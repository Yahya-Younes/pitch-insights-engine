import { useId, useRef, useState, type KeyboardEvent } from "react";
import { FcPlayerCard } from "../components/FcPlayerCard";
import { HeadToHead } from "../components/HeadToHead";
import { useT, type I18n } from "../i18n";
import { breakdownLabel } from "../i18n/backendLabels";
import { useMatch } from "../lib/matchContext";
import { usePlayersData } from "../lib/playersApi";
import {
  attributeCode,
  attributeLabel,
  formatPoints,
  formatRating,
  type AttributeKey,
  type MatchPlayer,
} from "../lib/playersTypes";
import "./JoueursTab.css";

type SortKey = "rating" | Extract<AttributeKey, "pace" | "passing" | "defending" | "involvement">;
type TeamFilter = "all" | "home" | "away";

const SORT_KEYS: readonly SortKey[] = ["rating", "pace", "passing", "defending", "involvement"];

function sortOptions(i18n: I18n): { value: SortKey; label: string }[] {
  return SORT_KEYS.map((k) => ({
    value: k,
    label: k === "rating" ? i18n.t("players.sort.rating") : attributeLabel(i18n, k),
  }));
}

/** Scoring rules of the live note /10 -- mirrors the backend's barème.
 * Numbers live here and are formatted per locale; words come from the catalog. */
function scaleRows(i18n: I18n): { key: string; rule: string; points: string }[] {
  const { t, num, signed, pct } = i18n;
  return [
    { key: "goal", rule: t("players.scale.goal"), points: t("players.scale.goalPts", { p: signed(1, 1), bonus: signed(0.2, 1), x: num(0.15, 2) }) },
    { key: "assist", rule: t("players.scale.assist"), points: signed(0.6, 1) },
    { key: "keyPass", rule: t("players.scale.keyPass"), points: signed(0.15, 2) },
    { key: "shot", rule: t("players.scale.shot"), points: t("players.scale.shotPts", { k: signed(0.3, 1), bonus: signed(0.05, 2) }) },
    { key: "xt", rule: t("players.scale.xt"), points: t("players.scale.xtPts", { k: signed(0.5, 1), cap: signed(0.8, 1) }) },
    { key: "dribble", rule: t("players.scale.dribble"), points: `${signed(0.05, 2)} / ${signed(-0.03, 2)}` },
    { key: "passHigh", rule: t("players.scale.passHigh", { pct: pct(0.85), n: 20 }), points: signed(0.1, 1) },
    { key: "passLow", rule: t("players.scale.passLow", { pct: pct(0.65), n: 15 }), points: signed(-0.1, 1) },
    { key: "ballLoss", rule: t("players.scale.ballLoss"), points: signed(-0.03, 2) },
    { key: "tackle", rule: t("players.scale.tackle"), points: signed(0.06, 2) },
    { key: "duel", rule: t("players.scale.duel"), points: `±${num(0.03, 2)}` },
    { key: "threat", rule: t("players.scale.threat"), points: `${signed(0.5, 1)} × xT` },
    { key: "save", rule: t("players.scale.save"), points: `${signed(0.15, 2)} + ${num(0.1, 1)} × xG` },
    { key: "conceded", rule: t("players.scale.conceded"), points: t("players.scale.concededPts", { gk: signed(-0.3, 1), def: signed(-0.1, 1) }) },
    { key: "foul", rule: t("players.scale.foul"), points: signed(-0.05, 2) },
    { key: "yellow", rule: t("players.scale.yellow"), points: signed(-0.3, 1) },
    { key: "red", rule: t("players.scale.red"), points: signed(-1, 1) },
  ];
}

function scaleNotes(i18n: I18n): string[] {
  const { t, num } = i18n;
  return [
    t("players.scale.note.multipliers", { d: num(1.3, 1), o: num(1.2, 1) }),
    t("players.scale.note.physical"),
    t("players.scale.note.bounds", { min: num(3), max: num(10) }),
    t("players.scale.note.hysteresis", { gap: num(0.1, 1) }),
  ];
}

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
  const i18n = useT();
  const { t } = i18n;
  return (
    <details className="jt-scale">
      <summary className="jt-scale__summary">{t("players.scale.show")}</summary>
      <table className="jt-scale__table">
        <caption className="ui-sr-only">{t("players.scale.caption")}</caption>
        <thead>
          <tr><th scope="col">{t("players.col.action")}</th><th scope="col">{t("players.col.points")}</th></tr>
        </thead>
        <tbody>
          {scaleRows(i18n).map((r) => (
            <tr key={r.key}><th scope="row">{r.rule}</th><td>{r.points}</td></tr>
          ))}
        </tbody>
      </table>
      <ul className="jt-scale__notes">
        {scaleNotes(i18n).map((n) => <li key={n}>{n}</li>)}
      </ul>
    </details>
  );
}

