import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run unlock checks only through the isolated API runner.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${process.env.BASE_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return { status: response.status, data: await response.json() };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(ok).then(value => value.state);
const poll = (member, version) => request(`${pathFor(member)}?since=${version}`, { token: member.token }).then(ok);
const stored = async member => JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [member.state.code] })).rows[0].state_json).state;
const unlock = state => ({ type: "unlock", expectedPlayerId: state.currentPlayerId, expectedAmount: state.currentBid, expectedLockVersion: state.bidLockVersion ?? 0 });
const bid = (state, customAmount) => ({ type: "bid", expectedPlayerId: state.currentPlayerId, expectedAmount: state.currentBid ? state.currentBid + state.settings.bidIncrement : state.players.find(player => player.id === state.currentPlayerId).basePrice, ...(customAmount === undefined ? {} : { customAmount }) });
const rejected = async (member, action, status, code) => {
  const before = await stored(member);
  const result = await act(member, action);
  assert.equal(result.status, status, result.data.error);
  assert.equal(result.data.code, code);
  assert.deepEqual(await stored(member), before, "rejected unlocks must not mutate stored state");
};

try {
  const catalogBefore = ok(await request("/api/players/catalog"));
  const host = ok(await request("/api/rooms", { body: { name: "Unlock bidding verification", hostName: "Reopen host" } }));
  const teamPassword = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword } : {}) } }).then(ok);
  const red = await join("Red manager", "rcb");
  const blue = await join("Blue manager", "mi");
  const spectator = await join("Unlock viewer");
  const candidates = host.state.players.filter(player => player.status === "available" && player.eligibilityVerified !== false && !player.isOverseas).slice(0, 4);
  assert.equal(candidates.length, 4);
  const open = async player => {
    ok(await act(host, { type: "select_player", playerId: player.id }));
    return ok(await act(host, { type: "start" })).state;
  };

  // A previously purchased lineup must be unaffected by reopening another player.
  const first = await open(candidates[0]);
  ok(await act(red, bid(first)));
  ok(await act(host, { type: "lock" }));
  ok(await act(host, { type: "sell" }));
  ok(await act(red, {
    type: "set_lineup", teamId: "rcb", expectedRevision: 0,
    lineup: { playingXI: [candidates[0].id], substitutes: [], captainId: candidates[0].id, viceCaptainId: null },
  }));

  const second = await open(candidates[1]);
  const raised = ok(await act(red, bid(second, 500))).state;
  ok(await act(host, { type: "pause" }));
  const locked = ok(await act(host, { type: "lock" })).state;
  for (const member of [red, blue, spectator]) {
    await rejected(member, { ...unlock(locked), memberId: host.memberId, role: "auctioneer" }, 403, "FORBIDDEN");
  }
  assert.equal((await request(`${pathFor(host)}/action`, { body: { action: unlock(locked) } })).status, 401);
  await rejected(host, { ...unlock(locked), expectedPlayerId: candidates[0].id }, 409, "STALE_PLAYER");
  await rejected(host, { ...unlock(locked), expectedAmount: 525 }, 409, "STALE_BID");
  for (const expectedAmount of [null, "500", -1, 500.5, false]) {
    await rejected(host, { ...unlock(locked), expectedAmount }, 400, "INVALID_UNLOCK_AMOUNT");
  }
  await rejected(host, { ...unlock(locked), expectedPlayerId: undefined }, 409, "STALE_PLAYER");
  for (const expectedLockVersion of [undefined, null, "1", false, -1, 1.5, 0, locked.bidLockVersion + 1]) {
    await rejected(host, { ...unlock(locked), expectedLockVersion }, 409, "STALE_LOCK");
  }
  await rejected(blue, bid(locked, 700), 409, "BIDDING_CLOSED");

  for (const member of [red, blue]) {
    const snapshot = await read(member);
    assert.equal(snapshot.phase, "locked");
    assert.equal(snapshot.version, locked.version);
    assert.equal((await poll(member, locked.version)).unchanged, true);
  }
  const reopened = ok(await act(host, unlock(locked))).state;
  assert.equal(reopened.phase, "live", "a paused-then-locked auction reopens into live bidding");
  assert.equal(reopened.version, locked.version + 1);
  for (const key of ["currentPlayerId", "currentBid", "leadingTeamId", "lastBidAt", "bidHistory", "bidLockVersion", "teams", "players", "settings", "sharedCatalogVersion"]) {
    assert.deepEqual(reopened[key], locked[key], `${key} must not be rewritten by an unlock`);
  }
  assert.equal(reopened.lastBidAt, raised.lastBidAt);
  assert.equal(reopened.activity.at(-1).type, "unlock");
  const persisted = await stored(host);
  assert.equal(persisted.phase, "live");
  assert.deepEqual(persisted.teams, reopened.teams);
  for (const member of [red, blue, spectator]) {
    const refreshed = await poll(member, locked.version);
    assert.equal(refreshed.unchanged, undefined, "unlock invalidates old poll versions for each participant");
    assert.equal(refreshed.state.phase, "live");
    assert.equal(refreshed.state.currentBid, 500);
    assert.equal(refreshed.state.leadingTeamId, "rcb");
    assert.equal(refreshed.state.version, reopened.version);
  }
  await rejected(host, unlock(locked), 409, "BIDDING_NOT_LOCKED");
  await rejected(host, { type: "sell" }, 409, "INVALID_ACTION");
  await rejected(red, bid(reopened, 700), 409, "ALREADY_LEADING");
  const remainingCooldown = reopened.lastBidAt + reopened.settings.bidCooldownMs - Date.now();
  if (remainingCooldown > 0) await new Promise(resolve => setTimeout(resolve, remainingCooldown + 20));
  const afterBid = ok(await act(blue, bid(reopened, 700))).state;
  assert.equal(afterBid.currentBid, 700);
  assert.equal(afterBid.leadingTeamId, "mi");
  assert.equal(afterBid.bidHistory.length, locked.bidHistory.length + 1);

  // Two concurrent host requests must re-check the durable current phase.
  const relocked = ok(await act(host, { type: "lock" })).state;
  assert.notEqual(relocked.bidLockVersion, locked.bidLockVersion);
  await rejected(host, { ...unlock(relocked), expectedLockVersion: locked.bidLockVersion }, 409, "STALE_LOCK");
  const chatted = ok(await act(blue, { type: "chat", text: "The current bidding lock must survive this message." })).state;
  assert.equal(chatted.bidLockVersion, relocked.bidLockVersion);
  const race = await Promise.all([act(host, unlock(relocked)), act(host, { type: "sell" })]);
  assert.equal(race.filter(result => result.status === 200).length, 1, "unlock and sell cannot both win");
  assert.equal(race.filter(result => result.status === 409).length, 1);
  let result = await read(host);
  if (race[0].status === 200) {
    assert.equal(result.phase, "live");
    assert.deepEqual(result.teams, relocked.teams, "the losing sale must not debit a purse");
    ok(await act(host, { type: "lock" }));
    result = ok(await act(host, { type: "sell" })).state;
  } else assert.equal(result.phase, "sold");
  const blueTeam = result.teams.find(team => team.id === "mi");
  assert.equal(blueTeam.purse, relocked.teams.find(team => team.id === "mi").purse - 700);
  assert.deepEqual(blueTeam.squad, [{ playerId: candidates[1].id, amount: 700 }]);
  assert.deepEqual(result.teams.find(team => team.id === "rcb"), locked.teams.find(team => team.id === "rcb"));
  await rejected(host, unlock(relocked), 409, "BIDDING_NOT_LOCKED");
  await rejected(host, { type: "sell" }, 409, "INVALID_ACTION");

  await open(candidates[2]);
  const noBidLock = ok(await act(host, { type: "lock" })).state;
  const noBidOpen = ok(await act(host, unlock(noBidLock))).state;
  assert.equal(noBidOpen.currentBid, 0);
  assert.equal(noBidOpen.leadingTeamId, null);
  assert.equal(noBidOpen.lastBidAt, null);
  assert.deepEqual(noBidOpen.bidHistory, noBidLock.bidHistory);
  assert.deepEqual(noBidOpen.teams, noBidLock.teams);
  const noBidRelocked = ok(await act(host, { type: "lock" })).state;
  assert.equal(noBidRelocked.currentBid, noBidLock.currentBid);
  await rejected(host, unlock(noBidLock), 409, "STALE_LOCK");
  const unsoldRace = await Promise.all([act(host, unlock(noBidRelocked)), act(host, { type: "unsold" })]);
  assert.equal(unsoldRace.filter(response => response.status === 200).length, 1);
  assert.equal(unsoldRace.filter(response => response.status === 409).length, 1);
  if (unsoldRace[0].status === 200) {
    ok(await act(host, { type: "lock" }));
    ok(await act(host, { type: "unsold" }));
  }
  await rejected(host, unlock(noBidRelocked), 409, "BIDDING_NOT_LOCKED");
  await open(candidates[3]);
  const nextLock = ok(await act(host, { type: "lock" })).state;
  assert.equal(nextLock.currentBid, 0);
  await rejected(host, unlock(noBidRelocked), 409, "STALE_LOCK");
  await rejected(host, { ...unlock(nextLock), expectedPlayerId: noBidRelocked.currentPlayerId }, 409, "STALE_PLAYER");
  assert.deepEqual(ok(await request("/api/players/catalog")), catalogBefore, "unlock and auction settlement never rewrite the common catalog");
  console.log("PASS: authenticated unlock, zero-bid and paused locks, stale requests, two-manager poll invalidation, durable state, unchanged lineups, preserved cooldown, and mutually exclusive unlock/settlement races.");
} finally {
  database.close();
}
