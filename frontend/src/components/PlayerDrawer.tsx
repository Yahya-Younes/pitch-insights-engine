import { useEffect, useId, useState } from "react";
import { FcPlayerCard } from "./FcPlayerCard";
import { HexRadar, type RadarSeries } from "./HexRadar";
import { PlayerHeatmap } from "./PlayerHeatmap";
import { shirtNumber, useMatch } from "../lib/matchContext";
import { usePlayersData } from "../lib/playersApi";
import { fetchPlayerTags, type PlayerPhysical } from "../lib/playerTagsApi";
import {
  formatNumber,
  formatPoints,
  formatRating,
  positionLabel,
  type MatchPlayer,
  type RatingPoint,
} from "../lib/playersTypes";
import type { RenderPayload } from "../lib/types";
import "./PlayerDrawer.css";

interface PlayerDrawerProps {
  playerId: string;
  onClose: () => void;
}

type PhysicalState = { matchId: string; players: PlayerPhysical[] | null };

/** Render events that mention the player (linked_players, or related_players if present). */
function mentions(ev: RenderPayload, playerId: string): boolean {
  if (ev.linked_players.includes(playerId)) return true;
  if ("related_players" in ev) {
    const rel: unknown = ev.related_players;
    return Array.isArray(rel) && rel.includes(playerId);
  }
  return false;
}

const SPARK_W = 320;
const SPARK_H = 96;
const PAD_X = 6;
const PAD_Y = 10;

