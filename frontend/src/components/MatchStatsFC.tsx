import { useId } from "react";
import type { MatchStat, MatchStatsResponse, StatsWindow } from "../lib/liveTypes";
import "./MatchStatsFC.css";

interface Props {
  data: MatchStatsResponse | null;
  error: string | null;
  pending: boolean;
  period: StatsWindow;
  onWindowChange: (w: StatsWindow) => void;
  homeTeam: string;
  awayTeam: string;
}

const WINDOWS: { id: StatsWindow; label: string; full: string }[] = [
  { id: "match", label: "Match", full: "Tout le match" },
  { id: "last15", label: "15 dern. min", full: "15 dernières minutes" },
];

type Edge = "home" | "away" | "even";

function better(s: MatchStat): Edge {
  if (s.home === s.away) return "even";
  const homeHigher = s.home > s.away;
  return homeHigher === s.higher_is_better ? "home" : "away";
}

function homeShare(s: MatchStat): number {
  const h = Math.max(0, s.home);
  const a = Math.max(0, s.away);
  const total = h + a;
  return total > 0 ? (h / total) * 100 : 50;
}

function StatRow({ stat }: { stat: MatchStat }) {
  const edge = better(stat);
  const share = homeShare(stat);
  return (
    <li className={`msfc-row msfc-edge-${edge}`} aria-hidden="true">
      <div className="msfc-values">
        <span className="msfc-value msfc-home">{stat.home_display}</span>
        <span className="msfc-label">{stat.label}</span>
        <span className="msfc-value msfc-away">{stat.away_display}</span>
      </div>
      <div className="msfc-bar">
        <span className="msfc-bar-home" style={{ width: `${share}%` }} />
        <span className="msfc-bar-away" style={{ width: `${100 - share}%` }} />
      </div>
    </li>
  );
}

const EDGE_TEXT: Record<Edge, (h: string, a: string) => string> = {
  home: (h) => h,
  away: (_h, a) => a,
  even: () => "Égalité",
};

export function MatchStatsFC({ data, error, pending, period, onWindowChange, homeTeam, awayTeam }: Props) {
  const headingId = useId();

  let body;
  if (data && data.stats.length > 0) {
    const caption = period === "last15"
      ? `Statistiques de la ${data.window.from_min}e à la ${data.window.to_min}e minute`
      : `Statistiques du match à la ${data.minute}e minute`;
    body = (
      <>
        <ul className={`msfc-list${pending ? " is-pending" : ""}`}>
          {data.stats.map((s) => <StatRow key={s.key} stat={s} />)}
        </ul>
        <table className="ui-sr-only sl-sr-only">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Statistique</th>
              <th scope="col">{homeTeam}</th>
              <th scope="col">{awayTeam}</th>
              <th scope="col">Avantage</th>
            </tr>
          </thead>
          <tbody>
            {data.stats.map((s) => (
              <tr key={s.key}>
                <th scope="row">{s.label}</th>
                <td>{s.home_display}</td>
                <td>{s.away_display}</td>
                <td>{EDGE_TEXT[better(s)](homeTeam, awayTeam)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  } else if (error) {
    body = <p className="sl-error" role="alert">Stats indisponibles : {error}</p>;
  } else if (data) {
    body = <p className="sl-empty">Aucune statistique sur cette période.</p>;
  } else {
    body = (
      <div className="sl-skeleton" aria-busy="true" aria-label="Chargement des statistiques">
        {Array.from({ length: 6 }, (_, i) => <span key={i} className="sl-skeleton-line" />)}
      </div>
    );
  }

  return (
    <section className="ui-card msfc" aria-labelledby={headingId}>
      <header className="msfc-head">
        <h2 id={headingId} className="ui-heading">Stats du match</h2>
        <div className="msfc-toggle" role="group" aria-label="Période des statistiques">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`msfc-toggle-btn${period === w.id ? " is-active" : ""}`}
              aria-pressed={period === w.id}
              aria-label={w.full}
              onClick={() => onWindowChange(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>
      {data ? (
        <div className="msfc-teams" aria-hidden="true">
          <span className="msfc-team-home">{homeTeam}</span>
          <span className="msfc-window">
            {data.window.from_min}'–{data.window.to_min}'
          </span>
          <span className="msfc-team-away">{awayTeam}</span>
        </div>
      ) : null}
      {error && data ? <p className="sl-stale" role="alert">Mise à jour impossible : {error}</p> : null}
      {body}
    </section>
  );
}
