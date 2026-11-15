import assert from "node:assert/strict";
import test from "node:test";
import { applyAction, AuctionError, createDemoState, createRoomState, getNextBid, upgradeRoomTeams, type RoomState } from "../lib/auction.ts";
import { TEAM_CATALOG_VERSION, TEAM_SEEDS } from "../lib/team-catalog.ts";
import { createRoomPollCache } from "../lib/room-poll-cache.ts";

const NOW = 1_800_000_000_000;
const historicalIds = ["dch", "pwi"];
const expansionIds = ["gt", "lsg"];
const addedIds = [...historicalIds, ...expansionIds];

function legacyRoom(practice = false, catalogVersion?: number): RoomState {
  const room = createDemoState();
  const removedIds = catalogVersion === 2 ? expansionIds : addedIds;
  room.teams = room.teams.filter(team => !removedIds.includes(team.id));
  room.members = room.members.filter(member => !removedIds.includes(member.teamId || ""));
  if (catalogVersion === undefined) delete room.teamCatalogVersion;
  else room.teamCatalogVersion = catalogVersion;
  if (practice) room.mode = "practice";
  room.sharedCatalogVersion = 7;
  return room;
}

test("new rooms include twelve distinct franchises and all current and historical teams", () => {
  const host = createDemoState().members[0];
  const room = createRoomState("TEAMS1", "Franchise selection", host, NOW);
  assert.equal(room.teams.length, 12);
  assert.equal(new Set(room.teams.map(team => team.id)).size, 12);
  assert.equal(new Set(room.teams.map(team => team.shortName)).size, 12);
  assert.equal(room.teamCatalogVersion, TEAM_CATALOG_VERSION);
  for (const id of addedIds) {
    const team = room.teams.find(team => team.id === id)!;
    assert.equal(team.purse, room.settings.purse);
    assert.deepEqual(team.squad, []);
  }
  assert.equal(room.teams.find(team => team.id === "dch")!.name, "Deccan Chargers");
  assert.equal(room.teams.find(team => team.id === "pwi")!.name, "Pune Warriors India");
  assert.equal(room.teams.find(team => team.id === "gt")!.name, "Gujarat Titans");
  assert.equal(room.teams.find(team => team.id === "lsg")!.name, "Lucknow Super Giants");
  assert.equal(room.members.length, 1, "real rooms never inherit simulated managers");
});

test("practice includes a named simulated manager for every franchise", () => {
  const room = createDemoState();
  assert.equal(room.members.length, 13);
  for (const team of TEAM_SEEDS) {
    const managers = room.members.filter(member => member.teamId === team.id);
    assert.equal(managers.length, 1);
    assert.ok(managers[0].name?.trim());
    assert.equal(managers[0].id, `demo-${team.id}`);
  }
});

test("team migration preserves financials, overrides, members, current lot and all auction history", () => {
  const room = legacyRoom();
  room.settings.purse = 12500;
  room.teams[0].name = "Organizer's Chennai";
  room.teams[0].purse = 11000;
  room.teams[0].squad = [{ playerId: "virat-kohli", amount: 1500 }];
  const player = room.players.find(player => player.id === "virat-kohli")!;
  player.status = "sold"; player.soldTo = "csk"; player.soldFor = 1500;
  const before = structuredClone(room);
  const upgraded = upgradeRoomTeams(room, NOW);
  assert.deepEqual(room, before, "input is never mutated");
  assert.deepEqual(upgraded.teams.slice(0, 8), before.teams);
  assert.deepEqual(upgraded.members, before.members);
  for (const field of ["players", "currentPlayerId", "currentBid", "leadingTeamId", "phase", "lastBidAt", "bidHistory", "activity", "settings", "hostId", "sharedCatalogVersion"] as const) {
    assert.deepEqual(upgraded[field], before[field], field);
  }
  for (const id of addedIds) {
    assert.equal(upgraded.teams.find(team => team.id === id)!.purse, 12500);
    assert.deepEqual(upgraded.teams.find(team => team.id === id)!.squad, []);
  }
  assert.equal(upgraded.version, room.version + 1);
  assert.equal(upgraded.serverTime, NOW);
  assert.strictEqual(upgradeRoomTeams(upgraded, NOW + 1), upgraded, "migration is idempotent and avoids repeat writes");
});

test("migration does not overwrite an already-present historical franchise or owner", () => {
  const room = legacyRoom();
  room.teams.push({ id: "dch", name: "Custom Deccan", shortName: "DCH", color: "#ffffff", purse: 7500, squad: [{ playerId: "virat-kohli", amount: 2500 }] });
  room.members.push({ ...room.members[1], id: "historic-owner", teamId: "dch", name: "Existing owner" });
  const existing = structuredClone(room.teams.at(-1));
  const upgraded = upgradeRoomTeams(room, NOW);
  assert.equal(upgraded.teams.length, 12);
  assert.deepEqual(upgraded.teams.find(team => team.id === "dch"), existing);
  assert.deepEqual(upgraded.members, room.members);
});

