import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, withDatabaseWrite } from "@/db";
import { auctionRooms, catalogEditorSessions, roomCreationRequests, roomDeletions, sharedPlayerCatalog } from "@/db/schema";
import {
  applyAction, AuctionError, cleanText, createDemoState, createRoomState, DEFAULT_SETTINGS, upgradeRoomCatalog, upgradeRoomTeams,
  type AuctionAction, type Member, type Player, type RoomState,
} from "@/lib/auction";
import { readSharedCatalogVersion, readSharedPlayerCatalog, SHARED_CATALOG_ID } from "@/lib/player-catalog-store";
import { createRoomPollCache } from "@/lib/room-poll-cache";
import { ownTargetPicks, validateTargetPicks, type PrivateTargetPicks } from "@/lib/target-picks";
import { DatabaseWriteBusyError } from "@/lib/database-write-queue";
import { createTeamAccess, deriveTeamPassword, matchesTeamPassword, type TeamAccessCredential } from "@/lib/room-access";
import {
  availableCatalogPlayers, findDuplicatePlayer, hasProtectedReference, syncRoomPlayerCatalog,
  type SharedPlayerCatalog,
} from "@/lib/shared-player-catalog";

// Credential hashes stay outside RoomState and are never returned to a browser.
type StoredRoom = { state: RoomState; tokenHashes: Record<string, string>; teamAccess?: TeamAccessCredential; privateTargetPicks?: PrivateTargetPicks };
type SessionResponse = { state: RoomState; token: string; memberId: string };
const MAX_BODY_BYTES = 32768;
const ROOM_CAPACITY = 50;
const pollCache = createRoomPollCache();
const CATALOG_EDITOR_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
type CatalogAction = Extract<AuctionAction, { type: "add_player" | "update_player" | "delete_player" }>;
type WriteTransaction = Parameters<Parameters<typeof withDatabaseWrite>[0]>[0];

function secureToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (value) => alphabet[value % alphabet.length]).join("");
}

function normalizeCode(raw: string): string {
  const code = raw.toUpperCase().trim();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new AuctionError("Enter a six-character room code.");
  return code;
}

function credentialToken(request: Request): string {
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new AuctionError("Join this room to continue.", 401, "UNAUTHORIZED");
  return token;
}

async function credentialHash(request: Request): Promise<string> {
  return hashToken(credentialToken(request));
}

function identifyMember(room: StoredRoom, hash: string): Member {
  const memberId = Object.keys(room.tokenHashes).find((id) => room.tokenHashes[id] === hash);
  const member = room.state.members.find((entry) => entry.id === memberId);
  if (!member) throw new AuctionError("Your room session has expired. Join again to continue.", 401, "UNAUTHORIZED");
  return member;
}

function snapshot(room: StoredRoom, memberId: string): RoomState {
  const state = { ...room.state, serverTime: Date.now() };
  // Never copy a prior response projection into another member's response.
  delete state.myTargetPicks;
  const picks = ownTargetPicks(room.state, memberId, room.privateTargetPicks);
  if (picks) state.myTargetPicks = picks;
  return state;
}

function requirePracticeHost(room: StoredRoom, member: Member): void {
  if (room.state.mode !== "practice" || member.id !== room.state.hostId || member.role !== "auctioneer") {
    throw new AuctionError("Only the owner of a practice session can do that.", 403, "FORBIDDEN");
  }
}

function requireRoomCreator(room: StoredRoom, member: Member): void {
  if (member.id !== room.state.hostId || member.role !== "auctioneer") {
    throw new AuctionError("Only the person who created this room can do that.", 403, "FORBIDDEN");
  }
}

function requireTeamPassword(room: StoredRoom, password: unknown): void {
  if (!room.teamAccess) {
    throw new AuctionError("The room creator needs to open Room settings to activate team access. You can join as a spectator meanwhile.", 403, "TEAM_ACCESS_NOT_READY");
  }
  if (password === undefined || password === null || password === "") {
    throw new AuctionError("Ask the room creator for the team password to take a team seat.", 403, "TEAM_PASSWORD_REQUIRED");
  }
  if (!matchesTeamPassword(room.teamAccess, password)) {
    throw new AuctionError("That team password does not match. Ask the room creator for the correct password.", 403, "TEAM_PASSWORD_INVALID");
  }
}

