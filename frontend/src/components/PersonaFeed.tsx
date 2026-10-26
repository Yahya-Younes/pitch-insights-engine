import { shortName } from "../lib/matchContext";
import type { PersonalizedMessage } from "../lib/types";
import { VoiceButton } from "./VoiceButton";

const PERSONA_AVATAR: Record<string, string> = {
  casual_fan: "🙌",
  analyst: "📊",
  player_tracker: "🎯",
};

const PERSONA_LABEL: Record<string, string> = {
  casual_fan: "Fan",
  analyst: "Analyste",
  player_tracker: "Joueur suivi",
};

interface Props {
  messages: PersonalizedMessage[];
  /** When set, messages mentioning this term (e.g. a followed player's full
   * name, or its "R. Donnelly" short form) are pinned first and highlighted.
   * Surnames alone are not matched: the simulator reuses them within a squad. */
  focusTerm?: string | null;
  autoPlayLatest?: boolean;
  emptyText?: string;
}

function mentions(text: string, term: string): boolean {
  const hay = text.toLocaleLowerCase("fr");
  const short = shortName(term);
  return hay.includes(term.toLocaleLowerCase("fr")) || (short !== term && hay.includes(short.toLocaleLowerCase("fr")));
}

export function PersonaFeed({ messages, focusTerm = null, autoPlayLatest = true, emptyText }: Props) {
  if (messages.length === 0) {
    return (
      <div className="lv-empty">
        <span className="lv-empty-icon" aria-hidden="true">💬</span>
        <p>{emptyText ?? "Pas encore de commentaire. Le Concierge prend la parole dès le premier insight."}</p>
      </div>
    );
  }

  const newestFirst = messages.map((m, i) => ({ m, i })).reverse();
  const term = focusTerm?.trim() || null;
  const ordered = term
    ? [...newestFirst.filter(({ m }) => mentions(m.text, term)), ...newestFirst.filter(({ m }) => !mentions(m.text, term))]
    : newestFirst;
  const latestIndex = messages.length - 1;

  return (
    <ul className="lv-feed" aria-live="polite" aria-relevant="additions" aria-label="Commentaire en direct">
      {ordered.map(({ m, i }) => {
        const focused = term !== null && mentions(m.text, term);
        return (
          <li key={i} className={`lv-feed-row${i === latestIndex ? " is-latest" : ""}${focused ? " is-focus" : ""}`}>
            <span className="lv-feed-avatar" aria-hidden="true">{PERSONA_AVATAR[m.persona] ?? "🗣️"}</span>
            <div className="lv-feed-bubble">
              <div className="lv-feed-meta">
                <span className="lv-feed-persona">{PERSONA_LABEL[m.persona] ?? m.persona.replace(/_/g, " ")}</span>
                {focused && <span className="ui-pill is-home lv-feed-focus">Focus</span>}
              </div>
              <p>{m.text}</p>
              <VoiceButton audioBase64={m.audio_base64} autoPlay={autoPlayLatest && i === latestIndex} className="lv-btn-sm" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
