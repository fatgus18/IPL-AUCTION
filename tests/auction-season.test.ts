import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import type { Player } from "../lib/auction";
import type { SeasonSourceRow } from "../lib/season-source";
const { applyAction, createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { buildAuctionSeason, emptyAuctionSeason, matchSeasonRows, sumSeasonPoints, seasonSourceKey }: typeof import("../lib/auction-season") = await import(new URL("../lib/auction-season.ts", import.meta.url).href);
const { createSeasonWorkbook }: typeof import("../lib/season-export") = await import(new URL("../lib/season-export.ts", import.meta.url).href);
const { getSeasonReference, SEASON_REFERENCE_METADATA }: typeof import("../lib/season-reference") = await import(new URL("../lib/season-reference.ts", import.meta.url).href);

function source(name: string, points: number, providerPlayerId: string | null = null): SeasonSourceRow {
  return { name, points, providerPlayerId, profileUrl: null, matches: 12, runs: 234, wickets: 5, teamName: "Provider franchise", battingImpact: null, bowlingImpact: null };
}
function fixture() {
  const state = createDemoState();
  const team = state.teams.find(team => team.id === "rcb")!;
  const players = state.players.slice(0, 5);
  players.forEach((player, index) => {
    player.status = "sold"; player.soldTo = team.id; player.soldFor = 100 + index * 25;
    team.squad.push({ playerId: player.id, amount: player.soldFor });
  });
  team.lineup = { playingXI: [players[0].id, null, players[1].id], substitutes: [players[2].id], captainId: players[0].id, viceCaptainId: players[1].id, revision: 1 };
  const stored = emptyAuctionSeason();
  stored.snapshot = { sourceUrl: stored.sourceUrl, provider: "espncricinfo", seriesId: "1510719", seriesName: "IPL 2026", fetchedAt: "2026-11-20T12:00:00.000Z", rows: [source(players[0].name, 10.25), source(players[1].name, -3.35), source(players[2].name, 1.23), source(players[3].name, 0)] };
  stored.method = "import";
  return { state, team, players, stored };
}

test("entire purchased squad scores with exact C/VC multipliers, negative values and unknown coverage", () => {
  const { state, players, stored } = fixture();
  const before = structuredClone(state);
  const view = buildAuctionSeason(state, stored);
  const team = view.teams.find(team => team.id === "rcb")!;
  assert.deepEqual(state, before);
  assert.equal(team.players.length, 5);
  assert.equal(team.players.find(player => player.id === players[0].id)?.points, 20.5);
  assert.equal(team.players.find(player => player.id === players[1].id)?.points, -5.025);
  assert.equal(team.players.find(player => player.id === players[2].id)?.points, 1.23, "substitute contributes");
  assert.equal(team.players.find(player => player.id === players[3].id)?.points, 0, "reserve contributes observed zero");
  assert.equal(team.players.find(player => player.id === players[4].id)?.points, null, "unobserved is unknown, not zero");
  assert.equal(team.knownPoints, 16.705);
  assert.equal(team.points, 16.705);
  assert.equal(team.complete, false);
  assert.deepEqual(view.coverage, { matchedPlayers: 4, totalPlayers: 5, sourceRows: 4, unmatchedPlayers: 1 });
  assert.equal(view.provisional, true);
  assert.equal(sumSeasonPoints([0.1, 0.2, 0.3, -0.1]), 0.5);
  assert.equal(sumSeasonPoints([1e-7, 2e-7]), 3e-7);
});

test("current saved lineups and corrected sales recompute without changing source snapshot", () => {
  const { state, players, team, stored } = fixture();
  state.endedAt = Date.now();
  state.completedManagers = { rcb: { id: "former-manager", name: "Original captain" } };
  state.myTargetPicks = { teamId: "rcb", playerIds: ["SECRET-TARGET"], maxBids: { "SECRET-TARGET": 900 }, revision: 1 };
  state.activity.push({ id: "private", type: "chat", text: "SECRET-CHAT", at: Date.now() });
  team.lineup!.captainId = players[2].id;
  team.lineup!.viceCaptainId = players[1].id;
  let view = buildAuctionSeason(state, stored);
  assert.equal(view.teams.find(entry => entry.id === "rcb")!.players.find(entry => entry.id === players[2].id)!.multiplier, 2, "a purchased substitute can captain the squad");
  assert.equal(view.provisional, false);
  assert.equal(view.teams.find(entry => entry.id === "rcb")!.manager, "Original captain");
  team.lineup!.captainId = players[1].id;
  view = buildAuctionSeason(state, stored);
  assert.equal(view.teams.find(entry => entry.id === "rcb")!.players.find(entry => entry.id === players[1].id)!.multiplier, 2);
  assert.equal(view.teams.find(entry => entry.id === "rcb")!.players.filter(entry => entry.viceCaptain).length, 0, "same player cannot be C and VC");
  players[0].soldTo = "mi";
  state.teams.find(team => team.id === "mi")!.squad.push({ playerId: players[0].id, amount: 100 });
  view = buildAuctionSeason(state, stored);
  assert.equal(view.teams.find(entry => entry.id === "rcb")!.totalPlayers, 4);
  assert.equal(view.teams.find(entry => entry.id === "mi")!.points, 10.25);
  assert.doesNotMatch(JSON.stringify(view), /SECRET|myTargetPicks|memberId|tokenHashes|password|fetchRequestId|activity/);
});

test("captaincy changes after the season starts recalculate reserve points and workbook leadership", async () => {
  const { state, players, team, stored } = fixture();
  state.endedAt = Date.now();
  team.lineup!.playingXI = []; team.lineup!.substitutes = [];
  const sourceBefore = structuredClone(stored);
  const saved = applyAction(state, { type: "set_captaincy", teamId: team.id, captainId: players[1].id, viceCaptainId: players[0].id, expectedRevision: 1 }, "demo-rcb");
  const view = buildAuctionSeason(saved, stored);
  const scored = view.teams.find(entry => entry.id === team.id)!;
  assert.equal(scored.players.find(player => player.id === players[1].id)!.points, -6.7, "reserve captain preserves signed scoring");
  assert.equal(scored.players.find(player => player.id === players[0].id)!.points, 15.375);
  assert.equal(scored.points, 9.905);
  assert.ok(scored.players.every(player => player.selection === "Squad"));
  assert.deepEqual(stored, sourceBefore, "captaincy recomputes against the existing season snapshot");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await createSeasonWorkbook(view)).buffer);
  const points = workbook.getWorksheet("POINTS")!;
  const captain = points.getRows(5, points.rowCount - 4)!.find(row => row.getCell(3).value === players[1].name)!;
  assert.equal(captain.getCell(5).value, "Squad"); assert.equal(captain.getCell(6).value, "C");
  assert.equal(captain.getCell(8).value, 2); assert.equal(captain.getCell(9).value, -6.7);
  const invalid = structuredClone(saved); invalid.teams.find(entry => entry.id === team.id)!.lineup!.captainId = "unknown-player";
  assert.equal(buildAuctionSeason(invalid, stored).teams.find(entry => entry.id === team.id)!.players.filter(player => player.captain).length, 0);
});

