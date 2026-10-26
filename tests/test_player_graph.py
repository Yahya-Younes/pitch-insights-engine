"""Player graph: pass + duel network with centrality and insights.

Offline and deterministic: hand-built events for the counting / centrality
checks, a seeded simulator match for the end-to-end checks, and the router
mounted on a bare FastAPI app (service/main.py wiring is done separately).
"""
from __future__ import annotations

import itertools
import random

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.analyst0.metrics import direction_of, xt_value
from agents.analyst0.player_graph import compute_player_graph
from datagen.match_simulator import MatchSimulator, build_squad
from datagen.schema import DribbleEvent, DuelEvent, InterceptionEvent, PassEvent, TackleEvent
from service.routers.player_graph import router
from service.state import STATE


def _env(team: str, player: str, minute: int, loc=(60.0, 40.0), second: int = 0, clock_ms: int | None = None) -> dict:
    return dict(
        match_id="G", period=1 if minute < 45 else 2, minute=minute, second=second,
        match_clock_ms=clock_ms if clock_ms is not None else (minute * 60 + second) * 1000,
        team=team, team_name=f"{team.title()} XI", player_id=player, player_name=f"Name {player}",
        location=loc, possession_id=1,
    )


def _pass(src: str, dst: str | None, minute: int = 10, team: str = "home", outcome: str = "complete",
          start=(40.0, 40.0), end=(60.0, 40.0)) -> PassEvent:
    return PassEvent(
        **_env(team, src, minute, start), end_location=end, recipient_id=dst,
        recipient_name=f"Name {dst}" if dst else None, outcome=outcome, pass_type="ground",
        body_part="right_foot", distance_m=20.0, angle_deg=0.0, ball_speed_kmh=40.0,
    )


def _node(graph: dict, pid: str) -> dict:
    return next(n for n in graph["nodes"] if n["id"] == pid)


def _edge(graph: dict, src: str, dst: str, kind: str = "pass") -> dict | None:
    return next((e for e in graph["edges"] if e["kind"] == kind and e["source"] == src and e["target"] == dst), None)


# --- pass edges --------------------------------------------------------------

def test_pass_edge_counts_completed_counts_and_xt():
    events = [
        _pass("h1", "h2", start=(40.0, 40.0), end=(70.0, 40.0)),
        _pass("h1", "h2", start=(50.0, 30.0), end=(95.0, 35.0)),
        _pass("h1", "h2", outcome="incomplete", start=(50.0, 30.0), end=(110.0, 40.0)),
        _pass("h2", "h1"),
    ]
    g = compute_player_graph(events, min_passes=1)
    e = _edge(g, "h1", "h2")
    assert e == {**e, "count": 3, "completed_count": 2, "directed": True}
    d = direction_of("home")
    expected = (xt_value((70.0, 40.0), d) - xt_value((40.0, 40.0), d)) + (xt_value((95.0, 35.0), d) - xt_value((50.0, 30.0), d))
    assert e["xt_added"] == pytest.approx(expected, abs=1e-4)  # incomplete pass adds nothing
    assert _edge(g, "h2", "h1")["count"] == 1
    h1 = _node(g, "h1")
    assert h1["passes_made"] == 3 and h1["passes_received"] == 1 and h1["team"] == "home"
    assert _node(g, "h2")["passes_received"] == 2  # only completed passes are received


def test_window_filters_by_minute():
    events = [_pass("h1", "h2", minute=5), _pass("h1", "h2", minute=6), _pass("h3", "h4", minute=60),
              _pass("h3", "h4", minute=61)]
    first = compute_player_graph(events, from_min=0, to_min=45, min_passes=1)
    assert first["window"] == {"from_min": 0, "to_min": 45}
    assert {n["id"] for n in first["nodes"]} == {"h1", "h2"}
    assert _edge(first, "h1", "h2")["count"] == 2
    second = compute_player_graph(events, from_min=45, to_min=90, min_passes=1)
    assert {n["id"] for n in second["nodes"]} == {"h3", "h4"}


def test_min_passes_threshold_drops_edges_and_flags_isolated():
    events = [_pass("h1", "h2"), _pass("h1", "h2"), _pass("h3", "h1")]
    g = compute_player_graph(events, min_passes=2)
    assert _edge(g, "h1", "h2")["count"] == 2
    assert _edge(g, "h3", "h1") is None
    assert g["insights"]["isolated_players"] == ["h3"]
    assert compute_player_graph(events, min_passes=1)["insights"]["isolated_players"] == []


