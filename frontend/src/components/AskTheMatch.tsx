import { useState } from "react";
import type { Locale } from "../lib/types";
import { askMatch } from "../lib/api";
import { LOCALES } from "../lib/locales";
import { VoiceButton } from "./VoiceButton";

interface QaTurn {
  question: string;
  answer: string;
  factChecked: boolean;
  audioBase64: string | null;
}


export function AskTheMatch({ matchId }: { matchId: string | null }) {
  const [question, setQuestion] = useState("");
  const [locale, setLocale] = useState<Locale>("en");
  const [turns, setTurns] = useState<QaTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk() {
    if (!matchId || !question.trim()) return;
    const q = question.trim();
    setBusy(true);
    setError(null);
    try {
      const res = await askMatch(matchId, q, locale);
      setTurns((prev) => [{ question: q, answer: res.answer, factChecked: res.fact_checked, audioBase64: res.audio_base64 }, ...prev]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="feed-panel ask-panel">
      <div className="panel-heading">
        <h2>Ask the Match</h2>
        <span className="panel-tag">grounded Q&amp;A</span>
      </div>

      {!matchId ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">❓</span>
          <p>Run a match first, then ask it anything about what happened.</p>
        </div>
      ) : (
        <>
          <div className="ask-input-row">
            <input
              className="ask-input"
              type="text"
              placeholder="e.g. Did anything unusual happen with the pressing?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && handleAsk()}
              disabled={busy}
            />
            <div className="locale-tabs ask-locale-tabs" role="tablist" aria-label="Answer language">
              {LOCALES.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  role="tab"
                  aria-selected={locale === l.value}
                  className={`locale-tab ${locale === l.value ? "locale-tab-active" : ""}`}
                  onClick={() => setLocale(l.value)}
                >
                  {l.short}
                </button>
              ))}
            </div>
            <button className="ask-button" onClick={handleAsk} disabled={busy || !question.trim()}>
              {busy ? <span className="spinner" /> : "Ask"}
            </button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}

          {turns.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">💬</span>
              <p>Ask anything about this match -- answered only from what's actually been verified so far.</p>
            </div>
          ) : (
            <ul className="qa-feed">
              {turns.map((t, i) => (
                <li key={i} className={`qa-turn ${i === 0 ? "qa-turn-latest commentary-in" : ""}`}>
                  <p className="qa-question">You asked: "{t.question}"</p>
                  <div className="qa-answer-row">
                    <p className="qa-answer">{t.answer}</p>
                    {t.factChecked ? (
                      <span className="verify-badge verify-badge-ok qa-badge">✓ grounded</span>
                    ) : (
                      <span className="verify-badge verify-badge-corrected qa-badge" title="The model's answer couldn't be verified against this match's actual insights, so a safe fallback was used instead.">
                        ⚠ unverified
                      </span>
                    )}
                  </div>
                  <VoiceButton audioBase64={t.audioBase64} autoPlay={i === 0} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
