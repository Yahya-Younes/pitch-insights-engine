import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/momentumApi";

/** Eases each number from what is on screen now to its new target (from 0
 * on first mount, or when `shape` changes, e.g. "980" -> "1.2k"), so live
 * figures glide instead of jumping. Reduced motion gets the targets as-is. */
export function useTweenedNumbers(targets: readonly number[], durationMs = 900, shape = ""): readonly number[] {
  const key = targets.join("|");
  const [shown, setShown] = useState<readonly number[]>(() => targets.map(() => 0));
  const onScreen = useRef<readonly number[]>(shown);
  const lastShape = useRef(shape);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const goal = key === "" ? [] : key.split("|").map(Number);
    const sameShape = lastShape.current === shape && onScreen.current.length === goal.length;
    lastShape.current = shape;
    const from = sameShape ? onScreen.current : goal.map(() => 0);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = goal.map((g, i) => (from[i] ?? 0) + (g - (from[i] ?? 0)) * eased);
      onScreen.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, durationMs, shape]);

  if (prefersReducedMotion() || shown.length !== targets.length) return targets;
  return shown;
}
