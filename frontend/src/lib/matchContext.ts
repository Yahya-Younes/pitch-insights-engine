import { createContext, useContext } from "react";
import type { LensSummary, PersonalizedMessage, RenderPayload, RunMatchResponse } from "./types";

/** Shared state for every tab: the current match, its live overlay feed, and
 * the "follow a player" / "open player drawer" interactions that any tab can
 * trigger. Provided once by App.tsx. */
export interface MatchContextValue {
  match: RunMatchResponse | null;
  matchId: string | null;
  homeTeam: string;
  awayTeam: string;
  renderEvents: RenderPayload[];
  personalizedEvents: PersonalizedMessage[];
  lenses: LensSummary[];
  /** Player followed across tabs (pitch ring, commentary focus). */
  followedPlayerId: string | null;
  setFollowedPlayerId: (playerId: string | null) => void;
  /** Opens the player drawer (FC card, radar, heatmap, moments). */
  openPlayer: (playerId: string) => void;
}

export const MatchContext = createContext<MatchContextValue | null>(null);

export function useMatch(): MatchContextValue {
  const ctx = useContext(MatchContext);
  if (!ctx) throw new Error("useMatch must be used inside <MatchContext.Provider>");
  return ctx;
}

/** "Rafael Donnelly" -> "R. Donnelly". The simulator reuses surnames within a
 * squad, so a bare surname is ambiguous -- always show the initial. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName.trim();
  const first = parts[0] ?? "";
  return `${first.charAt(0)}. ${parts.slice(1).join(" ")}`;
}

/** Synthetic player ids look like "home_10" -- the suffix doubles as the shirt number. */
export function shirtNumber(playerId: string): string {
  return playerId.split("_").pop() ?? "";
}
