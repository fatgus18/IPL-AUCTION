import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AuctionAction, Member, Player, PlayerInput, PlayerRole, RoomState } from "../lib/auction";

const { applyAction, AuctionError, createDemoState, createPlayerPool, createRoomState, getNextBid, upgradeRoomCatalog }:
  typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { CATALOG_VERSION, CATALOG_DATA_REVISION }:
  typeof import("../lib/player-catalog") = await import(new URL("../lib/player-catalog.ts", import.meta.url).href);

const NOW = 1_800_000_000_000;
const HOST = "demo-host";
const BIDDER = "demo-csk";

// This is the persisted 32-player starter pool, before catalog metadata existed.
// Keep its historical sample figures independent of the current catalog.
const legacyRows: [string, string, PlayerRole, number, number, number, number, number][] = [
  ["Rishabh Pant", "India", "Marquee", 200, 111, 3284, 0, 148.93],
  ["Virat Kohli", "India", "Marquee", 200, 252, 8004, 4, 131.97],
  ["Jasprit Bumrah", "India", "Marquee", 200, 133, 69, 165, 85.19],
  ["Rohit Sharma", "India", "Marquee", 200, 257, 6628, 15, 131.14],
  ["Jos Buttler", "England", "Wicketkeeper", 200, 107, 3582, 0, 147.53],
  ["Rashid Khan", "Afghanistan", "Bowler", 200, 121, 545, 149, 161.72],
  ["Hardik Pandya", "India", "All-rounder", 200, 137, 2525, 64, 145.61],
  ["Shubman Gill", "India", "Batter", 200, 103, 3216, 0, 135.70],
  ["Travis Head", "Australia", "Batter", 200, 25, 772, 2, 173.87],
  ["Pat Cummins", "Australia", "Bowler", 200, 58, 515, 63, 147.14],
  ["Suryakumar Yadav", "India", "Batter", 200, 150, 3594, 0, 145.33],
  ["Ravindra Jadeja", "India", "All-rounder", 200, 240, 2959, 160, 129.36],
  ["KL Rahul", "India", "Wicketkeeper", 200, 132, 4683, 0, 134.61],
  ["Andre Russell", "West Indies", "All-rounder", 200, 126, 2484, 115, 174.93],
  ["Yuzvendra Chahal", "India", "Bowler", 200, 160, 37, 205, 43.53],
  ["Sanju Samson", "India", "Wicketkeeper", 200, 168, 4419, 0, 138.96],
  ["Mitchell Starc", "Australia", "Bowler", 200, 41, 102, 51, 96.23],
  ["Shreyas Iyer", "India", "Batter", 200, 116, 3127, 0, 127.48],
  ["Nicholas Pooran", "West Indies", "Wicketkeeper", 200, 76, 1769, 0, 162.29],
  ["Mohammed Shami", "India", "Bowler", 150, 110, 69, 127, 93.24],
  ["Axar Patel", "India", "All-rounder", 150, 150, 1653, 123, 130.88],
  ["Yashasvi Jaiswal", "India", "Batter", 150, 53, 1607, 0, 150.61],
  ["Arshdeep Singh", "India", "Bowler", 150, 65, 25, 76, 64.10],
  ["Glenn Maxwell", "Australia", "All-rounder", 200, 134, 2771, 37, 156.73],
  ["Rinku Singh", "India", "Batter", 100, 45, 893, 0, 143.34],
  ["Ishan Kishan", "India", "Wicketkeeper", 150, 105, 2644, 0, 135.86],
  ["Kuldeep Yadav", "India", "Bowler", 150, 84, 191, 87, 79.25],
  ["Sunil Narine", "West Indies", "All-rounder", 200, 177, 1534, 180, 165.84],
  ["Shivam Dube", "India", "All-rounder", 100, 65, 1502, 5, 146.67],
  ["Sai Sudharsan", "India", "Batter", 100, 25, 1034, 0, 139.17],
  ["T Natarajan", "India", "Bowler", 100, 61, 3, 67, 60],
  ["Dhruv Jurel", "India", "Wicketkeeper", 50, 28, 347, 0, 151.53],
];

