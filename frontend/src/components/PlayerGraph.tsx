import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  computeForceLayout, computePitchLayout, curvedEdgePath, interpolatePositions, pitchRect, radiusForTouches,
} from "../lib/forceLayout";
import type { LayoutBox, LayoutLink, LayoutNode, Point } from "../lib/forceLayout";
import { useT } from "../i18n";
import { countLabel, edgeKey, fmtXt, shortName } from "../lib/playerGraphApi";
import type { GraphEdge, GraphNode, GraphSelection, PlayerGraphResponse } from "../lib/playerGraphApi";
import { shirtNumber } from "../lib/matchContext";
import "./PlayerGraph.css";

export type GraphLayoutMode = "force" | "pitch";

const W = 860;
const H = 520;
const FORCE_BOX: LayoutBox = { width: W, height: H, padding: 22 };
const PITCH_BOX: LayoutBox = { width: W, height: H, padding: 14 };
const TWEEN_MS = 650;
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

interface Props {
  data: PlayerGraphResponse;
  layout: GraphLayoutMode;
  homeTeam: string;
  awayTeam: string;
  selection: GraphSelection;
  onSelect: (sel: GraphSelection) => void;
  onOpen: (playerId: string) => void;
  followedPlayerId: string | null;
}

type Hover = { kind: "node"; id: string } | { kind: "edge"; key: string } | null;

function edgeTouches(e: GraphEdge, id: string): boolean {
  return e.source === id || e.target === id;
}

function edgeLinks(e: GraphEdge, a: string, b: string): boolean {
  return (e.source === a && e.target === b) || (e.source === b && e.target === a);
}

