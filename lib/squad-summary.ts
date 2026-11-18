import type { RoomState, Team } from "./auction";
import { countPlayingRoles } from "./player-roles.ts";

/** Ended auctions retain the manager recorded at completion, even after they leave. */
export function getSquadManager(state: RoomState, teamId: string): { id: string; name: string } | null {
  if (state.endedAt !== undefined) return state.completedManagers?.[teamId] ??
    state.members.find(member => member.teamId === teamId && member.role === "bidder") ?? null;
  return state.members.find(member => member.teamId === teamId && member.role === "bidder") ?? null;
}

/** Derive comparisons from the current purchases, including any audited sale corrections. */
export function summarizeSquad(state: RoomState, team: Team) {
  const playerMap = new Map(state.players.map(player => [player.id, player]));
  const purchased = new Set(team.squad.map(purchase => purchase.playerId));
  const players = team.squad.map(purchase => playerMap.get(purchase.playerId));
  const playingXI = new Set((team.lineup?.playingXI ?? []).filter((id): id is string => !!id && purchased.has(id)));
  const substitutes = new Set((team.lineup?.substitutes ?? []).filter((id): id is string => !!id && purchased.has(id) && !playingXI.has(id)));
  const leader = (id: string | null | undefined) => id && playingXI.has(id) ? playerMap.get(id) ?? null : null;
  const spent = team.squad.reduce((total, purchase) => total + purchase.amount, 0);
  return {
    manager: getSquadManager(state, team.id),
    startingBudget: state.settings.purse,
    spent,
    remaining: team.purse,
    spentPercent: state.settings.purse > 0 ? Math.max(0, Math.min(100, spent * 100 / state.settings.purse)) : 0,
    spots: team.squad.length,
    overseas: players.filter(player => player?.isOverseas).length,
    roles: countPlayingRoles(players),
    playingXI: playingXI.size,
    substitutes: substitutes.size,
    captain: leader(team.lineup?.captainId),
    viceCaptain: leader(team.lineup?.viceCaptainId),
  };
}
