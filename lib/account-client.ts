import type { Member, RoomState } from "./auction";

export type AccountUser = { id: string; username: string; name: string };
export type AccountRoomSummary = {
  code: string;
  memberId: string;
  name: string;
  role: Member["role"];
  teamId: string | null;
  teamName?: string;
  endedAt?: number | null;
  auctionPausedAt?: number | null;
  updatedAt?: number;
};
export type AccountRoomResume = { state: RoomState; token: string; memberId: string };

export class AccountRequestError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AccountRequestError";
    this.status = status;
    this.code = code;
  }
}

function publicError(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const text = value.trim();
  if (!text || text.length > 300 || /[<>\r\n]|\bBearer\s|\b(?:password|secret|token|api[-_ ]?key)\s*[:=]|\b[a-f0-9]{64}\b|\bat\s+\S+\s*\(/i.test(text)) return;
  return text;
}

/** Account cookies stay HTTP-only. Requests are never retried automatically. */
export async function requestAccount<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  if (!/^\/api\/account(?:\/|$)/.test(path)) throw new AccountRequestError("Invalid account request.");
  const callerSignal = signal ?? init.signal;
  if (callerSignal?.aborted) throw new AccountRequestError("Request cancelled.", undefined, "REQUEST_ABORTED");
  const controller = new AbortController();
  let rejectCancellation: ((error: AccountRequestError) => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const cancel = () => {
    controller.abort();
    rejectCancellation?.(new AccountRequestError("Request cancelled.", undefined, "REQUEST_ABORTED"));
  };
  callerSignal?.addEventListener("abort", cancel, { once: true });
  if (callerSignal?.aborted) cancel();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => {
      controller.abort();
      reject(new AccountRequestError("The account server took too long. Check your connection and try again.", undefined, "REQUEST_TIMEOUT"));
    }, 15_000);
  });
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  try {
    return await Promise.race([cancellation, timeout, (async () => {
      const response = await fetch(path, {
        ...init,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new AccountRequestError("The account server returned an unexpected response. Please try again.", response.status);
      }
      let result: unknown;
      try { result = JSON.parse(await response.text()); } catch {
        throw new AccountRequestError("The account response could not be read. Please try again.", response.status);
      }
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new AccountRequestError("The account response could not be read. Please try again.", response.status);
      }
      if (!response.ok) {
        const data = result as Record<string, unknown>;
        throw new AccountRequestError(publicError(data.error) ?? "Your account request could not be completed. Please try again.", response.status, typeof data.code === "string" ? data.code : undefined);
      }
      return result as T;
    })()]);
  } catch (error) {
    if (callerSignal?.aborted) throw new AccountRequestError("Request cancelled.", undefined, "REQUEST_ABORTED");
    if (error instanceof AccountRequestError) throw error;
    throw new AccountRequestError("Could not reach your account. Check your connection and try again.");
  } finally {
    clearTimeout(deadline);
    callerSignal?.removeEventListener("abort", cancel);
  }
}
