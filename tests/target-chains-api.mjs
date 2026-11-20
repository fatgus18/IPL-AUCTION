import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";
import { getActiveTargetIds, getTargetChains } from "../lib/target-chains.ts";
import { currentPrivateBudget, privateBudgetPlan } from "../lib/private-budget-display.ts";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Target chain lifecycle tests must use the isolated API runner.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${process.env.BASE_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return { status: response.status, data: await response.json() };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(ok).then(data => data.state);
const stored = async member => JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [member.state.code] })).rows[0].state_json);
const assertPrivate = (state, expected) => {
  assert.deepEqual(state.myTargetPicks, expected);
  const shared = { ...state };
  delete shared.myTargetPicks;
  assert.doesNotMatch(JSON.stringify(shared), /"(?:privateTargetPicks|backups|maxBids)"/, "private chain data never enters shared snapshots, squads or activity");
};

let host;
try {
  host = ok(await request("/api/rooms", { body: { name: "Backup target lifecycle", hostName: "Chain creator", creationKey: randomBytes(32).toString("hex") } }));
  const password = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword: password } : {}) } }).then(ok);
  const owner = await join("Chain owner", "rcb");
  const rival = await join("Chain rival", "csk");
  const watcher = await join("Chain watcher");
  const players = host.state.players.filter(player => player.status === "available" && !player.catalogArchived && !player.isOverseas && player.eligibilityVerified !== false).slice(0, 5);
  assert.equal(players.length, 5);
  const [lostFirst, lostBackup, wonFirst, wonBackup, standalone] = players;
  const firstChoices = [lostFirst.id, wonFirst.id, standalone.id];
  const backups = { [lostFirst.id]: lostBackup.id, [wonFirst.id]: wonBackup.id };
  const maxBids = { [lostFirst.id]: 1000, [lostBackup.id]: 725, [wonFirst.id]: 900, [wonBackup.id]: 1100, [standalone.id]: 500 };
  let saved = ok(await act(owner, { type: "set_target_picks", teamId: "rcb", playerIds: firstChoices, backups, maxBids, expectedRevision: 0 })).state.myTargetPicks;
  const rivalSaved = ok(await act(rival, { type: "set_target_picks", teamId: "csk", playerIds: [standalone.id], expectedRevision: 0 })).state.myTargetPicks;
  assert.equal(rivalSaved.backups, undefined, "a standalone target has no mandatory backup");
  const privacy = async () => {
    for (const [caller, expected] of [[owner, saved], [rival, rivalSaved], [host, undefined], [watcher, undefined]]) {
      assertPrivate(await read(caller), expected);
      assertPrivate(ok(await request(`${pathFor(caller)}?since=0`, { token: caller.token })).state, expected);
    }
    const persisted = await stored(host);
    assert.deepEqual(persisted.privateTargetPicks[owner.memberId], saved);
    assertPrivate(persisted.state, undefined);
  };
  const active = async (expectedIds, expectedStatuses) => {
    const state = await read(owner);
    assert.deepEqual(state.myTargetPicks, saved, "sales and corrections preserve the manager's saved choices, limits and revision");
    assert.deepEqual(getActiveTargetIds(state.players, state.myTargetPicks), expectedIds);
    if (expectedStatuses) assert.deepEqual(getTargetChains(state.players, state.myTargetPicks).map(chain => chain.status), expectedStatuses);
    return state;
  };
  const purchase = async (player, bidder) => {
    ok(await act(host, { type: "select_player", playerId: player.id }));
    ok(await act(host, { type: "start" }));
    ok(await act(bidder, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice }));
    ok(await act(host, { type: "lock" }));
    assertPrivate(ok(await act(host, { type: "sell" })).state, undefined);
  };
  const correct = async (playerId, teamId) => {
    const state = await read(host);
    const player = state.players.find(entry => entry.id === playerId);
    assertPrivate(ok(await act(host, {
      type: "correct_sale", playerId, expectedTeamId: player.soldTo, expectedAmount: player.soldFor,
      expectedResultsRevision: state.resultsRevision ?? 0, teamId, ...(teamId ? { amount: player.soldFor } : {}),
      reason: "Correcting the receiving team to verify the saved optional backup remains reversible.",
    })).state, undefined);
  };
  await privacy();
  await active(firstChoices, ["first-choice", "first-choice", "first-choice"]);

  // These real sales exercise the same derived helpers used by the live badge,
  // private limit reminder and new-lot notification integration.
  await purchase(lostFirst, rival);
  await active([lostBackup.id, wonFirst.id, standalone.id], ["backup-active", "first-choice", "first-choice"]);
  await purchase(wonFirst, owner);
  let ownerState = await active([lostBackup.id, standalone.id], ["backup-active", "secured", "first-choice"]);
  const purse = ownerState.teams.find(team => team.id === "rcb").purse;
  const plan = privateBudgetPlan(ownerState.players, saved.playerIds, saved.maxBids, purse, saved.backups, saved.teamId);
  assert.equal(plan.planned, 1225, "only the active lost-first backup and standalone target reserve money; an owned first choice secures its whole chain");

  ok(await act(host, { type: "select_player", playerId: lostBackup.id }));
  ownerState = await read(owner);
  assert.equal(currentPrivateBudget(ownerState, owner.memberId)?.limit, 725, "the activated backup uses its own saved limit");
  assert.equal(currentPrivateBudget(await read(rival), rival.memberId), null);
  ok(await act(host, { type: "select_player", playerId: wonBackup.id }));
  assert.equal(currentPrivateBudget(await read(owner), owner.memberId), null, "the secured chain's backup is not a current target");

  await correct(wonFirst.id, "csk");
  ownerState = await active([lostBackup.id, wonBackup.id, standalone.id], ["backup-active", "backup-active", "first-choice"]);
  assert.equal(currentPrivateBudget(ownerState, owner.memberId)?.limit, 1100, "correcting an own purchase to a rival restores the backup's current-lot limit");
  await correct(lostFirst.id, "rcb");
  await active([wonBackup.id, standalone.id], ["secured", "backup-active", "first-choice"]);
  await correct(lostFirst.id, null);
  await active([lostFirst.id, wonBackup.id, standalone.id], ["first-choice", "backup-active", "first-choice"]);
  await correct(wonFirst.id, null);
  await active(firstChoices, ["first-choice", "first-choice", "first-choice"]);

  ok(await act(host, { type: "select_player", playerId: lostFirst.id }));
  ok(await act(host, { type: "start" }));
  ok(await act(host, { type: "lock" }));
  ok(await act(host, { type: "unsold" }));
  ownerState = await active(firstChoices, ["first-choice", "first-choice", "first-choice"]);
  assert.equal(ownerState.phase, "unsold");
  assert.equal(currentPrivateBudget(ownerState, owner.memberId), null, "a settled unsold lot has no live budget reminder");
  ok(await act(host, { type: "select_player", playerId: lostBackup.id }));
  assert.equal(currentPrivateBudget(await read(owner), owner.memberId), null, "an unsold first choice still keeps its backup on standby");

  const oldRevision = saved.revision;
  saved = ok(await act(owner, { type: "set_target_picks", teamId: "rcb", playerIds: firstChoices, expectedRevision: oldRevision })).state.myTargetPicks;
  assert.deepEqual(saved.backups, backups, "a legacy client preserves the reversible pairs after sales and corrections");
  assert.deepEqual(saved.maxBids, maxBids);
  const stale = await act(owner, { type: "set_target_picks", teamId: "rcb", playerIds: firstChoices, backups: {}, expectedRevision: oldRevision });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, "TARGET_PICKS_CONFLICT");
  await privacy();
  console.log("PASS: private optional backups activate after rival sales, stay dormant after own sales or unsold lots, reverse correctly after creator corrections, retain limits/revisions and remain private to their manager.");
} finally {
  if (host) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }).then(ok);
  database.close();
}
