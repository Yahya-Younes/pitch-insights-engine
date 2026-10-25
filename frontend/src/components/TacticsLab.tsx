import { useEffect, useState } from "react";
import { fetchFormations, simulateTacticsMatchup } from "../lib/api";
import type { TacticsLabResult } from "../lib/api";

const QUALITY_PRESETS: { value: string; label: string }[] = [
  { value: "random", label: "Random squad value" },
  { value: "big_money", label: "Big-money squad" },
  { value: "mid_table", label: "Mid-table squad" },
  { value: "shoestring", label: "Shoestring-budget squad" },
];

function presetToQuality(preset: string, min: number, max: number): number | null {
  if (preset === "big_money") return max;
  if (preset === "mid_table") return (min + max) / 2;
  if (preset === "shoestring") return min;
  return null; // "random"
}

function formatEur(value: number): string {
  if (value >= 1_000_000_000) return `€${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}M`;
  return `€${Math.round(value / 1000)}K`;
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
        <h2>Tactics Lab</h2>
        <span
          className="panel-tag"
          title="Monte-Carlo formation comparison: runs N independent full 90-minute synthetic matches between two chosen formations (and, optionally, two deliberately different squad values) and reports the aggregate win/draw/loss record, goals, xG, possession, and pressing intensity -- not a single match's result. Squad value scales directly into the attributes that drive shot and pass outcomes, so a value gap is a real, measurable edge, not a cosmetic label. Pure CPU simulation, no LLM calls."
        >
          Monte-Carlo &middot; {result ? `${result.n_matches} matches` : "no LLM calls"}
        </span>
      </div>

      <div className="whatif-knob-row tactics-lab-controls">
        <label>
          Home formation
          <select value={home} onChange={(e) => { setHome(e.target.value); setResult(null); }}>
            {formations.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          Home squad
          <select value={homePreset} onChange={(e) => { setHomePreset(e.target.value); setResult(null); }}>
            {QUALITY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label>
          Away formation
          <select value={away} onChange={(e) => { setAway(e.target.value); setResult(null); }}>
            {formations.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          Away squad
          <select value={awayPreset} onChange={(e) => { setAwayPreset(e.target.value); setResult(null); }}>
            {QUALITY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label>
          Matches
          <input
            type="number" min={1} max={200} value={nMatches}
            onChange={(e) => setNMatches(Math.max(1, Math.min(200, Number(e.target.value))))}
          />
        </label>
        <button className="ask-button" onClick={handleRun} disabled={busy}>
          {busy ? <span className="spinner" /> : "Run simulation"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="tactics-lab-result commentary-in">
          <div className="tactics-lab-record">
            <strong>{result.home_formation}</strong> vs <strong>{result.away_formation}</strong>
            <span className="tactics-lab-wdl">
              {result.home_record.wins}W&nbsp;
              {result.home_record.draws}D&nbsp;
              {result.home_record.losses}L
              <span className="stats-chip-sub">
                ({result.home_record.win_pct}% / {result.home_record.draw_pct}% / {result.home_record.loss_pct}%)
              </span>
            </span>
          </div>
          <table className="tactics-lab-table">
            <thead>
              <tr><th></th><th>{result.home_formation} (home)</th><th>{result.away_formation} (away)</th></tr>
            </thead>
            <tbody>
              <tr><td>Squad value</td><td>{formatEur(result.home_market_value_eur)}</td><td>{formatEur(result.away_market_value_eur)}</td></tr>
              <tr><td>Mean goals</td><td>{result.mean_home_goals}</td><td>{result.mean_away_goals}</td></tr>
              <tr><td>Mean xG</td><td>{result.mean_home_xg}</td><td>{result.mean_away_xg}</td></tr>
              <tr><td>Mean PPDA</td><td>{result.mean_home_ppda}</td><td>{result.mean_away_ppda}</td></tr>
              <tr><td>Possession</td><td>{result.mean_home_possession_pct}%</td><td>{100 - (result.mean_home_possession_pct ?? 50)}%</td></tr>
            </tbody>
          </table>
          <p className="whatif-explanation">{result.method}</p>
        </div>
      )}
    </section>
  );
}
