import { useId, useState, type CSSProperties } from "react";
import { HexRadar, type RadarSeries } from "./HexRadar";
import { useT } from "../i18n";
import {
  ATTRIBUTE_ORDER,
  attributeLabel,
  formatRating,
  cardName,
  type MatchPlayer,
} from "../lib/playersTypes";
import "./HeadToHead.css";

interface HeadToHeadProps {
  players: MatchPlayer[];
  homeTeam: string;
  awayTeam: string;
  defaultA: string | null;
  defaultB: string | null;
}

type Tone = RadarSeries["tone"];

interface DuelRow {
  key: string;
  label: string;
  a: number;
  b: number;
  max: number;
  text: (v: number) => string;
}

/** Native <select> of every player, grouped by team. */
function PlayerSelect({
  id, label, value, players, homeTeam, awayTeam, onChange,
}: {
  id: string; label: string; value: string; players: MatchPlayer[];
  homeTeam: string; awayTeam: string; onChange: (id: string) => void;
}) {
  const i18n = useT();
  const groups: [string, MatchPlayer[]][] = [
    [homeTeam, players.filter((p) => p.team === "home")],
    [awayTeam, players.filter((p) => p.team === "away")],
  ];
  return (
    <div className="h2h__picker">
      <label htmlFor={id} className="h2h__picker-label">{label}</label>
      <select id={id} className="h2h__select" value={value} onChange={(e) => onChange(e.target.value)}>
        {groups.map(([team, list]) =>
          list.length ? (
            <optgroup key={team} label={team}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.number} {p.name}
                  {p.rating !== null ? ` — ${formatRating(i18n, p.rating)}` : ""}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
    </div>
  );
}

/** Two players face to face: overlaid hexagon radar + six duel bars. */
export function HeadToHead({ players, homeTeam, awayTeam, defaultA, defaultB }: HeadToHeadProps) {
  const baseId = useId();
  const i18n = useT();
  const { t } = i18n;
  const [pickA, setPickA] = useState<string | null>(null);
  const [pickB, setPickB] = useState<string | null>(null);

  const byId = new Map(players.map((p) => [p.id, p]));
  const fallbackA = players[0]?.id ?? null;
  const fallbackB = players.find((p) => p.team !== byId.get(defaultA ?? fallbackA ?? "")?.team)?.id ?? players[1]?.id ?? null;
  const idA = (pickA && byId.has(pickA) ? pickA : null) ?? (defaultA && byId.has(defaultA) ? defaultA : fallbackA);
  const idB = (pickB && byId.has(pickB) ? pickB : null) ?? (defaultB && byId.has(defaultB) ? defaultB : fallbackB);
  const a = idA ? byId.get(idA) : undefined;
  const b = idB ? byId.get(idB) : undefined;

  if (players.length < 2 || !a || !b) {
    return (
      <section className="h2h ui-card" aria-labelledby={`${baseId}-title`}>
        <h3 id={`${baseId}-title`} className="ui-heading h2h__title">{t("players.h2h.title")}</h3>
        <p className="h2h__empty">{t("players.h2h.notEnough")}</p>
      </section>
    );
  }

  const toneA: Tone = a.team;
  const toneB: Tone = b.team === a.team ? "gold" : b.team;

  const rows: DuelRow[] = [];
  if (a.rating !== null && b.rating !== null) {
    rows.push({
      key: "rating", label: t("players.h2h.rating"), a: a.rating, b: b.rating, max: 10,
      text: (v) => formatRating(i18n, v),
    });
  }
  if (a.attributes && b.attributes) {
    for (const k of ATTRIBUTE_ORDER) {
      rows.push({ key: k, label: attributeLabel(i18n, k), a: a.attributes[k], b: b.attributes[k], max: 99, text: String });
    }
  }

  const series: RadarSeries[] = [];
  if (a.attributes) series.push({ id: a.id, name: a.name, values: a.attributes, tone: toneA });
  if (b.attributes && b.id !== a.id) series.push({ id: b.id, name: b.name, values: b.attributes, tone: toneB });

  const style = {
    "--h2h-a": `var(--h2h-tone-${toneA})`,
    "--h2h-b": `var(--h2h-tone-${toneB})`,
  } as CSSProperties;

  return (
    <section className="h2h ui-card" aria-labelledby={`${baseId}-title`} style={style}>
      <h3 id={`${baseId}-title`} className="ui-heading h2h__title">{t("players.h2h.title")}</h3>
      <div className="h2h__pickers">
        <PlayerSelect
          id={`${baseId}-a`} label={t("players.h2h.playerA")} value={a.id} players={players}
          homeTeam={homeTeam} awayTeam={awayTeam} onChange={setPickA}
        />
        <span className="h2h__vs" aria-hidden="true">VS</span>
        <PlayerSelect
          id={`${baseId}-b`} label={t("players.h2h.playerB")} value={b.id} players={players}
          homeTeam={homeTeam} awayTeam={awayTeam} onChange={setPickB}
        />
      </div>

      <div className="h2h__body">
        <div className="h2h__radar">
          {series.length ? (
            <HexRadar series={series} size={240} />
          ) : (
            <p className="h2h__empty">{t("players.attrsUnavailable")}</p>
          )}
          <div className="h2h__legend" aria-hidden="true">
            <span className="h2h__legend-item h2h__legend-item--a">{cardName(a.name)}</span>
            <span className="h2h__legend-item h2h__legend-item--b">{cardName(b.name)}</span>
          </div>
        </div>

        {rows.length ? (
          <ul className="h2h__duels">
            {rows.map((r) => {
              const winner = r.a === r.b ? "tie" : r.a > r.b ? "a" : "b";
              const sr = `${t("players.h2h.row", { label: r.label, a: a.name, va: r.text(r.a), b: b.name, vb: r.text(r.b) })}, ` +
                (winner === "tie" ? t("players.h2h.tie") : t("players.h2h.advantage", { name: winner === "a" ? a.name : b.name }));
              return (
                <li key={r.key} className={`h2h__duel h2h__duel--${winner}`}>
                  <span className="ui-sr-only">{sr}</span>
                  <span className="h2h__val h2h__val--a" aria-hidden="true">{r.text(r.a)}</span>
                  <span className="h2h__bars" aria-hidden="true">
                    <span className="h2h__track h2h__track--a">
                      <span className="h2h__bar h2h__bar--a" style={{ width: `${(r.a / r.max) * 100}%` }} />
                    </span>
                    <span className="h2h__label">{r.label}</span>
                    <span className="h2h__track h2h__track--b">
                      <span className="h2h__bar h2h__bar--b" style={{ width: `${(r.b / r.max) * 100}%` }} />
                    </span>
                  </span>
                  <span className="h2h__val h2h__val--b" aria-hidden="true">{r.text(r.b)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="h2h__empty">{t("players.h2h.unavailable")}</p>
        )}
      </div>
    </section>
  );
}
