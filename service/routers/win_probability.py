"""GET /matches/{match_id}/win-probability -- live home/draw/away win
probability over match time. See agents/analyst0/win_probability.py."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from agents.analyst0.win_probability import compute_win_probability
from service.state import STATE

router = APIRouter(tags=["win-probability"])


@router.get("/matches/{match_id}/win-probability")
async def match_win_probability(match_id: str) -> dict:
    """Only covers matches run via POST /matches/run (same retained event
    list as /matches/{id}/analytics)."""
    events = STATE.get("events_by_match", {}).get(match_id)
    duration_ms = STATE.get("duration_ms_by_match", {}).get(match_id)
    if events is None or duration_ms is None:
        raise HTTPException(404, f"no event data for match {match_id!r}")
    result = await asyncio.to_thread(compute_win_probability, events, duration_ms)
    status = STATE.get("match_status", {}).get(match_id, {})
    result["home_team"] = status.get("home_team") or None
    result["away_team"] = status.get("away_team") or None
    return result
