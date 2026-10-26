import { useEffect, useState } from "react";
import { teamCrest } from "../lib/crest";
import {
  fetchScorebugStats, fetchScorebugStatus, fetchScorebugWinProb,
  type ScorebugStats, type ScorebugStatus, type ScorebugWinProb,
} from "../lib/scorebugApi";
import type { RunMatchResponse } from "../lib/types";
import { TeamCrest } from "./TeamCrest";

const POLL_MS = 3000;
const TERMINAL: ReadonlySet<string> = new Set(["done", "failed"]);

interface LiveState {
  matchId: string;
  status: ScorebugStatus | null;
  stats: ScorebugStats | null;
  winProb: ScorebugWinProb | null;
}

function pct(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

function MinutePill({ status, minute }: { status: ScorebugStatus | null; minute: number | null }) {
  if (status === "done") return <span className="ui-pill is-solid scorebug-pill">Terminé</span>;
  if (status === "failed") return <span className="ui-pill is-danger scorebug-pill">Échec</span>;
  if (status === "crashed") return <span className="ui-pill is-gold scorebug-pill">Interrompu</span>;
  return (
    <span className="ui-pill is-danger scorebug-pill">
      {minute !== null ? `${minute}'` : "0'"}
      <span className="scorebug-live-dot" aria-hidden="true">●</span>
      En direct
    </span>
  );
}

export function Scorebug({ match }: { match: RunMatchResponse | null }) {
  const matchId = match?.match_id ?? null;
  const [live, setLive] = useState<LiveState | null>(null);

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
      <div className="scorebug scorebug-empty" role="region" aria-label="Tableau de score">
        <span className="scorebug-empty-text">Aucun match en cours</span>
        <span className="ui-tag">Lance un match pour afficher le score</span>
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
  const wpHome = wp ? pct(wp.home) : null;
  const wpDraw = wp ? pct(wp.draw) : null;
  const wpAway = wp ? pct(wp.away) : null;

  return (
    <div className="scorebug" role="region" aria-label="Tableau de score">
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
        Score : {match.home_team} {home}, {match.away_team} {away}
        {status === "done" ? ". Match terminé." : ""}
      </p>

      <div className="scorebug-wp" aria-label="Probabilité de victoire" role="group">
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
          <span className="is-home"><abbr title={match.home_team}>{homeCode}</abbr> {wpHome !== null ? `${wpHome}%` : "–"}</span>
          <span className="is-draw">Nul {wpDraw !== null ? `${wpDraw}%` : "–"}</span>
          <span className="is-away"><abbr title={match.away_team}>{awayCode}</abbr> {wpAway !== null ? `${wpAway}%` : "–"}</span>
        </div>
      </div>
    </div>
  );
}
