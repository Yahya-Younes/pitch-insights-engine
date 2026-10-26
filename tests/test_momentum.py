"""Match momentum: xT added per team per time bucket
(agents/analyst0/momentum.py and service/routers/momentum.py)."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.analyst0.momentum import compute_momentum
from datagen.schema import CarryEvent, PassEvent, ShotEvent

_BASE = {"match_id": "M", "period": 1, "possession_id": 1}


def _env(t_ms: int, team: str, pid: str) -> dict:
    return {
        **_BASE, "minute": t_ms // 60000, "second": (t_ms // 1000) % 60, "match_clock_ms": t_ms,
        "team": team, "team_name": team.title(), "player_id": pid, "player_name": pid,
    }


def _pass(t_ms, team, pid, start, end, outcome="complete") -> PassEvent:
    return PassEvent(
        **_env(t_ms, team, pid), location=start, end_location=end, outcome=outcome,
        pass_type="ground", body_part="right_foot", distance_m=10.0, angle_deg=0.0, ball_speed_kmh=50.0,
    )


def _carry(t_ms, team, pid, start, end) -> CarryEvent:
    return CarryEvent(**_env(t_ms, team, pid), location=start, end_location=end, duration_s=2.0)


def _goal(t_ms, team, pid) -> ShotEvent:
    return ShotEvent(
        **_env(t_ms, team, pid), location=(108.0, 40.0), end_location=(120.0, 40.0), outcome="goal",
        xg=0.4, shot_speed_kmh=95.0,
    )


def test_buckets_cover_match_duration():
    result = compute_momentum([], 10 * 60000, bucket_min=1)
    assert [b["minute"] for b in result["buckets"]] == list(range(10))
    assert all(b["momentum"] == 0 for b in result["buckets"])

    coarse = compute_momentum([], 10 * 60000, bucket_min=3)
    assert [b["minute"] for b in coarse["buckets"]] == [0, 3, 6, 9]
    assert coarse["bucket_min"] == 3


def test_home_only_progressive_passes_give_positive_momentum():
    events = [
        _pass(2 * 60000 + 1000, "home", "home_6", (60.0, 40.0), (100.0, 40.0)),
        _pass(2 * 60000 + 9000, "home", "home_7", (70.0, 30.0), (105.0, 38.0)),
        # Away progression in a different bucket.
        _carry(5 * 60000, "away", "away_6", (60.0, 40.0), (30.0, 40.0)),
        # Incomplete passes add nothing.
        _pass(7 * 60000, "away", "away_6", (60.0, 40.0), (15.0, 40.0), outcome="incomplete"),
    ]
    result = compute_momentum(events, 10 * 60000, bucket_min=1)
    buckets = {b["minute"]: b for b in result["buckets"]}
    assert buckets[2]["home_xt"] > 0 and buckets[2]["away_xt"] == 0
    assert buckets[2]["momentum"] > 0
    assert buckets[5]["momentum"] < 0 and buckets[5]["away_xt"] > 0
    assert buckets[7]["away_xt"] == 0 and buckets[7]["momentum"] == 0
    for b in result["buckets"]:
        assert -1.0 <= b["momentum"] <= 1.0
    assert max(abs(b["momentum"]) for b in result["buckets"]) == pytest.approx(1.0)


def test_backward_moves_add_no_threat():
    events = [_pass(60000, "home", "home_4", (80.0, 40.0), (30.0, 40.0))]
    result = compute_momentum(events, 3 * 60000)
    assert all(b["home_xt"] == 0 for b in result["buckets"])


def test_goals_listed_with_names():
    events = [_goal(33 * 60000 + 5000, "away", "away_9")]
    result = compute_momentum(events, 45 * 60000, player_names={"away_9": "Nine"})
    assert result["goals"] == [{"minute": 33, "team": "away", "player_name": "Nine"}]


def test_seeded_match_is_deterministic():
    from datagen.match_simulator import MatchSimulator

    sim = MatchSimulator("SIM", 5).generate_match()
    events = [e for e in sim.events if e.type != "match_metadata"]
    first = compute_momentum(events, 90 * 60000, bucket_min=5)
    assert first == compute_momentum(events, 90 * 60000, bucket_min=5)
    assert len(first["buckets"]) == 18
    assert sum(b["home_xt"] + b["away_xt"] for b in first["buckets"]) > 0


# ---------------------------------------------------------------------------
# HTTP router
# ---------------------------------------------------------------------------

@pytest.fixture
def api(STATE):
    from service.routers.momentum import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_unknown_match_is_404(api):
    assert api.get("/matches/NOPE/momentum").status_code == 404


def test_endpoint_serves_buckets(api, STATE):
    STATE.setdefault("events_by_match", {})["MO1"] = [
        _pass(30000, "home", "home_6", (60.0, 40.0), (100.0, 40.0)),
    ]
    STATE.setdefault("duration_ms_by_match", {})["MO1"] = 4 * 60000
    res = api.get("/matches/MO1/momentum?bucket_min=2")
    assert res.status_code == 200
    body = res.json()
    assert body["match_id"] == "MO1"
    assert [b["minute"] for b in body["buckets"]] == [0, 2]
    assert body["buckets"][0]["momentum"] == 1.0
    assert api.get("/matches/MO1/momentum?bucket_min=0").status_code == 422
