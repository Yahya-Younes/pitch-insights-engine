import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPlayerTags, recentTagsAt } from "../lib/playerTagsApi";
import type { PlayerPhysical, PlayerTag, PlayerTagKind, PlayerTagsResponse } from "../lib/playerTagsApi";
import { frNum, frRaw } from "../lib/frLabels";
import "./PlayerTags.css";

interface Props {
  matchId: string | null;
  /**
   * Optional external playhead (match time, ms). When provided the ticker
   * follows it (e.g. PitchView's playhead); when omitted the panel runs its
   * own play/pause/scrub controls.
   */
  currentTimeMs?: number;
}

const TICKER_SIZE = 6;
const PLAYBACK_RATES = [30, 60, 120] as const;

const KIND_LABEL: Record<PlayerTagKind, string> = {
  sprint: "Sprint",
  distance_km: "Distance",
  top_speed: "Vitesse max",
};

const OUTCOME_FR: Record<string, string> = {
  goal: "but", saved: "arrêté", blocked: "contré", off_target: "non cadré",
};

/** French ticker text built from the tag's structured fields (the API label is English). */
function tagText(tag: PlayerTag, name: string | undefined): string {
  if (!name) return tag.label;
  if (tag.kind === "distance_km") return `${name} a parcouru ${tag.value} km`;
  if (tag.kind === "top_speed") return `Nouvelle vitesse max du match : ${name}, ${frNum(tag.value, 1)} km/h`;
  return `Sprint de ${name}, ${frNum(tag.value, 1)} km/h`;
}

function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function topBy(players: PlayerPhysical[], key: "distance_km" | "top_speed_kmh"): PlayerPhysical[] {
  return [...players].sort((a, b) => b[key] - a[key] || a.player_id.localeCompare(b.player_id)).slice(0, 5);
}

function TeamDot({ team }: { team: string }) {
  return <span className={`player-tags-dot player-tags-dot-${team}`} aria-hidden="true" />;
}

