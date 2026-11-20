import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { SeasonCloudRuntime, SeasonCloudSandbox } from "../lib/season-cloud-source";
const { createSeasonCloudSource }: typeof import("../lib/season-cloud-source") = await import(new URL("../lib/season-cloud-source.ts", import.meta.url).href);
const { parseSeasonSourceHtml, SeasonSourceError }: typeof import("../lib/season-source") = await import(new URL("../lib/season-source.ts", import.meta.url).href);
const fixture = JSON.parse(await readFile(new URL("./fixtures/season-source.json", import.meta.url), "utf8"));
const url = fixture.sourceUrl as string;
const data = () => {
  const snapshot = parseSeasonSourceHtml(`<script id="__NEXT_DATA__">${JSON.stringify(fixture)}</script>`, url);
  return { ok: true, snapshot, totalRows: snapshot.rows.length };
};
const sourceError = (code: string) => (error: unknown) => error instanceof SeasonSourceError && error.code === code;

function mock() {
  const calls = { assets: [] as string[], creates: [] as Parameters<SeasonCloudRuntime["create"]>[0][], writes: [] as Parameters<SeasonCloudSandbox["writeFiles"]>[0][], commands: [] as Parameters<SeasonCloudSandbox["runCommand"]>[0][], reads: [] as Parameters<SeasonCloudSandbox["readFileToBuffer"]>[0][], stops: [] as AbortSignal[], signals: [] as AbortSignal[] };
  let buffer: Buffer | null = Buffer.from(JSON.stringify(data()));
  let exitCode = 0;
  const sandbox: SeasonCloudSandbox = {
    writeFiles: async (files, options) => { calls.writes.push(files); calls.signals.push(options.signal); },
    runCommand: async options => { calls.commands.push(options); calls.signals.push(options.signal); return { exitCode }; },
    readFileToBuffer: async (file, options) => { calls.reads.push(file); calls.signals.push(options.signal); return buffer; },
    stop: async options => { calls.stops.push(options.signal); },
  };
  const runtime: SeasonCloudRuntime = {
    create: async options => { calls.creates.push(options); return sandbox; },
    readAsset: async name => { calls.assets.push(name); return Buffer.from(`fixed test asset: ${name}`); },
  };
  return { calls, sandbox, runtime, result(value: unknown) { buffer = Buffer.from(JSON.stringify(value)); }, bytes(value: Buffer | null) { buffer = value; }, exit(value: number) { exitCode = value; } };
}

test("cloud acquisition copies only fixed assets, passes a normalized URL as argv, and never forwards environment or credentials", async () => {
  const fixture = mock();
  const result = await createSeasonCloudSource(fixture.runtime)(`${url}?tracking=discard-me`);
  assert.equal(result.rows.length, 3); assert.equal(result.rows[2].points, -25.81);
  assert.equal(result.rows[0].name, "Vaibhav Sooryavanshi"); assert.equal(result.rows[0].providerPlayerId, "1408688");
  assert.deepEqual(fixture.calls.assets.sort(), ["season-cloud-runner.mjs", "season-source.ts"]);
  const options = fixture.calls.creates[0];
  assert.deepEqual(Object.keys(options).sort(), ["image", "networkPolicy", "persistent", "region", "resources", "signal", "timeout"]);
  assert.equal(options.persistent, false); assert.equal(options.timeout, 45000); assert.equal(options.region, "bom1");
  assert.equal(options.image, "vercel/sandbox/universal"); assert.deepEqual(options.resources, { vcpus: 1 });
  assert.deepEqual(options.networkPolicy, { allow: ["www.cricinfo.com", "cricinfo.com", "www.espncricinfo.com", "espncricinfo.com"] });
  assert.deepEqual(fixture.calls.writes[0].map(file => file.path), ["/tmp/season-source.ts", "/tmp/run.mjs"]);
  assert.equal(fixture.calls.commands[0].cmd, "node");
  assert.deepEqual(fixture.calls.commands[0].args, ["--experimental-strip-types", "/tmp/run.mjs", url]);
  assert.equal(fixture.calls.commands[0].cwd, "/tmp"); assert.equal(fixture.calls.commands[0].timeoutMs, 20000);
  assert.deepEqual(Object.keys(fixture.calls.commands[0]).sort(), ["args", "cmd", "cwd", "signal", "timeoutMs"]);
  assert.deepEqual(fixture.calls.reads, [{ path: "/tmp/result.json", cwd: "/tmp" }]);
  assert.ok(fixture.calls.signals.every(signal => signal === options.signal));
  assert.equal(fixture.calls.stops.length, 1); assert.notEqual(fixture.calls.stops[0], options.signal);
  assert.equal(options.signal.aborted, true); assert.equal(fixture.calls.stops[0].aborted, false);
});

