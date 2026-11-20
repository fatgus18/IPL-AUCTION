import assert from "node:assert/strict";
import test from "node:test";
import type { Player, Team } from "../lib/auction";
import type { AuctionSeasonView } from "../lib/auction-season";
import type { SeasonSourceRow } from "../lib/season-source";
const { createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { buildAuctionSeason, emptyAuctionSeason, sumSeasonPoints }: typeof import("../lib/auction-season") = await import(new URL("../lib/auction-season.ts", import.meta.url).href);

function fixture() {
  const state = createDemoState();
  for (const team of state.teams) { team.squad = []; delete team.lineup; }
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "Available Gem", "Unsold Gem", "Duplicate Name", "Duplicate Name"];
  state.players = names.map((name, index): Player => ({ id: `analytics-${index}`, name, country: "India", role: "Batter", basePrice: 25, isOverseas: false, status: index === 9 ? "unsold" : "available", stats: { matches: null, runs: null, wickets: null, strikeRate: null } }));
  const a = state.teams.find(team => team.id === "rcb")!, b = state.teams.find(team => team.id === "mi")!;
  const buy = (team: Team, index: number, price: number) => { const player = state.players[index]; player.status = "sold"; player.soldTo = team.id; player.soldFor = price; team.squad.push({ playerId: player.id, amount: price }); };
  [1000, 200, 200, 500, 0, 600].forEach((price, index) => buy(a, index, price));
  buy(b, 6, 500); buy(b, 7, 1000);
  a.lineup = { playingXI: ["analytics-0", "analytics-1", "analytics-2", "analytics-3", null, null, "analytics-4"], substitutes: ["analytics-5"], captainId: "analytics-0", viceCaptainId: "analytics-1", revision: 1 };
  b.lineup = { playingXI: [null, "analytics-7", null, null, null, null, "analytics-6"], substitutes: [], captainId: "analytics-6", viceCaptainId: "analytics-7", revision: 1 };
  const values: [number, number, number | null, string | null][] = [[0, 100, 10, "RCB"], [1, 80, 8, "Royal Challengers Bengaluru"], [2, -20, 4, "MI"], [3, 0, 0, "Mumbai Indians"], [4, 50, null, "GT"], [6, 100, 5, "MI"], [7, -50, 5, "RCB"], [8, 100, 10, "RCB"], [9, 90, 9, "MI"], [10, 100, 10, "GT"]];
  const rows: SeasonSourceRow[] = values.map(([index, points, matches, teamName]) => ({ providerPlayerId: String(90000 + index), name: names[index], profileUrl: null, points, matches, teamName, runs: Math.max(0, points), wickets: index === 1 ? 8 : index === 4 ? 5 : 0, battingImpact: null, bowlingImpact: null }));
  rows.push({ providerPlayerId: "99999", name: "Outside Pool", profileUrl: null, points: 100, matches: 10, teamName: null, runs: 150, wickets: 12, battingImpact: null, bowlingImpact: null });
  const stored = emptyAuctionSeason();
  stored.snapshot = { sourceUrl: stored.sourceUrl, provider: "espncricinfo", seriesId: "1510719", seriesName: "IPL 2026", fetchedAt: "2026-11-20T12:00:00.000Z", rows };
  stored.method = "import";
  return { state, stored, a, b, buy };
}
const board = (view: AuctionSeasonView, id: string) => { const found = view.analytics.boards.find(board => board.id === id); assert.ok(found, id); return found; };
const teamRow = (view: AuctionSeasonView, id: string, teamId: string) => { const found = board(view, id).rows.find(row => row.teamId === teamId); assert.ok(found); return found; };

