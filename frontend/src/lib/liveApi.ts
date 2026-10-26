// Clients + the single shared poller for the "Suivi live" dashboard.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAgentTrace } from "./agentTraceApi";
import type { AgentTraceResponse } from "./agentTraceTypes";
import { fetchShotMap } from "./matchMapsApi";
import type { ShotMapResponse } from "./matchMapsTypes";
import type { PlayerTagsResponse } from "./playerTagsApi";
import { fetchWinProbability, type WinProbabilityResponse } from "./winProbabilityApi";
import type {
  LiveRatingsResponse, LiveStatusResponse, MatchStatsResponse, MomentumResponse, Resource, StatsWindow,
} from "./liveTypes";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

/** HTTP error that keeps the status code so the UI can word 404 vs 500 differently. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export function fetchLiveStatus(matchId: string, signal?: AbortSignal): Promise<LiveStatusResponse> {
  return fetch(`${API_BASE}/matches/${enc(matchId)}/status`, { signal }).then(asJson<LiveStatusResponse>);
}

export function fetchMatchStats(
  matchId: string, lastMinutes: number | null, signal?: AbortSignal,
): Promise<MatchStatsResponse> {
  const q = lastMinutes !== null ? `?last_minutes=${lastMinutes}` : "";
  return fetch(`${API_BASE}/matches/${enc(matchId)}/match-stats${q}`, { signal }).then(asJson<MatchStatsResponse>);
}

export function fetchLiveRatings(matchId: string, signal?: AbortSignal): Promise<LiveRatingsResponse> {
  return fetch(`${API_BASE}/matches/${enc(matchId)}/live-ratings`, { signal }).then(asJson<LiveRatingsResponse>);
}

export function fetchMomentum(matchId: string, bucketMin = 1, signal?: AbortSignal): Promise<MomentumResponse> {
  return fetch(`${API_BASE}/matches/${enc(matchId)}/momentum?bucket_min=${bucketMin}`, { signal })
    .then(asJson<MomentumResponse>);
}

// The shared playerTagsApi client takes no AbortSignal -- keep a local one.
export function fetchPlayerTagsLive(matchId: string, signal?: AbortSignal): Promise<PlayerTagsResponse> {
  return fetch(`${API_BASE}/matches/${enc(matchId)}/player-tags`, { signal }).then(asJson<PlayerTagsResponse>);
}

/** Human (French) wording for a failed request. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "Pas encore de données pour ce match (404).";
    if (err.status >= 500) return `Le serveur a renvoyé une erreur (${err.status}).`;
    return `Requête refusée (${err.status}).`;
  }
  if (err instanceof TypeError) return "API injoignable — vérifie que le backend tourne.";
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Formatting (French decimals)
// ---------------------------------------------------------------------------

const RATING_FMT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const SIGNED_FMT = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1, maximumFractionDigits: 2, signDisplay: "exceptZero",
});
const DEC2_FMT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 8.4 -> "8,4" */
export function formatRating(n: number): string {
  return RATING_FMT.format(n);
}

/** 0.45 -> "+0,45", -0.3 -> "-0,3" */
export function formatSigned(n: number): string {
  return SIGNED_FMT.format(n);
}

export function formatDec2(n: number): string {
  return DEC2_FMT.format(n);
}

/** "R. Ribeiro" from "Rafael Ribeiro" (single names unchanged). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const first = parts[0] ?? "";
  return `${first.charAt(0)}. ${parts.slice(1).join(" ")}`;
}

// ---------------------------------------------------------------------------
// Shared poller
// ---------------------------------------------------------------------------

export const POLL_INTERVAL_MS = 3000;
/** Player tags are heavier to compute -- refresh them every Nth tick only. */
const TAGS_EVERY_N_TICKS = 4;
/** Give up polling after this many consecutive status failures. */
const MAX_STATUS_FAILURES = 5;

export type PollPhase = "idle" | "loading" | "live" | "stopped";

export interface LiveSnapshot {
  /** Last status from /status, or "unknown" when it could not be read. */
  status: string;
  phase: PollPhase;
  /** Epoch ms of the last completed tick. */
  updatedAt: number | null;
  stats: Resource<MatchStatsResponse>;
  ratings: Resource<LiveRatingsResponse>;
  winProb: Resource<WinProbabilityResponse>;
  momentum: Resource<MomentumResponse>;
  shots: Resource<ShotMapResponse>;
  agents: Resource<AgentTraceResponse>;
  tags: Resource<PlayerTagsResponse>;
  /** Window the current stats payload was computed for. */
  statsFor: StatsWindow | null;
}

const EMPTY: Resource<never> = { data: null, error: null };

function initialSnapshot(matchId: string | null): LiveSnapshot {
  return {
    status: "unknown",
    phase: matchId ? "loading" : "idle",
    updatedAt: null,
    stats: EMPTY, ratings: EMPTY, winProb: EMPTY, momentum: EMPTY, shots: EMPTY, agents: EMPTY, tags: EMPTY,
    statsFor: null,
  };
}

