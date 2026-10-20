"""Deterministic render-payload builder for the Broadcaster agent (stage d,
"render"). Models how real broadcast graphics engines (Chyron PRIME /
Vizrt-style) consume external data feeds keyed by game-clock + entity id.
No LLM involved -- this only reshapes an already-narrated insight into a
display-ready payload.
"""
from __future__ import annotations

from agents.shared.models import InsightCandidate, RenderDisplay, RenderPayload

_TEMPLATE_BY_TRIGGER: dict[str, str] = {
    "pressure_spike": "pressing_intensity_card",
    "chaos_shift": "momentum_meter",
    "rhythm_change": "tempo_graph",
    "xt_surge": "threat_zone_highlight",
    "milestone": "goal_banner",
    "referee_decision": "referee_positioning_card",
    "tendency_match": "player_tendency_card",
    "tendency_break": "player_tendency_card",
}
_DURATION_MS_BY_TRIGGER: dict[str, int] = {
    "milestone": 6000,
    "referee_decision": 5000,
}
_PRIORITY_BY_TRIGGER: dict[str, int] = {
    "milestone": 1,
    "referee_decision": 2,
}
_DEFAULT_DURATION_MS = 4000
_DEFAULT_PRIORITY = 5


def _game_clock(minute_float: float) -> str:
    total_seconds = max(0, round(minute_float * 60))
    minutes, seconds = divmod(total_seconds, 60)
    return f"{minutes:02d}:{seconds:02d}"


def build_render_payload(insight: InsightCandidate, narrative_text: str) -> RenderPayload:
    data_points: list[dict] = [{"label": insight.metric_name, "value": insight.metric_value}]
    if insight.baseline_value is not None:
        data_points.append({"label": "baseline", "value": insight.baseline_value})
    if insight.delta_pct is not None:
        data_points.append({"label": "delta_pct", "value": insight.delta_pct})
    for key, value in insight.window_summary.items():
        data_points.append({"label": key, "value": value})

    return RenderPayload(
        match_id=insight.match_id,
        game_clock=_game_clock(insight.window_start_min),
        graphic_type=insight.trigger_type,
        narrative_text=narrative_text,
        display=RenderDisplay(
            template=_TEMPLATE_BY_TRIGGER.get(insight.trigger_type, "generic_insight_card"),
            duration_ms=_DURATION_MS_BY_TRIGGER.get(insight.trigger_type, _DEFAULT_DURATION_MS),
            priority=_PRIORITY_BY_TRIGGER.get(insight.trigger_type, _DEFAULT_PRIORITY),
        ),
        data_points=data_points,
        linked_players=list(insight.related_players),
        source_insight_id=insight.insight_id,
    )
