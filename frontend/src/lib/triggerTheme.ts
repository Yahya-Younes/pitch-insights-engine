export interface TriggerTheme {
  label: string;
  icon: string;
  color: string;
  colorSoft: string;
  gradient: string;
}

const DEFAULT_THEME: TriggerTheme = {
  label: "Insight",
  icon: "◆",
  color: "#2899f5",
  colorSoft: "rgba(40, 153, 245, 0.16)",
  gradient: "linear-gradient(135deg, #1d4ed8, #0a0b0f)",
};

export const TRIGGER_THEME: Record<string, TriggerTheme> = {
  milestone: {
    label: "GOAL",
    icon: "⚽",
    color: "#eab308",
    colorSoft: "rgba(234, 179, 8, 0.18)",
    gradient: "linear-gradient(135deg, #b45309, #0a0b0f)",
  },
  pressure_spike: {
    label: "Pressing Intensity",
    icon: "🔥",
    color: "#f97316",
    colorSoft: "rgba(249, 115, 22, 0.16)",
    gradient: "linear-gradient(135deg, #c2410c, #0a0b0f)",
  },
  chaos_shift: {
    label: "Control / Chaos",
    icon: "⚡",
    color: "#a855f7",
    colorSoft: "rgba(168, 85, 247, 0.16)",
    gradient: "linear-gradient(135deg, #7e22ce, #0a0b0f)",
  },
  rhythm_change: {
    label: "Game Rhythm",
    icon: "🎵",
    color: "#06b6d4",
    colorSoft: "rgba(6, 182, 212, 0.16)",
    gradient: "linear-gradient(135deg, #0e7490, #0a0b0f)",
  },
  xt_surge: {
    label: "Threat Surge",
    icon: "📈",
    color: "#22c55e",
    colorSoft: "rgba(34, 197, 94, 0.16)",
    gradient: "linear-gradient(135deg, #15803d, #0a0b0f)",
  },
  referee_decision: {
    label: "Referee Decision",
    icon: "🟨",
    color: "#facc15",
    colorSoft: "rgba(250, 204, 21, 0.16)",
    gradient: "linear-gradient(135deg, #854d0e, #0a0b0f)",
  },
  tendency_match: {
    label: "Tendency Match",
    icon: "🎯",
    color: "#2899f5",
    colorSoft: "rgba(40, 153, 245, 0.16)",
    gradient: "linear-gradient(135deg, #1d4ed8, #0a0b0f)",
  },
  tendency_break: {
    label: "Tendency Break",
    icon: "❗",
    color: "#ef4444",
    colorSoft: "rgba(239, 68, 68, 0.16)",
    gradient: "linear-gradient(135deg, #b91c1c, #0a0b0f)",
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