function deletedRoomError(): AuctionError {
  return new AuctionError("The creator has deleted this auction room.", 410, "ROOM_DELETED");
}

function availablePool(players: Player[]): Player[] {
  return availableCatalogPlayers(players);
}

function installFreshCatalog(state: RoomState, catalog: SharedPlayerCatalog): void {
  state.players = availablePool(catalog.players);
  state.sharedCatalogVersion = catalog.version;
  state.catalogCount = catalog.players.length;
  if (state.currentPlayerId && !state.players.some(player => player.id === state.currentPlayerId)) {
    state.currentPlayerId = null; state.currentBid = 0; state.leadingTeamId = null;
    state.phase = "waiting"; state.lastBidAt = null; state.bidHistory = [];
    state.activity = state.activity.filter(entry => entry.type === "room");
  }
}

async function practiceSource(value: unknown): Promise<RoomState | undefined> {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuctionError("A saved practice session is required.");
  }
  const source = value as Record<string, unknown>;
  if (typeof source.code !== "string" || typeof source.token !== "string" || !/^[a-f0-9]{64}$/i.test(source.token)) {
    throw new AuctionError("Your practice session credentials are invalid.", 401, "UNAUTHORIZED");
  }
  const room = await readStoredRoom(normalizeCode(source.code));
  requirePracticeHost(room, identifyMember(room, await hashToken(source.token)));
  return room.state;
}

async function readStoredRoom(code: string): Promise<StoredRoom> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rows = await (await getDb()).select().from(auctionRooms).where(eq(auctionRooms.code, code)).limit(1);
    if (!rows[0]) {
      const deleted = await (await getDb()).select({ code: roomDeletions.code }).from(roomDeletions).where(eq(roomDeletions.code, code)).limit(1);
      if (deleted[0]) throw deletedRoomError();
      throw new AuctionError("That room was not found. Check the code with your auctioneer.", 404, "ROOM_NOT_FOUND");
    }
    const room = JSON.parse(rows[0].stateJson) as StoredRoom;
    room.state.version = rows[0].version;
    const catalog = await readSharedPlayerCatalog();
    const legacy = room.state.sharedCatalogVersion === undefined ? upgradeRoomCatalog(room.state) : room.state;
    const upgraded = upgradeRoomTeams(syncRoomPlayerCatalog(legacy, catalog));
    if (upgraded === room.state) {
      pollCache.remember(room.state, room.tokenHashes);
      return room;
    }
    room.state = upgraded;
    if (await persistIfCurrent(code, rows[0].version, room)) {
      pollCache.remember(room.state, room.tokenHashes);
      return room;
    }
  }
  throw new AuctionError("The room is updating its player catalog. Please try again.", 409, "ROOM_BUSY");
}

/** SQLite compare-and-swap makes bids, room locks, team claims, and purse debits atomic. */
async function persistIfCurrent(code: string, expectedVersion: number, room: StoredRoom): Promise<boolean> {
  return withDatabaseWrite(async tx => {
    const catalogVersion = await readSharedCatalogVersion(tx);
    // A global deletion/edit racing a selection or bid must force fresh validation.
    if (room.state.sharedCatalogVersion !== catalogVersion) return false;
    const rows = await tx.update(auctionRooms).set({
      stateJson: JSON.stringify(room), version: room.state.version,
    }).where(and(eq(auctionRooms.code, code), eq(auctionRooms.version, expectedVersion)))
      .returning({ code: auctionRooms.code });
    return rows.length === 1;
  });
}

