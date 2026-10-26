import { shirtNumber, shortName } from "../lib/matchContext";
import type { RosterPlayer, RosterStatus, Side } from "../lib/momentumApi";

interface Props {
  players: RosterPlayer[];
  status: RosterStatus;
  homeTeam: string;
  awayTeam: string;
  followedPlayerId: string | null;
  onToggleFollow: (playerId: string) => void;
}

const POSITION_ORDER: Record<string, number> = { GK: 0, CB: 1, FB: 2, CM: 3, WM: 4, FW: 5 };

function sortKey(p: RosterPlayer): [number, number] {
  const pos = p.position ? (POSITION_ORDER[p.position] ?? 6) : 6;
  const num = Number(shirtNumber(p.playerId));
  return [pos, Number.isFinite(num) ? num : 99];
}

function bySortKey(a: RosterPlayer, b: RosterPlayer): number {
  const [pa, na] = sortKey(a);
  const [pb, nb] = sortKey(b);
  return pa - pb || na - nb;
}

/** Two team columns of [number + "R. Donnelly"] chips; clicking one follows that player. */
export function LineupChips({ players, status, homeTeam, awayTeam, followedPlayerId, onToggleFollow }: Props) {
  if (status === "loading" && players.length === 0) {
    return <p className="lv-muted lv-lineup-state" role="status">Chargement des compositions…</p>;
  }
  if (players.length === 0) {
    return (
      <p className="lv-muted lv-lineup-state">
        {status === "error" ? "Compositions indisponibles pour ce match." : "Aucune composition pour l'instant."}
      </p>
    );
  }

  const column = (side: Side, teamName: string) => {
    const list = players.filter((p) => p.team === side).sort(bySortKey);
    return (
      <div className={`lv-lineup-col is-${side}`} role="group" aria-label={`Composition ${teamName}`}>
        <h3 className="lv-lineup-team">{teamName}</h3>
        <ul className="lv-lineup-list">
          {list.map((p) => {
            const followed = p.playerId === followedPlayerId;
            const num = shirtNumber(p.playerId);
            return (
              <li key={p.playerId}>
                <button
                  type="button"
                  className={`lv-chip${followed ? " is-followed" : ""}`}
                  aria-pressed={followed}
                  aria-label={`#${num} ${p.name}${p.position ? `, ${p.position}` : ""} — ${followed ? "ne plus suivre" : "suivre"}`}
                  onClick={() => onToggleFollow(p.playerId)}
                >
                  <span className="lv-chip-num" aria-hidden="true">{num}</span>
                  <span className="lv-chip-name" aria-hidden="true">{shortName(p.name)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className="lv-lineup">
      {column("home", homeTeam)}
      {column("away", awayTeam)}
    </div>
  );
}
