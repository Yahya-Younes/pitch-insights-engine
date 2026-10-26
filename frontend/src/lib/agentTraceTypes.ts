// Mirrors service/routers/agent_trace.py + agents/orchestrator/agent_trace.py.

export type AgentKind = "deterministic" | "llm" | "llm+verifier";
export type HandoffPath = "llm" | "fallback" | "rules";

export interface AgentTraceAgent {
  stage: string;
  name: string;
  role: string;
  kind: AgentKind;
  processed: number;
  outputs: number;
  /** null = not recorded (pre-instrumentation entries); 0 for deterministic agents. */
  llm_calls: number | null;
  fallbacks: number;
  grounding_failures: number;
  llm_outages: number;
  avg_duration_ms: number | null;
  last_activity_ts: number | null;
}

export interface AgentTraceTimelineRow {
  t: number;
  stage: string;
  label: string;
  path: HandoffPath;
  insight_id?: string;
  duration_ms?: number;
}

export interface AgentTraceTotals {
  insights: number;
  verified: number;
  fell_back: number;
  persona_fallbacks: number;
  grounding_failures: number;
  llm_outages: number;
  llm_calls: number | null;
  overlays: number;
  handoffs: number;
  elapsed_s: number;
}

export interface AgentTraceResponse {
  match_id: string;
  status: string | null;
  agents: AgentTraceAgent[];
  timeline: AgentTraceTimelineRow[];
  totals: AgentTraceTotals;
  started_at: number | null;
}
