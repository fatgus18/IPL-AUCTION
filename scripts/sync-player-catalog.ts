import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { upgradeRoomCatalog, type RoomState } from "../lib/auction.ts";

// This migration is for the local installation. Preserve a consistent backup before updating rooms.
const { default: nextEnv } = await import("@next/env");
nextEnv.loadEnvConfig(process.cwd());
const configured = process.env.DATABASE_URL?.trim() || "file:./.data/pavilion.db";
if (!configured.startsWith("file:") || process.env.VERCEL === "1") throw new Error("Run this migration against a local SQLite database only.");
const url = configured.startsWith("file:/") ? configured : pathToFileURL(resolve(configured.slice(5))).href;
const db = createClient({ url });
try {
  const rooms = await db.execute("SELECT code, version, state_json FROM auction_rooms");
  const updates = rooms.rows.flatMap(row => {
    const stored = JSON.parse(String(row.state_json)) as { state: RoomState; [key: string]: unknown };
    stored.state.version = Number(row.version);
    const updated = upgradeRoomCatalog(stored.state);
    return updated === stored.state ? [] : [{ code: String(row.code), before: Number(row.version), stored: { ...stored, state: updated } }];
  });
  if (!updates.length) {
    console.log("All existing rooms already have the latest player catalog.");
  } else {
    const backupDirectory = resolve(".data/backups");
    await mkdir(backupDirectory, { recursive: true });
    const backup = resolve(backupDirectory, `before-player-catalog-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    await db.execute({ sql: "VACUUM INTO ?", args: [backup] });
    let changed = 0;
    for (const update of updates) {
      const result = await db.execute({ sql: "UPDATE auction_rooms SET state_json = ?, version = ? WHERE code = ? AND version = ?", args: [JSON.stringify(update.stored), update.stored.state.version, update.code, update.before] });
      if (result.rowsAffected === 1) changed += 1;
    }
    console.log(`Updated ${changed} room(s). Preserved all existing bids, sales, squad allocations, and access credentials.`);
    console.log(`Backup: ${backup}`);
    if (changed !== updates.length) throw new Error("Some rooms changed during the import. Run the migration again to finish safely.");
  }
} finally { db.close(); }