test("old practice rooms gain simulated seats without altering existing participants", () => {
  const room = legacyRoom(true);
  const upgraded = upgradeRoomTeams(room, NOW);
  assert.deepEqual(upgraded.members.slice(0, room.members.length), room.members);
  assert.deepEqual(upgraded.members.slice(-4).map(member => [member.id, member.name, member.teamId]), [
    ["demo-dch", "Ishaan", "dch"], ["demo-pwi", "Meera", "pwi"], ["demo-gt", "Rohan", "gt"], ["demo-lsg", "Sana", "lsg"],
  ]);
  assert.equal(upgradeRoomTeams(upgraded).members.length, 13);
});

test("persisted v2 rooms gain GT and LSG while preserving purchases, lineups, owners and a live bid", () => {
  const room = legacyRoom(false, 2);
  const team = room.teams.find(team => team.id === "dch")!;
  team.name = "Existing Deccan squad";
  team.purse = 7250;
  team.squad = [{ playerId: "virat-kohli", amount: 2750 }];
  team.lineup = { playingXI: [null, null, "virat-kohli"], substitutes: [], captainId: "virat-kohli", viceCaptainId: null, revision: 8 };
  const player = room.players.find(player => player.id === "virat-kohli")!;
  player.status = "sold"; player.soldTo = "dch"; player.soldFor = 2750;
  const before = structuredClone(room);
  const upgraded = upgradeRoomTeams(room, NOW);
  assert.deepEqual(room, before, "migration does not mutate its source");
  assert.deepEqual(upgraded.teams.slice(0, 10), before.teams, "existing team records and saved batting positions are untouched");
  assert.deepEqual(upgraded.teams.slice(10).map(team => team.id), expansionIds);
  for (const id of expansionIds) {
    assert.equal(upgraded.teams.find(team => team.id === id)!.purse, room.settings.purse);
    assert.deepEqual(upgraded.teams.find(team => team.id === id)!.squad, []);
  }
  for (const field of ["members", "players", "currentPlayerId", "currentBid", "leadingTeamId", "phase", "lastBidAt", "bidHistory", "activity", "settings", "hostId", "sharedCatalogVersion"] as const) {
    assert.deepEqual(upgraded[field], before[field], field);
  }
  assert.equal(upgraded.teamCatalogVersion, 3);
  assert.equal(upgraded.version, before.version + 1);
  assert.strictEqual(upgradeRoomTeams(upgraded, NOW + 1), upgraded);
});

test("v2 migration retains a pre-existing custom GT record and adds only the missing franchise", () => {
  const room = legacyRoom(false, 2);
  const existing = { id: "gt", name: "My Titans", shortName: "GT", color: "#aabbcc", purse: 5000, squad: [{ playerId: "virat-kohli", amount: 5000 }] };
  room.teams.push(existing);
  room.members.push({ ...room.members[1], id: "existing-gt-owner", name: "Titans manager", teamId: "gt" });
  const upgraded = upgradeRoomTeams(room, NOW);
  assert.deepEqual(upgraded.teams.find(team => team.id === "gt"), existing);
  assert.deepEqual(upgraded.members, room.members);
  assert.equal(upgraded.teams.length, 12);
});

test("unmigrated team schemas cannot be hidden by an unchanged-poll cache hit", () => {
  const room = legacyRoom(true);
  const cache = createRoomPollCache();
  cache.remember(room, { [room.hostId]: "host-hash" });
  assert.equal(cache.check(room.code, room.version, 7, "host-hash", NOW), "miss");
  const upgraded = upgradeRoomTeams(room, NOW);
  cache.remember(upgraded, { [room.hostId]: "host-hash" });
  assert.equal(cache.check(upgraded.code, upgraded.version, 7, "host-hash", NOW), "unchanged");
  cache.remember(room, { [room.hostId]: "host-hash" });
  assert.equal(cache.check(upgraded.code, upgraded.version, 7, "host-hash", NOW), "miss", "remembering stale schema clears its prior authorization entry");
});

for (const teamId of addedIds) {
  test(`${teamId} can claim a seat, bid and receive a sale under the normal permission rules`, () => {
    const demo = createDemoState();
    let room = createRoomState("TEAMS2", "Historical team bidding", demo.members[0], NOW);
    room.members.push({ ...demo.members[1], id: "new-owner", teamId: null, role: "spectator" });
    room = applyAction(room, { type: "claim_team", teamId }, "new-owner", NOW);
    assert.equal(room.members.at(-1)!.role, "bidder");
    assert.throws(() => applyAction(room, { type: "select_player", playerId: "virat-kohli" }, "new-owner", NOW), (error: unknown) => error instanceof AuctionError && error.code === "FORBIDDEN");
    room = applyAction(room, { type: "select_player", playerId: "virat-kohli" }, room.hostId, NOW);
    room = applyAction(room, { type: "start" }, room.hostId, NOW);
    const price = getNextBid(room);
    room = applyAction(room, { type: "bid", expectedPlayerId: "virat-kohli", expectedAmount: price }, "new-owner", NOW);
    assert.equal(room.leadingTeamId, teamId);
    room = applyAction(room, { type: "lock" }, room.hostId, NOW);
    room = applyAction(room, { type: "sell" }, room.hostId, NOW);
    assert.equal(room.teams.find(team => team.id === teamId)!.purse, room.settings.purse - price);
    assert.deepEqual(room.teams.find(team => team.id === teamId)!.squad, [{ playerId: "virat-kohli", amount: price }]);
    assert.equal(room.players.find(player => player.id === "virat-kohli")!.soldTo, teamId);
  });
}
