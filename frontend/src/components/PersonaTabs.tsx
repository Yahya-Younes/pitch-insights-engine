import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { Persona } from "../lib/types";
import { useT } from "../i18n";

interface Props {
  value: Persona;
  onChange: (persona: Persona) => void;
  /** Optional message count per persona, shown as a small badge. */
  counts?: Partial<Record<Persona, number>>;
  label?: string;
}

/** Labels come from "shell.persona.<value>" and "shell.persona.<value>.desc". */
const PERSONAS: readonly { value: Persona }[] = [
  { value: "casual_fan" },
  { value: "analyst" },
  { value: "player_tracker" },
];

/** Persona switch rendered as a pill radio group (arrow keys move the choice). */
export function PersonaTabs({ value, onChange, counts, label }: Props) {
  const { t } = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % PERSONAS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + PERSONAS.length) % PERSONAS.length;
    if (next === null) return;
    e.preventDefault();
    const target = PERSONAS[next];
    if (!target) return;
    onChange(target.value);
    refs.current[next]?.focus();
  }

  return (
    <div className="lv-persona-tabs" role="radiogroup" aria-label={label ?? t("shell.persona.group")}>
      {PERSONAS.map((p, i) => {
        const active = value === p.value;
        const count = counts?.[p.value];
        return (
          <button
            key={p.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={`ui-pill${active ? " is-solid is-home" : ""}`}
            onClick={() => onChange(p.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            title={t(`shell.persona.${p.value}.desc`)}
          >
            {t(`shell.persona.${p.value}`)}
            {count !== undefined && <span className="lv-persona-count" aria-label={t("shell.persona.count", { n: count })}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
