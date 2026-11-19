import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import ExcelJS from "exceljs";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run through the isolated API runner only.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const baseUrl = process.env.BASE_URL;
const request = async (path, { token, body, origin = baseUrl } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return { status: response.status, data: await response.json() };
};
const ok = response => { assert.ok(response.status >= 200 && response.status < 300, `${response.status}: ${response.data.error}`); return response.data; };
const rooms = [];
const create = async name => { const host = ok(await request("/api/rooms", { body: { name, hostName: "Season creator" } })); rooms.push(host); return host; };
const roomPath = session => `/api/rooms/${session.state.code}`;
const seasonPath = session => `${roomPath(session)}/season`;
const act = (session, action) => request(`${roomPath(session)}/action`, { token: session.token, body: { action } }).then(ok).then(result => result.state);
const get = session => request(seasonPath(session), { token: session.token }).then(ok).then(result => result.season);
const write = (session, body) => request(seasonPath(session), { token: session.token, body });

try {
  const host = await create("Season integration fixture"), other = await create("Different season room");
  const password = ok(await request(`${roomPath(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${roomPath(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword: password } : {}) } }).then(ok);
  const manager = await join("Season manager", "rcb"), spectator = await join("Season spectator");
  const players = host.state.players.filter(player => !player.isOverseas && player.eligibilityVerified !== false).slice(0, 5);
  for (const player of players) {
    await act(host, { type: "select_player", playerId: player.id }); await act(host, { type: "start" });
    await act(manager, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice, customAmount: 500 });
    await act(host, { type: "lock" }); await act(host, { type: "sell" });
  }
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: [players[0].id, null, players[1].id], substitutes: [players[2].id], captainId: players[0].id, viceCaptainId: players[1].id } });
  const privateTarget = host.state.players.find(player => !players.some(purchased => purchased.id === player.id));
  assert.ok(privateTarget);
  await act(manager, { type: "set_target_picks", teamId: "rcb", expectedRevision: 0, playerIds: [privateTarget.id], maxBids: { [privateTarget.id]: 900 } });
  let season = await get(host);
  assert.equal(season.revision, 0); assert.equal(season.snapshot, null); assert.equal(season.canManage, true);
  assert.equal(season.reference.playerCount, 202); assert.equal(season.reference.seriesId, "1510719");
  assert.equal(season.coverage.totalPlayers, 5); assert.equal(season.coverage.matchedPlayers, 0);
  assert.equal((await request(seasonPath(host))).status, 401);
  assert.equal((await request(seasonPath(host), { token: other.token })).status, 401);
  for (const member of [manager, spectator]) {
    assert.equal((await get(member)).canManage, false);
    for (const type of ["configure", "fetch", "import", "map", "reference"]) assert.equal((await write(member, { type, expectedRevision: 0 })).status, 403);
  }
  assert.equal((await request(seasonPath(host), { token: host.token, body: { type: "configure", sourceUrl: season.sourceUrl, expectedRevision: 0 }, origin: "https://attacker.invalid" })).status, 403);
  assert.equal((await write(host, { type: "configure", sourceUrl: "http://127.0.0.1/secret", expectedRevision: 0 })).status, 400);
  assert.equal((await write(host, { type: "fetch" })).data.code, "SEASON_REVISION_REQUIRED");

  const rows = players.slice(0, 4).map((player, index) => ({ name: player.name, points: [10.25, -3.35, 1.23, 0][index], matches: 5, runs: 102, wickets: 3 }));
  rows.push({ name: "Source spelling requiring creator review", points: 4.1 });
  rows.push({ name: "A different verified provider player", providerPlayerId: "9999999999", points: 50 });
  season = ok(await write(host, { type: "import", text: JSON.stringify(rows), expectedRevision: 0 })).season;
  assert.equal(season.revision, 1); assert.equal(season.snapshot.method, "import");
  assert.equal(season.sourceChanged, false); assert.equal(season.coverage.matchedPlayers, 4);
  let team = season.teams.find(team => team.id === "rcb");
  assert.equal(team.points, 16.705); assert.equal(team.players.find(player => player.id === players[4].id).points, null);
  assert.doesNotMatch(JSON.stringify(season), /myTargetPicks|maxBids|privateTargetPicks|tokenHashes|fetchRequestId|teamPassword/);
  for (const member of [manager, spectator]) {
    const projection = await get(member);
    assert.deepEqual(projection.teams, season.teams); assert.deepEqual(projection.sourceRows, season.sourceRows);
  }
  assert.equal((await write(host, { type: "import", text: "not a valid table", expectedRevision: 1 })).status, 400);
  assert.deepEqual((await get(host)).snapshot, season.snapshot);
  assert.equal((await write(host, { type: "import", text: JSON.stringify(rows), expectedRevision: 0 })).data.code, "SEASON_CONFLICT");
  assert.equal((await write(host, { type: "map", mappings: { "id:9999999999": players[0].id }, expectedRevision: 1 })).data.code, "SEASON_MAPPING_ID_CONFLICT");
  const unmatched = season.sourceRows.find(row => !row.playerId);
  season = ok(await write(host, { type: "map", mappings: { [unmatched.key]: players[4].id }, expectedRevision: 1 })).season;
  assert.equal(season.coverage.matchedPlayers, 5); assert.equal(season.teams.find(team => team.id === "rcb").points, 20.805);
  assert.equal((await write(host, { type: "map", mappings: { [unmatched.key]: "not-in-pool" }, expectedRevision: 2 })).data.code, "SEASON_MAPPING_INVALID");
  const duplicateMappings = Object.fromEntries(season.sourceRows.slice(0, 2).map(row => [row.key, players[0].id]));
  assert.equal((await write(host, { type: "map", mappings: duplicateMappings, expectedRevision: 2 })).data.code, "SEASON_MAPPING_INVALID");
  const source2025 = "https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players";
  const race = await Promise.all([write(host, { type: "configure", sourceUrl: source2025, expectedRevision: 2 }), write(host, { type: "configure", sourceUrl: source2025, expectedRevision: 2 })]);
  assert.equal(race.filter(result => result.status === 200).length, 1);
  assert.equal(race.filter(result => result.status === 409).length, 1);
  season = await get(host); assert.equal(season.revision, 3); assert.equal(season.sourceChanged, true);
  assert.equal(season.snapshot.seriesId, "1510719", "old successful source remains honestly labeled");

  // An intentionally invalid fixture URL exercises failure persistence and cooldown
  // without making any provider request or introducing production-only test hooks.
  const storedRow = (await database.execute({ sql: "SELECT state_json FROM auction_seasons WHERE room_code = ?", args: [host.state.code] })).rows[0];
  const stored = JSON.parse(storedRow.state_json); stored.sourceUrl = "https://127.0.0.1/blocked";
  await database.execute({ sql: "UPDATE auction_seasons SET state_json = ? WHERE room_code = ?", args: [JSON.stringify(stored), host.state.code] });
  assert.equal((await write(host, { type: "fetch", expectedRevision: 3 })).status, 400);
  const afterFailure = await get(host); assert.deepEqual(afterFailure.snapshot, season.snapshot); assert.equal(afterFailure.revision, 3); assert.ok(afterFailure.lastFetchAttemptAt);
  assert.equal((await write(host, { type: "fetch", expectedRevision: 3 })).data.code, "SEASON_FETCH_COOLDOWN");
  season = ok(await write(host, { type: "configure", sourceUrl: source2025, expectedRevision: 3 })).season;
  season = ok(await write(host, { type: "import", text: JSON.stringify(rows), expectedRevision: 4 })).season;
  assert.equal(season.snapshot.seriesId, "1449924"); assert.equal(season.sourceChanged, false);
  assert.deepEqual(season.mappings, {}, "manual mappings reset when source changes");
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 1, lineup: { playingXI: [players[0].id, players[1].id], substitutes: [players[2].id], captainId: players[1].id, viceCaptainId: players[0].id } });
  season = await get(manager); assert.equal(season.teams.find(team => team.id === "rcb").points, 9.905, "saved lineups recompute against saved source");
  let state = ok(await request(roomPath(host), { token: host.token })).state;
  state = await act(host, { type: "end_auction", expectedResultsRevision: state.resultsRevision });
  season = await get(spectator); assert.equal(season.provisional, false); assert.equal(season.teams.find(team => team.id === "rcb").manager, "Season manager");
  await act(host, { type: "correct_sale", playerId: players[0].id, expectedTeamId: "rcb", expectedAmount: 500, expectedResultsRevision: state.resultsRevision, teamId: "mi", amount: 500, reason: "Testing a reviewed franchise correction." });
  season = await get(spectator); assert.equal(season.teams.find(team => team.id === "mi").points, 10.25);
  assert.equal(season.teams.find(team => team.id === "rcb").points, -5.47);
  const exportResponse = await fetch(`${baseUrl}${seasonPath(spectator)}/export`, { headers: { Authorization: `Bearer ${spectator.token}` } });
  assert.equal(exportResponse.status, 200); assert.match(exportResponse.headers.get("content-type"), /spreadsheetml/);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await exportResponse.arrayBuffer());
  assert.ok(workbook.getWorksheet("POINTS")); assert.ok(workbook.getWorksheet("THE TEAMS")); assert.ok(workbook.getWorksheet("Source coverage"));
  assert.equal((await fetch(`${baseUrl}${seasonPath(host)}/export`)).status, 401);
  const referenceMeta = (await get(other)).reference;
  let referenceSeason = ok(await write(other, { type: "reference", expectedRevision: 0 })).season;
  assert.equal(referenceSeason.revision, 1); assert.equal(referenceSeason.snapshot.method, "reference");
  assert.equal(referenceSeason.snapshot.fetchedAt, referenceMeta.fetchedAt);
  assert.equal(referenceSeason.sourceRows.length, 202); assert.equal(referenceSeason.sourceChanged, false);
  assert.equal((await write(other, { type: "reference", expectedRevision: 0 })).data.code, "SEASON_CONFLICT");
  referenceSeason = ok(await write(other, { type: "reference", expectedRevision: 1 })).season;
  assert.equal(referenceSeason.snapshot.fetchedAt, referenceMeta.fetchedAt, "loading again never invents a fresh capture timestamp");
  referenceSeason = ok(await write(other, { type: "configure", sourceUrl: source2025, expectedRevision: 2 })).season;
  assert.equal(referenceSeason.reference, null); assert.equal(referenceSeason.sourceChanged, true);
  assert.equal((await write(other, { type: "reference", expectedRevision: 3 })).data.code, "SEASON_REFERENCE_UNAVAILABLE");
  assert.deepEqual((await get(other)).snapshot, referenceSeason.snapshot, "unavailable fallback cannot replace good source data");
  const persisted = JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [host.state.code] })).rows[0].state_json);
  assert.equal(Object.hasOwn(persisted.state, "season"), false); assert.equal(Object.hasOwn(persisted.state, "sourceRows"), false);
  ok(await request(`${roomPath(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }));
  assert.equal((await database.execute({ sql: "SELECT room_code FROM auction_seasons WHERE room_code = ?", args: [host.state.code] })).rows.length, 0);
  assert.equal((await request(seasonPath(host), { token: host.token })).status, 410);
  assert.equal((await write(host, { type: "map", expectedRevision: season.revision, mappings: {} })).status, 410);
  console.log("Auction season API: authorization, full-squad precision, private-data separation, CAS, mapping, failure recovery, source provenance, lineup/correction updates, Excel and deletion passed.");
} finally {
  for (const host of rooms) await request(`${roomPath(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } });
  database.close();
}
