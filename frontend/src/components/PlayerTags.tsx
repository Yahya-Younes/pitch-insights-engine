import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPlayerTags, recentTagsAt } from "../lib/playerTagsApi";
import type { PlayerPhysical, PlayerTag, PlayerTagsResponse } from "../lib/playerTagsApi";
import { useT, type I18n } from "../i18n";
import { plural, rawNum, rawPct } from "../lib/panelLabels";
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

/** Ticker text built from the tag's structured fields (the API label is English-only). */
function tagText(i18n: I18n, tag: PlayerTag, name: string | undefined): string {
  if (!name) return tag.label;
  if (tag.kind === "distance_km") return i18n.t("panels.tags.text.distance", { name, km: rawNum(i18n, tag.value) });
  if (tag.kind === "top_speed") return i18n.t("panels.tags.text.topSpeed", { name, speed: i18n.num(tag.value, 1) });
  return i18n.t("panels.tags.text.sprint", { name, speed: i18n.num(tag.value, 1) });
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
  const i18n = useT();
  const { t } = i18n;
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
    () => (data ? (milestonesOnly ? data.tags.filter((tag) => tag.kind !== "sprint") : data.tags) : []),
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

  // The API's `method` is French-only: show the same disclosure from the catalog.
  const methodTitle = data
    ? t("panels.tags.method", { max: rawNum(i18n, data.thresholds.max_plausible_kmh) })
    : t("panels.tags.methodShort");

  return (
    <section className="feed-panel player-tags-panel" aria-labelledby="player-tags-heading">
      <div className="panel-heading">
        <h2 id="player-tags-heading">{t("panels.tags.title")}</h2>
        <span className="panel-tag" title={methodTitle}>
          {t("panels.tags.tag")}
        </span>
      </div>

      {!matchId && (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">&#9201;</span>
          {t("panels.tags.empty")}
        </div>
      )}

      {matchId && loading && (
        <div className="player-tags-loading" role="status">
          <span className="spinner" aria-hidden="true" /> {t("panels.tags.loading")}
        </div>
      )}

      {matchId && error && (
        <div className="player-tags-error">
          <p className="error" role="alert">{t("panels.tags.error", { error })}</p>
          <button type="button" className="player-tags-button" onClick={() => setReloadKey((k) => k + 1)}>
            {t("panels.retry")}
          </button>
        </div>
      )}

      {data && data.players.length === 0 && (
        <div className="empty-state">{t("panels.tags.noPlayers")}</div>
      )}

      {data && data.players.length > 0 && (
        <>
          <div className="player-tags-boards commentary-in">
            <div className="player-tags-card">
              <h3>{t("panels.tags.distanceTitle")}</h3>
              <ol aria-label={t("panels.tags.distanceAria")}>
                {byDistance.map((p) => (
                  <li key={p.player_id}>
                    <TeamDot team={p.team} />
                    <span className="player-tags-name">{p.name}</span>
                    <span className="player-tags-value">{i18n.num(p.distance_km, 2)} km</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="player-tags-card">
              <h3>{t("panels.tags.speedTitle")}</h3>
              <ol aria-label={t("panels.tags.speedAria")}>
                {bySpeed.map((p) => (
                  <li key={p.player_id}>
                    <TeamDot team={p.team} />
                    <span className="player-tags-name">{p.name}</span>
                    <span className="player-tags-value">
                      {i18n.num(p.top_speed_kmh, 1)} km/h
                      <span className="player-tags-sub">{plural(i18n, "panels.tags.sprints", p.sprints)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="player-tags-card">
              <h3>{t("panels.tags.ballSpeed")}</h3>
              {data.fastest_shot ? (
                <div className="player-tags-hero" aria-label={t("panels.tags.fastestShot")}>
                  <span className="player-tags-hero-value">
                    {i18n.num(data.fastest_shot.speed_kmh, 1)}<small> km/h</small>
                  </span>
                  <span className="player-tags-hero-caption">
                    {t("panels.tags.fastestShot")} &middot; <TeamDot team={data.fastest_shot.team} />
                    {data.fastest_shot.name} &middot; {data.fastest_shot.game_clock}
                    {data.fastest_shot.outcome ? ` · ${t(`panels.outcome.${data.fastest_shot.outcome}`)}` : ""}
                    {data.fastest_shot.xg !== null ? ` · xG ${i18n.num(data.fastest_shot.xg, 2)}` : ""}
                  </span>
                </div>
              ) : (
                <p className="player-tags-muted">{t("panels.tags.noShots")}</p>
              )}
              {data.fastest_pass && (
                <p className="player-tags-muted">
                  {t("panels.tags.fastestPass")} <strong>{i18n.num(data.fastest_pass.speed_kmh, 1)} km/h</strong>{" "}
                  {t("panels.tags.fastestPassBy", {
                    name: data.fastest_pass.name, clock: data.fastest_pass.game_clock,
                    shots: data.shots.length, passes: data.passes_counted,
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="player-tags-live">
            <div className="player-tags-live-head">
              <h3>{t("panels.tags.liveTitle")}</h3>
              <span className="player-tags-clock" aria-label={t("panels.tags.clockAria")}>{formatClock(playheadMs)}</span>
            </div>

            <div className="player-tags-controls">
              {!external && (
                <>
                  <button
                    type="button"
                    className="player-tags-button"
                    onClick={togglePlay}
                    aria-label={t(playing ? "panels.tags.pauseAria" : "panels.tags.playAria")}
                  >
                    {t(playing ? "panels.tags.pause" : "panels.tags.play")}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(totalMs, 1)}
                    step={1000}
                    value={Math.min(ownPlayheadMs, totalMs)}
                    onChange={(e) => setOwnPlayheadMs(Number(e.target.value))}
                    aria-label={t("panels.tags.seekAria")}
                    aria-valuetext={formatClock(ownPlayheadMs)}
                  />
                  <select
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    aria-label={t("panels.tags.rateAria")}
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
                {t("panels.tags.milestones")}
              </label>
            </div>

            {ticker.length === 0 ? (
              <p className="player-tags-muted">
                {t(playheadMs <= 0 && !external ? "panels.tags.hintPlay" : "panels.tags.noneNow")}
              </p>
            ) : (
              <ul className="player-tags-ticker" role="log" aria-live={playing ? "off" : "polite"} aria-label={t("panels.tags.tickerAria")}>
                {ticker.map((tag) => (
                  <li key={`${tag.kind}-${tag.player_id}-${tag.t_ms}`} className={`player-tags-tag player-tags-tag-${tag.kind}`}>
                    <span className="player-tags-tag-clock">{tag.game_clock}</span>
                    <span className="player-tags-tag-kind">{t(`panels.tags.kind.${tag.kind}`)}</span>
                    <TeamDot team={nameOf.get(tag.player_id)?.team ?? "unknown"} />
                    <span className="player-tags-tag-label">{tagText(i18n, tag, nameOf.get(tag.player_id)?.name)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="player-tags-disclosure">
            {t("panels.tags.disclosure", {
              w: data.thresholds.pitch_m[0], h: data.thresholds.pitch_m[1],
              sprint: rawNum(i18n, data.thresholds.sprint_kmh),
              excluded: rawPct(i18n, data.speed_samples_excluded_pct),
              max: rawNum(i18n, data.thresholds.max_plausible_kmh),
            })}
          </p>
        </>
      )}
    </section>
  );
}
