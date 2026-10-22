import typing

import pytest

from agents.narrator.fallback import fallback_narration
from agents.shared.models import InsightCandidate, TriggerType
from eval.grounding_check import check_grounding

ALL_TRIGGER_TYPES = typing.get_args(TriggerType)


@pytest.mark.parametrize("trigger_type", ALL_TRIGGER_TYPES)
def test_fallback_narration_passes_its_own_grounding_check(trigger_type):
    insight = InsightCandidate(
        match_id="M1", window_start_min=10.0, window_end_min=13.0,
        trigger_type=trigger_type, metric_name="some_metric", metric_value=4.321,
        baseline_value=2.1, delta_pct=105.8, related_players=["home_1"],
        window_summary={"team": "home"},
    )
    text = fallback_narration(insight)
    result = check_grounding(text, insight, player_names={"home_1": "Test Player"})
    assert result.passed, f"fallback failed its own grounding check: {result}"


def test_fallback_narration_handles_missing_baseline():
    insight = InsightCandidate(
        match_id="M1", window_start_min=12.0, window_end_min=12.0,
        trigger_type="milestone", metric_name="goal", metric_value=1.0,
        related_players=["home_9"], window_summary={"team": "home"},
    )
    text = fallback_narration(insight)
    assert "n/a" not in text  # milestone template doesn't reference baseline at all
    result = check_grounding(text, insight)
    assert result.passed


def test_fallback_narration_never_names_a_player():
    insight = InsightCandidate(
        match_id="M1", window_start_min=5.0, window_end_min=7.0,
        trigger_type="xt_surge", metric_name="xt_gain", metric_value=0.05,
        baseline_value=0.01, delta_pct=400.0, related_players=["home_2", "home_3"],
        window_summary={},
    )
    text = fallback_narration(insight)
    assert "home_2" not in text and "home_3" not in text
