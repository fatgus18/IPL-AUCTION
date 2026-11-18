import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AuctionError, type RoomState } from "./auction.ts";
import { getPlayingRole, PLAYING_ROLES } from "./player-roles.ts";
import { getAuctionAwards, type AuctionAwards } from "./auction-awards.ts";

/** Only this allowlisted projection enters a download. Never serialize a room snapshot. */
export type RecapPlayer = {
  id: string; name: string; role: string; country: string; overseas: boolean;
  amountLakhs: number; selection: "Playing XI" | "Substitute" | "Squad";
  position: number | null; captain: boolean; viceCaptain: boolean;
};
export type RecapTeam = {
  id: string; name: string; shortName: string; manager: string; color: string;
  spentLakhs: number; purseLakhs: number; overseas: number;
  roles: Record<string, number>; players: RecapPlayer[];
};
export type AuctionRecap = {
  code: string; name: string; endedAt: number; exportedAt: number; revision: number;
  totalSpentLakhs: number; soldCount: number; teams: RecapTeam[];
  awards: AuctionAwards;
  corrections: {
    at: number; actor: string; player: string; reason: string; revision: number;
    beforeTeam: string; beforeAmountLakhs: number;
    afterTeam: string; afterAmountLakhs: number | null;
  }[];
};

export function buildAuctionRecap(state: RoomState, exportedAt = Date.now()): AuctionRecap {
  if (state.endedAt === undefined) throw new AuctionError("End the auction to download its recap.", 409, "AUCTION_NOT_ENDED");
  const byId = new Map(state.players.map(player => [player.id, player]));
  const teams: RecapTeam[] = state.teams.map(team => {
    const manager = state.completedManagers?.[team.id]?.name
      ?? state.members.find(member => member.role === "bidder" && member.teamId === team.id)?.name
      ?? "No manager assigned";
    const players: RecapPlayer[] = team.squad.map(purchase => {
      const player = byId.get(purchase.playerId);
      const xiPosition = team.lineup?.playingXI.indexOf(purchase.playerId) ?? -1;
      const subPosition = team.lineup?.substitutes.indexOf(purchase.playerId) ?? -1;
      return {
        id: purchase.playerId, name: player?.name ?? "Player unavailable",
        role: getPlayingRole(player) ?? "Unclassified", country: player?.country ?? "Unknown",
        overseas: player?.isOverseas ?? false, amountLakhs: purchase.amount,
        selection: xiPosition >= 0 ? "Playing XI" : subPosition >= 0 ? "Substitute" : "Squad",
        position: xiPosition >= 0 ? xiPosition + 1 : subPosition >= 0 ? subPosition + 1 : null,
        captain: xiPosition >= 0 && team.lineup?.captainId === purchase.playerId,
        viceCaptain: xiPosition >= 0 && team.lineup?.viceCaptainId === purchase.playerId,
      };
    });
    const order = { "Playing XI": 0, Substitute: 1, Squad: 2 };
    players.sort((a, b) => order[a.selection] - order[b.selection] || (a.position ?? 0) - (b.position ?? 0));
    const roles: Record<string, number> = Object.fromEntries([...PLAYING_ROLES, "Unclassified"].map(role => [role, 0]));
    for (const player of players) roles[player.role] += 1;
    return {
      id: team.id, name: team.name, shortName: team.shortName, manager,
      color: /^#[a-f\d]{6}$/i.test(team.color) ? team.color.slice(1) : "D5B477",
      spentLakhs: players.reduce((sum, player) => sum + player.amountLakhs, 0),
      purseLakhs: team.purse, overseas: players.filter(player => player.overseas).length,
      roles, players,
    };
  });
  return {
    code: state.code, name: state.name, endedAt: state.endedAt, exportedAt,
    revision: state.resultsRevision ?? 0,
    totalSpentLakhs: teams.reduce((sum, team) => sum + team.spentLakhs, 0),
    soldCount: teams.reduce((sum, team) => sum + team.players.length, 0), teams,
    awards: getAuctionAwards(state),
    corrections: (state.saleCorrections ?? []).map(correction => ({
      at: correction.at, actor: correction.actorName, player: correction.playerName,
      reason: correction.reason, revision: correction.revision,
      beforeTeam: correction.before.teamName, beforeAmountLakhs: correction.before.amount,
      afterTeam: correction.after?.teamName ?? "Sale voided", afterAmountLakhs: correction.after?.amount ?? null,
    })),
  };
}

