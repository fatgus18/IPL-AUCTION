import assert from "node:assert/strict";
import test from "node:test";
import type { AuctionAction, RoomState } from "../lib/auction";

const { applyAction, AuctionError, createDemoState, createRoomState, upgradeRoomCatalog, upgradeRoomTeams }:
  typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { syncRoomPlayerCatalog }: typeof import("../lib/shared-player-catalog") = await import(new URL("../lib/shared-player-catalog.ts", import.meta.url).href);
const NOW = 1_800_000_000_000;
const HOST = "demo-host";
const CSK = "demo-csk";
const act = (state: RoomState, action: AuctionAction, member = HOST, now = NOW) => applyAction(state, action, member, now);
const team = (state: RoomState, id = "csk") => state.teams.find(entry => entry.id === id)!;
const end = (state: RoomState): AuctionAction => ({ type: "end_auction", expectedResultsRevision: state.resultsRevision ?? 0 });

function fixture(count = 3): RoomState {
  const members = createDemoState().members;
  const state = createRoomState("FINISH", "Completed auction test", members[0], NOW - 10000);
  state.members = [...members, { id: "viewer", name: "Viewer", role: "spectator", teamId: null, joinedAt: NOW, lastSeenAt: NOW, flagRaisedAt: null }];
  state.sharedCatalogVersion = 1; state.catalogCount = state.players.length;
  const purchased = state.players.filter(player => !player.isOverseas && player.eligibilityVerified !== false).slice(0, count);
  for (const player of purchased) {
    player.status = "sold"; player.soldTo = "csk"; player.soldFor = 500;
    team(state).squad.push({ playerId: player.id, amount: 500 }); team(state).purse -= 500;
  }
  state.resultsRevision = count;
  if (purchased.length) {
    state.currentPlayerId = purchased[0].id; state.currentBid = 500; state.leadingTeamId = "csk"; state.phase = "sold";
    state.bidHistory.push({ id: "original-bid", playerId: purchased[0].id, teamId: "csk", memberId: CSK, amount: 500, at: NOW - 5000 });
    team(state).lineup = { playingXI: [purchased[0].id, null, purchased[1]?.id ?? null], substitutes: [purchased[2]?.id ?? null], captainId: purchased[0].id, viceCaptainId: purchased[1]?.id ?? null, revision: 4 };
  }
  return state;
}

function correction(state: RoomState, changes: Record<string, unknown> = {}): AuctionAction {
  const player = state.players.find(entry => entry.status === "sold")!;
  return { type: "correct_sale", playerId: player.id, expectedTeamId: player.soldTo!, expectedAmount: player.soldFor!, expectedResultsRevision: state.resultsRevision ?? 0, teamId: "mi", amount: 700, reason: "The sale was attributed to the wrong team.", ...changes } as AuctionAction;
}

function rejects(state: RoomState, action: unknown, code: string, member = HOST, status?: number) {
  const before = structuredClone(state);
  assert.throws(() => act(state, action as AuctionAction, member), (error: unknown) => {
    assert.ok(error instanceof AuctionError); assert.equal(error.code, code);
    if (status) assert.equal(error.status, status);
    return true;
  });
  assert.deepEqual(state, before, "rejected commands never mutate the original room");
}

test("only the actual room creator can end an auction or correct its sales", () => {
  const state = fixture();
  state.members.push({ ...state.members[0], id: "forged-host", name: "Other auctioneer" });
  for (const actor of [CSK, "viewer", "forged-host"]) {
    rejects(state, end(state), "FORBIDDEN", actor, 403);
    rejects(state, correction(state), "FORBIDDEN", actor, 403);
  }
});

test("ending preserves results and archives managers without deleting the room", () => {
  const state = fixture(); const before = structuredClone(state);
  const result = act(state, end(state));
  assert.equal(result.endedAt, NOW); assert.equal(result.endedBy, HOST);
  assert.equal(result.resultsRevision, 4); assert.equal(result.version, state.version + 1);
  assert.deepEqual(result.completedManagers?.csk, { id: CSK, name: state.members.find(member => member.id === CSK)!.name });
  assert.equal(Object.keys(result.completedManagers!).length, state.teams.length);
  for (const key of ["id", "code", "players", "teams", "bidHistory", "settings", "currentBid", "leadingTeamId", "phase"] as const) assert.deepEqual(result[key], state[key]);
  assert.equal(result.activity.at(-1)?.type, "auction_ended");
  assert.deepEqual(state, before);
  rejects(result, end(result), "AUCTION_ALREADY_ENDED");
});

test("live, paused, and locked rounds must be settled before end or correction", () => {
  for (const phase of ["live", "paused", "locked"] as const) {
    const state = fixture(); state.phase = phase;
    rejects(state, end(state), "ROUND_UNSETTLED");
    rejects(state, correction(state), "ROUND_UNSETTLED");
  }
  const empty = fixture(0);
  assert.equal(act(empty, end(empty)).endedAt, NOW, "an empty auction can still be completed");
});

