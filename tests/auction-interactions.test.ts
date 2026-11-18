import assert from "node:assert/strict";
import test from "node:test";
import type { AuctionAction, RoomState } from "../lib/auction";

const { applyAction, AuctionError, createDemoState, createRoomState, getNextBid }:
  typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { parseCroreBid }: typeof import("../lib/bid-input") = await import(new URL("../lib/bid-input.ts", import.meta.url).href);

const NOW = 1_800_000_000_000;
const HOST = "demo-host", RCB = "demo-rcb", MI = "demo-mi";
const act = (room: RoomState, action: AuctionAction, member = HOST, now = NOW) => applyAction(room, action, member, now);
const customBid = (room: RoomState, customAmount: number): AuctionAction => ({ type: "bid", expectedPlayerId: room.currentPlayerId!, expectedAmount: getNextBid(room), customAmount });

function live(): RoomState {
  const members = createDemoState().members;
  const room = createRoomState("CUSTOM", "Custom bids", members[0], NOW);
  room.members = members;
  return act(act(room, { type: "select_player", playerId: "axar-patel" }), { type: "start" });
}

function rejects(room: RoomState, action: unknown, code: string, member = RCB, now = NOW) {
  const before = structuredClone(room);
  assert.throws(() => act(room, action as AuctionAction, member, now), (error: unknown) => {
    assert.ok(error instanceof AuctionError);
    assert.equal(error.code, code);
    return true;
  });
  assert.deepEqual(room, before, "rejected requests leave the entire snapshot unchanged");
}

test("crore input converts exact decimal text to integer lakhs without rounding", () => {
  for (const [input, expected] of [
    ["5", 500], ["5.25", 525], ["5.01", 501], ["0.29", 29], [".01", 1],
    [".5", 50], ["1.", 100], ["  05.20  ", 520], ["999999.99", 99999999],
  ] as const) assert.equal(parseCroreBid(input), expected, input);
});

test("crore input rejects zero, fractional lakhs, signs and non-decimal formats", () => {
  for (const input of ["", " ", ".", "0", "0.00", ".00", "-5", "+5", "5.001", ".001", "1e2", "0x10", "5,00", "₹5", "NaN", "Infinity", "5.0.0", "5 00", "1000000"]) {
    assert.equal(parseCroreBid(input), null, input);
  }
});

test("custom bids use exact integer lakhs for the leader, history, next increment and sale", () => {
  const initial = live();
  const before = structuredClone(initial);
  const jumped = act(initial, customBid(initial, 500), RCB);
  assert.equal(jumped.currentBid, 500);
  assert.equal(jumped.leadingTeamId, "rcb");
  assert.equal(jumped.bidHistory.at(-1)!.amount, 500);
  assert.equal(jumped.teams.find(team => team.id === "rcb")!.purse, 10000, "bidding reserves no premature debit");
  assert.equal(getNextBid(jumped), 525);
  assert.match(jumped.activity.at(-1)!.text, /₹5\.00 Cr/);
  const raised = act(jumped, customBid(jumped, 575), MI, NOW + 1000);
  assert.equal(getNextBid(raised), 600, "a custom jump still uses quarter-crore amounts");
  const sold = act(act(raised, { type: "lock" }), { type: "sell" });
  const winner = sold.teams.find(team => team.id === "mi")!;
  assert.equal(winner.purse, 10000 - 575);
  assert.deepEqual(winner.squad, [{ playerId: initial.currentPlayerId, amount: 575 }]);
  assert.equal(sold.players.find(player => player.id === initial.currentPlayerId)!.soldFor, 575);
  rejects(sold, { type: "sell" }, "INVALID_ACTION", HOST);
  assert.deepEqual(initial, before, "successful transitions are immutable too");
});

test("custom bids still compare the displayed price and lot before accepting any jump", () => {
  const initial = live();
  const first = customBid(initial, 500);
  const raced = customBid(initial, 700);
  const latest = act(initial, first, RCB);
  rejects(latest, raced, "STALE_BID", MI, NOW + 2000);
  rejects(initial, { ...first, expectedAmount: 500 }, "STALE_BID");
  rejects(initial, { ...first, expectedPlayerId: "virat-kohli" }, "STALE_PLAYER");
  rejects(initial, { type: "bid", customAmount: 500 }, "STALE_PLAYER");
});

