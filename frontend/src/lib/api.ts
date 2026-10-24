import type {
  LensSummary, Locale, MatchTacticsResponse, Persona, PositionTrackResponse, RunMatchResponse, WhatIfResponse,
} from "./types";

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

export function runMatch(opts: {
  persona: Persona; lensId: string | null; seed?: number; injectFault?: boolean;
  injectCrash?: boolean; locale?: Locale;
}): Promise<RunMatchResponse> {
  return fetch(`${API_BASE}/matches/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      persona: opts.persona, lens_id: opts.lensId, seed: opts.seed,
      inject_fault: opts.injectFault ?? false, inject_crash: opts.injectCrash ?? false,
      locale: opts.locale ?? "en",
    }),
  }).then(asJson<RunMatchResponse>);
}

export interface MatchStatusResponse {
  status: "running" | "done" | "crashed" | "failed";
  checkpoint_id?: string | null;
  home_team?: string;
  away_team?: string;
}

export function fetchMatchStatus(matchId: string): Promise<MatchStatusResponse> {
  return fetch(`${API_BASE}/matches/${matchId}/status`).then(asJson<MatchStatusResponse>);
}

export function resumeMatch(matchId: string): Promise<RunMatchResponse> {
  return fetch(`${API_BASE}/matches/${matchId}/resume`, { method: "POST" }).then(asJson<RunMatchResponse>);
}

export function fetchPositions(matchId: string): Promise<PositionTrackResponse> {
  return fetch(`${API_BASE}/matches/${matchId}/positions`).then(asJson<PositionTrackResponse>);
}

export function fetchTactics(matchId: string): Promise<MatchTacticsResponse> {
  return fetch(`${API_BASE}/matches/${matchId}/tactics`).then(asJson<MatchTacticsResponse>);
}

export function whatIf(matchId: string, insightId: string, knob: Record<string, unknown>): Promise<WhatIfResponse> {
  return fetch(`${API_BASE}/matches/${matchId}/whatif`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ insight_id: insightId, knob }),
  }).then(asJson<WhatIfResponse>);
}

export interface RealismMetric {
  metric: string;
  value: number;
  reference_range: [number, number];
  in_range: boolean;
}

export interface StatsResponse {
  tendency_recovery: { dominant_action_recovery_accuracy: number; n_players_evaluated: number; method: string };
  grounding: { narrator_pass_rate: number | null; concierge_pass_rate: number | null; combined_pass_rate: number | null; sample_size: number };
  robustness: { corruptions_caught: number; corruptions_total: number; catch_rate: number; false_positives: number; legitimate_total: number; method: string };
  realism: {
    metrics: RealismMetric[]; in_range_count: number; total_count: number; n_matches_averaged: number; method: string;
    real_data_source: {
      source: string; attribution: string; seasons_sampled_from: string[];
      n_matches: number; n_matches_available_total: number; generated_at: string;
    };
  };
  formation_detection: {
    shift_detection_rate: number | null; mean_timing_error_min: number | null;
    n_team_matches_with_a_real_shift: number; method: string;
  };
}

export function fetchStats(): Promise<StatsResponse> {
  return fetch(`${API_BASE}/stats`).then(asJson<StatsResponse>);
}

export interface AskResponse {
  answer: string;
  fact_checked: boolean;
  audio_base64: string | null;
}

export function askMatch(matchId: string, question: string, locale: Locale = "en"): Promise<AskResponse> {
  return fetch(`${API_BASE}/matches/${matchId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, locale }),
  }).then(asJson<AskResponse>);
}
