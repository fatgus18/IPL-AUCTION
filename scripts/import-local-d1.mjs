import { mkdir, open, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { CREATE_ROOMS_SQL, databaseConfig } from "./init-db.mjs";

const { default: nextEnv } = await import("@next/env");
nextEnv.loadEnvConfig(process.cwd());

async function sqliteFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sqliteFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".sqlite")) files.push(path);
  }
  return files;
}

async function readRooms(filePath) {
  if (!(await stat(filePath)).isFile()) throw new Error("The source must be an existing SQLite file.");
  const client = createClient({ url: pathToFileURL(filePath).href });
  try {
    // This connection never changes the original D1 database.
    await client.execute("PRAGMA query_only = ON");
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auction_rooms'");
    if (!tables.rows.length) return null;
    const result = await client.execute("SELECT code, state_json, version, created_at FROM auction_rooms");
    return result.rows;
  } finally {
    client.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--source")) {
    throw new Error("Usage: npm run db:import-local-d1 -- [--source path/to/old.sqlite]");
  }
  const config = databaseConfig();
  if (!config.filePath) throw new Error("This import only writes to a local file DATABASE_URL.");
  const candidates = args.length ? [resolve(args[1])] : await sqliteFiles(resolve(".wrangler/state/v3/d1"));
  const matches = [];
  for (const source of candidates) {
    const rooms = await readRooms(source);
    if (rooms !== null) matches.push({ source, rooms });
  }
  if (matches.length !== 1) {
    throw new Error(`Found ${matches.length} local D1 databases with auction rooms. Use --source to select exactly one existing database.`);
  }
  const { source, rooms } = matches[0];
  if (resolve(source) === resolve(config.filePath)) throw new Error("Source and destination must be different files.");
  await mkdir(dirname(config.filePath), { recursive: true });
  // Reserve a new file exclusively so an existing local database is never overwritten.
  try {
    const destination = await open(config.filePath, "wx");
    await destination.close();
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("The destination database already exists. Import before first startup, or choose a new DATABASE_URL file path.");
    throw error;
  }
  const destination = createClient({ url: config.url });
  try {
    await destination.batch([
      CREATE_ROOMS_SQL,
      ...rooms.map((room) => ({
        sql: "INSERT INTO auction_rooms (code, state_json, version, created_at) VALUES (?, ?, ?, ?)",
        args: [room.code, room.state_json, room.version, room.created_at],
      })),
    ], "write");
    console.log(`Imported ${rooms.length} auction room(s). The original D1 database is unchanged.`);
  } finally {
    destination.close();
  }
}

try {
  await main();
} catch (error) {
  // Deliberately omit SQL, stored room data, and credentials from error output.
  if (error instanceof Error && error.constructor === Error) console.error(error.message);
  else console.error("The local database import failed. Check the source file and destination directory permissions.");
  process.exitCode = 1;
}
