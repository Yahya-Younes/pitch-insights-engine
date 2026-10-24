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
  fine_tuned_narrator:
    | {
        available: true; job_id: string; base_model: string; deployment_name: string;
        training_examples: number; trigger_type: string;
        production_narration: string; fine_tuned_narration: string; fine_tuned_grounded: boolean;
        method: string;
      }
    | { available: false; reason: string; job_id?: string };
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

export interface TacticsLabResult {
  home_formation: string;
  away_formation: string;
  n_matches: number;
  home_record: { wins: number; draws: number; losses: number; win_pct: number; draw_pct: number; loss_pct: number };
  mean_home_goals: number | null;
  mean_away_goals: number | null;
  mean_home_xg: number | null;
  mean_away_xg: number | null;
  mean_home_possession_pct: number | null;
  mean_home_ppda: number | null;
  mean_away_ppda: number | null;
  method: string;
}

export function fetchFormations(): Promise<{ formations: string[] }> {
  return fetch(`${API_BASE}/tactics-lab/formations`).then(asJson<{ formations: string[] }>);
}

export function simulateTacticsMatchup(
  homeFormation: string, awayFormation: string, nMatches: number,
): Promise<TacticsLabResult> {
  return fetch(`${API_BASE}/tactics-lab/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ home_formation: homeFormation, away_formation: awayFormation, n_matches: nMatches }),
  }).then(asJson<TacticsLabResult>);
}

export interface CompareResponse {
  match_id: string;
  left: { persona: string; lens_id: string | null; player_id: string | null; text: string };
  right: { persona: string; lens_id: string | null; player_id: string | null; text: string };
}

export function compareMatch(
  matchId: string, personaA: string, personaB: string,
  opts: { lensIdA?: string | null; lensIdB?: string | null; locale?: Locale } = {},
): Promise<CompareResponse> {
  return fetch(`${API_BASE}/matches/${matchId}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      persona_a: personaA, persona_b: personaB,
      lens_id_a: opts.lensIdA ?? null, lens_id_b: opts.lensIdB ?? null,
      locale: opts.locale ?? "en",
    }),
  }).then(asJson<CompareResponse>);
}
