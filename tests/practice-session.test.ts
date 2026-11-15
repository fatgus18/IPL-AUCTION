import assert from "node:assert/strict";
import test from "node:test";
import type { RoomState } from "../lib/auction.ts";
import { AuctionRequestError, type requestAuction } from "../lib/auction-client.ts";
import {
  createPracticeSessionRestorer, parseRoomSession, PRACTICE_SESSION_KEY, PracticeSessionError,
  type PracticeSessionDependencies, type RoomSession,
} from "../lib/practice-session.ts";

const session: RoomSession = { code: "ABC123", token: "a".repeat(64), memberId: "practice-host" };
const serialized = JSON.stringify(session);

function fixture(): RoomState & { mode: "practice" } {
  return {
    id: "room-id", code: session.code, name: "Practice room", mode: "practice", version: 0,
    createdAt: 100, serverTime: 100, hostId: session.memberId,
    members: [{ id: session.memberId, name: "Auctioneer", role: "auctioneer", teamId: null, joinedAt: 100, lastSeenAt: 100, flagRaisedAt: null }],
    players: [], teams: [], currentPlayerId: null, currentBid: 0, leadingTeamId: null, phase: "waiting", lastBidAt: null,
    bidHistory: [], activity: [],
    settings: { purse: 10000, maxSquadSize: 25, maxOverseas: 8, bidCooldownMs: 1000, bidIncrement: 25, callUrl: "" },
  };
}

function memoryStorage(initial?: string) {
  const entries = new Map<string, string>(initial === undefined ? [] : [[PRACTICE_SESSION_KEY, initial]]);
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
}

function sharedLock(): NonNullable<PracticeSessionDependencies["runExclusive"]> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(name: string, work: () => Promise<T>): Promise<T> => {
    assert.equal(name, PRACTICE_SESSION_KEY);
    const current = tail.then(work);
    tail = current.catch(() => {});
    return current;
  };
}

function fakeServer(state = fixture()) {
  const calls: { path: string; body: unknown; token: string | undefined }[] = [];
  const request: typeof requestAuction = async <T>(path: string, body?: unknown, token?: string): Promise<T> => {
    calls.push({ path, body, token });
    if (path === "/api/practice") {
      assert.deepEqual(body, {});
      assert.equal(token, undefined);
      return structuredClone({ state, token: session.token, memberId: session.memberId }) as T;
    }
    assert.equal(path, `/api/rooms/${session.code}`);
    assert.equal(body, undefined);
    assert.equal(token, session.token);
    return structuredClone({ state }) as T;
  };
  return { request, calls, state };
}

function practiceError(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof PracticeSessionError);
    assert.equal(error.code, code);
    return true;
  };
}

test("session parsing rejects malformed codes, credentials, and member identities", () => {
  assert.deepEqual(parseRoomSession(serialized), session);
  for (const raw of [null, "", "garbage", "[]", "null", "{}", JSON.stringify({ ...session, code: "abc123" }),
    JSON.stringify({ ...session, code: "ABC1234" }), JSON.stringify({ ...session, token: "a".repeat(16) }),
    JSON.stringify({ ...session, token: "g".repeat(64) }), JSON.stringify({ ...session, memberId: " " }),
    JSON.stringify({ ...session, memberId: "a".repeat(81) }), JSON.stringify({ ...session, memberId: "user\nname" }),
    JSON.stringify({ ...session, memberId: " leading" })]) assert.equal(parseRoomSession(raw), null);
});

test("creation saves room access before exposing a usable state", async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const restore = createPracticeSessionRestorer({ storage: () => storage, request: server.request, runExclusive: sharedLock() });
  const result = await restore();
  assert.deepEqual(result.session, session);
  assert.deepEqual(parseRoomSession(storage.getItem(PRACTICE_SESSION_KEY)), result.session);
  assert.equal(server.calls.length, 1);
  assert.equal(storage.entries.size, 1, "the temporary storage check must be removed");
});

test("repeated mounts in one tab share the same pending creation", async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const restore = createPracticeSessionRestorer({ storage: () => storage, request: server.request, runExclusive: sharedLock() });
  const first = restore();
  const second = restore();
  assert.equal(first, second);
  assert.deepEqual(await first, await second);
  assert.equal(server.calls.length, 1);
});

test("two first-open tabs create one room and restore identical server state", async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const deps = { storage: () => storage, request: server.request, runExclusive: sharedLock() };
  const tabA = createPracticeSessionRestorer(deps);
  const tabB = createPracticeSessionRestorer(deps);
  const [first, second] = await Promise.all([tabA(), tabB()]);
  assert.deepEqual(first, second);
  assert.equal(server.calls.filter(call => call.path === "/api/practice").length, 1);
  assert.equal(server.calls.filter(call => call.path.startsWith("/api/rooms/")).length, 1);
});

test("a refreshed page restores imported players from the same saved room without creation", async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const deps = { storage: () => storage, request: server.request, runExclusive: sharedLock() };
  const initial = await createPracticeSessionRestorer(deps)();
  server.state.players.push({
    id: "imported-player", name: "Imported player", role: "Batter", country: "India", isOverseas: false,
    status: "available", basePrice: 50, stats: { matches: 10, runs: 250, wickets: 0, strikeRate: 120 },
  });
  server.state.version += 1;
  const refreshed = await createPracticeSessionRestorer(deps)();
  assert.deepEqual(refreshed.session, initial.session);
  assert.deepEqual(refreshed.state.players, server.state.players);
  assert.equal(refreshed.state.version, 1);
  assert.equal(server.calls.filter(call => call.path === "/api/practice").length, 1);
});