async function persistCatalogAction(
  code: string, expectedVersion: number, room: StoredRoom, action: AuctionAction, actorId: string,
): Promise<boolean> {
  return withDatabaseWrite(async tx => {
    const catalog = await readSharedPlayerCatalog(tx);
    const existing = await tx.select({ version: auctionRooms.version }).from(auctionRooms).where(eq(auctionRooms.code, code)).limit(1);
    if (existing[0]?.version !== expectedVersion || room.state.sharedCatalogVersion !== catalog.version) return false;
    const nextCatalog = await writeCatalogAction(tx, catalog, requireCatalogAction(action), room.state, actorId);
    room.state = syncRoomPlayerCatalog(room.state, nextCatalog);
    await tx.update(auctionRooms).set({ stateJson: JSON.stringify(room), version: room.state.version })
      .where(and(eq(auctionRooms.code, code), eq(auctionRooms.version, expectedVersion)));
    return true;
  });
}

function requireCatalogAction(action: unknown): CatalogAction {
  if (!action || typeof action !== "object" || !("type" in action)) {
    throw new AuctionError("A player catalog action is required.");
  }
  if (!["add_player", "update_player", "delete_player"].includes(String(action.type))) {
    throw new AuctionError("Catalog editing cannot change an auction room.", 403, "CATALOG_ACTION_FORBIDDEN");
  }
  return action as CatalogAction;
}

/** The lobby and room auctioneers share one atomic catalog mutation path. */
async function writeCatalogAction(
  tx: WriteTransaction, catalog: SharedPlayerCatalog, action: CatalogAction, context: RoomState, actorId: string,
): Promise<SharedPlayerCatalog> {
  const catalogView: RoomState = {
    ...context, players: availablePool(catalog.players), currentPlayerId: null,
    currentBid: 0, leadingTeamId: null, phase: "waiting",
  };
  // Validate shape, player fields, identifiers and duplicate identities before
  // consulting room references. This also keeps malformed input out of SQL.
  const changed = applyAction(catalogView, action, actorId);
  if (action.type === "add_player" || action.type === "update_player") {
    const candidate = changed.players.find(player => player.id === action.player.id) || changed.players.at(-1)!;
    if (findDuplicatePlayer(changed.players, candidate)) {
      throw new AuctionError("This player is already in the shared pool. Update their existing profile instead.", 409, "PLAYER_EXISTS");
    }
    if (action.type === "add_player") {
      const references = await tx.select({ code: auctionRooms.code }).from(auctionRooms).where(sql`EXISTS (
        SELECT 1 FROM json_each(${auctionRooms.stateJson}, '$.state.players')
        WHERE json_extract(value, '$.id') = ${candidate.id}
      )`).limit(1);
      if (references.length) {
        throw new AuctionError("This player ID belongs to a saved auction record. Import the player with a new ID to preserve auction history.", 409, "PLAYER_ID_RESERVED");
      }
    }
  }
  if (action.type === "delete_player") {
    const rooms = await tx.select({ stateJson: auctionRooms.stateJson }).from(auctionRooms);
    if (rooms.some(row => hasProtectedReference((JSON.parse(row.stateJson) as StoredRoom).state, action.playerId))) {
      throw new AuctionError("This player is on an auction table or in a purchased squad in a saved auction. Players with those references cannot be removed from the shared pool.", 409, "PLAYER_IN_USE");
    }
  }
  const nextCatalog = { players: availablePool(changed.players), version: catalog.version + 1 };
  await tx.update(sharedPlayerCatalog).set({
    playersJson: JSON.stringify(nextCatalog.players), version: nextCatalog.version, updatedAt: Date.now(),
  }).where(and(eq(sharedPlayerCatalog.id, SHARED_CATALOG_ID), eq(sharedPlayerCatalog.version, catalog.version)));
  return nextCatalog;
}

/** An explicit edit grants only catalog access. Opening the homepage remains read-only. */
export async function createCatalogEditor(): Promise<{ token: string }> {
  const token = secureToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  await withDatabaseWrite(async tx => {
    await tx.delete(catalogEditorSessions).where(lt(catalogEditorSessions.expiresAt, now));
    await tx.insert(catalogEditorSessions).values({ tokenHash, createdAt: now, expiresAt: now + CATALOG_EDITOR_LIFETIME_MS });
  });
  return { token };
}

