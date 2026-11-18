import assert from "node:assert/strict";
import test from "node:test";
import type { AuctionAction, Bid, RoomState } from "../lib/auction";

const { applyAction, AuctionError, createDemoState, createRoomState, getNextBid }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { getAuctionAwards, recordAuctionAwards }: typeof import("../lib/auction-awards") = await import(new URL("../lib/auction-awards.ts", import.meta.url).href);
const NOW = 1_800_000_000_000;
const HOST = "demo-host", RED = "demo-rcb", BLUE = "demo-mi";
function fixture(): RoomState {
  const members = createDemoState().members;
  const state = createRoomState("AWARDS", "Award verification", members[0], NOW - 10000);
  state.members = members;
  return state;
}
const act = (state: RoomState, action: AuctionAction, member = HOST, now = NOW) => applyAction(state, action, member, now);
const end = (state: RoomState) => act(state, { type: "end_auction", expectedResultsRevision: state.resultsRevision ?? 0 });
const award = (state: RoomState, id: string) => getAuctionAwards(state).awards.find(entry => entry.id === id)!;
const team = (state: RoomState, id: string) => state.teams.find(entry => entry.id === id)!;
function signed(state: RoomState, teamId: string, playerIndex: number, amount: number) {
  const player = state.players.filter(entry => !entry.isOverseas && entry.eligibilityVerified !== false)[playerIndex];
  player.status = "sold"; player.soldTo = teamId; player.soldFor = amount;
  team(state, teamId).squad.push({ playerId: player.id, amount }); team(state, teamId).purse -= amount;
  state.resultsRevision = (state.resultsRevision ?? 0) + 1;
  return player;
}
const historyBid = (state: RoomState, id: string, playerIndex: number, teamId: string): Bid => ({ id, playerId: state.players[playerIndex].id, teamId, memberId: `demo-${teamId}`, amount: 200, at: NOW });

test("awards stay hidden until the auction ends, and an empty recap invents no winners", () => {
  const state = fixture(); const before = structuredClone(state);
  assert.deepEqual(getAuctionAwards(state), { bidHistoryComplete: true, awards: [] });
  assert.deepEqual(state, before);
  const completed = end(state);
  assert.equal(getAuctionAwards(completed).awards.length, 6);
  for (const entry of getAuctionAwards(completed).awards) {
    assert.equal(entry.winners.length, 0); assert.ok(entry.unavailable);
  }
});

test("financial awards include every exact tie and require eleven actual signings for purse eligibility", () => {
  const state = fixture();
  for (let i = 0; i < 11; i++) {
    signed(state, "rcb", i, i === 0 ? 500 : 200);
    signed(state, "mi", i + 11, i === 0 ? 500 : 200);
  }
  signed(state, "csk", 22, 200);
  const result = end(state);
  assert.equal(award(result, "headline").metric, "₹5.00 Cr");
  assert.deepEqual(new Set(award(result, "headline").winners.flatMap(winner => winner.teamIds)), new Set(["rcb", "mi"]));
  assert.deepEqual(new Set(award(result, "roster").winners.map(winner => winner.id)), new Set(["rcb", "mi"]));
  assert.equal(award(result, "roster").metric, "11 players");
  assert.deepEqual(new Set(award(result, "purse").winners.map(winner => winner.id)), new Set(["rcb", "mi"]));
  assert.ok(team(result, "csk").purse > team(result, "rcb").purse, "larger unspent purse alone cannot win with one signing");
});

test("no team with fewer than eleven signings receives the purse award", () => {
  const state = fixture();
  for (let i = 0; i < 10; i++) signed(state, "rcb", i, 200);
  const result = award(end(state), "purse");
  assert.deepEqual(result.winners, []); assert.match(result.unavailable!, /11 signings/);
});

