import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run through tests/run-isolated-api.mjs; this suite changes the shared catalog.");
const baseUrl = process.env.BASE_URL;
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return { status: response.status, data: await response.json() };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const read = async session => ok(await request(`/api/rooms/${session.state.code}`, { token: session.token })).state;
const act = (session, action, memberId) => request(`/api/rooms/${session.state.code}/action`, { token: session.token, body: { action, ...(memberId ? { memberId } : {}) } });
const common = () => request("/api/players/catalog").then(ok);
const baseline = await common();
const [regular, incognito] = await Promise.all([0, 1].map(() => request("/api/practice", { body: {} }).then(ok)));
assert.notEqual(regular.token, incognito.token);
assert.notEqual(regular.state.code, incognito.state.code);
assert.equal(regular.state.players.length, baseline.players.length);
assert.equal(incognito.state.players.length, baseline.players.length);

// Reproduce two existing browser sessions reconnecting after a catalog upgrade.
// Both need a catalog writeback with an old presence timestamp, while another
// process briefly owns the SQLite write lock. Practice reads must not add a
// heartbeat write. This database belongs only to the runner.
assert.match(process.env.DATABASE_URL || "", /^file:/);
const fixtureDatabase = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
for (const session of [regular, incognito]) {
  const row = (await fixtureDatabase.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [session.state.code] })).rows[0];
  const stored = JSON.parse(row.state_json);
  delete stored.state.sharedCatalogVersion;
  delete stored.state.catalogCount;
  stored.state.members.find(member => member.id === stored.state.hostId).lastSeenAt = 0;
  await fixtureDatabase.execute({ sql: "UPDATE auction_rooms SET state_json = ? WHERE code = ?", args: [JSON.stringify(stored), session.state.code] });
}
const heldLock = await fixtureDatabase.transaction("write");
try {
  const reconnecting = Promise.all(Array.from({ length: 12 }, () => [regular, incognito]).flat().map(read));
  await new Promise(resolve => setTimeout(resolve, 250));
  await heldLock.commit();
  const synchronized = await reconnecting;
  assert.equal(synchronized.length, 24);
  assert.ok(synchronized.every(state => state.sharedCatalogVersion === baseline.version && state.catalogCount === baseline.players.length));
  assert.ok(synchronized.every(state => state.members.find(member => member.id === state.hostId).lastSeenAt === 0), "practice reconnects must not rewrite presence");
} finally {
  if (!heldLock.closed) await heldLock.rollback();
  fixtureDatabase.close();
}
console.log("PASS: 24 simultaneous reconnect reads migrated two saved catalogs through an external SQLite lock, without losing state or adding practice heartbeat writes.");

const fixture = suffix => ({
  id: `shared-catalog-${suffix}`, name: `Shared Catalog ${suffix}`, country: "India", role: "Batter",
  basePrice: 50, isOverseas: false, stats: { matches: null, runs: null, wickets: null, strikeRate: null },
  dataStatus: "manual", eligibilityVerified: true,
});
assert.equal((await act(regular, { type: "add_player", player: fixture("forbidden") }, "demo-csk")).status, 403);
const concurrent = await Promise.all([
  act(regular, { type: "add_player", player: fixture("one") }),
  act(incognito, { type: "add_player", player: fixture("two") }),
]);
concurrent.forEach(ok);
const [regularState, incognitoState] = await Promise.all([read(regular), read(incognito)]);
for (const state of [regularState, incognitoState]) {
  assert.equal(state.players.length, baseline.players.length + 2);
  assert.equal(state.catalogCount, baseline.players.length + 2);
  assert.ok(state.players.some(p => p.id === "shared-catalog-one"));
  assert.ok(state.players.some(p => p.id === "shared-catalog-two"));
}
assert.equal(regularState.sharedCatalogVersion, incognitoState.sharedCatalogVersion);
const changedPoll = await request(`/api/rooms/${incognito.state.code}?since=${incognito.state.version}`, { token: incognito.token });
assert.ok(changedPoll.data.state, "shared edits must invalidate the room's previous unchanged response");
const fresh = ok(await request("/api/practice", { body: {} }));
assert.equal(fresh.state.players.length, baseline.players.length + 2, "a brand-new browser profile sees the same pool");

