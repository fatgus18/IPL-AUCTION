import { navigateTo } from "./browser-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run poster browser checks with an isolated database.");
const base = process.env.BASE_URL;
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const request = async (path, token, body) => {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: base }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const data = await response.json(); assert.ok(response.ok, `${response.status}: ${data.error}`); return data;
};
let host;
const errors = [];
const output = resolve(".sites-runtime/screenshots"); await mkdir(output, { recursive: true });
try {
  host = await request("/api/rooms", undefined, { name: "Franchise poster browser QA", hostName: "Poster host" });
  const room = `/api/rooms/${host.state.code}`;
  const access = await request(`${room}/access`, host.token, {});
  const manager = await request(`${room}/join`, undefined, { name: "Franchise manager", teamId: "rcb", teamPassword: access.teamPassword });
  const act = (member, action) => request(`${room}/action`, member.token, { action }).then(result => result.state);
  const players = host.state.players.filter(player => !player.isOverseas && player.eligibilityVerified !== false).slice(0, 2);
  let state;
  for (const player of players) {
    await act(host, { type: "select_player", playerId: player.id }); await act(host, { type: "start" });
    await act(manager, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice });
    await act(host, { type: "lock" }); state = await act(host, { type: "sell" });
  }
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: [players[0].id, null, null, null, null, null, players[1].id], substitutes: [], captainId: players[0].id, viceCaptainId: players[1].id } });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  await context.addInitScript(member => localStorage.setItem(`pavilion-session-${member.state.code}`, JSON.stringify({ code: member.state.code, token: member.token, memberId: member.memberId })), manager);
  const page = await context.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message));
  let posterRequests = 0; page.on("request", request => { if (new URL(request.url()).pathname.endsWith("/poster")) posterRequests++; });
  await page.goto(`${base}/?room=${host.state.code}&view=my-squad`); await page.locator(".app-shell.tab-my-squad").waitFor(); await page.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  assert.equal(await page.locator(".franchise-posters").count(), 0, "do not offer poster generation during bidding");
  await act(host, { type: "end_auction", expectedResultsRevision: state.resultsRevision });
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.getByRole("button", { name: "Generate squad poster", exact: true }).waitFor();
  assert.equal(posterRequests, 0, "there must be no eager rendering request");
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/poster"), { timeout: 60000 });
  await page.getByRole("button", { name: "Generate squad poster", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Preparing poster…", exact: true }).isDisabled());
  assert.equal((await responsePromise).status(), 200);
  const downloadLink = page.getByRole("link", { name: "Download PNG", exact: true }); await downloadLink.waitFor();
  assert.equal(posterRequests, 1); assert.ok(await page.getByRole("link", { name: "Open Royal Challengers Bengaluru squad poster at full size", exact: true }).isVisible());
  const downloadPromise = page.waitForEvent("download"); await downloadLink.click(); const download = await downloadPromise;
  const metadata = await sharp(await readFile(await download.path())).metadata(); assert.equal(metadata.width, 1440); assert.equal(metadata.height, 1800);
  const oldUrl = await downloadLink.getAttribute("href");
  await navigateTo(page, /Player pool/); await page.locator(".app-shell.tab-players").waitFor();
  await navigateTo(page, "My Squad"); await page.locator(".app-shell.tab-my-squad").waitFor(); await downloadLink.waitFor();
  await page.waitForFunction(old => document.querySelector('.franchise-poster-actions a[download]')?.getAttribute("href") !== old, oldUrl);
  assert.equal(await page.evaluate(async url => (await fetch(url)).status, await downloadLink.getAttribute("href")), 200, "restoring a retained page recreates its image URL");
  assert.equal(posterRequests, 1, "restoring a generated poster does not rerender it on the server");
  await page.locator(".franchise-posters:visible").screenshot({ path: resolve(output, "franchise-poster-panel-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator(".franchise-posters:visible").scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "poster panel fits mobile viewport");
  for (const control of await page.locator(".franchise-posters:visible button, .franchise-posters:visible select, .franchise-posters:visible .franchise-poster-actions a").all()) {
    const bounds = await control.boundingBox(); assert.ok(bounds && bounds.height >= 44, "poster controls stay touch accessible");
  }
  await page.locator(".franchise-posters:visible").screenshot({ path: resolve(output, "franchise-poster-panel-mobile.png") });
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 1, lineup: { playingXI: [players[0].id, null, null, null, null, null, players[1].id], substitutes: [], captainId: players[1].id, viceCaptainId: players[0].id } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.getByRole("button", { name: "Generate squad poster", exact: true }).waitFor();
  assert.equal(await downloadLink.count(), 0, "saved captaincy changes invalidate an old poster");
  assert.equal(posterRequests, 1, "changing a lineup must not trigger background generation");
  await page.goto(`${base}/?room=${host.state.code}&view=room`); await page.locator(".auction-recap").waitFor();
  await page.locator(".auction-recap .franchise-posters").waitFor();
  assert.equal(posterRequests, 1, "recap entry also waits for explicit generation");
  assert.deepEqual(errors, []);
  console.log("Franchise posters browser: hidden before end, explicit generation, real PNG download, preview invalidation, recap/My Squad entries, mobile layout and touch targets passed.");
  await context.close();
} finally {
  await browser.close();
  if (host) await request(`/api/rooms/${host.state.code}/delete`, host.token, { confirmationCode: host.state.code });
}