test("invalid input and asset failures do not create cloud resources", async () => {
  for (const invalid of ["http://127.0.0.1/private", "https://evil.test/", `${url}/../private`, "file:///etc/passwd"]) {
    const fixture = mock(); await assert.rejects(createSeasonCloudSource(fixture.runtime)(invalid), SeasonSourceError);
    assert.equal(fixture.calls.creates.length, 0); assert.equal(fixture.calls.assets.length, 0);
  }
  const missing = mock(); missing.runtime.readAsset = async () => { throw new Error("PRIVATE_LOCAL_PATH"); };
  await assert.rejects(createSeasonCloudSource(missing.runtime)(url), error => sourceError("SEASON_CLOUD_UNAVAILABLE")(error) && !String(error).includes("PRIVATE_LOCAL_PATH"));
  assert.equal(missing.calls.creates.length, 0);
  const oversized = mock(); oversized.runtime.readAsset = async () => Buffer.alloc(129000);
  await assert.rejects(createSeasonCloudSource(oversized.runtime)(url), sourceError("SEASON_CLOUD_UNAVAILABLE"));
  assert.equal(oversized.calls.creates.length, 0);
});

test("raw SDK failures are sanitized and allocated sandboxes always receive one stop", async () => {
  for (const stage of ["create", "write", "run", "read"] as const) {
    const fixture = mock();
    const fail = async () => { throw new Error("CONTROL_PLANE_SECRET=private-oidc-token"); };
    if (stage === "create") fixture.runtime.create = fail;
    if (stage === "write") fixture.sandbox.writeFiles = fail;
    if (stage === "run") fixture.sandbox.runCommand = fail;
    if (stage === "read") fixture.sandbox.readFileToBuffer = fail;
    await assert.rejects(createSeasonCloudSource(fixture.runtime)(url), error => sourceError("SEASON_CLOUD_UNAVAILABLE")(error) && !String(error).includes("private-oidc-token"));
    assert.equal(fixture.calls.stops.length, stage === "create" ? 0 : 1);
  }
});

test("denial and rate limits are reported without fallback, retries, or remote error details", async () => {
  for (const code of ["SEASON_SOURCE_UNAVAILABLE", "SEASON_SOURCE_RATE_LIMIT", "SEASON_SOURCE_RESPONSE"]) {
    const fixture = mock(); fixture.exit(1); fixture.result({ ok: false, error: { code, message: "SECRET-IN-REMOTE-ERROR" } });
    await assert.rejects(createSeasonCloudSource(fixture.runtime)(url), error => sourceError(code)(error) && !String(error).includes("SECRET-IN-REMOTE-ERROR"));
    assert.equal(fixture.calls.creates.length, 1); assert.equal(fixture.calls.commands.length, 1); assert.equal(fixture.calls.stops.length, 1);
  }
});

