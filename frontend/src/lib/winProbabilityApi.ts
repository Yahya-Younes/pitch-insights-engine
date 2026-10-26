// Client + types for GET /matches/{id}/win-probability
// (service/routers/win_probability.py).

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export type TeamSide = "home" | "away";

export interface WinProbabilityPoint {
  minute: number;
  home: number;
  draw: number;
  away: number;
  home_goals: number;
  away_goals: number;
  home_xg: number;
  away_xg: number;
}

export interface SwingCause {
  kind: "goal" | "big_chance" | "chance" | "time";
  team: TeamSide | null;
  player_name: string | null;
  xg: number | null;
  event_id: string | null;
  match_clock_ms: number | null;
  description: string;
}

export interface SwingMoment {
  minute: number;
  delta_home: number;
  home_before: number;
  home_after: number;
  score_after: string;
  cause: SwingCause;
}

export interface WinProbabilityResponse {
  series: WinProbabilityPoint[];
  swings: SwingMoment[];
  full_time: boolean;
  method: string;
  home_team: string | null;
  away_team: string | null;
}

export function fetchWinProbability(matchId: string, signal?: AbortSignal): Promise<WinProbabilityResponse> {
  return fetch(`${API_BASE}/matches/${encodeURIComponent(matchId)}/win-probability`, { signal })
    .then(asJson<WinProbabilityResponse>);
}
