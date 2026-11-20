import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import type { Player, Team } from "../lib/auction";
const { createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { buildAuctionSeason, checkpointAuctionSeason, emptyAuctionSeason }: typeof import("../lib/auction-season") = await import(new URL("../lib/auction-season.ts", import.meta.url).href);
const { createSeasonWorkbook }: typeof import("../lib/season-export") = await import(new URL("../lib/season-export.ts", import.meta.url).href);

function fixture() {
  const state = createDemoState();
  for (const team of state.teams) { team.squad = []; delete team.lineup; }
  state.players = ["Alpha", "Bravo", "Charlie", "Delta"].map((name, index): Player => ({
    id: `race-${index}`, name, country: "India", role: "Batter", basePrice: 25, isOverseas: false,
    status: "available", stats: { matches: null, runs: null, wickets: null, strikeRate: null },
  }));
  const a = state.teams.find(team => team.id === "rcb")!, b = state.teams.find(team => team.id === "mi")!;
  const buy = (team: Team, index: number) => {
    const player = state.players[index]; player.status = "sold"; player.soldTo = team.id; player.soldFor = 100;
    team.squad.push({ playerId: player.id, amount: 100 });
  };
  buy(a, 0); buy(a, 1); buy(b, 2); buy(b, 3);
  const stored = emptyAuctionSeason();
  stored.snapshot = { sourceUrl: stored.sourceUrl, provider: "espncricinfo", seriesId: "1510719", seriesName: "IPL 2026", fetchedAt: "2026-05-01T10:00:00.000Z", rows: state.players.slice(0, 3).map((player, index) => ({
    name: player.name, points: [10.1, -2.1, 8][index], providerPlayerId: null, profileUrl: null, matches: 1,
    runs: null, wickets: null, teamName: null, battingImpact: null, bowlingImpact: null,
  })) };
  stored.method = "import";
  return { state, stored, a, b };
}

test("legacy reads do not fabricate history and each successful save freezes signed totals, ties and unknown coverage", () => {
  const { state, stored } = fixture();
  const legacyBefore = structuredClone(stored);
  assert.deepEqual(buildAuctionSeason(state, stored).raceHistory.checkpoints, []);
  assert.deepEqual(stored, legacyBefore);
  let saved = checkpointAuctionSeason(state, stored, { revision: 3, recordedAt: 1000, reason: "import" });
  let history = buildAuctionSeason(state, saved).raceHistory;
  assert.equal(history.totalCheckpoints, 1);
  assert.deepEqual(history.checkpoints[0].teams.filter(team => team.points !== null).map(team => [team.points, team.rank]), [[8, 1], [8, 1]]);
  const empty = history.checkpoints[0].teams.find(team => team.id === "csk")!;
  assert.equal(empty.points, null); assert.equal(empty.rank, null);
  const partial = history.checkpoints[0].teams.find(team => team.id === "mi")!;
  assert.equal(partial.matchedPlayers, 1); assert.equal(partial.totalPlayers, 2); assert.equal(partial.complete, false);
  saved = checkpointAuctionSeason(state, saved, { revision: 4, recordedAt: 2000, reason: "import" });
  history = buildAuctionSeason(state, saved).raceHistory;
  assert.equal(history.totalCheckpoints, 2, "identical successful refreshes are retained");
  assert.equal(history.checkpoints[1].teamChanges.find(change => change.teamId === "rcb")!.pointsDelta, 0);
  assert.equal(history.checkpoints[1].teamChanges.find(change => change.teamId === "csk")!.pointsDelta, null);
  assert.equal(history.checkpoints[1].overtakes.length, 0);
});

test("history survives reload and captaincy changes without rewriting prior totals or exposing private plans", () => {
  const { state, stored, a } = fixture();
  a.lineup = { playingXI: [], substitutes: [], captainId: "race-0", viceCaptainId: "race-1", revision: 1 };
  state.myTargetPicks = { teamId: "rcb", playerIds: ["SECRET-PLAN"], maxBids: { "SECRET-PLAN": 900 }, revision: 1 };
  state.activity.push({ id: "private", type: "chat", text: "SECRET-CHAT", at: 100 });
  state.completedManagers = { rcb: { id: "secret-member-id", name: "Original manager" } };
  let saved = checkpointAuctionSeason(state, stored, { revision: 1, recordedAt: 1000, reason: "import" });
  const first = JSON.stringify(saved.raceHistory!.checkpoints[0]);
  saved = JSON.parse(JSON.stringify(saved));
  a.lineup.captainId = "race-1"; a.lineup.viceCaptainId = "race-0";
  state.completedManagers.rcb.name = "New manager";
  let view = buildAuctionSeason(state, saved);
  assert.equal(view.raceHistory.currentTeamsChanged, true);
  assert.equal(JSON.stringify(view.raceHistory.checkpoints[0]).includes("Original manager"), true);
  assert.equal(JSON.stringify(saved.raceHistory!.checkpoints[0]), first);
  saved = checkpointAuctionSeason(state, saved, { revision: 2, recordedAt: 2000, reason: "map" });
  view = buildAuctionSeason(state, saved);
  const checkpoint = view.raceHistory.checkpoints[1];
  const change = checkpoint.teamChanges.find(change => change.teamId === "rcb")!;
  assert.equal(change.captaincyChanged, true); assert.equal(change.squadChanged, false); assert.equal(change.managerChanged, true);
  assert.equal(change.pointsDelta, -6.1); assert.equal(checkpoint.reason, "map");
  assert.equal(checkpoint.teams.find(team => team.id === "rcb")!.captainName, "Bravo");
  assert.equal(view.raceHistory.currentTeamsChanged, false);
  assert.equal(JSON.stringify(saved.raceHistory!.checkpoints[0]), first);
  assert.doesNotMatch(JSON.stringify(view.raceHistory), /SECRET|secret-member-id|myTargetPicks|maxBids|token|activity|Signature|"players":|"rows":/);
});

test("strict overtakes exclude ties, unknown entries and unrelated source segments", () => {
  const { state, stored } = fixture();
  stored.snapshot!.rows[2].points = 12;
  let saved = checkpointAuctionSeason(state, stored, { revision: 1, recordedAt: 1000, reason: "import" });
  saved = { ...saved, snapshot: { ...saved.snapshot!, rows: saved.snapshot!.rows.map(row => ({ ...row, points: row.name === "Alpha" ? 20.1 : row.points })) } };
  saved = checkpointAuctionSeason(state, saved, { revision: 2, recordedAt: 2000, reason: "fetch" });
  let latest = buildAuctionSeason(state, saved).raceHistory.checkpoints.at(-1)!;
  assert.deepEqual(latest.overtakes, [{ teamId: "rcb", passedTeamId: "mi" }]);
  assert.equal(latest.teamChanges.find(change => change.teamId === "rcb")!.rankDelta, 1);
  saved = { ...saved, snapshot: { ...saved.snapshot!, rows: saved.snapshot!.rows.map(row => ({ ...row, points: row.name === "Charlie" ? 18 : row.points })) } };
  saved = checkpointAuctionSeason(state, saved, { revision: 3, recordedAt: 3000, reason: "fetch" });
  latest = buildAuctionSeason(state, saved).raceHistory.checkpoints.at(-1)!;
  assert.equal(latest.overtakes.length, 0, "joining a tie is not an overtake");
  saved = { ...saved, snapshot: { ...saved.snapshot!, seriesId: "1449924", seriesName: "IPL 2025", sourceUrl: "https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players" } };
  saved = checkpointAuctionSeason(state, saved, { revision: 4, recordedAt: 4000, reason: "import" });
  latest = buildAuctionSeason(state, saved).raceHistory.checkpoints.at(-1)!;
  assert.equal(latest.previousCheckpointId, null); assert.deepEqual(latest.teamChanges, []); assert.deepEqual(latest.overtakes, []);
  saved = { ...saved, snapshot: stored.snapshot };
  saved = checkpointAuctionSeason(state, saved, { revision: 5, recordedAt: 5000, reason: "reference" });
  const history = buildAuctionSeason(state, saved).raceHistory;
  assert.equal(new Set(history.checkpoints.map(point => point.segmentId)).size, 3, "switching back starts a fresh segment");
});

test("squad and mapping coverage changes are annotated even when counts and totals stay equal", () => {
  const { state, stored, b } = fixture();
  let saved = checkpointAuctionSeason(state, stored, { revision: 1, recordedAt: 1000, reason: "import" });
  saved = { ...saved, snapshot: { ...saved.snapshot!, rows: saved.snapshot!.rows.map(row => ({ ...row, name: row.name === "Charlie" ? "Delta" : row.name })) } };
  saved = checkpointAuctionSeason(state, saved, { revision: 2, recordedAt: 2000, reason: "map" });
  let change = buildAuctionSeason(state, saved).raceHistory.checkpoints[1].teamChanges.find(change => change.teamId === "mi")!;
  assert.equal(change.coverageChanged, true); assert.equal(change.pointsDelta, 0);
  state.players[2].soldTo = "csk"; b.squad = b.squad.filter(player => player.playerId !== "race-2");
  saved = checkpointAuctionSeason(state, saved, { revision: 3, recordedAt: 3000, reason: "fetch" });
  change = buildAuctionSeason(state, saved).raceHistory.checkpoints[2].teamChanges.find(change => change.teamId === "mi")!;
  assert.equal(change.squadChanged, true);
});

test("retention preserves the first and latest 239 checkpoints and never invents movement across the gap", () => {
  const { state, stored } = fixture();
  let saved = stored;
  for (let index = 1; index <= 245; index++) saved = checkpointAuctionSeason(state, saved, { revision: index, recordedAt: index * 1000, reason: "import" });
  const history = buildAuctionSeason(state, JSON.parse(JSON.stringify(saved))).raceHistory;
  assert.equal(history.totalCheckpoints, 245); assert.equal(history.checkpoints.length, 240); assert.equal(history.omittedCheckpoints, 5);
  assert.equal(history.checkpoints[0].sequence, 1); assert.equal(history.checkpoints[1].sequence, 7); assert.equal(history.checkpoints.at(-1)!.sequence, 245);
  assert.equal(history.checkpoints[1].comparisonGap, true); assert.equal(history.checkpoints[1].previousCheckpointId, null); assert.deepEqual(history.checkpoints[1].teamChanges, []);
  assert.equal(history.checkpoints[2].comparisonGap, false); assert.equal(history.checkpoints[2].previousCheckpointId, "refresh-7");
});

test("reference capture dates stay distinct from recording time and Excel contains frozen public history", async () => {
  const { state, stored } = fixture(); stored.method = "reference";
  const recordedAt = Date.parse("2026-11-20T12:00:00.000Z");
  const saved = checkpointAuctionSeason(state, stored, { revision: 1, recordedAt, reason: "reference" });
  const view = buildAuctionSeason(state, saved), point = view.raceHistory.checkpoints[0];
  assert.equal(point.sourceCapturedAt, "2026-05-01T10:00:00.000Z"); assert.equal(point.recordedAt, recordedAt);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(new Uint8Array(await createSeasonWorkbook(view)).buffer);
  const race = workbook.getWorksheet("Season race")!;
  assert.ok(race); assert.equal(race.getCell("B5").value, "2026-11-20T12:00:00.000Z");
  assert.equal(race.getCell("C5").value, "2026-05-01T10:00:00.000Z"); assert.equal(race.getCell("D5").value, "reference");
  assert.equal(race.getCell("J5").value, 8); assert.equal(race.getCell("K5").value, null);
});
