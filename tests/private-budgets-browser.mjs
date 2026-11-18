import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Only the isolated runner may run budget browser tests.");
const base = process.env.BASE_URL;
assert.ok(base);
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
const errors = [];
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = await response.json();
  assert.ok(response.ok, `${response.status}: ${value.error}`);
  return value;
};
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } }).then(value => value.state);
const read = member => request(pathFor(member), { token: member.token }).then(value => value.state);
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
  return { page, context };
};
const nav = (page, name) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name });
const clickNav = async (page, name, tab) => {
  await page.bringToFront();
  if (!await nav(page, name).isVisible()) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await nav(page, name).click();
  if (tab) await page.locator(`.app-shell.tab-${tab}`).waitFor();
};
const target = async (page, player) => {
  await page.getByRole("searchbox", { name: "Search target players", exact: true }).fill(player.name);
  await page.getByRole("region", { name: "Player pool for targeting", exact: true }).getByRole("checkbox", { name: `Target ${player.name}`, exact: true }).click();
};
const input = (page, player) => page.getByRole("textbox", { name: `Private limit for ${player.name} in crores`, exact: true });
const save = async page => {
  const received = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/action") && response.request().postDataJSON()?.action?.type === "set_target_picks");
  await page.getByRole("button", { name: "Save targets", exact: true }).click();
  const response = await received;
  assert.equal(response.status(), 200, await response.text());
  return (await response.json()).state;
};
const refreshState = async (page, member, version) => {
  const received = page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || new URL(response.url()).pathname !== pathFor(member) || !response.ok()) return false;
    try { const data = await response.json(); return (data.state?.version ?? data.version ?? -1) >= version; } catch { return false; }
  });
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await received;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${page.viewportSize().width}px overflow`);
const dismissNotice = async page => {
  const close = page.getByRole("button", { name: "Dismiss player notification", exact: true });
  if (await close.isVisible()) await close.click();
};

try {
  const host = await request("/api/rooms", { body: { name: "Private budgets browser", hostName: "Budget host" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, teamId, teamPassword } });
  const owner = await join("Budget RCB manager", "rcb");
  const rival = await join("Budget MI manager", "mi");
  const [player, other] = host.state.players.filter(entry => entry.status === "available" && !entry.catalogArchived && entry.eligibilityVerified !== false && entry.basePrice <= 200);
  assert.ok(player && other);
  const { page, context } = await openMember(owner);
  await target(page, player);
  await target(page, other);
  await input(page, player).fill("7.13");
  await input(page, other).fill("100");
  assert.match(await page.getByRole("region", { name: "Private budget plan" }).innerText(), /over your remaining purse/);
  let state = await save(page);
  assert.deepEqual(state.myTargetPicks.maxBids, { [player.id]: 713, [other.id]: 10000 });
  assert.equal((await read(host)).myTargetPicks, undefined);
  assert.deepEqual((await read(rival)).myTargetPicks.maxBids ?? {}, {});
  await page.reload();
  await input(page, player).waitFor();
  assert.equal(await input(page, player).inputValue(), "7.13");
  console.log("PASS: private budgets save in whole lakhs, survive reload, show overallocation and remain absent from host/rival snapshots.");

  await input(page, player).fill("broken");
  assert.equal(await page.getByRole("button", { name: "Save targets", exact: true }).isDisabled(), true);
  await clickNav(page, "My Squad", "my-squad");
  const chatState = await act(rival, { type: "chat", text: "Budget draft should stay intact" });
  await refreshState(page, owner, chatState.version);
  await clickNav(page, "My Target Picks", "targets");
  assert.equal(await input(page, player).inputValue(), "broken");
  assert.equal(await input(page, player).getAttribute("aria-invalid"), "true");
  await input(page, player).fill("0.01");
  assert.match(await page.locator(`.target-shortlist li[data-player-id="${player.id}"]`).innerText(), /Below base price/);
  await input(page, player).fill("7.13");
  await input(page, other).fill("");
  state = await save(page);
  assert.deepEqual(state.myTargetPicks.maxBids, { [player.id]: 713 });
  assert.match(await page.getByRole("region", { name: "Private budget plan" }).innerText(), /1 remaining target without a limit/);
  console.log("PASS: invalid drafts survive navigation and polling, below-base limits are explained, and clearing a limit removes it without removing the target.");

  const second = await openMember(owner);
  await input(second.page, player).fill("8.88");
  await page.bringToFront();
  await input(page, player).fill("8.13");
  state = await save(page);
  await refreshState(second.page, owner, state.version);
  assert.equal(await input(second.page, player).inputValue(), "8.88");
  assert.equal(await second.page.getByRole("button", { name: "Save targets", exact: true }).isDisabled(), true);
  await second.page.getByRole("button", { name: "Reload saved targets", exact: true }).click();
  assert.equal(await input(second.page, player).inputValue(), "8.13");
  await second.context.close();
  await page.bringToFront();
  await page.getByRole("button", { name: `Remove ${other.name} from targets`, exact: true }).click();
  await input(page, player).fill("7.13");
  state = await save(page);
  assert.deepEqual(state.myTargetPicks.playerIds, [player.id]);
  assert.deepEqual(state.myTargetPicks.maxBids, { [player.id]: 713 });
  console.log("PASS: budget-only edits are revision-protected and removing a target keeps the submitted budget map aligned.");

  await act(host, { type: "select_player", playerId: player.id });
  await act(host, { type: "start" });
  await clickNav(page, "My Squad", "my-squad");
  state = await act(rival, { type: "bid", expectedAmount: player.basePrice, expectedPlayerId: player.id, customAmount: 725 });
  await refreshState(page, owner, state.version);
  let warning = page.getByRole("status", { name: "Your private bidding budget" });
  await warning.waitFor();
  assert.match(await warning.innerText(), /above your limit/);
  await dismissNotice(page);
  await warning.getByRole("button", { name: "View auction", exact: true }).click();
  await page.locator(".app-shell.tab-room").waitFor();
  warning = page.getByRole("status", { name: "Your private bidding budget" });
  assert.match(await warning.innerText(), /7\.13/);
  const ownBid = page.locator(".custom-bid");
  await ownBid.getByRole("textbox", { name: "Custom bid in crore" }).fill("8.25");
  const bidResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/action") && response.request().postDataJSON()?.action?.type === "bid");
  await ownBid.getByRole("button", { name: "Bid ₹8.25 Cr", exact: true }).click();
  assert.equal((await bidResponse).status(), 200);
  await warning.getByText(/above your limit/).waitFor();
  const rivalBrowser = await openMember(rival, "room");
  const hostBrowser = await openMember(host, "room");
  assert.equal(await rivalBrowser.page.locator(".private-bid-budget").count(), 0);
  assert.equal(await hostBrowser.page.locator(".private-bid-budget").count(), 0);
  await rivalBrowser.context.close();
  await hostBrowser.context.close();
  console.log("PASS: saved-limit warnings follow the owner across pages, remain private, and never block an intentional above-plan bid.");

  await act(host, { type: "lock" });
  state = await act(host, { type: "sell" });
  await refreshState(page, owner, state.version);
  assert.equal(await page.locator(".private-bid-budget").count(), 0);
  await clickNav(page, "My Target Picks", "targets");
  assert.equal(await input(page, player).isDisabled(), true);
  assert.match(await page.locator(`.target-shortlist li[data-player-id="${player.id}"]`).innerText(), /Excluded from your remaining plan/);
  assert.match(await page.getByRole("region", { name: "Private budget plan" }).innerText(), /Planned limits\s*₹0 L/);
  await target(page, other);
  await input(page, other).fill("2.25");
  await save(page);

  for (const width of [360, 390, 768, 1051, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await noOverflow(page);
    await input(page, other).scrollIntoViewIfNeeded();
    const bounds = await input(page, other).boundingBox();
    assert.ok(bounds && bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    if ([390, 1440].includes(width)) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(screenshots, `private-budgets-${width}.png`), fullPage: true });
    }
  }
  const endState = await read(host);
  state = await act(host, { type: "end_auction", expectedResultsRevision: endState.resultsRevision ?? 0 });
  await refreshState(page, owner, state.version);
  assert.equal(await input(page, other).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Save targets", exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS: sold targets leave the remaining plan, ended rooms are read-only, and 360–1440px layouts have usable inputs without horizontal overflow.");
} finally {
  await browser.close();
}
