"""Narrator's WorkflowBuilder node: stage (c), "explain." Wraps
agent_framework.agent.narrate_insight -- the LLM call -- and fans the
result out to both Broadcaster (stage d) and the live Concierge path
(stage e). narrate_fn is injectable so the orchestration graph itself can
be tested offline with a fake narrator, without live Azure calls.

The model's output is verified live against eval.grounding_check before it
ever leaves this stage -- this is what turns "we have a grounding checker"
from a claim backed only by an offline test suite into something the
pipeline actually enforces on every insight, every run. A failed check
falls back to a deterministic, zero-LLM sentence (agents.narrator.fallback)
rather than ever shipping an ungrounded claim downstream.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from agent_framework import Executor, WorkflowContext, handler

from agents.narrator.agent import narrate_insight
from agents.narrator.fallback import fallback_narration
from agents.shared.handoff_log import HandoffLog
from agents.shared.models import InsightCandidate, NarratedInsight
from eval.grounding_check import check_grounding

NarrateFn = Callable[[InsightCandidate, dict[str, str] | None], Awaitable[str]]
_CALL_TIMEOUT_S = 45.0
logger = logging.getLogger("pitch.narrator.executor")


class NarratorExecutor(Executor):
    def __init__(
        self, id: str, handoff_log: HandoffLog,
        narrate_fn: NarrateFn | None = None,
        player_names: dict[str, str] | None = None,
        inject_fault: bool = False,
    ):
        super().__init__(id=id)
        self._log = handoff_log
        self._narrate_fn = narrate_fn or narrate_insight
        self._player_names = player_names or {}
        # Demo/debug hook: deliberately corrupts the *first* insight's text
        # with a fabricated number so the live grounding check -- and the
        # fallback below -- visibly catches and corrects it on demand,
        # instead of asking judges to just take "we verify every claim" on
        # faith. Only the first insight is touched so the rest of the match
        # still demonstrates normal, unforced grounded output.
        self._inject_fault = inject_fault
        self._fault_injected = False

    @handler
    async def handle(self, insight: InsightCandidate, ctx: WorkflowContext[NarratedInsight]) -> None:
        try:
            text = await asyncio.wait_for(
                self._narrate_fn(insight, self._player_names), timeout=_CALL_TIMEOUT_S,
            )
        except Exception:
            logger.exception("narrate_fn failed or timed out for insight %s -- dropping it", insight.insight_id)
            return

        if self._inject_fault and not self._fault_injected:
            self._fault_injected = True
            text = f"{text} (a fabricated 48271% spike also occurred, unrelated to the above)"

        result = check_grounding(text, insight, self._player_names)
        fact_checked = result.passed
        if not fact_checked:
            logger.warning(
                "grounding check failed for insight %s (trigger=%s): unmatched_numbers=%s unmatched_entities=%s -- using fallback",
                insight.insight_id, insight.trigger_type, result.unmatched_numbers, result.unmatched_entities,
            )
            text = fallback_narration(insight)

        self._log.record("narrator", insight.match_id, {
            "insight_id": insight.insight_id, "trigger_type": insight.trigger_type, "text_preview": text[:80],
            "fact_checked": fact_checked,
        })
        await ctx.send_message(NarratedInsight(insight=insight, narrative_text=text, fact_checked=fact_checked))
