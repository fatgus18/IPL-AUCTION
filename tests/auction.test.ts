import assert from "node:assert/strict";
import test from "node:test";
import type { AuctionAction, Member, PlayerInput, RoomState } from "../lib/auction";

// A URL import lets Node run these tests with built-in TypeScript stripping,
// without requiring a test runner or changing the application's module settings.
const { applyAction, AuctionError, createDemoState, createRoomState, getNextBid }:
  typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);

const NOW = 1_800_000_000_000;
const HOST = "demo-host";
const CSK = "demo-csk";
const MI = "demo-mi";

function demo(): RoomState {
  const room = createDemoState();
  room.lastBidAt = NOW - 5000;
  room.serverTime = NOW;
  return room;
}

function fresh(): RoomState {
  const members = demo().members;
  const room = createRoomState("TEST26", "Test auction", members[0], NOW);
  room.members = members;
  return room;
}

function act(room: RoomState, action: AuctionAction, memberId = HOST, now = NOW): RoomState {
  return applyAction(room, action, memberId, now);
}

function open(room = fresh(), playerId = "rishabh-pant", now = NOW): RoomState {
  return act(act(room, { type: "select_player", playerId }, HOST, now), { type: "start" }, HOST, now);
}

function bidAction(room: RoomState, expectedAmount = getNextBid(room)): AuctionAction {
  assert.ok(room.currentPlayerId);
  return { type: "bid", expectedPlayerId: room.currentPlayerId, expectedAmount };
}

function bid(room: RoomState, memberId = CSK, now = NOW): RoomState {
  return act(room, bidAction(room), memberId, now);
}

function sell(room: RoomState, now = NOW): RoomState {
  return act(act(room, { type: "lock" }, HOST, now), { type: "sell" }, HOST, now);
}

function rejects(room: RoomState, action: AuctionAction, options: { memberId?: string; now?: number; code?: string; status?: number } = {}) {
  const before = structuredClone(room);
  assert.throws(() => act(room, action, options.memberId ?? HOST, options.now ?? NOW), (error: unknown) => {
    assert.ok(error instanceof AuctionError);
    if (options.code) assert.equal(error.code, options.code);
    if (options.status) assert.equal(error.status, options.status);
    return true;
  });
  assert.deepEqual(room, before, "rejected actions must not mutate the room");
}

const customPlayer: PlayerInput = {
  id: "custom-player", name: "Custom Player", country: "India", role: "Batter", basePrice: 50,
  isOverseas: false, stats: { matches: 12, runs: 350, wickets: 0, strikeRate: 140.5 },
};

test("a new room waits for the auctioneer to select and open a player", () => {
  const room = fresh();
  assert.equal(room.phase, "waiting");
  assert.equal(room.currentPlayerId, null);
  rejects(room, { type: "start" }, { status: 409 });
  const selected = act(room, { type: "select_player", playerId: "virat-kohli" });
  assert.equal(selected.currentPlayerId, "virat-kohli");
  rejects(selected, bidAction(selected, 200), { memberId: CSK, code: "BIDDING_CLOSED" });
  const live = act(selected, { type: "start" });
  assert.equal(live.phase, "live");
  assert.equal(live.version, room.version + 2);
  assert.equal(room.currentPlayerId, null);
});

test("all auction and pool administration actions require the auctioneer", () => {
  const room = demo();
  const player = room.players.find((entry) => entry.id === "virat-kohli")!;
  const actions: AuctionAction[] = [
    { type: "select_player", playerId: player.id }, { type: "start" }, { type: "pause" },
    { type: "resume" }, { type: "lock" }, { type: "sell" }, { type: "unsold" },
    { type: "add_player", player: customPlayer }, { type: "update_player", player },
    { type: "delete_player", playerId: player.id }, { type: "update_settings", settings: { callUrl: "https://meet.example.com/room" } },
  ];
  for (const action of actions) rejects(room, action, { memberId: CSK, code: "FORBIDDEN", status: 403 });
});

