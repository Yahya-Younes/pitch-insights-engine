import { useState } from "react";
import { AgentTeam } from "../components/AgentTeam";
import { HeroStage } from "../components/HeroStage";
import { HistoryRail } from "../components/HistoryRail";
import { MakeItLie } from "../components/MakeItLie";
import { PipelineStatus } from "../components/PipelineStatus";
import { StatsBadge } from "../components/StatsBadge";
import { useMatch } from "../lib/matchContext";

/** Pourquoi faire confiance aux insights : chiffres mesurés en direct, trace
 * des agents, tentative de faire mentir le narrateur, historique diffusé. */
export function ConfianceTab() {
  const { match, matchId, homeTeam, awayTeam, renderEvents, personalizedEvents } = useMatch();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = renderEvents.find((p) => p.render_id === selectedId) ?? renderEvents[renderEvents.length - 1] ?? null;

  return (
    <div className="tab-stack">
      {match && (
        <PipelineStatus
          running
          sawRender={renderEvents.length > 0}
          sawPersonalized={personalizedEvents.length > 0}
        />
      )}

      <section className="ui-card confiance-stats" aria-labelledby="confiance-stats-title">
        <div className="ui-card-head">
          <h2 id="confiance-stats-title" className="ui-heading">Chiffres de confiance</h2>
          <span className="ui-tag">mesurés en direct</span>
        </div>
        <StatsBadge />
      </section>

      <AgentTeam matchId={matchId} running={Boolean(match)} />
      <MakeItLie matchId={matchId} insightCount={renderEvents.length} />

      <section className="ui-card confiance-history" aria-labelledby="confiance-history-title">
        <div className="ui-card-head">
          <h2 id="confiance-history-title" className="ui-heading">Historique diffusé</h2>
          <span className="ui-tag">stage d · render</span>
        </div>
        <HistoryRail
          payloads={renderEvents}
          selectedId={selected?.render_id ?? null}
          onSelect={setSelectedId}
        />
        {selected && <HeroStage payload={selected} homeTeam={homeTeam} awayTeam={awayTeam} />}
      </section>
    </div>
  );
}
