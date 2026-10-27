import { useId, useState } from "react";
import type { CSSProperties } from "react";
import type { DataPoint, RenderPayload } from "../lib/types";
import { themeFor } from "../lib/triggerTheme";
import { num1, num2, payloadTeam, prefersReducedMotion, splitHeadline, triggerLabel } from "../lib/momentumApi";
import { useT } from "../i18n";
import type { I18n } from "../i18n";
import { useCountUp } from "../hooks/useCountUp";
import { VoiceButton } from "./VoiceButton";

export interface HeroLinkedPlayer {
  playerId: string;
  label: string;
  team: "home" | "away";
}

interface Props {
  payload: RenderPayload;
  homeTeam: string;
  awayTeam: string;
  /** Auto-play the narration when a new insight lands (live mode). */
  autoPlayAudio?: boolean;
  /** "What if…?" -- defaults to switching to the #analyses tab. */
  onWhatIf?: () => void;
  linkedPlayers?: HeroLinkedPlayer[];
  followedPlayerId?: string | null;
  onFollowPlayer?: (playerId: string) => void;
}

/** A z-score means nothing to a viewer, so it is never the headline figure:
 * a tempo change shows its actions per minute instead. */
const Z_SCORE_LABELS = new Set(["zscore", "tempo_zscore"]);

function pickHeadlineStat(points: DataPoint[]): DataPoint | null {
  const byLabel = (label: string) => points.find((p) => p.label === label);
  return byLabel("delta_pct") ?? byLabel("positioning_quality") ?? byLabel("tempo_actions_per_min")
    ?? points.find((p) => typeof p.value === "number" && !Z_SCORE_LABELS.has(p.label)) ?? null;
}

/** Translated data-point label ("live.dp.<label>"), else the raw key de-snaked. */
function humanLabel(i18n: I18n, label: string): string {
  const key = `live.dp.${label}`;
  const text = i18n.t(key);
  return text === key ? label.replace(/_/g, " ") : text;
}

function formatValue(i18n: I18n, value: DataPoint["value"], teamName: (side: string) => string | null): string {
  if (typeof value === "boolean") return i18n.t(value ? "live.value.yes" : "live.value.no");
  if (typeof value === "number") return Number.isInteger(value) ? i18n.num(value) : num2(i18n, value);
  return teamName(value) ?? value;
}

function goToAnalyses() {
  window.location.hash = "#analyses";
}

export function HeroStage({
  payload, homeTeam, awayTeam, autoPlayAudio = false, onWhatIf, linkedPlayers = [], followedPlayerId, onFollowPlayer,
}: Props) {
  const i18n = useT();
  const { t } = i18n;
  const [proofOpenFor, setProofOpenFor] = useState<string | null>(null);
  const proofId = useId();
  const theme = themeFor(payload.graphic_type);
  const stat = pickHeadlineStat(payload.data_points);
  const statValue = typeof stat?.value === "number" ? stat.value : 0;
  const animated = useCountUp(statValue, 900, payload.render_id);
  const shownValue = prefersReducedMotion() ? statValue : animated;
  const side = payloadTeam(payload.data_points);
  const sideName = (s: string | null) => (s === "home" ? homeTeam : s === "away" ? awayTeam : null);
  const teamName = sideName(side);
  const isPercent = stat?.label === "delta_pct";
  const { headline, rest } = splitHeadline(payload.narrative_text);
  const proofOpen = proofOpenFor === payload.render_id;

  return (
    <article className="ui-card lv-hero" style={{ "--lv-trigger": theme.color } as CSSProperties} aria-labelledby={`${proofId}-headline`}>
      <div className="lv-hero-live" aria-live="polite" aria-atomic="true">
        <div key={payload.render_id} className="lv-hero-in">
          <div className="lv-hero-top">
            <span className="ui-pill lv-trigger-pill">
              <span aria-hidden="true">{theme.icon}</span> {triggerLabel(i18n, payload.graphic_type)}
            </span>
            {payload.fact_checked ? (
              <span className="ui-pill is-success">{t("live.hero.verified")}</span>
            ) : (
              <span
                className="ui-pill is-danger"
                title={t("live.hero.correctedTitle")}
              >
                {t("live.hero.corrected")}
              </span>
            )}
            {teamName && (
              <span className={`ui-pill ${side === "home" ? "is-home" : "is-away"}`}>{teamName}</span>
            )}
            <span className="lv-hero-clock" aria-label={t("live.hero.clockAria", { clock: payload.game_clock })}>{payload.game_clock}</span>
          </div>

          <div className="lv-hero-body">
            <div className="lv-hero-text">
              <h2 id={`${proofId}-headline`} className="lv-hero-headline">{headline}</h2>
              {rest && <p className="lv-hero-narrative">{rest}</p>}
            </div>
            {stat && (
              <div className="lv-hero-stat">
                <span className="ui-stat-value lv-hero-stat-value">
                  {isPercent
                    ? `${shownValue > 0 ? "+" : ""}${i18n.pct(Number((shownValue / 100).toFixed(3)) || 0, 1)}`
                    : num1(i18n, shownValue)}
                </span>
                <span className="lv-hero-stat-label">{humanLabel(i18n, stat.label)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {linkedPlayers.length > 0 && onFollowPlayer && (
        <div className="lv-hero-players" role="group" aria-label={t("live.hero.playersAria")}>
          {linkedPlayers.map((p) => {
            const followed = followedPlayerId === p.playerId;
            return (
              <button
                key={p.playerId}
                type="button"
                className={`ui-pill ${p.team === "home" ? "is-home" : "is-away"}${followed ? " is-solid" : ""}`}
                aria-pressed={followed}
                onClick={() => onFollowPlayer(p.playerId)}
              >
                👁 {p.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="lv-hero-actions">
        <VoiceButton audioUrl={payload.audio_url} autoPlay={autoPlayAudio} showWhenEmpty className="ui-btn-primary" />
        <button type="button" className="ui-btn" onClick={onWhatIf ?? goToAnalyses}>
          {t("live.hero.whatIf")}
        </button>
        <button
          type="button"
          className="ui-btn"
          aria-expanded={proofOpen}
          aria-controls={`${proofId}-proof`}
          onClick={() => setProofOpenFor(proofOpen ? null : payload.render_id)}
        >
          {t("live.hero.why")}
        </button>
      </div>

      {proofOpen && (
        <div id={`${proofId}-proof`} className="lv-hero-proof">
          <p className="lv-hero-proof-intro">
            {t("live.hero.proofIntro")}
          </p>
          {payload.data_points.length === 0 ? (
            <p className="lv-muted">{t("live.hero.proofEmpty")}</p>
          ) : (
            <dl className="lv-hero-proof-list">
              {payload.data_points.map((d, i) => (
                <div key={`${d.label}-${i}`} className="lv-hero-proof-row">
                  <dt>{humanLabel(i18n, d.label)}</dt>
                  <dd>{formatValue(i18n, d.value, d.label === "team" ? sideName : () => null)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="lv-muted lv-hero-proof-source">{t("live.hero.source", { id: payload.source_insight_id })}</p>
        </div>
      )}
    </article>
  );
}
