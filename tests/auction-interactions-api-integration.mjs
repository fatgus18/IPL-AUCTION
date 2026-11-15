import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run interaction checks only through the isolated API runner.");
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
const ok = response => { assert.ok(response.status >= 200 && response.status < 300, `${response.status}: ${response.data.error}`); return response.data; };
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(ok).then(value => value.state);
const stored = async member => JSON.parse((await database.execute({ sql: "SELECT state_json FROM auction_rooms WHERE code = ?", args: [member.state.code] })).rows[0].state_json).state;
const rcb = state => state.teams.find(team => team.id === "rcb");
const save = (lineup, expectedRevision) => ({ type: "set_lineup", teamId: "rcb", lineup, expectedRevision });
const rejected = async (member, action, status, code) => {
  const before = await stored(member);
  const response = await act(member, action);
  assert.equal(response.status, status, response.data.error);
  assert.equal(response.data.code, code);
  assert.deepEqual(await stored(member), before, "rejected requests cannot mutate persistent room state");
};

try {
  const host = ok(await request("/api/rooms", { body: { name: "Custom bids and free positions", hostName: "Interaction host" } }));
  const teamPassword = ok(await request(`${pathFor(host)}/access`, { token: host.token, body: {} })).teamPassword;
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword } : {}) } }).then(ok);
  const owner = await join("Red manager", "rcb");
  const opponent = await join("Blue manager", "mi");
  const spectator = await join("Room viewer");
  const candidates = host.state.players.filter(player => player.status === "available" && player.eligibilityVerified !== false && !player.isOverseas).slice(0, 4);
  assert.equal(candidates.length, 4);
  const open = async player => {
    ok(await act(host, { type: "select_player", playerId: player.id }));
    return ok(await act(host, { type: "start" })).state;
  };
  const bidFor = (player, customAmount, expectedAmount = player.basePrice) => ({ type: "bid", expectedPlayerId: player.id, expectedAmount, customAmount });
  const finish = async () => {
    ok(await act(host, { type: "lock" }));
    return ok(await act(host, { type: "sell" })).state;
  };

  const first = candidates[0];
  await open(first);
  for (const customAmount of [null, "500", false, {}, [], 0, -1, 500.5, Number.MAX_SAFE_INTEGER + 1]) {
    await rejected(owner, bidFor(first, customAmount), 400, "INVALID_BID_AMOUNT");
  }
  await rejected(owner, bidFor(first, first.basePrice - 1), 400, "BID_TOO_LOW");
  await rejected(owner, bidFor(first, 10001), 409, "INSUFFICIENT_PURSE");
  await rejected(owner, bidFor(first, 500, 500), 409, "STALE_BID");
  await rejected(owner, { ...bidFor(first, 500), expectedPlayerId: candidates[1].id }, 409, "STALE_PLAYER");
  await rejected(spectator, bidFor(first, 500), 403, "NO_TEAM");

  const racers = [owner, opponent];
  const raced = await Promise.all(racers.map((member, index) => act(member, bidFor(first, 500 + index * 200))));
  assert.equal(raced.filter(result => result.status === 200).length, 1, "only one custom jump from a given displayed price can be accepted");
  assert.equal(raced.filter(result => result.status === 409 && result.data.code === "STALE_BID").length, 1);
  const winningIndex = raced.findIndex(result => result.status === 200);
  const winningBid = raced[winningIndex].data.state;
  const loser = racers[1 - winningIndex];
  const acceptedAmount = 500 + winningIndex * 200;
  assert.equal(winningBid.currentBid, acceptedAmount);
  assert.equal(winningBid.bidHistory.at(-1).amount, acceptedAmount);
  assert.ok(winningBid.teams.every(team => team.purse === 10000));
  const nextAmount = acceptedAmount + winningBid.settings.bidIncrement;
  await rejected(racers[winningIndex], bidFor(first, 900, nextAmount), 409, "ALREADY_LEADING");
  ok(await act(host, { type: "lock" }));
  await rejected(loser, bidFor(first, 950, nextAmount), 409, "BIDDING_CLOSED");
  const sold = ok(await act(host, { type: "sell" })).state;
  const winner = sold.teams.find(team => team.id === sold.leadingTeamId);
  assert.equal(winner.purse, 10000 - acceptedAmount);
  assert.deepEqual(winner.squad, [{ playerId: first.id, amount: acceptedAmount }]);
  assert.equal(sold.players.find(player => player.id === first.id).soldFor, acceptedAmount);
  await rejected(host, { type: "sell" }, 409, "INVALID_ACTION");

  const owned = [];
  for (const player of candidates.slice(1)) {
    await open(player);
    ok(await act(owner, bidFor(player, 577)));
    await finish();
    owned.push(player.id);
  }
  const draft = {
    playingXI: [null, null, null, null, null, null, owned[0], null, null, null, null],
    substitutes: [null, null, null, null, owned[1]], captainId: owned[0], viceCaptainId: null,
  };
  const saved = ok(await act(owner, save(draft, 0))).state;
  const canonical = { ...draft, playingXI: draft.playingXI.slice(0, 7), revision: 1 };
  assert.deepEqual(rcb(saved).lineup, canonical);
  assert.deepEqual(rcb(await stored(owner)).lineup, canonical, "No. 7 and substitute 5 retain their positions on disk");
  for (const member of [host, owner, opponent, spectator]) {
    assert.deepEqual(rcb(await read(member)).lineup, canonical);
  }
  const newOpener = { ...draft, playingXI: [owned[2], null, null, null, null, null, owned[0]], viceCaptainId: owned[2] };
  const newLast = { ...draft, playingXI: [null, null, null, null, null, null, owned[0], null, null, null, owned[2]], viceCaptainId: owned[2] };
  for (const invalid of [
    { ...draft, playingXI: [owned[0], null, owned[0]] },
    { ...draft, substitutes: [null, owned[0]] },
    { ...draft, captainId: owned[1] },
    { ...draft, viceCaptainId: owned[0] },
  ]) await rejected(owner, save(invalid, 1), 400, "INVALID_ACTION");
  const lineupRace = await Promise.all([newOpener, newLast].map(lineup => act(owner, save(lineup, 1))));
  assert.equal(lineupRace.filter(result => result.status === 200).length, 1);
  assert.equal(lineupRace.filter(result => result.status === 409 && result.data.code === "LINEUP_CONFLICT").length, 1);
  const latest = rcb(lineupRace.find(result => result.status === 200).data.state).lineup;
  assert.equal(latest.playingXI[6], owned[0]);
  assert.equal(latest.revision, 2);
  assert.deepEqual(rcb(await stored(owner)).lineup, latest);

  const chat = ok(await act(owner, {
    type: "chat", text: "This is my actual message", senderName: "Interaction host", senderTeamId: "mi", memberId: host.memberId,
  })).state.activity.at(-1);
  assert.equal(chat.memberId, owner.memberId);
  assert.equal(chat.senderName, "Red manager");
  assert.equal(chat.senderTeamId, "rcb");
  const spectatorChat = ok(await act(spectator, { type: "chat", text: "Watching the auction" })).state.activity.at(-1);
  assert.equal(spectatorChat.senderName, "Room viewer");
  assert.equal(spectatorChat.senderTeamId, null);
  ok(await act(owner, { type: "leave" }));
  const afterLeave = await read(spectator);
  assert.ok(!afterLeave.members.some(member => member.id === owner.memberId));
  assert.deepEqual(afterLeave.activity.find(entry => entry.id === chat.id), chat, "sender identity survives a fresh read after leaving");
  assert.deepEqual((await stored(host)).activity.find(entry => entry.id === chat.id), chat);
  console.log("PASS: custom bid races, exact currency, stale/locked bids, sale accounting, independently filled lineup positions, revision conflicts and durable authenticated chat names.");
} finally {
  database.close();
}
