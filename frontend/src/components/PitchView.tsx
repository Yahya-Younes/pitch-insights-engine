import { useEffect, useRef, useState } from "react";
import { fetchPositions } from "../lib/api";
import type { PositionFrame } from "../lib/types";

interface Props {
  matchId: string | null;
}

const PITCH_X_MAX = 120;
const PITCH_Y_MAX = 80;
// Loop the whole generated track over roughly this many real seconds,
// regardless of how many simulated match-minutes it covers -- a 12-minute
// demo match and a full 90-minute one should both feel like a reasonable
// highlight loop, not take that many real minutes to play out once.
const TARGET_LOOP_S = 24;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Finds the two frames bracketing t and the interpolation fraction
 * between them, advancing a cursor forward rather than re-scanning from
 * the start every call -- playhead time only ever increases within a
 * loop, so this stays O(1) amortized. */
function useInterpolatedFrame(frames: PositionFrame[], playheadMs: number) {
  const cursorRef = useRef(0);
  if (frames.length === 0) return null;
  if (playheadMs <= frames[0].t_ms) {
    cursorRef.current = 0;
    return frames[0];
  }
  let i = cursorRef.current;
  if (i >= frames.length - 1 || frames[i].t_ms > playheadMs) i = 0;
  while (i < frames.length - 2 && frames[i + 1].t_ms <= playheadMs) i += 1;
  cursorRef.current = i;

  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)];
  const span = Math.max(b.t_ms - a.t_ms, 1);
  const t = Math.max(0, Math.min(1, (playheadMs - a.t_ms) / span));

  const players: Record<string, [number, number]> = {};
  for (const pid of Object.keys(a.players)) {
    const pa = a.players[pid];
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

export function PitchView({ matchId }: Props) {
  const [frames, setFrames] = useState<PositionFrame[]>([]);
  const [playing, setPlaying] = useState(true);
  const [playheadMs, setPlayheadMs] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!matchId) {
      setFrames([]);
      return;
    }
    const id = matchId;
    let cancelled = false;
    let attempt = 0;
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
        if (!cancelled && attempt < 3) setTimeout(load, 500);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const totalMs = frames.length > 0 ? frames[frames.length - 1].t_ms : 0;
  const speed = totalMs > 0 ? Math.max(1, totalMs / (TARGET_LOOP_S * 1000)) : 1;

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    function tick(now: number) {
      if (lastTickRef.current != null) {
        const deltaMs = (now - lastTickRef.current) * speed;
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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, frames, speed, totalMs]);

  const frame = useInterpolatedFrame(frames, playheadMs);

  if (!matchId) {
    return (
      <section className="feed-panel pitch-panel">
        <div className="panel-heading">
          <h2>Pitch View</h2>
          <span className="panel-tag">synthetic tracking</span>
        </div>
        <div className="empty-state">Run a match to see the animated pitch view.</div>
      </section>
    );
  }

  return (
    <section className="feed-panel pitch-panel">
      <div className="panel-heading">
        <h2>Pitch View</h2>
        <span
          className="panel-tag"
          title="Positions are interpolated from this match's own recorded event locations, not computer vision or real player tracking."
        >
          synthetic tracking
        </span>
      </div>
      {frames.length === 0 ? (
        <div className="empty-state">Loading positions...</div>
      ) : (
        <>
          <svg className="pitch-svg" viewBox={`0 0 ${PITCH_X_MAX} ${PITCH_Y_MAX}`} role="img" aria-label="Animated top-down pitch view">
            <rect x={0} y={0} width={PITCH_X_MAX} height={PITCH_Y_MAX} className="pitch-grass" />
            <rect x={0.5} y={0.5} width={PITCH_X_MAX - 1} height={PITCH_Y_MAX - 1} className="pitch-line" />
            <line x1={PITCH_X_MAX / 2} y1={0} x2={PITCH_X_MAX / 2} y2={PITCH_Y_MAX} className="pitch-line" />
            <circle cx={PITCH_X_MAX / 2} cy={PITCH_Y_MAX / 2} r={9} className="pitch-line" />
            <rect x={0.5} y={PITCH_Y_MAX / 2 - 20} width={16} height={40} className="pitch-line" />
            <rect x={PITCH_X_MAX - 16.5} y={PITCH_Y_MAX / 2 - 20} width={16} height={40} className="pitch-line" />

            {frame &&
              Object.entries(frame.players).map(([pid, [x, y]]) => (
                <circle
                  key={pid}
                  cx={x}
                  cy={y}
                  r={1.6}
                  className={pid.startsWith("home") ? "pitch-dot pitch-dot-home" : "pitch-dot pitch-dot-away"}
                />
              ))}
            {frame && (
              <circle
                cx={frame.ball[0]}
                cy={frame.ball[1]}
                r={0.9 + frame.ball[2] * 0.15}
                className="pitch-dot pitch-ball"
              />
            )}
          </svg>
          <div className="pitch-controls">
            <button className="pitch-play-button" onClick={() => setPlaying((p) => !p)}>
              {playing ? "⏸ Pause" : "▶ Play"}
            </button>
            <span className="pitch-speed-note">looping ~{TARGET_LOOP_S}s playback at {speed.toFixed(1)}x</span>
          </div>
        </>
      )}
    </section>
  );
}
