import type { RenderPayload } from "../lib/types";

const GRAPHIC_LABEL: Record<string, string> = {
  milestone: "Goal",
  pressure_spike: "Pressing Intensity",
  chaos_shift: "Control / Chaos",
  rhythm_change: "Game Rhythm",
  xt_surge: "Threat Surge",
  referee_decision: "Referee Decision",
  tendency_match: "Tendency Match",
  tendency_break: "Tendency Break",
};

const GRAPHIC_ICON: Record<string, string> = {
  milestone: "⚽",
  pressure_spike: "🔥",
  chaos_shift: "⚡",
  rhythm_change: "🎵",
  xt_surge: "📈",
  referee_decision: "🟨",
  tendency_match: "🎯",
  tendency_break: "❗",
};

export function OverlayCard({ payload }: { payload: RenderPayload }) {
  return (
    <article className={`overlay-card overlay-card-in priority-${payload.display.priority}`}>
      <header>
        <span className="overlay-icon" aria-hidden="true">{GRAPHIC_ICON[payload.graphic_type] ?? "📊"}</span>
        <span className="graphic-type">{GRAPHIC_LABEL[payload.graphic_type] ?? payload.graphic_type}</span>
        <span className="game-clock">{payload.game_clock}</span>
      </header>
      <p className="narrative">{payload.narrative_text}</p>
      {payload.data_points.length > 0 && (
        <ul className="data-points">
          {payload.data_points.map((dp, i) => (
            <li key={i}>
              <span>{dp.label}</span>
              <strong>{String(dp.value)}</strong>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
