import { useId, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { breakdownLabel, motmReason } from "../i18n/backendLabels";
import { describeError, formatRating, formatSigned, shortName } from "../lib/liveApi";
import { shirtNumber } from "../lib/matchContext";
import type {
  LiveError, LivePlayerRating, LiveRatingsResponse, RatingBreakdownItem, RatingPoint,
} from "../lib/liveTypes";
import "./MotmRace.css";

const TOP_N = 5;
const SPARK_W = 72;
const SPARK_H = 24;

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function Sparkline({ series, gold }: { series: RatingPoint[]; gold: boolean }) {
  if (series.length < 2) return <span className="motm-spark motm-spark-empty" aria-hidden="true" />;
  const ratings = series.map((p) => p.rating);
  const lo = Math.min(...ratings, 5.5);
  const hi = Math.max(...ratings, 7.5);
  const first = series[0]?.minute ?? 0;
  const last = series[series.length - 1]?.minute ?? 1;
  const span = Math.max(1, last - first);
  const x = (m: number) => ((m - first) / span) * (SPARK_W - 2) + 1;
  const y = (r: number) => SPARK_H - 2 - ((r - lo) / Math.max(0.1, hi - lo)) * (SPARK_H - 4);
  const d = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.minute).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ");
  const end = series[series.length - 1];
  return (
    <svg className={`motm-spark${gold ? " is-gold" : ""}`} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true">
      <path d={d} />
      {end ? <circle cx={x(end.minute)} cy={y(end.rating)} r={2} /> : null}
    </svg>
  );
}

function Delta({ value }: { value: number }) {
  const i18n = useT();
  const { t } = i18n;
  if (Math.abs(value) < 0.05) {
    return (
      <span className="motm-delta is-flat" title={t("suivi.motm.flatTitle")}>
        =<span className="ui-sr-only sl-sr-only"> {t("suivi.motm.flatSr")}</span>
      </span>
    );
  }
  const up = value > 0;
  return (
    <span className={`motm-delta ${up ? "is-up" : "is-down"}`}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span> {formatSigned(i18n, value)}
      <span className="ui-sr-only sl-sr-only"> {t("suivi.motm.deltaSr")}</span>
    </span>
  );
}

