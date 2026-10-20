import math

import pytest

from agents.analyst0 import metrics as m
from datagen.schema import (
    CarryEvent, DribbleEvent, DuelEvent, FoulEvent, InterceptionEvent,
    PassEvent, PossessionChangeEvent, ShotEvent, TackleEvent,
)

MATCH_ID = "TEST-MATCH"


def pass_event(**overrides):
    base = dict(
        match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=1000,
        team="home", team_name="Home", player_id="home_1", player_name="P1",
        location=(60.0, 40.0), possession_id=1, end_location=(65.0, 40.0),
        outcome="complete", pass_type="ground", body_part="right_foot",
        distance_m=5.0, angle_deg=0.0, ball_speed_kmh=40.0,
    )
    base.update(overrides)
    return PassEvent(**base)


class TestPPDA:
    def test_hand_computed_ppda(self):
        events = [
            pass_event(team="away", team_name="Away", player_id="away_1", location=(70, 40), match_clock_ms=1000),
            pass_event(team="away", team_name="Away", player_id="away_2", location=(90, 40), match_clock_ms=2000),
            pass_event(team="away", team_name="Away", player_id="away_3", location=(55, 40), match_clock_ms=3000),
            # outside the away defensive-60% zone (x < 48) -- should not count
            pass_event(team="away", team_name="Away", player_id="away_4", location=(20, 40), match_clock_ms=4000),
            TackleEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=1500,
                        team="home", team_name="Home", player_id="home_1", player_name="P1",
                        location=(70, 40), possession_id=1, outcome="won", opponent_id="away_1"),
            TackleEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=2500,
                        team="home", team_name="Home", player_id="home_2", player_name="P2",
                        location=(80, 40), possession_id=1, outcome="lost", opponent_id="away_2"),
            InterceptionEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=3500,
                               team="home", team_name="Home", player_id="home_3", player_name="P3",
                               location=(60, 40), possession_id=1, opponent_id="away_3"),
            FoulEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=4500,
                      team="home", team_name="Home", player_id="home_4", player_name="P4",
                      location=(55, 40), possession_id=1, opponent_id="away_3", severity="minor"),
            DuelEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=5000,
                      team="home", team_name="Home", player_id="home_5", player_name="P5",
                      location=(60, 40), possession_id=1, outcome="won", opponent_id="away_1", duel_type="aerial"),
            DuelEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=5500,
                      team="home", team_name="Home", player_id="home_6", player_name="P6",
                      location=(60, 40), possession_id=1, outcome="lost", opponent_id="away_1", duel_type="aerial"),
        ]
        # opponent_passes = 3 (the 4th is outside the zone)
        # defensive_actions = tackle(any outcome)=2 + interception=1 + foul=1 + duel_won=1 = 5
        ppda = m.compute_ppda(events, "home", 0, 10000)
        assert ppda == pytest.approx(3 / 5)

    def test_returns_none_when_no_activity(self):
        assert m.compute_ppda([], "home", 0, 10000) is None


class TestEntropy:
    def test_single_category_has_zero_entropy(self):
        events = [pass_event(match_clock_ms=i * 1000) for i in range(5)]
        assert m.shannon_entropy(events) == 0.0

    def test_uniform_categories_hit_max_entropy(self):
        events = [
            pass_event(outcome="complete"),
            pass_event(outcome="incomplete"),
            CarryEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=1000,
                       team="home", team_name="Home", player_id="home_1", player_name="P1",
                       location=(60, 40), possession_id=1, end_location=(65, 40), duration_s=1.0),
            DribbleEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=1000,
                         team="home", team_name="Home", player_id="home_1", player_name="P1",
                         location=(60, 40), possession_id=1, outcome="complete", opponent_id="away_1"),
            DribbleEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=1000,
                         team="home", team_name="Home", player_id="home_1", player_name="P1",
                         location=(60, 40), possession_id=1, outcome="tackled", opponent_id="away_1"),
            PossessionChangeEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=1000,
                                   team="home", team_name="Home", player_id="", player_name="",
                                   location=(60, 40), possession_id=2, reason="turnover"),
            ShotEvent(match_id=MATCH_ID, period=1, minute=1, second=0, match_clock_ms=1000,
                      team="home", team_name="Home", player_id="home_1", player_name="P1",
                      location=(100, 40), possession_id=1, end_location=(120, 40), outcome="saved",
                      xg=0.3, shot_speed_kmh=90.0),
        ]
        assert m.shannon_entropy(events) == pytest.approx(m.MAX_ENTROPY, rel=1e-6)


class TestXT:
    def test_xt_increases_toward_goal(self):
        own_box = m.xt_value((5, 40), "left_to_right")
        midfield = m.xt_value((60, 40), "left_to_right")
        opp_box = m.xt_value((115, 40), "left_to_right")
        assert own_box < midfield < opp_box
        assert 0.0 <= own_box <= 0.05
        assert 0.1 <= opp_box <= 0.3

    def test_direction_mirrors_correctly(self):
        a = m.xt_value((115, 40), "left_to_right")
        b = m.xt_value((5, 40), "right_to_left")
        assert a == pytest.approx(b, abs=1e-9)


class TestPositioningQuality:
    def test_perfect_positioning(self):
        assert m.positioning_quality(0.0, 0.0) == 1.0

    def test_worst_positioning_clips_to_zero(self):
        assert m.positioning_quality(35.0, 90.0) == 0.0
        assert m.positioning_quality(100.0, 100.0) == 0.0


class TestPassDifficulty:
    def test_pressure_increases_difficulty(self):
        calm = m.pass_difficulty_rating((60, 40), (70, 40), 10.0, under_pressure=False, direction="left_to_right")
        pressured = m.pass_difficulty_rating((60, 40), (70, 40), 10.0, under_pressure=True, direction="left_to_right")
        assert pressured > calm


class TestTempo:
    def test_constant_series_has_zero_zscore(self):
        series = [(0, 10.0), (60000, 10.0), (120000, 10.0)]
        z = m.tempo_zscores(series)
        assert all(score == 0.0 for _, _, score in z)
