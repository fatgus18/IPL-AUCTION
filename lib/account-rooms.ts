import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb, withDatabaseWrite } from "@/db";
import { accountRooms } from "@/db/auth-schema";
import { auctionRooms } from "@/db/schema";
import { AuctionError, type RoomState } from "@/lib/auction";
import { recoverAccountRoom } from "@/lib/auction-server";
import { accountSecret, accountSession, requireAccountOrigin, requireAccountSession } from "@/lib/auth";
import { decryptRoomCredential, encryptRoomCredential } from "@/lib/account-credentials";
import { limitAccountRequest } from "@/lib/account-rate-limit";

type SavedCredential = { code: string; token: string; memberId: string };
type RoomSession = Awaited<ReturnType<typeof recoverAccountRoom>>;

function parseCredential(value: Record<string, unknown>): SavedCredential {
  const code = typeof value.code === "string" ? value.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{6}$/.test(code) || typeof value.token !== "string" || !/^[a-f0-9]{64}$/i.test(value.token) || typeof value.memberId !== "string" || !value.memberId || value.memberId.length > 100) {
    throw new AuctionError("A valid saved room session is required.", 400, "INVALID_ROOM_SESSION");
  }
  return { code, token: value.token, memberId: value.memberId };
}

async function attachCredential(userId: string, credential: SavedCredential): Promise<void> {
  await recoverAccountRoom(credential.code, credential.token, credential.memberId);
  const owner = { userId, roomCode: credential.code, memberId: credential.memberId };
  const encryptedToken = encryptRoomCredential(credential.token, owner, accountSecret());
  await withDatabaseWrite(async tx => {
    const existing = await tx.select().from(accountRooms).where(and(eq(accountRooms.roomCode, credential.code), or(eq(accountRooms.userId, userId), eq(accountRooms.memberId, credential.memberId))));
    if (existing.some(entry => entry.userId !== userId || entry.memberId !== credential.memberId)) {
      throw new AuctionError("This auction seat is already saved to an account, or you already saved a different seat in this room.", 409, "ROOM_ACCOUNT_CONFLICT");
    }
    const now = Date.now();
    if (existing[0]) await tx.update(accountRooms).set({ encryptedToken, updatedAt: now }).where(eq(accountRooms.id, existing[0].id));
    else await tx.insert(accountRooms).values({ id: randomUUID(), ...owner, encryptedToken, createdAt: now, updatedAt: now });
  });
}

export async function attachAccountRoom(request: Request, value: Record<string, unknown>) {
  requireAccountOrigin(request);
  const { user } = await requireAccountSession(request);
  await limitAccountRequest(request, "link");
  await attachCredential(user.id, parseCredential(value));
  return { accountLinked: true };
}

/** A room has already committed by this point. Account failure must not hide it. */
export async function autoSaveAccountRoom(request: Request, room: RoomSession): Promise<RoomSession & { accountLinked?: boolean; accountLinkError?: string }> {
  try {
    const account = await accountSession(request);
    if (!account) return room;
    await attachCredential(account.user.id, { code: room.state.code, token: room.token, memberId: room.memberId });
    return { ...room, accountLinked: true };
  } catch (error) {
    return { ...room, accountLinked: false, accountLinkError: error instanceof AuctionError ? error.message : "Your auction is ready, but saving it to your account failed. Save it from My account before changing devices." };
  }
}

export async function listAccountRooms(request: Request) {
  const { user } = await requireAccountSession(request);
  const database = await getDb();
  const rows = await database.select({ link: accountRooms, stateJson: auctionRooms.stateJson }).from(accountRooms)
    .leftJoin(auctionRooms, eq(accountRooms.roomCode, auctionRooms.code))
    .where(eq(accountRooms.userId, user.id)).orderBy(desc(accountRooms.updatedAt));
  const stale: string[] = [];
  const rooms = [];
  for (const { link, stateJson } of rows) {
    if (!stateJson) { stale.push(link.id); continue; }
    const room = JSON.parse(stateJson) as { state: RoomState; tokenHashes: Record<string, string> };
    const member = room.state.members.find(entry => entry.id === link.memberId);
    if (!member) { stale.push(link.id); continue; }
    // A secret rotation is a configuration problem, not evidence that a room
    // was left. Never discard encrypted recovery material on decryption errors.
    const token = decryptRoomCredential(link.encryptedToken, link, accountSecret());
    const hash = createHash("sha256").update(token).digest("hex");
    if (room.tokenHashes[link.memberId] !== hash) { stale.push(link.id); continue; }
    const team = room.state.teams.find(entry => entry.id === member.teamId);
    rooms.push({
      code: link.roomCode, memberId: member.id, name: room.state.name, role: member.role, teamId: member.teamId,
      teamName: team?.name, endedAt: room.state.endedAt || null,
      auctionPausedAt: room.state.auctionPausedAt || null,
      updatedAt: Math.max(link.updatedAt, room.state.activity.at(-1)?.at || 0),
    });
  }
  if (stale.length) await withDatabaseWrite(tx => tx.delete(accountRooms).where(and(eq(accountRooms.userId, user.id), inArray(accountRooms.id, stale))));
  return { rooms };
}

export async function resumeAccountRoom(request: Request, rawCode: string) {
  requireAccountOrigin(request);
  const { user } = await requireAccountSession(request);
  await limitAccountRequest(request, "resume");
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new AuctionError("Enter a valid room code.");
  const [link] = await (await getDb()).select().from(accountRooms).where(and(eq(accountRooms.userId, user.id), eq(accountRooms.roomCode, code))).limit(1);
  if (!link) throw new AuctionError("This auction is not saved to your account.", 404, "ACCOUNT_ROOM_NOT_FOUND");
  const token = decryptRoomCredential(link.encryptedToken, link, accountSecret());
  try {
    const room = await recoverAccountRoom(code, token, link.memberId);
    await withDatabaseWrite(tx => tx.update(accountRooms).set({ updatedAt: Date.now() }).where(eq(accountRooms.id, link.id)));
    return room;
  } catch (error) {
    if (error instanceof AuctionError && [401, 404, 410].includes(error.status)) {
      await withDatabaseWrite(tx => tx.delete(accountRooms).where(eq(accountRooms.id, link.id)));
    }
    throw error;
  }
}
