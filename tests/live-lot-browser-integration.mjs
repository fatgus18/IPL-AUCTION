import { navigateTo } from "./browser-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run only through the isolated API runner; never mutate a user's auction.");
assert.ok(process.env.DATABASE_URL?.startsWith("file:"), "The isolated runner must supply its temporary database.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
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
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } }).then(value => value.state);
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const observedVersion = async (page, member, version) => {
  await page.bringToFront();
  await page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || new URL(response.url()).pathname !== pathFor(member) || !response.ok()) return false;
    try {
      const value = await response.json();
      return (value.state?.version ?? value.version ?? -1) >= version;
    } catch { return false; }
  }, { timeout: 20000 });
  await paint(page);
};
const openMember = async (member, view = "room") => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const access = { code: member.state.code, token: member.token, memberId: member.memberId };
  await context.addInitScript(access => {
    localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access));
    localStorage.setItem("pavilion-active-room", access.code);
  }, access);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${access.code}&view=${view}`);
  await page.locator(`.app-shell.in-auction.tab-${view}`).waitFor();
  await page.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  return { page, context };
};
const clickNav = async (page, name, view) => {
  await navigateTo(page, name);
  await page.locator(`.app-shell.tab-${view}`).waitFor();
};
const noNotice = async page => assert.equal(await page.locator(".new-lot-notice").count(), 0);
const noticeFor = async (page, player) => {
  const notice = page.locator(".new-lot-notice");
  await notice.filter({ hasText: player.name }).waitFor();
  assert.equal(await notice.count(), 1, "only the current player gets one notification");
  await notice.getByRole("button", { name: "View auction", exact: true }).waitFor();
  return notice;
};
const noOverflow = async page => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
};
const assertLive = async (page, phase) => {
  await page.bringToFront();
  const card = page.locator(`.player-card.phase-${phase}`);
  await card.waitFor();
  const badge = card.locator(".live-lot-status");
  await badge.getByText("LIVE", { exact: true }).waitFor();
  const colour = await badge.getByText("LIVE", { exact: true }).evaluate(element => getComputedStyle(element).color);
  const channels = colour.match(/[\d.]+/g)?.map(Number);
  assert.ok(channels?.length >= 3 && channels[0] > channels[1] + 30 && channels[0] > channels[2] + 30, `The LIVE label must be clearly red, got ${colour}`);
};

try {
  const host = await request("/api/rooms", { body: { name: "Live lot notification check", hostName: "Live lot auctioneer" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const owner = await request(`${pathFor(host)}/join`, { body: { name: "Live lot manager", teamId: "rcb", teamPassword } });
  const players = host.state.players.filter(player => player.status === "available" && player.eligibilityVerified !== false).slice(0, 5);
  assert.equal(players.length, 5);
  const [first, second, third, fourth, fifth] = players;
  const hostBrowser = await openMember(host);
  const ownerBrowser = await openMember(owner, "my-squad");
  const hostPage = hostBrowser.page;
  const ownerPage = ownerBrowser.page;
  await noNotice(ownerPage);
  assert.equal(await hostPage.locator(".live-lot-status").getByText("LIVE", { exact: true }).count(), 0, "an empty room is not a live player");

  await act(host, { type: "select_player", playerId: first.id });
  await noticeFor(ownerPage, first);
  assert.equal(new URL(ownerPage.url()).searchParams.get("view"), "my-squad", "notification must not interrupt the participant's page");
  await assertLive(hostPage, "waiting");
  await noNotice(hostPage);
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: "Dismiss player notification", exact: true }).click();
  await noNotice(ownerPage);

  await act(host, { type: "start" });
  await assertLive(hostPage, "live");
  let state = await act(owner, { type: "bid", expectedAmount: first.basePrice, expectedPlayerId: first.id });
  await observedVersion(ownerPage, owner, state.version);
  await noNotice(ownerPage);
  await observedVersion(ownerPage, owner, state.version);
  await noNotice(ownerPage);
  await act(host, { type: "pause" });
  await assertLive(hostPage, "paused");
  await act(host, { type: "resume" });
  await assertLive(hostPage, "live");
  await act(host, { type: "lock" });
  await assertLive(hostPage, "locked");
  await act(host, { type: "sell" });
  await hostPage.locator(".player-card.phase-sold").waitFor();
  assert.equal(await hostPage.locator(".live-lot-status").getByText("LIVE", { exact: true }).count(), 0, "a sold player is no longer LIVE");
  console.log("PASS: selected players have a red LIVE label before bidding and through live, paused and locked phases; sales remove it. Dismissed notices stay dismissed through bids and unchanged polls.");

  await ownerPage.bringToFront();
  await clickNav(ownerPage, "Player pool", "players");
  await act(host, { type: "select_player", playerId: second.id });
  await noticeFor(ownerPage, second);
  await act(host, { type: "select_player", playerId: third.id });
  const thirdNotice = await noticeFor(ownerPage, third);
  assert.ok(!(await thirdNotice.innerText()).includes(second.name), "new selection replaces the previous notification");
  await act(host, { type: "start" });
  await act(host, { type: "lock" });
  state = await act(host, { type: "unsold" });
  await observedVersion(ownerPage, owner, state.version);
  await noNotice(ownerPage);
  await hostPage.bringToFront();
  await hostPage.locator(".player-card.phase-unsold").waitFor();
  assert.equal(await hostPage.locator(".live-lot-status").getByText("LIVE", { exact: true }).count(), 0);

  await ownerPage.bringToFront();
  await clickNav(ownerPage, "Team squads", "squads");
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await act(host, { type: "select_player", playerId: third.id });
  const mobileNotice = await noticeFor(ownerPage, third);
  await noOverflow(ownerPage);
  assert.equal(await mobileNotice.evaluate(element => element.scrollWidth > element.clientWidth), false);
  await ownerPage.evaluate(() => document.fonts.ready);
  await ownerPage.screenshot({ path: resolve(screenshots, "live-lot-notice-390.png") });
  await mobileNotice.getByRole("button", { name: "View auction", exact: true }).click();
  await ownerPage.locator(".app-shell.tab-room").waitFor();
  await assertLive(ownerPage, "waiting");
  await noNotice(ownerPage);
  await noOverflow(ownerPage);
  await clickNav(ownerPage, "Room settings", "settings");
  await noNotice(ownerPage);
  console.log("PASS: pool and squad pages receive one current-player notification, settled notices disappear, same-player reselection creates a new notice, and the mobile View auction button navigates without horizontal overflow.");

  await ownerPage.setViewportSize({ width: 1440, height: 1000 });
  await act(host, { type: "select_player", playerId: fourth.id });
  await noticeFor(ownerPage, fourth);
  await ownerPage.evaluate(() => document.fonts.ready);
  await ownerPage.screenshot({ path: resolve(screenshots, "live-lot-notice-1440.png") });
  await ownerPage.reload();
  await ownerPage.locator(".app-shell.tab-settings").waitFor();
  await ownerPage.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  await noNotice(ownerPage);
  await clickNav(ownerPage, "Auction room", "room");
  await assertLive(ownerPage, "waiting");
  await ownerBrowser.context.setOffline(true);
  await ownerPage.locator(".connection.offline").waitFor();
  assert.equal(await ownerPage.locator(".live-lot-status").getByText("LIVE", { exact: true }).count(), 0, "disconnected snapshots must not claim to be LIVE");
  await ownerBrowser.context.setOffline(false);
  await ownerPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await ownerPage.locator(".connection:not(.offline)").waitFor();
  await assertLive(ownerPage, "waiting");
  await clickNav(ownerPage, "Player pool", "players");
  await noNotice(ownerPage);

  const spectator = await request(`${pathFor(host)}/join`, { body: { name: "Late live lot spectator" } });
  const spectatorBrowser = await openMember(spectator, "squads");
  await noNotice(spectatorBrowser.page);
  await act(host, { type: "select_player", playerId: fifth.id });
  await noticeFor(spectatorBrowser.page, fifth);
  await ownerPage.bringToFront();
  await noticeFor(ownerPage, fifth);
  await act(host, { type: "start" });
  await act(owner, { type: "bid", expectedAmount: fifth.basePrice, expectedPlayerId: fifth.id });
  await act(host, { type: "lock" });
  state = await act(host, { type: "sell" });
  await observedVersion(ownerPage, owner, state.version);
  await noNotice(ownerPage);
  console.log("PASS: settings pages and spectators receive new selections; reload and late joins do not replay old selections; leaving the auction page does not invent a notice; connection loss suppresses LIVE and reconnect restores it.");

  await ownerPage.getByRole("button", { name: /Open sound settings/ }).click();
  const soundPanel = ownerPage.getByRole("region", { name: "Auction sound settings", exact: true });
  await soundPanel.waitFor();
  assert.doesNotMatch(await soundPanel.innerText(), /crack of the bat|fall of the gavel|your auction, with atmosphere|the bid|the signing|the lock|the transition|bat crack|gavel & applause|closing click|soft air/i);
  assert.equal(await soundPanel.getByRole("button").count(), 1, "only the close button remains, with no sound sample buttons");
  const toggle = soundPanel.getByRole("switch");
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  const volume = soundPanel.getByRole("slider", { name: /Volume/ });
  assert.equal(await volume.isDisabled(), true);
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  assert.equal(await volume.isDisabled(), false);
  await volume.focus();
  await volume.press("Home");
  await volume.press("ArrowRight");
  assert.equal(await volume.inputValue(), "1");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  await ownerPage.keyboard.press("Escape");
  await soundPanel.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("PASS: sound controls contain only the functional on/off and volume controls; preview descriptions/buttons are removed and Escape still closes settings.");
} finally {
  await browser.close();
}
