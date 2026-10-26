import { TacticalEvolution } from "../components/TacticalEvolution";
import { TacticsLab } from "../components/TacticsLab";
import { useMatch } from "../lib/matchContext";

/** Formations détectées au fil du match + laboratoire de simulations tactiques. */
export function TactiqueTab() {
  const { matchId, homeTeam, awayTeam } = useMatch();
  return (
    <div className="tab-stack">
      <TacticalEvolution matchId={matchId} homeTeam={homeTeam || "Domicile"} awayTeam={awayTeam || "Extérieur"} />
      <TacticsLab />
    </div>
  );
}
