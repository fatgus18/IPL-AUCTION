import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";
import ExcelJS from "exceljs";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Private budget tests must use the isolated runner.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const request = async (path, { token, body, origin } = {}) => {
  const response = await fetch(`${process.env.BASE_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return { status: response.status, data: await response.json(), headers: response.headers };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(ok).then(data => data.state);
const save = (playerIds, expectedRevision, maxBids, teamId = "rcb", backups) => ({ type: "set_target_picks", teamId, playerIds, expectedRevision, ...(maxBids === undefined ? {} : { maxBids }), ...(backups === undefined ? {} : { backups }) });
const stored = async member => JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [member.state.code] })).rows[0].state_json);
const publicState = state => {
  const result = { ...state };
  delete result.myTargetPicks; delete result.version; delete result.serverTime;
  return result;
};
const assertPrivate = (state, expected) => {
  assert.deepEqual(state.myTargetPicks, expected);
  assert.equal(Object.hasOwn(state, "privateTargetPicks"), false);
  assert.equal(JSON.stringify(publicState(state)).includes('"maxBids"'), false, "no private budget fields in the shared room projection");
  assert.equal(JSON.stringify(publicState(state)).includes('"backups"'), false, "no private backup pairings in the shared room projection");
};

let host;
try {
  const creation = { name: "Private budget verification", hostName: "Budget creator", creationKey: randomBytes(32).toString("hex") };
  host = ok(await request("/api/rooms", { body: creation }));
  const password = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword: password } : {}) } }).then(ok);
  const owner = await join("Budget owner", "rcb");
  const rival = await join("Separate session", "csk");
  const spectator = await join("Budget spectator");
  const players = host.state.players.filter(player => !player.catalogArchived && player.eligibilityVerified !== false).slice(0, 4);
  const ids = players.slice(0, 3).map(player => player.id);
  const backupId = players[3].id;
  const backups = { [ids[2]]: backupId };
  const budgetMap = { [ids[0]]: 1, [ids[1]]: 98761, [backupId]: 98671 };
  const before = (await stored(host)).state;
  let current = ok(await act(owner, save(ids, 0, budgetMap, "rcb", backups))).state.myTargetPicks;
  assert.deepEqual(current.maxBids, budgetMap);
  assert.deepEqual(current.backups, backups);
  assert.deepEqual(publicState((await stored(host)).state), publicState(before), "budget editing does not mutate bids, purses, history, lineups or public audit");
  assert.deepEqual((await stored(host)).privateTargetPicks[owner.memberId], current);
  assert.equal(Object.hasOwn((await stored(host)).state, "myTargetPicks"), false);
  for (const [caller, expected] of [[owner, current], [rival, { teamId: "csk", playerIds: [], revision: 0 }], [host, undefined], [spectator, undefined]]) {
    const response = await request(pathFor(caller), { token: caller.token });
    assert.match(response.headers.get("cache-control"), /no-store/);
    assertPrivate(ok(response).state, expected);
    assertPrivate(ok(await request(`${pathFor(caller)}?since=0`, { token: caller.token })).state, expected);
    const poll = ok(await request(`${pathFor(caller)}?since=${response.data.state.version}`, { token: caller.token }));
    assert.equal(poll.unchanged, true);
    assert.equal(Object.hasOwn(poll, "state"), false);
    assert.equal(JSON.stringify(poll).includes("maxBids"), false);
    assert.equal(JSON.stringify(poll).includes("backups"), false);
  }
  assertPrivate(ok(await request("/api/rooms", { body: creation })).state, undefined);
  assertPrivate((await join("Late viewer")).state, undefined);
  // Re-opening the same session has no local-storage dependency; another manager
  // and every new session only receive their own separately projected plan.
  assert.deepEqual((await read({ ...owner })).myTargetPicks, current);
  assert.equal(JSON.stringify(ok(await request("/api/players/catalog"))).includes("maxBids"), false);
  assert.equal(JSON.stringify(ok(await request("/api/players/catalog"))).includes('"backups"'), false);

  const beforeDenied = await stored(host);
  assert.equal((await request(`${pathFor(owner)}/action`, { body: { action: save(ids, current.revision, {}) } })).status, 401);
  for (const caller of [host, rival, spectator]) assert.equal((await act(caller, save(ids, current.revision, {}))).status, 403);
  assert.equal((await request(`${pathFor(owner)}/action`, { token: spectator.token, body: { action: save(ids, current.revision, {}), memberId: owner.memberId } })).status, 403);
  assert.equal((await request(`${pathFor(owner)}/action`, { token: owner.token, body: { action: save(ids, current.revision, {}) }, origin: "https://not-this-room.example" })).status, 403);
  for (const maxBids of [null, false, 1, "500", [], { unrelated: 500 }, JSON.parse('{"__proto__":500}'), JSON.parse('{"constructor":500}'), JSON.parse('{"prototype":500}')]) {
    const response = await act(owner, save(ids, current.revision, maxBids));
    assert.equal(response.status, 400); assert.equal(response.data.code, "INVALID_TARGET_BUDGET");
  }
  for (const amount of [0, -1, 1.5, 100001, "500", false, null, { polluted: true }]) {
    const response = await act(owner, save(ids, current.revision, { [ids[0]]: amount }));
    assert.equal(response.status, 400); assert.equal(response.data.code, "INVALID_TARGET_BUDGET");
  }
  for (const invalidBackups of [null, false, "wrong", [], { [ids[0]]: ids[0] }, { [ids[0]]: ids[1], [ids[1]]: ids[0] }, { [ids[0]]: backupId, [ids[1]]: backupId }, { [ids[0]]: [backupId] }, { unrelated: backupId }, JSON.parse(`{"__proto__":"${backupId}"}`)]) {
    const response = await act(owner, save(ids, current.revision, undefined, "rcb", invalidBackups));
    assert.equal(response.status, 400); assert.equal(response.data.code, "INVALID_TARGET_BACKUP");
  }
  for (const caller of [host, rival, spectator]) {
    const denied = await act(caller, save(ids, current.revision, budgetMap, "rcb", backups));
    assert.equal(denied.status, 403); assert.equal(denied.data.code, "FORBIDDEN");
  }
  assert.deepEqual(await stored(host), beforeDenied);

  const races = await Promise.all([650, 850].map(limit => act(owner, save(ids, current.revision, { [ids[0]]: limit, [ids[1]]: 98761 }))));
  assert.equal(races.filter(result => result.status === 200).length, 1);
  assert.equal(races.filter(result => result.status === 409 && result.data.code === "TARGET_PICKS_CONFLICT").length, 1);
  current = races.find(result => result.status === 200).data.state.myTargetPicks;
  assert.deepEqual((await read(owner)).myTargetPicks, current);
  current = ok(await act(owner, save(ids, current.revision))).state.myTargetPicks;
  assert.equal(current.maxBids[ids[1]], 98761, "old list-only save keeps all surviving limits");
  assert.equal(current.maxBids[backupId], 98671, "deployed clients submitting first-choice budgets preserve unseen backup limits");
  assert.deepEqual(current.backups, backups, "old list-only save preserves the optional backup");
  const staleBackup = await act(owner, save(ids, current.revision - 1, undefined, "rcb", {}));
  assert.equal(staleBackup.status, 409); assert.equal(staleBackup.data.code, "TARGET_PICKS_CONFLICT");
  current = ok(await act(owner, save([ids[0], ids[2]], current.revision))).state.myTargetPicks;
  assert.equal(Object.hasOwn(current.maxBids, ids[1]), false, "removed player's budget is pruned");
  current = ok(await act(owner, save(ids, current.revision, {}, "rcb", backups))).state.myTargetPicks;
  assert.equal(Object.hasOwn(current, "maxBids"), false, "explicit empty map clears every limit");
  current = ok(await act(owner, save(ids, current.revision, { [ids[0]]: 1, [ids[2]]: 98761 }))).state.myTargetPicks;

  ok(await act(host, { type: "select_player", playerId: ids[0] }));
  ok(await act(host, { type: "start" }));
  const [bid, plan] = await Promise.all([
    act(owner, { type: "bid", expectedPlayerId: ids[0], expectedAmount: players[0].basePrice }),
    act(owner, save(ids, current.revision, { [ids[0]]: 1, [ids[2]]: 98371 })),
  ]);
  ok(bid); current = ok(plan).state.myTargetPicks;
  const afterRace = await read(owner);
  assert.equal(afterRace.currentBid, players[0].basePrice, "budget is a private warning, not a prohibition on actual bidding");
  assert.deepEqual(afterRace.myTargetPicks, current, "budget write and competing bid both persist");
  ok(await act(host, { type: "lock" })); ok(await act(host, { type: "sell" }));
  assert.deepEqual((await read(owner)).myTargetPicks, current, "budget remains readable after its player is sold");

  assertPrivate(ok(await act(owner, { type: "claim_team", teamId: "mi", teamPassword: password })).state, { teamId: "mi", playerIds: [], revision: 0 });
  assert.equal((await stored(host)).privateTargetPicks[owner.memberId], undefined);
  const replacement = await join("Replacement RCB owner", "rcb");
  assertPrivate(replacement.state, { teamId: "rcb", playerIds: [], revision: 0 });
  ok(await act(replacement, save([ids[2]], 0, { [ids[2]]: 98371 })));
  ok(await act(replacement, { type: "leave" }));
  assert.equal((await stored(host)).privateTargetPicks[replacement.memberId], undefined);
  assert.equal((await request(pathFor(replacement), { token: replacement.token })).status, 401);
  const finalist = await join("Final RCB owner", "rcb");
  current = ok(await act(finalist, save([ids[2]], 0, { [ids[2]]: 98371, [backupId]: 98971 }, "rcb", backups))).state.myTargetPicks;
  const finalState = await read(host);
  ok(await act(host, { type: "end_auction", expectedResultsRevision: finalState.resultsRevision ?? 0 }));
  const blocked = await act(finalist, save([ids[2]], current.revision, {}));
  assert.equal(blocked.status, 409); assert.equal(blocked.data.code, "AUCTION_ENDED");
  assert.deepEqual((await read(finalist)).myTargetPicks, current);
  const download = await fetch(`${process.env.BASE_URL}${pathFor(finalist)}/export?format=xlsx`, { headers: { Authorization: `Bearer ${finalist.token}` }, signal: AbortSignal.timeout(20000) });
  assert.equal(download.status, 200);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await download.arrayBuffer()));
  const values = [];
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(cell.value))));
  assert.equal(values.includes(98371), false, "private limits never enter a downloadable recap, even for their owner");
  assert.equal(values.includes(98971), false, "private backup limits never enter a downloadable recap");
  assert.equal(JSON.stringify(values).includes("maxBids"), false);
  assert.equal(JSON.stringify(values).includes("backups"), false);
  assert.equal(values.includes(players[2].name), false, "unbought target players are not exported as research");
  assert.equal(values.includes(players[3].name), false, "standby backup players are not exported as research");
  assert.equal(JSON.stringify((await stored(host)).state).includes('"maxBids"'), false);
  assert.equal(JSON.stringify((await stored(host)).state).includes('"backups"'), false);
  console.log("PASS: private budgets and optional backups persist independently, preserve old clients, reject malformed/prototype edits, survive concurrent bidding, clear on ownership changes and never leak to other sessions or recap exports.");
} finally {
  if (host) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }).then(ok);
  database.close();
}