/** SVG pass + duel network with tooltips, keyboard focus and an accessible table alternative. */
export function PlayerGraph({
  data, layout, homeTeam, awayTeam, selection, onSelect, onOpen, followedPlayerId,
}: Props) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const reduced = useReducedMotion();
  const i18n = useT();
  const { t, num: fmtNum } = i18n;
  const [hover, setHover] = useState<Hover>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const nodesById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const hubId = data.insights.hub?.player_id ?? null;

  const radii = useMemo(() => {
    const maxT = Math.max(1, ...data.nodes.map((n) => n.touches));
    return new Map(data.nodes.map((n) => [n.id, radiusForTouches(n.touches, maxT)]));
  }, [data.nodes]);

  const target = useMemo(() => {
    const lnodes: LayoutNode[] = data.nodes.map((n) => ({
      id: n.id, team: n.team, radius: radii.get(n.id) ?? 12, pitchX: n.avg_x, pitchY: n.avg_y,
    }));
    if (layout === "pitch") return computePitchLayout(lnodes, PITCH_BOX);
    const links: LayoutLink[] = data.edges.map((e) => ({
      source: e.source, target: e.target, weight: e.kind === "pass" ? e.count : e.count * 0.25,
    }));
    return computeForceLayout(lnodes, links, FORCE_BOX);
  }, [data.nodes, data.edges, layout, radii]);

  // Animated positions: tween from whatever is on screen to the new target.
  const [positions, setPositions] = useState<Map<string, Point>>(target);
  const shownRef = useRef<Map<string, Point>>(target);
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    if (reduced || from.size === 0) {
      shownRef.current = target;
      setPositions(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const next = t >= 1 ? target : interpolatePositions(from, target, t);
      shownRef.current = next;
      setPositions(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  const passMax = useMemo(
    () => Math.max(1, ...data.edges.filter((e) => e.kind === "pass").map((e) => e.count)), [data.edges],
  );
  const duelMax = useMemo(
    () => Math.max(1, ...data.edges.filter((e) => e.kind === "duel").map((e) => e.count)), [data.edges],
  );

  // Neighbours for dimming.
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of data.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)?.add(e.target);
      m.get(e.target)?.add(e.source);
    }
    return m;
  }, [data.edges]);

  // What is emphasised right now: hover > keyboard focus > persistent selection.
  const activeNode = hover?.kind === "node" ? hover.id
    : hover?.kind === "edge" ? null
    : focusId ?? (selection?.kind === "node" ? selection.id : null);
  const activeEdge = hover?.kind === "edge" ? hover.key : null;
  const activePair = !hover && !focusId && selection?.kind === "pair" ? selection : null;
  const anyActive = activeNode !== null || activeEdge !== null || activePair !== null;

  const edgeIsLit = (e: GraphEdge): boolean => {
    if (activeEdge) return edgeKey(e) === activeEdge;
    if (activeNode) return edgeTouches(e, activeNode);
    if (activePair) return edgeLinks(e, activePair.a, activePair.b) && e.kind === activePair.edge;
    return false;
  };
  const nodeIsLit = (id: string): boolean => {
    if (activeEdge) {
      const e = data.edges.find((x) => edgeKey(x) === activeEdge);
      return !!e && edgeTouches(e, id);
    }
    if (activeNode) return id === activeNode || (neighbours.get(activeNode)?.has(id) ?? false);
    if (activePair) return id === activePair.a || id === activePair.b;
    return true;
  };

  const teamName = (t: GraphNode["team"]) => (t === "home" ? homeTeam : awayTeam);
  const nameOf = (id: string) => shortName(i18n, nodesById.get(id), id);

  const edgeSummary = (e: GraphEdge): string => {
    if (e.kind === "pass") {
      return `${nameOf(e.source)} → ${nameOf(e.target)} · ${countLabel(i18n, "relations.edge.passes", e.count)}`
        + ` · ${countLabel(i18n, "relations.edge.completed", e.completed_count)} · ${fmtXt(i18n, e.xt_added)}`;
    }
    return `${nameOf(e.source)} ⚔ ${nameOf(e.target)} · ${countLabel(i18n, "relations.edge.duels", e.count)}`
      + ` · ${e.won_by_source}–${e.won_by_target}`;
  };

  const onNodeKey = (ev: ReactKeyboardEvent<SVGGElement>, id: string) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      onOpen(id);
    } else if (ev.key === " " || ev.key === "Spacebar") {
      ev.preventDefault();
      onSelect(selection?.kind === "node" && selection.id === id ? null : { kind: "node", id });
    }
  };

  // Only keyboard focus (focus-visible) drives the tooltip, so a mouse click doesn't leave it stuck open.
  const onNodeFocus = (ev: ReactFocusEvent<SVGGElement>, id: string) => {
    let visible = true;
    try {
      visible = ev.currentTarget.matches(":focus-visible");
    } catch {
      visible = true;
    }
    if (visible) setFocusId(id);
  };

  const onRootKey = (ev: ReactKeyboardEvent<HTMLDivElement>) => {
    if (ev.key === "Escape") {
      setHover(null);
      onSelect(null);
    }
  };

  const pitch = pitchRect(PITCH_BOX);
  const passEdges = data.edges.filter((e) => e.kind === "pass");
  const duelEdges = data.edges.filter((e) => e.kind === "duel");

  // Tooltip content (HTML overlay positioned in % of the viewBox).
  let tooltip: { x: number; y: number; above: number; body: ReactNode } | null = null;
  const tipNodeId = hover?.kind === "node" ? hover.id : focusId;
  if (hover?.kind === "edge") {
    const e = data.edges.find((x) => edgeKey(x) === hover.key);
    const pa = e ? positions.get(e.source) : undefined;
    const pb = e ? positions.get(e.target) : undefined;
    if (e && pa && pb) {
      tooltip = {
        x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, above: 8,
        body: <span className="pg-tip-line">{edgeSummary(e)}</span>,
      };
    }
  } else if (tipNodeId) {
    const n = nodesById.get(tipNodeId);
    const p = positions.get(tipNodeId);
    if (n && p) {
      tooltip = {
        x: p.x, y: p.y, above: (radii.get(n.id) ?? 12) + 10,
        body: (
          <>
            <span className="pg-tip-name">
              <span className={`pg-tip-dot is-${n.team}`} aria-hidden="true" />
              {n.name} <span className="pg-tip-num">#{shirtNumber(n.id)}</span>
            </span>
            <span className="pg-tip-line">
              {t("relations.tip.passes", { made: fmtNum(n.passes_made), received: fmtNum(n.passes_received) })}
            </span>
            <span className="pg-tip-line">
              {t("relations.tip.centrality", { c: fmtNum(n.betweenness, 2), touches: fmtNum(n.touches) })}
            </span>
            <span className="pg-tip-hint">{t("relations.tip.hint")}</span>
          </>
        ),
      };
    }
  }

  const sortedTableEdges = [...data.edges].sort((a, b) => b.count - a.count);

  return (
    <div className="pg" onKeyDown={onRootKey}>
      <div className="pg-stage">
        <svg
          className="pg-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label={t("relations.svg.aria", { players: data.nodes.length, links: passEdges.length, duels: duelEdges.length })}
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) onSelect(null);
          }}
        >
          <defs>
            <marker id={`${uid}-arrow-home`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9"
              markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className="pg-arrow is-home" />
            </marker>
            <marker id={`${uid}-arrow-away`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9"
              markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className="pg-arrow is-away" />
            </marker>
          </defs>

          {layout === "pitch" ? (
            <g className="pg-pitch" aria-hidden="true">
              <rect x={pitch.x} y={pitch.y} width={pitch.width} height={pitch.height} className="pg-pitch-grass" rx="4" />
              {Array.from({ length: 6 }, (_, i) => (
                <rect key={i} className="pg-pitch-stripe" x={pitch.x + (i * 2 * pitch.width) / 12} y={pitch.y}
                  width={pitch.width / 12} height={pitch.height} />
              ))}
              <g className="pg-pitch-lines">
                <rect x={pitch.x} y={pitch.y} width={pitch.width} height={pitch.height} />
                <line x1={pitch.x + pitch.width / 2} y1={pitch.y} x2={pitch.x + pitch.width / 2} y2={pitch.y + pitch.height} />
                <circle cx={pitch.x + pitch.width / 2} cy={pitch.y + pitch.height / 2} r={(10 / 120) * pitch.width} />
                {[0, 1].map((side) => {
                  const s = pitch.width / 120;
                  const boxW = 18 * s;
                  const boxH = 44 * s;
                  const sixW = 6 * s;
                  const sixH = 20 * s;
                  const x0 = side === 0 ? pitch.x : pitch.x + pitch.width - boxW;
                  const x6 = side === 0 ? pitch.x : pitch.x + pitch.width - sixW;
                  return (
                    <g key={side}>
                      <rect x={x0} y={pitch.y + (pitch.height - boxH) / 2} width={boxW} height={boxH} />
                      <rect x={x6} y={pitch.y + (pitch.height - sixH) / 2} width={sixW} height={sixH} />
                    </g>
                  );
                })}
              </g>
            </g>
          ) : (
            <g className="pg-halves" aria-hidden="true">
              {data.nodes.some((n) => n.team === "home") && data.nodes.some((n) => n.team === "away") && (
                <>
                  <text x={28} y={30} className="pg-half-label is-home">{homeTeam}</text>
                  <text x={W - 28} y={30} textAnchor="end" className="pg-half-label is-away">{awayTeam}</text>
                </>
              )}
            </g>
          )}

          <g className="pg-edges" aria-hidden="true">
            {duelEdges.map((e) => {
              const pa = positions.get(e.source);
              const pb = positions.get(e.target);
              if (!pa || !pb) return null;
              const key = edgeKey(e);
              const lit = edgeIsLit(e);
              const w = 1.5 + (e.count / duelMax) * 3.5;
              return (
                <g key={key} className="pg-edge-g" style={{ opacity: anyActive ? (lit ? 0.95 : 0.12) : 0.55 }}
                  onPointerEnter={() => setHover({ kind: "edge", key })} onPointerLeave={() => setHover(null)}
                  onClick={() => onSelect({ kind: "pair", a: e.source, b: e.target, edge: "duel" })}>
                  <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="pg-edge-hit" />
                  <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="pg-edge is-duel" strokeWidth={w} />
                </g>
              );
            })}
            {passEdges.map((e) => {
              const pa = positions.get(e.source);
              const pb = positions.get(e.target);
              const src = nodesById.get(e.source);
              if (!pa || !pb || !src) return null;
              const key = edgeKey(e);
              const lit = edgeIsLit(e);
              const w = 1.2 + (e.count / passMax) * 7;
              const { d } = curvedEdgePath(pa, radii.get(e.source) ?? 12, pb, radii.get(e.target) ?? 12, 0.14, 5);
              return (
                <g key={key} className="pg-edge-g" style={{ opacity: anyActive ? (lit ? 0.9 : 0.12) : 0.35 }}
                  onPointerEnter={() => setHover({ kind: "edge", key })} onPointerLeave={() => setHover(null)}
                  onClick={() => onSelect({ kind: "pair", a: e.source, b: e.target, edge: "pass" })}>
                  <path d={d} className="pg-edge-hit" />
                  <path d={d} className={`pg-edge is-${src.team}`} strokeWidth={w}
                    markerEnd={`url(#${uid}-arrow-${src.team})`} />
                </g>
              );
            })}
          </g>

          <g className="pg-nodes">
            {data.nodes.map((n) => {
              const p = positions.get(n.id);
              if (!p) return null;
              const r = radii.get(n.id) ?? 12;
              const isHub = n.id === hubId;
              const isFollowed = n.id === followedPlayerId;
              const isSelected = selection?.kind === "node" && selection.id === n.id;
              const lit = nodeIsLit(n.id);
              const num = shirtNumber(n.id);
              const flags = (isHub ? `, ${t("relations.panel.hub")}` : "")
                + (isFollowed ? `, ${t("relations.panel.followed")}` : "");
              const label = t("relations.node.aria", {
                name: n.name, num, team: teamName(n.team), flags,
                made: fmtNum(n.passes_made), received: fmtNum(n.passes_received), c: fmtNum(n.betweenness, 2),
              });
              return (
                <g
                  key={n.id}
                  className={`pg-node is-${n.team}${isSelected ? " is-selected" : ""}`}
                  transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                  style={{ opacity: anyActive && !lit ? 0.3 : 1 }}
                  tabIndex={0}
                  role="button"
                  aria-label={label}
                  aria-pressed={isSelected}
                  onPointerEnter={() => setHover({ kind: "node", id: n.id })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={(ev) => onNodeFocus(ev, n.id)}
                  onBlur={() => setFocusId((cur) => (cur === n.id ? null : cur))}
                  onClick={() => onSelect(isSelected ? null : { kind: "node", id: n.id })}
                  onDoubleClick={() => onOpen(n.id)}
                  onKeyDown={(ev) => onNodeKey(ev, n.id)}
                >
                  {isFollowed && <circle r={r + (isHub ? 11 : 6)} className="pg-ring is-followed" />}
                  {isHub && <circle r={r + 5} className="pg-ring is-hub" />}
                  <circle r={r + 3} className="pg-node-focus" />
                  <circle r={r} className="pg-node-disc" />
                  <text className="pg-node-num" dy="0.35em" fontSize={Math.max(11, r * 0.78)}>{num}</text>
                  <text className="pg-node-label" y={r + 15}>{shortName(i18n, n)}</text>
                  {isHub && <text className="pg-node-hub" y={-r - 10}>{t("relations.hub")}</text>}
                </g>
              );
            })}
          </g>
        </svg>

        {tooltip && (
          <div
            className="pg-tip"
            role="presentation"
            style={{
              left: `${(tooltip.x / W) * 100}%`,
              top: `${((tooltip.y - tooltip.above) / H) * 100}%`,
            }}
          >
            {tooltip.body}
          </div>
        )}
      </div>

      <div className="pg-legend">
        <ul className="pg-legend-items" aria-label={t("relations.legend.aria")}>
          <li><span className="pg-key pg-key-pass" aria-hidden="true" />{t("relations.legend.passes")}</li>
          <li><span className="pg-key pg-key-duel" aria-hidden="true" />{t("relations.duels")}</li>
          <li><span className="pg-key pg-key-size" aria-hidden="true" />{t("relations.legend.size")}</li>
          <li><span className="pg-key pg-key-hub" aria-hidden="true" />{t("relations.legend.hub")}</li>
          {followedPlayerId && <li><span className="pg-key pg-key-followed" aria-hidden="true" />{t("relations.legend.followed")}</li>}
        </ul>
        <span className="pg-legend-hint">
          <kbd>{t("relations.kbd.tab")}</kbd> {t("relations.kbd.browse")} · <kbd>{t("relations.kbd.space")}</kbd> {t("relations.kbd.select")}
          {" · "}<kbd>{t("relations.kbd.enter")}</kbd> {t("relations.kbd.profile")} · <kbd>{t("relations.kbd.esc")}</kbd> {t("relations.kbd.clear")}
        </span>
        <button
          type="button"
          className="ui-btn pg-table-toggle"
          aria-expanded={showTable}
          aria-controls={`${uid}-table`}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? t("relations.table.hide") : t("relations.table.show")}
        </button>
      </div>

      <div className={showTable ? "pg-table-wrap" : "ui-sr-only"} id={`${uid}-table`}>
        <table className="pg-table">
          <caption>
            {t("relations.table.caption", { from: data.window.from_min, to: data.window.to_min })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("relations.table.from")}</th>
              <th scope="col">{t("relations.table.to")}</th>
              <th scope="col">{t("relations.table.type")}</th>
              <th scope="col">{t("relations.table.volume")}</th>
              <th scope="col">{t("relations.table.result")}</th>
              <th scope="col">{t("relations.table.xt")}</th>
            </tr>
          </thead>
          <tbody>
            {sortedTableEdges.length === 0 && (
              <tr><td colSpan={6}>{t("relations.table.empty")}</td></tr>
            )}
            {sortedTableEdges.map((e) => (
              <tr key={edgeKey(e)}>
                <td>{nodesById.get(e.source)?.name ?? e.source}</td>
                <td>{nodesById.get(e.target)?.name ?? e.target}</td>
                <td>{e.kind === "pass" ? t("relations.passes") : t("relations.duels")}</td>
                <td>{fmtNum(e.count)}</td>
                <td>{e.kind === "pass" ? fmtNum(e.completed_count) : `${e.won_by_source}–${e.won_by_target}`}</td>
                <td>{e.kind === "pass" ? fmtXt(i18n, e.xt_added) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
