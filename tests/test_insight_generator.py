from agents.analyst0.insight_generator import generate_insight_candidates
from datagen.schema import MatchMetadataEvent, PassEvent, RefereeDecisionEvent, ShotEvent

MATCH_ID = "TEST-INSIGHTS"


def _metadata():
    return MatchMetadataEvent(
        match_id=MATCH_ID, kickoff_utc="2026-10-24T15:00:00Z", venue="Test Ground",
        weather="Clear", home_team="Home", away_team="Away", home_formation="4-3-3",
        away_formation="4-3-3", home_lineup=[], away_lineup=[], referee_name="R. Test",
    )


def test_milestone_emitted_for_every_goal():
    events = [
        _metadata(),
        ShotEvent(match_id=MATCH_ID, period=1, minute=10, second=0, match_clock_ms=600000,
                  team="home", team_name="Home", player_id="home_9", player_name="Striker",
                  location=(110, 40), possession_id=1, end_location=(120, 40), outcome="goal",
                  xg=0.4, shot_speed_kmh=90.0),
        ShotEvent(match_id=MATCH_ID, period=1, minute=20, second=0, match_clock_ms=1200000,
                  team="home", team_name="Home", player_id="home_9", player_name="Striker",
                  location=(100, 40), possession_id=2, end_location=(120, 40), outcome="saved",
                  xg=0.2, shot_speed_kmh=80.0),
    ]
    candidates = generate_insight_candidates(events, MATCH_ID, 90 * 60000)
    milestones = [c for c in candidates if c.trigger_type == "milestone"]
    assert len(milestones) == 1
    assert milestones[0].related_players == ["home_9"]


def test_only_contestable_referee_decisions_become_insights():
    events = [
        _metadata(),
        RefereeDecisionEvent(match_id=MATCH_ID, period=1, minute=15, second=0, match_clock_ms=900000,
                              decision_type="foul_called", referee_location=(60, 40), incident_location=(62, 41),
                              referee_distance_to_incident_m=2.0, referee_viewing_angle_deg=5.0,
                              incident_severity="minor", contestable=False, related_player_ids=["home_4", "away_7"]),
        RefereeDecisionEvent(match_id=MATCH_ID, period=1, minute=30, second=0, match_clock_ms=1800000,
                              decision_type="foul_called", referee_location=(20, 10), incident_location=(80, 70),
                              referee_distance_to_incident_m=30.0, referee_viewing_angle_deg=80.0,
                              incident_severity="reckless", contestable=True, related_player_ids=["home_2", "away_9"]),
    ]
    candidates = generate_insight_candidates(events, MATCH_ID, 90 * 60000)
    ref_insights = [c for c in candidates if c.trigger_type == "referee_decision"]
    assert len(ref_insights) == 1
    assert ref_insights[0].metric_value < 0.5  # poor positioning quality on the contestable one


def _pass(minute, start, end, player_id="home_6", recipient_id="home_7"):
    ms = minute * 60000
    return PassEvent(
        match_id=MATCH_ID, period=1, minute=minute, second=0, match_clock_ms=ms,
        team="home", team_name="Home", player_id=player_id, player_name="Passer",
        location=start, possession_id=1, end_location=end,
        recipient_id=recipient_id, recipient_name="Receiver", outcome="complete",
        pass_type="ground", body_part="right_foot", distance_m=10.0, angle_deg=0.0,
        ball_speed_kmh=60.0,
    )


def test_xt_surge_emitted_for_outlier_progressive_pass():
    # six 10m midfield progressions establish the baseline (small, nonzero xT gain)...
    baseline_passes = [
        _pass(10 + i, (20 + i * 10, 40), (30 + i * 10, 40))
        for i in range(6)
    ]
    # ...then one line-breaking pass straight into the box should stand out.
    surge_pass = _pass(40, (60, 40), (115, 42), player_id="home_8", recipient_id="home_9")

    events = [_metadata(), *baseline_passes, surge_pass]
    candidates = generate_insight_candidates(events, MATCH_ID, 90 * 60000)
    xt_insights = [c for c in candidates if c.trigger_type == "xt_surge"]

    assert len(xt_insights) == 1
    assert xt_insights[0].related_players == ["home_8", "home_9"]
    assert xt_insights[0].metric_value > xt_insights[0].baseline_value


def test_no_events_produces_no_candidates():
    assert generate_insight_candidates([_metadata()], MATCH_ID, 90 * 60000) == []
