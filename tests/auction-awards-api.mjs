import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { getAuctionAwards } from "../lib/auction-awards.ts";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Awards checks only use disposable isolated rooms.");
assert.match(process.env.DATABASE_URL || "", /^file:/);
const database = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${process.env.BASE_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, data: await response.json() };
};
const ok = result => { assert.ok(result.status >= 200 && result.status < 300, `${result.status}: ${result.data.error}`); return result.data; };
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(ok).then(data => data.state);
const stored = async member => JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [member.state.code] })).rows[0].state_json);
const award = (state, id) => getAuctionAwards(state).awards.find(entry => entry.id === id);
const rooms = [];
const create = async name => { const host = ok(await request("/api/rooms", { body: { name, hostName: "Awards creator" } })); rooms.push(host); return host; };
const bidCommand = (state, customAmount) => ({ type: "bid", expectedPlayerId: state.currentPlayerId, expectedAmount: state.leadingTeamId ? state.currentBid + state.settings.bidIncrement : state.players.find(player => player.id === state.currentPlayerId).basePrice, ...(customAmount === undefined ? {} : { customAmount }) });
const waitForBid = async state => { const delay = (state.lastBidAt ?? 0) + state.settings.bidCooldownMs - Date.now() + 20; if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay)); };
const correct = (state, playerId, changes) => {
  const player = state.players.find(entry => entry.id === playerId);
  return { type: "correct_sale", playerId, expectedTeamId: player.soldTo, expectedAmount: player.soldFor, expectedResultsRevision: state.resultsRevision ?? 0, reason: "Awards integration correction", ...changes };
};

