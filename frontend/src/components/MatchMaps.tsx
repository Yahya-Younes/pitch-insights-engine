import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { fetchPassNetwork, fetchShotMap, fetchThreatPrevented } from "../lib/matchMapsApi";
import type {
  PassNetworkResponse, Shot, ShotMapResponse, TeamSide, ThreatPreventedResponse,
} from "../lib/matchMapsTypes";
import "./MatchMaps.css";

const W = 120;
const H = 80;

type TabId = "threat" | "shots" | "network";
const TABS: { id: TabId; label: string }[] = [
  { id: "threat", label: "Threat prevented" },
  { id: "shots", label: "Shot map" },
  { id: "network", label: "Pass network" },
];

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

const fmt = (n: number, d = 2) => n.toFixed(d);

function Status({ state, onRetry, what }: { state: Load<unknown>; onRetry: () => void; what: string }) {
  if (state.status === "error") {
    return (
      <div className="empty-state">
        <p className="error" role="alert">Couldn't load the {what} for this match.</p>
        <button type="button" className="pitch-play-button" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  return (
    <div className="empty-state" aria-live="polite">
      <p>Loading {what}...</p>
    </div>
  );
}

function TeamToggle({ team, onChange, names }: {
  team: TeamSide; onChange: (t: TeamSide) => void; names: Record<TeamSide, string>;
}) {
  return (
    <div className="mm-toggle" role="group" aria-label="Team">
      {(["home", "away"] as const).map((t) => (
        <button
          key={t}
          type="button"
          className={`mm-toggle-btn mm-${t}${team === t ? " is-active" : ""}`}
          aria-pressed={team === t}
          onClick={() => onChange(t)}
        >
          {names[t]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Threat prevented
// ---------------------------------------------------------------------------

function ThreatView({ data }: { data: ThreatPreventedResponse }) {
  const { home, away } = data.teams;
  const total = home.xt_prevented + away.xt_prevented;
  const homePct = total > 0 ? (home.xt_prevented / total) * 100 : 50;
  const topPlayers = data.players.slice(0, 5);
  const maxMoment = Math.max(0.0001, ...data.top_moments.map((m) => m.xt_prevented));

  if (data.n_actions === 0) {
    return <div className="empty-state"><p>No interceptions or won tackles yet.</p></div>;
  }

  const label =
    `Pitch showing the ${data.top_moments.length} biggest threat-prevention moments. ` +
    data.top_moments
      .map((m, i) => `${i + 1}: ${m.player_name}, ${m.action}, minute ${m.minute}, ${fmt(m.xt_prevented, 3)} xT`)
      .join("; ") + ".";

  return (
    <div className="mm-body">
      <div className="mm-split" aria-label="Threat prevented by team">
        <div className="mm-split-labels">
          <span className="mm-home-text">{home.team_name} <strong>{fmt(home.xt_prevented)}</strong> xT · {home.actions} actions</span>
          <span className="mm-away-text">{away.actions} actions · <strong>{fmt(away.xt_prevented)}</strong> xT {away.team_name}</span>
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
                  <title>{`${m.player_name} · ${m.action} · ${m.minute}' · ${fmt(m.xt_prevented, 3)} xT prevented`}</title>
                </circle>
                <text x={x} y={y + 0.9} className="mm-moment-num" aria-hidden="true">{i + 1}</text>
              </g>
            );
          })}
        </PitchSvg>

        <div className="mm-side">
          <h3 className="mm-h3">Biggest saves</h3>
          <ol className="mm-list">
            {data.top_moments.map((m, i) => (
              <li key={m.event_id || i} className="mm-list-item">
                <span className={`mm-rank mm-fill-${m.team}`}>{i + 1}</span>
                <span className="mm-list-main">
                  <span className="mm-name">{m.player_name}</span>
                  <span className="mm-meta">{m.minute}' · {m.action === "tackle" ? "tackle won" : "interception"}</span>
                </span>
                <span className="mm-value">{fmt(m.xt_prevented, 3)}</span>
              </li>
            ))}
          </ol>
          <h3 className="mm-h3">Top defenders</h3>
          <ol className="mm-list">
            {topPlayers.map((p) => (
              <li key={p.player_id} className="mm-list-item">
                <span className={`mm-dot mm-fill-${p.team}`} aria-hidden="true" />
                <span className="mm-list-main">
                  <span className="mm-name">{p.player_name}</span>
                  <span className="mm-meta">{p.interceptions} int · {p.tackles_won} tkl</span>
                </span>
                <span className="mm-value">{fmt(p.xt_prevented, 3)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="mm-note">
        Each interception or won tackle is credited with the xT the attacking side held where the ball was won
        (interceptions: the intercepted pass's intended target), from the same Markov xT grid as the rest of
        analyst-0. Aerial duels, blocked shots and clearances aren't counted — synthetic events don't attribute them cleanly.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shot map
// ---------------------------------------------------------------------------

const OUTCOME_LABEL: Record<Shot["outcome"], string> = {
  goal: "Goal", saved: "Saved", blocked: "Blocked", off_target: "Off target",
};

function ShotView({ data }: { data: ShotMapResponse }) {
  const { home, away } = data.teams;
  const label =
    `Shot map. ${home.team_name} (attacking right): ${home.shots} shots, ${fmt(home.xg)} xG, ${home.goals} goals. ` +
    `${away.team_name} (attacking left): ${away.shots} shots, ${fmt(away.xg)} xG, ${away.goals} goals. ` +
    "Circle size is proportional to xG; goals are filled and ringed.";
  // Draw goals last so they sit on top.
  const ordered = [...data.shots].sort((a, b) => Number(a.outcome === "goal") - Number(b.outcome === "goal"));

  return (
    <div className="mm-body">
      <div className="mm-totals">
        {(["home", "away"] as const).map((t) => {
          const s = data.teams[t];
          return (
            <div key={t} className={`mm-total mm-total-${t}`}>
              <span className="mm-total-team">{s.team_name} <span className="mm-meta">{t === "home" ? "→" : "←"}</span></span>
              <span className="mm-total-stats">
                <span><strong>{s.shots}</strong> shots</span>
                <span><strong>{fmt(s.xg)}</strong> xG</span>
                <span><strong>{s.goals}</strong> goals</span>
                <span><strong>{s.on_target}</strong> on target</span>
              </span>
            </div>
          );
        })}
      </div>
      {data.shots.length === 0 ? (
        <div className="empty-state"><p>No shots yet.</p></div>
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
                    {`${s.player_name} · ${s.minute}' · ${OUTCOME_LABEL[s.outcome]} · xG ${fmt(s.xg)} · ${Math.round(s.shot_speed_kmh)} km/h`}
                  </title>
                </circle>
              </g>
            );
          })}
        </PitchSvg>
      )}
      <p className="mm-note">
        Circle area ∝ xG; filled + ringed = goal. Hover a shot for player, minute, outcome and shot speed.
        Home attacks right, away attacks left.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pass network
// ---------------------------------------------------------------------------

function NetworkView({ data }: { data: PassNetworkResponse }) {
  const byId = new Map(data.nodes.map((n) => [n.player_id, n]));
  const maxInv = Math.max(1, ...data.nodes.map((n) => n.involvement));
  const maxEdge = Math.max(1, data.max_edge_count);
  const strongest = data.edges.slice(0, 3)
    .map((e) => `${byId.get(e.source)?.player_name ?? e.source} to ${byId.get(e.target)?.player_name ?? e.target} (${e.count})`)
    .join(", ");
  const label =
    `Pass network for ${data.team_name}: ${data.nodes.length} players, ${data.edges.length} passing links of ` +
    `${data.min_edge_count}+ completed passes from ${data.completed_passes} completed passes.` +
    (strongest ? ` Strongest links: ${strongest}.` : "");

  if (data.nodes.length === 0) {
    return <div className="empty-state"><p>No completed passes for {data.team_name} yet.</p></div>;
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
                <title>{`${a.player_name} → ${b.player_name}: ${e.count} passes`}</title>
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
                <title>{`${n.player_name}: ${n.passes} passes made, ${n.received} received`}</title>
              </circle>
              <text x={x} y={y + r + 2.2} className="mm-node-label" aria-hidden="true">{surname(n.player_name)}</text>
            </g>
          );
        })}
      </PitchSvg>
      <p className="mm-note">
        Nodes sit at each player's average pass/receipt location, sized by involvement; lines show
        passer→receiver links with {data.min_edge_count}+ completed passes (thicker = more), {data.completed_passes} completed
        passes in total. Receivers come from each pass's recorded recipient — not inferred.
        {data.team === "home" ? " Attacking right." : " Attacking left."}
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

  // Team names for the toggle: from whichever payload has them, else Home/Away.
  const [names, setNames] = useState<Record<TeamSide, string>>({ home: "Home", away: "Away" });
  useEffect(() => {
    setNames({ home: "Home", away: "Away" });
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

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const idx = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(idx + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    if (!next) return;
    e.preventDefault();
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  let body: ReactNode;
  if (!matchId) {
    body = (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">🗺️</span>
        <p>Run a match to see defensive threat prevented, the shot map and pass networks.</p>
      </div>
    );
  } else if (tab === "threat") {
    body = threat.status === "ok" ? <ThreatView data={threat.data} />
      : <Status state={threat} onRetry={retryThreat} what="threat-prevented data" />;
  } else if (tab === "shots") {
    body = shots.status === "ok" ? <ShotView data={shots.data} />
      : <Status state={shots} onRetry={retryShots} what="shot map" />;
  } else {
    body = (
      <>
        <TeamToggle team={team} onChange={setTeam} names={names} />
        {network.status === "ok" ? <NetworkView data={network.data} />
          : <Status state={network} onRetry={retryNetwork} what="pass network" />}
      </>
    );
  }

  return (
    <section className="feed-panel mm-panel">
      <div className="panel-heading">
        <h2>Match Maps</h2>
        <span
          className="panel-tag"
          title="Deterministic, computed from the match's event stream -- no LLM involved."
        >
          analyst-0 · deterministic
        </span>
      </div>

      <div className="mm-tabs" role="tablist" aria-label="Match map views" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            id={`mm-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="mm-tabpanel"
            tabIndex={tab === t.id ? 0 : -1}
            className={`mm-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="mm-tabpanel" role="tabpanel" aria-labelledby={`mm-tab-${tab}`}>
        {body}
      </div>
      <p className="mm-disclosure">
        Synthetic match data: values come from simulated events, not real Premier League tracking.
      </p>
    </section>
  );
}

export default MatchMaps;
