import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Explicitly opt in to a deployment. This script creates and deletes ONLY its
// own private room. It does not write to the common player catalog or use SQL.
// BASE_URL=https://your-deployment.vercel.app node tests/deployment-smoke.mjs
assert.ok(process.env.BASE_URL, "Set BASE_URL explicitly to the deployment to check.");
const target = new URL(process.env.BASE_URL);
assert.ok(!target.username && !target.password && !target.search && !target.hash,
  "BASE_URL must be a plain deployment origin, without credentials or query parameters.");
assert.equal(target.pathname, "/", "BASE_URL must point to the deployment root.");
assert.ok(target.protocol === "https:" || (target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)),
  "Deployment checks require HTTPS; HTTP is allowed only on localhost.");
const baseUrl = target.origin;
const expectedCount = process.env.EXPECTED_CATALOG_COUNT ? Number(process.env.EXPECTED_CATALOG_COUNT) : null;
assert.ok(expectedCount === null || (Number.isSafeInteger(expectedCount) && expectedCount >= 249),
  "EXPECTED_CATALOG_COUNT must be an integer of at least 249.");

async function request(path, { token, body } = {}) {
  const method = body === undefined ? "GET" : "POST";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    redirect: "error",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Origin: baseUrl,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/i,
    `${method} ${path} returned HTTP ${response.status} without JSON; check deployment protection and API routing.`);
  return { status: response.status, data: await response.json(), cacheControl: response.headers.get("cache-control") || "" };
}

function expectStatus(result, status, label) {
  assert.equal(result.status, status, `${label}: expected HTTP ${status}, received ${result.status}.`);
  return result.data;
}

function privateState(state, secrets) {
  const serialized = JSON.stringify(state);
  for (const privateField of ["tokenHashes", "passwordHash", "teamAccess", "privateTargetPicks"]) {
    assert.ok(!serialized.includes(`\"${privateField}\"`), "Shared snapshots must not expose credential material.");
  }
  for (const secret of secrets.filter(Boolean)) {
    assert.ok(!serialized.includes(secret), "Shared snapshots must not expose membership credentials or the team password.");
  }
}

const creation = {
  name: `Deployment smoke ${new Date().toISOString()}`,
  hostName: "Deployment smoke host",
  creationKey: randomBytes(32).toString("hex"),
};
let host;
let creationAttempted = false;
let failure;
let catalogCount;
const secrets = [creation.creationKey];
const roomPath = () => `/api/rooms/${host.state.code}`;
const act = (member, action) => request(`${roomPath()}/action`, { token: member.token, body: { action } });
const read = async member => {
  const result = expectStatus(await request(roomPath(), { token: member.token }), 200, "Fresh room read");
  privateState(result.state, secrets);
  return result.state;
};