test("invalid, fractional or low custom currency fails without a state change", () => {
  const room = live();
  for (const customAmount of [null, "500", false, {}, [], -1, 0, 500.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    rejects(room, { ...customBid(room, 500), customAmount }, "INVALID_BID_AMOUNT");
  }
  rejects(room, customBid(room, getNextBid(room) - 1), "BID_TOO_LOW");
  const exact = act(room, customBid(room, getNextBid(room)), RCB);
  assert.equal(exact.currentBid, getNextBid(room));
});

test("custom bids respect all room phases, cooldown and current leader", () => {
  const room = live();
  const first = act(room, customBid(room, 500), RCB);
  rejects(first, customBid(first, 700), "ALREADY_LEADING", RCB, NOW + 2000);
  rejects(first, customBid(first, 700), "BID_COOLDOWN", MI, NOW + 999);
  assert.equal(act(first, customBid(first, 700), MI, NOW + 1000).currentBid, 700);
  for (const phase of ["waiting", "paused", "locked", "sold", "unsold"] as const) {
    rejects({ ...room, phase }, customBid(room, 500), "BIDDING_CLOSED");
  }
  rejects(room, customBid(room, 500), "NO_TEAM", HOST);
});

test("custom amounts cannot bypass purse, squad or overseas limits", () => {
  const room = live();
  const team = room.teams.find(value => value.id === "rcb")!;
  team.purse = 500;
  rejects(room, customBid(room, 525), "INSUFFICIENT_PURSE");
  assert.equal(act(room, customBid(room, 500), RCB).currentBid, 500);
  team.squad = Array.from({ length: room.settings.maxSquadSize }, (_, index) => ({ playerId: `held-${index}`, amount: 1 }));
  rejects(room, customBid(room, 500), "SQUAD_FULL");
  team.squad = [];
  room.settings.maxOverseas = 0;
  room.players.find(player => player.id === room.currentPlayerId)!.isOverseas = true;
  rejects(room, customBid(room, 500), "OVERSEAS_LIMIT");
  room.players.find(player => player.id === room.currentPlayerId)!.eligibilityVerified = false;
  rejects(room, customBid(room, 500), "PLAYER_REVIEW_REQUIRED");
});

test("chat snapshots the authenticated name and team and ignores spoofed author fields", () => {
  const room = live();
  const author = room.members.find(member => member.id === RCB)!;
  author.name = "Actual manager";
  const spoofed = { type: "chat", text: "  My bid is next  ", senderName: "Auctioneer", senderTeamId: "mi", memberId: HOST };
  const posted = act(room, spoofed as AuctionAction, RCB);
  const message = posted.activity.at(-1)!;
  assert.equal(message.text, "My bid is next");
  assert.equal(message.memberId, RCB);
  assert.equal(message.senderName, "Actual manager");
  assert.equal(message.senderTeamId, "rcb");
  const changedSeat = act(posted, { type: "claim_team", teamId: null }, RCB);
  const departed = act(changedSeat, { type: "leave" }, RCB);
  assert.ok(!departed.members.some(member => member.id === RCB));
  assert.deepEqual(departed.activity.find(entry => entry.id === message.id), message, "identity remains intact after changing seats and leaving");
});

test("spectator chat records a null team and non-chat activity stays unchanged", () => {
  const room = live();
  room.members.push({ id: "viewer", name: "Viewer", role: "spectator", teamId: null, joinedAt: NOW, lastSeenAt: NOW, flagRaisedAt: null });
  const posted = act(room, { type: "chat", text: "Good auction" }, "viewer");
  assert.equal(posted.activity.at(-1)!.senderName, "Viewer");
  assert.equal(posted.activity.at(-1)!.senderTeamId, null);
  const paused = act(posted, { type: "pause" });
  assert.equal(paused.activity.at(-1)!.senderName, undefined);
  assert.equal(paused.activity.at(-1)!.senderTeamId, undefined);
  rejects(posted, { type: "chat", text: "Again" }, "INVALID_ACTION", "viewer", NOW + 999);
});

test("the retired raise-flag action cannot mutate an auction", () => {
  rejects(live(), { type: "raise_flag" }, "INVALID_ACTION");
});
