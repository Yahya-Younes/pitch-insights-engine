from agents.concierge.lens import load_preset_lenses
from agents.concierge.persona_filter import filter_for_persona
from agents.shared.models import InsightCandidate

MATCH_ID = "M-PERSONA"


def _insight(trigger_type, start, related_players=None, metric_value=1.0, delta_pct=None):
    return InsightCandidate(
        match_id=MATCH_ID, window_start_min=start, window_end_min=start,
        trigger_type=trigger_type, metric_name="x", metric_value=metric_value,
        delta_pct=delta_pct, related_players=related_players or [],
    )


def test_analyst_persona_includes_everything_in_chronological_order():
    insights = [
        _insight("chaos_shift", 30),
        _insight("milestone", 10),
        _insight("xt_surge", 20),
    ]
    result = filter_for_persona(insights, "analyst")
    assert [c.window_start_min for c in result] == [10, 20, 30]


def test_casual_fan_persona_caps_at_top_n_and_prioritizes_milestones():
    insights = [
        _insight("pressure_spike", 5, delta_pct=-20.0),
        _insight("milestone", 10),
        _insight("rhythm_change", 15, delta_pct=1.6),
        _insight("chaos_shift", 20, delta_pct=16.0),
        _insight("xt_surge", 25, delta_pct=400.0),
        _insight("referee_decision", 30, delta_pct=-80.0),
    ]
    result = filter_for_persona(insights, "casual_fan")
    assert len(result) == 4
    assert result[0].trigger_type == "milestone"


def test_player_tracker_persona_only_includes_that_players_insights():
    insights = [
        _insight("pressure_spike", 5, related_players=["home_1"]),
        _insight("milestone", 10, related_players=["home_9"]),
        _insight("xt_surge", 20, related_players=["home_9", "home_8"]),
    ]
    result = filter_for_persona(insights, "player_tracker", player_id="home_9")
    assert len(result) == 2
    assert all("home_9" in c.related_players for c in result)


def test_player_tracker_persona_requires_player_id():
    try:
        filter_for_persona([_insight("milestone", 10)], "player_tracker")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_lens_reweights_casual_fan_top_picks():
    insights = [
        _insight("xt_surge", 10, delta_pct=50.0),
        _insight("referee_decision", 20, delta_pct=-80.0),
        _insight("chaos_shift", 30, delta_pct=16.0),
        _insight("pressure_spike", 40, delta_pct=-30.0),
        _insight("rhythm_change", 50, delta_pct=1.6),
    ]
    lenses = load_preset_lenses()
    guardiola_top = filter_for_persona(insights, "casual_fan", lens=lenses["guardiola_positional_play"])
    mourinho_top = filter_for_persona(insights, "casual_fan", lens=lenses["mourinho_control_the_chaos"])

    assert guardiola_top[0].trigger_type == "xt_surge"
    assert mourinho_top[0].trigger_type == "referee_decision"