export function JoueursTab() {
  const { matchId, homeTeam, awayTeam, openPlayer, followedPlayerId } = useMatch();
  const i18n = useT();
  const { t } = i18n;
  const data = usePlayersData(matchId);
  const [sort, setSort] = useState<SortKey>("rating");
  const [team, setTeam] = useState<TeamFilter>("all");
  const motmTitleId = useId();
  const gridTitleId = useId();

  if (!matchId) {
    return (
      <div className="jt jt--empty ui-card">
        <p>{t("players.empty.noMatch")}</p>
      </div>
    );
  }

  if (data.status === "loading" || data.status === "idle") {
    return (
      <div className="jt" aria-busy="true">
        <p className="ui-sr-only" role="status">{t("players.loading")}</p>
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
          <p>{t("players.error.load")}</p>
          <p className="jt-error__detail">{data.error}</p>
          <button type="button" className="ui-btn" onClick={data.reload}>{t("players.retry")}</button>
        </div>
      </div>
    );
  }

  const { players } = data;
  const byId = new Map(players.map((p) => [p.id, p]));
  const teamName = (p: MatchPlayer) => (p.team === "home" ? homeTeam : awayTeam);

  const motmId = data.motm?.player_id ?? data.fallbackMotm?.player_id ?? null;
  const motmPlayer = motmId ? byId.get(motmId) : undefined;
  // "Why him?" is rebuilt from the breakdown (same top-3 rule as motmReason()):
  // the backend's own `reason` sentence is French-only, so it is not shown.
  const topItems = motmPlayer
    ? [...motmPlayer.breakdown]
        .filter((b) => b.label !== "Base" && Number(b.points.toFixed(2)) > 0)
        .sort((x, y) => y.points - x.points)
        .slice(0, 3)
    : [];

  const visible = players
    .filter((p) => team === "all" || p.team === team)
    .sort((x, y) => sortValue(y, sort) - sortValue(x, sort) || x.name.localeCompare(y.name, i18n.locale));

  return (
    <div className="jt">
      {!data.liveAvailable && (
        <p className="jt-banner" role="status">
          {t("players.banner.liveUnavailable", { na: t("players.ratingUnavailable") })}
        </p>
      )}
      {data.liveAvailable && data.attrsError && (
        <p className="jt-banner" role="status">
          {t("players.banner.attrsUnavailable", { codes: `${attributeCode(i18n, "pace")}/${attributeCode(i18n, "shooting")}/` })}
        </p>
      )}

      <div className="jt__top">
        <section className="jt-motm ui-card" aria-labelledby={motmTitleId}>
          <h2 id={motmTitleId} className="ui-heading jt-motm__title">
            {t("players.motm.title")}
            {data.minute !== null && <span className="jt-motm__minute"> · {t("players.motm.atMinute", { m: data.minute })}</span>}
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
                <h3 className="jt-motm__why-title">{t("players.motm.why")}</h3>
                <ul className="jt-motm__reasons">
                  {topItems.map((b) => (
                    <li key={b.label}>
                      {breakdownLabel(i18n, b.label)}{b.count > 1 ? ` ×${b.count}` : ""}{" "}
                      <span className="jt-motm__pts">{formatPoints(i18n, b.points)}</span>
                    </li>
                  ))}
                  {!topItems.length && <li>{t("players.motm.pending")}</li>}
                </ul>
                {data.motm ? (
                  <p className="jt-motm__leader">
                    <span aria-hidden="true">★ </span>
                    {t("players.motm.leader", { m: data.motm.leader_since_minute, r: formatRating(i18n, data.motm.rating) })}
                  </p>
                ) : (
                  <p className="jt-motm__leader jt-motm__leader--muted">
                    {t("players.motm.provisional")}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="jt-muted">{t("players.motm.none")}</p>
          )}
          <p className="jt-motm__foot">
            {t("players.motm.foot", { base: i18n.num(6, 1) })}
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
          <h2 id={gridTitleId} className="ui-heading">{t("players.grid.title")}</h2>
          <div className="jt-ratings__controls">
            <RadioPills label={t("players.sort.label")} options={sortOptions(i18n)} value={sort} onChange={setSort} />
            <RadioPills<TeamFilter>
              label={t("players.team.label")}
              options={[
                { value: "all", label: t("players.team.all") },
                { value: "home", label: homeTeam },
                { value: "away", label: awayTeam },
              ]}
              value={team}
              onChange={setTeam}
            />
          </div>
        </div>
        {visible.length ? (
          <ul className="jt__grid" aria-label={visible.length === 1 ? t("players.grid.countOne") : t("players.grid.count", { n: visible.length })}>
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
          <p className="jt-muted">{t("players.grid.empty")}</p>
        )}
      </section>
    </div>
  );
}
