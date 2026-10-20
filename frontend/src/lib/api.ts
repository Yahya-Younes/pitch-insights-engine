import type { LensSummary, Persona, RunMatchResponse } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function fetchLenses(): Promise<LensSummary[]> {
  return fetch(`${API_BASE}/lenses`).then(asJson<LensSummary[]>);
}

export function negotiate(): Promise<{ url: string }> {
  return fetch(`${API_BASE}/negotiate`).then(asJson<{ url: string }>);
}

export function runMatch(opts: { persona: Persona; lensId: string | null; seed?: number }): Promise<RunMatchResponse> {
  return fetch(`${API_BASE}/matches/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona: opts.persona, lens_id: opts.lensId, seed: opts.seed }),
  }).then(asJson<RunMatchResponse>);
}