test("stable IDs override spelling, exact names work and ambiguous identities require mapping", () => {
  const { state } = fixture();
  const base = state.players[0];
  const players: Player[] = [
    { ...base, id: "new-a", name: "A New Name", profileUrl: "https://www.espncricinfo.com/cricketers/a-new-name-123456" },
    { ...base, id: "new-b", name: "Same Name", profileUrl: undefined },
    { ...base, id: "new-c", name: "Same Name", profileUrl: undefined },
  ];
  const rows = [source("Provider Spelling", 20, "123456"), source("Same Name", 10), source("Other Name", 10)];
  let matched = matchSeasonRows(players, rows);
  assert.deepEqual(matched.map(row => [row.playerId, row.match]), [["new-a", "id"], [null, null], [null, null]]);
  matched = matchSeasonRows(players, rows, { [seasonSourceKey(rows[1])]: "new-b" });
  assert.equal(matched[1].playerId, "new-b"); assert.equal(matched[1].match, "manual");
  assert.equal(matchSeasonRows(players, [source("A New Name", 99, "999999")])[0].playerId, null, "conflicting provider IDs must not fall back to a name");
  assert.equal(matchSeasonRows(players, [source("A New Name", 99, "999999")], { "id:999999": "new-a" })[0].playerId, null, "a stale manual mapping cannot override conflicting provider IDs");
  const growingSource = matchSeasonRows(players, [source("Old Alias", 50), source("Provider Spelling", 20, "123456")], { "name:oldalias": "new-a" });
  assert.equal(growingSource[0].playerId, null); assert.equal(growingSource[1].playerId, "new-a", "a newly available verified row wins over a saved name-only mapping");
  assert.equal(matchSeasonRows(players, [source("A New Name", 99)])[0].playerId, "new-a");
  assert.equal(matchSeasonRows(players, [source("A Name", 99)])[0].playerId, null, "no fuzzy guessed identities");
  assert.ok(matchSeasonRows(players, [rows[0], { ...rows[0], name: "Second Row" }]).every(row => row.playerId === null), "duplicate source IDs cannot score twice");
});

