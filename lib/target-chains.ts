import type { Player, TargetPicks } from "./auction.ts";

type ChainPicks = Pick<TargetPicks, "teamId" | "playerIds" | "backups">;
export type TargetChain = {
  firstChoiceId: string;
  backupId?: string;
  activePlayerId: string | null;
  status: "first-choice" | "backup-active" | "secured" | "unavailable";
};

/** Unsold players can return to auction; archived or unverified players cannot. */
export function isTargetPlayerEligible(player: Player | undefined): player is Player {
  return !!player && !player.catalogArchived && player.eligibilityVerified !== false && (player.status === "available" || player.status === "unsold");
}

export function targetBackupId(backups: TargetPicks["backups"], firstChoiceId: string): string | undefined {
  return backups && Object.hasOwn(backups, firstChoiceId) && typeof backups[firstChoiceId] === "string" ? backups[firstChoiceId] : undefined;
}

/** Include standby backups when editing limits, without making them active targets. */
export function getTargetPlayerIds(picks: Pick<TargetPicks, "playerIds" | "backups">): string[] {
  return [...new Set(picks.playerIds.flatMap((id) => {
    const backupId = targetBackupId(picks.backups, id);
    return backupId ? [id, backupId] : [id];
  }))];
}

/** Derive from current sales so corrections can reactivate an unchanged saved plan. */
export function getTargetChains(players: readonly Player[], picks: ChainPicks): TargetChain[] {
  const playerMap = new Map(players.map((player) => [player.id, player]));
  return [...new Set(picks.playerIds)].map<TargetChain>((firstChoiceId) => {
    const backupId = targetBackupId(picks.backups, firstChoiceId);
    const firstChoice = playerMap.get(firstChoiceId);
    const backup = backupId ? playerMap.get(backupId) : undefined;
    const chain = { firstChoiceId, ...(backupId ? { backupId } : {}) };
    if (firstChoice?.status === "sold" && firstChoice.soldTo === picks.teamId) {
      return { ...chain, activePlayerId: null, status: "secured" };
    }
    if (isTargetPlayerEligible(firstChoice)) {
      return { ...chain, activePlayerId: firstChoiceId, status: "first-choice" };
    }
    if (backup?.status === "sold" && backup.soldTo === picks.teamId) {
      return { ...chain, activePlayerId: null, status: "secured" };
    }
    if (isTargetPlayerEligible(backup)) {
      return { ...chain, activePlayerId: backup.id, status: "backup-active" };
    }
    return { ...chain, activePlayerId: null, status: "unavailable" };
  });
}

export function getActiveTargetIds(players: readonly Player[], picks: ChainPicks): string[] {
  return getTargetChains(players, picks).flatMap((chain) => chain.activePlayerId ? [chain.activePlayerId] : []);
}
