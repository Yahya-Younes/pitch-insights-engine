"""Live player rating (agents/analyst0/live_rating.py and
service/routers/live_rating.py).

Hand-built schema events keep every expectation traceable to the spec; the
determinism / performance checks use a seeded MatchSimulator match.
"""
from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.analyst0.live_rating import (
    BASE_RATING,
    RATING_MAX,
    RATING_MIN,
    compute_live_ratings,
    track_motm,
)
from datagen.schema import (
    CardEvent,
    CarryEvent,
    DuelEvent,
    FoulEvent,
    InterceptionEvent,
    PassEvent,
    PossessionChangeEvent,
    ShotEvent,
    TackleEvent,
)

ROLES = {
    "home_1": "GK", "home_4": "CB", "home_2": "FB", "home_6": "CM", "home_8": "CM", "home_9": "FW", "home_10": "CM",
    "away_1": "GK", "away_4": "CB", "away_3": "FB", "away_6": "CM", "away_9": "FW",
}


def _env(t_ms: int, team: str, pid: str, possession: int = 1) -> dict:
    return {
        "match_id": "M", "period": 1 if t_ms < 45 * 60000 else 2, "possession_id": possession,
        "minute": t_ms // 60000, "second": (t_ms // 1000) % 60, "match_clock_ms": t_ms,
        "team": team, "team_name": team.title(), "player_id": pid, "player_name": pid,
    }


def _team(pid: str) -> str:
    return pid.split("_", 1)[0]


def _pass(t, pid, start=(100.0, 40.0), end=(101.0, 41.0), outcome="complete", recipient=None, possession=1):
    return PassEvent(
        **_env(t, _team(pid), pid, possession), location=start, end_location=end, outcome=outcome,
        recipient_id=recipient if outcome == "complete" else None, recipient_name=recipient,
        pass_type="ground", body_part="right_foot", distance_m=5.0, angle_deg=0.0, ball_speed_kmh=40.0,
    )


def _shot(t, pid, xg=0.4, outcome="goal", possession=1):
    return ShotEvent(
        **_env(t, _team(pid), pid, possession), location=(108.0, 40.0), end_location=(120.0, 40.0),
        outcome=outcome, xg=xg, shot_speed_kmh=90.0,
    )


def _carry(t, pid, start=(101.0, 41.0), end=(102.0, 41.5), possession=1):
    return CarryEvent(**_env(t, _team(pid), pid, possession), location=start, end_location=end, duration_s=1.0)


def _by_id(result: dict) -> dict[str, dict]:
    return {p["player_id"]: p for p in result["players"]}


def _item(player: dict, label: str) -> dict | None:
    return next((b for b in player["breakdown"] if b["label"] == label), None)


# ---------------------------------------------------------------------------
# Base / attack
# ---------------------------------------------------------------------------

def test_everyone_starts_at_six_with_no_events():
    result = compute_live_ratings([], {}, ROLES)
    assert result["minute"] == 0
    assert len(result["players"]) == len(ROLES)
    for p in result["players"]:
        assert p["rating"] == BASE_RATING == 6.0
        assert p["breakdown"] == []
        assert p["delta_10min"] == 0.0
        assert p["series"] == [{"minute": 0, "rating": 6.0}]
    assert result["motm"] is None
    assert result["leader_history"] == []
    assert isinstance(result["method"], str) and result["method"]


def test_goal_is_plus_one_and_low_xg_goal_adds_bonus():
    normal = _by_id(compute_live_ratings([_shot(1000, "home_10", xg=0.4)], {}, ROLES))["home_10"]
    assert normal["rating"] == 7.0
    assert _item(normal, "But") == {"label": "But", "points": 1.0, "count": 1}

    worldie = _by_id(compute_live_ratings([_shot(1000, "home_10", xg=0.1)], {}, ROLES))["home_10"]
    assert worldie["rating"] == 7.2
    assert _item(worldie, "But")["points"] == pytest.approx(1.2)


def test_assist_and_key_pass_detection():
    events = [
        # possession 1: home_8 -> home_10, home_10 carries then scores => assist for home_8
        _pass(1000, "home_8", recipient="home_10"),
        _carry(2000, "home_10"),
        _shot(3000, "home_10", xg=0.4, outcome="goal"),
        # possession 2: home_6 -> home_9 who shoots straight away (saved) => key pass for home_6
        _pass(10000, "home_6", recipient="home_9", possession=2),
        _shot(11000, "home_9", xg=0.2, outcome="saved", possession=2),
        # possession 3: home_2 -> home_9 who carries before shooting => not a key pass
        _pass(20000, "home_2", recipient="home_9", possession=3),
        _carry(21000, "home_9", possession=3),
        _shot(22000, "home_9", xg=0.2, outcome="off_target", possession=3),
    ]
    players = _by_id(compute_live_ratings(events, {}, ROLES))
    assert _item(players["home_8"], "Passe décisive") == {"label": "Passe décisive", "points": 0.6, "count": 1}
    assert _item(players["home_8"], "Passe clé") is None  # an assist is not also a key pass
    assert players["home_8"]["rating"] == 6.6
    assert _item(players["home_6"], "Passe clé") == {"label": "Passe clé", "points": 0.15, "count": 1}
    assert _item(players["home_2"], "Passe clé") is None
    assert players["home_2"]["rating"] == 6.0


