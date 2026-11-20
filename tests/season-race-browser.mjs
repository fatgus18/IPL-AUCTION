import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { navigateTo } from "./browser-navigation.mjs";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run only through the isolated API runner.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const output = resolve(".sites-runtime/screenshots");
await mkdir(output, { recursive: true });
const errors = [], browserWrites = [];
const api = async (path, { member, body, status } = {}) => {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(member ? { Authorization: `Bearer ${member.token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: base }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000),
  });
  const value = await response.json();
  if (status !== undefined) assert.equal(response.status, status, `${response.status}: ${value.error}`);
  else assert.ok(response.ok, `${response.status}: ${value.error}`);
  return value;
};
const roomPath = member => `/api/rooms/${member.state.code}`;
const seasonPath = member => `${roomPath(member)}/season`;
const act = (member, action) => api(`${roomPath(member)}/action`, { member, body: { action } }).then(value => value.state);
const read = member => api(seasonPath(member), { member }).then(value => value.season);
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const snapshot = page => page.getByRole("complementary", { name: "Standings at selected checkpoint", exact: true });
const leader = page => snapshot(page).locator(".race-row-name strong").first();
const noOverflow = async page => {
  const geometry = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
    panels: [...document.querySelectorAll(".season-race, .race-plot-panel, .race-snapshot, .race-legend")].map(element => ({
      name: element.className, content: element.scrollWidth, width: element.clientWidth,
    })),
  }));
  assert.ok(geometry.page <= geometry.viewport + 1, `${geometry.viewport}px page overflow`);
  for (const panel of geometry.panels) assert.ok(panel.content <= panel.width + 1, `${geometry.viewport}px ${panel.name} overflow`);
};

let host;
try {
  host = await api("/api/rooms", { body: { name: "Season race verification", hostName: "Race creator" } });
  const { teamPassword } = await api(`${roomPath(host)}/access`, { member: host, body: {} });
  const managers = {};
  for (const teamId of ["rcb", "mi", "csk"]) managers[teamId] = await api(`${roomPath(host)}/join`, { body: { name: `${teamId.toUpperCase()} race manager`, teamId, teamPassword } });
  const spectator = await api(`${roomPath(host)}/join`, { body: { name: "Race spectator", teamId: null } });
  const players = host.state.players.filter(player => player.status === "available" && !player.isOverseas && player.eligibilityVerified !== false && !player.catalogArchived).slice(0, 4);
  assert.equal(players.length, 4);
  for (const [index, player] of players.entries()) {
    await act(host, { type: "select_player", playerId: player.id }); await act(host, { type: "start" });
    await act(managers[index < 2 ? "rcb" : index === 2 ? "mi" : "csk"], { type: "bid", expectedPlayerId: player.id, expectedAmount: Math.max(25, Math.ceil(player.basePrice / 25) * 25) });
    await act(host, { type: "lock" }); await act(host, { type: "sell" });
  }
  for (const [teamId, captain, vice] of [["rcb", 0, 1], ["mi", 2, null], ["csk", 3, null]]) await act(managers[teamId], {
    type: "set_captaincy", teamId, captainId: players[captain].id, viceCaptainId: vice === null ? null : players[vice].id, expectedRevision: 0,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), { code: host.state.code, token: spectator.token, memberId: spectator.memberId });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/season")) browserWrites.push(request.postDataJSON()); });
  await page.goto(`${base}/?room=${host.state.code}`);
  await page.locator(".app-shell.in-auction").waitFor();
  await navigateTo(page, "Auction Season");
  const race = page.locator("section.season-race");
  await race.locator(".race-empty").waitFor();
  assert.match(await race.innerText(), /Your next successful points update records the first checkpoint/);
  assert.equal(await race.getByRole("slider", { name: "Season checkpoint" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Fetch latest data", exact: true }).count(), 0, "Spectator controls stay read-only.");
  let season = await read(host);
  assert.equal(season.raceHistory.totalCheckpoints, 0);
  const importPoints = async values => {
    const text = JSON.stringify(players.flatMap((player, index) => values[index] === null ? [] : [{ name: player.name, points: values[index], matches: 3 }]));
    season = (await api(seasonPath(host), { member: host, body: { type: "import", expectedRevision: season.revision, text } })).season;
    return season.raceHistory.checkpoints.at(-1);
  };
  const showCount = async count => {
    await page.reload(); await race.waitFor();
    await page.waitForFunction(expected => document.querySelector(".race-record-count")?.textContent.trim() === `${expected} ${expected === 1 ? "checkpoint" : "checkpoints"}`, count);
    await paint(page);
  };
  const first = await importPoints([10, 2, 8, null]);
  assert.equal(first.teams.find(team => team.id === "rcb").points, 23);
  assert.equal(first.teams.find(team => team.id === "csk").points, null, "Unknown points remain unknown.");
  assert.deepEqual(first.overtakes, []);
  await showCount(1);
  const slider = race.getByRole("slider", { name: "Season checkpoint", exact: true });
  assert.equal(await slider.isDisabled(), true);
  assert.equal(await leader(page).innerText(), "RCB");
  const second = await importPoints([11, 2, 20, -4]);
  assert.deepEqual(second.overtakes, [{ teamId: "mi", passedTeamId: "rcb" }]);
  assert.equal(second.teams.find(team => team.id === "csk").points, -8);
  const third = await importPoints([30, 4, 23, 5]);
  assert.deepEqual(third.overtakes, [{ teamId: "rcb", passedTeamId: "mi" }]);
  const recorded = structuredClone(season.raceHistory.checkpoints);
  for (const member of [host, managers.rcb, spectator, spectator]) assert.deepEqual((await read(member)).raceHistory.checkpoints, recorded, "Reads and public projections must not append or rewrite checkpoints.");
  await api(seasonPath(host), { member: spectator, body: { type: "map", mappings: {}, expectedRevision: season.revision }, status: 403 });
  assert.deepEqual((await read(host)).raceHistory.checkpoints, recorded, "A spectator cannot create a history checkpoint.");
  await showCount(3);
  assert.equal(await leader(page).innerText(), "RCB");
  assert.match(await race.locator(".race-overtakes").innerText(), /RCB.*MI/s);
  await slider.focus(); await slider.press("Home"); await paint(page);
  assert.match(await slider.getAttribute("aria-valuetext"), /^Checkpoint 1,/);
  assert.equal(await race.getByRole("button", { name: "Previous checkpoint", exact: true }).isDisabled(), true);
  assert.equal(await race.locator(".race-overtakes").count(), 0);
  await slider.press("ArrowRight"); await paint(page);
  assert.match(await slider.getAttribute("aria-valuetext"), /^Checkpoint 2,/);
  assert.equal(await leader(page).innerText(), "MI");
  assert.match(await race.locator(".race-overtakes").innerText(), /MI.*RCB/s);
  await race.getByRole("button", { name: "Next checkpoint", exact: true }).click(); await paint(page);
  assert.equal(await leader(page).innerText(), "RCB");
  const metric = race.getByRole("group", { name: "Timeline metric", exact: true });
  await metric.getByRole("button", { name: "Position", exact: true }).click();
  assert.equal(await metric.getByRole("button", { name: "Position", exact: true }).getAttribute("aria-pressed"), "true");
  assert.match(await race.locator("svg.race-chart").getAttribute("aria-label"), /^Position history across 3/);
  await metric.getByRole("button", { name: "Points", exact: true }).click();
  const legend = race.getByRole("group", { name: "Highlight a franchise", exact: true });
  await legend.getByRole("button", { name: "RCB", exact: true }).click();
  assert.equal(await legend.getByRole("button", { name: "RCB", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await race.locator(".race-series-path.is-muted").count(), 2);
  assert.ok((await race.locator(".race-team-detail").innerText()).includes(players[0].name));
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 1000 }); await paint(page); await noOverflow(page);
    await page.evaluate(() => document.fonts.ready);
    await race.screenshot({ path: resolve(output, `season-race-${width === 1440 ? "desktop" : "mobile-360"}.png`) });
  }
  assert.deepEqual((await read(host)).raceHistory.checkpoints, recorded, "Exploring the timeline never changes stored history.");
  console.log("PASS: empty/first states, three checkpoints, real overtakes, signed/unknown scores, keyboard controls and 1440/360px layouts.");

  await act(managers.rcb, { type: "set_captaincy", teamId: "rcb", captainId: players[1].id, viceCaptainId: players[0].id, expectedRevision: 1 });
  season = await read(host);
  assert.deepEqual(season.raceHistory.checkpoints, recorded, "Current captaincy cannot rewrite any historical field.");
  assert.equal(season.raceHistory.currentTeamsChanged, true);
  assert.equal(season.teams.find(team => team.id === "rcb").points, 53);
  assert.equal(season.raceHistory.checkpoints.at(-1).teams.find(team => team.id === "rcb").points, 66);
  await showCount(3);
  assert.match(await race.locator(".race-context-note").innerText(), /changed since the latest checkpoint/);
  const fourth = await importPoints([30, 4, 23, 5]);
  assert.deepEqual(season.raceHistory.checkpoints.slice(0, 3), recorded);
  const change = fourth.teamChanges.find(team => team.teamId === "rcb");
  assert.equal(change.captaincyChanged, true); assert.equal(change.pointsDelta, -13);
  assert.equal(season.raceHistory.currentTeamsChanged, false);
  await showCount(4);
  await legend.getByRole("button", { name: "RCB", exact: true }).click();
  assert.match(await race.locator(".race-team-detail").innerText(), /Captaincy changed/);
  const beforeFailure = structuredClone(season.raceHistory.checkpoints);
  await api(seasonPath(host), { member: host, body: { type: "import", text: "not a points table", expectedRevision: season.revision }, status: 400 });
  await api(seasonPath(host), { member: host, body: { type: "map", mappings: {}, expectedRevision: season.revision - 1 }, status: 409 });
  assert.deepEqual((await read(host)).raceHistory.checkpoints, beforeFailure);
  const scoredSource = structuredClone(season.snapshot);
  season = (await api(seasonPath(host), { member: host, body: { type: "configure", expectedRevision: season.revision, sourceUrl: "https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players" } })).season;
  assert.deepEqual(season.raceHistory.checkpoints, beforeFailure); assert.deepEqual(season.snapshot, scoredSource);
  assert.equal(season.sourceChanged, true);
  const fifth = await importPoints([30, 4, 23, 5]);
  assert.equal(fifth.seriesId, "1449924"); assert.notEqual(fifth.segmentId, fourth.segmentId);
  assert.equal(fifth.previousCheckpointId, null); assert.deepEqual(fifth.teamChanges, []); assert.deepEqual(fifth.overtakes, []);
  assert.deepEqual(season.raceHistory.checkpoints.slice(0, 4), beforeFailure);
  const allHistory = structuredClone(season.raceHistory);
  await showCount(5);
  assert.equal(await slider.isDisabled(), true, "A different source starts a separate one-point segment.");
  const series = race.getByRole("combobox", { name: "Timeline series", exact: true });
  assert.equal(await series.locator("option").count(), 2);
  await series.selectOption(first.segmentId); await paint(page);
  assert.equal(await slider.isDisabled(), false); assert.match(await slider.getAttribute("aria-valuetext"), /^Checkpoint 4,/);
  await slider.focus(); await slider.press("Home"); await paint(page);
  assert.match(await slider.getAttribute("aria-valuetext"), /^Checkpoint 1,/);
  const original = snapshot(page).getByRole("button", { name: "Highlight Royal Challengers Bengaluru in timeline", exact: true });
  assert.equal(await original.locator(".race-row-total strong").getAttribute("title"), "23");
  await page.reload(); await race.waitFor();
  assert.deepEqual((await read(spectator)).raceHistory, allHistory, "History survives browser reload with every frozen field unchanged.");
  console.log("PASS: captaincy drift is labeled and captured once, failures/configuration preserve history, and unrelated sources stay in separate segments.");

  const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: "Download points", exact: true }).click();
  const download = await downloadPromise; assert.equal(await download.failure(), null);
  const workbookPath = resolve(output, "season-race-workbook.xlsx"); await download.saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(workbookPath));
  const historySheet = workbook.getWorksheet("Season race"); assert.ok(historySheet);
  const data = historySheet.getRows(5, historySheet.rowCount - 4);
  assert.equal(data.length, allHistory.checkpoints.reduce((total, checkpoint) => total + checkpoint.teams.length, 0));
  const firstRCB = data.find(row => row.getCell(1).value === 1 && row.getCell(7).value === "Royal Challengers Bengaluru");
  assert.ok(firstRCB);
  assert.equal(firstRCB.getCell(2).value, new Date(first.recordedAt).toISOString());
  assert.equal(firstRCB.getCell(3).value, first.sourceCapturedAt);
  assert.equal(firstRCB.getCell(10).value, 23); assert.equal(firstRCB.getCell(15).value, players[0].name);
  const fourthRCB = data.find(row => row.getCell(1).value === 4 && row.getCell(7).value === "Royal Challengers Bengaluru");
  assert.equal(fourthRCB.getCell(10).value, 53); assert.equal(fourthRCB.getCell(11).value, -13);
  assert.equal(fourthRCB.getCell(15).value, players[1].name); assert.match(fourthRCB.getCell(17).value, /Captaincy changed/);
  assert.deepEqual(browserWrites, [], "Timeline, navigation, reload and Excel are read-only; none requests a source refresh.");
  assert.deepEqual(errors, []);
  console.log("PASS: the downloaded workbook preserves every checkpoint and original captaincy; no browser errors or automatic source writes.");
} finally {
  await browser.close();
  if (host) await api(`${roomPath(host)}/delete`, { member: host, body: { confirmationCode: host.state.code } });
}
