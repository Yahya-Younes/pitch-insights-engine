export interface RenderDisplay {
  template: string;
  duration_ms: number;
  priority: number;
}

export interface DataPoint {
  label: string;
  value: number | string | boolean;
}

export interface RenderPayload {
  render_id: string;
  match_id: string;
  game_clock: string;
  graphic_type: string;
  narrative_text: string;
  display: RenderDisplay;
  data_points: DataPoint[];
  linked_players: string[];
  source_insight_id: string;
  fact_checked: boolean;
  audio_base64: string | null;
}

export interface PersonalizedMessage {
  match_id: string;
  persona: string;
  text: string;
  audio_base64: string | null;
}

export type OverlayEvent =
  | { kind: "render"; data: RenderPayload }
  | { kind: "personalized"; data: PersonalizedMessage };

export interface LensSummary {
  lens_id: string;
  attributed_style_of: string;
  tone_descriptors: string[];
  tactical_principles: string[];
  sourcing_note: string;
}

export interface RunMatchResponse {
  match_id: string;
  home_team: string;
  away_team: string;
  status: string;
}

export type Persona = "analyst" | "casual_fan" | "player_tracker";

export type Locale = "en" | "fr" | "es" | "de";

export interface PositionFrame {
  t_ms: number;
  ball: [number, number, number];
  players: Record<string, [number, number]>;
}

export interface PositionTrackResponse {
  match_id: string;
  frames: PositionFrame[];
}

export interface WhatIfResponse {
  actual_value: number;
  hypothetical_value: number;
  delta: number;
  explanation: string;
  audio_base64: string | null;
}
