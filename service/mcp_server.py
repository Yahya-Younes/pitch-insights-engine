"""In-process MCP server exposing this match-intelligence pipeline's data
as agent-callable tools -- mounted at /mcp on the same Container App as the
main FastAPI surface (service/main.py), not a separate deployment. Any
MCP-compatible client (another team's agent, a different broadcaster, a
generic MCP inspector) can query real match insights, the live
fact-checking scorecard, and ask grounded questions without needing our
REST API's specific request/response shapes.

Read-only by design -- nothing here starts a match or mutates state; it
only surfaces what service/main.py's own endpoints already compute, via the
same shared service.state.STATE dict so the two never see divergent data.
"""
from __future__ import annotations

import asyncio
import os

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from agents.qa.agent import ask as qa_ask
from agents.shared.models import InsightCandidate
from eval.robustness_suite import run as run_robustness_suite
from service.state import STATE

# The MCP SDK's DNS-rebinding protection only matches an exact Host header
# (or an exact-host + ":*" port wildcard) -- there's no subdomain/hostname
# wildcard, so Azure Container Apps' own randomly-generated FQDN has to be
# allow-listed explicitly rather than guessed at. MCP_ALLOWED_HOST is set on
# the live Container App via `az containerapp update --set-env-vars`;
# unset (e.g. running locally), only localhost is allowed, which is what
# every local test against `uvicorn service.main:app` already used.
_allowed_hosts = ["127.0.0.1:*", "localhost:*", "[::1]:*"]
if _extra_host := os.environ.get("MCP_ALLOWED_HOST"):
    _allowed_hosts.append(_extra_host)

mcp = FastMCP(
    "pitch-insights-engine",
    instructions=(
        "Read-only access to Pitch Insights Engine match intelligence: recent "
        "matches, their verified insights, a live fact-checking scorecard, and "
        "a grounded Q&A tool that only answers from what has actually been "
        "verified for a given match -- never from general football knowledge."
    ),
    # FastMCP's own ASGI app defaults to serving itself at "/mcp" internally
    # -- mounted at "/mcp" on the main app (service/main.py) that would
    # double up to "/mcp/mcp" and 404. Serving at "/" internally instead
    # means the main app's app.mount("/mcp", ...) is the only place "/mcp"
    # is ever specified.
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(allowed_hosts=_allowed_hosts, allowed_origins=["*"]),
)


def _entries_for(match_id: str | None = None, limit: int | None = None) -> list:
    log = STATE.get("handoff_log")
    if log is None:
        return []
    try:
        return log.entries(match_id, limit)
    except TypeError:
        entries = log.entries()
        return [e for e in entries if match_id is None or e.match_id == match_id]


@mcp.tool()
async def list_recent_matches(limit: int = 20) -> list[dict]:
    """Lists recent match_ids this pipeline has processed, most recent first."""
    entries = await asyncio.to_thread(_entries_for, None, max(limit * 4, 100))
    last_seen: dict[str, float] = {}
    for e in entries:
        last_seen[e.match_id] = max(last_seen.get(e.match_id, 0.0), e.timestamp)
    ordered = sorted(last_seen.items(), key=lambda kv: kv[1], reverse=True)
    return [{"match_id": mid, "last_activity": ts} for mid, ts in ordered[:limit]]


@mcp.tool()
async def get_match_insights(match_id: str) -> list[dict]:
    """Returns every verified insight generated for one match -- the exact
    InsightCandidate + narrative text + fact_checked flag the Narrator
    produced and the live grounding check verified, nothing editorialized."""
    entries = await asyncio.to_thread(_entries_for, match_id)
    return [e.summary for e in entries if e.stage == "insight"]


@mcp.tool()
async def get_match_stats() -> dict:
    """Live fact-checking and tendency-recovery headline numbers -- the
    same data GET /stats on the REST API reports, computed fresh from the
    actual running system, not asserted anywhere statically."""
    from eval.realism_check import run as run_realism_check
    from service.stats import (
        compute_finetuned_narrator_comparison, compute_formation_detection_accuracy,
        compute_tendency_recovery_accuracy, grounding_pass_rate_from_entries,
    )

    tendency = STATE.get("tendency_accuracy")
    if tendency is None:
        tendency = await asyncio.to_thread(compute_tendency_recovery_accuracy)
        STATE["tendency_accuracy"] = tendency
    realism = STATE.get("realism_check")
    if realism is None:
        realism = await asyncio.to_thread(run_realism_check)
        STATE["realism_check"] = realism
    formation_detection = STATE.get("formation_detection_accuracy")
    if formation_detection is None:
        formation_detection = await asyncio.to_thread(compute_formation_detection_accuracy)
        STATE["formation_detection_accuracy"] = formation_detection

    entries = await asyncio.to_thread(_entries_for, None, 300)
    robustness = run_robustness_suite()
    fine_tuned_narrator = await asyncio.to_thread(compute_finetuned_narrator_comparison, STATE)
    return {
        "tendency_recovery": tendency,
        "fine_tuned_narrator": fine_tuned_narrator,
        "grounding": {
            **grounding_pass_rate_from_entries(entries),
            "window": "most recent 300 live handoff entries",
        },
        "robustness": {
            "corruptions_caught": robustness.corruptions_caught,
            "corruptions_total": robustness.corruptions_total,
            "catch_rate": robustness.catch_rate,
            "false_positives": robustness.false_positives,
            "legitimate_total": robustness.legitimate_total,
        },
        "realism": realism,
        "formation_detection": formation_detection,
    }


