import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, withDatabaseWrite } from "@/db";
import { seasonSourceJobs } from "@/db/schema";
import type { SeasonSourceAvailability } from "./auction-season";
import { fetchSeasonSource, SeasonSourceError, validateSeasonSourceUrl, type SeasonSourceSnapshot } from "./season-source";
import { seasonSourceMode } from "./season-source-mode";
import { fetchSeasonSourceThroughWorker, getSeasonSourceAvailability as workerAvailability } from "./season-source-worker";

const CLOUD_LEASE_MS = 45_000, WAIT_MS = 40_000, HISTORY_MS = 120_000, STARTS_PER_MINUTE = 4;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const timeout = () => new SeasonSourceError("The cloud refresh took too long. Your saved points are unchanged; try again shortly.", 504, "SEASON_CLOUD_TIMEOUT");

export async function getSeasonSourceAvailability(): Promise<SeasonSourceAvailability> {
  const mode = seasonSourceMode();
  return mode === "worker" ? workerAvailability() : { mode, available: true, lastSeenAt: null };
}

async function reserveCloudSource(sourceUrl: string) {
  return withDatabaseWrite(async tx => {
    const now = Date.now();
    await tx.delete(seasonSourceJobs).where(lte(seasonSourceJobs.expiresAt, now));
    // Queued desktop jobs cannot run after switching this deployment to cloud mode.
    await tx.update(seasonSourceJobs).set({ status: "failed", leaseTokenHash: null, errorJson: JSON.stringify({ message: timeout().message, status: 504, code: "SEASON_CLOUD_TIMEOUT" }) })
      .where(eq(seasonSourceJobs.status, "queued"));
    await tx.update(seasonSourceJobs).set({ status: "failed", leaseTokenHash: null, errorJson: JSON.stringify({ message: timeout().message, status: 504, code: "SEASON_CLOUD_TIMEOUT" }) })
      .where(and(inArray(seasonSourceJobs.status, ["queued", "leased"]), lte(seasonSourceJobs.leaseExpiresAt, now)));
    const active = await tx.select().from(seasonSourceJobs).where(inArray(seasonSourceJobs.status, ["queued", "leased"]));
    const same = active.find(job => job.sourceUrl === sourceUrl);
    if (same) return { id: same.id, owner: false as const, lease: "" };
    if (active.length) throw new SeasonSourceError("Another season is refreshing. Try again in a moment.", 429, "SEASON_SOURCE_BUSY");
    const recent = await tx.select({ id: seasonSourceJobs.id }).from(seasonSourceJobs)
      .where(gte(seasonSourceJobs.createdAt, now - 60_000)).orderBy(desc(seasonSourceJobs.createdAt)).limit(STARTS_PER_MINUTE);
    if (recent.length >= STARTS_PER_MINUTE) throw new SeasonSourceError("The refresh limit has been reached. Wait a minute before fetching again.", 429, "SEASON_CLOUD_RATE_LIMIT");
    const id = randomUUID(), lease = randomBytes(32).toString("hex");
    await tx.insert(seasonSourceJobs).values({ id, sourceUrl, status: "leased", createdAt: now, claimedAt: now,
      expiresAt: now + HISTORY_MS, leaseExpiresAt: now + CLOUD_LEASE_MS, leaseTokenHash: digest(lease) });
    return { id, owner: true as const, lease };
  });
}

async function waitForCloudSource(id: string): Promise<SeasonSourceSnapshot> {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    const [job] = await (await getDb()).select().from(seasonSourceJobs).where(eq(seasonSourceJobs.id, id)).limit(1);
    if (!job || job.expiresAt <= Date.now()) throw timeout();
    if (job.status === "completed" && job.resultJson) return JSON.parse(job.resultJson) as SeasonSourceSnapshot;
    if (job.status === "failed") {
      const failure = JSON.parse(job.errorJson ?? "{}") as { message?: string; status?: number; code?: string };
      throw new SeasonSourceError(failure.message ?? "The cloud source could not be refreshed. Your saved points are unchanged.", failure.status ?? 502, failure.code ?? "SEASON_SOURCE_UNAVAILABLE");
    }
    if ((job.leaseExpiresAt ?? 0) <= Date.now()) throw timeout();
    await new Promise(resolve => setTimeout(resolve, Math.min(750, Math.max(1, until - Date.now()))));
  }
  throw timeout();
}

async function fetchManagedCloudSource(sourceUrl: string): Promise<SeasonSourceSnapshot> {
  const reservation = await reserveCloudSource(sourceUrl);
  if (!reservation.owner) return waitForCloudSource(reservation.id);
  try {
    const snapshot = await (await import("./season-cloud-source")).fetchSeasonSourceInCloud(sourceUrl);
    await withDatabaseWrite(async tx => {
      const [job] = await tx.select().from(seasonSourceJobs).where(eq(seasonSourceJobs.id, reservation.id)).limit(1);
      if (!job || job.status !== "leased" || job.sourceUrl !== sourceUrl || job.leaseTokenHash !== digest(reservation.lease)
        || (job.leaseExpiresAt ?? 0) <= Date.now() || job.expiresAt <= Date.now()) throw timeout();
      await tx.update(seasonSourceJobs).set({ status: "completed", resultJson: JSON.stringify(snapshot), leaseTokenHash: null })
        .where(eq(seasonSourceJobs.id, reservation.id));
    });
    return snapshot;
  } catch (error) {
    const failure = error instanceof SeasonSourceError ? error : new SeasonSourceError("The cloud refresh could not finish. Your saved points are unchanged; try again later.", 503, "SEASON_CLOUD_UNAVAILABLE");
    await withDatabaseWrite(tx => tx.update(seasonSourceJobs).set({ status: "failed", leaseTokenHash: null,
      errorJson: JSON.stringify({ message: failure.message, status: failure.status, code: failure.code }) })
      .where(and(eq(seasonSourceJobs.id, reservation.id), eq(seasonSourceJobs.status, "leased"), eq(seasonSourceJobs.leaseTokenHash, digest(reservation.lease)))));
    throw failure;
  }
}

/** Acquisition mode is a server deployment setting; clients cannot choose an executor. */
export async function fetchSeasonSourceForRoom(input: string): Promise<SeasonSourceSnapshot> {
  const source = validateSeasonSourceUrl(input);
  const mode = seasonSourceMode();
  if (mode === "cloud") return fetchManagedCloudSource(source.url.href);
  if (mode === "worker") return fetchSeasonSourceThroughWorker(source.url.href);
  return fetchSeasonSource(source.url.href);
}
