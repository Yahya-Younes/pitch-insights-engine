"""Analyst-0's WorkflowBuilder node: stage (b), "interpret." Wraps the
existing deterministic generate_insight_candidates() and fans out one
message per InsightCandidate -- the Narrator downstream processes insights
one at a time, same as a live feed would.

Player tendency profiles are inferred from the match's own observed events
(never the generator's hidden ground truth), so a tendency_break means "this
player just did something unlike their own habit in this match".
"""
from __future__ import annotations

import time
from collections.abc import Callable

from agent_framework import Executor, WorkflowContext, handler

from agents.analyst0.insight_generator import generate_insight_candidates
from agents.analyst0.tendency_model import InferredTendencyProfile, infer_all_profiles
from agents.scout.executor import ValidatedMatchEvents
from agents.shared.handoff_log import HandoffLog
from agents.shared.models import InsightCandidate
from datagen.schema import AnyEvent

ProfileInferrer = Callable[[list[AnyEvent], list[str]], dict[str, InferredTendencyProfile]]


class Analyst0Executor(Executor):
    def __init__(self, id: str, handoff_log: HandoffLog, infer_profiles: ProfileInferrer = infer_all_profiles):
        super().__init__(id=id)
        self._log = handoff_log
        self._infer_profiles = infer_profiles

    @handler
    async def handle(self, batch: ValidatedMatchEvents, ctx: WorkflowContext[InsightCandidate]) -> None:
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
        for candidate in candidates:
            await ctx.send_message(candidate)
