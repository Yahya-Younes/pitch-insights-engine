import type { PersonalizedMessage } from "../lib/types";
import { VoiceButton } from "./VoiceButton";

const PERSONA_AVATAR: Record<string, string> = {
  casual_fan: "🙌",
  analyst: "📊",
  player_tracker: "🎯",
};

export function PersonaFeed({ messages }: { messages: PersonalizedMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">💬</span>
        <p>No commentary yet.<br />Run a match to hear the Concierge agent.</p>
      </div>
    );
  }
  const ordered = [...messages].reverse();
  return (
    <ul className="commentary-feed" aria-live="polite" aria-label="Live commentary">
      {ordered.map((m, i) => (
        <li key={i} className={`commentary-row ${i === 0 ? "commentary-row-latest" : ""} commentary-in`}>
          <span className="commentary-avatar">{PERSONA_AVATAR[m.persona] ?? "🗣️"}</span>
          <div className="commentary-bubble">
            <span className="persona-tag">{m.persona.replace("_", " ")}</span>
            <p>{m.text}</p>
            <VoiceButton audioBase64={m.audio_base64} autoPlay={i === 0} />
          </div>
        </li>
      ))}
    </ul>
  );
}
