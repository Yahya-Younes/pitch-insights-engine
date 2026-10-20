"""Narrator's WorkflowBuilder node: stage (c), "explain." Wraps
agent_framework.agent.narrate_insight -- the LLM call -- and fans the
result out to both Broadcaster (stage d) and the live Concierge path
(stage e). narrate_fn is injectable so the orchestration graph itself can
be tested offline with a fake narrator, without live Azure calls.
"""
from __future__ import annotations

from typing import Awaitable, Callable

from agent_framework import Executor, WorkflowContext, handler

from agents.narrator.agent import narrate_insight
from agents.shared.handoff_log import HandoffLog
from agents.shared.models import InsightCandidate, NarratedInsight

NarrateFn = Callable[[InsightCandidate, dict[str, str] | None], Awaitable[str]]


class NarratorExecutor(Executor):
    def __init__(
        self, id: str, handoff_log: HandoffLog,
        narrate_fn: NarrateFn | None = None,
        player_names: dict[str, str] | None = None,
    ):
        super().__init__(id=id)
        self._log = handoff_log
        self._narrate_fn = narrate_fn or narrate_insight
        self._player_names = player_names or {}

    @handler
    async def handle(self, insight: InsightCandidate, ctx: WorkflowContext[NarratedInsight]) -> None:
        text = await self._narrate_fn(insight, self._player_names)
        self._log.record("narrator", insight.match_id, {
            "insight_id": insight.insight_id, "trigger_type": insight.trigger_type, "text_preview": text[:80],
        })
        await ctx.send_message(NarratedInsight(insight=insight, narrative_text=text))
