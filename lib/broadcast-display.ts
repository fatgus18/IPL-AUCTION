import type { RoomState } from "./auction";

/** The broadcast display receives public auction facts, never personal room data. */
export type BroadcastState = Pick<RoomState,
  "code" | "name" | "players" | "teams" | "currentPlayerId" | "currentBid" | "leadingTeamId" | "phase" | "endedAt" | "auctionPausedAt"
> & {
  settings: Pick<RoomState["settings"], "maxSquadSize" | "bidIncrement">;
  bidHistory: Pick<RoomState["bidHistory"][number], "id" | "playerId" | "teamId" | "amount">[];
};

export function toBroadcastState(state: RoomState): BroadcastState {
  return {
    code: state.code,
    name: state.name,
    players: state.players,
    teams: state.teams,
    currentPlayerId: state.currentPlayerId,
    currentBid: state.currentBid,
    leadingTeamId: state.leadingTeamId,
    phase: state.phase,
    endedAt: state.endedAt,
    auctionPausedAt: state.auctionPausedAt,
    settings: { maxSquadSize: state.settings.maxSquadSize, bidIncrement: state.settings.bidIncrement },
    bidHistory: state.bidHistory.map(({ id, playerId, teamId, amount }) => ({ id, playerId, teamId, amount })),
  };
}
