import { useEffect, useState } from "react";

/** Animates a number counting up from 0 to `target` over `durationMs`,
 * restarting whenever `target` or `resetKey` changes. */
export function useCountUp(target: number, durationMs = 900, resetKey?: string) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const from = 0;

    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, resetKey]);

  return value;
}
