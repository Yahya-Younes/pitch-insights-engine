import { useState } from "react";
import { whatIf } from "../lib/api";
import { useT, type I18n } from "../i18n";
import { rawNum, triggerLabel } from "../lib/panelLabels";
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

interface Knob {
  endX: number;
  endY: number;
  distanceM: number;
  angleDeg: number;
  action: string;
}

interface WhatIfResultState {
  graphicType: string;
  knob: Knob;
  actual_value: number;
  hypothetical_value: number;
  delta: number;
  explanation: string;
  audioBase64: string | null;
}

/** The backend's explanation is English-only; rebuild the same sentence from
 * the structured result and the knob the viewer chose, in the page language. */
function explain(i18n: I18n, r: WhatIfResultState): string {
  const dir = r.delta > 0 ? "up" : r.delta < 0 ? "down" : "same";
  if (r.graphicType === "xt_surge") {
    return i18n.t(`panels.whatif.explain.xt.${dir}`, {
      x: i18n.num(r.knob.endX), y: i18n.num(r.knob.endY), delta: i18n.num(Math.abs(r.delta), 3),
      from: i18n.num(r.actual_value, 3), to: i18n.num(r.hypothetical_value, 3),
    });
  }
  if (r.graphicType === "referee_decision") {
    return i18n.t(`panels.whatif.explain.ref.${dir}`, {
      d: i18n.num(r.knob.distanceM, 1), a: i18n.num(r.knob.angleDeg),
      from: i18n.num(r.actual_value, 2), to: i18n.num(r.hypothetical_value, 2),
    });
  }
  if (r.graphicType === "tendency_match" || r.graphicType === "tendency_break") {
    return i18n.t(`panels.whatif.explain.tendency.${dir}`, {
      action: i18n.t(`panels.whatif.action.${r.knob.action}`),
      from: i18n.num(r.actual_value, 2), to: i18n.num(r.hypothetical_value, 2),
    });
  }
  return r.explanation;
}

export function WhatIfPanel({ matchId, insights }: Props) {
  const i18n = useT();
  const { t } = i18n;
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
      setResult({
        ...res,
        graphicType: selected.graphic_type,
        knob: { endX, endY, distanceM, angleDeg, action },
        audioBase64: res.audio_base64,
      });
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
        <h2>{t("panels.whatif.title")}</h2>
        <span className="panel-tag" title={t("panels.whatif.tagTitle")}>
          {t("panels.whatif.tag")}
        </span>
      </div>

      {!matchId || candidates.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">🔁</span>
          <p>{t(matchId ? "panels.whatif.emptyNoInsight" : "panels.whatif.emptyNoMatch")}</p>
        </div>
      ) : (
        <>
          <div className="whatif-row">
            <select
              className="whatif-select"
              aria-label={t("panels.whatif.selectAria")}
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setResult(null);
              }}
            >
              <option value="">{t("panels.whatif.choose")}</option>
              {candidates.map((p) => (
                <option key={p.source_insight_id} value={p.source_insight_id}>
                  [{triggerLabel(i18n, p.graphic_type)}] {p.narrative_text.slice(0, 60)}
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
                    {t("panels.whatif.endX")}
                    <input type="number" min={0} max={120} value={endX} onChange={(e) => setEndX(Number(e.target.value))} />
                  </label>
                  <label>
                    {t("panels.whatif.endY")}
                    <input type="number" min={0} max={80} value={endY} onChange={(e) => setEndY(Number(e.target.value))} />
                  </label>
                </>
              )}
              {selected.graphic_type === "referee_decision" && (
                <>
                  <label>
                    {t("panels.whatif.distance")}
                    <input type="number" min={0} max={40} value={distanceM} onChange={(e) => setDistanceM(Number(e.target.value))} />
                  </label>
                  <label>
                    {t("panels.whatif.angle")}
                    <input type="number" min={0} max={90} value={angleDeg} onChange={(e) => setAngleDeg(Number(e.target.value))} />
                  </label>
                </>
              )}
              {(selected.graphic_type === "tendency_match" || selected.graphic_type === "tendency_break") && (
                <label>
                  {t("panels.whatif.action")}
                  <select value={action} onChange={(e) => setAction(e.target.value)}>
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a} value={a}>{t(`panels.whatif.action.${a}`)}</option>
                    ))}
                  </select>
                </label>
              )}
              <button className="ask-button" onClick={handleRun} disabled={busy}>
                {busy ? <span className="spinner" /> : t("panels.whatif.run")}
              </button>
            </div>
          )}

          {error && <p className="error" role="alert">{error}</p>}

          {result && (
            <div className="whatif-result commentary-in">
              <p className="whatif-explanation">{explain(i18n, result)}</p>
              <div className="whatif-values">
                <span>{t("panels.whatif.actual", { v: rawNum(i18n, result.actual_value) })}</span>
                <span>{t("panels.whatif.hypothetical", { v: rawNum(i18n, result.hypothetical_value) })}</span>
                <span className={result.delta >= 0 ? "whatif-delta-up" : "whatif-delta-down"}>
                  {result.delta >= 0 ? "+" : ""}{rawNum(i18n, result.delta)}
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
