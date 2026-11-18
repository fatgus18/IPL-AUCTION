import assert from "node:assert/strict";
import { test } from "node:test";
import { toBroadcastState } from "../lib/broadcast-display.ts";

const { createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);

test("broadcast projection excludes private plans, participant identities, chat and access settings", () => {
  const state = createDemoState();
  const player = state.players[0];
  state.myTargetPicks = { teamId: "rcb", playerIds: [player.id], maxBids: { [player.id]: 937 }, revision: 3 };
  state.settings.callUrl = "https://example.com/private-call";
  state.activity.push({ id: "chat-private", type: "chat", text: "Secret chat", senderName: "Private identity", at: 1 });
  state.bidHistory.push({ id: "public-bid", playerId: player.id, teamId: "rcb", memberId: "private-member", amount: 200, at: 1 });
  const before = structuredClone(state);
  const display = toBroadcastState(state);
  assert.deepEqual(Object.keys(display).sort(), ["code", "name", "players", "teams", "currentPlayerId", "currentBid", "leadingTeamId", "phase", "endedAt", "settings", "bidHistory"].sort());
  assert.deepEqual(display.settings, { maxSquadSize: state.settings.maxSquadSize, bidIncrement: state.settings.bidIncrement });
  assert.deepEqual(display.bidHistory.at(-1), { id: "public-bid", playerId: player.id, teamId: "rcb", amount: 200 });
  for (const secret of ["myTargetPicks", "maxBids", "members", "hostId", "completedManagers", "callUrl", "private-member", "Secret chat", "Private identity"]) {
    assert.ok(!JSON.stringify(display).includes(secret), `Broadcast excludes ${secret}`);
  }
  assert.deepEqual(state, before, "Projection never changes room data");
});

test("broadcast preserves every auction phase, public purchases and completion without inventing bids", () => {
  const state = createDemoState();
  for (const phase of ["waiting", "live", "paused", "locked", "sold", "unsold"] as const) {
    state.phase = phase;
    state.currentBid = 525;
    state.leadingTeamId = "gt";
    const display = toBroadcastState(state);
    assert.equal(display.phase, phase);
    assert.equal(display.currentBid, 525);
    assert.equal(display.leadingTeamId, "gt");
    assert.equal(display.teams, state.teams);
    assert.equal(display.players, state.players);
  }
  state.endedAt = 1234;
  assert.equal(toBroadcastState(state).endedAt, 1234);
  state.currentPlayerId = null;
  state.currentBid = 0;
  state.leadingTeamId = null;
  assert.equal(toBroadcastState(state).currentPlayerId, null);
  assert.equal(toBroadcastState(state).currentBid, 0);
});