function merge<T>(prev: Resource<T>, result: PromiseSettledResult<T> | null): Resource<T> {
  if (result === null) return prev;
  if (result.status === "fulfilled") return { data: result.value, error: null };
  return { data: prev.data, error: describeError(result.reason) };
}

function settle<T>(p: Promise<T>): Promise<PromiseSettledResult<T>> {
  return p.then(
    (value): PromiseSettledResult<T> => ({ status: "fulfilled", value }),
    (reason: unknown): PromiseSettledResult<T> => ({ status: "rejected", reason }),
  );
}

function windowMinutes(w: StatsWindow): number | null {
  return w === "last15" ? 15 : null;
}

export interface LiveDashboard extends LiveSnapshot {
  /** The stats window was just toggled and its payload is still loading. */
  statsPending: boolean;
  /** Restart polling from scratch (after a stop on error). */
  retry: () => void;
}

/**
 * Polls every dashboard endpoint every 3 s while the match status is
 * "running"; one final fetch otherwise (finished match = static data).
 * Last good payloads survive transient errors. All timers / requests are
 * cancelled on unmount or when the match changes.
 */
export function useLiveDashboard(matchId: string | null, statsWindow: StatsWindow): LiveDashboard {
  const [nonce, setNonce] = useState(0);
  const key = `${matchId ?? ""}#${nonce}`;
  // State is tagged with the match/nonce it belongs to, so switching match
  // shows a fresh snapshot without a reset-in-effect.
  const [state, setState] = useState<{ key: string; snap: LiveSnapshot }>(() => ({
    key, snap: initialSnapshot(matchId),
  }));
  const windowRef = useRef(statsWindow);
  const lastWindow = useRef(statsWindow);

  useEffect(() => {
    windowRef.current = statsWindow;
  }, [statsWindow]);

  useEffect(() => {
    if (!matchId) return;
    const update = (fn: (prev: LiveSnapshot) => LiveSnapshot) =>
      setState((prev) => ({ key, snap: fn(prev.key === key ? prev.snap : initialSnapshot(matchId)) }));
    const ctrl = new AbortController();
    const { signal } = ctrl;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tick = 0;
    let statusFailures = 0;

    const run = async () => {
      let status = "unknown";
      try {
        status = String((await fetchLiveStatus(matchId, signal)).status);
        statusFailures = 0;
      } catch {
        if (signal.aborted) return;
        statusFailures += 1;
      }
      const running = status === "running";
      const withTags = tick % TAGS_EVERY_N_TICKS === 0 || !running;
      const requestedWindow = windowRef.current;
      const [stats, ratings, winProb, momentum, shots, agents, tags] = await Promise.all([
        settle(fetchMatchStats(matchId, windowMinutes(requestedWindow), signal)),
        settle(fetchLiveRatings(matchId, signal)),
        settle(fetchWinProbability(matchId, signal)),
        settle(fetchMomentum(matchId, 1, signal)),
        settle(fetchShotMap(matchId, signal)),
        settle(fetchAgentTrace(matchId, signal)),
        withTags ? settle(fetchPlayerTagsLive(matchId, signal)) : Promise.resolve(null),
      ]);
      if (signal.aborted) return;
      const keepPolling = running || (status === "unknown" && statusFailures < MAX_STATUS_FAILURES);
      // Drop a stats payload fetched for a window the user has since switched away from.
      const statsResult = requestedWindow === windowRef.current ? stats : null;
      update((prev) => ({
        status,
        phase: keepPolling ? "live" : "stopped",
        updatedAt: Date.now(),
        stats: merge(prev.stats, statsResult),
        statsFor: statsResult?.status === "fulfilled" ? requestedWindow : prev.statsFor,
        ratings: merge(prev.ratings, ratings),
        winProb: merge(prev.winProb, winProb),
        momentum: merge(prev.momentum, momentum),
        shots: merge(prev.shots, shots),
        agents: merge(prev.agents, agents),
        tags: merge(prev.tags, tags),
      }));
      tick += 1;
      if (keepPolling) timer = setTimeout(() => void run(), POLL_INTERVAL_MS);
    };
    void run();

    return () => {
      ctrl.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [matchId, key]);

  // Toggling the stats window refetches stats right away instead of waiting for the next tick.
  useEffect(() => {
    if (!matchId || lastWindow.current === statsWindow) return;
    lastWindow.current = statsWindow;
    const ctrl = new AbortController();
    void settle(fetchMatchStats(matchId, windowMinutes(statsWindow), ctrl.signal)).then((result) => {
      if (ctrl.signal.aborted) return;
      setState((prev) => prev.key !== key ? prev : {
        key,
        snap: {
          ...prev.snap,
          stats: merge(prev.snap.stats, result),
          statsFor: result.status === "fulfilled" ? statsWindow : prev.snap.statsFor,
        },
      });
    });
    return () => ctrl.abort();
  }, [matchId, key, statsWindow]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const snap = state.key === key ? state.snap : initialSnapshot(matchId);
  const statsPending = snap.statsFor !== null && snap.statsFor !== statsWindow;
  return { ...snap, statsPending, retry };
}

/** Re-renders every `intervalMs` while `active`; returns Date.now(). */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
