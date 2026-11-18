import assert from "node:assert/strict";
import test from "node:test";
import type { AuctionAction, Phase, RoomState } from "../lib/auction";

const { applyAction, AuctionError, createDemoState, createRoomState, getNextBid }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const NOW = 1_800_000_000_000, NEXT_DAY = NOW + 86_400_000;
const HOST = "demo-host", BIDDER = "demo-mi";
const act = (room: RoomState, action: AuctionAction, member = HOST, now = NOW) => applyAction(room, action, member, now);

function fixture(phase: Phase = "live"): RoomState {
  const demo = createDemoState();
  let room = createRoomState("PAUSE1", "Two-day auction", demo.members[0], NOW - 10000);
  room.members = demo.members;
  room = act(room, { type: "select_player", playerId: "axar-patel" });
  if (phase === "waiting") return room;
  room = act(room, { type: "start" });
  if (phase !== "unsold") room = act(room, { type: "bid", expectedPlayerId: room.currentPlayerId!, expectedAmount: getNextBid(room), customAmount: 500 }, BIDDER);
  if (phase === "live") return room;
  if (phase === "paused") return act(room, { type: "pause" });
  room = act(room, { type: "lock" });
  return phase === "locked" ? room : act(room, { type: phase === "sold" ? "sell" : "unsold" });
}

function rejects(room: RoomState, action: unknown, code: string, member = HOST) {
  const before = structuredClone(room);
  assert.throws(() => act(room, action as AuctionAction, member), error => error instanceof AuctionError && error.code === code);
  assert.deepEqual(room, before);
}

test("a whole-auction break survives serialization and resumes every unfinished lot phase unchanged the next day", () => {
  for (const phase of ["waiting", "live", "paused", "locked", "sold", "unsold"] as const) {
    const original = fixture(phase), before = structuredClone(original);
    const paused = act(original, { type: "pause_auction" });
    assert.equal(paused.auctionPausedAt, NOW);
    assert.equal(paused.phase, phase);
    assert.equal(paused.activity.at(-1)!.type, "auction_paused");
    const restored = JSON.parse(JSON.stringify(paused)) as RoomState;
    const resumed = act(restored, { type: "resume_auction" }, HOST, NEXT_DAY);
    assert.equal(resumed.auctionPausedAt, undefined);
    assert.equal(resumed.activity.at(-1)!.type, "auction_resumed");
    assert.equal(resumed.version, original.version + 2);
    for (const key of ["phase", "currentPlayerId", "currentBid", "leadingTeamId", "lastBidAt", "bidLockVersion", "bidHistory", "players", "teams", "settings", "resultsRevision"] as const) {
      assert.deepEqual(paused[key], original[key], `${phase}: pause preserves ${key}`);
      const persistedValue = original[key] === undefined ? undefined : JSON.parse(JSON.stringify(original[key]));
      assert.deepEqual(resumed[key], persistedValue, `${phase}: resume preserves ${key}`);
    }
    assert.deepEqual(original, before);
  }
});

test("a new room can be paused before a first player is selected", () => {
  const demo = createDemoState();
  const original = createRoomState("BREAK1", "Before the auction", demo.members[0], NOW);
  const paused = act(original, { type: "pause_auction" });
  assert.equal(paused.currentPlayerId, null);
  assert.equal(act(paused, { type: "resume_auction" }, HOST, NEXT_DAY).currentPlayerId, null);
});

test("only the actual creator with the auctioneer role can pause or resume", () => {
  const room = fixture();
  room.members.push({ id: "spectator", name: "Viewer", role: "spectator", teamId: null, joinedAt: NOW, lastSeenAt: NOW, flagRaisedAt: null });
  const paused = act(room, { type: "pause_auction" });
  for (const member of [BIDDER, "spectator"]) {
    rejects(room, { type: "pause_auction" }, "FORBIDDEN", member);
    rejects(paused, { type: "resume_auction" }, "FORBIDDEN", member);
  }
  room.members.find(member => member.id === BIDDER)!.role = "auctioneer";
  rejects(room, { type: "pause_auction" }, "FORBIDDEN", BIDDER);
  room.members.find(member => member.id === HOST)!.role = "bidder";
  rejects(room, { type: "pause_auction" }, "FORBIDDEN");
  rejects(paused, { type: "resume_auction" }, "UNAUTHORIZED", "unknown");
});

test("a break prevents every auction-flow mutation including stale normal and custom bids", () => {
  const live = fixture(), paused = act(live, { type: "pause_auction" });
  const blocked = ["select_player", "start", "pause", "resume", "lock", "unlock", "sell", "unsold", "end_auction", "correct_sale"];
  for (const type of blocked) rejects(paused, { type }, "AUCTION_PAUSED");
  for (const customAmount of [undefined, 1000]) rejects(paused, { type: "bid", expectedPlayerId: live.currentPlayerId, expectedAmount: getNextBid(live), customAmount }, "AUCTION_PAUSED", "demo-rcb");
  const resumed = act(paused, { type: "resume_auction" }, HOST, NEXT_DAY);
  const bid = act(resumed, { type: "bid", expectedPlayerId: live.currentPlayerId!, expectedAmount: getNextBid(live) }, "demo-rcb", NEXT_DAY);
  assert.equal(bid.currentBid, 525);
  rejects(paused, { type: "pause_auction" }, "AUCTION_ALREADY_PAUSED");
  rejects(resumed, { type: "resume_auction" }, "AUCTION_NOT_PAUSED");
});

test("chat, owned lineups and safe settings remain usable during a break without resuming it", () => {
  let paused = act(fixture("sold"), { type: "pause_auction" });
  paused = act(paused, { type: "chat", text: "Continue tomorrow" }, BIDDER);
  paused = act(paused, { type: "set_lineup", teamId: "mi", expectedRevision: 0, lineup: { playingXI: [paused.currentPlayerId!], substitutes: [], captainId: paused.currentPlayerId!, viceCaptainId: null } }, BIDDER);
  paused = act(paused, { type: "update_settings", settings: { callUrl: "https://example.com/day-two" } });
  assert.equal(paused.auctionPausedAt, NOW);
  assert.equal(paused.teams.find(team => team.id === "mi")!.lineup!.captainId, paused.currentPlayerId);
  assert.equal(paused.settings.callUrl, "https://example.com/day-two");
  assert.equal(act(paused, { type: "ping" }, BIDDER).auctionPausedAt, NOW);
});

test("ended auctions cannot be paused or resumed", () => {
  const room = fixture("sold");
  const ended = act(room, { type: "end_auction", expectedResultsRevision: room.resultsRevision ?? 0 });
  rejects(ended, { type: "pause_auction" }, "AUCTION_ENDED");
  rejects(ended, { type: "resume_auction" }, "AUCTION_ENDED");
});
