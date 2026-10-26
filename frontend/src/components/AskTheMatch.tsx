import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Locale } from "../lib/types";
import { askMatch } from "../lib/api";
import { LOCALES } from "../lib/locales";
import { useT } from "../i18n";
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
  const { t, locale: uiLocale } = useT();
  const [question, setQuestion] = useState("");
  // Answers follow the page language unless the user picks another one here.
  const [localeOverride, setLocaleOverride] = useState<Locale | null>(null);
  const locale = localeOverride ?? uiLocale;
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
    ? t("live.ask.placeholderFocus", { name: focusPlayerName })
    : t("live.ask.placeholder");

  let content: ReactNode;
  if (!matchId) {
    content = <p className="lv-muted">{t("live.ask.noMatch")}</p>;
  } else {
    content = (
      <>
        <form className="lv-ask-form" onSubmit={handleAsk}>
          <label htmlFor={`${uid}-q`} className="ui-sr-only">{t("live.ask.questionLabel")}</label>
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
          <label htmlFor={`${uid}-lang`} className="ui-sr-only">{t("live.ask.langLabel")}</label>
          <select
            id={`${uid}-lang`}
            className="lv-ask-locale"
            value={locale}
            onChange={(e) => {
              const next = LOCALES.find((l) => l.value === e.target.value);
              if (next) setLocaleOverride(next.value === uiLocale ? null : next.value);
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
            aria-label={busy ? t("live.ask.sending") : t("live.ask.send")}
          >
            {busy ? <span className="lv-spinner" aria-hidden="true" /> : <span aria-hidden="true">➤</span>}
          </button>
        </form>
        {error && <p className="lv-error" role="alert">{t("live.ask.error", { error })}</p>}

        {turns.length > 0 && (
          <ul className="lv-qa-feed" aria-live="polite" aria-label={t("live.ask.answersAria")}>
            {turns.map((turn, i) => (
              <li key={turns.length - i} className={`lv-qa-turn${i === 0 ? " is-latest" : ""}`}>
                <p className="lv-qa-question">{t("live.ask.quote", { question: turn.question })}</p>
                <p className="lv-qa-answer">{turn.answer}</p>
                <div className="lv-qa-foot">
                  {turn.factChecked ? (
                    <span className="ui-pill is-success">{t("live.ask.verified")}</span>
                  ) : (
                    <span
                      className="ui-pill is-danger"
                      title={t("live.ask.unverifiedTitle")}
                    >
                      {t("live.ask.unverified")}
                    </span>
                  )}
                  <VoiceButton audioBase64={turn.audioBase64} autoPlay={i === 0} className="lv-btn-sm" />
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
        <h3 id={`${uid}-title`} className="lv-subheading">{t("live.ask.title")}</h3>
        {content}
      </div>
    );
  }

  return (
    <section className="ui-card lv-ask" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="ui-heading">{t("live.ask.title")}</h2>
      {content}
    </section>
  );
}
