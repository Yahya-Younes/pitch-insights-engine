"""GET /matches/{match_id}/player-ratings and
GET /matches/{match_id}/players/{player_id}/heatmap -- FIFA-style ratings
and per-player occupancy heatmaps (see agents/analyst0/player_ratings.py).

Read-only views over STATE["events_by_match"] / STATE["positions_by_match"],
populated only for matches run via POST /matches/run -- anything else is 404.
Player roles (GK/CB/...) are read from STATE["player_roles_by_match"] when
present; without it every `position` is null and the default weights apply.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query

from agents.analyst0.player_ratings import compute_player_heatmap, compute_player_ratings
from service.state import STATE

router = APIRouter(tags=["player-ratings"])


def _match_inputs(match_id: str) -> tuple[list, list | None, dict[str, str]]:
    events = STATE.get("events_by_match", {}).get(match_id)
    positions = STATE.get("positions_by_match", {}).get(match_id)
    if events is None and positions is None:
        raise HTTPException(404, f"no event data for match {match_id!r}")
    names = STATE.get("player_names_by_match", {}).get(match_id, {})
    return events or [], positions, names


@router.get("/matches/{match_id}/player-ratings")
async def player_ratings(match_id: str):
    events, positions, names = _match_inputs(match_id)
    roles = STATE.get("player_roles_by_match", {}).get(match_id)

    # The position walk behind pace / work rate is ~1-2 s for a full match,
    # so the body is cached per match, keyed on the identity of its inputs
    # (compared with `is`) so a re-run of the same match id is never stale.
    cache = STATE.setdefault("player_ratings_by_match", {})
    hit = cache.get(match_id)
    if hit is not None and all(a is b for a, b in zip(hit[0], (events, positions, names, roles), strict=True)):
        return hit[1]

    # Reuse /player-tags' cached tracking numbers when they match these inputs.
    tracking = None
    tags_hit = STATE.get("player_tags_by_match", {}).get(match_id)
    if tags_hit is not None and positions is not None and tags_hit[0] is positions and tags_hit[1] is events:
        tracking = tags_hit[2]["players"]

    result = await asyncio.to_thread(
        compute_player_ratings, events, positions, names, roles=roles, tracking=tracking,
    )
    body = {"match_id": match_id, **result}
    cache[match_id] = ((events, positions, names, roles), body)
    return body


@router.get("/matches/{match_id}/players/{player_id}/heatmap")
async def player_heatmap(
    match_id: str,
    player_id: str,
    cols: int = Query(12, ge=1, le=60),
    rows: int = Query(8, ge=1, le=40),
):
    events, positions, names = _match_inputs(match_id)
    result = await asyncio.to_thread(
        compute_player_heatmap, player_id, positions, events, names, cols=cols, rows=rows,
    )
    if result is None:
        raise HTTPException(404, f"no data for player {player_id!r} in match {match_id!r}")
    return {"match_id": match_id, **result}