def test_top_pairs_combine_both_directions():
    events = [_pass("h1", "h2")] * 2 + [_pass("h2", "h1")] * 2 + [_pass("h3", "h4")] * 3
    pairs = compute_player_graph(events, min_passes=1)["insights"]["top_pairs"]
    assert {frozenset((pairs[0]["a"], pairs[0]["b"])): pairs[0]["passes"]} == {frozenset(("h1", "h2")): 4}
    assert pairs[1]["passes"] == 3
    assert len(pairs) == 2


# --- centrality ----------------------------------------------------------------

def test_betweenness_normalised_on_a_line():
    # a -> b -> c: b is on the only a->c shortest path, 1 of (n-1)(n-2) = 2 ordered pairs.
    events = [_pass("a", "b")] * 2 + [_pass("b", "c")] * 2
    g = compute_player_graph(events, min_passes=1)
    assert _node(g, "b")["betweenness"] == pytest.approx(0.5)
    assert _node(g, "a")["betweenness"] == 0 and _node(g, "c")["betweenness"] == 0
    assert _node(g, "b")["degree_centrality"] == pytest.approx(1.0)
    assert _node(g, "a")["degree_centrality"] == pytest.approx(0.5)


def test_hub_is_the_bridge_between_two_cliques():
    events = []
    for clique in (("a1", "a2", "a3"), ("b1", "b2", "b3")):
        for s, t in itertools.permutations(clique, 2):
            events += [_pass(s, t)] * 3
    for s, t in (("a1", "hub"), ("hub", "a1"), ("hub", "b1"), ("b1", "hub")):
        events += [_pass(s, t)] * 3
    g = compute_player_graph(events, min_passes=2)
    hub = g["insights"]["hub"]
    assert hub["player_id"] == "hub"
    assert hub["name"] == "Name hub" and hub["reason"]
    assert hub["betweenness"] == max(n["betweenness"] for n in g["nodes"])
    assert all(0.0 <= n["betweenness"] <= 1.0 for n in g["nodes"])
    assert _node(g, "a2")["betweenness"] == 0


def test_weighted_distance_prefers_frequent_links():
    # a->c directly once (distance 1) vs a->b->c with 5 each (distance 0.4): b is on the shortest path.
    events = [_pass("a", "c")] + [_pass("a", "b")] * 5 + [_pass("b", "c")] * 5
    g = compute_player_graph(events, min_passes=1)
    assert _node(g, "b")["betweenness"] == pytest.approx(0.5)


# --- duels -------------------------------------------------------------------------

def _duel_events():
    return [
        _pass("h1", "h2"), _pass("a1", "a2", team="away"),
        DuelEvent(**_env("home", "h1", 20), outcome="won", opponent_id="a1", duel_type="aerial"),
        DuelEvent(**_env("away", "a1", 21), outcome="won", opponent_id="h1", duel_type="aerial"),
        TackleEvent(**_env("home", "h1", 22), outcome="won", opponent_id="a1"),
        InterceptionEvent(**_env("away", "a2", 23), opponent_id="h2"),
        # A tackled dribble is logged twice by the simulator (dribble + won tackle): one contest.
        DribbleEvent(**_env("away", "a1", 24, clock_ms=24 * 60000), outcome="tackled", opponent_id="h1"),
        TackleEvent(**_env("home", "h1", 24, clock_ms=24 * 60000), outcome="won", opponent_id="a1"),
    ]


def test_duel_edges_only_when_requested():
    events = _duel_events()
    without = compute_player_graph(events, include_duels=False, min_passes=1)
    assert not [e for e in without["edges"] if e["kind"] == "duel"]
    assert without["insights"]["most_contested_duel"] is None

    g = compute_player_graph(events, include_duels=True, min_passes=1)
    duels = [e for e in g["edges"] if e["kind"] == "duel"]
    by_pair = {frozenset((e["source"], e["target"])): e for e in duels}
    h1a1 = by_pair[frozenset(("h1", "a1"))]
    assert h1a1["count"] == 4 and h1a1["directed"] is False
    wins = {h1a1["source"]: h1a1["won_by_source"], h1a1["target"]: h1a1["won_by_target"]}
    assert wins == {"h1": 3, "a1": 1}
    h2a2 = by_pair[frozenset(("h2", "a2"))]
    assert h2a2["count"] == 1
    assert {h2a2["source"]: h2a2["won_by_source"], h2a2["target"]: h2a2["won_by_target"]} == {"a2": 1, "h2": 0}
    contested = g["insights"]["most_contested_duel"]
    assert {contested["a"], contested["b"]} == {"h1", "a1"} and contested["count"] == 4


