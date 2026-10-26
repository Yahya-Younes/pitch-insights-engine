import { TacticalEvolution } from "../components/TacticalEvolution";
import { TacticsLab } from "../components/TacticsLab";
import { useT } from "../i18n";
import { useMatch } from "../lib/matchContext";

/** Formations detected over the match + the tactical simulation lab. */
export function TactiqueTab() {
  const { t } = useT();
  const { matchId, homeTeam, awayTeam } = useMatch();
  return (
    <div className="tab-stack">
      <TacticalEvolution
        matchId={matchId}
        homeTeam={homeTeam || t("panels.home")}
        awayTeam={awayTeam || t("panels.away")}
      />
      <TacticsLab />
    </div>
  );
}
