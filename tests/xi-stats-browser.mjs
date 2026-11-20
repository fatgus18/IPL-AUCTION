import { navigateTo } from "./browser-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated API runner; never change a user's auction.");
const base = process.env.BASE_URL;
assert.ok(base);
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const errors = [];
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
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
const read = member => request(pathFor(member), { token: member.token }).then(value => value.state);
const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const assertStats = async (container, player) => {
  for (const key of ["matches", "runs", "wickets", "strikeRate"]) {
    assert.equal(await container.locator(`[data-stat="${key}"] dd`).innerText(), player.stats[key] === null ? "—" : numberFormat.format(player.stats[key]));
  }
  if (player.statsFormat !== "Unknown") assert.equal(await container.locator("header b").innerText(), player.statsFormat);
};
const insideViewport = async page => {
  const bounds = await page.locator(".lineup-stats-popup[data-open]").boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, "stats stay inside the viewport");
};
const openMember = async (member, mobile = false) => {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const access = { code: member.state.code, token: member.token, memberId: member.memberId };
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), access);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${access.code}&view=build-xi`);
  await page.locator(".lineup-builder:visible").waitFor();
  return { context, page };
};

try {
  const host = await request("/api/rooms", { body: { name: "XI hover statistics", hostName: "Stats auctioneer" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const owner = await request(`${pathFor(host)}/join`, { body: { name: "Stats manager", teamId: "rcb", teamPassword } });
  const players = [
    host.state.players.find(player => player.name === "Abhishek Sharma"),
    host.state.players.find(player => player.statsFormat === "T20I" && player.eligibilityVerified !== false),
    host.state.players.find(player => Object.values(player.stats).every(value => value === null) && player.eligibilityVerified !== false),
  ];
  assert.ok(players.every(Boolean), "test IPL, T20I, and unavailable statistics using actual catalog entries");
  for (const player of players) {
    await act(host, { type: "select_player", playerId: player.id });
    await act(host, { type: "start" });
    await act(owner, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice });
    await act(host, { type: "lock" });
    await act(host, { type: "sell" });
  }
  const playingXI = Array(11).fill(null);
  playingXI[0] = players[0].id;
  playingXI[10] = players[1].id;
  const substitutes = [null, null, null, null, players[2].id];
  await act(owner, { type: "set_lineup", teamId: "rcb", lineup: { playingXI, substitutes, captainId: players[0].id, viceCaptainId: players[1].id }, expectedRevision: 0 });
  const before = await read(owner);
  const { page } = await openMember(owner);
  const first = page.getByRole("button", { name: "Change player at XI position 1", exact: true });
  const last = page.getByRole("button", { name: "Change player at XI position 11", exact: true });
  const sub = page.getByRole("button", { name: "Change player at substitute position 5", exact: true });
  const popup = page.locator(".lineup-stats-popup[data-open]");

  await first.hover();
  await popup.waitFor();
  await assertStats(popup, players[0]);
  assert.equal(await popup.locator("header > strong").innerText(), players[0].name);
  await insideViewport(page);
  await popup.hover();
  await page.waitForTimeout(250);
  assert.ok(await popup.isVisible(), "the pointer may move into the stats card without dismissing it");
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "hidden" });
  console.log("PASS: hovering an XI portrait shows actual IPL stats, remains open under the pointer, and Escape dismisses it.");

  await first.focus();
  // Escape keeps that trigger dismissed until focus leaves and returns.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await popup.waitFor();
  assert.equal(await popup.getAttribute("role"), "tooltip");
  const descriptionId = await first.getAttribute("aria-describedby");
  assert.ok(descriptionId, "the focused portrait has an accessible description");
  assert.equal(descriptionId, await popup.getAttribute("id"), "keyboard focus receives an accessible statistics description");
  await assertStats(popup, players[0]);
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "hidden" });
  await last.hover();
  await popup.waitFor();
  await assertStats(popup, players[1]);
  await insideViewport(page);
  await page.screenshot({ path: resolve(screenshots, "xi-stats-desktop.png") });
  await sub.hover();
  await popup.waitFor();
  await popup.getByText("Statistics not available", { exact: true }).waitFor();
  await assertStats(popup, players[2]);
  assert.equal(await popup.locator("header b").count(), 0, "unknown format is never mislabeled IPL");
  await insideViewport(page);
  console.log("PASS: keyboard focus exposes the same stats, T20I stays correctly labeled, and bench players with no statistics show — instead of fabricated zeroes.");

  await first.click();
  await page.locator(".lineup-picker[open]").waitFor();
  await popup.waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await page.locator(".lineup-picker[open]").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: `Manage ${players[0].name}`, exact: true }).click();
  await page.getByRole("button", { name: `Remove ${players[0].name} from playing XI`, exact: true }).click();
  await page.getByRole("button", { name: "Choose player for XI position 7", exact: true }).click();
  await page.getByRole("button", { name: `Select ${players[0].name}`, exact: true }).click();
  await page.locator(".lineup-picker[open]").waitFor({ state: "hidden" });
  const seventh = page.getByRole("button", { name: "Change player at XI position 7", exact: true });
  assert.ok(await seventh.evaluate(element => element === document.activeElement), "filling an empty slot preserves picker focus restoration");
  await seventh.hover();
  await popup.waitFor();
  await navigateTo(page, "My Squad");
  await popup.waitFor({ state: "hidden" });
  console.log("PASS: stats preserve picker focus when filling an empty slot, do not obstruct selections, and disappear after leaving Build my XI.");

  const { page: touchPage } = await openMember(owner, true);
  await touchPage.getByRole("button", { name: `Manage ${players[0].name}`, exact: true }).tap();
  const inspector = touchPage.getByRole("region", { name: "Selected position", exact: true });
  await assertStats(inspector.locator(".lineup-player-stats"), players[0]);
  const bounds = await inspector.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, "mobile controls remain in the viewport");
  assert.equal(await touchPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await touchPage.screenshot({ path: resolve(screenshots, "xi-stats-touch-390.png") });
  await touchPage.getByRole("button", { name: "Close player controls", exact: true }).tap();
  const after = await read(owner);
  assert.deepEqual(after.teams, before.teams, "viewing stats must not alter the lineup, purse, or squad");
  assert.deepEqual(errors, []);
  console.log("PASS: touch users see the same metrics through Manage; no lineup or auction finances changed, and no browser errors occurred.");
} finally {
  await browser.close();
}