const INK = "142233", GOLD = "D5B477", PALE = "EEF2F6", WHITE = "FFFFFF", MUTED = "526273";
const money = (lakhs: number) => `INR ${(lakhs / 100).toFixed(2)} Cr`;
const stamp = (at: number) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(at) + " IST";
const named = (player: RecapPlayer) => `${player.name}${player.captain ? " (C)" : player.viceCaptain ? " (VC)" : ""}`;
const selection = (player: RecapPlayer) => player.selection === "Squad" ? "Squad" : `${player.selection} ${player.position}`;
const metadata = (recap: AuctionRecap) => `Room ${recap.code} | Ended ${stamp(recap.endedAt)} | Results revision ${recap.revision} | Exported ${stamp(recap.exportedAt)}`;

function sheetTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string, count: number) {
  sheet.mergeCells(1, 1, 1, count); sheet.getCell(1, 1).value = title;
  sheet.getRow(1).height = 36;
  sheet.getCell(1, 1).font = { name: "Aptos Display", size: 20, bold: true, color: { argb: WHITE } };
  sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  sheet.mergeCells(2, 1, 2, count); sheet.getCell(2, 1).value = subtitle;
  sheet.getCell(2, 1).font = { name: "Aptos", size: 10, color: { argb: MUTED } };
  sheet.getRow(2).height = 30; sheet.getCell(2, 1).alignment = { wrapText: true, vertical: "middle" };
}

function headers(sheet: ExcelJS.Worksheet, rowNumber: number, values: string[]) {
  const row = sheet.getRow(rowNumber); row.values = values; row.height = 32;
  row.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.font = { name: "Aptos", bold: true, size: 10, color: { argb: WHITE } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function baseSheet(workbook: ExcelJS.Workbook, name: string, widths: number[], color = GOLD) {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: color } }, views: [{ state: "frozen", ySplit: 4, xSplit: 0 }], pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.columns = widths.map(width => ({ width }));
  sheet.properties.defaultRowHeight = 23;
  return sheet;
}

function dataRow(sheet: ExcelJS.Worksheet, values: ExcelJS.CellValue[], editableFrom?: number) {
  const row = sheet.addRow(values);
  row.eachCell({ includeEmpty: true }, (cell, column) => {
    cell.font = { name: "Aptos", size: 11, color: { argb: INK } };
    cell.alignment = { vertical: "middle", wrapText: true };
    if (row.number % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } };
    if (editableFrom && column >= editableFrom) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8E8" } };
      cell.border = { bottom: { style: "hair", color: { argb: "D9CBAA" } } };
    }
  });
  return row;
}

const PLAYER_HEADERS = ["Team", "Manager", "Player", "Playing role", "Country", "Overseas", "Selection", "Position", "Captain", "Vice captain", "Price (INR lakh)", "Runs", "Wickets", "Catches", "Stumpings", "Points", "Notes"];
const PLAYER_WIDTHS = [29, 24, 29, 19, 19, 12, 17, 11, 11, 13, 19, 12, 12, 12, 13, 12, 30];
function addPlayerRows(sheet: ExcelJS.Worksheet, teams: RecapTeam[]) {
  for (const team of teams) for (const player of team.players) {
    const row = dataRow(sheet, [team.name, team.manager, player.name, player.role, player.country, player.overseas ? "Yes" : "No", player.selection, player.position, player.captain ? "Yes" : "", player.viceCaptain ? "Yes" : "", player.amountLakhs, null, null, null, null, null, null], 12);
    row.getCell(11).numFmt = '#,##0.00';
    for (const column of [12, 13, 14, 15]) row.getCell(column).dataValidation = { type: "whole", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: "Use a whole number", error: "Enter zero or a positive whole number." };
    row.getCell(16).numFmt = "0.00";
  }
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, sheet.rowCount), column: PLAYER_HEADERS.length } };
}