export async function actOnCatalog(request: Request, value: unknown): Promise<SharedPlayerCatalog> {
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new AuctionError("Start a catalog editing session to continue.", 401, "UNAUTHORIZED");
  const tokenHash = await hashToken(token);
  let action = requireCatalogAction(value);
  if (action.type === "add_player" && action.player && !action.player.id) {
    action = { ...action, player: { ...action.player, id: `player-${crypto.randomUUID()}` } };
  }
  return withDatabaseWrite(async tx => {
    const editor = await tx.select({ expiresAt: catalogEditorSessions.expiresAt }).from(catalogEditorSessions)
      .where(eq(catalogEditorSessions.tokenHash, tokenHash)).limit(1);
    if (!editor[0] || editor[0].expiresAt <= Date.now()) {
      throw new AuctionError("Your catalog editing session expired. Reopen the editor to continue.", 401, "UNAUTHORIZED");
    }
    const catalog = await readSharedPlayerCatalog(tx);
    const now = Date.now();
    const actorId = "catalog-editor";
    // An ephemeral validation context reuses authoritative player rules; it is
    // never inserted into auction_rooms or returned as an auction session.
    const context: RoomState = {
      id: "catalog", code: "", name: "Player pool", version: catalog.version,
      createdAt: now, serverTime: now, hostId: actorId,
      members: [{ id: actorId, name: "Catalog editor", role: "auctioneer", teamId: null, joinedAt: now, lastSeenAt: now, flagRaisedAt: null }],
      players: [], teams: [], currentPlayerId: null, currentBid: 0, leadingTeamId: null,
      phase: "waiting", lastBidAt: null, bidHistory: [], activity: [], settings: { ...DEFAULT_SETTINGS },
    };
    return writeCatalogAction(tx, catalog, action, context, actorId);
  });
}

type CreationRequest = { keyHash: string; requestJson: string };

function validateCreationRequest(existing: { requestJson: string }, creation: CreationRequest): void {
  if (existing.requestJson !== creation.requestJson) {
    throw new AuctionError("This room creation attempt belongs to different room details. Recover the original room first.", 409, "CREATION_KEY_REUSED");
  }
}

async function insertRoomWithCatalog(room: StoredRoom, creation?: CreationRequest): Promise<StoredRoom | undefined> {
  return withDatabaseWrite(async tx => {
    if (creation) {
      const existing = await tx.select().from(roomCreationRequests).where(eq(roomCreationRequests.keyHash, creation.keyHash)).limit(1);
      if (existing[0]) {
        validateCreationRequest(existing[0], creation);
        const rows = await tx.select().from(auctionRooms).where(eq(auctionRooms.code, existing[0].roomCode)).limit(1);
        if (!rows[0]) throw deletedRoomError();
        const saved = JSON.parse(rows[0].stateJson) as StoredRoom;
        saved.state.version = rows[0].version;
        if (identifyMember(saved, creation.keyHash).id !== existing[0].memberId) {
          throw new AuctionError("This room session is no longer available.", 401, "UNAUTHORIZED");
        }
        return saved;
      }
    }
    // Never reissue a code whose deleted room may still be open in another tab.
    const deleted = await tx.select({ code: roomDeletions.code }).from(roomDeletions).where(eq(roomDeletions.code, room.state.code)).limit(1);
    if (deleted[0]) return undefined;
    installFreshCatalog(room.state, await readSharedPlayerCatalog(tx));
    const rows = await tx.insert(auctionRooms).values({
      code: room.state.code, stateJson: JSON.stringify(room), version: room.state.version, createdAt: room.state.createdAt,
    }).onConflictDoNothing().returning({ code: auctionRooms.code });
    if (!rows.length) return undefined;
    if (creation) await tx.insert(roomCreationRequests).values({
      ...creation, roomCode: room.state.code, memberId: room.state.hostId, createdAt: room.state.createdAt,
    });
    return room;
  });
}

