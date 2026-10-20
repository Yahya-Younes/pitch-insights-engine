interface Props {
  homeTeam: string;
  awayTeam: string;
  insightCount: number;
}

export function MatchHeader({ homeTeam, awayTeam, insightCount }: Props) {
  return (
    <div className="match-header">
      <div className="match-header-teams">
        <span className="match-team">{homeTeam}</span>
        <span className="match-vs">vs</span>
        <span className="match-team">{awayTeam}</span>
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
