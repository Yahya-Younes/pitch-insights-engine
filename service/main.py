"""Deployed Container App entrypoint. Hosts the orchestrator
(Scout -> Analyst-0 -> Narrator -> fan-out to {Broadcaster, Concierge}) behind
a small FastAPI surface, backed by Cosmos DB (handoff log) and pushing every
render/personalized output live to Web PubSub for the frontend overlay.

Two ingestion paths feed the same pipeline:
  - POST /matches/run: generates a fresh synthetic match in-process and runs
    it in a background task -- the fast, reliable path used for the demo
    video. Each live-generated insight still goes through one real Narrator
    LLM call and one real Concierge LLM call, so a full 90-minute match can
    mean dozens of sequential model calls; the endpoint returns immediately
    with the match_id rather than blocking the HTTP request on all of them,
    and by default only simulates the first `minutes` of play so a demo run
    finishes in a reasonable time. Raise `minutes` (up to 90) for a full match.
  - the background Event Hubs consumer (service/eventhub_consumer.py): the
    genuine stage-(a) transport, fed by datagen/streamer.py replaying a match
    onto the hub at accelerated real-time pace.
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents.concierge.lens import load_preset_lenses
from agents.orchestrator.workflow import run_match
from agents.shared.models import RenderPayload
from datagen.match_simulator import PERIOD_MS, MatchSimulator
from service.eventhub_consumer import start_background

logger = logging.getLogger("pitch.service")

_state: dict = {}


def _handoff_log():
    endpoint = os.environ.get("COSMOS_ENDPOINT")
    if not endpoint:
        from agents.shared.handoff_log import InMemoryHandoffLog
        return InMemoryHandoffLog()
    from agents.shared.cosmos_handoff_log import CosmosHandoffLog
    return CosmosHandoffLog(endpoint)


def _publisher():
    endpoint = os.environ.get("WEBPUBSUB_ENDPOINT")
    if not endpoint:
        return None
    from agents.shared.webpubsub_publisher import WebPubSubPublisher
    return WebPubSubPublisher(endpoint, hub=os.environ.get("WEBPUBSUB_HUB", "pitch_overlay"))


async def _handle_streamed_match(match_id: str, raw_events: list[dict], duration_ms: int) -> None:
    logger.info("running match %s from Event Hubs feed (%d events)", match_id, len(raw_events))
    # The pure Event-Hubs-fed path only sees raw event dicts (no PlayerTendencyProfile
    # objects), so it narrates by player_id until the feed itself carries a names map.
    await _run_and_publish(raw_events, match_id, duration_ms, persona="casual_fan", lens_id=None, player_names={})


@asynccontextmanager
async def lifespan(app: FastAPI):
    _state["handoff_log"] = _handoff_log()
    _state["publisher"] = _publisher()
    _state["lenses"] = load_preset_lenses()

    fqdn = os.environ.get("EVENTHUB_FQDN")
    if fqdn:
        consumer, task = start_background(
            fqdn, os.environ.get("EVENTHUB_NAME", "pitch-events"),
            os.environ.get("EVENTHUB_CONSUMER_GROUP", "$Default"),
            _handle_streamed_match,
        )
        _state["eh_consumer"], _state["eh_task"] = consumer, task
    yield
    if "eh_consumer" in _state:
        await _state["eh_consumer"].stop()


app = FastAPI(title="Pitch Insights Engine", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


class RunMatchRequest(BaseModel):
    seed: int | None = None
    persona: str = "casual_fan"
    lens_id: str | None = None
    minutes: float = 12.0
    inject_fault: bool = False
    """Demo/debug hook: deliberately corrupts the first insight's narration
    so the live grounding check visibly catches and corrects it -- proves
    the fact-checking claim instead of asking judges to trust it."""


class RunMatchResponse(BaseModel):
    match_id: str
    home_team: str
    away_team: str
    status: str


async def _run_and_publish(
    raw_events: list[dict], match_id: str, duration_ms: int, persona: str,
    lens_id: str | None, player_names: dict[str, str], inject_fault: bool = False,
):
    lens = _state["lenses"].get(lens_id) if lens_id else None
    result, log = await run_match(
        raw_events=raw_events, match_id=match_id, duration_ms=duration_ms,
        handoff_log=_state["handoff_log"], persona=persona, lens=lens, player_names=player_names,
        inject_fault=inject_fault,
    )

    publisher = _state["publisher"]
    outputs = result.get_outputs()
    render_payloads = [o for o in outputs if isinstance(o, RenderPayload)]
    personalized_texts = [o for o in outputs if isinstance(o, str)]

    if publisher is not None:
        # The Web PubSub SDK client here is synchronous; run each call off
        # the event loop so a slow/retrying publish can't stall anything else.
        for payload in render_payloads:
            await asyncio.to_thread(publisher.publish_render, payload)
        for text in personalized_texts:
            await asyncio.to_thread(publisher.publish_personalized, match_id, persona, text)

    return render_payloads, personalized_texts, log


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/negotiate")
async def negotiate():
    publisher = _state["publisher"]
    if publisher is None:
        raise HTTPException(503, "Web PubSub is not configured in this environment")
    return {"url": publisher.client_access_url()}


@app.get("/matches/{match_id}/handoff")
async def match_handoff(match_id: str):
    """Exposes the shared orchestration trace for one match -- concrete,
    inspectable evidence of the 5-stage agent handoff (Scout -> Analyst-0 ->
    Narrator -> {Broadcaster, Concierge}), not just a demo claim."""
    log = _state["handoff_log"]
    try:
        entries = log.entries(match_id)
    except TypeError:
        entries = [e for e in log.entries() if e.match_id == match_id]
    return [
        {"stage": e.stage, "match_id": e.match_id, "summary": e.summary, "timestamp": e.timestamp}
        for e in entries
    ]


@app.get("/lenses")
async def lenses():
    return [
        {
            "lens_id": l.lens_id,
            "attributed_style_of": l.attributed_style_of,
            "tone_descriptors": l.tone_descriptors,
            "tactical_principles": l.tactical_principles,
            "sourcing_note": l.sourcing_note,
        }
        for l in _state["lenses"].values()
    ]


@app.post("/matches/run", response_model=RunMatchResponse)
async def run_demo_match(req: RunMatchRequest):
    if req.lens_id is not None and req.lens_id not in _state["lenses"]:
        raise HTTPException(400, f"unknown lens_id {req.lens_id!r}")

    seed = req.seed if req.seed is not None else random.randint(1, 1_000_000)
    match_id = f"DEMO-{int(time.time())}-{seed}"
    result = MatchSimulator(match_id, seed).generate_match()
    cutoff_ms = max(1.0, min(90.0, req.minutes)) * 60000
    raw_events = [
        e.model_dump(mode="json") for e in result.events
        if e.type == "match_metadata" or e.match_clock_ms <= cutoff_ms
    ]
    player_names = {p.player_id: p.player_name for p in [*result.home_profiles, *result.away_profiles]}

    async def _background_run():
        try:
            await _run_and_publish(
                raw_events, match_id, int(cutoff_ms), req.persona, req.lens_id, player_names,
                inject_fault=req.inject_fault,
            )
            logger.info("match %s finished processing", match_id)
        except Exception:
            logger.exception("match %s failed during background processing", match_id)
        finally:
            _state["background_tasks"].discard(task)

    # asyncio only holds a weak reference to a bare create_task() result, so
    # without keeping a strong reference here the task can be garbage
    # collected mid-run -- a well-known asyncio footgun.
    task = asyncio.create_task(_background_run())
    _state.setdefault("background_tasks", set()).add(task)

    return RunMatchResponse(
        match_id=match_id, home_team=result.home_name, away_team=result.away_name, status="running",
    )