function RatingSparkline({
  series, leaderSince, currentMinute, name,
}: {
  series: RatingPoint[]; leaderSince: number | null; currentMinute: number | null; name: string;
}) {
  if (series.length < 2) {
    return <p className="pd-muted">Évolution disponible après quelques minutes de jeu.</p>;
  }
  const ratings = series.map((p) => p.rating);
  const lo = Math.max(3, Math.min(6, ...ratings) - 0.4);
  const hi = Math.min(10, Math.max(6, ...ratings) + 0.4);
  const last = series[series.length - 1];
  const first = series[0];
  const xMax = Math.max(90, currentMinute ?? 0, last?.minute ?? 0);
  const x = (m: number) => PAD_X + (m / xMax) * (SPARK_W - 2 * PAD_X);
  const y = (r: number) => PAD_Y + (1 - (r - lo) / Math.max(0.1, hi - lo)) * (SPARK_H - 2 * PAD_Y);
  const path = series.map((p, i) => `${i ? "L" : "M"}${x(p.minute).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ");
  const area = `${path} L${x(last?.minute ?? 0).toFixed(1)},${SPARK_H - PAD_Y} L${x(first?.minute ?? 0).toFixed(1)},${SPARK_H - PAD_Y} Z`;
  const leaderEnd = currentMinute ?? last?.minute ?? 0;

  const minR = Math.min(...ratings);
  const maxR = Math.max(...ratings);
  const label =
    `Évolution de la note de ${name} : ${formatRating(first?.rating ?? 0)} à la ${first?.minute ?? 0}', ` +
    `${formatRating(last?.rating ?? 0)} à la ${last?.minute ?? 0}' (minimum ${formatRating(minR)}, maximum ${formatRating(maxR)}).` +
    (leaderSince !== null ? ` Homme du match depuis la ${leaderSince}'.` : "");

  return (
    <figure className="pd-spark">
      <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className="pd-spark__svg" role="img" aria-label={label}>
        {leaderSince !== null && (
          <g className="pd-spark__leader">
            <rect x={x(leaderSince)} y={0} width={Math.max(2, x(leaderEnd) - x(leaderSince))} height={SPARK_H} />
            <text x={x(leaderSince) + 4} y={11}>★ Leader</text>
          </g>
        )}
        <line className="pd-spark__base" x1={0} x2={SPARK_W} y1={y(6)} y2={y(6)} />
        <text className="pd-spark__base-label" x={SPARK_W - 2} y={y(6) - 3} textAnchor="end">6,0</text>
        <path className="pd-spark__area" d={area} />
        <path className="pd-spark__line" d={path} />
        {last && <circle className="pd-spark__dot" cx={x(last.minute)} cy={y(last.rating)} r={3.5} />}
      </svg>
      <figcaption className="pd-spark__caption">
        <span>{first?.minute ?? 0}'</span>
        <span>{last?.minute ?? 0}'</span>
      </figcaption>
    </figure>
  );
}

function BreakdownTable({ player }: { player: MatchPlayer }) {
  if (player.rating === null) {
    return <p className="pd-muted">Note indisponible — le détail du calcul apparaîtra avec les notes en direct.</p>;
  }
  const rows = [...player.breakdown].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return (
    <table className="pd-table">
      <caption className="ui-sr-only">Détail du calcul de la note de {player.name}</caption>
      <thead>
        <tr><th scope="col">Action</th><th scope="col">Nb</th><th scope="col">Points</th></tr>
      </thead>
      <tbody>
        <tr className="pd-table__base"><th scope="row">Base</th><td>—</td><td>6,0</td></tr>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td>{r.count}</td>
            <td className={r.points < 0 ? "is-neg" : r.points > 0 ? "is-pos" : undefined}>{formatPoints(r.points)}</td>
          </tr>
        ))}
        {!rows.length && (
          <tr><td colSpan={3} className="pd-muted">Aucune action notée pour l'instant.</td></tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Note (bornée 3–10)</th>
          <td />
          <td>{formatRating(player.rating)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** Content of the player drawer (the shell renders the drawer chrome). */
export function PlayerDrawer({ playerId, onClose }: PlayerDrawerProps) {
  const { matchId, homeTeam, awayTeam, renderEvents, followedPlayerId, setFollowedPlayerId } = useMatch();
  const data = usePlayersData(matchId);
  const [compareId, setCompareId] = useState<string>("");
  const [physical, setPhysical] = useState<PhysicalState | null>(null);
  const titleId = useId();
  const compareSelectId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    fetchPlayerTags(matchId).then(
      (r) => { if (!cancelled) setPhysical({ matchId, players: r.players }); },
      () => { if (!cancelled) setPhysical({ matchId, players: null }); },
    );
    return () => { cancelled = true; };
  }, [matchId]);

  const player = data.players.find((p) => p.id === playerId);
  const teamName = player ? (player.team === "home" ? homeTeam : awayTeam) : "";
  const isFollowed = followedPlayerId === playerId;
  const isMotm = data.motm?.player_id === playerId;
  const compare = compareId && compareId !== playerId ? data.players.find((p) => p.id === compareId) : undefined;
  const phys = physical?.matchId === matchId ? physical.players?.find((p) => p.player_id === playerId) : undefined;
  const moments = renderEvents.filter((ev) => mentions(ev, playerId));

  const header = (
    <header className="pd-header">
      <div className="pd-header__id">
        <span className={`pd-header__num pd-header__num--${player?.team ?? "home"}`} aria-hidden="true">
          {player?.number ?? shirtNumber(playerId)}
        </span>
        <div>
          <h2 id={titleId} className="pd-header__name">{player?.name ?? playerId}</h2>
          <p className="pd-header__meta">
            <span className="ui-sr-only">Numéro {player?.number ?? shirtNumber(playerId)}, </span>
            {player ? `${teamName} · ${positionLabel(player.position)}` : "Fiche joueur"}
          </p>
        </div>
      </div>
      <button type="button" className="ui-btn pd-header__close" onClick={onClose}>
        <span aria-hidden="true">✕ </span>Fermer (Échap)
      </button>
    </header>
  );

  if (!matchId) {
    return <div className="pd">{header}<p className="pd-muted">Aucun match en cours.</p></div>;
  }
  if (data.status === "loading" || data.status === "idle") {
    return (
      <div className="pd" aria-busy="true">
        {header}
        <p className="pd-muted" role="status">Chargement de la fiche…</p>
      </div>
    );
  }
  if (data.status === "error") {
    return (
      <div className="pd">
        {header}
        <div role="alert" className="pd-error">
          <p>Impossible de charger la fiche du joueur.</p>
          <button type="button" className="ui-btn" onClick={data.reload}>Réessayer</button>
        </div>
      </div>
    );
  }
  if (!player) {
    return <div className="pd">{header}<p className="pd-muted">Joueur introuvable dans ce match.</p></div>;
  }

  const series: RadarSeries[] = [];
  if (player.attributes) series.push({ id: player.id, name: player.name, values: player.attributes, tone: player.team });
  if (compare?.attributes) {
    series.push({
      id: compare.id, name: compare.name, values: compare.attributes,
      tone: compare.team === player.team ? "gold" : compare.team,
    });
  }

  const raw = player.raw;
  const topSpeed = phys?.top_speed_kmh ?? raw?.top_speed_kmh ?? null;
  const sprints = phys?.sprints ?? raw?.sprints ?? null;
  const chips: { label: string; value: string }[] = raw
    ? [
        {
          label: "Passes réussies",
          value: raw.passes_attempted ? `${formatNumber(raw.pass_pct, 0)} % (${raw.passes_completed}/${raw.passes_attempted})` : "—",
        },
        { label: "xG", value: formatNumber(raw.xg, 2) },
        { label: "xT créé", value: formatNumber(raw.xt_added, 2) },
        { label: "Vitesse max", value: topSpeed !== null ? `${formatNumber(topSpeed, 1)} km/h` : "—" },
        { label: "Sprints", value: sprints !== null ? String(sprints) : "—" },
        { label: "Ballons gagnés", value: String(raw.ball_wins) },
      ]
    : [];

  const playersByTeam: [string, MatchPlayer[]][] = [
    [homeTeam, data.players.filter((p) => p.team === "home" && p.id !== playerId)],
    [awayTeam, data.players.filter((p) => p.team === "away" && p.id !== playerId)],
  ];

  return (
    <div className="pd">
      {header}

      {!data.liveAvailable && (
        <p className="pd-banner" role="status">Note en direct indisponible pour l'instant.</p>
      )}

      <div className="pd-hero">
        <FcPlayerCard player={player} motm={isMotm} compact teamName={teamName} followed={isFollowed} />
        <div className="pd-hero__radar">
          {series.length ? <HexRadar series={series} size={230} /> : <p className="pd-muted">Attributs indisponibles.</p>}
        </div>
      </div>

      <div className="pd-actions">
        <div className="pd-compare">
          <label htmlFor={compareSelectId} className="pd-label">Comparer avec</label>
          <select
            id={compareSelectId}
            className="pd-select"
            value={compare ? compare.id : ""}
            onChange={(e) => setCompareId(e.target.value)}
          >
            <option value="">— Personne —</option>
            {playersByTeam.map(([team, list]) =>
              list.length ? (
                <optgroup key={team} label={team}>
                  {list.map((p) => (
                    <option key={p.id} value={p.id}>#{p.number} {p.name}</option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
        </div>
        <button
          type="button"
          className={`ui-btn pd-follow${isFollowed ? " ui-btn-primary is-on" : ""}`}
          aria-pressed={isFollowed}
          onClick={() => setFollowedPlayerId(isFollowed ? null : playerId)}
        >
          <span aria-hidden="true">{isFollowed ? "◉ " : "○ "}</span>
          {isFollowed ? "Joueur suivi" : "Suivre ce joueur"}
        </button>
      </div>

      <section className="pd-section" aria-labelledby={`${titleId}-evo`}>
        <h3 id={`${titleId}-evo`} className="pd-section__title">
          Évolution de la note
          {player.delta10 !== null && (
            <span className={`pd-delta ${player.delta10 >= 0 ? "is-pos" : "is-neg"}`}>
              {formatPoints(player.delta10)} sur 10 min
            </span>
          )}
        </h3>
        {player.rating === null ? (
          <p className="pd-muted">Note indisponible.</p>
        ) : (
          <RatingSparkline
            series={player.series}
            leaderSince={isMotm ? (data.motm?.leader_since_minute ?? null) : null}
            currentMinute={data.minute}
            name={player.name}
          />
        )}
      </section>

      <section className="pd-section" aria-labelledby={`${titleId}-calc`}>
        <h3 id={`${titleId}-calc`} className="pd-section__title">Détail du calcul</h3>
        <BreakdownTable player={player} />
      </section>

      <section className="pd-section" aria-labelledby={`${titleId}-heat`}>
        <h3 id={`${titleId}-heat`} className="pd-section__title">Carte de chaleur</h3>
        <PlayerHeatmap matchId={matchId} playerId={playerId} playerName={player.name} />
      </section>

      <section className="pd-section" aria-labelledby={`${titleId}-stats`}>
        <h3 id={`${titleId}-stats`} className="pd-section__title">Stats clés</h3>
        {chips.length ? (
          <ul className="pd-chips">
            {chips.map((c) => (
              <li key={c.label} className="pd-chip">
                <span className="pd-chip__value">{c.value}</span>
                <span className="pd-chip__label">{c.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pd-muted">Statistiques indisponibles.</p>
        )}
        <p className="pd-note">
          Vitesse/distance issues de positions synthétiques — non comptées dans la note.
        </p>
      </section>

      <section className="pd-section" aria-labelledby={`${titleId}-moments`}>
        <h3 id={`${titleId}-moments`} className="pd-section__title">Moments clés</h3>
        {moments.length ? (
          <ol className="pd-moments">
            {moments.map((ev) => (
              <li key={ev.render_id} className="pd-moment">
                <span className="pd-moment__clock">{ev.game_clock}</span>
                <span className="pd-moment__text">{ev.narrative_text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="pd-muted">Aucun moment clé impliquant ce joueur pour l'instant.</p>
        )}
      </section>
    </div>
  );
}
