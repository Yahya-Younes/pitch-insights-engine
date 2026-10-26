export interface TriggerTheme {
  icon: string;
  color: string;
  colorSoft: string;
}

// Flat, neutral card surfaces everywhere -- category is cued by a small
// tinted icon badge and a colored left-border accent only (the common
// enterprise-dashboard pattern, e.g. Azure Monitor's severity-colored
// alert cards), never a full colorful gradient fill.
const DEFAULT_THEME: TriggerTheme = {
  icon: "◆",
  color: "#2899f5",
  colorSoft: "rgba(40, 153, 245, 0.14)",
};

export const TRIGGER_THEME: Record<string, TriggerTheme> = {
  milestone: {
    icon: "⚽",
    color: "#eab308",
    colorSoft: "rgba(234, 179, 8, 0.14)",
  },
  pressure_spike: {
    icon: "🔥",
    color: "#f97316",
    colorSoft: "rgba(249, 115, 22, 0.14)",
  },
  chaos_shift: {
    icon: "⚡",
    color: "#a855f7",
    colorSoft: "rgba(168, 85, 247, 0.14)",
  },
  rhythm_change: {
    icon: "🎵",
    color: "#06b6d4",
    colorSoft: "rgba(6, 182, 212, 0.14)",
  },
  xt_surge: {
    icon: "📈",
    color: "#22c55e",
    colorSoft: "rgba(34, 197, 94, 0.14)",
  },
  referee_decision: {
    icon: "🟨",
    color: "#facc15",
    colorSoft: "rgba(250, 204, 21, 0.14)",
  },
  tendency_match: {
    icon: "🎯",
    color: "#2899f5",
    colorSoft: "rgba(40, 153, 245, 0.14)",
  },
  tendency_break: {
    icon: "❗",
    color: "#ef4444",
    colorSoft: "rgba(239, 68, 68, 0.14)",
  },
};

export function themeFor(graphicType: string): TriggerTheme {
  return TRIGGER_THEME[graphicType] ?? DEFAULT_THEME;
}

/** Parses a "MM:SS" game clock into total seconds for timeline placement. */
export function clockToSeconds(clock: string): number {
  const [m, s] = clock.split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
}
