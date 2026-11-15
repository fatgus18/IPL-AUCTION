import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";

export const CREATE_ROOMS_SQL = `CREATE TABLE IF NOT EXISTS auction_rooms (
  code TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`;

export function databaseConfig() {
  let url = process.env.DATABASE_URL?.trim() || "file:./.data/pavilion.db";
  const local = url.startsWith("file:");
  if (process.env.VERCEL === "1" && (!process.env.DATABASE_URL?.trim() || local)) {
    throw new Error("Vercel requires a persistent hosted DATABASE_URL, such as libSQL/Turso.");
  }
  let filePath;
  if (local) {
    filePath = url.startsWith("file:/") ? fileURLToPath(url) : resolve(url.slice("file:".length));
    url = pathToFileURL(filePath).href;
  }
  return { url, filePath, authToken: local ? undefined : process.env.DATABASE_AUTH_TOKEN };
}

export async function initializeDatabase() {
  const config = databaseConfig();
  if (config.filePath) await mkdir(dirname(config.filePath), { recursive: true });
  const client = createClient({ url: config.url, authToken: config.authToken });
  try {
    if (config.filePath) {
      await client.execute("PRAGMA busy_timeout = 5000");
      await client.execute("PRAGMA journal_mode = WAL");
    }
    await client.execute(CREATE_ROOMS_SQL);
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Match Next.js: load .env.local/.env without overriding existing shell variables.
  const { default: nextEnv } = await import("@next/env");
  nextEnv.loadEnvConfig(process.cwd());
  try {
    const client = await initializeDatabase();
    client.close();
    console.log("Auction database is ready.");
  } catch {
    console.error("Database initialization failed. Check DATABASE_URL, its directory permissions, and hosted database credentials.");
    process.exitCode = 1;
  }
}
