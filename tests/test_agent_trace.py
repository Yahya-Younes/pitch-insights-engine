"""Tests for the "Agent team, live" trace and the published overlay contract.

Three layers, all offline and deterministic:
  1. the executors themselves record real timing/path keys into the shared
     handoff log (run through the real WorkflowBuilder graph with fakes);
  2. agents.orchestrator.agent_trace.build_agent_trace -- a pure rollup over
     handoff entries;
  3. service/routers/agent_trace.py's endpoints, mounted on a bare FastAPI
     app so this suite doesn't depend on main.py wiring the router in.
"""
from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.narrator.fallback import fallback_narration
from agents.orchestrator.agent_trace import PIPELINE_STAGES, build_agent_trace
from agents.orchestrator.workflow import run_match
from agents.shared.handoff_log import HandoffEntry, InMemoryHandoffLog
from agents.shared.models import InsightCandidate, RenderPayload

MATCH = "M-TRACE"


# -- fixtures / helpers --------------------------------------------------------

def _metadata_dict(match_id=MATCH):
    return {
        "type": "match_metadata", "match_id": match_id, "kickoff_utc": "2026-10-24T15:00:00Z",
        "venue": "Test Ground", "weather": "Clear", "home_team": "Home", "away_team": "Away",
        "home_formation": "4-3-3", "away_formation": "4-3-3", "home_lineup": [], "away_lineup": [],
        "referee_name": "R. Test",
    }


def _goal_dict(match_id=MATCH):
    return {
        "type": "shot", "match_id": match_id, "period": 1, "minute": 10, "second": 0,
        "match_clock_ms": 600000, "team": "home", "team_name": "Home",
        "player_id": "home_9", "player_name": "Striker", "location": [110, 40],
        "possession_id": 1, "end_location": [120, 40], "outcome": "goal",
        "xg": 0.4, "shot_speed_kmh": 90.0,
    }


async def _fake_narrate(insight, player_names=None):
    return f"FAKE NARRATION: {fallback_narration(insight)}"


async def _fake_personalize(insights, persona, lens=None, player_id=None, locale="en", player_names=None):
    return f"FAKE PERSONALIZED ({persona}): {fallback_narration(insights[0])}"


async def _always_fails(*args, **kwargs):
    raise RuntimeError("simulated Foundry outage")


def _run(match_id=MATCH, **kwargs):
    kwargs.setdefault("narrate_fn", _fake_narrate)
    kwargs.setdefault("personalize_fn", _fake_personalize)
    _, log = asyncio.run(run_match(
        raw_events=[_metadata_dict(match_id), _goal_dict(match_id)],
        match_id=match_id, duration_ms=90 * 60000, **kwargs,
    ))
    return log


def _by_stage(log, stage):
    return [e for e in log.entries() if e.stage == stage]


@pytest.fixture
def api(STATE):
    from service.routers.agent_trace import router

    STATE["handoff_log"] = InMemoryHandoffLog()
    STATE["match_status"] = {}
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client, STATE


# -- 1. executors record real timing / path data -------------------------------

def test_every_pipeline_stage_records_duration_and_path():
    log = _run()
    for stage in PIPELINE_STAGES:
        entries = _by_stage(log, stage)
        assert entries, f"no {stage} entries"
        for e in entries:
            assert isinstance(e.summary["duration_ms"], (int, float)) and e.summary["duration_ms"] >= 0
            assert e.summary["path"] in {"llm", "fallback", "rules"}
    assert all(e.summary["path"] == "rules" for s in ("scout", "analyst0", "broadcaster") for e in _by_stage(log, s))
    assert all(e.summary["path"] == "llm" and e.summary["llm_attempts"] == 1 for e in _by_stage(log, "narrator"))
    assert all(e.summary["path"] == "llm" and e.summary["llm_attempts"] == 1 for e in _by_stage(log, "concierge"))


def test_grounding_failure_is_recorded_as_fallback():
    log = _run(match_id="M-TRACE-FAULT", inject_fault=True)
    narr = _by_stage(log, "narrator")
    caught = [e for e in narr if e.summary["grounding_failed"]]
    assert len(caught) == 1
    assert caught[0].summary["path"] == "fallback" and caught[0].summary["llm_attempts"] == 1
    assert sum(1 for e in narr if e.summary["path"] == "fallback") == 1


def test_llm_outage_records_two_attempts_and_fallback():
    log = _run(match_id="M-TRACE-DOWN", narrate_fn=_always_fails, personalize_fn=_always_fails)
    for stage in ("narrator", "concierge"):
        entries = _by_stage(log, stage)
        assert entries
        assert all(e.summary["path"] == "fallback" and e.summary["llm_attempts"] == 2 for e in entries)
        assert not any(e.summary["grounding_failed"] for e in entries)


# -- 2. pure rollup -------------------------------------------------------------

