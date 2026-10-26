import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { Persona } from "../lib/types";

interface Props {
  value: Persona;
  onChange: (persona: Persona) => void;
  /** Optional message count per persona, shown as a small badge. */
  counts?: Partial<Record<Persona, number>>;
  label?: string;
}

const PERSONAS: { value: Persona; label: string; description: string }[] = [
  { value: "casual_fan", label: "Fan", description: "Les temps forts, en langage simple" },
  { value: "analyst", label: "Analyste", description: "Chaque insight, chiffres bruts" },
  { value: "player_tracker", label: "Joueur suivi", description: "Filtré sur un joueur" },
];

/** Persona switch rendered as a pill radio group (arrow keys move the choice). */
export function PersonaTabs({ value, onChange, counts, label = "Profil de commentaire" }: Props) {
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
    <div className="lv-persona-tabs" role="radiogroup" aria-label={label}>
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
            title={p.description}
          >
            {p.label}
            {count !== undefined && <span className="lv-persona-count" aria-label={`${count} messages`}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
