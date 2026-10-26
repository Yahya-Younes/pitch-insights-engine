import type { I18n } from "./index";

/** The live-rating API labels its breakdown rows in French ("Passe clé").
 * Map them back to stable keys so any language can display them. */
const ITEM_KEY_BY_FR: Record<string, string> = {
  "Base": "base",
  "But": "goal",
  "Passe décisive": "assist",
  "Passe clé": "key_pass",
  "Tirs (xG)": "shots",
  "Menace créée (xT)": "xt",
  "Dribbles": "dribbles",
  "Précision de passe": "pass_accuracy",
  "Pertes de balle": "ball_loss",
  "Tacles/interceptions": "tackles",
  "Duels": "duels",
  "Menace évitée": "threat",
  "Arrêts": "saves",
  "Buts encaissés": "conceded",
  "Fautes": "fouls",
  "Cartons": "cards",
};

/** Translated label for a live-rating breakdown row (falls back to the API text). */
export function breakdownLabel(i18n: I18n, apiLabel: string): string {
  const key = ITEM_KEY_BY_FR[apiLabel];
  return key ? i18n.t(`backend.item.${key}`) : apiLabel;
}

/** Translated label for a /match-stats row, by its stable `key`. */
export function statLabel(i18n: I18n, key: string, apiLabel: string): string {
  const text = i18n.t(`backend.stat.${key}`);
  return text === `backend.stat.${key}` ? apiLabel : text;
}

export interface BreakdownRow {
  label: string;
  points: number;
  count: number;
}

/** "Why him?" sentence rebuilt client-side from the breakdown (the API's own
 * `reason` is French-only): the top three positive contributions, e.g.
 * "Goal (+1.2), key pass (+0.15), dribbles ×2 (+0.1)". Rows that round to
 * zero are skipped, matching the backend. */
export function motmReason(i18n: I18n, breakdown: BreakdownRow[]): string {
  return breakdown
    .filter((r) => r.label !== "Base" && Number(r.points.toFixed(2)) > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((r, i) => {
      let label = breakdownLabel(i18n, r.label);
      if (i > 0) label = label.charAt(0).toLocaleLowerCase(i18n.locale) + label.slice(1);
      const count = r.count > 1 ? ` ×${r.count}` : "";
      return `${label}${count} (${i18n.signed(r.points, 2)})`;
    })
    .join(", ");
}
