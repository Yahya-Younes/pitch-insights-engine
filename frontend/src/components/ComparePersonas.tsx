import { useState } from "react";
import { compareMatch } from "../lib/api";
import type { CompareResponse } from "../lib/api";
import { useT } from "../i18n";
import { personaLabel } from "../lib/panelLabels";
import type { LensSummary } from "../lib/types";

interface Props {
  matchId: string | null;
  lenses: LensSummary[];
}

const PERSONAS = ["casual_fan", "analyst", "player_tracker"] as const;

export function ComparePersonas({ matchId, lenses }: Props) {
  const i18n = useT();
  const { t } = i18n;
  const [personaA, setPersonaA] = useState<string>("casual_fan");
  const [personaB, setPersonaB] = useState<string>("analyst");
  const [lensIdA, setLensIdA] = useState<string>("");
  const [lensIdB, setLensIdB] = useState<string>("");
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    if (!matchId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await compareMatch(matchId, personaA, personaB, {
        lensIdA: lensIdA || null, lensIdB: lensIdB || null, locale: i18n.locale,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="feed-panel compare-personas-panel">
      <div className="panel-heading">
        <h2>{t("panels.compare.title")}</h2>
        <span className="panel-tag" title={t("panels.compare.tagTitle")}>
          {t("panels.compare.tag")}
        </span>
      </div>

      {!matchId ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">⇄</span>
          <p>{t("panels.compare.empty")}</p>
        </div>
      ) : (
        <>
          <div className="whatif-knob-row compare-personas-controls">
            <label>
              {t("panels.compare.left")}
              <select value={personaA} onChange={(e) => setPersonaA(e.target.value)}>
                {PERSONAS.map((p) => <option key={p} value={p}>{personaLabel(i18n, p)}</option>)}
              </select>
            </label>
            <label>
              {t("panels.compare.lensLeft")}
              <select value={lensIdA} onChange={(e) => setLensIdA(e.target.value)}>
                <option value="">{t("panels.compare.none")}</option>
                {lenses.map((l) => <option key={l.lens_id} value={l.lens_id}>{l.attributed_style_of}</option>)}
              </select>
            </label>
            <label>
              {t("panels.compare.right")}
              <select value={personaB} onChange={(e) => setPersonaB(e.target.value)}>
                {PERSONAS.map((p) => <option key={p} value={p}>{personaLabel(i18n, p)}</option>)}
              </select>
            </label>
            <label>
              {t("panels.compare.lensRight")}
              <select value={lensIdB} onChange={(e) => setLensIdB(e.target.value)}>
                <option value="">{t("panels.compare.none")}</option>
                {lenses.map((l) => <option key={l.lens_id} value={l.lens_id}>{l.attributed_style_of}</option>)}
              </select>
            </label>
            <button className="ask-button" onClick={handleRun} disabled={busy}>
              {busy ? <span className="spinner" /> : t("panels.compare.run")}
            </button>
          </div>

          {error && <p className="error" role="alert">{error}</p>}

          {result && (
            <div className="compare-personas-result commentary-in">
              <div className="compare-personas-column">
                <h3>{personaLabel(i18n, result.left.persona)}{result.left.lens_id ? ` · ${result.left.lens_id}` : ""}</h3>
                <p>{result.left.text}</p>
              </div>
              <div className="compare-personas-column">
                <h3>{personaLabel(i18n, result.right.persona)}{result.right.lens_id ? ` · ${result.right.lens_id}` : ""}</h3>
                <p>{result.right.text}</p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