try {
  const catalog = expectStatus(await request("/api/players/catalog"), 200, "Public common catalog");
  assert.ok(Array.isArray(catalog.players) && catalog.players.length >= 249, "The common catalog must contain at least 249 players.");
  catalogCount = catalog.players.length;
  if (expectedCount !== null) assert.equal(catalogCount, expectedCount, "The expected catalog was deployed.");
  console.log(`PASS: public catalog is available with ${catalogCount} players.`);

  creationAttempted = true;
  const created = await request("/api/rooms", { body: creation });
  // Retain the deletion credential even if a later assertion fails.
  if (created.data?.state?.code && created.data?.token) host = created.data;
  expectStatus(created, 201, "Room creation");
  assert.ok(host?.memberId && host.token, "Creation must return a private creator membership.");
  assert.equal(host.state.name, creation.name, "The returned room must belong to this check.");
  assert.equal(host.state.players.length, catalogCount, "New rooms use the common catalog.");
  assert.ok(host.state.teams.some(team => team.id === "gt") && host.state.teams.some(team => team.id === "lsg"),
    "Gujarat Titans and Lucknow Super Giants must be available.");
  privateState(host.state, secrets);

  const access = await request(`${roomPath()}/access`, { token: host.token, body: {} });
  const { teamPassword } = expectStatus(access, 200, "Creator team password");
  assert.ok(typeof teamPassword === "string" && teamPassword.length >= 12, "Creator receives a strong team password.");
  assert.match(access.cacheControl, /no-store/i, "Private password responses must not be cached.");
  secrets.push(teamPassword, host.token);
  const invalidJoin = await request(`${roomPath()}/join`, { body: { name: "Denied smoke manager", teamId: "gt", teamPassword: "incorrect-smoke-password" } });
  expectStatus(invalidJoin, 403, "Incorrect team password");
  assert.equal(invalidJoin.data.code, "TEAM_PASSWORD_INVALID");

  const managerNames = { gt: "Smoke Gujarat manager", lsg: "Smoke Lucknow manager" };
  const participants = [];
  for (const teamId of ["gt", "lsg"]) {
    const joined = expectStatus(await request(`${roomPath()}/join`, {
      body: { name: managerNames[teamId], teamId, teamPassword },
    }), 201, `${teamId.toUpperCase()} join`);
    secrets.push(joined.token);
    privateState(joined.state, secrets);
    assert.equal(joined.state.members.find(member => member.id === joined.memberId)?.teamId, teamId);
    participants.push({ ...joined, teamId });
  }
  const spectator = expectStatus(await request(`${roomPath()}/join`, { body: { name: "Smoke spectator" } }), 201, "Free spectator join");
  secrets.push(spectator.token);
  assert.equal(spectator.state.members.find(member => member.id === spectator.memberId)?.role, "spectator");
  expectStatus(await request(`${roomPath()}/access`, { token: spectator.token, body: {} }), 403, "Spectator cannot read team password");
  expectStatus(await request(roomPath()), 401, "Private room snapshot requires membership");

  const joinedState = await read(spectator);
  assert.equal(joinedState.members.length, 4, "Only the creator, two managers and spectator should be admitted.");
  const startingFinancials = new Map(joinedState.teams.map(team => [team.id, { purse: team.purse, squad: team.squad }]));
  const player = joinedState.players.find(entry => entry.status === "available" && entry.eligibilityVerified !== false && !entry.isOverseas);
  assert.ok(player, "At least one eligible domestic player must be available.");
  const targetIds = joinedState.players.filter(entry => !entry.catalogArchived && entry.status === "available").slice(0, 12).map(entry => entry.id);
  assert.equal(targetIds.length, 12);
  const manager = participants[0];
  for (const [revision, count] of [[0, 5], [1, 9], [2, 12]]) {
    const saved = expectStatus(await act(manager, { type: "set_target_picks", teamId: manager.teamId, playerIds: targetIds.slice(0, count), expectedRevision: revision }), 200, "Save cumulative private targets").state;
    assert.deepEqual(saved.myTargetPicks, { teamId: manager.teamId, playerIds: targetIds.slice(0, count), revision: revision + 1 });
  }
  assert.deepEqual((await read(manager)).myTargetPicks.playerIds, targetIds);
  assert.deepEqual((await read(participants[1])).myTargetPicks.playerIds, []);
  assert.equal((await read(host)).myTargetPicks, undefined);
  assert.equal((await read(spectator)).myTargetPicks, undefined);
  expectStatus(await act(spectator, { type: "set_target_picks", teamId: manager.teamId, playerIds: [], expectedRevision: 3 }), 403, "Spectators cannot edit a manager's targets");
  console.log("PASS: private target picks grow from five to nine to twelve and are visible only to their authenticated manager.");
  expectStatus(await act(spectator, { type: "select_player", playerId: player.id }), 403, "Only the auctioneer may select a player");
  expectStatus(await act(host, { type: "select_player", playerId: player.id }), 200, "Select player");
  expectStatus(await act(host, { type: "start" }), 200, "Open bidding");
  const firstBid = { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice };
  expectStatus(await act(spectator, firstBid), 403, "A spectator cannot bid");
  const bids = await Promise.all(participants.map(member => act(member, firstBid)));
  assert.equal(bids.filter(result => result.status === 200).length, 1, "Exactly one bid at the displayed price must win.");
  const staleBid = bids.find(result => result.status !== 200);
  expectStatus(staleBid, 409, "Concurrent stale bid");
  assert.equal(staleBid.data.code, "STALE_BID");
  const bidState = bids.find(result => result.status === 200).data.state;
  assert.equal(bidState.bidHistory.length, 1);
  assert.equal(bidState.currentBid, player.basePrice);
  const winner = participants.find(member => member.teamId === bidState.leadingTeamId);
  const other = participants.find(member => member.teamId !== bidState.leadingTeamId);
  assert.ok(winner && other, "One test manager must lead.");
  for (const team of bidState.teams) {
    assert.equal(team.purse, startingFinancials.get(team.id).purse, "Bidding alone must not debit any purse.");
  }
  const locked = expectStatus(await act(host, { type: "lock" }), 200, "Lock bidding").state;
  assert.equal(locked.phase, "locked");
  const late = await act(other, { type: "bid", expectedPlayerId: player.id, expectedAmount: bidState.currentBid + bidState.settings.bidIncrement });
  expectStatus(late, 409, "Late bid after locking");
  assert.equal(late.data.code, "BIDDING_CLOSED");
  const reopen = { type: "unlock", expectedPlayerId: player.id, expectedAmount: locked.currentBid, expectedLockVersion: locked.bidLockVersion ?? 0 };
  expectStatus(await act(other, reopen), 403, "A manager cannot unlock bidding");
  const reopened = expectStatus(await act(host, reopen), 200, "Creator reopens bidding").state;
  assert.equal(reopened.phase, "live");
  assert.equal(reopened.currentBid, locked.currentBid);
  assert.equal(reopened.leadingTeamId, locked.leadingTeamId);
  assert.deepEqual(reopened.bidHistory, locked.bidHistory);
  assert.deepEqual(reopened.teams, locked.teams, "Unlocking must not change any squad or purse.");
  expectStatus(await act(host, { type: "lock" }), 200, "Lock the reopened round");
  expectStatus(await act(other, { type: "sell" }), 403, "A manager cannot confirm a sale");
  expectStatus(await act(host, { type: "sell" }), 200, "Confirm sale");
  expectStatus(await act(host, { type: "sell" }), 409, "A sale cannot charge twice");
  expectStatus(await act(host, reopen), 409, "A completed sale cannot be reopened");

  const sold = await read(spectator);
  assert.deepEqual((await read(manager)).myTargetPicks.playerIds, targetIds, "Auction events preserve the private target list.");
  assert.equal(sold.phase, "sold");
  const winningTeam = sold.teams.find(team => team.id === winner.teamId);
  assert.equal(winningTeam.purse, startingFinancials.get(winner.teamId).purse - player.basePrice);
  assert.deepEqual(winningTeam.squad, [{ playerId: player.id, amount: player.basePrice }]);
  for (const team of sold.teams.filter(team => team.id !== winner.teamId)) {
    assert.deepEqual({ purse: team.purse, squad: team.squad }, startingFinancials.get(team.id), "Other franchises must remain financially unchanged.");
  }
  assert.equal(sold.players.find(entry => entry.id === player.id).status, "sold");
  console.log("PASS: GT/LSG admission, creator permissions, simultaneous bidding, safe lock/unlock and single-sale accounting.");

  const lineup = { playingXI: [null, null, null, null, null, null, player.id], substitutes: [], captainId: player.id, viceCaptainId: null };
  const save = { type: "set_lineup", teamId: winner.teamId, lineup, expectedRevision: winningTeam.lineup?.revision || 0 };
  expectStatus(await act(other, save), 403, "Only the franchise manager can save its XI");
  expectStatus(await act(winner, save), 200, "Save player at number seven with captaincy");
  const refreshed = await read(winner);
  const afterLineup = refreshed.teams.find(team => team.id === winner.teamId);
  assert.deepEqual(afterLineup.lineup, { ...lineup, revision: save.expectedRevision + 1 }, "A fresh session read must preserve empty positions and captaincy.");
  assert.equal(afterLineup.purse, winningTeam.purse);
  assert.deepEqual(afterLineup.squad, winningTeam.squad, "Saving a lineup cannot alter purchases.");
  const spectatorRead = await read(spectator);
  assert.deepEqual(spectatorRead.teams.find(team => team.id === winner.teamId).lineup, afterLineup.lineup, "Other sessions see the saved XI.");

  const chat = expectStatus(await act(winner, { type: "chat", text: "Production smoke: squad is ready.", senderName: "Forged name", senderTeamId: other.teamId }), 200, "Manager chat").state.activity.at(-1);
  assert.equal(chat.senderName, managerNames[winner.teamId], "Chat identity must be derived from the authenticated participant.");
  assert.equal(chat.senderTeamId, winner.teamId);
  assert.equal(chat.memberId, winner.memberId);
  const chatRead = await read(spectator);
  assert.deepEqual(chatRead.activity.find(entry => entry.id === chat.id), chat, "Chat names persist across participant sessions.");
  expectStatus(await request(`${roomPath()}/delete`, { token: spectator.token, body: { confirmationCode: host.state.code } }), 403, "Only the creator may delete the room");
  console.log("PASS: number-seven lineup, captaincy, independent-session persistence and authenticated chat names.");
} catch (error) {
  failure = error;
} finally {
  if (creationAttempted) {
    try {
      // The creation key is idempotent. Recover a lost creation response so this
      // test can still remove its own room after a timeout or transport failure.
      if (!host) host = expectStatus(await request("/api/rooms", { body: creation }), 201, "Recover smoke room for cleanup");
      assert.equal(host.state.name, creation.name, "Cleanup must only target this test's room.");
      const deleted = expectStatus(await request(`${roomPath()}/delete`, {
        token: host.token, body: { confirmationCode: host.state.code },
      }), 200, "Creator cleanup");
      assert.equal(deleted.deleted, true);
      const removed = await request(roomPath(), { token: host.token });
      expectStatus(removed, 410, "Deleted smoke room is no longer available");
      assert.equal(removed.data.code, "ROOM_DELETED");
      console.log("PASS: the smoke room was deleted; no existing auctions or catalog entries were modified.");
    } catch (cleanupError) {
      console.error(`Cleanup failed${host?.state?.code ? ` for smoke room ${host.state.code}` : ""}. Rerun only after reviewing this test room.`);
      failure ||= cleanupError;
    }
  }
}

if (failure) {
  // Assertion inspection can contain objects; log only the human-readable
  // message so membership tokens and passwords cannot appear in test output.
  console.error(`FAIL: ${failure instanceof Error ? failure.message : "Deployment check failed."}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: deployment smoke completed against ${baseUrl} (${catalogCount} shared players).`);
}