test("sale corrections and cancellations immediately recalculate awards from confirmed purchases", () => {
  const state = fixture();
  const first = signed(state, "rcb", 0, 500), second = signed(state, "mi", 1, 500);
  let result = end(state);
  assert.equal(award(result, "headline").winners.length, 2);
  result = act(result, { type: "correct_sale", playerId: first.id, expectedTeamId: "rcb", expectedAmount: 500, expectedResultsRevision: result.resultsRevision!, teamId: "mi", amount: 700, reason: "Correct the winning franchise and final price" });
  assert.deepEqual(award(result, "headline").winners.map(winner => winner.playerId), [first.id]);
  assert.deepEqual(award(result, "roster").winners.map(winner => winner.id), ["mi"]);
  result = act(result, { type: "correct_sale", playerId: first.id, expectedTeamId: "mi", expectedAmount: 700, expectedResultsRevision: result.resultsRevision!, teamId: null, reason: "Cancel the accidental sale" });
  assert.deepEqual(award(result, "headline").winners.map(winner => winner.playerId), [second.id]);
  assert.equal(award(result, "headline").metric, "₹5.00 Cr");
  assert.match(award(result, "roster").metric, /^1 player(s)?$/);
});

test("only accepted bids increment telemetry; rejected bids and other actions leave counts unchanged", () => {
  let state = fixture();
  const player = state.players.find(entry => !entry.isOverseas && entry.eligibilityVerified !== false)!;
  state = act(act(state, { type: "select_player", playerId: player.id }), { type: "start" });
  state = act(state, { type: "bid", expectedPlayerId: player.id, expectedAmount: getNextBid(state) }, RED);
  assert.equal(state.awardLedger!.players[player.id].bids, 1);
  const before = structuredClone(state);
  for (const [action, member, now] of [
    [{ type: "bid", expectedPlayerId: player.id, expectedAmount: getNextBid(state) }, BLUE, NOW + 999],
    [{ type: "bid", expectedPlayerId: player.id, expectedAmount: getNextBid(state) }, RED, NOW + 1000],
    [{ type: "bid", expectedPlayerId: player.id, expectedAmount: 1 }, BLUE, NOW + 1000],
  ] as [AuctionAction, string, number][]) {
    assert.throws(() => act(state, action, member, now), AuctionError); assert.deepEqual(state, before);
  }
  state = act(state, { type: "bid", expectedPlayerId: player.id, expectedAmount: getNextBid(state) }, BLUE, NOW + 1000);
  assert.equal(state.awardLedger!.players[player.id].bids, 2);
  const ledger = structuredClone(state.awardLedger);
  state = act(act(state, { type: "lock" }), { type: "sell" });
  state = act(state, { type: "chat", text: "Congratulations" }, RED);
  state = end(state);
  assert.deepEqual(state.awardLedger, ledger);
  assert.equal(award(state, "battle").metric, "2 bids");
  assert.equal(award(state, "table").winners.length, 2, "tied bidding tables both win");
});

test("rivalry counts distinct jointly contested players, while repeated appearances contribute to bid totals", () => {
  const state = fixture();
  const rows: [number, string][] = [
    [0, "rcb"], [0, "mi"], [0, "rcb"], [0, "mi"],
    [1, "rcb"], [1, "mi"],
    // Same player offered again: another four accepted bids, still one shared contest.
    [0, "rcb"], [0, "mi"], [0, "rcb"], [0, "mi"],
    [2, "rcb"], [2, "csk"],
  ];
  state.bidHistory = rows.map(([playerIndex, teamId], i) => historyBid(state, `b-${i}`, playerIndex, teamId));
  const result = end(state);
  assert.equal(award(result, "battle").metric, "8 bids");
  assert.equal(award(result, "battle").winners[0].playerId, state.players[0].id);
  assert.equal(award(result, "rivals").metric, "2 shared contests");
  assert.deepEqual(award(result, "rivals").winners[0].teamIds, ["mi", "rcb"]);
  assert.equal(award(result, "table").metric, "6 bids");
  assert.equal(award(result, "table").winners[0].id, "rcb");
});

test("single-franchise bidding does not fabricate competitive player or rivalry awards", () => {
  const state = fixture();
  state.bidHistory = [historyBid(state, "single", 0, "rcb")];
  const result = end(state);
  assert.deepEqual(award(result, "battle").winners, []);
  assert.deepEqual(award(result, "rivals").winners, []);
  assert.equal(award(result, "table").winners[0].id, "rcb");
});

