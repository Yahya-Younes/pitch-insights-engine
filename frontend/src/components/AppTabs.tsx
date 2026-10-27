import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { prefersReducedMotion } from "../lib/momentumApi";

export interface AppTab<Id extends string = string> {
  id: Id;
  label: string;
}

interface Props<Id extends string> {
  tabs: readonly AppTab<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
}

// DOM ids shared by a tab and its panel (aria-controls / aria-labelledby).
const tabDomId = (id: string) => `app-tab-${id}`;
const panelDomId = (id: string) => `app-panel-${id}`;

/** The panel for tab `id` -- render only the selected one. */
export function AppTabPanel({ id, intro, children }: { id: string; intro?: string; children: ReactNode }) {
  return (
    <section role="tabpanel" id={panelDomId(id)} aria-labelledby={tabDomId(id)} tabIndex={0} className="app-tabpanel">
      {intro && <p className="app-tabpanel-intro">{intro}</p>}
      {children}
    </section>
  );
}

interface Indicator {
  x: number;
  w: number;
}

/** WAI-ARIA tablist with roving tabindex and automatic activation
 * (ArrowLeft/Right, Home, End). Pair with <AppTabPanel id=...>.
 * A sliding underline follows the selected tab; when the row overflows,
 * the hidden side fades out and gets an arrow, and the selected tab is
 * scrolled into view. */
export function AppTabs<Id extends string>({ tabs, selected, onSelect }: Props<Id>) {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const { t } = useT();

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const el = refs.current.get(selected);
      const next = el ? { x: el.offsetLeft, w: el.offsetWidth } : null;
      setIndicator((prev) => (prev && next && prev.x === next.x && prev.w === next.w ? prev : next));
      const max = list.scrollWidth - list.clientWidth;
      const left = list.scrollLeft > 2;
      const right = list.scrollLeft < max - 2;
      setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(list);
    refs.current.forEach((el) => ro?.observe(el));
    list.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro?.disconnect();
      list.removeEventListener("scroll", measure);
    };
  }, [selected, tabs]);

  useEffect(() => {
    const list = listRef.current;
    const el = refs.current.get(selected);
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    const left = Math.max(0, el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2);
    list.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [selected]);

  function nudge(direction: 1 | -1) {
    const list = listRef.current;
    list?.scrollBy({ left: direction * list.clientWidth * 0.6, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  function focusAndSelect(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    onSelect(tab.id);
    refs.current.get(tab.id)?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    focusAndSelect(next);
  }

  return (
    <nav
      className={`app-tabs${edges.left ? " has-left" : ""}${edges.right ? " has-right" : ""}`}
      aria-label={t("shell.tabs.nav")}
    >
      {/* Pointer-only helpers: keyboard users move with the arrow keys. */}
      {edges.left && (
        <button type="button" className="app-tabs-more is-left" tabIndex={-1} aria-hidden="true" onClick={() => nudge(-1)}>
          ‹
        </button>
      )}
      <div ref={listRef} className="app-tabs-list" role="tablist" aria-label={t("shell.tabs.list")}>
        {tabs.map((t, i) => {
          const isSelected = t.id === selected;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) refs.current.set(t.id, el);
                else refs.current.delete(t.id);
              }}
              type="button"
              role="tab"
              id={tabDomId(t.id)}
              aria-selected={isSelected}
              aria-controls={isSelected ? panelDomId(t.id) : undefined}
              tabIndex={isSelected ? 0 : -1}
              className={`app-tab${isSelected ? " is-selected" : ""}`}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
            </button>
          );
        })}
        {indicator && (
          <span
            className="app-tabs-indicator"
            aria-hidden="true"
            style={{ width: indicator.w, transform: `translateX(${indicator.x}px)` }}
          />
        )}
      </div>
      {edges.right && (
        <button type="button" className="app-tabs-more is-right" tabIndex={-1} aria-hidden="true" onClick={() => nudge(1)}>
          ›
        </button>
      )}
    </nav>
  );
}
