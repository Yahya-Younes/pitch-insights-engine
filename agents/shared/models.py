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
