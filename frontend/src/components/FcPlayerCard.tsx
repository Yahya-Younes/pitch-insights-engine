import type { CSSProperties } from "react";
import {
  ATTRIBUTE_META,
  ATTRIBUTE_ORDER,
  formatRating,
  positionLabel,
  cardName,
  type MatchPlayer,
} from "../lib/playersTypes";
import "./FcPlayerCard.css";

type CardTier = "gold" | "silver" | "bronze" | "none";

function cardTier(rating: number | null, motm: boolean): CardTier {
  if (motm) return "gold";
  if (rating === null) return "none";
  if (rating >= 7.5) return "gold";
  if (rating >= 6.5) return "silver";
  return "bronze";
}

export interface FcPlayerCardProps {
  player: Pick<MatchPlayer, "id" | "name" | "number" | "team" | "position" | "rating" | "attributes">;
  motm?: boolean;
  compact?: boolean;
  /** Followed across tabs -> small "Suivi" ribbon. */
  followed?: boolean;
  /** Team display name, used in the accessible label. */
  teamName?: string;
  /** When set the whole card is a button; otherwise a static figure. */
  onSelect?: (playerId: string) => void;
  /** Delay (ms) for the staggered entrance animation in grids. */
  enterDelayMs?: number;
}

/** EA FC-style player card: note /10, position, shirt-number avatar, six attributes. */
export function FcPlayerCard({
  player, motm = false, compact = false, followed = false, teamName, onSelect, enterDelayMs,
}: FcPlayerCardProps) {
  const tier = cardTier(player.rating, motm);
  const ratingText = player.rating === null ? "–" : formatRating(player.rating);
  const posCode = player.position ?? "—";

  const attrsLabel = player.attributes
    ? ATTRIBUTE_ORDER.map((k) => `${ATTRIBUTE_META[k].label} ${player.attributes?.[k] ?? 0}`).join(", ")
    : "attributs indisponibles";
  const label = [
    player.name,
    `numéro ${player.number}`,
    teamName,
    positionLabel(player.position),
    player.rating === null ? "note indisponible" : `note ${ratingText} sur 10`,
    motm ? "homme du match" : null,
    followed ? "joueur suivi" : null,
    attrsLabel,
  ].filter(Boolean).join(", ");

  const className = [
    "fc-card",
    `fc-card--${tier}`,
    `fc-card--${player.team}`,
    motm ? "fc-card--motm" : "",
    compact ? "fc-card--compact" : "",
    onSelect ? "fc-card--interactive" : "",
  ].filter(Boolean).join(" ");

  const style = enterDelayMs !== undefined ? ({ "--fc-delay": `${enterDelayMs}ms` } as CSSProperties) : undefined;

  const body = (
    <>
      <span className="fc-card__stripe" aria-hidden="true" />
      <span className="fc-card__top" aria-hidden="true">
        <span className="fc-card__rating-block">
          <span className="fc-card__rating">{ratingText}</span>
          <span className="fc-card__pos">{posCode}</span>
        </span>
        <span className="fc-card__avatar">
          <span className="fc-card__avatar-num">{player.number}</span>
        </span>
      </span>
      {motm && <span className="fc-card__motm" aria-hidden="true">★ MOTM</span>}
      {followed && <span className="fc-card__followed" aria-hidden="true">◉ Suivi</span>}
      <span className="fc-card__name" aria-hidden="true">{cardName(player.name)}</span>
      <span className="fc-card__divider" aria-hidden="true" />
      <span className="fc-card__stats" aria-hidden="true">
        {ATTRIBUTE_ORDER.map((k) => (
          <span key={k} className="fc-card__stat">
            <span className="fc-card__stat-value">{player.attributes ? player.attributes[k] : "–"}</span>
            <span className="fc-card__stat-code">{ATTRIBUTE_META[k].code}</span>
          </span>
        ))}
      </span>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        aria-label={`${label}. Ouvrir la fiche`}
        onClick={() => onSelect(player.id)}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={className} style={style} role="img" aria-label={label}>
      {body}
    </div>
  );
}
