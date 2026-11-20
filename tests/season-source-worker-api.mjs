import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1");
assert.match(process.env.DATABASE_URL ?? "", /^file:/);
assert.ok(process.env.PAVILION_SOURCE_WORKER_TOKEN?.length >= 32);
const base = process.env.BASE_URL, token = process.env.PAVILION_SOURCE_WORKER_TOKEN;
const db = createClient({ url: process.env.DATABASE_URL, timeout: 100 });
const rooms = [], pending = [];
const request = async (path, body, credential) => {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: base }), ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) });
  return { status: response.status, data: await response.json() };
};
const ok = result => { assert.equal(result.status < 300, true, `${result.status}: ${result.data.error}`); return result.data; };
const worker = body => request("/api/season-source-worker", body, token);
const create = async () => { const room = ok(await request("/api/rooms", { name: "Isolated worker verification", hostName: "Source owner" })); rooms.push(room); return room; };
const seasonPath = room => `/api/rooms/${room.state.code}/season`;
const read = room => request(seasonPath(room), undefined, room.token).then(ok).then(value => value.season);
const post = (room, body) => request(seasonPath(room), body, room.token);
const startFetch = (room, expectedRevision = 0) => { const promise = post(room, { type: "fetch", expectedRevision }); pending.push(promise); return promise; };
const jobs = () => db.execute("SELECT * FROM season_source_jobs WHERE status IN ('queued','leased') ORDER BY created_at").then(result => result.rows);
const waitJobs = async count => {
  for (let attempt = 0; attempt < 80; attempt++) { const rows = await jobs(); if (rows.length === count) return rows; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail(`Expected ${count} pending source jobs`);
};
const snapshot = job => ({ sourceUrl: job.sourceUrl, provider: "espncricinfo", seriesId: "1510719", seriesName: "IPL 2026", fetchedAt: job.claimedAt, rows: [{ providerPlayerId: "253802", name: "Virat Kohli", points: -2.555, matches: 7, runs: 0, wickets: null, teamName: "Royal Challengers Bengaluru", battingImpact: 0, bowlingImpact: -2.555 }] });
const complete = (job, data = snapshot(job), extra = {}) => worker({ type: "complete", jobId: job.id, leaseToken: job.leaseToken, snapshot: data, totalRows: data.rows.length, ...extra });
const claim = () => worker({ type: "claim" }).then(ok).then(value => value.job);

try {
  const first = await create(), second = await create();
  assert.equal((await request("/api/season-source-worker", { type: "claim" })).status, 401);
  assert.equal((await request("/api/season-source-worker", { type: "claim" }, first.token)).status, 401);
  assert.equal((await read(first)).sourceFetch.available, false);
  assert.equal(await claim(), null);
  assert.equal((await read(first)).sourceFetch.mode, "worker"); assert.equal((await read(first)).sourceFetch.available, true);

  const firstFetch = startFetch(first), secondFetch = startFetch(second);
  const initialJobs = await waitJobs(1);
  const job = await claim(); assert.equal(job.id, initialJobs[0].id);
  assert.match(job.leaseToken, /^[a-f\d]{64}$/); assert.ok(Date.parse(job.leaseExpiresAt) > Date.parse(job.claimedAt));
  assert.deepEqual(Object.keys(job).sort(), ["claimedAt", "id", "leaseExpiresAt", "leaseToken", "sourceUrl"]);
  assert.equal(await claim(), null, "only one global active lease");
  const stored = (await db.execute({ sql: "SELECT * FROM season_source_jobs WHERE id=?", args: [job.id] })).rows[0];
  assert.notEqual(stored.lease_token_hash, job.leaseToken); assert.equal(stored.source_url, job.sourceUrl);
  const good = snapshot(job);
  assert.equal((await complete(job, good, { leaseToken: "a".repeat(64) })).data.code, "SEASON_WORKER_LEASE_CONFLICT");
  for (const invalid of [
    { ...good, sourceUrl: "https://127.0.0.1/private" }, { ...good, seriesId: "1449924" }, { ...good, provider: "evil" },
    { ...good, fetchedAt: undefined }, { ...good, fetchedAt: new Date(Date.parse(job.claimedAt) - 6000).toISOString() },
    { ...good, fetchedAt: new Date(Date.now() + 60000).toISOString() },
    { ...good, rows: [{ ...good.rows[0], points: "not a number" }] },
    { ...good, rows: [good.rows[0], good.rows[0]] },
  ]) assert.equal((await complete(job, invalid)).data.code, "SEASON_WORKER_RESULT_INVALID");
  assert.equal((await complete(job, good, { totalRows: 2 })).data.code, "SEASON_WORKER_RESULT_INVALID");
  assert.equal((await complete(job, good, { totalRows: undefined })).data.code, "SEASON_WORKER_RESULT_INVALID");
  ok(await complete(job));
  assert.equal((await complete(job)).data.code, "SEASON_WORKER_LEASE_CONFLICT");
  assert.equal((await worker({ type: "fail", jobId: job.id, leaseToken: job.leaseToken })).data.code, "SEASON_WORKER_LEASE_CONFLICT");
  const resultA = ok(await firstFetch).season, resultB = ok(await secondFetch).season;
  assert.equal(resultA.snapshot.method, "fetch"); assert.equal(resultA.sourceRows[0].points, -2.555);
  assert.equal(resultA.sourceRows[0].runs, 0); assert.equal(resultA.sourceRows[0].wickets, null);
  assert.deepEqual(resultA.snapshot, resultB.snapshot); assert.equal(resultA.revision, 1);
  assert.doesNotMatch(JSON.stringify(resultA), /leaseToken|workerToken|lease_token_hash/);

  // Offline acquisition leaves the previous verified source untouched.
  await db.execute({ sql: "UPDATE season_source_worker_state SET last_seen_at=?", args: [Date.now() - 60000] });
  const stateRow = (await db.execute({ sql: "SELECT state_json FROM auction_seasons WHERE room_code=?", args: [first.state.code] })).rows[0];
  const state = JSON.parse(stateRow.state_json); state.lastFetchAttemptAt = Date.now() - 16000;
  await db.execute({ sql: "UPDATE auction_seasons SET state_json=? WHERE room_code=?", args: [JSON.stringify(state), first.state.code] });
  const offline = await post(first, { type: "fetch", expectedRevision: 1 });
  assert.equal(offline.status, 503); assert.equal(offline.data.code, "SEASON_WORKER_OFFLINE");
  assert.deepEqual((await read(first)).snapshot, resultA.snapshot); assert.equal((await read(first)).revision, 1);
  await claim();

  // A completed public job still cannot overwrite a reconfigured creator request.
  const changed = await create(), changedFetch = startFetch(changed); await waitJobs(1);
  const changedJob = await claim();
  ok(await post(changed, { type: "configure", expectedRevision: 0, sourceUrl: "https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players" }));
  ok(await complete(changedJob));
  assert.equal((await changedFetch).data.code, "SEASON_CONFLICT"); assert.equal((await read(changed)).snapshot, null);

  const expired = await create(), expiredFetch = startFetch(expired); await waitJobs(1);
  const expiredJob = await claim();
  await db.execute({ sql: "UPDATE season_source_jobs SET lease_expires_at=? WHERE id=?", args: [Date.now() - 1, expiredJob.id] });
  assert.equal((await complete(expiredJob)).data.code, "SEASON_WORKER_LEASE_CONFLICT");
  assert.equal((await expiredFetch).data.code, "SEASON_WORKER_TIMEOUT"); await claim();

  const failed = await create(), failedFetch = startFetch(failed); await waitJobs(1);
  const failedJob = await claim();
  ok(await worker({ type: "fail", jobId: failedJob.id, leaseToken: failedJob.leaseToken, error: { code: "SEASON_SOURCE_RATE_LIMIT", message: "DO-NOT-EXPOSE-WORKER-DETAILS" } }));
  const failedResult = await failedFetch; assert.equal(failedResult.status, 429); assert.doesNotMatch(JSON.stringify(failedResult), /DO-NOT-EXPOSE/);

  const deleted = await create(), deletedFetch = startFetch(deleted); await waitJobs(1);
  const deletedJob = await claim();
  ok(await request(`/api/rooms/${deleted.state.code}/delete`, { confirmationCode: deleted.state.code }, deleted.token));
  ok(await complete(deletedJob)); assert.equal((await deletedFetch).status, 410);
  assert.equal((await db.execute({ sql: "SELECT room_code FROM auction_seasons WHERE room_code=?", args: [deleted.state.code] })).rows.length, 0);

  const now = Date.now();
  for (let index = 0; index < 3; index++) await db.execute({ sql: "INSERT INTO season_source_jobs(id,source_url,status,created_at,expires_at) VALUES(?,?,'queued',?,?)", args: [`quota-${index}`, `https://www.cricinfo.com/series/test-${3000 + index}/most-valuable-players`, now, now + 120000] });
  const quota = await create(); assert.equal((await post(quota, { type: "fetch", expectedRevision: 0 })).data.code, "SEASON_SOURCE_BUSY");
  await db.execute("DELETE FROM season_source_jobs WHERE id LIKE 'quota-%'");
  await db.execute({ sql: "INSERT INTO season_source_jobs(id,source_url,status,created_at,expires_at) VALUES('old-queue',?,'queued',?,?)", args: [job.sourceUrl, now - 36000, now + 120000] });
  assert.equal(await claim(), null, "timed-out queued requests cannot consume the next lease");
  assert.equal((await db.execute("SELECT status FROM season_source_jobs WHERE id='old-queue'")).rows[0].status, "failed");
  console.log("PASS: source-worker authentication, heartbeat, deduplication, lease safety, completeness/precision, offline retention, creator CAS, deletion, and queue limits.");
} finally {
  await db.execute("UPDATE season_source_jobs SET status='failed', error_json='{}' WHERE status IN ('queued','leased')").catch(() => undefined);
  await Promise.allSettled(pending);
  for (const room of rooms) await request(`/api/rooms/${room.state.code}/delete`, { confirmationCode: room.state.code }, room.token);
  db.close();
}
