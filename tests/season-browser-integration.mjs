import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Only run this test against the isolated database.");
const base = process.env.BASE_URL;
assert.ok(base);
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const output = resolve(".sites-runtime/screenshots");
await mkdir(output, { recursive: true });
const errors = [];
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = await response.json(); assert.ok(response.ok, `${response.status}: ${value.error}`); return value;
};
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } }).then(value => value.state);
const open = async member => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), { code: member.state.code, token: member.token, memberId: member.memberId });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${member.state.code}&view=season`);
  await page.locator(".app-shell.in-auction.tab-season").waitFor();
  await page.locator(".season-standing").first().waitFor();
  return { page, context };
};
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `${page.viewportSize().width}px page overflow`);
const seasonAction = async (page, type, click) => {
  const observed = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/season") && response.request().postDataJSON()?.type === type);
  await click(); const response = await observed;
  assert.equal(response.status(), 200, await response.text()); await paint(page);
  return (await response.json()).season;
};
const showTeam = async (page, name) => {
  await page.getByRole("button", { name: `View ${name} season points`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await dialog.waitFor(); return dialog;
};
const closeTeam = page => page.getByRole("button", { name: "Close franchise points", exact: true }).click();
const saveScreenshot = async (page, filename) => {
  await page.evaluate(() => document.fonts.ready); await paint(page);
  await page.screenshot({ path: resolve(output, filename), fullPage: true });
};

let host;
try {
  host = await request("/api/rooms", { body: { name: "The Pavilion season", hostName: "Season creator" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const manager = await request(`${pathFor(host)}/join`, { body: { name: "RCB season manager", teamId: "rcb", teamPassword } });
  const rival = await request(`${pathFor(host)}/join`, { body: { name: "MI season manager", teamId: "mi", teamPassword } });
  const spectator = await request(`${pathFor(host)}/join`, { body: { name: "Season spectator", teamId: null } });
  const players = host.state.players.filter(player => !player.isOverseas && player.eligibilityVerified !== false && !player.catalogArchived).slice(0, 5);
  for (const [index, player] of players.entries()) {
    await act(host, { type: "select_player", playerId: player.id }); await act(host, { type: "start" });
    await act(index === 4 ? rival : manager, { type: "bid", expectedPlayerId: player.id, expectedAmount: Math.ceil(player.basePrice / 25) * 25, customAmount: 500 });
    await act(host, { type: "lock" }); await act(host, { type: "sell" });
  }
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: [players[0].id, players[1].id], substitutes: [players[2].id], captainId: players[0].id, viceCaptainId: players[1].id } });
  const { page: hp, context: hc } = await open(host);
  assert.equal(await hp.getByRole("button", { name: "Fetch latest data", exact: true }).isVisible(), true);
  assert.match(await hp.locator(".season-leader-card").innerText(), /Connect a points source/);
  assert.equal(await hp.locator(".season-standing-points strong").first().innerText(), "—");
  const reference = await seasonAction(hp, "reference", () => hp.getByRole("button", { name: "Load verified 2026 snapshot", exact: true }).click());
  assert.equal(reference.snapshot.method, "reference");
  assert.equal(reference.coverage.sourceRows, 202);
  assert.equal(reference.snapshot.fetchedAt, reference.reference.fetchedAt, "The reference keeps its original capture date.");
  assert.match(await hp.locator(".season-source-facts").innerText(), /Verified snapshot/);
  assert.match(await hp.locator(".season-source-facts").innerText(), /not a live refresh/);
  await hp.locator(".season-source-panel").screenshot({ path: resolve(output, "season-reference-desktop.png") });
  await hp.setViewportSize({ width: 360, height: 1000 }); await paint(hp); await noOverflow(hp);
  await hp.locator(".season-source-panel").screenshot({ path: resolve(output, "season-reference-360.png") });
  await hp.setViewportSize({ width: 1440, height: 1000 });
  console.log("PASS: the creator can explicitly load the real 202-row reference snapshot with its original timestamp and honest saved-data label.");
  const analytics = hp.locator(".season-analytics");
  assert.equal(await analytics.getByRole("tab").count(), 3);
  assert.equal(await analytics.getByRole("region", { name: "Tournament stats", exact: true }).isVisible(), true);
  assert.match(await analytics.locator(".sa-tournament-metrics").innerText(), /202/);
  const visitedBoards = new Set();
  for (const category of ["Tournament", "Squad analysis", "Auction value"]) {
    await analytics.getByRole("tab", { name: category, exact: false }).click();
    const choices = await analytics.locator(".sa-board-choices button").evaluateAll(buttons => buttons.map(button => button.getAttribute("data-board")));
    for (const id of choices) {
      await analytics.locator(`.sa-board-choices button[data-board="${id}"]`).click();
      await analytics.locator(`.sa-board[data-board-id="${id}"]`).waitFor();
      assert.equal(await analytics.locator(`.sa-board-choices button[data-board="${id}"]`).getAttribute("aria-pressed"), "true");
      visitedBoards.add(id);
    }
  }
  assert.equal(visitedBoards.size, 20, "Every PDF analytics leaderboard is accessible through the three groups.");
  for (const width of [1440, 360]) {
    await hp.setViewportSize({ width, height: 1000 });
    for (const [category, boardId, suffix] of [["Tournament", "top-mvp", "tournament"], ["Squad analysis", "overall", "squad"], ["Auction value", "best-value", "value"]]) {
      await analytics.getByRole("tab", { name: category, exact: false }).click();
      await analytics.locator(`.sa-board-choices button[data-board="${boardId}"]`).click();
      await paint(hp); await noOverflow(hp);
      const choices = await analytics.locator(".sa-board-choices").evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth }));
      assert.ok(choices.scroll <= choices.width + 1, `${width}px: board choices must wrap instead of creating a horizontal scrollbar`);
      if (width === 360) {
        const scores = await analytics.locator(".sa-row-value > strong, .sa-podium-team > b, .sa-tournament-metrics strong").evaluateAll(elements => elements.map(element => {
          const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          if (!text) return { text: "", lines: 0, fits: true };
          const range = document.createRange(); range.selectNodeContents(text);
          const rects = [...range.getClientRects()]; const box = element.getBoundingClientRect();
          return { text: text.textContent, lines: new Set(rects.map(rect => Math.round(rect.top))).size, fits: rects.every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1) };
        }));
        for (const score of scores) { assert.equal(score.lines, 1, `360px score ${score.text} must stay on one line`); assert.equal(score.fits, true, `360px score ${score.text} must fit its allocated column`); }
      }
      await analytics.screenshot({ path: resolve(output, `season-analytics-${suffix}-${width}.png`) });
    }
  }
  await analytics.getByRole("tab", { name: "Squad analysis", exact: false }).click();
  assert.equal(await analytics.getByRole("region", { name: "Season podium", exact: true }).locator(".sa-podium-team").count(), 2, "Only purchased teams occupy the podium.");
  await analytics.locator('.sa-board[data-board-id="overall"] button.sa-identity').first().click();
  await hp.locator(".season-team-dialog[open]").waitFor(); await closeTeam(hp);
  await analytics.getByRole("tab", { name: "Tournament", exact: false }).click();
  await analytics.getByRole("tab", { name: "Tournament", exact: false }).focus();
  await hp.keyboard.press("ArrowRight");
  assert.equal(await analytics.getByRole("tab", { name: "Squad analysis", exact: false }).getAttribute("aria-selected"), "true");
  await hp.setViewportSize({ width: 1440, height: 1000 });
  console.log("PASS: all 20 PDF boards and tournament stats are accessible, podium teams open full squads, keyboard tabs work, and board controls wrap at 360px.");
  await hp.locator(".season-import-tools summary").click();
  await hp.getByLabel("Player points table", { exact: true }).fill(`name,points,matches,runs,wickets\n${players[0].name},100.25,5,213,2\n${players[1].name},10.25,4,185,1\n${players[2].name},-8.5,,50,0\nSource player alternate,12,2,30,1\n${players[4].name},90,4,200,2`);
  let season = await seasonAction(hp, "import", () => hp.getByRole("button", { name: "Save imported points", exact: true }).click());
  assert.equal(season.teams.find(team => team.id === "rcb").knownPoints, 207.375);
  let dialog = await showTeam(hp, "Royal Challengers Bengaluru");
  assert.equal(await dialog.locator("tbody tr").count(), 4, "Every signing appears, including a substitute and a player outside the XI.");
  const captainRow = dialog.locator("tbody tr").filter({ hasText: players[0].name });
  assert.equal(await captainRow.locator(".season-weighted-points").innerText(), "200.5");
  assert.equal(await captainRow.locator(".season-player-deviation").innerText(), "+59.45", "Deviation uses raw MVP minus the complete source average.");
  assert.equal(await captainRow.locator(".season-player-average").innerText(), "40.1", "Points per match uses weighted points.");
  const viceRow = dialog.locator("tbody tr").filter({ hasText: players[1].name });
  assert.equal(await viceRow.locator(".season-weighted-points").innerText(), "15.375", "Half multiplier preserves third decimal.");
  assert.equal(await viceRow.locator(".season-player-deviation").innerText(), "-30.55");
  assert.equal(await viceRow.locator(".season-player-average").innerText(), "3.84375");
  assert.match(await dialog.locator(".season-player-average-total").innerText(), /43\.94375/);
  assert.match(await dialog.locator(".season-player-average-total").innerText(), /2 \/ 4 rates known/);
  assert.match(await dialog.locator("tbody tr").filter({ hasText: players[3].name }).innerText(), /Pending/);
  assert.match(await dialog.locator("tbody tr").filter({ hasText: players[2].name }).innerText(), /-8\.5/);
  await closeTeam(hp);
  console.log("PASS: creator imports a source; all signings count, captaincy is weighted exactly, negatives count and missing data remains pending.");

  await hp.locator(".season-match-tools summary").filter({ hasText: "source data" }).click();
  const select = hp.getByRole("combobox", { name: `Source match for ${players[3].name}`, exact: true });
  await select.selectOption({ label: "Source player alternate · 12 MVP" });
  season = await seasonAction(hp, "map", () => select.locator("..").getByRole("button", { name: "Link player", exact: true }).click());
  assert.equal(season.teams.find(team => team.id === "rcb").points, 219.375);
  assert.equal(season.teams.find(team => team.id === "rcb").complete, true);
  assert.equal(await hp.locator(".season-leader-score > strong").innerText(), "219.375");
  await hp.reload(); await hp.locator(".season-leader-score > strong").filter({ hasText: "219.375" }).waitFor();
  console.log("PASS: a creator-confirmed player match recalculates the table and persists across reload.");

  const { page: mp, context: mc } = await open(manager);
  const { page: sp, context: sc } = await open(spectator);
  for (const page of [mp, sp]) {
    assert.equal(await page.getByRole("button", { name: /Fetch latest/ }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Load verified 2026 snapshot", exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Player points table", { exact: true }).count(), 0);
    await showTeam(page, "Royal Challengers Bengaluru");
    assert.equal(await page.locator(".season-team-dialog tbody tr").count(), 4);
    await closeTeam(page);
  }
  assert.equal(await mp.locator(".season-standing.is-own").count(), 1);
  assert.equal(await sp.locator(".season-standing.is-own").count(), 0);
  console.log("PASS: managers and spectators can view full points while provider controls remain creator-only.");

  await mp.bringToFront();
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 1, lineup: { playingXI: [players[0].id, players[1].id], substitutes: [players[2].id], captainId: players[1].id, viceCaptainId: players[0].id } });
  await mp.evaluate(() => window.dispatchEvent(new Event("focus")));
  await mp.locator(".season-leader-score > strong").filter({ hasText: "174.375" }).waitFor();
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 2, lineup: { playingXI: [players[0].id, players[1].id], substitutes: [players[2].id], captainId: players[0].id, viceCaptainId: players[1].id } });
  await mp.evaluate(() => window.dispatchEvent(new Event("focus")));
  await mp.locator(".season-leader-score > strong").filter({ hasText: "219.375" }).waitFor();
  console.log("PASS: saved captaincy changes recalculate the visible season without another provider fetch.");

  await hp.bringToFront();
  await hp.route(`**/api/rooms/${host.state.code}/season`, async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.type === "fetch") return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The source temporarily blocked automated fetching. Import its table instead.", code: "SEASON_SOURCE_BLOCKED" }) });
    return route.continue();
  });
  await hp.getByRole("button", { name: "Fetch latest data", exact: true }).click();
  await hp.getByRole("alert").filter({ hasText: "temporarily blocked" }).waitFor();
  assert.equal(await hp.locator(".season-leader-score > strong").innerText(), "219.375");
  assert.match(await hp.locator(".auction-season").getByRole("alert").innerText(), /last successful points snapshot/);
  await hp.unroute(`**/api/rooms/${host.state.code}/season`);
  console.log("PASS: fetch failures retain the last successful standings and offer an explicit import fallback.");

  let serviceAvailable = false;
  let serviceMode = "worker";
  let refreshRequests = 0;
  await hp.route(`**/api/rooms/${host.state.code}/season`, async route => {
    if (route.request().method() === "GET") {
      const response = await route.fetch(); const value = await response.json();
      value.season.sourceFetch = { mode: serviceMode, available: serviceAvailable, lastSeenAt: serviceMode === "worker" && serviceAvailable ? new Date().toISOString() : null };
      return route.fulfill({ response, json: value });
    }
    if (route.request().postDataJSON()?.type === "fetch") {
      refreshRequests += 1;
      await new Promise(resolve => setTimeout(resolve, 600));
      const value = await request(`${pathFor(host)}/season`, { token: host.token });
      value.season.sourceFetch = { mode: serviceMode, available: true, lastSeenAt: serviceMode === "worker" ? new Date().toISOString() : null };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    }
    return route.continue();
  });
  await hp.reload();
  await hp.getByText("Refresh service offline", { exact: true }).waitFor();
  assert.equal(await hp.getByRole("button", { name: "Fetch latest data", exact: true }).isDisabled(), true);
  assert.equal(await hp.getByRole("button", { name: "Load verified 2026 snapshot", exact: true }).isDisabled(), false);
  assert.match(await hp.locator(".season-refresh-status").innerText(), /running on the host computer/);
  await hp.getByLabel("ESPNcricinfo MVP page", { exact: true }).fill("https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players");
  let configured = await seasonAction(hp, "configure", () => hp.getByRole("button", { name: "Save source link", exact: true }).click());
  assert.match(configured.sourceUrl, /ipl-2025-1449924/);
  await hp.getByText("Refresh service offline", { exact: true }).waitFor();
  await hp.getByLabel("ESPNcricinfo MVP page", { exact: true }).fill("https://www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players");
  configured = await seasonAction(hp, "configure", () => hp.getByRole("button", { name: "Save source link", exact: true }).click());
  assert.match(configured.sourceUrl, /ipl-2026-1510719/);
  await hp.getByText("Refresh service offline", { exact: true }).waitFor();
  assert.equal(refreshRequests, 0, "No refresh is posted while the service is offline.");
  await hp.locator(".season-source-panel").screenshot({ path: resolve(output, "season-refresh-offline.png") });
  serviceAvailable = true;
  await hp.evaluate(() => window.dispatchEvent(new Event("focus")));
  await hp.getByText("Refresh service online", { exact: true }).waitFor();
  const refreshed = hp.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.type === "fetch");
  await hp.getByRole("button", { name: "Fetch latest data", exact: true }).click();
  await hp.getByRole("button", { name: "Fetching fresh points…", exact: true }).waitFor();
  assert.equal((await refreshed).status(), 200);
  await hp.getByRole("button", { name: "Fetch latest data", exact: true }).waitFor();
  assert.equal(refreshRequests, 1, "A fresh refresh is sent once, only after an explicit click.");
  serviceMode = "cloud";
  serviceAvailable = false;
  await hp.evaluate(() => window.dispatchEvent(new Event("focus")));
  await hp.getByText("Cloud refresh unavailable", { exact: true }).waitFor();
  assert.equal(await hp.getByRole("button", { name: "Fetch latest data", exact: true }).isDisabled(), true);
  assert.doesNotMatch(await hp.locator(".season-source-panel").innerText(), /host computer|fetch service needs to be running/i);
  serviceAvailable = true;
  await hp.evaluate(() => window.dispatchEvent(new Event("focus")));
  await hp.getByText("Cloud refresh ready", { exact: true }).waitFor();
  assert.equal(await hp.getByRole("button", { name: "Fetch latest data", exact: true }).isDisabled(), false);
  const cloudRefreshed = hp.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.type === "fetch");
  await hp.getByRole("button", { name: "Fetch latest data", exact: true }).click();
  await hp.getByRole("button", { name: "Fetching fresh points…", exact: true }).waitFor();
  assert.equal((await cloudRefreshed).status(), 200);
  await hp.getByRole("button", { name: "Fetch latest data", exact: true }).waitFor();
  assert.equal(refreshRequests, 2, "Cloud refresh sends one additional explicit request, with no automatic retries.");
  assert.doesNotMatch(await hp.locator(".season-source-panel").innerText(), /host computer|fetch service needs to be running/i);
  await hp.locator(".season-source-panel").screenshot({ path: resolve(output, "season-refresh-cloud.png") });
  await hp.unroute(`**/api/rooms/${host.state.code}/season`);
  console.log("PASS: offline refresh disables only fetching, source edits and snapshots remain usable, and an online refresh is sent exactly once with clear pending text.");
  console.log("PASS: cloud refresh displays readiness without any host-computer dependency and sends exactly one explicit request.");

  const downloaded = hp.waitForEvent("download", { timeout: 60000 });
  await hp.getByRole("button", { name: "Download points", exact: true }).click();
  const file = await downloaded; assert.equal(await file.failure(), null);
  const path = resolve(output, "season-browser-workbook.xlsx"); await file.saveAs(path);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(path));
  assert.ok(workbook.getWorksheet("POINTS"));
  assert.ok(workbook.getWorksheet("THE TEAMS"));
  console.log("PASS: downloaded season workbook is a real Excel file with POINTS and THE TEAMS.");

  await mp.bringToFront();
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 360]) {
    await mp.setViewportSize({ width, height: 1000 }); await mp.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })); await paint(mp); await noOverflow(mp);
    if (width >= 1280) {
      const navigation = mp.getByRole("navigation", { name: "Main navigation", exact: true });
      assert.equal(await navigation.locator("button[data-destination]").count(), 8, "Managers retain all eight navigation destinations.");
      const geometry = await navigation.evaluate(element => {
        const buttons = [...element.querySelectorAll("button")].filter(button => button.getClientRects().length > 0).map(button => ({ label: button.textContent, left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right }));
        return { right: element.getBoundingClientRect().right, buttons, viewport: innerWidth };
      });
      assert.ok(geometry.right <= geometry.viewport, `Navigation fits ${width}px`);
      geometry.buttons.slice(1).forEach((button, index) => assert.ok(button.left >= geometry.buttons[index].right - 1, `${width}px: ${button.label} must not overlap the previous destination`));
    }
    await saveScreenshot(mp, `season-manager-${width}.png`);
    dialog = await showTeam(mp, "Royal Challengers Bengaluru"); await paint(mp);
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `Points dialog fits ${width}px`);
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    if (width <= 640) {
      const pointsCell = await dialog.locator(".season-weighted-points").first().boundingBox();
      const tableViewport = await dialog.locator(".season-player-table-wrap").boundingBox();
      assert.ok(pointsCell && tableViewport && pointsCell.x >= tableViewport.x && pointsCell.x + pointsCell.width <= tableViewport.x + tableViewport.width + 1, `${width}px: team points must be fully visible without horizontal scrolling`);
      assert.equal(await dialog.getByText("Swipe for MVP and match stats", { exact: true }).isVisible(), true);
    }
    if (width === 1440 || width === 360) await saveScreenshot(mp, `season-points-${width}.png`);
    await mp.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  }
  await hc.close(); await mc.close(); await sc.close();
  assert.deepEqual(errors, []);
  console.log("PASS: season dashboard and points dialog fit 360–1920px, keyboard dismissal works, and no browser errors occurred.");
} finally {
  await browser.close();
  if (host) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } });
}
