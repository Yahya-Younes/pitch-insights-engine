"""GET /matches/{match_id}/momentum -- xT added per team per time bucket
(see agents/analyst0/momentum.py). Only covers matches run via
POST /matches/run (STATE["events_by_match"]); anything else is 404."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from agents.analyst0.momentum import compute_momentum
from service.state import STATE

router = APIRouter(tags=["momentum"])


@router.get("/matches/{match_id}/momentum")
async def match_momentum(match_id: str, bucket_min: int = Query(1, ge=1, le=45)):
    events = STATE.get("events_by_match", {}).get(match_id)
    if events is None:
        raise HTTPException(404, f"no event data for match {match_id!r}")
    duration_ms = STATE.get("duration_ms_by_match", {}).get(match_id)
    if duration_ms is None:
        duration_ms = max((int(getattr(e, "match_clock_ms", 0) or 0) for e in events), default=0)
    names = STATE.get("player_names_by_match", {}).get(match_id, {})
    # One linear pass over ~2-3k events (a few ms) -- no thread or cache needed.
    return {"match_id": match_id, **compute_momentum(events, duration_ms, bucket_min, names)}