function legacyRoom(): RoomState {
  const room = createDemoState();
  room.players = legacyRows.map(([name, country, role, basePrice, matches, runs, wickets, strikeRate]) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, country, role, basePrice,
    isOverseas: country !== "India", status: "available", stats: { matches, runs, wickets, strikeRate },
  }));
  delete room.catalogVersion;
  delete room.catalogDataRevision;
  room.version = 17;
  room.serverTime = NOW - 10000;
  room.lastBidAt = NOW - 5000;
  const sold = room.players.find(player => player.id === "virat-kohli")!;
  Object.assign(sold, { status: "sold", soldTo: "csk", soldFor: 600 });
  room.teams.find(team => team.id === "csk")!.squad.push({ playerId: sold.id, amount: 600 });
  room.teams.find(team => team.id === "csk")!.purse -= 600;
  room.players.find(player => player.id === "jos-buttler")!.status = "unsold";
  return room;
}

function fresh(): RoomState {
  const members = createDemoState().members;
  const host = members.find(member => member.id === HOST) as Member;
  const room = createRoomState("POOL26", "Catalog test", host, NOW);
  room.members = members;
  return room;
}

function act(room: RoomState, action: AuctionAction, memberId = HOST): RoomState {
  return applyAction(room, action, memberId, NOW);
}

function rejected(room: RoomState, action: AuctionAction, code?: string, memberId = HOST): void {
  const before = structuredClone(room);
  assert.throws(() => act(room, action, memberId), (error: unknown) => {
    assert.ok(error instanceof AuctionError, "invalid input must be rejected as an auction error");
    if (code) assert.equal(error.code, code);
    return true;
  });
  assert.deepEqual(room, before, "rejections must not mutate the persisted room");
}

const manualPlayer: PlayerInput = {
  id: "organizer-player", name: "Organizer Player", country: "India", role: "Batter",
  basePrice: 75, isOverseas: false, eligibilityVerified: true,
  stats: { matches: null, runs: null, wickets: null, strikeRate: null },
  statsFormat: "Unknown", dataStatus: "manual",
};

test("legacy 32-player rooms receive the full 249-player catalog without changing auction records", () => {
  const room = legacyRoom();
  const before = structuredClone(room);
  assert.equal(room.players.length, 32);
  const upgraded = upgradeRoomCatalog(room, NOW);
  const canonicalIds = createPlayerPool().map(player => player.id);
  assert.equal(canonicalIds.length, 249);
  assert.ok(canonicalIds.every(id => upgraded.players.some(player => player.id === id)));
  assert.equal(new Set(upgraded.players.map(player => player.id)).size, upgraded.players.length);
  assert.deepEqual(upgraded.teams, room.teams, "purses and squads must survive migration exactly");
  assert.deepEqual(upgraded.members, room.members);
  assert.deepEqual(upgraded.bidHistory, room.bidHistory);
  assert.deepEqual(upgraded.settings, room.settings);
  for (const field of ["id", "code", "name", "createdAt", "hostId", "currentPlayerId", "currentBid", "leadingTeamId", "phase", "lastBidAt"] as const) {
    assert.deepEqual(upgraded[field], room[field], field);
  }
  for (const previous of room.players) {
    const player = upgraded.players.find(entry => entry.id === previous.id)!;
    for (const field of ["status", "soldTo", "soldFor", "basePrice", "role", "country", "isOverseas"] as const) {
      assert.deepEqual(player[field], previous[field], `${previous.id}.${field}`);
    }
  }
  assert.equal(upgraded.catalogVersion, CATALOG_VERSION);
  assert.equal(upgraded.catalogDataRevision, CATALOG_DATA_REVISION);
  assert.equal(upgraded.version, room.version + 1);
  assert.equal(upgraded.serverTime, NOW);
  assert.deepEqual(room, before, "migration must not mutate the input snapshot");
});

