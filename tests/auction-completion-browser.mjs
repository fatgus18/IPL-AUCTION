import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated API runner; never alter the user's auction rooms.");
const base = process.env.BASE_URL;
assert.ok(base);
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const output = resolve(".sites-runtime/screenshots");
await mkdir(output, { recursive: true });
const errors = [];
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const value = await response.json(); assert.ok(response.ok, `${response.status}: ${value.error}`); return value;
};
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } }).then(value => value.state);
const read = member => request(pathFor(member), { token: member.token }).then(value => value.state);
const nav = (page, name) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name });
const clickNav = async (page, name, view) => {
  if (!await nav(page, name).isVisible()) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await nav(page, name).click();
  if (view) await page.locator(`.app-shell.tab-${view}`).waitFor();
};
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const openMember = async (member, view) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), { code: member.state.code, token: member.token, memberId: member.memberId });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${member.state.code}&view=${view}`);
  await page.locator(`.app-shell.in-auction.tab-${view}`).waitFor();
  await page.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  return { page, context };
};
const refreshSnapshot = async (page, member, version) => {
  const observed = page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || new URL(response.url()).pathname !== pathFor(member) || !response.ok()) return false;
    try { const value = await response.json(); return (value.state?.version ?? value.version ?? -1) >= version; } catch { return false; }
  });
  await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await observed; await paint(page);
};
const uiAction = async (page, type, click) => {
  const pending = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/action") && response.request().postDataJSON()?.action?.type === type);
  await click(); const response = await pending; assert.equal(response.status(), 200, await response.text());
  await paint(page); return (await response.json()).state;
};
const correctionDialog = page => page.getByRole("dialog", { name: "Correct confirmed sale", exact: true });
const openCorrection = async (page, player) => { await page.getByRole("button", { name: `Correct sale for ${player.name}`, exact: true }).click(); await correctionDialog(page).waitFor(); };
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${page.viewportSize().width}px page overflow`);
const controls = async (page, selector) => {
  for (const control of await page.locator(selector).all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    assert.ok(box && box.height >= 43.5, `${await control.getAttribute("aria-label") || await control.textContent()}: control is ${box?.height}px tall`);
  }
};
const dialogGeometry = async (page, dialog) => {
  const bounds = await dialog.boundingBox(); const viewport = page.viewportSize();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1, `dialog must fit ${viewport.width}px viewport`);
  assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, "dialog content must not overflow sideways");
  await controls(page, ".result-dialog button, .result-dialog select, .result-dialog input:not([type=radio]), .result-dialog textarea, .correction-mode label");
};
const capture = async (page, name) => {
  await page.evaluate(() => document.fonts.ready); await paint(page);
  await page.screenshot({ path: resolve(output, name), fullPage: true });
};
const download = async (page, label, filename) => {
  const ready = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: label, exact: true }).click();
  const file = await ready; assert.equal(await file.failure(), null);
  const location = resolve(output, filename); await file.saveAs(location); return readFile(location);
};

