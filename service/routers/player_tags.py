"""GET /matches/{match_id}/player-tags -- player speed/distance tags plus
shot and pass ball speeds (see agents/analyst0/player_tags.py)."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from agents.analyst0.player_tags import compute_player_tags
from service.state import STATE

router = APIRouter()


@router.get("/matches/{match_id}/player-tags")
async def player_tags(match_id: str):
    positions = STATE.get("positions_by_match", {}).get(match_id)
    if positions is None:
        raise HTTPException(404, f"no positions recorded for match {match_id!r}")
    events = STATE.get("events_by_match", {}).get(match_id, [])
    names = STATE.get("player_names_by_match", {}).get(match_id, {})

    # A full 90-minute track is ~1.2M player samples (~1-2 s of CPU), so the
    # result is cached per match, keyed on the identity of the inputs it was
    # built from (held by reference, compared with `is`) so a re-run of the
    # same match id is never served stale.
    cache = STATE.setdefault("player_tags_by_match", {})
    hit = cache.get(match_id)
    if hit is not None and hit[0] is positions and hit[1] is events:
        return hit[2]

    result = await asyncio.to_thread(compute_player_tags, positions, events, names)
    body = {"match_id": match_id, "duration_ms": STATE.get("duration_ms_by_match", {}).get(match_id), **result}
    cache[match_id] = (positions, events, body)
    return body