test("unknown members and a forged auctioneer role do not gain host authority", () => {
  const room = demo();
  rejects(room, { type: "ping" }, { memberId: "unregistered", code: "UNAUTHORIZED", status: 401 });
  room.members.find((member) => member.id === CSK)!.role = "auctioneer";
  rejects(room, { type: "lock" }, { memberId: CSK, code: "FORBIDDEN" });
});

test("first bids use the base price and later bids increment exactly once", () => {
  const room = open();
  assert.equal(getNextBid(room), 200);
  const first = bid(room);
  assert.equal(first.currentBid, 200);
  assert.equal(first.leadingTeamId, "csk");
  assert.equal(first.bidHistory.length, 1);
  assert.equal(first.members.find((member) => member.id === CSK)!.flagRaisedAt, null);
  const second = bid(first, MI, NOW + 1000);
  assert.equal(second.currentBid, 225);
  assert.equal(second.bidHistory.length, 2);
  assert.equal(second.leadingTeamId, "mi");
  assert.equal(room.currentBid, 0);
  assert.equal(room.bidHistory.length, 0);
});

test("concurrent stale prices are rejected without silently raising the price", () => {
  const room = demo();
  const displayedAmount = getNextBid(room);
  const first = act(room, bidAction(room, displayedAmount), CSK);
  rejects(first, bidAction(first, displayedAmount), { memberId: MI, now: NOW + 1000, code: "STALE_BID" });
  assert.equal(first.currentBid, displayedAmount);
  assert.equal(first.bidHistory.length, room.bidHistory.length + 1);
});

test("a delayed bid cannot buy a different player at the same opening price", () => {
  const firstPlayer = open();
  const delayedBid = bidAction(firstPlayer);
  const unsold = act(act(firstPlayer, { type: "lock" }), { type: "unsold" });
  const nextPlayer = open(unsold, "virat-kohli", NOW + 5000);
  assert.equal(getNextBid(firstPlayer), getNextBid(nextPlayer));
  rejects(nextPlayer, delayedBid, { memberId: CSK, now: NOW + 5000, code: "STALE_PLAYER", status: 409 });
  assert.equal(nextPlayer.currentBid, 0);
  assert.equal(nextPlayer.leadingTeamId, null);
  assert.equal(nextPlayer.bidHistory.length, 0);
  assert.equal(bid(nextPlayer, CSK, NOW + 5000).leadingTeamId, "csk");
});

test("a malformed bid that omits the intended player is rejected", () => {
  const room = open();
  const malformed = { type: "bid", expectedAmount: getNextBid(room) } as AuctionAction;
  rejects(room, malformed, { memberId: CSK, code: "STALE_PLAYER", status: 409 });
});

test("the room-wide cooldown rejects 999ms and accepts exactly 1000ms", () => {
  const first = bid(demo());
  rejects(first, bidAction(first), { memberId: MI, now: NOW + 999, code: "BID_COOLDOWN", status: 429 });
  const second = bid(first, MI, NOW + 1000);
  assert.equal(second.lastBidAt, NOW + 1000);
  assert.equal(second.currentBid, first.currentBid + first.settings.bidIncrement);
});

test("the leading team cannot outbid itself even after the cooldown", () => {
  const room = bid(demo());
  rejects(room, bidAction(room), { memberId: CSK, now: NOW + 5000, code: "ALREADY_LEADING" });
});

test("bids reject invalid displayed amounts", () => {
  const room = demo();
  for (const expectedAmount of [0, -25, 750.5, NaN, Infinity, 10000]) {
    rejects(room, bidAction(room, expectedAmount), { memberId: CSK, code: "STALE_BID" });
  }
});

test("spectators and an auctioneer without a team cannot bid", () => {
  const room = demo();
  const spectator: Member = { id: "spectator", name: "Viewer", role: "spectator", teamId: null, joinedAt: NOW, lastSeenAt: NOW, flagRaisedAt: null };
  room.members.push(spectator);
  for (const memberId of [HOST, spectator.id]) {
    rejects(room, bidAction(room), { memberId, code: "NO_TEAM", status: 403 });
  }
});