let host;
try {
  host = await request("/api/rooms", { body: { name: "The final call · browser verification", hostName: "Final call creator" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, teamId, teamPassword } });
  const red = await join("Red team manager", "rcb"); const blue = await join("Blue team manager", "mi");
  const players = host.state.players.filter(player => !player.isOverseas && player.eligibilityVerified !== false).slice(0, 4);
  for (const player of players.slice(0, 3)) {
    await act(host, { type: "select_player", playerId: player.id }); await act(host, { type: "start" });
    await act(red, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice, customAmount: 500 });
    await act(host, { type: "lock" }); await act(host, { type: "sell" });
  }
  await act(red, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: [players[0].id, null, players[1].id], substitutes: [players[2].id], captainId: players[0].id, viceCaptainId: players[1].id } });
  const hostBrowser = await openMember(host, "settings"); const hp = hostBrowser.page;
  const redBrowser = await openMember(red, "my-squad"); const rp = redBrowser.page;
  const blueBrowser = await openMember(blue, "settings"); const bp = blueBrowser.page;
  assert.equal(await bp.getByRole("heading", { name: "Results & final call", exact: true }).count(), 0, "manager cannot see creator controls");
  await clickNav(bp, "My Squad", "my-squad");
  await hp.bringToFront(); await hp.getByRole("heading", { name: "Results & final call", exact: true }).waitFor();
  await openCorrection(hp, players[0]);
  const transfer = correctionDialog(hp);
  assert.equal(await transfer.getByRole("button", { name: "Confirm correction", exact: true }).isDisabled(), true, "unchanged sale and empty audit reason cannot be submitted");
  await transfer.getByLabel(/^Correct franchise/).selectOption("mi");
  await transfer.getByLabel("Correct price (₹ crore)", { exact: true }).fill("7.00");
  assert.equal(await transfer.getByRole("button", { name: "Confirm correction", exact: true }).isDisabled(), true, "a changed sale still needs an audit reason");
  await transfer.getByLabel("Reason for correction", { exact: true }).fill("The winning bid belonged to MI, not RCB.");
  await dialogGeometry(hp, transfer); await capture(hp, "completion-correction-desktop.png");
  let state = await uiAction(hp, "correct_sale", () => transfer.getByRole("button", { name: "Confirm correction", exact: true }).click());
  await transfer.waitFor({ state: "hidden" });
  await refreshSnapshot(rp, red, state.version);
  assert.equal(await rp.locator(".personal-squad-player").count(), 2);
  assert.equal(await rp.getByRole("heading", { name: players[0].name, exact: true }).count(), 0);
  assert.match(await rp.locator(".personal-squad-totals").innerText(), /₹90\.00 Cr/);
  await refreshSnapshot(bp, blue, state.version);
  await bp.getByRole("heading", { name: players[0].name, exact: true }).waitFor();
  assert.match(await bp.locator(".personal-squad-totals").innerText(), /₹93\.00 Cr/);
  assert.deepEqual(state.teams.find(team => team.id === "rcb").lineup, { playingXI: [null, null, players[1].id], substitutes: [players[2].id], captainId: null, viceCaptainId: players[1].id, revision: 2 });
  for (const [page, member] of [[rp, red], [bp, blue]]) {
    await clickNav(page, "Team squads", "squads");
    await page.locator(".sale-audit summary").click();
    await page.getByText("The winning bid belonged to MI, not RCB.", { exact: true }).waitFor();
    assert.equal((await read(member)).saleCorrections.length, 1);
  }

  await hp.bringToFront(); await openCorrection(hp, players[2]);
  await correctionDialog(hp).getByRole("radio", { name: "Cancel and refund sale", exact: true }).check();
  await correctionDialog(hp).getByLabel("Reason for correction", { exact: true }).fill("This player was confirmed accidentally.");
  for (const width of [390, 360]) {
    await hp.setViewportSize({ width, height: 900 }); await paint(hp);
    await dialogGeometry(hp, correctionDialog(hp)); await noOverflow(hp);
    await capture(hp, `completion-cancel-${width}.png`);
  }
  state = await uiAction(hp, "correct_sale", () => correctionDialog(hp).getByRole("button", { name: "Confirm correction", exact: true }).click());
  await correctionDialog(hp).waitFor({ state: "hidden" });
  assert.equal(state.players.find(player => player.id === players[2].id).status, "available");
  assert.equal(state.teams.find(team => team.id === "rcb").purse, 9500);
  assert.deepEqual(state.teams.find(team => team.id === "rcb").lineup.substitutes, [null]);

  await hp.setViewportSize({ width: 1440, height: 1000 });
  await openCorrection(hp, players[1]);
  await correctionDialog(hp).getByLabel("Correct price (₹ crore)", { exact: true }).fill("8.00");
  await correctionDialog(hp).getByLabel("Reason for correction", { exact: true }).fill("Stale draft must not overwrite the latest correction.");
  const before = await read(host);
  state = await act(host, { type: "correct_sale", playerId: players[1].id, expectedTeamId: "rcb", expectedAmount: 500, expectedResultsRevision: before.resultsRevision, teamId: "rcb", amount: 600, reason: "The final agreed price was six crore." });
  await refreshSnapshot(hp, host, state.version);
  await correctionDialog(hp).getByRole("alert").filter({ hasText: "Results changed" }).waitFor();
  assert.equal(await correctionDialog(hp).getByRole("button", { name: "Confirm correction", exact: true }).isDisabled(), true);
  await correctionDialog(hp).getByRole("button", { name: "Close result dialog", exact: true }).click();
  assert.equal((await read(host)).saleCorrections.length, 3, "the stale draft never reaches settlement");

  await act(host, { type: "select_player", playerId: players[3].id }); state = await act(host, { type: "start" });
  await refreshSnapshot(hp, host, state.version);
  assert.equal(await hp.getByRole("button", { name: "End auction", exact: true }).isDisabled(), true);
  assert.equal(await hp.getByRole("button", { name: `Correct sale for ${players[1].name}`, exact: true }).isDisabled(), true);
  await act(host, { type: "lock" }); state = await act(host, { type: "unsold" });
  await refreshSnapshot(hp, host, state.version);
  for (const width of [1440, 390, 360]) {
    await hp.setViewportSize({ width, height: 1000 }); await hp.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })); await paint(hp);
    await noOverflow(hp); await controls(hp, ".auction-end-card button, .sale-management button");
    await capture(hp, `completion-administration-${width}.png`);
  }
  await hp.getByRole("button", { name: "End auction", exact: true }).click();
  const endDialog = hp.getByRole("dialog", { name: "End this auction?", exact: true });
  await endDialog.waitFor(); await dialogGeometry(hp, endDialog); await capture(hp, "completion-end-confirmation-360.png");
  state = await uiAction(hp, "end_auction", () => endDialog.getByRole("button", { name: "End auction and create recap", exact: true }).click());
  await endDialog.waitFor({ state: "hidden" });
  await hp.locator(".auction-recap, .auction-ended-banner").first().waitFor();
  await clickNav(hp, "Auction recap", "room"); await hp.locator(".auction-recap").waitFor();
  assert.equal(await hp.locator(".live-lot-status, .nav-live-dot").count(), 0, "completed rooms do not appear live");
  for (const width of [360, 390, 1440]) {
    await hp.setViewportSize({ width, height: 1000 }); await hp.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })); await paint(hp);
    await noOverflow(hp); await controls(hp, ".recap-download-actions button");
    await capture(hp, `completion-recap-${width}.png`);
  }
  await clickNav(hp, "Player pool", "players"); await hp.locator(".auction-ended-banner").waitFor();
  assert.equal(await hp.getByRole("button", { name: /Bring to auction|Select for auction|Auction next/i }).count(), 0);
  assert.equal(await hp.getByRole("button", { name: /Add player/i }).count(), 0);

  await refreshSnapshot(bp, blue, state.version);
  await clickNav(bp, "Build my XI", "build-xi");
  await bp.locator(".auction-ended-banner").waitFor();
  const positionSeven = bp.locator(".lineup-xi-slots .lineup-slot").nth(6);
  await positionSeven.locator(".lineup-slot-pick").click();
  await bp.getByRole("button", { name: `Select ${players[0].name}`, exact: true }).click();
  await bp.getByRole("button", { name: `Manage ${players[0].name}`, exact: true }).click();
  await bp.getByRole("button", { name: `Make ${players[0].name} captain`, exact: true }).click();
  await bp.getByRole("button", { name: "Close player controls", exact: true }).click();
  const finalLineup = await uiAction(bp, "set_lineup", () => bp.getByRole("button", { name: "Save lineup", exact: true }).click());
  assert.equal(finalLineup.teams.find(team => team.id === "mi").lineup.captainId, players[0].id);
  assert.equal(finalLineup.endedAt, state.endedAt);
  await clickNav(bp, "Auction recap", "room"); await bp.locator(".auction-recap").waitFor();
  const pdf = await download(bp, "Download recap PDF", "completion-recap.pdf");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-"); assert.ok(pdf.length > 1000);
  const xlsx = await download(bp, "Download Excel workbook", "completion-squads.xlsx");
  assert.equal(xlsx.subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(new Uint8Array(xlsx).buffer);
  const all = workbook.getWorksheet("All players"); assert.ok(all);
  const rows = []; all.eachRow((row, number) => { if (number > 4) rows.push(row.values); });
  assert.equal(rows.length, 2, "cancelled players do not appear as squad purchases");
  const transferred = rows.find(row => row[3] === players[0].name); const retained = rows.find(row => row[3] === players[1].name);
  assert.equal(transferred[1], "Mumbai Indians"); assert.equal(transferred[2], "Blue team manager");
  assert.equal(transferred[7], "Playing XI"); assert.equal(transferred[8], 7); assert.equal(transferred[9], "Yes"); assert.equal(transferred[11], 700);
  assert.equal(retained[1], "Royal Challengers Bengaluru"); assert.equal(retained[2], "Red team manager"); assert.equal(retained[10], "Yes"); assert.equal(retained[11], 600);
  for (const row of rows) for (let index = 12; index <= 17; index++) assert.equal(row[index] ?? null, null, "match statistics remain blank and editable");
  assert.ok(workbook.getWorksheet("THE TEAMS")); assert.ok(workbook.getWorksheet("POINTS"));
  assert.equal(workbook.getWorksheet("Audit").rowCount, 7, "all three correction entries are exported");
  await hp.bringToFront(); await clickNav(hp, "Room settings", "settings");
  await hp.getByText("Team ownership is final. The room link still welcomes spectators to view the recap.", { exact: true }).waitFor();
  assert.equal(await hp.getByRole("button", { name: "Add call link", exact: true }).count(), 0);
  assert.equal(await hp.getByLabel("Team password", { exact: true }).count(), 0);
  assert.equal(await hp.getByRole("button", { name: "Delete room", exact: true }).count(), 1, "completion does not remove the creator's separate delete option");
  await hp.getByRole("button", { name: "Invite people", exact: true }).click();
  const invitation = hp.getByRole("dialog", { name: "Invite people", exact: true });
  await invitation.getByText("Bidding has ended. New guests can view the results as spectators.", { exact: true }).waitFor();
  assert.equal(await invitation.getByRole("button", { name: "Copy team password", exact: true }).count(), 0);
  await invitation.getByRole("button", { name: "Close dialog", exact: true }).click();
  await bp.bringToFront(); await clickNav(bp, "My Target Picks", "targets");
  await bp.getByText("Auction complete · Saved target list", { exact: true }).waitFor();
  assert.equal(await bp.getByRole("button", { name: "Save targets", exact: true }).isDisabled(), true);
  assert.equal(await bp.getByRole("checkbox", { name: `Target ${players[2].name}`, exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log("PASS: real creator transfer/refund/reason/stale-form controls, other-manager purse/roster/lineup updates, shared audit, completion UI, 360/390/1440 layouts, post-completion captain selection, and actual PDF/Excel downloads with current squads and C/VC.");
} finally {
  if (host) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }).catch(() => undefined);
  await browser.close();
}
