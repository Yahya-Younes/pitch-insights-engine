import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { fetchPositions } from "../lib/api";
import type { PositionFrame } from "../lib/types";
import { shirtNumber, shortName } from "../lib/matchContext";
import { activeTagsAt, fetchPlayerTags } from "../lib/playerTagsApi";
import type { PlayerTagsResponse } from "../lib/playerTagsApi";
import { num1, prefersReducedMotion } from "../lib/momentumApi";
import { useT } from "../i18n";
import type { RosterPlayer } from "../lib/momentumApi";

export interface SeekRequest {
  ms: number;
  nonce: number;
}

interface Props {
  matchId: string | null;
  homeTeam?: string;
  awayTeam?: string;
  roster?: ReadonlyMap<string, RosterPlayer>;
  followedPlayerId?: string | null;
  onToggleFollow?: (playerId: string) => void;
  onOpenPlayer?: (playerId: string) => void;
  /** Jump the playhead to a match time (new nonce = new request). */
  seek?: SeekRequest | null;
  /** Rendered under the pitch, inside the card (lineups, follow footer). */
  children?: ReactNode;
}

const PITCH_X_MAX = 120;
const PITCH_Y_MAX = 80;
// StatsBomb units -> metres (105 x 68 pitch).
const X_TO_M = 105 / PITCH_X_MAX;
const Y_TO_M = 68 / PITCH_Y_MAX;
const CARRIER_MAX_M = 2.2;
const CARRIER_MAX_BALL_Z_M = 2;
/** Match-ms advanced per real ms at "1×" -- one match minute every 6 s. */
const BASE_RATE = 10;
const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];
/** How long (real time) a speed tag stays on screen. */
const TAG_VISIBLE_REAL_MS = 2500;
const MAX_OVERLAY_TAGS = 3;
const HOVER_LINGER_MS = 280;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolates the frame at playheadMs between the two bracketing frames
 * (binary search -- O(log n) per render, and safe for seeking backwards). */
function interpolatedFrame(frames: PositionFrame[], playheadMs: number) {
  const first = frames[0];
  if (!first) return null;
  if (playheadMs <= first.t_ms) return first;
  // Largest i with frames[i].t_ms <= playheadMs.
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((frames[mid]?.t_ms ?? Infinity) <= playheadMs) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;

  const a = frames[i] ?? first;
  const b = frames[Math.min(i + 1, frames.length - 1)] ?? a;
  const span = Math.max(b.t_ms - a.t_ms, 1);
  const t = Math.max(0, Math.min(1, (playheadMs - a.t_ms) / span));

  const players: Record<string, [number, number]> = {};
  for (const [pid, pa] of Object.entries(a.players)) {
    const pb = b.players[pid] ?? pa;
    players[pid] = [lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t)];
  }
  return {
    t_ms: playheadMs,
    ball: [lerp(a.ball[0], b.ball[0], t), lerp(a.ball[1], b.ball[1], t), lerp(a.ball[2], b.ball[2], t)] as [
      number, number, number,
    ],
    players,
  };
}

function findCarrier(players: Record<string, [number, number]>, ball: [number, number, number]): string | null {
  if (ball[2] > CARRIER_MAX_BALL_Z_M) return null;
  let best = CARRIER_MAX_M;
  let carrier: string | null = null;
  for (const [pid, [x, y]] of Object.entries(players)) {
    const d = Math.hypot((x - ball[0]) * X_TO_M, (y - ball[1]) * Y_TO_M);
    if (d <= best) {
      best = d;
      carrier = pid;
    }
  }
  return carrier;
}

function pos(x: number, y: number): CSSProperties {
  return { left: `${(x / PITCH_X_MAX) * 100}%`, top: `${(y / PITCH_Y_MAX) * 100}%` };
}

function sideOf(pid: string): "home" | "away" {
  return pid.startsWith("away") ? "away" : "home";
}

