"""Coach Lens: a structured, non-freeform personalization axis for the
Concierge agent. A lens never injects raw text into the LLM prompt as-is —
it's validated data that reweights which InsightCandidates surface and how
they're framed, with the Narrator's grounding discipline (see
agents/narrator/prompts/narrator_system.md) still strictly enforced. This is
what keeps "view the match through Guardiola's philosophy" explainable rather
than an unconstrained roleplay prompt.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

TriggerType = Literal[
    "pressure_spike", "chaos_shift", "rhythm_change", "xt_surge",
    "milestone", "referee_decision", "tendency_match", "tendency_break",
]

LENSES_DIR = Path(__file__).parent / "lenses"


class NarrativeWeights(BaseModel):
    possession_value_emphasis: float = Field(ge=0.0, le=1.0)
    pressing_trigger_emphasis: float = Field(ge=0.0, le=1.0)
    defensive_solidity_emphasis: float = Field(ge=0.0, le=1.0)
    individual_duel_emphasis: float = Field(ge=0.0, le=1.0)
    risk_tolerance: float = Field(ge=0.0, le=1.0)


class CoachLens(BaseModel):
    lens_id: str
    attributed_style_of: str
    status: Literal["preset", "community_pending", "community_published"]
    tactical_principles: list[str]
    narrative_weights: NarrativeWeights
    insight_priority_order: list[TriggerType]
    tone_descriptors: list[str]
    signature_phrases: list[str]
    sourcing_note: str
    moderation_status: Literal["approved", "pending", "rejected"]


def load_lens(path: Path) -> CoachLens:
    return CoachLens.model_validate(json.loads(path.read_text(encoding="utf-8")))


def load_preset_lenses(directory: Path = LENSES_DIR) -> dict[str, CoachLens]:
    return {lens.lens_id: lens for lens in (load_lens(p) for p in sorted(directory.glob("*.json")))}


def rank_insights_for_lens(insights, lens: CoachLens):
    """Reorders insight candidates by the lens's insight_priority_order, then
    by magnitude within each trigger type. Never drops or rewrites facts —
    only changes what surfaces first."""
    order_index = {t: i for i, t in enumerate(lens.insight_priority_order)}
    return sorted(
        insights,
        key=lambda c: (order_index.get(c.trigger_type, len(order_index)), -abs(c.metric_value)),
    )
