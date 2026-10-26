// Types for the "Joueurs" tab and the player drawer:
//   GET /matches/{id}/live-ratings              -> LiveRatingsResponse (note /10)
//   GET /matches/{id}/player-ratings            -> PlayerRatingsResponse (attributes 0-99)
//   GET /matches/{id}/players/{pid}/heatmap     -> PlayerHeatmapResponse
import { shortName } from "./matchContext";

export type Side = "home" | "away";
export type PositionCode = "GK" | "CB" | "FB" | "CM" | "WM" | "FW";

// ---- /live-ratings -------------------------------------------------------

export interface BreakdownItem {
  label: string;
  points: number;
  count: number;
}

export interface RatingPoint {
  minute: number;
  rating: number;
}

export interface LivePlayerRating {
  player_id: string;
  number: number | string;
  name: string;
  team: Side;
  position: string | null;
  /** Note /10 (3-10, one decimal) -- the big number on the cards. */
  rating: number;
  delta_10min: number;
  breakdown: BreakdownItem[];
  series: RatingPoint[];
}

export interface LiveMotm {
  player_id: string;
  name: string;
  rating: number;
  leader_since_minute: number;
  reason: string;
}

export interface LiveRatingsResponse {
  minute: number;
  players: LivePlayerRating[];
  motm: LiveMotm | null;
  method: string;
}

// ---- /player-ratings -----------------------------------------------------

export interface PlayerAttributes {
  passing: number;
  shooting: number;
  pace: number;
  defending: number;
  work_rate: number;
  involvement: number;
}

export type AttributeKey = keyof PlayerAttributes;

export interface PlayerRawStats {
  passes_attempted: number;
  passes_completed: number;
  pass_pct: number;
  xg: number;
  shots: number;
  shots_on_target: number;
  goals: number;
  xt_added: number;
  threat_prevented: number;
  ball_wins: number;
  top_speed_kmh: number;
  sprints: number;
  distance_km: number;
  touches: number;
  passes_received: number;
}

export interface AttributePlayer {
  player_id: string;
  name: string;
  team: string;
  position: string | null;
  /** 40-99 FIFA-style overall -- deliberately not displayed (the /10 note is). */
  rating: number;
  attributes: PlayerAttributes;
  raw: PlayerRawStats;
}

export interface PlayerRatingsResponse {
  match_id: string;
  players: AttributePlayer[];
  man_of_the_match: { player_id: string; rating: number; reason: string } | null;
  method: string;
}

// ---- /players/{pid}/heatmap ----------------------------------------------

export interface PlayerHeatmapResponse {
  match_id: string;
  player_id: string;
  name: string;
  team: string;
  grid: { cols: number; rows: number };
  /** rows x cols, 0-1; row 0 = y near 0, col 0 = x near 0 (StatsBomb 120x80). */
  cells: number[][];
  samples: number;
  source: string;
  touches: number;
  attack_direction: string | null;
}

// ---- merged view model ---------------------------------------------------

/** One player as the UI sees it: live note /10 merged with match attributes. */
export interface MatchPlayer {
  id: string;
  name: string;
  number: string;
  team: Side;
  position: PositionCode | null;
  /** Note /10, null when /live-ratings is unavailable. */
  rating: number | null;
  delta10: number | null;
  breakdown: BreakdownItem[];
  series: RatingPoint[];
  attributes: PlayerAttributes | null;
  raw: PlayerRawStats | null;
}

/** Display order of the six attributes (card grid columns + radar axes). */
export const ATTRIBUTE_ORDER: readonly AttributeKey[] = [
  "pace", "shooting", "passing", "defending", "work_rate", "involvement",
];

export const ATTRIBUTE_META: Record<AttributeKey, { code: string; label: string }> = {
  pace: { code: "PAC", label: "Vitesse" },
  shooting: { code: "TIR", label: "Tir" },
  passing: { code: "PAS", label: "Passe" },
  defending: { code: "DEF", label: "Défense" },
  work_rate: { code: "VOL", label: "Volume" },
  involvement: { code: "IMP", label: "Implication" },
};

export const POSITION_LABELS: Record<PositionCode, string> = {
  GK: "Gardien",
  CB: "Défenseur central",
  FB: "Latéral",
  CM: "Milieu",
  WM: "Milieu excentré",
  FW: "Attaquant",
};

export function asPosition(value: string | null | undefined): PositionCode | null {
  return value && value in POSITION_LABELS ? (value as PositionCode) : null;
}

export function positionLabel(pos: PositionCode | null): string {
  return pos ? POSITION_LABELS[pos] : "Poste inconnu";
}

// signDisplay "negative": values that round to zero print "0,0", never "-0,0".
const FR_1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "negative" });
const FR_2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** 8.4 -> "8,4" */
export function formatRating(rating: number): string {
  return FR_1.format(rating);
}

/** Signed points: 0.15 -> "+0,15", -0.3 -> "−0,3"; anything that rounds to zero -> "0,0". */
export function formatPoints(points: number): string {
  const rounded = Math.round(points * 100) / 100;
  const abs = FR_2.format(Math.abs(rounded));
  return `${rounded < 0 ? "−" : rounded > 0 ? "+" : ""}${abs}`;
}

export function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, signDisplay: "negative" }).format(value);
}

/** "Rafael Donnelly" -> "R. DONNELLY". Keeps the initial: the simulator
 * reuses surnames within a squad, so a bare surname is ambiguous. */
export function cardName(name: string): string {
  return shortName(name).toUpperCase();
}
