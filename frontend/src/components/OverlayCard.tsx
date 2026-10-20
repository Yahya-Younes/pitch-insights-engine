import type { RenderPayload } from "../lib/types";

const GRAPHIC_LABEL: Record<string, string> = {
  milestone: "GOAL",
  pressure_spike: "PRESSING INTENSITY",
  chaos_shift: "CONTROL / CHAOS",
  rhythm_change: "GAME RHYTHM",
  xt_surge: "THREAT SURGE",
  referee_decision: "REFEREE DECISION",
  tendency_match: "TENDENCY MATCH",
  tendency_break: "TENDENCY BREAK",
};

export function OverlayCard({ payload }: { payload: RenderPayload }) {
  return (
    <article className={`overlay-card priority-${payload.display.priority}`}>
      <header>
        <span className="game-clock">{payload.game_clock}</span>
        <span className="graphic-type">{GRAPHIC_LABEL[payload.graphic_type] ?? payload.graphic_type}</span>
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
