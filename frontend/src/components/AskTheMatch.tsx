import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
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

interface Props {
  matchId: string | null;
  /** Full name of the followed player, used to suggest a question. */
  focusPlayerName?: string | null;
  /** Render without its own card/heading (inside another card). */
  embedded?: boolean;
}

export function AskTheMatch({ matchId, focusPlayerName = null, embedded = false }: Props) {
  const [question, setQuestion] = useState("");
  const [locale, setLocale] = useState<Locale>("fr");
  const [turns, setTurns] = useState<QaTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();

  async function handleAsk(e?: FormEvent) {
    e?.preventDefault();
    if (!matchId || !question.trim() || busy) return;
    const q = question.trim();
    setBusy(true);
    setError(null);
    try {
      const res = await askMatch(matchId, q, locale);
      setTurns((prev) => [{ question: q, answer: res.answer, factChecked: res.fact_checked, audioBase64: res.audio_base64 }, ...prev]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const placeholder = focusPlayerName
    ? `Ex. : Qu'a fait ${focusPlayerName} depuis la reprise ?`
    : "Pose une question au match…";

  let content: ReactNode;
  if (!matchId) {
    content = <p className="lv-muted">Lance un match, puis pose-lui n'importe quelle question.</p>;
  } else {
    content = (
      <>
        <form className="lv-ask-form" onSubmit={handleAsk}>
          <label htmlFor={`${uid}-q`} className="ui-sr-only">Question sur le match</label>
          <input
            id={`${uid}-q`}
            className="lv-ask-input"
            type="text"
            placeholder={placeholder}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
          <label htmlFor={`${uid}-lang`} className="ui-sr-only">Langue de la réponse</label>
          <select
            id={`${uid}-lang`}
            className="lv-ask-locale"
            value={locale}
            onChange={(e) => {
              const next = LOCALES.find((l) => l.value === e.target.value);
              if (next) setLocale(next.value);
            }}
            disabled={busy}
          >
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>{l.short}</option>
            ))}
          </select>
          <button
            type="submit"
            className="lv-ask-send"
            disabled={busy || !question.trim()}
            aria-label={busy ? "Réponse en cours" : "Envoyer la question"}
          >
            {busy ? <span className="lv-spinner" aria-hidden="true" /> : <span aria-hidden="true">➤</span>}
          </button>
        </form>
        {error && <p className="lv-error" role="alert">Impossible d'obtenir une réponse : {error}</p>}

        {turns.length > 0 && (
          <ul className="lv-qa-feed" aria-live="polite" aria-label="Réponses">
            {turns.map((t, i) => (
              <li key={turns.length - i} className={`lv-qa-turn${i === 0 ? " is-latest" : ""}`}>
                <p className="lv-qa-question">« {t.question} »</p>
                <p className="lv-qa-answer">{t.answer}</p>
                <div className="lv-qa-foot">
                  {t.factChecked ? (
                    <span className="ui-pill is-success">✓ Vérifié</span>
                  ) : (
                    <span
                      className="ui-pill is-danger"
                      title="La réponse du modèle n'a pas pu être vérifiée sur les insights du match ; une réponse prudente a été utilisée."
                    >
                      ⚠ Non vérifié
                    </span>
                  )}
                  <VoiceButton audioBase64={t.audioBase64} autoPlay={i === 0} className="lv-btn-sm" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  if (embedded) {
    return (
      <div className="lv-ask" aria-labelledby={`${uid}-title`}>
        <h3 id={`${uid}-title`} className="lv-subheading">Demande au match</h3>
        {content}
      </div>
    );
  }

  return (
    <section className="ui-card lv-ask" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="ui-heading">Demande au match</h2>
      {content}
    </section>
  );
}
