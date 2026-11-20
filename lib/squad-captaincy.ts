import type { Player, Team, TeamLineupInput } from "./auction";

export type SquadCaptaincy = Pick<TeamLineupInput, "captainId" | "viceCaptainId">;

/** Leadership belongs to the purchased squad, independently of XI and bench positions. */
export function getSquadCaptaincy(team: Team, players: readonly Player[]): SquadCaptaincy {
  const owned = new Set(team.squad.map(purchase => purchase.playerId));
  const purchased = new Set(players.filter(player => player.status === "sold" && player.soldTo === team.id && owned.has(player.id)).map(player => player.id));
  const captainId = team.lineup?.captainId && purchased.has(team.lineup.captainId) ? team.lineup.captainId : null;
  const viceCaptainId = team.lineup?.viceCaptainId && purchased.has(team.lineup.viceCaptainId) && team.lineup.viceCaptainId !== captainId ? team.lineup.viceCaptainId : null;
  return { captainId, viceCaptainId };
}