test("migration replaces untouched illustrative figures with sourced catalog facts", () => {
  const room = legacyRoom();
  const upgraded = upgradeRoomCatalog(room, NOW);
  const expected = createPlayerPool().find(player => player.id === "rishabh-pant")!;
  const actual = upgraded.players.find(player => player.id === expected.id)!;
  assert.notDeepEqual(actual.stats, room.players.find(player => player.id === expected.id)!.stats);
  assert.deepEqual(actual.stats, expected.stats);
  assert.equal(actual.statsFormat, expected.statsFormat);
  assert.equal(actual.dataStatus, expected.dataStatus);
  assert.deepEqual(actual.dataSources, expected.dataSources);
  assert.equal(actual.profileUrl, expected.profileUrl);
  assert.deepEqual(actual.catalogSheets, expected.catalogSheets);
});

test("retained Russell and Maxwell records gain sourced IPL statistics without changing settled or live finances", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../data/legacy-player-profiles.json", import.meta.url), "utf8")) as {
    profiles: Record<string, { stats: Player["stats"]; profileUrl: string; sourceUrls: string[]; fetchedAt: string }>;
  };
  const legacyIds = ["andre-russell", "glenn-maxwell"];
  assert.ok(createPlayerPool().every(player => !legacyIds.includes(player.id)), "legacy enrichment must not add players absent from the workbook to new rooms");
  for (const dataStatus of [undefined, "illustrative"] as const) {
    const room = legacyRoom();
    const russell = room.players.find(player => player.id === "andre-russell")!;
    Object.assign(russell, { status: "sold", soldTo: "kkr", soldFor: 800 });
    const winningTeam = room.teams.find(team => team.id === "kkr")!;
    winningTeam.purse -= 800;
    winningTeam.squad.push({ playerId: russell.id, amount: 800 });
    room.currentPlayerId = "glenn-maxwell";
    room.currentBid = 775;
    room.bidHistory.push({ id: "maxwell-leading", playerId: "glenn-maxwell", teamId: "rcb", memberId: "demo-rcb", amount: 775, at: NOW - 1000 });
    for (const id of legacyIds) room.players.find(player => player.id === id)!.dataStatus = dataStatus;
    const before = structuredClone(room);
    const upgraded = upgradeRoomCatalog(room, NOW);
    for (const id of legacyIds) {
      const previous = before.players.find(player => player.id === id)!;
      const actual = upgraded.players.find(player => player.id === id)!;
      const sourced = snapshot.profiles[id];
      assert.notDeepEqual(actual.stats, previous.stats, `${id} must lose its old sample figures`);
      assert.deepEqual(actual.stats, sourced.stats);
      assert.equal(actual.statsFormat, "IPL");
      assert.equal(actual.dataStatus, "verified");
      assert.equal(actual.profileUrl, sourced.profileUrl);
      assert.equal(new URL(actual.profileUrl!).hostname, "www.cricbuzz.com");
      assert.deepEqual(actual.dataSources?.map(source => source.url), sourced.sourceUrls);
      assert.equal(actual.dataUpdatedAt, sourced.fetchedAt);
      for (const field of ["status", "soldTo", "soldFor", "basePrice", "country", "isOverseas"] as const) {
        assert.deepEqual(actual[field], previous[field], `${id}.${field}`);
      }
    }
    assert.deepEqual(upgraded.teams, before.teams);
    assert.deepEqual(upgraded.bidHistory, before.bidHistory);
    for (const field of ["currentPlayerId", "currentBid", "leadingTeamId", "phase", "lastBidAt"] as const) {
      assert.deepEqual(upgraded[field], before[field], field);
    }
    assert.deepEqual(room, before);
  }
});