@mcp.tool()
async def get_match_tactics(match_id: str) -> dict:
    """Each team's inferred tactical shape over the course of one match --
    a formation-shorthand timeline, any detected mid-match shifts, and
    individual player role changes -- inferred purely from observed event
    locations, never from the generator's hidden ground truth."""
    tactics = STATE.get("tactics_by_match", {}).get(match_id)
    if tactics is None:
        return {"error": f"no tactics recorded for match {match_id!r}"}
    player_names = STATE.get("player_names_by_match", {}).get(match_id, {})

    def _serialize(timeline):
        return {
            "team": timeline.team,
            "starting_formation": timeline.starting_formation,
            "windows": [{"start_min": w.start_min, "end_min": w.end_min, "label": w.label} for w in timeline.windows],
            "shifts": [{"at_min": s.at_min, "from_label": s.from_label, "to_label": s.to_label} for s in timeline.shifts],
            "role_changes": [
                {
                    "player_id": r.player_id, "player_name": player_names.get(r.player_id, r.player_id),
                    "at_min": r.at_min, "from_zone": r.from_zone, "to_zone": r.to_zone,
                }
                for r in timeline.role_changes
            ],
        }

    return {"home": _serialize(tactics["home"]), "away": _serialize(tactics["away"])}


@mcp.tool()
async def simulate_tactics_matchup(
    home_formation: str, away_formation: str, n_matches: int = 50,
    home_quality: float | None = None, away_quality: float | None = None,
) -> dict:
    """Monte-Carlo formation comparison: runs n_matches full synthetic
    matches between two chosen formations and returns the aggregate
    win/draw/loss record, goals, xG, possession, and pressing intensity for
    each side. Valid formations: 4-4-2, 4-3-3, 4-2-3-1, 4-5-1, 3-5-2, 3-4-3.
    Optional home_quality/away_quality (0.7-1.3) compare a big-money squad
    against a shoestring-budget one in the same formation. Pure CPU
    simulation, no LLM calls."""
    from agents.analyst0.tactics_lab import simulate_formation_matchup

    if not 1 <= n_matches <= 200:
        return {"error": "n_matches must be between 1 and 200"}
    try:
        return await asyncio.to_thread(
            simulate_formation_matchup, home_formation, away_formation, n_matches,
            home_quality=home_quality, away_quality=away_quality,
        )
    except ValueError as exc:
        return {"error": str(exc)}


@mcp.tool()
async def get_match_analytics(match_id: str, bucket_min: float = 5.0) -> dict:
    """Ad-hoc, time-bucketed analytics over one match's event stream: PPDA,
    possession, shots, goals, and tempo per time bucket -- a queryable
    series over the same underlying data the narrated insights come from,
    not just the pre-packaged narrations themselves. Only covers matches
    started via POST /matches/run (the demo path)."""
    from agents.analyst0.live_analytics import compute_match_analytics

    events = STATE.get("events_by_match", {}).get(match_id)
    duration_ms = STATE.get("duration_ms_by_match", {}).get(match_id)
    if events is None or duration_ms is None:
        return {"error": f"no analytics data for match {match_id!r}"}
    if not 0.5 <= bucket_min <= 30:
        return {"error": "bucket_min must be between 0.5 and 30"}
    return await asyncio.to_thread(compute_match_analytics, events, duration_ms, bucket_min)


@mcp.tool()
async def get_robustness_scorecard() -> dict:
    """Standalone fact-checking scorecard: deliberately corrupted
    narrations (fabricated numbers, wrong-but-real player names, off-topic
    phrasing) run through the live grounding checker right now, not a
    static claim."""
    r = run_robustness_suite()
    return {
        "corruptions_caught": r.corruptions_caught, "corruptions_total": r.corruptions_total,
        "catch_rate": r.catch_rate, "false_positives": r.false_positives,
        "legitimate_total": r.legitimate_total,
    }


@mcp.tool()
async def ask_match(match_id: str, question: str, locale: str = "en") -> dict:
    """Grounded free-text Q&A over one match's verified insights -- answers
    only from what this pipeline has actually verified for that match,
    never from general football knowledge; says so honestly when the
    answer hasn't come up yet rather than guessing."""
    entries = await asyncio.to_thread(_entries_for, match_id)
    insights = [InsightCandidate(**e.summary) for e in entries if e.stage == "insight"]
    player_names = STATE.get("player_names_by_match", {}).get(match_id, {})
    answer, fact_checked = await qa_ask(question, insights, player_names, locale=locale)
    return {"answer": answer, "fact_checked": fact_checked}
