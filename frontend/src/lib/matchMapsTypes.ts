// Response shapes for service/routers/match_maps.py.

export type TeamSide = "home" | "away";
export type Point = [number, number];

export interface ThreatMoment {
  event_id: string;
  action: "interception" | "tackle";
  team: TeamSide;
  player_id: string;
  player_name: string;
  minute: number;
  second: number;
  location: Point;
  valued_at: Point;
  basis: string;
  xt_prevented: number;
}

export interface ThreatPlayer {
  player_id: string;
  player_name: string;
  team: TeamSide;
  xt_prevented: number;
  actions: number;
  interceptions: number;
  tackles_won: number;
}

export interface ThreatTeam {
  team_name: string;
  xt_prevented: number;
  actions: number;
}

export interface ThreatPreventedResponse {
  match_id: string;
  teams: Record<TeamSide, ThreatTeam>;
  players: ThreatPlayer[];
  top_moments: ThreatMoment[];
  n_actions: number;
  by_action: Partial<Record<"interception" | "tackle", number>>;
  all_moments_total: number;
  method: string;
}

export interface Shot {
  event_id: string;
  team: TeamSide;
  player_id: string;
  player_name: string;
  minute: number;
  second: number;
  location: Point;
  end_location: Point;
  xg: number;
  outcome: "goal" | "saved" | "blocked" | "off_target";
  shot_speed_kmh: number;
}

export interface ShotTeamTotals {
  shots: number;
  xg: number;
  goals: number;
  on_target: number;
  team_name: string;
}

export interface ShotMapResponse {
  match_id: string;
  shots: Shot[];
  teams: Record<TeamSide, ShotTeamTotals>;
}

export interface PassNode {
  player_id: string;
  player_name: string;
  avg_location: Point;
  passes: number;
  received: number;
  involvement: number;
}

export interface PassEdge {
  source: string;
  target: string;
  count: number;
}

export interface PassNetworkResponse {
  match_id: string;
  team: TeamSide;
  team_name: string;
  min_edge_count: number;
  completed_passes: number;
  nodes: PassNode[];
  edges: PassEdge[];
  max_edge_count: number;
}
