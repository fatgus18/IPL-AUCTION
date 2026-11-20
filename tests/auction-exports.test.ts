import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import ExcelJS from "exceljs";

const { AuctionError, createDemoState }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { buildAuctionRecap, createAuctionWorkbook, createAuctionPdf }: typeof import("../lib/auction-exports") = await import(new URL("../lib/auction-exports.ts", import.meta.url).href);

function fixture() {
  const state = createDemoState();
  state.name = "The final auction"; state.endedAt = Date.UTC(2026, 10, 18, 14); state.resultsRevision = 4;
  const team = state.teams.find(team => team.id === "rcb")!;
  const ids = ["marco-jansen", "abhishek-sharma", "sanju-samson"];
  const players = ids.map(id => state.players.find(player => player.id === id)!);
  assert.ok(players.every(Boolean));
  for (const [index, player] of players.entries()) {
    player.status = "sold"; player.soldTo = team.id; player.soldFor = 200 + index * 25;
    team.squad.push({ playerId: player.id, amount: player.soldFor }); team.purse -= player.soldFor;
  }
  players[0].role = "Marquee"; players[0].playingRole = "All-rounder";
  team.lineup = { playingXI: [players[2].id, null, null, null, null, null, players[0].id, null, null, null, null], substitutes: [null, players[1].id, null, null, null], captainId: players[0].id, viceCaptainId: players[2].id, revision: 3 };
  state.completedManagers = { rcb: { id: "archived-manager", name: "Archived owner" } };
  state.members = state.members.filter(member => member.teamId !== "rcb");
  state.myTargetPicks = { teamId: "rcb", playerIds: ["SECRET-TARGET"], revision: 9 };
  state.activity.push({ id: "private-chat", text: "SECRET-CHAT", type: "chat", at: state.endedAt });
  state.saleCorrections = [{ id: "correction-1", at: state.endedAt - 6000, actorId: state.hostId, actorName: "Creator", playerId: players[0].id, playerName: players[0].name, reason: "Wrong amount entered", before: { teamId: "rcb", teamName: team.name, amount: 250 }, after: { teamId: "rcb", teamName: team.name, amount: 200 }, revision: 3 }];
  return state;
}

const strings = (workbook: ExcelJS.Workbook) => {
  const values: string[] = [];
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => { if (typeof cell.value === "string") values.push(cell.value); })));
  return values.join("\n");
};

test("recap is gated by completion and projects financials, actual playing roles and saved lineups", () => {
  const state = fixture(); const before = structuredClone(state);
  const recap = buildAuctionRecap(state, state.endedAt);
  assert.deepEqual(state, before, "exports never mutate the room");
  const team = recap.teams.find(team => team.id === "rcb")!;
  assert.equal(team.manager, "Archived owner", "end-time manager survives departure");
  assert.equal(team.spentLakhs, 675); assert.equal(team.purseLakhs, 9325);
  assert.equal(recap.totalSpentLakhs, 675); assert.equal(recap.soldCount, 3);
  assert.equal(team.roles["All-rounder"], 2); assert.equal(team.roles.Wicketkeeper, 1);
  assert.equal(team.roles.Marquee, undefined);
  assert.deepEqual(team.players.map(player => [player.id, player.selection, player.position, player.captain, player.viceCaptain]), [
    ["sanju-samson", "Playing XI", 1, false, true], ["marco-jansen", "Playing XI", 7, true, false], ["abhishek-sharma", "Substitute", 2, false, false],
  ]);
  assert.equal(recap.corrections[0].beforeAmountLakhs, 250); assert.equal(recap.corrections[0].afterAmountLakhs, 200);
  assert.doesNotMatch(JSON.stringify(recap), /SECRET-|myTargetPicks|token|chat|password|memberId|actorId/);
  delete state.endedAt;
  assert.throws(() => buildAuctionRecap(state), (error: unknown) => error instanceof AuctionError && error.status === 409 && error.code === "AUCTION_NOT_ENDED");
});

test("Excel matches original team/points views and leaves match statistics editable and blank", async () => {
  const recap = buildAuctionRecap(fixture());
  const bytes = await createAuctionWorkbook(recap);
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(new Uint8Array(bytes).buffer);
  assert.equal(workbook.worksheets.length, recap.teams.length + 7);
  for (const name of ["Read me", "Overview", "THE TEAMS", "POINTS", "All players", "Audit", "GT", "LSG", "RCB"]) assert.ok(workbook.getWorksheet(name), name);
  const all = workbook.getWorksheet("All players")!;
  assert.equal(all.rowCount, recap.soldCount + 4);
  assert.equal(all.views[0].state, "frozen"); assert.ok(all.autoFilter);
  assert.equal(all.getRow(4).getCell(11).value, "Price (INR lakh)");
  for (let row = 5; row <= all.rowCount; row++) {
    assert.equal(typeof all.getCell(row, 11).value, "number");
    for (let column = 12; column <= 17; column++) assert.equal(all.getCell(row, column).value, null, "manual match statistics must not contain career statistics");
  }
  const points = workbook.getWorksheet("POINTS")!;
  const pointStrings: string[] = []; points.eachRow(row => { if (typeof row.getCell(1).value === "string") pointStrings.push(row.getCell(1).value as string); });
  assert.ok(pointStrings.includes("RCB (Archived owner)"));
  assert.ok(pointStrings.includes("Marco Jansen (C)")); assert.ok(pointStrings.includes("Sanju Samson (VC)"));
  const content = strings(workbook);
  for (const team of recap.teams) { assert.ok(content.includes(team.name)); for (const player of team.players) assert.ok(content.includes(player.name)); }
  assert.doesNotMatch(content, /SECRET-TARGET|SECRET-CHAT/);
  const audit = workbook.getWorksheet("Audit")!;
  assert.equal(audit.getCell("E5").value, 250); assert.equal(audit.getCell("G5").value, 200);
  assert.equal(audit.getCell("H5").value, "Wrong amount entered");
});

