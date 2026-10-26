"""Behavioural tests for the live win-probability model
(agents/analyst0/win_probability.py) and its router
(service/routers/win_probability.py)."""
from __future__ import annotations

import random
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.analyst0.win_probability import (
    FULL_TIME_MIN,
    compute_win_probability,
    outcome_probabilities,
)
from datagen.match_simulator import MatchSimulator, build_squad


def _shot(team: str, minute: float, xg: float, goal: bool = False, player: str = "P") -> SimpleNamespace:
    ms = int(minute * 60000)
    return SimpleNamespace(
        type="shot", team=team, minute=ms // 60000, second=(ms // 1000) % 60, match_clock_ms=ms,
        outcome="goal" if goal else "saved", xg=xg, player_name=player, event_id=f"{team}-{ms}",
    )


def _pass(team: str, minute: float) -> SimpleNamespace:
    ms = int(minute * 60000)
    return SimpleNamespace(type="pass", team=team, minute=ms // 60000, second=0, match_clock_ms=ms)


FULL = FULL_TIME_MIN * 60000


def _row_sum(row: dict) -> float:
    return row["home"] + row["draw"] + row["away"]


# ---------- outcome_probabilities (the core Poisson step) ----------

@pytest.mark.parametrize("lam_h,lam_a,diff", [
    (0.0, 0.0, 0), (1.4, 1.4, 0), (2.5, 0.3, -1), (0.1, 3.0, 2), (5.0, 5.0, 0),
])
def test_outcome_probabilities_sum_to_one(lam_h, lam_a, diff):
    h, d, a = outcome_probabilities(diff, lam_h, lam_a)
    assert h + d + a == pytest.approx(1.0, abs=1e-12)
    assert min(h, d, a) >= 0.0


@pytest.mark.parametrize("diff,expected", [(1, (1.0, 0.0, 0.0)), (0, (0.0, 1.0, 0.0)), (-2, (0.0, 0.0, 1.0))])
def test_no_time_left_means_the_current_score_is_the_result(diff, expected):
    assert outcome_probabilities(diff, 0.0, 0.0) == expected


def test_symmetric_rates_give_symmetric_output():
    h, _d, a = outcome_probabilities(0, 1.1, 1.1)
    assert h == pytest.approx(a, abs=1e-12)


def test_stronger_attack_is_more_likely_to_win():
    h, _d, a = outcome_probabilities(0, 2.0, 0.5)
    assert h > a


# ---------- compute_win_probability over a match ----------

def test_series_covers_every_minute_and_every_row_sums_to_one():
    events = [_shot("home", 10.5, 0.2), _shot("away", 33.2, 0.4, goal=True), _pass("home", 50)]
    result = compute_win_probability(events, FULL)
    series = result["series"]
    assert [r["minute"] for r in series] == list(range(0, FULL_TIME_MIN + 1))
    for row in series:
        assert _row_sum(row) == pytest.approx(1.0, abs=1e-9)


def test_kickoff_with_no_events_is_symmetric():
    first = compute_win_probability([], FULL)["series"][0]
    assert first["home"] == pytest.approx(first["away"], abs=1e-12)
    assert first["home_goals"] == first["away_goals"] == 0


@pytest.mark.parametrize("home_goals,away_goals,expected", [
    (2, 1, (1.0, 0.0, 0.0)), (0, 0, (0.0, 1.0, 0.0)), (1, 3, (0.0, 0.0, 1.0)),
])
def test_full_time_is_exactly_the_actual_outcome(home_goals, away_goals, expected):
    events = [_shot("home", 5 + i * 7, 0.3, goal=True) for i in range(home_goals)]
    events += [_shot("away", 8 + i * 9, 0.3, goal=True) for i in range(away_goals)]
    last = compute_win_probability(events, FULL)["series"][-1]
    assert last["minute"] == FULL_TIME_MIN
    assert (last["home"], last["draw"], last["away"]) == expected
    assert (last["home_goals"], last["away_goals"]) == (home_goals, away_goals)
    assert compute_win_probability(events, FULL)["full_time"] is True


def test_team_leading_late_is_a_heavy_favourite():
    events = [_shot("away", 80.0, 0.5, goal=True)]
    row = next(r for r in compute_win_probability(events, FULL)["series"] if r["minute"] == 85)
    assert row["away"] > 0.8
    assert row["away"] > row["draw"] > 0


def test_a_goal_causes_a_jump_in_home_win_probability():
    events = [_shot("home", 40.5, 0.3, goal=True)]
    series = compute_win_probability(events, FULL)["series"]
    before, after = series[40]["home"], series[41]["home"]
    assert after - before > 0.15


def test_symmetric_match_gives_symmetric_series():
    events = [_shot("home", 20.5, 0.3, goal=True), _shot("away", 20.5, 0.3, goal=True)]
    for row in compute_win_probability(events, FULL)["series"]:
        assert row["home"] == pytest.approx(row["away"], abs=1e-12)


def test_only_events_up_to_minute_t_are_used():
    early = compute_win_probability([_shot("home", 60.5, 0.4, goal=True)], FULL)["series"]
    none = compute_win_probability([], FULL)["series"]
    for t in range(0, 61):
        assert early[t]["home"] == pytest.approx(none[t]["home"], abs=1e-12)


def test_observed_xg_pace_moves_the_projection():
    # Same 0-0 score, but home are creating far more: home should be favoured.
    events = [_shot("home", m + 0.5, 0.35) for m in range(1, 45, 4)]
    row = compute_win_probability(events, FULL)["series"][45]
    assert (row["home_goals"], row["away_goals"]) == (0, 0)
    assert row["home"] > row["away"] + 0.1


def test_truncated_match_stops_at_its_duration_and_is_not_resolved():
    result = compute_win_probability([_shot("home", 10.5, 0.3, goal=True)], 30 * 60000)
    assert result["series"][-1]["minute"] == 30
    assert result["full_time"] is False
    assert 0.0 < result["series"][-1]["away"] < 1.0


def test_metadata_like_events_without_team_are_ignored():
    meta = SimpleNamespace(type="match_metadata", match_clock_ms=0)
    result = compute_win_probability([meta, _shot("home", 3.5, 0.3, goal=True)], FULL)
    assert result["series"][-1]["home"] == 1.0


# ---------- swing moments ----------

def test_swings_are_top_three_by_home_win_change_and_linked_to_goals():
    events = [
        _shot("home", 20.5, 0.3, goal=True, player="Saka"),
        _shot("away", 60.5, 0.2, goal=True, player="Salah"),
        _shot("home", 85.5, 0.6, goal=True, player="Rice"),
        _shot("away", 30.5, 0.05),
    ]
    swings = compute_win_probability(events, FULL)["swings"]
    assert len(swings) == 3
    assert sorted(s["minute"] for s in swings) == [21, 61, 86]
    deltas = [abs(s["delta_home"]) for s in swings]
    assert deltas == sorted(deltas, reverse=True)
    for s in swings:
        assert s["cause"]["kind"] == "goal"
    by_min = {s["minute"]: s for s in swings}
    assert by_min[86]["cause"]["player_name"] == "Rice"
    assert by_min[86]["cause"]["team"] == "home"
    assert by_min[61]["delta_home"] < 0
    assert by_min[21]["home_after"] - by_min[21]["home_before"] == pytest.approx(by_min[21]["delta_home"])


def test_swing_without_a_goal_links_the_biggest_chance():
    events = [_shot("away", 50.5, 0.05), _shot("away", 50.7, 0.7, player="Haaland")]
    swings = compute_win_probability(events, FULL)["swings"]
    top = swings[0]
    assert top["minute"] == 51
    assert top["cause"]["kind"] == "big_chance"
    assert top["cause"]["player_name"] == "Haaland"
    assert top["cause"]["xg"] == pytest.approx(0.7)


def test_deterministic_on_a_simulated_match():
    rng = random.Random(7)
    sim = MatchSimulator("WP-TEST", seed=7, home_squad=build_squad("home", "H", rng),
                         away_squad=build_squad("away", "A", rng))
    events = sim.generate_match().events
    a = compute_win_probability(events, FULL)
    b = compute_win_probability(events, FULL)
    assert a == b
    goals = [e for e in events if getattr(e, "type", None) == "shot" and e.outcome == "goal"]
    last = a["series"][-1]
    assert last["home_goals"] + last["away_goals"] == len(goals)
    assert max(last["home"], last["draw"], last["away"]) == 1.0
    assert isinstance(a["method"], str) and "Poisson" in a["method"]


# ---------- router ----------

@pytest.fixture
def wp_client(STATE):
    from service.routers.win_probability import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_endpoint_404s_for_unknown_match(wp_client):
    res = wp_client.get("/matches/nope/win-probability")
    assert res.status_code == 404


def test_endpoint_returns_series_swings_and_method(wp_client, STATE):
    STATE.setdefault("events_by_match", {})["M1"] = [_shot("home", 12.5, 0.4, goal=True, player="Saka")]
    STATE.setdefault("duration_ms_by_match", {})["M1"] = FULL
    STATE.setdefault("match_status", {})["M1"] = {"status": "done", "home_team": "Arsenal", "away_team": "Spurs"}
    res = wp_client.get("/matches/M1/win-probability")
    assert res.status_code == 200
    body = res.json()
    assert len(body["series"]) == FULL_TIME_MIN + 1
    assert set(body["series"][0]) >= {"minute", "home", "draw", "away", "home_goals", "away_goals"}
    assert body["swings"][0]["minute"] == 13
    assert body["home_team"] == "Arsenal" and body["away_team"] == "Spurs"
    assert body["method"]
