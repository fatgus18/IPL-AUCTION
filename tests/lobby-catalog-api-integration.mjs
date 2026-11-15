import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run through tests/run-isolated-api.mjs; this suite changes the shared catalog.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const baseUrl = process.env.BASE_URL;
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const request = async (path, { token, body, origin } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin === undefined ? {} : { Origin: origin }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return { status: response.status, data: await response.json() };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const common = since => request(`/api/players/catalog${since === undefined ? "" : `?since=${since}`}`).then(ok);
const edit = (editor, action, origin = baseUrl) => request("/api/players/catalog", { token: editor.token, body: { action }, origin });
const readRoom = session => request(`/api/rooms/${session.state.code}`, { token: session.token }).then(ok).then(value => value.state);
const act = (session, action) => request(`/api/rooms/${session.state.code}/action`, { token: session.token, body: { action } });
const counts = async () => (await database.execute("SELECT (SELECT COUNT(*) FROM auction_rooms) AS rooms, (SELECT COUNT(*) FROM catalog_editor_sessions) AS editors")).rows[0];
const fixture = suffix => ({
  id: `lobby-catalog-${suffix}`, name: `Lobby Catalog ${suffix}`, country: "India", role: "Batter",
  basePrice: 50, isOverseas: false, eligibilityVerified: true, dataStatus: "manual",
  stats: { matches: null, runs: null, wickets: null, strikeRate: null },
});

try {
  const initialCounts = await counts();
  const baseline = await common();
  const stable = await common(baseline.version);
  assert.deepEqual(stable, { unchanged: true, version: baseline.version });
  assert.ok(JSON.stringify(stable).length < 100, "unchanged lobby polling must not transfer every player");
  assert.deepEqual(await counts(), initialCounts, "visiting the public pool must not create rooms or editor credentials");
  assert.equal((await request("/api/players/catalog/session", { body: {}, origin: "https://unrelated.example" })).status, 403);
  assert.deepEqual(await counts(), initialCounts, "rejected foreign requests must not create sessions");

  const editors = await Promise.all([0, 1].map(() => request("/api/players/catalog/session", { body: {}, origin: baseUrl }).then(ok)));
  assert.ok(editors.every(editor => Object.keys(editor).join() === "token" && /^[a-f0-9]{64}$/.test(editor.token)));
  assert.notEqual(editors[0].token, editors[1].token);
  assert.equal((await counts()).rooms, initialCounts.rooms, "catalog editors have no private practice room");
  for (const editor of editors) {
    const digest = createHash("sha256").update(editor.token).digest("hex");
    const stored = (await database.execute({ sql: "SELECT token_hash, expires_at FROM catalog_editor_sessions WHERE token_hash = ?", args: [digest] })).rows[0];
    assert.equal(stored.token_hash, digest);
    assert.notEqual(stored.token_hash, editor.token);
    assert.ok(Number(stored.expires_at) > Date.now());
  }
  assert.equal((await request("/api/players/catalog", { body: { action: { type: "add_player", player: fixture("unauthenticated") } } })).status, 401);
  assert.equal((await edit({ token: "f".repeat(64) }, { type: "add_player", player: fixture("invalid-token") })).status, 401);
  assert.equal((await edit(editors[0], { type: "add_player", player: fixture("foreign") }, "https://unrelated.example")).status, 403);
  for (const action of [{ type: "start" }, { type: "sell" }, { type: "claim_team", teamId: "csk" }, { type: "leave" }, { type: "select_player", playerId: baseline.players[0].id }]) {
    const denied = await edit(editors[0], action);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code, "CATALOG_ACTION_FORBIDDEN");
  }
  assert.equal((await edit(editors[0], { type: "add_player", player: null })).status, 400);
  assert.equal((await edit(editors[0], { type: "update_player" })).status, 404);

  const room = ok(await request("/api/rooms", { body: { name: "Lobby catalog verification", hostName: "Lobby host" } }));
  assert.equal((await request(`/api/rooms/${room.state.code}`, { token: editors[0].token })).status, 401);
  assert.equal((await request(`/api/rooms/${room.state.code}/action`, { token: editors[0].token, body: { action: { type: "bid", expectedPlayerId: baseline.players[0].id, expectedAmount: 50 } } })).status, 401);
  assert.equal((await request(`/api/rooms/${room.state.code}/action`, { token: editors[0].token, body: { action: { type: "leave" } } })).status, 401);
  assert.equal((await edit(room, { type: "add_player", player: fixture("room-credential") })).status, 401, "room credentials and catalog credentials are independently scoped");

  // Lobby and room changes enter the same writer queue, without lost updates.
  const changes = await Promise.all([
    edit(editors[0], { type: "add_player", player: fixture("first") }),
    edit(editors[1], { type: "add_player", player: fixture("second") }),
    act(room, { type: "add_player", player: fixture("from-room") }),
  ]);
  changes.forEach(ok);
  const changed = await common(baseline.version);
  assert.equal(changed.version, baseline.version + 3);
  assert.equal(changed.players.length, baseline.players.length + 3);
  assert.ok(changed.players.every(player => player.status === "available" && !player.soldTo && player.soldFor === undefined));
  const synchronizedRoom = await readRoom(room);
  for (const suffix of ["first", "second", "from-room"]) assert.ok(synchronizedRoom.players.some(player => player.id === fixture(suffix).id));
  assert.equal(synchronizedRoom.members.length, 1, "catalog editing cannot add room members");
  assert.equal((await counts()).rooms, Number(initialCounts.rooms) + 1);

  const duplicates = await Promise.all(editors.map((editor, index) => edit(editor, {
    type: "add_player", player: { ...fixture(`duplicate-${index}`), profileUrl: index ? "https://cricbuzz.com/profiles/999991/different-slug?ref=qa" : "https://www.cricbuzz.com/profiles/999991/lobby-test" },
  })));
  assert.equal(duplicates.filter(result => result.status === 200).length, 1);
  assert.equal(duplicates.filter(result => result.status === 409 && result.data.code === "PLAYER_EXISTS").length, 1);

  const original = changed.players.find(player => player.id === fixture("first").id);
  const { teamPassword } = ok(await request(`/api/rooms/${room.state.code}/access`, { token: room.token, body: {} }));
  const bidder = ok(await request(`/api/rooms/${room.state.code}/join`, { body: { name: "Squad owner", teamId: "csk", teamPassword } }));
  ok(await act(room, { type: "select_player", playerId: original.id }));
  ok(await act(room, { type: "start" }));
  ok(await act(bidder, { type: "bid", expectedPlayerId: original.id, expectedAmount: 50 }));
  const liveBefore = await readRoom(room);
  ok(await edit(editors[0], { type: "update_player", player: { ...original, name: "Lobby Catalog Updated", basePrice: 200, country: "Australia", isOverseas: true } }));
  const liveAfter = await readRoom(room);
  const pinned = liveAfter.players.find(player => player.id === original.id);
  assert.equal(pinned.name, "Lobby Catalog Updated");
  assert.equal(pinned.basePrice, 50);
  assert.equal(pinned.isOverseas, false);
  assert.equal(liveAfter.currentBid, liveBefore.currentBid);
  assert.deepEqual(liveAfter.bidHistory, liveBefore.bidHistory);
  assert.deepEqual(liveAfter.teams, liveBefore.teams);
  assert.equal((await edit(editors[0], { type: "delete_player", playerId: original.id })).data.code, "PLAYER_IN_USE");
  ok(await act(room, { type: "lock" }));
  ok(await act(room, { type: "sell" }));
  assert.equal((await edit(editors[1], { type: "delete_player", playerId: original.id })).data.code, "PLAYER_IN_USE");
  const purchased = await readRoom(bidder);
  assert.equal(purchased.teams.find(team => team.id === "csk").squad[0].playerId, original.id);
  assert.equal(purchased.teams.find(team => team.id === "csk").purse, 9950);

  ok(await edit(editors[0], { type: "delete_player", playerId: fixture("second").id }));
  assert.equal((await edit(editors[1], { type: "add_player", player: { ...fixture("second"), name: "Reused historical identifier" } })).data.code, "PLAYER_ID_RESERVED");
  assert.ok(!(await readRoom(room)).players.some(player => player.id === fixture("second").id));
  const finalCatalog = await common();
  assert.ok(!finalCatalog.players.some(player => player.id === fixture("second").id));
  assert.deepEqual(await common(finalCatalog.version), { unchanged: true, version: finalCatalog.version });
  const serialized = JSON.stringify(finalCatalog);
  assert.ok(!serialized.includes("tokenHashes"));
  for (const editor of editors) assert.ok(!serialized.includes(editor.token));

  const expiredHash = createHash("sha256").update(editors[1].token).digest("hex");
  await database.execute({ sql: "UPDATE catalog_editor_sessions SET expires_at = 0 WHERE token_hash = ?", args: [expiredHash] });
  assert.equal((await edit(editors[1], { type: "add_player", player: fixture("expired") })).status, 401);
  console.log("PASS: homepage catalog reads create no rooms or credentials; scoped editors share durable, atomic CRUD without room access, while live bids and purchased squads retain their terms.");
  console.log("PASS: unchanged catalog polls stay under 100 bytes; cross-origin requests, invalid/expired tokens, duplicate identities and protected-player deletions are rejected.");
} finally { database.close(); }
