import type { Locale } from "../lib/types";

/** One namespace's strings per locale: { fr: { "ns.key": "…" }, en: {…}, … }. */
export type Catalog = Partial<Record<Locale, Record<string, string>>>;