function BreakdownList({ items }: { items: RatingBreakdownItem[] }) {
  const i18n = useT();
  const { t } = i18n;
  if (items.length === 0) return <p className="motm-breakdown-empty">{t("suivi.motm.breakdownEmpty")}</p>;
  return (
    <table className="motm-breakdown">
      <thead className="ui-sr-only sl-sr-only">
        <tr>
          <th scope="col">{t("suivi.motm.colAction")}</th>
          <th scope="col">{t("suivi.motm.colCount")}</th>
          <th scope="col">{t("suivi.motm.colPoints")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((b) => (
          <tr key={b.label}>
            <th scope="row">{breakdownLabel(i18n, b.label)}</th>
            <td className="motm-bd-count">×{b.count}</td>
            <td className={`motm-bd-pts ${b.points > 0 ? "is-pos" : b.points < 0 ? "is-neg" : ""}`}>
              {formatSigned(i18n, b.points)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function playerLabel(p: Pick<LivePlayerRating, "number" | "name">): string {
  return `#${p.number} ${shortName(p.name)}`;
}

// ---------------------------------------------------------------------------
// Race
// ---------------------------------------------------------------------------

interface RaceProps {
  data: LiveRatingsResponse | null;
  error: LiveError | null;
  homeTeam: string;
  awayTeam: string;
  followedPlayerId: string | null;
  onOpenPlayer: (playerId: string) => void;
  onFollow: (playerId: string) => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function MotmRace({ data, error, homeTeam, awayTeam, followedPlayerId, onOpenPlayer, onFollow }: RaceProps) {
  const i18n = useT();
  const { t } = i18n;
  const headingId = useId();
  const baseId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const prevTops = useRef(new Map<string, number>());
  const prevOrder = useRef("");

  const top = data ? data.players.slice(0, TOP_N) : [];
  const orderKey = top.map((p) => p.player_id).join("|");

  // FLIP: when the ranking changes, slide each row from its previous position.
  useLayoutEffect(() => {
    const animate = prevOrder.current !== "" && prevOrder.current !== orderKey && !prefersReducedMotion();
    const next = new Map<string, number>();
    rowRefs.current.forEach((el, id) => {
      const topPx = el.getBoundingClientRect().top;
      next.set(id, topPx);
      const before = prevTops.current.get(id);
      if (!animate || typeof el.animate !== "function") return;
      if (before === undefined) {
        el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
          duration: 350, easing: "ease-out",
        });
      } else if (before !== topPx) {
        el.animate([{ transform: `translateY(${before - topPx}px)` }, { transform: "none" }], {
          duration: 450, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    });
    prevTops.current = next;
    prevOrder.current = orderKey;
  }, [orderKey, openId]);

  // The API's motm.reason is French-only: rebuild it from the leader's breakdown.
  const motmPlayer = data?.motm ? data.players.find((p) => p.player_id === data.motm?.player_id) ?? null : null;
  const reason = motmPlayer ? motmReason(i18n, motmPlayer.breakdown) : "";

  let body;
  if (top.length > 0 && data) {
    body = (
      <>
        <ol className="motm-list">
          {top.map((p, i) => {
            const leader = i === 0;
            const panelId = `${baseId}-bd-${i}`;
            const open = openId === p.player_id;
            const teamName = p.team === "home" ? homeTeam : awayTeam;
            return (
              <li
                key={p.player_id}
                ref={(el) => {
                  if (el) rowRefs.current.set(p.player_id, el);
                  else rowRefs.current.delete(p.player_id);
                }}
                className={`motm-row${leader ? " is-leader" : ""}${p.player_id === followedPlayerId ? " is-followed" : ""}`}
              >
                <button
                  type="button"
                  className="motm-main"
                  onClick={() => onOpenPlayer(p.player_id)}
                  aria-label={t("suivi.motm.rowAria", {
                    rank: i + 1, name: p.name, number: p.number, team: teamName, rating: formatRating(i18n, p.rating),
                  })}
                >
                  <span className="motm-rank" aria-hidden="true">{i + 1}</span>
                  <span className="motm-who" aria-hidden="true">
                    <span className="motm-name">{playerLabel(p)}</span>
                    <span className={`motm-team is-${p.team}`}>
                      {teamName}{p.position ? ` · ${p.position}` : ""}
                    </span>
                    {leader && data.motm && data.motm.player_id === p.player_id ? (
                      <span className="motm-since">{t("suivi.motm.leaderSince", { minute: data.motm.leader_since_minute })}</span>
                    ) : null}
                  </span>
                  <Sparkline series={p.series} gold={leader} />
                  <span className="motm-rating-wrap" aria-hidden="true">
                    <span className={`motm-rating${leader ? " is-gold" : ""}`}>{formatRating(i18n, p.rating)}</span>
                  </span>
                </button>
                <Delta value={p.delta_10min} />
                <button
                  type="button"
                  className="motm-disclosure"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId(open ? null : p.player_id)}
                >
                  <span aria-hidden="true" className="motm-chevron">{open ? "▾" : "▸"}</span> {t("suivi.motm.details")}
                  <span className="ui-sr-only sl-sr-only"> {t("suivi.motm.detailsSr", { name: p.name })}</span>
                </button>
                <div id={panelId} className="motm-panel" hidden={!open}>
                  <BreakdownList items={p.breakdown} />
                  {p.player_id !== followedPlayerId ? (
                    <button type="button" className="ui-btn motm-follow" onClick={() => onFollow(p.player_id)}>
                      {t("suivi.motm.follow")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        {reason ? <p className="motm-reason">{reason}</p> : null}
        <p className="motm-method">{t("suivi.motm.method")}</p>
      </>
    );
  } else if (error) {
    body = <p className="sl-error" role="alert">{t("suivi.motm.error", { error: describeError(i18n, error) })}</p>;
  } else if (data) {
    body = <p className="sl-empty">{t("suivi.motm.empty")}</p>;
  } else {
    body = (
      <div className="sl-skeleton" aria-busy="true" aria-label={t("suivi.motm.loading")}>
        {Array.from({ length: 5 }, (_, i) => <span key={i} className="sl-skeleton-line is-tall" />)}
      </div>
    );
  }

  return (
    <section className="ui-card motm" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-heading motm-title">
        {t("suivi.motm.title")} <span className="motm-live">· {t("suivi.motm.live")}</span>
      </h2>
      {error && top.length > 0 ? (
        <p className="sl-stale" role="alert">{t("suivi.stale", { error: describeError(i18n, error) })}</p>
      ) : null}
      {body}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Followed player
// ---------------------------------------------------------------------------

interface FollowProps {
  playerId: string;
  player: LivePlayerRating | null;
  rank: number | null;
  teamName: string | null;
  onStop: () => void;
  onOpenPlayer: (playerId: string) => void;
}

export function FollowedPlayerCard({ playerId, player, rank, teamName, onStop, onOpenPlayer }: FollowProps) {
  const i18n = useT();
  const { t } = i18n;
  const headingId = useId();
  const factors = player
    ? [...player.breakdown].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3)
    : [];
  return (
    <section className={`ui-card motm-follow-card${player ? ` is-${player.team}` : ""}`} aria-labelledby={headingId}>
      <div className="motm-follow-head">
        <span className="ui-tag">{t("suivi.follow.tag")}</span>
        <button type="button" className="ui-btn motm-stop" onClick={onStop}>{t("suivi.follow.stop")}</button>
      </div>
      {player ? (
        <>
          <div className="motm-follow-body">
            <div>
              <h3 id={headingId} className="motm-follow-name">
                <button type="button" className="motm-link" onClick={() => onOpenPlayer(player.player_id)}>
                  {playerLabel(player)}
                </button>
              </h3>
              <p className={`motm-team is-${player.team}`}>
                {teamName}{rank !== null ? ` · ${t("suivi.follow.rank", { rank })}` : ""}
              </p>
            </div>
            <div className="motm-follow-score">
              <span className="motm-rating">{formatRating(i18n, player.rating)}</span>
              <Delta value={player.delta_10min} />
            </div>
          </div>
          {factors.length > 0 ? (
            <>
              <p className="motm-follow-sub">{t("suivi.follow.factors")}</p>
              <BreakdownList items={factors} />
            </>
          ) : null}
        </>
      ) : (
        <h3 id={headingId} className="motm-follow-name">
          {t("suivi.follow.pending", { number: shirtNumber(playerId) })}
        </h3>
      )}
    </section>
  );
}
