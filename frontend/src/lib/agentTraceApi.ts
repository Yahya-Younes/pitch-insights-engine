import type { AgentTraceResponse } from "./agentTraceTypes";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function fetchAgentTrace(matchId: string, signal?: AbortSignal): Promise<AgentTraceResponse> {
  return fetch(`${API_BASE}/matches/${encodeURIComponent(matchId)}/agent-trace`, { signal })
    .then(asJson<AgentTraceResponse>);
}

export function overlayFeedUrl(matchId: string): string {
  return `${API_BASE}/matches/${encodeURIComponent(matchId)}/overlay-feed`;
}

export function overlaySchemaUrl(): string {
  return `${API_BASE}/overlay/schema`;
}
