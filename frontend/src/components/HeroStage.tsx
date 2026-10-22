import type { DataPoint, RenderPayload } from "../lib/types";
import { themeFor } from "../lib/triggerTheme";
import { useCountUp } from "../hooks/useCountUp";
import { TeamCrest } from "./TeamCrest";
import { VoiceButton } from "./VoiceButton";

interface Props {
  payload: RenderPayload;
  homeTeam: string;
  awayTeam: string;
}

function pickHeadlineStat(points: DataPoint[]): DataPoint | null {
  const byLabel = (label: string) => points.find((p) => p.label === label);
  return byLabel("delta_pct") ?? byLabel("positioning_quality") ?? points.find((p) => typeof p.value === "number") ?? null;
}

function teamNameFor(points: DataPoint[], homeTeam: string, awayTeam: string): string | null {
  const team = points.find((p) => p.label === "team")?.value;
  if (team === "home") return homeTeam;
  if (team === "away") return awayTeam;
  return null;
}

export function HeroStage({ payload, homeTeam, awayTeam }: Props) {
  const theme = themeFor(payload.graphic_type);
  const stat = pickHeadlineStat(payload.data_points);
  const statValue = typeof stat?.value === "number" ? stat.value : 0;
  const animated = useCountUp(statValue, 900, payload.render_id);
  const team = teamNameFor(payload.data_points, homeTeam, awayTeam);
  const isPercent = stat?.label === "delta_pct";

  return (
    <div
      key={payload.render_id}
      className="hero-stage hero-stage-in"
      style={{ background: theme.gradient, borderColor: theme.color }}
    >
      <div className="hero-glow" style={{ background: theme.colorSoft }} />
      <div className="hero-top">
        <span className="hero-badge" style={{ background: theme.colorSoft, color: theme.color, borderColor: theme.color }}>
          <span className="hero-badge-icon">{theme.icon}</span>
          {theme.label}
        </span>
        <span className="hero-clock">{payload.game_clock}</span>
      </div>

      <div className="hero-verify-row">
        {payload.fact_checked ? (
          <span className="verify-badge verify-badge-ok">✓ Fact-checked live</span>
        ) : (
          <span className="verify-badge verify-badge-corrected" title="The model's original claim failed the live grounding check and was replaced with a verified, data-only sentence.">
            ⚠ Auto-corrected by grounding check
          </span>
        )}
        <VoiceButton audioBase64={payload.audio_base64} autoPlay />
      </div>

      <div className="hero-body">
        <p className="hero-narrative">{payload.narrative_text}</p>

        <div className="hero-foot">
          {team && (
            <div className="hero-team">
              <TeamCrest name={team} size={32} />
              <span>{team}</span>
            </div>
          )}
          {stat && (
            <div className="hero-stat">
              <span className="hero-stat-value">
                {isPercent && animated > 0 ? "+" : ""}
                {animated.toFixed(stat.label === "zscore" ? 2 : 1)}
                {isPercent ? "%" : ""}
              </span>
              <span className="hero-stat-label">{stat.label.replace(/_/g, " ")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
