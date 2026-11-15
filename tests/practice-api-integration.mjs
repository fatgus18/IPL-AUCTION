import assert from "node:assert/strict";

// Catalog edits affect every room. Run only through the isolated API test runner.
assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use tests/run-isolated-api.mjs; this suite mutates the global player catalog.");
const baseUrl = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

async function request(path, { token, body, method = body ? "POST" : "GET" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/i,
    `${method} ${path} returned HTTP ${response.status} without JSON. Rebuild the local server to discover new API routes.`);
  return { status: response.status, data: await response.json() };
}

function noCredentials(state, tokens) {
  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes("tokenHashes"), "credential hashes must stay out of public state");
  for (const token of tokens) assert.ok(!serialized.includes(token), "credentials must stay out of public state");
}

const practice = await request("/api/practice", { body: {} });
assert.equal(practice.status, 201, practice.data.error);
const { token, memberId } = practice.data;
let state = practice.data.state;
assert.equal(state.mode, "practice");
assert.equal(memberId, "demo-host");
assert.equal(state.hostId, memberId);
assert.match(state.code, /^[A-Z0-9]{6}$/);
assert.notEqual(state.code, "DEMO26");
assert.equal(state.id, state.code);
assert.match(token, /^[a-f0-9]{64}$/);
assert.equal(state.players.length, 249);
const roomPath = `/api/rooms/${state.code}`;
const act = (action, actor) => request(`${roomPath}/action`, { token, body: { action, ...(actor === undefined ? {} : { memberId: actor }) } });

assert.equal((await request(roomPath)).status, 401);
assert.equal((await request(roomPath, { token: "0".repeat(64) })).status, 401);
assert.equal((await request(`${roomPath}/join`, { body: { name: "Uninvited visitor" } })).status, 403);
assert.equal((await request(`${roomPath}/action`, { body: { resetPractice: true } })).status, 401);
assert.equal((await act({ type: "ping" }, "does-not-exist")).status, 400);
assert.equal((await act({ type: "ping" }, null)).status, 400);
assert.equal((await act({ type: "lock" }, "demo-csk")).status, 403, "simulating a bidder must retain bidder permissions");

const makePlayer = (suffix) => ({
  id: `practice-persistence-${suffix}`,
  name: `Persistence Check ${suffix}`,
  country: "India", role: "Batter", basePrice: 50, isOverseas: false,
  stats: { matches: null, runs: null, wickets: null, strikeRate: null },
  statsFormat: "Unknown", dataStatus: "manual", eligibilityVerified: true,
});
const additions = await Promise.all(["one", "two"].map((suffix) => act({ type: "add_player", player: makePlayer(suffix) })));
for (const result of additions) assert.equal(result.status, 200, result.data.error);
const read = await request(roomPath, { token });
assert.equal(read.status, 200);
state = read.data.state;
assert.equal(state.players.length, 251, "concurrent writes must both survive a fresh read");
assert.ok(state.players.some((player) => player.id === "practice-persistence-one"));
assert.ok(state.players.some((player) => player.id === "practice-persistence-two"));
noCredentials(state, [token]);
const unchanged = await request(`${roomPath}?since=${state.version}`, { token });
assert.equal(unchanged.data.unchanged, true);
assert.equal(unchanged.data.state, undefined);

const edit = await act({ type: "update_player", player: { ...state.players.find((player) => player.id === "practice-persistence-one"), basePrice: 75 } });
assert.equal(edit.status, 200);
assert.equal((await act({ type: "delete_player", playerId: "virat-kohli" })).status, 200);
const bid = await act({ type: "bid", expectedPlayerId: state.currentPlayerId, expectedAmount: 750 }, "demo-csk");
assert.equal(bid.status, 200, bid.data.error);
assert.equal(bid.data.state.leadingTeamId, "csk");
assert.equal((await act({ type: "lock" })).status, 200);
assert.equal((await act({ type: "sell" })).status, 200);

const derived = await request("/api/rooms", { body: {
  name: "Practice pool inheritance check", hostName: "QA host", practiceSession: { code: state.code, token },
} });
assert.equal(derived.status, 201, derived.data.error);
const derivedState = derived.data.state;
const derivedPath = `/api/rooms/${derivedState.code}`;
assert.equal(derivedState.mode, undefined, "a shared room must never inherit private practice privileges");
assert.equal(derivedState.members.length, 1, "simulated members must not enter a real room");
assert.equal(derivedState.hostId, derived.data.memberId);
assert.notEqual(derived.data.memberId, memberId);
assert.equal(derivedState.players.length, 250, "custom additions and catalog deletions must both carry forward");
assert.equal(derivedState.players.find((player) => player.id === "practice-persistence-one").basePrice, 75);
assert.ok(!derivedState.players.some((player) => player.id === "virat-kohli"));
assert.ok(derivedState.players.every((player) => player.status === "available" && !player.soldTo && player.soldFor === undefined));
assert.ok(derivedState.teams.every((team) => team.purse === 10000 && team.squad.length === 0));
assert.equal(derivedState.bidHistory.length, 0);
assert.equal(derivedState.currentPlayerId, null);
assert.equal(derivedState.phase, "waiting");
assert.equal(derivedState.catalogVersion, state.catalogVersion);
assert.equal(derivedState.catalogDataRevision, state.catalogDataRevision);
noCredentials(derivedState, [token, derived.data.token]);

