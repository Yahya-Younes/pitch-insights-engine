"""Player speed/distance tags + ball/shot speed (agents/analyst0/player_tags.py
and service/routers/player_tags.py).

Frames are hand-built in StatsBomb pitch units (120 x 80), so every expected
number below is derived from the documented 105 m x 68 m conversion.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.analyst0.player_tags import (
    MAX_PLAUSIBLE_KMH,
    SPRINT_KMH,
    X_M_PER_UNIT,
    Y_M_PER_UNIT,
    compute_player_tags,
    format_game_clock,
)

DT_MS = 100


@dataclass
class Frame:
    t_ms: int
    ball: tuple[float, float, float] = (60.0, 40.0, 0.0)
    players: dict[str, tuple[float, float]] = field(default_factory=dict)


def _track(speeds_kmh: list[float], axis: str = "x", start=(10.0, 10.0)) -> list[tuple[float, float]]:
    """One position per frame; speeds_kmh[i] is the speed of step i -> i+1."""
    x, y = start
    out = [(x, y)]
    for v in speeds_kmh:
        metres = v / 3.6 * DT_MS / 1000
        if axis == "x":
            x += metres / X_M_PER_UNIT
        else:
            y += metres / Y_M_PER_UNIT
        out.append((x, y))
    return out


def _frames(**tracks: list[tuple[float, float]]) -> list[Frame]:
    n = max(len(t) for t in tracks.values())
    frames = []
    for i in range(n):
        players = {pid: t[min(i, len(t) - 1)] for pid, t in tracks.items()}
        frames.append(Frame(t_ms=i * DT_MS, players=players))
    return frames


def _player(result: dict, pid: str) -> dict:
    return next(p for p in result["players"] if p["player_id"] == pid)


@pytest.mark.parametrize("axis", ["x", "y"])
def test_constant_jog_distance_and_speed_are_in_real_metres(axis):
    # 18 km/h = 5 m/s for 60 s = 300 m, whichever axis (the two axes have
    # different metre-per-unit scales, so this catches a missing conversion).
    result = compute_player_tags(_frames(home_1=_track([18.0] * 600, axis)), [], {})
    p = _player(result, "home_1")
    assert p["distance_km"] == pytest.approx(0.3, abs=0.002)
    assert p["top_speed_kmh"] == pytest.approx(18.0, abs=0.2)
    assert p["sprints"] == 0
    assert result["tags"] == []


def test_one_sprint_is_counted_once_and_tagged_at_its_start():
    speeds = [10.0] * 50 + [30.0] * 30 + [5.0] * 50
    result = compute_player_tags(_frames(home_9=_track(speeds)), [], {"home_9": "Striker Nine"})
    p = _player(result, "home_9")
    assert p["sprints"] == 1
    assert p["name"] == "Striker Nine"
    assert p["team"] == "home"
    sprint_tags = [t for t in result["tags"] if t["kind"] == "sprint"]
    assert len(sprint_tags) == 1
    tag = sprint_tags[0]
    # 1 s rolling mean crosses 25.2 km/h a little after the burst begins at 5.0 s.
    assert 5000 <= tag["t_ms"] <= 6000
    assert tag["value"] == pytest.approx(30.0, abs=0.3)  # peak of that sprint
    assert "Striker Nine" in tag["label"]
    assert tag["game_clock"] == format_game_clock(tag["t_ms"])


def test_short_burst_below_one_second_is_not_a_sprint():
    # 0.3 s at 30 km/h inside slow jogging: the 1 s rolling mean stays below 25.2.
    speeds = [8.0] * 40 + [30.0] * 3 + [8.0] * 40
    result = compute_player_tags(_frames(home_2=_track(speeds)), [], {})
    assert _player(result, "home_2")["sprints"] == 0


def test_every_full_kilometre_gets_a_distance_tag():
    # 25.2 km/h = 7 m/s -> 1 km at ~142.9 s, 2 km at ~285.7 s; 300 s total = 2.1 km.
    # (Sits exactly on the sprint threshold, so we jog just under it.)
    speeds = [25.0] * 3000
    result = compute_player_tags(_frames(away_4=_track(speeds, start=(0.0, 0.0))), [], {})
    km_tags = [t for t in result["tags"] if t["kind"] == "distance_km"]
    assert [t["value"] for t in km_tags] == [1, 2]
    assert km_tags[0]["t_ms"] == pytest.approx(144_000, abs=500)
    assert km_tags[1]["t_ms"] == pytest.approx(288_000, abs=500)
    assert _player(result, "away_4")["team"] == "away"


def test_teleport_snaps_count_as_distance_but_never_as_speed():
    # A 20 m jump in one 0.1 s frame (the interpolator snapping a player to
    # their next event) -- physically impossible, so excluded from speed.
    track = [(10.0, 10.0)] * 20 + [(10.0 + 20.0 / X_M_PER_UNIT, 10.0)] * 20
    result = compute_player_tags(_frames(home_3=track), [], {})
    p = _player(result, "home_3")
    assert p["top_speed_kmh"] == 0.0
    assert p["sprints"] == 0
    assert p["distance_km"] == pytest.approx(0.02, abs=0.001)
    assert result["speed_samples_excluded_pct"] > 0


def test_impossible_sustained_speed_is_never_reported():
    result = compute_player_tags(_frames(home_5=_track([45.0] * 100)), [], {})
    p = _player(result, "home_5")
    assert p["top_speed_kmh"] <= MAX_PLAUSIBLE_KMH
    assert all(t["value"] <= MAX_PLAUSIBLE_KMH for t in result["tags"] if t["kind"] != "distance_km")


def test_new_match_top_speed_tags_only_fire_on_a_new_record():
    a = [5.0] * 20 + [28.0] * 20 + [5.0] * 200
    b = [5.0] * 100 + [27.0] * 20 + [5.0] * 20 + [33.0] * 20 + [5.0] * 80
    result = compute_player_tags(_frames(home_7=_track(a), away_7=_track(b, start=(80.0, 60.0))), [], {})
    records = [t for t in result["tags"] if t["kind"] == "top_speed"]
    values = [t["value"] for t in records]
    assert values == sorted(values)
    assert len(values) >= 2
    assert records[0]["player_id"] == "home_7"
    assert records[-1]["player_id"] == "away_7"
    assert records[-1]["value"] == pytest.approx(33.0, abs=0.3)
    # away_7's 27 km/h burst never beat home_7's 28 km/h record.
    assert not any(t["player_id"] == "away_7" and t["value"] < 28.0 for t in records)
    assert all(t["value"] >= SPRINT_KMH for t in records)


def test_tags_are_time_ordered():
    a = [30.0] * 20 + [5.0] * 30 + [30.0] * 20
    b = [5.0] * 10 + [31.0] * 20 + [5.0] * 40
    result = compute_player_tags(_frames(home_1=_track(a), away_1=_track(b, start=(90.0, 60.0))), [], {})
    times = [t["t_ms"] for t in result["tags"]]
    assert times == sorted(times)


def _shot(t_ms: int, pid: str, speed: float, xg: float, outcome: str) -> dict:
    return {"type": "shot", "match_clock_ms": t_ms, "player_id": pid, "team": pid.split("_")[0],
            "shot_speed_kmh": speed, "xg": xg, "outcome": outcome}


def _pass(t_ms: int, pid: str, speed: float, distance: float) -> dict:
    return {"type": "pass", "match_clock_ms": t_ms, "player_id": pid, "team": pid.split("_")[0],
            "ball_speed_kmh": speed, "distance_m": distance}


def test_shots_and_fastest_shot_and_pass_come_from_event_speeds():
    events = [
        _shot(60_000, "home_9", 88.4, 0.12, "saved"),
        _shot(120_000, "away_10", 112.6, 0.31, "goal"),
        _pass(30_000, "home_4", 61.0, 38.0),
        _pass(40_000, "home_6", 72.5, 41.0),
    ]
    names = {"away_10": "Ten"}
    result = compute_player_tags(_frames(home_1=_track([5.0] * 10)), events, names)
    assert [s["speed_kmh"] for s in result["shots"]] == [88.4, 112.6]
    assert result["fastest_shot"]["player_id"] == "away_10"
    assert result["fastest_shot"]["name"] == "Ten"
    assert result["fastest_shot"]["outcome"] == "goal"
    assert result["fastest_shot"]["xg"] == 0.31
    assert result["fastest_pass"]["speed_kmh"] == 72.5
    assert result["passes_counted"] == 2


def test_event_objects_work_as_well_as_dicts():
    class ShotObj:
        type = "shot"
        match_clock_ms = 5000
        player_id = "home_9"
        team = "home"
        shot_speed_kmh = 99.0
        xg = 0.2
        outcome = "goal"

    result = compute_player_tags(_frames(home_1=_track([5.0] * 10)), [ShotObj()], {})
    assert result["fastest_shot"]["speed_kmh"] == 99.0


def test_no_shots_means_null_fastest_shot():
    result = compute_player_tags(_frames(home_1=_track([5.0] * 10)), [], {})
    assert result["shots"] == []
    assert result["fastest_shot"] is None
    assert result["fastest_pass"] is None


@pytest.mark.parametrize("t_ms,expected", [(0, "00:00"), (61_500, "01:01"), (5_400_000, "90:00")])
def test_format_game_clock(t_ms, expected):
    assert format_game_clock(t_ms) == expected


def test_real_simulated_match_is_plausible_and_deterministic():
    from datagen.match_simulator import MatchSimulator
    from datagen.trajectory import generate_positions

    sim = MatchSimulator("PT-TEST", 11).generate_match()
    cutoff = 8 * 60_000
    events = [e for e in sim.events if e.type != "match_metadata" and e.match_clock_ms <= cutoff]
    frames = generate_positions("PT-TEST", events, sim.home_profiles, sim.away_profiles, cutoff)
    names = {p.player_id: p.player_name for p in [*sim.home_profiles, *sim.away_profiles]}

    first = compute_player_tags(frames, events, names)
    second = compute_player_tags(frames, events, names)
    assert first == second
    assert len(first["players"]) == 22
    assert all(0 <= p["top_speed_kmh"] <= MAX_PLAUSIBLE_KMH for p in first["players"])
    assert any(p["distance_km"] > 0 for p in first["players"])
    assert {p["team"] for p in first["players"]} == {"home", "away"}
    assert all(p["name"] == names[p["player_id"]] for p in first["players"])
    assert "synthetic" in first["method"].lower()


# ---------- HTTP router ----------

@pytest.fixture
def api(STATE):
    from service.routers.player_tags import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_unknown_match_is_404(api):
    assert api.get("/matches/NOPE/player-tags").status_code == 404


def test_endpoint_serves_tags_for_a_seeded_match(api, STATE):
    frames = _frames(home_9=_track([10.0] * 20 + [30.0] * 30 + [5.0] * 20))
    STATE.setdefault("positions_by_match", {})["M1"] = frames
    STATE.setdefault("events_by_match", {})["M1"] = [_shot(3000, "home_9", 101.0, 0.4, "goal")]
    STATE.setdefault("player_names_by_match", {})["M1"] = {"home_9": "Nine"}

    res = api.get("/matches/M1/player-tags")
    assert res.status_code == 200
    body = res.json()
    assert body["match_id"] == "M1"
    assert body["players"][0]["name"] == "Nine"
    assert body["players"][0]["sprints"] == 1
    assert body["fastest_shot"]["speed_kmh"] == 101.0
    assert body["thresholds"]["sprint_kmh"] == SPRINT_KMH
    assert any(t["kind"] == "sprint" for t in body["tags"])


def test_endpoint_caches_until_positions_change(api, STATE):
    STATE.setdefault("positions_by_match", {})["M2"] = _frames(home_1=_track([18.0] * 100))
    first = api.get("/matches/M2/player-tags").json()
    assert first["players"][0]["distance_km"] == pytest.approx(0.05, abs=0.001)
    assert api.get("/matches/M2/player-tags").json() == first

    STATE["positions_by_match"]["M2"] = _frames(home_1=_track([18.0] * 200))
    second = api.get("/matches/M2/player-tags").json()
    assert second["players"][0]["distance_km"] == pytest.approx(0.1, abs=0.001)