try {
  const host = await create("Awards and concurrent bidding");
  const password = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword: password } : {}) } }).then(ok);
  const red = await join("Awards red", "rcb"), blue = await join("Awards blue", "mi"), viewer = await join("Awards viewer");
  const players = host.state.players.filter(player => !player.isOverseas && player.eligibilityVerified !== false && !player.catalogArchived).slice(0, 3);
  ok(await act(red, { type: "set_target_picks", teamId: "rcb", playerIds: [players[2].id], expectedRevision: 0, maxBids: { [players[2].id]: 98371 } }));
  let state = ok(await act(host, { type: "select_player", playerId: players[0].id })).state;
  state = ok(await act(host, { type: "start" })).state;
  assert.deepEqual(getAuctionAwards(state).awards, []);
  const racing = await Promise.all([red, blue].map(member => act(member, bidCommand(state, 500))));
  assert.equal(racing.filter(result => result.status === 200).length, 1);
  assert.equal(racing.filter(result => result.status === 409).length, 1);
  state = await read(host);
  assert.equal(state.awardLedger.players[players[0].id].bids, 1, "only the committed race winner counts");
  assert.equal(state.bidHistory.length, 1);
  const initialLeader = state.leadingTeamId === "rcb" ? red : blue;
  const challenger = initialLeader === red ? blue : red;
  const ledgerBeforeRejected = structuredClone(state.awardLedger);
  assert.equal((await act(initialLeader, bidCommand(state))).data.code, "ALREADY_LEADING");
  assert.equal((await act(challenger, { ...bidCommand(state), expectedAmount: 1 })).data.code, "STALE_BID");
  assert.deepEqual((await read(host)).awardLedger, ledgerBeforeRejected);
  await waitForBid(state);
  const [raised, chatted] = await Promise.all([
    act(challenger, bidCommand(state, 700)), act(host, { type: "chat", text: "A closely contested opening lot" }),
  ]);
  ok(raised); ok(chatted); state = await read(host);
  assert.equal(state.awardLedger.players[players[0].id].bids, 2, "an unrelated CAS write cannot lose or duplicate a bid count");
  state = ok(await act(host, { type: "lock" })).state;
  assert.equal((await act(initialLeader, bidCommand(state))).data.code, "BIDDING_CLOSED");
  state = ok(await act(host, { type: "unlock", expectedPlayerId: players[0].id, expectedAmount: state.currentBid, expectedLockVersion: state.bidLockVersion })).state;
  await waitForBid(state);
  state = ok(await act(initialLeader, bidCommand(state, 725))).state;
  ok(await act(host, { type: "lock" })); state = ok(await act(host, { type: "sell" })).state;
  assert.equal(state.awardLedger.players[players[0].id].bids, 3);
  const cancelled = correct(state, players[0].id, { teamId: null });
  state = ok(await act(host, cancelled)).state;
  assert.equal(state.awardLedger.players[players[0].id].bids, 3, "cancelling a result preserves factual historical bidding");
  for (const player of players.slice(0, 2)) {
    ok(await act(host, { type: "select_player", playerId: player.id }));
    state = ok(await act(host, { type: "start" })).state;
    state = ok(await act(red, bidCommand(state, 700))).state;
    await waitForBid(state);
    state = ok(await act(blue, bidCommand(state, 725))).state;
    ok(await act(host, { type: "lock" })); state = ok(await act(host, { type: "sell" })).state;
  }
  assert.equal(state.awardLedger.players[players[0].id].bids, 5);
  assert.equal(state.awardLedger.players[players[1].id].bids, 2);
  assert.deepEqual((await stored(host)).state.awardLedger, state.awardLedger, "aggregate is durable room data");
  assert.deepEqual(getAuctionAwards(state).awards, []);
  state = ok(await act(host, { type: "end_auction", expectedResultsRevision: state.resultsRevision ?? 0 })).state;
  assert.equal(award(state, "headline").winners.length, 2);
  assert.equal(award(state, "battle").metric, "5 bids");
  assert.equal(award(state, "rivals").metric, "2 shared contests");
  assert.equal(award(state, "purse").winners.length, 0);
  const canonicalAwards = getAuctionAwards(state), canonicalLedger = structuredClone(state.awardLedger);
  for (const caller of [host, red, blue, viewer]) {
    const ownState = await read(caller);
    assert.deepEqual(getAuctionAwards(ownState), canonicalAwards);
    assert.deepEqual(ownState.awardLedger, canonicalLedger);
    assert.equal(JSON.stringify(ownState.awardLedger).includes("maxBids"), false);
    assert.equal(JSON.stringify(getAuctionAwards(ownState)).includes("98371"), false);
  }
  assert.equal((await read(red)).myTargetPicks.maxBids[players[2].id], 98371);
  state = ok(await act(host, correct(state, players[1].id, { teamId: "rcb", amount: 900 }))).state;
  assert.equal(award(state, "headline").metric, "₹9.00 Cr");
  assert.deepEqual(award(state, "headline").winners[0].teamIds, ["rcb"]);
  state = ok(await act(host, correct(state, players[1].id, { teamId: null }))).state;
  assert.deepEqual(award(state, "headline").winners.map(winner => winner.playerId), [players[0].id]);
  assert.deepEqual(state.awardLedger, canonicalLedger, "post-auction financial corrections do not rewrite historical competition");

  // Seed only disposable test-room records to exercise migration and retained
  // telemetry without placing thousands of real, cooldown-limited API bids.
  for (const retainedLedger of [true, false]) {
    const archived = await create(retainedLedger ? "Durable compact awards" : "Legacy truncated awards");
    const record = await stored(archived);
    const player = record.state.players[0];
    record.state.bidHistory = Array.from({ length: 2000 }, (_, i) => ({ id: `retained-${i + 105}`, playerId: player.id, teamId: i % 2 ? "rcb" : "mi", memberId: "historic-manager", amount: 200 + i * 5, at: Date.now() - 2000000 + i * 1000 }));
    if (retainedLedger) record.state.awardLedger = { schema: 1, complete: true, lastBidId: "retained-2104", players: { [player.id]: { name: player.name, bids: 2105, teamBids: { rcb: 1053, mi: 1052 } } } };
    else delete record.state.awardLedger;
    record.state.version += 1;
    await database.execute({ sql: "UPDATE auction_rooms SET state_json = ?, version = ? WHERE code = ?", args: [JSON.stringify(record), record.state.version, archived.state.code] });
    const completed = ok(await act(archived, { type: "end_auction", expectedResultsRevision: record.state.resultsRevision ?? 0 })).state;
    assert.equal(completed.awardLedger.complete, retainedLedger);
    assert.deepEqual((await stored(archived)).state.awardLedger, completed.awardLedger);
    assert.deepEqual((await read(archived)).awardLedger, completed.awardLedger);
    if (retainedLedger) {
      assert.equal(award(completed, "battle").metric, "2105 bids");
      assert.ok(JSON.stringify(completed.awardLedger).length < 500);
    } else for (const id of ["battle", "table", "rivals"]) {
      assert.deepEqual(award(completed, id).winners, []); assert.match(award(completed, id).unavailable, /Earlier bids are missing/);
    }
  }
  console.log("PASS: auction awards count committed bids once across CAS races/reoffers, survive rolling history and storage, exclude private budgets, and update financial results after audited corrections.");
} finally {
  for (const host of rooms) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }).then(ok);
  database.close();
}
