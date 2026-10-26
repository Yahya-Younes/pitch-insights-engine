// Player speed/distance tags + ball/shot speed -- GET /matches/{id}/player-tags
// (service/routers/player_tags.py). Types and helpers live here so PitchView
// (or anything else with a playhead) can reuse them without importing the
// PlayerTags component.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export type TeamSide = "home" | "away" | "unknown";
export type PlayerTagKind = "sprint" | "distance_km" | "top_speed";

export interface PlayerPhysical {
  player_id: string;
  name: string;
  team: TeamSide;
  distance_km: number;
  top_speed_kmh: number;
  top_speed_t_ms: number | null;
  sprints: number;
}

export interface PlayerTag {
  t_ms: number;
  game_clock: string;
  player_id: string;
  kind: PlayerTagKind;
  value: number;
  label: string;
}

export interface ShotSpeed {
  t_ms: number;
  game_clock: string;
  player_id: string;
  name: string;
  team: TeamSide;
  speed_kmh: number;
  xg: number | null;
  outcome: string | null;
}

export interface PassSpeed {
  t_ms: number;
  game_clock: string;
  player_id: string;
  name: string;
  team: TeamSide;
  speed_kmh: number;
  distance_m: number | null;
}

export interface PlayerTagsResponse {
  match_id: string;
  duration_ms: number | null;
  players: PlayerPhysical[];
  tags: PlayerTag[];
  shots: ShotSpeed[];
  fastest_shot: ShotSpeed | null;
  fastest_pass: PassSpeed | null;
  passes_counted: number;
  speed_samples_excluded_pct: number;
  thresholds: {
    sprint_kmh: number;
    max_plausible_kmh: number;
    smoothing_window_ms: number;
    pitch_m: [number, number];
  };
  method: string;
}

export function fetchPlayerTags(matchId: string): Promise<PlayerTagsResponse> {
  return fetch(`${API_BASE}/matches/${encodeURIComponent(matchId)}/player-tags`).then(
    asJson<PlayerTagsResponse>,
  );
}

/** Index of the first tag with t_ms > tMs (tags must be sorted by t_ms, as the API returns them). */
function upperBound(tags: readonly PlayerTag[], tMs: number): number {
  let lo = 0;
  let hi = tags.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((tags[mid]?.t_ms ?? Infinity) <= tMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Tags that should currently be "popped up" at playhead tMs: fired within the
 * last windowMs of match time. This is what a pitch overlay would draw next to
 * each player's dot.
 */
export function activeTagsAt(tags: readonly PlayerTag[], tMs: number, windowMs = 4000): PlayerTag[] {
  const end = upperBound(tags, tMs);
  const start = upperBound(tags, tMs - windowMs);
  return tags.slice(start, end);
}

/** The most recent `count` tags at or before tMs, newest first (for a ticker). */
export function recentTagsAt(tags: readonly PlayerTag[], tMs: number, count: number): PlayerTag[] {
  const end = upperBound(tags, tMs);
  return tags.slice(Math.max(0, end - count), end).reverse();
}
