import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Transaction } from "@libsql/client";
import { createDatabaseWriteQueue } from "../lib/database-write-queue.ts";

test("native SQLite writer recovers a blocked BEGIN without poisoning later commits or interrupting reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pavilion-native-lock-"));
  const url = pathToFileURL(join(directory, "isolated.db")).href;
  const reader = createClient({ url, timeout: 20 });
  const writer = createClient({ url, timeout: 20, concurrency: 1 });
  let held: Transaction | undefined;
  try {
    await reader.execute("PRAGMA journal_mode = WAL");
    await reader.execute("CREATE TABLE check_writes (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    held = await reader.transaction("write");
    const queue = createDatabaseWriteQueue();
    let recoveries = 0;
    let mutations = 0;
    const begin = async <T>(work: (transaction: Transaction) => Promise<T>): Promise<T> => {
      const transaction = await writer.transaction("write");
      try { const result = await work(transaction); await transaction.commit(); return result; }
      catch (error) { if (!transaction.closed) await transaction.rollback(); throw error; }
    };
    const recovery = async () => {
      recoveries += 1;
      await writer.reconnect();
      // Release the external lock only after proving that a BEGIN actually failed.
      if (!held!.closed) await held!.commit();
    };
    const result = await queue(begin, async (transaction: Transaction) => {
      mutations += 1;
      await transaction.execute({ sql: "INSERT INTO check_writes (value) VALUES (?) RETURNING id", args: ["first"] });
      const read = await reader.execute("SELECT COUNT(*) AS count FROM check_writes");
      assert.equal(read.rows[0].count, 0, "reader uses its own committed snapshot while writer is open");
      return "saved";
    }, recovery);
    assert.equal(result, "saved");
    assert.equal(recoveries, 1);
    assert.equal(mutations, 1);
    await queue(begin, async (transaction: Transaction) => {
      await transaction.execute({ sql: "INSERT INTO check_writes (value) VALUES (?)", args: ["second"] });
    }, recovery);
    const count = await reader.execute("SELECT COUNT(*) AS count FROM check_writes");
    assert.equal(count.rows[0].count, 2, "both commits remain durable after connection recovery");
  } finally {
    if (held && !held.closed) await held.rollback();
    reader.close(); writer.close();
  }
});
