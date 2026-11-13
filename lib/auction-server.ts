import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auctionRooms } from "@/db/schema";
import {
  applyAction, AuctionError, cleanText, createRoomState,
  type AuctionAction, type Member, type RoomState,
} from "@/lib/auction";

// Credential hashes stay outside RoomState and are never returned to a browser.
type StoredRoom = { state: RoomState; tokenHashes: Record<string, string> };
type SessionResponse = { state: RoomState; token: string; memberId: string };
const MAX_BODY_BYTES = 32768;
const ROOM_CAPACITY = 50;

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

async function credentialHash(request: Request): Promise<string> {
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new AuctionError("Join this room to continue.", 401, "UNAUTHORIZED");
  return hashToken(token);
}

function identifyMember(room: StoredRoom, hash: string): Member {
  const memberId = Object.keys(room.tokenHashes).find((id) => room.tokenHashes[id] === hash);
  const member = room.state.members.find((entry) => entry.id === memberId);
  if (!member) throw new AuctionError("Your room session has expired. Join again to continue.", 401, "UNAUTHORIZED");
  return member;
}

function snapshot(state: RoomState): RoomState {
  return { ...state, serverTime: Date.now() };
}

async function readStoredRoom(code: string): Promise<StoredRoom> {
  const rows = await getDb().select().from(auctionRooms).where(eq(auctionRooms.code, code)).limit(1);
  if (!rows[0]) throw new AuctionError("That room was not found. Check the code with your auctioneer.", 404, "ROOM_NOT_FOUND");
  const room = JSON.parse(rows[0].stateJson) as StoredRoom;
  room.state.version = rows[0].version;
  return room;
}

/** D1 compare-and-swap makes bids, room locks, team claims, and purse debits atomic. */
async function persistIfCurrent(code: string, expectedVersion: number, room: StoredRoom): Promise<boolean> {
  const rows = await getDb().update(auctionRooms).set({
    stateJson: JSON.stringify(room), version: room.state.version,
  }).where(and(eq(auctionRooms.code, code), eq(auctionRooms.version, expectedVersion)))
    .returning({ code: auctionRooms.code });
  return rows.length === 1;
}

export async function createRoom(body: Record<string, unknown>): Promise<SessionResponse> {
  const name = cleanText(body.name, "Room name");
  const hostName = cleanText(body.hostName, "Your name", 40);
  const now = Date.now();
  const token = secureToken();
  const hash = await hashToken(token);
  const member: Member = {
    id: crypto.randomUUID(), name: hostName, role: "auctioneer", teamId: null,
    joinedAt: now, lastSeenAt: now, flagRaisedAt: null,
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const state = createRoomState(code, name, member, now);
    const room: StoredRoom = { state, tokenHashes: { [member.id]: hash } };
    const rows = await getDb().insert(auctionRooms).values({
      code, stateJson: JSON.stringify(room), version: state.version, createdAt: now,
    }).onConflictDoNothing().returning({ code: auctionRooms.code });
    if (rows.length) return { state: snapshot(state), token, memberId: member.id };
  }
  throw new AuctionError("Could not create a room. Please try again.", 503, "ROOM_CREATE_RETRY");
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
    const before = room.state.version;
    const now = Date.now();
    if (room.state.members.length >= ROOM_CAPACITY) throw new AuctionError("This room has reached its 50-person capacity.", 409, "ROOM_FULL");
    if (teamId && !room.state.teams.some((team) => team.id === teamId)) throw new AuctionError("Choose a valid team.");
    if (teamId && room.state.members.some((member) => member.teamId === teamId)) throw new AuctionError("This team already has a manager. Choose another team or join as a spectator.", 409, "TEAM_TAKEN");
    room.state.members.push({ id, name, role: teamId ? "bidder" : "spectator", teamId, joinedAt: now, lastSeenAt: now, flagRaisedAt: null });
    room.state.activity.push({ id: `join-${id}`, type: "room", text: `${name} joined the room.`, at: now, memberId: id });
    room.state.activity = room.state.activity.slice(-150);
    room.state.version += 1; room.state.serverTime = now; room.tokenHashes[id] = hash;
    if (await persistIfCurrent(code, before, room)) return { state: snapshot(room.state), token, memberId: id };
  }
  throw new AuctionError("The room is busy. Please try joining again.", 409, "ROOM_BUSY");
}

export async function getRoom(rawCode: string, request: Request): Promise<RoomState> {
  const code = normalizeCode(rawCode);
  const hash = await credentialHash(request);
  let room = await readStoredRoom(code);
  const member = identifyMember(room, hash);
  // Heartbeat at most once per 25 seconds per member; ordinary polls are read-only.
  if (Date.now() - member.lastSeenAt >= 25000) {
    const before = room.state.version;
    room.state = applyAction(room.state, { type: "ping" }, member.id);
    if (!await persistIfCurrent(code, before, room)) {
      room = await readStoredRoom(code);
      identifyMember(room, hash);
    }
  }
  return snapshot(room.state);
}

export async function actInRoom(rawCode: string, request: Request, action: AuctionAction): Promise<RoomState> {
  const code = normalizeCode(rawCode);
  const hash = await credentialHash(request);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const room = await readStoredRoom(code);
    const member = identifyMember(room, hash);
    const before = room.state.version;
    room.state = applyAction(room.state, action, member.id);
    if (action.type === "leave") delete room.tokenHashes[member.id];
    if (await persistIfCurrent(code, before, room)) return snapshot(room.state);
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
  // Never expose database state, stack traces, or credentials in HTTP errors.
  console.error("Auction request failed:", error instanceof Error ? error.message : "Unknown server failure");
  return jsonResponse({ error: "The auction service is temporarily unavailable. Please try again.", code: "SERVICE_UNAVAILABLE" }, 503);
}