test("result revisions guard late end and correction requests, including legacy revision zero", () => {
  const state = fixture();
  for (const expectedResultsRevision of [undefined, null, -1, "3", 2, 4, 3.5, Number.MAX_SAFE_INTEGER]) {
    rejects(state, { type: "end_auction", expectedResultsRevision }, "RESULTS_CONFLICT");
    rejects(state, correction(state, { expectedResultsRevision }), "RESULTS_CONFLICT");
  }
  delete state.resultsRevision; delete state.saleCorrections;
  const corrected = act(state, correction(state));
  assert.equal(corrected.resultsRevision, 1); assert.equal(corrected.saleCorrections?.length, 1);
});

test("settled auctions reject nominations, bids, settings, catalog mutations, team claims and targets", () => {
  const state = act(fixture(), end(fixture()));
  const blocked = [
    { type: "select_player", playerId: state.players.at(-1)!.id }, { type: "start" }, { type: "pause" },
    { type: "resume" }, { type: "lock" }, { type: "unlock" }, { type: "sell" }, { type: "unsold" },
    { type: "bid" }, { type: "update_settings", settings: {} }, { type: "add_player" },
    { type: "update_player" }, { type: "delete_player" }, { type: "claim_team", teamId: null }, { type: "set_target_picks" },
  ];
  for (const action of blocked) rejects(state, action, "AUCTION_ENDED");
});

test("lineups and chat still work after ending while leaving preserves the completed manager", () => {
  const original = fixture(); const state = act(original, end(original));
  const lineup = team(state).lineup!;
  const saved = act(state, { type: "set_lineup", teamId: "csk", expectedRevision: lineup.revision, lineup: { ...lineup, captainId: lineup.viceCaptainId, viceCaptainId: lineup.captainId } }, CSK);
  assert.equal(team(saved).lineup!.revision, lineup.revision + 1);
  assert.deepEqual(saved.completedManagers, state.completedManagers);
  const chatted = act(saved, { type: "chat", text: "Great auction." }, CSK);
  const left = act(chatted, { type: "leave" }, CSK);
  assert.ok(!left.members.some(member => member.id === CSK));
  assert.deepEqual(left.completedManagers, state.completedManagers);
  assert.equal(act(left, { type: "ping" }).endedAt, NOW);
});

test("sale correction refunds the old team, charges the receiver and records an immutable public audit", () => {
  const state = fixture(); const command = correction(state); const original = structuredClone(state);
  const result = act(state, command);
  assert.equal(team(result).purse, team(state).purse + 500);
  assert.equal(team(result, "mi").purse, team(state, "mi").purse - 700);
  const id = state.currentPlayerId!;
  assert.ok(!team(result).squad.some(sale => sale.playerId === id));
  assert.deepEqual(team(result, "mi").squad, [{ playerId: id, amount: 700 }]);
  assert.equal(result.players.find(player => player.id === id)!.soldTo, "mi");
  assert.equal(result.players.find(player => player.id === id)!.soldFor, 700);
  assert.equal(result.phase, "sold"); assert.equal(result.currentBid, 700); assert.equal(result.leadingTeamId, "mi");
  assert.deepEqual(result.bidHistory, state.bidHistory, "original bids remain historical facts");
  assert.deepEqual(result.saleCorrections![0], {
    id: `correction-4-${NOW}`, at: NOW, actorId: HOST, actorName: state.members[0].name,
    playerId: id, playerName: state.players.find(player => player.id === id)!.name,
    reason: "The sale was attributed to the wrong team.", revision: 4,
    before: { teamId: "csk", teamName: team(state).name, amount: 500 },
    after: { teamId: "mi", teamName: team(state, "mi").name, amount: 700 },
  });
  assert.deepEqual(state, original);
  rejects(result, command, "RESULTS_CONFLICT");
});

test("moving a sale clears only its previous lineup slot and leadership without shifting positions", () => {
  const state = fixture(); const result = act(state, correction(state));
  assert.deepEqual(team(result).lineup?.playingXI, [null, null, team(state).lineup!.playingXI[2]]);
  assert.deepEqual(team(result).lineup?.substitutes, team(state).lineup!.substitutes);
  assert.equal(team(result).lineup?.captainId, null);
  assert.equal(team(result).lineup?.viceCaptainId, team(state).lineup!.viceCaptainId);
  assert.equal(team(result).lineup?.revision, 5);
  assert.equal(team(result, "mi").lineup, undefined, "the receiving manager chooses their own XI");
  rejects(result, { type: "set_lineup", teamId: "csk", expectedRevision: 4, lineup: team(state).lineup }, "LINEUP_CONFLICT", CSK);
});

test("same-team price edits preserve squad order and the complete lineup even at the squad cap", () => {
  const state = fixture(); state.settings.maxSquadSize = 3;
  const result = act(state, correction(state, { teamId: "csk", amount: 800 }));
  assert.equal(team(result).purse, team(state).purse - 300);
  assert.deepEqual(team(result).lineup, team(state).lineup);
  assert.deepEqual(team(result).squad.map(sale => sale.playerId), team(state).squad.map(sale => sale.playerId));
  assert.equal(team(result).squad[0].amount, 800);
  rejects(state, correction(state, { teamId: "csk", amount: 500 }), "NO_CORRECTION_CHANGE");
});

