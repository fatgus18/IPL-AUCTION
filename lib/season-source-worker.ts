import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { getDb, withDatabaseWrite } from "@/db";
import { seasonSourceJobs, seasonSourceWorkerState } from "@/db/schema";
import { AuctionError } from "./auction";
import type { SeasonSourceAvailability } from "./auction-season";
import { fetchSeasonSource, parseSeasonSourceImport, SeasonSourceError, validateSeasonSourceUrl, type SeasonSourceSnapshot } from "./season-source";
import { seasonSourceMode } from "./season-source-mode";

const WORKER_ID = "primary", HEARTBEAT_MS = 45_000, LEASE_MS = 25_000, JOB_TTL_MS = 120_000, WAIT_MS = 35_000, MAX_PENDING = 3;
type Transaction = Parameters<Parameters<typeof withDatabaseWrite>[0]>[0];
type Job = typeof seasonSourceJobs.$inferSelect;
const digest = (token: string) => createHash("sha256").update(token).digest();
const secret = () => process.env.PAVILION_SOURCE_WORKER_TOKEN?.trim() ?? "";
const offline = () => new SeasonSourceError("The season data worker is offline. Your saved points are unchanged; reconnect the worker or use a dated snapshot.", 503, "SEASON_WORKER_OFFLINE");

export function authorizeSeasonSourceWorker(request: Request): void {
  if (seasonSourceMode() !== "worker") throw new AuctionError("Desktop refresh workers are disabled for this deployment.", 503, "SEASON_WORKER_DISABLED");
  const configured = secret();
  if (configured.length < 32) throw new AuctionError("The source worker is not configured.", 503, "SEASON_WORKER_NOT_CONFIGURED");
  const supplied = /^Bearer ([^\s]{32,512})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!timingSafeEqual(digest(supplied), digest(configured))) throw new AuctionError("The source worker credential is invalid.", 401, "SEASON_WORKER_UNAUTHORIZED");
}

export async function getSeasonSourceAvailability(): Promise<SeasonSourceAvailability> {
  if (!secret()) return { mode: "direct", available: true, lastSeenAt: null };
  const rows = await (await getDb()).select().from(seasonSourceWorkerState).where(eq(seasonSourceWorkerState.id, WORKER_ID)).limit(1);
  const at = rows[0]?.lastSeenAt;
  return { mode: "worker", available: secret().length >= 32 && at !== undefined && Date.now() - at <= HEARTBEAT_MS && at <= Date.now() + 5000, lastSeenAt: at === undefined ? null : new Date(at).toISOString() };
}

async function heartbeat(tx: Transaction, now: number): Promise<void> {
  await tx.insert(seasonSourceWorkerState).values({ id: WORKER_ID, lastSeenAt: now }).onConflictDoUpdate({ target: seasonSourceWorkerState.id, set: { lastSeenAt: now } });
}
async function cleanJobs(tx: Transaction, now: number): Promise<void> {
  await tx.delete(seasonSourceJobs).where(lte(seasonSourceJobs.expiresAt, now));
  await tx.update(seasonSourceJobs).set({ status: "failed", leaseTokenHash: null, errorJson: JSON.stringify({ code: "SEASON_WORKER_TIMEOUT", status: 504, message: "The source worker did not finish in time. Your saved points are unchanged; try again." }) })
    .where(and(eq(seasonSourceJobs.status, "leased"), lte(seasonSourceJobs.leaseExpiresAt, now)));
  await tx.update(seasonSourceJobs).set({ status: "failed", errorJson: JSON.stringify({ code: "SEASON_WORKER_TIMEOUT", status: 504, message: "The source request waited too long. Your saved points are unchanged; try again." }) })
    .where(and(eq(seasonSourceJobs.status, "queued"), lte(seasonSourceJobs.createdAt, now - WAIT_MS)));
}

