"""Tests the WorkflowBuilder graph wiring itself -- message flow, fan-out,
and handoff logging -- using fake narrate/personalize functions so this
suite stays Azure-independent and free, like the rest of the offline core.
Live correctness of the real narrate_insight/personalize is covered by the
agents' own smoke tests (agents/narrator/agent.py, agents/concierge/agent.py)
and the grounding checks already run against them, not by this file.
"""
import asyncio

from agents.narrator.fallback import fallback_narration
from agents.orchestrator.workflow import run_match
from agents.shared.models import RenderPayload


def _metadata_dict():
    return {
        "type": "match_metadata", "match_id": "M-ORCH", "kickoff_utc": "2026-10-24T15:00:00Z",
        "venue": "Test Ground", "weather": "Clear", "home_team": "Home", "away_team": "Away",
        "home_formation": "4-3-3", "away_formation": "4-3-3", "home_lineup": [], "away_lineup": [],
        "referee_name": "R. Test",
    }


def _goal_dict():
    return {
        "type": "shot", "match_id": "M-ORCH", "period": 1, "minute": 10, "second": 0,
        "match_clock_ms": 600000, "team": "home", "team_name": "Home",
        "player_id": "home_9", "player_name": "Striker", "location": [110, 40],
        "possession_id": 1, "end_location": [120, 40], "outcome": "goal",
        "xg": 0.4, "shot_speed_kmh": 90.0,
    }


def _bad_dict():
    return {"type": "nonsense"}


async def _fake_narrate(insight, player_names=None):
    # Built on fallback_narration so it's grounded (and vocab-safe) by
    # construction for every trigger_type -- the live grounding check now
    # runs on every narrated insight, fakes included, so a fake that can't
    # pass it would get silently replaced and break assertions below.
    return f"FAKE NARRATION: {fallback_narration(insight)}"


async def _fake_personalize(insights, persona, lens=None, player_id=None, locale="en", player_names=None):
    return f"FAKE PERSONALIZED ({persona}): {fallback_narration(insights[0])}"


def test_full_pipeline_runs_end_to_end_with_fakes():
    result, log = asyncio.run(run_match(
        raw_events=[_metadata_dict(), _bad_dict(), _goal_dict()],
        match_id="M-ORCH", duration_ms=90 * 60000,
        narrate_fn=_fake_narrate, personalize_fn=_fake_personalize,
    ))

    outputs = result.get_outputs()
    render_payloads = [o for o in outputs if isinstance(o, RenderPayload)]
    personalized_texts = [o for o in outputs if isinstance(o, str)]

    # a single goal in a 90-minute window still produces more than just the
    # milestone insight (chaos/rhythm candidates can fire on sparse windows
    # too) -- the orchestration should carry *every one* of them through the
    # full fan-out, not assume there's exactly one.
    assert len(render_payloads) >= 1
    milestone_payloads = [p for p in render_payloads if p.graphic_type == "milestone"]
    assert len(milestone_payloads) == 1
    assert "FAKE NARRATION" in milestone_payloads[0].narrative_text

    assert len(personalized_texts) == len(render_payloads)
    assert all("FAKE PERSONALIZED (casual_fan)" in t for t in personalized_texts)

    entries = log.entries()
    assert entries[0].stage == "scout"
    assert entries[1].stage == "analyst0"
    # every insight fans out through narrator (which logs both a "narrator"
    # preview entry and a fuller "insight" entry for the Q&A agent) ->
    # {broadcaster, concierge}
    assert len(entries) == 2 + 4 * len(render_payloads)

    scout_entry = entries[0]
    assert scout_entry.summary["accepted"] == 2  # metadata + goal
    assert scout_entry.summary["rejected"] == 1  # the nonsense dict


def test_handoff_log_is_injectable_and_shared():
    from agents.shared.handoff_log import InMemoryHandoffLog

    log = InMemoryHandoffLog()
    asyncio.run(run_match(
        raw_events=[_metadata_dict(), _goal_dict()],
        match_id="M-ORCH-2", duration_ms=90 * 60000,
        handoff_log=log, narrate_fn=_fake_narrate, personalize_fn=_fake_personalize,
    ))
    entries = log.entries()
    assert len(entries) >= 5  # at least scout + analyst0 + one full narrator/broadcaster/concierge fan-out
    assert (len(entries) - 2) % 3 == 0
    assert all(e.match_id == "M-ORCH-2" for e in entries)


def test_inject_fault_is_caught_and_corrected_by_the_live_grounding_check():
    """The fault-injection demo hook corrupts the first narrated insight
    with a fabricated number; the live check inside NarratorExecutor must
    catch it and ship the deterministic fallback instead -- proving the
    grounding claim is actually enforced on the live path, not just
    checked offline in eval/test_grounding_check.py."""
    result, log = asyncio.run(run_match(
        raw_events=[_metadata_dict(), _goal_dict()],
        match_id="M-ORCH-FAULT", duration_ms=90 * 60000,
        narrate_fn=_fake_narrate, personalize_fn=_fake_personalize, inject_fault=True,
    ))

    render_payloads = [o for o in result.get_outputs() if isinstance(o, RenderPayload)]
    assert len(render_payloads) >= 1

    corrected = [p for p in render_payloads if not p.fact_checked]
    assert len(corrected) == 1, "exactly one insight should have been corrupted and caught"
    assert "48271" not in corrected[0].narrative_text, "the fabricated claim must not reach the output"

    uncorrected = [p for p in render_payloads if p.fact_checked]
    assert len(uncorrected) == len(render_payloads) - 1

    narrator_entries = [e for e in log.entries() if e.stage == "narrator"]
    assert sum(1 for e in narrator_entries if not e.summary["fact_checked"]) == 1
