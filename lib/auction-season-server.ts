import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, withDatabaseWrite } from "@/db";
import { auctionSeasons } from "@/db/schema";
import { AuctionError, type Member, type RoomState } from "./auction";
import { getSeasonRoomContext } from "./auction-server";
import { buildAuctionSeason, emptyAuctionSeason, matchSeasonRows, seasonSourceKey, type StoredAuctionSeason, type SeasonMappings } from "./auction-season";
import { fetchSeasonSource, normalizeSeasonSourceUrl, parseSeasonSourceImport, SeasonSourceError, type SeasonSourceSnapshot } from "./season-source";
import { getPlayerSeasonIdentity } from "./player-identities";

type WriteTransaction = Parameters<Parameters<typeof withDatabaseWrite>[0]>[0];
type SeasonRecord = { stored: StoredAuctionSeason; revision: number; updatedAt: number | null };
const FETCH_COOLDOWN_MS = 15_000;

function isCreator(context: { state: RoomState; member: Member }): boolean {
  return context.member.role === "auctioneer" && context.member.id === context.state.hostId;
}
function requireCreator(context: { state: RoomState; member: Member }): void {
  if (!isCreator(context)) throw new AuctionError("Only the room creator can change or refresh season data.", 403, "FORBIDDEN");
}
function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= Number.MAX_SAFE_INTEGER) {
    throw new AuctionError("A valid season revision is required.", 400, "SEASON_REVISION_REQUIRED");
  }
  return value as number;
}
function requireCurrent(actual: number, expected: number): void {
  if (actual !== expected) throw new AuctionError("Season data changed in another tab. Review the latest data and try again.", 409, "SEASON_CONFLICT");
}
function sourceOperation<T>(work: () => T): T {
  try { return work(); } catch (error) {
    if (error instanceof SeasonSourceError) throw new AuctionError(error.message, error.status, error.code);
    throw error;
  }
}
async function readSeason(code: string, tx?: WriteTransaction): Promise<SeasonRecord> {
  const rows = await (tx ?? await getDb()).select().from(auctionSeasons).where(eq(auctionSeasons.roomCode, code)).limit(1);
  return rows[0] ? { stored: JSON.parse(rows[0].stateJson) as StoredAuctionSeason, revision: rows[0].revision, updatedAt: rows[0].updatedAt }
    : { stored: emptyAuctionSeason(), revision: 0, updatedAt: null };
}
async function writeSeason(tx: WriteTransaction, code: string, stored: StoredAuctionSeason, revision: number, updatedAt: number): Promise<void> {
  await tx.insert(auctionSeasons).values({ roomCode: code, stateJson: JSON.stringify(stored), revision, updatedAt })
    .onConflictDoUpdate({ target: auctionSeasons.roomCode, set: { stateJson: JSON.stringify(stored), revision, updatedAt } });
}

export async function getAuctionSeason(code: string, request: Request) {
  const context = await getSeasonRoomContext(code, request);
  const record = await readSeason(context.state.code);
  return buildAuctionSeason(context.state, record.stored, { ...record, canManage: isCreator(context) });
}

function validateMappings(value: unknown, record: SeasonRecord, state: RoomState): SeasonMappings {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 1000) {
    throw new AuctionError("Choose valid player matches.", 400, "SEASON_MAPPING_INVALID");
  }
  const sourceKeys = new Set((record.stored.snapshot?.rows ?? []).map(seasonSourceKey));
  const playerIds = new Set(state.players.map(player => player.id));
  const used = new Set<string>();
  const mappings: SeasonMappings = {};
  for (const [key, id] of Object.entries(value)) {
    if (!sourceKeys.has(key) || typeof id !== "string" || !playerIds.has(id) || used.has(id) || key.length > 250) {
      throw new AuctionError("Each source player must match one different player in this room's pool.", 400, "SEASON_MAPPING_INVALID");
    }
    const source = record.stored.snapshot!.rows.find(row => seasonSourceKey(row) === key)!;
    const target = state.players.find(player => player.id === id)!;
    const targetProviderId = getPlayerSeasonIdentity(target).providerPlayerId;
    if (source.providerPlayerId && targetProviderId && source.providerPlayerId !== targetProviderId) {
      throw new AuctionError("Those players have different verified provider IDs. Choose a matching identity.", 400, "SEASON_MAPPING_ID_CONFLICT");
    }
    used.add(id); mappings[key] = id;
  }
  // Explicit matches may resolve an ambiguous identity but cannot steal a source row
  // already identified as another player by its stable provider ID.
  const automatic = matchSeasonRows(state.players, record.stored.snapshot?.rows ?? []);
  for (const row of automatic) {
    if (row.match === "id" && row.playerId && mappings[row.key] && mappings[row.key] !== row.playerId) {
      throw new AuctionError("This source already has a verified player ID. Choose that player or leave the automatic match.", 400, "SEASON_MAPPING_ID_CONFLICT");
    }
    if (row.playerId && used.has(row.playerId) && !mappings[row.key] && row.match === "id") {
      throw new AuctionError("That player already has a verified source row. Each player can score only once.", 400, "SEASON_MAPPING_ID_CONFLICT");
    }
  }
  return mappings;
}