test("result identity, capture time, row completeness and decimal values are revalidated", async () => {
  const invalids = [
    { ...data(), snapshot: { ...data().snapshot, sourceUrl: "https://evil.test/" } },
    { ...data(), snapshot: { ...data().snapshot, seriesId: "1449924" } },
    { ...data(), snapshot: { ...data().snapshot, provider: "unknown" } },
    { ...data(), snapshot: { ...data().snapshot, fetchedAt: undefined } },
    { ...data(), snapshot: { ...data().snapshot, fetchedAt: new Date(Date.now() - 60000).toISOString() } },
    { ...data(), snapshot: { ...data().snapshot, fetchedAt: new Date(Date.now() + 60000).toISOString() } },
    { ...data(), totalRows: 4 }, { ...data(), totalRows: undefined },
  ];
  const duplicate = data(); duplicate.snapshot.rows[1].providerPlayerId = duplicate.snapshot.rows[0].providerPlayerId; invalids.push(duplicate);
  const invalidId = data(); invalidId.snapshot.rows[0].providerPlayerId = null; invalids.push(invalidId);
  const invalidPoints = data(); invalidPoints.snapshot.rows[0].points = Number.NaN; invalids.push(invalidPoints);
  for (const value of invalids) {
    const fixture = mock(); fixture.result(value);
    await assert.rejects(createSeasonCloudSource(fixture.runtime)(url), sourceError("SEASON_SOURCE_RESPONSE"));
    assert.equal(fixture.calls.stops.length, 1);
  }
});

test("missing, oversized or malformed result buffers and nonzero success envelopes cannot be accepted", async () => {
  for (const buffer of [null, Buffer.alloc(1000001), Buffer.from("{invalid"), Buffer.from("[]")]) {
    const fixture = mock(); fixture.bytes(buffer);
    await assert.rejects(createSeasonCloudSource(fixture.runtime)(url), sourceError("SEASON_SOURCE_RESPONSE"));
    assert.equal(fixture.calls.stops.length, 1);
  }
  const fixture = mock(); fixture.exit(1);
  await assert.rejects(createSeasonCloudSource(fixture.runtime)(url), sourceError("SEASON_SOURCE_RESPONSE"));
});

test("work deadline covers hanging commands and reads; cleanup uses a fresh non-aborted signal", async () => {
  for (const stage of ["run", "read"] as const) {
    const fixture = mock(); fixture.runtime.workTimeoutMs = 30; fixture.runtime.cleanupTimeoutMs = 15;
    if (stage === "run") fixture.sandbox.runCommand = () => new Promise(() => undefined);
    else fixture.sandbox.readFileToBuffer = () => new Promise(() => undefined);
    await assert.rejects(createSeasonCloudSource(fixture.runtime)(url), sourceError("SEASON_CLOUD_TIMEOUT"));
    assert.equal(fixture.calls.stops.length, 1); assert.equal(fixture.calls.creates[0].signal.aborted, true);
    assert.equal(fixture.calls.stops[0].aborted, false);
  }
});

test("hanging or failed cleanup is bounded independently and never exposes SDK errors", async () => {
  const hanging = mock(); hanging.runtime.cleanupTimeoutMs = 15;
  let cleanupSignal: AbortSignal | undefined;
  hanging.sandbox.stop = options => { cleanupSignal = options.signal; return new Promise(() => undefined); };
  assert.equal((await createSeasonCloudSource(hanging.runtime)(url)).rows.length, 3);
  assert.equal(cleanupSignal?.aborted, true);
  const failed = mock(); failed.sandbox.stop = () => { throw new Error("SECRET_STOP_CREDENTIAL"); };
  assert.equal((await createSeasonCloudSource(failed.runtime)(url)).rows.length, 3);
});

test("a sandbox handle delivered after the work deadline is stopped without executing a task", async () => {
  const fixture = mock(); fixture.runtime.workTimeoutMs = 20; fixture.runtime.cleanupTimeoutMs = 15;
  let release!: (sandbox: SeasonCloudSandbox) => void;
  fixture.runtime.create = () => new Promise(resolve => { release = resolve; });
  await assert.rejects(createSeasonCloudSource(fixture.runtime)(url), sourceError("SEASON_CLOUD_TIMEOUT"));
  release(fixture.sandbox);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(fixture.calls.stops.length, 1); assert.equal(fixture.calls.writes.length, 0); assert.equal(fixture.calls.commands.length, 0);
});

test("the fixed runner has no application environment forwarding and writes a bounded result at an absolute path", async () => {
  const runner = await readFile(new URL("../lib/season-cloud-runner.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /process\.env|exec\(|spawn\(|eval\(|new Function/);
  assert.match(runner, /fetchSeasonSource\(process\.argv\[2\]\)/);
  assert.match(runner, /writeFile\("\/tmp\/result\.json"/);
  assert.match(runner, /1_000_000/);
});
