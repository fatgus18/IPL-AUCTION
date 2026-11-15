import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated API runner; this suite deletes test rooms and migrates a test legacy room.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const base = process.env.BASE_URL;
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const request = async (path, { token, body, origin } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin === undefined ? {} : { Origin: origin }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/, `${path} returned ${response.status} without JSON`);
  return { status: response.status, data: await response.json(), cacheControl: response.headers.get("cache-control") || "" };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const pathFor = room => `/api/rooms/${room.state.code}`;
const read = room => request(pathFor(room), { token: room.token }).then(ok).then(data => data.state);
const access = room => request(`${pathFor(room)}/access`, { token: room.token, body: {} });
const act = (room, action) => request(`${pathFor(room)}/action`, { token: room.token, body: { action } });
const join = (room, body) => request(`${pathFor(room)}/join`, { body });
const remove = (room, token = room.token, confirmationCode = room.state.code) => request(`${pathFor(room)}/delete`, { token, body: { confirmationCode } });
const stored = async room => {
  const row = (await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [room.state.code] })).rows[0];
  return row ? JSON.parse(row.state_json) : undefined;
};
const assertPrivate = (data, secrets) => {
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes("tokenHashes"), "membership hashes must stay server-private");
  assert.ok(!serialized.includes('"teamAccess"'), "password recovery material must stay server-private");
  assert.ok(!serialized.includes('"passwordHash"'), "password hashes must stay server-private");
  assert.ok(!serialized.includes('"salt"'), "password derivation material must stay server-private");
  for (const secret of secrets) assert.ok(!serialized.includes(secret), "private credentials must not appear in shared responses");
};