test("all 21 PDF panels are represented: 20 boards plus tournament statistics and tied extremes", () => {
  const { state, stored } = fixture();
  const before = structuredClone(state);
  const view = buildAuctionSeason(state, stored), analytics = view.analytics;
  assert.deepEqual(state, before, "analytics do not mutate purchases or lineups");
  assert.equal(analytics.ready, true); assert.equal(analytics.boards.length, 20);
  assert.equal(new Set(analytics.boards.map(board => board.id)).size, 20);
  assert.deepEqual(analytics.boards.map(board => board.id).sort(), ["overall", "points-per-match", "real-team-mvp", "efficient-franchises", "purist", "franchise-loyalty", "best-value", "top-mvp", "undrafted-gems", "captains", "dead-weight", "hardest-carry", "dynamic-duo", "roster-depth", "worst-value", "orange-cap", "purple-cap", "captaincy-regret", "heavy-top-order", "expensive-duds"].sort());
  assert.equal(analytics.tournament.trackedPlayers, 11); assert.equal(analytics.tournament.totalPoints, 650);
  assert.equal(analytics.tournament.averagePoints, 650 / 11);
  assert.equal(analytics.tournament.highestPlayers.length, 5);
  assert.equal(analytics.tournament.lowestPlayers[0].name, "Hotel"); assert.equal(analytics.tournament.lowestPlayers[0].value, -50);
  assert.deepEqual(analytics.coverage, { unmappedSourcePlayers: 2, sourcePlayersWithoutTeam: 1 });
  assert.deepEqual(analytics.podium.map(row => [row.teamId, row.rank, row.value]), [["rcb", 1, 350], ["mi", 2, 125]]);
  assert.equal(board(view, "overall").rows.length, 2, "empty franchises do not receive zero-point ranks");
});

test("player deviation uses unrounded all-source RAW mean and per-match preserves weighted signed precision", () => {
  const { state, stored } = fixture();
  const view = buildAuctionSeason(state, stored), team = view.teams.find(team => team.id === "rcb")!;
  const player = (id: string) => team.players.find(player => player.id === id)!;
  assert.equal(player("analytics-0").deviation, sumSeasonPoints([100, -(650 / 11)]));
  assert.notEqual(player("analytics-0").deviation, 200 - 650 / 11, "captain deviation must not double raw MVP");
  assert.equal(player("analytics-0").pointsPerMatch, 20); assert.equal(player("analytics-1").pointsPerMatch, 15);
  assert.equal(player("analytics-2").pointsPerMatch, -5);
  assert.equal(player("analytics-3").pointsPerMatch, null, "zero matches is not a zero average");
  assert.equal(player("analytics-4").pointsPerMatch, null); assert.equal(player("analytics-5").deviation, null);
  const average = teamRow(view, "points-per-match", "rcb");
  assert.equal(average.value, 30); assert.deepEqual(average.coverage, { matched: 3, total: 6, pending: 3 });
  assert.equal(teamRow(view, "points-per-match", "mi").value, 25);
});

test("real-franchise totals and efficiency use source ownership; loyalty includes every tied franchise", () => {
  const { state, stored } = fixture(); const view = buildAuctionSeason(state, stored);
  assert.equal(teamRow(view, "real-team-mvp", "rcb").value, 230);
  assert.equal(teamRow(view, "real-team-mvp", "mi").value, 170);
  assert.equal(teamRow(view, "real-team-mvp", "gt").value, 150);
  assert.equal(teamRow(view, "efficient-franchises", "rcb").value, 57.5);
  assert.equal(teamRow(view, "efficient-franchises", "gt").value, 75);
  assert.equal(teamRow(view, "real-team-mvp", "rcb").manager, undefined, "real IPL table must not imply the mock manager owns those scores");
  const loyalty = teamRow(view, "franchise-loyalty", "rcb");
  assert.equal(loyalty.value, 2);
  assert.deepEqual(new Set(loyalty.relatedNames), new Set(["Mumbai Indians", "Royal Challengers Bengaluru"]));
  assert.deepEqual(loyalty.coverage, { matched: 5, total: 6, pending: 1 });
});

test("value boards use raw points and exact ₹2/₹5 crore boundaries, with zero prices excluded", () => {
  const { state, stored } = fixture(); const view = buildAuctionSeason(state, stored);
  const best = board(view, "best-value").rows;
  assert.equal(best[0].name, "Bravo"); assert.equal(best[0].value, 40, "VC raw80 / ₹2Cr, not weighted120");
  assert.ok(best.every(row => row.playerId !== "analytics-4" && row.playerId !== "analytics-5"));
  const worst = board(view, "worst-value").rows;
  assert.deepEqual(worst.map(row => row.name), ["Charlie", "Hotel", "Delta", "Alpha", "Golf"]);
  assert.equal(worst[0].value, -10); assert.equal(worst[0].amountLakhs, 200);
  const duds = board(view, "expensive-duds").rows;
  assert.deepEqual(duds.map(row => [row.name, row.value]), [["Delta", 0], ["Alpha", 100], ["Golf", 100]]);
  assert.equal(duds[0].amountLakhs, 500); assert.equal(duds[1].rank, duds[2].rank);
  state.players[3].soldFor = 499; state.teams.find(team => team.id === "rcb")!.squad.find(entry => entry.playerId === "analytics-3")!.amount = 499;
  assert.ok(!board(buildAuctionSeason(state, stored), "expensive-duds").rows.some(row => row.name === "Delta"));
  state.teams.find(team => team.id === "rcb")!.squad.find(entry => entry.playerId === "analytics-2")!.amount = 199;
  assert.ok(!board(buildAuctionSeason(state, stored), "worst-value").rows.some(row => row.name === "Charlie"));
});

