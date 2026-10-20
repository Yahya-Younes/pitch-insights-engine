from agents.concierge.lens import load_preset_lenses, rank_insights_for_lens
from agents.shared.models import InsightCandidate

EXPECTED_LENS_IDS = {
    "guardiola_positional_play", "mourinho_control_the_chaos", "klopp_gegenpressing",
    "wenger_fluid_technicality", "ferguson_momentum_and_management",
}


def test_all_five_preset_lenses_load_and_validate():
    lenses = load_preset_lenses()
    assert set(lenses.keys()) == EXPECTED_LENS_IDS
    for lens in lenses.values():
        assert len(lens.insight_priority_order) == 8
        assert lens.moderation_status == "approved"
        assert "not affiliated with or endorsed by" in lens.sourcing_note.lower()


def test_lenses_reorder_insights_differently():
    insights = [
        InsightCandidate(match_id="M1", window_start_min=10, window_end_min=12,
                          trigger_type="pressure_spike", metric_name="ppda_home", metric_value=4.0),
        InsightCandidate(match_id="M1", window_start_min=20, window_end_min=22,
                          trigger_type="xt_surge", metric_name="xt_gain", metric_value=0.15),
        InsightCandidate(match_id="M1", window_start_min=30, window_end_min=32,
                          trigger_type="referee_decision", metric_name="positioning_quality", metric_value=0.2),
    ]
    lenses = load_preset_lenses()
    guardiola_order = [c.trigger_type for c in rank_insights_for_lens(insights, lenses["guardiola_positional_play"])]
    mourinho_order = [c.trigger_type for c in rank_insights_for_lens(insights, lenses["mourinho_control_the_chaos"])]

    assert guardiola_order[0] == "xt_surge"
    assert mourinho_order[0] == "referee_decision"
    assert guardiola_order != mourinho_order
