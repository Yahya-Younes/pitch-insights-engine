import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n";
import "./TimeRangeSlider.css";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

interface Props {
  from: number;
  to: number;
  onChange: (from: number, to: number) => void;
  min?: number;
  max?: number;
  /** Smallest allowed window, in minutes. */
  minGap?: number;
  /** Width of the window the replay slides from min to max. */
  replayWindow?: number;
  /** Replay step, in minutes. */
  replayStep?: number;
  /** Optional "live" minute marker (match still running). */
  liveMinute?: number | null;
  disabled?: boolean;
}

/** Accessible dual-thumb minute range (two native range inputs) + "replay the evolution". */
export function TimeRangeSlider({
  from, to, onChange, min = 0, max = 90, minGap = 5, replayWindow = 15, replayStep = 5,
  liveMinute = null, disabled = false,
}: Props) {
  const uid = useId();
  const { t } = useT();
  const reduced = useReducedMotion();
  const [playRequested, setPlaying] = useState(false);
  const playing = playRequested && !disabled;
  const onChangeRef = useRef(onChange);
  const fromRef = useRef(from);

  useEffect(() => {
    onChangeRef.current = onChange;
    fromRef.current = from;
  });

  // Replay: slide a `replayWindow`-minute window from min to max, one step per tick.
  useEffect(() => {
    if (!playing) return;
    const delay = reduced ? 1600 : 1000;
    const id = window.setInterval(() => {
      const nextFrom = fromRef.current + replayStep;
      if (nextFrom + replayWindow > max) {
        setPlaying(false);
        return;
      }
      fromRef.current = nextFrom;
      onChangeRef.current(nextFrom, nextFrom + replayWindow);
    }, delay);
    return () => window.clearInterval(id);
  }, [playing, reduced, replayStep, replayWindow, max]);


  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Restart from the beginning unless we're paused mid-replay on a replay-sized window.
    const midReplay = to - from === replayWindow && to < max;
    if (!midReplay) {
      fromRef.current = min;
      onChange(min, min + replayWindow);
    }
    setPlaying(true);
  };

  const span = Math.max(max - min, 1);
  const pct = (v: number) => ((v - min) / span) * 100;
  const live = liveMinute !== null && liveMinute >= min && liveMinute <= max ? liveMinute : null;

  return (
    <div className="trs" data-disabled={disabled || undefined}>
      <div className="trs-head">
        <span className="trs-label" id={`${uid}-label`}>
          {t("relations.slider.window")} <strong>{from}'</strong> → <strong>{to}'</strong>
        </span>
        <button
          type="button"
          className={`ui-btn trs-play${playing ? " is-playing" : ""}`}
          onClick={togglePlay}
          disabled={disabled}
          aria-pressed={playing}
        >
          {playing ? t("relations.slider.pause") : t("relations.slider.replay")}
        </button>
      </div>
      <div className="trs-track" role="group" aria-labelledby={`${uid}-label`}>
        <div className="trs-rail" aria-hidden="true" />
        <div className="trs-fill" aria-hidden="true" style={{ left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%` }} />
        {live !== null && (
          <div className="trs-live" aria-hidden="true" style={{ left: `${pct(live)}%` }} title={t("relations.slider.liveAt", { m: live })} />
        )}
        <input
          type="range"
          className="trs-input trs-input--from"
          min={min}
          max={max}
          step={1}
          value={from}
          disabled={disabled}
          aria-label={t("relations.slider.start")}
          aria-valuetext={t("relations.slider.startValue", { m: from })}
          onChange={(e) => {
            setPlaying(false);
            const v = Math.min(Number(e.currentTarget.value), to - minGap);
            onChange(Math.max(min, v), to);
          }}
        />
        <input
          type="range"
          className="trs-input trs-input--to"
          min={min}
          max={max}
          step={1}
          value={to}
          disabled={disabled}
          aria-label={t("relations.slider.end")}
          aria-valuetext={t("relations.slider.endValue", { m: to })}
          onChange={(e) => {
            setPlaying(false);
            const v = Math.max(Number(e.currentTarget.value), from + minGap);
            onChange(from, Math.min(max, v));
          }}
        />
      </div>
      <div className="trs-ticks" aria-hidden="true">
        {[0, 15, 30, 45, 60, 75, 90].filter((m) => m >= min && m <= max).map((m) => (
          <span key={m} style={{ left: `${pct(m)}%` }}>{m}'</span>
        ))}
      </div>
    </div>
  );
}
