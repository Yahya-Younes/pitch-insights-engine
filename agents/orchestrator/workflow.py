"""The orchestrator: wires Scout -> Analyst-0 -> Narrator -> fan-out to
{Broadcaster, Concierge} as a Microsoft Agent Framework WorkflowBuilder
graph, per the pipeline's five mandated stages. A shared HandoffLog records
every stage's input/output summary, giving a concrete, inspectable
orchestration trace.
"""
from __future__ import annotations

from agent_framework import CheckpointStorage, Workflow, WorkflowBuilder

from agents.analyst0.executor import Analyst0Executor
from agents.broadcaster.executor import BroadcasterExecutor
from agents.concierge.executor import ConciergeExecutor, PersonalizeFn
from agents.concierge.lens import CoachLens
from agents.concierge.persona_filter import Persona
from agents.narrator.executor import NarrateFn, NarratorExecutor
from agents.scout.executor import RawMatchFeed, ScoutExecutor
from agents.shared.handoff_log import HandoffLog, InMemoryHandoffLog

# FileCheckpointStorage pickles workflow state and refuses to deserialize
# any type not explicitly allow-listed (a deliberate safety feature, not a
# bug) -- every custom type that can appear inside a workflow message or
# executor state needs to be listed here, or checkpoint saves silently fail
# and get_last_checkpoint_id() never has anything real to return. Kept as a
# single source of truth so service/main.py's real FileCheckpointStorage
# and any test using one stay in sync with what the workflow actually
# carries, rather than two hand-maintained copies drifting apart.
CHECKPOINT_ALLOWED_TYPES: list[str] = [
    "agents.scout.executor:RawMatchFeed",
    "agents.scout.executor:ValidatedMatchEvents",
    "agents.shared.models:InsightCandidate",
    "agents.shared.models:NarratedInsight",
    "agents.shared.models:RenderDisplay",
    "agents.shared.models:RenderPayload",
    "datagen.schema:MatchMetadataEvent",
    "datagen.schema:RefereePositionEvent",
    "datagen.schema:RefereeDecisionEvent",
    "datagen.schema:PassEvent",
    "datagen.schema:ShotEvent",
    "datagen.schema:CarryEvent",
    "datagen.schema:DribbleEvent",
    "datagen.schema:TackleEvent",
    "datagen.schema:InterceptionEvent",
    "datagen.schema:DuelEvent",
    "datagen.schema:PressureEvent",
    "datagen.schema:PossessionChangeEvent",
    "datagen.schema:FoulEvent",
    "datagen.schema:CardEvent",
]


class WorkflowCrashed(RuntimeError):
    """Raised by run_match() when the workflow itself raises mid-run (e.g.
    the inject_crash demo hook). Carries the latest checkpoint id (if
    checkpointing was enabled for this run) so the caller can offer to
    resume instead of just losing the match."""

    def __init__(self, checkpoint_id: str | None, original: BaseException):
        super().__init__(f"workflow crashed (checkpoint_id={checkpoint_id!r}): {original}")
        self.checkpoint_id = checkpoint_id
        self.original = original


def build_workflow(
    handoff_log: HandoffLog | None = None,
    persona: Persona = "casual_fan",
    lens: CoachLens | None = None,
    player_names: dict[str, str] | None = None,
    narrate_fn: NarrateFn | None = None,
    personalize_fn: PersonalizeFn | None = None,
    inject_fault: bool = False,
    locale: str = "en",
    checkpoint_storage: CheckpointStorage | None = None,
    inject_crash: bool = False,
) -> tuple[Workflow, HandoffLog]:
    """Builds the 5-stage workflow graph. Pass narrate_fn/personalize_fn to
    substitute fakes for offline testing -- by default both use the real,
    live Azure AI Foundry-backed agents. inject_fault corrupts the first
    insight's narrated text so the live grounding check visibly catches and
    corrects it; inject_crash instead makes the Narrator raise outright on
    the first insight it sees, so (with checkpoint_storage set) a resumed
    run can demonstrate picking back up without re-running Scout/Analyst-0
    or re-narrating already-completed insights -- both are demo/debug
    hooks, see NarratorExecutor."""
    log = handoff_log if handoff_log is not None else InMemoryHandoffLog()

    scout = ScoutExecutor("scout", log)
    analyst0 = Analyst0Executor("analyst0", log)
    narrator = NarratorExecutor(
        "narrator", log, narrate_fn=narrate_fn, player_names=player_names,
        inject_fault=inject_fault, inject_crash=inject_crash,
    )
    broadcaster = BroadcasterExecutor("broadcaster", log)
    concierge = ConciergeExecutor(
        "concierge", log, persona=persona, lens=lens,
        personalize_fn=personalize_fn, player_names=player_names, locale=locale,
    )

    workflow = (
        WorkflowBuilder(start_executor=scout, checkpoint_storage=checkpoint_storage)
        .add_edge(scout, analyst0)
        .add_edge(analyst0, narrator)
        .add_fan_out_edges(narrator, [broadcaster, concierge])
        .build()
    )
    return workflow, log


async def run_match(
    raw_events: list[dict] | None, match_id: str, duration_ms: int,
    checkpoint_id: str | None = None, checkpoint_storage: CheckpointStorage | None = None,
    **kwargs,
):
    """Convenience entrypoint: builds the workflow and runs it end-to-end
    against one match's raw (as-if-off-Event-Hubs) event payloads. Returns
    (WorkflowRunResult, HandoffLog).

    Pass checkpoint_id (with the same checkpoint_storage the crashed run
    used) to resume a previously interrupted run instead of starting fresh
    -- the restored state already contains the seeded input, so raw_events
    is ignored in that case. If the run raises, wraps the exception in
    WorkflowCrashed carrying the latest checkpoint id (when checkpointing
    was enabled) rather than losing that id along with the exception.
    """
    workflow, log = build_workflow(checkpoint_storage=checkpoint_storage, **kwargs)
    try:
        if checkpoint_id is not None:
            result = await workflow.run(checkpoint_id=checkpoint_id, checkpoint_storage=checkpoint_storage)
        else:
            feed = RawMatchFeed(match_id=match_id, duration_ms=duration_ms, raw_events=raw_events or [])
            result = await workflow.run(feed)
    except Exception as exc:
        last_checkpoint_id = workflow.get_last_checkpoint_id() if checkpoint_storage is not None else None
        raise WorkflowCrashed(last_checkpoint_id, exc) from exc
    return result, log
