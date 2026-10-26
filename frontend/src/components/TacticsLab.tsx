import { useEffect, useState } from "react";
import { fetchFormations, simulateTacticsMatchup } from "../lib/api";
import type { TacticsLabResult } from "../lib/api";
import { useT, type I18n } from "../i18n";
import { plural, rawNum, rawPct } from "../lib/panelLabels";

const QUALITY_PRESETS = ["random", "big_money", "mid_table", "shoestring"] as const;

function presetToQuality(preset: string, min: number, max: number): number | null {
  if (preset === "big_money") return max;
  if (preset === "mid_table") return (min + max) / 2;
  if (preset === "shoestring") return min;
  return null; // "random"
}

function formatEur(i18n: I18n, value: number): string {
  if (value >= 1_000_000_000) return i18n.t("panels.lab.eur.bn", { v: i18n.num(value / 1_000_000_000, 2) });
  if (value >= 1_000_000) return i18n.t("panels.lab.eur.m", { v: i18n.num(value / 1_000_000, 1) });
  return i18n.t("panels.lab.eur.k", { v: i18n.num(value / 1000, 0) });
}

export function TacticsLab() {
  const i18n = useT();
  const { t } = i18n;
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

  const presetOptions = QUALITY_PRESETS.map((p) => <option key={p} value={p}>{t(`panels.lab.preset.${p}`)}</option>);

  return (
    <section className="feed-panel tactics-lab-panel">
      <div className="panel-heading">
        <h2>{t("panels.lab.title")}</h2>
        <span className="panel-tag" title={t("panels.lab.tagTitle")}>
          Monte-Carlo &middot; {result ? plural(i18n, "panels.lab.matches", result.n_matches) : t("panels.noLlm")}
        </span>
      </div>

      <div className="whatif-knob-row tactics-lab-controls">
        <label>
          {t("panels.lab.homeSystem")}
          <select value={home} onChange={(e) => { setHome(e.target.value); setResult(null); }}>
            {formations.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          {t("panels.lab.homeSquad")}
          <select value={homePreset} onChange={(e) => { setHomePreset(e.target.value); setResult(null); }}>
            {presetOptions}
          </select>
        </label>
        <label>
          {t("panels.lab.awaySystem")}
          <select value={away} onChange={(e) => { setAway(e.target.value); setResult(null); }}>
            {formations.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          {t("panels.lab.awaySquad")}
          <select value={awayPreset} onChange={(e) => { setAwayPreset(e.target.value); setResult(null); }}>
            {presetOptions}
          </select>
        </label>
        <label>
          {t("panels.lab.matchesLabel")}
          <input
            type="number" min={1} max={200} value={nMatches}
            onChange={(e) => setNMatches(Math.max(1, Math.min(200, Number(e.target.value))))}
          />
        </label>
        <button className="ask-button" onClick={handleRun} disabled={busy}>
          {busy ? <span className="spinner" /> : t("panels.lab.run")}
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <div className="tactics-lab-result commentary-in">
          <div className="tactics-lab-record">
            <strong>{result.home_formation}</strong> {t("panels.lab.versus")} <strong>{result.away_formation}</strong>
            <span className="tactics-lab-wdl">
              {t("panels.lab.wdl", { w: result.home_record.wins, d: result.home_record.draws, l: result.home_record.losses })}
              <span className="stats-chip-sub">
                {" "}({rawPct(i18n, result.home_record.win_pct)} / {rawPct(i18n, result.home_record.draw_pct)} / {rawPct(i18n, result.home_record.loss_pct)})
              </span>
            </span>
          </div>
          <table className="tactics-lab-table">
            <thead>
              <tr>
                <th></th>
                <th>{t("panels.lab.colHome", { f: result.home_formation })}</th>
                <th>{t("panels.lab.colAway", { f: result.away_formation })}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>{t("panels.lab.row.value")}</td><td>{formatEur(i18n, result.home_market_value_eur)}</td><td>{formatEur(i18n, result.away_market_value_eur)}</td></tr>
              <tr><td>{t("panels.lab.row.goals")}</td><td>{rawNum(i18n, result.mean_home_goals)}</td><td>{rawNum(i18n, result.mean_away_goals)}</td></tr>
              <tr><td>{t("panels.lab.row.xg")}</td><td>{rawNum(i18n, result.mean_home_xg)}</td><td>{rawNum(i18n, result.mean_away_xg)}</td></tr>
              <tr><td>{t("panels.lab.row.ppda")}</td><td>{rawNum(i18n, result.mean_home_ppda)}</td><td>{rawNum(i18n, result.mean_away_ppda)}</td></tr>
              <tr>
                <td>{t("panels.lab.row.possession")}</td>
                <td>{rawPct(i18n, result.mean_home_possession_pct)}</td>
                <td>{result.mean_home_possession_pct === null ? "--" : i18n.pct((100 - result.mean_home_possession_pct) / 100, 1)}</td>
              </tr>
            </tbody>
          </table>
          {/* The API's `method` is French-only: the same sentence comes from the catalog. */}
          <p className="whatif-explanation">
            {t("panels.lab.method", { n: result.n_matches, home: result.home_formation, away: result.away_formation })}
          </p>
        </div>
      )}
    </section>
  );
}
