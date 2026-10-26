import { useId } from "react";
import { useT, type I18n } from "../i18n";
import { statLabel } from "../i18n/backendLabels";
import { describeError } from "../lib/liveApi";
import type { LiveError, MatchStat, MatchStatsResponse, StatsWindow } from "../lib/liveTypes";
import "./MatchStatsFC.css";

interface Props {
  data: MatchStatsResponse | null;
  error: LiveError | null;
  pending: boolean;
  period: StatsWindow;
  onWindowChange: (w: StatsWindow) => void;
  homeTeam: string;
  awayTeam: string;
}

const WINDOWS: StatsWindow[] = ["match", "last15"];

/** Backend placeholder for "no value" (e.g. pass accuracy with no pass yet). */
const NONE = "–";

/** One side of a stat, formatted for the UI language from the numeric value.
 * The API's *_display strings are French ("54 %", "1,42"); only the parts the
 * number alone cannot give back (shots on target, yellow/red split) are read
 * from them. */
function formatStat(i18n: I18n, s: MatchStat, side: "home" | "away"): string {
  const value = s[side];
  const display = side === "home" ? s.home_display : s.away_display;
  if (display.trim() === NONE) return NONE;
  switch (s.key) {
    case "possession": {
      // Rounded so both sides add up to 100, like the backend.
      const home = Math.round(s.home);
      return i18n.pct((side === "home" ? home : 100 - home) / 100);
    }
    case "pass_accuracy":
      return i18n.pct(Math.round(value) / 100);
    case "xg":
      return i18n.num(value, 2);
    case "ppda":
      return i18n.num(value, 1);
    case "shots": {
      const onTarget = /\((\d+)\)/.exec(display);
      const total = i18n.num(value);
      return onTarget ? `${total} (${i18n.num(Number(onTarget[1]))})` : total;
    }
    case "cards": {
      const yellow = /(\d+)\s*🟨/.exec(display);
      const red = /(\d+)\s*🟥/.exec(display);
      const parts = [
        ...(yellow ? [`${i18n.num(Number(yellow[1]))} 🟨`] : []),
        ...(red ? [`${i18n.num(Number(red[1]))} 🟥`] : []),
      ];
      return parts.length > 0 ? parts.join(" ") : i18n.num(0);
    }
    case "duels_won":
    case "interceptions":
    case "tackles_won":
    case "fouls":
      return i18n.num(value);
    default:
      return display;
  }
}

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
  const i18n = useT();
  const edge = better(stat);
  const share = homeShare(stat);
  return (
    <li className={`msfc-row msfc-edge-${edge}`} aria-hidden="true">
      <div className="msfc-values">
        <span className="msfc-value msfc-home">{formatStat(i18n, stat, "home")}</span>
        <span className="msfc-label">{statLabel(i18n, stat.key, stat.label)}</span>
        <span className="msfc-value msfc-away">{formatStat(i18n, stat, "away")}</span>
      </div>
      <div className="msfc-bar">
        <span className="msfc-bar-home" style={{ width: `${share}%` }} />
        <span className="msfc-bar-away" style={{ width: `${100 - share}%` }} />
      </div>
    </li>
  );
}

export function MatchStatsFC({ data, error, pending, period, onWindowChange, homeTeam, awayTeam }: Props) {
  const i18n = useT();
  const { t } = i18n;
  const headingId = useId();
  const edgeText = (e: Edge) => (e === "home" ? homeTeam : e === "away" ? awayTeam : t("suivi.stats.even"));

  let body;
  if (data && data.stats.length > 0) {
    const caption = period === "last15"
      ? t("suivi.stats.captionWindow", { from: data.window.from_min, to: data.window.to_min })
      : t("suivi.stats.captionMatch", { minute: data.minute });
    body = (
      <>
        <ul className={`msfc-list${pending ? " is-pending" : ""}`}>
          {data.stats.map((s) => <StatRow key={s.key} stat={s} />)}
        </ul>
        <table className="ui-sr-only sl-sr-only">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t("suivi.stats.colStat")}</th>
              <th scope="col">{homeTeam}</th>
              <th scope="col">{awayTeam}</th>
              <th scope="col">{t("suivi.stats.colEdge")}</th>
            </tr>
          </thead>
          <tbody>
            {data.stats.map((s) => (
              <tr key={s.key}>
                <th scope="row">{statLabel(i18n, s.key, s.label)}</th>
                <td>{formatStat(i18n, s, "home")}</td>
                <td>{formatStat(i18n, s, "away")}</td>
                <td>{edgeText(better(s))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  } else if (error) {
    body = <p className="sl-error" role="alert">{t("suivi.stats.error", { error: describeError(i18n, error) })}</p>;
  } else if (data) {
    body = <p className="sl-empty">{t("suivi.stats.empty")}</p>;
  } else {
    body = (
      <div className="sl-skeleton" aria-busy="true" aria-label={t("suivi.stats.loading")}>
        {Array.from({ length: 6 }, (_, i) => <span key={i} className="sl-skeleton-line" />)}
      </div>
    );
  }

  return (
    <section className="ui-card msfc" aria-labelledby={headingId}>
      <header className="msfc-head">
        <h2 id={headingId} className="ui-heading">{t("suivi.stats.title")}</h2>
        <div className="msfc-toggle" role="group" aria-label={t("suivi.stats.windowAria")}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={`msfc-toggle-btn${period === w ? " is-active" : ""}`}
              aria-pressed={period === w}
              aria-label={t(`suivi.stats.window.${w}.full`)}
              onClick={() => onWindowChange(w)}
            >
              {t(`suivi.stats.window.${w}`)}
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
      {error && data ? (
        <p className="sl-stale" role="alert">{t("suivi.stale", { error: describeError(i18n, error) })}</p>
      ) : null}
      {body}
    </section>
  );
}
