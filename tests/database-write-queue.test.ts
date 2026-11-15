import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseWriteQueue } from "../lib/database-write-queue.ts";

const busy = () => Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });

test("simultaneous database writers never overlap and preserve submission order", async () => {
  const run = createDatabaseWriteQueue();
  const events: string[] = [];
  let active = 0;
  const begin = async (work: (transaction: null) => Promise<number>) => {
    assert.equal(active, 0);
    active += 1;
    try { return await work(null); } finally { active -= 1; }
  };
  const results = await Promise.all([1, 2, 3, 4].map(value => run(begin, async () => {
    events.push(`start-${value}`);
    await new Promise(resolve => setTimeout(resolve, 5));
    events.push(`end-${value}`);
    return value;
  })));
  assert.deepEqual(results, [1, 2, 3, 4]);
  assert.deepEqual(events, ["start-1", "end-1", "start-2", "end-2", "start-3", "end-3", "start-4", "end-4"]);
});

test("a busy BEGIN retries without running a mutation twice", async () => {
  const run = createDatabaseWriteQueue();
  let begins = 0;
  let mutations = 0;
  const result = await run(async work => {
    begins += 1;
    if (begins < 3) throw busy();
    return work(null);
  }, async () => { mutations += 1; return "saved"; });
  assert.equal(result, "saved");
  assert.equal(begins, 3);
  assert.equal(mutations, 1);
});

test("errors after mutation begins are never replayed, including ambiguous commits", async () => {
  const run = createDatabaseWriteQueue();
  let begins = 0;
  let mutations = 0;
  await assert.rejects(run(async work => {
    begins += 1;
    await work(null);
    throw busy();
  }, async () => { mutations += 1; }), { code: "SQLITE_BUSY" });
  assert.equal(begins, 1);
  assert.equal(mutations, 1);
  assert.equal(await run(work => work(null), async () => "next request"), "next request", "a rejected write does not poison the queue");
});

test("validation and network failures before BEGIN are not retried", async () => {
  const run = createDatabaseWriteQueue();
  let calls = 0;
  await assert.rejects(run(async () => { calls += 1; throw new Error("network unavailable"); }, async () => undefined), /network unavailable/);
  assert.equal(calls, 1);
});

test("database busy retry is bounded and never invokes the transaction callback", async () => {
  const run = createDatabaseWriteQueue();
  let begins = 0;
  let mutations = 0;
  await assert.rejects(run(async () => { begins += 1; throw busy(); }, async () => { mutations += 1; }), { code: "SQLITE_BUSY" });
  assert.equal(begins, 8);
  assert.equal(mutations, 0);
});

test("an expired queued request fails promptly and never mutates after the blocker finishes", async () => {
  const run = createDatabaseWriteQueue({ maxQueueWaitMs: 25 });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = run(work => work(null), async () => gate);
  await new Promise(resolve => setTimeout(resolve, 1));
  let mutations = 0;
  const second = run(work => work(null), async () => { mutations += 1; });
  await assert.rejects(second, { code: "DATABASE_WRITE_BUSY" });
  release();
  await first;
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(mutations, 0);
  assert.equal(await run(work => work(null), async () => "recovered"), "recovered");
});

test("a full writer queue rejects additional work without starting it", async () => {
  const run = createDatabaseWriteQueue({ maxPending: 1 });
  let release!: () => void;
  const first = run(work => work(null), async () => new Promise<void>(resolve => { release = resolve; }));
  await new Promise(resolve => setTimeout(resolve, 1));
  let mutations = 0;
  await assert.rejects(run(work => work(null), async () => { mutations += 1; }), { code: "DATABASE_WRITE_BUSY" });
  release();
  await first;
  assert.equal(mutations, 0);
});
