from datagen.pitch_grid import ZONE_LABELS, zone_center, zone_of
from datagen.schema import ActionBias, PlayerTendencyProfile


def test_action_bias_accepts_pass_alias():
    bias = ActionBias.model_validate({"pass": 0.6, "dribble": 0.2, "carry": 0.15, "lose_possession": 0.05})
    assert bias.pass_ == 0.6
    dumped = bias.model_dump(by_alias=True)
    assert dumped["pass"] == 0.6
    assert "pass_" not in dumped


def test_player_tendency_profile_roundtrip():
    profile = PlayerTendencyProfile(
        player_id="home_7", player_name="J. Okafor", position="WM", preferred_foot="right",
        zone_bias={z: 1 / len(ZONE_LABELS) for z in ZONE_LABELS},
        action_bias_under_pressure=ActionBias.model_validate(
            {"pass": 0.4, "dribble": 0.35, "carry": 0.2, "lose_possession": 0.05}
        ),
        directness=0.6, dribble_tendency=0.5, sprint_frequency_per_match=40.0,
        preferred_sprint_zones=["z3_0", "z4_0"], shot_on_sight=0.2,
    )
    assert abs(sum(profile.zone_bias.values()) - 1.0) < 1e-9
    assert profile.position == "WM"


def test_zone_grid_round_trip_is_consistent():
    for label in ZONE_LABELS:
        center = zone_center(label)
        assert zone_of(center) == label
