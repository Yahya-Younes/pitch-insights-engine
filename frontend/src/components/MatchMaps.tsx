import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { fetchPassNetwork, fetchShotMap, fetchThreatPrevented } from "../lib/matchMapsApi";
import type {
  PassNetworkResponse, Shot, ShotMapResponse, TeamSide, ThreatPreventedResponse,
} from "../lib/matchMapsTypes";
import { useT, type I18n } from "../i18n";
import { plural } from "../lib/panelLabels";
import "./MatchMaps.css";

const W = 120;
const H = 80;

type TabId = "threat" | "shots" | "network";
const TABS: TabId[] = ["threat", "shots", "network"];

type Load<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

/** Fetch `key`-scoped data with a couple of short retries (match data is
 * stored the instant a run starts, so retries only absorb request jitter). */
function useLoad<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ status: "idle" });
  const [reload, setReload] = useState(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key === null) {
      setState({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState({ status: "loading" });
    const run = () => {
      fetcherRef.current(ctrl.signal)
        .then((data) => { if (!ctrl.signal.aborted) setState({ status: "ok", data }); })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          attempt += 1;
          if (attempt < 3) timer = setTimeout(run, 800);
          else setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        });
    };
    run();
    return () => {
      ctrl.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [key, reload]);

  return [state, () => setReload((r) => r + 1)];
}

// ---------------------------------------------------------------------------
// Shared pitch
// ---------------------------------------------------------------------------

function PitchSvg({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg className="mm-pitch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect x={0} y={0} width={W} height={H} className="mm-grass" />
      <g className="mm-line" aria-hidden="true">
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} />
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} />
        <circle cx={W / 2} cy={H / 2} r={9} />
        <circle cx={W / 2} cy={H / 2} r={0.4} className="mm-spot" />
        {/* penalty areas, six-yard boxes, spots and goals (StatsBomb dims) */}
        <rect x={0.5} y={18} width={17.5} height={44} />
        <rect x={W - 18} y={18} width={17.5} height={44} />
        <rect x={0.5} y={30} width={5.5} height={20} />
        <rect x={W - 6} y={30} width={5.5} height={20} />
        <circle cx={12} cy={H / 2} r={0.4} className="mm-spot" />
        <circle cx={W - 12} cy={H / 2} r={0.4} className="mm-spot" />
        <rect x={-1} y={36} width={1.5} height={8} className="mm-goal" />
        <rect x={W - 0.5} y={36} width={1.5} height={8} className="mm-goal" />
      </g>
      {children}
    </svg>
  );
}

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function Status({ state, onRetry, what }: { state: Load<unknown>; onRetry: () => void; what: TabId }) {
  const { t } = useT();
  if (state.status === "error") {
    return (
      <div className="empty-state">
        <p className="error" role="alert">{t(`panels.maps.error.${what}`)}</p>
        <button type="button" className="pitch-play-button" onClick={onRetry}>{t("panels.retry")}</button>
      </div>
    );
  }
  return (
    <div className="empty-state" aria-live="polite">
      <p>{t(`panels.maps.loading.${what}`)}</p>
    </div>
  );
}

function TeamToggle({ team, onChange, names }: {
  team: TeamSide; onChange: (t: TeamSide) => void; names: Record<TeamSide, string>;
}) {
  const { t } = useT();
  return (
    <div className="mm-toggle" role="group" aria-label={t("panels.maps.teamAria")}>
      {(["home", "away"] as const).map((side) => (
        <button
          key={side}
          type="button"
          className={`mm-toggle-btn mm-${side}${team === side ? " is-active" : ""}`}
          aria-pressed={team === side}
          onClick={() => onChange(side)}
        >
          {names[side]}
        </button>
      ))}
    </div>
  );
}

const outcomeLabel = (i18n: I18n, outcome: Shot["outcome"]) => i18n.t(`panels.outcome.${outcome}`);

function actionLabel(i18n: I18n, action: string): string {
  return action === "tackle" || action === "interception" ? i18n.t(`panels.maps.action.${action}`) : action;
}

// ---------------------------------------------------------------------------
// Threat prevented
// ---------------------------------------------------------------------------