test("untrusted names stay text in Excel and all reserve players remain in every squad export", async () => {
  const state = fixture(); state.name = '=HYPERLINK("https://invalid.example","unsafe")';
  state.completedManagers!.rcb.name = "+CMD|' /C calc'!A0";
  const player = state.players.find(player => player.id === "abhishek-sharma")!;
  player.name = '@SUM(1,2)'; state.teams.find(team => team.id === "rcb")!.lineup!.substitutes.fill(null);
  const recap = buildAuctionRecap(state);
  assert.equal(recap.teams.find(team => team.id === "rcb")!.players.at(-1)!.selection, "Squad");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(new Uint8Array(await createAuctionWorkbook(recap)).buffer);
  assert.equal(workbook.getWorksheet("Overview")!.getCell("A1").type, ExcelJS.ValueType.String);
  let foundName = false, foundManager = false;
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
    if (cell.value === player.name) { foundName = true; assert.equal(cell.type, ExcelJS.ValueType.String); }
    if (cell.value === state.completedManagers!.rcb.name) { foundManager = true; assert.equal(cell.type, ExcelJS.ValueType.String); }
    if (cell.type === ExcelJS.ValueType.Formula) assert.match((cell.value as ExcelJS.CellFormulaValue).formula, /^SUM\(H\d+:H\d+\)$/);
  })));
  assert.ok(foundName && foundManager);
});

test("PDF is a real paginated, embedded-font recap with bounded size for every team", async () => {
  const recap = buildAuctionRecap(fixture());
  recap.teams[0].manager = "Zoë D’Souza — ₹";
  const pdf = await createAuctionPdf(recap);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.subarray(-30).toString(), /%%EOF/);
  const source = pdf.toString("latin1");
  assert.equal((source.match(/\/Type \/Page\b/g) ?? []).length, recap.teams.length + 4, "overview uses two pages; small squads, awards and audit each fit without blank footer pages");
  assert.match(source, /\/ToUnicode/); assert.match(source, /\/FontFile2/);
  assert.ok(pdf.byteLength < 1_000_000, `PDF should stay comfortably below server response limits: ${pdf.byteLength}`);
  assert.doesNotMatch(source, /SECRET-TARGET|SECRET-CHAT/);
  const streams = [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap(match => { try { return [inflateSync(Buffer.from(match[1], "latin1")).toString("latin1")]; } catch { return []; } });
  assert.ok(streams.some(stream => stream.includes("begincmap")), "embedded fonts provide a Unicode text map");
});

test("latest lineup changes, corrected prices and cancellation audit are reflected in fresh exports", () => {
  const state = fixture(); const first = buildAuctionRecap(state);
  const team = state.teams.find(team => team.id === "rcb")!;
  team.lineup!.captainId = "sanju-samson"; team.lineup!.viceCaptainId = "marco-jansen"; team.lineup!.revision += 1;
  team.squad[0].amount = 300; team.purse -= 100; state.resultsRevision! += 1;
  state.saleCorrections!.push({ ...state.saleCorrections![0], id: "void", reason: "Wrong player selected", after: null, revision: state.resultsRevision! });
  const latest = buildAuctionRecap(state);
  assert.equal(first.totalSpentLakhs, 675); assert.equal(latest.totalSpentLakhs, 775);
  assert.equal(latest.teams.find(team => team.id === "rcb")!.players.find(player => player.captain)!.name, "Sanju Samson");
  assert.equal(latest.corrections.at(-1)!.afterTeam, "Sale voided"); assert.equal(latest.corrections.at(-1)!.afterAmountLakhs, null);
});

test("fresh recap downloads include squad leaders without requiring a saved XI", async () => {
  const state = fixture();
  const team = state.teams.find(team => team.id === "rcb")!;
  team.lineup!.playingXI = [];
  team.lineup!.captainId = "abhishek-sharma";
  const recap = buildAuctionRecap(state);
  const exported = recap.teams.find(entry => entry.id === team.id)!;
  assert.equal(exported.players.find(player => player.captain)!.selection, "Substitute");
  assert.equal(exported.players.find(player => player.viceCaptain)!.selection, "Squad");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await createAuctionWorkbook(recap)).buffer);
  assert.match(strings(workbook), /Abhishek Sharma \(C\)/);
  assert.match(strings(workbook), /Sanju Samson \(VC\)/);
});

test("Excel audit shows the full multiline reason with a bounded expanded row height", async () => {
  const state = fixture();
  const reason = ("The agreed bid was confirmed by both managers before correcting the purchase.\n".repeat(8)).slice(0, 500);
  state.saleCorrections![0].reason = reason;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await createAuctionWorkbook(buildAuctionRecap(state))).buffer);
  const audit = workbook.getWorksheet("Audit")!;
  assert.equal(audit.getCell("H5").value, reason);
  assert.equal(audit.getCell("H5").alignment.wrapText, true);
  assert.ok(audit.getRow(5).height > 100 && audit.getRow(5).height <= 400);
});
