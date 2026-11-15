import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Room recovery checks require the isolated API runner.");
const base = process.env.BASE_URL;
async function request(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
}

const creationKey = randomBytes(32).toString("hex");
const body = { name: "Recoverable room", hostName: "Recovery host", creationKey };
const results = await Promise.all(Array.from({ length: 4 }, () => request("/api/rooms", body)));
for (const response of results) assert.equal(response.status, 201, response.data.error);
const first = results[0].data;
for (const { data } of results) {
  assert.equal(data.state.code, first.state.code, "parallel retries must create one room");
  assert.equal(data.memberId, first.memberId);
  assert.equal(data.token, creationKey);
  assert.equal(data.state.members.length, 1);
  assert.ok(!JSON.stringify(data.state).includes(creationKey));
}
const path = `/api/rooms/${first.state.code}`;
const mismatch = await request("/api/rooms", { ...body, name: "Another room" });
assert.equal(mismatch.status, 409);
assert.equal(mismatch.data.code, "CREATION_KEY_REUSED");
assert.equal((await request("/api/rooms", { ...body, creationKey: "a-short-key" })).status, 400);

const member = (await request(`${path}/join`, { name: "Leaving guest" })).data;
const read = await request(path, undefined, member.token);
const warm = await request(`${path}?since=${read.data.state.version}`, undefined, member.token);
assert.equal(warm.data.unchanged, true);
const unauthorized = await request(`${path}?since=${read.data.state.version}`, undefined, "0".repeat(64));
assert.equal(unauthorized.status, 401, "unchanged polls still authenticate every bearer");
assert.equal((await request(`${path}/action`, { action: { type: "leave" } }, member.token)).status, 200);
const current = (await request(path, undefined, first.token)).data.state;
assert.equal((await request(`${path}?since=${current.version}`, undefined, member.token)).status, 401, "a cached authorization must not survive leave");
const retry = (await request("/api/rooms", body)).data;
assert.equal(retry.state.version, current.version, "recovery returns the latest room state");
assert.equal(retry.state.members.length, 1);

const timings = [];
await request(path, undefined, first.token);
for (let i = 0; i < 12; i += 1) {
  const started = performance.now();
  const poll = await request(`${path}?since=${current.version}`, undefined, first.token);
  assert.equal(poll.data.unchanged, true);
  assert.ok(JSON.stringify(poll.data).length < 100);
  timings.push(Math.round(performance.now() - started));
}
console.log(`PASS: room creation retries are atomic, parameter-bound and recoverable; unchanged polls reject invalid/revoked credentials. Stable poll timings: median ${timings.sort((a, b) => a - b)[6]} ms, max ${Math.max(...timings)} ms.`);
