"""Deterministic, zero-LLM fallback narration -- the safety net the live
grounding check (eval/grounding_check.check_grounding) falls back to when a
model's output can't be verified against its own InsightCandidate. Built
directly from the insight's own fields with no model call, so it passes its
own grounding check by construction: every number comes straight from the
object, and it never names a player (sidestepping the entity check
entirely), so there's nothing for the checker to reject.

Each template also includes one word from eval.grounding_check.TRIGGER_VOCAB
for its trigger_type, so the vocabulary check passes too -- without that,
a generic sentence like "a pressure_spike was flagged" would fail the
checker on the exact trigger type it's reporting.
"""
from __future__ import annotations

from agents.shared.models import InsightCandidate

_TEMPLATES: dict[str, str] = {
    "pressure_spike": "A pressing shift was flagged: {metric} reached {value} against a baseline of {baseline}.",
    "chaos_shift": "The match's chaos level shifted: {metric} reached {value} against a baseline of {baseline}.",
    "rhythm_change": "The game's rhythm shifted: {metric} reached {value} against a baseline of {baseline}.",
    "xt_surge": "A notably dangerous sequence was flagged: {metric} reached {value} against a baseline of {baseline}.",
    "milestone": "A goal-level milestone was recorded: {metric} reached {value}.",
    "referee_decision": "A referee decision was flagged as contestable: {metric} reached {value} against a baseline of {baseline}.",
    "tendency_match": "This matches a known pattern for this player: {metric} reached {value} against a baseline of {baseline}.",
    "tendency_break": "This was unusual for this player: {metric} reached {value} against a baseline of {baseline}.",
}


def fallback_narration(insight: InsightCandidate) -> str:
    template = _TEMPLATES.get(
        insight.trigger_type,
        "A notable moment was flagged: {metric} reached {value} against a baseline of {baseline}.",
    )
    baseline = round(insight.baseline_value, 2) if insight.baseline_value is not None else "n/a"
    return template.format(
        metric=insight.metric_name.replace("_", " "),
        value=round(insight.metric_value, 2),
        baseline=baseline,
    )
