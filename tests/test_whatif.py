import pytest

from agents.analyst0 import metrics as m
from agents.analyst0.whatif import UnsupportedWhatIf, score_counterfactual
from agents.shared.models import InsightCandidate


def _insight(trigger_type: str, metric_value: float, window_summary: dict) -> InsightCandidate:
    return InsightCandidate(
        match_id="M-WHATIF", window_start_min=10.0, window_end_min=10.0,
        trigger_type=trigger_type, metric_name="x", metric_value=metric_value,
        window_summary=window_summary,
    )


def test_xt_surge_whatif_matches_direct_call_to_action_xt_delta():
    start = (60.0, 40.0)
    end = (90.0, 40.0)
    direction = m.direction_of("home")
    actual = m.action_xt_delta(start, end, direction)

    insight = _insight("xt_surge", actual, {
        "team": "home", "action_type": "pass", "zscore": 2.0,
        "start_x": start[0], "start_y": start[1], "end_x": end[0], "end_y": end[1],
    })

    hyp_end = (110.0, 40.0)
    result = score_counterfactual(insight, {"end_x": hyp_end[0], "end_y": hyp_end[1]})

    expected_hypothetical = m.action_xt_delta(start, hyp_end, direction)
    assert result.actual_value == actual
    assert result.hypothetical_value == expected_hypothetical
    assert result.delta == round(expected_hypothetical - actual, 4)
    assert str(round(hyp_end[0])) in result.explanation


def test_referee_decision_whatif_matches_direct_call_to_positioning_quality():
    actual = m.positioning_quality(20.0, 30.0)
    insight = _insight("referee_decision", actual, {
        "decision_type": "foul_called", "distance_m": 20.0, "angle_deg": 30.0,
        "severity": "reckless", "law_reference": "Law 12", "estimated_impact": 0.55,
        "confidence": m.confidence_band(actual),
    })

    result = score_counterfactual(insight, {"distance_m": 5.0, "angle_deg": 5.0})

    expected_hypothetical = m.positioning_quality(5.0, 5.0)
    assert result.actual_value == actual
    assert result.hypothetical_value == expected_hypothetical
    assert result.delta == round(expected_hypothetical - actual, 3)


def test_tendency_whatif_matches_bias_lookup():
    insight = _insight("tendency_break", 0.05, {
        "actual_action": "dribble", "dominant_expected_action": "pass",
        "bias_pass": 0.7, "bias_dribble": 0.05, "bias_carry": 0.2, "bias_lose_possession": 0.05,
    })

    result = score_counterfactual(insight, {"actual_action": "pass"})

    assert result.actual_value == 0.05
    assert result.hypothetical_value == 0.7
    assert result.delta == round(0.7 - 0.05, 3)


def test_pressure_spike_is_not_supported():
    insight = _insight("pressure_spike", 4.2, {"team": "home"})
    with pytest.raises(UnsupportedWhatIf):
        score_counterfactual(insight, {})


def test_missing_window_summary_fields_raises():
    insight = _insight("xt_surge", 0.01, {"team": "home"})  # no start_x/end_x etc.
    with pytest.raises(UnsupportedWhatIf):
        score_counterfactual(insight, {"end_x": 100.0})
