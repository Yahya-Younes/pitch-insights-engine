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
}

export interface PersonalizedMessage {
  match_id: string;
  persona: string;
  text: string;
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