def test_build_agent_trace_rolls_up_a_real_run():
    log = _run(match_id="M-TRACE-FAULT2", inject_fault=True)
    trace = build_agent_trace(log.entries())

    assert [a["stage"] for a in trace["agents"]] == list(PIPELINE_STAGES)
    agents = {a["stage"]: a for a in trace["agents"]}
    n_insights = len(_by_stage(log, "insight"))
    assert n_insights >= 1

    assert agents["scout"]["kind"] == "deterministic" and agents["scout"]["processed"] == 2
    assert agents["analyst0"]["outputs"] == n_insights
    assert agents["narrator"]["kind"] == "llm+verifier"
    assert agents["narrator"]["processed"] == n_insights
    assert agents["narrator"]["llm_calls"] == n_insights
    assert agents["narrator"]["fallbacks"] == 1 and agents["narrator"]["grounding_failures"] == 1
    assert agents["broadcaster"]["outputs"] == n_insights and agents["broadcaster"]["llm_calls"] == 0
    for a in trace["agents"]:
        assert a["role"]
        assert a["avg_duration_ms"] is not None
        assert a["last_activity_ts"] is not None

    totals = trace["totals"]
    assert totals["insights"] == n_insights
    assert totals["verified"] == n_insights - 1
    assert totals["fell_back"] == 1
    assert totals["llm_calls"] == 2 * n_insights  # narrator + concierge, one attempt each

    tl = trace["timeline"]
    assert tl[0]["stage"] == "scout" and tl[0]["t"] == 0
    assert all(tl[i]["t"] <= tl[i + 1]["t"] for i in range(len(tl) - 1))
    assert any(row["path"] == "fallback" and row["stage"] == "narrator" for row in tl)
    assert all(row["label"] for row in tl)
    assert any(row.get("insight_id") for row in tl)


def test_build_agent_trace_is_bounded_and_tolerates_legacy_entries():
    entries = [HandoffEntry("scout", "M", {"accepted": 5, "rejected": 0}, timestamp=100.0)]
    entries += [
        HandoffEntry("narrator", "M", {"insight_id": f"i{i}", "trigger_type": "milestone", "fact_checked": i % 2 == 0},
                     timestamp=101.0 + i)
        for i in range(200)
    ]
    entries.append(HandoffEntry("some_future_stage", "M", {"x": 1}, timestamp=999.0))
    trace = build_agent_trace(entries, timeline_limit=50)
    assert len(trace["timeline"]) == 50
    assert trace["timeline"][-1]["insight_id"] == "i199"
    narrator = next(a for a in trace["agents"] if a["stage"] == "narrator")
    assert narrator["processed"] == 200
    assert narrator["fallbacks"] == 100  # legacy entry without "path": fact_checked=False reads as fallback
    assert narrator["avg_duration_ms"] is None  # no timing recorded -> not guessed
    assert narrator["llm_calls"] is None  # unknown, not guessed


def test_build_agent_trace_empty():
    trace = build_agent_trace([])
    assert len(trace["agents"]) == 5
    assert trace["timeline"] == []
    assert trace["totals"]["insights"] == 0


# -- 3. HTTP surface ------------------------------------------------------------

def test_agent_trace_endpoint_404s_unknown_match(api):
    client, _ = api
    assert client.get("/matches/NOPE/agent-trace").status_code == 404


def test_agent_trace_endpoint_known_by_status_only(api):
    client, state = api
    state["match_status"]["M-EMPTY"] = {"status": "running"}
    resp = client.get("/matches/M-EMPTY/agent-trace")
    assert resp.status_code == 200
    assert resp.json()["timeline"] == []


def test_agent_trace_endpoint_returns_rollup(api):
    client, state = api
    log = _run(match_id="M-HTTP", handoff_log=state["handoff_log"])
    _run(match_id="M-OTHER", handoff_log=log)  # must not leak into M-HTTP's trace
    body = client.get("/matches/M-HTTP/agent-trace").json()
    assert body["match_id"] == "M-HTTP"
    assert body["totals"]["insights"] == len([e for e in log.entries() if e.stage == "insight" and e.match_id == "M-HTTP"])
    assert len(body["timeline"]) <= 50


def test_overlay_schema_endpoint(api):
    client, _ = api
    body = client.get("/overlay/schema").json()
    assert body["schema"] == RenderPayload.model_json_schema()
    contract = body["contract"]
    assert contract["contract_version"]
    timing = json.dumps(contract)
    for field in ("game_clock", "duration_ms", "priority", "template"):
        assert field in timing
    assert "anchor" not in timing  # no such field exists on RenderDisplay -- don't advertise one


def test_overlay_feed_endpoint_rebuilds_payloads_from_insights(api):
    client, state = api
    log = _run(match_id="M-FEED", handoff_log=state["handoff_log"], inject_fault=True)
    resp = client.get("/matches/M-FEED/overlay-feed")
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]
    assert "M-FEED" in resp.headers["content-disposition"]
    body = resp.json()
    payloads = [RenderPayload.model_validate(p) for p in body["payloads"]]
    insights = [e for e in log.entries() if e.stage == "insight"]
    assert len(payloads) == len(insights)
    assert {p.source_insight_id for p in payloads} == {e.summary["insight_id"] for e in insights}
    assert sum(1 for p in payloads if not p.fact_checked) == 1
    clocks = [p.game_clock for p in payloads]
    assert clocks == sorted(clocks)
    # deterministic: two downloads are byte-identical
    assert client.get("/matches/M-FEED/overlay-feed").content == resp.content


def test_overlay_feed_payload_matches_live_broadcaster_render(api):
    client, state = api
    insight = InsightCandidate(
        match_id="M-ONE", window_start_min=10.5, window_end_min=12.0, trigger_type="milestone",
        metric_name="goal", metric_value=1.0, related_players=["home_9"], window_summary={"team": "home"},
    )
    state["handoff_log"].record("insight", "M-ONE", {**insight.model_dump(), "narrative_text": "Goal!", "fact_checked": True})
    payload = client.get("/matches/M-ONE/overlay-feed").json()["payloads"][0]
    assert payload["game_clock"] == "10:30"
    assert payload["display"] == {"template": "goal_banner", "duration_ms": 6000, "priority": 1}
    assert payload["narrative_text"] == "Goal!"
    assert payload["audio_url"] is None


def test_overlay_feed_404s_unknown_match(api):
    client, _ = api
    assert client.get("/matches/NOPE/overlay-feed").status_code == 404