test("paused bidding preserves the leader and resumes with the same next price", () => {
  const room = demo();
  const paused = act(room, { type: "pause" });
  assert.equal(paused.phase, "paused");
  assert.equal(paused.currentBid, room.currentBid);
  assert.equal(paused.leadingTeamId, room.leadingTeamId);
  rejects(paused, bidAction(paused), { memberId: CSK, code: "BIDDING_CLOSED" });
  const resumed = act(paused, { type: "resume" });
  assert.equal(bid(resumed).currentBid, getNextBid(room));
  rejects(room, { type: "resume" }, { status: 409 });
});

test("locking live or paused bidding rejects every later bid", () => {
  for (const room of [demo(), act(demo(), { type: "pause" })]) {
    const locked = act(room, { type: "lock" });
    assert.equal(locked.phase, "locked");
    rejects(locked, bidAction(locked), { memberId: CSK, now: NOW + 10000, code: "BIDDING_CLOSED" });
    rejects(locked, { type: "resume" }, { status: 409 });
    rejects(locked, { type: "start" }, { status: 409 });
  }
});

test("a sale requires a locked bid and debits the winning purse exactly once", () => {
  const room = demo();
  const winningTeamBefore = room.teams.find((team) => team.id === room.leadingTeamId)!;
  rejects(room, { type: "sell" }, { status: 409 });
  const sold = sell(room);
  const winner = sold.teams.find((team) => team.id === room.leadingTeamId)!;
  const player = sold.players.find((entry) => entry.id === room.currentPlayerId)!;
  assert.equal(sold.phase, "sold");
  assert.equal(winner.purse, winningTeamBefore.purse - 725);
  assert.deepEqual(winner.squad, [{ playerId: "rishabh-pant", amount: 725 }]);
  assert.equal(player.status, "sold");
  assert.equal(player.soldTo, "rcb");
  assert.equal(player.soldFor, 725);
  assert.deepEqual(sold.teams.filter((team) => team.id !== winner.id), room.teams.filter((team) => team.id !== winner.id));
  rejects(sold, { type: "sell" }, { status: 409 });
  rejects(sold, { type: "select_player", playerId: player.id });
});

test("auctioneer cannot replace an active player or discard a locked winning bid", () => {
  const live = demo();
  const paused = act(live, { type: "pause" });
  const locked = act(live, { type: "lock" });
  for (const room of [live, paused, locked]) {
    rejects(room, { type: "select_player", playerId: "virat-kohli" }, { status: 409 });
  }
  rejects(locked, { type: "unsold" }, { status: 409 });
  const next = act(sell(live), { type: "select_player", playerId: "virat-kohli" });
  assert.equal(next.currentBid, 0);
  assert.equal(next.leadingTeamId, null);
  assert.equal(next.lastBidAt, null);
});

test("a player with no bids can be marked unsold and offered again", () => {
  const room = open();
  rejects(room, { type: "unsold" }, { status: 409 });
  const locked = act(room, { type: "lock" });
  rejects(locked, { type: "sell" }, { status: 409 });
  const unsold = act(locked, { type: "unsold" });
  assert.equal(unsold.players.find((player) => player.id === "rishabh-pant")!.status, "unsold");
  const reopened = open(unsold);
  assert.equal(reopened.players.find((player) => player.id === "rishabh-pant")!.status, "available");
  assert.equal(getNextBid(reopened), 200);
});

test("bids above the remaining purse fail while a bid equal to it succeeds", () => {
  const room = open();
  room.teams.find((team) => team.id === "csk")!.purse = 199;
  rejects(room, bidAction(room, 200), { memberId: CSK, code: "INSUFFICIENT_PURSE" });
  room.teams.find((team) => team.id === "csk")!.purse = 200;
  const sold = sell(bid(room));
  assert.equal(sold.teams.find((team) => team.id === "csk")!.purse, 0);
});

