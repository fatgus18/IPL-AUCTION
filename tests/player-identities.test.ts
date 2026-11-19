import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Player } from "../lib/auction";
import type { SeasonSourceRow } from "../lib/season-source";

const { alignVerifiedPlayerNames, getPlayerSeasonIdentity, normalizeSeasonName }: typeof import("../lib/player-identities") = await import(new URL("../lib/player-identities.ts", import.meta.url).href);
const { createPlayerPool, createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { syncRoomPlayerCatalog }: typeof import("../lib/shared-player-catalog") = await import(new URL("../lib/shared-player-catalog.ts", import.meta.url).href);
const { buildAuctionSeason, emptyAuctionSeason, matchSeasonRows }: typeof import("../lib/auction-season") = await import(new URL("../lib/auction-season.ts", import.meta.url).href);
const verified = JSON.parse(await readFile(new URL("../data/player-identities.json", import.meta.url), "utf8")) as {
  players: { id: string; providerPlayerId: string; canonicalName: string; aliases: string[] }[];
};

const corrections: [string, string, string][] = [
  ["allah-ghazanfar", "Allah Ghazanfar", "AM Ghazanfar"],
  ["philip-salt", "Philip Salt", "Phil Salt"],
  ["smaran-ravichandran", "Smaran Ravichandran", "Ravichandran Smaran"],
  ["akshat-raghuvanshi", "Akshat Raghuvanshi", "Akshat Raghuwanshi"],
  ["abhishek-porel", "Abhishek Porel", "Abishek Porel"],
  ["shahrukh-khan", "Shahrukh Khan", "M Shahrukh Khan"],
  ["vaibhav-suryavanshi", "Vaibhav Suryavanshi", "Vaibhav Sooryavanshi"],
  ["rasikh-dar-salam", "Rasikh Dar Salam", "Rasikh Salam"],
  ["yash-raj-punia", "Yash Raj Punia", "Yash Raj Punja"],
  ["raj-bawa", "Raj Bawa", "Raj\u00a0Bawa"],
  ["r-sai-kishore", "R Sai Kishore", "Sai Kishore"],
];
const pool = createPlayerPool();
const row = (name: string, providerPlayerId: string | null = null, points = 12.34): SeasonSourceRow => ({
  name, providerPlayerId, points, profileUrl: null, teamName: null, matches: null, runs: null, wickets: null, battingImpact: null, bowlingImpact: null,
});

test("all eleven observed spelling variants correct names while preserving stable IDs and every other fact", () => {
  const legacy = corrections.map(([id, name]) => ({ ...pool.find(player => player.id === id)!, name }));
  const before = structuredClone(legacy);
  const aligned = alignVerifiedPlayerNames(legacy);
  assert.equal(aligned.length, 11);
  corrections.forEach(([id, , canonical], index) => {
    assert.equal(aligned[index].id, id);
    assert.equal(aligned[index].name, canonical);
    assert.deepEqual({ ...aligned[index], name: before[index].name }, before[index], `${id} facts, portraits, stats and finances remain intact`);
  });
  assert.deepEqual(legacy, before, "alignment does not mutate its input");
  assert.equal(alignVerifiedPlayerNames(aligned), aligned, "already migrated arrays are idempotent with no extra write needed");
});

test("fresh catalogs already contain corrected names and exactly the original stable IDs", () => {
  for (const [id, , canonical] of corrections) assert.equal(pool.find(player => player.id === id)?.name, canonical);
  assert.equal(new Set(pool.map(player => player.id)).size, pool.length);
  assert.equal(alignVerifiedPlayerNames(pool), pool);
});

test("manual custom players and deliberate unrelated display-name edits are not overwritten", () => {
  const players = [
    { id: "custom-player", name: "Philip Salt", note: "A manually entered player" },
    { id: "philip-salt", name: "Custom manager label", note: "Preserve an intentional edit" },
    { id: "unknown-name", name: "Unknown Local Player", note: "Not present in provider" },
  ];
  assert.equal(alignVerifiedPlayerNames(players), players);
  assert.equal(getPlayerSeasonIdentity(players[0]).providerPlayerId, null);
});

test("provider identity records are unique and spelling aliases do not collide across known people", () => {
  assert.equal(verified.players.length, 192);
  assert.equal(new Set(verified.players.map(player => player.id)).size, verified.players.length);
  assert.equal(new Set(verified.players.map(player => player.providerPlayerId)).size, verified.players.length);
  const names = new Map<string, string>();
  for (const player of verified.players) {
    for (const name of [player.canonicalName, ...player.aliases]) {
      const normalized = normalizeSeasonName(name);
      assert.ok(!names.has(normalized) || names.get(normalized) === player.id, `${name} must not alias different people`);
      names.set(normalized, player.id);
    }
  }
});

test("official profile identities support both domains, legacy routes and profiles without a slug", () => {
  for (const profileUrl of [
    "https://www.cricinfo.com/cricketers/virat-kohli-253802", "https://www.espncricinfo.com/cricketers/virat-kohli-253802",
    "https://www.cricinfo.com/cricketers/253802", "https://www.espncricinfo.com/ci/content/player/253802.html",
  ]) assert.equal(getPlayerSeasonIdentity({ id: "custom-kohli", name: "V Kohli", profileUrl }).providerPlayerId, "253802");
  assert.equal(getPlayerSeasonIdentity({ id: "custom", name: "Unknown", profileUrl: "https://evil.test/cricketers/virat-kohli-253802" }).providerPlayerId, null);
});

test("normalization tolerates accents, punctuation and nonbreaking spaces without collapsing unrelated scripts", () => {
  assert.equal(normalizeSeasonName(" Raj\u00a0Bawa "), normalizeSeasonName("Raj Bawa"));
  assert.equal(normalizeSeasonName("José O'Neil"), normalizeSeasonName("Jose ONeil"));
  assert.notEqual(normalizeSeasonName("विराट"), normalizeSeasonName("रोहित"));
  assert.equal(normalizeSeasonName("KL Rahul"), normalizeSeasonName("K. L. Rahul"));
});

test("completed room names stay frozen while season scoring resolves the same historical IDs", () => {
  const state = createDemoState();
  const player = state.players.find(entry => entry.id === "philip-salt")!;
  player.name = "Philip Salt";
  Object.assign(player, { status: "sold", soldTo: "rcb", soldFor: 175 });
  const team = state.teams.find(entry => entry.id === "rcb")!;
  team.squad = [{ playerId: player.id, amount: 175 }]; team.purse -= 175;
  state.endedAt = 1_800_000_000_000;
  const before = structuredClone(state);
  const migrated = syncRoomPlayerCatalog(state, { players: pool, version: 99 });
  assert.equal(migrated.players.find(entry => entry.id === player.id)?.name, "Philip Salt");
  assert.deepEqual(migrated.teams, before.teams);
  assert.deepEqual(migrated.players, before.players);
  const identity = getPlayerSeasonIdentity(player);
  assert.ok(identity.providerPlayerId);
  const season = buildAuctionSeason(migrated, {
    ...emptyAuctionSeason(), method: "fetch",
    snapshot: { sourceUrl: emptyAuctionSeason().sourceUrl, provider: "espncricinfo", seriesId: "1510719", seriesName: "IPL 2026", fetchedAt: "2026-11-20T00:00:00.000Z", rows: [row("Phil Salt", identity.providerPlayerId, 88.25)] },
  });
  assert.equal(season.sourceRows[0].playerId, "philip-salt");
  assert.equal(season.sourceRows[0].match, "id");
  assert.equal(season.teams.find(entry => entry.id === "rcb")?.points, 88.25);
  assert.equal(season.teams.find(entry => entry.id === "rcb")?.players[0].name, "Philip Salt");
  assert.deepEqual(state, before);
});

test("ambiguous aliases and mismatched provider IDs remain unmatched instead of choosing a person", () => {
  const base = pool.find(player => player.id === "virat-kohli")!;
  const duplicates: Player[] = [{ ...base, id: "custom-one", name: "Same Name", profileUrl: undefined }, { ...base, id: "custom-two", name: "Same Name", profileUrl: undefined }];
  assert.equal(matchSeasonRows(duplicates, [row("Same Name")])[0].playerId, null);
  assert.equal(matchSeasonRows([base], [row("Virat Kohli", "999999999")])[0].playerId, null);
  const actual = getPlayerSeasonIdentity(base).providerPlayerId;
  assert.equal(matchSeasonRows([base], [row("Provider Changed Display Name", actual)])[0].playerId, base.id);
});
