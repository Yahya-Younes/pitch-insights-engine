import { useEffect, useRef, useState } from "react";

// Hysteresis: condense well past the marker, expand only back near it. The
// gap is larger than the height the header loses when condensed, so a short
// page whose scroll position gets clamped can't flip back and forth.
const CONDENSE_AFTER_PX = 100;
const EXPAND_BEFORE_PX = 8;

/** True once the page has scrolled past the element the returned ref is put
 * on -- used to shrink the sticky scorebug while reading further down. */
export function useCondensedOnScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    let frame = 0;
    let current = false;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const past = -el.getBoundingClientRect().top;
      const next = current ? past > EXPAND_BEFORE_PX : past > CONDENSE_AFTER_PX;
      if (next !== current) {
        current = next;
        setCondensed(next);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return [ref, condensed] as const;
}
