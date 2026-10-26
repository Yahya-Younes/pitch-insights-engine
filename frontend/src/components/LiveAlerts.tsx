import { useId, useMemo } from "react";
import { shortName } from "../lib/liveApi";
import type { LiveRatingsResponse, Side } from "../lib/liveTypes";
import { shirtNumber } from "../lib/matchContext";
import type { PlayerTagsResponse } from "../lib/playerTagsApi";
import { clockToSeconds } from "../lib/triggerTheme";
import type { RenderPayload } from "../lib/types";
import "./LiveAlerts.css";

const MAX_ALERTS = 8;
/** Speed tags are frequent -- cap them so insights and leader changes stay visible. */
const MAX_TAG_ALERTS = 3;

interface Props {
  renderEvents: RenderPayload[];
  ratings: LiveRatingsResponse | null;
  tags: PlayerTagsResponse | null;
  /** Hide anything after this match minute (null = no limit). */
  maxMinute: number | null;
}

interface Alert {
  id: string;
  seconds: number;
  team: Side | null;
  icon: string;
  kind: string;
  text: string;
}

const INSIGHT_KIND: Record<string, { icon: string; label: string }> = {
  milestone: { icon: "⚽", label: "But" },
  referee_decision: { icon: "🟨", label: "Décision arbitrale" },
  tendency_break: { icon: "❗", label: "Rupture de tendance" },
  tendency_match: { icon: "🎯", label: "Tendance confirmée" },
  pressure_spike: { icon: "🔥", label: "Pic de pressing" },
  xt_surge: { icon: "📈", label: "Poussée offensive" },
  chaos_shift: { icon: "⚡", label: "Contrôle / chaos" },
  rhythm_change: { icon: "🎵", label: "Changement de rythme" },
};

function sideOf(playerId: string | undefined): Side | null {
  if (!playerId) return null;
  if (playerId.startsWith("home")) return "home";
  if (playerId.startsWith("away")) return "away";
  return null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function buildAlerts(renderEvents: RenderPayload[], ratings: LiveRatingsResponse | null,
  tags: PlayerTagsResponse | null, maxMinute: number | null): Alert[] {
  const limitS = maxMinute === null ? Infinity : (maxMinute + 1) * 60;
  const out: Alert[] = [];

  for (const ev of renderEvents) {
    const kind = INSIGHT_KIND[ev.graphic_type] ?? { icon: "◆", label: "Analyse" };
    const seconds = clockToSeconds(ev.game_clock);
    out.push({
      id: `ev-${ev.render_id}`,
      seconds,
      team: sideOf(ev.linked_players[0]),
      icon: kind.icon,
      kind: kind.label,
      text: truncate(ev.narrative_text, 140),
    });
  }

  if (tags) {
    const names = new Map(tags.players.map((p) => [p.player_id, p.name]));
    const speedTags = tags.tags
      .filter((t) => (t.kind === "sprint" || t.kind === "top_speed") && t.t_ms / 1000 < limitS)
      .slice(-MAX_TAG_ALERTS);
    for (const t of speedTags) {
      const name = shortName(names.get(t.player_id) ?? t.player_id);
      const speed = t.value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const top = t.kind === "top_speed";
      out.push({
        id: `tag-${t.kind}-${t.player_id}-${t.t_ms}`,
        seconds: t.t_ms / 1000,
        team: sideOf(t.player_id),
        icon: top ? "🚀" : "💨",
        kind: top ? "Vitesse max du match" : "Sprint",
        text: `#${shirtNumber(t.player_id)} ${name} · ${speed} km/h`,
      });
    }
  }

  if (ratings) {
    const byId = new Map(ratings.players.map((p) => [p.player_id, p]));
    ratings.leader_history.forEach((h, i) => {
      const p = byId.get(h.player_id);
      const label = p ? `#${p.number} ${shortName(p.name)}` : `#${shirtNumber(h.player_id)}`;
      out.push({
        id: `lead-${h.minute}-${h.player_id}`,
        // Leader changes are computed at minute granularity; sort them after events of that minute.
        seconds: h.minute * 60 + 59.5,
        team: p?.team ?? sideOf(h.player_id),
        icon: "👑",
        kind: "Homme du match",
        text: `${i === 0 ? "Premier leader" : "Nouveau leader"} : ${label}`,
      });
    });
  }

  return out
    .filter((a) => a.seconds < limitS)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MAX_ALERTS);
}

export function LiveAlerts({ renderEvents, ratings, tags, maxMinute }: Props) {
  const headingId = useId();
  const alerts = useMemo(
    () => buildAlerts(renderEvents, ratings, tags, maxMinute),
    [renderEvents, ratings, tags, maxMinute],
  );

  return (
    <section className="ui-card la" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-heading">Alertes en direct</h2>
      <ol className="la-list" aria-live="polite" aria-relevant="additions" aria-label="Alertes, la plus récente en premier">
        {alerts.map((a) => (
          <li key={a.id} className={`la-item${a.team ? ` is-${a.team}` : ""}`}>
            <span className={`la-minute${a.team ? ` is-${a.team}` : ""}`}>{Math.floor(a.seconds / 60)}'</span>
            <span className="la-icon" aria-hidden="true">{a.icon}</span>
            <span className="la-text">
              <span className="la-kind">{a.kind}</span>
              <span className="la-body">{a.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {alerts.length === 0 ? (
        <p className="sl-empty">Aucune alerte pour l'instant — buts, cartons, sprints et changements de leader s'afficheront ici.</p>
      ) : null}
    </section>
  );
}
