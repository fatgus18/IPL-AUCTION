import assert from "node:assert/strict";
import test from "node:test";
import type { AuctionAction, RoomState } from "../lib/auction";

const { applyAction, AuctionError, createDemoState, createRoomState, getNextBid }:
  typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);

const NOW = 1_800_000_000_000;
const HOST = "demo-host", RCB = "demo-rcb", MI = "demo-mi";
const act = (room: RoomState, action: AuctionAction, member = HOST, now = NOW) => applyAction(room, action, member, now);
const unlock = (room: RoomState): AuctionAction => ({ type: "unlock", expectedPlayerId: room.currentPlayerId!, expectedAmount: room.currentBid, expectedLockVersion: room.bidLockVersion ?? 0 });
const bid = (room: RoomState): AuctionAction => ({ type: "bid", expectedPlayerId: room.currentPlayerId!, expectedAmount: getNextBid(room) });

function live(withBid = true): RoomState {
  const demo = createDemoState();
  demo.lastBidAt = NOW - 1000;
  if (withBid) return demo;
  const room = createRoomState("UNLOCK", "Reopen bidding", demo.members[0], NOW);
  room.members = demo.members;
  return act(act(room, { type: "select_player", playerId: "rishabh-pant" }), { type: "start" });
}

function rejects(room: RoomState, action: unknown, code: string, status = 409, member = HOST, now = NOW) {
  const before = structuredClone(room);
  assert.throws(() => act(room, action as AuctionAction, member, now), (error: unknown) => {
    assert.ok(error instanceof AuctionError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
  assert.deepEqual(room, before, "a rejected unlock cannot change the source snapshot");
}

test("unlock reopens only bidding, preserving the leader, price, bids, cooldown, squads, lineups and pool", () => {
  const locked = act(live(), { type: "lock" });
  locked.teams[0].lineup = { playingXI: [], substitutes: [], captainId: null, viceCaptainId: null, revision: 7 };
  const before = structuredClone(locked);
  const reopened = act(locked, unlock(locked), HOST, NOW + 100);
  assert.equal(reopened.phase, "live");
  assert.equal(reopened.version, locked.version + 1);
  assert.equal(reopened.serverTime, NOW + 100);
  for (const key of ["currentPlayerId", "currentBid", "leadingTeamId", "lastBidAt", "bidHistory", "bidLockVersion", "teams", "players", "settings", "catalogVersion", "catalogDataRevision", "sharedCatalogVersion"] as const) {
    assert.deepEqual(reopened[key], locked[key], `${key} must survive reopening`);
  }
  assert.deepEqual(reopened.activity.slice(0, -1), locked.activity);
  assert.equal(reopened.activity.at(-1)!.type, "unlock");
  assert.equal(reopened.activity.at(-1)!.memberId, HOST);
  assert.match(reopened.activity.at(-1)!.text, /reopened bidding for Rishabh Pant/);
  assert.deepEqual(locked, before, "successful transitions are immutable");
});

test("a paused auction locked by its host reopens directly into live bidding", () => {
  const locked = act(act(live(), { type: "pause" }), { type: "lock" });
  assert.equal(act(locked, unlock(locked)).phase, "live");
});

test("zero-bid locks reopen without inventing a bid or resetting the base price", () => {
  const locked = act(live(false), { type: "lock" });
  const reopened = act(locked, unlock(locked));
  assert.equal(reopened.currentBid, 0);
  assert.equal(reopened.leadingTeamId, null);
  assert.equal(reopened.lastBidAt, null);
  assert.deepEqual(reopened.bidHistory, []);
  assert.equal(getNextBid(reopened), 200);
  assert.equal(act(reopened, bid(reopened), MI).currentBid, 200);
});

test("bidders, spectators, forged auctioneers and a host without its role cannot unlock", () => {
  const locked = act(live(), { type: "lock" });
  rejects(locked, unlock(locked), "FORBIDDEN", 403, MI);
  const spectator = structuredClone(locked);
  spectator.members.find(member => member.id === MI)!.role = "spectator";
  spectator.members.find(member => member.id === MI)!.teamId = null;
  rejects(spectator, unlock(spectator), "FORBIDDEN", 403, MI);
  const forged = structuredClone(locked);
  forged.members.find(member => member.id === MI)!.role = "auctioneer";
  rejects(forged, unlock(forged), "FORBIDDEN", 403, MI);
  forged.members.find(member => member.id === HOST)!.role = "bidder";
  rejects(forged, unlock(forged), "FORBIDDEN", 403);
  rejects(locked, unlock(locked), "UNAUTHORIZED", 401, "missing-member");
});

test("waiting, live, paused and settled phases cannot be reopened by an unlock", () => {
  const locked = act(live(), { type: "lock" });
  for (const phase of ["waiting", "live", "paused", "sold", "unsold"] as const) {
    rejects({ ...locked, phase }, unlock(locked), "BIDDING_NOT_LOCKED");
  }
  rejects({ ...locked, currentPlayerId: null }, unlock(locked), "BIDDING_NOT_LOCKED");
  for (const status of ["sold", "unsold"] as const) {
    const settled = structuredClone(locked);
    settled.players.find(player => player.id === settled.currentPlayerId)!.status = status;
    rejects(settled, unlock(settled), "BIDDING_NOT_LOCKED");
  }
});

test("unlock rejects stale or missing lot identity and stale displayed amounts", () => {
  const locked = act(live(), { type: "lock" });
  for (const expectedPlayerId of [undefined, null, "", 1, "virat-kohli"]) {
    rejects(locked, { ...unlock(locked), expectedPlayerId }, "STALE_PLAYER");
  }
  for (const expectedAmount of [0, locked.currentBid - 25, locked.currentBid + 25]) {
    rejects(locked, { ...unlock(locked), expectedAmount }, "STALE_BID");
  }
});

test("unlock validates its amount without coercing malformed or unsafe values", () => {
  const locked = act(live(), { type: "lock" });
  for (const expectedAmount of [undefined, null, "725", false, {}, [], -1, 725.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    rejects(locked, { ...unlock(locked), expectedAmount }, "INVALID_UNLOCK_AMOUNT", 400);
  }
});

test("unlock preserves the outstanding bid cooldown and the leading team's exclusion", () => {
  const initial = live(false);
  const first = act(initial, bid(initial), RCB);
  const locked = act(first, { type: "lock" }, HOST, NOW + 100);
  const reopened = act(locked, unlock(locked), HOST, NOW + 200);
  rejects(reopened, bid(reopened), "BID_COOLDOWN", 429, MI, NOW + 999);
  rejects(reopened, bid(reopened), "ALREADY_LEADING", 409, RCB, NOW + 1000);
  const raised = act(reopened, bid(reopened), MI, NOW + 1000);
  assert.equal(raised.currentBid, first.currentBid + first.settings.bidIncrement);
  assert.equal(raised.leadingTeamId, "mi");
  assert.equal(raised.bidHistory.length, first.bidHistory.length + 1);
});

test("unlock does not bypass purse, squad size, or overseas bidding limits", () => {
  const locked = act(live(), { type: "lock" });
  const reopened = act(locked, unlock(locked));
  const poor = structuredClone(reopened);
  poor.teams.find(team => team.id === "mi")!.purse = 1;
  rejects(poor, bid(poor), "INSUFFICIENT_PURSE", 409, MI);
  const full = structuredClone(reopened);
  full.settings.maxSquadSize = 1;
  full.teams.find(team => team.id === "mi")!.squad = [{ playerId: "virat-kohli", amount: 200 }];
  rejects(full, bid(full), "SQUAD_FULL", 409, MI);
  const overseas = structuredClone(reopened);
  overseas.settings.maxOverseas = 0;
  overseas.players.find(player => player.id === overseas.currentPlayerId)!.isOverseas = true;
  rejects(overseas, bid(overseas), "OVERSEAS_LIMIT", 409, MI);
});

test("unlock and sale are mutually exclusive against the same locked snapshot", () => {
  const locked = act(live(), { type: "lock" });
  const reopened = act(locked, unlock(locked));
  rejects(reopened, { type: "sell" }, "INVALID_ACTION");
  rejects(reopened, unlock(locked), "BIDDING_NOT_LOCKED");
  assert.deepEqual(reopened.teams, locked.teams);
  const sold = act(locked, { type: "sell" });
  rejects(sold, unlock(locked), "BIDDING_NOT_LOCKED");
  rejects(sold, { type: "sell" }, "INVALID_ACTION");
  const winner = sold.teams.find(team => team.id === locked.leadingTeamId)!;
  assert.equal(winner.squad.filter(player => player.playerId === locked.currentPlayerId).length, 1);
  assert.equal(winner.purse, locked.teams.find(team => team.id === winner.id)!.purse - locked.currentBid);
});

test("a no-bid lock can reopen or settle unsold, never both", () => {
  const locked = act(live(false), { type: "lock" });
  const reopened = act(locked, unlock(locked));
  rejects(reopened, { type: "unsold" }, "INVALID_ACTION");
  const unsold = act(locked, { type: "unsold" });
  rejects(unsold, unlock(locked), "BIDDING_NOT_LOCKED");
  assert.deepEqual(unsold.teams, locked.teams);
});

test("relock after reopening sells exactly once at the updated winning amount", () => {
  const locked = act(live(), { type: "lock" });
  const reopened = act(locked, unlock(locked));
  const raised = act(reopened, bid(reopened), MI);
  const sold = act(act(raised, { type: "lock" }), { type: "sell" });
  assert.equal(sold.phase, "sold");
  const winner = sold.teams.find(team => team.id === "mi")!;
  assert.equal(winner.purse, locked.teams.find(team => team.id === "mi")!.purse - raised.currentBid);
  assert.deepEqual(winner.squad, [{ playerId: locked.currentPlayerId, amount: raised.currentBid }]);
  rejects(sold, unlock(raised), "BIDDING_NOT_LOCKED");
});

test("each lock creates a new marker so a delayed same-price unlock cannot reopen a later lock", () => {
  const initial = live();
  const firstLock = act(initial, { type: "lock" });
  assert.equal(firstLock.bidLockVersion, initial.version + 1);
  const firstUnlock = unlock(firstLock);
  const reopened = act(firstLock, firstUnlock);
  const secondLock = act(reopened, { type: "lock" });
  assert.equal(secondLock.currentBid, firstLock.currentBid);
  assert.equal(secondLock.currentPlayerId, firstLock.currentPlayerId);
  assert.equal(secondLock.bidLockVersion, reopened.version + 1);
  assert.notEqual(secondLock.bidLockVersion, firstLock.bidLockVersion);
  rejects(secondLock, firstUnlock, "STALE_LOCK");
  assert.equal(act(secondLock, unlock(secondLock)).phase, "live");
});

test("missing, malformed and mismatched lock markers are rejected without coercion", () => {
  const locked = act(live(), { type: "lock" });
  for (const expectedLockVersion of [undefined, null, "1", false, {}, [], -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 0, locked.bidLockVersion! + 1]) {
    rejects(locked, { ...unlock(locked), expectedLockVersion }, "STALE_LOCK");
  }
});

test("unrelated chat and trimming activity history do not invalidate the current lock marker", () => {
  const locked = act(live(), { type: "lock" });
  const openingAction = unlock(locked);
  let latest = locked;
  for (let index = 0; index < 151; index += 1) {
    latest = act(latest, { type: "chat", text: `Room message ${index}` }, MI, NOW + index * 1000);
  }
  assert.equal(latest.bidLockVersion, locked.bidLockVersion);
  assert.equal(latest.activity.length, 150);
  assert.ok(latest.activity.every(entry => entry.type === "chat"), "the original lock activity has been evicted");
  assert.ok(latest.version > locked.version);
  const reopened = act(latest, openingAction, HOST, NOW + 152000);
  assert.equal(reopened.phase, "live");
  assert.equal(reopened.currentBid, locked.currentBid);
});

test("legacy locked rooms accept marker zero once but reject its replay after a fresh lock", () => {
  const legacy = act(live(), { type: "lock" });
  delete legacy.bidLockVersion;
  const legacyUnlock = unlock(legacy);
  assert.equal(legacyUnlock.type === "unlock" && legacyUnlock.expectedLockVersion, 0);
  const reopened = act(legacy, legacyUnlock);
  assert.equal(reopened.phase, "live");
  const relocked = act(reopened, { type: "lock" });
  assert.ok(relocked.bidLockVersion! > 0);
  rejects(relocked, legacyUnlock, "STALE_LOCK");
  assert.equal(act(relocked, unlock(relocked)).phase, "live");
});