test("a full squad cannot bid for another player", () => {
  const configured = act(fresh(), { type: "update_settings", settings: { maxSquadSize: 1, maxOverseas: 1 } });
  const firstSale = sell(bid(open(configured)));
  const secondPlayer = open(firstSale, "virat-kohli", NOW + 5000);
  rejects(secondPlayer, bidAction(secondPlayer, 200), { memberId: CSK, now: NOW + 5000, code: "SQUAD_FULL" });
  assert.equal(bid(secondPlayer, MI, NOW + 5000).leadingTeamId, "mi");
});

test("overseas limits prevent overseas bids but still permit domestic players", () => {
  const configured = act(fresh(), { type: "update_settings", settings: { maxOverseas: 1 } });
  const firstSale = sell(bid(open(configured, "jos-buttler")));
  const anotherOverseas = open(firstSale, "rashid-khan", NOW + 5000);
  rejects(anotherOverseas, bidAction(anotherOverseas, 200), { memberId: CSK, now: NOW + 5000, code: "OVERSEAS_LIMIT" });
  const unsold = act(act(anotherOverseas, { type: "lock" }), { type: "unsold" });
  assert.equal(bid(open(unsold, "virat-kohli"), CSK, NOW + 6000).leadingTeamId, "csk");
});

test("settings cannot invalidate the existing squad or current winning bid", () => {
  const configured = act(fresh(), { type: "update_settings", settings: { maxOverseas: 2 } });
  const sold = sell(bid(open(configured, "jos-buttler")));
  rejects(sold, { type: "update_settings", settings: { maxOverseas: 0 } }, { status: 409 });
  const leading = bid(open(sold, "rashid-khan"), CSK, NOW + 5000);
  rejects(leading, { type: "update_settings", settings: { maxOverseas: 1 } }, { code: "OVERSEAS_LIMIT" });
  rejects(leading, { type: "update_settings", settings: { maxSquadSize: 1, maxOverseas: 1 } }, { code: "SQUAD_FULL" });
});

test("organizers can add, edit, and remove a custom player", () => {
  const room = fresh();
  const added = act(room, { type: "add_player", player: { ...customPlayer, name: "  Custom Player  " } });
  const player = added.players.find((entry) => entry.id === customPlayer.id)!;
  assert.equal(player.name, "Custom Player");
  assert.equal(player.status, "available");
  assert.equal(added.players.length, room.players.length + 1);
  const edited = act(added, { type: "update_player", player: { ...player, role: "Wicketkeeper", basePrice: 75 } });
  assert.equal(edited.players.find((entry) => entry.id === player.id)!.basePrice, 75);
  assert.equal(edited.players.find((entry) => entry.id === player.id)!.role, "Wicketkeeper");
  const removed = act(edited, { type: "delete_player", playerId: player.id });
  assert.equal(removed.players.length, room.players.length);
  assert.ok(!removed.players.some((entry) => entry.id === player.id));
  rejects(removed, { type: "delete_player", playerId: player.id }, { status: 404 });
});

test("invalid player details and duplicate IDs are rejected", () => {
  const room = fresh();
  const invalid: PlayerInput[] = [
    { ...customPlayer, name: "  " }, { ...customPlayer, country: "" },
    { ...customPlayer, basePrice: 0 }, { ...customPlayer, basePrice: 25.5 },
    { ...customPlayer, basePrice: NaN }, { ...customPlayer, basePrice: Infinity },
    { ...customPlayer, id: "unsafe/id" }, { ...customPlayer, role: "Invalid" as PlayerInput["role"] },
    { ...customPlayer, stats: { ...customPlayer.stats, matches: -1 } },
    { ...customPlayer, image: "javascript:alert(1)" },
  ];
  for (const player of invalid) rejects(room, { type: "add_player", player });
  const added = act(room, { type: "add_player", player: customPlayer });
  rejects(added, { type: "add_player", player: customPlayer }, { status: 409 });
});

