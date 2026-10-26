"""GET /matches/{match_id}/live-ratings -- live 3-10 player ratings, their
per-minute series and the hysteresis man of the match
(see agents/analyst0/live_rating.py).

Read-only view over STATE["events_by_match"] (matches run via
POST /matches/run) -- anything else is 404. Roles come from
STATE["player_roles_by_match"]; without them nobody is weighted, saves and
goals conceded have no keeper / back line to land on.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query

from agents.analyst0.live_rating import compute_live_ratings
from service.state import STATE

router = APIRouter(tags=["live-ratings"])

_CACHE_PER_MATCH = 128


@router.get("/matches/{match_id}/live-ratings")
async def live_ratings(match_id: str, minute: int | None = Query(None, ge=0, le=200)):
    events = STATE.get("events_by_match", {}).get(match_id)
    if events is None:
        raise HTTPException(404, f"no event data for match {match_id!r}")
    names = STATE.get("player_names_by_match", {}).get(match_id, {})
    roles = STATE.get("player_roles_by_match", {}).get(match_id, {})

    # Cached per (match, minute), invalidated when any input object is
    # replaced (compared with `is`) or the event list grows in place.
    cache = STATE.setdefault("live_ratings_by_match", {})
    inputs = (events, names, roles)
    entry = cache.get(match_id)
    if entry is None or entry[1] != len(events) or not all(a is b for a, b in zip(entry[0], inputs, strict=True)):
        entry = (inputs, len(events), {})
        cache[match_id] = entry
    bodies = entry[2]
    if minute in bodies:
        return bodies[minute]

    result = await asyncio.to_thread(compute_live_ratings, events, names, roles, minute)
    body = {"match_id": match_id, **result}
    if len(bodies) >= _CACHE_PER_MATCH:
        bodies.clear()
    bodies[minute] = body
    return body
