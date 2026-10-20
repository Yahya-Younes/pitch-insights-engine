"""Analyst-0's WorkflowBuilder node: stage (b), "interpret." Wraps the
existing deterministic generate_insight_candidates() and fans out one
message per InsightCandidate -- the Narrator downstream processes insights
one at a time, same as a live feed would.
"""
from __future__ import annotations

from agent_framework import Executor, WorkflowContext, handler

from agents.analyst0.insight_generator import generate_insight_candidates
from agents.scout.executor import ValidatedMatchEvents
from agents.shared.handoff_log import HandoffLog
from agents.shared.models import InsightCandidate


class Analyst0Executor(Executor):
    def __init__(self, id: str, handoff_log: HandoffLog):
        super().__init__(id=id)
        self._log = handoff_log

    @handler
    async def handle(self, batch: ValidatedMatchEvents, ctx: WorkflowContext[InsightCandidate]) -> None:
        candidates = generate_insight_candidates(batch.events, batch.match_id, batch.duration_ms)
        self._log.record("analyst0", batch.match_id, {
            "events_processed": len(batch.events), "insight_count": len(candidates),
        })
        for candidate in candidates:
            await ctx.send_message(candidate)
