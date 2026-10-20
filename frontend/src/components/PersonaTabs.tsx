import type { Persona } from "../lib/types";

interface Props {
  value: Persona;
  onChange: (persona: Persona) => void;
}

const PERSONAS: { value: Persona; label: string; description: string }[] = [
  { value: "casual_fan", label: "Casual Fan", description: "Top highlights, plain language" },
  { value: "analyst", label: "Analyst", description: "Every insight, raw numbers" },
  { value: "player_tracker", label: "Player Tracker", description: "Filtered to one player" },
];

export function PersonaTabs({ value, onChange }: Props) {
  return (
    <div className="persona-tabs" role="tablist" aria-label="Viewer persona">
      {PERSONAS.map((p) => (
        <button
          key={p.value}
          type="button"
          role="tab"
          aria-selected={value === p.value}
          className={`persona-tab ${value === p.value ? "persona-tab-active" : ""}`}
          onClick={() => onChange(p.value)}
          title={p.description}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
