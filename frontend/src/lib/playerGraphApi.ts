// Player relations graph -- GET /matches/{id}/player-graph
// (service/routers/player_graph.py, agents/analyst0/player_graph.py).
// Types, fetchers and a small per-params response cache for the Relations tab.

import type { I18n } from "../i18n";
import { shortName as initialName } from "./matchContext";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export type GraphTeam = "home" | "away";
export type GraphTeamFilter = "both" | GraphTeam;

export interface GraphNode {
  id: string;
  name: string;
  team: GraphTeam;
  touches: number;
  passes_made: number;
  passes_received: number;
  degree_centrality: number;
  /** Normalised per team, 0-1. */
  betweenness: number;
  /** 120x80 pitch coordinates (absolute frame). */
  avg_x: number;
  avg_y: number;
}

export interface PassEdge {
  source: string;
  target: string;
  kind: "pass";
  count: number;
  completed_count: number;
  xt_added: number;
  directed: true;
}

export interface DuelEdge {
  source: string;
  target: string;
  kind: "duel";
  count: number;
  won_by_source: number;
  won_by_target: number;
  directed: false;
}

export type GraphEdge = PassEdge | DuelEdge;

export interface GraphHub {
  player_id: string;
  name: string;
  betweenness: number;
  reason: string;
}

export interface GraphPair {
  a: string;
  b: string;
  passes: number;
  xt_added: number;
}

export interface GraphDuelPair {
  a: string;
  b: string;
  count: number;
}

export interface PlayerGraphResponse {
  match_id: string;
  window: { from_min: number; to_min: number };
  nodes: GraphNode[];
  edges: GraphEdge[];
  insights: {
    hub: GraphHub | null;
    top_pairs: GraphPair[];
    most_contested_duel: GraphDuelPair | null;
    isolated_players: string[];
  };
  method: string;
}

export interface PlayerGraphParams {
  fromMin: number;
  toMin: number;
  team: GraphTeamFilter;
  includeDuels: boolean;
  minPasses: number;
}

export function graphCacheKey(matchId: string, p: PlayerGraphParams): string {
  return [matchId, p.fromMin, p.toMin, p.team, p.includeDuels ? 1 : 0, p.minPasses].join("|");
}

const CACHE_MAX = 200;
const cache = new Map<string, PlayerGraphResponse>();

/** Last response for these params, if any (does not hit the network). */
export function cachedPlayerGraph(matchId: string, p: PlayerGraphParams): PlayerGraphResponse | undefined {
  return cache.get(graphCacheKey(matchId, p));
}

/** Fetches the graph. `fresh` bypasses the cache (live polling); the result is cached either way. */
export async function fetchPlayerGraph(
  matchId: string, p: PlayerGraphParams, opts: { signal?: AbortSignal; fresh?: boolean } = {},
): Promise<PlayerGraphResponse> {
  const key = graphCacheKey(matchId, p);
  const hit = cache.get(key);
  if (hit && !opts.fresh) return hit;
  const qs = new URLSearchParams({
    from_min: String(p.fromMin),
    to_min: String(p.toMin),
    team: p.team,
    include_duels: String(p.includeDuels),
    min_passes: String(p.minPasses),
  });
  const res = await fetch(`${API_BASE}/matches/${encodeURIComponent(matchId)}/player-graph?${qs}`, {
    signal: opts.signal,
  });
  const body = await asJson<PlayerGraphResponse>(res);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, body);
  return body;
}

export type MatchRunStatus = "running" | "done" | "crashed" | "failed";

export async function fetchRunStatus(matchId: string, signal?: AbortSignal): Promise<MatchRunStatus> {
  const res = await fetch(`${API_BASE}/matches/${encodeURIComponent(matchId)}/status`, { signal });
  const body = await asJson<{ status: MatchRunStatus }>(res);
  return body.status;
}

/** Current match minute from /match-stats; null when unavailable (endpoint still being built). */
export async function fetchMatchMinute(matchId: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}/matches/${encodeURIComponent(matchId)}/match-stats`, { signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "minute" in body) {
      const minute = (body as { minute: unknown }).minute;
      if (typeof minute === "number" && Number.isFinite(minute)) return minute;
    }
    return null;
  } catch {
    return null;
  }
}

// --- UI helpers shared by the Relations tab and PlayerGraph ------------------

/** What the graph highlights: one player, or a pair (duo / duel insight). */
export type GraphSelection =
  | { kind: "node"; id: string }
  | { kind: "pair"; a: string; b: string; edge: "pass" | "duel" }
  | null;

/** Signed xT in the active locale, e.g. "+0,21 xT" / "+0.21 xT"; values that
 * round to zero print without a sign. */
export function fmtXt(i18n: I18n, v: number): string {
  return `${i18n.signed(v, 2)} xT`;
}

const pluralRules = new Map<string, Intl.PluralRules>();

/** "one" / "other" for a count in the active locale (French treats 0 as singular). */
export function pluralForm(i18n: I18n, n: number): "one" | "other" {
  let rules = pluralRules.get(i18n.locale);
  if (!rules) {
    rules = new Intl.PluralRules(i18n.locale);
    pluralRules.set(i18n.locale, rules);
  }
  return rules.select(n) === "one" ? "one" : "other";
}

/** Picks the ".one" / ".other" variant of a "{n} …" key for a count. */
export function countLabel(i18n: I18n, key: string, n: number): string {
  return i18n.t(`${key}.${pluralForm(i18n, n)}`, { n: i18n.num(n) });
}

/** Short display name: "R. Donnelly" (the simulator reuses surnames within a
 * squad, so the initial is kept), or a shirt-number label when the API only knows the id. */
export function shortName(
  i18n: I18n, node: { id: string; name: string } | undefined, fallbackId = "",
): string {
  if (!node) return fallbackId ? shortFromId(i18n, fallbackId) : "?";
  if (!node.name || node.name === node.id) return shortFromId(i18n, node.id);
  return initialName(node.name);
}

function shortFromId(i18n: I18n, id: string): string {
  const num = id.split("_").pop();
  return num && /^\d+$/.test(num) ? i18n.t("relations.shirtNo", { n: num }) : id;
}

export function edgeKey(e: { kind: string; source: string; target: string }): string {
  return `${e.kind}:${e.source}>${e.target}`;
}