function retainedMappings(stored: StoredAuctionSeason, snapshot: SeasonSourceSnapshot): SeasonMappings {
  if (stored.snapshot?.sourceUrl !== snapshot.sourceUrl) return {};
  const keys = new Set(snapshot.rows.map(seasonSourceKey));
  return Object.fromEntries(Object.entries(stored.mappings).filter(([key]) => keys.has(key)));
}

export async function updateAuctionSeason(code: string, request: Request, body: Record<string, unknown>) {
  const context = await getSeasonRoomContext(code, request);
  requireCreator(context);
  const expectedRevision = requireRevision(body.expectedRevision);
  if (!["configure", "fetch", "import", "map"].includes(String(body.type))) throw new AuctionError("Choose a valid season action.");
  const roomCode = context.state.code;
  if (body.type === "fetch") {
    const requestId = randomUUID();
    const reservation = await withDatabaseWrite(async tx => {
      requireCreator(await getSeasonRoomContext(roomCode, request, tx));
      const record = await readSeason(roomCode, tx);
      requireCurrent(record.revision, expectedRevision);
      const now = Date.now();
      if (record.stored.lastFetchAttemptAt && now - record.stored.lastFetchAttemptAt < FETCH_COOLDOWN_MS) {
        throw new AuctionError("Wait 15 seconds between source refreshes.", 429, "SEASON_FETCH_COOLDOWN");
      }
      const stored = { ...record.stored, lastFetchAttemptAt: now, fetchRequestId: requestId };
      await writeSeason(tx, roomCode, stored, record.revision, record.updatedAt ?? now);
      return { sourceUrl: stored.sourceUrl };
    });
    // Network work is deliberately outside the write transaction. A failed request
    // keeps every prior source row and score, and cannot recreate a deleted room.
    let snapshot: SeasonSourceSnapshot;
    try { snapshot = await fetchSeasonSource(reservation.sourceUrl); }
    catch (error) {
      if (error instanceof SeasonSourceError) throw new AuctionError(error.message, error.status, error.code);
      throw error;
    }
    await withDatabaseWrite(async tx => {
      requireCreator(await getSeasonRoomContext(roomCode, request, tx));
      const record = await readSeason(roomCode, tx);
      requireCurrent(record.revision, expectedRevision);
      if (record.stored.sourceUrl !== reservation.sourceUrl || record.stored.fetchRequestId !== requestId) {
        throw new AuctionError("The source changed during this refresh. Fetch the selected source again.", 409, "SEASON_CONFLICT");
      }
      const mappings = retainedMappings(record.stored, snapshot);
      await writeSeason(tx, roomCode, { ...record.stored, snapshot, method: "fetch", mappings, fetchRequestId: undefined }, record.revision + 1, Date.now());
    });
    return getAuctionSeason(roomCode, request);
  }

  // Parsing bounded import text is also outside the writer lock. Recheck the
  // revision and URL inside the transaction before any replacement is committed.
  const initial = await readSeason(roomCode);
  requireCurrent(initial.revision, expectedRevision);
  const imported = body.type === "import" ? sourceOperation(() => {
    if (typeof body.text !== "string") throw new AuctionError("Paste the source's MVP table to import.", 400, "SEASON_IMPORT_REQUIRED");
    return parseSeasonSourceImport(body.text, initial.stored.sourceUrl);
  }) : null;
  const configuredUrl = body.type === "configure" ? sourceOperation(() => {
    if (typeof body.sourceUrl !== "string") throw new AuctionError("Enter an ESPNcricinfo MVP page link.");
    return normalizeSeasonSourceUrl(body.sourceUrl);
  }) : null;
  await withDatabaseWrite(async tx => {
    const freshContext = await getSeasonRoomContext(roomCode, request, tx);
    requireCreator(freshContext);
    const record = await readSeason(roomCode, tx);
    requireCurrent(record.revision, expectedRevision);
    let stored = { ...record.stored, fetchRequestId: undefined };
    if (configuredUrl) stored = { ...stored, sourceUrl: configuredUrl };
    if (imported) {
      if (initial.stored.sourceUrl !== record.stored.sourceUrl) throw new AuctionError("The source changed. Import the table again.", 409, "SEASON_CONFLICT");
      stored = { ...stored, snapshot: imported, method: "import", mappings: retainedMappings(record.stored, imported) };
    }
    if (body.type === "map") stored = { ...stored, mappings: validateMappings(body.mappings, record, freshContext.state) };
    await writeSeason(tx, roomCode, stored, record.revision + 1, Date.now());
  });
  return getAuctionSeason(roomCode, request);
}
