import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Account tests must use the isolated database runner.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const base = process.env.BASE_URL;
const suffix = randomBytes(5).toString("hex");
const password = "An auction passphrase 2026!";
const request = async (path, { cookie, token, body, origin = base, extraHeaders } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/, path);
  return { status: response.status, data: await response.json(), cookies: response.headers.getSetCookie(), cache: response.headers.get("cache-control") };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const jar = response => response.cookies.map(cookie => cookie.split(";")[0]).filter(cookie => !cookie.endsWith("=")).join("; ");
const register = username => request("/api/account/register", { body: { username, password } });
const login = username => request("/api/account/login", { body: { username, password } });
const pathFor = room => `/api/rooms/${room.state.code}`;
const action = (room, action) => request(`${pathFor(room)}/action`, { token: room.token, body: { action } }).then(ok).then(data => data.state);
const credentials = room => ({ code: room.state.code, token: room.token, memberId: room.memberId });
const resume = (cookie, room) => request(`/api/account/rooms/${room.state.code}/resume`, { cookie, body: {} });
const list = cookie => request("/api/account/rooms", { cookie }).then(ok).then(result => result.rooms);
const rooms = [];

try {
  assert.deepEqual(ok(await request("/api/account")), { user: null });
  const beforeHealthCounters = (await database.execute("SELECT count(*) AS total FROM auth_rate_limits")).rows[0].total;
  assert.deepEqual(ok(await request("/api/auth/ok", { extraHeaders: { "x-pavilion-client-ip": "198.51.100.21" } })), { status: "ok" });
  assert.equal((await database.execute("SELECT count(*) AS total FROM auth_rate_limits")).rows[0].total, beforeHealthCounters, "public health checks cannot allocate attacker-controlled persistent rate-limit keys");
  assert.equal((await request("/api/account/rooms")).status, 401);
  assert.equal((await request("/api/auth/sign-up/email", { body: { email: "bypass@example.com", name: "bypass", password } })).status, 404);
  assert.equal((await request("/api/account/register", { body: { username: `x${suffix}`, password }, origin: "https://foreign.example" })).status, 403);
  assert.equal((await request("/api/account/register", { body: { username: `x${suffix}`, password }, extraHeaders: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  for (const username of ["ab", "has spaces", "a".repeat(31), "foo@example.com", "tést"]) assert.equal((await request("/api/account/register", { body: { username, password } })).status, 400);
  assert.equal((await request("/api/account/register", { body: { username: `short_${suffix}`, password: "short" } })).status, 400);

  const hostName = `host_${suffix}`;
  const managerName = `manager_${suffix}`;
  const hostRegistration = await register(hostName);
  assert.equal(hostRegistration.status, 201, hostRegistration.data.error);
  const hostUser = hostRegistration.data.user;
  assert.deepEqual(Object.keys(hostUser).sort(), ["id", "name", "username"]);
  assert.equal(hostUser.username, hostName);
  assert.ok(hostRegistration.cookies.some(cookie => /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Path=\//i.test(cookie)));
  assert.match(hostRegistration.cache, /no-store/);
  const hostCookie = jar(hostRegistration);
  assert.ok(hostCookie.includes("pavilion.session_token="));
  assert.equal(ok(await request("/api/account", { cookie: hostCookie })).user.id, hostUser.id);
  assert.equal((await register(hostName.toUpperCase())).status, 400, "usernames are unique irrespective of case");
  assert.equal((await request("/api/account/login", { body: { username: hostName, password: "Wrong password for Pavilion" } })).status, 401);
  assert.equal((await request("/api/account/login", { body: { username: hostName, password }, origin: "https://foreign.example" })).status, 403);
  const managerRegistration = await register(managerName);
  const managerUser = ok(managerRegistration).user;
  const managerCookie = jar(managerRegistration);
  const outsiderRegistration = await register(`other_${suffix}`);
  const outsiderCookie = jar(outsiderRegistration);
  ok(outsiderRegistration);

  const host = ok(await request("/api/rooms", { cookie: hostCookie, body: { hostName: "Saved auctioneer", name: "Account recovery auction", creationKey: randomBytes(32).toString("hex") } }));
  rooms.push(host);
  assert.equal(host.accountLinked, true, host.accountLinkError);
  const teamPassword = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const manager = ok(await request(`${pathFor(host)}/join`, { cookie: managerCookie, body: { name: "Saved RCB manager", teamId: "rcb", teamPassword } }));
  assert.equal(manager.accountLinked, true, manager.accountLinkError);
  const ownerRooms = await list(hostCookie);
  assert.equal(ownerRooms.length, 1);
  assert.equal(ownerRooms[0].role, "auctioneer");
  assert.equal(ownerRooms[0].memberId, host.memberId, "account summaries identify the exact saved seat without exposing its token");
  assert.equal((await list(managerCookie))[0].teamId, "rcb");
  assert.deepEqual(await list(outsiderCookie), []);
  assert.ok(!JSON.stringify(ownerRooms).includes(host.token));
  assert.ok(!JSON.stringify(ownerRooms).includes(teamPassword));
  assert.ok(!JSON.stringify(ownerRooms).includes("encryptedToken"));
  assert.equal((await resume(outsiderCookie, host)).status, 404);
  assert.equal((await resume(undefined, host)).status, 401);
  assert.equal((await request("/api/account/rooms", { cookie: outsiderCookie, body: credentials(host) })).status, 409, "an already linked seat cannot be claimed by another account even with its bearer credential");
  assert.equal((await request("/api/account/rooms", { cookie: managerCookie, body: { ...credentials(host), memberId: manager.memberId } })).status, 403);
  assert.equal((await request("/api/account/rooms", { cookie: hostCookie, body: credentials(host), origin: "https://foreign.example" })).status, 403);
  assert.equal((await request(`/api/account/rooms/${host.state.code}/resume`, { cookie: hostCookie, body: {}, origin: "https://foreign.example" })).status, 403);

  const player = host.state.players.find(player => player.eligibilityVerified !== false && !player.isOverseas && player.basePrice % 25 === 0);
  assert.ok(player);
  await action(manager, { type: "set_target_picks", teamId: "rcb", playerIds: [player.id], expectedRevision: 0, maxBids: { [player.id]: 500 } });
  await action(host, { type: "select_player", playerId: player.id });
  await action(host, { type: "start" });
  await action(manager, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice });
  await action(host, { type: "lock" });
  await action(host, { type: "sell" });
  await action(manager, { type: "set_lineup", teamId: "rcb", lineup: { playingXI: [player.id], substitutes: [], captainId: player.id, viceCaptainId: null }, expectedRevision: 0 });
  await action(host, { type: "pause_auction" });

  const hostDevice2 = await login(hostName.toUpperCase());
  ok(hostDevice2);
  const hostCookie2 = jar(hostDevice2);
  const recoveredHost = ok(await resume(hostCookie2, host));
  assert.equal(recoveredHost.token, host.token, "creator recovery retains the original token needed for stable team password derivation");
  assert.equal(recoveredHost.memberId, host.memberId);
  assert.equal(ok(await request(`${pathFor(host)}/access`, { token: recoveredHost.token, body: {} })).teamPassword, teamPassword);
  assert.equal(recoveredHost.state.teams.find(team => team.id === "rcb").squad.length, 1);
  assert.ok(recoveredHost.state.auctionPausedAt);
  assert.equal(recoveredHost.state.myTargetPicks, undefined, "host recovery cannot expose a manager's private targets");
  const managerDevice2 = await login(managerName);
  ok(managerDevice2);
  const managerCookie2 = jar(managerDevice2);
  const recoveredManager = ok(await resume(managerCookie2, host));
  assert.equal(recoveredManager.token, manager.token);
  assert.equal(recoveredManager.memberId, manager.memberId);
  assert.equal(recoveredManager.state.myTargetPicks.teamId, "rcb");
  assert.equal(recoveredManager.state.myTargetPicks.maxBids[player.id], 500);
  assert.equal(recoveredManager.state.teams.find(team => team.id === "rcb").lineup.captainId, player.id);
  assert.ok((await list(managerCookie2))[0].auctionPausedAt);
  const logout = await request("/api/account/logout", { cookie: managerCookie2, body: {} });
  assert.deepEqual(ok(logout), { user: null });
  assert.equal((await resume(managerCookie2, host)).status, 401, "logout revokes the database session, not merely its browser cookie");
  assert.equal(ok(await request("/api/account", { cookie: managerCookie2 })).user, null);
  assert.equal(ok(await request("/api/account", { cookie: managerCookie })).user.id, managerUser.id, "other signed-in devices keep their own independent session");
  assert.equal(ok(await request(pathFor(manager), { token: manager.token })).state.members.find(entry => entry.id === manager.memberId).teamId, "rcb", "account logout must not release a team seat");

  const legacy = ok(await request("/api/rooms", { body: { name: "Existing guest auction", hostName: "Legacy host" } }));
  rooms.push(legacy);
  assert.equal(legacy.accountLinked, undefined);
  assert.equal(ok(await request("/api/account/rooms", { cookie: hostCookie, body: credentials(legacy) })).accountLinked, true);
  assert.equal(ok(await resume(hostCookie2, legacy)).token, legacy.token);
  const alternateGuest = ok(await request(`${pathFor(legacy)}/join`, { body: { name: "Other seat" } }));
  assert.equal((await request("/api/account/rooms", { cookie: hostCookie, body: credentials(alternateGuest) })).status, 409, "saving a second seat cannot overwrite an account's existing creator seat");

  const storedAccount = (await database.execute({ sql: "SELECT password FROM auth_accounts WHERE user_id = ?", args: [hostUser.id] })).rows[0];
  assert.ok(storedAccount.password && storedAccount.password !== password && !storedAccount.password.includes(password), "passwords must be library-generated hashes");
  const storedLinks = (await database.execute({ sql: "SELECT encrypted_token FROM account_rooms WHERE user_id = ?", args: [hostUser.id] })).rows;
  assert.ok(storedLinks.every(link => link.encrypted_token.startsWith("v1.") && !link.encrypted_token.includes(host.token) && !link.encrypted_token.includes(legacy.token)));
  assert.ok((await database.execute("SELECT count(*) AS total FROM auth_sessions")).rows[0].total >= 4, "independent browser sessions are persisted in the database");

  // A departed member's stale account link must disappear rather than rejoin or
  // overwrite the new owner of the franchise.
  const viewer = ok(await request(`${pathFor(legacy)}/join`, { cookie: outsiderCookie, body: { name: "Saved viewer" } }));
  assert.equal(viewer.accountLinked, true);
  await action(viewer, { type: "leave" });
  assert.deepEqual(await list(outsiderCookie), []);
  assert.equal((await resume(outsiderCookie, legacy)).status, 404);
  ok(await request(`${pathFor(legacy)}/delete`, { token: legacy.token, body: { confirmationCode: legacy.state.code } }));
  assert.equal((await list(hostCookie)).some(room => room.code === legacy.state.code), false);

  const nonexistentUsername = `attempt_${suffix}`;
  let limited;
  for (let i = 0; i < 11; i += 1) {
    limited = await request("/api/account/login", { body: { username: nonexistentUsername, password }, extraHeaders: { "X-Forwarded-For": `198.51.100.${i + 1}` } });
    assert.equal(limited.status, i < 10 ? 401 : 429, "changing an untrusted forwarded IP must not bypass the username limit");
  }
  assert.equal(limited.data.code, "ACCOUNT_RATE_LIMIT");
  assert.ok((await database.execute("SELECT count(*) AS total FROM account_request_limits")).rows[0].total > 0, "rate limits survive process changes through the database");
  console.log("PASS: username/password accounts, unique normalized usernames, secure cookies, durable sessions, logout revocation and origin/rate-limit protections.");
  console.log("PASS: independent devices recover exact creator/team seats, team passwords, purchases, lineup, pause state and private targets without exposing credentials to rivals.");
  console.log("PASS: encrypted room links preserve guest migration, reject conflicting accounts/seats and prune only deleted or departed room access.");
} finally {
  for (const room of rooms) await request(`${pathFor(room)}/delete`, { token: room.token, body: { confirmationCode: room.state.code } });
  database.close();
}
