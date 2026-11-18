import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Pause checks require the isolated API runner.");
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
const ok = response => { assert.ok(response.status >= 200 && response.status < 300, `${response.status}: ${response.data.error}`); return response.data; };
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(ok).then(value => value.state);
const stored = async member => JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [member.state.code] })).rows[0].state_json).state;
const next = state => state.leadingTeamId ? Math.floor(state.currentBid / 25) * 25 + Math.max(25, Math.ceil(state.settings.bidIncrement / 25) * 25) : Math.max(25, Math.ceil(state.players.find(player => player.id === state.currentPlayerId).basePrice / 25) * 25);
const bid = (state, customAmount) => ({ type: "bid", expectedPlayerId: state.currentPlayerId, expectedAmount: next(state), ...(customAmount === undefined ? {} : { customAmount }) });
let host;

try {
  host = ok(await request("/api/rooms", { body: { name: "Durable break verification", hostName: "Break creator" } }));
  const teamPassword = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword } : {}) } }).then(ok);
  const bidder = await join("Break manager", "rcb"), viewer = await join("Break spectator");
  const player = host.state.players.find(player => player.status === "available" && player.eligibilityVerified !== false);
  const rejected = async (member, action, code, status = 409) => {
    const before = await stored(host), response = await act(member, action);
    assert.equal(response.status, status, response.data.error); assert.equal(response.data.code, code);
    assert.deepEqual(await stored(host), before, "rejected break actions cannot change saved state");
  };
  for (const member of [bidder, viewer]) await rejected(member, { type: "pause_auction" }, "FORBIDDEN", 403);
  const before = await read(host);
  const races = await Promise.all([act(host, { type: "pause_auction" }), act(host, { type: "pause_auction" })]);
  assert.equal(races.filter(response => response.status === 200).length, 1);
  assert.equal(races.filter(response => response.data.code === "AUCTION_ALREADY_PAUSED").length, 1);
  let paused = await stored(host);
  assert.equal(paused.version, before.version + 1);
  assert.ok(paused.auctionPausedAt);
  for (const member of [host, bidder, viewer]) assert.equal((await read(member)).auctionPausedAt, paused.auctionPausedAt);
  await rejected(host, { type: "select_player", playerId: player.id }, "AUCTION_PAUSED");
  await rejected(host, { type: "end_auction", expectedResultsRevision: 0 }, "AUCTION_PAUSED");
  for (const member of [bidder, viewer]) await rejected(member, { type: "resume_auction" }, "FORBIDDEN", 403);
  ok(await act(bidder, { type: "chat", text: "Tomorrow works for me" }));
  const picks = ok(await act(bidder, { type: "set_target_picks", teamId: "rcb", playerIds: [player.id], maxBids: { [player.id]: 713 }, expectedRevision: 0 })).state.myTargetPicks;
  assert.equal(picks.maxBids[player.id], 713, "private planning budgets remain flexible during a break");
  assert.equal((await read(viewer)).myTargetPicks, undefined);
  const resumes = await Promise.all([act(host, { type: "resume_auction" }), act(host, { type: "resume_auction" })]);
  assert.equal(resumes.filter(response => response.status === 200).length, 1);
  assert.equal(resumes.filter(response => response.data.code === "AUCTION_NOT_PAUSED").length, 1);
  ok(await act(host, { type: "select_player", playerId: player.id }));
  let live = ok(await act(host, { type: "start" })).state;
  const bidRace = await Promise.all([act(host, { type: "pause_auction" }), act(bidder, bid(live, 500))]);
  assert.equal(bidRace[0].status, 200);
  assert.ok(bidRace[1].status === 200 || bidRace[1].data.code === "AUCTION_PAUSED");
  paused = await stored(host);
  assert.equal(paused.phase, "live"); assert.ok(paused.auctionPausedAt);
  assert.equal(paused.bidHistory.length, bidRace[1].status === 200 ? 1 : 0);
  assert.equal(paused.currentBid, bidRace[1].status === 200 ? 500 : 0);
  await rejected(viewer, bid(paused, 1000), "AUCTION_PAUSED");
  await rejected(host, { type: "lock" }, "AUCTION_PAUSED");
  live = ok(await act(host, { type: "resume_auction" })).state;
  assert.equal(live.currentBid, paused.currentBid); assert.deepEqual(live.bidHistory, paused.bidHistory);
  if (!live.leadingTeamId) live = ok(await act(bidder, bid(live, 500))).state;
  const locked = ok(await act(host, { type: "lock" })).state;
  paused = ok(await act(host, { type: "pause_auction" })).state;
  assert.equal(paused.phase, "locked");
  await rejected(host, { type: "sell" }, "AUCTION_PAUSED");
  const unlock = { type: "unlock", expectedPlayerId: player.id, expectedAmount: locked.currentBid, expectedLockVersion: locked.bidLockVersion };
  await rejected(host, unlock, "AUCTION_PAUSED");
  ok(await act(host, { type: "resume_auction" }));
  const sold = ok(await act(host, { type: "sell" })).state;
  assert.equal(sold.teams.find(team => team.id === "rcb").purse, 9500);
  assert.equal(sold.teams.find(team => team.id === "rcb").squad[0].amount, 500);
  console.log("PASS: creator-only durable breaks, concurrent pause/resume and bid races, public synchronization, private planning during breaks and preserved locked-sale accounting.");
} finally {
  if (host) ok(await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }));
  database.close();
}
