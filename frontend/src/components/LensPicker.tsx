import type { CSSProperties } from "react";
import type { LensSummary } from "../lib/types";
import { useT } from "../i18n";

interface Props {
  lenses: LensSummary[];
  selected: string | null;
  onSelect: (lensId: string | null) => void;
}

const LENS_ACCENT: Record<string, string> = {
  guardiola_positional_play: "#2899f5",
  klopp_gegenpressing: "#ef4444",
  mourinho_control_the_chaos: "#94a3b8",
  wenger_fluid_technicality: "#22c55e",
  ferguson_momentum_and_management: "#d97706",
};

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return parts.slice(-2).map((p) => p[0]).join("").toUpperCase();
}

export function LensPicker({ lenses, selected, onSelect }: Props) {
  const { t } = useT();
  return (
    <div className="lens-picker">
      <button
        type="button"
        className={`lens-card lens-card-neutral ${selected === null ? "lens-card-selected" : ""}`}
        onClick={() => onSelect(null)}
      >
        <div className="lens-avatar lens-avatar-neutral">--</div>
        <div className="lens-card-body">
          <span className="lens-name">{t("shell.lens.neutral")}</span>
          <span className="lens-desc">{t("shell.lens.neutralDesc")}</span>
        </div>
      </button>

      {lenses.map((lens) => {
        const accent = LENS_ACCENT[lens.lens_id] ?? "#2899f5";
        const isSelected = selected === lens.lens_id;
        return (
          <button
            key={lens.lens_id}
            type="button"
            className={`lens-card ${isSelected ? "lens-card-selected" : ""}`}
            style={isSelected ? ({ "--lens-accent": accent } as CSSProperties) : undefined}
            onClick={() => onSelect(lens.lens_id)}
            title={lens.sourcing_note}
          >
            <div className="lens-avatar" style={{ background: `${accent}26`, color: accent }}>
              {initials(lens.attributed_style_of)}
            </div>
            <div className="lens-card-body">
              <span className="lens-name">{lens.attributed_style_of}</span>
              <span className="lens-desc">{lens.tactical_principles[0]}</span>
              <div className="lens-tags">
                {lens.tone_descriptors.slice(0, 2).map((t) => (
                  <span key={t} className="lens-tag">{t}</span>
                ))}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
