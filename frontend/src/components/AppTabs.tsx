import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "../i18n";

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

/** WAI-ARIA tablist with roving tabindex and automatic activation
 * (ArrowLeft/Right, Home, End). Pair with <AppTabPanel id=...>. */
export function AppTabs<Id extends string>({ tabs, selected, onSelect }: Props<Id>) {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const { t } = useT();

  function focusAndSelect(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    onSelect(tab.id);
    const el = refs.current.get(tab.id);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
    <nav className="app-tabs" aria-label={t("shell.tabs.nav")}>
      <div className="app-tabs-list" role="tablist" aria-label={t("shell.tabs.list")}>
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
      </div>
    </nav>
  );
}
