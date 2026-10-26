"""Player graph endpoint: pass + duel network with centrality and insights.

Read-only view over STATE["events_by_match"] (populated for matches run via
POST /matches/run) -- anything else is 404.
"""
from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from agents.analyst0.player_graph import compute_player_graph
from service.state import STATE

router = APIRouter(tags=["player-graph"])

_CACHE_KEY = "player_graph_cache"
_CACHE_MAX = 256


@router.get("/matches/{match_id}/player-graph")
async def player_graph(
    match_id: str,
    from_min: int = Query(0, ge=0, lt=120),
    to_min: int = Query(90, gt=0, le=120),
    team: Literal["both", "home", "away"] = "both",
    include_duels: bool = True,
    min_passes: int = Query(2, ge=1, le=50),
):
    if from_min >= to_min:
        raise HTTPException(422, "from_min must be < to_min")
    events = STATE.get("events_by_match", {}).get(match_id)
    if events is None:
        raise HTTPException(404, f"no event data for match {match_id!r}")
    names = STATE.get("player_names_by_match", {}).get(match_id, {})

    # Cached per (match, params), keyed on the identity of the event list it was
    # built from so a re-run of the same match id is never served stale.
    cache = STATE.setdefault(_CACHE_KEY, {})
    key = (match_id, from_min, to_min, team, include_duels, min_passes)
    hit = cache.get(key)
    if hit is not None and hit[0] is events:
        return hit[1]

    result = await asyncio.to_thread(
        compute_player_graph, events, from_min, to_min, team, include_duels, min_passes, names,
    )
    body = {"match_id": match_id, **result}
    if len(cache) >= _CACHE_MAX:
        cache.clear()
    cache[key] = (events, body)
    return body
