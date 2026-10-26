import { useEffect, useRef, useState } from "react";
import type { LensSummary, Locale, Persona, RunMatchResponse } from "../lib/types";
import { fetchMatchStatus, resumeMatch, runMatch } from "../lib/api";
import { LOCALES } from "../lib/locales";
import { PersonaTabs } from "./PersonaTabs";
import { LensPicker } from "./LensPicker";
import { useT } from "../i18n";

interface Props {
  lenses: LensSummary[];
  onMatchStarted: (summary: RunMatchResponse) => void;
  /** Commentary language preselected from the app's language setting. */
  defaultLocale?: Locale;
}


export function MatchControls({ lenses, onMatchStarted, defaultLocale = "en" }: Props) {
  const { t } = useT();
  const [persona, setPersona] = useState<Persona>("casual_fan");
  const [lensId, setLensId] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  // Follow the app-wide language until the user picks one here.
  useEffect(() => setLocale(defaultLocale), [defaultLocale]);
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
          <span className="control-label">{t("shell.controls.persona")}</span>
        </div>
        <PersonaTabs value={persona} onChange={setPersona} label={t("shell.controls.persona")} />
      </div>

      <div className="control-row">
        <div className="control-label-row">
          <span className="control-label">{t("shell.controls.language")}</span>
          <span className="control-hint">{t("shell.controls.languageHint")}</span>
        </div>
        <div className="locale-tabs" role="tablist" aria-label={t("shell.controls.language")}>
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
          <span className="control-label">{t("shell.controls.lens")}</span>
          <span className="control-hint">{t("shell.controls.lensHint")}</span>
        </div>
        <LensPicker lenses={lenses} selected={lensId} onSelect={setLensId} />
      </div>

      <div className="control-footer">
        <button className="run-button" onClick={handleRun} disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" />
              {t("shell.controls.generating")}
            </>
          ) : (
            <>
              <span className="run-icon" aria-hidden="true">▶</span>
              {t("shell.controls.run")}
            </>
          )}
        </button>
        <label className="fault-toggle" title={t("shell.controls.faultTitle")}>
          <input type="checkbox" checked={injectFault} onChange={(e) => setInjectFault(e.target.checked)} />
          {t("shell.controls.fault")}
        </label>
        <label className="fault-toggle" title={t("shell.controls.crashTitle")}>
          <input type="checkbox" checked={injectCrash} onChange={(e) => setInjectCrash(e.target.checked)} />
          {t("shell.controls.crash")}
        </label>
        {crashedMatchId && (
          <button className="run-button resume-button" onClick={handleResume} disabled={resuming}>
            {resuming ? (
              <>
                <span className="spinner" />
                {t("shell.controls.resuming")}
              </>
            ) : (
              <><span aria-hidden="true">⟲</span> {t("shell.controls.resume")}</>
            )}
          </button>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
