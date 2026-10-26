import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { PlayerGraph } from "../components/PlayerGraph";
import type { GraphLayoutMode } from "../components/PlayerGraph";
import { TimeRangeSlider } from "../components/TimeRangeSlider";
import { useT } from "../i18n";
import type { I18n } from "../i18n";
import { shirtNumber, useMatch } from "../lib/matchContext";
import {
  cachedPlayerGraph, fetchMatchMinute, fetchPlayerGraph, fetchRunStatus, fmtXt, pluralForm, shortName,
} from "../lib/playerGraphApi";
import type {
  GraphNode, GraphSelection, GraphTeamFilter, PlayerGraphParams, PlayerGraphResponse,
} from "../lib/playerGraphApi";
import "./RelationsTab.css";

const DEBOUNCE_MS = 250;
const POLL_MS = 5000;
const MIN_PASSES_RANGE = [1, 5] as const;

interface Partner {
  id: string;
  given: number;
  received: number;
  total: number;
  xt: number;
}

interface DuelLine {
  id: string;
  count: number;
  won: number;
  lost: number;
}

function partnersOf(data: PlayerGraphResponse, id: string): { partners: Partner[]; duels: DuelLine[] } {
  const acc = new Map<string, Partner>();
  const duels: DuelLine[] = [];
  for (const e of data.edges) {
    if (e.kind === "pass") {
      if (e.source !== id && e.target !== id) continue;
      const other = e.source === id ? e.target : e.source;
      const p = acc.get(other) ?? { id: other, given: 0, received: 0, total: 0, xt: 0 };
      if (e.source === id) p.given += e.count;
      else p.received += e.count;
      p.total += e.count;
      p.xt += e.xt_added;
      acc.set(other, p);
    } else if (e.source === id || e.target === id) {
      const mine = e.source === id;
      duels.push({
        id: mine ? e.target : e.source,
        count: e.count,
        won: mine ? e.won_by_source : e.won_by_target,
        lost: mine ? e.won_by_target : e.won_by_source,
      });
    }
  }
  return {
    partners: [...acc.values()].sort((a, b) => b.total - a.total || b.xt - a.xt),
    duels: duels.sort((a, b) => b.count - a.count),
  };
}

function hubReason(i18n: I18n, n: GraphNode | undefined): string {
  if (!n) return "";
  return i18n.t("relations.hubReason", {
    pct: i18n.pct(n.betweenness), made: i18n.num(n.passes_made), received: i18n.num(n.passes_received),
  });
}

