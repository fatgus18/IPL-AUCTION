import assert from "node:assert/strict";
import test from "node:test";
import { createDemoState, type Player } from "../lib/auction.ts";
import { availableCatalogPlayers, findDuplicatePlayer, hasProtectedReference, playerProfileIdentity, syncRoomPlayerCatalog } from "../lib/shared-player-catalog.ts";

test("shared catalog strips room sales without mutating the source", () => {
  const state = createDemoState();
  state.players[0] = { ...state.players[0], status: "sold", soldTo: "mi", soldFor: 800 };
  const players = availableCatalogPlayers(state.players);
  assert.equal(players[0].status, "available");
  assert.equal(players[0].soldTo, undefined);
  assert.equal(players[0].soldFor, undefined);
  assert.equal(state.players[0].soldFor, 800);
});

test("catalog sync preserves bids, purses, memberships and private room outcomes", () => {
  const state = createDemoState();
  const player = state.players.find(player => player.id !== state.currentPlayerId)!;
  player.status = "sold"; player.soldTo = "mi"; player.soldFor = 500;
  state.teams[1].purse -= 500; state.teams[1].squad.push({ playerId: player.id, amount: 500 });
  const catalog = { players: availableCatalogPlayers(state.players), version: 3 };
  const result = syncRoomPlayerCatalog(state, catalog, 10000);
  assert.equal(result.players.find(p => p.id === player.id)?.soldFor, 500);
  assert.deepEqual(result.teams, state.teams);
  assert.deepEqual(result.bidHistory, state.bidHistory);
  assert.deepEqual(result.members, state.members);
  assert.equal(result.currentBid, state.currentBid);
  assert.equal(result.catalogCount, catalog.players.length);
  assert.equal(result.sharedCatalogVersion, 3);
  assert.equal(result.version, state.version + 1);
  assert.equal(syncRoomPlayerCatalog(result, catalog), result, "unchanged polls do not keep incrementing versions");
});

test("metadata updates reach a live lot while bidding terms remain pinned", () => {
  const state = createDemoState();
  const original = state.players.find(p => p.id === state.currentPlayerId)!;
  const players = availableCatalogPlayers(state.players);
  Object.assign(players.find(p => p.id === original.id)!, { name: "Updated public name", basePrice: 600, country: "Australia", isOverseas: true, stats: { matches: 999, runs: 1, wickets: 1, strikeRate: 1 } });
  const synced = syncRoomPlayerCatalog(state, { players, version: 4 });
  const current = synced.players.find(p => p.id === original.id)!;
  assert.equal(current.name, "Updated public name");
  assert.equal(current.stats.matches, 999);
  assert.equal(current.basePrice, original.basePrice);
  assert.equal(current.isOverseas, original.isOverseas);
  assert.equal(current.country, original.country);
  const reopened = syncRoomPlayerCatalog({ ...synced, phase: "waiting", leadingTeamId: null }, { players, version: 4 }, Date.now(), true);
  assert.equal(reopened.players.find(p => p.id === original.id)?.basePrice, 600);
});

test("shared deletion removes unreferenced records but preserves historical sales", () => {
  const state = createDemoState();
  const saved = state.players[1];
  saved.status = "sold"; saved.soldFor = 25; saved.soldTo = "mi";
  const catalog = { players: state.players.filter(p => p.id !== saved.id && p.id !== state.players[2].id), version: 2 };
  const result = syncRoomPlayerCatalog(state, catalog);
  assert.ok(result.players.some(p => p.id === saved.id));
  assert.ok(!result.players.some(p => p.id === state.players[2].id));
  assert.equal(result.catalogCount, catalog.players.length);
});

test("profile identity ignores provider slug, query parameters and www", () => {
  assert.equal(playerProfileIdentity("https://www.cricbuzz.com/profiles/51665/mahli-beardman?tracking=1"), playerProfileIdentity("https://cricbuzz.com/profiles/51665/another-slug/"));
  assert.equal(playerProfileIdentity("https://www.espncricinfo.com/cricketers/virat-kohli-253802"), "cricinfo:253802");
});

test("global duplicate checks cover edited names and equivalent provider profile links", () => {
  const player = createDemoState().players[0];
  const other: Player = { ...player, id: "another-id", profileUrl: `${player.profileUrl}?source=lookup` };
  assert.equal(findDuplicatePlayer([player], other)?.id, player.id);
  assert.equal(findDuplicatePlayer([player], { ...other, profileUrl: "", name: ` ${player.name.toUpperCase()} ` })?.id, player.id);
  assert.equal(findDuplicatePlayer([player], player), undefined);
});

test("current lots and purchased squads block global removal", () => {
  const state = createDemoState();
  assert.equal(hasProtectedReference(state, state.currentPlayerId!), true);
  assert.equal(hasProtectedReference(state, "unused-player"), false);
  state.teams[0].squad.push({ playerId: "historic-player", amount: 50 });
  assert.equal(hasProtectedReference(state, "historic-player"), true);
});
