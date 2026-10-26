// API client + types for "Try to make it lie" (service/routers/make_it_lie.py).

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export type TamperAttack = "fake_number" | "wrong_player" | "real_club_leak" | "custom";
export type Verdict = "passed" | "rejected";

export interface GroundingReasons {
  numeric_ok: boolean;
  entity_ok: boolean;
  vocabulary_ok: boolean;
  real_world_ok: boolean;
  unmatched_numbers: string[];
  unmatched_entities: string[];
  real_world_leaks: string[];
  off_topic: boolean;
}

export interface TamperTrace {
  match_id: string;
  insight_id: string;
  trigger_type: string;
  attack: TamperAttack;
  checker: string;
  original_text: string;
  original_verdict: Verdict;
  tampered_text: string;
  verdict: Verdict;
  reasons: GroundingReasons;
  corrected_text: string | null;
  corrected_verdict: Verdict | null;
  corrected_reasons: GroundingReasons | null;
  shipped: "corrected" | "tampered";
}

export interface AttackBreakdown {
  attack: string;
  label: string;
  planted: number;
  caught: number;
}

export interface VerificationHeadline {
  planted: number;
  caught: number;
  reached_air: number;
  false_positives: number;
  clean_tested: number;
  precision: number;
  recall: number;
  fallbacks_verified: number;
  fixtures: number;
  by_attack: AttackBreakdown[];
  elapsed_ms: number;
  method: string;
  cached: boolean;
  cache_age_s: number;
}

export function tamperNarration(
  matchId: string, attack: TamperAttack, opts: { insightId?: string; customText?: string } = {},
): Promise<TamperTrace> {
  return fetch(`${API_BASE}/matches/${encodeURIComponent(matchId)}/tamper`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      attack,
      insight_id: opts.insightId ?? null,
      custom_text: opts.customText ?? null,
    }),
  }).then(asJson<TamperTrace>);
}

export function fetchVerificationHeadline(): Promise<VerificationHeadline> {
  return fetch(`${API_BASE}/verification/headline`).then(asJson<VerificationHeadline>);
}
