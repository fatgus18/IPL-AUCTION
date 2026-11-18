import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated API runner; never modify the user's rooms for target tests.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const request = async (path, { token, body, origin } = {}) => {
  const response = await fetch(`${process.env.BASE_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return { status: response.status, data: await response.json() };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(ok).then(data => data.state);
const save = (playerIds, expectedRevision = 0, teamId = "rcb") => ({ type: "set_target_picks", teamId, playerIds, expectedRevision });
const stored = async member => JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [member.state.code] })).rows[0].state_json);
const sharedState = state => {
  const shared = { ...state };
  delete shared.myTargetPicks; delete shared.version; delete shared.serverTime;
  return shared;
};
const assertPrivate = (state, expected) => {
  assert.equal(Object.hasOwn(state, "privateTargetPicks"), false);
  assert.equal(Object.hasOwn(state, "tokenHashes"), false);
  assert.deepEqual(state.myTargetPicks, expected);
  assert.equal(state.activity.some(entry => /target.?pick/i.test(entry.type)), false, "no public target-selection events");
  assert.ok(state.teams.every(team => !Object.hasOwn(team, "targetPicks")), "no target data on public teams");
};

try {
  const creation = { name: "Private targets", hostName: "Creator", creationKey: randomBytes(32).toString("hex") };
  const host = ok(await request("/api/rooms", { body: creation }));
  const password = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword: password } : {}) } }).then(ok);
  const owner = await join("RCB manager", "rcb");
  const rival = await join("CSK manager", "csk");
  const spectator = await join("Viewer");
  const empty = { teamId: "rcb", playerIds: [], revision: 0 };
  assertPrivate(owner.state, empty);
  assertPrivate(rival.state, { ...empty, teamId: "csk" });
  assertPrivate(host.state, undefined);
  assertPrivate(spectator.state, undefined);
  const ids = host.state.players.filter(player => !player.catalogArchived).map(player => player.id);
  const beforeUnauthorized = await stored(host);
  assert.equal((await request(`${pathFor(host)}/action`, { body: { action: save(ids.slice(0, 5)) } })).status, 401);
  for (const caller of [host, rival, spectator]) {
    const denied = await act(caller, save(ids.slice(0, 5)));
    assert.equal(denied.status, 403); assert.equal(denied.data.code, "FORBIDDEN");
  }
  assert.equal((await request(`${pathFor(host)}/action`, { token: spectator.token, body: { action: save([]), memberId: owner.memberId } })).status, 403);
  assert.equal((await request(`${pathFor(host)}/action`, { token: owner.token, body: { action: save([]) }, origin: "https://foreign.example" })).status, 403);
  assert.deepEqual(await stored(host), beforeUnauthorized);

  let current = empty;
  for (const count of [5, 9, 12, ids.length]) {
    const before = (await stored(host)).state;
    const response = ok(await act(owner, save(ids.slice(0, count), current.revision))).state;
    current = { teamId: "rcb", playerIds: ids.slice(0, count), revision: current.revision + 1 };
    assertPrivate(response, current);
    assert.equal(response.version, before.version + 1);
    assert.deepEqual(sharedState(response), sharedState(before), "private saves do not change finances, lot, lineup, members or history");
    const persisted = await stored(host);
    assert.deepEqual(persisted.privateTargetPicks[owner.memberId], current);
    assert.equal(Object.hasOwn(persisted.state, "myTargetPicks"), false, "caller-specific projection never enters stored shared state");
  }
  current = ok(await act(owner, save(ids.slice(0, 12), current.revision))).state.myTargetPicks;
  const rivalPicks = ok(await act(rival, save(ids.slice(10, 14), 0, "csk"))).state.myTargetPicks;
  for (const [caller, expected] of [[owner, current], [rival, rivalPicks], [host, undefined], [spectator, undefined]]) {
    const fresh = await read(caller);
    assertPrivate(fresh, expected);
    assertPrivate(ok(await request(`${pathFor(caller)}?since=0`, { token: caller.token })).state, expected);
    const poll = ok(await request(`${pathFor(caller)}?since=${fresh.version}`, { token: caller.token }));
    assert.equal(poll.unchanged, true);
    assert.equal(Object.hasOwn(poll, "state"), false);
    assert.equal(Object.hasOwn(poll, "myTargetPicks"), false, "unchanged poll cache holds no private payload");
  }
  assertPrivate(ok(await request("/api/rooms", { body: creation })).state, undefined, "creator retries cannot disclose lists");
  assertPrivate((await join("Late spectator")).state, undefined);
  assertPrivate((await join("Late GT manager", "gt")).state, { teamId: "gt", playerIds: [], revision: 0 });
  assertPrivate(ok(await act(host, { type: "update_settings", settings: { bidCooldownMs: 1000 } })).state, undefined);
  assertPrivate(ok(await act(owner, { type: "chat", text: "Ready for the auction" })).state, current);
  assertPrivate(ok(await act(rival, { type: "chat", text: "Good luck" })).state, rivalPicks);

  const beforeMalformed = await stored(host);
  for (const invalid of [null, {}, "wrong", [null], [false], [""], [ids[0], ids[0]]]) assert.equal((await act(owner, { ...save([], current.revision), playerIds: invalid })).status, 400);
  for (const invalid of [-1, 0.5, "5", null, Number.MAX_SAFE_INTEGER]) assert.equal((await act(owner, { ...save([], current.revision), expectedRevision: invalid })).status, 400);
  const stale = await act(owner, save([], current.revision - 1));
  assert.equal(stale.status, 409); assert.equal(stale.data.code, "TARGET_PICKS_CONFLICT");
  assert.deepEqual(await stored(host), beforeMalformed);

  const racing = await Promise.all([ids.slice(0, 4), ids.slice(0, 7)].map(selection => act(owner, save(selection, current.revision))));
  assert.equal(racing.filter(result => result.status === 200).length, 1);
  assert.equal(racing.filter(result => result.status === 409 && result.data.code === "TARGET_PICKS_CONFLICT").length, 1);
  current = racing.find(result => result.status === 200).data.state.myTargetPicks;
  assert.deepEqual((await read(owner)).myTargetPicks, current);

  const candidate = host.state.players.find(player => current.playerIds.includes(player.id) && player.eligibilityVerified !== false);
  assert.ok(candidate);
  ok(await act(host, { type: "select_player", playerId: candidate.id }));
  for (const action of [{ type: "start" }, { type: "pause" }, { type: "resume" }]) {
    ok(await act(host, action));
    current = ok(await act(owner, save(current.playerIds, current.revision))).state.myTargetPicks;
  }
  const [bid, targetSave] = await Promise.all([
    act(owner, { type: "bid", expectedPlayerId: candidate.id, expectedAmount: candidate.basePrice }),
    act(owner, save(current.playerIds, current.revision)),
  ]);
  ok(bid); current = ok(targetSave).state.myTargetPicks;
  const bidState = await read(owner);
  assert.equal(bidState.currentBid, candidate.basePrice);
  assert.deepEqual(bidState.myTargetPicks, current, "bid and private target write both survive the room compare-and-swap race");
  ok(await act(host, { type: "lock" }));
  current = ok(await act(owner, save(current.playerIds, current.revision))).state.myTargetPicks;
  assertPrivate(ok(await act(host, { type: "sell" })).state, undefined);
  current = ok(await act(owner, save(current.playerIds, current.revision))).state.myTargetPicks;
  assert.ok(current.playerIds.includes(candidate.id), "saved targets stay visible after a sale");
  current = ok(await act(owner, save(current.playerIds.filter(id => id !== candidate.id), current.revision))).state.myTargetPicks;
  const retargetSold = await act(owner, save([...current.playerIds, candidate.id], current.revision));
  assert.equal(retargetSold.status, 409); assert.equal(retargetSold.data.code, "TARGET_UNAVAILABLE");

  // Earlier suites may have purchased any seeded player in another room. Use a
  // unique catalog entry whose only reference is this manager's private list.
  const fixtureSuffix = randomBytes(8).toString("hex");
  const removedId = `target-deletion-${fixtureSuffix}`;
  const deletionFixture = {
    id: removedId, name: `Target deletion ${fixtureSuffix}`, country: "India", role: "Batter",
    basePrice: 50, isOverseas: false, stats: { matches: null, runs: null, wickets: null, strikeRate: null },
    dataStatus: "manual", eligibilityVerified: true,
  };
  assertPrivate(ok(await act(host, { type: "add_player", player: deletionFixture })).state, undefined);
  const afterAddition = await read(owner);
  assert.deepEqual(afterAddition.myTargetPicks, current, "catalog additions preserve private selections and their revision");
  current = ok(await act(owner, save([...afterAddition.myTargetPicks.playerIds, removedId], afterAddition.myTargetPicks.revision))).state.myTargetPicks;
  assertPrivate(ok(await act(host, { type: "delete_player", playerId: removedId })).state, undefined);
  assert.ok(!(await read(owner)).players.some(player => player.id === removedId));
  current = ok(await act(owner, save(current.playerIds, current.revision))).state.myTargetPicks;
  assert.ok(current.playerIds.includes(removedId), "deleted catalog entries remain removable target records");
  current = ok(await act(owner, save(current.playerIds.filter(id => id !== removedId), current.revision))).state.myTargetPicks;
  assert.equal((await act(owner, save([...current.playerIds, removedId], current.revision))).data.code, "TARGET_UNAVAILABLE");

  assertPrivate(ok(await act(owner, { type: "claim_team", teamId: "mi", teamPassword: password })).state, { teamId: "mi", playerIds: [], revision: 0 });
  assert.equal((await stored(host)).privateTargetPicks[owner.memberId], undefined);
  const replacement = await join("New RCB manager", "rcb");
  assertPrivate(replacement.state, empty, "replacement manager never inherits predecessor's research");
  const replacementTargets = ok(await act(replacement, save(ids.filter(id => id !== candidate.id && id !== removedId).slice(0, 3)))).state.myTargetPicks;
  assert.equal(replacementTargets.revision, 1);
  assertPrivate(ok(await act(replacement, { type: "claim_team", teamId: null })).state, undefined);
  assert.equal((await stored(host)).privateTargetPicks[replacement.memberId], undefined);
  assertPrivate(ok(await act(replacement, { type: "claim_team", teamId: "rcb", teamPassword: password })).state, empty);
  ok(await act(replacement, save(ids.filter(id => id !== candidate.id && id !== removedId).slice(0, 3))));
  assertPrivate(ok(await act(replacement, { type: "leave" })).state, undefined);
  assert.equal((await stored(host)).privateTargetPicks[replacement.memberId], undefined);
  assert.equal((await request(pathFor(replacement), { token: replacement.token })).status, 401);

  // Practice's creator can impersonate a bidder for historical bidding controls,
  // but that must never let the creator save private targets as that person.
  const practice = ok(await request("/api/practice", { body: {} }));
  const practiceBidder = practice.state.members.find(member => member.role === "bidder");
  const deniedPractice = await request(`${pathFor(practice)}/action`, { token: practice.token, body: { memberId: practiceBidder.id, action: save([], 0, practiceBidder.teamId) } });
  assert.equal(deniedPractice.status, 403);
  assertPrivate(ok(await request(`${pathFor(practice)}/action`, { token: practice.token, body: { resetPractice: true } })).state, undefined);
  assert.deepEqual((await stored(practice)).privateTargetPicks, {});
  console.log("PASS: private target lists persist, grow throughout every auction phase, protect concurrent revisions, never leak through room responses/polls, and reset on team transfer or departure.");
} finally { database.close(); }