try {
  const baselineCatalog = ok(await request("/api/players/catalog"));
  const creation = { name: "Protected team access", hostName: "Room creator", creationKey: randomBytes(32).toString("hex") };
  const created = await request("/api/rooms", { body: creation });
  assert.equal(created.status, 201);
  const host = created.data;
  const other = ok(await request("/api/rooms", { body: { name: "Unaffected room", hostName: "Other creator" } }));
  const passwordResponse = await access(host);
  assert.equal(passwordResponse.status, 200);
  assert.match(passwordResponse.cacheControl, /no-store/, "the creator's password response must not be cached");
  assert.deepEqual(Object.keys(passwordResponse.data), ["teamPassword"]);
  const { teamPassword } = passwordResponse.data;
  assert.equal(typeof teamPassword, "string");
  assert.ok(teamPassword.length >= 12, "the server must issue a strong room-specific password");
  assert.notEqual(teamPassword, host.token, "team access must never reveal the creator's credential");
  assert.equal(ok(await access(host)).teamPassword, teamPassword, "creator can recover the same password later");
  const otherPassword = ok(await access(other)).teamPassword;
  assert.notEqual(otherPassword, teamPassword, "passwords are unique to each room");
  assertPrivate(host, [teamPassword, otherPassword]);
  assertPrivate(await read(host), [teamPassword, otherPassword, host.token]);
  assert.equal((await request(`${pathFor(host)}/access`, { body: {} })).status, 401);
  assert.equal((await request(`${pathFor(host)}/access`, { token: teamPassword, body: {} })).status, 401, "the shareable password is not a creator bearer token");
  assert.ok([401, 403].includes((await request(`${pathFor(host)}/access`, { token: other.token, body: {} })).status));
  assert.equal((await request(`${pathFor(host)}/access`, { token: host.token, body: {}, origin: "https://foreign.example" })).status, 403);

  const beforeRejectedJoins = await stored(host);
  assert.equal((await request(`${pathFor(host)}/join`, { body: { name: "Foreign manager", teamId: "csk", teamPassword }, origin: "https://foreign.example" })).status, 403);
  for (const invalidPassword of [undefined, "", "incorrect-password", otherPassword, {}, "x".repeat(512)]) {
    const rejected = await join(host, { name: "Denied manager", teamId: "csk", ...(invalidPassword === undefined ? {} : { teamPassword: invalidPassword }) });
    assert.equal(rejected.status, 403, rejected.data.error);
    assert.match(rejected.data.code, /^TEAM_PASSWORD_(REQUIRED|INVALID)$/);
  }
  assert.deepEqual(await stored(host), beforeRejectedJoins, "rejected team joins must not persist members, owner assignments or tokens");
  const spectator = ok(await join(host, { name: "Free spectator" }));
  assert.equal(spectator.state.members.find(member => member.id === spectator.memberId).role, "spectator");
  assert.equal(spectator.state.members.find(member => member.id === spectator.memberId).teamId, null);
  assertPrivate(spectator, [teamPassword, host.token]);
  assert.equal((await access(spectator)).status, 403, "a spectator cannot retrieve the team password");
  assert.equal((await request(`${pathFor(host)}/access`, { token: spectator.token, body: { memberId: host.memberId } })).status, 403);
  const beforeRejectedClaims = await stored(host);
  for (const supplied of [undefined, "incorrect-password", otherPassword]) {
    const denied = await act(spectator, { type: "claim_team", teamId: "csk", ...(supplied ? { teamPassword: supplied } : {}) });
    assert.equal(denied.status, 403);
    assert.match(denied.data.code, /^TEAM_PASSWORD_(REQUIRED|INVALID)$/);
  }
  assert.deepEqual(await stored(host), beforeRejectedClaims, "joining as spectator cannot bypass team admission through claim_team");
  const promoted = ok(await act(spectator, { type: "claim_team", teamId: "csk", teamPassword }));
  assert.equal(promoted.state.members.find(member => member.id === spectator.memberId).teamId, "csk");
  assert.equal((await access(spectator)).status, 403, "having a team does not grant creator controls");
  assert.equal((await act(spectator, { type: "claim_team", teamId: "mi" })).status, 403, "switching teams must also authenticate access");

  const racingJoins = await Promise.all(["One", "Two"].map(name => join(host, { name: `Racing manager ${name}`, teamId: "mi", teamPassword })));
  assert.equal(racingJoins.filter(result => result.status === 201).length, 1);
  assert.equal(racingJoins.filter(result => result.status === 409 && result.data.code === "TEAM_TAKEN").length, 1);
  const winner = racingJoins.find(result => result.status === 201).data;
  const afterRace = await read(host);
  assert.equal(afterRace.members.filter(member => member.teamId === "mi").length, 1);
  assert.equal(afterRace.members.find(member => member.teamId === "mi").id, winner.memberId);
  const poll = await request(`${pathFor(host)}?since=${afterRace.version}`, { token: winner.token });
  assert.equal(poll.data.unchanged, true);
  for (const data of [promoted, winner, afterRace, poll.data, ok(await request("/api/players/catalog"))]) assertPrivate(data, [teamPassword, otherPassword, host.token]);
  for (const table of ["auction_rooms", "room_creation_requests", "room_deletions"]) {
    const serialized = JSON.stringify((await database.execute(`SELECT * FROM ${table}`)).rows);
    assert.ok(!serialized.includes(teamPassword), "passwords must not be persisted as plaintext");
    assert.ok(!serialized.includes(otherPassword), "other rooms' passwords must also remain private at rest");
  }
  console.log("PASS: free spectators, password-protected team joins and claims, atomic competing claims, creator-only access and no shared/plaintext password leaks.");

  // Legacy rooms have financial history and valid existing memberships, but no new password material.
  const legacy = ok(await request("/api/rooms", { body: { name: "Legacy auction", hostName: "Legacy creator" } }));
  const legacyPassword = ok(await access(legacy)).teamPassword;
  const legacyOwner = ok(await join(legacy, { name: "Existing owner", teamId: "csk", teamPassword: legacyPassword }));
  const player = legacy.state.players[0];
  ok(await act(legacy, { type: "select_player", playerId: player.id }));
  ok(await act(legacy, { type: "start" }));
  ok(await act(legacyOwner, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice }));
  ok(await act(legacy, { type: "lock" }));
  const sale = ok(await act(legacy, { type: "sell" })).state;
  const legacyStored = await stored(legacy);
  delete legacyStored.teamAccess;
  legacyStored.state.version += 1;
  await database.execute({ sql: "UPDATE auction_rooms SET state_json = ?, version = ? WHERE code = ?", args: [JSON.stringify(legacyStored), legacyStored.state.version, legacy.state.code] });
  assert.equal((await read(legacyOwner)).teams.find(team => team.id === "csk").purse, sale.teams.find(team => team.id === "csk").purse);
  const uninitializedJoin = await join(legacy, { name: "Wait for creator", teamId: "rcb", teamPassword: legacyPassword });
  assert.equal(uninitializedJoin.status, 403);
  assert.equal(uninitializedJoin.data.code, "TEAM_ACCESS_NOT_READY");
  ok(await join(legacy, { name: "Legacy spectator" }));
  const migratedPassword = ok(await access(legacy)).teamPassword;
  assert.notEqual(migratedPassword, legacyPassword);
  const migrated = await read(legacyOwner);
  assert.deepEqual(migrated.teams, sale.teams, "password migration must not change existing owners, squads, prices or purses");
  assert.deepEqual(migrated.bidHistory, sale.bidHistory);
  assert.equal(migrated.phase, "sold");
  assert.equal(migrated.players.find(entry => entry.id === player.id).soldFor, player.basePrice);
  const migratedStored = await stored(legacy);
  for (const [id, hash] of Object.entries(legacyStored.tokenHashes)) assert.equal(migratedStored.tokenHashes[id], hash, "existing credentials survive migration");
  ok(await join(legacy, { name: "New invited manager", teamId: "rcb", teamPassword: migratedPassword }));
  console.log("PASS: existing room credentials and confirmed purchases survive creator-initialized password migration; uninitialized legacy team seats stay protected.");

  const beforeUnauthorizedDeletes = await stored(host);
  assert.equal((await request(`${pathFor(host)}/delete`, { body: { confirmationCode: host.state.code } })).status, 401);
  assert.equal((await remove(host, spectator.token)).status, 403);
  assert.equal((await remove(host, winner.token)).status, 403);
  assert.ok([401, 403].includes((await remove(host, other.token)).status));
  for (const confirmationCode of ["", "WRONG1", other.state.code]) assert.equal((await remove(host, host.token, confirmationCode)).status, 400);
  assert.equal((await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code }, origin: "https://foreign.example" })).status, 403);
  assert.deepEqual(await stored(host), beforeUnauthorizedDeletes, "rejected deletion cannot alter the auction");
  const unaffectedBefore = await stored(other);
  const versionBeforeDelete = (await read(host)).version;
  assert.equal((await request(`${pathFor(host)}?since=${versionBeforeDelete}`, { token: winner.token })).data.unchanged, true, "prime the authenticated poll cache before deletion");
  const deleted = await remove(host);
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.data, { deleted: true, code: host.state.code });
  assert.equal(await stored(host), undefined);
  for (const response of [
    await request(pathFor(host), { token: host.token }),
    await request(`${pathFor(host)}?since=${versionBeforeDelete}`, { token: winner.token }),
    await join(host, { name: "Late spectator" }),
    await join(host, { name: "Late manager", teamId: "rcb", teamPassword }),
    await access(host),
    await act(spectator, { type: "raise_flag" }),
    await request("/api/rooms", { body: creation }),
  ]) {
    assert.equal(response.status, 410, response.data.error);
    assert.equal(response.data.code, "ROOM_DELETED");
    assertPrivate(response.data, [teamPassword, host.token]);
  }
  assert.equal((await remove(host)).status, 200, "the creator may safely retry a lost deletion response");
  assert.equal((await remove(host, spectator.token)).status, 403, "a former participant cannot authenticate the deletion tombstone");
  assert.deepEqual(await stored(other), unaffectedBefore, "deleting one room must leave other rooms intact");
  assert.equal((await request(pathFor(other), { token: other.token })).status, 200);
  assert.deepEqual(ok(await request("/api/players/catalog")), baselineCatalog, "room deletion must not delete shared players");

  const racingRoom = ok(await request("/api/rooms", { body: { name: "Deletion join race", hostName: "Race creator" } }));
  const racingPassword = ok(await access(racingRoom)).teamPassword;
  const [raceDelete, raceJoin] = await Promise.all([
    remove(racingRoom),
    join(racingRoom, { name: "Concurrent manager", teamId: "csk", teamPassword: racingPassword }),
  ]);
  assert.equal(raceDelete.status, 200);
  assert.ok([201, 410].includes(raceJoin.status), raceJoin.data.error);
  assert.equal(await stored(racingRoom), undefined, "a concurrent admitted join must not recreate a deleted room");
  if (raceJoin.status === 201) assert.equal((await request(pathFor(racingRoom), { token: raceJoin.data.token })).status, 410);
  console.log("PASS: only the creator can confirm deletion; old/cached access is revoked, retries are idempotent, creation keys cannot resurrect rooms, and other auctions/shared players remain intact.");
} finally {
  database.close();
}
