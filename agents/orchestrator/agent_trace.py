"""Per-agent rollup of one match's shared handoff log -- the data behind the
"Agent team, live" panel (GET /matches/{id}/agent-trace).

Pure and deterministic: everything here is derived from HandoffEntry rows the
five executors already write (plus the additive "duration_ms" / "path" /
"llm_attempts" / "grounding_failed" keys they record for exactly this view).
Nothing is estimated -- an older entry written before those keys existed
contributes what it can (counts, fact_checked) and leaves timing/LLM-call
figures as None rather than guessing them.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from agents.shared.handoff_log import HandoffEntry

PIPELINE_STAGES: tuple[str, ...] = ("scout", "analyst0", "narrator", "broadcaster", "concierge")

_AGENT_META: dict[str, dict[str, str]] = {
    "scout": {
        "name": "Scout", "kind": "deterministic",
        "role": "Ingests the raw event feed and rejects malformed events before anything downstream sees them.",
    },
    "analyst0": {
        "name": "Analyst-0", "kind": "deterministic",
        "role": "Computes pressure, xT, tempo and tendency metrics and emits grounded insight candidates.",
    },
    "narrator": {
        "name": "Narrator", "kind": "llm+verifier",
        "role": "Explains each insight with an LLM; a grounding check rejects any unsupported number or name.",
    },
    "broadcaster": {
        "name": "Broadcaster", "kind": "deterministic",
        "role": "Turns each narrated insight into a timed, machine-readable overlay payload for graphics.",
    },
    "concierge": {
        "name": "Concierge", "kind": "llm+verifier",
        "role": "Rewrites each insight for the viewer's persona, re-verified against the same evidence.",
    },
}

_FAILED_STAGES = {"narrator_failed": "narrator", "concierge_failed": "concierge"}
DEFAULT_TIMELINE_LIMIT = 50


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _path(stage: str, summary: dict[str, Any]) -> str:
    path = summary.get("path")
    if path in ("llm", "fallback", "rules"):
        return path
    if stage in ("narrator", "concierge"):  # legacy entry: infer from what actually shipped
        return "llm" if summary.get("fact_checked", True) else "fallback"
    return "rules"


def _label(stage: str, s: dict[str, Any], path: str) -> str:
    if stage == "scout":
        return f"Validated {s.get('accepted', 0)} events, rejected {s.get('rejected', 0)}"
    if stage == "analyst0":
        return f"{s.get('insight_count', 0)} insight candidates from {s.get('events_processed', 0)} events"
    if stage == "broadcaster":
        return f"Rendered {s.get('template', 'overlay')} overlay"
    subject = str(s.get("trigger_type") or "insight").replace("_", " ")
    if stage == "concierge":
        subject = f"{str(s.get('persona') or 'persona').replace('_', ' ')} recap"
    if path == "llm":
        return f"{'Narrated' if stage == 'narrator' else 'Personalized'} {subject} (verified)"
    if s.get("grounding_failed"):
        verb = "deterministic template" if stage == "narrator" else "narrator's verified text"
        return f"{subject}: grounding check rejected LLM text, shipped {verb}"
    if s.get("llm_attempts") == 2:
        return f"{subject}: LLM failed twice, fell back"
    return f"{subject}: fell back"


def build_agent_trace(
    entries: Iterable[HandoffEntry], timeline_limit: int = DEFAULT_TIMELINE_LIMIT,
) -> dict[str, Any]:
    """Rolls one match's handoff entries up into per-agent counters, a
    bounded relative-time timeline and match totals. Entries for stages
    outside the 5-agent pipeline (e.g. "qa", "insight") never appear as
    agents or timeline rows; "insight" rows only feed totals."""
    rows = sorted(entries, key=lambda e: e.timestamp)  # stable: ties keep record order
    start_ts = rows[0].timestamp if rows else None

    acc: dict[str, dict[str, Any]] = {
        stage: {"processed": 0, "outputs": 0, "llm_calls": 0, "llm_calls_known": False,
                "fallbacks": 0, "grounding_failures": 0, "hard_failures": 0,
                "durations": [], "last": None}
        for stage in PIPELINE_STAGES
    }
    insight_ids: set[str] = set()
    timeline: list[dict[str, Any]] = []

    for e in rows:
        s = e.summary or {}
        if e.stage == "insight":
            insight_ids.add(str(s.get("insight_id")))
            continue
        if e.stage in _FAILED_STAGES:
            acc[_FAILED_STAGES[e.stage]]["hard_failures"] += 1
            continue
        if e.stage not in acc:
            continue
        a = acc[e.stage]
        path = _path(e.stage, s)
        if e.stage == "scout":
            a["processed"] += int(s.get("accepted", 0)) + int(s.get("rejected", 0))
            a["outputs"] += int(s.get("accepted", 0))
        elif e.stage == "analyst0":
            a["processed"] += int(s.get("events_processed", 0))
            a["outputs"] += int(s.get("insight_count", 0))
        else:
            a["processed"] += 1
            a["outputs"] += 1
        if (attempts := _num(s.get("llm_attempts"))) is not None:
            a["llm_calls"] += int(attempts)
            a["llm_calls_known"] = True
        if path == "fallback":
            a["fallbacks"] += 1
        if s.get("grounding_failed"):
            a["grounding_failures"] += 1
        if (dur := _num(s.get("duration_ms"))) is not None:
            a["durations"].append(dur)
        a["last"] = e.timestamp

        row: dict[str, Any] = {
            "t": round(e.timestamp - start_ts, 3) if start_ts is not None else 0,
            "stage": e.stage, "label": _label(e.stage, s, path), "path": path,
        }
        if s.get("insight_id"):
            row["insight_id"] = s["insight_id"]
        if (dur := _num(s.get("duration_ms"))) is not None:
            row["duration_ms"] = dur
        timeline.append(row)

    agents = []
    for stage in PIPELINE_STAGES:
        a, meta = acc[stage], _AGENT_META[stage]
        is_llm = meta["kind"] != "deterministic"
        durations = a["durations"]
        agents.append({
            "stage": stage, "name": meta["name"], "role": meta["role"], "kind": meta["kind"],
            "processed": a["processed"], "outputs": a["outputs"],
            # Deterministic agents make no LLM calls by construction; for LLM
            # agents an entry without "llm_attempts" (pre-instrumentation)
            # leaves the count unknown rather than guessed.
            "llm_calls": (a["llm_calls"] if a["llm_calls_known"] else None) if is_llm else 0,
            "fallbacks": a["fallbacks"], "grounding_failures": a["grounding_failures"],
            "llm_outages": a["hard_failures"],
            "avg_duration_ms": round(sum(durations) / len(durations), 2) if durations else None,
            "last_activity_ts": a["last"],
        })

    by = {ag["stage"]: ag for ag in agents}
    narrator, concierge = acc["narrator"], acc["concierge"]
    llm_known = [by[s]["llm_calls"] for s in ("narrator", "concierge") if by[s]["llm_calls"] is not None]
    totals = {
        "insights": len(insight_ids) if insight_ids else narrator["outputs"],
        "verified": narrator["outputs"] - narrator["fallbacks"],
        "fell_back": narrator["fallbacks"],
        "persona_fallbacks": concierge["fallbacks"],
        "grounding_failures": narrator["grounding_failures"] + concierge["grounding_failures"],
        "llm_outages": narrator["hard_failures"] + concierge["hard_failures"],
        "llm_calls": sum(llm_known) if llm_known else None,
        "overlays": acc["broadcaster"]["outputs"],
        "handoffs": len(timeline),
        "elapsed_s": round(rows[-1].timestamp - start_ts, 3) if rows and start_ts is not None else 0,
    }
    return {
        "agents": agents,
        "timeline": timeline[-timeline_limit:] if timeline_limit > 0 else [],
        "totals": totals,
        "started_at": start_ts,
    }
