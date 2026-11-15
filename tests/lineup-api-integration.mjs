import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run lineup API checks with the isolated API runner, never the user's rooms.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const request = async (path, { token, body, origin } = {}) => {
  const response = await fetch(`${process.env.BASE_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return { status: response.status, data: await response.json() };
};
const ok = response => { assert.ok(response.status >= 200 && response.status < 300, `${response.status}: ${response.data.error}`); return response.data; };
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(ok).then(value => value.state);
const team = state => state.teams.find(entry => entry.id === "rcb");
const empty = () => ({ playingXI: [], substitutes: [], captainId: null, viceCaptainId: null });
const save = (lineup, expectedRevision = 0) => ({ type: "set_lineup", teamId: "rcb", lineup, expectedRevision });
const stored = async member => JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [member.state.code] })).rows[0].state_json).state;
const financials = state => ({
  players: state.players, teams: state.teams.map(value => ({ ...value, lineup: undefined })),
  currentPlayerId: state.currentPlayerId, phase: state.phase, currentBid: state.currentBid,
  leadingTeamId: state.leadingTeamId, lastBidAt: state.lastBidAt, bidHistory: state.bidHistory, settings: state.settings,
});

try {
  const host = ok(await request("/api/rooms", { body: { name: "Persistent lineup check", hostName: "Lineup creator" } }));
  const password = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword: password } : {}) } }).then(ok);
  const owner = await join("RCB manager", "rcb");
  const opponent = await join("MI manager", "mi");
  const spectator = await join("Spectator");
  const action = save(empty());
  const beforeUnauthorized = await stored(host);
  assert.equal((await request(`${pathFor(host)}/action`, { body: { action } })).status, 401);
  for (const member of [host, opponent, spectator]) {
    const denied = await act(member, action);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code, "FORBIDDEN");
  }
  assert.equal((await request(`${pathFor(host)}/action`, { token: spectator.token, body: { action, memberId: owner.memberId } })).status, 403, "a spectator cannot impersonate a manager through practice-only request options");
  assert.equal((await request(`${pathFor(host)}/action`, { token: owner.token, body: { action }, origin: "https://foreign.example" })).status, 403);
  assert.deepEqual(await stored(host), beforeUnauthorized);
  assert.equal(team(ok(await act(owner, action)).state).lineup.revision, 1, "legacy teams need no database migration to save their first draft");

  const candidates = host.state.players.filter(player => player.status === "available" && player.eligibilityVerified !== false && !player.isOverseas).slice(0, 17);
  assert.equal(candidates.length, 17);
  const buy = async player => {
    ok(await act(host, { type: "select_player", playerId: player.id }));
    ok(await act(host, { type: "start" }));
    ok(await act(owner, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice }));
    ok(await act(host, { type: "lock" }));
    return ok(await act(host, { type: "sell" })).state;
  };
  await buy(candidates[0]);
  await buy(candidates[1]);
  const partial = { ...empty(), playingXI: candidates.slice(0, 2).map(player => player.id), captainId: candidates[0].id, viceCaptainId: candidates[1].id };
  const partialSaved = ok(await act(owner, save(partial, 1))).state;
  let afterPurchases = partialSaved;
  for (const candidate of candidates.slice(2)) afterPurchases = await buy(candidate);
  assert.deepEqual(team(afterPurchases).lineup, { ...partial, revision: 2 }, "new sales preserve a manager's saved formation and leadership");
  assert.equal(team(afterPurchases).squad.length, 17);

  const allIds = candidates.map(player => player.id);
  const complete = { playingXI: allIds.slice(0, 11), substitutes: allIds.slice(11, 16), captainId: allIds[0], viceCaptainId: allIds[1] };
  const beforeMalformed = await stored(host);
  for (const invalidLineup of [
    null, [], {}, { ...empty(), playingXI: "incorrect" },
    { ...empty(), playingXI: allIds.slice(0, 12) },
    { ...empty(), substitutes: allIds.slice(0, 6) },
    { ...empty(), playingXI: [allIds[0], allIds[0]] },
    { ...empty(), playingXI: [allIds[0]], substitutes: [allIds[0]] },
    { ...complete, captainId: allIds[11] },
    { ...complete, viceCaptainId: allIds[0] },
    { ...empty(), playingXI: ["unknown-player"] },
    { ...empty(), substitutes: [host.state.players.find(player => !allIds.includes(player.id)).id] },
  ]) assert.equal((await act(owner, save(invalidLineup, 2))).status, 400);
  assert.equal((await act(owner, { ...save(complete, 2), expectedRevision: "2" })).status, 400);
  const stale = await act(owner, save(complete, 1));
  assert.equal(stale.status, 409); assert.equal(stale.data.code, "LINEUP_CONFLICT");
  assert.deepEqual(await stored(host), beforeMalformed, "invalid and stale drafts cannot mutate persistent state");

  const saved = ok(await act(owner, save(complete, 2))).state;
  assert.deepEqual(team(saved).lineup, { ...complete, revision: 3 });
  assert.deepEqual(financials(saved), financials(afterPurchases), "lineup editing cannot change sales, purse or bidding");
  const persisted = await stored(host);
  assert.deepEqual(team(persisted).lineup, { ...complete, revision: 3 }, "formation and leadership are durably stored, not browser-only");
  for (const member of [owner, host, opponent, spectator]) {
    assert.deepEqual(team(await read(member)).lineup, { ...complete, revision: 3 }, "fresh authenticated GETs see the same lineup");
  }
  const poll = await request(`${pathFor(owner)}?since=${afterPurchases.version}`, { token: owner.token });
  assert.equal(poll.status, 200);
  assert.deepEqual(team(poll.data.state).lineup, { ...complete, revision: 3 }, "existing room polling distributes lineup updates");

  const variants = [
    { ...complete, captainId: allIds[2] },
    { ...complete, captainId: allIds[3] },
  ];
  const racing = await Promise.all(variants.map(lineup => act(owner, save(lineup, 3))));
  assert.equal(racing.filter(result => result.status === 200).length, 1);
  assert.equal(racing.filter(result => result.status === 409 && result.data.code === "LINEUP_CONFLICT").length, 1);
  const winningLineup = team(racing.find(result => result.status === 200).data.state).lineup;
  assert.equal(winningLineup.revision, 4);
  assert.deepEqual(team(await stored(host)).lineup, winningLineup, "two tabs cannot overwrite each other with the same draft revision");

  ok(await act(owner, { type: "claim_team", teamId: null }));
  assert.equal((await act(owner, save(complete, 4))).status, 403, "giving up a team revokes lineup-editing rights");
  const replacement = await join("Replacement manager", "rcb");
  assert.deepEqual(team(replacement.state).lineup, winningLineup, "the lineup belongs to the franchise and survives manager replacement");
  const final = ok(await act(replacement, save(complete, 4))).state;
  assert.equal(team(final).lineup.revision, 5);
  assert.deepEqual(financials(final), financials(afterPurchases));
  console.log("PASS: owned XI plus five substitutes and C/VC persist across purchases and fresh sessions; ownership, malformed drafts and concurrent tab conflicts are enforced by the API.");
} finally {
  database.close();
}
