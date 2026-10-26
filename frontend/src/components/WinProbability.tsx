import { useEffect, useId, useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { fetchWinProbability } from "../lib/winProbabilityApi";
import type { SwingMoment, TeamSide, WinProbabilityPoint, WinProbabilityResponse } from "../lib/winProbabilityApi";
import "./WinProbability.css";

interface Props {
  matchId: string | null;
  homeTeam?: string;
  awayTeam?: string;
}

// SVG geometry (viewBox units; the SVG scales to its container width).
const W = 360;
const H = 170;
const PL = 30;
const PR = 6;
const PT = 6;
const PB = 22;
const PLOT_W = W - PL - PR;
const PLOT_H = H - PT - PB;
const FULL_TIME = 90;

const xOf = (minute: number) => PL + (minute / FULL_TIME) * PLOT_W;
const yOf = (cumulative: number) => PT + cumulative * PLOT_H;

function pct(p: number): string {
  return `${Math.round(p * 100)} %`;
}

/** Polygon for the band between two cumulative curves (0 = top, 1 = bottom). */
function bandPath(series: WinProbabilityPoint[], upper: (p: WinProbabilityPoint) => number,
  lower: (p: WinProbabilityPoint) => number): string {
  const fwd = series.map((p) => `${xOf(p.minute).toFixed(1)},${yOf(upper(p)).toFixed(1)}`);
  const back = [...series].reverse().map((p) => `${xOf(p.minute).toFixed(1)},${yOf(lower(p)).toFixed(1)}`);
  return `M${fwd.join("L")}L${back.join("L")}Z`;
}

interface GoalMarker {
  minute: number;
  team: TeamSide;
  score: string;
}

function goalMarkers(series: WinProbabilityPoint[]): GoalMarker[] {
  const out: GoalMarker[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    if (!prev || !cur) continue;
    const score = `${cur.home_goals}-${cur.away_goals}`;
    for (let g = prev.home_goals; g < cur.home_goals; g++) out.push({ minute: cur.minute, team: "home", score });
    for (let g = prev.away_goals; g < cur.away_goals; g++) out.push({ minute: cur.minute, team: "away", score });
  }
  return out;
}

const CAUSE_LABEL: Record<SwingMoment["cause"]["kind"], string> = {
  goal: "But",
  big_chance: "Grosse occasion",
  chance: "Occasion",
  time: "Temps",
};

export function WinProbability({ matchId, homeTeam, awayTeam }: Props) {
  const [result, setResult] = useState<{ key: string; data: WinProbabilityResponse | null; error: string | null } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const titleId = useId();
  const requestKey = matchId ? `${matchId}#${reloadKey}` : null;

  useEffect(() => {
    if (!matchId) return;
    const key = `${matchId}#${reloadKey}`;
    const ctrl = new AbortController();
    fetchWinProbability(matchId, ctrl.signal)
      .then((d) => setResult({ key, data: d, error: null }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setResult({ key, data: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [matchId, reloadKey]);

  const current = result && result.key === requestKey ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const loading = requestKey !== null && current === null;

  const series = useMemo(() => data?.series ?? [], [data]);
  const goals = useMemo(() => goalMarkers(series), [series]);
  const keySwing = useMemo(
    () => (data?.swings ?? []).reduce<SwingMoment | null>(
      (best, s) => (best === null || Math.abs(s.delta_home) > Math.abs(best.delta_home) ? s : best), null),
    [data],
  );
  const lastMinute = series[series.length - 1]?.minute ?? 0;

  const homeName = homeTeam || data?.home_team || "Domicile";
  const awayName = awayTeam || data?.away_team || "Extérieur";
  const teamName = (side: TeamSide | null) => (side === "home" ? homeName : side === "away" ? awayName : "");

  const shown: WinProbabilityPoint | undefined =
    (cursor !== null ? series.find((p) => p.minute === cursor) : undefined) ?? series[series.length - 1];

  function minuteFromPointer(e: PointerEvent<SVGSVGElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const m = Math.round(((vx - PL) / PLOT_W) * FULL_TIME);
    return Math.max(0, Math.min(lastMinute, m));
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    const cur = cursor ?? lastMinute;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowLeft") setCursor(Math.max(0, cur - step));
    else if (e.key === "ArrowRight") setCursor(Math.min(lastMinute, cur + step));
    else if (e.key === "Home") setCursor(0);
    else if (e.key === "End" || e.key === "Escape") setCursor(null);
    else return;
    e.preventDefault();
  }

  let body: ReactNode;
  if (!matchId) {
    body = <p className="lv-muted">Lance un match pour suivre les chances de chaque équipe minute par minute.</p>;
  } else if (loading) {
    body = (
      <div className="wp-loading" role="status">
        <span className="lv-spinner" aria-hidden="true" /> Calcul des probabilités…
      </div>
    );
  } else if (error) {
    body = (
      <div className="wp-error">
        <p className="lv-error" role="alert">Probabilités indisponibles : {error}</p>
        <button type="button" className="ui-btn" onClick={() => setReloadKey((k) => k + 1)}>Réessayer</button>
      </div>
    );
  } else if (!data || series.length === 0 || !shown) {
    body = <p className="lv-muted">Aucun événement enregistré pour l'instant.</p>;
  } else {
    const cursorX = cursor !== null ? xOf(cursor) : null;
    body = (
      <>
        <div className="wp-now" aria-live="polite">
          <div className="wp-stat wp-home">
            <span className="wp-stat-value">{pct(shown.home)}</span>
            <span className="wp-stat-label">{homeName}</span>
          </div>
          <div className="wp-stat wp-draw">
            <span className="wp-stat-value">{pct(shown.draw)}</span>
            <span className="wp-stat-label">Nul</span>
          </div>
          <div className="wp-stat wp-away">
            <span className="wp-stat-value">{pct(shown.away)}</span>
            <span className="wp-stat-label">{awayName}</span>
          </div>
        </div>
        <p className="wp-minute">
          {cursor !== null ? `${cursor}'` : data.full_time ? "Fin du match" : `${lastMinute}'`}
          <span className="wp-score">{shown.home_goals} – {shown.away_goals}</span>
        </p>

        <svg
          className="wp-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`Probabilité de victoire de la minute 0 à ${lastMinute}. ${homeName} ${pct(shown.home)}, nul ${pct(shown.draw)}, ${awayName} ${pct(shown.away)} à la ${shown.minute}e minute. Flèches gauche/droite pour parcourir.`}
          onPointerMove={(e) => setCursor(minuteFromPointer(e))}
          onPointerLeave={() => setCursor(null)}
          onKeyDown={onKey}
        >
          <path className="wp-band wp-band-home" d={bandPath(series, () => 0, (p) => p.home)} />
          <path className="wp-band wp-band-draw" d={bandPath(series, (p) => p.home, (p) => p.home + p.draw)} />
          <path className="wp-band wp-band-away" d={bandPath(series, (p) => p.home + p.draw, () => 1)} />

          {[0.25, 0.5, 0.75].map((g) => (
            <g key={g}>
              <line className="wp-grid" x1={PL} x2={PL + PLOT_W} y1={yOf(g)} y2={yOf(g)} />
              <text className="wp-axis-label" x={PL - 4} y={yOf(g) + 3} textAnchor="end">{Math.round((1 - g) * 100)}%</text>
            </g>
          ))}
          {lastMinute < FULL_TIME && (
            <rect className="wp-unplayed" x={xOf(lastMinute)} y={PT} width={xOf(FULL_TIME) - xOf(lastMinute)} height={PLOT_H} />
          )}
          <line className="wp-axis" x1={PL} x2={PL + PLOT_W} y1={PT + PLOT_H} y2={PT + PLOT_H} />
          {[0, 15, 30, 45, 60, 75, 90].map((m) => (
            <text key={m} className="wp-axis-label" x={xOf(m)} y={H - 4} textAnchor="middle">{m}'</text>
          ))}
          {goals.map((g, i) => (
            <g key={i} className={`wp-goal wp-goal-${g.team}`}>
              <line x1={xOf(g.minute)} x2={xOf(g.minute)} y1={PT} y2={PT + PLOT_H} />
              <circle cx={xOf(g.minute)} cy={PT + PLOT_H + 6} r={3.5}>
                <title>{`${g.minute}' but ${teamName(g.team)} (${g.score})`}</title>
              </circle>
            </g>
          ))}
          {cursorX !== null && (
            <line className="wp-cursor" x1={cursorX} x2={cursorX} y1={PT} y2={PT + PLOT_H} />
          )}
        </svg>

        {keySwing ? (
          <p className="wp-key-swing">
            <span className="wp-key-swing-label">Tournant</span>
            <span className="wp-swing-minute">{keySwing.minute}'</span>
            <span className={`wp-swing-kind wp-kind-${keySwing.cause.team ?? "none"}`}>{CAUSE_LABEL[keySwing.cause.kind]}</span>
            <span className="wp-swing-text">
              {keySwing.cause.team ? `${teamName(keySwing.cause.team)} · ` : ""}
              {homeName} {pct(keySwing.home_before)} → {pct(keySwing.home_after)}
            </span>
          </p>
        ) : (
          <p className="lv-muted wp-key-swing-empty">Aucune minute n'a fait bouger les chances de 2 points ou plus.</p>
        )}

        {data.swings.length > 1 && (
          <details className="wp-swings">
            <summary>Tous les tournants ({data.swings.length})</summary>
            <ol>
              {data.swings.map((s) => (
                <li key={s.minute} className="wp-swing">
                  <span className="wp-swing-minute">{s.minute}'</span>
                  <span className="wp-swing-text">
                    {s.cause.team ? `${teamName(s.cause.team)} : ` : ""}{s.cause.description}
                    <span className="lv-muted"> · {s.score_after}</span>
                  </span>
                  <span className={`wp-swing-delta ${s.delta_home >= 0 ? "wp-up" : "wp-down"}`}>
                    {s.delta_home >= 0 ? "+" : "−"}{Math.round(Math.abs(s.delta_home) * 100)}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}

        <p className="wp-disclosure">
          {data.full_time ? "" : `Match simulé jusqu'à la ${lastMinute}e minute seulement. `}
          Modèle : {data.method}
        </p>
      </>
    );
  }

  return (
    <section className="ui-card wp-panel" aria-labelledby={titleId}>
      <div className="lv-card-head">
        <h2 id={titleId} className="ui-heading">Probabilité de victoire</h2>
        <span
          className="ui-tag"
          title="Déterministe : score actuel + rythme d'xG de chaque équipe projeté sur les minutes restantes (buts de Poisson). Aucun LLM."
        >
          modèle live
        </span>
      </div>
      {body}
    </section>
  );
}
