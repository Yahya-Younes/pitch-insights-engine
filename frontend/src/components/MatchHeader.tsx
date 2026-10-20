import { TeamCrest } from "./TeamCrest";

interface Props {
  homeTeam: string;
  awayTeam: string;
  insightCount: number;
}

export function MatchHeader({ homeTeam, awayTeam, insightCount }: Props) {
  return (
    <div className="match-header">
      <div className="match-header-teams">
        <TeamCrest name={homeTeam} size={30} />
        <span className="match-team">{homeTeam}</span>
        <span className="match-vs">vs</span>
        <span className="match-team">{awayTeam}</span>
        <TeamCrest name={awayTeam} size={30} />
      </div>
      <div className="match-header-meta">
        <span className="live-badge">
          <span className="live-dot" />
          LIVE
        </span>
        <span className="insight-count">{insightCount} insight{insightCount === 1 ? "" : "s"} so far</span>
      </div>
    </div>
  );
}
