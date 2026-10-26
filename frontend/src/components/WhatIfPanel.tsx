import { useState } from "react";
import { whatIf } from "../lib/api";
import { frRaw, triggerFr } from "../lib/frLabels";
import type { RenderPayload } from "../lib/types";
import { VoiceButton } from "./VoiceButton";

interface Props {
  matchId: string | null;
  insights: RenderPayload[];
}

// Only these trigger_types (== RenderPayload.graphic_type, set 1:1 from
// InsightCandidate.trigger_type by the Broadcaster) have per-event data
// rich enough for a real counterfactual -- pressure_spike/chaos_shift/
// rhythm_change are team/window-level aggregates with no single action to
// vary, so they're left out of this dropdown entirely rather than offering
// a what-if that would just 400.
const SUPPORTED_TYPES = new Set(["xt_surge", "referee_decision", "tendency_match", "tendency_break"]);

const ACTION_OPTIONS = ["pass", "dribble", "carry", "lose_possession"];
const ACTION_FR: Record<string, string> = {
  pass: "Passe", dribble: "Dribble", carry: "Conduite de balle", lose_possession: "Perte de balle",
};

interface WhatIfResultState {
  actual_value: number;
  hypothetical_value: number;
  delta: number;
  explanation: string;
  audioBase64: string | null;
}

export function WhatIfPanel({ matchId, insights }: Props) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [endX, setEndX] = useState(100);
  const [endY, setEndY] = useState(40);
  const [distanceM, setDistanceM] = useState(5);
  const [angleDeg, setAngleDeg] = useState(10);
  const [action, setAction] = useState("pass");
  const [result, setResult] = useState<WhatIfResultState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = insights.filter((p) => SUPPORTED_TYPES.has(p.graphic_type));
  const selected = candidates.find((p) => p.source_insight_id === selectedId) ?? null;

  async function handleRun() {
    if (!matchId || !selected) return;
    setBusy(true);
    setError(null);
    try {
      let knob: Record<string, unknown> = {};
      if (selected.graphic_type === "xt_surge") knob = { end_x: endX, end_y: endY };
      else if (selected.graphic_type === "referee_decision") knob = { distance_m: distanceM, angle_deg: angleDeg };
      else knob = { actual_action: action };

      const res = await whatIf(matchId, selected.source_insight_id, knob);
      setResult({ ...res, audioBase64: res.audio_base64 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="feed-panel whatif-panel">
      <div className="panel-heading">
        <h2>Et si… ?</h2>
        <span
          className="panel-tag"
          title="Relance la même fonction déterministe d'Analyste-0 qui a produit la vraie métrique de l'insight, sur une entrée hypothétique que tu choisis -- un chiffre recalculé, pas une supposition de LLM."
        >
          scénario contrefactuel
        </span>
      </div>

      {!matchId || candidates.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">🔁</span>
          <p>
            {matchId
              ? "Pas encore d'insight de menace (xT), de décision arbitrale ou de tendance sur lequel tester un scénario."
              : "Lance d'abord un match, puis teste un scénario alternatif sur l'un de ses insights."}
          </p>
        </div>
      ) : (
        <>
          <div className="whatif-row">
            <select
              className="whatif-select"
              aria-label="Insight à tester"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setResult(null);
              }}
            >
              <option value="">Choisis un insight…</option>
              {candidates.map((p) => (
                <option key={p.source_insight_id} value={p.source_insight_id}>
                  [{triggerFr(p.graphic_type)}] {p.narrative_text.slice(0, 60)}
                  {p.narrative_text.length > 60 ? "…" : ""}
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <div className="whatif-knob-row">
              {selected.graphic_type === "xt_surge" && (
                <>
                  <label>
                    x d'arrivée
                    <input type="number" min={0} max={120} value={endX} onChange={(e) => setEndX(Number(e.target.value))} />
                  </label>
                  <label>
                    y d'arrivée
                    <input type="number" min={0} max={80} value={endY} onChange={(e) => setEndY(Number(e.target.value))} />
                  </label>
                </>
              )}
              {selected.graphic_type === "referee_decision" && (
                <>
                  <label>
                    distance (m)
                    <input type="number" min={0} max={40} value={distanceM} onChange={(e) => setDistanceM(Number(e.target.value))} />
                  </label>
                  <label>
                    angle (°)
                    <input type="number" min={0} max={90} value={angleDeg} onChange={(e) => setAngleDeg(Number(e.target.value))} />
                  </label>
                </>
              )}
              {(selected.graphic_type === "tendency_match" || selected.graphic_type === "tendency_break") && (
                <label>
                  action hypothétique
                  <select value={action} onChange={(e) => setAction(e.target.value)}>
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a} value={a}>{ACTION_FR[a] ?? a}</option>
                    ))}
                  </select>
                </label>
              )}
              <button className="ask-button" onClick={handleRun} disabled={busy}>
                {busy ? <span className="spinner" /> : "Lancer le scénario"}
              </button>
            </div>
          )}

          {error && <p className="error" role="alert">{error}</p>}

          {result && (
            <div className="whatif-result commentary-in">
              <p className="whatif-explanation">{result.explanation}</p>
              <div className="whatif-values">
                <span>réel : {frRaw(result.actual_value)}</span>
                <span>hypothétique : {frRaw(result.hypothetical_value)}</span>
                <span className={result.delta >= 0 ? "whatif-delta-up" : "whatif-delta-down"}>
                  {result.delta >= 0 ? "+" : ""}{frRaw(result.delta)}
                </span>
              </div>
              <VoiceButton audioBase64={result.audioBase64} autoPlay={false} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
