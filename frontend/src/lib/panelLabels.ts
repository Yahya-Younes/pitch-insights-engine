// Display helpers for the Tactique, Analyses and Confiance panels. API enum
// values stay unchanged; these only map them to text (in the selected
// language, via the "panels.*" catalog) at render time.
import type { I18n, Params } from "../i18n";

const PLURAL_RULES = new Map<string, Intl.PluralRules>();

/** Picks "<key>.one" or "<key>.other" by the locale's plural rule for `n`. */
export function plural(i18n: I18n, key: string, n: number, params?: Params): string {
  let rules = PLURAL_RULES.get(i18n.locale);
  if (!rules) {
    rules = new Intl.PluralRules(i18n.locale);
    PLURAL_RULES.set(i18n.locale, rules);
  }
  const form = rules.select(n) === "one" ? "one" : "other";
  return i18n.t(`${key}.${form}`, { n: i18n.num(n), ...params });
}

function decimalsOf(n: number, max: number): number {
  const s = String(Number(n.toFixed(max)));
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : Math.min(max, s.length - dot - 1);
}

/** Locale-aware number keeping the raw value's own precision (up to 4 decimals, no padding). */
export function rawNum(i18n: I18n, n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "--";
  return i18n.num(n, decimalsOf(n, 4));
}

/** A 0-100 percentage value shown with the locale's percent style, raw precision (up to 2 decimals). */
export function rawPct(i18n: I18n, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return i18n.pct(value / 100, decimalsOf(value, 2));
}

function enumLabel(i18n: I18n, prefix: string, value: string): string {
  const id = value.replace(/ /g, "_");
  const key = `${prefix}.${id}`;
  const text = i18n.t(key);
  return text === key ? value.replace(/_/g, " ") : text;
}

/** Insight trigger type ("xt_surge") -> readable label. */
export function triggerLabel(i18n: I18n, value: string): string {
  return enumLabel(i18n, "panels.trigger", value);
}

/** Persona id ("casual_fan") -> readable label. */
export function personaLabel(i18n: I18n, value: string): string {
  return enumLabel(i18n, "panels.persona", value);
}
