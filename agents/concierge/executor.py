"""Concierge's WorkflowBuilder node: stage (e), "personalize" -- the
live/continuous variant. Personalizes each insight individually as it comes
off the Narrator, for one fixed persona per workflow instance.

This is deliberately not the only way Concierge is invoked: the same
agents.concierge.agent.personalize() can separately be called on-demand
with a whole match's insight list (e.g. from an API handler, per viewer
request) for a full-match recap in whatever persona that viewer chose --
that's a different granularity (one call per viewer session, not one call
per insight) and doesn't belong wired into this per-tick graph. This
executor's fixed-persona, per-insight mode exists to prove the live
orchestration wiring end-to-end.

Like the Narrator, every personalized recap is verified live against
eval.grounding_check before it ships -- a persona's phrasing can still
invent a number or a name, so the same safety net applies here, falling
back to the Narrator's original (already-verified) text if the persona's
rewrite can't be confirmed grounded.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from agent_framework import Executor, WorkflowContext, handler

from agents.concierge.agent import personalize
from agents.concierge.lens import CoachLens
from agents.concierge.persona_filter import Persona
from agents.shared.handoff_log import HandoffLog
from agents.shared.models import InsightCandidate, NarratedInsight
from eval.grounding_check import check_grounding_multi

PersonalizeFn = Callable[..., Awaitable[str]]
_CALL_TIMEOUT_S = 45.0
logger = logging.getLogger("pitch.concierge.executor")


class ConciergeExecutor(Executor):
    def __init__(
        self, id: str, handoff_log: HandoffLog,
        persona: Persona = "casual_fan",
        lens: CoachLens | None = None,
        personalize_fn: PersonalizeFn | None = None,
        player_names: dict[str, str] | None = None,
    ):
        super().__init__(id=id)
        self._log = handoff_log
        self._persona = persona
        self._lens = lens
        self._personalize_fn = personalize_fn or personalize
        self._player_names = player_names or {}

    @handler
    async def handle(self, narrated: NarratedInsight, ctx: WorkflowContext[Any, str]) -> None:
        insight: InsightCandidate = narrated.insight
        try:
            text = await asyncio.wait_for(
                self._personalize_fn([insight], self._persona, lens=self._lens, player_names=self._player_names),
                timeout=_CALL_TIMEOUT_S,
            )
        except Exception:
            logger.exception("personalize_fn failed or timed out for insight %s -- dropping it", insight.insight_id)
            return

        result = check_grounding_multi(text, [insight], self._player_names)
        fact_checked = result.passed
        if not fact_checked:
            logger.warning(
                "grounding check failed for concierge/%s on insight %s: unmatched_numbers=%s unmatched_entities=%s -- using narrator's text",
                self._persona, insight.insight_id, result.unmatched_numbers, result.unmatched_entities,
            )
            text = narrated.narrative_text

        self._log.record("concierge", insight.match_id, {
            "persona": self._persona, "insight_id": insight.insight_id, "text_preview": text[:80],
            "fact_checked": fact_checked,
        })
        await ctx.yield_output(text)