export async function createRoom(body: Record<string, unknown>): Promise<SessionResponse> {
  const name = cleanText(body.name, "Room name");
  const hostName = cleanText(body.hostName, "Your name", 40);
  if (body.creationKey !== undefined && (typeof body.creationKey !== "string" || !/^[a-f0-9]{64}$/.test(body.creationKey))) {
    throw new AuctionError("The room recovery key is invalid.", 400, "INVALID_CREATION_KEY");
  }
  const token = typeof body.creationKey === "string" ? body.creationKey : secureToken();
  const hash = await hashToken(token);
  const creation = body.creationKey === undefined ? undefined : { keyHash: hash, requestJson: JSON.stringify({ name, hostName }) };
  // A completed retry is read-only and does not queue behind unrelated bids.
  if (creation) {
    const existing = await (await getDb()).select().from(roomCreationRequests).where(eq(roomCreationRequests.keyHash, hash)).limit(1);
    if (existing[0]) {
      validateCreationRequest(existing[0], creation);
      const saved = await readStoredRoom(existing[0].roomCode);
      const savedMember = identifyMember(saved, hash);
      if (savedMember.id !== existing[0].memberId) throw new AuctionError("This room session is no longer available.", 401, "UNAUTHORIZED");
      return { state: snapshot(saved, savedMember.id), token, memberId: savedMember.id };
    }
  }
  // Accept old clients' practice credentials, but the browser no longer chooses the pool.
  await practiceSource(body.practiceSession);
  const now = Date.now();
  const member: Member = {
    id: crypto.randomUUID(), name: hostName, role: "auctioneer", teamId: null,
    joinedAt: now, lastSeenAt: now, flagRaisedAt: null,
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const state = createRoomState(code, name, member, now);
    const room: StoredRoom = { state, tokenHashes: { [member.id]: hash }, teamAccess: createTeamAccess(token, state.id) };
    const saved = await insertRoomWithCatalog(room, creation);
    if (saved) return { state: snapshot(saved, saved.state.hostId), token, memberId: saved.state.hostId };
  }
  throw new AuctionError("Could not create a room. Please try again.", 503, "ROOM_CREATE_RETRY");
}

export async function createPractice(): Promise<SessionResponse> {
  const token = secureToken();
  const hash = await hashToken(token);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const state = createDemoState();
    state.id = code;
    state.code = code;
    state.mode = "practice";
    const room: StoredRoom = { state, tokenHashes: { [state.hostId]: hash } };
    if (await insertRoomWithCatalog(room)) return { state: snapshot(room, state.hostId), token, memberId: state.hostId };
  }
  throw new AuctionError("Could not save your practice session. Please try again.", 503, "ROOM_CREATE_RETRY");
}

export async function joinRoom(rawCode: string, body: Record<string, unknown>): Promise<SessionResponse> {
  const code = normalizeCode(rawCode);
  const name = cleanText(body.name, "Your name", 40);
  const teamId = body.teamId ?? null;
  if (teamId !== null && typeof teamId !== "string") throw new AuctionError("Choose a valid team.");
  const token = secureToken();
  const hash = await hashToken(token);
  const id = crypto.randomUUID();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const room = await readStoredRoom(code);
    if (room.state.mode === "practice") throw new AuctionError("Practice sessions are private. Ask the auctioneer to create a room to play together.", 403, "PRIVATE_PRACTICE");
    const before = room.state.version;
    const now = Date.now();
    if (room.state.members.length >= ROOM_CAPACITY) throw new AuctionError("This room has reached its 50-person capacity.", 409, "ROOM_FULL");
    if (teamId && !room.state.teams.some((team) => team.id === teamId)) throw new AuctionError("Choose a valid team.");
    if (teamId && room.state.endedAt !== undefined) throw new AuctionError("This auction has ended. You can still join as a spectator to view its recap.", 409, "AUCTION_ENDED");
    if (teamId) requireTeamPassword(room, body.teamPassword);
    if (teamId && room.state.members.some((member) => member.teamId === teamId)) throw new AuctionError("This team already has a manager. Choose another team or join as a spectator.", 409, "TEAM_TAKEN");
    room.state.members.push({ id, name, role: teamId ? "bidder" : "spectator", teamId, joinedAt: now, lastSeenAt: now, flagRaisedAt: null });
    room.state.activity.push({ id: `join-${id}`, type: "room", text: `${name} joined the room.`, at: now, memberId: id });
    room.state.activity = room.state.activity.slice(-150);
    room.state.version += 1; room.state.serverTime = now; room.tokenHashes[id] = hash;
    if (await persistIfCurrent(code, before, room)) return { state: snapshot(room, id), token, memberId: id };
  }
  throw new AuctionError("The room is busy. Please try joining again.", 409, "ROOM_BUSY");
}

