import type {
  PassNetworkResponse, ShotMapResponse, TeamSide, ThreatPreventedResponse,
} from "./matchMapsTypes";

// Same base URL resolution as lib/api.ts (kept local so this feature owns its client).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export function fetchThreatPrevented(matchId: string, signal?: AbortSignal): Promise<ThreatPreventedResponse> {
  return fetch(`${API_BASE}/matches/${enc(matchId)}/threat-prevented`, { signal })
    .then(asJson<ThreatPreventedResponse>);
}

export function fetchShotMap(matchId: string, signal?: AbortSignal): Promise<ShotMapResponse> {
  return fetch(`${API_BASE}/matches/${enc(matchId)}/shot-map`, { signal }).then(asJson<ShotMapResponse>);
}

export function fetchPassNetwork(
  matchId: string, team: TeamSide, minCount = 3, signal?: AbortSignal,
): Promise<PassNetworkResponse> {
  return fetch(`${API_BASE}/matches/${enc(matchId)}/pass-network?team=${team}&min_count=${minCount}`, { signal })
    .then(asJson<PassNetworkResponse>);
}