test("one-to-one identity batches do not double score alias rows, tied ranks remain tied", () => {
  const { state, stored, players } = fixture();
  const duplicatedName = [{ ...players[0], id: "only-player", name: "Exact Name", profileUrl: undefined }];
  const matched = matchSeasonRows(duplicatedName, [source("Exact Name", 2, "123"), source("Exact Name", 4, "456")]);
  assert.ok(matched.every(row => row.playerId === null));
  const first = state.teams.find(team => team.id === "rcb")!;
  first.squad = [{ playerId: players[0].id, amount: 100 }]; delete first.lineup;
  const second = state.teams.find(team => team.id === "mi")!;
  players[1].soldTo = "mi"; second.squad = [{ playerId: players[1].id, amount: 100 }];
  stored.snapshot!.rows[1].points = stored.snapshot!.rows[0].points;
  const view = buildAuctionSeason(state, stored);
  assert.equal(view.teams.find(team => team.id === "rcb")!.rank, 1);
  assert.equal(view.teams.find(team => team.id === "mi")!.rank, 1);
  assert.equal(view.teams.find(team => team.id === "csk")!.rank, null);
});

test("source changes retain honest provenance and workbook carries all actual points with blanks", async () => {
  const { state, stored } = fixture();
  state.name = "=SUM(A1:A99)";
  stored.sourceUrl = "https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players";
  const view = buildAuctionSeason(state, stored);
  assert.equal(view.sourceChanged, true);
  assert.equal(view.snapshot!.seriesId, "1510719");
  const bytes = await createSeasonWorkbook(view);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(new Uint8Array(bytes).buffer);
  for (const name of ["POINTS", "THE TEAMS", "Rules", "Standings", "Source coverage", "Unmatched squad players"]) assert.ok(workbook.getWorksheet(name));
  const points = workbook.getWorksheet("POINTS")!;
  assert.equal(points.getCell("I5").value, 20.5);
  assert.equal(points.getCell("I6").value, -5.025);
  assert.equal(workbook.getWorksheet("Standings")!.getCell("A1").value, "=SUM(A1:A99)", "user strings stay text");
  let formulas = 0;
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => { if (cell.type === ExcelJS.ValueType.Formula) formulas++; })));
  assert.equal(formulas, 0);
});

