import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Never run global catalog mutation tests on a user's application database.
// The temporary database is deliberately retained in the OS temp folder for failure diagnosis.
const temporaryDirectory = await mkdtemp(join(tmpdir(), "pavilion-api-test-"));
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env, DATABASE_URL: pathToFileURL(join(temporaryDirectory, "isolated.db")).href,
  BASE_URL: baseUrl, PAVILION_TEST_ISOLATED: "1", NEXT_TELEMETRY_DISABLED: "1",
};
delete env.DATABASE_AUTH_TOKEN;
let serverOutput = "";
const startServer = () => {
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { serverOutput = (serverOutput + data).slice(-16000); });
  child.stderr.on("data", data => { serverOutput = (serverOutput + data).slice(-16000); });
  return child;
};
let server = startServer();
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Isolated server exited: ${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/players/catalog`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const catalog = await response.json();
        assert.equal(catalog.players.length, 249, "the test server must use a fresh isolated database");
        ready = true; break;
      }
    } catch { /* Wait for the newly spawned server to bind. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, `The isolated server did not become ready: ${serverOutput}`);
  const suites = process.argv.slice(2);
  for (const suite of suites.length ? suites : ["tests/api-integration.mjs", "tests/practice-api-integration.mjs", "tests/shared-catalog-api-integration.mjs", "tests/room-recovery-api-integration.mjs", "tests/historic-teams-api-integration.mjs", "tests/lobby-catalog-api-integration.mjs", "tests/room-access-api-integration.mjs", "tests/lineup-api-integration.mjs", "tests/auction-interactions-api-integration.mjs", "tests/target-picks-api-integration.mjs", "tests/unlock-api-integration.mjs", "tests/auction-completion-api.mjs", "tests/auction-exports-api.mjs", "tests/private-budgets-api.mjs", "tests/franchise-posters-api.mjs", "tests/auction-awards-api.mjs"]) {
    const child = spawn(process.execPath, [suite], { env, windowsHide: true, stdio: "inherit" });
    const [code] = await once(child, "exit");
    assert.equal(code, 0, `${suite} failed. Server output: ${serverOutput}`);
  }
  const beforeRestart = await fetch(`${baseUrl}/api/players/catalog`).then(response => response.json());
  const recoveryBody = { name: "Durable retry check", hostName: "Restart host", creationKey: randomBytes(32).toString("hex") };
  const recover = async () => {
    const response = await fetch(`${baseUrl}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recoveryBody) });
    assert.equal(response.status, 201);
    return response.json();
  };
  const roomBeforeRestart = await recover();
  const privateAccess = async room => {
    const response = await fetch(`${baseUrl}/api/rooms/${room.state.code}/access`, { method: "POST", headers: { Authorization: `Bearer ${room.token}`, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 200);
    return response.json();
  };
  const accessBeforeRestart = await privateAccess(roomBeforeRestart);
  const deletedCreation = { name: "Deleted before restart", hostName: "Deletion host", creationKey: randomBytes(32).toString("hex") };
  const createDeleted = () => fetch(`${baseUrl}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(deletedCreation) });
  const deletedResponse = await createDeleted();
  assert.equal(deletedResponse.status, 201);
  const deletedRoom = await deletedResponse.json();
  const deletion = await fetch(`${baseUrl}/api/rooms/${deletedRoom.state.code}/delete`, { method: "POST", headers: { Authorization: `Bearer ${deletedRoom.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ confirmationCode: deletedRoom.state.code }) });
  assert.equal(deletion.status, 200);
  server.kill();
  await once(server, "exit");
  server = startServer();
  let afterRestart;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Restarted isolated server exited: ${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/players/catalog`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { afterRestart = await response.json(); break; }
    } catch { /* The restarted process is still binding. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.deepEqual(afterRestart, beforeRestart, "catalog edits and deletion must survive a complete server restart");
  const recoveredRoom = await recover();
  assert.equal(recoveredRoom.state.code, roomBeforeRestart.state.code, "a lost creation response is recoverable after server restart");
  assert.equal(recoveredRoom.memberId, roomBeforeRestart.memberId);
  assert.equal(recoveredRoom.token, recoveryBody.creationKey);
  assert.deepEqual(await privateAccess(recoveredRoom), accessBeforeRestart, "the private team password survives server restart");
  const deletedRetry = await createDeleted();
  assert.equal(deletedRetry.status, 410, "a deleted creation key must stay revoked across server restart");
  assert.equal((await deletedRetry.json()).code, "ROOM_DELETED");
  const deletedPoll = await fetch(`${baseUrl}/api/rooms/${deletedRoom.state.code}`, { headers: { Authorization: `Bearer ${deletedRoom.token}` } });
  assert.equal(deletedPoll.status, 410);
  const fresh = await fetch(`${baseUrl}/api/practice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(response => response.json());
  assert.equal(fresh.state.catalogCount, beforeRestart.players.length);
  assert.equal(fresh.state.sharedCatalogVersion, beforeRestart.version);
  console.log("PASS: the entire shared catalog and its version survive a server restart and are used by a fresh browser session.");
  console.log("PASS: the same private creation key recovers the same room and host membership after a server restart.");
  console.log("PASS: private team passwords and deleted-room tombstones survive a server restart; old creation keys cannot recreate deleted rooms.");
  console.log("PASS: API suites used an isolated database; the user's rooms and common catalog were untouched.");
} finally {
  if (server.exitCode === null) {
    server.kill();
    await once(server, "exit");
  }
}
