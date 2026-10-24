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

from agents.shared.glossary import TRIGGER_GLOSSARY
from agents.shared.models import InsightCandidate

# English narration (Narrator is English-only; Concierge's English path uses
# this too) groups large numbers with comma thousands-separators and a period
# decimal point (e.g. "1,417.6") -- the opposite convention from fr/es/de,
# where a bare comma is the decimal separator (e.g. "0,005"). Using one
# pattern for both locales silently mis-parses whichever convention it
# doesn't match: "1,417" read as a European decimal becomes 1.417 instead of
# 1417, which then looks like a fabricated number and fails grounding even
# though it's the correct value, just formatted differently.
_NUMBER_RE_EN = re.compile(r"-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?")
_NUMBER_RE_EU = re.compile(r"-?\d+(?:[.,]\d+)?")


def _extract_numbers(text: str, locale: str = "en") -> list[str]:
    pattern = _NUMBER_RE_EN if locale == "en" else _NUMBER_RE_EU
    return pattern.findall(text)


def _to_float(token: str, locale: str = "en") -> float:
    return float(token.replace(",", "")) if locale == "en" else float(token.replace(",", "."))

TRIGGER_VOCAB: dict[str, set[str]] = {
    "pressure_spike": {"press", "pressure", "squeeze", "high line", "closing down", "pressed", "pressing"},
    "chaos_shift": {"chaotic", "chaos", "scrappy", "control", "momentum", "disjointed", "frantic", "turnover"},
    "rhythm_change": {"tempo", "rhythm", "pace", "slowed", "sped up", "surge", "slower", "faster"},
    "xt_surge": {
        "threat", "dangerous", "danger", "chance", "territory", "threatening", "threatened",
        "xt_surge", "xt surge", "lit up", "carved",
    },
    "milestone": {"goal", "scores", "scored", "milestone"},
    "referee_decision": {"referee", "contestable", "positioning", "angle", "call", "decision", "away", "law"},
    "tendency_match": {"anticipated", "knew", "known", "pattern", "typical", "usual", "matches", "matched", "consistent with"},
    "tendency_break": {
        "out of character", "against his", "against her", "surprising", "unusual", "caught", "instead",
        "diverged", "deviat", "departed from", "atypical", "uncharacteristic",
    },
}

NUMERIC_TOLERANCE = 0.6

# This system only ever describes the synthetic match in front of it --
# Narrator's own system prompt says so explicitly ("never state ... any fact
# about a real Premier League club, player, or match"), but until now
# nothing actually enforced that rule; it relied entirely on the model
# following an instruction. A small, curated, case-insensitive blocklist of
# unambiguous real-club and real-player identifiers (full names only, never
# a single common word like "City" that would false-positive on ordinary
# text) catches the realistic failure mode: the model name-drops a real club
# or player it knows about from training, not just a fabricated stat.
# Illustrative, not exhaustive -- a heuristic defense, not a perfect filter.
_REAL_WORLD_ENTITIES = [
    "Manchester United", "Manchester City", "Liverpool FC", "Real Madrid",
    "FC Barcelona", "Bayern Munich", "Tottenham Hotspur", "Newcastle United",
    "Paris Saint-Germain", "Erling Haaland", "Mohamed Salah", "Kevin De Bruyne",
    "Bukayo Saka", "Cristiano Ronaldo", "Lionel Messi",
]


def _real_world_leak_check(text: str) -> tuple[bool, list[str]]:
    text_lower = text.lower()
    hits = [name for name in _REAL_WORLD_ENTITIES if name.lower() in text_lower]
    return len(hits) == 0, hits


@dataclass
class GroundingResult:
    insight_id: str
    numeric_ok: bool
    entity_ok: bool
    vocabulary_ok: bool
    unmatched_numbers: list[str] = field(default_factory=list)
    unmatched_entities: list[str] = field(default_factory=list)
    real_world_ok: bool = True
    real_world_leaks: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.numeric_ok and self.entity_ok and self.vocabulary_ok and self.real_world_ok


def _allowed_numeric_values(insight: InsightCandidate, locale: str = "en") -> list[float]:
    values = [insight.window_start_min, insight.window_end_min]
    # match_id ("DEMO-<timestamp>-<seed>") is a legitimate, if unusual, thing
    # for the dense/precise analyst persona to cite -- its embedded digits
    # shouldn't look like a fabricated stat.
    values.extend(_to_float(tok, locale) for tok in _extract_numbers(insight.match_id, locale))
    for v in (insight.metric_value, insight.baseline_value, insight.delta_pct):
        if v is not None:
            values.append(float(v))
    for v in insight.window_summary.values():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            values.append(float(v))
        elif isinstance(v, str):
            # A number can legitimately live inside a string field too (e.g.
            # window_summary["law_reference"] = "Law 12 (...)") -- it still
            # traces back to the InsightCandidate, just not through a
            # numeric field, so it should count as grounded.
            values.extend(_to_float(tok, locale) for tok in _extract_numbers(v, locale))
    for pid in insight.related_players:
        # The analyst persona in particular is instructed to be dense and
        # precise, and reasonably cites internal ids like "(home_7)" -- the
        # embedded 7 is a real, traceable fact about the insight, not a
        # fabricated number, even though it never appears in a numeric field.
        values.extend(_to_float(tok, locale) for tok in _extract_numbers(pid, locale))
    return values


