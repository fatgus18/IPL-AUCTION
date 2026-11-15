import { eq } from "drizzle-orm";
import { getDb, withDatabaseWrite, type Database } from "@/db";
import { sharedPlayerCatalog } from "@/db/schema";
import { createPlayerPool } from "@/lib/auction";
import { availableCatalogPlayers, type SharedPlayerCatalog } from "@/lib/shared-player-catalog";

export const SHARED_CATALOG_ID = "common";
export type CatalogStore = Pick<Database, "select" | "insert" | "update">;

// One committed version only: ordinary polls read a scalar instead of repeatedly
// transferring/parsing the complete catalog. Transaction snapshots never enter
// this cache because a rolled-back version may later be reused by another write.
let committedCatalog: SharedPlayerCatalog | undefined;

export async function readSharedCatalogVersion(store?: CatalogStore): Promise<number> {
  const rows = await (store || await getDb()).select({ version: sharedPlayerCatalog.version })
    .from(sharedPlayerCatalog).where(eq(sharedPlayerCatalog.id, SHARED_CATALOG_ID)).limit(1);
  return rows[0]?.version ?? (await readSharedPlayerCatalog(store)).version;
}

export async function readSharedPlayerCatalog(store?: CatalogStore): Promise<SharedPlayerCatalog> {
  const database = store || await getDb();
  if (!store && committedCatalog) {
    const version = await readSharedCatalogVersion(database);
    if (version === committedCatalog.version) return committedCatalog;
  }
  let rows = await database.select().from(sharedPlayerCatalog).where(eq(sharedPlayerCatalog.id, SHARED_CATALOG_ID)).limit(1);
  if (!rows.length) {
    if (!store) return withDatabaseWrite(transaction => readSharedPlayerCatalog(transaction));
    await database.insert(sharedPlayerCatalog).values({
      id: SHARED_CATALOG_ID, playersJson: JSON.stringify(availableCatalogPlayers(createPlayerPool())), version: 1, updatedAt: Date.now(),
    }).onConflictDoNothing();
    rows = await database.select().from(sharedPlayerCatalog).where(eq(sharedPlayerCatalog.id, SHARED_CATALOG_ID)).limit(1);
  }
  const catalog = { players: JSON.parse(rows[0].playersJson), version: rows[0].version };
  if (!store) committedCatalog = catalog;
  return catalog;
}