test("compact telemetry survives more than 2000 bids, JSON persistence and rolling detailed history", () => {
  let state = act(fixture(), { type: "ping" });
  for (let i = 0; i < 2105; i++) {
    const next = { ...state, awardLedger: structuredClone(state.awardLedger), bidHistory: [...state.bidHistory, historyBid(state, `durable-${i}`, i % 3, i % 2 ? "rcb" : "mi")] };
    recordAuctionAwards(state, next);
    next.bidHistory = next.bidHistory.slice(-2000);
    state = next;
  }
  state = JSON.parse(JSON.stringify(state));
  assert.equal(state.bidHistory.length, 2000);
  assert.equal(Object.values(state.awardLedger!.players).reduce((sum, entry) => sum + entry.bids, 0), 2105);
  assert.equal(Object.keys(state.awardLedger!.players).length, 3);
  assert.ok(JSON.stringify(state.awardLedger).length < 1000, "aggregate size depends on players and franchises, not total bids");
  const result = end(state);
  assert.equal(getAuctionAwards(result).bidHistoryComplete, true);
  assert.equal(award(result, "table").metric, "1053 bids");
  assert.equal(award(result, "table").winners[0].id, "mi");
  assert.equal(award(result, "rivals").metric, "3 shared contests");
});

test("legacy history below the old limit reconstructs safely, including duplicate bid IDs", () => {
  const state = fixture();
  const first = historyBid(state, "legacy-one", 0, "rcb"), second = historyBid(state, "legacy-two", 0, "mi");
  state.bidHistory = [first, second, { ...second }];
  const result = end(state);
  assert.equal(result.awardLedger!.complete, true);
  assert.equal(award(result, "battle").metric, "2 bids");
  assert.equal(result.awardLedger!.lastBidId, "legacy-two");
});

test("legacy history at the truncation boundary withholds bidding awards without withholding purchase awards", () => {
  const state = fixture(); signed(state, "rcb", 0, 700);
  state.bidHistory = Array.from({ length: 2000 }, (_, i) => historyBid(state, `legacy-${i}`, 0, i % 2 ? "rcb" : "mi"));
  const result = end(state);
  assert.equal(getAuctionAwards(result).bidHistoryComplete, false);
  assert.equal(award(result, "headline").metric, "₹7.00 Cr");
  for (const id of ["battle", "table", "rivals"]) {
    assert.deepEqual(award(result, id).winners, []); assert.match(award(result, id).unavailable!, /Earlier bids are missing/);
  }
});

test("a missing incremental marker degrades to partial history instead of inventing complete totals", () => {
  let state = fixture(); state.bidHistory = [historyBid(state, "old", 0, "rcb")];
  state = act(state, { type: "ping" });
  state.bidHistory = [historyBid(state, "replacement", 0, "mi")];
  state = act(state, { type: "ping" });
  assert.equal(state.awardLedger!.complete, false);
  assert.deepEqual(award(end(state), "table").winners, []);
});

test("prototype-sensitive identifiers are data, and private planning limits never enter awards or telemetry", () => {
  const state = fixture();
  state.players[0].id = "__proto__"; state.players[0].name = "Player <safe>";
  team(state, "rcb").id = "constructor"; team(state, "mi").id = "__proto__";
  state.bidHistory = [historyBid(state, "safe-one", 0, "constructor"), historyBid(state, "safe-two", 0, "__proto__")];
  state.myTargetPicks = { teamId: "constructor", playerIds: [state.players[1].id], revision: 4, maxBids: { [state.players[1].id]: 98371 } };
  const result = end(state);
  assert.equal(Object.hasOwn(result.awardLedger!.players, "__proto__"), true);
  assert.equal(Object.hasOwn(result.awardLedger!.players.__proto__.teamBids, "constructor"), true);
  assert.equal(award(result, "battle").winners[0].name, "Player <safe>");
  for (const value of [result.awardLedger, getAuctionAwards(result)]) {
    assert.equal(JSON.stringify(value).includes("maxBids"), false);
    assert.equal(JSON.stringify(value).includes("98371"), false);
  }
  assert.equal(Object.getPrototypeOf(result.awardLedger!.players), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