test("manual Russell and Maxwell statistics survive legacy profile enrichment with or without an explicit manual marker", () => {
  for (const id of ["andre-russell", "glenn-maxwell"]) {
    for (const dataStatus of [undefined, "manual"] as const) {
      const room = legacyRoom();
      const edited = room.players.find(player => player.id === id)!;
      edited.stats = { matches: 17, runs: 810, wickets: null, strikeRate: 155.5 };
      edited.statsFormat = "T20";
      edited.dataStatus = dataStatus;
      edited.basePrice = 425;
      const before = structuredClone(edited);
      const upgraded = upgradeRoomCatalog(room, NOW);
      const actual = upgraded.players.find(player => player.id === id)!;
      for (const field of Object.keys(before) as (keyof Player)[]) {
        assert.deepEqual(actual[field], before[field], `${id}.${field}`);
      }
      assert.deepEqual(upgraded.teams, room.teams);
    }
  }
});

test("a current catalog is an exact no-op with no duplicate players or activity", () => {
  const upgraded = upgradeRoomCatalog(legacyRoom(), NOW);
  const before = structuredClone(upgraded);
  assert.equal(upgraded.activity.filter(entry => entry.id.startsWith("catalog-")).length, 1);
  for (let repeat = 1; repeat <= 3; repeat += 1) {
    assert.strictEqual(upgradeRoomCatalog(upgraded, NOW + repeat), upgraded);
  }
  assert.deepEqual(upgraded, before);
  const newRoom = fresh();
  assert.strictEqual(upgradeRoomCatalog(newRoom, NOW + 1), newRoom);
});

test("custom players and manually corrected catalog data survive migration", () => {
  const room = legacyRoom();
  const custom = { ...manualPlayer, id: "organizer-player", status: "available" as const };
  room.players.push(custom);
  const edited = room.players.find(player => player.id === "rashid-khan")!;
  Object.assign(edited, {
    dataStatus: "manual", basePrice: 350, country: "Afghanistan", isOverseas: true,
    stats: { matches: 12, runs: null, wickets: 25, strikeRate: null }, statsFormat: "T20",
    image: "https://images.example.com/organizer-photo.jpg", profileUrl: "https://example.com/player",
    dataSources: [{ label: "Organizer scorebook", url: "https://example.com/scorebook" }],
  });
  const before = structuredClone(edited);
  const upgraded = upgradeRoomCatalog(room, NOW);
  assert.deepEqual(upgraded.players.find(player => player.id === custom.id), custom);
  const actual = upgraded.players.find(player => player.id === edited.id)!;
  for (const field of Object.keys(before) as (keyof Player)[]) assert.deepEqual(actual[field], before[field], field);
  assert.ok(actual.catalogSheets?.length);
});

test("legacy edits without a data-status marker are not mistaken for untouched sample data", () => {
  const room = legacyRoom();
  const edited = room.players.find(player => player.id === "rishabh-pant")!;
  edited.stats.runs = 4001;
  edited.basePrice = 500;
  const upgraded = upgradeRoomCatalog(room, NOW);
  const actual = upgraded.players.find(player => player.id === edited.id)!;
  assert.deepEqual(actual.stats, edited.stats);
  assert.equal(actual.basePrice, 500);
});

test("matching custom identities prevent duplicate catalog entries during migration", () => {
  const room = legacyRoom();
  const customIdentity = room.players.find(player => player.id === "rashid-khan")!;
  customIdentity.id = "organizer-rashid";
  customIdentity.name = "RASHID  KHAN";
  customIdentity.dataStatus = "manual";
  const upgraded = upgradeRoomCatalog(room, NOW);
  assert.deepEqual(upgraded.players.find(player => player.id === "organizer-rashid"), customIdentity);
  assert.ok(!upgraded.players.some(player => player.id === "rashid-khan"));
});

