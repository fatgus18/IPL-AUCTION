import assert from "node:assert/strict";
import test from "node:test";
import { createRoomCreationManager, PENDING_ROOM_CREATION_KEY } from "../lib/room-creation.ts";

function memoryStorage(initial?: string) {
  const entries = new Map<string, string>(initial === undefined ? [] : [[PENDING_ROOM_CREATION_KEY, initial]]);
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
}

test("repeated submissions and refreshes reuse a persisted creation key", () => {
  const storage = memoryStorage();
  let generated = 0;
  const randomBytes = () => { generated += 1; return new Uint8Array(32).fill(generated); };
  const firstTab = createRoomCreationManager({ storage: () => storage, randomBytes });
  const first = firstTab.prepareRoomCreation("\u0000  Sunday\n Auction  \u0000", " An\u0000mol ");
  assert.equal(first.name, "Sunday Auction");
  assert.equal(first.hostName, "Anmol");
  assert.deepEqual(JSON.parse(storage.getItem(PENDING_ROOM_CREATION_KEY)!), first);
  assert.deepEqual(firstTab.prepareRoomCreation("Sunday Auction", "Anmol"), first);
  const refreshedTab = createRoomCreationManager({ storage: () => storage, randomBytes });
  assert.deepEqual(refreshedTab.readPendingRoomCreation(), first);
  assert.deepEqual(refreshedTab.prepareRoomCreation("Sunday Auction", "Anmol"), first);
  assert.equal(generated, 1);
});

test("a conflicting request cannot replace pending recovery credentials", () => {
  const storage = memoryStorage();
  const manager = createRoomCreationManager({ storage: () => storage });
  const first = manager.prepareRoomCreation("Sunday Auction", "Anmol");
  const raw = storage.getItem(PENDING_ROOM_CREATION_KEY);
  for (const [name, hostName] of [["Another room", "Anmol"], ["Sunday Auction", "Someone else"]]) {
    assert.throws(() => manager.prepareRoomCreation(name, hostName), { message: "Recover the pending room before starting a different one." });
    assert.equal(storage.getItem(PENDING_ROOM_CREATION_KEY), raw);
  }
  assert.deepEqual(manager.readPendingRoomCreation(), first);
});

test("invalid names fail before generating or storing recovery credentials", () => {
  const storage = memoryStorage();
  let generated = 0;
  const manager = createRoomCreationManager({ storage: () => storage, randomBytes: () => { generated += 1; return new Uint8Array(32); } });
  for (const [name, hostName] of [["", "Anmol"], [" \n ", "Anmol"], ["a".repeat(81), "Anmol"], ["Room", ""], ["Room", "a".repeat(41)]]) {
    assert.throws(() => manager.prepareRoomCreation(name, hostName), /must contain/);
  }
  assert.equal(generated, 0);
  assert.equal(storage.entries.size, 0);
});

test("a blocked or silently ignored storage write never exposes a creation key", () => {
  for (const setItem of [() => { throw new Error("Quota exceeded"); }, () => {}]) {
    const storage = { ...memoryStorage(), setItem };
    const manager = createRoomCreationManager({ storage: () => storage });
    assert.throws(() => manager.prepareRoomCreation("Room", "Anmol"), /could not save room recovery access/);
    assert.equal(storage.entries.size, 0);
  }
  const unavailable = createRoomCreationManager({ storage: () => { throw new Error("Access denied"); } });
  assert.throws(() => unavailable.readPendingRoomCreation(), /could not save room recovery access/);
  assert.throws(() => unavailable.prepareRoomCreation("Room", "Anmol"), /could not save room recovery access/);
});

test("corrupt pending data is preserved and blocks replacement", () => {
  const valid = { creationKey: "a".repeat(64), name: "Room", hostName: "Anmol" };
  for (const raw of ["", "broken", "null", "[]", "{}", JSON.stringify({ ...valid, creationKey: "A".repeat(64) }), JSON.stringify({ ...valid, name: " Room" }), JSON.stringify({ ...valid, hostName: "\n" })]) {
    const storage = memoryStorage(raw);
    const manager = createRoomCreationManager({ storage: () => storage });
    assert.throws(() => manager.readPendingRoomCreation(), /has been kept/);
    assert.throws(() => manager.prepareRoomCreation("Room", "Anmol"), /has been kept/);
    assert.throws(() => manager.finishRoomCreation(valid.creationKey), /has been kept/);
    assert.equal(storage.getItem(PENDING_ROOM_CREATION_KEY), raw);
  }
});

test("finishing an older request cannot delete newer pending recovery", () => {
  const storage = memoryStorage();
  const manager = createRoomCreationManager({ storage: () => storage });
  const first = manager.prepareRoomCreation("Room", "Anmol");
  manager.finishRoomCreation("b".repeat(64));
  assert.deepEqual(manager.readPendingRoomCreation(), first);
  manager.finishRoomCreation(first.creationKey);
  assert.equal(manager.readPendingRoomCreation(), null);
  const next = manager.prepareRoomCreation("Next room", "Anmol");
  manager.finishRoomCreation(first.creationKey);
  assert.deepEqual(manager.readPendingRoomCreation(), next);
});

test("real crypto creates distinct 256-bit lowercase hex keys in separate tabs", () => {
  const firstStorage = memoryStorage();
  const secondStorage = memoryStorage();
  const first = createRoomCreationManager({ storage: () => firstStorage }).prepareRoomCreation("Room", "Anmol");
  const second = createRoomCreationManager({ storage: () => secondStorage }).prepareRoomCreation("Room", "Anmol");
  assert.match(first.creationKey, /^[a-f0-9]{64}$/);
  assert.match(second.creationKey, /^[a-f0-9]{64}$/);
  assert.notEqual(first.creationKey, second.creationKey);
});

test("invalid crypto output and failed completion storage do not lose recovery state", () => {
  const storage = memoryStorage();
  const invalid = createRoomCreationManager({ storage: () => storage, randomBytes: () => new Uint8Array(16) });
  assert.throws(() => invalid.prepareRoomCreation("Room", "Anmol"), /could not be generated/);
  assert.equal(storage.entries.size, 0);
  const manager = createRoomCreationManager({ storage: () => storage });
  const pending = manager.prepareRoomCreation("Room", "Anmol");
  const blocked = createRoomCreationManager({ storage: () => ({ ...storage, removeItem: () => {} }) });
  assert.throws(() => blocked.finishRoomCreation(pending.creationKey), /could not save room recovery access/);
  assert.deepEqual(manager.readPendingRoomCreation(), pending);
});
