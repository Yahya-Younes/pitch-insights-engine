"""GET /matches/{match_id}/match-stats -- EA FC-style "Match Stats" panel
(see agents/analyst0/match_stats.py). `last_minutes` restricts the stats to
the most recent minutes; the score is always the full-match score.

Read-only view over STATE["events_by_match"] -- anything else is 404.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from agents.analyst0.match_stats import compute_match_stats
from service.state import STATE

router = APIRouter(tags=["match-stats"])


@router.get("/matches/{match_id}/match-stats")
async def match_stats(match_id: str, last_minutes: int | None = Query(None, ge=1, le=200)):
    events = STATE.get("events_by_match", {}).get(match_id)
    if events is None:
        raise HTTPException(404, f"no event data for match {match_id!r}")
    # One linear pass over ~2-3k events (a few ms) -- no thread or cache needed.
    return {"match_id": match_id, **compute_match_stats(events, last_minutes)}