export function PlayerTags({ matchId, currentTimeMs }: Props) {
  const [data, setData] = useState<PlayerTagsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<number>(60);
  const [ownPlayheadMs, setOwnPlayheadMs] = useState(0);
  const [milestonesOnly, setMilestonesOnly] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  const external = currentTimeMs !== undefined;

  useEffect(() => {
    if (!matchId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = matchId;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setLoading(true);
    setError(null);
    setData(null);
    setOwnPlayheadMs(0);
    // Positions are stored before /matches/run returns, so this normally
    // succeeds first time; two short retries absorb request-ordering jitter.
    async function load() {
      try {
        const res = await fetchPlayerTags(id);
        if (cancelled) return;
        setData(res);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        attempt += 1;
        if (attempt < 3) {
          retryTimer = setTimeout(load, 600);
        } else {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [matchId, reloadKey]);

  const totalMs = data?.duration_ms ?? data?.tags.at(-1)?.t_ms ?? 0;

  useEffect(() => {
    if (external || !playing || totalMs <= 0) return;
    function tick(now: number) {
      if (lastTickRef.current !== null) {
        const delta = (now - lastTickRef.current) * rate;
        setOwnPlayheadMs((prev) => {
          const next = prev + delta;
          if (next >= totalMs) {
            setPlaying(false);
            return totalMs;
          }
          return next;
        });
      }
      lastTickRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
    };
  }, [external, playing, rate, totalMs]);

  const playheadMs = external ? currentTimeMs : ownPlayheadMs;

  const visibleTags = useMemo<PlayerTag[]>(
    () => (data ? (milestonesOnly ? data.tags.filter((t) => t.kind !== "sprint") : data.tags) : []),
    [data, milestonesOnly],
  );
  const ticker = useMemo(() => recentTagsAt(visibleTags, playheadMs, TICKER_SIZE), [visibleTags, playheadMs]);

  const nameOf = useMemo(() => {
    const m = new Map<string, PlayerPhysical>();
    for (const p of data?.players ?? []) m.set(p.player_id, p);
    return m;
  }, [data]);

  const byDistance = useMemo(() => (data ? topBy(data.players, "distance_km") : []), [data]);
  const bySpeed = useMemo(() => (data ? topBy(data.players, "top_speed_kmh") : []), [data]);

  function togglePlay() {
    if (!playing && ownPlayheadMs >= totalMs) setOwnPlayheadMs(0);
    setPlaying((p) => !p);
  }

  return (
    <section className="feed-panel player-tags-panel" aria-labelledby="player-tags-heading">
      <div className="panel-heading">
        <h2 id="player-tags-heading">Vitesse et distance</h2>
        <span
          className="panel-tag"
          title={data?.method ?? "Calculé à partir de la trace de positions synthétique interpolée -- aucun appel LLM."}
        >
          Tracking synthétique &middot; sans LLM
        </span>
      </div>

      {!matchId && (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">&#9201;</span>
          Lance un match pour voir les distances parcourues, vitesses max, sprints et vitesses de frappe.
        </div>
      )}

      {matchId && loading && (
        <div className="player-tags-loading" role="status">
          <span className="spinner" aria-hidden="true" /> Calcul des vitesses à partir de la trace de positions&hellip;
        </div>
      )}

      {matchId && error && (
        <div className="player-tags-error">
          <p className="error" role="alert">Impossible de charger les étiquettes joueurs : {error}</p>
          <button type="button" className="player-tags-button" onClick={() => setReloadKey((k) => k + 1)}>
            Réessayer
          </button>
        </div>
      )}

      {data && data.players.length === 0 && (
        <div className="empty-state">Aucune position de joueur n'a été enregistrée pour ce match.</div>
      )}

      {data && data.players.length > 0 && (
        <>
          <div className="player-tags-boards commentary-in">
            <div className="player-tags-card">
              <h3>Distance parcourue</h3>
              <ol aria-label="Top 5 des joueurs par distance parcourue">
                {byDistance.map((p) => (
                  <li key={p.player_id}>
                    <TeamDot team={p.team} />
                    <span className="player-tags-name">{p.name}</span>
                    <span className="player-tags-value">{frNum(p.distance_km, 2)} km</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="player-tags-card">
              <h3>Vitesse max</h3>
              <ol aria-label="Top 5 des joueurs par vitesse max">
                {bySpeed.map((p) => (
                  <li key={p.player_id}>
                    <TeamDot team={p.team} />
                    <span className="player-tags-name">{p.name}</span>
                    <span className="player-tags-value">
                      {frNum(p.top_speed_kmh, 1)} km/h
                      <span className="player-tags-sub">{p.sprints} sprint{p.sprints > 1 ? "s" : ""}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="player-tags-card">
              <h3>Vitesse du ballon</h3>
              {data.fastest_shot ? (
                <div className="player-tags-hero" aria-label="Frappe la plus rapide">
                  <span className="player-tags-hero-value">
                    {frNum(data.fastest_shot.speed_kmh, 1)}<small> km/h</small>
                  </span>
                  <span className="player-tags-hero-caption">
                    Frappe la plus rapide &middot; <TeamDot team={data.fastest_shot.team} />
                    {data.fastest_shot.name} &middot; {data.fastest_shot.game_clock}
                    {data.fastest_shot.outcome ? ` · ${OUTCOME_FR[data.fastest_shot.outcome] ?? data.fastest_shot.outcome.replace("_", " ")}` : ""}
                    {data.fastest_shot.xg !== null ? ` · xG ${frNum(data.fastest_shot.xg, 2)}` : ""}
                  </span>
                </div>
              ) : (
                <p className="player-tags-muted">Aucun tir pour l'instant.</p>
              )}
              {data.fastest_pass && (
                <p className="player-tags-muted">
                  Passe la plus rapide : <strong>{frNum(data.fastest_pass.speed_kmh, 1)} km/h</strong> par{" "}
                  {data.fastest_pass.name} ({data.fastest_pass.game_clock}) &middot; {data.shots.length} tirs,{" "}
                  {data.passes_counted} passes mesurées
                </p>
              )}
            </div>
          </div>

          <div className="player-tags-live">
            <div className="player-tags-live-head">
              <h3>Étiquettes en direct</h3>
              <span className="player-tags-clock" aria-label="Chrono du match">{formatClock(playheadMs)}</span>
            </div>

            <div className="player-tags-controls">
              {!external && (
                <>
                  <button
                    type="button"
                    className="player-tags-button"
                    onClick={togglePlay}
                    aria-label={playing ? "Mettre en pause les étiquettes" : "Lire les étiquettes en direct"}
                  >
                    {playing ? "Pause" : "Lecture"}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(totalMs, 1)}
                    step={1000}
                    value={Math.min(ownPlayheadMs, totalMs)}
                    onChange={(e) => setOwnPlayheadMs(Number(e.target.value))}
                    aria-label="Se déplacer dans le match"
                    aria-valuetext={formatClock(ownPlayheadMs)}
                  />
                  <select
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    aria-label="Vitesse de lecture"
                  >
                    {PLAYBACK_RATES.map((r) => <option key={r} value={r}>{r}&times;</option>)}
                  </select>
                </>
              )}
              <label className="player-tags-toggle">
                <input
                  type="checkbox"
                  checked={milestonesOnly}
                  onChange={(e) => setMilestonesOnly(e.target.checked)}
                />
                Jalons uniquement
              </label>
            </div>

            {ticker.length === 0 ? (
              <p className="player-tags-muted">
                {playheadMs <= 0 && !external ? "Appuie sur Lecture pour rejouer les étiquettes au fil du match." : "Aucune étiquette à ce stade du match."}
              </p>
            ) : (
              <ul className="player-tags-ticker" role="log" aria-live={playing ? "off" : "polite"} aria-label="Étiquettes joueurs récentes">
                {ticker.map((t) => (
                  <li key={`${t.kind}-${t.player_id}-${t.t_ms}`} className={`player-tags-tag player-tags-tag-${t.kind}`}>
                    <span className="player-tags-tag-clock">{t.game_clock}</span>
                    <span className="player-tags-tag-kind">{KIND_LABEL[t.kind]}</span>
                    <TeamDot team={nameOf.get(t.player_id)?.team ?? "unknown"} />
                    <span className="player-tags-tag-label">{tagText(t, nameOf.get(t.player_id)?.name)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="player-tags-disclosure">
            Synthétique, pas un vrai tracking : dérivé de la trace de positions interpolée sur un terrain de{" "}
            {data.thresholds.pitch_m[0]}&times;{data.thresholds.pitch_m[1]} m, lissée sur 1 s ; sprint &ge;{" "}
            {frRaw(data.thresholds.sprint_kmh)} km/h ; {frRaw(data.speed_samples_excluded_pct)} % des pas au-dessus de{" "}
            {frRaw(data.thresholds.max_plausible_kmh)} km/h écartés comme artefacts d'interpolation. Les distances sont
            bien inférieures aux totaux réels de Premier League ; les vitesses du ballon sont les valeurs propres du simulateur.
          </p>
        </>
      )}
    </section>
  );
}