def test_xt_created_is_capped():
    # 40 long carries from midfield into the box: well over 1.6 xT in total.
    events = [_carry(1000 + i * 1000, "home_10", start=(60.0, 40.0), end=(112.0, 40.0)) for i in range(40)]
    p = _by_id(compute_live_ratings(events, {}, ROLES))["home_10"]
    assert _item(p, "Menace créée (xT)")["points"] == pytest.approx(0.8)
    assert p["rating"] == 6.8


def test_shot_xg_and_on_target_bonus_with_forward_weighting():
    p = _by_id(compute_live_ratings([_shot(1000, "home_9", xg=0.3, outcome="saved")], {}, ROLES))["home_9"]
    # (0.3 * 0.3 + 0.05) * 1.2 for a FW
    assert _item(p, "Tirs (xG)")["points"] == pytest.approx(0.168)
    assert p["rating"] == 6.2


def test_dribbles():
    from datagen.schema import DribbleEvent

    events = [
        DribbleEvent(**_env(1000, "home", "home_10"), location=(80.0, 40.0), outcome="complete", opponent_id="away_6"),
        DribbleEvent(**_env(2000, "home", "home_10"), location=(80.0, 40.0), outcome="nutmeg", opponent_id="away_6"),
        DribbleEvent(**_env(3000, "home", "home_10"), location=(80.0, 40.0), outcome="tackled", opponent_id="away_6"),
    ]
    p = _by_id(compute_live_ratings(events, {}, ROLES))["home_10"]
    assert _item(p, "Dribbles") == {"label": "Dribbles", "points": pytest.approx(0.07), "count": 3}


# ---------------------------------------------------------------------------
# Possession
# ---------------------------------------------------------------------------

def test_pass_accuracy_thresholds():
    good = [_pass(1000 + i * 1000, "home_6", recipient="home_8") for i in range(18)]
    good += [_pass(30000 + i * 1000, "home_6", outcome="incomplete") for i in range(2)]  # 18/20 = 90 %
    p = _by_id(compute_live_ratings(good, {}, ROLES))["home_6"]
    assert _item(p, "Précision de passe")["points"] == pytest.approx(0.1)
    assert p["rating"] == 6.1

    bad = [_pass(1000 + i * 1000, "home_6", recipient="home_8") for i in range(9)]
    bad += [_pass(30000 + i * 1000, "home_6", outcome="incomplete") for i in range(6)]  # 9/15 = 60 %
    p = _by_id(compute_live_ratings(bad, {}, ROLES))["home_6"]
    assert _item(p, "Précision de passe")["points"] == pytest.approx(-0.1)
    assert _item(p, "Pertes de balle") is None  # failed passes are scored by accuracy only
    assert p["rating"] == 5.9


def test_attributed_turnover_is_a_ball_loss():
    events = [
        PossessionChangeEvent(**_env(1000, "home", "home_6", 2), location=(50.0, 40.0), reason="turnover"),
        # Unattributed turnover (e.g. after a shot): nobody is charged.
        PossessionChangeEvent(**_env(2000, "home", "", 3), location=(50.0, 40.0), reason="turnover"),
    ]
    p = _by_id(compute_live_ratings(events, {}, ROLES))["home_6"]
    assert _item(p, "Pertes de balle") == {"label": "Pertes de balle", "points": -0.03, "count": 1}


# ---------------------------------------------------------------------------
# Defence
# ---------------------------------------------------------------------------

def test_defender_tackle_is_weighted_by_1_3():
    def tackle(pid):
        return TackleEvent(**_env(1000, "home", pid), location=(60.0, 40.0), outcome="won", opponent_id="away_9")

    cb = _by_id(compute_live_ratings([tackle("home_4")], {}, ROLES))["home_4"]
    cm = _by_id(compute_live_ratings([tackle("home_6")], {}, ROLES))["home_6"]
    assert _item(cb, "Tacles/interceptions")["points"] == pytest.approx(0.078)
    assert _item(cm, "Tacles/interceptions")["points"] == pytest.approx(0.06)
    assert _item(cb, "Menace évitée")["points"] == pytest.approx(_item(cm, "Menace évitée")["points"] * 1.3, abs=1e-3)
    assert _item(cm, "Menace évitée")["points"] > 0