/** Spreadsheet cells are explicitly strings/numbers; user names are never formulas or links. */
export async function createAuctionWorkbook(recap: AuctionRecap): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Pavilion"; workbook.title = `${recap.name} — auction recap`;
  workbook.created = new Date(recap.exportedAt); workbook.modified = new Date(recap.exportedAt);
  const readme = baseSheet(workbook, "Read me", [24, 24, 24, 24, 24, 24]);
  sheetTitle(readme, "PAVILION / AUCTION RECAP", metadata(recap), 6);
  const explanations = [
    ["Auction", recap.name], ["Snapshot", "This file contains the latest saved squads, lineups and corrections at export time. Re-download after a correction or lineup change."],
    ["Money", "All numeric financial columns use INR lakh. 100 lakh = 1 crore. THE TEAMS displays prices in INR crore."],
    ["THE TEAMS", "Side-by-side team columns in the format of your original workbook: TEAM (MANAGER), every signing, captain (C), vice captain (VC), and remaining purse."],
    ["POINTS", "Team sections with the whole squad and (C)/(VC) labels. Yellow Runs, Wickets, Catches, Stumpings and Points cells are blank and editable. Enter points using your own scoring rules."],
    ["All players / team tabs", "Sortable detailed squad lists. Playing XI positions, substitute positions and reserve squad members are included. Yellow match-statistics cells start blank; these are not career statistics."],
    ["Lineups", "Only lineups saved in Pavilion are included. Missing captains, vice captains or positions remain unassigned. XI order appears first, followed by substitutes and other squad players."],
    ["Managers", "Manager names are recorded when the auction ends and remain in the recap if someone later leaves the room."],
    ["Audit", "Corrections show who made them, when, the reason, and the before/after sale values. The original event record is preserved in Pavilion."],
    ["Privacy", "Private target picks, chat, invitations, passwords and authentication details are not included."],
  ];
  for (const [label, explanation] of explanations) {
    const row = readme.addRow([label, explanation]); readme.mergeCells(row.number, 2, row.number, 6);
    row.height = label === "POINTS" || label === "All players / team tabs" || label === "THE TEAMS" ? 50 : 40;
    row.getCell(1).font = { name: "Aptos", bold: true, size: 11, color: { argb: INK } };
    row.getCell(2).alignment = { wrapText: true, vertical: "middle" };
    row.getCell(2).font = { name: "Aptos", size: 11, color: { argb: MUTED } };
  }
  const overview = baseSheet(workbook, "Overview", [35, 25, 12, 21, 21, 13, 13, 16, 16, 16, 13, 27, 27]);
  sheetTitle(overview, recap.name, metadata(recap), 13);
  headers(overview, 4, ["Team", "Manager", "Players", "Spent (INR lakh)", "Remaining (INR lakh)", "Batters", "Bowlers", "All-rounders", "Wicketkeepers", "Unclassified", "Overseas", "Captain", "Vice captain"]);
  for (const team of recap.teams) {
    const row = dataRow(overview, [team.name, team.manager, team.players.length, team.spentLakhs, team.purseLakhs, ...PLAYING_ROLES.map(role => team.roles[role]), team.roles.Unclassified, team.overseas, team.players.find(player => player.captain)?.name ?? "Not selected", team.players.find(player => player.viceCaptain)?.name ?? "Not selected"]);
    row.getCell(4).numFmt = row.getCell(5).numFmt = '#,##0.00';
  }
  overview.autoFilter = `A4:M${overview.rowCount}`;
  const totals = dataRow(overview, ["AUCTION TOTAL", "", recap.soldCount, recap.totalSpentLakhs]); totals.font = { bold: true };

  const teamsSheet = baseSheet(workbook, "THE TEAMS", Array.from({ length: Math.max(2, recap.teams.length) }, () => 39));
  sheetTitle(teamsSheet, "THE TEAMS", metadata(recap), Math.max(2, recap.teams.length));
  headers(teamsSheet, 4, recap.teams.map(team => `${team.shortName} (${team.manager})`));
  const maxSquad = Math.max(1, ...recap.teams.map(team => team.players.length));
  for (let index = 0; index < maxSquad; index++) {
    const row = dataRow(teamsSheet, recap.teams.map(team => {
      const player = team.players[index];
      return player ? `${named(player)}${player.overseas ? " *" : ""} — ${money(player.amountLakhs)}\n${selection(player)} · ${player.role}` : "";
    })); row.height = 42;
  }
  dataRow(teamsSheet, recap.teams.map(team => `TOTAL SPENT / ${money(team.spentLakhs)}`));
  dataRow(teamsSheet, recap.teams.map(team => `PURSE REMAINING / ${money(team.purseLakhs)}`));

  const points = baseSheet(workbook, "POINTS", [34, 19, 11, 13, 13, 13, 14, 13, 30]);
  sheetTitle(points, "POINTS / MATCH STATISTICS", "Editable match statistics · C = captain · VC = vice captain · Points follow your own scoring rules", 9);
  for (const team of recap.teams) {
    const label = points.addRow([`${team.shortName} (${team.manager})`]);
    points.mergeCells(label.number, 1, label.number, 9); label.height = 30;
    label.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    label.getCell(1).font = { name: "Aptos", size: 12, bold: true, color: { argb: WHITE } };
    headers(points, points.rowCount + 1, ["Player", "Selection", "Position", "Runs", "Wickets", "Catches", "Stumpings", "Points", "Notes"]);
    const from = points.rowCount + 1;
    for (const player of team.players) dataRow(points, [named(player), player.selection, player.position, null, null, null, null, null, null], 4);
    if (team.players.length === 0) dataRow(points, ["No signings", null, null, null, null, null, null, null, null]);
    const to = points.rowCount;
    const total = dataRow(points, ["Total", "", null, null, null, null, null, team.players.length ? { formula: `SUM(H${from}:H${to})`, result: 0 } : 0]);
    total.font = { name: "Aptos", bold: true, size: 11 }; points.addRow([]);
  }
  const all = baseSheet(workbook, "All players", PLAYER_WIDTHS);
  sheetTitle(all, "ALL SIGNINGS", metadata(recap), PLAYER_HEADERS.length);
  headers(all, 4, PLAYER_HEADERS); addPlayerRows(all, recap.teams);
  const usedNames = new Set(workbook.worksheets.map(sheet => sheet.name.toLowerCase()));
  for (const team of recap.teams) {
    const baseName = team.shortName.replace(/[\\/*?:[\]]/g, "").replace(/^'+|'+$/g, "").slice(0, 27) || "Team";
    let name = baseName, suffix = 1;
    while (usedNames.has(name.toLowerCase())) name = `${baseName} ${suffix++}`;
    usedNames.add(name.toLowerCase());
    const sheet = baseSheet(workbook, name, PLAYER_WIDTHS, team.color);
    sheetTitle(sheet, `${team.name} / ${team.manager}`, `${team.players.length} signings | Spent ${money(team.spentLakhs)} | Purse ${money(team.purseLakhs)} | Results revision ${recap.revision}`, PLAYER_HEADERS.length);
    headers(sheet, 4, PLAYER_HEADERS); addPlayerRows(sheet, [team]);
  }
  const awards = baseSheet(workbook, "Awards", [26, 37, 22, 58, 75]);
  sheetTitle(awards, "THE AUCTION HONOURS", "Factual awards · All tied winners are included · Purchase awards reflect corrected sales", 5);
  headers(awards, 4, ["Award", "Winner", "Result", "Details", "How this is decided"]);
  for (const award of recap.awards.awards) {
    const winners = award.winners.length ? award.winners : [{ name: "Not awarded", detail: award.unavailable ?? "" }];
    for (const winner of winners) {
      const row = dataRow(awards, [award.title, winner.name, award.metric, winner.detail, award.criterion]);
      row.height = Math.max(48, Math.ceil(award.criterion.length / 65) * 15 + 12, Math.ceil(winner.detail.length / 45) * 15 + 12);
    }
  }
  awards.autoFilter = `A4:E${Math.max(4, awards.rowCount)}`;
  const audit = baseSheet(workbook, "Audit", [24, 25, 30, 34, 22, 34, 22, 64, 12]);
  sheetTitle(audit, "SALE CORRECTIONS", "Every correction retains its original sale values, actor, time and reason. All amounts are INR lakh.", 9);
  headers(audit, 4, ["Time (IST)", "Corrected by", "Player", "Previous team", "Previous price", "Corrected team", "Corrected price", "Reason", "Revision"]);
  for (const correction of recap.corrections) {
    const row = dataRow(audit, [stamp(correction.at), correction.actor, correction.player, correction.beforeTeam, correction.beforeAmountLakhs, correction.afterTeam, correction.afterAmountLakhs, correction.reason, correction.revision]);
    const reasonLines = correction.reason.split(/\r?\n/).reduce((count, paragraph) => count + Math.max(1, Math.ceil(paragraph.length / 56)), 0);
    row.height = Math.min(400, Math.max(48, reasonLines * 15 + 12));
  }
  if (recap.corrections.length === 0) dataRow(audit, ["No sale corrections recorded"]);
  audit.autoFilter = `A4:I${Math.max(4, audit.rowCount)}`;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

let fontFiles: Promise<[Buffer, Buffer]> | undefined;
function loadFonts() {
  // These are immutable packaged assets, not room data. No external requests or disk writes.
  return fontFiles ??= Promise.all([
    readFile(path.join(process.cwd(), "lib/export-assets/NotoSans-Regular.ttf")),
    readFile(path.join(process.cwd(), "lib/export-assets/NotoSans-Bold.ttf")),
  ]).catch(error => { fontFiles = undefined; throw error; });
}

/** Server-only PDF renderer with embedded fonts and explicit pagination. */
export async function createAuctionPdf(recap: AuctionRecap): Promise<Buffer> {
  const [regular, bold] = await loadFonts();
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true, autoFirstPage: false, font: path.join(process.cwd(), "lib/export-assets/NotoSans-Regular.ttf"), info: { Title: `${recap.name} — Auction recap`, Author: "Pavilion", Subject: `Room ${recap.code}, results revision ${recap.revision}`, CreationDate: new Date(recap.exportedAt) } });
  doc.registerFont("Body", regular); doc.registerFont("Strong", bold);
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => { doc.on("data", chunk => chunks.push(Buffer.from(chunk))); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  const width = 511.28, left = 42, bottom = 765;
  let y = 0;
  const newPage = (section: string) => {
    doc.addPage(); doc.rect(0, 0, doc.page.width, 8).fill(`#${GOLD}`);
    doc.font("Strong").fontSize(10).fillColor(`#${INK}`).text("PAVILION", left, 28, { width: 140 });
    doc.font("Body").fontSize(8).fillColor(`#${MUTED}`).text(section, 190, 29, { width: 363, align: "right" }); y = 65;
  };
  const line = (text: string, options: { size?: number; strong?: boolean; color?: string; gap?: number } = {}) => {
    doc.font(options.strong ? "Strong" : "Body").fontSize(options.size ?? 10).fillColor(options.color ?? `#${INK}`);
    const height = doc.heightOfString(text, { width, lineGap: 2 });
    if (y + height > bottom) {
      newPage("Auction recap / continued");
      doc.font(options.strong ? "Strong" : "Body").fontSize(options.size ?? 10).fillColor(options.color ?? `#${INK}`);
    }
    doc.text(text, left, y, { width, lineGap: 2 }); y += height + (options.gap ?? 9);
  };
  const table = (head: string[], rows: string[][], widths: number[]) => {
    const row = (values: string[], header: boolean, index: number) => {
      doc.font(header ? "Strong" : "Body").fontSize(header ? 8 : 9);
      const height = Math.max(27, ...values.map((value, column) => doc.heightOfString(value, { width: widths[column] - 14, lineGap: 1 }) + 14));
      if (y + height > bottom) { newPage("Auction recap / continued"); if (!header) row(head, true, 0); }
      if (header || index % 2 === 0) doc.rect(left, y, width, height).fill(header ? `#${INK}` : `#${PALE}`);
      let x = left;
      doc.font(header ? "Strong" : "Body").fontSize(header ? 8 : 9).fillColor(header ? "#FFFFFF" : `#${INK}`);
      for (let column = 0; column < values.length; column++) { doc.text(values[column], x + 7, y + 7, { width: widths[column] - 14, lineGap: 1 }); x += widths[column]; }
      y += height;
    };
    row(head, true, 0); rows.forEach((values, index) => row(values, false, index)); y += 18;
  };
  newPage(`ROOM ${recap.code} / RESULTS REVISION ${recap.revision}`);
  line("THE AUCTION.\nTHE FINAL SQUADS.", { size: 30, strong: true, gap: 18 });
  line(recap.name, { size: 18, strong: true });
  line(`Ended ${stamp(recap.endedAt)}\nExported ${stamp(recap.exportedAt)}`, { color: `#${MUTED}`, gap: 22 });
  line(`${recap.soldCount} signings   /   ${money(recap.totalSpentLakhs)} spent   /   ${recap.teams.length} teams`, { size: 13, strong: true, gap: 20 });
  table(["TEAM / MANAGER", "PLAYERS", "SPENT", "PURSE LEFT"], recap.teams.map(team => [`${team.name}\n${team.manager}`, String(team.players.length), money(team.spentLakhs), money(team.purseLakhs)]), [235, 56, 110, 110.28]);
  line("Amounts are in INR crore. This is a snapshot of the latest saved lineups and corrected sales; re-download after changes.", { size: 9, color: `#${MUTED}` });
  for (const team of recap.teams) {
    newPage(`ROOM ${recap.code} / ${team.shortName}`);
    line(team.name, { size: 23, strong: true });
    line(`Owned and managed by: ${team.manager}`, { size: 11, gap: 15 });
    line(`${team.players.length} signings  /  Spent ${money(team.spentLakhs)}  /  Purse ${money(team.purseLakhs)}`, { strong: true, gap: 8 });
    line(`${team.roles.Batter} batters · ${team.roles.Bowler} bowlers · ${team.roles["All-rounder"]} all-rounders · ${team.roles.Wicketkeeper} wicketkeepers${team.roles.Unclassified ? ` · ${team.roles.Unclassified} unclassified` : ""} · ${team.overseas} overseas`, { size: 9, color: `#${MUTED}`, gap: 15 });
    line(`Captain: ${team.players.find(player => player.captain)?.name ?? "Not selected"}\nVice captain: ${team.players.find(player => player.viceCaptain)?.name ?? "Not selected"}`, { size: 10, gap: 18 });
    if (team.players.length) table(["PLAYER", "PLAYING ROLE", "SELECTION", "PRICE"], team.players.map(player => [`${named(player)}${player.overseas ? " *" : ""}\n${player.country}`, player.role, selection(player), money(player.amountLakhs)]), [198, 105, 102, 106.28]);
    else line(team.manager === "No manager assigned" ? "No manager took charge of this team." : "No players purchased.", { color: `#${MUTED}` });
    line("C = captain · VC = vice captain · * = overseas player", { size: 8, color: `#${MUTED}` });
  }
  newPage("AUCTION AWARDS / THE HONOURS BOARD");
  line("THE AUCTION HONOURS", { size: 24, strong: true });
  line("Factual awards with every shared winner. Final purchase awards include corrections; bidding awards use accepted bid records.", { size: 10, color: `#${MUTED}`, gap: 18 });
  table(["AWARD / CRITERIA", "WINNER / DETAILS", "RESULT"], recap.awards.awards.flatMap(award => {
    const winners = award.winners.length ? award.winners : [{ name: "Not awarded", detail: award.unavailable ?? "" }];
    return winners.map((winner, index) => [`${award.title}${index === 0 ? `\n${award.criterion}` : " (shared)"}`, `${winner.name}\n${winner.detail}`, award.metric.replace("₹", "INR ")]);
  }), [160, 235, 116.28]);
  newPage("SALE CORRECTIONS / AUDIT");
  line("THE CORRECTION RECORD", { size: 24, strong: true });
  if (!recap.corrections.length) line("No sale corrections were recorded.", { size: 11 });
  for (const correction of recap.corrections) {
    if (y > bottom - 170) newPage("SALE CORRECTIONS / CONTINUED");
    line(correction.player, { size: 15, strong: true, gap: 5 });
    line(`${stamp(correction.at)} · ${correction.actor} · Revision ${correction.revision}`, { size: 9, color: `#${MUTED}` });
    line(`Before: ${correction.beforeTeam} / ${money(correction.beforeAmountLakhs)}\nAfter: ${correction.afterTeam}${correction.afterAmountLakhs === null ? "" : ` / ${money(correction.afterAmountLakhs)}`}`, { size: 10 });
    line(`Reason: ${correction.reason}`, { size: 10, gap: 22 });
  }
  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index++) {
    doc.switchToPage(index); doc.moveTo(left, 779).lineTo(left + width, 779).strokeColor("#DEE4EA").stroke();
    doc.font("Body").fontSize(8).fillColor(`#${MUTED}`).text(`Pavilion · ${recap.code} · Revision ${recap.revision}`, left, 786, { width: 380, lineBreak: false });
    doc.text(`${index + 1} / ${pages.count}`, left + 400, 786, { width: 111, align: "right", lineBreak: false });
  }
  doc.end();
  return output;
}
