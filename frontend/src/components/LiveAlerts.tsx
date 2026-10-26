import { useId, useMemo } from "react";
import { useT, type I18n } from "../i18n";
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

/** Icon per insight type; the label is "suivi.alert.kind.<type>". */
const INSIGHT_ICON: Record<string, string> = {
  milestone: "⚽",
  referee_decision: "🟨",
  tendency_break: "❗",
  tendency_match: "🎯",
  pressure_spike: "🔥",
  xt_surge: "📈",
  chaos_shift: "⚡",
  rhythm_change: "🎵",
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

function buildAlerts(i18n: I18n, renderEvents: RenderPayload[], ratings: LiveRatingsResponse | null,
  tags: PlayerTagsResponse | null, maxMinute: number | null): Alert[] {
  const { t } = i18n;
  const limitS = maxMinute === null ? Infinity : (maxMinute + 1) * 60;
  const out: Alert[] = [];

  for (const ev of renderEvents) {
    const known = Object.hasOwn(INSIGHT_ICON, ev.graphic_type);
    const seconds = clockToSeconds(ev.game_clock);
    out.push({
      id: `ev-${ev.render_id}`,
      seconds,
      team: sideOf(ev.linked_players[0]),
      icon: INSIGHT_ICON[ev.graphic_type] ?? "◆",
      kind: t(known ? `suivi.alert.kind.${ev.graphic_type}` : "suivi.alert.kind.other"),
      text: truncate(ev.narrative_text, 140),
    });
  }

  if (tags) {
    const names = new Map(tags.players.map((p) => [p.player_id, p.name]));
    const speedTags = tags.tags
      .filter((tag) => (tag.kind === "sprint" || tag.kind === "top_speed") && tag.t_ms / 1000 < limitS)
      .slice(-MAX_TAG_ALERTS);
    for (const tag of speedTags) {
      const name = shortName(names.get(tag.player_id) ?? tag.player_id);
      const speed = i18n.num(tag.value, 1);
      const top = tag.kind === "top_speed";
      out.push({
        id: `tag-${tag.kind}-${tag.player_id}-${tag.t_ms}`,
        seconds: tag.t_ms / 1000,
        team: sideOf(tag.player_id),
        icon: top ? "🚀" : "💨",
        kind: t(top ? "suivi.alert.topSpeed" : "suivi.alert.sprint"),
        text: t("suivi.alert.speedText", { number: shirtNumber(tag.player_id), name, speed }),
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
        kind: t("suivi.alert.motm"),
        text: t(i === 0 ? "suivi.alert.firstLeader" : "suivi.alert.newLeader", { player: label }),
      });
    });
  }

  return out
    .filter((a) => a.seconds < limitS)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MAX_ALERTS);
}

export function LiveAlerts({ renderEvents, ratings, tags, maxMinute }: Props) {
  const i18n = useT();
  const { t } = i18n;
  const headingId = useId();
  const alerts = useMemo(
    () => buildAlerts(i18n, renderEvents, ratings, tags, maxMinute),
    [i18n, renderEvents, ratings, tags, maxMinute],
  );

  return (
    <section className="ui-card la" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-heading">{t("suivi.alert.title")}</h2>
      <ol className="la-list" aria-live="polite" aria-relevant="additions" aria-label={t("suivi.alert.listAria")}>
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
        <p className="sl-empty">{t("suivi.alert.empty")}</p>
      ) : null}
    </section>
  );
}
