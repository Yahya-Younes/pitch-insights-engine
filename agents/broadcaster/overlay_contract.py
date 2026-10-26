"""The published overlay contract for graphics/rendering partners.

Two things live here:
  * overlay_contract() -- RenderPayload's JSON Schema plus a short, factual
    description of its timing semantics. Every field it describes exists on
    agents.shared.models.RenderPayload / RenderDisplay; nothing is invented.
  * overlay_feed() -- one match's overlay payloads as a single, downloadable,
    deterministic JSON document.

Why the feed is *rebuilt* rather than replayed: the Broadcaster's handoff-log
entry records only a summary (render_id, graphic_type, template,
fact_checked), not the full payload. Every "insight" entry, though, carries
the complete InsightCandidate plus the exact narrative_text and fact_checked
flag the Broadcaster received, and build_render_payload() is a pure function
of those -- so re-running it reproduces the live payload field-for-field,
except two fields that are documented as such: render_id (live = random
uuid4; here = uuid5 of the source insight id, so the feed is stable across
downloads) and audio_base64 (attached at publish time only; always null here).
"""
from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from agents.broadcaster.render import (
    _DEFAULT_DURATION_MS,
    _DEFAULT_PRIORITY,
    _DURATION_MS_BY_TRIGGER,
    _PRIORITY_BY_TRIGGER,
    _TEMPLATE_BY_TRIGGER,
    build_render_payload,
)
from agents.shared.handoff_log import HandoffEntry
from agents.shared.models import InsightCandidate, RenderPayload

CONTRACT_VERSION = "1.0"
_RENDER_ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "pitch-insights-engine/overlay")


def overlay_contract() -> dict[str, Any]:
    return {
        "contract_version": CONTRACT_VERSION,
        "payload_model": "RenderPayload",
        "transport": {
            "live": (
                "Azure Web PubSub, hub 'pitch_overlay' (GET /negotiate returns a client URL). Each message is "
                "{\"kind\": \"render\", \"data\": <RenderPayload>}; persona recaps arrive separately as "
                "{\"kind\": \"personalized\", ...} and are not overlay payloads."
            ),
            "replay": "GET /matches/{match_id}/overlay-feed -- the whole match as one JSON file, sorted by game_clock.",
        },
        "timing": {
            "game_clock": (
                "'MM:SS' match clock at the start of the insight's evidence window (InsightCandidate.window_start_min). "
                "Minutes run continuously (a second-half moment reads e.g. '67:30'); there is no period field."
            ),
            "display.duration_ms": (
                "How long the graphic should stay on screen once shown: "
                f"{_DURATION_MS_BY_TRIGGER} by graphic_type, otherwise {_DEFAULT_DURATION_MS}."
            ),
            "display.priority": (
                "Integer, lower = more important: "
                f"{_PRIORITY_BY_TRIGGER} by graphic_type, otherwise {_DEFAULT_PRIORITY}. Advisory -- the engine "
                "does not arbitrate overlapping graphics; collision handling is the renderer's call."
            ),
            "display.template": (
                f"Renderer template id chosen by graphic_type: {_TEMPLATE_BY_TRIGGER}; "
                "unknown types use 'generic_insight_card'."
            ),
            "positioning": "Not part of the contract -- payloads carry no screen position or layout field; placement is the renderer's.",
        },
        "semantics": {
            "graphic_type": "The Analyst-0 trigger that produced the insight.",
            "data_points": "[{label, value}] -- the triggering metric, then baseline / delta_pct when present, "
                           "then the insight's window_summary keys. Every value is computed, never LLM-written.",
            "narrative_text": "LLM narration that passed the live grounding check, or a deterministic fallback.",
            "fact_checked": "false means the LLM text failed verification (or the LLM was unavailable) and "
                            "narrative_text is the deterministic fallback -- renderers may badge it.",
            "linked_players": "Player ids (e.g. 'home_9') referenced by the insight.",
            "source_insight_id": "Stable id of the InsightCandidate -- the join key back to /matches/{id}/handoff.",
            "render_id": "Unique per payload. In the replay feed it is uuid5(source_insight_id), stable across "
                         "downloads; the live Web PubSub payload carries a random uuid4 instead.",
            "audio_base64": "Optional mp3 narration attached at publish time when Azure AI Speech is configured; "
                            "always null in the replay feed.",
        },
        "versioning": "Additive changes (new optional fields) keep the major version; removals/renames bump it.",
    }


def overlay_schema_document() -> dict[str, Any]:
    return {"schema": RenderPayload.model_json_schema(), "contract": overlay_contract()}


def _payload_from_insight_entry(summary: dict[str, Any]) -> RenderPayload | None:
    try:
        insight = InsightCandidate.model_validate(
            {k: v for k, v in summary.items() if k in InsightCandidate.model_fields},
        )
    except Exception:
        return None
    payload = build_render_payload(
        insight, str(summary.get("narrative_text", "")), fact_checked=bool(summary.get("fact_checked", True)),
    )
    payload.render_id = uuid.uuid5(_RENDER_ID_NAMESPACE, insight.insight_id).hex
    return payload


def overlay_feed(match_id: str, entries: Iterable[HandoffEntry]) -> dict[str, Any]:
    latest: dict[str, tuple[float, RenderPayload]] = {}
    for e in entries:
        if e.stage != "insight" or e.match_id != match_id:
            continue
        payload = _payload_from_insight_entry(e.summary or {})
        if payload is not None:  # a resumed run may re-record an insight: keep the latest
            latest[payload.source_insight_id] = (float(e.summary.get("window_start_min", 0.0)), payload)
    ordered = sorted(latest.values(), key=lambda t: (t[0], t[1].display.priority, t[1].source_insight_id))
    return {
        "contract_version": CONTRACT_VERSION,
        "match_id": match_id,
        "payload_count": len(ordered),
        "payloads": [p.model_dump(mode="json") for _, p in ordered],
    }
