import type { PersonalizedMessage } from "../lib/types";

export function PersonaFeed({ messages }: { messages: PersonalizedMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">💬</span>
        <p>No personalized recaps yet.<br />Run a match to see the Concierge agent in action.</p>
      </div>
    );
  }
  return (
    <ul className="persona-feed">
      {messages.map((m, i) => (
        <li key={i} className="persona-card-in">
          <span className="persona-tag">{m.persona.replace("_", " ")}</span>
          <p>{m.text}</p>
        </li>
      ))}
    </ul>
  );
}
