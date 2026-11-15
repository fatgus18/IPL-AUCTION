import assert from "node:assert/strict";
import test from "node:test";
import { createDemoState } from "../lib/auction.ts";
import { createRoomPollCache } from "../lib/room-poll-cache.ts";

test("poll authorization requires current room and common catalog versions", () => {
  const room = createDemoState();
  room.sharedCatalogVersion = 7;
  const cache = createRoomPollCache();
  cache.remember(room, { [room.hostId]: "host-digest" });
  assert.equal(cache.check(room.code, room.version, 7, "host-digest", room.serverTime), "unchanged");
  assert.equal(cache.check(room.code, room.version, 7, "other-digest", room.serverTime), "unauthorized");
  assert.equal(cache.check(room.code, room.version + 1, 7, "host-digest", room.serverTime), "miss");
  assert.equal(cache.check(room.code, room.version, 8, "host-digest", room.serverTime), "miss");
  assert.equal(cache.check(room.code, room.version, null, "host-digest", room.serverTime), "miss");
});

test("removed members never authenticate, even if an obsolete digest remains", () => {
  const room = createDemoState();
  room.sharedCatalogVersion = 1;
  const cache = createRoomPollCache();
  cache.remember(room, { ghost: "removed-digest", [room.hostId]: "host-digest" });
  assert.equal(cache.check(room.code, room.version, 1, "removed-digest", room.serverTime), "unauthorized");
});

test("practice polling stays read-only; live presence requires a heartbeat after 25 seconds", () => {
  const room = createDemoState();
  room.sharedCatalogVersion = 1;
  const cache = createRoomPollCache();
  room.mode = "practice";
  cache.remember(room, { [room.hostId]: "host-digest" });
  assert.equal(cache.check(room.code, room.version, 1, "host-digest", room.serverTime + 60000), "unchanged");
  delete room.mode;
  cache.remember(room, { [room.hostId]: "host-digest" });
  assert.equal(cache.check(room.code, room.version, 1, "host-digest", room.serverTime + 24999), "unchanged");
  assert.equal(cache.check(room.code, room.version, 1, "host-digest", room.serverTime + 25000), "miss");
});

test("poll metadata has a bounded LRU and old room revisions cannot be reused", () => {
  const cache = createRoomPollCache(2);
  const room = createDemoState();
  room.sharedCatalogVersion = 1;
  for (const code of ["AAAAAA", "BBBBBB", "CCCCCC"]) cache.remember({ ...room, code }, { [room.hostId]: "host-digest" });
  assert.equal(cache.check("AAAAAA", room.version, 1, "host-digest", room.serverTime), "miss");
  assert.equal(cache.check("BBBBBB", room.version, 1, "host-digest", room.serverTime), "unchanged");
  cache.remember({ ...room, code: "DDDDDD" }, { [room.hostId]: "host-digest" });
  assert.equal(cache.check("CCCCCC", room.version, 1, "host-digest", room.serverTime), "miss");
  cache.remember({ ...room, code: "BBBBBB", version: room.version + 1 }, {});
  assert.equal(cache.check("BBBBBB", room.version, 1, "host-digest", room.serverTime), "miss");
  assert.equal(cache.check("BBBBBB", room.version + 1, 1, "host-digest", room.serverTime), "unauthorized");
});
