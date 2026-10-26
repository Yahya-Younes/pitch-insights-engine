import { useId, useState } from "react";
import { FollowedPlayerCard, MotmRace } from "../components/MotmRace";
import { LiveAlerts } from "../components/LiveAlerts";
import { MatchStatsFC } from "../components/MatchStatsFC";
import { ShotMapMini } from "../components/ShotMapMini";
import type { AgentTraceResponse } from "../lib/agentTraceTypes";
import { useT } from "../i18n";
import { describeError, formatDec2, useLiveDashboard, useNow } from "../lib/liveApi";
import type { LiveError, MomentumResponse, Resource, StatsWindow } from "../lib/liveTypes";
import { useMatch } from "../lib/matchContext";
import type { WinProbabilityResponse } from "../lib/winProbabilityApi";
import "./SuiviLiveTab.css";

const MOMENTUM_BUCKETS = 10;

/** Error line (errorKey takes {error}) or a loading skeleton labelled `loading`. */
function ErrorOrLoading({ error, errorKey, loading }: { error: LiveError | null; errorKey: string; loading: string }) {
  const i18n = useT();
  if (error) return <p className="sl-error" role="alert">{i18n.t(errorKey, { error: describeError(i18n, error) })}</p>;
  return <div className="sl-skeleton sl-skeleton-block" aria-busy="true" aria-label={loading} />;
}

// ---------------------------------------------------------------------------
// Column 3 widgets
// ---------------------------------------------------------------------------

