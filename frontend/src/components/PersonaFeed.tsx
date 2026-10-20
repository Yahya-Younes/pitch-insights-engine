import type { PersonalizedMessage } from "../lib/types";

export function PersonaFeed({ messages }: { messages: PersonalizedMessage[] }) {
  if (messages.length === 0) {
    return <p className="empty-state">No personalized recaps yet -- run a match to see the Concierge agent in action.</p>;
  }
  return (
    <ul className="persona-feed">
      {messages.map((m, i) => (
        <li key={i}>
          <span className="persona-tag">{m.persona}</span>
          <p>{m.text}</p>
        </li>
      ))}
    </ul>
  );
}