test("unmapped and ambiguous identities never become undrafted gems; caps use only known positive statistics", () => {
  const { state, stored } = fixture(); const view = buildAuctionSeason(state, stored);
  assert.deepEqual(board(view, "undrafted-gems").rows.map(row => [row.name, row.draftStatus]), [["Available Gem", "available"], ["Unsold Gem", "unsold"]]);
  const unknown = board(view, "top-mvp").rows.find(row => row.name === "Outside Pool")!;
  assert.equal(unknown.draftStatus, "unmapped"); assert.equal(unknown.manager, undefined);
  assert.equal(board(view, "orange-cap").rows[0].name, "Outside Pool"); assert.equal(board(view, "orange-cap").rows[0].value, 150);
  assert.equal(board(view, "purple-cap").rows[0].value, 12);
  assert.ok(board(view, "purple-cap").rows.every(row => row.value! > 0));
  assert.equal(board(view, "top-mvp").rows.find(row => row.name === "Alpha")!.teamId, "rcb");
});

test("archived and explicitly ineligible pool entries are never recommended as available gems", () => {
  const { state, stored } = fixture();
  state.players[8].catalogArchived = true;
  state.players[9].eligibilityVerified = false;
  const view = buildAuctionSeason(state, stored);
  assert.deepEqual(board(view, "undrafted-gems").rows, []);
  for (const name of ["Available Gem", "Unsold Gem"]) {
    const row = board(view, "top-mvp").rows.find(row => row.name === name)!;
    assert.equal(row.draftStatus, "excluded"); assert.match(row.detail!, /ineligible/);
  }
});

test("leadership, depth, signed carry and top-order formulas stay faithful to saved positions", () => {
  const { state, stored } = fixture(); const view = buildAuctionSeason(state, stored);
  assert.equal(teamRow(view, "purist", "rcb").value, 210);
  assert.equal(teamRow(view, "captains", "rcb").value, 200);
  assert.equal(teamRow(view, "dynamic-duo", "rcb").value, 320);
  assert.equal(teamRow(view, "roster-depth", "rcb").value, 30);
  assert.deepEqual(teamRow(view, "roster-depth", "rcb").coverage, { matched: 3, total: 4, pending: 1 });
  assert.equal(teamRow(view, "dead-weight", "rcb").value, 2); assert.equal(teamRow(view, "dead-weight", "rcb").coverage!.pending, 1);
  assert.equal(teamRow(view, "hardest-carry", "mi").value, 160, "negative contributions can produce >100% carry");
  assert.equal(teamRow(view, "heavy-top-order", "rcb").value, 160 / 210 * 100);
  assert.equal(teamRow(view, "heavy-top-order", "mi").value, null, "no.7 must not slide into an empty opener slot");
  assert.equal(teamRow(view, "heavy-top-order", "mi").coverage!.matched, 1);
  assert.equal(teamRow(view, "captaincy-regret", "rcb").value, 0);
});

test("missing C/VC and missing source values remain pending rather than creating artificial awards", () => {
  const { state, stored, a } = fixture();
  a.lineup!.captainId = null; a.lineup!.viceCaptainId = null;
  let view = buildAuctionSeason(state, stored);
  for (const id of ["captains", "dynamic-duo", "roster-depth", "captaincy-regret"]) assert.equal(teamRow(view, id, "rcb").value, null, id);
  a.lineup!.playingXI = ["analytics-5", "analytics-1", "analytics-2"];
  a.lineup!.captainId = "analytics-5"; a.lineup!.viceCaptainId = "analytics-1";
  view = buildAuctionSeason(state, stored);
  assert.equal(teamRow(view, "captains", "rcb").value, null);
  assert.equal(teamRow(view, "dynamic-duo", "rcb").value, null);
  assert.deepEqual(teamRow(view, "dynamic-duo", "rcb").coverage, { matched: 1, total: 2, pending: 1 });
  assert.equal(teamRow(view, "heavy-top-order", "rcb").value, null);
});

