import { AuctionError, type AuctionAction, type Member, type RoomState, type TargetPicks } from "./auction.ts";
import { getTargetPlayerIds, isTargetPlayerEligible, targetBackupId } from "./target-chains.ts";

export type TargetPicksAction = Extract<AuctionAction, { type: "set_target_picks" }>;
export type PrivateTargetPicks = Record<string, TargetPicks>;
const unsafeBudgetKeys = new Set(["__proto__", "prototype", "constructor"]);

/** A manager owns the research, not the franchise's next manager. */
export function ownTargetPicks(state: RoomState, memberId: string, saved?: PrivateTargetPicks): TargetPicks | undefined {
  const member = state.members.find(entry => entry.id === memberId);
  if (!member || member.id === state.hostId || member.role !== "bidder" || !member.teamId || !state.teams.some(team => team.id === member.teamId)) return undefined;
  const previous = saved && Object.hasOwn(saved, member.id) ? saved[member.id] : undefined;
  return previous?.teamId === member.teamId
    ? {
      teamId: previous.teamId, playerIds: [...previous.playerIds], revision: previous.revision,
      ...(previous.backups && Object.keys(previous.backups).length ? { backups: { ...previous.backups } } : {}),
      ...(previous.maxBids && Object.keys(previous.maxBids).length ? { maxBids: { ...previous.maxBids } } : {}),
    }
    : { teamId: member.teamId, playerIds: [], revision: 0 };
}

/** Validation deliberately does not touch the auction or emit a public event. */
export function validateTargetPicks(
  state: RoomState, member: Member, action: TargetPicksAction, saved?: PrivateTargetPicks,
): TargetPicks {
  if (state.endedAt !== undefined) throw new AuctionError("This auction has ended. Your saved targets remain available to view.", 409, "AUCTION_ENDED");
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
  const firstChoices = new Set(action.playerIds);
  let backupEntries: [string, string][];
  if (action.backups !== undefined) {
    const value = action.backups;
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new AuctionError("Choose one valid backup for each first choice.", 400, "INVALID_TARGET_BACKUP");
    }
    backupEntries = Object.entries(value);
    const usedBackups = new Set<string>();
    for (const [firstChoiceId, backupId] of backupEntries) {
      if (!firstChoices.has(firstChoiceId) || unsafeBudgetKeys.has(firstChoiceId) || typeof backupId !== "string" || !backupId || backupId.length > 200 || unsafeBudgetKeys.has(backupId) || firstChoices.has(backupId) || usedBackups.has(backupId)) {
        throw new AuctionError("Each first choice can have one distinct backup. A backup cannot be another first choice or belong to multiple targets.", 400, "INVALID_TARGET_BACKUP");
      }
      usedBackups.add(backupId);
      if (targetBackupId(previous.backups, firstChoiceId) !== backupId && !state.players.some(player => player.id === backupId && isTargetPlayerEligible(player))) {
        throw new AuctionError("A newly selected backup is no longer available. Review your list before saving.", 409, "TARGET_UNAVAILABLE");
      }
    }
  } else {
    // A legacy list-only client preserves surviving pairs, including sold backups.
    // Promoting a backup to a first choice removes the old pairing automatically.
    const usedBackups = new Set<string>();
    backupEntries = Object.entries(previous.backups ?? {}).filter(([id, backupId]) => {
      if (!firstChoices.has(id) || unsafeBudgetKeys.has(id) || typeof backupId !== "string" || !backupId || backupId.length > 200 || unsafeBudgetKeys.has(backupId) || firstChoices.has(backupId) || usedBackups.has(backupId)) return false;
      usedBackups.add(backupId);
      return true;
    });
  }
  const backups = Object.fromEntries(backupEntries);
  const selected = new Set(getTargetPlayerIds({ playerIds: action.playerIds, backups }));
  let entries: [string, number][];
  if (action.maxBids !== undefined) {
    const value = action.maxBids;
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new AuctionError("Set a valid budget for each target player.", 400, "INVALID_TARGET_BUDGET");
    }
    entries = Object.entries(value);
    if (entries.some(([id, amount]) => unsafeBudgetKeys.has(id) || !selected.has(id) || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000)) {
      throw new AuctionError("Budgets must belong to selected players and be whole lakhs between 1 and 100,000.", 400, "INVALID_TARGET_BUDGET");
    }
    if (action.backups === undefined) {
      // Deployed clients submit explicit limits for first choices only. Keep the
      // unseen limits of surviving backups, but respect edits/removals of every
      // first-choice limit. Clients sending backups use full replacement above.
      const retainedBackupIds = new Set(backupEntries.map(([, backupId]) => backupId));
      entries.push(...Object.entries(previous.maxBids ?? {}).filter(([id]) => retainedBackupIds.has(id) && !Object.hasOwn(value, id)));
    }
  } else {
    // Old clients can still change the list without silently discarding existing limits.
    entries = Object.entries(previous.maxBids ?? {}).filter(([id]) => selected.has(id));
  }
  return {
    teamId: action.teamId, playerIds: [...action.playerIds], revision: previous.revision + 1,
    ...(backupEntries.length ? { backups } : {}),
    ...(entries.length ? { maxBids: Object.fromEntries(entries) } : {}),
  };
}