test("dated reference projections and Excel preserve capture provenance rather than claim a live refresh", async () => {
  const { state, stored } = fixture();
  stored.snapshot = getSeasonReference(stored.sourceUrl);
  stored.method = "reference";
  const view = buildAuctionSeason(state, stored, { revision: 8, updatedAt: Date.now(), reference: SEASON_REFERENCE_METADATA });
  assert.equal(view.snapshot!.method, "reference");
  assert.equal(view.snapshot!.fetchedAt, "2026-11-19T20:00:31.557Z");
  assert.equal(view.reference!.playerCount, 202);
  assert.equal(view.sourceChanged, false);
  stored.sourceUrl = "https://www.cricinfo.com/series/1510719/most-valuable-players";
  assert.equal(buildAuctionSeason(state, stored, { reference: SEASON_REFERENCE_METADATA }).sourceChanged, false, "equivalent official series URL accepts the reference's canonical provenance");
  stored.sourceUrl = "https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players";
  assert.equal(buildAuctionSeason(state, stored, { reference: null }).sourceChanged, true, "a different season never relabels old data");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(new Uint8Array(await createSeasonWorkbook(view)).buffer);
  const rules: string[] = [];
  workbook.getWorksheet("Rules")!.eachRow(row => row.eachCell(cell => { if (typeof cell.value === "string") rules.push(cell.value); }));
  assert.ok(rules.some(value => value.includes("not a live fetch")));
  assert.ok(rules.some(value => value.includes("Captured 2026-11-19T20:00:31.557Z")));
});

test("season workbook includes every PDF statistics board plus precise player deviation and signed per-match points", async () => {
  const { state, stored, players } = fixture();
  const view = buildAuctionSeason(state, stored);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await createSeasonWorkbook(view)).buffer);
  const stats = workbook.getWorksheet("Season analytics")!;
  const tournament = workbook.getWorksheet("Tournament stats")!;
  assert.ok(stats); assert.ok(tournament);
  const titles = new Set<string>();
  stats.eachRow((row, number) => { if (number >= 5 && typeof row.getCell(1).value === "string") titles.add(row.getCell(1).value as string); });
  assert.equal(view.analytics.boards.length, 20);
  assert.equal(titles.size, 20);
  for (const board of view.analytics.boards) assert.ok(titles.has(board.title), `${board.title} is included in the download even when empty`);
  assert.equal(tournament.getCell("B5").value, 4);
  assert.equal(tournament.getCell("B6").value, 8.13);
  assert.equal(tournament.getCell("B7").value, 2.0325);
  const points = workbook.getWorksheet("POINTS")!;
  assert.equal(points.getCell("N4").value, "Deviation from source mean");
  assert.equal(points.getCell("O4").value, "Weighted points / match");
  assert.equal(points.getCell("N5").value, 8.2175, "deviation uses raw points even for the captain");
  assert.equal(points.getCell("O5").value, 20.5 / 12);
  assert.equal(points.getCell("O6").value, -5.025 / 12, "negative per-match values are preserved");
  const missing = points.getRows(5, points.rowCount - 4)!.find(row => row.getCell(3).value === players[4].name)!;
  assert.equal(missing.getCell(14).value, null); assert.equal(missing.getCell(15).value, null);
  const overview: string[] = [];
  tournament.eachRow(row => { if (typeof row.getCell(1).value === "string") overview.push(row.getCell(1).value as string); });
  assert.ok(overview.includes("Highest MVP")); assert.ok(overview.includes("Lowest MVP"));
  assert.ok(overview.some(value => value.startsWith("Podium")));
});

test("POINTS totals distinguish per-match coverage from MVP coverage", async () => {
  const { state, stored } = fixture();
  stored.snapshot!.rows[0].matches = null;
  const view = buildAuctionSeason(state, stored);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await createSeasonWorkbook(view)).buffer);
  const points = workbook.getWorksheet("POINTS")!;
  const total = points.getRows(5, points.rowCount - 4)!.find(row => row.getCell(3).value === "KNOWN TOTAL" && row.getCell(1).value === "Royal Challengers Bengaluru")!;
  assert.equal(total.getCell(13).value, "4/5 MVP scores · 3/5 per-match rates");
  assert.equal(total.getCell(15).value, view.analytics.boards.find(board => board.id === "points-per-match")!.rows.find(row => row.teamId === "rcb")!.value);
});
