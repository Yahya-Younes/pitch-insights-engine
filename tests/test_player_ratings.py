"""Player ratings (FIFA-style card numbers) and per-player heatmaps
(agents/analyst0/player_ratings.py and service/routers/player_ratings.py).

Events are hand-built schema models so every expectation is traceable; the
determinism / range checks use a seeded MatchSimulator match.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.analyst0.player_ratings import (
    ATTRIBUTE_FLOOR,
    ATTRIBUTES,
    RATING_MAX,
    RATING_MIN,
    compute_player_heatmap,
    compute_player_ratings,
)
from datagen.schema import InterceptionEvent, PassEvent, ShotEvent, TackleEvent

_BASE = {"match_id": "M", "period": 1, "possession_id": 1}


def _env(t_ms: int, team: str, pid: str) -> dict:
    return {
        **_BASE, "minute": t_ms // 60000, "second": (t_ms // 1000) % 60, "match_clock_ms": t_ms,
        "team": team, "team_name": team.title(), "player_id": pid, "player_name": pid,
    }


def _pass(t_ms, team, pid, start, end, outcome="complete", recipient=None) -> PassEvent:
    return PassEvent(
        **_env(t_ms, team, pid), location=start, end_location=end, outcome=outcome,
        recipient_id=recipient, recipient_name=recipient, pass_type="ground", body_part="right_foot",
        distance_m=10.0, angle_deg=0.0, ball_speed_kmh=50.0,
    )


def _shot(t_ms, team, pid, loc, xg, outcome) -> ShotEvent:
    return ShotEvent(
        **_env(t_ms, team, pid), location=loc, end_location=(120.0, 40.0), outcome=outcome, xg=xg,
        shot_speed_kmh=90.0,
    )


def _twins_events(scorer_shoots: bool) -> list:
    """home_9 and home_10 do exactly the same things, except home_9 may score."""
    events = []
    t = 1000
    for pid in ("home_9", "home_10"):
        for _ in range(5):
            events.append(_pass(t, "home", pid, (60.0, 40.0), (80.0, 40.0), recipient="home_6"))
            t += 1000
    for pid in ("home_6", "away_4"):
        events.append(_pass(t, "home" if pid.startswith("home") else "away", pid, (50.0, 30.0), (55.0, 30.0),
                            recipient="home_9" if pid.startswith("home") else "away_5"))
        t += 1000
    events.append(TackleEvent(**_env(t, "away", "away_4"), location=(70.0, 40.0), outcome="won", opponent_id="home_9"))
    t += 1000
    events.append(InterceptionEvent(**_env(t, "home", "home_6"), location=(40.0, 40.0), opponent_id="away_5"))
    t += 1000
    if scorer_shoots:
        events.append(_shot(t, "home", "home_9", (110.0, 40.0), 0.62, "goal"))
    return events


def _by_id(result: dict) -> dict[str, dict]:
    return {p["player_id"]: p for p in result["players"]}


# ---------------------------------------------------------------------------
# Pure logic
# ---------------------------------------------------------------------------

def test_goal_scorer_outranks_identical_twin():
    result = compute_player_ratings(_twins_events(scorer_shoots=True), None, {})
    players = _by_id(result)
    scorer, twin = players["home_9"], players["home_10"]
    assert scorer["raw"]["goals"] == 1 and scorer["raw"]["xg"] == pytest.approx(0.62)
    assert twin["raw"]["goals"] == 0
    assert scorer["attributes"]["shooting"] > twin["attributes"]["shooting"]
    assert scorer["rating"] > twin["rating"]
    # Everything else about them is the same.
    for attr in ("passing", "pace", "work_rate"):
        assert scorer["attributes"][attr] == twin["attributes"][attr]


def test_ratings_and_attributes_in_range_and_motm_is_max():
    result = compute_player_ratings(_twins_events(scorer_shoots=True), None, {"home_9": "Nine"})
    assert result["players"], "expected rated players"
    for p in result["players"]:
        assert RATING_MIN <= p["rating"] <= RATING_MAX
        assert isinstance(p["rating"], int)
        assert set(p["attributes"]) == set(ATTRIBUTES)
        for v in p["attributes"].values():
            assert isinstance(v, int) and ATTRIBUTE_FLOOR <= v <= 99
    motm = result["man_of_the_match"]
    assert motm["rating"] == max(p["rating"] for p in result["players"])
    assert motm["player_id"] == "home_9"
    assert "goal" in motm["reason"]
    assert _by_id(result)["home_9"]["name"] == "Nine"
    assert isinstance(result["method"], str) and result["method"]


def test_raw_numbers_come_straight_from_events():
    events = [
        _pass(1000, "home", "home_6", (40.0, 40.0), (80.0, 40.0), recipient="home_9"),
        _pass(2000, "home", "home_6", (40.0, 40.0), (80.0, 40.0), outcome="incomplete"),
        _pass(3000, "home", "home_9", (90.0, 40.0), (60.0, 40.0), recipient="home_6"),  # backwards
        _shot(4000, "home", "home_9", (108.0, 40.0), 0.3, "saved"),
    ]
    raw = _by_id(compute_player_ratings(events, None, {}))
    six, nine = raw["home_6"]["raw"], raw["home_9"]["raw"]
    assert six["passes_attempted"] == 2 and six["passes_completed"] == 1 and six["pass_pct"] == 50.0
    assert six["xt_added"] > 0
    assert nine["xt_added"] == 0  # backward pass adds no threat
    assert nine["shots"] == 1 and nine["goals"] == 0 and nine["xg"] == pytest.approx(0.3)
    assert nine["touches"] == 2
    assert six["top_speed_kmh"] == 0 and six["distance_km"] == 0  # no position track supplied


def test_position_aware_weights_use_roles_when_given():
    events = _twins_events(scorer_shoots=True)
    plain = _by_id(compute_player_ratings(events, None, {}))
    roles = _by_id(compute_player_ratings(events, None, {}, roles={"home_9": "FW", "home_6": "CB"}))
    assert roles["home_9"]["position"] == "FW"
    assert roles["home_10"]["position"] is None
    assert plain["home_9"]["position"] is None
    # A forward who scored is weighted toward shooting, so rates at least as high.
    assert roles["home_9"]["rating"] >= plain["home_9"]["rating"]


def test_seeded_simulated_match_is_deterministic_and_in_range():
    from datagen.match_simulator import MatchSimulator
    from datagen.trajectory import generate_positions

    cutoff = 15 * 60000
    sim = MatchSimulator("SIM", 11).generate_match()
    events = [e for e in sim.events if e.type != "match_metadata" and e.match_clock_ms <= cutoff]
    positions = generate_positions("SIM", events, sim.home_profiles, sim.away_profiles, cutoff)
    names = {p.player_id: p.player_name for p in [*sim.home_profiles, *sim.away_profiles]}
    roles = {p.player_id: p.position for p in [*sim.home_profiles, *sim.away_profiles]}

    first = compute_player_ratings(events, positions, names, roles=roles)
    second = compute_player_ratings(events, positions, names, roles=roles)
    assert first == second
    assert len(first["players"]) >= 20
    for p in first["players"]:
        assert RATING_MIN <= p["rating"] <= RATING_MAX
        assert p["position"] in ("GK", "CB", "FB", "CM", "WM", "FW")
    assert any(p["raw"]["distance_km"] > 0 for p in first["players"])
    assert first["man_of_the_match"]["rating"] == max(p["rating"] for p in first["players"])


# ---------------------------------------------------------------------------
# Heatmap
# ---------------------------------------------------------------------------

@dataclass
class Frame:
    t_ms: int
    ball: tuple[float, float, float] = (60.0, 40.0, 0.0)
    players: dict[str, tuple[float, float]] = field(default_factory=dict)


def _corner_frames() -> list[Frame]:
    return [Frame(t_ms=i * 100, players={"home_9": (2.0, 3.0), "away_2": (110.0, 70.0)}) for i in range(50)]


def test_heatmap_peaks_in_the_corner_cell():
    result = compute_player_heatmap("home_9", _corner_frames(), [], {"home_9": "Nine"}, cols=12, rows=8)
    assert result["grid"] == {"cols": 12, "rows": 8}
    cells = result["cells"]
    assert len(cells) == 8 and all(len(r) == 12 for r in cells)
    assert cells[0][0] == 1.0
    assert sum(sum(r) for r in cells) == pytest.approx(1.0)
    assert result["name"] == "Nine" and result["team"] == "home"
    assert result["attack_direction"] == "left_to_right"
    assert result["source"] == "positions"


def test_heatmap_falls_back_to_event_locations():
    events = [_pass(1000 * i, "away", "away_7", (115.0, 75.0), (100.0, 70.0)) for i in range(4)]
    result = compute_player_heatmap("away_7", None, events, {}, cols=12, rows=8)
    assert result["source"] == "events"
    assert result["cells"][7][11] == 1.0
    assert result["touches"] == 4
    assert result["attack_direction"] == "right_to_left"


def test_heatmap_unknown_player_returns_none():
    assert compute_player_heatmap("home_99", _corner_frames(), [], {}, cols=12, rows=8) is None


# ---------------------------------------------------------------------------
# HTTP router
# ---------------------------------------------------------------------------

@pytest.fixture
def api(STATE):
    from service.routers.player_ratings import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_unknown_match_is_404(api):
    assert api.get("/matches/NOPE/player-ratings").status_code == 404
    assert api.get("/matches/NOPE/players/home_9/heatmap").status_code == 404


def test_ratings_endpoint_serves_a_seeded_match(api, STATE):
    STATE.setdefault("events_by_match", {})["R1"] = _twins_events(scorer_shoots=True)
    STATE.setdefault("player_names_by_match", {})["R1"] = {"home_9": "Nine"}
    STATE.setdefault("player_roles_by_match", {})["R1"] = {"home_9": "FW"}
    res = api.get("/matches/R1/player-ratings")
    assert res.status_code == 200
    body = res.json()
    assert body["match_id"] == "R1"
    assert body["man_of_the_match"]["player_id"] == "home_9"
    nine = next(p for p in body["players"] if p["player_id"] == "home_9")
    assert nine["position"] == "FW" and nine["name"] == "Nine"
    assert api.get("/matches/R1/player-ratings").json() == body  # cached, stable


def test_heatmap_endpoint(api, STATE):
    STATE.setdefault("events_by_match", {})["H1"] = []
    STATE.setdefault("positions_by_match", {})["H1"] = _corner_frames()
    res = api.get("/matches/H1/players/home_9/heatmap?cols=6&rows=4")
    assert res.status_code == 200
    body = res.json()
    assert body["grid"] == {"cols": 6, "rows": 4}
    assert body["cells"][0][0] == 1.0
    assert api.get("/matches/H1/players/home_99/heatmap").status_code == 404
    assert api.get("/matches/H1/players/home_9/heatmap?cols=0").status_code == 422
