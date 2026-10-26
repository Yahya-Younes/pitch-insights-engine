import type { CSSProperties } from "react";
import type { RenderPayload } from "../lib/types";
import { clockToSeconds, themeFor } from "../lib/triggerTheme";
import { triggerLabelFr } from "../lib/momentumApi";

interface Props {
  payloads: RenderPayload[];
  selectedId: string | null;
  onSelect: (renderId: string) => void;
}

/** Scrubbable strip of every insight so far, positioned by game clock. */
export function Timeline({ payloads, selectedId, onSelect }: Props) {
  if (payloads.length === 0) return null;

  const maxSeconds = Math.max(300, ...payloads.map((p) => clockToSeconds(p.game_clock)));

  return (
    <nav className="lv-timeline" aria-label="Chronologie des insights">
      <div className="lv-timeline-track">
        {payloads.map((p) => {
          const pct = Math.min(100, (clockToSeconds(p.game_clock) / maxSeconds) * 100);
          const theme = themeFor(p.graphic_type);
          const isSelected = p.render_id === selectedId;
          const label = `${p.game_clock} — ${triggerLabelFr(p.graphic_type)}`;
          return (
            <button
              key={p.render_id}
              type="button"
              className={`lv-timeline-dot${isSelected ? " is-selected" : ""}`}
              style={{ left: `${pct}%`, "--lv-dot": theme.color } as CSSProperties}
              onClick={() => onSelect(p.render_id)}
              title={label}
              aria-label={label}
              aria-current={isSelected ? "true" : undefined}
            />
          );
        })}
      </div>
      <div className="lv-timeline-labels" aria-hidden="true">
        <span>0'</span>
        <span>{Math.floor(maxSeconds / 60)}'</span>
      </div>
    </nav>
  );
}
