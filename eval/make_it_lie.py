"""'Try to make it lie': an interactive, zero-LLM demonstration of the live
grounding check actually doing its job.

Takes a narration that already shipped for a real insight, deliberately
tampers with it (a fabricated number, a real-but-wrong player from the same
match roster, a real Premier League club name leak, or the viewer's own
text), and runs the result through the *exact same* function the Narrator
stage calls in production -- eval.grounding_check.check_grounding, with the
match's full roster as player_names (see agents/narrator/executor.py). When
the check rejects, the trace also shows the deterministic fallback sentence
(agents.narrator.fallback.fallback_narration) that the pipeline would ship
instead, re-checked by the same function.

Nothing here calls a model, so it's free, instant, and safe to expose
publicly. And it is honest by design: if a viewer's custom text genuinely
slips past the checker (it's a lightweight number/name/keyword verifier
with a +-0.6 numeric tolerance, not an NLI model), the verdict says
"passed" and shipped says "tampered" -- it is never faked into a rejection.

compute_headline() turns eval.robustness_suite into a judge-friendly
headline. It reuses the suite's own fixtures, corruption generators and
canonical run() totals; the only thing added is a per-attack breakdown and
a "reached air" count (corruptions whose *shipped* text -- tampered if it
passed, fallback otherwise -- would still be ungrounded).
"""
from __future__ import annotations

import time
from typing import Literal

from agents.narrator.fallback import fallback_narration
from agents.shared.models import InsightCandidate
from eval import robustness_suite
from eval.grounding_check import (
    _NUMBER_RE_EN,
    _REAL_WORLD_ENTITIES,
    NUMERIC_TOLERANCE,
    GroundingResult,
    _allowed_numeric_values,
    check_grounding,
)

Attack = Literal["fake_number", "wrong_player", "real_club_leak", "custom"]
ATTACKS: tuple[str, ...] = ("fake_number", "wrong_player", "real_club_leak", "custom")
CUSTOM_MAX_CHARS = 300

# Clubs only (the blocklist's first entries), so the leak reads like a
# commentator's comparison rather than a random celebrity name.
_CLUBS = [e for e in _REAL_WORLD_ENTITIES if any(w in e for w in ("United", "City", "FC", "Madrid", "Munich", "Hotspur", "Germain"))]


class TamperUnavailable(ValueError):
    """The requested attack can't be built for this insight (e.g. no
    unrelated player on the roster, or an empty custom text)."""


def _is_grounded_number(value: float, allowed: list[float]) -> bool:
    return any(
        abs(value - a) <= NUMERIC_TOLERANCE or abs(abs(value) - abs(a)) <= NUMERIC_TOLERANCE
        for a in allowed
    )


def _format_like(value: float, token: str) -> str:
    decimals = len(token.split(".", 1)[1]) if "." in token else 0
    return f"{value:.{decimals}f}"


def _fake_value(original: float, token: str, allowed: list[float]) -> str:
    """Shift the number by +10, +20, ... (keeping its sign and decimal
    places) until it's clearly outside the checker's tolerance of every
    grounded value -- a fabricated stat, not a rounding difference."""
    sign = -1.0 if original < 0 else 1.0
    for k in range(1, 200):
        candidate = sign * (abs(original) + 10 * k)
        text = _format_like(candidate, token)
        if not _is_grounded_number(float(text), allowed):
            return text
    raise TamperUnavailable("could not construct an out-of-tolerance number")  # pragma: no cover


def _attack_fake_number(text: str, insight: InsightCandidate) -> str:
    allowed = _allowed_numeric_values(insight, "en")
    matches = list(_NUMBER_RE_EN.finditer(text))
    if not matches:
        for k in range(37, 1000, 10):
            if not _is_grounded_number(float(k), allowed):
                return f"{text.rstrip()} That was a {k}% swing on the previous spell."
        raise TamperUnavailable("could not construct an out-of-tolerance number")  # pragma: no cover
    # Corrupt the headline stat: the number closest to the insight's own
    # metric_value (first one on ties), so the lie is about what matters.
    target = min(matches, key=lambda m: abs(float(m.group().replace(",", "")) - insight.metric_value))
    token = target.group()
    fake = _fake_value(float(token.replace(",", "")), token.replace(",", ""), allowed)
    return text[: target.start()] + fake + text[target.end():]


def _attack_wrong_player(text: str, insight: InsightCandidate, player_names: dict[str, str]) -> str:
    related = {player_names[pid] for pid in insight.related_players if pid in player_names}
    candidates = sorted(
        (pid, name) for pid, name in player_names.items()
        if pid not in insight.related_players and name and name not in related
        and name.lower() not in text.lower()
    )
    if not candidates:
        raise TamperUnavailable("no roster player unrelated to this insight to swap in")
    wrong = candidates[0][1]
    for name in sorted(related, key=len, reverse=True):
        idx = text.lower().find(name.lower())
        if idx >= 0:
            return text[:idx] + wrong + text[idx + len(name):]
    return f"{text.rstrip()} {wrong} was at the heart of it."


def _attack_real_club_leak(text: str, insight: InsightCandidate) -> str:
    club = _CLUBS[sum(map(ord, insight.insight_id)) % len(_CLUBS)]
    return f"{text.rstrip()} Straight out of the {club} playbook."


