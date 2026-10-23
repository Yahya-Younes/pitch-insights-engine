from datagen.schema import ActionBias, PITCH_X_MAX, PITCH_Y_MAX, PassEvent, PlayerTendencyProfile
from datagen.trajectory import generate_positions


def _profile(player_id: str, zone_bias: dict[str, float]) -> PlayerTendencyProfile:
    return PlayerTendencyProfile(
        player_id=player_id, player_name=player_id, position="CM", preferred_foot="right",
        zone_bias=zone_bias,
        action_bias_under_pressure=ActionBias(**{"pass": 0.5, "dribble": 0.2, "carry": 0.2, "lose_possession": 0.1}),
        directness=0.5, dribble_tendency=0.3, sprint_frequency_per_match=10.0,
        preferred_sprint_zones=[], shot_on_sight=0.1,
    )


def _pass_event(player_id: str, match_clock_ms: int, location, end_location) -> PassEvent:
    return PassEvent(
        match_id="M-TRAJ", period=1, minute=0, second=0, match_clock_ms=match_clock_ms,
        team="home", team_name="Home", player_id=player_id, player_name=player_id,
        location=location, possession_id=1, end_location=end_location,
        outcome="complete", pass_type="ground", body_part="right_foot",
        distance_m=10.0, angle_deg=0.0, ball_speed_kmh=40.0,
    )


def test_positions_stay_within_pitch_bounds():
    home = [_profile("home_1", {"z0_0": 1.0})]
    away = [_profile("away_1", {"z5_3": 1.0})]
    events = [_pass_event("home_1", 0, (60.0, 40.0), (119.0, 79.0))]

    frames = generate_positions("M-TRAJ", events, home, away, duration_ms=3000)

    assert len(frames) > 1
    for frame in frames:
        bx, by, bz = frame.ball
        assert 0.0 <= bx <= PITCH_X_MAX
        assert 0.0 <= by <= PITCH_Y_MAX
        assert bz >= 0.0
        for (px, py) in frame.players.values():
            assert 0.0 <= px <= PITCH_X_MAX
            assert 0.0 <= py <= PITCH_Y_MAX


def test_ball_position_at_event_timestamp_matches_the_recorded_location():
    home = [_profile("home_1", {"z0_0": 1.0})]
    away = [_profile("away_1", {"z5_3": 1.0})]
    events = [_pass_event("home_1", 0, (60.0, 40.0), (100.0, 40.0))]

    frames = generate_positions("M-TRAJ", events, home, away, duration_ms=2000)

    first_frame = frames[0]
    assert first_frame.t_ms == 0
    assert first_frame.ball[0] == 60.0
    assert first_frame.ball[1] == 40.0
    assert first_frame.ball[2] == 0.0  # grounded at the very start of the arc


def test_off_ball_players_drift_toward_their_home_position():
    home = [_profile("home_1", {"z0_0": 1.0})]
    away = [_profile("away_1", {"z5_3": 1.0})]
    # No events at all involving away_1 -- it should settle near its own
    # zone-bias home position rather than staying frozen at the pitch
    # center default.
    events = [_pass_event("home_1", 0, (60.0, 40.0), (65.0, 40.0))]

    frames = generate_positions("M-TRAJ", events, home, away, duration_ms=5000)
    last = frames[-1]
    away_x, away_y = last.players["away_1"]

    from datagen.pitch_grid import expected_location_from_bias
    home_x, home_y = expected_location_from_bias({"z5_3": 1.0})
    assert abs(away_x - home_x) < 2.0
    assert abs(away_y - home_y) < 2.0
