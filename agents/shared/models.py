"""Shared contract types passed between agents. An InsightCandidate is the
only thing the Narrator agent is allowed to look at when writing an
explanation — if a fact isn't in here, it doesn't exist as far as the
Narrator is concerned. This is what keeps stage (c) "explain why it matters"
grounded instead of hallucinated.
"""
from __future__ import annotations

from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

TriggerType = Literal[
    "pressure_spike", "chaos_shift", "rhythm_change", "xt_surge",
    "milestone", "referee_decision", "tendency_match", "tendency_break",
]


class InsightCandidate(BaseModel):
    insight_id: str = Field(default_factory=lambda: uuid4().hex)
    match_id: str
    window_start_min: float
    window_end_min: float
    trigger_type: TriggerType
    metric_name: str
    metric_value: float
    baseline_value: float | None = None
    delta_pct: float | None = None
    related_players: list[str] = Field(default_factory=list)
    related_events: list[str] = Field(default_factory=list)
    window_summary: dict[str, float | int | str | bool] = Field(default_factory=dict)


class NarratedInsight(BaseModel):
    """Stage (c) output: an InsightCandidate paired with the Narrator's
    grounded explanation of it. This is what fans out to both Broadcaster
    (stage d) and the live/per-insight Concierge path (stage e)."""

    insight: InsightCandidate
    narrative_text: str
    fact_checked: bool = True
    """False when the model's own text failed the live grounding check and
    was replaced by agents.narrator.fallback.fallback_narration -- carried
    through to RenderPayload so the UI can show it was auto-corrected."""


class RenderDisplay(BaseModel):
    template: str
    duration_ms: int
    priority: int


class RenderPayload(BaseModel):
    """Stage (d) output: a timecoded, broadcast-graphics-style overlay
    payload (modeled on Chyron PRIME / Vizrt-style external data feeds),
    deterministically built from a NarratedInsight -- no LLM involved."""

    render_id: str = Field(default_factory=lambda: uuid4().hex)
    match_id: str
    game_clock: str
    graphic_type: str
    narrative_text: str
    display: RenderDisplay
    data_points: list[dict[str, float | int | str | bool]] = Field(default_factory=list)
    linked_players: list[str] = Field(default_factory=list)
    source_insight_id: str
    fact_checked: bool = True
    audio_url: str | None = None
    """Path of the mp3 of narrative_text ("/audio/<clip_id>", relative to the
    API), attached at publish time (not here -- this stays a pure,
    deterministic build from a NarratedInsight). The audio is synthesized
    when first fetched, so it never rides in the Web PubSub message. None
    when speech synthesis isn't configured -- the card still renders,
    just silently."""


class WhatIfResult(BaseModel):
    """Output of agents.analyst0.whatif.score_counterfactual -- a real
    recomputation of the same deterministic Analyst-0 function that
    produced the insight's actual metric, run again against a hypothetical
    alternate input. No LLM involved in the numbers themselves; explanation
    is a deterministic template built from them."""

    actual_value: float
    hypothetical_value: float
    delta: float
    explanation: str