test("active and sold players cannot be edited or deleted", () => {
  const live = demo();
  for (const room of [live, sell(live)]) {
    const player = room.players.find((entry) => entry.id === "rishabh-pant")!;
    rejects(room, { type: "update_player", player: { ...player, basePrice: 50 } }, { status: 409 });
    rejects(room, { type: "delete_player", playerId: player.id }, { status: 409 });
  }
  const sold = act(sell(live), { type: "select_player", playerId: "virat-kohli" });
  const player = sold.players.find((entry) => entry.id === "rishabh-pant")!;
  rejects(sold, { type: "update_player", player }, { status: 409 });
  rejects(sold, { type: "delete_player", playerId: player.id }, { status: 409 });
});

test("call links accept HTTPS and reject executable, relative, and credential-bearing URLs", () => {
  const room = fresh();
  for (const callUrl of ["javascript:alert(1)", "http://meet.example.com/room", "/call", "data:text/html,hello", "https://user:secret@example.com/room", "not a url"]) {
    rejects(room, { type: "update_settings", settings: { callUrl } });
  }
  const saved = act(room, { type: "update_settings", settings: { callUrl: "https://meet.example.com/room?code=123" } });
  assert.equal(saved.settings.callUrl, "https://meet.example.com/room?code=123");
  assert.equal(act(saved, { type: "update_settings", settings: { callUrl: "" } }).settings.callUrl, "");
});

test("bidding rules are bounded and cannot change during a live auction", () => {
  const room = fresh();
  for (const settings of [{ bidCooldownMs: 999 }, { bidCooldownMs: 2001 }, { bidIncrement: 0 }, { maxSquadSize: 0 }, { maxOverseas: 26 }, { purse: -1 }]) {
    rejects(room, { type: "update_settings", settings });
  }
  const configured = act(room, { type: "update_settings", settings: { bidCooldownMs: 2000, bidIncrement: 50, purse: 5000 } });
  assert.ok(configured.teams.every((team) => team.purse === 5000));
  const live = open(configured);
  rejects(live, { type: "update_settings", settings: { bidCooldownMs: 1000 } }, { status: 409 });
  rejects(live, { type: "update_settings", settings: { bidIncrement: 25 } }, { status: 409 });
  const first = bid(live);
  rejects(first, bidAction(first, 250), { memberId: MI, now: NOW + 1999, code: "BID_COOLDOWN" });
  assert.equal(bid(first, MI, NOW + 2000).currentBid, 250);
  rejects(first, { type: "update_settings", settings: { purse: 6000 } }, { status: 409 });
});

test("leading bidders cannot leave or surrender their team before settlement", () => {
  const room = demo();
  for (const current of [room, act(room, { type: "pause" }), act(room, { type: "lock" })]) {
    rejects(current, { type: "leave" }, { memberId: "demo-rcb", status: 409 });
    rejects(current, { type: "claim_team", teamId: null }, { memberId: "demo-rcb", status: 409 });
  }
  const sold = sell(room);
  assert.ok(!act(sold, { type: "leave" }, "demo-rcb").members.some((member) => member.id === "demo-rcb"));
});

test("spectators can join a vacant team or leave while the first player awaits bids", () => {
  const room = open();
  room.members = room.members.filter((member) => member.id !== CSK);
  const spectator: Member = { id: "viewer", name: "Viewer", role: "spectator", teamId: null, joinedAt: NOW, lastSeenAt: NOW, flagRaisedAt: null };
  room.members.push(spectator);
  const seated = act(room, { type: "claim_team", teamId: "csk" }, spectator.id);
  assert.equal(seated.members.find((member) => member.id === spectator.id)!.teamId, "csk");
  assert.ok(!act(room, { type: "leave" }, spectator.id).members.some((member) => member.id === spectator.id));
});
