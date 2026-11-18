import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run lifecycle checks through the isolated API runner only.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const baseUrl = process.env.BASE_URL;
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: baseUrl }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return { status: response.status, data: await response.json() };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(ok).then(value => value.state);
const stored = async member => JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [member.state.code] })).rows[0].state_json);
const end = state => ({ type: "end_auction", expectedResultsRevision: state.resultsRevision ?? 0 });
const correct = (state, playerId, changes = {}) => {
  const player = state.players.find(entry => entry.id === playerId);
  return { type: "correct_sale", playerId, expectedTeamId: player.soldTo, expectedAmount: player.soldFor, expectedResultsRevision: state.resultsRevision ?? 0, teamId: "mi", amount: 700, reason: "Corrected an accidental sale to the wrong team.", ...changes };
};
const rejected = async (member, action, status, code) => {
  const before = await stored(member); const response = await act(member, action);
  assert.equal(response.status, status, response.data.error); assert.equal(response.data.code, code);
  assert.deepEqual(await stored(member), before, "rejected lifecycle writes cannot change stored room or private data");
};
const rooms = [];
const create = async name => { const host = ok(await request("/api/rooms", { body: { name, hostName: "Lifecycle creator" } })); rooms.push(host); return host; };

try {
  const host = await create("Completion and audited corrections");
  const password = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword: password } : {}) } });
  const red = ok(await join("Red manager", "rcb"));
  const blue = ok(await join("Blue manager", "mi"));
  const viewer = ok(await join("Recap viewer"));
  const players = host.state.players.filter(player => !player.isOverseas && player.eligibilityVerified !== false).slice(0, 5);
  assert.equal(players.length, 5);
  const purchase = async player => {
    ok(await act(host, { type: "select_player", playerId: player.id }));
    ok(await act(host, { type: "start" }));
    ok(await act(red, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice, customAmount: 500 }));
    ok(await act(host, { type: "lock" }));
    return ok(await act(host, { type: "sell" })).state;
  };
  await purchase(players[0]); let state = await purchase(players[1]);
  assert.equal(state.resultsRevision, 2);
  ok(await act(red, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: [players[0].id, null, players[1].id], substitutes: [], captainId: players[0].id, viceCaptainId: players[1].id } }));
  const privatePicks = ok(await act(red, { type: "set_target_picks", teamId: "rcb", playerIds: [players[3].id], expectedRevision: 0 })).state.myTargetPicks;
  state = await read(host);
  for (const member of [red, blue, viewer]) {
    await rejected(member, end(state), 403, "FORBIDDEN");
    await rejected(member, correct(state, players[0].id), 403, "FORBIDDEN");
  }
  assert.equal((await request(`${pathFor(host)}/action`, { body: { action: end(state) } })).status, 401);
  await rejected(host, { ...end(state), expectedResultsRevision: 1 }, 409, "RESULTS_CONFLICT");
  await rejected(host, correct(state, players[0].id, { expectedAmount: 600 }), 409, "SALE_CONFLICT");
  await rejected(host, correct(state, players[0].id, { reason: " " }), 400, "INVALID_ACTION");
  await rejected(host, correct(state, players[0].id, { amount: 500.5 }), 400, "INVALID_ACTION");

  const originalBids = structuredClone(state.bidHistory);
  const pendingCorrection = correct(state, players[0].id);
  const races = await Promise.all([act(host, pendingCorrection), act(host, pendingCorrection)]);
  assert.equal(races.filter(response => response.status === 200).length, 1);
  assert.equal(races.filter(response => response.status === 409 && response.data.code === "RESULTS_CONFLICT").length, 1);
  state = await read(host);
  assert.equal(state.resultsRevision, 3); assert.equal(state.saleCorrections.length, 1);
  assert.equal(state.teams.find(team => team.id === "rcb").purse, 9500);
  assert.equal(state.teams.find(team => team.id === "mi").purse, 9300);
  assert.deepEqual(state.teams.find(team => team.id === "rcb").lineup, { playingXI: [null, null, players[1].id], substitutes: [], captainId: null, viceCaptainId: players[1].id, revision: 2 });
  assert.deepEqual(state.bidHistory, originalBids);
  assert.deepEqual((await stored(host)).privateTargetPicks[red.memberId], privatePicks);
  for (const member of [red, blue, viewer]) {
    const refreshed = await read(member);
    assert.deepEqual(refreshed.saleCorrections, state.saleCorrections);
    assert.equal(Object.hasOwn(refreshed, "tokenHashes"), false);
    assert.equal(Object.hasOwn(refreshed, "privateTargetPicks"), false);
    assert.deepEqual(refreshed.myTargetPicks, member === red ? privatePicks : member === blue ? { teamId: "mi", playerIds: [], revision: 0 } : undefined);
  }

  // Corrections and completion never consume a live bid's reserved purse/slot.
  ok(await act(host, { type: "select_player", playerId: players[2].id }));
  state = ok(await act(host, { type: "start" })).state;
  for (const phase of ["live", "paused", "locked"]) {
    if (phase === "paused") state = ok(await act(host, { type: "pause" })).state;
    if (phase === "locked") state = ok(await act(host, { type: "lock" })).state;
    await rejected(host, end(state), 409, "ROUND_UNSETTLED");
    await rejected(host, correct(state, players[0].id, { teamId: "rcb", amount: 800 }), 409, "ROUND_UNSETTLED");
  }
  state = ok(await act(host, { type: "unsold" })).state;

  // Include an unowned catalog entry so a later common-pool edit tests snapshot freezing.
  const catalogPlayer = { id: `completed-catalog-${host.state.code.toLowerCase()}`, name: `Completed Catalog ${host.state.code}`, country: "India", role: "Batter", basePrice: 25, isOverseas: false, eligibilityVerified: true, dataStatus: "manual", stats: { matches: 10, runs: 100, wickets: 0, strikeRate: 100 } };
  state = ok(await act(host, { type: "add_player", player: catalogPlayer })).state;
  const ended = ok(await act(host, end(state))).state;
  assert.ok(ended.endedAt); assert.equal(ended.endedBy, host.memberId);
  assert.deepEqual(ended.completedManagers.rcb, { id: red.memberId, name: "Red manager" });
  assert.deepEqual(ended.completedManagers.mi, { id: blue.memberId, name: "Blue manager" });
  assert.deepEqual(ended.teams, state.teams); assert.deepEqual(ended.players, state.players);
  assert.equal(ended.resultsRevision, state.resultsRevision + 1);
  await rejected(host, end(ended), 409, "AUCTION_ALREADY_ENDED");
  for (const action of [{ type: "select_player", playerId: players[4].id }, { type: "start" }, { type: "update_settings", settings: {} }, { type: "add_player", player: { ...catalogPlayer, id: "rejected-ended-add" } }, { type: "delete_player", playerId: catalogPlayer.id }]) await rejected(host, action, 409, "AUCTION_ENDED");
  await rejected(red, { type: "bid", expectedPlayerId: players[2].id, expectedAmount: players[2].basePrice }, 409, "AUCTION_ENDED");
  await rejected(red, { type: "claim_team", teamId: null }, 409, "AUCTION_ENDED");
  await rejected(red, { type: "set_target_picks", teamId: "rcb", playerIds: [], expectedRevision: 1 }, 409, "AUCTION_ENDED");
  const lateManager = await join("Late manager", "csk"); assert.equal(lateManager.status, 409); assert.equal(lateManager.data.code, "AUCTION_ENDED");
  const lateViewer = ok(await join("Late spectator")); assert.equal(lateViewer.state.endedAt, ended.endedAt);

  const editor = ok(await request("/api/players/catalog/session", { body: {} }));
  ok(await request("/api/players/catalog", { token: editor.token, body: { action: { type: "update_player", player: { ...catalogPlayer, name: "Changed after completion", status: "available", stats: { matches: 99, runs: 999, wickets: 9, strikeRate: 199 } } } } }));
  const synced = await read(host);
  assert.deepEqual(synced.players, ended.players); assert.equal(synced.catalogCount, ended.catalogCount);
  assert.ok(synced.sharedCatalogVersion > ended.sharedCatalogVersion);
  const stablePoll = ok(await request(`${pathFor(host)}?since=${synced.version}`, { token: host.token })); assert.equal(stablePoll.unchanged, true);
  ok(await request("/api/players/catalog", { token: editor.token, body: { action: { type: "delete_player", playerId: catalogPlayer.id } } }));
  state = await read(host); assert.deepEqual(state.players, ended.players);
  const adjusted = ok(await act(host, correct(state, players[0].id, { teamId: "mi", amount: 900, reason: "The agreed final price was nine crore." }))).state;
  assert.equal(adjusted.endedAt, ended.endedAt); assert.equal(adjusted.saleCorrections.length, 2);
  assert.equal(adjusted.teams.find(team => team.id === "mi").purse, 9100);
  state = ok(await act(host, correct(adjusted, players[1].id, { teamId: null, reason: "The second sale was accidental." }))).state;
  assert.equal(state.players.find(player => player.id === players[1].id).status, "available");
  assert.equal(state.teams.find(team => team.id === "rcb").purse, 10000);
  assert.equal(state.teams.find(team => team.id === "rcb").lineup.revision, 3);
  state = ok(await act(blue, { type: "set_lineup", teamId: "mi", expectedRevision: 0, lineup: { playingXI: [players[0].id], substitutes: [], captainId: players[0].id, viceCaptainId: null } })).state;
  assert.equal(state.teams.find(team => team.id === "mi").lineup.captainId, players[0].id);
  ok(await act(red, { type: "chat", text: "Thanks for the auction." }));
  ok(await act(red, { type: "leave" }));
  state = await read(host);
  assert.deepEqual(state.completedManagers.rcb, { id: red.memberId, name: "Red manager" });
  assert.deepEqual((await stored(host)).state.saleCorrections, state.saleCorrections, "all corrections are durable beyond current snapshots");
  assert.equal(state.saleCorrections.length, 3);

  // Starting bidding and ending the room are mutually exclusive under database CAS.
  const second = await create("Concurrent start and completion");
  state = ok(await act(second, { type: "select_player", playerId: players[4].id })).state;
  const completionRace = await Promise.all([act(second, end(state)), act(second, { type: "start" })]);
  assert.equal(completionRace.filter(response => response.status === 200).length, 1);
  assert.equal(completionRace.filter(response => response.status === 409).length, 1);
  state = await read(second);
  assert.ok((state.endedAt && state.phase === "waiting") || (!state.endedAt && state.phase === "live"));
  console.log("PASS: creator-only completion/corrections, atomic races/refunds, stale terms, durable audit, preserved private targets, lineup cleanup, archive snapshots, late spectator admission and manager preservation.");
} finally {
  for (const host of rooms) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }).catch(() => undefined);
  database.close();
}
