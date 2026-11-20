import type { Player, RoomState } from "./auction.ts";
import { getNextBid } from "./auction-display.ts";
import { parseCroreBid } from "./bid-input.ts";
import { getActiveTargetIds, getTargetChains, isTargetPlayerEligible } from "./target-chains.ts";

export type BudgetInputs = Record<string, string>;
export const MAX_PRIVATE_BUDGET = 100_000;

/** Player ids are dictionary keys, including names inherited by ordinary objects. */
export function budgetInputValue(inputs: BudgetInputs, id: string): string {
  return Object.hasOwn(inputs, id) && typeof inputs[id] === "string" ? inputs[id] : "";
}

export function budgetLimitValue(maxBids: Record<string, number> | undefined, id: string): number | undefined {
  return maxBids && Object.hasOwn(maxBids, id) && typeof maxBids[id] === "number" ? maxBids[id] : undefined;
}

/** Preserve text while editing: incomplete and invalid amounts must not disappear on polling. */
export function budgetInputsFromSaved(maxBids: Record<string, number> = {}): BudgetInputs {
  return Object.fromEntries(Object.entries(maxBids).filter(([, amount]) => typeof amount === "number" && Number.isFinite(amount)).map(([id, amount]) => [id, (amount / 100).toFixed(2)]));
}

export function parseBudgetInputs(playerIds: readonly string[], inputs: BudgetInputs) {
  const amounts: [string, number][] = [];
  const invalidIds: string[] = [];
  for (const id of playerIds) {
    const text = budgetInputValue(inputs, id).trim();
    if (!text) continue;
    const amount = parseCroreBid(text);
    if (amount === null || amount > MAX_PRIVATE_BUDGET) invalidIds.push(id);
    else amounts.push([id, amount]);
  }
  const maxBids: Record<string, number> = Object.fromEntries(amounts);
  return { maxBids, invalidIds };
}

export function sameBudgetValues(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((id) => Object.hasOwn(b, id) && a[id] === b[id]);
}

export function sameBudgetInputs(a: BudgetInputs, b: BudgetInputs): boolean {
  const keys = Object.keys(a).filter((id) => budgetInputValue(a, id).trim());
  return keys.length === Object.keys(b).filter((id) => budgetInputValue(b, id).trim()).length && keys.every((id) => budgetInputValue(a, id) === budgetInputValue(b, id));
}

/** Alternatives reserve the larger eligible limit once per chain, never both limits. */
export function privateBudgetPlan(players: readonly Player[], playerIds: readonly string[], maxBids: Record<string, number>, purse: number, backups: Record<string, string> = {}, teamId?: string) {
  const playerMap = new Map(players.map((player) => [player.id, player]));
  let planned = 0;
  let unpriced = 0;
  let remaining = 0;
  for (const chain of getTargetChains(players, { playerIds: [...playerIds], backups, teamId: teamId ?? "" })) {
    if (chain.status === "secured") continue;
    const ids = [chain.firstChoiceId, ...(chain.backupId ? [chain.backupId] : [])].filter(id => isTargetPlayerEligible(playerMap.get(id)));
    if (!ids.length) continue;
    remaining += 1;
    const limits = ids.map(id => budgetLimitValue(maxBids, id));
    const validLimits = limits.filter((limit): limit is number => limit !== undefined && Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_PRIVATE_BUDGET);
    planned += Math.max(0, ...validLimits);
    if (validLimits.length !== ids.length) unpriced += 1;
  }
  return { planned, unpriced, remaining, overallocated: Math.max(0, planned - purse), unallocated: Math.max(0, purse - planned) };
}

export type PrivateBudgetWarning = "within" | "at" | "over" | "next-over";

/** Only the authenticated owner's saved planning data can produce an in-auction reminder. */
export function currentPrivateBudget(state: RoomState, memberId: string) {
  if (state.endedAt || state.phase === "sold" || state.phase === "unsold") return null;
  const member = state.members.find((entry) => entry.id === memberId);
  if (!member || member.role !== "bidder" || member.id === state.hostId || !member.teamId) return null;
  const team = state.teams.find((entry) => entry.id === member.teamId);
  const picks = state.myTargetPicks;
  const player = state.players.find((entry) => entry.id === state.currentPlayerId);
  if (!team || !picks || picks.teamId !== team.id || !player || player.catalogArchived || player.status !== "available" || !getActiveTargetIds(state.players, picks).includes(player.id)) return null;
  const limit = budgetLimitValue(picks.maxBids, player.id);
  if (!limit || !Number.isSafeInteger(limit) || limit > MAX_PRIVATE_BUDGET || limit < 0) return null;
  const nextBid = getNextBid(state);
  const warning: PrivateBudgetWarning = state.currentBid > limit ? "over"
    : state.currentBid === limit ? "at"
      : state.leadingTeamId !== team.id && nextBid > limit ? "next-over" : "within";
  return { player, team, limit, nextBid, warning, currentBid: state.currentBid };
}
