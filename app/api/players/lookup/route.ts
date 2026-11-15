import { lookupPlayer, PlayerLookupError } from "@/lib/player-lookup";
import { hasSameRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

// Small bounded process-local budgets protect provider access even without a signed-in room.
// Multi-instance hosting should apply a shared edge rate limit as well.
const buckets = new Map<string, { count: number; reset: number }>();
let globalBudget = { count: 0, reset: 0 };
function consumeBudget(request: Request): void {
  const now = Date.now();
  if (globalBudget.reset <= now) globalBudget = { count: 0, reset: now + 60_000 };
  const ip = (request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "local").trim().slice(0, 100);
  let entry = buckets.get(ip);
  if (!entry || entry.reset <= now) entry = { count: 0, reset: now + 60_000 };
  if (entry.count >= 12 || globalBudget.count >= 40) throw new PlayerLookupError("Too many player searches. Try again in a minute.", 429, "LOOKUP_RATE_LIMIT");
  if (buckets.size >= 1_000) for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
  if (buckets.size >= 1_000 && !buckets.has(ip)) throw new PlayerLookupError("Player search is busy. Try again shortly.", 429, "LOOKUP_RATE_LIMIT");
  entry.count++;
  globalBudget.count++;
  buckets.set(ip, entry);
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new PlayerLookupError("Send the player search as JSON.", 415);
  if (Number(request.headers.get("content-length") || 0) > 2_048) throw new PlayerLookupError("This player search is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PlayerLookupError("Enter a player name or profile URL.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > 2_048) { await reader.cancel(); throw new PlayerLookupError("This player search is too large.", 413); }
    chunks.push(chunk.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new PlayerLookupError("The player search could not be read. Try again."); }
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    if (!hasSameRequestOrigin(request)) throw new PlayerLookupError("Open player search from your auction room.", 403, "LOOKUP_ORIGIN");
    consumeBudget(request);
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PlayerLookupError("Enter a player name or profile URL.");
    return Response.json(await lookupPlayer((body as Record<string, unknown>).query), { headers });
  } catch (error) {
    const known = error instanceof PlayerLookupError;
    return Response.json({ error: known ? error.message : "Player search is temporarily unavailable. Try again shortly.", code: known ? error.code : "LOOKUP_FAILED" }, { status: known ? error.status : 500, headers: { ...headers, ...(known && error.status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}
