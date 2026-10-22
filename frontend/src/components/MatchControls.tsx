import { useState } from "react";
import type { LensSummary, Locale, Persona, RunMatchResponse } from "../lib/types";
import { runMatch } from "../lib/api";
import { PersonaTabs } from "./PersonaTabs";
import { LensPicker } from "./LensPicker";

interface Props {
  lenses: LensSummary[];
  onMatchStarted: (summary: RunMatchResponse) => void;
}

const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Francais" },
  { value: "es", label: "Espanol" },
  { value: "de", label: "Deutsch" },
];

export function MatchControls({ lenses, onMatchStarted }: Props) {
  const [persona, setPersona] = useState<Persona>("casual_fan");
  const [lensId, setLensId] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [injectFault, setInjectFault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setBusy(true);
    setError(null);
    try {
      const summary = await runMatch({ persona, lensId, injectFault, locale });
      onMatchStarted(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="control-deck">
      <div className="control-row">
        <div className="control-label-row">
          <span className="control-label">Viewer Persona</span>
        </div>
        <PersonaTabs value={persona} onChange={setPersona} />
      </div>

      <div className="control-row">
        <div className="control-label-row">
          <span className="control-label">Commentary Language</span>
          <span className="control-hint">the live commentary panel only -- the broadcast overlay stays in English, like a canonical studio feed</span>
        </div>
        <div className="locale-tabs" role="tablist" aria-label="Commentary language">
          {LOCALES.map((l) => (
            <button
              key={l.value}
              type="button"
              role="tab"
              aria-selected={locale === l.value}
              className={`locale-tab ${locale === l.value ? "locale-tab-active" : ""}`}
              onClick={() => setLocale(l.value)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-row">
        <div className="control-label-row">
          <span className="control-label">Coach Lens</span>
          <span className="control-hint">reframes which insights lead &amp; how they're told</span>
        </div>
        <LensPicker lenses={lenses} selected={lensId} onSelect={setLensId} />
      </div>

      <div className="control-footer">
        <button className="run-button" onClick={handleRun} disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" />
              Generating match...
            </>
          ) : (
            <>
              <span className="run-icon" aria-hidden="true">▶</span>
              Run New Match
            </>
          )}
        </button>
        <label className="fault-toggle" title="Deliberately corrupts the first insight's narration with a fabricated stat, so you can watch the live grounding check catch and auto-correct it.">
          <input type="checkbox" checked={injectFault} onChange={(e) => setInjectFault(e.target.checked)} />
          Demo: inject a false claim
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