/** Private creator-only response, kept out of every ordinary room snapshot. */
export async function getRoomTeamAccess(rawCode: string, request: Request): Promise<{ teamPassword: string }> {
  const code = normalizeCode(rawCode);
  const token = credentialToken(request);
  const hash = await hashToken(token);
  return withDatabaseWrite(async tx => {
    const rows = await tx.select().from(auctionRooms).where(eq(auctionRooms.code, code)).limit(1);
    if (!rows[0]) {
      const deleted = await tx.select({ code: roomDeletions.code }).from(roomDeletions).where(eq(roomDeletions.code, code)).limit(1);
      if (deleted[0]) throw deletedRoomError();
      throw new AuctionError("That room was not found.", 404, "ROOM_NOT_FOUND");
    }
    const room = JSON.parse(rows[0].stateJson) as StoredRoom;
    room.state.version = rows[0].version;
    requireRoomCreator(room, identifyMember(room, hash));
    if (!room.teamAccess) {
      // Legacy rooms keep all seats and auction history. Only their creator can
      // enable additional team admissions; opening the page cannot reset them.
      room.teamAccess = createTeamAccess(token, room.state.id);
      room.state.version += 1;
      room.state.serverTime = Date.now();
      await tx.update(auctionRooms).set({ stateJson: JSON.stringify(room), version: room.state.version })
        .where(eq(auctionRooms.code, code));
    }
    return { teamPassword: deriveTeamPassword(token, room.state.id, room.teamAccess.salt) };
  });
}

/** Room deletion and its tombstone commit together. Stale writes can only
 * update an existing row, and a creation-key retry cannot recreate this room. */
export async function deleteRoom(
  rawCode: string, request: Request, body: Record<string, unknown>,
): Promise<{ deleted: true; code: string }> {
  const code = normalizeCode(rawCode);
  const hash = await credentialHash(request);
  if (body.confirmationCode !== code) {
    throw new AuctionError("Type the room code to confirm deletion.", 400, "ROOM_DELETE_CONFIRMATION_REQUIRED");
  }
  const result = await withDatabaseWrite(async tx => {
    const rows = await tx.select().from(auctionRooms).where(eq(auctionRooms.code, code)).limit(1);
    if (!rows[0]) {
      const deleted = await tx.select().from(roomDeletions).where(eq(roomDeletions.code, code)).limit(1);
      if (!deleted[0]) throw new AuctionError("That room was not found.", 404, "ROOM_NOT_FOUND");
      if (deleted[0].hostTokenHash !== hash) {
        throw new AuctionError("Only the person who created this room can do that.", 403, "FORBIDDEN");
      }
      return { deleted: true as const, code };
    }
    const room = JSON.parse(rows[0].stateJson) as StoredRoom;
    requireRoomCreator(room, identifyMember(room, hash));
    await tx.insert(roomDeletions).values({ code, hostTokenHash: hash, deletedAt: Date.now() });
    await tx.delete(auctionRooms).where(eq(auctionRooms.code, code));
    // Keep room_creation_requests: their old key now resolves to ROOM_DELETED.
    return { deleted: true as const, code };
  });
  pollCache.forget(code);
  return result;
}

