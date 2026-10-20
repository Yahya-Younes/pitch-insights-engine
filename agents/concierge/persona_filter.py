"""Deterministic, LLM-free persona filtering for the Concierge agent
(stage e: personalize). Filtering and ordering happen entirely here, in
plain Python, before anything reaches the LLM -- the model only ever
phrases insights this module has already decided are in scope. This is
strictly more defensible than asking an LLM to roleplay "pretend you're
writing for a casual fan."
"""
from __future__ import annotations

from typing import Literal

from agents.concierge.lens import CoachLens, rank_insights_for_lens
from agents.shared.models import InsightCandidate

Persona = Literal["analyst", "casual_fan", "player_tracker"]

CASUAL_FAN_TOP_N = 4


def _importance(candidate: InsightCandidate) -> float:
    if candidate.trigger_type == "milestone":
        return 1_000_000.0  # a goal always outranks any delta_pct-based insight
    if candidate.delta_pct is not None:
        return abs(candidate.delta_pct)
    return abs(candidate.metric_value)


def _ordered(insights: list[InsightCandidate], lens: CoachLens | None) -> list[InsightCandidate]:
    if lens is not None:
        return rank_insights_for_lens(insights, lens)
    return sorted(insights, key=lambda c: c.window_start_min)


def filter_for_persona(
    insights: list[InsightCandidate],
    persona: Persona,
    lens: CoachLens | None = None,
    player_id: str | None = None,
) -> list[InsightCandidate]:
    """Returns the subset (and order) of insights a given persona's view
    should ever see. This is the only place that decision gets made."""
    if persona == "player_tracker":
        if not player_id:
            raise ValueError("player_tracker persona requires player_id")
        scoped = [c for c in insights if player_id in c.related_players]
        return _ordered(scoped, lens)

    ordered = _ordered(insights, lens)
    if persona == "casual_fan":
        if lens is not None:
            # the lens has already prioritized what matters most to this
            # tactical voice -- just take its top N, don't re-sort by
            # raw magnitude and undo that framing.
            return ordered[:CASUAL_FAN_TOP_N]
        return sorted(ordered, key=_importance, reverse=True)[:CASUAL_FAN_TOP_N]

    return ordered  # analyst: everything, in scope order