function PitchMarkings() {
  const X = PITCH_X_MAX;
  const Y = PITCH_Y_MAX;
  return (
    <svg className="lv-pitch-lines" viewBox={`0 0 ${X} ${Y}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect x={0.4} y={0.4} width={X - 0.8} height={Y - 0.8} />
      <line x1={X / 2} y1={0} x2={X / 2} y2={Y} />
      <circle cx={X / 2} cy={Y / 2} r={10} />
      <circle cx={X / 2} cy={Y / 2} r={0.5} className="lv-pitch-spot" />
      {/* Penalty + six-yard boxes, spots and arcs, both ends. */}
      <rect x={0.4} y={18} width={17.6} height={44} />
      <rect x={X - 18} y={18} width={17.6} height={44} />
      <rect x={0.4} y={30} width={5.6} height={20} />
      <rect x={X - 6} y={30} width={5.6} height={20} />
      <circle cx={12} cy={Y / 2} r={0.5} className="lv-pitch-spot" />
      <circle cx={X - 12} cy={Y / 2} r={0.5} className="lv-pitch-spot" />
      <path d={`M18 ${Y / 2 - 7.9} A10 10 0 0 1 18 ${Y / 2 + 7.9}`} />
      <path d={`M${X - 18} ${Y / 2 - 7.9} A10 10 0 0 0 ${X - 18} ${Y / 2 + 7.9}`} />
    </svg>
  );
}

export function PitchView({
  matchId, homeTeam: homeTeamProp, awayTeam: awayTeamProp, roster, followedPlayerId = null,
  onToggleFollow, onOpenPlayer, seek = null, children,
}: Props) {
  const i18n = useT();
  const { t } = i18n;
  const homeTeam = homeTeamProp ?? t("live.team.home");
  const awayTeam = awayTeamProp ?? t("live.team.away");
  const [frames, setFrames] = useState<PositionFrame[]>([]);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [speed, setSpeed] = useState<Speed>(1);
  const [showLabels, setShowLabels] = useState(true);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tags, setTags] = useState<PlayerTagsResponse | null>(null);
  const [tagsFailed, setTagsFailed] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!matchId) {
      setFrames([]);
      setLoadError(false);
      return;
    }
    const id = matchId;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setLoadError(false);
    // Positions are computed synchronously before /matches/run returns, so
    // this should succeed on the first try -- a couple of short retries
    // just absorb any ordinary request/response timing jitter.
    async function load() {
      try {
        const track = await fetchPositions(id);
        if (!cancelled) {
          setFrames(track.frames);
          setPlayheadMs(0);
        }
      } catch {
        attempt += 1;
        if (cancelled) return;
        if (attempt < 3) retryTimer = setTimeout(load, 500);
        else setLoadError(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [matchId, reloadKey]);

  // Speed tags are a nice-to-have overlay: failures only hide the overlay.
  useEffect(() => {
    setTags(null);
    setTagsFailed(false);
    if (!matchId) return;
    let cancelled = false;
    fetchPlayerTags(matchId)
      .then((res) => { if (!cancelled) setTags(res); })
      .catch(() => { if (!cancelled) setTagsFailed(true); });
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => () => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
  }, []);

  const totalMs = frames.at(-1)?.t_ms ?? 0;
  const rate = BASE_RATE * speed;

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    function tick(now: number) {
      if (lastTickRef.current != null) {
        // Clamp so a backgrounded tab doesn't jump minutes ahead on return.
        const deltaMs = Math.min(now - lastTickRef.current, 100) * rate;
        setPlayheadMs((prev) => {
          const next = prev + deltaMs;
          return totalMs > 0 ? next % totalMs : 0;
        });
      }
      lastTickRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = null;
    };
  }, [playing, frames, rate, totalMs]);

  const seekNonce = seek?.nonce;
  useEffect(() => {
    if (!seek) return;
    setPlayheadMs(totalMs > 0 ? Math.max(0, Math.min(seek.ms, totalMs - 1)) : Math.max(0, seek.ms));
    // Only react to a new request, not to totalMs changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekNonce]);

  const frame = useMemo(() => interpolatedFrame(frames, playheadMs), [frames, playheadMs]);

  const tagNames = useMemo(() => new Map((tags?.players ?? []).map((p) => [p.player_id, p.name])), [tags]);
  const nameOf = (pid: string) => roster?.get(pid)?.name ?? tagNames.get(pid) ?? t("live.player.fallback", { num: shirtNumber(pid) });
  const shortLabel = (pid: string) => `#${shirtNumber(pid)} ${shortName(nameOf(pid))}`;
  const teamOf = (pid: string) => (sideOf(pid) === "home" ? homeTeam : awayTeam);
  const ratingText = (pid: string): string | null => {
    const r = roster?.get(pid);
    if (r?.liveRating != null) return t("live.pitch.rating", { value: num1(i18n, r.liveRating) });
    if (r?.fcRating != null) return t("live.pitch.ratingFc", { value: r.fcRating });
    return null;
  };

  const windowMs = TAG_VISIBLE_REAL_MS * rate;
  const overlay = useMemo(() => {
    if (!tags || !showLabels) return { lines: [] as { key: string; text: string; kind: string }[], sprinting: new Set<string>() };
    const active = activeTagsAt(tags.tags, playheadMs, windowMs);
    const sprinting = new Set(active.filter((t) => t.kind === "sprint" || t.kind === "top_speed").map((t) => t.player_id));
    const lines: { key: string; text: string; kind: string; t: number }[] = [];
    for (const tag of active) {
      const who = shortName(tagNames.get(tag.player_id) ?? roster?.get(tag.player_id)?.name ?? `#${shirtNumber(tag.player_id)}`);
      const value = num1(i18n, tag.value);
      const text = tag.kind === "sprint"
        ? i18n.t("live.tag.sprint", { speed: value, who })
        : tag.kind === "top_speed"
          ? i18n.t("live.tag.topSpeed", { speed: value, who })
          : i18n.t("live.tag.distance", { km: value, who });
      lines.push({ key: `${tag.kind}-${tag.player_id}-${tag.t_ms}`, text, kind: tag.kind, t: tag.t_ms });
    }
    for (const s of tags.shots) {
      if (s.t_ms <= playheadMs && s.t_ms > playheadMs - windowMs) {
        lines.push({ key: `shot-${s.player_id}-${s.t_ms}`, text: i18n.t("live.tag.shot", { speed: i18n.num(Math.round(s.speed_kmh)), who: shortName(s.name) }), kind: "shot", t: s.t_ms });
      }
    }
    lines.sort((a, b) => b.t - a.t);
    return { lines: lines.slice(0, MAX_OVERLAY_TAGS), sprinting };
  }, [tags, showLabels, playheadMs, windowMs, tagNames, roster, i18n]);

  function scheduleHoverClear() {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverId(null), HOVER_LINGER_MS);
  }
  function keepHover(pid: string) {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoverId(pid);
  }
  function onTokenKey(e: KeyboardEvent<HTMLButtonElement>, pid: string) {
    if ((e.key === "f" || e.key === "F") && onOpenPlayer) {
      e.preventDefault();
      onOpenPlayer(pid);
    }
  }

  const heading = (
    <div className="lv-card-head">
      <h2 id={titleId} className="ui-heading">{t("live.pitch.title")}</h2>
      <span className="ui-tag" title={t("live.pitch.synthTitle")}>
        {t("live.pitch.synthTag")}
      </span>
    </div>
  );

  if (!matchId) {
    return (
      <section className="ui-card lv-pitch-card" aria-labelledby={titleId}>
        {heading}
        <p className="lv-muted">{t("live.pitch.noMatch")}</p>
      </section>
    );
  }

  const carrier = frame ? findCarrier(frame.players, frame.ball) : null;
  const inspectId = hoverId ?? focusId;
  const inspectPos = inspectId && frame ? frame.players[inspectId] : undefined;
  const playerIds = frame ? Object.keys(frame.players).sort((a, b) => {
    const sa = sideOf(a);
    const sb = sideOf(b);
    if (sa !== sb) return sa === "home" ? -1 : 1;
    return Number(shirtNumber(a)) - Number(shirtNumber(b));
  }) : [];
  const minute = Math.floor(playheadMs / 60000);

  return (
    <section className="ui-card lv-pitch-card" aria-labelledby={titleId}>
      {heading}
      {frames.length === 0 ? (
        loadError ? (
          <div className="lv-state">
            <p className="lv-error" role="alert">{t("live.pitch.loadError")}</p>
            <button type="button" className="ui-btn" onClick={() => setReloadKey((k) => k + 1)}>{t("live.retry")}</button>
          </div>
        ) : (
          <div className="lv-state" role="status"><span className="lv-spinner" aria-hidden="true" /> {t("live.pitch.loading")}</div>
        )
      ) : (
        <>
          <div
            className={`lv-pitch${followedPlayerId ? " has-follow" : ""}`}
            role="group"
            aria-label={t("live.pitch.aria", { minute, count: playerIds.length })}
          >
            <PitchMarkings />

            {showLabels && overlay.lines.length > 0 && (
              <ul className="lv-pitch-tags" aria-hidden="true">
                {overlay.lines.map((l) => (
                  <li key={l.key} className={`lv-pitch-tag is-${l.kind}`}>{l.text}</li>
                ))}
              </ul>
            )}

            {frame && (
              <span
                className="lv-ball"
                style={{ ...pos(frame.ball[0], frame.ball[1]), "--lv-ball-lift": `${Math.min(frame.ball[2], 6) * 1.5}px` } as CSSProperties}
                aria-hidden="true"
              />
            )}

            {frame && playerIds.map((pid) => {
              const coords = frame.players[pid];
              if (!coords) return null;
              const side = sideOf(pid);
              const num = shirtNumber(pid);
              const followed = pid === followedPlayerId;
              const isCarrier = pid === carrier;
              const rating = ratingText(pid);
              const label = `#${num} ${nameOf(pid)}, ${teamOf(pid)}${rating ? `, ${rating}` : ""}`;
              return (
                <button
                  key={pid}
                  type="button"
                  className={`lv-token is-${side}${followed ? " is-followed" : ""}${isCarrier ? " is-carrier" : ""}${followedPlayerId && !followed ? " is-dimmed" : ""}`}
                  style={pos(coords[0], coords[1])}
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={followed}
                  onClick={() => onToggleFollow?.(pid)}
                  onDoubleClick={() => onOpenPlayer?.(pid)}
                  onKeyDown={(e) => onTokenKey(e, pid)}
                  onPointerEnter={() => keepHover(pid)}
                  onPointerLeave={scheduleHoverClear}
                  onFocus={() => setFocusId(pid)}
                  onBlur={() => setFocusId((cur) => (cur === pid ? null : cur))}
                >
                  <span aria-hidden="true">{num}</span>
                  {overlay.sprinting.has(pid) && <span className="lv-token-bolt" aria-hidden="true">⚡</span>}
                </button>
              );
            })}

            {frame && carrier && showLabels && carrier !== followedPlayerId && frame.players[carrier] && (
              <span
                className={`lv-token-label is-carrier is-${sideOf(carrier)}`}
                style={pos(frame.players[carrier]?.[0] ?? 0, frame.players[carrier]?.[1] ?? 0)}
                aria-hidden="true"
              >
                ⚽ {shortLabel(carrier)}
              </span>
            )}
            {frame && followedPlayerId && frame.players[followedPlayerId] && (
              <span
                className={`lv-token-label is-follow is-${sideOf(followedPlayerId)}`}
                style={pos(frame.players[followedPlayerId]?.[0] ?? 0, frame.players[followedPlayerId]?.[1] ?? 0)}
                aria-hidden="true"
              >
                {followedPlayerId === carrier ? "⚽ " : ""}👁 {shortLabel(followedPlayerId)}
              </span>
            )}

            {inspectId && inspectPos && (
              <div
                className={`lv-minicard is-${sideOf(inspectId)}${inspectPos[0] > PITCH_X_MAX * 0.7 ? " is-flip-x" : ""}${inspectPos[1] < PITCH_Y_MAX * 0.35 ? " is-flip-y" : ""}`}
                style={pos(inspectPos[0], inspectPos[1])}
                onPointerEnter={() => keepHover(inspectId)}
                onPointerLeave={scheduleHoverClear}
                aria-hidden="true"
              >
                <div className="lv-minicard-head">
                  <span className="lv-minicard-num">{shirtNumber(inspectId)}</span>
                  <div>
                    <strong>{nameOf(inspectId)}</strong>
                    <span className="lv-minicard-sub">
                      {teamOf(inspectId)}{roster?.get(inspectId)?.position ? ` · ${roster.get(inspectId)?.position}` : ""}
                    </span>
                  </div>
                </div>
                {(() => {
                  const r = roster?.get(inspectId);
                  if (r?.liveRating != null) {
                    return (
                      <p className="lv-minicard-rating">
                        {t("live.mini.liveRating")} <b>{num1(i18n, r.liveRating)}</b>
                        {r.delta10 != null && Math.abs(r.delta10) >= 0.05 && (
                          <span className={r.delta10 > 0 ? "is-up" : "is-down"}>
                            {r.delta10 > 0 ? " ▲ " : " ▼ "}{i18n.signed(r.delta10, 1)} {t("live.mini.perTenMin")}
                          </span>
                        )}
                      </p>
                    );
                  }
                  if (r?.fcRating != null) return <p className="lv-minicard-rating">{t("live.mini.fcRating")} <b>{r.fcRating}</b></p>;
                  return null;
                })()}
                <p className="lv-minicard-hint">
                  {inspectId === followedPlayerId ? t("live.mini.unfollow") : t("live.mini.follow")}
                </p>
                {onOpenPlayer && hoverId === inspectId && (
                  <button type="button" className="lv-minicard-link" tabIndex={-1} onClick={() => onOpenPlayer(inspectId)}>
                    {t("live.mini.sheet")}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="lv-pitch-controls">
            <button
              type="button"
              className="ui-btn lv-btn-icon"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? t("live.pitch.pause") : t("live.pitch.play")}
            >
              <span aria-hidden="true">{playing ? "⏸" : "▶"}</span>
            </button>
            <div className="lv-segment" role="group" aria-label={t("live.pitch.speed")}>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`lv-segment-btn${speed === s ? " is-active" : ""}`}
                  aria-pressed={speed === s}
                  onClick={() => setSpeed(s)}
                >
                  {s}×
                </button>
              ))}
            </div>
            <label className="lv-scrub">
              <span className="ui-sr-only">{t("live.pitch.minuteLabel")}</span>
              <input
                type="range"
                min={0}
                max={Math.max(totalMs, 1)}
                step={1000}
                value={Math.min(playheadMs, totalMs)}
                aria-valuetext={t("live.pitch.minuteText", { minute })}
                onChange={(e) => setPlayheadMs(Number(e.target.value))}
              />
            </label>
            <span className="lv-pitch-clock" aria-hidden="true">{minute}'</span>
            <button
              type="button"
              className={`ui-pill${showLabels ? " is-solid is-home" : ""}`}
              aria-pressed={showLabels}
              onClick={() => setShowLabels((v) => !v)}
              title={tagsFailed ? t("live.pitch.labelsUnavailable") : t("live.pitch.labelsTitle")}
            >
              {t("live.pitch.labels")}
            </button>
          </div>
          <p className="lv-disclosure">
            {t("live.pitch.disclosure")}
          </p>
        </>
      )}
      {children}
    </section>
  );
}
