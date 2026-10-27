"""Analyst-0's WorkflowBuilder node: stage (b), "interpret." Wraps the
existing deterministic generate_insight_candidates() and hands the
InsightCandidates to the Narrator one per superstep, like a live feed.

Why one per superstep: Agent Framework runs the graph in Pregel supersteps,
and a stage only receives what the previous stage sent once that whole
superstep is over. Sending every candidate at once made the Narrator write
all of them back to back (~4.5 s each) before the Broadcaster saw the
first, so nothing reached the screen for ~40 s. Releasing them one at a
time through a self-loop pipelines the stages instead: while the Narrator
writes moment n, the Broadcaster and Concierge are already shipping moment
n-1. Same LLM calls, same order; the first insight is on air after one
narration. The not-yet-released candidates are executor state, saved in
every checkpoint, so a resumed run picks up exactly where it stopped.

Player tendency profiles are inferred from the match's own observed events
(never the generator's hidden ground truth), so a tendency_break means "this
player just did something unlike their own habit in this match".
"""
from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from agent_framework import Executor, WorkflowContext, handler

from agents.analyst0.insight_generator import generate_insight_candidates
from agents.analyst0.tendency_model import InferredTendencyProfile, infer_all_profiles
from agents.scout.executor import ValidatedMatchEvents
from agents.shared.handoff_log import HandoffLog
from agents.shared.models import InsightCandidate
from datagen.schema import AnyEvent

ProfileInferrer = Callable[[list[AnyEvent], list[str]], dict[str, InferredTendencyProfile]]


@dataclass
class ReleaseNextInsight:
    """Analyst-0 -> itself (self-loop edge): release the next queued
    candidate in the following superstep."""
    match_id: str


class Analyst0Executor(Executor):
    def __init__(self, id: str, handoff_log: HandoffLog, infer_profiles: ProfileInferrer = infer_all_profiles):
        super().__init__(id=id)
        self._log = handoff_log
        self._infer_profiles = infer_profiles
        self._pending: list[InsightCandidate] = []

    @handler
    async def handle(
        self, batch: ValidatedMatchEvents, ctx: WorkflowContext[InsightCandidate | ReleaseNextInsight],
    ) -> None:
        started = time.perf_counter()
        player_ids = sorted({pid for e in batch.events if (pid := getattr(e, "player_id", None))})
        profiles = self._infer_profiles(batch.events, player_ids)
        candidates = generate_insight_candidates(
            batch.events, batch.match_id, batch.duration_ms, tendency_profiles=profiles,
        )
        self._log.record("analyst0", batch.match_id, {
            "events_processed": len(batch.events), "insight_count": len(candidates),
            "tendency_profiles": len(profiles),
            # Additive trace keys for /matches/{id}/agent-trace.
            "duration_ms": round((time.perf_counter() - started) * 1000, 2), "path": "rules",
        })
        self._pending.extend(candidates)
        await self._release_one(batch.match_id, ctx)

    @handler
    async def release_next(
        self, signal: ReleaseNextInsight, ctx: WorkflowContext[InsightCandidate | ReleaseNextInsight],
    ) -> None:
        await self._release_one(signal.match_id, ctx)

    async def _release_one(
        self, match_id: str, ctx: WorkflowContext[InsightCandidate | ReleaseNextInsight],
    ) -> None:
        if not self._pending:
            return
        await ctx.send_message(self._pending.pop(0))
        if self._pending:
            await ctx.send_message(ReleaseNextInsight(match_id=match_id))

    async def on_checkpoint_save(self) -> dict[str, Any]:
        return {"pending": [c.model_dump(mode="json") for c in self._pending]}

    async def on_checkpoint_restore(self, state: dict[str, Any]) -> None:
        self._pending = [InsightCandidate.model_validate(c) for c in state.get("pending", [])]
