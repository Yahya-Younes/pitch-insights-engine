import type { RenderPayload } from "../lib/types";
import { themeFor } from "../lib/triggerTheme";
import { triggerLabel } from "../lib/momentumApi";
import { useT } from "../i18n";

interface Props {
  payloads: RenderPayload[];
  selectedId: string | null;
  onSelect: (renderId: string) => void;
}

export function HistoryRail({ payloads, selectedId, onSelect }: Props) {
  const i18n = useT();
  const { t } = i18n;
  if (payloads.length === 0) {
    return (
      <div className="history-rail-empty">
        <span className="empty-icon" aria-hidden="true">📺</span>
        {t("shell.history.empty")}
      </div>
    );
  }

  return (
    <div className="history-rail">
      {[...payloads].reverse().map((p) => {
        const theme = themeFor(p.graphic_type);
        const isSelected = p.render_id === selectedId;
        return (
          <button
            key={p.render_id}
            type="button"
            className={`history-chip ${isSelected ? "history-chip-selected" : ""}`}
            style={{ borderColor: isSelected ? theme.color : undefined }}
            onClick={() => onSelect(p.render_id)}
          >
            <span className="history-chip-icon">{theme.icon}</span>
            <div className="history-chip-text">
              <span className="history-chip-clock">{p.game_clock}</span>
              <span className="history-chip-label">{triggerLabel(i18n, p.graphic_type)}</span>
            </div>
            {!p.fact_checked && (
              <span className="history-chip-corrected" title={t("shell.history.corrected")}>⚠</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
