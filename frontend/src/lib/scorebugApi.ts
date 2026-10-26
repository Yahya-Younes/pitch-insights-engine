// Fetchers for the sticky scorebug: live minute/score, latest win
// probability and pipeline status.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function matchUrl(matchId: string, path: string): string {
  return `${API_BASE}/matches/${encodeURIComponent(matchId)}/${path}`;
}

/** GET /matches/{id}/match-stats -- only the fields the scorebug needs. */
export interface ScorebugStats {
  minute: number;
  score: { home: number; away: number };
}

export interface ScorebugWinProb {
  home: number;
  draw: number;
  away: number;
}

export type ScorebugStatus = "running" | "done" | "crashed" | "failed" | (string & {});

export function fetchScorebugStats(matchId: string, signal?: AbortSignal): Promise<ScorebugStats> {
  return fetch(matchUrl(matchId, "match-stats"), { signal }).then(asJson<ScorebugStats>);
}

/** Latest point of GET /matches/{id}/win-probability, or null if the series is empty. */
export async function fetchScorebugWinProb(matchId: string, signal?: AbortSignal): Promise<ScorebugWinProb | null> {
  const res = await fetch(matchUrl(matchId, "win-probability"), { signal })
    .then(asJson<{ series: ScorebugWinProb[] }>);
  const last = res.series[res.series.length - 1];
  return last ? { home: last.home, draw: last.draw, away: last.away } : null;
}

export async function fetchScorebugStatus(matchId: string, signal?: AbortSignal): Promise<ScorebugStatus> {
  const res = await fetch(matchUrl(matchId, "status"), { signal }).then(asJson<{ status: ScorebugStatus }>);
  return res.status;
}
