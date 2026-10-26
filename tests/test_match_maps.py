"""Match Maps: defensive "threat prevented", shot map, pass network.

Offline and deterministic: hand-built events for the xT-orientation checks,
a seeded simulator match for the end-to-end shape checks, and the router
mounted on a bare FastAPI app (service/main.py wiring is a one-liner done
separately).
"""
from __future__ import annotations

import random

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.analyst0.match_maps import (
    compute_pass_network,
    compute_shot_map,
    compute_threat_prevented,
)
from agents.analyst0.metrics import xt_value
from datagen.match_simulator import MatchSimulator, build_squad
from datagen.schema import InterceptionEvent, PassEvent, ShotEvent, TackleEvent
from service.routers.match_maps import router
from service.state import STATE

_BASE = dict(match_id="T", period=1, second=0, possession_id=1)


def _interception(x: float, y: float, minute: int = 10, player: str = "home_4") -> InterceptionEvent:
    # A home defender cuts out an *away* pass; away attacks right-to-left,
    # i.e. toward home's own goal at x=0.
    return InterceptionEvent(
        **_BASE, minute=minute, match_clock_ms=minute * 60000, team="home", team_name="Home XI",
        player_id=player, player_name=f"Name {player}", location=(x, y), opponent_id="away_9",
    )


def _sim_events(seed: int = 7):
    rng = random.Random(seed)
    home = build_squad("home", "Home XI", rng)
    away = build_squad("away", "Away XI", rng)
    return MatchSimulator("MAPS-TEST", seed=seed, home_squad=home, away_squad=away).generate_match().events


@pytest.fixture(scope="module")
def sim_events():
    return [e for e in _sim_events() if e.type not in ("match_metadata", "referee_position", "referee_decision")]


# --- threat prevented ------------------------------------------------------

def test_interception_in_own_box_prevents_more_than_at_halfway():
    deep = compute_threat_prevented([_interception(8.0, 40.0)])
    halfway = compute_threat_prevented([_interception(60.0, 40.0)])
    assert deep["teams"]["home"]["xt_prevented"] > halfway["teams"]["home"]["xt_prevented"] > 0


def test_value_uses_attacking_team_orientation():
    # Home intercepting an away attack at x=8 must be valued as the *away*
    # team's xT there (near the goal it attacks), not home's (own box).
    result = compute_threat_prevented([_interception(8.0, 40.0)])
    moment = result["moments"][0]
    assert moment["xt_prevented"] == pytest.approx(xt_value((8.0, 40.0), "right_to_left"), abs=1e-4)
    assert moment["xt_prevented"] > xt_value((8.0, 40.0), "left_to_right")


def test_intercepted_pass_is_valued_at_its_intended_destination():
    pass_ = PassEvent(
        **_BASE, minute=20, match_clock_ms=20 * 60000, team="away", team_name="Away XI",
        player_id="away_8", player_name="A8", location=(70.0, 40.0), end_location=(10.0, 40.0),
        outcome="incomplete", pass_type="high", body_part="right_foot", distance_m=60.0,
        angle_deg=180.0, ball_speed_kmh=60.0,
    )
    # Interception logged a little upfield of the intended target.
    ev = _interception(30.0, 40.0, minute=20)
    result = compute_threat_prevented([pass_, ev])
    assert result["moments"][0]["xt_prevented"] == pytest.approx(xt_value((10.0, 40.0), "right_to_left"), abs=1e-4)


def test_only_won_tackles_count():
    won = TackleEvent(**_BASE, minute=5, match_clock_ms=300000, team="away", team_name="Away XI",
                      player_id="away_5", player_name="A5", location=(100.0, 40.0), outcome="won", opponent_id="home_9")
    lost = won.model_copy(update={"outcome": "lost", "event_id": "x"})
    result = compute_threat_prevented([won, lost])
    assert len(result["moments"]) == 1
    assert result["teams"]["away"]["actions"] == 1


def test_totals_equal_sum_of_moments(sim_events):
    result = compute_threat_prevented(sim_events)
    moments = result["all_moments_total"]
    team_sum = result["teams"]["home"]["xt_prevented"] + result["teams"]["away"]["xt_prevented"]
    player_sum = sum(p["xt_prevented"] for p in result["players"])
    assert team_sum == pytest.approx(moments, abs=1e-3)
    assert player_sum == pytest.approx(moments, abs=1e-3)
    assert result["teams"]["home"]["actions"] + result["teams"]["away"]["actions"] == result["n_actions"] > 0