export async function getRoom(rawCode: string, request: Request): Promise<RoomState> {
  const code = normalizeCode(rawCode);
  const hash = await credentialHash(request);
  let room = await readStoredRoom(code);
  const member = identifyMember(room, hash);
  // Heartbeat at most once per 25 seconds per member; ordinary polls are read-only.
  if (room.state.mode !== "practice" && Date.now() - member.lastSeenAt >= 25000) {
    const before = room.state.version;
    room.state = applyAction(room.state, { type: "ping" }, member.id);
    if (!await persistIfCurrent(code, before, room)) {
      room = await readStoredRoom(code);
      identifyMember(room, hash);
    }
  }
  pollCache.remember(room.state, room.tokenHashes);
  return snapshot(room, member.id);
}

/** A stable poll reads only two indexed integers after authentication. A catalog
 * edit or membership change invalidates the fast path before any response. */
export async function pollRoom(rawCode: string, request: Request): Promise<{ state: RoomState } | { unchanged: true; version: number; serverTime: number }> {
  const since = new URL(request.url).searchParams.get("since");
  if (since !== null && /^\d+$/.test(since) && Number.isSafeInteger(Number(since))) {
    const code = normalizeCode(rawCode);
    const hash = await credentialHash(request);
    const rows = await (await getDb()).select({ version: auctionRooms.version, catalogVersion: sharedPlayerCatalog.version })
      .from(auctionRooms).leftJoin(sharedPlayerCatalog, eq(sharedPlayerCatalog.id, SHARED_CATALOG_ID))
      .where(eq(auctionRooms.code, code)).limit(1);
    if (rows[0]?.version === Number(since)) {
      const cached = pollCache.check(code, rows[0].version, rows[0].catalogVersion, hash);
      if (cached === "unauthorized") throw new AuctionError("Your room session has expired. Join again to continue.", 401, "UNAUTHORIZED");
      if (cached === "unchanged") return { unchanged: true, version: rows[0].version, serverTime: Date.now() };
    }
  }
  const state = await getRoom(rawCode, request);
  return since !== null && /^\d+$/.test(since) && Number(since) === state.version
    ? { unchanged: true, version: state.version, serverTime: state.serverTime }
    : { state };
}

