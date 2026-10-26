"""Broadcaster's WorkflowBuilder node: stage (d), "render." Deterministic --
wraps build_render_payload() and yields the result as a workflow output
(this is a terminal node; nothing consumes its output within the graph
itself, a frontend/Web PubSub subscriber would in the deployed system).
"""
from __future__ import annotations

import time
from typing import Any

from agent_framework import Executor, WorkflowContext, handler

from agents.broadcaster.render import build_render_payload
from agents.shared.handoff_log import HandoffLog
from agents.shared.models import NarratedInsight, RenderPayload


class BroadcasterExecutor(Executor):
    def __init__(self, id: str, handoff_log: HandoffLog):
        super().__init__(id=id)
        self._log = handoff_log

    @handler
    async def handle(self, narrated: NarratedInsight, ctx: WorkflowContext[Any, RenderPayload]) -> None:
        started = time.perf_counter()
        payload = build_render_payload(narrated.insight, narrated.narrative_text, fact_checked=narrated.fact_checked)
        self._log.record("broadcaster", narrated.insight.match_id, {
            "render_id": payload.render_id, "graphic_type": payload.graphic_type,
            "template": payload.display.template, "fact_checked": payload.fact_checked,
            # Additive trace keys for /matches/{id}/agent-trace.
            "duration_ms": round((time.perf_counter() - started) * 1000, 2), "path": "rules",
        })
        await ctx.yield_output(payload)
