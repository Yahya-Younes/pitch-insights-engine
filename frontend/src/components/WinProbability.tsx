import { useEffect, useMemo, useState } from "react";
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
const W = 640;
const H = 220;
const PL = 36;
const PR = 10;
const PT = 8;
const PB = 30;
const PLOT_W = W - PL - PR;
const PLOT_H = H - PT - PB;
const FULL_TIME = 90;

const xOf = (minute: number) => PL + (minute / FULL_TIME) * PLOT_W;
const yOf = (cumulative: number) => PT + cumulative * PLOT_H;

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
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
  goal: "Goal",
  big_chance: "Big chance",
  chance: "Chance",
  time: "Time",
};

export function WinProbability({ matchId, homeTeam, awayTeam }: Props) {
  const [data, setData] = useState<WinProbabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    setCursor(null);
    if (!matchId) return;
    const ctrl = new AbortController();
    setLoading(true);
    fetchWinProbability(matchId, ctrl.signal)
      .then(setData)
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [matchId]);

  const series = useMemo(() => data?.series ?? [], [data]);
  const goals = useMemo(() => goalMarkers(series), [series]);
  const lastMinute = series[series.length - 1]?.minute ?? 0;

  const homeName = homeTeam || data?.home_team || "Home";
  const awayName = awayTeam || data?.away_team || "Away";
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
    body = (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">📈</span>
        <p>Run a match to see how each side's chances moved minute by minute.</p>
      </div>
    );
  } else if (loading) {
    body = <div className="wp-loading" role="status">Computing win probability…</div>;
  } else if (error) {
    body = <p className="error" role="alert">Couldn't load win probability: {error}</p>;
  } else if (!data || series.length === 0 || !shown) {
    body = (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">📈</span>
        <p>No match events recorded yet.</p>
      </div>
    );
  } else {
    const cursorX = cursor !== null ? xOf(cursor) : null;
    body = (
      <>
        <div className="wp-now" aria-live="polite">
          <div className="wp-now-minute">
            {cursor !== null ? `${cursor}'` : data.full_time ? "FT" : `${lastMinute}'`}
            <span className="wp-now-score">{shown.home_goals}–{shown.away_goals}</span>
          </div>
          <div className="wp-stat wp-home">
            <span className="wp-stat-value">{pct(shown.home)}</span>
            <span className="wp-stat-label">{homeName} win</span>
          </div>
          <div className="wp-stat wp-draw">
            <span className="wp-stat-value">{pct(shown.draw)}</span>
            <span className="wp-stat-label">Draw</span>
          </div>
          <div className="wp-stat wp-away">
            <span className="wp-stat-value">{pct(shown.away)}</span>
            <span className="wp-stat-label">{awayName} win</span>
          </div>
        </div>

        <svg
          className="wp-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`Win probability chart, minute 0 to ${lastMinute}. ${homeName} ${pct(shown.home)}, draw ${pct(shown.draw)}, ${awayName} ${pct(shown.away)} at ${shown.minute} minutes. Use arrow keys to scrub.`}
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
              <text className="wp-axis-label" x={PL - 6} y={yOf(g) + 3} textAnchor="end">{pct(1 - g)}</text>
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
              <circle cx={xOf(g.minute)} cy={PT + PLOT_H + 7} r={4.5}>
                <title>{`${g.minute}' ${teamName(g.team)} goal (${g.score})`}</title>
              </circle>
            </g>
          ))}
          {cursorX !== null && (
            <line className="wp-cursor" x1={cursorX} x2={cursorX} y1={PT} y2={PT + PLOT_H} />
          )}
        </svg>

        <div className="wp-legend" aria-hidden="true">
          <span><i className="wp-swatch wp-swatch-home" />{homeName}</span>
          <span><i className="wp-swatch wp-swatch-draw" />Draw</span>
          <span><i className="wp-swatch wp-swatch-away" />{awayName}</span>
          <span className="wp-legend-hint">● = goal</span>
        </div>

        <div className="wp-swings">
          <h3>Swing moments</h3>
          {data.swings.length === 0 ? (
            <p className="wp-muted">No single minute moved the odds by 2 points or more.</p>
          ) : (
            <ol>
              {data.swings.map((s) => (
                <li key={s.minute} className="wp-swing">
                  <span className="wp-swing-minute">{s.minute}'</span>
                  <span className={`wp-swing-kind wp-kind-${s.cause.team ?? "none"}`}>{CAUSE_LABEL[s.cause.kind]}</span>
                  <span className="wp-swing-text">
                    {s.cause.team ? `${teamName(s.cause.team)}: ` : ""}{s.cause.description}
                    <span className="wp-muted"> · {homeName} win {pct(s.home_before)} → {pct(s.home_after)} ({s.score_after})</span>
                  </span>
                  <span className={`wp-swing-delta ${s.delta_home >= 0 ? "wp-up" : "wp-down"}`}>
                    {s.delta_home >= 0 ? "+" : "−"}{Math.round(Math.abs(s.delta_home) * 100)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <p className="wp-disclosure">
          {data.full_time ? "" : `Match simulated to ${lastMinute}' only, so not resolved. `}
          Model: {data.method}
        </p>
      </>
    );
  }

  return (
    <section className="feed-panel wp-panel" aria-labelledby="wp-title">
      <div className="panel-heading">
        <h2 id="wp-title">Win Probability</h2>
        <span
          className="panel-tag"
          title="Deterministic: current score plus each side's xG pace projected over the remaining minutes as Poisson goals. No LLM involved."
        >
          live model
        </span>
      </div>
      {body}
    </section>
  );
}
