import { navigateTo, navigationItem as nav } from "./browser-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run only through the isolated API runner; never change a user's room.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
const errors = [];
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${response.status}: ${value.error}`);
  return value;
};
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } }).then(value => value.state);
const read = member => request(pathFor(member), { token: member.token }).then(value => value.state);
const financials = state => ({
  currentPlayerId: state.currentPlayerId, currentBid: state.currentBid, leadingTeamId: state.leadingTeamId,
  phase: state.phase, bidHistory: state.bidHistory, players: state.players, teams: state.teams,
});
const clickNav = async (page, name, view) => {
  await navigateTo(page, name);
  if (view) await page.locator(`.app-shell.tab-${view}`).waitFor();
};
const openMember = async (member, view = "targets") => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const access = { code: member.state.code, token: member.token, memberId: member.memberId };
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), access);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${access.code}&view=${view}`);
  await page.locator(".app-shell.in-auction").waitFor();
  await page.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  return { context, page };
};
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const observedVersion = async (page, member, version) => {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || new URL(response.url()).pathname !== pathFor(member) || !response.ok()) return false;
    try { const value = await response.json(); return (value.state?.version ?? value.version ?? -1) >= version; }
    catch { return false; }
  });
  await paint(page);
};
const pool = page => page.getByRole("region", { name: "Player pool for targeting", exact: true });
const targetList = page => page.getByRole("list", { name: "Your target list", exact: true });
const selectedIds = page => targetList(page).locator("li[data-player-id]").evaluateAll(elements => elements.map(element => element.dataset.playerId));
const assertSelected = async (page, expected) => assert.deepEqual((await selectedIds(page)).sort(), [...expected].sort());
const target = async (page, player) => {
  await page.getByRole("searchbox", { name: "Search target players", exact: true }).fill(player.name);
  const toggle = pool(page).getByRole("checkbox", { name: `Target ${player.name}`, exact: true });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
};
const save = async page => {
  const received = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/action") && response.request().postDataJSON()?.action?.type === "set_target_picks");
  await page.getByRole("button", { name: "Save targets", exact: true }).click();
  const response = await received;
  assert.equal(response.status(), 200, await response.text());
  await page.getByRole("button", { name: "Save targets", exact: true }).waitFor();
  await paint(page);
  return (await response.json()).state;
};
const noNotice = async page => assert.equal(await page.locator(".new-lot-notice:visible").count(), 0);
const targetNotice = async (page, player) => {
  await page.bringToFront();
  const notice = page.locator(".new-lot-notice").filter({ hasText: player.name });
  await notice.getByText("Your target is up", { exact: true }).waitFor();
  assert.equal(await page.locator(".new-lot-notice").count(), 1);
  return notice;
};
const dismiss = async page => {
  await page.getByRole("button", { name: "Dismiss player notification", exact: true }).click();
  await noNotice(page);
};
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${page.viewportSize().width}px should not overflow`);
const screenshot = async (page, name, fullPage = true) => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await paint(page);
  await page.screenshot({ path: resolve(screenshots, name), fullPage });
};

try {
  const host = await request("/api/rooms", { body: { name: "Private target picks browser", hostName: "Target auctioneer" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword } : {}) } });
  const owner = await join("Target RCB manager", "rcb");
  const rival = await join("Target MI manager", "mi");
  const spectator = await join("Target spectator");
  const candidates = host.state.players.filter(player => player.status === "available" && player.eligibilityVerified !== false).slice(0, 15);
  assert.equal(candidates.length, 15);
  const ids = candidates.map(player => player.id);
  const marqueeAllRounder = host.state.players.find(player => player.role === "Marquee" && /all.?rounder/i.test(player.playingRole ?? ""));
  assert.ok(marqueeAllRounder, "the fixture needs a marquee player with a known playing role");

  for (const member of [host, spectator]) {
    const forbidden = await openMember(member);
    await forbidden.page.locator(".app-shell.tab-room").waitFor();
    assert.equal(new URL(forbidden.page.url()).searchParams.get("view"), "room");
    assert.equal(await nav(forbidden.page, "My Target Picks").count(), 0);
    assert.equal(await pool(forbidden.page).count(), 0);
    await forbidden.context.close();
  }
  const ownerBrowser = await openMember(owner);
  const page = ownerBrowser.page;
  await page.getByRole("heading", { name: /^My Target Picks\.?$/ }).waitFor();
  assert.equal(await nav(page, "My Target Picks").getAttribute("aria-current"), "page");
  assert.equal(await page.getByRole("navigation", { name: "Main navigation" }).locator("button[data-destination]").count(), 8);
  await assertSelected(page, []);
  assert.equal(await pool(page).locator(".target-player-card").count(), 24, "the full catalog starts with a lightweight page of 24 cards");
  await page.getByRole("button", { name: /^Load more players/ }).click();
  assert.equal(await pool(page).locator(".target-player-card").count(), 48);
  await page.getByRole("searchbox", { name: "Search target players", exact: true }).fill("NoSuchCricketerTargetBrowser");
  assert.equal(await pool(page).locator(".target-player-card").count(), 0);
  await page.getByRole("searchbox", { name: "Search target players", exact: true }).fill("");
  const roleFilters = page.getByRole("group", { name: "Filter targets by playing role", exact: true });
  await roleFilters.getByRole("button", { name: "All-rounder", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search target players", exact: true }).fill(marqueeAllRounder.name);
  assert.equal(await pool(page).locator(".target-player-card").count(), 1, "Marquee all-rounders must be discoverable by their actual playing role");
  await roleFilters.getByRole("button", { name: "Wicketkeeper", exact: true }).click();
  assert.equal(await pool(page).locator(".target-player-card").count(), 0);
  await roleFilters.getByRole("button", { name: "All roles", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search target players", exact: true }).fill(candidates[14].name);
  const keyboardTarget = pool(page).getByRole("checkbox", { name: `Target ${candidates[14].name}`, exact: true });
  await keyboardTarget.focus();
  await keyboardTarget.press("Space");
  assert.equal(await keyboardTarget.getAttribute("aria-checked"), "true");
  await keyboardTarget.press("Space");
  assert.equal(await keyboardTarget.getAttribute("aria-checked"), "false");
  await assertSelected(page, []);
  const beforeInitialSave = financials(await read(owner));
  for (const player of candidates.slice(0, 5)) await target(page, player);
  await assertSelected(page, ids.slice(0, 5));
  assert.deepEqual((await read(owner)).myTargetPicks?.playerIds ?? [], [], "selecting cards must not publish an unsaved draft");
  let saved = await save(page);
  assert.deepEqual(saved.myTargetPicks.playerIds, ids.slice(0, 5));
  assert.deepEqual(financials(saved), beforeInitialSave, "targets do not buy a player, change bidding, or spend money");
  await page.reload();
  await pool(page).waitFor();
  await assertSelected(page, ids.slice(0, 5));
  const restored = await openMember(owner);
  await pool(restored.page).waitFor();
  await assertSelected(restored.page, ids.slice(0, 5));
  await restored.context.close();
  const rivalBrowser = await openMember(rival, "room");
  assert.equal((await read(rival)).myTargetPicks?.playerIds.length ?? 0, 0);
  assert.equal((await read(host)).myTargetPicks, undefined);
  assert.equal((await read(spectator)).myTargetPicks, undefined);
  console.log("PASS: only a franchise manager receives My Target Picks; the catalog is searchable and paginated, the first five targets persist across reload/new contexts, and other participants cannot receive them.");

  await clickNav(page, "Auction room", "room");
  await act(host, { type: "select_player", playerId: ids[0] });
  await targetNotice(page, candidates[0]);
  await observedVersion(rivalBrowser.page, rival, (await read(rival)).version);
  await noNotice(rivalBrowser.page);
  await dismiss(page);
  const active = await act(host, { type: "start" });
  await observedVersion(page, owner, active.version);
  await noNotice(page);
  await observedVersion(page, owner, active.version);
  await noNotice(page);
  await clickNav(page, "My Target Picks", "targets");
  const beforeMidAuctionSave = financials(await read(owner));
  for (const player of candidates.slice(5, 9)) await target(page, player);
  saved = await save(page);
  assert.deepEqual(saved.myTargetPicks.playerIds, ids.slice(0, 9));
  assert.deepEqual(financials(saved), beforeMidAuctionSave);
  await act(host, { type: "lock" });
  await act(host, { type: "unsold" });
  for (const player of candidates.slice(9, 12)) await target(page, player);
  saved = await save(page);
  assert.deepEqual(saved.myTargetPicks.playerIds, ids.slice(0, 12));
  await targetList(page).getByRole("button", { name: `Remove ${candidates[11].name} from targets`, exact: true }).click();
  saved = await save(page);
  assert.deepEqual(saved.myTargetPicks.playerIds, ids.slice(0, 11));
  await clickNav(page, "Auction room", "room");
  await act(host, { type: "select_player", playerId: ids[11] });
  await observedVersion(page, owner, (await read(owner)).version);
  await noNotice(page);
  console.log("PASS: five targets can be extended by four during live bidding and three later; removing a saved target prevents its personal notice, and dismissed notices do not replay on polls.");

  await clickNav(page, "My Squad", "my-squad");
  await act(host, { type: "select_player", playerId: ids[0] });
  let notice = await targetNotice(page, candidates[0]);
  assert.equal(new URL(page.url()).searchParams.get("view"), "my-squad", "a target notice must not redirect the manager automatically");
  await notice.getByRole("button", { name: "View auction", exact: true }).click();
  await page.locator(".app-shell.tab-room").waitFor();
  await noNotice(page);
  await clickNav(page, "My Target Picks", "targets");
  await target(page, candidates[12]);
  await assertSelected(page, [...ids.slice(0, 11), ids[12]]);
  await clickNav(page, "Auction room", "room");
  const unsavedTargetLot = await act(host, { type: "select_player", playerId: ids[12] });
  await observedVersion(page, owner, unsavedTargetLot.version);
  await noNotice(page);
  assert.equal(await page.locator(".my-target-lot-badge").count(), 0, "an unsaved target must not receive a personal alert or target badge");
  await clickNav(page, "My Target Picks", "targets");
  await assertSelected(page, [...ids.slice(0, 11), ids[12]]);
  await act(host, { type: "select_player", playerId: ids[1] });
  notice = await targetNotice(page, candidates[1]);
  await notice.getByRole("button", { name: "View auction", exact: true }).click();
  await clickNav(page, "My Target Picks", "targets");
  await assertSelected(page, [...ids.slice(0, 11), ids[12]]);
  assert.deepEqual((await read(owner)).myTargetPicks.playerIds, ids.slice(0, 11), "a notice and page changes must neither save nor erase a target draft");
  await page.getByRole("button", { name: "How it works", exact: true }).click();
  const help = page.getByRole("dialog", { name: "How it works", exact: true });
  await help.waitFor();
  const duringDialog = await act(host, { type: "select_player", playerId: ids[2] });
  await observedVersion(page, owner, duringDialog.version);
  await noNotice(page);
  await help.getByRole("button", { name: "Close how it works", exact: true }).click();
  await targetNotice(page, candidates[2]);
  await dismiss(page);
  console.log("PASS: targeted players alert on Auction room and My Squad, repeated nominations work, notices queue behind dialogs, and opening the auction preserves an unsaved target draft.");

  const concurrent = await openMember(owner);
  await pool(concurrent.page).waitFor();
  await target(concurrent.page, candidates[13]);
  const changed = await save(page);
  await observedVersion(concurrent.page, owner, changed.version);
  await assertSelected(concurrent.page, [...ids.slice(0, 11), ids[13]]);
  assert.equal(await concurrent.page.getByRole("button", { name: "Save targets", exact: true }).isDisabled(), true, "a stale dirty tab must not overwrite a newer target list");
  await concurrent.page.getByRole("button", { name: "Reload saved targets", exact: true }).click();
  await assertSelected(concurrent.page, [...ids.slice(0, 11), ids[12]]);
  await concurrent.context.close();
  await clickNav(rivalBrowser.page, "My Target Picks", "targets");
  await assertSelected(rivalBrowser.page, []);
  await rivalBrowser.context.close();
  console.log("PASS: concurrent edits are revision-protected; reloading the saved list explicitly resolves a conflict and another manager's target page stays empty.");

  await page.bringToFront();
  await page.getByRole("searchbox", { name: "Search target players", exact: true }).fill("");
  for (const width of [360, 390, 768, 1051, 1100, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await paint(page);
    await noOverflow(page);
    await clickNav(page, "My Squad", "my-squad");
    await clickNav(page, "My Target Picks", "targets");
    await assertSelected(page, [...ids.slice(0, 11), ids[12]]);
    if ([390, 1440].includes(width)) await screenshot(page, `target-picks-${width}.png`);
    await page.getByRole("button", { name: "How it works", exact: true }).click();
    await help.waitFor();
    assert.doesNotMatch(await help.innerText(), /This is an independent mock auction|Original stadium art|Fan-made\. Game-ready/i);
    await help.getByRole("button", { name: "Close how it works", exact: true }).waitFor();
    await noOverflow(page);
    const box = await help.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= page.viewportSize().height + 1, "How it works must fit the viewport");
    if ([390, 1440].includes(width)) await screenshot(page, `how-it-works-${width}.png`, false);
    await help.getByRole("button", { name: "Ready to play", exact: true }).click();
    await help.waitFor({ state: "detached" });
    console.log(`PASS: target picks and help at ${width}px.`);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: target selection and the redesigned How it works dialog remain usable at 360/390/768/1051/1100/1280/1440px, with no horizontal overflow or browser errors.");
} finally {
  await browser.close();
}