def test_interception_and_duels():
    events = [
        InterceptionEvent(**_env(1000, "home", "home_6"), location=(40.0, 40.0), opponent_id="away_9"),
        DuelEvent(**_env(2000, "home", "home_6"), location=(50.0, 40.0), outcome="won", opponent_id="away_9",
                  duel_type="aerial"),
        DuelEvent(**_env(3000, "away", "away_6"), location=(50.0, 40.0), outcome="lost", opponent_id="home_10",
                  duel_type="ground"),
    ]
    players = _by_id(compute_live_ratings(events, {}, ROLES))
    assert _item(players["home_6"], "Tacles/interceptions") == {"label": "Tacles/interceptions", "points": 0.06, "count": 1}
    assert _item(players["home_6"], "Duels")["points"] == pytest.approx(0.03)
    assert _item(players["away_9"], "Duels")["points"] == pytest.approx(-0.03)  # FW: defence is not weighted
    assert _item(players["away_6"], "Duels")["points"] == pytest.approx(-0.03)
    assert _item(players["home_10"], "Duels")["points"] == pytest.approx(0.03)


def test_goalkeeper_gets_save_credit():
    p = _by_id(compute_live_ratings([_shot(1000, "home_9", xg=0.3, outcome="saved")], {}, ROLES))["away_1"]
    # (0.15 + 0.1 * 0.3) * 1.3
    assert _item(p, "Arrêts") == {"label": "Arrêts", "points": pytest.approx(0.234), "count": 1}
    assert p["rating"] == 6.2


def test_goal_conceded_hits_keeper_and_back_line():
    players = _by_id(compute_live_ratings([_shot(1000, "home_9", xg=0.4)], {}, ROLES))
    assert _item(players["away_1"], "Buts encaissés")["points"] == pytest.approx(-0.39)
    assert _item(players["away_4"], "Buts encaissés")["points"] == pytest.approx(-0.13)
    assert _item(players["away_3"], "Buts encaissés")["points"] == pytest.approx(-0.13)
    assert _item(players["away_6"], "Buts encaissés") is None
    assert _item(players["home_1"], "Buts encaissés") is None


# ---------------------------------------------------------------------------
# Discipline / clamp
# ---------------------------------------------------------------------------

def test_yellow_card_and_foul():
    card = CardEvent(**_env(1000, "away", "away_6"), location=(50.0, 40.0), card_type="yellow", reason="reckless foul")
    p = _by_id(compute_live_ratings([card], {}, ROLES))["away_6"]
    assert _item(p, "Cartons") == {"label": "Cartons", "points": -0.3, "count": 1}
    assert p["rating"] == 5.7

    foul = FoulEvent(**_env(1000, "away", "away_4"), location=(50.0, 40.0), opponent_id="home_10", severity="minor")
    p = _by_id(compute_live_ratings([foul], {}, ROLES))["away_4"]
    assert _item(p, "Fautes") == {"label": "Fautes", "points": -0.05, "count": 1}  # discipline is never weighted


def test_rating_is_clamped():
    reds = [CardEvent(**_env(1000 + i, "away", "away_6"), location=(50.0, 40.0), card_type="red", reason="x")
            for i in range(5)]
    goals = [_shot(1000 + i * 1000, "home_10", xg=0.5, possession=i) for i in range(8)]
    players = _by_id(compute_live_ratings(reds + goals, {}, ROLES))
    assert players["away_6"]["rating"] == RATING_MIN == 3.0
    assert players["home_10"]["rating"] == RATING_MAX == 10.0


# ---------------------------------------------------------------------------
# Time / MOTM
# ---------------------------------------------------------------------------

def test_minute_filtering_series_and_delta():
    events = [_shot(30 * 60000 + 5000, "home_10", xg=0.4)]
    before = _by_id(compute_live_ratings(events, {}, ROLES, minute=29))["home_10"]
    assert before["rating"] == 6.0 and before["breakdown"] == []

    at = compute_live_ratings(events, {}, ROLES, minute=35)
    p = _by_id(at)["home_10"]
    assert at["minute"] == 35
    assert p["rating"] == 7.0
    assert [s["minute"] for s in p["series"]] == list(range(36))
    assert p["series"][29]["rating"] == 6.0 and p["series"][30]["rating"] == 7.0
    assert p["delta_10min"] == 1.0
    assert _by_id(compute_live_ratings(events, {}, ROLES, minute=45))["home_10"]["delta_10min"] == 0.0
    # Default minute = latest minute in the events.
    assert compute_live_ratings(events, {}, ROLES)["minute"] == 30