for (const status of [401, 404]) {
  test(`a saved room returning ${status} keeps credentials and never creates a replacement`, async () => {
    const storage = memoryStorage(serialized);
    let calls = 0;
    const request: typeof requestAuction = async <T>(): Promise<T> => { calls += 1; throw new AuctionRequestError("Unavailable", status); };
    const restore = createPracticeSessionRestorer({ storage: () => storage, request, runExclusive: sharedLock() });
    await assert.rejects(restore(), practiceError("PRACTICE_SESSION_UNAVAILABLE"));
    assert.equal(calls, 1);
    assert.equal(storage.getItem(PRACTICE_SESSION_KEY), serialized);
  });
}

test("a transient server failure keeps saved access and a retry restores the same room", async () => {
  const storage = memoryStorage(serialized);
  const server = fakeServer();
  let fail = true;
  const request: typeof requestAuction = async <T>(...args: Parameters<typeof requestAuction>): Promise<T> => {
    if (fail) throw new AuctionRequestError("Network unavailable", undefined, "NETWORK_ERROR");
    return server.request<T>(...args);
  };
  const restore = createPracticeSessionRestorer({ storage: () => storage, request, runExclusive: sharedLock() });
  await assert.rejects(restore(), AuctionRequestError);
  assert.equal(storage.getItem(PRACTICE_SESSION_KEY), serialized);
  fail = false;
  assert.deepEqual((await restore()).session, session);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].path, `/api/rooms/${session.code}`);
});

test("corrupted saved access is preserved without any request or overwrite", async () => {
  const storage = memoryStorage("{damaged");
  const server = fakeServer();
  const restore = createPracticeSessionRestorer({ storage: () => storage, request: server.request, runExclusive: sharedLock() });
  await assert.rejects(restore(), practiceError("PRACTICE_SESSION_INVALID"));
  assert.equal(storage.getItem(PRACTICE_SESSION_KEY), "{damaged");
  assert.equal(server.calls.length, 0);
});

test("unavailable browser storage blocks creation before a server request", async () => {
  const server = fakeServer();
  const restore = createPracticeSessionRestorer({ storage: () => { throw new Error("Blocked"); }, request: server.request, runExclusive: sharedLock() });
  await assert.rejects(restore(), practiceError("PRACTICE_STORAGE_UNAVAILABLE"));
  assert.equal(server.calls.length, 0);
});

test("read-only browser storage fails its write check before creating a room", async () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error("Quota exceeded"); };
  const server = fakeServer();
  const restore = createPracticeSessionRestorer({ storage: () => storage, request: server.request, runExclusive: sharedLock() });
  await assert.rejects(restore(), practiceError("PRACTICE_STORAGE_UNAVAILABLE"));
  assert.equal(server.calls.length, 0);
});

test("a failed credential write never exposes an unsaved room and retry saves the same credentials", async () => {
  const storage = memoryStorage();
  const setItem = storage.setItem;
  let fail = true;
  storage.setItem = (key, value) => {
    if (key === PRACTICE_SESSION_KEY && fail) throw new Error("Storage became unavailable");
    setItem(key, value);
  };
  const server = fakeServer();
  const restore = createPracticeSessionRestorer({ storage: () => storage, request: server.request, runExclusive: sharedLock() });
  await assert.rejects(restore(), practiceError("PRACTICE_STORAGE_UNAVAILABLE"));
  assert.equal(storage.getItem(PRACTICE_SESSION_KEY), null);
  fail = false;
  assert.deepEqual((await restore()).session, session);
  assert.equal(storage.getItem(PRACTICE_SESSION_KEY), serialized);
  assert.equal(server.calls.length, 1, "retry must not create a second room");
});

test("silently discarded writes are treated as failed persistence", async () => {
  const storage = memoryStorage();
  const setItem = storage.setItem;
  storage.setItem = (key, value) => { if (key !== PRACTICE_SESSION_KEY) setItem(key, value); };
  const server = fakeServer();
  const restore = createPracticeSessionRestorer({ storage: () => storage, request: server.request, runExclusive: sharedLock() });
  await assert.rejects(restore(), practiceError("PRACTICE_STORAGE_UNAVAILABLE"));
  assert.equal(storage.getItem(PRACTICE_SESSION_KEY), null);
});

test("a saved session pointing to a multiplayer room cannot replace practice state", async () => {
  const storage = memoryStorage(serialized);
  const state = fixture();
  Object.assign(state, { mode: "multiplayer" });
  const server = fakeServer(state);
  const restore = createPracticeSessionRestorer({ storage: () => storage, request: server.request, runExclusive: sharedLock() });
  await assert.rejects(restore(), practiceError("PRACTICE_SESSION_MISMATCH"));
  assert.equal(storage.getItem(PRACTICE_SESSION_KEY), serialized);
  assert.equal(server.calls.length, 1);
});

test("a successful response for the wrong room never overwrites saved credentials", async () => {
  const storage = memoryStorage(serialized);
  const state = fixture();
  state.code = "ZZZ999";
  const server = fakeServer(state);
  const restore = createPracticeSessionRestorer({ storage: () => storage, request: server.request, runExclusive: sharedLock() });
  await assert.rejects(restore(), practiceError("PRACTICE_SESSION_MISMATCH"));
  assert.equal(storage.getItem(PRACTICE_SESSION_KEY), serialized);
});

test("browsers without cross-tab locks can restore existing access but cannot race first creation", async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const restore = createPracticeSessionRestorer({ storage: () => storage, request: server.request });
  await assert.rejects(restore(), practiceError("PRACTICE_LOCKS_UNAVAILABLE"));
  assert.equal(server.calls.length, 0);
  storage.setItem(PRACTICE_SESSION_KEY, serialized);
  assert.deepEqual((await restore()).session, session);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].path, `/api/rooms/${session.code}`);
});