async function enqueue(sourceUrl: string): Promise<string> {
  return withDatabaseWrite(async tx => {
    const now = Date.now();
    await cleanJobs(tx, now);
    const live = await tx.select().from(seasonSourceWorkerState).where(eq(seasonSourceWorkerState.id, WORKER_ID)).limit(1);
    if (!live[0] || now - live[0].lastSeenAt > HEARTBEAT_MS || live[0].lastSeenAt > now + 5000) throw offline();
    const pending = await tx.select().from(seasonSourceJobs).where(inArray(seasonSourceJobs.status, ["queued", "leased"])).orderBy(asc(seasonSourceJobs.createdAt));
    const same = pending.find(job => job.sourceUrl === sourceUrl);
    if (same) return same.id;
    if (pending.length >= MAX_PENDING) throw new SeasonSourceError("The season data queue is busy. Try again shortly.", 429, "SEASON_SOURCE_BUSY");
    const id = randomUUID();
    await tx.insert(seasonSourceJobs).values({ id, sourceUrl, status: "queued", createdAt: now, expiresAt: now + JOB_TTL_MS });
    return id;
  });
}

/** A configured worker is the sole acquisition path; no alternative-identity retries. */
export async function fetchSeasonSourceThroughWorker(input: string): Promise<SeasonSourceSnapshot> {
  const source = validateSeasonSourceUrl(input);
  if (!secret()) return fetchSeasonSource(source.url.href);
  if (!(await getSeasonSourceAvailability()).available) throw offline();
  const id = await enqueue(source.url.href);
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    const rows = await (await getDb()).select().from(seasonSourceJobs).where(eq(seasonSourceJobs.id, id)).limit(1);
    const job = rows[0];
    if (!job) throw new SeasonSourceError("The source request expired. Your saved points are unchanged; try again.", 504, "SEASON_WORKER_TIMEOUT");
    if (job.status === "completed" && job.resultJson) return JSON.parse(job.resultJson) as SeasonSourceSnapshot;
    if (job.status === "failed") {
      const failure = JSON.parse(job.errorJson ?? "{}") as { message?: string; status?: number; code?: string };
      throw new SeasonSourceError(failure.message ?? "The source worker could not retrieve that table. Your saved points are unchanged.", failure.status ?? 502, failure.code ?? "SEASON_SOURCE_UNAVAILABLE");
    }
    if (job.status === "leased" && (job.leaseExpiresAt ?? 0) <= Date.now()) throw new SeasonSourceError("The source worker did not finish in time. Your saved points are unchanged; try again.", 504, "SEASON_WORKER_TIMEOUT");
    await new Promise(resolve => setTimeout(resolve, Math.min(750, Math.max(1, until - Date.now()))));
  }
  throw new SeasonSourceError("The source worker did not finish in time. Your saved points are unchanged; try again.", 504, "SEASON_WORKER_TIMEOUT");
}

function validateLease(job: Job | undefined, token: unknown, now: number): asserts job is Job {
  if (!job || job.status !== "leased" || !job.leaseTokenHash || !/^[a-f\d]{64}$/i.test(job.leaseTokenHash) || !job.leaseExpiresAt || job.leaseExpiresAt <= now || job.expiresAt <= now
    || typeof token !== "string" || !/^[a-f\d]{64}$/i.test(token)
    || !timingSafeEqual(digest(token), Buffer.from(job.leaseTokenHash, "hex"))) {
    throw new AuctionError("This source job lease is stale or invalid.", 409, "SEASON_WORKER_LEASE_CONFLICT");
  }
}

function validatedSnapshot(value: unknown, totalRows: unknown, job: Job, now: number): SeasonSourceSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuctionError("A complete source snapshot is required.", 400, "SEASON_WORKER_RESULT_INVALID");
  const input = value as Record<string, unknown>;
  const source = validateSeasonSourceUrl(job.sourceUrl);
  const fetchedAt = typeof input.fetchedAt === "string" ? Date.parse(input.fetchedAt) : NaN;
  if (input.sourceUrl !== job.sourceUrl || input.provider !== "espncricinfo" || input.seriesId !== source.seriesId
    || typeof input.seriesName !== "string" || !input.seriesName.trim() || input.seriesName.length > 120 || /[<>\u0000-\u001f]/.test(input.seriesName)
    || !Number.isFinite(fetchedAt) || fetchedAt < (job.claimedAt ?? now) - 5000 || fetchedAt > now + 5000
    || !Array.isArray(input.rows) || !Number.isSafeInteger(totalRows) || totalRows !== input.rows.length || input.rows.length < 1 || input.rows.length > 1000
    || input.rows.some(row => !row || typeof row !== "object" || !/^[1-9]\d{0,9}$/.test(String((row as Record<string, unknown>).providerPlayerId)))) {
    throw new AuctionError("The source result is incomplete, stale, or does not match its job.", 400, "SEASON_WORKER_RESULT_INVALID");
  }
  try {
    const checked = parseSeasonSourceImport(JSON.stringify(input.rows), job.sourceUrl, new Date(fetchedAt).toISOString());
    return { ...checked, seriesName: input.seriesName.trim() };
  } catch { throw new AuctionError("The source result contains invalid player points.", 400, "SEASON_WORKER_RESULT_INVALID"); }
}

