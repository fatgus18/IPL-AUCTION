import assert from "node:assert/strict";
import test from "node:test";
import type { AuctionAction, RoomState } from "../lib/auction";

const { applyAction, AuctionError, createDemoState, getNextBid }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { isValidBidAmount, normalizeBidIncrement, parseCroreBid }: typeof import("../lib/bid-input") = await import(new URL("../lib/bid-input.ts", import.meta.url).href);
const NOW = 1_800_000_000_000;

function fixture(): RoomState {
  const room = createDemoState();
  room.currentBid = 500; room.leadingTeamId = "rcb"; room.lastBidAt = NOW - 1000;
  return room;
}

function bid(room: RoomState, customAmount?: number): AuctionAction {
  return { type: "bid", expectedPlayerId: room.currentPlayerId!, expectedAmount: getNextBid(room), ...(customAmount === undefined ? {} : { customAmount }) };
}

test("custom bids accept quarter-crore amounts and unrestricted jumps on that grid", () => {
  for (const amount of [525, 550, 575, 1050]) {
    const room = fixture();
    const result = applyAction(room, bid(room, amount), "demo-mi", NOW);
    assert.equal(result.currentBid, amount);
    assert.equal(result.bidHistory.at(-1)!.amount, amount);
    assert.equal(getNextBid(result), amount + 25);
  }
});

test("off-grid bids are rejected authoritatively without changing the room", () => {
  for (const amount of [526, 627, 631, 748, 9999]) {
    const room = fixture(), before = structuredClone(room);
    assert.throws(() => applyAction(room, bid(room, amount), "demo-mi", NOW), error => error instanceof AuctionError && error.code === "INVALID_BID_INCREMENT" && error.status === 400);
    assert.deepEqual(room, before);
  }
});

test("an off-grid catalog base price rounds up for bidding without changing the catalog fact", () => {
  for (const [basePrice, expectedBid] of [[1, 25], [20, 25], [30, 50], [40, 50], [75, 75], [110, 125], [200, 200]]) {
    const room = fixture();
    room.currentBid = 0; room.leadingTeamId = null; room.lastBidAt = null;
    room.players.find(player => player.id === room.currentPlayerId)!.basePrice = basePrice;
    assert.equal(getNextBid(room), expectedBid);
    const result = applyAction(room, bid(room), "demo-mi", NOW);
    assert.equal(result.currentBid, expectedBid);
    assert.equal(result.players.find(player => player.id === room.currentPlayerId)!.basePrice, basePrice);
  }
});

test("legacy current bids and increments emit the next valid grid amount without rewriting history", () => {
  for (const [currentBid, increment, expected] of [[627, 25, 650], [631, 5, 650], [748, 10, 750], [627, 50, 675], [625, 30, 675], [625, 25, 650]]) {
    const room = fixture(); room.currentBid = currentBid; room.settings.bidIncrement = increment;
    const originalHistory = structuredClone(room.bidHistory);
    assert.equal(getNextBid(room), expected);
    const result = applyAction(room, bid(room), "demo-mi", NOW);
    assert.equal(result.currentBid, expected);
    assert.deepEqual(result.bidHistory.slice(0, -1), originalHistory);
    assert.equal(room.currentBid, currentBid);
  }
});

test("new increment settings must be quarter-crore multiples; legacy room metadata can still be edited", () => {
  const room = fixture(); room.phase = "waiting";
  for (const increment of [5, 10, 20, 26, 30, 55, 499]) {
    assert.throws(() => applyAction(room, { type: "update_settings", settings: { bidIncrement: increment } }, "demo-host", NOW), error => error instanceof AuctionError && error.status === 400);
  }
  for (const increment of [25, 50, 75, 100, 500]) {
    assert.equal(applyAction(room, { type: "update_settings", settings: { bidIncrement: increment } }, "demo-host", NOW).settings.bidIncrement, increment);
  }
  room.settings.bidIncrement = 10; room.phase = "live";
  const updated = applyAction(room, { type: "update_settings", settings: { callUrl: "https://example.com/call" } }, "demo-host", NOW);
  assert.equal(updated.settings.bidIncrement, 25);
  assert.equal(updated.settings.callUrl, "https://example.com/call");
});

test("grid validation is separate from exact currency parsing used by private budgets", () => {
  assert.equal(parseCroreBid("7.13"), 713);
  assert.equal(isValidBidAmount(713), false);
  for (const value of [0, -25, 25.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(isValidBidAmount(value), false);
  for (const value of [25, 525, 1050, 10000]) assert.equal(isValidBidAmount(value), true);
  assert.equal(normalizeBidIncrement(10), 25);
  assert.equal(normalizeBidIncrement(30), 50);
});
