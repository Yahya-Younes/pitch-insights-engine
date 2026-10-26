import { useEffect, useState } from "react";
import { fetchPlayerHeatmap } from "../lib/playersApi";
import type { PlayerHeatmapResponse } from "../lib/playersTypes";
import "./PlayerHeatmap.css";

interface PlayerHeatmapProps {
  matchId: string;
  playerId: string;
  playerName?: string;
  cols?: number;
  rows?: number;
}

type HeatState =
  | { key: string; status: "ready"; data: PlayerHeatmapResponse }
  | { key: string; status: "error"; error: string };

const W = 120;
const H = 80;

/** Plain-language summary of the busiest cell, relative to the attack direction. */
function describePeak(data: PlayerHeatmapResponse): string | null {
  let best = -1;
  let br = 0;
  let bc = 0;
  data.cells.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v > best) {
        best = v;
        br = r;
        bc = c;
      }
    }),
  );
  if (best <= 0) return null;
  const { cols, rows } = data.grid;
  const ltr = data.attack_direction !== "right_to_left";
  const xFrac = (bc + 0.5) / cols;
  const yFrac = (br + 0.5) / rows;
  const forward = ltr ? xFrac : 1 - xFrac;
  const left = ltr ? yFrac : 1 - yFrac;
  const third = forward < 1 / 3 ? "tiers défensif" : forward < 2 / 3 ? "milieu de terrain" : "tiers offensif";
  const lane = left < 1 / 3 ? "côté gauche" : left < 2 / 3 ? "axe" : "côté droit";
  return `${third}, ${lane}`;
}

/** Mini pitch with a player's occupancy grid and the attack direction. */
export function PlayerHeatmap({ matchId, playerId, playerName, cols = 12, rows = 8 }: PlayerHeatmapProps) {
  const key = `${matchId}:${playerId}:${cols}x${rows}`;
  const [state, setState] = useState<HeatState | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchPlayerHeatmap(matchId, playerId, cols, rows).then(
      (data) => { if (!cancelled) setState({ key, status: "ready", data }); },
      (err: unknown) => {
        if (!cancelled) setState({ key, status: "error", error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => { cancelled = true; };
  }, [key, matchId, playerId, cols, rows, retry]);

  const current = state?.key === key ? state : null;

  if (!current) {
    return (
      <div className="ph-heatmap ph-heatmap--loading" aria-busy="true">
        <div className="ph-heatmap__pitch-skeleton" />
        <p className="ph-heatmap__caption">Chargement de la carte de chaleur…</p>
      </div>
    );
  }
  if (current.status === "error") {
    const notFound = current.error.startsWith("404");
    return (
      <div className="ph-heatmap" role={notFound ? undefined : "alert"}>
        <p className="ph-heatmap__caption">
          {notFound ? "Pas encore de données de position pour ce joueur." : "Carte de chaleur indisponible."}
        </p>
        {!notFound && (
          <button type="button" className="ui-btn" onClick={() => setRetry((n) => n + 1)}>Réessayer</button>
        )}
      </div>
    );
  }

  const { data } = current;
  const cw = W / Math.max(1, data.grid.cols);
  const ch = H / Math.max(1, data.grid.rows);
  const ltr = data.attack_direction !== "right_to_left";
  const peak = describePeak(data);
  const empty = peak === null;
  const label = empty
    ? `Carte de chaleur${playerName ? ` de ${playerName}` : ""} : aucune présence enregistrée.`
    : `Carte de chaleur${playerName ? ` de ${playerName}` : ""} : zone la plus fréquentée ${peak}. ` +
      `Attaque vers la ${ltr ? "droite" : "gauche"}. ${data.touches} ballons touchés.`;

  return (
    <figure className="ph-heatmap">
      <svg className="ph-heatmap__svg" viewBox={`-2 -2 ${W + 4} ${H + 14}`} role="img" aria-label={label}>
        <rect className="ph-heatmap__grass" x={0} y={0} width={W} height={H} />
        {data.cells.map((row, r) =>
          row.map((v, c) =>
            v > 0 ? (
              <rect
                key={`${r}-${c}`}
                className="ph-heatmap__cell"
                x={c * cw}
                y={r * ch}
                width={cw}
                height={ch}
                fillOpacity={Math.min(0.9, 0.1 + v * 0.8)}
              />
            ) : null,
          ),
        )}
        <g className="ph-heatmap__lines" aria-hidden="true">
          <rect x={0} y={0} width={W} height={H} />
          <line x1={W / 2} y1={0} x2={W / 2} y2={H} />
          <circle cx={W / 2} cy={H / 2} r={10} />
          <rect x={0} y={18} width={18} height={44} />
          <rect x={W - 18} y={18} width={18} height={44} />
          <rect x={0} y={30} width={6} height={20} />
          <rect x={W - 6} y={30} width={6} height={20} />
        </g>
        <g className="ph-heatmap__arrow" aria-hidden="true" transform={ltr ? undefined : `rotate(180 ${W / 2} ${H + 7})`}>
          <line x1={W / 2 - 14} y1={H + 7} x2={W / 2 + 12} y2={H + 7} />
          <path d={`M ${W / 2 + 14} ${H + 7} l -5 -3 v 6 z`} />
        </g>
      </svg>
      <figcaption className="ph-heatmap__caption">
        {empty ? "Aucune présence enregistrée pour l'instant." : (
          <>
            Sens d'attaque {ltr ? "→" : "←"} · {data.touches} ballons touchés ·{" "}
            {data.source === "positions" ? "positions synthétiques" : "positions des actions"}
          </>
        )}
      </figcaption>
    </figure>
  );
}
