import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.closest("[hidden]") && el.getClientRects().length > 0);
}

/** While `active`: moves focus into `containerRef`, keeps Tab/Shift+Tab inside
 * it, calls `onEscape` on Escape, and restores focus to the previously focused
 * element when deactivated. */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const first = focusables(container)[0];
    (first ?? container).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (!container) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(container);
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) {
        e.preventDefault();
        container.focus();
        return;
      }
      const current = document.activeElement;
      if (e.shiftKey && (current === firstItem || !container.contains(current))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (current === lastItem || !container.contains(current))) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [active, containerRef]);
}
