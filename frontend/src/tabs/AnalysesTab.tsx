import { ComparePersonas } from "../components/ComparePersonas";
import { MatchMaps } from "../components/MatchMaps";
import { PlayerTags } from "../components/PlayerTags";
import { WhatIfPanel } from "../components/WhatIfPanel";
import { useMatch } from "../lib/matchContext";

/** Threat/shot/network maps, counterfactuals, persona comparison and player tags. */
export function AnalysesTab() {
  const { matchId, renderEvents, lenses } = useMatch();
  return (
    <div className="tab-stack">
      <MatchMaps matchId={matchId} />
      <div className="ui-grid-2">
        <WhatIfPanel matchId={matchId} insights={renderEvents} />
        <ComparePersonas matchId={matchId} lenses={lenses} />
      </div>
      <PlayerTags matchId={matchId} />
    </div>
  );
}
