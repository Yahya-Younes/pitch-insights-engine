import { useId, useState } from "react";
import type { CSSProperties } from "react";
import type { DataPoint, RenderPayload } from "../lib/types";
import { themeFor } from "../lib/triggerTheme";
import { fr1, fr2, payloadTeam, prefersReducedMotion, splitHeadline, triggerLabelFr } from "../lib/momentumApi";
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
  /** "Et si… ?" -- defaults to switching to the #analyses tab. */
  onWhatIf?: () => void;
  linkedPlayers?: HeroLinkedPlayer[];
  followedPlayerId?: string | null;
  onFollowPlayer?: (playerId: string) => void;
}

function pickHeadlineStat(points: DataPoint[]): DataPoint | null {
  const byLabel = (label: string) => points.find((p) => p.label === label);
  return byLabel("delta_pct") ?? byLabel("positioning_quality") ?? points.find((p) => typeof p.value === "number") ?? null;
}

function humanLabel(label: string): string {
  return label.replace(/_/g, " ");
}

function formatValue(value: DataPoint["value"]): string {
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : fr2(value);
  return value;
}

function goToAnalyses() {
  window.location.hash = "#analyses";
}

export function HeroStage({
  payload, homeTeam, awayTeam, autoPlayAudio = false, onWhatIf, linkedPlayers = [], followedPlayerId, onFollowPlayer,
}: Props) {
  const [proofOpenFor, setProofOpenFor] = useState<string | null>(null);
  const proofId = useId();
  const theme = themeFor(payload.graphic_type);
  const stat = pickHeadlineStat(payload.data_points);
  const statValue = typeof stat?.value === "number" ? stat.value : 0;
  const animated = useCountUp(statValue, 900, payload.render_id);
  const shownValue = prefersReducedMotion() ? statValue : animated;
  const side = payloadTeam(payload.data_points);
  const teamName = side === "home" ? homeTeam : side === "away" ? awayTeam : null;
  const isPercent = stat?.label === "delta_pct";
  const { headline, rest } = splitHeadline(payload.narrative_text);
  const proofOpen = proofOpenFor === payload.render_id;

  return (
    <article className="ui-card lv-hero" style={{ "--lv-trigger": theme.color } as CSSProperties} aria-labelledby={`${proofId}-headline`}>
      <div className="lv-hero-live" aria-live="polite" aria-atomic="true">
        <div key={payload.render_id} className="lv-hero-in">
          <div className="lv-hero-top">
            <span className="ui-pill lv-trigger-pill">
              <span aria-hidden="true">{theme.icon}</span> {triggerLabelFr(payload.graphic_type)}
            </span>
            {payload.fact_checked ? (
              <span className="ui-pill is-success">✓ Vérifié par le fact-checker</span>
            ) : (
              <span
                className="ui-pill is-danger"
                title="L'affirmation d'origine du modèle a échoué au contrôle et a été remplacée par une phrase vérifiée, issue des données."
              >
                ⚠ Corrigé par le fact-checker
              </span>
            )}
            {teamName && (
              <span className={`ui-pill ${side === "home" ? "is-home" : "is-away"}`}>{teamName}</span>
            )}
            <span className="lv-hero-clock" aria-label={`Temps de jeu ${payload.game_clock}`}>{payload.game_clock}</span>
          </div>

          <div className="lv-hero-body">
            <div className="lv-hero-text">
              <h2 id={`${proofId}-headline`} className="lv-hero-headline">{headline}</h2>
              {rest && <p className="lv-hero-narrative">{rest}</p>}
            </div>
            {stat && (
              <div className="lv-hero-stat">
                <span className="ui-stat-value lv-hero-stat-value">
                  {isPercent && shownValue > 0 ? "+" : ""}
                  {stat.label === "zscore" ? fr2(shownValue) : fr1(shownValue)}
                  {isPercent ? " %" : ""}
                </span>
                <span className="lv-hero-stat-label">{humanLabel(stat.label)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {linkedPlayers.length > 0 && onFollowPlayer && (
        <div className="lv-hero-players" role="group" aria-label="Joueurs concernés">
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
        <VoiceButton audioBase64={payload.audio_base64} autoPlay={autoPlayAudio} showWhenEmpty className="ui-btn-primary" />
        <button type="button" className="ui-btn" onClick={onWhatIf ?? goToAnalyses}>
          Et si… ?
        </button>
        <button
          type="button"
          className="ui-btn"
          aria-expanded={proofOpen}
          aria-controls={`${proofId}-proof`}
          onClick={() => setProofOpenFor(proofOpen ? null : payload.render_id)}
        >
          Pourquoi c'est vrai ?
        </button>
      </div>

      {proofOpen && (
        <div id={`${proofId}-proof`} className="lv-hero-proof">
          <p className="lv-hero-proof-intro">
            Cette affirmation s'appuie sur ces données, recontrôlées par le fact-checker avant diffusion :
          </p>
          {payload.data_points.length === 0 ? (
            <p className="lv-muted">Aucune donnée chiffrée attachée à cet insight.</p>
          ) : (
            <dl className="lv-hero-proof-list">
              {payload.data_points.map((d, i) => (
                <div key={`${d.label}-${i}`} className="lv-hero-proof-row">
                  <dt>{humanLabel(d.label)}</dt>
                  <dd>{formatValue(d.value)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="lv-muted lv-hero-proof-source">Source : insight {payload.source_insight_id}</p>
        </div>
      )}
    </article>
  );
}
