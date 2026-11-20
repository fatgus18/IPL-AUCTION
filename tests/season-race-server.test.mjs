import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { createDemoState } from "../lib/auction.ts";
import { emptyAuctionSeason } from "../lib/auction-season.ts";

// Exercise the real season service without a Next server or provider requests.
// Only persistence/auth and the external fetch boundary are replaced.
const fixture = { state: null, record: null, rejectCommit: false, fetch: null, queue: Promise.resolve() };
globalThis.__seasonRaceServiceFixture = fixture;
const query = owner => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => owner.record ? [structuredClone(owner.record)] : [] }) }) }),
  insert: () => ({ values: values => ({ onConflictDoUpdate: async () => { owner.record = structuredClone(values); } }) }),
});
fixture.database = query(fixture);
fixture.write = work => {
  const pending = fixture.queue.then(async () => {
    const draft = { record: structuredClone(fixture.record) };
    const result = await work(query(draft));
    if (fixture.rejectCommit) { fixture.rejectCommit = false; throw new Error("Simulated commit failure"); }
    fixture.record = draft.record;
    return result;
  });
  fixture.queue = pending.catch(() => {});
  return pending;
};
const mockModules = {
  "@/db": "export const getDb = async () => globalThis.__seasonRaceServiceFixture.database; export const withDatabaseWrite = work => globalThis.__seasonRaceServiceFixture.write(work);",
  "@/db/schema": "export const auctionSeasons = { roomCode: 'roomCode' };",
  "drizzle-orm": "export const eq = (key, value) => value;",
  "./auction-server": "export const getSeasonRoomContext = async () => { const state = structuredClone(globalThis.__seasonRaceServiceFixture.state); return { state, member: { role: 'auctioneer', id: state.hostId } }; };",
  "./season-managed-fetch": "export const getSeasonSourceAvailability = async () => ({ mode:'direct', available:true, lastSeenAt:null }); export const fetchSeasonSourceForRoom = url => globalThis.__seasonRaceServiceFixture.fetch(url);",
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockModules[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mockModules[specifier])}`, shortCircuit: true };
    if (specifier.startsWith("./") && !specifier.endsWith(".ts") && context.parentURL?.startsWith("file:")) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { getAuctionSeason, updateAuctionSeason } = await import("../lib/auction-season-server.ts");
hooks.deregister();
const request = new Request("https://pavilion.example/api/rooms/TEST/season");
function reset() {
  fixture.state = createDemoState(); fixture.record = null; fixture.rejectCommit = false;
  const team = fixture.state.teams.find(team => team.id === "rcb");
  for (const [index, player] of fixture.state.players.slice(0, 2).entries()) {
    player.status = "sold"; player.soldTo = team.id; player.soldFor = 100;
    team.squad.push({ playerId: player.id, amount: 100 });
    if (!index) team.lineup = { playingXI: [], substitutes: [], captainId: player.id, viceCaptainId: null, revision: 1 };
  }
  fixture.fetch = async () => { throw new Error("Simulated source failure"); };
}
const write = body => updateAuctionSeason(fixture.state.code, request, body);
const read = () => getAuctionSeason(fixture.state.code, request);
const text = () => JSON.stringify(fixture.state.players.slice(0, 2).map((player, index) => ({ name: player.name, points: [10, 4][index] })));

test("service saves source and checkpoint atomically, preserves failures/conflicts, and reads never append", async () => {
  reset();
  let view = await read(); assert.equal(view.raceHistory.totalCheckpoints, 0); assert.equal(fixture.record, null);
  await write({ type: "configure", sourceUrl: emptyAuctionSeason().sourceUrl, expectedRevision: 0 });
  assert.equal((await read()).raceHistory.totalCheckpoints, 0);
  view = await write({ type: "import", text: text(), expectedRevision: 1 });
  assert.equal(view.raceHistory.totalCheckpoints, 1); assert.equal(view.revision, 2);
  const before = structuredClone(fixture.record);
  fixture.rejectCommit = true;
  await assert.rejects(write({ type: "import", text: text(), expectedRevision: 2 }), /commit failure/);
  assert.deepEqual(fixture.record, before, "neither snapshot nor checkpoint survives an aborted write");
  await assert.rejects(write({ type: "import", text: "invalid table", expectedRevision: 2 }));
  await assert.rejects(write({ type: "map", mappings: { bad: "bad" }, expectedRevision: 2 }));
  await assert.rejects(write({ type: "import", text: text(), expectedRevision: 1 }), { code: "SEASON_CONFLICT" });
  await assert.rejects(write({ type: "fetch", expectedRevision: 2 }), /source failure/);
  assert.equal((await read()).raceHistory.totalCheckpoints, 1, "failed fetch reservation does not append");
  for (let index = 0; index < 3; index++) await read();
  assert.equal((await read()).raceHistory.totalCheckpoints, 1);
  const races = await Promise.allSettled([write({ type: "map", mappings: {}, expectedRevision: 2 }), write({ type: "map", mappings: {}, expectedRevision: 2 })]);
  assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(races.filter(result => result.status === "rejected" && result.reason.code === "SEASON_CONFLICT").length, 1);
  fixture.record = JSON.parse(JSON.stringify(fixture.record));
  view = await read(); assert.equal(view.raceHistory.totalCheckpoints, 2); assert.equal(view.raceHistory.checkpoints[1].reason, "map");
});

test("fetch captures fresh room captaincy at commit and a stale pending request cannot append", async () => {
  reset();
  await write({ type: "import", text: text(), expectedRevision: 0 });
  let release; let started;
  const didStart = new Promise(resolve => { started = resolve; });
  const snapshot = JSON.parse(fixture.record.stateJson).snapshot;
  fixture.fetch = async () => { started(); return new Promise(resolve => { release = resolve; }); };
  const pending = write({ type: "fetch", expectedRevision: 1 });
  await didStart;
  const team = fixture.state.teams.find(team => team.id === "rcb");
  team.lineup.captainId = fixture.state.players[1].id; fixture.state.version += 1;
  release(snapshot);
  let view = await pending;
  const latest = view.raceHistory.checkpoints.at(-1);
  assert.equal(latest.roomVersion, fixture.state.version);
  assert.equal(latest.teams.find(team => team.id === "rcb").points, 18);
  assert.equal(latest.teamChanges.find(change => change.teamId === "rcb").captaincyChanged, true);
  const stored = JSON.parse(fixture.record.stateJson); stored.lastFetchAttemptAt = null; fixture.record.stateJson = JSON.stringify(stored);
  const nextStart = new Promise(resolve => { started = resolve; });
  const stale = write({ type: "fetch", expectedRevision: 2 });
  await nextStart;
  await write({ type: "configure", sourceUrl: "https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players", expectedRevision: 2 });
  release(snapshot);
  await assert.rejects(stale, { code: "SEASON_CONFLICT" });
  view = await read(); assert.equal(view.raceHistory.totalCheckpoints, 2); assert.equal(view.snapshot.seriesId, "1510719");
});

test("reference loads freeze the original source date and repeat loads create real recorded checkpoints", async () => {
  reset();
  const first = await write({ type: "reference", expectedRevision: 0 });
  const second = await write({ type: "reference", expectedRevision: 1 });
  assert.equal(second.raceHistory.totalCheckpoints, 2);
  for (const point of second.raceHistory.checkpoints) {
    assert.equal(point.sourceCapturedAt, first.snapshot.fetchedAt); assert.equal(point.reason, "reference");
    assert.ok(point.recordedAt >= Date.parse(first.snapshot.fetchedAt));
  }
});