test("metadata refresh never resurrects a catalog player deleted by the organizer", () => {
  const removedId = "rishabh-pant";
  const room = act(fresh(), { type: "delete_player", playerId: removedId });
  room.catalogDataRevision = "prior-profile-snapshot";
  const before = structuredClone(room);
  const refreshed = upgradeRoomCatalog(room, NOW + 1);
  assert.equal(refreshed.catalogVersion, CATALOG_VERSION);
  assert.equal(refreshed.catalogDataRevision, CATALOG_DATA_REVISION);
  assert.equal(refreshed.players.length, 248);
  assert.ok(!refreshed.players.some(player => player.id === removedId));
  assert.deepEqual(refreshed.activity, before.activity, "metadata-only refresh must not claim it added players");
  assert.deepEqual(refreshed.teams, before.teams);
  assert.strictEqual(upgradeRoomCatalog(refreshed, NOW + 2), refreshed);
  assert.deepEqual(room, before);
});

test("metadata refresh can resolve an imported identity without overwriting auction terms", () => {
  const room = fresh();
  room.catalogDataRevision = "prior-profile-snapshot";
  const player = room.players.find(entry => entry.id === "rashid-khan")!;
  Object.assign(player, {
    country: "Unverified", isOverseas: false, eligibilityVerified: false, dataStatus: "partial",
    stats: { matches: null, runs: null, wickets: null, strikeRate: null }, statsFormat: "Unknown",
    basePrice: 375, role: "Bowler", status: "unsold",
  });
  const refreshed = upgradeRoomCatalog(room, NOW);
  const actual = refreshed.players.find(entry => entry.id === player.id)!;
  const canonical = createPlayerPool().find(entry => entry.id === player.id)!;
  assert.equal(actual.eligibilityVerified, true);
  assert.equal(actual.country, "Afghanistan");
  assert.equal(actual.isOverseas, true);
  assert.deepEqual(actual.stats, canonical.stats);
  assert.equal(actual.basePrice, 375);
  assert.equal(actual.role, "Bowler");
  assert.equal(actual.status, "unsold");
});

test("metadata refresh fills sourced facts for catalog players whose country was already known", () => {
  const room = fresh();
  room.catalogDataRevision = "before-profiles-were-fetched";
  const player = room.players.find(entry => entry.id === "rishabh-pant")!;
  Object.assign(player, {
    country: "India", isOverseas: false, eligibilityVerified: true, dataStatus: "partial",
    stats: { matches: null, runs: null, wickets: null, strikeRate: null }, statsFormat: "Unknown",
    profileUrl: undefined, dataSources: [], dataUpdatedAt: undefined,
  });
  const refreshed = upgradeRoomCatalog(room, NOW);
  const actual = refreshed.players.find(entry => entry.id === player.id)!;
  const canonical = createPlayerPool().find(entry => entry.id === player.id)!;
  assert.ok(Object.values(canonical.stats).some(value => value !== null));
  assert.deepEqual(actual.stats, canonical.stats);
  assert.equal(actual.profileUrl, canonical.profileUrl);
  assert.deepEqual(actual.dataSources, canonical.dataSources);
  assert.equal(actual.country, "India");
});

test("data-only refresh preserves an organizer's explicit manual override", () => {
  const room = fresh();
  const original = room.players.find(player => player.id === "rishabh-pant")!;
  const edited = act(room, {
    type: "update_player",
    player: { ...original, dataStatus: "manual", statsFormat: "T20", stats: { matches: 10, runs: 700, wickets: null, strikeRate: 155.1 }, basePrice: 450 },
  });
  edited.catalogDataRevision = "previous-profile-snapshot";
  const before = structuredClone(edited.players.find(player => player.id === original.id)!);
  const refreshed = upgradeRoomCatalog(edited, NOW);
  assert.deepEqual(refreshed.players.find(player => player.id === original.id), before);
});

