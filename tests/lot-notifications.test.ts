import assert from "node:assert/strict";
import { test } from "node:test";
import { LotNotificationTracker, type LotNotificationSnapshot } from "../lib/lot-notifications.ts";

const away = { connected: true, away: true };
const onAuctionPage = { connected: true, away: false };
const offline = { connected: false, away: true };
const selection = (id: string, at = 100) => ({ id, type: "player", text: "A player is on the auction floor.", at });
const snapshot = (overrides: Partial<LotNotificationSnapshot> = {}): LotNotificationSnapshot => ({
  id: "room-one", code: "ABCDEF", version: 1, currentPlayerId: null, phase: "waiting", activity: [], ...overrides,
});

test("joining a room never announces its existing player or historical selections", () => {
  const tracker = new LotNotificationTracker();
  const state = snapshot({ currentPlayerId: "axar", phase: "live", activity: [selection("lot-1")] });
  assert.equal(tracker.observe(state, away), null);
  assert.equal(tracker.observe({ ...state, version: 2 }, away), null);
});

test("a newly nominated player announces once while the participant is elsewhere", () => {
  const tracker = new LotNotificationTracker();
  tracker.observe(snapshot(), away);
  const state = snapshot({ version: 2, currentPlayerId: "axar", activity: [selection("lot-1")] });
  assert.deepEqual(tracker.observe(state, away), { key: "room-one:ABCDEF:lot-1:axar", playerId: "axar" });
  assert.equal(tracker.observe(state, away), null);
  assert.equal(tracker.observe({ ...state, version: 3, phase: "live" }, away), null);
});

test("leaving the auction page does not announce the lot already seen there", () => {
  const tracker = new LotNotificationTracker();
  tracker.observe(snapshot(), onAuctionPage);
  const state = snapshot({ version: 2, currentPlayerId: "axar", activity: [selection("lot-1")] });
  assert.equal(tracker.observe(state, onAuctionPage), null);
  assert.equal(tracker.observe(state, away), null);
  assert.equal(tracker.observe({ ...state, version: 3 }, away), null);
});

test("re-nominating the same player is a new lot even with an identical timestamp", () => {
  const tracker = new LotNotificationTracker();
  const oldLot = snapshot({ currentPlayerId: "axar", activity: [selection("lot-1")] });
  tracker.observe(oldLot, away);
  assert.equal(tracker.observe({ ...oldLot, version: 2, phase: "unsold" }, away), null);
  assert.deepEqual(tracker.observe({ ...oldLot, version: 3, activity: [selection("lot-1"), selection("lot-2")] }, away), {
    key: "room-one:ABCDEF:lot-2:axar", playerId: "axar",
  });
});

test("a temporary disconnect announces only the latest active selection on reconnect", () => {
  const tracker = new LotNotificationTracker();
  tracker.observe(snapshot(), away);
  assert.equal(tracker.observe(snapshot(), offline), null);
  assert.equal(tracker.observe(snapshot({ version: 2, currentPlayerId: "axar", activity: [selection("lot-1")] }), offline), null);
  const current = snapshot({ version: 5, currentPlayerId: "bumrah", phase: "live", activity: [selection("lot-1"), selection("lot-2", 200)] });
  assert.deepEqual(tracker.observe(current, away), { key: "room-one:ABCDEF:lot-2:bumrah", playerId: "bumrah" });
  assert.equal(tracker.observe(current, away), null);
});

test("initial disconnected snapshots remain silent when the first connection succeeds", () => {
  const tracker = new LotNotificationTracker();
  tracker.observe(snapshot(), offline);
  assert.equal(tracker.observe(snapshot({ version: 3, currentPlayerId: "axar", activity: [selection("lot-1")] }), away), null);
});

test("sold, unsold, or cleared lots never produce a catch-up notification", () => {
  for (const state of [
    snapshot({ version: 4, currentPlayerId: "axar", phase: "sold", activity: [selection("lot-1")] }),
    snapshot({ version: 4, currentPlayerId: "axar", phase: "unsold", activity: [selection("lot-1")] }),
    snapshot({ version: 4, currentPlayerId: null, activity: [selection("lot-1")] }),
  ]) {
    const tracker = new LotNotificationTracker();
    tracker.observe(snapshot(), away);
    tracker.observe(snapshot(), offline);
    assert.equal(tracker.observe(state, away), null);
    assert.equal(tracker.observe({ ...state, version: 5 }, away), null);
  }
});

test("an active lot can be announced while waiting, live, paused, or locked", () => {
  for (const phase of ["waiting", "live", "paused", "locked"] as const) {
    const tracker = new LotNotificationTracker();
    tracker.observe(snapshot(), away);
    assert.equal(tracker.observe(snapshot({ version: 3, phase, currentPlayerId: "axar", activity: [selection("lot-1")] }), away)?.playerId, "axar");
  }
});

test("stale or duplicate room versions cannot rewind the tracker or replay a lot", () => {
  const tracker = new LotNotificationTracker();
  tracker.observe(snapshot(), away);
  const newer = snapshot({ version: 4, currentPlayerId: "bumrah", activity: [selection("lot-2", 200)] });
  assert.ok(tracker.observe(newer, away));
  assert.equal(tracker.observe(snapshot({ version: 2, currentPlayerId: "axar", activity: [selection("lot-1")] }), away), null);
  assert.equal(tracker.observe({ ...newer, version: 5 }, away), null);
  assert.equal(tracker.observe({ ...newer, currentPlayerId: "pant" }, away), null);
});

test("changing rooms or returning from the lobby creates a silent baseline", () => {
  const tracker = new LotNotificationTracker();
  const state = snapshot({ currentPlayerId: "axar", activity: [selection("lot-1")] });
  tracker.observe(state, away);
  assert.equal(tracker.observe({ ...state, id: "room-two", code: "GHIJKL", version: 50 }, away), null);
  assert.equal(tracker.observe(null, away), null);
  assert.equal(tracker.observe({ ...state, version: 60 }, away), null);
  tracker.reset();
  assert.equal(tracker.observe({ ...state, version: 70 }, away), null);
});

test("chat and history truncation do not masquerade as a new selection", () => {
  const tracker = new LotNotificationTracker();
  const state = snapshot({ currentPlayerId: "axar", activity: [selection("lot-1", 200)] });
  tracker.observe(state, away);
  const chat = { id: "chat-1", type: "chat", text: "Bumrah is on the auction floor.", at: 300 };
  assert.equal(tracker.observe({ ...state, version: 2, activity: [chat] }, away), null);
  assert.equal(tracker.observe({ ...state, version: 3, activity: [selection("older-history", 100), chat] }, away), null);
  assert.equal(tracker.observe({ ...state, version: 4, activity: [] }, away), null);
});

test("a changed player is detected even when chat has already displaced the selection event", () => {
  const tracker = new LotNotificationTracker();
  tracker.observe(snapshot({ currentPlayerId: "axar", activity: [selection("lot-1")] }), away);
  const current = snapshot({ version: 200, currentPlayerId: "bumrah", phase: "live", activity: [] });
  assert.deepEqual(tracker.observe(current, away), { key: "room-one:ABCDEF:version-200:bumrah", playerId: "bumrah" });
  assert.equal(tracker.observe({ ...current, version: 201 }, away), null);
});
