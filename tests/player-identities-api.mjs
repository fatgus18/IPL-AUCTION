import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run only through tests/run-isolated-api.mjs; this suite simulates a legacy catalog.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl && ["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname), "Never mutate a deployed server's catalog.");
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const identities = JSON.parse(await readFile(new URL("../data/player-identities.json", import.meta.url), "utf8"));
const variants = identities.players.filter(player => player.aliases.some(name => name !== player.canonicalName));
assert.equal(variants.length, 11);
const namesById = new Map(variants.map(player => [player.id, player.aliases.find(name => name !== player.canonicalName)]));
const canonicalById = new Map(variants.map(player => [player.id, player.canonicalName]));
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: baseUrl }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert.ok(response.ok, `${response.status} ${path}: ${data.error}`);
  return data;
};
const common = () => request("/api/players/catalog");
const baseline = await common();
const customId = `identity-migration-${randomUUID()}`;
const custom = {
  id: customId, name: "Organizer's Custom Player", role: "Batter", country: "India", isOverseas: false,
  eligibilityVerified: true, basePrice: 75, status: "available", dataStatus: "manual", statsFormat: "Unknown",
  stats: { matches: 12, runs: 345, wickets: 0, strikeRate: 123.45 },
};
let host;
try {
  host = await request("/api/rooms", { body: { name: "Historical identity migration", hostName: "Identity creator" } });
  const roomPath = `/api/rooms/${host.state.code}`;
  const action = (session, value) => request(`${roomPath}/action`, { token: session.token, body: { action: value } });
  const access = await request(`${roomPath}/access`, { token: host.token, body: {} });
  const owner = await request(`${roomPath}/join`, { body: { name: "Historical manager", teamId: "rcb", teamPassword: access.teamPassword } });
  const salt = host.state.players.find(player => player.id === "philip-salt");
  assert.ok(salt);
  await action(host, { type: "select_player", playerId: salt.id });
  await action(host, { type: "start" });
  await action(owner, { type: "bid", expectedPlayerId: salt.id, expectedAmount: salt.basePrice, customAmount: Math.max(250, Math.ceil(salt.basePrice / 25) * 25) });
  await action(host, { type: "lock" });
  const sale = (await action(host, { type: "sell" })).state;
  await action(owner, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: [salt.id], substitutes: [], captainId: salt.id, viceCaptainId: null } });
  const ended = (await action(host, { type: "end_auction", expectedResultsRevision: sale.resultsRevision })).state;

  const legacy = [...baseline.players.map(player => namesById.has(player.id) ? { ...player, name: namesById.get(player.id) } : player), custom];
  assert.equal(legacy.filter(player => namesById.has(player.id)).length, 11);
  const versionBeforeMigration = baseline.version + 1;
  const transaction = await database.transaction("write");
  try {
    const persisted = JSON.parse((await transaction.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [host.state.code] })).rows[0].state_json);
    persisted.state.players = persisted.state.players.map(player => namesById.has(player.id) ? { ...player, name: namesById.get(player.id) } : player);
    persisted.state.version += 1;
    await transaction.execute({ sql: "UPDATE auction_rooms SET state_json = ?, version = ? WHERE code = ?", args: [JSON.stringify(persisted), persisted.state.version, host.state.code] });
    await transaction.execute({ sql: "UPDATE shared_player_catalog SET players_json = ?, version = ?, updated_at = ? WHERE id = 'common'", args: [JSON.stringify(legacy), versionBeforeMigration, Date.now()] });
    await transaction.commit();
  } finally { if (!transaction.closed) await transaction.rollback(); }

  const migratedReads = await Promise.all(Array.from({ length: 6 }, common));
  const expected = legacy.map(player => canonicalById.has(player.id) ? { ...player, name: canonicalById.get(player.id) } : player);
  for (const catalog of migratedReads) {
    assert.equal(catalog.version, versionBeforeMigration + 1, "simultaneous reads perform exactly one durable identity migration");
    assert.equal(catalog.players.length, baseline.players.length + 1, "custom players remain in the shared catalog");
    assert.deepEqual(catalog.players, expected, "only verified names change; every ID and other field survives");
  }
  assert.deepEqual(await common(), migratedReads[0], "repeated reads are idempotent");
  const persistedCatalog = (await database.execute("SELECT players_json, version FROM shared_player_catalog WHERE id = 'common'")).rows[0];
  assert.deepEqual(JSON.parse(persistedCatalog.players_json), expected);
  assert.equal(Number(persistedCatalog.version), versionBeforeMigration + 1);

  const historical = (await request(roomPath, { token: host.token })).state;
  assert.equal(historical.players.find(player => player.id === salt.id).name, "Philip Salt", "completed names remain historical");
  assert.equal(historical.players.length, ended.players.length, "completed auctions do not acquire newly added players");
  assert.deepEqual(historical.teams, ended.teams, "squad membership, saved captain and purse are unchanged");
  assert.deepEqual(historical.bidHistory, ended.bidHistory);
  const providerId = identities.players.find(player => player.id === salt.id).providerPlayerId;
  const season = (await request(`${roomPath}/season`, { token: host.token, body: {
    type: "import", expectedRevision: 0, text: JSON.stringify([{ name: "Phil Salt", providerPlayerId: providerId, points: 12.34 }]),
  } })).season;
  assert.equal(season.sourceRows[0].playerId, salt.id);
  assert.equal(season.sourceRows[0].match, "id");
  const team = season.teams.find(team => team.id === "rcb");
  assert.equal(team.points, 24.68, "legacy captain scores under the stable provider identity");
  assert.equal(team.players[0].name, "Philip Salt");
  console.log("PASS: all 11 legacy name variants migrate once under concurrent reads; custom players, facts and stable IDs persist.");
  console.log("PASS: completed names and auction accounting stay frozen; season points still match canonical provider IDs and saved captain.");
} finally {
  if (host) await request(`/api/rooms/${host.state.code}/delete`, { token: host.token, body: { confirmationCode: host.state.code } });
  // Restore only this test's added player, preserving the verified naming migration.
  const transaction = await database.transaction("write");
  try {
    const current = (await transaction.execute("SELECT players_json, version FROM shared_player_catalog WHERE id = 'common'")).rows[0];
    const players = JSON.parse(current.players_json);
    if (players.some(player => player.id === customId)) await transaction.execute({
      sql: "UPDATE shared_player_catalog SET players_json = ?, version = ?, updated_at = ? WHERE id = 'common'",
      args: [JSON.stringify(players.filter(player => player.id !== customId)), Number(current.version) + 1, Date.now()],
    });
    await transaction.commit();
  } finally { if (!transaction.closed) await transaction.rollback(); database.close(); }
}
