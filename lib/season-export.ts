import ExcelJS from "exceljs";
import type { AuctionSeasonView } from "./auction-season.ts";

const INK = "101C2B", GOLD = "D5B477", WHITE = "FFFFFF", PALE = "EEF2F6";

function sheet(workbook: ExcelJS.Workbook, name: string, widths: number[], title: string, subtitle: string, headings: string[]) {
  const result = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }], properties: { defaultRowHeight: 24 } });
  result.columns = widths.map(width => ({ width }));
  result.mergeCells(1, 1, 1, widths.length); result.getCell(1, 1).value = title;
  result.getRow(1).height = 38;
  result.getCell(1, 1).font = { name: "Aptos Display", size: 20, bold: true, color: { argb: WHITE } };
  result.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  result.mergeCells(2, 1, 2, widths.length); result.getCell(2, 1).value = subtitle;
  result.getCell(2, 1).font = { name: "Aptos", size: 10, color: { argb: "526273" } };
  result.getCell(2, 1).alignment = { wrapText: true }; result.getRow(2).height = 32;
  result.getRow(4).values = headings;
  result.getRow(4).eachCell(cell => {
    cell.font = { name: "Aptos", bold: true, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } };
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
  result.getRow(4).height = 34;
  return result;
}
function row(sheet: ExcelJS.Worksheet, values: (string | number | null)[]) {
  const added = sheet.addRow(values);
  added.eachCell(cell => {
    cell.font = { name: "Aptos", size: 11, color: { argb: INK } };
    cell.alignment = { vertical: "middle", wrapText: true };
    if (added.number % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } };
    if (typeof cell.value === "number") cell.numFmt = "0.########";
  });
  return added;
}

/** Only the public season projection enters Excel; plain strings never become formulas. */
export async function createSeasonWorkbook(season: AuctionSeasonView): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Pavilion"; workbook.created = new Date();
  const subtitle = `Room ${season.code} | ${season.provisional ? "Provisional auction squads" : "Completed auction squads"} | Season revision ${season.revision} | Matched ${season.coverage.matchedPlayers}/${season.coverage.totalPlayers}`;
  const standings = sheet(workbook, "Standings", [10, 36, 27, 20, 15, 15, 21, 21], season.name, subtitle, ["Rank", "Franchise", "Manager", "Known points", "Matched players", "Squad players", "Spent (INR lakh)", "Purse (INR lakh)"]);
  for (const team of season.teams) row(standings, [team.rank, team.name, team.manager, team.points, team.matchedPlayers, team.totalPlayers, team.spentLakhs, team.purseLakhs]);
  const points = sheet(workbook, "POINTS", [34, 24, 30, 19, 16, 15, 15, 14, 17, 13, 13, 13, 32], "SEASON POINTS", subtitle, ["Franchise", "Manager", "Player", "Role", "Selection", "Captain / VC", "Raw MVP points", "Multiplier", "Weighted points", "Matches", "Runs", "Wickets", "Source name"]);
  for (const team of season.teams) {
    for (const player of team.players) row(points, [team.name, team.manager, player.name, player.role, player.selection, player.captain ? "C" : player.viceCaptain ? "VC" : "", player.rawPoints, player.multiplier, player.points, player.matches, player.runs, player.wickets, player.sourceName]);
    const total = row(points, [team.name, team.manager, "KNOWN TOTAL", null, null, null, null, null, team.points, null, null, null, `${team.matchedPlayers}/${team.totalPlayers} matched`]);
    total.font = { name: "Aptos", bold: true, color: { argb: INK } };
  }
  points.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, points.rowCount), column: 13 } };
  const teamCount = Math.max(2, season.teams.length);
  const teams = sheet(workbook, "THE TEAMS", Array.from({ length: teamCount }, () => 36), "THE TEAMS", subtitle, season.teams.map(team => `${team.shortName} — ${team.manager}`));
  const max = Math.max(1, ...season.teams.map(team => team.players.length));
  for (let index = 0; index < max; index++) row(teams, season.teams.map(team => {
    const player = team.players[index];
    return player ? `${player.name}${player.captain ? " (C)" : player.viceCaptain ? " (VC)" : ""}\n${player.points === null ? "Unmatched" : `${player.points} points`} · ${player.role}` : "";
  })).height = 42;
  row(teams, season.teams.map(team => `KNOWN TOTAL: ${team.points ?? "—"} (${team.matchedPlayers}/${team.totalPlayers} matched)`)).font = { bold: true };

  const rules = sheet(workbook, "Rules", [30, 110], "SCORING & PROVENANCE", subtitle, ["Setting", "Value"]);
  for (const entry of [
    ["Scoring", "Every purchased player contributes the source MVP points. Captain ×2, vice captain ×1.5; all other players ×1, including substitutes and reserves."],
    ["Captain eligibility", "Captain and vice captain use the team's latest saved Playing XI. Missing or invalid assignments receive no extra multiplier."],
    ["No extra bonuses", "Runs, wickets and matches are source information only. They are not added again to MVP points."],
    ["Unmatched players", "Blank points are unknown, not zero. Standings show known totals; negative source scores remain negative."],
    ["Squad changes", "Saved lineup changes and creator sale corrections recompute standings against the latest successful source snapshot."],
    ["Configured source", season.sourceUrl], ["Scored source", season.snapshot?.sourceUrl ?? "No successful source snapshot"],
    ["Series", season.snapshot?.seriesName ?? "Not fetched"], ["Retrieved", season.snapshot ? new Date(season.snapshot.fetchedAt).toISOString() : "Not fetched"],
    ["Acquisition", season.snapshot?.method === "reference" ? "Verified dated reference snapshot — not a live fetch" : season.snapshot?.method ?? "None"],
    ["Reference snapshot", season.snapshot?.method === "reference" ? `Captured ${season.snapshot.fetchedAt}. Loading this snapshot does not update its capture date or fetch newer provider data.` : "Not in use"],
    ["Source pending", season.sourceChanged ? "Configured source differs from scored source. Refresh to replace the current snapshot." : "No"],
  ]) row(rules, entry).height = 44;
  const coverage = sheet(workbook, "Source coverage", [18, 30, 30, 16, 20, 13, 13, 13, 22, 80], "SOURCE COVERAGE", subtitle, ["Provider ID", "Source name", "Pool player ID", "Match method", "Raw MVP points", "Matches", "Runs", "Wickets", "Source team", "Profile URL"]);
  for (const source of season.sourceRows) row(coverage, [source.providerPlayerId, source.name, source.playerId, source.match ?? "Unmatched", source.points, source.matches, source.runs, source.wickets, source.teamName, source.profileUrl]);
  const missing = sheet(workbook, "Unmatched squad players", [36, 32, 38], "UNMATCHED PURCHASES", "These players are missing from the scored source or need an explicit identity match. Their scores are unknown.", ["Franchise", "Player", "Pool player ID"]);
  for (const player of season.unmatchedPlayers) row(missing, [player.teamName, player.name, player.id]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
