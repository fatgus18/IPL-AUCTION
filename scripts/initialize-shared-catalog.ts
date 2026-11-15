import { createClient } from "@libsql/client";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { applyAction, createRoomState, type Player } from "../lib/auction.ts";
import { availableCatalogPlayers, findDuplicatePlayer } from "../lib/shared-player-catalog.ts";

// Run once on this local installation, before starting the shared-catalog build.
// The preservation file is an explicitly audited list, not an indiscriminate merge of test rooms.
const file = process.argv[2];
if (!file) throw new Error("Usage: node --experimental-strip-types scripts/initialize-shared-catalog.ts <audited-players.json>");
const client = createClient({ url: "file:.data/pavilion.db" });
try {
  await mkdir(".data/backups", { recursive: true });
  const backup = resolve(`.data/backups/before-common-pool-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  await client.execute({ sql: "VACUUM INTO ?", args: [backup] });
  await client.execute("CREATE TABLE IF NOT EXISTS shared_player_catalog (id TEXT PRIMARY KEY NOT NULL, players_json TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  const current = await client.execute("SELECT id FROM shared_player_catalog WHERE id = 'common'");
  if (current.rows.length) throw new Error("The common catalog already exists; refusing to replace it. Use normal catalog actions to edit it.");
  const preserved = JSON.parse(await readFile(resolve(file), "utf8")) as Player[];
  if (!Array.isArray(preserved)) throw new Error("The audited input must be a player array.");
  const now = Date.now();
  const host = { id: "catalog-bootstrap", name: "Catalog setup", role: "auctioneer" as const, teamId: null, joinedAt: now, lastSeenAt: now, flagRaisedAt: null };
  let state = createRoomState("IMPORT", "Catalog setup", host, now);
  for (const player of preserved) {
    if (state.players.some(existing => existing.id === player.id) || findDuplicatePlayer(state.players, player)) throw new Error(`Duplicate preserved identity: ${player.name}`);
    state = applyAction(state, { type: "add_player", player }, host.id);
  }
  await client.execute({ sql: "INSERT INTO shared_player_catalog (id, players_json, version, updated_at) VALUES ('common', ?, 1, ?)", args: [JSON.stringify(availableCatalogPlayers(state.players)), now] });
  console.log(`Created the common catalog with ${state.players.length} players. Preserved: ${preserved.map(player => player.name).join(", ")}.`);
  console.log(`Backup: ${backup}`);
} finally { client.close(); }
