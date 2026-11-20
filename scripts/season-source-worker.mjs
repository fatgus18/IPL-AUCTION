import { readFile, open, unlink, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { fetchSeasonSource, normalizeSeasonSourceUrl, SeasonSourceError } from "../lib/season-source.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLL_MS = 10_000;

export function workerConfiguration(env = process.env) {
  let origin;
  try { origin = new URL(env.PAVILION_WORKER_ORIGIN || ""); } catch { throw new Error("Set PAVILION_WORKER_ORIGIN to your Pavilion website address."); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback)) || origin.username || origin.password
    || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("PAVILION_WORKER_ORIGIN must be an HTTPS website origin (HTTP is allowed only for local tests).");
  const token = env.PAVILION_SOURCE_WORKER_TOKEN || "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error("Set a valid PAVILION_SOURCE_WORKER_TOKEN; never put it in the website UI or a spreadsheet.");
  return { origin: origin.origin, token };
}

export async function workerRequest(configuration, body, fetcher = fetch) {
  const response = await fetcher(`${configuration.origin}/api/season-source-worker`, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${configuration.token}` },
    body: JSON.stringify(body),
  });
  if (response.status >= 300 && response.status < 400) throw new Error("The website redirected the worker request. The service credential was not forwarded.");
  if (response.status === 401 || response.status === 403) {
    const error = new Error("The website rejected the worker credential. Check the service configuration.");
    error.code = "WORKER_AUTH";
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`The website returned HTTP ${response.status} for the worker request.`);
    error.code = response.status === 409 ? "WORKER_LEASE" : "WORKER_HTTP";
    throw error;
  }
  if (!/^application\/json\b/i.test(response.headers.get("content-type") || "")) throw new Error("The website did not return a worker JSON response.");
  return response.json();
}

function validateJob(job, now) {
  if (!job || typeof job !== "object" || typeof job.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(job.id)
    || typeof job.leaseToken !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(job.leaseToken)) throw new Error("The website returned an invalid refresh job.");
  const source = normalizeSeasonSourceUrl(job.sourceUrl);
  if (source !== job.sourceUrl) throw new Error("The website returned a non-canonical source link.");
  const claimed = Date.parse(job.claimedAt);
  const expires = Date.parse(job.leaseExpiresAt);
  if (!Number.isFinite(claimed) || !Number.isFinite(expires) || expires <= now || expires - claimed > 60_000 || claimed > now + 5_000) {
    throw new Error("The refresh job has an invalid or expired lease. Check the host computer's clock.");
  }
  return { ...job, sourceUrl: source };
}

/** The worker sees only public source jobs, never room credentials, squads or private plans. */
export async function processNextJob(configuration, dependencies = {}) {
  const request = dependencies.request || (body => workerRequest(configuration, body));
  const fetchSource = dependencies.fetchSource || fetchSeasonSource;
  const now = dependencies.now || Date.now;
  const log = dependencies.log || console.log;
  const claimed = await request({ type: "claim" });
  if (claimed.job === null) return false;
  const job = validateJob(claimed.job, now());
  let snapshot;
  try {
    snapshot = await fetchSource(job.sourceUrl);
  } catch (error) {
    await request({
      type: "fail", jobId: job.id, leaseToken: job.leaseToken,
      error: {
        message: error instanceof SeasonSourceError ? error.message : "The source could not be fetched. Your saved points are unchanged.",
        code: error instanceof SeasonSourceError ? error.code : "SEASON_SOURCE_UNAVAILABLE",
        status: error instanceof SeasonSourceError ? error.status : 502,
      },
    });
    log(`Source refresh failed: ${error instanceof SeasonSourceError ? error.code : "SEASON_SOURCE_UNAVAILABLE"}.`);
    return true;
  }
  if (Date.parse(job.leaseExpiresAt) <= now()) throw new Error("The refresh lease expired before submission. No stale result was submitted.");
  // The server revalidates this result and atomically checks the active lease.
  await request({ type: "complete", jobId: job.id, leaseToken: job.leaseToken, snapshot, totalRows: snapshot.rows.length });
  log(`Fetched ${snapshot.rows.length} players for series ${snapshot.seriesId} at ${snapshot.fetchedAt}.`);
  return true;
}

async function acquireProcessLock(path) {
  await mkdir(dirname(path), { recursive: true });
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
      await handle.close();
      return async () => {
        try { if (JSON.parse(await readFile(path, "utf8")).nonce === nonce) await unlink(path); } catch { /* Already removed. */ }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let previous;
      try { previous = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("The worker lock file is invalid; inspect it before restarting the service."); }
      if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error("The worker lock file is invalid.");
      try { process.kill(previous.pid, 0); return null; } catch (probe) {
        if (probe.code !== "ESRCH") return null;
      }
      await unlink(path);
    }
  }
  throw new Error("Another worker is starting. Try again shortly.");
}

async function main() {
  const configuration = workerConfiguration();
  const once = process.argv.includes("--once");
  const release = once ? async () => {} : await acquireProcessLock(resolve(ROOT, ".data", "season-worker.lock"));
  if (!release) { console.log("Pavilion's points refresh service is already running."); return; }
  let stopping = false;
  let wake = null;
  const stop = () => { stopping = true; wake?.(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`Starting Pavilion points refresh service for ${configuration.origin}.`);
  try {
    do {
      let worked = false;
      try { worked = await processNextJob(configuration); }
      catch (error) {
        console.error(error.message);
        if (error.code === "WORKER_AUTH" || once) throw error;
      }
      if (once || stopping) break;
      await new Promise(resolveSleep => {
        const timer = setTimeout(done, worked ? 1_000 : POLL_MS);
        function done() { clearTimeout(timer); wake = null; resolveSleep(); }
        wake = done;
      });
    } while (!stopping);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await release();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
