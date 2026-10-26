// Player ratings for the "Joueurs" tab / player drawer.
//   GET /matches/{id}/live-ratings          (note /10, recomputed every minute)
//   GET /matches/{id}/player-ratings        (six 0-99 attributes + raw stats)
//   GET /matches/{id}/players/{pid}/heatmap (occupancy grid)
// The tab and the drawer both read the same match, so fetches are shared
// through a tiny TTL cache instead of firing twice.

import { useCallback, useEffect, useState } from "react";
import { shirtNumber } from "./matchContext";
import {
  asPosition,
  type LiveMotm,
  type LiveRatingsResponse,
  type MatchPlayer,
  type PlayerHeatmapResponse,
  type PlayerRatingsResponse,
  type Side,
} from "./playersTypes";

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

const CACHE_TTL_MS = 8000;
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>, force = false): Promise<T> {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise as Promise<T>;
  const promise = load();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

const enc = encodeURIComponent;

export function fetchLiveRatings(matchId: string, force = false): Promise<LiveRatingsResponse> {
  return cached(`live:${matchId}`, () =>
    fetch(`${API_BASE}/matches/${enc(matchId)}/live-ratings`).then(asJson<LiveRatingsResponse>), force);
}

export function fetchPlayerRatings(matchId: string, force = false): Promise<PlayerRatingsResponse> {
  return cached(`attrs:${matchId}`, () =>
    fetch(`${API_BASE}/matches/${enc(matchId)}/player-ratings`).then(asJson<PlayerRatingsResponse>), force);
}

export function fetchPlayerHeatmap(
  matchId: string, playerId: string, cols = 12, rows = 8,
): Promise<PlayerHeatmapResponse> {
  return cached(`heat:${matchId}:${playerId}:${cols}x${rows}`, () =>
    fetch(`${API_BASE}/matches/${enc(matchId)}/players/${enc(playerId)}/heatmap?cols=${cols}&rows=${rows}`)
      .then(asJson<PlayerHeatmapResponse>));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asSide(team: string): Side {
  return team === "away" ? "away" : "home";
}

/** Merge /live-ratings and /player-ratings into one list (either may be missing). */
export function mergePlayers(
  live: LiveRatingsResponse | null, attrs: PlayerRatingsResponse | null,
): MatchPlayer[] {
  const byId = new Map<string, MatchPlayer>();
  for (const a of attrs?.players ?? []) {
    byId.set(a.player_id, {
      id: a.player_id,
      name: a.name,
      number: shirtNumber(a.player_id),
      team: asSide(a.team),
      position: asPosition(a.position),
      rating: null,
      delta10: null,
      breakdown: [],
      series: [],
      attributes: a.attributes,
      raw: a.raw,
    });
  }
  for (const l of live?.players ?? []) {
    const prev = byId.get(l.player_id);
    byId.set(l.player_id, {
      id: l.player_id,
      name: l.name || prev?.name || l.player_id,
      number: String(l.number ?? prev?.number ?? shirtNumber(l.player_id)),
      team: l.team,
      position: asPosition(l.position) ?? prev?.position ?? null,
      rating: l.rating,
      delta10: l.delta_10min,
      breakdown: l.breakdown,
      series: l.series,
      attributes: prev?.attributes ?? null,
      raw: prev?.raw ?? null,
    });
  }
  return [...byId.values()];
}

export interface PlayersData {
  /** "loading" only until the first answer for this match. */
  status: "idle" | "loading" | "ready" | "error";
  players: MatchPlayer[];
  /** Live note /10 leader, null if unavailable. */
  motm: LiveMotm | null;
  /** Fallback when /live-ratings is unavailable: /player-ratings' pick (no /10 note). */
  fallbackMotm: { player_id: string; reason: string } | null;
  minute: number | null;
  liveAvailable: boolean;
  /** Error from /live-ratings (non-fatal when attributes loaded). */
  liveError: string | null;
  /** Error from /player-ratings (non-fatal when live loaded). */
  attrsError: string | null;
  error: string | null;
  reload: () => void;
}

interface Snapshot {
  matchId: string;
  live: LiveRatingsResponse | null;
  attrs: PlayerRatingsResponse | null;
  liveError: string | null;
  attrsError: string | null;
  done: boolean;
}

const LIVE_POLL_MS = 20_000;
const ATTRS_EVERY_N_POLLS = 3;

/** Live note + attributes for every player of the match, refreshed every 20 s. */
export function usePlayersData(matchId: string | null): PlayersData {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    let tick = 0;

    const load = async (force: boolean, withAttrs: boolean) => {
      const [live, attrs] = await Promise.allSettled([
        fetchLiveRatings(matchId, force),
        withAttrs ? fetchPlayerRatings(matchId, force) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setSnap((prev) => {
        const base = prev?.matchId === matchId ? prev : null;
        return {
          matchId,
          live: live.status === "fulfilled" ? live.value : (base?.live ?? null),
          liveError: live.status === "rejected" ? errorText(live.reason) : null,
          attrs: attrs.status === "fulfilled" ? (attrs.value ?? base?.attrs ?? null) : (base?.attrs ?? null),
          attrsError: attrs.status === "rejected" ? errorText(attrs.reason) : (base?.attrsError ?? null),
          done: true,
        };
      });
    };

    void load(nonce > 0, true);
    const id = window.setInterval(() => {
      tick += 1;
      void load(true, tick % ATTRS_EVERY_N_POLLS === 0);
    }, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [matchId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const current = matchId && snap?.matchId === matchId ? snap : null;
  if (!matchId) {
    return {
      status: "idle", players: [], motm: null, fallbackMotm: null, minute: null, liveAvailable: false,
      liveError: null, attrsError: null, error: null, reload,
    };
  }
  if (!current) {
    return {
      status: "loading", players: [], motm: null, fallbackMotm: null, minute: null, liveAvailable: false,
      liveError: null, attrsError: null, error: null, reload,
    };
  }
  const players = mergePlayers(current.live, current.attrs);
  const failed = !current.live && !current.attrs;
  const fallback = current.attrs?.man_of_the_match ?? null;
  return {
    status: failed ? "error" : "ready",
    players,
    motm: current.live?.motm ?? null,
    fallbackMotm: fallback ? { player_id: fallback.player_id, reason: fallback.reason } : null,
    minute: current.live?.minute ?? null,
    liveAvailable: current.live !== null,
    liveError: current.liveError,
    attrsError: current.attrsError,
    error: failed ? (current.liveError ?? current.attrsError ?? "Données joueurs indisponibles") : null,
    reload,
  };
}