assert.equal((await request(`${derivedPath}/action`, { token: derived.data.token, body: { action: { type: "ping" }, memberId: derived.data.memberId } })).status, 403,
  "even a real room host may not supply an actor override");
assert.equal((await request(`${derivedPath}/action`, { token: derived.data.token, body: { resetPractice: true } })).status, 403);
assert.equal((await request("/api/rooms", { body: { name: "Invalid source", hostName: "QA", practiceSession: { code: derivedState.code, token: derived.data.token } } })).status, 403);
assert.equal((await request("/api/rooms", { body: { name: "Invalid source", hostName: "QA", practiceSession: { code: state.code, token: "0".repeat(64) } } })).status, 401);
assert.equal((await request(`${roomPath}/action`, { token: derived.data.token, body: { action: { type: "ping" }, memberId } })).status, 401);

const derivedAccess = await request(`${derivedPath}/access`, { token: derived.data.token, body: {} });
assert.equal(derivedAccess.status, 200, derivedAccess.data.error);
const realJoin = await request(`${derivedPath}/join`, { body: { name: "Real manager", teamId: "csk", teamPassword: derivedAccess.data.teamPassword } });
assert.equal(realJoin.status, 201, "normal shared room joining remains available");
assert.equal((await request(`${derivedPath}/action`, { token: realJoin.data.token, body: { action: { type: "add_player", player: makePlayer("three") } } })).status, 403);
assert.equal((await request(`${derivedPath}/action`, { token: realJoin.data.token, body: { action: { type: "add_player", player: makePlayer("three") }, memberId: derived.data.memberId } })).status, 403);
assert.equal((await request(`${derivedPath}/action`, { token: derived.data.token, body: { action: { type: "add_player", player: makePlayer("three") } } })).status, 200);
const realReadBack = await request(derivedPath, { token: realJoin.data.token });
assert.ok(realReadBack.data.state.players.some((player) => player.id === "practice-persistence-three"));
assert.ok(!realReadBack.data.state.players.some((player) => player.id === "virat-kohli"), "catalog migration must not resurrect intentionally deleted players");
noCredentials(realReadBack.data.state, [token, derived.data.token, realJoin.data.token]);

const preReset = await request(roomPath, { token });
assert.equal(preReset.data.state.phase, "sold");
const reset = await request(`${roomPath}/action`, { token, body: { resetPractice: true } });
assert.equal(reset.status, 200, reset.data.error);
state = reset.data.state;
assert.equal(state.code, practice.data.state.code);
assert.equal(state.mode, "practice");
assert.ok(state.version > preReset.data.state.version, "reset must never rewind the version used by other tabs");
assert.equal(state.players.length, 251, "an addition in another room is visible in this practice session");
assert.equal(state.players.find((player) => player.id === "practice-persistence-one").basePrice, 75);
assert.ok(!state.players.some((player) => player.id === "virat-kohli"));
assert.ok(state.players.every((player) => player.status === "available" && !player.soldTo && player.soldFor === undefined));
assert.ok(state.teams.every((team) => team.purse === 10000 && team.squad.length === 0));
assert.equal(state.phase, "live", "normal practice reset restores the demonstration auction");
const persistedReset = await request(roomPath, { token });
assert.deepEqual(persistedReset.data.state.players, state.players, "reset must save the curated pool, not just return it");

// Reset and a simultaneous addition must both survive compare-and-swap retries.
const racingReset = await Promise.all([
  request(`${roomPath}/action`, { token, body: { resetPractice: true } }),
  act({ type: "add_player", player: makePlayer("reset-race") }),
]);
for (const result of racingReset) assert.equal(result.status, 200, result.data.error);
const afterRace = await request(roomPath, { token });
assert.equal(afterRace.data.state.players.length, 252);
assert.ok(afterRace.data.state.players.some((player) => player.id === "practice-persistence-reset-race"));
assert.equal((await request(`${roomPath}/action`, { token, body: { resetPractice: false } })).status, 400);
assert.equal((await request(`${roomPath}/action`, { token, body: { resetPractice: true, action: { type: "ping" } } })).status, 400);
assert.equal((await request("/api/practice", { body: { oversized: "x".repeat(32768) } })).status, 413);

const standardRoom = await request("/api/rooms", { body: { name: "Default catalog check", hostName: "QA" } });
assert.equal(standardRoom.status, 201);
assert.equal(standardRoom.data.state.players.length, 252, "every room uses the common catalog without a practice reference");

console.log("PASS: durable private practice auctions, shared pool changes, actor permissions, private joins, curated reset, universal room inheritance, and credential isolation.");
