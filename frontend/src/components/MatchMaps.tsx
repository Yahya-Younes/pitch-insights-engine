import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { fetchPassNetwork, fetchShotMap, fetchThreatPrevented } from "../lib/matchMapsApi";
import type {
  PassNetworkResponse, Shot, ShotMapResponse, TeamSide, ThreatPreventedResponse,
} from "../lib/matchMapsTypes";
import { frNum } from "../lib/frLabels";
import "./MatchMaps.css";

const W = 120;
const H = 80;

type TabId = "threat" | "shots" | "network";
const TABS: { id: TabId; label: string }[] = [
  { id: "threat", label: "Menace évitée" },
  { id: "shots", label: "Carte des tirs" },
  { id: "network", label: "Réseau de passes" },
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

const fmt = (n: number, d = 2) => frNum(n, d);
const plural = (n: number, word: string) => `${word}${n > 1 ? "s" : ""}`;

function Status({ state, onRetry, what }: { state: Load<unknown>; onRetry: () => void; what: string }) {
  if (state.status === "error") {
    return (
      <div className="empty-state">
        <p className="error" role="alert">Impossible de charger {what} pour ce match.</p>
        <button type="button" className="pitch-play-button" onClick={onRetry}>Réessayer</button>
      </div>
    );
  }
  return (
    <div className="empty-state" aria-live="polite">
      <p>Chargement de {what}…</p>
    </div>
  );
}

function TeamToggle({ team, onChange, names }: {
  team: TeamSide; onChange: (t: TeamSide) => void; names: Record<TeamSide, string>;
}) {
  return (
    <div className="mm-toggle" role="group" aria-label="Équipe">
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
    return <div className="empty-state"><p>Aucune interception ni tacle gagné pour l'instant.</p></div>;
  }

  const label =
    `Terrain montrant les ${data.top_moments.length} plus grosses interventions défensives. ` +
    data.top_moments
      .map((m, i) => `${i + 1} : ${m.player_name}, ${actionFr(m.action)}, ${m.minute}e minute, ${fmt(m.xt_prevented, 3)} xT`)
      .join("; ") + ".";

  return (
    <div className="mm-body">
      <div className="mm-split" aria-label="Menace évitée par équipe">
        <div className="mm-split-labels">
          <span className="mm-home-text">{home.team_name} <strong>{fmt(home.xt_prevented)}</strong> xT · {home.actions} {plural(home.actions, "action")}</span>
          <span className="mm-away-text">{away.actions} {plural(away.actions, "action")} · <strong>{fmt(away.xt_prevented)}</strong> xT {away.team_name}</span>
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
                  <title>{`${m.player_name} · ${actionFr(m.action)} · ${m.minute}' · ${fmt(m.xt_prevented, 3)} xT évité`}</title>
                </circle>
                <text x={x} y={y + 0.9} className="mm-moment-num" aria-hidden="true">{i + 1}</text>
              </g>
            );
          })}
        </PitchSvg>

        <div className="mm-side">
          <h3 className="mm-h3">Plus grosses interventions</h3>
          <ol className="mm-list">
            {data.top_moments.map((m, i) => (
              <li key={m.event_id || i} className="mm-list-item">
                <span className={`mm-rank mm-fill-${m.team}`}>{i + 1}</span>
                <span className="mm-list-main">
                  <span className="mm-name">{m.player_name}</span>
                  <span className="mm-meta">{m.minute}' · {actionFr(m.action)}</span>
                </span>
                <span className="mm-value">{fmt(m.xt_prevented, 3)}</span>
              </li>
            ))}
          </ol>
          <h3 className="mm-h3">Meilleurs défenseurs</h3>
          <ol className="mm-list">
            {topPlayers.map((p) => (
              <li key={p.player_id} className="mm-list-item">
                <span className={`mm-dot mm-fill-${p.team}`} aria-hidden="true" />
                <span className="mm-list-main">
                  <span className="mm-name">{p.player_name}</span>
                  <span className="mm-meta">{p.interceptions} int. · {p.tackles_won} tac.</span>
                </span>
                <span className="mm-value">{fmt(p.xt_prevented, 3)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="mm-note">
        Chaque interception ou tacle gagné est crédité de la menace (xT) que détenait l'équipe adverse à l'endroit de la
        récupération (interceptions : la cible visée par la passe interceptée), d'après la même grille xT de Markov que le
        reste d'Analyste-0. Les duels aériens, tirs contrés et dégagements ne sont pas comptés — les événements synthétiques
        ne les attribuent pas proprement.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shot map
// ---------------------------------------------------------------------------

const OUTCOME_LABEL: Record<Shot["outcome"], string> = {
  goal: "But", saved: "Arrêté", blocked: "Contré", off_target: "Non cadré",
};

function actionFr(action: string): string {
  return action === "tackle" ? "tacle gagné" : action === "interception" ? "interception" : action;
}

function ShotView({ data }: { data: ShotMapResponse }) {
  const { home, away } = data.teams;
  const label =
    `Carte des tirs. ${home.team_name} (attaque vers la droite) : ${home.shots} tirs, ${fmt(home.xg)} xG, ${home.goals} buts. ` +
    `${away.team_name} (attaque vers la gauche) : ${away.shots} tirs, ${fmt(away.xg)} xG, ${away.goals} buts. ` +
    "La taille des cercles est proportionnelle aux xG ; les buts sont pleins et cerclés.";
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
                <span><strong>{s.shots}</strong> {plural(s.shots, "tir")}</span>
                <span><strong>{fmt(s.xg)}</strong> xG</span>
                <span><strong>{s.goals}</strong> {plural(s.goals, "but")}</span>
                <span><strong>{s.on_target}</strong> {s.on_target > 1 ? "cadrés" : "cadré"}</span>
              </span>
            </div>
          );
        })}
      </div>
      {data.shots.length === 0 ? (
        <div className="empty-state"><p>Aucun tir pour l'instant.</p></div>
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
                    {`${s.player_name} · ${s.minute}' · ${OUTCOME_LABEL[s.outcome]} · xG ${fmt(s.xg)} · ${frNum(s.shot_speed_kmh, 1)} km/h`}
                  </title>
                </circle>
              </g>
            );
          })}
        </PitchSvg>
      )}
      <p className="mm-note">
        Aire du cercle ∝ xG ; plein + cerclé = but. Survole un tir pour voir le joueur, la minute, l'issue et la vitesse
        de frappe. Le domicile attaque vers la droite, l'extérieur vers la gauche.
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
    .map((e) => `${byId.get(e.source)?.player_name ?? e.source} vers ${byId.get(e.target)?.player_name ?? e.target} (${e.count})`)
    .join(", ");
  const label =
    `Réseau de passes de ${data.team_name} : ${data.nodes.length} joueurs, ${data.edges.length} liaisons d'au moins ` +
    `${data.min_edge_count} passes réussies, sur ${data.completed_passes} passes réussies.` +
    (strongest ? ` Liaisons les plus fortes : ${strongest}.` : "");

  if (data.nodes.length === 0) {
    return <div className="empty-state"><p>Aucune passe réussie pour {data.team_name} pour l'instant.</p></div>;
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
                <title>{`${a.player_name} → ${b.player_name} : ${e.count} passes`}</title>
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
                <title>{`${n.player_name} : ${n.passes} passes données, ${n.received} reçues`}</title>
              </circle>
              <text x={x} y={y + r + 2.2} className="mm-node-label" aria-hidden="true">{surname(n.player_name)}</text>
            </g>
          );
        })}
      </PitchSvg>
      <p className="mm-note">
        Chaque joueur est placé à sa position moyenne de passe/réception, taille selon son implication ; les traits
        montrent les liaisons passeur→receveur d'au moins {data.min_edge_count} passes réussies (plus épais = plus
        fréquent), {data.completed_passes} passes réussies au total. Le receveur vient du destinataire enregistré de
        chaque passe — rien n'est déduit.
        {data.team === "home" ? " Attaque vers la droite." : " Attaque vers la gauche."}
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

  // Team names for the toggle: from whichever payload has them, else Domicile/Extérieur.
  const [names, setNames] = useState<Record<TeamSide, string>>({ home: "Domicile", away: "Extérieur" });
  useEffect(() => {
    setNames({ home: "Domicile", away: "Extérieur" });
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
        <p>Lance un match pour voir la menace évitée en défense, la carte des tirs et les réseaux de passes.</p>
      </div>
    );
  } else if (tab === "threat") {
    body = threat.status === "ok" ? <ThreatView data={threat.data} />
      : <Status state={threat} onRetry={retryThreat} what="la menace évitée" />;
  } else if (tab === "shots") {
    body = shots.status === "ok" ? <ShotView data={shots.data} />
      : <Status state={shots} onRetry={retryShots} what="la carte des tirs" />;
  } else {
    body = (
      <>
        <TeamToggle team={team} onChange={setTeam} names={names} />
        {network.status === "ok" ? <NetworkView data={network.data} />
          : <Status state={network} onRetry={retryNetwork} what="le réseau de passes" />}
      </>
    );
  }

  return (
    <section className="feed-panel mm-panel">
      <div className="panel-heading">
        <h2>Cartes du match</h2>
        <span
          className="panel-tag"
          title="Déterministe, calculé à partir du flux d'événements du match -- aucun LLM."
        >
          analyste-0 · déterministe
        </span>
      </div>

      <div className="mm-tabs" role="tablist" aria-label="Vues des cartes du match" onKeyDown={onTabKey}>
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
        Données de match synthétiques : les valeurs proviennent d'événements simulés, pas d'un vrai tracking de Premier League.
      </p>
    </section>
  );
}

export default MatchMaps;