export function RelationsTab() {
  const { matchId, homeTeam, awayTeam, followedPlayerId, setFollowedPlayerId, openPlayer } = useMatch();
  const i18n = useT();
  const { t, num: fmtNum } = i18n;

  const [team, setTeam] = useState<GraphTeamFilter>("both");
  const [duelsOn, setDuelsOn] = useState(true);
  const [layout, setLayout] = useState<GraphLayoutMode>("force");
  const [minPasses, setMinPasses] = useState(2);
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 0, to: 90 });
  const [selection, setSelection] = useState<GraphSelection>(null);

  const [data, setData] = useState<PlayerGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [liveMinute, setLiveMinute] = useState<number | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const forceFreshRef = useRef(false);

  const params: PlayerGraphParams = useMemo(() => ({
    fromMin: range.from, toMin: range.to, team, includeDuels: duelsOn && team === "both", minPasses,
  }), [range.from, range.to, team, duelsOn, minPasses]);

  // Reset when the match changes (adjusting state during render, per React docs).
  const [shownMatch, setShownMatch] = useState(matchId);
  if (shownMatch !== matchId) {
    setShownMatch(matchId);
    setData(null);
    setError(null);
    setSelection(null);
  }

  // Live polling: every 5 s while the match runs; one last fresh fetch when it ends.
  useEffect(() => {
    if (!matchId) return;
    const ctrl = new AbortController();
    let timer: number | undefined;
    let wasLive = false;
    const check = async () => {
      try {
        const status = await fetchRunStatus(matchId, ctrl.signal);
        if (ctrl.signal.aborted) return;
        const running = status === "running";
        if (running) {
          const minute = await fetchMatchMinute(matchId, ctrl.signal);
          if (ctrl.signal.aborted) return;
          setLiveMinute(minute);
          setLive(true);
          wasLive = true;
          setPollTick((t) => t + 1);
          timer = window.setTimeout(() => void check(), POLL_MS);
        } else {
          setLive(false);
          setLiveMinute(null);
          if (wasLive) {
            forceFreshRef.current = true;
            setPollTick((t) => t + 1);
          }
        }
      } catch {
        if (!ctrl.signal.aborted) setLive(false);
      }
    };
    void check();
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [matchId]);

  // Debounced, cached graph fetch.
  useEffect(() => {
    if (!matchId) return;
    const fresh = live || forceFreshRef.current;
    forceFreshRef.current = false;
    const hit = cachedPlayerGraph(matchId, params);
    if (hit && !fresh) {
      setData(hit);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetchPlayerGraph(matchId, params, { signal: ctrl.signal, fresh })
        .then((d) => {
          if (ctrl.signal.aborted) return;
          setData(d);
          setError(null);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [matchId, params, live, pollTick]);

  const nodesById = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const nameOf = (id: string) => shortName(i18n, nodesById.get(id), id);

  // Side panel player: explicit selection, else followed, else the hub.
  const panelId = selection?.kind === "node" ? selection.id
    : selection?.kind === "pair" ? selection.a
    : followedPlayerId && nodesById.has(followedPlayerId) ? followedPlayerId
    : data?.insights.hub?.player_id ?? null;
  const panelNode = panelId ? nodesById.get(panelId) : undefined;
  const panelLinks = useMemo(
    () => (data && panelId ? partnersOf(data, panelId) : { partners: [], duels: [] }),
    [data, panelId],
  );
  const partnerMax = Math.max(1, ...panelLinks.partners.map((p) => p.total));

  const teamOptions: { value: GraphTeamFilter; label: string }[] = [
    { value: "both", label: t("relations.team.both") },
    { value: "home", label: homeTeam || t("relations.team.home") },
    { value: "away", label: awayTeam || t("relations.team.away") },
  ];

  const onTeamKey = (ev: ReactKeyboardEvent<HTMLDivElement>) => {
    const idx = teamOptions.findIndex((o) => o.value === team);
    let next = idx;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") next = (idx + 1) % teamOptions.length;
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") next = (idx - 1 + teamOptions.length) % teamOptions.length;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = teamOptions.length - 1;
    else return;
    ev.preventDefault();
    const opt = teamOptions[next];
    if (!opt) return;
    setTeam(opt.value);
    const btn = ev.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[next];
    btn?.focus();
  };

  if (!matchId) {
    return (
      <div className="ui-card rel-empty">
        <p className="ui-heading">{t("relations.title")}</p>
        <p>{t("relations.noMatch")}</p>
      </div>
    );
  }

  const hub = data?.insights.hub ?? null;
  const duo = data?.insights.top_pairs[0] ?? null;
  const duel = data?.insights.most_contested_duel ?? null;
  const isolated = data?.insights.isolated_players ?? [];
  const isFollowed = !!panelId && panelId === followedPlayerId;

  return (
    <div className="rel">
      <div className="rel-main">
        <section className="ui-card rel-controls" aria-labelledby="rel-title">
          <div className="rel-controls-head">
            <h2 className="ui-heading" id="rel-title">{t("relations.title")}</h2>
            <span className="ui-tag">{t("relations.tag")}</span>
            {live && (
              <span className="ui-pill is-danger rel-live">
                {liveMinute !== null ? t("relations.liveAt", { m: liveMinute }) : t("relations.live")}
              </span>
            )}
            <span className="rel-status" aria-live="polite">{loading && data ? t("relations.updating") : ""}</span>
          </div>

          <div className="rel-controls-row">
            <div className="rel-seg" role="radiogroup" aria-label={t("relations.team.aria")} onKeyDown={onTeamKey}>
              {teamOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={team === o.value}
                  tabIndex={team === o.value ? 0 : -1}
                  className={`rel-seg-btn is-${o.value}${team === o.value ? " is-active" : ""}`}
                  onClick={() => setTeam(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`ui-btn rel-toggle${duelsOn && team === "both" ? " is-on" : ""}`}
              aria-pressed={duelsOn && team === "both"}
              disabled={team !== "both"}
              aria-describedby={team !== "both" ? "rel-duel-note" : undefined}
              onClick={() => setDuelsOn((v) => !v)}
            >
              {t("relations.duelsToggle")}
            </button>

            <div className="rel-seg rel-seg--small" role="group" aria-label={t("relations.layout.aria")}>
              <button type="button" className={`rel-seg-btn${layout === "force" ? " is-active" : ""}`}
                aria-pressed={layout === "force"} onClick={() => setLayout("force")}>{t("relations.layout.force")}</button>
              <button type="button" className={`rel-seg-btn${layout === "pitch" ? " is-active" : ""}`}
                aria-pressed={layout === "pitch"} onClick={() => setLayout("pitch")}>{t("relations.layout.pitch")}</button>
            </div>

            <div className="rel-stepper" role="group" aria-labelledby="rel-minp-label">
              <span id="rel-minp-label" className="rel-stepper-label">{t("relations.minPasses")}</span>
              <button type="button" className="ui-btn" aria-label={t("relations.minPasses.dec")}
                disabled={minPasses <= MIN_PASSES_RANGE[0]} onClick={() => setMinPasses((v) => Math.max(MIN_PASSES_RANGE[0], v - 1))}>−</button>
              <output className="rel-stepper-value" aria-live="polite">{minPasses}</output>
              <button type="button" className="ui-btn" aria-label={t("relations.minPasses.inc")}
                disabled={minPasses >= MIN_PASSES_RANGE[1]} onClick={() => setMinPasses((v) => Math.min(MIN_PASSES_RANGE[1], v + 1))}>+</button>
            </div>
          </div>

          {team !== "both" && (
            <p className="rel-note" id="rel-duel-note">
              {t("relations.duelNote", { both: t("relations.team.both") })}
            </p>
          )}

          <TimeRangeSlider
            from={range.from}
            to={range.to}
            liveMinute={live ? liveMinute : null}
            onChange={(from, to) => setRange({ from, to })}
          />
        </section>

        <section className="ui-card rel-graph-card" aria-label={t("relations.graph.aria")}>
          {error && (
            <div className="rel-error" role="alert">
              {t("relations.error")} <span className="rel-error-detail">{error}</span>
            </div>
          )}
          {!data && !error && (
            <div className="rel-loading" role="status">
              <span className="rel-spinner" aria-hidden="true" /> {t("relations.loading")}
            </div>
          )}
          {data && data.nodes.length === 0 && (
            <div className="rel-loading" role="status">
              {t("relations.emptyWindow", { from: data.window.from_min, to: data.window.to_min })}
            </div>
          )}
          {data && data.nodes.length > 0 && (
            <div className={loading ? "rel-graph is-stale" : "rel-graph"}>
              <PlayerGraph
                data={data}
                layout={layout}
                homeTeam={homeTeam}
                awayTeam={awayTeam}
                selection={selection}
                onSelect={setSelection}
                onOpen={openPlayer}
                followedPlayerId={followedPlayerId}
              />
            </div>
          )}
        </section>

        {data && data.nodes.length > 0 && (
          <section className="rel-insights" aria-label={t("relations.insights.aria")}>
            <button
              type="button"
              className={`ui-card rel-insight is-gold${selection?.kind === "node" && selection.id === hub?.player_id ? " is-active" : ""}`}
              disabled={!hub}
              onClick={() => hub && setSelection({ kind: "node", id: hub.player_id })}
            >
              <span className="rel-insight-kicker">{t("relations.hub")}</span>
              {hub ? (
                <>
                  <span className="rel-insight-title">{hub.name}</span>
                  <span className="rel-insight-stat">{t("relations.centrality")} <strong>{fmtNum(hub.betweenness, 2)}</strong></span>
                  <span className="rel-insight-body">{hubReason(i18n, nodesById.get(hub.player_id))}</span>
                </>
              ) : <span className="rel-insight-body">{t("relations.noHub")}</span>}
            </button>

            <button
              type="button"
              className={`ui-card rel-insight is-home${selection?.kind === "pair" && selection.edge === "pass" && duo && selection.a === duo.a && selection.b === duo.b ? " is-active" : ""}`}
              disabled={!duo}
              onClick={() => duo && setSelection({ kind: "pair", a: duo.a, b: duo.b, edge: "pass" })}
            >
              <span className="rel-insight-kicker">{t("relations.duo")}</span>
              {duo ? (
                <>
                  <span className="rel-insight-title">{nameOf(duo.a)} ⇄ {nameOf(duo.b)}</span>
                  <span className="rel-insight-stat">
                    <strong>{fmtNum(duo.passes)}</strong> {t(`relations.unit.pass.${pluralForm(i18n, duo.passes)}`)} · {fmtXt(i18n, duo.xt_added)}
                  </span>
                </>
              ) : <span className="rel-insight-body">{t("relations.noDuo")}</span>}
            </button>

            <button
              type="button"
              className={`ui-card rel-insight is-danger${selection?.kind === "pair" && selection.edge === "duel" ? " is-active" : ""}`}
              disabled={!duel}
              onClick={() => duel && setSelection({ kind: "pair", a: duel.a, b: duel.b, edge: "duel" })}
            >
              <span className="rel-insight-kicker">{t("relations.duel")}</span>
              {duel ? (
                <>
                  <span className="rel-insight-title">{nameOf(duel.a)} ⚔ {nameOf(duel.b)}</span>
                  <span className="rel-insight-stat"><strong>{fmtNum(duel.count)}</strong> {t(`relations.unit.duel.${pluralForm(i18n, duel.count)}`)}</span>
                </>
              ) : (
                <span className="rel-insight-body">
                  {params.includeDuels ? t("relations.noDuel") : t("relations.duelsHidden")}
                </span>
              )}
            </button>

            <div className="ui-card rel-insight rel-insight--static">
              <span className="rel-insight-kicker">{t("relations.isolated")}</span>
              {isolated.length === 0 ? (
                <span className="rel-insight-body">{t("relations.noIsolated")}</span>
              ) : (
                <ul className="rel-chips" aria-label={t("relations.isolatedAria")}>
                  {isolated.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        className={`ui-pill is-${nodesById.get(id)?.team ?? "home"}`}
                        aria-pressed={selection?.kind === "node" && selection.id === id}
                        onClick={() => setSelection({ kind: "node", id })}
                      >
                        {shirtNumber(id)} · {nameOf(id)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
      </div>

      <aside className="rel-side" aria-label={t("relations.panel.aria")}>
        <section className="ui-card rel-panel">
          {!panelNode ? (
            <p className="rel-panel-empty">
              {data ? t("relations.panel.hint") : t("relations.panel.waiting")}
            </p>
          ) : (
            <>
              <header className="rel-panel-head">
                <span className={`rel-panel-num is-${panelNode.team}`} aria-hidden="true">{shirtNumber(panelNode.id)}</span>
                <div>
                  <h3 className="rel-panel-name">{panelNode.name}</h3>
                  <p className="rel-panel-sub">
                    {panelNode.team === "home" ? homeTeam : awayTeam}
                    {selection === null && ` · ${panelNode.id === followedPlayerId ? t("relations.panel.followed") : t("relations.panel.hub")}`}
                  </p>
                </div>
              </header>
              <dl className="rel-panel-stats">
                <div><dt>{t("relations.panel.given")}</dt><dd className="ui-stat-value">{fmtNum(panelNode.passes_made)}</dd></div>
                <div><dt>{t("relations.panel.received")}</dt><dd className="ui-stat-value">{fmtNum(panelNode.passes_received)}</dd></div>
                <div><dt>{t("relations.centrality")}</dt><dd className="ui-stat-value">{fmtNum(panelNode.betweenness, 2)}</dd></div>
              </dl>

              <h4 className="rel-panel-h">{t("relations.panel.partners")}</h4>
              {panelLinks.partners.length === 0 ? (
                <p className="rel-panel-muted">{t("relations.panel.noPartners")}</p>
              ) : (
                <ol className="rel-partners">
                  {panelLinks.partners.slice(0, 6).map((p) => (
                    <li key={p.id}>
                      <button type="button" className="rel-partner"
                        onClick={() => setSelection({ kind: "pair", a: panelNode.id, b: p.id, edge: "pass" })}
                        aria-label={t("relations.panel.partnerAria", {
                          name: nodesById.get(p.id)?.name ?? p.id, given: fmtNum(p.given),
                          received: fmtNum(p.received), xt: fmtXt(i18n, p.xt),
                        })}>
                        <span className="rel-partner-name">{nameOf(p.id)}</span>
                        <span className="rel-partner-bar" aria-hidden="true">
                          <span className={`rel-partner-fill is-${panelNode.team}`} style={{ width: `${(p.total / partnerMax) * 100}%` }} />
                        </span>
                        <span className="rel-partner-val">{p.given}→ · ←{p.received}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              {params.includeDuels && (
                <>
                  <h4 className="rel-panel-h">{t("relations.duels")}</h4>
                  {panelLinks.duels.length === 0 ? (
                    <p className="rel-panel-muted">{t("relations.panel.noDuels")}</p>
                  ) : (
                    <ul className="rel-duels">
                      {panelLinks.duels.slice(0, 5).map((d) => (
                        <li key={d.id}>
                          <span>⚔ {nameOf(d.id)}</span>
                          <span className="rel-duel-score">
                            {fmtNum(d.count)} · <span className="is-won">{d.won}</span>–<span className="is-lost">{d.lost}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              <div className="rel-panel-actions">
                <button type="button" className="ui-btn is-solid" onClick={() => openPlayer(panelNode.id)}>
                  {t("relations.panel.open")}
                </button>
                <button
                  type="button"
                  className="ui-btn"
                  aria-pressed={isFollowed}
                  onClick={() => setFollowedPlayerId(isFollowed ? null : panelNode.id)}
                >
                  {isFollowed ? t("relations.panel.unfollow") : t("relations.panel.follow")}
                </button>
              </div>
            </>
          )}
        </section>
        {data && (
          <p className="rel-method">
            <span className="rel-method-k">{t("relations.method.label")}</span>{" "}
            {t("relations.method.text", { min: params.minPasses })}
          </p>
        )}
      </aside>
    </div>
  );
}
