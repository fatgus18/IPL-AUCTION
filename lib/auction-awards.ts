import type { Bid, RoomState } from "./auction.ts";
import { formatMoney } from "./auction-display.ts";

/** Compact public counts preserve awards after the detailed bid feed rolls over. */
export type AuctionAwardLedger = {
  schema: 1;
  complete: boolean;
  lastBidId: string | null;
  players: Record<string, { name: string; bids: number; teamBids: Record<string, number> }>;
};
export type AwardWinner = { id: string; name: string; detail: string; teamIds: string[]; playerId?: string };
export type AuctionAward = {
  id: "headline" | "roster" | "purse" | "battle" | "table" | "rivals";
  title: string; criterion: string; metric: string; winners: AwardWinner[]; unavailable?: string;
};
export type AuctionAwards = { bidHistoryComplete: boolean; awards: AuctionAward[] };

function addBid(ledger: AuctionAwardLedger, bid: Bid, names: Map<string, string>) {
  const entry = Object.hasOwn(ledger.players, bid.playerId) ? ledger.players[bid.playerId] : { name: names.get(bid.playerId) ?? "Archived player", bids: 0, teamBids: {} };
  entry.bids += 1;
  const previous = Object.hasOwn(entry.teamBids, bid.teamId) ? entry.teamBids[bid.teamId] : 0;
  Object.defineProperty(entry.teamBids, bid.teamId, { value: previous + 1, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(ledger.players, bid.playerId, { value: entry, writable: true, enumerable: true, configurable: true });
  ledger.lastBidId = bid.id;
}

function fromHistory(state: RoomState, complete: boolean): AuctionAwardLedger {
  const ledger: AuctionAwardLedger = { schema: 1, complete, lastBidId: null, players: {} };
  const names = new Map(state.players.map(player => [player.id, player.name]));
  const seen = new Set<string>();
  for (const bid of state.bidHistory) if (!seen.has(bid.id)) { seen.add(bid.id); addBid(ledger, bid, names); }
  return ledger;
}

/** Called only after an accepted action, on its cloned state before bid trimming. */
export function recordAuctionAwards(source: RoomState, state: RoomState): void {
  const ledger = state.awardLedger;
  if (!ledger || ledger.schema !== 1) {
    // At the old 2,000-entry boundary we cannot prove earlier bids were retained.
    state.awardLedger = fromHistory(state, source.bidHistory.length < 2000);
    return;
  }
  const last = state.bidHistory.at(-1)?.id ?? null;
  if (ledger.lastBidId === last) return;
  const index = ledger.lastBidId === null ? -1 : state.bidHistory.findLastIndex(bid => bid.id === ledger.lastBidId);
  if (ledger.lastBidId !== null && index < 0) {
    // A legacy writer may have advanced beyond our retained marker. Do not invent winners.
    state.awardLedger = fromHistory(state, false);
    return;
  }
  const names = new Map(state.players.map(player => [player.id, player.name]));
  for (const bid of state.bidHistory.slice(index + 1)) addBid(ledger, bid, names);
}

function best<T>(values: T[], score: (value: T) => number): T[] {
  if (!values.length) return [];
  const maximum = Math.max(...values.map(score));
  return values.filter(value => score(value) === maximum);
}

/** No private target lists, price limits or subjective team-strength scoring enter awards. */
export function getAuctionAwards(state: RoomState): AuctionAwards {
  if (state.endedAt === undefined) return { bidHistoryComplete: true, awards: [] };
  const players = new Map(state.players.map(player => [player.id, player]));
  const teams = new Map(state.teams.map(team => [team.id, team]));
  const ledger = state.awardLedger?.schema === 1 ? state.awardLedger : fromHistory(state, state.bidHistory.length < 2000);
  const purchases = state.teams.flatMap(team => team.squad.map(sale => ({ ...sale, team })));
  const highest = best(purchases, purchase => purchase.amount);
  const deepest = best(state.teams.filter(team => team.squad.length > 0), team => team.squad.length);
  const budgetKeepers = best(state.teams.filter(team => team.squad.length >= 11), team => team.purse);
  const teamWinner = (team: RoomState["teams"][number], detail: string): AwardWinner => ({ id: team.id, name: team.name, detail, teamIds: [team.id] });
  const missingHistory = "Bidding awards need a complete record. Earlier bids are missing from this older room.";
  const recordedPlayers = Object.entries(ledger.players).map(([id, entry]) => ({ id, ...entry, teamIds: Object.keys(entry.teamBids).filter(teamId => teams.has(teamId)) }));
  const battles = ledger.complete ? best(recordedPlayers.filter(entry => entry.teamIds.length >= 2), entry => entry.bids) : [];
  const totals = new Map<string, number>();
  const pairs = new Map<string, { ids: string[]; count: number }>();
  for (const entry of recordedPlayers) {
    for (const id of entry.teamIds) totals.set(id, (totals.get(id) ?? 0) + entry.teamBids[id]);
    const ids = [...entry.teamIds].sort();
    for (let left = 0; left < ids.length; left++) for (let right = left + 1; right < ids.length; right++) {
      const key = JSON.stringify([ids[left], ids[right]]);
      const previous = pairs.get(key);
      pairs.set(key, { ids: [ids[left], ids[right]], count: (previous?.count ?? 0) + 1 });
    }
  }
  const busy = ledger.complete ? best([...totals].filter(([, count]) => count > 0), ([, count]) => count) : [];
  const rivals = ledger.complete ? best([...pairs.values()], pair => pair.count) : [];
  return { bidHistoryComplete: ledger.complete, awards: [
    { id: "headline", title: "Headline signing", criterion: "Highest confirmed purchase price, including sale corrections.", metric: highest.length ? formatMoney(highest[0].amount) : "No signings", winners: highest.map(sale => ({ id: sale.playerId, name: players.get(sale.playerId)?.name ?? "Archived player", detail: sale.team.name, teamIds: [sale.team.id], playerId: sale.playerId })), ...(!highest.length ? { unavailable: "No players were purchased." } : {}) },
    { id: "roster", title: "Deepest squad", criterion: "Most players in the final purchased squad.", metric: deepest.length ? `${deepest[0].squad.length} ${deepest[0].squad.length === 1 ? "player" : "players"}` : "No signings", winners: deepest.map(team => teamWinner(team, `${formatMoney(team.squad.reduce((sum, sale) => sum + sale.amount, 0))} invested`)), ...(!deepest.length ? { unavailable: "No players were purchased." } : {}) },
    { id: "purse", title: "Purse protector", criterion: "Largest remaining purse among teams with at least 11 signings.", metric: budgetKeepers.length ? formatMoney(budgetKeepers[0].purse) : "Not awarded", winners: budgetKeepers.map(team => teamWinner(team, `${team.squad.length} players signed`)), ...(!budgetKeepers.length ? { unavailable: "A squad needs at least 11 signings to qualify." } : {}) },
    { id: "battle", title: "Bidding marathon", criterion: "Most accepted bids on one player across all their auction appearances; at least two franchises competed.", metric: battles.length ? `${battles[0].bids} bids` : "Not awarded", winners: battles.map(entry => ({ id: entry.id, name: players.get(entry.id)?.name ?? entry.name, detail: `${entry.teamIds.length} franchises in contention`, teamIds: entry.teamIds, playerId: entry.id })), ...(!battles.length ? { unavailable: ledger.complete ? "No player drew bids from multiple franchises." : missingHistory } : {}) },
    { id: "table", title: "Busiest table", criterion: "Most accepted bids placed by a franchise. Rejected bids do not count.", metric: busy.length ? `${busy[0][1]} ${busy[0][1] === 1 ? "bid" : "bids"}` : "Not awarded", winners: busy.map(([id]) => teamWinner(teams.get(id)!, "Most active in the bidding")), ...(!busy.length ? { unavailable: ledger.complete ? "No bids were recorded." : missingHistory } : {}) },
    { id: "rivals", title: "Fiercest rivalry", criterion: "The pair of franchises that both bid on the most distinct players.", metric: rivals.length ? `${rivals[0].count} shared ${rivals[0].count === 1 ? "contest" : "contests"}` : "Not awarded", winners: rivals.map(pair => ({ id: JSON.stringify(pair.ids), name: pair.ids.map(id => teams.get(id)!.shortName).join(" × "), detail: pair.ids.map(id => teams.get(id)!.name).join(" & "), teamIds: pair.ids })), ...(!rivals.length ? { unavailable: ledger.complete ? "No two franchises contested the same player." : missingHistory } : {}) },
  ] };
}