test("unknown statistics remain null while actual zeroes remain zero", () => {
  const room = act(fresh(), { type: "add_player", player: manualPlayer });
  const player = room.players.find(entry => entry.id === manualPlayer.id)!;
  assert.deepEqual(player.stats, { matches: null, runs: null, wickets: null, strikeRate: null });
  const edited = act(room, { type: "update_player", player: { ...player, stats: { matches: 0, runs: null, wickets: 0, strikeRate: 0 } } });
  assert.deepEqual(edited.players.find(entry => entry.id === player.id)!.stats, { matches: 0, runs: null, wickets: 0, strikeRate: 0 });
});

test("nullable statistics still reject negative, nonfinite, fractional-count and out-of-range values", () => {
  const room = fresh();
  const invalidStats: Player["stats"][] = [
    { ...manualPlayer.stats, matches: -1 }, { ...manualPlayer.stats, runs: -1 },
    { ...manualPlayer.stats, wickets: -1 }, { ...manualPlayer.stats, strikeRate: -1 },
    { ...manualPlayer.stats, matches: 1.5 }, { ...manualPlayer.stats, runs: 1.5 },
    { ...manualPlayer.stats, wickets: 0.5 }, { ...manualPlayer.stats, runs: NaN },
    { ...manualPlayer.stats, strikeRate: Infinity }, { ...manualPlayer.stats, wickets: 10001 },
    { ...manualPlayer.stats, matches: 10001 }, { ...manualPlayer.stats, strikeRate: 1001 },
  ];
  for (const stats of invalidStats) rejected(room, { type: "add_player", player: { ...manualPlayer, stats } });
  const accepted = act(room, { type: "add_player", player: { ...manualPlayer, stats: { ...manualPlayer.stats, strikeRate: 137.52 } } });
  assert.equal(accepted.players.find(entry => entry.id === manualPlayer.id)!.stats.strikeRate, 137.52);
});

test("profile, image and data-source metadata only accept safe HTTPS links", () => {
  const room = fresh();
  const unsafeUrls = ["javascript:alert(1)", "http://example.com/profile", "/profile", "data:text/html,test", "https://name:secret@example.com/profile"];
  for (const url of unsafeUrls) {
    for (const metadata of [{ profileUrl: url }, { image: url }, { dataSources: [{ label: "Source", url }] }]) {
      rejected(room, { type: "add_player", player: { ...manualPlayer, ...metadata } });
    }
  }
  const metadata = {
    profileUrl: "https://example.com/profile", image: "https://images.example.com/photo.jpg",
    dataSources: [{ label: "  Verified source  ", url: "https://example.com/statistics" }],
  };
  const accepted = act(room, { type: "add_player", player: { ...manualPlayer, ...metadata } });
  const player = accepted.players.find(entry => entry.id === manualPlayer.id)!;
  assert.equal(player.profileUrl, metadata.profileUrl);
  assert.equal(player.image, metadata.image);
  assert.deepEqual(player.dataSources, [{ label: "Verified source", url: "https://example.com/statistics" }]);
});

test("metadata enums, source limits and eligibility types are validated", () => {
  const room = fresh();
  const invalidPlayers: PlayerInput[] = [
    { ...manualPlayer, statsFormat: "Unsupported" as Player["statsFormat"] },
    { ...manualPlayer, dataStatus: "Unsupported" as Player["dataStatus"] },
    { ...manualPlayer, eligibilityVerified: "true" as unknown as boolean },
    { ...manualPlayer, dataSources: Array.from({ length: 6 }, () => ({ label: "Source", url: "https://example.com" })) },
    { ...manualPlayer, dataSources: [{ label: " ", url: "https://example.com" }] },
  ];
  for (const player of invalidPlayers) rejected(room, { type: "add_player", player });
});

