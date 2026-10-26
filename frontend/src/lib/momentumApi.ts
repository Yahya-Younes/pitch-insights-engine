// Data clients + small helpers for the Live tab:
//   GET /matches/{id}/momentum        (service/routers/momentum.py)
//   GET /matches/{id}/player-ratings  (service/routers/player_ratings.py)
//   GET /matches/{id}/live-ratings    (may 404 on older backends -- optional)
//   GET /matches/{id}/player-tags     (fallback roster names only)
import { useEffect, useMemo, useState } from "react";
import { fetchPlayerTags } from "./playerTagsApi";
import type { DataPoint, RenderPayload } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new HttpError(res.status, `${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function matchUrl(matchId: string, path: string): string {
  return `${API_BASE}/matches/${encodeURIComponent(matchId)}/${path}`;
}

// ---------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------

export type Side = "home" | "away";

export interface MomentumBucket {
  minute: number;
  home_xt: number;
  away_xt: number;
  /** -1 (away dominates) .. 1 (home dominates). */
  momentum: number;
}

export interface MomentumGoal {
  minute: number;
  team: Side;
  player_name: string;
}

export interface MomentumResponse {
  match_id: string;
  bucket_min: number;
  duration_ms: number;
  buckets: MomentumBucket[];
  goals: MomentumGoal[];
  method: string;
}

export function fetchMomentum(matchId: string, bucketMin = 1, signal?: AbortSignal): Promise<MomentumResponse> {
  return fetch(matchUrl(matchId, `momentum?bucket_min=${bucketMin}`), { signal }).then(asJson<MomentumResponse>);
}

// ---------------------------------------------------------------------------
// Roster (names, positions, ratings)
// ---------------------------------------------------------------------------

interface PlayerRatingsRow {
  player_id: string;
  name: string;
  team: string;
  position: string | null;
  rating: number;
}

interface PlayerRatingsResponse {
  players: PlayerRatingsRow[];
}

interface LiveRatingsRow {
  player_id: string;
  number?: number | string | null;
  name: string;
  team: string;
  position: string | null;
  rating: number;
  delta_10min: number | null;
}

interface LiveRatingsResponse {
  players: LiveRatingsRow[];
}

export interface RosterPlayer {
  playerId: string;
  name: string;
  team: Side;
  position: string | null;
  /** FC-style overall (≈40-99) from /player-ratings, when available. */
  fcRating: number | null;
  /** 0-10 live match rating from /live-ratings, when available. */
  liveRating: number | null;
  delta10: number | null;
}

export type RosterStatus = "idle" | "loading" | "ready" | "error";

export interface LiveRoster {
  status: RosterStatus;
  players: RosterPlayer[];
  byId: ReadonlyMap<string, RosterPlayer>;
}

const LIVE_RATINGS_POLL_MS = 20_000;

function sideOf(team: string, playerId: string): Side {
  if (team === "home" || team === "away") return team;
  return playerId.startsWith("away") ? "away" : "home";
}

async function loadBaseRoster(matchId: string, signal: AbortSignal): Promise<RosterPlayer[]> {
  try {
    const res = await fetch(matchUrl(matchId, "player-ratings"), { signal }).then(asJson<PlayerRatingsResponse>);
    return res.players.map((p) => ({
      playerId: p.player_id,
      name: p.name,
      team: sideOf(p.team, p.player_id),
      position: p.position,
      fcRating: p.rating,
      liveRating: null,
      delta10: null,
    }));
  } catch (e) {
    if (signal.aborted) throw e;
    // Ratings unavailable -- the speed-tags endpoint still knows names/teams.
    const tags = await fetchPlayerTags(matchId);
    return tags.players.map((p) => ({
      playerId: p.player_id,
      name: p.name,
      team: sideOf(p.team, p.player_id),
      position: null,
      fcRating: null,
      liveRating: null,
      delta10: null,
    }));
  }
}

/** Names, positions and ratings for every player of the match. Live ratings
 * are polled when the backend exposes /live-ratings; a 404 just stops the
 * polling and the roster keeps its FC ratings. */
export function useLiveRoster(matchId: string | null): LiveRoster {
  // Results are tagged with the match they belong to, so switching matches
  // needs no synchronous reset: stale results are simply ignored.
  const [base, setBase] = useState<{ matchId: string; players: RosterPlayer[] | null } | null>(null);
  const [live, setLive] = useState<{ matchId: string; rows: ReadonlyMap<string, LiveRatingsRow> } | null>(null);

  useEffect(() => {
    if (!matchId) return;
    const id = matchId;
    const ctrl = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    loadBaseRoster(id, ctrl.signal)
      .then((players) => {
        if (!ctrl.signal.aborted) setBase({ matchId: id, players });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setBase({ matchId: id, players: null });
      });

    async function pollLive() {
      try {
        const res = await fetch(matchUrl(id, "live-ratings"), { signal: ctrl.signal }).then(asJson<LiveRatingsResponse>);
        if (ctrl.signal.aborted) return;
        setLive({ matchId: id, rows: new Map(res.players.map((p) => [p.player_id, p])) });
        pollTimer = setTimeout(pollLive, LIVE_RATINGS_POLL_MS);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        // 404 = endpoint not deployed: degrade silently. Anything else: retry later.
        if (!(e instanceof HttpError && e.status === 404)) pollTimer = setTimeout(pollLive, LIVE_RATINGS_POLL_MS);
      }
    }
    void pollLive();

    return () => {
      ctrl.abort();
      if (pollTimer !== null) clearTimeout(pollTimer);
    };
  }, [matchId]);

  return useMemo(() => {
    const merged = new Map<string, RosterPlayer>();
    if (!matchId) return { status: "idle" as const, players: [], byId: merged };
    const baseHere = base?.matchId === matchId ? base : null;
    const liveRows = live?.matchId === matchId ? live.rows : null;
    for (const p of baseHere?.players ?? []) merged.set(p.playerId, { ...p });
    for (const [pid, row] of liveRows ?? []) {
      const prev = merged.get(pid);
      merged.set(pid, {
        playerId: pid,
        name: prev?.name ?? row.name,
        team: prev?.team ?? sideOf(row.team, pid),
        position: prev?.position ?? row.position,
        fcRating: prev?.fcRating ?? null,
        liveRating: row.rating,
        delta10: row.delta_10min,
      });
    }
    const players = [...merged.values()];
    let status: RosterStatus;
    if (players.length > 0) status = "ready";
    else if (!baseHere) status = "loading";
    else status = baseHere.players === null ? "error" : "ready";
    return { status, players, byId: merged };
  }, [matchId, base, live]);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

// signDisplay "negative": values that round to zero print "0,0", never "-0,0".
const FR_1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "negative" });
const FR_2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "negative" });

export function fr1(n: number): string {
  return FR_1.format(n);
}

export function fr2(n: number): string {
  return FR_2.format(n);
}

/** "63:12" -> 63 (match minute, 0-based like the clock). */
export function clockMinute(clock: string): number {
  const m = Number(clock.split(":")[0]);
  return Number.isFinite(m) ? m : 0;
}

/** "63:12" -> 3_792_000 ms. */
export function clockToMs(clock: string): number {
  const [m, s] = clock.split(":").map(Number);
  return ((m || 0) * 60 + (s || 0)) * 1000;
}

export function payloadTeam(points: DataPoint[]): Side | null {
  const team = points.find((p) => p.label === "team")?.value;
  return team === "home" || team === "away" ? team : null;
}

/** French labels for the broadcaster's trigger types. */
const TRIGGER_FR: Record<string, string> = {
  milestone: "But",
  pressure_spike: "Pressing",
  chaos_shift: "Contrôle / chaos",
  rhythm_change: "Rythme",
  xt_surge: "Poussée offensive",
  referee_decision: "Arbitrage",
  tendency_match: "Tendance confirmée",
  tendency_break: "Rupture de tendance",
};

export function triggerLabelFr(graphicType: string): string {
  return TRIGGER_FR[graphicType] ?? "Insight";
}

/** Trigger types worth surfacing as "temps forts". */
export const KEY_TRIGGERS: ReadonlySet<string> = new Set([
  "milestone", "referee_decision", "tendency_break", "xt_surge", "chaos_shift",
]);

export function isKeyMoment(p: RenderPayload): boolean {
  return KEY_TRIGGERS.has(p.graphic_type);
}

/** First sentence of a narrative, for headlines. */
export function splitHeadline(text: string): { headline: string; rest: string } {
  const trimmed = text.trim();
  const match = /^(.{12,140}?[.!?])(\s+|$)/.exec(trimmed);
  if (match?.[1]) return { headline: match[1], rest: trimmed.slice(match[0].length).trim() };
  if (trimmed.length <= 110) return { headline: trimmed, rest: "" };
  // One long sentence: headline up to the first clause break (", " / " — "),
  // else the last word boundary before ~90 chars, and keep the rest as body.
  const clause = /^(.{24,110}?)(,\s+|\s+[—–-]\s+)/.exec(trimmed);
  if (clause?.[1]) return { headline: clause[1], rest: trimmed.slice(clause[0].length).trim() };
  const cut = trimmed.lastIndexOf(" ", 90);
  const at = cut > 40 ? cut : 90;
  return { headline: `${trimmed.slice(0, at).trim()}…`, rest: `…${trimmed.slice(at).trim()}` };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
