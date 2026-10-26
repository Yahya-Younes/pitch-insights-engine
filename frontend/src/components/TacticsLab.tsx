import { useEffect, useState } from "react";
import { fetchFormations, simulateTacticsMatchup } from "../lib/api";
import type { TacticsLabResult } from "../lib/api";
import { frNum, frRaw } from "../lib/frLabels";

const QUALITY_PRESETS: { value: string; label: string }[] = [
  { value: "random", label: "Valeur d'effectif aléatoire" },
  { value: "big_money", label: "Effectif millionnaire" },
  { value: "mid_table", label: "Effectif de milieu de tableau" },
  { value: "shoestring", label: "Effectif à petit budget" },
];

function presetToQuality(preset: string, min: number, max: number): number | null {
  if (preset === "big_money") return max;
  if (preset === "mid_table") return (min + max) / 2;
  if (preset === "shoestring") return min;
  return null; // "random"
}

function formatEur(value: number): string {
  if (value >= 1_000_000_000) return `${frNum(value / 1_000_000_000, 2)} Md€`;
  if (value >= 1_000_000) return `${frNum(value / 1_000_000, 1)} M€`;
  return `${frNum(value / 1000, 0)} k€`;
}

export function TacticsLab() {
  const [formations, setFormations] = useState<string[]>([]);
  const [qualityMin, setQualityMin] = useState(0.7);
  const [qualityMax, setQualityMax] = useState(1.3);
  const [home, setHome] = useState("4-3-3");
  const [away, setAway] = useState("4-5-1");
  const [homePreset, setHomePreset] = useState("random");
  const [awayPreset, setAwayPreset] = useState("random");
  const [nMatches, setNMatches] = useState(50);
  const [result, setResult] = useState<TacticsLabResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFormations()
      .then((r) => { setFormations(r.formations); setQualityMin(r.quality_min); setQualityMax(r.quality_max); })
      .catch(() => setFormations([]));
  }, []);

  async function handleRun() {
    setBusy(true);
    setError(null);
    try {
      const r = await simulateTacticsMatchup(
        home, away, nMatches,
        presetToQuality(homePreset, qualityMin, qualityMax),
        presetToQuality(awayPreset, qualityMin, qualityMax),
      );
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="feed-panel tactics-lab-panel">
      <div className="panel-heading">
        <h2>Labo tactique</h2>
        <span
          className="panel-tag"
          title="Comparaison de systèmes par Monte-Carlo : simule N matchs synthétiques complets de 90 minutes entre deux systèmes choisis (et, en option, deux valeurs d'effectif volontairement différentes), puis donne le bilan victoires/nuls/défaites, les buts, les xG, la possession et l'intensité du pressing -- pas le résultat d'un seul match. La valeur d'effectif agit directement sur les attributs qui décident des tirs et des passes : un écart de valeur est un vrai avantage mesurable. Simulation CPU pure, sans LLM."
        >
          Monte-Carlo &middot; {result ? `${result.n_matches} matchs` : "sans LLM"}
        </span>
      </div>

      <div className="whatif-knob-row tactics-lab-controls">
        <label>
          Système domicile
          <select value={home} onChange={(e) => { setHome(e.target.value); setResult(null); }}>
            {formations.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          Effectif domicile
          <select value={homePreset} onChange={(e) => { setHomePreset(e.target.value); setResult(null); }}>
            {QUALITY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label>
          Système extérieur
          <select value={away} onChange={(e) => { setAway(e.target.value); setResult(null); }}>
            {formations.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          Effectif extérieur
          <select value={awayPreset} onChange={(e) => { setAwayPreset(e.target.value); setResult(null); }}>
            {QUALITY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label>
          Matchs
          <input
            type="number" min={1} max={200} value={nMatches}
            onChange={(e) => setNMatches(Math.max(1, Math.min(200, Number(e.target.value))))}
          />
        </label>
        <button className="ask-button" onClick={handleRun} disabled={busy}>
          {busy ? <span className="spinner" /> : "Lancer la simulation"}
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <div className="tactics-lab-result commentary-in">
          <div className="tactics-lab-record">
            <strong>{result.home_formation}</strong> contre <strong>{result.away_formation}</strong>
            <span className="tactics-lab-wdl">
              {result.home_record.wins}V&nbsp;
              {result.home_record.draws}N&nbsp;
              {result.home_record.losses}D
              <span className="stats-chip-sub">
                ({frRaw(result.home_record.win_pct)} % / {frRaw(result.home_record.draw_pct)} % / {frRaw(result.home_record.loss_pct)} %)
              </span>
            </span>
          </div>
          <table className="tactics-lab-table">
            <thead>
              <tr><th></th><th>{result.home_formation} (domicile)</th><th>{result.away_formation} (extérieur)</th></tr>
            </thead>
            <tbody>
              <tr><td>Valeur de l'effectif</td><td>{formatEur(result.home_market_value_eur)}</td><td>{formatEur(result.away_market_value_eur)}</td></tr>
              <tr><td>Buts (moyenne)</td><td>{frRaw(result.mean_home_goals)}</td><td>{frRaw(result.mean_away_goals)}</td></tr>
              <tr><td>xG (moyenne)</td><td>{frRaw(result.mean_home_xg)}</td><td>{frRaw(result.mean_away_xg)}</td></tr>
              <tr><td>PPDA (moyenne)</td><td>{frRaw(result.mean_home_ppda)}</td><td>{frRaw(result.mean_away_ppda)}</td></tr>
              <tr><td>Possession</td><td>{frRaw(result.mean_home_possession_pct)} %</td><td>{result.mean_home_possession_pct === null ? "--" : `${frNum(100 - result.mean_home_possession_pct, 1)} %`}</td></tr>
            </tbody>
          </table>
          <p className="whatif-explanation">{result.method}</p>
        </div>
      )}
    </section>
  );
}