function WinProbMini({ res, maxMinute, homeTeam, awayTeam }: {
  res: Resource<WinProbabilityResponse>; maxMinute: number | null; homeTeam: string; awayTeam: string;
}) {
  const i18n = useT();
  const { t } = i18n;
  const headingId = useId();
  const series = res.data?.series ?? [];
  const visible = maxMinute === null ? series : series.filter((p) => p.minute <= maxMinute);
  const point = visible[visible.length - 1] ?? null;
  return (
    <section className="ui-card sl-wp" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-heading">
        {t("suivi.wp.title")}{point ? <span className="sl-sub"> · {point.minute}'</span> : null}
      </h2>
      {point ? (
        <dl className="sl-wp-grid">
          <div className="sl-wp-cell is-home">
            <dt>{homeTeam}</dt>
            <dd className="ui-stat-value">{i18n.pct(point.home)}</dd>
          </div>
          <div className="sl-wp-cell is-draw">
            <dt>{t("suivi.wp.draw")}</dt>
            <dd className="ui-stat-value">{i18n.pct(point.draw)}</dd>
          </div>
          <div className="sl-wp-cell is-away">
            <dt>{awayTeam}</dt>
            <dd className="ui-stat-value">{i18n.pct(point.away)}</dd>
          </div>
        </dl>
      ) : res.data ? (
        <p className="sl-empty">{t("suivi.wp.empty")}</p>
      ) : (
        <ErrorOrLoading error={res.error} errorKey="suivi.wp.error" loading={t("suivi.wp.loading")} />
      )}
      {point ? (
        <div className="sl-wp-bar" aria-hidden="true">
          <span className="is-home" style={{ width: `${point.home * 100}%` }} />
          <span className="is-draw" style={{ width: `${point.draw * 100}%` }} />
          <span className="is-away" style={{ width: `${point.away * 100}%` }} />
        </div>
      ) : null}
      {point && res.error ? (
        <p className="sl-stale" role="alert">{t("suivi.stale", { error: describeError(i18n, res.error) })}</p>
      ) : null}
    </section>
  );
}

const MW = 200;
const MH = 64;

function MomentumMini({ res, maxMinute, homeTeam, awayTeam }: {
  res: Resource<MomentumResponse>; maxMinute: number | null; homeTeam: string; awayTeam: string;
}) {
  const i18n = useT();
  const { t } = i18n;
  const headingId = useId();
  const all = res.data?.buckets ?? [];
  const buckets = (maxMinute === null ? all : all.filter((b) => b.minute <= maxMinute)).slice(-MOMENTUM_BUCKETS);
  let body;
  if (buckets.length > 0 && res.data) {
    const slot = MW / MOMENTUM_BUCKETS;
    const mid = MH / 2;
    const net = buckets.reduce((acc, b) => acc + b.momentum, 0);
    const lead = Math.abs(net) < 0.5
      ? t("suivi.mom.even")
      : t("suivi.mom.lead", { team: net > 0 ? homeTeam : awayTeam });
    const first = buckets[0]?.minute ?? 0;
    const last = buckets[buckets.length - 1]?.minute ?? 0;
    const goalMinutes = new Set(res.data.goals.filter((g) => g.minute >= first && g.minute <= last + 1).map((g) => `${g.minute}-${g.team}`));
    body = (
      <>
        <svg className="sl-mom" viewBox={`0 0 ${MW} ${MH}`} role="img"
          aria-label={t("suivi.mom.aria", { from: first, to: last + 1, lead })}>
          <line x1={0} x2={MW} y1={mid} y2={mid} className="sl-mom-axis" />
          {buckets.map((b, i) => {
            const h = Math.abs(b.momentum) * (mid - 6);
            const home = b.momentum >= 0;
            const x = i * slot + slot * 0.18;
            const w = slot * 0.64;
            return (
              <g key={b.minute}>
                <rect x={x} width={w} y={home ? mid - h : mid} height={Math.max(h, 0.5)}
                  rx={1.5} className={home ? "is-home" : "is-away"}>
                  <title>{`${b.minute}' · xT ${formatDec2(i18n, b.home_xt)} – ${formatDec2(i18n, b.away_xt)}`}</title>
                </rect>
                {goalMinutes.has(`${b.minute}-home`) ? <circle cx={x + w / 2} cy={4} r={2.6} className="sl-mom-goal" /> : null}
                {goalMinutes.has(`${b.minute}-away`) ? <circle cx={x + w / 2} cy={MH - 4} r={2.6} className="sl-mom-goal" /> : null}
              </g>
            );
          })}
        </svg>
        <div className="sl-mom-legend" aria-hidden="true">
          <span>{first}'</span>
          <span className="sl-mom-lead">{lead}</span>
          <span>{last + 1}'</span>
        </div>
      </>
    );
  } else if (res.data) {
    body = <p className="sl-empty">{t("suivi.mom.empty")}</p>;
  } else {
    body = <ErrorOrLoading error={res.error} errorKey="suivi.mom.error" loading={t("suivi.mom.loading")} />;
  }
  return (
    <section className="ui-card sl-momentum" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-heading">
        {t("suivi.mom.title")} <span className="sl-sub">· {t("suivi.mom.window")}</span>
      </h2>
      {body}
    </section>
  );
}

function AgentsStrip({ res }: { res: Resource<AgentTraceResponse> }) {
  const { t } = useT();
  const headingId = useId();
  const agents = res.data?.agents ?? [];
  return (
    <section className="ui-card sl-agents" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-heading">{t("suivi.agents.title")}</h2>
      {agents.length > 0 ? (
        <ul className="sl-agent-list">
          {agents.map((a) => {
            const detail = t("suivi.agents.detail", { name: a.name, processed: a.processed, outputs: a.outputs }) +
              (a.llm_calls !== null ? t("suivi.agents.llm", { n: a.llm_calls }) : "") +
              t("suivi.agents.fallbacks", { n: a.fallbacks }) +
              (a.grounding_failures > 0 ? t("suivi.agents.grounding", { n: a.grounding_failures }) : "");
            return (
              <li key={a.stage} className={`ui-pill sl-agent${a.fallbacks > 0 ? " is-gold" : ""}`} title={detail}>
                <span aria-hidden="true">
                  {a.name} · {a.processed}→{a.outputs}{a.fallbacks > 0 ? ` · ${t("suivi.agents.fallbackShort", { n: a.fallbacks })}` : ""}
                </span>
                <span className="ui-sr-only sl-sr-only">{detail}</span>
              </li>
            );
          })}
        </ul>
      ) : res.data ? (
        <p className="sl-empty">{t("suivi.agents.empty")}</p>
      ) : (
        <ErrorOrLoading error={res.error} errorKey="suivi.agents.error" loading={t("suivi.agents.loading")} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

function statusPill(status: string, phase: string): { cls: string; key: string } {
  if (status === "running") return { cls: "is-danger", key: "suivi.status.live" };
  if (status === "done") return { cls: "is-success", key: "suivi.status.done" };
  if (status === "crashed" || status === "failed") return { cls: "is-danger", key: "suivi.status.stopped" };
  return { cls: "", key: phase === "loading" ? "suivi.status.connecting" : "suivi.status.unknown" };
}

export function SuiviLiveTab() {
  const i18n = useT();
  const { t } = i18n;
  const {
    matchId, homeTeam, awayTeam, renderEvents, followedPlayerId, setFollowedPlayerId, openPlayer,
  } = useMatch();
  const [period, setPeriod] = useState<StatsWindow>("match");
  const live = useLiveDashboard(matchId, period);
  const now = useNow(live.updatedAt !== null && live.phase === "live");

  if (!matchId) {
    return (
      <section className="ui-card sl-empty-state" aria-label={t("suivi.tab.aria")}>
        <p className="sl-empty-icon" aria-hidden="true">📡</p>
        <h2 className="ui-heading">{t("suivi.tab.noMatch")}</h2>
        <p>{t("suivi.tab.noMatchHint")}</p>
      </section>
    );
  }

  const ratings = live.ratings.data;
  const stats = live.stats.data;
  const running = live.status === "running";
  const minute = ratings?.minute ?? stats?.minute ?? null;
  const maxMinute = running ? minute : null;
  const pill = statusPill(live.status, live.phase);
  const ago = live.updatedAt !== null ? Math.max(0, Math.round((now - live.updatedAt) / 1000)) : null;
  const followedIdx = followedPlayerId && ratings ? ratings.players.findIndex((p) => p.player_id === followedPlayerId) : -1;
  const followed = followedIdx >= 0 ? ratings?.players[followedIdx] ?? null : null;
  const resources = [live.stats, live.ratings, live.winProb, live.momentum, live.shots, live.agents];
  const allFailed = live.phase !== "loading" && resources.every((r) => r.data === null && r.error !== null);

  return (
    <div className="sl">
      <header className="sl-head">
        <div className="sl-head-left">
          <span className={`ui-pill ${pill.cls}`}>
            {running ? <span className="sl-dot" aria-hidden="true" /> : null}
            {t(pill.key)}
          </span>
          {minute !== null ? <span className="sl-minute">{minute}'</span> : null}
          {stats ? (
            <span className="sl-score" aria-label={t("suivi.tab.scoreAria", {
              home: homeTeam, homeGoals: stats.score.home, away: awayTeam, awayGoals: stats.score.away,
            })}>
              <span className="is-home">{stats.score.home}</span>
              <span aria-hidden="true">–</span>
              <span className="is-away">{stats.score.away}</span>
            </span>
          ) : null}
        </div>
        <div className="sl-head-right">
          {ago !== null ? (
            <span className="sl-updated">
              {live.phase === "live" ? t("suivi.tab.updatedAgo", { s: i18n.num(ago) }) : t("suivi.tab.finalData")}
            </span>
          ) : null}
          {live.phase === "stopped" && live.status !== "done" ? (
            <button type="button" className="ui-btn" onClick={live.retry}>{t("suivi.tab.restart")}</button>
          ) : null}
        </div>
      </header>

      {allFailed ? (
        <div className="ui-card sl-error" role="alert">
          {t("suivi.tab.loadFailed", { error: live.stats.error ? describeError(i18n, live.stats.error) : "" })}
          <button type="button" className="ui-btn sl-retry" onClick={live.retry}>{t("suivi.tab.retry")}</button>
        </div>
      ) : null}

      <div className="sl-grid">
        <div className="sl-col sl-col-stats">
          <MatchStatsFC
            data={stats}
            error={live.stats.error}
            pending={live.statsPending}
            period={period}
            onWindowChange={setPeriod}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
          />
        </div>

        <div className="sl-col sl-col-race">
          {followedPlayerId ? (
            <FollowedPlayerCard
              playerId={followedPlayerId}
              player={followed}
              rank={followedIdx >= 0 ? followedIdx + 1 : null}
              teamName={followed ? (followed.team === "home" ? homeTeam : awayTeam) : null}
              onStop={() => setFollowedPlayerId(null)}
              onOpenPlayer={openPlayer}
            />
          ) : null}
          <MotmRace
            data={ratings}
            error={live.ratings.error}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            followedPlayerId={followedPlayerId}
            onOpenPlayer={openPlayer}
            onFollow={setFollowedPlayerId}
          />
          <LiveAlerts renderEvents={renderEvents} ratings={ratings} tags={live.tags.data} maxMinute={maxMinute} />
        </div>

        <div className="sl-col sl-col-side">
          <WinProbMini res={live.winProb} maxMinute={maxMinute} homeTeam={homeTeam} awayTeam={awayTeam} />
          <MomentumMini res={live.momentum} maxMinute={maxMinute} homeTeam={homeTeam} awayTeam={awayTeam} />
          <ShotMapMini
            data={live.shots.data}
            error={live.shots.error}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            maxMinute={maxMinute}
          />
          <AgentsStrip res={live.agents} />
        </div>
      </div>
    </div>
  );
}
