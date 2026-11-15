import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use tests/run-isolated-api.mjs; this suite migrates an isolated legacy room.");
assert.ok(process.env.DATABASE_URL?.startsWith("file:"));
const baseUrl = process.env.BASE_URL;
const client = createClient({ url: process.env.DATABASE_URL });

async function request(path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
}

function withoutPresence(member) {
  const copy = { ...member };
  delete copy.lastSeenAt;
  return copy;
}

try {
  const created = await request("/api/rooms", { body: { name: "Historical franchise QA", hostName: "QA auctioneer" } });
  assert.equal(created.status, 201, created.data.error);
  const host = created.data;
  assert.equal(host.state.teams.length, 12);
  const path = `/api/rooms/${host.state.code}`;
  const access = await request(`${path}/access`, { token: host.token, body: {} });
  assert.equal(access.status, 200, access.data.error);
  const { teamPassword } = access.data;
  const existingOwner = await request(`${path}/join`, { body: { name: "Existing Chennai manager", teamId: "csk", teamPassword } });
  assert.equal(existingOwner.status, 201, existingOwner.data.error);

  // Simulate a persisted v2 ten-team room with purchases and a saved XI.
  const row = (await client.execute({ sql: "SELECT state_json, version FROM auction_rooms WHERE code = ?", args: [host.state.code] })).rows[0];
  const stored = JSON.parse(row.state_json);
  stored.state.teams = stored.state.teams.filter(team => !["gt", "lsg"].includes(team.id));
  stored.state.teamCatalogVersion = 2;
  stored.state.settings.purse = 12000;
  stored.state.teams.forEach(team => { team.purse = 12000; });
  stored.state.teams[0].name = "Preserved team name";
  const signedPlayer = stored.state.players.at(-1);
  Object.assign(signedPlayer, { status: "sold", soldTo: "csk", soldFor: 1500 });
  Object.assign(stored.state.teams[0], {
    purse: 10500, squad: [{ playerId: signedPlayer.id, amount: 1500 }],
    lineup: { playingXI: [null, null, null, null, null, null, signedPlayer.id], substitutes: [], captainId: signedPlayer.id, viceCaptainId: null, revision: 3 },
  });
  const pendingPlayer = stored.state.players.at(-2);
  Object.assign(stored.state, {
    currentPlayerId: pendingPlayer.id, currentBid: 500, leadingTeamId: "csk", phase: "live", lastBidAt: Date.now() - 5000,
    bidHistory: [{ id: "preserved-bid", playerId: pendingPlayer.id, teamId: "csk", memberId: existingOwner.data.memberId, amount: 500, at: Date.now() - 5000 }],
  });
  stored.state.version = Number(row.version) + 1;
  const oldVersion = stored.state.version;
  const beforeTeams = structuredClone(stored.state.teams);
  const beforeState = structuredClone(stored.state);
  const hashes = structuredClone(stored.tokenHashes);
  await client.execute({ sql: "UPDATE auction_rooms SET state_json = ?, version = ? WHERE code = ?", args: [JSON.stringify(stored), oldVersion, host.state.code] });

  const migrated = await request(`${path}?since=${oldVersion}`, { token: host.token });
  assert.equal(migrated.status, 200, migrated.data.error);
  assert.ok(migrated.data.state, "the old poll version must receive a migrated snapshot");
  assert.equal(migrated.data.state.teams.length, 12);
  assert.equal(migrated.data.state.teamCatalogVersion, 3);
  assert.deepEqual(migrated.data.state.teams.slice(0, 10), beforeTeams);
  for (const field of ["players", "members", "currentPlayerId", "currentBid", "leadingTeamId", "phase", "lastBidAt", "bidHistory", "activity", "settings"]) {
    if (field === "members") {
      // Authenticated reads refresh only the viewing member's lastSeenAt timestamp.
      assert.deepEqual(migrated.data.state.members.map(withoutPresence), beforeState.members.map(withoutPresence));
    } else assert.deepEqual(migrated.data.state[field], beforeState[field], field);
  }
  assert.equal(migrated.data.state.teams.find(team => team.id === "gt").purse, 12000);
  assert.equal(migrated.data.state.teams.find(team => team.id === "lsg").purse, 12000);
  const persisted = JSON.parse((await client.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [host.state.code] })).rows[0].state_json);
  assert.deepEqual(persisted.tokenHashes, hashes, "team migration preserves credentials byte-for-byte");
  const unchanged = await request(`${path}?since=${migrated.data.state.version}`, { token: host.token });
  assert.equal(unchanged.data.unchanged, true, "the normal lightweight poll resumes after one migration");

  const expansionIds = ["gt", "lsg", "dch", "pwi"];
  const joins = await Promise.all(expansionIds.map(teamId => request(`${path}/join`, { body: { name: `${teamId.toUpperCase()} manager`, teamId, teamPassword } })));
  joins.forEach(join => assert.equal(join.status, 201, join.data.error));
  assert.equal((await request(`${path}/join`, { body: { name: "Duplicate", teamId: "dch", teamPassword } })).status, 409);
  const act = (token, action) => request(`${path}/action`, { token, body: { action } });
  assert.equal((await act(host.token, { type: "lock" })).status, 200, "the preserved live bid remains usable after migration");
  assert.equal((await act(host.token, { type: "sell" })).status, 200);
  for (const [index, teamId] of expansionIds.entries()) {
    const bidder = joins[index].data;
    const player = host.state.players[index];
    assert.equal((await act(bidder.token, { type: "select_player", playerId: player.id })).status, 403);
    assert.equal((await act(host.token, { type: "select_player", playerId: player.id })).status, 200);
    assert.equal((await act(host.token, { type: "start" })).status, 200);
    const bid = await act(bidder.token, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice });
    assert.equal(bid.status, 200, bid.data.error);
    assert.equal(bid.data.state.leadingTeamId, teamId);
    assert.equal((await act(host.token, { type: "lock" })).status, 200);
    assert.equal((await act(bidder.token, { type: "sell" })).status, 403);
    const sold = await act(host.token, { type: "sell" });
    assert.equal(sold.status, 200, sold.data.error);
    const team = sold.data.state.teams.find(team => team.id === teamId);
    assert.equal(team.purse, 12000 - player.basePrice);
    assert.deepEqual(team.squad, [{ playerId: player.id, amount: player.basePrice }]);
  }
  const practice = await request("/api/practice", { body: {} });
  assert.equal(practice.status, 201, practice.data.error);
  assert.equal(practice.data.state.teams.length, 12);
  assert.equal(practice.data.state.members.length, 13);
  assert.ok(practice.data.state.members.every(member => member.name?.trim()));
  console.log("PASS: twelve playable teams; v2 room migration preserves purchases, lineups, managers, live bids, settings and credentials; GT, LSG and both historical managers join, bid and purchase; repeat polls remain lightweight.");
} finally {
  client.close();
}
