"""Deterministic "what if" counterfactual scoring. Re-runs the exact same
pure Analyst-0 function that produced an insight's actual metric, against a
hypothetical alternate input a viewer picks (a different pass end-zone, a
different referee position, a different action under pressure) -- a real
recomputed number, not an LLM guessing what might have happened. No model
call involved, same honesty posture as the rest of Analyst-0.

Only trigger_types with enough per-event (not team/window-aggregate) data
in their window_summary support a counterfactual this way -- pressure_spike,
chaos_shift, and rhythm_change are team/window-level statistics with no
single action to vary, so they're not in scope here.
"""
from __future__ import annotations

from agents.analyst0 import metrics as m
from agents.shared.models import InsightCandidate, WhatIfResult

SUPPORTED_TRIGGER_TYPES = ("xt_surge", "referee_decision", "tendency_match", "tendency_break")


class UnsupportedWhatIf(ValueError):
    """Raised when an insight's trigger_type has no counterfactual mapping,
    or the insight is missing the window_summary fields a what-if needs
    (e.g. an insight logged before these fields were added)."""


def _require(summary: dict, *keys: str) -> list:
    missing = [k for k in keys if k not in summary]
    if missing:
        raise UnsupportedWhatIf(f"insight is missing required fields for a what-if: {missing}")
    return [summary[k] for k in keys]


def _score_xt_surge(insight: InsightCandidate, knob: dict) -> WhatIfResult:
    start_x, start_y, end_x, end_y, team = _require(
        insight.window_summary, "start_x", "start_y", "end_x", "end_y", "team",
    )
    direction = m.direction_of(team)
    hyp_end = (float(knob.get("end_x", end_x)), float(knob.get("end_y", end_y)))

    actual = m.action_xt_delta((start_x, start_y), (end_x, end_y), direction)
    hypothetical = m.action_xt_delta((start_x, start_y), hyp_end, direction)
    delta = round(hypothetical - actual, 4)
    word = "increased" if delta > 0 else ("decreased" if delta < 0 else "stayed the same")
    explanation = (
        f"Had that action gone to ({hyp_end[0]:.0f}, {hyp_end[1]:.0f}) instead of "
        f"({end_x:.0f}, {end_y:.0f}), Expected Threat would have {word} by {abs(delta):.3f} "
        f"(from {actual:.3f} to {hypothetical:.3f})."
    )
    return WhatIfResult(actual_value=actual, hypothetical_value=hypothetical, delta=delta, explanation=explanation)


def _score_referee_decision(insight: InsightCandidate, knob: dict) -> WhatIfResult:
    distance_m, angle_deg = _require(insight.window_summary, "distance_m", "angle_deg")
    hyp_distance = float(knob.get("distance_m", distance_m))
    hyp_angle = float(knob.get("angle_deg", angle_deg))

    actual = m.positioning_quality(distance_m, angle_deg)
    hypothetical = m.positioning_quality(hyp_distance, hyp_angle)
    delta = round(hypothetical - actual, 3)
    word = "improved" if delta > 0 else ("worsened" if delta < 0 else "stayed the same")
    explanation = (
        f"Had the referee been {hyp_distance:.1f}m away at a {hyp_angle:.0f} degree viewing angle "
        f"instead of {distance_m:.1f}m / {angle_deg:.0f} degrees, positioning quality would have {word} "
        f"from {actual:.2f} to {hypothetical:.2f} ({m.confidence_band(hypothetical)})."
    )
    return WhatIfResult(actual_value=actual, hypothetical_value=hypothetical, delta=delta, explanation=explanation)


def _score_tendency(insight: InsightCandidate, knob: dict) -> WhatIfResult:
    summary = insight.window_summary
    (actual_action,) = _require(summary, "actual_action")
    bias_keys = ("bias_pass", "bias_dribble", "bias_carry", "bias_lose_possession")
    if not any(k in summary for k in bias_keys):
        raise UnsupportedWhatIf("insight is missing the action-bias fields needed for a what-if")
    bias = {
        "pass": summary.get("bias_pass", 0.0), "dribble": summary.get("bias_dribble", 0.0),
        "carry": summary.get("bias_carry", 0.0), "lose_possession": summary.get("bias_lose_possession", 0.0),
    }
    hyp_action = str(knob.get("actual_action", actual_action))

    actual = insight.metric_value
    hypothetical = round(bias.get(hyp_action, 0.0), 3)
    delta = round(hypothetical - actual, 3)
    word = "more" if delta > 0 else ("less" if delta < 0 else "equally")
    explanation = (
        f"Had the player {hyp_action} instead of {actual_action} under that same pressure, it would have "
        f"been {word} in character for them (alignment score {hypothetical:.2f} vs. the actual {actual:.2f})."
    )
    return WhatIfResult(actual_value=actual, hypothetical_value=hypothetical, delta=delta, explanation=explanation)


_SCORERS = {
    "xt_surge": _score_xt_surge,
    "referee_decision": _score_referee_decision,
    "tendency_match": _score_tendency,
    "tendency_break": _score_tendency,
}


def score_counterfactual(insight: InsightCandidate, knob: dict) -> WhatIfResult:
    scorer = _SCORERS.get(insight.trigger_type)
    if scorer is None:
        raise UnsupportedWhatIf(
            f"no counterfactual mapping for trigger_type={insight.trigger_type!r} "
            f"(supported: {SUPPORTED_TRIGGER_TYPES})"
        )
    return scorer(insight, knob)
