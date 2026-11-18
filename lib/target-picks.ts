import { AuctionError, type AuctionAction, type Member, type RoomState, type TargetPicks } from "./auction.ts";

export type TargetPicksAction = Extract<AuctionAction, { type: "set_target_picks" }>;
export type PrivateTargetPicks = Record<string, TargetPicks>;

/** A manager owns the research, not the franchise's next manager. */
export function ownTargetPicks(state: RoomState, memberId: string, saved?: PrivateTargetPicks): TargetPicks | undefined {
  const member = state.members.find(entry => entry.id === memberId);
  if (!member || member.id === state.hostId || member.role !== "bidder" || !member.teamId || !state.teams.some(team => team.id === member.teamId)) return undefined;
  const previous = saved?.[member.id];
  return previous?.teamId === member.teamId
    ? { ...previous, playerIds: [...previous.playerIds] }
    : { teamId: member.teamId, playerIds: [], revision: 0 };
}

/** Validation deliberately does not touch the auction or emit a public event. */
export function validateTargetPicks(
  state: RoomState, member: Member, action: TargetPicksAction, saved?: PrivateTargetPicks,
): TargetPicks {
  if (typeof action.teamId !== "string" || !action.teamId) throw new AuctionError("Choose a valid team.");
  const previous = ownTargetPicks(state, member.id, saved);
  if (!previous || member.teamId !== action.teamId) {
    throw new AuctionError("Only this team's manager can edit their target picks.", 403, "FORBIDDEN");
  }
  if (!Number.isSafeInteger(action.expectedRevision) || action.expectedRevision < 0 || action.expectedRevision >= Number.MAX_SAFE_INTEGER) {
    throw new AuctionError("A valid target picks revision is required.");
  }
  if (action.expectedRevision !== previous.revision) {
    throw new AuctionError("Your target picks changed in another tab. Review the latest list before saving again.", 409, "TARGET_PICKS_CONFLICT");
  }
  if (!Array.isArray(action.playerIds) || action.playerIds.some(id => typeof id !== "string" || !id || id.length > 200)) {
    throw new AuctionError("Choose valid players for your target picks.");
  }
  if (new Set(action.playerIds).size !== action.playerIds.length) throw new AuctionError("Each target player can only appear once.");
  const previouslySelected = new Set(previous.playerIds);
  const eligible = new Set(state.players.filter(player => !player.catalogArchived && player.status !== "sold").map(player => player.id));
  if (action.playerIds.some(id => !previouslySelected.has(id) && !eligible.has(id))) {
    throw new AuctionError("A newly selected target is no longer available. Review your list before saving.", 409, "TARGET_UNAVAILABLE");
  }
  return { teamId: action.teamId, playerIds: [...action.playerIds], revision: previous.revision + 1 };
}
