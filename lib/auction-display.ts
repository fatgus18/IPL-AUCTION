import type { RoomState } from "./auction.ts";

/** Shared display helpers stay independent of the server's player catalog. */
export const PLAYER_ROLES = ["Marquee", "Batter", "Bowler", "All-rounder", "Wicketkeeper"] as const;

/** All monetary values are integer lakhs: 100 lakhs = 1 crore. */
export function formatMoney(lakhs: number): string {
  return lakhs >= 100 ? `₹${(lakhs / 100).toFixed(2)} Cr` : `₹${lakhs} L`;
}

export function getNextBid(state: RoomState): number {
  const player = state.players.find((entry) => entry.id === state.currentPlayerId);
  if (!player) return 0;
  return state.leadingTeamId ? state.currentBid + state.settings.bidIncrement : player.basePrice;
}
