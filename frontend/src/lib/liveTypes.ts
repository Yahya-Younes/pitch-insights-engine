// Response shapes for the "Suivi live" dashboard endpoints:
//   GET /matches/{id}/match-stats?last_minutes=N
//   GET /matches/{id}/live-ratings
//   GET /matches/{id}/momentum?bucket_min=1
//   GET /matches/{id}/status

export type Side = "home" | "away";

export interface MatchStat {
  key: string;
  label: string;
  home: number;
  away: number;
  home_display: string;
  away_display: string;
  higher_is_better: boolean;
}

export interface MatchStatsResponse {
  match_id: string;
  minute: number;
  score: { home: number; away: number };
  window: { from_min: number; to_min: number };
  stats: MatchStat[];
}

export interface RatingBreakdownItem {
  label: string;
  points: number;
  count: number;
}

export interface RatingPoint {
  minute: number;
  rating: number;
}

export interface LivePlayerRating {
  player_id: string;
  number: number;
  name: string;
  team: Side;
  position: string | null;
  /** 3-10, one decimal. */
  rating: number;
  delta_10min: number;
  breakdown: RatingBreakdownItem[];
  series: RatingPoint[];
}

export interface ManOfTheMatch {
  player_id: string;
  name: string;
  rating: number;
  leader_since_minute: number;
  reason: string;
}

export interface LeaderChange {
  minute: number;
  player_id: string;
}

export interface LiveRatingsResponse {
  match_id: string;
  minute: number;
  /** Sorted by rating, descending. */
  players: LivePlayerRating[];
  motm: ManOfTheMatch | null;
  leader_history: LeaderChange[];
  method: string;
}

export interface MomentumBucket {
  minute: number;
  home_xt: number;
  away_xt: number;
  /** -1 (away dominates) .. +1 (home dominates). */
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

export type LiveMatchStatus = "running" | "done" | "crashed" | "failed";

export interface LiveStatusResponse {
  status: LiveMatchStatus | string;
  home_team?: string;
  away_team?: string;
}

/** One polled endpoint: last good payload (kept across transient failures) + last error. */
export interface Resource<T> {
  data: T | null;
  error: string | null;
}

export type StatsWindow = "match" | "last15";
