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

export function databaseConfig(env = process.env) {
  const configuredUrl = env.DATABASE_URL?.trim() || env.TURSO_DATABASE_URL?.trim();
  let url = configuredUrl || "file:./.data/pavilion.db";
  const local = url.startsWith("file:");
  if (env.VERCEL === "1" && (!configuredUrl || local)) {
    throw new Error("Vercel requires a persistent hosted DATABASE_URL or TURSO_DATABASE_URL.");
  }
  let filePath;
  if (local) {
    filePath = url.startsWith("file:/") ? fileURLToPath(url) : resolve(url.slice("file:".length));
    url = pathToFileURL(filePath).href;
  }
  return { url, filePath, authToken: local ? undefined : (env.DATABASE_AUTH_TOKEN?.trim() || env.TURSO_AUTH_TOKEN?.trim()) };
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
    console.error("Database initialization failed. Check DATABASE_URL or TURSO_DATABASE_URL, directory permissions, and hosted database credentials.");
    process.exitCode = 1;
  }
}