test("cancelling a sale returns the player to the pool, refunds exactly once and permits a later auction", () => {
  const state = fixture(); const result = act(state, correction(state, { teamId: null, amount: undefined }));
  const player = result.players.find(entry => entry.id === state.currentPlayerId)!;
  assert.equal(player.status, "available"); assert.equal(player.soldTo, undefined); assert.equal(player.soldFor, undefined);
  assert.equal(result.currentBid, 0); assert.equal(result.leadingTeamId, null); assert.equal(result.phase, "waiting");
  assert.equal(team(result).purse, team(state).purse + 500); assert.equal(result.saleCorrections![0].after, null);
  rejects(result, correction(state, { expectedResultsRevision: result.resultsRevision, teamId: null }), "SALE_CONFLICT");
  let bidding = act(result, { type: "start" });
  bidding = act(bidding, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice, customAmount: 600 }, "demo-mi");
  const sold = act(act(bidding, { type: "lock" }), { type: "sell" });
  assert.equal(sold.resultsRevision, 5); assert.equal(team(sold, "mi").purse, 9400);
  assert.equal(sold.saleCorrections?.length, 1); assert.equal(sold.bidHistory[0].amount, 500);
});

test("corrections validate current sale terms, reasons, safe whole-lakh prices and team identity", () => {
  const state = fixture();
  rejects(state, correction(state, { expectedTeamId: "mi" }), "SALE_CONFLICT");
  rejects(state, correction(state, { expectedAmount: 400 }), "SALE_CONFLICT");
  rejects(state, correction(state, { playerId: "missing" }), "SALE_CONFLICT");
  for (const reason of [undefined, null, "", "  ", "\u0000", "a".repeat(501)]) rejects(state, correction(state, { reason }), "INVALID_ACTION");
  for (const amount of [undefined, null, "700", 0, -1, 0.5, 100001, Number.MAX_SAFE_INTEGER, Infinity]) rejects(state, correction(state, { amount }), "INVALID_ACTION");
  for (const teamId of [undefined, "missing", false, 1]) rejects(state, correction(state, { teamId }), "INVALID_ACTION");
  const trimmed = act(state, correction(state, { reason: "  Wrong\u0000 seat.  " }));
  assert.equal(trimmed.saleCorrections![0].reason, "Wrong seat.");
});

test("purse, squad capacity and overseas checks roll back the entire correction on rejection", () => {
  const poor = fixture(); team(poor, "mi").purse = 699;
  rejects(poor, correction(poor), "INSUFFICIENT_PURSE");
  const full = fixture(); full.settings.maxSquadSize = 1; team(full, "mi").squad = [{ playerId: full.players.at(-1)!.id, amount: 25 }];
  rejects(full, correction(full), "SQUAD_FULL");
  const overseas = fixture(); overseas.players.find(player => player.id === overseas.currentPlayerId)!.isOverseas = true; overseas.settings.maxOverseas = 0;
  rejects(overseas, correction(overseas), "OVERSEAS_LIMIT");
});

test("audit survives chat eviction and remains append-only through later corrections after ending", () => {
  let state = fixture(); state = act(state, correction(state));
  const first = structuredClone(state.saleCorrections![0]);
  state = act(state, end(state)); const endedAt = state.endedAt;
  const changed = act(state, correction(state, { playerId: state.currentPlayerId, expectedTeamId: "mi", expectedAmount: 700, teamId: "rcb", amount: 900 }));
  assert.equal(changed.endedAt, endedAt); assert.deepEqual(changed.saleCorrections![0], first); assert.equal(changed.saleCorrections?.length, 2);
  state = changed;
  for (let index = 1; index <= 151; index++) state = act(state, { type: "chat", text: `Message ${index}` }, HOST, NOW + index * 1100);
  assert.ok(state.activity.every(entry => entry.type === "chat")); assert.equal(state.activity.length, 150);
  assert.deepEqual(state.saleCorrections, changed.saleCorrections);
});

test("completed player and franchise snapshots survive later catalog and team migrations", () => {
  const original = fixture(); const ended = act(original, end(original));
  const shared = structuredClone(original.players); shared[0].name = "Changed globally"; shared.pop();
  const synced = syncRoomPlayerCatalog(ended, { players: shared, version: 2 });
  assert.deepEqual(synced.players, ended.players); assert.equal(synced.catalogCount, ended.catalogCount);
  assert.equal(synced.sharedCatalogVersion, 2); assert.equal(synced.version, ended.version + 1);
  assert.equal(syncRoomPlayerCatalog(synced, { players: shared, version: 2 }, NOW, true), synced);
  synced.catalogVersion = "old"; synced.teamCatalogVersion = 0;
  assert.equal(upgradeRoomCatalog(synced), synced); assert.equal(upgradeRoomTeams(synced), synced);
});
