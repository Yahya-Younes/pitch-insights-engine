import { useState } from "react";
import { compareMatch } from "../lib/api";
import type { CompareResponse } from "../lib/api";
import type { LensSummary } from "../lib/types";

interface Props {
  matchId: string | null;
  lenses: LensSummary[];
}

const PERSONAS = ["casual_fan", "analyst", "player_tracker"] as const;

export function ComparePersonas({ matchId, lenses }: Props) {
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
        lensIdA: lensIdA || null, lensIdB: lensIdB || null,
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
        <h2>Compare Personas</h2>
        <span
          className="panel-tag"
          title="The same match's current insights, personalized two different ways side by side -- reuses the same whole-match recap call a single-persona view already uses, just run twice concurrently."
        >
          split screen
        </span>
      </div>

      {!matchId ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">⇄</span>
          <p>Run a match first, then compare two ways of explaining it side by side.</p>
        </div>
      ) : (
        <>
          <div className="whatif-knob-row compare-personas-controls">
            <label>
              Left
              <select value={personaA} onChange={(e) => setPersonaA(e.target.value)}>
                {PERSONAS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>
              Lens (left)
              <select value={lensIdA} onChange={(e) => setLensIdA(e.target.value)}>
                <option value="">none</option>
                {lenses.map((l) => <option key={l.lens_id} value={l.lens_id}>{l.attributed_style_of}</option>)}
              </select>
            </label>
            <label>
              Right
              <select value={personaB} onChange={(e) => setPersonaB(e.target.value)}>
                {PERSONAS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>
              Lens (right)
              <select value={lensIdB} onChange={(e) => setLensIdB(e.target.value)}>
                <option value="">none</option>
                {lenses.map((l) => <option key={l.lens_id} value={l.lens_id}>{l.attributed_style_of}</option>)}
              </select>
            </label>
            <button className="ask-button" onClick={handleRun} disabled={busy}>
              {busy ? <span className="spinner" /> : "Compare"}
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          {result && (
            <div className="compare-personas-result commentary-in">
              <div className="compare-personas-column">
                <h3>{result.left.persona}{result.left.lens_id ? ` · ${result.left.lens_id}` : ""}</h3>
                <p>{result.left.text}</p>
              </div>
              <div className="compare-personas-column">
                <h3>{result.right.persona}{result.right.lens_id ? ` · ${result.right.lens_id}` : ""}</h3>
                <p>{result.right.text}</p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
