import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../lib/types";
import { LOCALES } from "../lib/locales";

export type TextSize = "md" | "lg" | "xl";
export type Contrast = "normal" | "high";

export interface A11ySettings {
  textSize: TextSize;
  contrast: Contrast;
  locale: Locale;
}

const STORAGE_KEY = "pie.a11y";
const TEXT_SIZES: readonly TextSize[] = ["md", "lg", "xl"];
const DEFAULTS: A11ySettings = { textSize: "md", contrast: "normal", locale: "fr" };

function isTextSize(v: unknown): v is TextSize {
  return typeof v === "string" && (TEXT_SIZES as readonly string[]).includes(v);
}

function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && LOCALES.some((l) => l.value === v);
}

function readStored(): A11ySettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULTS;
    const rec = parsed as Record<string, unknown>;
    return {
      textSize: isTextSize(rec.textSize) ? rec.textSize : DEFAULTS.textSize,
      contrast: rec.contrast === "high" ? "high" : "normal",
      locale: isLocale(rec.locale) ? rec.locale : DEFAULTS.locale,
    };
  } catch {
    return DEFAULTS;
  }
}

function applyToDocument(s: A11ySettings) {
  const root = document.documentElement;
  if (s.textSize === "md") root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", s.textSize);
  if (s.contrast === "high") root.setAttribute("data-contrast", "high");
  else root.removeAttribute("data-contrast");
  // The interface copy is French; the locale is a commentary-language
  // preference, so <html lang> is deliberately left at "fr".
  root.setAttribute("data-locale", s.locale);
}

/** Applies the persisted settings to <html> -- called once before the first render. */
export function applyStoredA11ySettings() {
  applyToDocument(readStored());
}

/** Text size / high contrast / interface language, persisted in localStorage
 * and mirrored as data-attributes on <html> (consumed by index.css). */
export function useA11ySettings() {
  const [settings, setSettings] = useState<A11ySettings>(readStored);

  useEffect(() => {
    applyToDocument(settings);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable (private mode, quota) -- settings still apply for this session
    }
  }, [settings]);

  const cycleTextSize = useCallback(() => {
    setSettings((s) => {
      const idx = TEXT_SIZES.indexOf(s.textSize);
      const next = TEXT_SIZES[(idx + 1) % TEXT_SIZES.length] ?? "md";
      return { ...s, textSize: next };
    });
  }, []);

  const toggleContrast = useCallback(() => {
    setSettings((s) => ({ ...s, contrast: s.contrast === "high" ? "normal" : "high" }));
  }, []);

  const setLocale = useCallback((locale: Locale) => {
    setSettings((s) => ({ ...s, locale }));
  }, []);

  return { settings, cycleTextSize, toggleContrast, setLocale };
}
