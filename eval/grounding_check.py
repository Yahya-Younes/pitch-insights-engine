"""Automated grounding verifier for Narrator/Concierge output. This is what
separates "explainable match intelligence" from an LLM free-associating: every
number and every named player in the generated text has to trace back to the
InsightCandidate it was generated from, and the text has to actually be
talking about what the trigger_type says it's talking about.

Deliberately a lightweight regex/keyword checker, not a full NLI model — fast,
cheap, dependency-free, and transparent about exactly why something failed,
which matters more here than marginal extra precision would.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from agents.shared.models import InsightCandidate

_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")

TRIGGER_VOCAB: dict[str, set[str]] = {
    "pressure_spike": {"press", "pressure", "squeeze", "high line", "closing down", "pressed", "pressing"},
    "chaos_shift": {"chaotic", "chaos", "scrappy", "control", "momentum", "disjointed", "frantic", "turnover"},
    "rhythm_change": {"tempo", "rhythm", "pace", "slowed", "sped up", "surge", "slower", "faster"},
    "xt_surge": {"threat", "dangerous", "chance", "territory", "threatening"},
    "milestone": {"goal", "scores", "scored", "milestone"},
    "referee_decision": {"referee", "contestable", "positioning", "angle", "call", "decision", "away"},
    "tendency_match": {"anticipated", "knew", "known", "pattern", "typical", "usual", "matches"},
    "tendency_break": {"out of character", "against his", "against her", "surprising", "unusual", "caught", "instead"},
}

NUMERIC_TOLERANCE = 0.6


@dataclass
class GroundingResult:
    insight_id: str
    numeric_ok: bool
    entity_ok: bool
    vocabulary_ok: bool
    unmatched_numbers: list[str] = field(default_factory=list)
    unmatched_entities: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.numeric_ok and self.entity_ok and self.vocabulary_ok


def _allowed_numeric_values(insight: InsightCandidate) -> list[float]:
    values = [insight.window_start_min, insight.window_end_min]
    for v in (insight.metric_value, insight.baseline_value, insight.delta_pct):
        if v is not None:
            values.append(float(v))
    for v in insight.window_summary.values():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            values.append(float(v))
    return values


def _numeric_check(text: str, insight: InsightCandidate) -> tuple[bool, list[str]]:
    allowed = _allowed_numeric_values(insight)
    unmatched = []
    for token in _NUMBER_RE.findall(text):
        num = float(token)
        if not any(
            abs(num - a) <= NUMERIC_TOLERANCE or abs(abs(num) - abs(a)) <= NUMERIC_TOLERANCE
            for a in allowed
        ):
            unmatched.append(token)
    return len(unmatched) == 0, unmatched


def _entity_check(text: str, insight: InsightCandidate, player_names: dict[str, str]) -> tuple[bool, list[str]]:
    allowed_names = {player_names[pid] for pid in insight.related_players if pid in player_names}
    text_lower = text.lower()
    unmatched = []
    for pid, name in player_names.items():
        if name.lower() in text_lower and name not in allowed_names:
            unmatched.append(name)
    return len(unmatched) == 0, unmatched


def _vocabulary_check(text: str, insight: InsightCandidate) -> bool:
    vocab = TRIGGER_VOCAB.get(insight.trigger_type)
    if not vocab:
        return True
    text_lower = text.lower()
    return any(kw in text_lower for kw in vocab)


def check_grounding(text: str, insight: InsightCandidate, player_names: dict[str, str] | None = None) -> GroundingResult:
    player_names = player_names or {}
    numeric_ok, unmatched_numbers = _numeric_check(text, insight)
    entity_ok, unmatched_entities = _entity_check(text, insight, player_names)
    vocabulary_ok = _vocabulary_check(text, insight)
    return GroundingResult(
        insight_id=insight.insight_id, numeric_ok=numeric_ok, entity_ok=entity_ok,
        vocabulary_ok=vocabulary_ok, unmatched_numbers=unmatched_numbers, unmatched_entities=unmatched_entities,
    )


def grounding_pass_rate(results: list[GroundingResult]) -> float:
    if not results:
        return 1.0
    return round(sum(1 for r in results if r.passed) / len(results), 3)
