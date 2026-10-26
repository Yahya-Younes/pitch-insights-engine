import { useEffect, useRef, useState } from "react";
import { ATTRIBUTE_META, ATTRIBUTE_ORDER, type PlayerAttributes } from "../lib/playersTypes";
import "./HexRadar.css";

export interface RadarSeries {
  id: string;
  name: string;
  values: PlayerAttributes;
  tone: "home" | "away" | "gold";
}

interface HexRadarProps {
  /** One or two polygons; the second is drawn on top with a lighter fill. */
  series: RadarSeries[];
  /** Rendered width/height in px (the SVG scales; default 260). */
  size?: number;
  className?: string;
}

const VIEW = 300;
const C = VIEW / 2;
const R = 100;
const MAX = 99;
const RINGS = [1 / 3, 2 / 3, 1];
const TWEEN_MS = 450;

function point(axis: number, radius: number): [number, number] {
  const angle = (-90 + axis * 60) * (Math.PI / 180);
  return [C + radius * Math.cos(angle), C + radius * Math.sin(angle)];
}

function polygon(values: readonly number[], scale = 1): string {
  return values
    .map((v, i) => point(i, (Math.max(0, Math.min(MAX, v)) / MAX) * R * scale).map((n) => n.toFixed(1)).join(","))
    .join(" ");
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Tween a flat number array toward `target` (rAF, eased); instant with reduced motion. */
function useTweened(target: readonly number[]): number[] {
  const [shown, setShown] = useState<number[]>(() => target.map(() => 0));
  const shownRef = useRef<number[]>(shown);
  const key = target.join(",");

  useEffect(() => {
    const to = key === "" ? [] : key.split(",").map(Number);
    const from = to.map((_, i) => shownRef.current[i] ?? 0);
    if (prefersReducedMotion()) {
      shownRef.current = to;
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const e = 1 - (1 - t) ** 3;
      const next = to.map((v, i) => {
        const f = from[i] ?? 0;
        return f + (v - f) * e;
      });
      shownRef.current = next;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key]);

  // Reduced motion: no tween, show the target straight away.
  return prefersReducedMotion() ? [...target] : shown;
}

/** Hexagonal attribute radar (six 0-99 attributes), one or two players overlaid. */
export function HexRadar({ series, size = 260, className }: HexRadarProps) {
  const shown = series.slice(0, 2);
  const target = shown.flatMap((s) => ATTRIBUTE_ORDER.map((k) => s.values[k]));
  const tweened = useTweened(target);

  const label =
    "Radar des attributs (sur 99). " +
    shown
      .map((s) => `${s.name} : ${ATTRIBUTE_ORDER.map((k) => `${ATTRIBUTE_META[k].label} ${s.values[k]}`).join(", ")}`)
      .join(". ");

  return (
    <svg
      className={["hex-radar", className].filter(Boolean).join(" ")}
      viewBox={`-28 -6 ${VIEW + 56} ${VIEW + 12}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
    >
      {RINGS.map((s) => (
        <polygon key={s} className="hex-radar__ring" points={polygon([MAX, MAX, MAX, MAX, MAX, MAX], s)} />
      ))}
      {ATTRIBUTE_ORDER.map((k, i) => {
        const [x, y] = point(i, R);
        return <line key={k} className="hex-radar__axis" x1={C} y1={C} x2={x} y2={y} />;
      })}
      {shown.map((s, si) => {
        const vals = tweened.slice(si * 6, si * 6 + 6);
        if (vals.length < 6) return null;
        return (
          <g key={s.id} className={`hex-radar__series hex-radar__series--${s.tone} hex-radar__series--${si === 0 ? "a" : "b"}`}>
            <polygon className="hex-radar__shape" points={polygon(vals)} />
            {vals.map((v, i) => {
              const [x, y] = point(i, (Math.max(0, Math.min(MAX, v)) / MAX) * R);
              return <circle key={i} className="hex-radar__dot" cx={x} cy={y} r={3} />;
            })}
          </g>
        );
      })}
      {ATTRIBUTE_ORDER.map((k, i) => {
        const [x, y] = point(i, R + 26);
        return (
          <g key={k} className="hex-radar__label" aria-hidden="true">
            <text x={x} y={y - 4} textAnchor="middle" className="hex-radar__code">{ATTRIBUTE_META[k].code}</text>
            <text x={x} y={y + 12} textAnchor="middle" className="hex-radar__values">
              {shown.map((s, si) => (
                <tspan key={s.id} className={`hex-radar__value hex-radar__value--${s.tone}`}>
                  {si > 0 ? " · " : ""}
                  {s.values[k]}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
