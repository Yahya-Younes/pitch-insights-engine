"""Scout's WorkflowBuilder node: wraps the pure parse_events() ingest logic
(ingest.py) as the orchestrator's stage-(a) entrypoint, recording what it
accepted/rejected to the shared handoff log.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from agent_framework import Executor, WorkflowContext, handler

from agents.scout.ingest import parse_events
from agents.shared.handoff_log import HandoffLog
from datagen.schema import AnyEvent


@dataclass
class RawMatchFeed:
    """The orchestrator's entrypoint message: raw, as-if-off-Event-Hubs JSON
    event payloads for one match."""

    match_id: str
    duration_ms: int
    raw_events: list[dict] = field(default_factory=list)


@dataclass
class ValidatedMatchEvents:
    match_id: str
    duration_ms: int
    events: list[AnyEvent]
    rejected_count: int


class ScoutExecutor(Executor):
    def __init__(self, id: str, handoff_log: HandoffLog):
        super().__init__(id=id)
        self._log = handoff_log

    @handler
    async def handle(self, feed: RawMatchFeed, ctx: WorkflowContext[ValidatedMatchEvents]) -> None:
        started = time.perf_counter()
        events, rejected = parse_events(feed.raw_events)
        self._log.record("scout", feed.match_id, {
            "accepted": len(events), "rejected": rejected,
            # Additive trace keys for /matches/{id}/agent-trace: real wall time, deterministic path.
            "duration_ms": round((time.perf_counter() - started) * 1000, 2), "path": "rules",
        })
        await ctx.send_message(ValidatedMatchEvents(
            match_id=feed.match_id, duration_ms=feed.duration_ms, events=events, rejected_count=rejected,
        ))