def test_motm_hysteresis():
    snaps = [
        (0, {"a": (6.0, 0.0), "b": (6.0, 0.0)}),
        (1, {"a": (7.0, 0.4), "b": (6.0, 0.0)}),
        (2, {"a": (7.0, 0.4), "b": (7.05, 0.5)}),  # +0.05: not enough
        (3, {"a": (7.0, 0.4), "b": (7.15, 0.5)}),  # +0.15: takes the lead
        (4, {"a": (7.2, 0.4), "b": (7.15, 0.5)}),  # a +0.05 back: b keeps it
    ]
    leader, since, history = track_motm(snaps)
    assert leader == "b" and since == 3
    assert history == [{"minute": 1, "player_id": "a"}, {"minute": 3, "player_id": "b"}]


def test_motm_tie_break_uses_xg_plus_xt():
    leader, since, _ = track_motm([(5, {"a": (7.0, 0.2), "b": (7.0, 0.6)})])
    assert leader == "b" and since == 5


def test_motm_reason_lists_top_positive_items():
    events = [_pass(1000, "home_8", recipient="home_10"), _shot(2000, "home_10", xg=0.4)]
    result = compute_live_ratings(events, {"home_10": "Dix"}, ROLES)
    motm = result["motm"]
    assert motm["player_id"] == "home_10" and motm["name"] == "Dix" and motm["rating"] == 7.0
    assert motm["leader_since_minute"] == 0
    assert motm["reason"].startswith("But (+1")
    assert result["leader_history"] == [{"minute": 0, "player_id": "home_10"}]
    assert result["players"][0]["player_id"] == "home_10"  # sorted by rating desc
    assert result["players"][0]["number"] == "10"
    assert result["players"][0]["team"] == "home" and result["players"][0]["position"] == "CM"


def _sim_match():
    from datagen.match_simulator import MatchSimulator

    sim = MatchSimulator("SIM", 11).generate_match()
    events = [e for e in sim.events if e.type not in ("match_metadata", "referee_position", "referee_decision")]
    profiles = [*sim.home_profiles, *sim.away_profiles]
    return events, {p.player_id: p.player_name for p in profiles}, {p.player_id: p.position for p in profiles}


def test_seeded_match_is_deterministic_fast_and_in_range():
    events, names, roles = _sim_match()
    start = time.perf_counter()
    first = compute_live_ratings(events, names, roles)
    elapsed = time.perf_counter() - start
    second = compute_live_ratings(events, names, roles)
    assert first == second
    assert elapsed < 1.0  # target is < 300 ms; generous bound for slow CI boxes
    assert len(first["players"]) == 22
    assert first["minute"] >= 89
    ratings = [p["rating"] for p in first["players"]]
    assert ratings == sorted(ratings, reverse=True)
    for p in first["players"]:
        assert RATING_MIN <= p["rating"] <= RATING_MAX
        assert len(p["series"]) == first["minute"] + 1
        assert p["series"][-1]["rating"] == p["rating"]
    motm = first["motm"]
    assert motm is not None and motm["rating"] >= max(ratings) - 0.1 - 1e-9
    assert first["leader_history"] and first["leader_history"][-1]["player_id"] == motm["player_id"]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@pytest.fixture
def api(STATE):
    from service.routers.live_rating import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_unknown_match_is_404(api):
    assert api.get("/matches/NOPE/live-ratings").status_code == 404


def test_endpoint_shape(api, STATE):
    STATE.setdefault("events_by_match", {})["L1"] = [_pass(1000, "home_8", recipient="home_10"),
                                                    _shot(65 * 60000, "home_10", xg=0.4)]
    STATE.setdefault("player_names_by_match", {})["L1"] = {"home_10": "Dix"}
    STATE.setdefault("player_roles_by_match", {})["L1"] = ROLES
    body = api.get("/matches/L1/live-ratings").json()
    assert body["match_id"] == "L1" and body["minute"] == 65
    assert set(body) == {"match_id", "minute", "players", "motm", "leader_history", "method"}
    top = body["players"][0]
    assert set(top) == {"player_id", "number", "name", "team", "position", "rating", "delta_10min", "breakdown", "series"}
    assert top["name"] == "Dix" and top["rating"] == 7.0 and top["delta_10min"] == 1.0
    assert set(body["motm"]) == {"player_id", "name", "rating", "leader_since_minute", "reason"}

    early = api.get("/matches/L1/live-ratings?minute=10").json()
    assert early["minute"] == 10 and _by_id(early)["home_10"]["rating"] == 6.0
    assert api.get("/matches/L1/live-ratings?minute=-1").status_code == 422
