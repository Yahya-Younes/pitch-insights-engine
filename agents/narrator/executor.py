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
import time
from collections.abc import Awaitable, Callable

from agent_framework import Executor, WorkflowContext, handler

from agents.narrator.agent import narrate_insight
from agents.narrator.fallback import fallback_narration
from agents.shared.handoff_log import HandoffLog
from agents.shared.models import InsightCandidate, NarratedInsight
from agents.shared.tracing import current_trace_id
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
        inject_crash: bool = False,
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
        # A second, separate demo/debug hook: deliberately raises on the
        # *first* insight instead of corrupting its text, so a resumed run
        # (agents.orchestrator.workflow.run_match's checkpoint_id path) can
        # demonstrate picking back up without re-running Scout/Analyst-0 or
        # re-narrating insights already committed before the crash.
        self._inject_crash = inject_crash
        self._crash_injected = False

    async def _narrate_with_retry(
        self, insight: InsightCandidate, attempts: list[int] | None = None,
    ) -> str | None:
        """Tries narrate_fn twice before giving up -- a transient Foundry
        throttle/timeout shouldn't cost an insight its narration when a
        second attempt would likely succeed. Returns None only after both
        attempts fail, at which point the caller falls back to a
        deterministic template rather than dropping the insight."""
        for attempt in range(2):
            if attempts is not None:
                attempts.append(attempt + 1)
            try:
                return await asyncio.wait_for(
                    self._narrate_fn(insight, self._player_names), timeout=_CALL_TIMEOUT_S,
                )
            except Exception:
                logger.exception(
                    "narrate_fn failed or timed out for insight %s (attempt %d/2)",
                    insight.insight_id, attempt + 1,
                )
        return None

    @handler
    async def handle(self, insight: InsightCandidate, ctx: WorkflowContext[NarratedInsight]) -> None:
        if self._inject_crash and not self._crash_injected:
            self._crash_injected = True
            raise RuntimeError(f"Demo: simulated crash while narrating insight {insight.insight_id}")

        started = time.perf_counter()
        attempts: list[int] = []
        grounding_failed = False
        text = await self._narrate_with_retry(insight, attempts)
        if text is None:
            # Both attempts failed -- previously this just dropped the
            # insight entirely (no downstream message, no log entry). Now it
            # still ships, via the same zero-LLM fallback the grounding
            # check itself falls back to, and the failure is recorded rather
            # than silently disappearing from the trace.
            self._log.record("narrator_failed", insight.match_id, {
                "insight_id": insight.insight_id, "trigger_type": insight.trigger_type,
            })
            text = fallback_narration(insight)
            fact_checked = False
        else:
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
                grounding_failed = True

        self._log.record("narrator", insight.match_id, {
            "insight_id": insight.insight_id, "trigger_type": insight.trigger_type, "text_preview": text[:80],
            "fact_checked": fact_checked, "trace_id": current_trace_id(),
            # Additive trace keys for /matches/{id}/agent-trace: real wall time
            # (LLM call(s) + grounding check), which text actually shipped, how
            # many LLM calls were made, and whether the verifier rejected one.
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "path": "llm" if fact_checked else "fallback",
            "llm_attempts": len(attempts), "grounding_failed": grounding_failed,
        })
        # A second, fuller record alongside the one above -- the "narrator"
        # entry stays a short preview for the handoff trace UI, but the "Ask
        # the match" Q&A agent needs the complete InsightCandidate and the
        # untruncated narrative text to answer questions grounded in real
        # match evidence, so it gets its own entry rather than overloading
        # the existing one's shape.
        self._log.record("insight", insight.match_id, {**insight.model_dump(), "narrative_text": text, "fact_checked": fact_checked})
        await ctx.send_message(NarratedInsight(insight=insight, narrative_text=text, fact_checked=fact_checked))