def build_tampered_text(
    original: str, insight: InsightCandidate, attack: str,
    player_names: dict[str, str], custom_text: str | None = None,
) -> str:
    if attack == "fake_number":
        return _attack_fake_number(original, insight)
    if attack == "wrong_player":
        return _attack_wrong_player(original, insight, player_names)
    if attack == "real_club_leak":
        return _attack_real_club_leak(original, insight)
    if attack == "custom":
        text = (custom_text or "").strip()
        if not text:
            raise TamperUnavailable("custom attack needs custom_text")
        if len(text) > CUSTOM_MAX_CHARS:
            raise TamperUnavailable(f"custom_text must be at most {CUSTOM_MAX_CHARS} characters")
        return text
    raise TamperUnavailable(f"unknown attack {attack!r}")


def _reasons(result: GroundingResult) -> dict:
    return {
        "numeric_ok": result.numeric_ok,
        "entity_ok": result.entity_ok,
        "vocabulary_ok": result.vocabulary_ok,
        "real_world_ok": result.real_world_ok,
        "unmatched_numbers": list(result.unmatched_numbers),
        "unmatched_entities": list(result.unmatched_entities),
        "real_world_leaks": list(result.real_world_leaks),
        "off_topic": not result.vocabulary_ok,
    }


def _verdict(result: GroundingResult) -> str:
    return "passed" if result.passed else "rejected"


def run_tamper(
    insight: InsightCandidate, original_text: str, attack: str,
    player_names: dict[str, str] | None = None, custom_text: str | None = None,
) -> dict:
    """Builds the tampered narration and runs it, the original, and (when
    rejected) the fallback through the production grounding check."""
    player_names = player_names or {}
    tampered = build_tampered_text(original_text, insight, attack, player_names, custom_text)

    original_result = check_grounding(original_text, insight, player_names)
    result = check_grounding(tampered, insight, player_names)

    corrected_text: str | None = None
    corrected_verdict: str | None = None
    corrected_reasons: dict | None = None
    if not result.passed:
        corrected_text = fallback_narration(insight)
        corrected = check_grounding(corrected_text, insight, player_names)
        corrected_verdict, corrected_reasons = _verdict(corrected), _reasons(corrected)

    return {
        "insight_id": insight.insight_id,
        "trigger_type": insight.trigger_type,
        "attack": attack,
        "checker": "eval.grounding_check.check_grounding",
        "original_text": original_text,
        "original_verdict": _verdict(original_result),
        "tampered_text": tampered,
        "verdict": _verdict(result),
        "reasons": _reasons(result),
        "corrected_text": corrected_text,
        "corrected_verdict": corrected_verdict,
        "corrected_reasons": corrected_reasons,
        "shipped": "tampered" if result.passed else "corrected",
    }


# --------------------------------------------------------------- headline

# Index-aligned with eval.robustness_suite._corrupted_variants' return list.
_VARIANT_LABELS = [
    ("fabricated_percentage", "Invented percentage spike"),
    ("wrong_player", "Real roster player, wrong moment"),
    ("fabricated_count", "Invented season count"),
    ("inflated_metric", "Headline metric inflated by 1000"),
    ("real_world_leak", "Real club / player name-drop"),
]


def _label(i: int) -> tuple[str, str]:
    return _VARIANT_LABELS[i] if i < len(_VARIANT_LABELS) else (f"variant_{i}", f"Corruption variant {i}")


def compute_headline() -> dict:
    start = time.perf_counter()
    canonical = robustness_suite.run()
    names = robustness_suite.PLAYER_NAMES

    by_attack: dict[str, dict] = {}
    reached_air = 0
    fallback_ok = 0
    for insight in robustness_suite._FIXTURES:
        fallback = fallback_narration(insight)
        fallback_passes = check_grounding(fallback, insight, names).passed
        fallback_ok += int(fallback_passes)
        for i, text in enumerate(robustness_suite._corrupted_variants(insight)):
            key, label = _label(i)
            row = by_attack.setdefault(key, {"attack": key, "label": label, "planted": 0, "caught": 0})
            row["planted"] += 1
            caught = not check_grounding(text, insight, names).passed
            row["caught"] += int(caught)
            # What would actually air: the corrupted text if it slipped
            # through, the fallback otherwise -- either way it must be grounded.
            if not caught or not fallback_passes:
                reached_air += 1

    caught_total = canonical.corruptions_caught
    flagged = caught_total + canonical.false_positives
    return {
        "planted": canonical.corruptions_total,
        "caught": caught_total,
        "reached_air": reached_air,
        "false_positives": canonical.false_positives,
        "clean_tested": canonical.legitimate_total,
        "precision": round(caught_total / flagged, 3) if flagged else 1.0,
        "recall": round(caught_total / canonical.corruptions_total, 3) if canonical.corruptions_total else 1.0,
        "fallbacks_verified": fallback_ok,
        "fixtures": len(robustness_suite._FIXTURES),
        "by_attack": list(by_attack.values()),
        "elapsed_ms": round((time.perf_counter() - start) * 1000, 2),
        "method": "eval.robustness_suite corruptions run through eval.grounding_check.check_grounding "
                  "(the live Narrator checker); no LLM involved",
    }


