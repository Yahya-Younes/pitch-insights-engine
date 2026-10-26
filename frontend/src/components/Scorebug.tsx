import { useEffect, useState } from "react";
import { teamCrest } from "../lib/crest";
import {
  fetchScorebugStats, fetchScorebugStatus, fetchScorebugWinProb,
  type ScorebugStats, type ScorebugStatus, type ScorebugWinProb,
} from "../lib/scorebugApi";
import type { RunMatchResponse } from "../lib/types";
import { useT } from "../i18n";
import { TeamCrest } from "./TeamCrest";

const POLL_MS = 3000;
const TERMINAL: ReadonlySet<string> = new Set(["done", "failed"]);

interface LiveState {
  matchId: string;
  status: ScorebugStatus | null;
  stats: ScorebugStats | null;
  winProb: ScorebugWinProb | null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function MinutePill({ status, minute }: { status: ScorebugStatus | null; minute: number | null }) {
  const { t } = useT();
  if (status === "done") return <span className="ui-pill is-solid scorebug-pill">{t("shell.score.done")}</span>;
  if (status === "failed") return <span className="ui-pill is-danger scorebug-pill">{t("shell.score.failed")}</span>;
  if (status === "crashed") return <span className="ui-pill is-gold scorebug-pill">{t("shell.score.crashed")}</span>;
  return (
    <span className="ui-pill is-danger scorebug-pill">
      {minute !== null ? `${minute}'` : "0'"}
      <span className="scorebug-live-dot" aria-hidden="true">●</span>
      {t("shell.score.live")}
    </span>
  );
}

export function Scorebug({ match }: { match: RunMatchResponse | null }) {
  const matchId = match?.match_id ?? null;
  const [live, setLive] = useState<LiveState | null>(null);
  const { t, pct } = useT();

  useEffect(() => {
    if (!matchId) return;
    const id = matchId;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    function stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }

    async function tick() {
      const [status, stats, winProb] = await Promise.allSettled([
        fetchScorebugStatus(id, ctrl.signal),
        fetchScorebugStats(id, ctrl.signal),
        fetchScorebugWinProb(id, ctrl.signal),
      ]);
      if (cancelled) return;
      setLive((prev) => {
        const base: LiveState = prev && prev.matchId === id
          ? prev
          : { matchId: id, status: null, stats: null, winProb: null };
        return {
          matchId: id,
          status: status.status === "fulfilled" ? status.value : base.status,
          stats: stats.status === "fulfilled" ? stats.value : base.stats,
          winProb: winProb.status === "fulfilled" && winProb.value ? winProb.value : base.winProb,
        };
      });
      if (status.status === "fulfilled" && TERMINAL.has(status.value)) stop();
    }

    void tick();
    timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      stop();
      ctrl.abort();
    };
  }, [matchId]);

  if (!match) {
    return (
      <div className="scorebug scorebug-empty" role="region" aria-label={t("shell.score.region")}>
        <span className="scorebug-empty-text">{t("shell.score.empty")}</span>
        <span className="ui-tag">{t("shell.score.emptyHint")}</span>
      </div>
    );
  }

  const current = live && live.matchId === match.match_id ? live : null;
  const stats = current?.stats ?? null;
  const status = current?.status ?? null;
  const wp = current?.winProb ?? null;
  const home = stats?.score.home ?? 0;
  const away = stats?.score.away ?? 0;
  const homeCode = teamCrest(match.home_team).initials;
  const awayCode = teamCrest(match.away_team).initials;
  const wpHome = wp ? pct(clamp01(wp.home)) : "–";
  const wpDraw = wp ? pct(clamp01(wp.draw)) : "–";
  const wpAway = wp ? pct(clamp01(wp.away)) : "–";

  return (
    <div className="scorebug" role="region" aria-label={t("shell.score.region")}>
      <div className="scorebug-match">
        <div className="scorebug-team scorebug-team-home">
          <TeamCrest name={match.home_team} size={36} />
          <span className="scorebug-name" title={match.home_team}>{match.home_team}</span>
        </div>

        <div className="scorebug-center">
          <div className="scorebug-score ui-stat-value" aria-hidden="true">
            <span className="scorebug-goals-home">{home}</span>
            <span className="scorebug-sep">–</span>
            <span className="scorebug-goals-away">{away}</span>
          </div>
          <MinutePill status={status} minute={stats?.minute ?? null} />
        </div>

        <div className="scorebug-team scorebug-team-away">
          <span className="scorebug-name" title={match.away_team}>{match.away_team}</span>
          <TeamCrest name={match.away_team} size={36} />
        </div>
      </div>

      <p className="ui-sr-only" aria-live="polite">
        {t("shell.score.sr", { home: match.home_team, homeGoals: home, away: match.away_team, awayGoals: away })}
        {status === "done" ? t("shell.score.srDone") : ""}
      </p>

      <div className="scorebug-wp" aria-label={t("shell.score.winProb")} role="group">
        <div className="scorebug-wp-bar" aria-hidden="true">
          {wp ? (
            <>
              <span className="scorebug-wp-seg is-home" style={{ flexGrow: Math.max(wp.home, 0.001) }} />
              <span className="scorebug-wp-seg is-draw" style={{ flexGrow: Math.max(wp.draw, 0.001) }} />
              <span className="scorebug-wp-seg is-away" style={{ flexGrow: Math.max(wp.away, 0.001) }} />
            </>
          ) : (
            <span className="scorebug-wp-seg is-pending" />
          )}
        </div>
        <div className="scorebug-wp-labels">
          <span className="is-home"><abbr title={match.home_team}>{homeCode}</abbr> {wpHome}</span>
          <span className="is-draw">{t("common.draw")} {wpDraw}</span>
          <span className="is-away"><abbr title={match.away_team}>{awayCode}</abbr> {wpAway}</span>
        </div>
      </div>
    </div>
  );
}
