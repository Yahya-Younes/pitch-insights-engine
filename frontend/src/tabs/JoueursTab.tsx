import { useId, useRef, useState, type KeyboardEvent } from "react";
import { FcPlayerCard } from "../components/FcPlayerCard";
import { HeadToHead } from "../components/HeadToHead";
import { useMatch } from "../lib/matchContext";
import { usePlayersData } from "../lib/playersApi";
import {
  formatPoints,
  formatRating,
  type AttributeKey,
  type MatchPlayer,
} from "../lib/playersTypes";
import "./JoueursTab.css";

type SortKey = "rating" | Extract<AttributeKey, "pace" | "passing" | "defending" | "involvement">;
type TeamFilter = "all" | "home" | "away";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "rating", label: "Note" },
  { value: "pace", label: "Vitesse" },
  { value: "passing", label: "Passe" },
  { value: "defending", label: "Défense" },
  { value: "involvement", label: "Implication" },
];

/** Scoring rules of the live note /10 -- mirrors the backend's barème. */
const SCALE: { rule: string; points: string }[] = [
  { rule: "But", points: "+1,0 (+0,2 si xG < 0,15)" },
  { rule: "Passe décisive", points: "+0,6" },
  { rule: "Passe clé", points: "+0,15" },
  { rule: "Tir sans but", points: "+0,3 × xG (+0,05 si cadré)" },
  { rule: "xT créé", points: "+0,5 × xT (plafond +0,8)" },
  { rule: "Dribble réussi / raté", points: "+0,05 / −0,03" },
  { rule: "Précision de passe ≥ 85 % (≥ 20 passes)", points: "+0,1" },
  { rule: "Précision de passe < 65 % (≥ 15 passes)", points: "−0,1" },
  { rule: "Perte de balle", points: "−0,03" },
  { rule: "Tacle / interception", points: "+0,06" },
  { rule: "Duel gagné / perdu", points: "±0,03" },
  { rule: "Menace stoppée", points: "+0,5 × xT" },
  { rule: "Arrêt du gardien", points: "+0,15 + 0,1 × xG" },
  { rule: "But encaissé", points: "gardien −0,3 · défenseurs −0,1" },
  { rule: "Faute", points: "−0,05" },
  { rule: "Carton jaune", points: "−0,3" },
  { rule: "Carton rouge", points: "−1,0" },
];

const SCALE_NOTES = [
  "Points défensifs × 1,3 pour les gardiens, défenseurs centraux et latéraux ; points offensifs × 1,2 pour les attaquants.",
  "Données physiques (vitesse, distance) non comptées : elles viennent de positions synthétiques.",
  "Note bornée entre 3 et 10.",
  "Pour prendre le titre d'homme du match, un challenger doit devancer le leader d'au moins 0,1.",
];