def _numeric_check(text: str, insight: InsightCandidate, locale: str = "en") -> tuple[bool, list[str]]:
    allowed = _allowed_numeric_values(insight, locale)
    unmatched = []
    for token in _extract_numbers(text, locale):
        num = _to_float(token, locale)
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


def _vocabulary_check_localized(text: str, insight: InsightCandidate, locale: str) -> bool:
    """Same check as _vocabulary_check, but against TRIGGER_GLOSSARY's
    locale-specific terms instead of the English-only TRIGGER_VOCAB.
    Returns True (skips the check) only for a genuinely unsupported locale
    -- not for every non-English locale, the way this used to work before
    TRIGGER_GLOSSARY existed."""
    if locale == "en":
        return _vocabulary_check(text, insight)
    vocab = TRIGGER_GLOSSARY.get(locale, {}).get(insight.trigger_type)
    if not vocab:
        return True
    text_lower = text.lower()
    return any(kw in text_lower for kw in vocab)


def check_grounding(text: str, insight: InsightCandidate, player_names: dict[str, str] | None = None) -> GroundingResult:
    """Always English -- the Narrator (this function's only caller) never
    writes any other language, so number parsing always uses the
    comma-thousands/period-decimal convention (see _NUMBER_RE_EN)."""
    player_names = player_names or {}
    numeric_ok, unmatched_numbers = _numeric_check(text, insight, locale="en")
    entity_ok, unmatched_entities = _entity_check(text, insight, player_names)
    vocabulary_ok = _vocabulary_check(text, insight)
    real_world_ok, real_world_leaks = _real_world_leak_check(text)
    return GroundingResult(
        insight_id=insight.insight_id, numeric_ok=numeric_ok, entity_ok=entity_ok,
        vocabulary_ok=vocabulary_ok, unmatched_numbers=unmatched_numbers, unmatched_entities=unmatched_entities,
        real_world_ok=real_world_ok, real_world_leaks=real_world_leaks,
    )


def check_grounding_multi(
    text: str, insights: list[InsightCandidate], player_names: dict[str, str] | None = None,
    locale: str = "en",
) -> GroundingResult:
    """Grounding check for Concierge-style text that covers several insights
    at once (unlike the Narrator, which always gets exactly one). Numeric and
    entity checks union the allowed values/names across all given insights;
    the vocabulary check passes if the text matches *any* of the covered
    trigger types' vocab, since a multi-insight recap legitimately touches
    more than one topic -- requiring every trigger's vocab to appear would be
    too strict for a short summary, and this checker is deliberately a
    lightweight keyword/number check, not a full NLI model (see module
    docstring).

    TRIGGER_VOCAB is English-only, but agents.shared.glossary.TRIGGER_GLOSSARY
    mirrors it for fr/es/de, so the vocabulary check runs for real in those
    locales too instead of being unconditionally skipped -- it only skips
    (vocabulary_ok=True) for a genuinely unsupported locale now. Numbers and
    player names don't change across languages, so numeric_ok/entity_ok --
    the checks that actually catch a fabricated or wrong claim -- always
    apply in full regardless of locale."""
    player_names = player_names or {}
    allowed_numbers: list[float] = []
    allowed_names: set[str] = set()
    for insight in insights:
        allowed_numbers.extend(_allowed_numeric_values(insight, locale))
        allowed_names |= {player_names[pid] for pid in insight.related_players if pid in player_names}

    unmatched_numbers = []
    for token in _extract_numbers(text, locale):
        num = _to_float(token, locale)
        if not any(
            abs(num - a) <= NUMERIC_TOLERANCE or abs(abs(num) - abs(a)) <= NUMERIC_TOLERANCE
            for a in allowed_numbers
        ):
            unmatched_numbers.append(token)
    numeric_ok = len(unmatched_numbers) == 0

    text_lower = text.lower()
    unmatched_entities = [
        name for pid, name in player_names.items()
        if name.lower() in text_lower and name not in allowed_names
    ]
    entity_ok = len(unmatched_entities) == 0

    vocabulary_ok = (
        any(_vocabulary_check_localized(text, insight, locale) for insight in insights) if insights else True
    )
    real_world_ok, real_world_leaks = _real_world_leak_check(text)

    combined_id = "+".join(i.insight_id for i in insights) if insights else "none"
    return GroundingResult(
        insight_id=combined_id, numeric_ok=numeric_ok, entity_ok=entity_ok,
        vocabulary_ok=vocabulary_ok, unmatched_numbers=unmatched_numbers, unmatched_entities=unmatched_entities,
        real_world_ok=real_world_ok, real_world_leaks=real_world_leaks,
    )


def grounding_pass_rate(results: list[GroundingResult]) -> float:
    if not results:
        return 1.0
    return round(sum(1 for r in results if r.passed) / len(results), 3)
