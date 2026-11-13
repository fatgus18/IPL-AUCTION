import assert from "node:assert/strict";

// Run against a local built preview after applying its D1 migration:
// BASE_URL=http://127.0.0.1:5173 node tests/api-integration.mjs
const baseUrl = (process.env.BASE_URL || "http://127.0.0.1:5173").replace(/\/$/, "");

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
  const data = await response.json();
  return { status: response.status, data };
}

function checkPublicState(state, tokens) {
  assert.equal(state.tokenHashes, undefined, "credential hashes must not be in public state");
  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes("tokenHashes"), "nested credential hashes must not leak");
  for (const token of tokens) assert.ok(!serialized.includes(token), "membership tokens must not leak into room snapshots");
}

const host = await request("/api/rooms", { body: { name: "API integration check", hostName: "Test auctioneer" } });
assert.equal(host.status, 201, `room creation failed: ${host.data.error || host.status}`);
assert.match(host.data.token, /^[a-f0-9]{64}$/);
const roomPath = `/api/rooms/${host.data.state.code}`;
assert.equal(host.data.state.phase, "waiting");
assert.equal(host.data.state.members[0].role, "auctioneer");

const joinResults = await Promise.all([
  request(`${roomPath}/join`, { body: { name: "Test Chennai", teamId: "csk" } }),
  request(`${roomPath}/join`, { body: { name: "Test Mumbai", teamId: "mi" } }),
]);
joinResults.forEach((result) => assert.equal(result.status, 201));
const [chennai, mumbai] = joinResults.map((result) => result.data);
const tokens = [host.data.token, chennai.token, mumbai.token];
for (const response of [host.data, chennai, mumbai]) checkPublicState(response.state, tokens);

const duplicateSeat = await request(`${roomPath}/join`, { body: { name: "Duplicate seat", teamId: "csk" } });
assert.equal(duplicateSeat.status, 409);
assert.equal(duplicateSeat.data.code, "TEAM_TAKEN");
assert.equal((await request(roomPath)).status, 401);
assert.equal((await request(roomPath, { token: "0".repeat(64) })).status, 401);

const act = (token, action) => request(`${roomPath}/action`, { token, body: { action } });
const player = host.data.state.players[0];
assert.equal((await act(chennai.token, { type: "select_player", playerId: player.id })).status, 403);
assert.equal((await act(host.data.token, { type: "select_player", playerId: player.id })).status, 200);
assert.equal((await act(host.data.token, { type: "start" })).status, 200);

const firstBid = { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice };
const bids = await Promise.all(tokens.slice(1).map((token) => act(token, firstBid)));
const accepted = bids.filter((result) => result.status === 200);
const rejected = bids.filter((result) => result.status !== 200);
assert.equal(accepted.length, 1, "exactly one simultaneous bid must be accepted");
assert.equal(rejected.length, 1);
assert.equal(rejected[0].status, 409);
assert.equal(rejected[0].data.code, "STALE_BID");
let state = accepted[0].data.state;
assert.equal(state.currentBid, player.basePrice);
assert.equal(state.bidHistory.length, 1);
assert.equal(state.teams.find((team) => team.id === state.leadingTeamId).purse, 10000, "purse is charged only when the sale is confirmed");

const nextBid = { type: "bid", expectedPlayerId: player.id, expectedAmount: state.currentBid + state.settings.bidIncrement };
const trailingToken = state.leadingTeamId === "csk" ? mumbai.token : chennai.token;
const locked = await act(host.data.token, { type: "lock" });
assert.equal(locked.status, 200);
assert.equal(locked.data.state.phase, "locked");
const lateBid = await act(trailingToken, nextBid);
assert.equal(lateBid.status, 409);
assert.equal(lateBid.data.code, "BIDDING_CLOSED", "even a previously prepared bid must fail once locked");
assert.equal((await act(trailingToken, { type: "sell" })).status, 403);

const sold = await act(host.data.token, { type: "sell" });
assert.equal(sold.status, 200);
state = sold.data.state;
assert.equal(state.phase, "sold");
const winningTeam = state.teams.find((team) => team.id === state.leadingTeamId);
assert.equal(winningTeam.purse, 10000 - player.basePrice);
assert.deepEqual(winningTeam.squad, [{ playerId: player.id, amount: player.basePrice }]);
assert.equal(state.players.find((entry) => entry.id === player.id).status, "sold");
assert.equal((await act(host.data.token, { type: "sell" })).status, 409, "replaying sale cannot charge the purse twice");

const readBack = await request(roomPath, { token: chennai.token });
assert.equal(readBack.status, 200);
assert.equal(readBack.data.state.version, state.version);
assert.equal(readBack.data.state.teams.find((team) => team.id === winningTeam.id).purse, winningTeam.purse);
assert.equal(readBack.data.state.members.length, 3, "concurrent joins must both persist");
checkPublicState(readBack.data.state, tokens);

console.log("PASS: persisted room creation, concurrent joins and bids, private tokens, auctioneer permissions, locked bidding, and one-time sale accounting.");
