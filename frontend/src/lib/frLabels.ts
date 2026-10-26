// French display labels for API enum values used by the Tactique, Analyses
// and Confiance panels. API values stay unchanged; these only map them to
// text at render time.

const NUM_FMT = new Map<string, Intl.NumberFormat>();

/** French number formatting (comma decimals, narrow no-break thousands). */
export function frNum(n: number, digits = 2): string {
  const key = String(digits);
  let fmt = NUM_FMT.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    NUM_FMT.set(key, fmt);
  }
  return fmt.format(n);
}

/** Same as frNum but keeps the raw value's own precision (no padding). */
export function frRaw(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "--";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(n);
}

export const TRIGGER_FR: Record<string, string> = {
  xt_surge: "pic de menace (xT)",
  pressure_spike: "pic de pressing",
  rhythm_change: "changement de rythme",
  chaos_shift: "bascule chaos/contrôle",
  tendency_break: "rupture de tendance",
  referee_decision: "décision arbitrale",
  milestone: "jalon",
  tendency_match: "tendance confirmée",
};

export function triggerFr(value: string): string {
  return TRIGGER_FR[value] ?? TRIGGER_FR[value.replace(/ /g, "_")] ?? value.replace(/_/g, " ");
}

export const PERSONA_FR: Record<string, string> = {
  casual_fan: "Fan",
  analyst: "Analyste",
  player_tracker: "Suivi joueur",
};

export function personaFr(value: string): string {
  return PERSONA_FR[value] ?? PERSONA_FR[value.replace(/ /g, "_")] ?? value.replace(/_/g, " ");
}
