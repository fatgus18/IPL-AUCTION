import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run only with the isolated API runner; never modify a user's room.");
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
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const nav = (page, name) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name });
const clickNav = async (page, name) => {
  if (!await nav(page, name).isVisible()) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await nav(page, name).click();
};
const openMember = async (member, view) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const access = { code: member.state.code, token: member.token, memberId: member.memberId };
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), access);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${access.code}&view=${view}`);
  await page.locator(".app-shell.in-auction").waitFor();
  return { context, page };
};
const roles = container => container.locator("[data-playing-role]").evaluateAll(elements => Object.fromEntries(elements.map(element => [element.dataset.playingRole, Number(element.dataset.count)])));
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);

try {
  const host = await request("/api/rooms", { body: { name: "Separated squads and XI", hostName: "Gallery auctioneer" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const owner = await request(`${pathFor(host)}/join`, { body: { name: "Gallery manager", teamId: "rcb", teamPassword } });
  const rival = await request(`${pathFor(host)}/join`, { body: { name: "Another manager", teamId: "mi", teamPassword } });
  const purchases = ["Marco Jansen", "Sanju Samson", "Virat Kohli"].map(name => host.state.players.find(player => player.name === name));
  assert.ok(purchases.every(Boolean), "The role regression uses the actual named catalog players.");
  assert.ok(purchases.every(player => player.role === "Marquee"), "These players must be Marquee auction entries to reproduce the counter defect.");
  const expectedRoles = { Batter: 1, Bowler: 0, "All-rounder": 1, Wicketkeeper: 1 };
  const { page } = await openMember(owner, "my-squad");
  await page.getByRole("heading", { name: "Your first signing starts here.", exact: true }).waitFor();
  for (const player of purchases) {
    await act(host, { type: "select_player", playerId: player.id });
    await act(host, { type: "start" });
    await act(owner, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice });
    await act(host, { type: "lock" });
    await act(host, { type: "sell" });
    await page.bringToFront();
    await page.locator(".personal-squad-player").filter({ has: page.getByRole("heading", { name: player.name, exact: true }) }).waitFor();
  }
  const counters = page.locator(".personal-squad-categories");
  assert.deepEqual(await roles(counters), expectedRoles);
  assert.equal(await counters.getByText("Marquee", { exact: true }).count(), 0, "the auction set must not replace the actual playing role");
  assert.equal(await page.locator(".personal-squad-player").count(), 3);
  assert.equal(await page.locator(".lineup-builder:visible").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save lineup", exact: true }).count(), 0);
  for (const [role, player] of [["All-rounder", purchases[0]], ["Wicketkeeper", purchases[1]], ["Batter", purchases[2]]]) {
    await counters.locator(`[data-playing-role="${role}"]`).click();
    assert.equal(await page.locator(".personal-squad-player").count(), 1);
    assert.equal(await page.locator(".personal-squad-player h4").innerText(), player.name);
    assert.deepEqual(await roles(counters), expectedRoles, "filtering must not recalculate role counts from the filtered subset");
  }
  await counters.locator('[data-playing-role="Bowler"]').click();
  assert.equal(await page.locator(".personal-squad-player").count(), 0);
  await page.getByRole("button", { name: "Show all players", exact: true }).click();
  assert.equal(await page.locator(".personal-squad-player").count(), 3);
  await counters.getByRole("button", { name: "All players 3", exact: true }).click();
  await page.locator(".personal-squad-roster img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".cinematic-sale").waitFor({ state: "hidden" });
  await page.screenshot({ path: resolve(screenshots, "my-squad-playing-roles-1440.png"), fullPage: true });
  console.log("PASS: actual Marquee purchases update All-rounder/Wicketkeeper/Batter counts live; My Squad remains a photo gallery with independent role filters.");

  await clickNav(page, "Team squads");
  const team = owner.state.teams.find(team => team.id === "rcb");
  await page.getByRole("button", { name: `View ${team.name} squad`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: team.name, exact: true });
  await dialog.waitFor();
  assert.deepEqual(await roles(dialog.locator(".squad-detail-roles")), expectedRoles);
  assert.equal(await dialog.locator(".squad-detail-player").count(), 3);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  const { context: rivalContext, page: rivalPage } = await openMember(rival, "my-squad");
  await rivalPage.getByRole("heading", { name: "Your first signing starts here.", exact: true }).waitFor();
  assert.equal(await rivalPage.locator(".personal-squad-player").count(), 0, "another franchise must never inherit this roster");
  await rivalContext.close();
  console.log("PASS: the Team squads detail dialog has the same role totals while each manager's personal gallery remains private to their own franchise.");

  await clickNav(page, "Build my XI");
  await page.locator(".lineup-builder:visible").waitFor();
  assert.equal(await page.locator(".personal-squad:visible").count(), 0);
  const seventh = page.locator(".lineup-xi-slots .lineup-slot").nth(6);
  await seventh.locator(".lineup-slot-pick").click();
  await page.getByRole("button", { name: "Select Marco Jansen", exact: true }).click();
  assert.equal(await seventh.getAttribute("data-player-id"), purchases[0].id);
  await clickNav(page, "My Squad");
  assert.equal(await page.locator(".lineup-builder:visible").count(), 0);
  assert.equal(await page.locator(".personal-squad-player").count(), 3);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await noOverflow(page);
    await clickNav(page, "Build my XI");
    await noOverflow(page);
    assert.equal(await seventh.getAttribute("data-player-id"), purchases[0].id, "a draft survives visits to the separate squad gallery");
    await clickNav(page, "My Squad");
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(screenshots, "my-squad-playing-roles-390.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: My Squad and Build my XI are separate pages; a sparse draft survives cross-page navigation at 360/390/768/1440px without overflow or browser errors.");
} finally {
  await browser.close();
}
