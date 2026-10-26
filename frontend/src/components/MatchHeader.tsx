import { TeamCrest } from "./TeamCrest";
import { useT, type I18n } from "../i18n";

interface Props {
  homeTeam: string;
  awayTeam: string;
  insightCount: number;
  homeMarketValueEur?: number;
  awayMarketValueEur?: number;
}

function formatEur({ t, num }: I18n, value: number): string {
  if (value >= 1_000_000_000) return t("shell.eur.billion", { n: num(value / 1_000_000_000, 2) });
  if (value >= 1_000_000) return t("shell.eur.million", { n: num(value / 1_000_000, 1) });
  return t("shell.eur.thousand", { n: num(value / 1000, 0) });
}

export function MatchHeader({ homeTeam, awayTeam, insightCount, homeMarketValueEur, awayMarketValueEur }: Props) {
  const i18n = useT();
  const { t } = i18n;
  const showValue = !!homeMarketValueEur && !!awayMarketValueEur;
  return (
    <div className="match-header">
      <div className="match-header-teams">
        <TeamCrest name={homeTeam} size={30} />
        <span className="match-team">
          {homeTeam}
          {showValue && <span className="match-team-value">{formatEur(i18n, homeMarketValueEur!)}</span>}
        </span>
        <span className="match-vs">{t("common.vs")}</span>
        <span className="match-team">
          {awayTeam}
          {showValue && <span className="match-team-value">{formatEur(i18n, awayMarketValueEur!)}</span>}
        </span>
        <TeamCrest name={awayTeam} size={30} />
      </div>
      <div className="match-header-meta">
        <span className="live-badge">
          <span className="live-dot" aria-hidden="true" />
          {t("shell.header.live")}
        </span>
        <span className="insight-count">{t(insightCount === 1 ? "shell.header.insights.one" : "shell.header.insights.other", { n: insightCount })}</span>
      </div>
    </div>
  );
}
