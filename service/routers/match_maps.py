"""Match Maps endpoints: threat prevented, shot map, pass network.

Read-only views over STATE["events_by_match"], which is only populated for
matches run via POST /matches/run (the demo path) -- anything else is 404.
"""
from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from agents.analyst0.match_maps import compute_pass_network, compute_shot_map, compute_threat_prevented
from service.state import STATE

router = APIRouter(tags=["match-maps"])


def _events_and_names(match_id: str) -> tuple[list, dict[str, str]]:
    events = STATE.get("events_by_match", {}).get(match_id)
    if events is None:
        raise HTTPException(404, f"no event data for match {match_id!r}")
    return events, STATE.get("player_names_by_match", {}).get(match_id, {})


@router.get("/matches/{match_id}/threat-prevented")
async def threat_prevented(match_id: str):
    events, names = _events_and_names(match_id)
    result = await asyncio.to_thread(compute_threat_prevented, events, names)
    result.pop("moments", None)  # full list is internal; top 5 + aggregates are the API
    return {"match_id": match_id, **result}


@router.get("/matches/{match_id}/shot-map")
async def shot_map(match_id: str):
    events, names = _events_and_names(match_id)
    return {"match_id": match_id, **compute_shot_map(events, names)}


@router.get("/matches/{match_id}/pass-network")
async def pass_network(
    match_id: str,
    team: Literal["home", "away"] = "home",
    min_count: int = Query(3, ge=1, le=20),
):
    events, names = _events_and_names(match_id)
    result = await asyncio.to_thread(compute_pass_network, events, team, min_count, names)
    return {"match_id": match_id, **result}
