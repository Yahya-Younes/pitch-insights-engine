"""Tests the WorkflowBuilder graph wiring itself -- message flow, fan-out,
and handoff logging -- using fake narrate/personalize functions so this
suite stays Azure-independent and free, like the rest of the offline core.
Live correctness of the real narrate_insight/personalize is covered by the
agents' own smoke tests (agents/narrator/agent.py, agents/concierge/agent.py)
and the grounding checks already run against them, not by this file.
"""
import asyncio

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
    return f"FAKE NARRATION: {insight.trigger_type}"


async def _fake_personalize(insights, persona, lens=None, player_id=None, locale="en", player_names=None):
    return f"FAKE PERSONALIZED ({persona}): {len(insights)} insight(s)"


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
    # every insight fans out through narrator -> {broadcaster, concierge}
    assert len(entries) == 2 + 3 * len(render_payloads)

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
