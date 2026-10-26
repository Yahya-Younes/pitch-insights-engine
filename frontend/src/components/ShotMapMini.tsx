import { useId } from "react";
import { formatDec2 } from "../lib/liveApi";
import type { Shot, ShotMapResponse } from "../lib/matchMapsTypes";
import "./ShotMapMini.css";

// StatsBomb pitch units (same as MatchMaps): home attacks right, away attacks left.
const W = 120;
const H = 80;

const OUTCOME: Record<Shot["outcome"], string> = {
  goal: "but",
  saved: "arrêté",
  blocked: "contré",
  off_target: "non cadré",
};

interface Props {
  data: ShotMapResponse | null;
  error: string | null;
  homeTeam: string;
  awayTeam: string;
  /** Hide shots after this minute (null = all). */
  maxMinute: number | null;
}

export function ShotMapMini({ data, error, homeTeam, awayTeam, maxMinute }: Props) {
  const headingId = useId();

  let body;
  if (data) {
    const shots = data.shots
      .filter((s) => maxMinute === null || s.minute <= maxMinute)
      // Goals last so their rings sit on top.
      .sort((a, b) => Number(a.outcome === "goal") - Number(b.outcome === "goal"));
    const sum = (team: "home" | "away") => {
      const own = shots.filter((s) => s.team === team);
      return {
        n: own.length,
        xg: own.reduce((acc, s) => acc + s.xg, 0),
        goals: own.filter((s) => s.outcome === "goal").length,
      };
    };
    const home = sum("home");
    const away = sum("away");
    const label =
      `Carte des tirs. ${homeTeam} (attaque à droite) : ${home.n} tirs, ${formatDec2(home.xg)} xG, ${home.goals} but(s). ` +
      `${awayTeam} (attaque à gauche) : ${away.n} tirs, ${formatDec2(away.xg)} xG, ${away.goals} but(s).`;
    body = (
      <>
        <svg className="smm-pitch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
          <rect x={0} y={0} width={W} height={H} className="smm-grass" />
          <g className="smm-line" aria-hidden="true">
            <rect x={0.5} y={0.5} width={W - 1} height={H - 1} />
            <line x1={W / 2} y1={0} x2={W / 2} y2={H} />
            <circle cx={W / 2} cy={H / 2} r={9} />
            <rect x={0.5} y={18} width={17.5} height={44} />
            <rect x={W - 18} y={18} width={17.5} height={44} />
            <rect x={0.5} y={30} width={5.5} height={20} />
            <rect x={W - 6} y={30} width={5.5} height={20} />
          </g>
          {shots.map((s) => {
            const [x, y] = s.location;
            const r = 0.9 + Math.sqrt(Math.max(0, s.xg)) * 4.5;
            const goal = s.outcome === "goal";
            return (
              <g key={s.event_id}>
                {goal ? <circle cx={x} cy={y} r={r + 1.1} className="smm-goal-ring" /> : null}
                <circle cx={x} cy={y} r={r} className={`smm-shot is-${s.team}${goal ? " is-goal" : ""}`}>
                  <title>{`${s.player_name} · ${s.minute}' · ${OUTCOME[s.outcome]} · xG ${formatDec2(s.xg)}`}</title>
                </circle>
              </g>
            );
          })}
        </svg>
        <div className="smm-totals" aria-hidden="true">
          <span className="smm-total is-home">{home.n} tirs · {formatDec2(home.xg)} xG</span>
          <span className="smm-legend">taille = xG · anneau = but</span>
          <span className="smm-total is-away">{away.n} tirs · {formatDec2(away.xg)} xG</span>
        </div>
        {error ? <p className="sl-stale" role="alert">Mise à jour impossible : {error}</p> : null}
      </>
    );
  } else if (error) {
    body = <p className="sl-error" role="alert">Carte des tirs indisponible : {error}</p>;
  } else {
    body = <div className="sl-skeleton smm-skeleton" aria-busy="true" aria-label="Chargement de la carte des tirs" />;
  }

  return (
    <section className="ui-card smm" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-heading">Carte des tirs</h2>
      {body}
    </section>
  );
}