def test_top_moments_are_five_sorted_descending(sim_events):
    result = compute_threat_prevented(sim_events)
    top = result["top_moments"]
    assert len(top) == 5
    values = [m["xt_prevented"] for m in top]
    assert values == sorted(values, reverse=True)
    assert all({"minute", "player_name", "action", "location"} <= m.keys() for m in top)


# --- shot map ----------------------------------------------------------------

def test_shot_map_lists_every_shot_with_team_totals(sim_events):
    shots = [e for e in sim_events if e.type == "shot"]
    result = compute_shot_map(sim_events)
    assert len(result["shots"]) == len(shots) > 0
    for team in ("home", "away"):
        mine = [s for s in shots if s.team == team]
        t = result["teams"][team]
        assert t["shots"] == len(mine)
        assert t["goals"] == sum(s.outcome == "goal" for s in mine)
        assert t["xg"] == pytest.approx(sum(s.xg for s in mine), abs=1e-3)
    first = result["shots"][0]
    assert {"location", "xg", "outcome", "team", "player_name", "minute", "shot_speed_kmh"} <= first.keys()


def test_shot_map_handles_no_shots():
    shot_free = compute_shot_map([_interception(50, 40)])
    assert shot_free["shots"] == []
    assert shot_free["teams"]["home"] == {"shots": 0, "xg": 0.0, "goals": 0, "on_target": 0, "team_name": "Home XI"}


def test_shot_map_field_values():
    shot = ShotEvent(**_BASE, minute=33, match_clock_ms=33 * 60000, team="home", team_name="Home XI",
                     player_id="home_9", player_name="H9", location=(108.0, 38.0), end_location=(120.0, 40.0),
                     outcome="goal", xg=0.31, shot_speed_kmh=101.5)
    s = compute_shot_map([shot])["shots"][0]
    assert s["location"] == [108.0, 38.0] and s["xg"] == 0.31 and s["outcome"] == "goal" and s["minute"] == 33


# --- pass network -------------------------------------------------------------

def test_pass_network_edges_respect_threshold_and_counts(sim_events):
    net = compute_pass_network(sim_events, "home", min_edge_count=3)
    completed = [e for e in sim_events if e.type == "pass" and e.team == "home" and e.outcome == "complete"]
    pair_counts: dict[tuple[str, str], int] = {}
    for p in completed:
        key = (p.player_id, p.recipient_id)
        pair_counts[key] = pair_counts.get(key, 0) + 1
    assert net["edges"], "a full simulated match should have some repeated pass pairs"
    for edge in net["edges"]:
        assert edge["count"] >= 3
        assert edge["count"] == pair_counts[(edge["source"], edge["target"])]
    assert len(net["edges"]) == sum(1 for c in pair_counts.values() if c >= 3)
    assert net["completed_passes"] == len(completed)


def test_pass_network_nodes_have_locations_on_pitch(sim_events):
    net = compute_pass_network(sim_events, "away")
    ids = {n["player_id"] for n in net["nodes"]}
    assert ids and all(i.startswith("away") for i in ids)
    for n in net["nodes"]:
        x, y = n["avg_location"]
        assert 0 <= x <= 120 and 0 <= y <= 80
        assert n["involvement"] == n["passes"] + n["received"]
    for e in net["edges"]:
        assert e["source"] in ids and e["target"] in ids


# --- router ------------------------------------------------------------------

@pytest.fixture
def client(sim_events):
    STATE.setdefault("events_by_match", {})["MAPS-TEST"] = sim_events
    STATE.setdefault("player_names_by_match", {})["MAPS-TEST"] = {}
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.mark.parametrize("path", ["threat-prevented", "shot-map", "pass-network"])
def test_unknown_match_is_404(client, path):
    assert client.get(f"/matches/NOPE/{path}").status_code == 404


@pytest.mark.parametrize("path", ["threat-prevented", "shot-map", "pass-network?team=away"])
def test_endpoints_return_200(client, path):
    resp = client.get(f"/matches/MAPS-TEST/{path}")
    assert resp.status_code == 200
    assert resp.json()["match_id"] == "MAPS-TEST"


def test_pass_network_rejects_bad_team(client):
    assert client.get("/matches/MAPS-TEST/pass-network?team=neutral").status_code == 422
