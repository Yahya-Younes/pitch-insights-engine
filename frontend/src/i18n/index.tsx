import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Locale } from "../lib/types";
import { messages as agents } from "./messages/agents";
import { messages as backend } from "./messages/backend";
import { messages as common } from "./messages/common";
import { messages as live } from "./messages/live";
import { messages as panels } from "./messages/panels";
import { messages as players } from "./messages/players";
import { messages as relations } from "./messages/relations";
import { messages as shell } from "./messages/shell";
import { messages as suivi } from "./messages/suivi";
import type { Catalog } from "./types";

export type { Catalog } from "./types";

/** Every UI string lives in a namespace catalog under ./messages, keyed
 * "<namespace>.<key>" (e.g. "live.hero.listen"). French is the source
 * language; a missing translation falls back to English, then French, then
 * the key itself so a gap is visible rather than blank. */
const CATALOGS: Catalog[] = [common, shell, live, suivi, players, relations, panels, agents, backend];

function merge(locale: Locale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cat of CATALOGS) Object.assign(out, cat[locale] ?? {});
  return out;
}

const TABLES: Partial<Record<Locale, Record<string, string>>> = {};
function table(locale: Locale): Record<string, string> {
  return (TABLES[locale] ??= merge(locale));
}

export type Params = Record<string, string | number>;

export function translate(locale: Locale, key: string, params?: Params): string {
  const raw = table(locale)[key] ?? table("en")[key] ?? table("fr")[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

const INTL_TAG: Record<Locale, string> = { fr: "fr-FR", en: "en-GB", es: "es-ES", de: "de-DE", it: "it-IT", pt: "pt-PT" };

export interface I18n {
  locale: Locale;
  /** Translate a "<namespace>.<key>" with optional {param} substitution. */
  t: (key: string, params?: Params) => string;
  /** Locale-aware number, fixed decimals ("8,4" in fr, "8.4" in en). */
  num: (value: number, decimals?: number) => string;
  /** Like num() but with an explicit sign; values that round to zero get none. */
  signed: (value: number, decimals?: number) => string;
  /** 0.54 -> "54 %" / "54%" depending on locale. */
  pct: (ratio: number, decimals?: number) => string;
}

const formatters = new Map<string, Intl.NumberFormat>();
function nf(locale: Locale, decimals: number, style: "decimal" | "percent" = "decimal"): Intl.NumberFormat {
  const id = `${locale}|${decimals}|${style}`;
  let f = formatters.get(id);
  if (!f) {
    f = new Intl.NumberFormat(INTL_TAG[locale], { style, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(id, f);
  }
  return f;
}

export function makeI18n(locale: Locale): I18n {
  return {
    locale,
    t: (key, params) => translate(locale, key, params),
    num: (value, decimals = 0) => nf(locale, decimals).format(value),
    signed: (value, decimals = 0) => {
      const text = nf(locale, decimals).format(Math.abs(value));
      if (Number(Math.abs(value).toFixed(decimals)) === 0) return nf(locale, decimals).format(0);
      return `${value < 0 ? "−" : "+"}${text}`;
    },
    pct: (ratio, decimals = 0) => nf(locale, decimals, "percent").format(ratio),
  };
}

const I18nContext = createContext<I18n>(makeI18n("fr"));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => makeI18n(locale), [locale]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18n {
  return useContext(I18nContext);
}
