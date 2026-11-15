const REQUEST_TIMEOUT_MS = 15_000;
const UNEXPECTED_RESPONSE = "The auction server returned an unexpected response. Refresh the page, then check your room before trying again.";
const REQUEST_UNCONFIRMED = "We couldn't confirm your request because the connection was interrupted. Check your room before trying again.";
const REQUEST_TIMED_OUT = "We couldn't confirm your request because the auction server took too long. Check your room before trying again.";
export type AuctionRequestOptions = { timeoutMs?: number; signal?: AbortSignal };

export class AuctionRequestError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AuctionRequestError";
    this.status = status;
    this.code = code;
  }
}

function safeErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.trim();
  // Only expose short plain-text API errors, never HTML, stack traces, or credentials.
  if (!message || message.length > 300 || /[<>\r\n]|\bBearer\s|\b(?:password|secret|token|api[-_ ]?key)\s*[:=]|\b[a-f0-9]{64}\b|\bat\s+\S+\s*\(/i.test(message)) return undefined;
  return message;
}

/** One request only: replaying a bid or team claim could perform the action twice. */
export async function requestAuction<T>(path: string, body?: unknown, token?: string, options: AuctionRequestOptions = {}): Promise<T> {
  if (options.signal?.aborted) throw new AuctionRequestError("The request was cancelled.", undefined, "REQUEST_ABORTED");
  const controller = new AbortController();
  const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) ? Math.min(45_000, Math.max(1_000, options.timeoutMs)) : REQUEST_TIMEOUT_MS;
  let rejectCancelled: ((error: AuctionRequestError) => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const onAbort = () => {
    controller.abort();
    rejectCancelled?.(new AuctionRequestError("The request was cancelled.", undefined, "REQUEST_ABORTED"));
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let status: number | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new AuctionRequestError(REQUEST_TIMED_OUT, status, "REQUEST_TIMEOUT"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      deadline, cancellation,
      (async () => {
        const response = await fetch(path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          cache: "no-store",
          signal: controller.signal,
        });
        status = response.status;
        const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
        if (!contentType || !/^application\/(?:[\w.-]+\+)?json$/.test(contentType)) {
          throw new AuctionRequestError(UNEXPECTED_RESPONSE, status, "INVALID_RESPONSE");
        }

        // Body reads remain inside the same deadline as the initial request.
        const text = await response.text();
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new AuctionRequestError(UNEXPECTED_RESPONSE, status, "INVALID_RESPONSE");
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new AuctionRequestError(UNEXPECTED_RESPONSE, status, "INVALID_RESPONSE");
        }
        if (!response.ok) {
          const { error, code } = data as Record<string, unknown>;
          throw new AuctionRequestError(
            safeErrorMessage(error) || "The auction request could not be completed. Check your room before trying again.",
            status,
            typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "HTTP_ERROR",
          );
        }
        return data as T;
      })(),
    ]);
  } catch (error) {
    if (options.signal?.aborted) throw new AuctionRequestError("The request was cancelled.", status, "REQUEST_ABORTED");
    if (error instanceof AuctionRequestError) throw error;
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "TimeoutError");
    throw new AuctionRequestError(timedOut ? REQUEST_TIMED_OUT : REQUEST_UNCONFIRMED, status, timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
