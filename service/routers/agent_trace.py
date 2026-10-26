"""Agent-team trace + published overlay contract.

  GET /matches/{match_id}/agent-trace   per-agent rollup of the shared handoff log
  GET /overlay/schema                   RenderPayload JSON Schema + timing contract
  GET /matches/{match_id}/overlay-feed  one match's overlay payloads, as a download

Mounted from service/main.py with app.include_router(router).
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Response

from agents.broadcaster.overlay_contract import overlay_feed, overlay_schema_document
from agents.orchestrator.agent_trace import build_agent_trace
from service.state import STATE

router = APIRouter(tags=["agent-team"])


def _match_entries(match_id: str) -> list:
    log = STATE["handoff_log"]
    try:
        entries = log.entries(match_id)  # Cosmos log: partition-scoped query
    except TypeError:
        entries = [e for e in log.entries() if e.match_id == match_id]
    if not entries and match_id not in STATE.get("match_status", {}):
        raise HTTPException(404, f"unknown match {match_id!r}")
    return entries


@router.get("/matches/{match_id}/agent-trace")
async def agent_trace(match_id: str):
    """Which agent did what, how often it used its LLM, how often the
    verifier or an outage forced a fallback, and how long each stage took --
    derived entirely from the handoff log the executors write."""
    entries = _match_entries(match_id)
    status = STATE.get("match_status", {}).get(match_id, {}).get("status")
    return {"match_id": match_id, "status": status, **build_agent_trace(entries)}


@router.get("/overlay/schema")
async def overlay_schema():
    return overlay_schema_document()


@router.get("/matches/{match_id}/overlay-feed")
async def match_overlay_feed(match_id: str):
    entries = _match_entries(match_id)
    body = json.dumps(overlay_feed(match_id, entries), indent=2, ensure_ascii=False)
    safe_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in match_id)
    return Response(
        content=body, media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="overlay-feed-{safe_id}.json"'},
    )