export async function actOnSeasonSourceWorker(body: Record<string, unknown>) {
  if (!["claim", "complete", "fail"].includes(String(body.type))) throw new AuctionError("Choose a valid source worker operation.");
  if (body.type === "claim") return withDatabaseWrite(async tx => {
    const now = Date.now(); await heartbeat(tx, now); await cleanJobs(tx, now);
    const leased = await tx.select({ id: seasonSourceJobs.id }).from(seasonSourceJobs).where(and(eq(seasonSourceJobs.status, "leased"), gt(seasonSourceJobs.leaseExpiresAt, now))).limit(1);
    if (leased[0]) return { job: null };
    const queued = await tx.select().from(seasonSourceJobs).where(eq(seasonSourceJobs.status, "queued")).orderBy(asc(seasonSourceJobs.createdAt)).limit(1);
    if (!queued[0]) return { job: null };
    const leaseToken = randomBytes(32).toString("hex"), leaseExpiresAt = now + LEASE_MS;
    await tx.update(seasonSourceJobs).set({ status: "leased", claimedAt: now, leaseExpiresAt, leaseTokenHash: digest(leaseToken).toString("hex") }).where(eq(seasonSourceJobs.id, queued[0].id));
    return { job: { id: queued[0].id, sourceUrl: queued[0].sourceUrl, leaseToken, claimedAt: new Date(now).toISOString(), leaseExpiresAt: new Date(leaseExpiresAt).toISOString() } };
  });
  if (typeof body.jobId !== "string" || body.jobId.length > 80) throw new AuctionError("A valid source job is required.");
  // Parse outside the transaction, then check the same live lease again at commit.
  const before = await (await getDb()).select().from(seasonSourceJobs).where(eq(seasonSourceJobs.id, body.jobId)).limit(1);
  validateLease(before[0], body.leaseToken, Date.now());
  const snapshot = body.type === "complete" ? validatedSnapshot(body.snapshot, body.totalRows, before[0], Date.now()) : null;
  const reported = body.error && typeof body.error === "object" && !Array.isArray(body.error) ? body.error as Record<string, unknown> : {};
  const failure = reported.code === "SEASON_SOURCE_RATE_LIMIT"
    ? { code: "SEASON_SOURCE_RATE_LIMIT", status: 429, message: "ESPNcricinfo is limiting source requests. Your saved points are unchanged; try later." }
    : { code: "SEASON_SOURCE_UNAVAILABLE", status: 502, message: "The source worker could not retrieve that MVP table. Your saved points are unchanged; try later or use a dated snapshot." };
  return withDatabaseWrite(async tx => {
    const now = Date.now();
    const rows = await tx.select().from(seasonSourceJobs).where(eq(seasonSourceJobs.id, body.jobId as string)).limit(1);
    validateLease(rows[0], body.leaseToken, now);
    if (rows[0].sourceUrl !== before[0].sourceUrl || rows[0].claimedAt !== before[0].claimedAt) throw new AuctionError("The source job changed.", 409, "SEASON_WORKER_LEASE_CONFLICT");
    await tx.update(seasonSourceJobs).set({ status: snapshot ? "completed" : "failed", resultJson: snapshot ? JSON.stringify(snapshot) : null, errorJson: snapshot ? null : JSON.stringify(failure), leaseTokenHash: null }).where(eq(seasonSourceJobs.id, rows[0].id));
    await heartbeat(tx, now);
    return { accepted: true as const };
  });
}
