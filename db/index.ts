import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { createDatabaseWriteQueue } from "@/lib/database-write-queue";
import { AUTH_SCHEMA_SQL } from "./auth-migrations";

export type Database = LibSQLDatabase<typeof schema>;
const databaseGlobal = globalThis as typeof globalThis & {
  pavilionDatabase?: Promise<Database>;
  pavilionWriteDatabase?: Promise<{ database: Database; client: Client; local: boolean }>;
  pavilionDatabaseWriteQueue?: ReturnType<typeof createDatabaseWriteQueue>;
};

async function createDatabaseConnection(writer = false): Promise<{ client: Client; local: boolean }> {
  const configuredUrl = process.env.DATABASE_URL?.trim() || process.env.TURSO_DATABASE_URL?.trim();
  let url = configuredUrl || "file:./.data/pavilion.db";
  const local = url.startsWith("file:");
  if (process.env.VERCEL === "1" && (!configuredUrl || local)) {
    throw new Error(
      "Vercel requires a persistent hosted DATABASE_URL or TURSO_DATABASE_URL. A local SQLite file cannot persist auction rooms across serverless requests."
    );
  }

  if (local) {
    const filePath = url.startsWith("file:/")
      ? fileURLToPath(url)
      : resolve(url.slice("file:".length));
    await mkdir(dirname(filePath), { recursive: true });
    url = pathToFileURL(filePath).href;
  }

  const client = createClient({
    url,
    authToken: local ? undefined : (process.env.DATABASE_AUTH_TOKEN?.trim() || process.env.TURSO_AUTH_TOKEN?.trim()),
    // Applied to every pooled connection. Keep native waits short so async
    // retries can yield the event loop when another process owns the file lock.
    timeout: local ? 100 : undefined,
    // A writer is held exclusively by the application queue. Its pool can be
    // refreshed after a failed native BEGIN without interrupting any readers.
    ...(writer && local ? { concurrency: 1 } : {}),
  });
  return { client, local };
}

async function initializeDatabase(): Promise<Database> {
  const { client, local } = await createDatabaseConnection();
  try {
    if (local) {
      await client.execute("PRAGMA journal_mode = WAL");
    }
    // Idempotent startup also works on a fresh checkout, without a CLI migration.
    await client.execute(`CREATE TABLE IF NOT EXISTS auction_rooms (
      code TEXT PRIMARY KEY NOT NULL,
      state_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`);
    await client.execute(`CREATE TABLE IF NOT EXISTS shared_player_catalog (
      id TEXT PRIMARY KEY NOT NULL,
      players_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    await client.execute(`CREATE TABLE IF NOT EXISTS auction_seasons (
      room_code TEXT PRIMARY KEY NOT NULL,
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`);
    await client.execute(`CREATE TABLE IF NOT EXISTS room_creation_requests (
      key_hash TEXT PRIMARY KEY NOT NULL,
      request_json TEXT NOT NULL,
      room_code TEXT NOT NULL,
      member_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    await client.execute(`CREATE TABLE IF NOT EXISTS catalog_editor_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    await client.execute(`CREATE TABLE IF NOT EXISTS room_deletions (
      code TEXT PRIMARY KEY NOT NULL,
      host_token_hash TEXT NOT NULL,
      deleted_at INTEGER NOT NULL
    )`);
    await client.batch(AUTH_SCHEMA_SQL, "write");
    return drizzle(client, { schema });
  } catch (error) {
    client.close();
    throw error;
  }
}

export function getDb(): Promise<Database> {
  // Share initialization and the connection during concurrent requests and dev reloads.
  databaseGlobal.pavilionDatabase ??= initializeDatabase().catch((error: unknown) => {
    databaseGlobal.pavilionDatabase = undefined;
    throw error;
  });
  return databaseGlobal.pavilionDatabase;
}

type WriteTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function withDatabaseWrite<Result>(work: (transaction: WriteTransaction) => Promise<Result>): Promise<Result> {
  await getDb(); // Ensure schema initialization completes before opening the writer.
  databaseGlobal.pavilionWriteDatabase ??= createDatabaseConnection(true).then(({ client, local }) => ({
    database: drizzle(client, { schema }), client, local,
  })).catch((error: unknown) => {
    databaseGlobal.pavilionWriteDatabase = undefined;
    throw error;
  });
  const { database, client, local } = await databaseGlobal.pavilionWriteDatabase;
  databaseGlobal.pavilionDatabaseWriteQueue ??= createDatabaseWriteQueue();
  return databaseGlobal.pavilionDatabaseWriteQueue(
    transaction => database.transaction(transaction), work,
    local ? async () => { client.reconnect(); } : undefined,
  );
}
