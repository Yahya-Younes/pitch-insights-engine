"""'Try to make it lie' endpoints.

POST /matches/{match_id}/tamper -- tamper with a narration that already
shipped for this match and run it through the live grounding check (no LLM).
GET /verification/headline -- the robustness-suite headline, cached ~5 min.
See eval/make_it_lie.py for the logic and its honesty guarantees.
"""
from __future__ import annotations

import asyncio
import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents.shared.models import InsightCandidate
from eval import make_it_lie
from service.state import STATE

router = APIRouter(tags=["make-it-lie"])

HEADLINE_TTL_S = 300.0
_CACHE_KEY = "verification_headline_cache"


class TamperRequest(BaseModel):
    insight_id: str | None = Field(default=None, min_length=1, max_length=200)
    attack: Literal["fake_number", "wrong_player", "real_club_leak", "custom"]
    custom_text: str | None = Field(default=None, max_length=make_it_lie.CUSTOM_MAX_CHARS)


async def _entries(match_id: str) -> list:
    log = STATE["handoff_log"]
    try:
        return await asyncio.to_thread(log.entries, match_id)
    except TypeError:
        return [e for e in log.entries() if e.match_id == match_id]


@router.post("/matches/{match_id}/tamper")
async def tamper(match_id: str, req: TamperRequest):
    entries = await _entries(match_id)
    if not entries and match_id not in STATE.get("match_status", {}):
        raise HTTPException(404, f"unknown match {match_id!r}")

    insight_entries = [e for e in entries if e.stage == "insight"]
    if req.insight_id is not None:
        chosen = next((e for e in insight_entries if e.summary.get("insight_id") == req.insight_id), None)
        if chosen is None:
            raise HTTPException(404, f"no insight {req.insight_id!r} found for match {match_id!r}")
    else:
        verified = [e for e in insight_entries if e.summary.get("fact_checked")]
        pool = verified or insight_entries
        if not pool:
            raise HTTPException(404, f"no insights yet for match {match_id!r}")
        chosen = pool[-1]

    summary = dict(chosen.summary)
    original_text = str(summary.pop("narrative_text", ""))
    summary.pop("fact_checked", None)
    insight = InsightCandidate(**summary)
    player_names = STATE.get("player_names_by_match", {}).get(match_id, {})

    try:
        trace = make_it_lie.run_tamper(insight, original_text, req.attack, player_names, req.custom_text)
    except make_it_lie.TamperUnavailable as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"match_id": match_id, **trace}


@router.get("/verification/headline")
async def verification_headline():
    cached = STATE.get(_CACHE_KEY)
    now = time.monotonic()
    if cached is not None and now - cached[0] < HEADLINE_TTL_S:
        return {**cached[1], "cached": True, "cache_age_s": round(now - cached[0], 1)}
    result = await asyncio.to_thread(make_it_lie.compute_headline)
    STATE[_CACHE_KEY] = (now, result)
    return {**result, "cached": False, "cache_age_s": 0.0}
