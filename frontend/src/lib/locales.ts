import type { Locale } from "./types";

/** Supported commentary/answer languages. `label` is the full name used in
 * the match controls; `short` is the compact code used in tighter rows. */
export const LOCALES: { value: Locale; label: string; short: string }[] = [
  { value: "en", label: "English", short: "EN" },
  { value: "fr", label: "Francais", short: "FR" },
  { value: "es", label: "Espanol", short: "ES" },
  { value: "de", label: "Deutsch", short: "DE" },
  { value: "it", label: "Italiano", short: "IT" },
  { value: "pt", label: "Portugues", short: "PT" },
];