def test_single_team_view_has_no_cross_team_duels():
    g = compute_player_graph(_duel_events(), team="home", include_duels=True, min_passes=1)
    assert {n["team"] for n in g["nodes"]} == {"home"}
    assert all(e["kind"] == "pass" for e in g["edges"])


def test_duel_without_opponent_id_is_paired_with_preceding_carrier():
    carry = {**_env("away", "a9", 30, clock_ms=1_800_000), "type": "carry", "end_location": (50.0, 40.0),
             "duration_s": 1.0}
    tackle = {**_env("home", "h5", 30, clock_ms=1_801_500), "type": "tackle", "outcome": "won"}
    g = compute_player_graph([carry, tackle], include_duels=True, min_passes=1)
    duel = next(e for e in g["edges"] if e["kind"] == "duel")
    assert {duel["source"], duel["target"]} == {"a9", "h5"}
    assert "inferred" in g["method"]
    # Too far apart in time: no pairing.
    late = {**tackle, "match_clock_ms": 1_806_000}
    assert not [e for e in compute_player_graph([carry, late])["edges"] if e["kind"] == "duel"]


# --- seeded simulator match + router ---------------------------------------------

def _sim_events(seed: int = 11):
    rng = random.Random(seed)
    home = build_squad("home", "Home XI", rng)
    away = build_squad("away", "Away XI", rng)
    events = MatchSimulator("GRAPH-TEST", seed=seed, home_squad=home, away_squad=away).generate_match().events
    return [e for e in events if e.type not in ("match_metadata", "referee_position", "referee_decision")]


@pytest.fixture(scope="module")
def sim_events():
    return _sim_events()


def test_simulated_match_is_deterministic_and_well_formed(sim_events):
    a = compute_player_graph(sim_events)
    b = compute_player_graph(_sim_events())
    assert a == b
    ids = {n["id"] for n in a["nodes"]}
    assert {n["team"] for n in a["nodes"]} == {"home", "away"}
    for n in a["nodes"]:
        assert 0 <= n["avg_x"] <= 120 and 0 <= n["avg_y"] <= 80
        assert 0 <= n["betweenness"] <= 1 and 0 <= n["degree_centrality"] <= 1
    for e in a["edges"]:
        assert e["source"] in ids and e["target"] in ids
        if e["kind"] == "pass":
            assert e["count"] >= 2
    assert any(e["kind"] == "duel" for e in a["edges"])
    assert a["insights"]["hub"]["player_id"] in ids
    assert len(a["insights"]["top_pairs"]) == 3


@pytest.fixture
def client(sim_events):
    STATE.setdefault("events_by_match", {})["GRAPH-TEST"] = sim_events
    STATE.setdefault("player_names_by_match", {})["GRAPH-TEST"] = {}
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_endpoint_returns_graph(client):
    resp = client.get("/matches/GRAPH-TEST/player-graph?from_min=0&to_min=45&team=away&min_passes=1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["match_id"] == "GRAPH-TEST"
    assert body["window"] == {"from_min": 0, "to_min": 45}
    assert {"nodes", "edges", "insights", "method"} <= body.keys()
    assert {n["team"] for n in body["nodes"]} == {"away"}
    assert client.get("/matches/GRAPH-TEST/player-graph?from_min=0&to_min=45&team=away&min_passes=1").json() == body


def test_unknown_match_is_404(client):
    assert client.get("/matches/NOPE/player-graph").status_code == 404


@pytest.mark.parametrize("query", [
    "team=neutral", "from_min=-1", "to_min=121", "from_min=50&to_min=40", "from_min=30&to_min=30", "min_passes=0",
])
def test_bad_params_are_rejected(client, query):
    assert 400 <= client.get(f"/matches/GRAPH-TEST/player-graph?{query}").status_code < 500
