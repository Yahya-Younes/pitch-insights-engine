# Overlay contract (v2.0)

Pitch Insights Engine's **Broadcaster** agent turns every narrated insight into a
timed, machine-readable overlay payload (`RenderPayload`) that a graphics/rendering
partner can consume without knowing anything about the agents upstream. This page
is the human-readable version of the contract; the machine-readable version is
served live:

| Endpoint | What it returns |
|---|---|
| `GET /overlay/schema` | `{ "schema": <RenderPayload JSON Schema>, "contract": { ...timing & semantics... } }` |
| `GET /matches/{match_id}/overlay-feed` | One match's payloads as a downloadable JSON file (`Content-Disposition: attachment`), sorted by `game_clock` |
| `GET /negotiate` | A client URL for the live Azure Web PubSub hub `pitch_overlay` |

Source of truth: `agents/shared/models.py` (`RenderPayload`, `RenderDisplay`),
`agents/broadcaster/render.py` (the deterministic builder) and
`agents/broadcaster/overlay_contract.py` (the published contract).

## Transport

- **Live** — Azure Web PubSub. Each overlay arrives as
  `{"kind": "render", "data": <RenderPayload>}`. Messages with `"kind": "personalized"`
  are persona recaps for the companion app, not overlays. Each message is pushed as
  soon as its insight is narrated and checked, not at the end of the match.
- **Replay** — `GET /matches/{match_id}/overlay-feed`. Rebuilt from the shared handoff
  log with the same pure `build_render_payload()` the live Broadcaster uses, so every
  field matches the live payload except `render_id` and `audio_url` (see below).

## Fields

| Field | Type | Meaning |
|---|---|---|
| `render_id` | string | Unique per payload. Live: random uuid4. Replay feed: `uuid5(source_insight_id)`, so it is stable across downloads. |
| `match_id` | string | Match the overlay belongs to. |
| `game_clock` | `"MM:SS"` | Match clock at the **start** of the insight's evidence window. Minutes run continuously (a second-half moment reads `"67:30"`); there is no separate period field. |
| `graphic_type` | string | The Analyst-0 trigger: `pressure_spike`, `chaos_shift`, `rhythm_change`, `xt_surge`, `milestone`, `referee_decision`, `tendency_match`, `tendency_break`. |
| `narrative_text` | string | LLM narration that passed the live grounding check, or the deterministic fallback sentence. |
| `display.template` | string | Renderer template id (table below); unknown types use `generic_insight_card`. |
| `display.duration_ms` | int | How long to keep the graphic on screen once shown. |
| `display.priority` | int | Lower = more important. Advisory: the engine does not arbitrate overlapping graphics. |
| `data_points` | `[{label, value}]` | The triggering metric, then `baseline` / `delta_pct` when present, then the insight's window summary. All computed, never LLM-written. |
| `linked_players` | string[] | Player ids (e.g. `home_9`) referenced by the insight. |
| `source_insight_id` | string | Join key back to `GET /matches/{id}/handoff` and the agent trace. |
| `fact_checked` | bool | `false` means the LLM text failed verification (or the LLM was unavailable) and `narrative_text` is the deterministic fallback, so a renderer may badge it. |
| `audio_url` | string \| null | Path of the mp3 narration on the API (`/audio/<clip_id>`), attached at publish time when Azure AI Speech is configured. The clip is synthesized on first request and kept out of the message itself, which stays a few KB. Always `null` in the replay feed. |

There is **no screen-position or layout field**. Placement is the renderer's
decision, driven by `display.template`.

### Template / timing table (from `agents/broadcaster/render.py`)

| `graphic_type` | `display.template` | `duration_ms` | `priority` |
|---|---|---|---|
| `milestone` | `goal_banner` | 6000 | 1 |
| `referee_decision` | `referee_positioning_card` | 5000 | 2 |
| `pressure_spike` | `pressing_intensity_card` | 4000 | 5 |
| `chaos_shift` | `momentum_meter` | 4000 | 5 |
| `rhythm_change` | `tempo_graph` | 4000 | 5 |
| `xt_surge` | `threat_zone_highlight` | 4000 | 5 |
| `tendency_match` / `tendency_break` | `player_tendency_card` | 4000 | 5 |

## Example payload

This is a real payload from `GET /matches/DEMO-DOC-7/overlay-feed`, produced by an offline
run of the full pipeline on simulated match seed 7 (first 30 minutes). Narration in
that run was the deterministic fallback sentence, not a Foundry call.

```json
{
  "render_id": "fac919b3061051f6aaf686c32a465483",
  "match_id": "DEMO-DOC-7",
  "game_clock": "28:05",
  "graphic_type": "milestone",
  "narrative_text": "A goal-level milestone was recorded: goal reached 1.0.",
  "display": { "template": "goal_banner", "duration_ms": 6000, "priority": 1 },
  "data_points": [
    { "label": "goal", "value": 1.0 },
    { "label": "team", "value": "away" },
    { "label": "xg", "value": 0.346 }
  ],
  "linked_players": ["away_11"],
  "source_insight_id": "dd8017e53ec340db9e43f4175ab1a4e4",
  "fact_checked": true,
  "audio_url": null
}
```

The replay feed wraps payloads as
`{"contract_version": "2.0", "match_id": ..., "payload_count": N, "payloads": [...]}`.

## Versioning

Adding a new optional field keeps the major version. Removing or renaming a field
bumps it. The version is reported as `contract.contract_version` by `/overlay/schema`
and as `contract_version` in every feed file.
