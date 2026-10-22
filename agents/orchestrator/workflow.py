"""The orchestrator: wires Scout -> Analyst-0 -> Narrator -> fan-out to
{Broadcaster, Concierge} as a Microsoft Agent Framework WorkflowBuilder
graph, per the pipeline's five mandated stages. A shared HandoffLog records
every stage's input/output summary, giving a concrete, inspectable
orchestration trace.
"""
from __future__ import annotations

from agent_framework import Workflow, WorkflowBuilder

from agents.analyst0.executor import Analyst0Executor
from agents.broadcaster.executor import BroadcasterExecutor
from agents.concierge.executor import ConciergeExecutor
from agents.concierge.lens import CoachLens
from agents.concierge.persona_filter import Persona
from agents.narrator.executor import NarrateFn, NarratorExecutor
from agents.concierge.executor import PersonalizeFn
from agents.scout.executor import RawMatchFeed, ScoutExecutor
from agents.shared.handoff_log import HandoffLog, InMemoryHandoffLog


def build_workflow(
    handoff_log: HandoffLog | None = None,
    persona: Persona = "casual_fan",
    lens: CoachLens | None = None,
    player_names: dict[str, str] | None = None,
    narrate_fn: NarrateFn | None = None,
    personalize_fn: PersonalizeFn | None = None,
    inject_fault: bool = False,
) -> tuple[Workflow, HandoffLog]:
    """Builds the 5-stage workflow graph. Pass narrate_fn/personalize_fn to
    substitute fakes for offline testing -- by default both use the real,
    live Azure AI Foundry-backed agents. inject_fault corrupts the first
    insight's narrated text so the live grounding check visibly catches and
    corrects it -- a demo/debug hook, see NarratorExecutor."""
    log = handoff_log if handoff_log is not None else InMemoryHandoffLog()

    scout = ScoutExecutor("scout", log)
    analyst0 = Analyst0Executor("analyst0", log)
    narrator = NarratorExecutor(
        "narrator", log, narrate_fn=narrate_fn, player_names=player_names, inject_fault=inject_fault,
    )
    broadcaster = BroadcasterExecutor("broadcaster", log)
    concierge = ConciergeExecutor(
        "concierge", log, persona=persona, lens=lens,
        personalize_fn=personalize_fn, player_names=player_names,
    )

    workflow = (
        WorkflowBuilder(start_executor=scout)
        .add_edge(scout, analyst0)
        .add_edge(analyst0, narrator)
        .add_fan_out_edges(narrator, [broadcaster, concierge])
        .build()
    )
    return workflow, log


async def run_match(
    raw_events: list[dict], match_id: str, duration_ms: int, **kwargs,
):
    """Convenience entrypoint: builds the workflow and runs it end-to-end
    against one match's raw (as-if-off-Event-Hubs) event payloads. Returns
    (WorkflowRunResult, HandoffLog)."""
    workflow, log = build_workflow(**kwargs)
    feed = RawMatchFeed(match_id=match_id, duration_ms=duration_ms, raw_events=raw_events)
    result = await workflow.run(feed)
    return result, log