test("unknown eligibility blocks opening and cannot be bypassed with a direct bid", () => {
  const added = act(fresh(), { type: "add_player", player: { ...manualPlayer, country: "Unverified", eligibilityVerified: false } });
  const waiting = act(added, { type: "select_player", playerId: manualPlayer.id! });
  rejected(waiting, { type: "start" }, "PLAYER_REVIEW_REQUIRED");
  const staleLive = structuredClone(waiting);
  staleLive.phase = "live";
  rejected(staleLive, { type: "bid", expectedPlayerId: manualPlayer.id!, expectedAmount: getNextBid(staleLive) }, "PLAYER_REVIEW_REQUIRED", BIDDER);
});

test("the auctioneer can verify a waiting player and then open bidding", () => {
  const added = act(fresh(), { type: "add_player", player: { ...manualPlayer, country: "Unverified", eligibilityVerified: false } });
  const waiting = act(added, { type: "select_player", playerId: manualPlayer.id! });
  const selected = waiting.players.find(player => player.id === manualPlayer.id)!;
  const corrected = { ...selected, country: "England", isOverseas: true, eligibilityVerified: true };
  rejected(waiting, { type: "update_player", player: corrected }, "FORBIDDEN", BIDDER);
  const reviewed = act(waiting, { type: "update_player", player: corrected });
  assert.equal(reviewed.players.find(player => player.id === manualPlayer.id)!.eligibilityVerified, true);
  const live = act(reviewed, { type: "start" });
  const bidding = act(live, { type: "bid", expectedPlayerId: selected.id, expectedAmount: selected.basePrice }, BIDDER);
  assert.equal(bidding.leadingTeamId, "csk");
});

test("an Unverified country cannot be bypassed by setting eligibilityVerified true", () => {
  const added = act(fresh(), { type: "add_player", player: { ...manualPlayer, country: "Unverified", eligibilityVerified: true } });
  assert.equal(added.players.find(player => player.id === manualPlayer.id)!.eligibilityVerified, false);
  rejected(act(added, { type: "select_player", playerId: manualPlayer.id! }), { type: "start" }, "PLAYER_REVIEW_REQUIRED");
});

test("player metadata cannot change during live, paused or locked bidding, or after sale", () => {
  const room = createDemoState();
  const paused = act(room, { type: "pause" });
  const locked = act(room, { type: "lock" });
  const sold = act(locked, { type: "sell" });
  for (const state of [room, paused, locked, sold]) {
    const player = state.players.find(entry => entry.id === state.currentPlayerId)!;
    rejected(state, { type: "update_player", player: { ...player, country: "England", isOverseas: true } });
  }
  const nextPlayer = act(sold, { type: "select_player", playerId: "virat-kohli" });
  const settled = nextPlayer.players.find(player => player.id === "rishabh-pant")!;
  rejected(nextPlayer, { type: "update_player", player: { ...settled, stats: manualPlayer.stats } });
});

test("duplicate names in the same country cannot create a second auction identity", () => {
  const room = act(fresh(), { type: "add_player", player: manualPlayer });
  rejected(room, {
    type: "add_player",
    player: { ...manualPlayer, id: "second-organizer-player", name: "  ORGANIZER-PLAYER  ", country: "india" },
  }, "PLAYER_EXISTS");
  const namesake = act(room, {
    type: "add_player",
    player: { ...manualPlayer, id: "overseas-namesake", country: "England", isOverseas: true },
  });
  assert.ok(namesake.players.some(player => player.id === "overseas-namesake"));
  assert.ok(namesake.players.some(player => player.id === manualPlayer.id));
});

test("the same sourced profile cannot be added again under another spelling or country", () => {
  const profileUrl = "https://example.com/profiles/unique-player";
  const room = act(fresh(), { type: "add_player", player: { ...manualPlayer, profileUrl } });
  rejected(room, {
    type: "add_player",
    player: { ...manualPlayer, id: "alternate-profile-name", name: "Alternate Spelling", country: "England", isOverseas: true, profileUrl },
  }, "PLAYER_EXISTS");
});