/** Accessible radio pills: role=radiogroup, roving tabindex, arrow keys. */
function RadioPills<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const opt = options[next];
    if (opt) {
      onChange(opt.value);
      refs.current[next]?.focus();
    }
  };
  return (
    <div className="jt-pills">
      <span id={labelId} className="jt-pills__label">{label}</span>
      <div role="radiogroup" aria-labelledby={labelId} className="jt-pills__group">
        {options.map((o, i) => {
          const checked = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className={`ui-pill${checked ? " is-active" : ""}`}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function sortValue(p: MatchPlayer, key: SortKey): number {
  if (key === "rating") return p.rating ?? -1;
  return p.attributes?.[key] ?? -1;
}

/** Best player of the other team (live note first, attributes as fallback). */
function bestOpponent(players: MatchPlayer[], of: MatchPlayer | undefined): string | null {
  if (!of) return null;
  const avg = (p: MatchPlayer) =>
    p.attributes ? Object.values(p.attributes).reduce((s, v) => s + v, 0) / 6 : 0;
  const rivals = players
    .filter((p) => p.team !== of.team)
    .sort((x, y) => (y.rating ?? -1) - (x.rating ?? -1) || avg(y) - avg(x));
  return rivals[0]?.id ?? null;
}

function ScaleDisclosure() {
  return (
    <details className="jt-scale">
      <summary className="jt-scale__summary">Voir le barème</summary>
      <table className="jt-scale__table">
        <caption className="ui-sr-only">Barème de la note sur 10</caption>
        <thead>
          <tr><th scope="col">Action</th><th scope="col">Points</th></tr>
        </thead>
        <tbody>
          {SCALE.map((r) => (
            <tr key={r.rule}><th scope="row">{r.rule}</th><td>{r.points}</td></tr>
          ))}
        </tbody>
      </table>
      <ul className="jt-scale__notes">
        {SCALE_NOTES.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </details>
  );
}

export function JoueursTab() {
  const { matchId, homeTeam, awayTeam, openPlayer, followedPlayerId } = useMatch();
  const data = usePlayersData(matchId);
  const [sort, setSort] = useState<SortKey>("rating");
  const [team, setTeam] = useState<TeamFilter>("all");
  const motmTitleId = useId();
  const gridTitleId = useId();

  if (!matchId) {
    return (
      <div className="jt jt--empty ui-card">
        <p>Lance un match pour voir les notes des joueurs.</p>
      </div>
    );
  }

  if (data.status === "loading" || data.status === "idle") {
    return (
      <div className="jt" aria-busy="true">
        <p className="ui-sr-only" role="status">Chargement des notes des joueurs…</p>
        <div className="jt__top">
          <div className="jt-skeleton jt-skeleton--motm" />
          <div className="jt-skeleton jt-skeleton--h2h" />
        </div>
        <div className="jt__grid">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="jt-skeleton jt-skeleton--card" />)}
        </div>
      </div>
    );
  }

  if (data.status === "error") {
    return (
      <div className="jt">
        <div className="ui-card jt-error" role="alert">
          <p>Impossible de charger les notes des joueurs.</p>
          <p className="jt-error__detail">{data.error}</p>
          <button type="button" className="ui-btn" onClick={data.reload}>Réessayer</button>
        </div>
      </div>
    );
  }

  const { players } = data;
  const byId = new Map(players.map((p) => [p.id, p]));
  const teamName = (p: MatchPlayer) => (p.team === "home" ? homeTeam : awayTeam);

  const motmId = data.motm?.player_id ?? data.fallbackMotm?.player_id ?? null;
  const motmPlayer = motmId ? byId.get(motmId) : undefined;
  // Live reason: sentence(s); fallback (/player-ratings) reason: "a, b, c".
  const reasons = (data.motm ? data.motm.reason : (data.fallbackMotm?.reason ?? ""))
    .split(data.motm ? /\s*[;•]\s*|\.\s+/ : /\s*,\s*/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);
  const topItems = motmPlayer
    ? [...motmPlayer.breakdown].filter((b) => b.points > 0).sort((x, y) => y.points - x.points).slice(0, 3)
    : [];

  const visible = players
    .filter((p) => team === "all" || p.team === team)
    .sort((x, y) => sortValue(y, sort) - sortValue(x, sort) || x.name.localeCompare(y.name, "fr"));

  return (
    <div className="jt">
      {!data.liveAvailable && (
        <p className="jt-banner" role="status">
          Notes en direct indisponibles pour l'instant — fiches affichées avec « note indisponible ».
        </p>
      )}
      {data.liveAvailable && data.attrsError && (
        <p className="jt-banner" role="status">Attributs (radar, PAC/TIR/…) indisponibles pour l'instant.</p>
      )}

      <div className="jt__top">
        <section className="jt-motm ui-card" aria-labelledby={motmTitleId}>
          <h2 id={motmTitleId} className="ui-heading jt-motm__title">
            Homme du match
            {data.minute !== null && <span className="jt-motm__minute"> · à la {data.minute}'</span>}
          </h2>
          {motmPlayer ? (
            <div className="jt-motm__body">
              <FcPlayerCard
                player={motmPlayer}
                motm
                teamName={teamName(motmPlayer)}
                followed={followedPlayerId === motmPlayer.id}
                onSelect={openPlayer}
              />
              <div className="jt-motm__why">
                <h3 className="jt-motm__why-title">Pourquoi lui ?</h3>
                <ul className="jt-motm__reasons">
                  {reasons.map((r) => <li key={r}>{r}</li>)}
                  {topItems.map((b) => (
                    <li key={b.label}>
                      {b.label}{b.count > 1 ? ` ×${b.count}` : ""}{" "}
                      <span className="jt-motm__pts">{formatPoints(b.points)}</span>
                    </li>
                  ))}
                  {!reasons.length && !topItems.length && <li>Détail du calcul en attente.</li>}
                </ul>
                {data.motm ? (
                  <p className="jt-motm__leader">
                    <span aria-hidden="true">★ </span>Leader depuis la {data.motm.leader_since_minute}'
                    {" "}— note {formatRating(data.motm.rating)}
                  </p>
                ) : (
                  <p className="jt-motm__leader jt-motm__leader--muted">
                    Sélection provisoire d'après les attributs du match — note indisponible.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="jt-muted">Pas encore d'homme du match : le match vient de commencer.</p>
          )}
          <p className="jt-motm__foot">
            Note /10 recalculée chaque minute (base 6,0) — barème transparent.
          </p>
          <ScaleDisclosure />
        </section>

        <HeadToHead
          players={players}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          defaultA={motmPlayer?.id ?? null}
          defaultB={bestOpponent(players, motmPlayer)}
        />
      </div>

      <section className="jt-ratings" aria-labelledby={gridTitleId}>
        <div className="jt-ratings__head">
          <h2 id={gridTitleId} className="ui-heading">Notes du match</h2>
          <div className="jt-ratings__controls">
            <RadioPills label="Trier par" options={SORTS} value={sort} onChange={setSort} />
            <RadioPills<TeamFilter>
              label="Équipe"
              options={[
                { value: "all", label: "Tous" },
                { value: "home", label: homeTeam },
                { value: "away", label: awayTeam },
              ]}
              value={team}
              onChange={setTeam}
            />
          </div>
        </div>
        {visible.length ? (
          <ul className="jt__grid" aria-label={`${visible.length} joueurs`}>
            {visible.map((p, i) => (
              <li key={p.id} className="jt__grid-item">
                <FcPlayerCard
                  player={p}
                  motm={p.id === motmId}
                  teamName={teamName(p)}
                  followed={followedPlayerId === p.id}
                  onSelect={openPlayer}
                  enterDelayMs={Math.min(i, 12) * 30}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="jt-muted">Aucun joueur à afficher.</p>
        )}
      </section>
    </div>
  );
}
