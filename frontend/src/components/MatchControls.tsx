import { useEffect, useRef, useState } from "react";
import type { LensSummary, Locale, Persona, RunMatchResponse } from "../lib/types";
import { fetchMatchStatus, resumeMatch, runMatch } from "../lib/api";
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
  const [injectCrash, setInjectCrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crashedMatchId, setCrashedMatchId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function pollForCrash(matchId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchMatchStatus(matchId);
        if (status.status === "crashed") {
          setCrashedMatchId(matchId);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (status.status === "done" || status.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // transient -- keep polling until the interval naturally stops above
      }
    }, 2000);
  }

  async function handleRun() {
    setBusy(true);
    setError(null);
    setCrashedMatchId(null);
    try {
      const summary = await runMatch({ persona, lensId, injectFault, injectCrash, locale });
      onMatchStarted(summary);
      if (injectCrash) pollForCrash(summary.match_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    if (!crashedMatchId) return;
    setResuming(true);
    setError(null);
    try {
      await resumeMatch(crashedMatchId);
      setCrashedMatchId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResuming(false);
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
        <label className="fault-toggle" title="Deliberately crashes mid-match so you can watch the workflow resume from its last checkpoint instead of losing the run -- a live demo of real crash recovery, not just a claim.">
          <input type="checkbox" checked={injectCrash} onChange={(e) => setInjectCrash(e.target.checked)} />
          Demo: crash + recover mid-match
        </label>
        {crashedMatchId && (
          <button className="run-button resume-button" onClick={handleResume} disabled={resuming}>
            {resuming ? (
              <>
                <span className="spinner" />
                Resuming from checkpoint...
              </>
            ) : (
              <>⟲ Resume crashed match from checkpoint</>
            )}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
