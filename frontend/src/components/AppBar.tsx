import { useId, useRef } from "react";
import type { ConnectionStatus } from "../hooks/useOverlayFeed";
import type { Contrast, TextSize } from "../hooks/useA11ySettings";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useT } from "../i18n";
import { LOCALES } from "../lib/locales";
import type { LensSummary, Locale, RunMatchResponse } from "../lib/types";
import { MatchControls } from "./MatchControls";

const FEED_TONE: Record<ConnectionStatus, string> = {
  open: "is-success",
  connecting: "is-gold",
  closed: "is-danger",
  error: "is-danger",
};

interface AppBarProps {
  feedStatus: ConnectionStatus;
  textSize: TextSize;
  contrast: Contrast;
  locale: Locale;
  onCycleTextSize: () => void;
  onToggleContrast: () => void;
  onLocaleChange: (locale: Locale) => void;
  onOpenNewMatch: () => void;
  newMatchOpen: boolean;
}

export function AppBar({
  feedStatus, textSize, contrast, locale, onCycleTextSize, onToggleContrast, onLocaleChange,
  onOpenNewMatch, newMatchOpen,
}: AppBarProps) {
  const localeId = useId();
  const { t } = useT();
  return (
    <header className="app-bar">
      <div className="app-bar-brand">
        <span className="app-bar-dot" aria-hidden="true" />
        <span className="app-bar-name">Pitch Insights</span>
        <span className={`ui-pill ${FEED_TONE[feedStatus]} app-bar-feed`} role="status">
          <span aria-hidden="true">●</span> {t(`shell.feed.${feedStatus}`)}
        </span>
      </div>

      <div className="app-bar-actions">
        <label className="ui-sr-only" htmlFor={localeId}>{t("shell.bar.language")}</label>
        <select
          id={localeId}
          className="app-bar-select"
          value={locale}
          onChange={(e) => onLocaleChange(e.target.value as Locale)}
        >
          {LOCALES.map((l) => (
            <option key={l.value} value={l.value}>{l.short} · {l.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="ui-btn app-bar-tool"
          onClick={onCycleTextSize}
          title={t("shell.bar.textTitle")}
        >
          A+ <span className="app-bar-tool-label">{t("shell.bar.text")}</span>
          <span className="ui-sr-only">{t("shell.bar.textCurrent", { size: t(`shell.bar.size.${textSize}`) })}</span>
        </button>
        <button
          type="button"
          className="ui-btn app-bar-tool"
          onClick={onToggleContrast}
          aria-pressed={contrast === "high"}
          title={t("shell.bar.contrastTitle")}
        >
          <span aria-hidden="true">◐</span> <span className="app-bar-tool-label">{t("shell.bar.contrast")}</span>
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary app-bar-new"
          onClick={onOpenNewMatch}
          aria-haspopup="dialog"
          aria-expanded={newMatchOpen}
        >
          <span aria-hidden="true">▶</span> {t("shell.newMatch")}
        </button>
      </div>
    </header>
  );
}

interface NewMatchDialogProps {
  open: boolean;
  onClose: () => void;
  lenses: LensSummary[];
  onMatchStarted: (summary: RunMatchResponse) => void;
  locale: Locale;
}

/** The match-start flow (persona, lens, commentary language, demo toggles).
 * MatchControls stays mounted while the dialog is closed so its crash-recovery
 * polling and "resume" button survive -- reopen the dialog to resume. */
export function NewMatchDialog({ open, onClose, lenses, onMatchStarted, locale }: NewMatchDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { t } = useT();
  useFocusTrap(open, panelRef, onClose);

  return (
    <div className="nm-layer" hidden={!open}>
      <div className="nm-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="nm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="nm-head">
          <div>
            <h2 id={titleId} className="ui-heading">{t("shell.newMatch")}</h2>
            <p className="nm-sub">{t("shell.dialog.sub")}</p>
          </div>
          <button type="button" className="ui-btn nm-close" onClick={onClose} aria-label={t("common.close")}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <MatchControls lenses={lenses} onMatchStarted={onMatchStarted} defaultLocale={locale} />
      </div>
    </div>
  );
}
