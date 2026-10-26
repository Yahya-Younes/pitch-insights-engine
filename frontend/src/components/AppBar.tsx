import { useId, useRef } from "react";
import type { ConnectionStatus } from "../hooks/useOverlayFeed";
import type { Contrast, TextSize } from "../hooks/useA11ySettings";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { LOCALES } from "../lib/locales";
import type { LensSummary, Locale, RunMatchResponse } from "../lib/types";
import { MatchControls } from "./MatchControls";

const TEXT_SIZE_LABEL: Record<TextSize, string> = { md: "normale", lg: "grande", xl: "très grande" };

const FEED_LABEL: Record<ConnectionStatus, { text: string; tone: string }> = {
  open: { text: "5 agents live", tone: "is-success" },
  connecting: { text: "Connexion…", tone: "is-gold" },
  closed: { text: "Flux déconnecté", tone: "is-danger" },
  error: { text: "Erreur de flux", tone: "is-danger" },
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
  const feed = FEED_LABEL[feedStatus];
  return (
    <header className="app-bar">
      <div className="app-bar-brand">
        <span className="app-bar-dot" aria-hidden="true" />
        <span className="app-bar-name">Pitch Insights</span>
        <span className={`ui-pill ${feed.tone} app-bar-feed`} role="status">
          <span aria-hidden="true">●</span> {feed.text}
        </span>
      </div>

      <div className="app-bar-actions">
        <label className="ui-sr-only" htmlFor={localeId}>Langue</label>
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
          title="Changer la taille du texte"
        >
          A+ <span className="app-bar-tool-label">Texte</span>
          <span className="ui-sr-only">(taille actuelle : {TEXT_SIZE_LABEL[textSize]})</span>
        </button>
        <button
          type="button"
          className="ui-btn app-bar-tool"
          onClick={onToggleContrast}
          aria-pressed={contrast === "high"}
          title="Contraste élevé"
        >
          <span aria-hidden="true">◐</span> <span className="app-bar-tool-label">Contraste</span>
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary app-bar-new"
          onClick={onOpenNewMatch}
          aria-haspopup="dialog"
          aria-expanded={newMatchOpen}
        >
          <span aria-hidden="true">▶</span> Nouveau match
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
}

/** The match-start flow (persona, lens, commentary language, demo toggles).
 * MatchControls stays mounted while the dialog is closed so its crash-recovery
 * polling and "resume" button survive -- reopen the dialog to resume. */
export function NewMatchDialog({ open, onClose, lenses, onMatchStarted }: NewMatchDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
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
            <h2 id={titleId} className="ui-heading">Nouveau match</h2>
            <p className="nm-sub">Choisis un profil de spectateur, une langue et un coach, puis lance le match.</p>
          </div>
          <button type="button" className="ui-btn nm-close" onClick={onClose} aria-label="Fermer">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <MatchControls lenses={lenses} onMatchStarted={onMatchStarted} />
      </div>
    </div>
  );
}
