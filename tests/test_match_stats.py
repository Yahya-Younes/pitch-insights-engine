"""EA FC-style match stats (agents/analyst0/match_stats.py and
service/routers/match_stats.py), checked against hand-built events."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.analyst0.match_stats import STAT_KEYS, compute_match_stats
from agents.analyst0.metrics import compute_ppda
from datagen.schema import (
    CardEvent,
    CarryEvent,
    DuelEvent,
    FoulEvent,
    InterceptionEvent,
    PassEvent,
    ShotEvent,
    TackleEvent,
)


def _env(minute: int, pid: str, sec: int = 0) -> dict:
    t_ms = minute * 60000 + sec * 1000
    team = pid.split("_", 1)[0]
    return {
        "match_id": "M", "period": 1 if minute < 45 else 2, "possession_id": 1, "minute": minute, "second": sec,
        "match_clock_ms": t_ms, "team": team, "team_name": team.title(), "player_id": pid, "player_name": pid,
    }


def _pass(minute, pid, outcome="complete", sec=0, start=(40.0, 40.0)):
    return PassEvent(
        **_env(minute, pid, sec), location=start, end_location=(50.0, 40.0), outcome=outcome,
        recipient_id="x" if outcome == "complete" else None, pass_type="ground", body_part="right_foot",
        distance_m=10.0, angle_deg=0.0, ball_speed_kmh=50.0,
    )


def _shot(minute, pid, xg, outcome):
    return ShotEvent(**_env(minute, pid), location=(108.0, 40.0), end_location=(120.0, 40.0), outcome=outcome,
                     xg=xg, shot_speed_kmh=90.0)


def _events() -> list:
    return [
        _pass(1, "home_6"), _pass(2, "home_6"), _pass(3, "home_8"), _pass(4, "home_8", outcome="incomplete"),
        CarryEvent(**_env(4, "home_8", 30), location=(50.0, 40.0), end_location=(55.0, 40.0), duration_s=1.0),
        _pass(6, "away_6", start=(80.0, 40.0)),
        _shot(5, "home_9", 0.5, "goal"),
        DuelEvent(**_env(10, "home_5"), location=(50.0, 40.0), outcome="won", opponent_id="away_9", duel_type="aerial"),
        DuelEvent(**_env(11, "away_6"), location=(50.0, 40.0), outcome="lost", opponent_id="home_10", duel_type="ground"),
        FoulEvent(**_env(20, "away_4"), location=(50.0, 40.0), opponent_id="home_9", severity="reckless"),
        CardEvent(**_env(20, "away_4"), location=(50.0, 40.0), card_type="yellow", reason="reckless foul"),
        _shot(50, "home_9", 0.2, "saved"),
        InterceptionEvent(**_env(60, "away_6"), location=(70.0, 40.0), opponent_id="home_8"),
        TackleEvent(**_env(70, "home_4"), location=(60.0, 40.0), outcome="won", opponent_id="away_9"),
        TackleEvent(**_env(72, "away_4"), location=(60.0, 40.0), outcome="lost", opponent_id="home_9"),
        _shot(80, "away_9", 0.1, "off_target"),
        FoulEvent(**_env(85, "away_6"), location=(50.0, 40.0), opponent_id="home_9", severity="serious"),
        CardEvent(**_env(85, "away_6"), location=(50.0, 40.0), card_type="red", reason="serious foul"),
    ]


def _stats(result: dict) -> dict[str, dict]:
    return {s["key"]: s for s in result["stats"]}


def test_keys_order_and_shape():
    result = compute_match_stats(_events())
    assert [s["key"] for s in result["stats"]] == list(STAT_KEYS) == [
        "possession", "xg", "shots", "pass_accuracy", "ppda", "duels_won", "interceptions", "tackles_won",
        "fouls", "cards",
    ]
    for s in result["stats"]:
        assert set(s) == {"key", "label", "home", "away", "home_display", "away_display", "higher_is_better"}
        assert isinstance(s["label"], str) and s["label"]
    lower_better = {s["key"] for s in result["stats"] if not s["higher_is_better"]}
    assert lower_better == {"ppda", "fouls", "cards"}


def test_full_match_totals():
    events = _events()
    result = compute_match_stats(events)
    assert result["minute"] == 85
    assert result["score"] == {"home": 1, "away": 0}
    assert result["window"] == {"from_min": 0, "to_min": 85}
    s = _stats(result)
    # possession = share of passes + carries: home 4 passes + 1 carry vs away 1 pass
    assert s["possession"]["home"] == pytest.approx(83.3) and s["possession"]["away"] == pytest.approx(16.7)
    assert (s["possession"]["home_display"], s["possession"]["away_display"]) == ("83 %", "17 %")
    assert s["xg"]["home"] == pytest.approx(0.7) and s["xg"]["home_display"] == "0,70"
    assert s["xg"]["away_display"] == "0,10"
    assert (s["shots"]["home"], s["shots"]["home_display"]) == (2, "2 (2)")
    assert (s["shots"]["away"], s["shots"]["away_display"]) == (1, "1 (0)")
    assert s["pass_accuracy"]["home"] == pytest.approx(75.0) and s["pass_accuracy"]["home_display"] == "75 %"
    assert s["pass_accuracy"]["away_display"] == "100 %"
    ppda_home = compute_ppda(events, "home", 0, 86 * 60000)
    assert s["ppda"]["home"] == pytest.approx(ppda_home or 0.0)
    assert (s["duels_won"]["home"], s["duels_won"]["away"]) == (2, 0)
    assert (s["interceptions"]["home"], s["interceptions"]["away"]) == (0, 1)
    assert (s["tackles_won"]["home"], s["tackles_won"]["away"]) == (1, 0)
    assert (s["fouls"]["home"], s["fouls"]["away"]) == (0, 2)
    assert (s["cards"]["home"], s["cards"]["home_display"]) == (0, "0")
    assert (s["cards"]["away"], s["cards"]["away_display"]) == (3, "1 🟨 1 🟥")


def test_last_minutes_window_filters_stats_but_not_score():
    result = compute_match_stats(_events(), last_minutes=15)
    assert result["window"] == {"from_min": 71, "to_min": 85}
    assert result["score"] == {"home": 1, "away": 0}
    s = _stats(result)
    assert (s["shots"]["home"], s["shots"]["away"]) == (0, 1)
    assert s["xg"]["home"] == 0 and s["xg"]["away"] == pytest.approx(0.1)
    assert (s["tackles_won"]["home"], s["fouls"]["away"]) == (0, 1)
    assert (s["cards"]["away"], s["cards"]["away_display"]) == (2, "1 🟥")
    # No passes/carries in the window: an even split, not a crash.
    assert s["possession"]["home"] == 50.0 and s["pass_accuracy"]["home_display"] == "–"


def test_empty_match():
    result = compute_match_stats([])
    assert result["minute"] == 0 and result["score"] == {"home": 0, "away": 0}
    assert len(result["stats"]) == len(STAT_KEYS)


@pytest.fixture
def api(STATE):
    from service.routers.match_stats import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_unknown_match_is_404(api):
    assert api.get("/matches/NOPE/match-stats").status_code == 404


def test_endpoint(api, STATE):
    STATE.setdefault("events_by_match", {})["S1"] = _events()
    body = api.get("/matches/S1/match-stats").json()
    assert body["match_id"] == "S1" and body["minute"] == 85 and body["score"] == {"home": 1, "away": 0}
    assert [s["key"] for s in body["stats"]] == list(STAT_KEYS)
    windowed = api.get("/matches/S1/match-stats?last_minutes=15").json()
    assert windowed["window"] == {"from_min": 71, "to_min": 85}
    assert api.get("/matches/S1/match-stats?last_minutes=0").status_code == 422
