from agents.broadcaster.render import build_render_payload
from agents.shared.models import InsightCandidate


def test_render_payload_is_deterministic_and_grounded_in_the_insight():
    insight = InsightCandidate(
        match_id="M1", window_start_min=23.5, window_end_min=26.0,
        trigger_type="pressure_spike", metric_name="ppda_home", metric_value=4.2,
        baseline_value=7.1, delta_pct=-40.8, related_players=["home_7"],
        related_events=["evt-1"], window_summary={"team": "home"},
    )
    payload = build_render_payload(insight, "The home side pressed much harder in this window.")

    assert payload.match_id == "M1"
    assert payload.game_clock == "23:30"
    assert payload.graphic_type == "pressure_spike"
    assert payload.display.template == "pressing_intensity_card"
    assert payload.linked_players == ["home_7"]
    assert payload.source_insight_id == insight.insight_id
    assert {"label": "ppda_home", "value": 4.2} in payload.data_points
    assert {"label": "baseline", "value": 7.1} in payload.data_points
    assert {"label": "delta_pct", "value": -40.8} in payload.data_points


def test_milestone_gets_a_goal_banner_with_top_priority():
    insight = InsightCandidate(
        match_id="M1", window_start_min=12.0, window_end_min=12.0,
        trigger_type="milestone", metric_name="goal", metric_value=1.0,
        related_players=["home_9"], window_summary={"team": "home", "xg": 0.42},
    )
    payload = build_render_payload(insight, "Goal!")

    assert payload.display.template == "goal_banner"
    assert payload.display.priority == 1


def test_trigger_without_a_custom_duration_or_priority_uses_the_default():
    insight = InsightCandidate(
        match_id="M1", window_start_min=5.0, window_end_min=5.0,
        trigger_type="rhythm_change", metric_name="tempo_zscore", metric_value=1.8,
    )
    payload = build_render_payload(insight, "The tempo picked up noticeably.")
    assert payload.display.template == "tempo_graph"
    assert payload.display.duration_ms == 4000
    assert payload.display.priority == 5