export async function actInRoom(
  rawCode: string,
  request: Request,
  action: AuctionAction,
  options: { memberId?: unknown; resetPractice?: unknown } = {},
): Promise<RoomState> {
  const code = normalizeCode(rawCode);
  const hash = await credentialHash(request);
  if (action?.type === "add_player" && action.player && !action.player.id) {
    action = { ...action, player: { ...action.player, id: `player-${crypto.randomUUID()}` } };
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const room = await readStoredRoom(code);
    const member = identifyMember(room, hash);
    const before = room.state.version;
    if (options.memberId !== undefined || options.resetPractice !== undefined) requirePracticeHost(room, member);
    if (options.resetPractice !== undefined && options.resetPractice !== true) throw new AuctionError("Invalid practice reset request.");
    if (options.resetPractice === true) {
      if (room.state.endedAt !== undefined) throw new AuctionError("This auction has ended. Create a new room to begin another auction.", 409, "AUCTION_ENDED");
      if (options.memberId !== undefined || action !== undefined) throw new AuctionError("Reset practice separately from other actions.");
      const previous = room.state;
      const reset = createDemoState({ hostName: member.name });
      reset.id = previous.id;
      reset.code = previous.code;
      reset.name = previous.name;
      reset.createdAt = previous.createdAt;
      reset.mode = "practice";
      reset.version = before + 1;
      installFreshCatalog(reset, await readSharedPlayerCatalog());
      reset.catalogVersion = previous.catalogVersion;
      reset.catalogDataRevision = previous.catalogDataRevision;
      // A curated pool may intentionally omit the original demonstration lot.
      if (!reset.players.some((player) => player.id === reset.currentPlayerId)) {
        reset.currentPlayerId = null;
        reset.currentBid = 0;
        reset.leadingTeamId = null;
        reset.phase = "waiting";
        reset.lastBidAt = null;
        reset.bidHistory = [];
        reset.activity = reset.activity.filter((entry) => entry.type === "room");
      }
      reset.activity.push({ id: `practice-reset-${reset.version}-${reset.serverTime}`, type: "room", text: "Practice restarted with the shared player pool.", at: reset.serverTime });
      room.state = reset;
      room.privateTargetPicks = {};
    } else {
      if (options.memberId !== undefined && (typeof options.memberId !== "string" || !room.state.members.some((entry) => entry.id === options.memberId))) {
        throw new AuctionError("Choose an available practice seat.");
      }
      const actorId = typeof options.memberId === "string" ? options.memberId : member.id;
      if (room.state.endedAt !== undefined && action?.type === "set_target_picks") {
        throw new AuctionError("This auction has ended. Your saved targets remain available to view.", 409, "AUCTION_ENDED");
      }
      if (action?.type === "set_target_picks") {
        // Always authenticate as the bearer, never a practice impersonation.
        const picks = validateTargetPicks(room.state, member, action, room.privateTargetPicks);
        room.privateTargetPicks = { ...room.privateTargetPicks, [member.id]: picks };
        room.state = { ...room.state, version: before + 1, serverTime: Date.now() };
        if (await persistIfCurrent(code, before, room)) return snapshot(room, member.id);
        continue;
      }
      if (room.state.mode !== "practice" && action?.type === "claim_team" && action.teamId !== null && action.teamId !== member.teamId) {
        if (room.state.endedAt !== undefined) throw new AuctionError("This auction has ended. Team ownership is preserved in its recap.", 409, "AUCTION_ENDED");
        requireTeamPassword(room, action.teamPassword);
      }
      const removedHistory = action?.type === "delete_player" && room.state.bidHistory.some(bid => bid.playerId === action.playerId)
        ? room.state.players.find(player => player.id === action.playerId) : undefined;
      room.state = applyAction(room.state, action, actorId);
      if (removedHistory) room.state.players.push({ ...removedHistory, catalogArchived: true });
      if (action.type === "select_player") {
        // Reopening an unsold lot takes the current common terms; a live lot kept its snapshot.
        const catalog = await readSharedPlayerCatalog();
        if (catalog.version !== room.state.sharedCatalogVersion) continue;
        room.state = syncRoomPlayerCatalog(room.state, catalog, Date.now(), true);
      }
      if (action.type === "leave") delete room.tokenHashes[actorId];
      if (action.type === "leave" || (action.type === "claim_team" && action.teamId !== member.teamId)) {
        if (room.privateTargetPicks) delete room.privateTargetPicks[actorId];
      }
      if (["add_player", "update_player", "delete_player"].includes(action.type)) {
        if (await persistCatalogAction(code, before, room, action, actorId)) return snapshot(room, member.id);
        continue;
      }
    }
    if (await persistIfCurrent(code, before, room)) return snapshot(room, member.id);
    // Reapply against fresh state. A competing bid fails expectedAmount, and a
    // successful lock makes every subsequent competing bid fail BIDDING_CLOSED.
  }
  throw new AuctionError("The room changed while processing your request. Please try again.", 409, "ROOM_BUSY");
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new AuctionError("Send a JSON request body.", 415);
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new AuctionError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AuctionError("Request body is required.");
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new AuctionError("Request is too large.", 413); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new AuctionError("Request body contains invalid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuctionError("Request body must be an object.");
  return body as Record<string, unknown>;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AuctionError) return jsonResponse({ error: error.message, code: error.code }, error.status);
  if (error instanceof DatabaseWriteBusyError) return jsonResponse({ error: error.message, code: error.code }, 503);
  // Never expose database state, stack traces, or credentials in HTTP errors.
  console.error("Auction request failed:", error instanceof Error ? error.message : "Unknown server failure");
  return jsonResponse({ error: "The auction service is temporarily unavailable. Please try again.", code: "SERVICE_UNAVAILABLE" }, 503);
}
