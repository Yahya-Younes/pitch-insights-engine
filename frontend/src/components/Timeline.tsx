import type { RenderPayload } from "../lib/types";
import { clockToSeconds, themeFor } from "../lib/triggerTheme";

interface Props {
  payloads: RenderPayload[];
  selectedId: string | null;
  onSelect: (renderId: string) => void;
}

export function Timeline({ payloads, selectedId, onSelect }: Props) {
  if (payloads.length === 0) return null;

  const maxSeconds = Math.max(300, ...payloads.map((p) => clockToSeconds(p.game_clock)));

  return (
    <div className="timeline">
      <div className="timeline-track">
        {payloads.map((p) => {
          const pct = Math.min(100, (clockToSeconds(p.game_clock) / maxSeconds) * 100);
          const theme = themeFor(p.graphic_type);
          const isSelected = p.render_id === selectedId;
          return (
            <button
              key={p.render_id}
              type="button"
              className={`timeline-dot ${isSelected ? "timeline-dot-selected" : ""}`}
              style={{ left: `${pct}%`, background: theme.color, boxShadow: isSelected ? `0 0 0 4px ${theme.colorSoft}` : undefined }}
              onClick={() => onSelect(p.render_id)}
              title={`${p.game_clock} — ${theme.label}`}
            />
          );
        })}
      </div>
      <div className="timeline-labels">
        <span>00:00</span>
        <span>{Math.floor(maxSeconds / 60)}:00</span>
      </div>
    </div>
  );
}
