import type { RoomState } from "./auction.ts";
import { AuctionRequestError, requestAuction } from "./auction-client.ts";

export type RoomSession = { code: string; token: string; memberId: string };
export type PracticeSession = { session: RoomSession; state: RoomState };
export const PRACTICE_SESSION_KEY = "pavilion-practice-session";

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PracticeSessionDependencies = {
  storage: () => SessionStorage;
  request?: typeof requestAuction;
  runExclusive?: <T>(name: string, work: () => Promise<T>) => Promise<T>;
};

export class PracticeSessionError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "PracticeSessionError";
    this.code = code;
  }
}

export function parseRoomSession(raw: string | null): RoomSession | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const { code, token, memberId } = value as Record<string, unknown>;
    if (typeof code !== "string" || !/^[A-Z0-9]{6}$/.test(code) ||
        typeof token !== "string" || !/^[a-fA-F0-9]{64}$/.test(token) ||
        typeof memberId !== "string" || !memberId.trim() || memberId.length > 80 ||
        memberId !== memberId.trim() || /[\u0000-\u001f\u007f]/.test(memberId)) return null;
    return { code, token, memberId };
  } catch { return null; }
}

function storageError(): PracticeSessionError {
  return new PracticeSessionError(
    "Your browser could not save access to the practice room. Allow site storage for this address, then retry. Keep this tab open until access is saved.",
    "PRACTICE_STORAGE_UNAVAILABLE",
  );
}

function validatePracticeState(state: RoomState | undefined, session: RoomSession): RoomState {
  if (!state || state.code !== session.code || (state as RoomState & { mode?: string }).mode !== "practice" ||
      !Array.isArray(state.players) || !Array.isArray(state.members) ||
      state.hostId !== session.memberId || !state.members.some(member => member.id === session.memberId && member.role === "auctioneer")) {
    throw new PracticeSessionError(
      "The saved room could not be verified as your practice room. Your saved access has been kept. Retry once the server is available.",
      "PRACTICE_SESSION_MISMATCH",
    );
  }
  return state;
}

/** Separate instances represent tabs; their shared Web Lock protects first creation. */
export function createPracticeSessionRestorer(dependencies: PracticeSessionDependencies): () => Promise<PracticeSession> {
  const request = dependencies.request ?? requestAuction;
  let pending: Promise<PracticeSession> | undefined;
  // If the server creates a room but the browser refuses the write, a retry in this
  // tab saves those credentials instead of creating another inaccessible room.
  let createdButUnsaved: PracticeSession | undefined;

  const restore = async (): Promise<PracticeSession> => {
    let storage: SessionStorage;
    let raw: string | null;
    try {
      storage = dependencies.storage();
      raw = storage.getItem(PRACTICE_SESSION_KEY);
    } catch { throw storageError(); }

    const stored = parseRoomSession(raw);
    if (raw && !stored) {
      throw new PracticeSessionError(
        "The saved practice-room access is damaged. It has been kept so it can be recovered; no replacement room was created.",
        "PRACTICE_SESSION_INVALID",
      );
    }

    if (stored) {
      try {
        const result = await request<{ state: RoomState }>(`/api/rooms/${stored.code}`, undefined, stored.token);
        const state = validatePracticeState(result.state, stored);
        return { session: stored, state };
      } catch (error) {
        if (error instanceof AuctionRequestError && (error.status === 401 || error.status === 404)) {
          throw new PracticeSessionError(
            "Your saved practice room is currently unavailable or its access was rejected. Your saved access has been kept. Restore the room on the server, then retry; no replacement room was created.",
            "PRACTICE_SESSION_UNAVAILABLE",
          );
        }
        throw error;
      }
    }

    // Without cross-tab coordination, two fresh tabs could save different rooms.
    // Existing sessions remain usable in older browsers, but creation fails safely.
    if (!dependencies.runExclusive) {
      throw new PracticeSessionError(
        "This browser cannot safely create a shared practice room. Open this address in a current Chrome, Edge, Firefox, or Safari browser using localhost or HTTPS, then retry.",
        "PRACTICE_LOCKS_UNAVAILABLE",
      );
    }

    const probeKey = `${PRACTICE_SESSION_KEY}:storage-check`;
    try {
      storage.setItem(probeKey, "available");
      if (storage.getItem(probeKey) !== "available") throw new Error("Storage write was not retained");
      storage.removeItem(probeKey);
    } catch { throw storageError(); }

    if (!createdButUnsaved) {
      const result = await request<{ state: RoomState; token: string; memberId: string }>("/api/practice", {});
      const session = parseRoomSession(JSON.stringify({ code: result.state?.code, token: result.token, memberId: result.memberId }));
      if (!session) {
        throw new PracticeSessionError("The server returned incomplete practice-room access. Retry once the server is available.", "PRACTICE_RESPONSE_INVALID");
      }
      createdButUnsaved = { session, state: validatePracticeState(result.state, session) };
    }
    const created = createdButUnsaved;
    const serialized = JSON.stringify(created.session);
    try {
      storage.setItem(PRACTICE_SESSION_KEY, serialized);
      if (storage.getItem(PRACTICE_SESSION_KEY) !== serialized) throw new Error("Saved access was not retained");
    } catch { throw storageError(); }
    createdButUnsaved = undefined;
    return created;
  };

  return () => {
    if (pending) return pending;
    const operation = dependencies.runExclusive
      ? Promise.resolve().then(() => dependencies.runExclusive!(PRACTICE_SESSION_KEY, restore))
      : Promise.resolve().then(restore);
    pending = operation.finally(() => { pending = undefined; });
    return pending;
  };
}

let browserRestorer: (() => Promise<PracticeSession>) | undefined;

export function restorePracticeSession(): Promise<PracticeSession> {
  if (typeof window === "undefined") return Promise.reject(new PracticeSessionError("Open the application in a browser to restore your practice room.", "PRACTICE_BROWSER_REQUIRED"));
  if (!browserRestorer) {
    browserRestorer = createPracticeSessionRestorer({
      storage: () => window.localStorage,
      ...(navigator.locks?.request ? { runExclusive: async <T>(name: string, work: () => Promise<T>): Promise<T> => await navigator.locks.request(name, work) } : {}),
    });
  }
  return browserRestorer();
}