function ThreatView({ data }: { data: ThreatPreventedResponse }) {
  const i18n = useT();
  const { t } = i18n;
  const fmt = (n: number, d = 2) => i18n.num(n, d);
  const { home, away } = data.teams;
  const total = home.xt_prevented + away.xt_prevented;
  const homePct = total > 0 ? (home.xt_prevented / total) * 100 : 50;
  const topPlayers = data.players.slice(0, 5);
  const maxMoment = Math.max(0.0001, ...data.top_moments.map((m) => m.xt_prevented));

  if (data.n_actions === 0) {
    return <div className="empty-state"><p>{t("panels.maps.threat.none")}</p></div>;
  }

  const label =
    t("panels.maps.threat.pitchAria", { n: data.top_moments.length }) + " " +
    data.top_moments
      .map((m, i) => t("panels.maps.threat.momentAria", {
        rank: i + 1, name: m.player_name, action: actionLabel(i18n, m.action), minute: m.minute, xt: fmt(m.xt_prevented, 3),
      }))
      .join("; ") + ".";

  return (
    <div className="mm-body">
      <div className="mm-split" aria-label={t("panels.maps.threat.splitAria")}>
        <div className="mm-split-labels">
          <span className="mm-home-text">{home.team_name} <strong>{fmt(home.xt_prevented)}</strong> xT · {plural(i18n, "panels.maps.actions", home.actions)}</span>
          <span className="mm-away-text">{plural(i18n, "panels.maps.actions", away.actions)} · <strong>{fmt(away.xt_prevented)}</strong> xT {away.team_name}</span>
        </div>
        <div className="mm-split-bar" aria-hidden="true">
          <span className="mm-split-home" style={{ width: `${homePct}%` }} />
          <span className="mm-split-away" style={{ width: `${100 - homePct}%` }} />
        </div>
      </div>

      <div className="mm-grid">
        <PitchSvg label={label}>
          {data.top_moments.map((m, i) => {
            const [x, y] = m.location;
            const r = 1.6 + (m.xt_prevented / maxMoment) * 2.6;
            return (
              <g key={m.event_id || i}>
                {m.valued_at[0] !== m.location[0] || m.valued_at[1] !== m.location[1] ? (
                  <line x1={m.valued_at[0]} y1={m.valued_at[1]} x2={x} y2={y} className={`mm-intent mm-stroke-${m.team}`} />
                ) : null}
                <circle cx={x} cy={y} r={r} className={`mm-moment mm-fill-${m.team}`}>
                  <title>{t("panels.maps.threat.momentTitle", {
                    name: m.player_name, action: actionLabel(i18n, m.action), minute: m.minute, xt: fmt(m.xt_prevented, 3),
                  })}</title>
                </circle>
                <text x={x} y={y + 0.9} className="mm-moment-num" aria-hidden="true">{i + 1}</text>
              </g>
            );
          })}
        </PitchSvg>

        <div className="mm-side">
          <h3 className="mm-h3">{t("panels.maps.threat.topMoments")}</h3>
          <ol className="mm-list">
            {data.top_moments.map((m, i) => (
              <li key={m.event_id || i} className="mm-list-item">
                <span className={`mm-rank mm-fill-${m.team}`}>{i + 1}</span>
                <span className="mm-list-main">
                  <span className="mm-name">{m.player_name}</span>
                  <span className="mm-meta">{m.minute}' · {actionLabel(i18n, m.action)}</span>
                </span>
                <span className="mm-value">{fmt(m.xt_prevented, 3)}</span>
              </li>
            ))}
          </ol>
          <h3 className="mm-h3">{t("panels.maps.threat.topDefenders")}</h3>
          <ol className="mm-list">
            {topPlayers.map((p) => (
              <li key={p.player_id} className="mm-list-item">
                <span className={`mm-dot mm-fill-${p.team}`} aria-hidden="true" />
                <span className="mm-list-main">
                  <span className="mm-name">{p.player_name}</span>
                  <span className="mm-meta">{t("panels.maps.threat.defMeta", { int: p.interceptions, tac: p.tackles_won })}</span>
                </span>
                <span className="mm-value">{fmt(p.xt_prevented, 3)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="mm-note">{t("panels.maps.threat.note")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shot map
// ---------------------------------------------------------------------------

function ShotView({ data }: { data: ShotMapResponse }) {
  const i18n = useT();
  const { t } = i18n;
  const fmt = (n: number, d = 2) => i18n.num(n, d);
  const { home, away } = data.teams;
  const label = t("panels.maps.shots.aria", {
    home: home.team_name, hs: home.shots, hxg: fmt(home.xg), hg: home.goals,
    away: away.team_name, as: away.shots, axg: fmt(away.xg), ag: away.goals,
  });
  // Draw goals last so they sit on top.
  const ordered = [...data.shots].sort((a, b) => Number(a.outcome === "goal") - Number(b.outcome === "goal"));

  return (
    <div className="mm-body">
      <div className="mm-totals">
        {(["home", "away"] as const).map((side) => {
          const s = data.teams[side];
          return (
            <div key={side} className={`mm-total mm-total-${side}`}>
              <span className="mm-total-team">{s.team_name} <span className="mm-meta">{side === "home" ? "→" : "←"}</span></span>
              <span className="mm-total-stats">
                <span><strong>{s.shots}</strong> {plural(i18n, "panels.maps.word.shot", s.shots)}</span>
                <span><strong>{fmt(s.xg)}</strong> xG</span>
                <span><strong>{s.goals}</strong> {plural(i18n, "panels.maps.word.goal", s.goals)}</span>
                <span><strong>{s.on_target}</strong> {plural(i18n, "panels.maps.word.onTarget", s.on_target)}</span>
              </span>
            </div>
          );
        })}
      </div>
      {data.shots.length === 0 ? (
        <div className="empty-state"><p>{t("panels.maps.shots.none")}</p></div>
      ) : (
        <PitchSvg label={label}>
          {ordered.map((s) => {
            const [x, y] = s.location;
            const r = 0.7 + Math.sqrt(s.xg) * 4.2;
            const goal = s.outcome === "goal";
            return (
              <g key={s.event_id}>
                {goal ? <circle cx={x} cy={y} r={r + 0.9} className={`mm-goal-ring mm-stroke-${s.team}`} /> : null}
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  className={`mm-shot mm-stroke-${s.team} ${goal ? `mm-fill-${s.team}` : "mm-shot-miss"}`}
                >
                  <title>
                    {`${s.player_name} · ${s.minute}' · ${outcomeLabel(i18n, s.outcome)} · xG ${fmt(s.xg)} · ${fmt(s.shot_speed_kmh, 1)} km/h`}
                  </title>
                </circle>
              </g>
            );
          })}
        </PitchSvg>
      )}
      <p className="mm-note">{t("panels.maps.shots.note")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pass network
// ---------------------------------------------------------------------------

function NetworkView({ data }: { data: PassNetworkResponse }) {
  const { t } = useT();
  const byId = new Map(data.nodes.map((n) => [n.player_id, n]));
  const maxInv = Math.max(1, ...data.nodes.map((n) => n.involvement));
  const maxEdge = Math.max(1, data.max_edge_count);
  const strongest = data.edges.slice(0, 3)
    .map((e) => t("panels.maps.network.strongEdge", {
      from: byId.get(e.source)?.player_name ?? e.source, to: byId.get(e.target)?.player_name ?? e.target, n: e.count,
    }))
    .join(", ");
  const label =
    t("panels.maps.network.aria", {
      team: data.team_name, nodes: data.nodes.length, edges: data.edges.length,
      min: data.min_edge_count, total: data.completed_passes,
    }) +
    (strongest ? " " + t("panels.maps.network.ariaStrongest", { list: strongest }) : "");

  if (data.nodes.length === 0) {
    return <div className="empty-state"><p>{t("panels.maps.network.none", { team: data.team_name })}</p></div>;
  }

  return (
    <div className="mm-body">
      <PitchSvg label={label}>
        <g>
          {data.edges.map((e) => {
            const a = byId.get(e.source);
            const b = byId.get(e.target);
            if (!a || !b) return null;
            const [x1, y1] = a.avg_location;
            const [x2, y2] = b.avg_location;
            // Offset each directed edge sideways so A→B and B→A don't overlap.
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            const ox = (-dy / len) * 0.6;
            const oy = (dx / len) * 0.6;
            const w = 0.25 + (e.count / maxEdge) * 1.4;
            return (
              <line
                key={`${e.source}-${e.target}`}
                x1={x1 + ox} y1={y1 + oy} x2={x2 + ox} y2={y2 + oy}
                className={`mm-edge mm-stroke-${data.team}`}
                strokeWidth={w}
                strokeOpacity={0.25 + (e.count / maxEdge) * 0.6}
              >
                <title>{t("panels.maps.network.edgeTitle", { from: a.player_name, to: b.player_name, n: e.count })}</title>
              </line>
            );
          })}
        </g>
        {data.nodes.map((n) => {
          const [x, y] = n.avg_location;
          const r = 1.4 + Math.sqrt(n.involvement / maxInv) * 2.6;
          return (
            <g key={n.player_id}>
              <circle cx={x} cy={y} r={r} className={`mm-node mm-fill-${data.team}`}>
                <title>{t("panels.maps.network.nodeTitle", { name: n.player_name, given: n.passes, received: n.received })}</title>
              </circle>
              <text x={x} y={y + r + 2.2} className="mm-node-label" aria-hidden="true">{surname(n.player_name)}</text>
            </g>
          );
        })}
      </PitchSvg>
      <p className="mm-note">
        {t("panels.maps.network.note", { min: data.min_edge_count, total: data.completed_passes })}{" "}
        {t(data.team === "home" ? "panels.maps.network.attackRight" : "panels.maps.network.attackLeft")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface Props {
  matchId: string | null;
}

export function MatchMaps({ matchId }: Props) {
  const { t } = useT();
  const [tab, setTab] = useState<TabId>("threat");
  const [team, setTeam] = useState<TeamSide>("home");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ threat: null, shots: null, network: null });

  const [threat, retryThreat] = useLoad(
    matchId && tab === "threat" ? `t:${matchId}` : null,
    (s) => fetchThreatPrevented(matchId ?? "", s),
  );
  const [shots, retryShots] = useLoad(
    matchId && tab === "shots" ? `s:${matchId}` : null,
    (s) => fetchShotMap(matchId ?? "", s),
  );
  const [network, retryNetwork] = useLoad(
    matchId && tab === "network" ? `n:${matchId}:${team}` : null,
    (s) => fetchPassNetwork(matchId ?? "", team, 3, s),
  );

  // Team names for the toggle: from whichever payload has them, else the
  // generic home/away labels (resolved at render so they follow the language).
  const [names, setNames] = useState<Record<TeamSide, string | null>>({ home: null, away: null });
  useEffect(() => {
    setNames({ home: null, away: null });
  }, [matchId]);
  useEffect(() => {
    const src = threat.status === "ok" ? threat.data.teams : shots.status === "ok" ? shots.data.teams : null;
    if (src) setNames({ home: src.home.team_name, away: src.away.team_name });
  }, [threat, shots]);
  useEffect(() => {
    if (network.status === "ok") {
      const other: TeamSide = network.data.team === "home" ? "away" : "home";
      setNames((prev) => ({ ...prev, [network.data.team]: network.data.team_name, [other]: prev[other] }));
    }
  }, [network]);
  const shownNames: Record<TeamSide, string> = {
    home: names.home ?? t("panels.home"),
    away: names.away ?? t("panels.away"),
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const idx = TABS.indexOf(tab);
    const next = TABS[(idx + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  let body: ReactNode;
  if (!matchId) {
    body = (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">🗺️</span>
        <p>{t("panels.maps.empty")}</p>
      </div>
    );
  } else if (tab === "threat") {
    body = threat.status === "ok" ? <ThreatView data={threat.data} />
      : <Status state={threat} onRetry={retryThreat} what="threat" />;
  } else if (tab === "shots") {
    body = shots.status === "ok" ? <ShotView data={shots.data} />
      : <Status state={shots} onRetry={retryShots} what="shots" />;
  } else {
    body = (
      <>
        <TeamToggle team={team} onChange={setTeam} names={shownNames} />
        {network.status === "ok" ? <NetworkView data={network.data} />
          : <Status state={network} onRetry={retryNetwork} what="network" />}
      </>
    );
  }

  return (
    <section className="feed-panel mm-panel">
      <div className="panel-heading">
        <h2>{t("panels.maps.title")}</h2>
        <span className="panel-tag" title={t("panels.maps.tagTitle")}>
          {t("panels.maps.tag")}
        </span>
      </div>

      <div className="mm-tabs" role="tablist" aria-label={t("panels.maps.tabsAria")} onKeyDown={onTabKey}>
        {TABS.map((id) => (
          <button
            key={id}
            ref={(el) => { tabRefs.current[id] = el; }}
            id={`mm-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="mm-tabpanel"
            tabIndex={tab === id ? 0 : -1}
            className={`mm-tab${tab === id ? " is-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {t(`panels.maps.tab.${id}`)}
          </button>
        ))}
      </div>

      <div id="mm-tabpanel" role="tabpanel" aria-labelledby={`mm-tab-${tab}`}>
        {body}
      </div>
      <p className="mm-disclosure">{t("panels.maps.disclosure")}</p>
    </section>
  );
}

export default MatchMaps;
