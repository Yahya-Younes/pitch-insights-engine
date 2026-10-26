import { useState } from "react";
import { compareMatch } from "../lib/api";
import type { CompareResponse } from "../lib/api";
import { personaFr } from "../lib/frLabels";
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
        <h2>Comparer les profils</h2>
        <span
          className="panel-tag"
          title="Les insights actuels du même match, personnalisés de deux façons côte à côte -- le même appel de récap que la vue à profil unique, simplement lancé deux fois en parallèle."
        >
          écran partagé
        </span>
      </div>

      {!matchId ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">⇄</span>
          <p>Lance d'abord un match, puis compare deux façons de le raconter côte à côte.</p>
        </div>
      ) : (
        <>
          <div className="whatif-knob-row compare-personas-controls">
            <label>
              Gauche
              <select value={personaA} onChange={(e) => setPersonaA(e.target.value)}>
                {PERSONAS.map((p) => <option key={p} value={p}>{personaFr(p)}</option>)}
              </select>
            </label>
            <label>
              Lentille (gauche)
              <select value={lensIdA} onChange={(e) => setLensIdA(e.target.value)}>
                <option value="">Aucune</option>
                {lenses.map((l) => <option key={l.lens_id} value={l.lens_id}>{l.attributed_style_of}</option>)}
              </select>
            </label>
            <label>
              Droite
              <select value={personaB} onChange={(e) => setPersonaB(e.target.value)}>
                {PERSONAS.map((p) => <option key={p} value={p}>{personaFr(p)}</option>)}
              </select>
            </label>
            <label>
              Lentille (droite)
              <select value={lensIdB} onChange={(e) => setLensIdB(e.target.value)}>
                <option value="">Aucune</option>
                {lenses.map((l) => <option key={l.lens_id} value={l.lens_id}>{l.attributed_style_of}</option>)}
              </select>
            </label>
            <button className="ask-button" onClick={handleRun} disabled={busy}>
              {busy ? <span className="spinner" /> : "Comparer"}
            </button>
          </div>

          {error && <p className="error" role="alert">{error}</p>}

          {result && (
            <div className="compare-personas-result commentary-in">
              <div className="compare-personas-column">
                <h3>{personaFr(result.left.persona)}{result.left.lens_id ? ` · ${result.left.lens_id}` : ""}</h3>
                <p>{result.left.text}</p>
              </div>
              <div className="compare-personas-column">
                <h3>{personaFr(result.right.persona)}{result.right.lens_id ? ` · ${result.right.lens_id}` : ""}</h3>
                <p>{result.right.text}</p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
