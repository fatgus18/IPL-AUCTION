import type { RoomState } from "./auction.ts";

/** The static loading shell has no room data. Authenticated restoration supplies it. */
export function createBootstrapState(): RoomState {
  return {
    id: "", code: "", name: "", version: 0, createdAt: 0, serverTime: 0, hostId: "",
    members: [], players: [], teams: [],
    currentPlayerId: null, currentBid: 0, leadingTeamId: null,
    phase: "waiting", lastBidAt: null, bidHistory: [], activity: [],
    settings: {
      purse: 0, maxSquadSize: 0, maxOverseas: 0,
      bidCooldownMs: 0, bidIncrement: 0, callUrl: "",
    },
  };
}
