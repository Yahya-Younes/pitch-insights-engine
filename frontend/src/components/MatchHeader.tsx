import { TeamCrest } from "./TeamCrest";

interface Props {
  homeTeam: string;
  awayTeam: string;
  insightCount: number;
  homeMarketValueEur?: number;
  awayMarketValueEur?: number;
}

function formatEur(value: number): string {
  if (value >= 1_000_000_000) return `€${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}M`;
  return `€${Math.round(value / 1000)}K`;
}

export function MatchHeader({ homeTeam, awayTeam, insightCount, homeMarketValueEur, awayMarketValueEur }: Props) {
  const showValue = !!homeMarketValueEur && !!awayMarketValueEur;
  return (
    <div className="match-header">
      <div className="match-header-teams">
        <TeamCrest name={homeTeam} size={30} />
        <span className="match-team">
          {homeTeam}
          {showValue && <span className="match-team-value">{formatEur(homeMarketValueEur!)}</span>}
        </span>
        <span className="match-vs">vs</span>
        <span className="match-team">
          {awayTeam}
          {showValue && <span className="match-team-value">{formatEur(awayMarketValueEur!)}</span>}
        </span>
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