const original = regularState.players.find(p => p.id === "shared-catalog-one");
ok(await act(regular, { type: "update_player", player: { ...original, basePrice: 75 } }));
assert.equal((await read(incognito)).players.find(p => p.id === original.id).basePrice, 75);
const duplicateResults = await Promise.all([
  act(regular, { type: "add_player", player: { ...fixture("profile-a"), profileUrl: "https://www.cricbuzz.com/profiles/999999/shared-test" } }),
  act(incognito, { type: "add_player", player: { ...fixture("profile-b"), profileUrl: "https://cricbuzz.com/profiles/999999/different-slug?source=test" } }),
]);
assert.equal(duplicateResults.filter(r => r.status === 200).length, 1);
assert.equal(duplicateResults.filter(r => r.status === 409 && r.data.code === "PLAYER_EXISTS").length, 1);
assert.equal((await common()).players.length, baseline.players.length + 3);

const roomA = ok(await request("/api/rooms", { body: { name: "Shared A", hostName: "Host A" } }));
const roomB = ok(await request("/api/rooms", { body: { name: "Shared B", hostName: "Host B" } }));
const { teamPassword } = ok(await request(`/api/rooms/${roomA.state.code}/access`, { token: roomA.token, body: {} }));
const bidder = ok(await request(`/api/rooms/${roomA.state.code}/join`, { body: { name: "Bidder A", teamId: "csk", teamPassword } }));
assert.equal((await act(bidder, { type: "delete_player", playerId: "shared-catalog-two" })).status, 403);
ok(await act(roomA, { type: "select_player", playerId: original.id }));
ok(await act(roomA, { type: "start" }));
ok(await act(bidder, { type: "bid", expectedPlayerId: original.id, expectedAmount: 75 }));
const beforeEdit = await read(roomA);
const globalEdit = { ...original, name: "Shared Catalog Updated", basePrice: 200, country: "Australia", isOverseas: true };
ok(await act(roomB, { type: "update_player", player: globalEdit }));
const duringBidding = await read(roomA);
const pinned = duringBidding.players.find(p => p.id === original.id);
assert.equal(pinned.basePrice, 75, "an open lot retains its accepted financial terms");
assert.equal(pinned.isOverseas, false, "changing the common country must not invalidate an accepted bid");
assert.equal(pinned.name, globalEdit.name, "source metadata still refreshes");
assert.equal(duringBidding.currentBid, beforeEdit.currentBid);
assert.deepEqual(duringBidding.bidHistory, beforeEdit.bidHistory);
assert.equal((await act(roomB, { type: "delete_player", playerId: original.id })).data.code, "PLAYER_IN_USE");
ok(await act(roomA, { type: "lock" }));
ok(await act(roomA, { type: "sell" }));
const soldA = await read(roomA);
const untouchedB = await read(roomB);
assert.equal(soldA.players.find(p => p.id === original.id).soldFor, 75);
assert.equal(soldA.teams.find(t => t.id === "csk").purse, 9925);
assert.equal(untouchedB.players.find(p => p.id === original.id).status, "available");
assert.equal(untouchedB.players.find(p => p.id === original.id).basePrice, 200);
assert.ok(untouchedB.teams.every(t => t.purse === 10000 && !t.squad.length));
assert.equal((await act(roomB, { type: "delete_player", playerId: original.id })).data.code, "PLAYER_IN_USE");

ok(await act(regular, { type: "delete_player", playerId: "shared-catalog-two" }));
const reused = await act(roomB, { type: "add_player", player: { ...fixture("two"), name: "Different historical identity" } });
assert.equal(reused.status, 409);
assert.equal(reused.data.code, "PLAYER_ID_RESERVED", "IDs still held by saved room records cannot relabel those records");
for (const session of [regular, incognito, fresh, roomA, roomB]) {
  const state = await read(session);
  assert.ok(!state.players.some(p => p.id === "shared-catalog-two"));
  assert.equal(state.catalogCount, baseline.players.length + 2);
}
const exported = JSON.stringify(await common());
assert.ok(!exported.includes("tokenHashes"));
for (const session of [regular, incognito, fresh, roomA, roomB, bidder]) assert.ok(!exported.includes(session.token));
assert.ok((await common()).players.every(p => p.status === "available" && !p.soldTo && p.soldFor === undefined));
console.log("PASS: independent browser identities share additions, edits, deletions, fresh-session persistence, concurrent writes and duplicate protection; room sales and locked financial terms remain independent.");