test("negative and zero denominators never become percentages; tied totals and extremes remain honest", () => {
  const { state, stored } = fixture();
  for (const row of stored.snapshot!.rows) row.points = -10;
  let view = buildAuctionSeason(state, stored);
  assert.equal(view.analytics.tournament.highestPlayers.length, 11); assert.equal(view.analytics.tournament.highestPlayers[0].value, -10);
  assert.equal(board(view, "overall").rows[0].teamId, "mi"); assert.ok(board(view, "overall").rows.every(row => row.value! < 0));
  for (const id of ["hardest-carry", "heavy-top-order"]) assert.ok(board(view, id).rows.every(row => row.value === null));
  assert.equal(teamRow(view, "captaincy-regret", "rcb").value, 0);
  stored.snapshot!.rows.find(row => row.name === "Alpha")!.points = -30;
  view = buildAuctionSeason(state, stored);
  assert.equal(teamRow(view, "captaincy-regret", "rcb").value, 20, "negative best scores must not be initialized to zero");
  for (const row of stored.snapshot!.rows) row.points = 0;
  view = buildAuctionSeason(state, stored);
  assert.deepEqual(view.analytics.podium.map(row => row.rank), [1, 1]);
  assert.ok(board(view, "hardest-carry").rows.every(row => row.value === null));
  assert.ok(board(view, "heavy-top-order").rows.every(row => row.value === null));
});

test("cut-off ties are preserved and complete source boards do not truncate tied leaders", () => {
  const { state, stored } = fixture();
  const extras: SeasonSourceRow[] = Array.from({ length: 25 }, (_, index) => ({ providerPlayerId: String(700000 + index), name: `Tied MVP ${index}`, profileUrl: null, points: 500, matches: 1, teamName: "GT", runs: 1000, wickets: 100, battingImpact: null, bowlingImpact: null }));
  stored.snapshot!.rows.push(...extras);
  const view = buildAuctionSeason(state, stored);
  assert.equal(board(view, "top-mvp").rows.length, 25); assert.ok(board(view, "top-mvp").rows.every(row => row.rank === 1));
  assert.equal(board(view, "orange-cap").rows.length, 25); assert.equal(board(view, "purple-cap").rows.length, 25);
});

test("saved captain changes, actual order changes and corrected sales recompute analytics", () => {
  const { state, stored, a, b } = fixture();
  a.lineup!.captainId = "analytics-2"; a.lineup!.viceCaptainId = "analytics-1";
  let view = buildAuctionSeason(state, stored);
  assert.equal(teamRow(view, "captaincy-regret", "rcb").value, 120);
  assert.equal(teamRow(view, "dynamic-duo", "rcb").value, 80);
  a.lineup!.playingXI = [null, "analytics-1", "analytics-2", "analytics-3", null, null, "analytics-0", "analytics-4"];
  view = buildAuctionSeason(state, stored); assert.equal(teamRow(view, "heavy-top-order", "rcb").value, null);
  state.players[0].soldTo = b.id; a.squad = a.squad.filter(purchase => purchase.playerId !== "analytics-0"); b.squad.push({ playerId: "analytics-0", amount: 500 });
  view = buildAuctionSeason(state, stored);
  assert.equal(board(view, "top-mvp").rows.find(row => row.name === "Alpha")!.teamId, "mi");
  assert.equal(board(view, "best-value").rows.find(row => row.name === "Alpha")!.value, 20);
  assert.equal(teamRow(view, "purist", "rcb").value, 110);
});

test("no source yields no numeric tournament claims or podium and keeps pending player columns null", () => {
  const { state } = fixture(); const view = buildAuctionSeason(state);
  assert.equal(view.analytics.ready, false); assert.equal(view.analytics.tournament.totalPoints, null); assert.equal(view.analytics.tournament.averagePoints, null);
  assert.deepEqual(view.analytics.podium, []); assert.ok(view.analytics.boards.every(board => board.rows.length === 0));
  assert.ok(view.teams.flatMap(team => team.players).every(player => player.deviation === null && player.pointsPerMatch === null));
});
