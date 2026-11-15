export type PendingRoomCreation = { creationKey: string; name: string; hostName: string };
export const PENDING_ROOM_CREATION_KEY = "pavilion-pending-room-creation";

type CreationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RoomCreationDependencies = {
  storage: () => CreationStorage;
  randomBytes?: () => Uint8Array;
};

function cleanName(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  // Produce a stable value accepted unchanged by the server's cleanText.
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (text.length < 1 || text.length > maxLength) throw new Error(`${label} must contain 1–${maxLength} characters.`);
  return text;
}

function storageError(): Error {
  return new Error("Your browser could not save room recovery access. Allow site storage, then retry in this tab.");
}

function parsePending(raw: string | null): PendingRoomCreation | null {
  if (raw === null) return null;
  try {
    if (raw.length > 2048) throw new Error("Invalid saved request");
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved request");
    const { creationKey, name, hostName } = value as Record<string, unknown>;
    if (typeof creationKey !== "string" || !/^[a-f0-9]{64}$/.test(creationKey) ||
        cleanName(name, "Room name", 80) !== name || cleanName(hostName, "Your name", 40) !== hostName) {
      throw new Error("Invalid saved request");
    }
    return { creationKey, name: name as string, hostName: hostName as string };
  } catch {
    throw new Error("The pending room recovery access could not be read. It has been kept; no replacement room was started.");
  }
}

/** Saves a retry identity before any request. This helper never sends network traffic. */
export function createRoomCreationManager(dependencies: RoomCreationDependencies) {
  const storage = (): CreationStorage => {
    try { return dependencies.storage(); } catch { throw storageError(); }
  };
  const read = (target: CreationStorage): string | null => {
    try { return target.getItem(PENDING_ROOM_CREATION_KEY); } catch { throw storageError(); }
  };

  function readPendingRoomCreation(): PendingRoomCreation | null {
    return parsePending(read(storage()));
  }

  function prepareRoomCreation(name: string, hostName: string): PendingRoomCreation {
    const cleanRoomName = cleanName(name, "Room name", 80);
    const cleanHostName = cleanName(hostName, "Your name", 40);
    const target = storage();
    const pending = parsePending(read(target));
    if (pending) {
      if (pending.name !== cleanRoomName || pending.hostName !== cleanHostName) {
        throw new Error("Recover the pending room before starting a different one.");
      }
      return pending;
    }

    const bytes = dependencies.randomBytes ? dependencies.randomBytes() : crypto.getRandomValues(new Uint8Array(32));
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error("Secure room recovery access could not be generated. Retry in this tab.");
    const creationKey = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    const created = { creationKey, name: cleanRoomName, hostName: cleanHostName };
    const serialized = JSON.stringify(created);
    try {
      target.setItem(PENDING_ROOM_CREATION_KEY, serialized);
      if (target.getItem(PENDING_ROOM_CREATION_KEY) !== serialized) throw new Error("Recovery access was not retained");
    } catch { throw storageError(); }
    return created;
  }

  function finishRoomCreation(creationKey: string): void {
    const target = storage();
    const raw = read(target);
    const pending = parsePending(raw);
    if (!pending || pending.creationKey !== creationKey) return;
    try {
      target.removeItem(PENDING_ROOM_CREATION_KEY);
      if (target.getItem(PENDING_ROOM_CREATION_KEY) === raw) throw new Error("Recovery access was not cleared");
    } catch { throw storageError(); }
  }

  return { readPendingRoomCreation, prepareRoomCreation, finishRoomCreation };
}

const browserManager = createRoomCreationManager({ storage: () => window.sessionStorage });
export const { readPendingRoomCreation, prepareRoomCreation, finishRoomCreation } = browserManager;
