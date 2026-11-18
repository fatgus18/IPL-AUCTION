import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Account browser checks must use an isolated database, never existing auctions.");
const base = process.env.BASE_URL;
assert.ok(base);
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
const pageErrors = [];
const contexts = [];
const password = " Pavilion matchday passphrase 2026! ";
const suffix = Date.now().toString(36);
const hostUsername = `browser_host_${suffix}`;
const managerUsername = `browser_manager_${suffix}`;
const pathFor = member => `/api/rooms/${member.state.code}`;
const request = async (path, { token, body, context } = {}) => {
  const headers = { Origin: base, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let response;
  if (context) response = await context.request.fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { data: body }), timeout: 20000 });
  else response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = await response.json();
  const status = typeof response.status === "function" ? response.status() : response.status;
  assert.ok(status >= 200 && status < 300, `${path}: ${status}: ${value.error}`);
  return value;
};
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } }).then(value => value.state);
const read = member => request(pathFor(member), { token: member.token }).then(value => value.state);
const nextBid = state => state.leadingTeamId ? Math.floor(state.currentBid / 25) * 25 + Math.max(25, Math.ceil(state.settings.bidIncrement / 25) * 25) : Math.max(25, Math.ceil(state.players.find(player => player.id === state.currentPlayerId).basePrice / 25) * 25);
const bid = (member, state, amount) => act(member, { type: "bid", expectedPlayerId: state.currentPlayerId, expectedAmount: nextBid(state), customAmount: amount });
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const accountDialog = page => page.getByRole("dialog", { name: "Your account", exact: true });
const openAccount = async page => {
  await page.bringToFront();
  await page.locator(".topbar").getByRole("button", { name: /^(Sign in|My auctions)$/ }).click();
  await accountDialog(page).waitFor();
  return accountDialog(page);
};
const openBrowser = async ({ member, width = 1440 } = {}) => {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  contexts.push(context);
  if (member) await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), { code: member.state.code, token: member.token, memberId: member.memberId });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(member ? `${base}/?room=${member.state.code}&view=room` : base);
  await page.locator(member ? ".app-shell.in-auction" : ".app-shell.in-lobby").waitFor();
  if (member) await page.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  return { page, context };
};
const authenticate = async (page, username, mode = "login", value = password, expectedStatus = 200) => {
  const dialog = await openAccount(page);
  if (mode === "register") await dialog.locator(".account-access-modes").getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("Username", { exact: true }).fill(username);
  await dialog.getByLabel("Password", { exact: true }).fill(value);
  const submitted = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/account/${mode}`);
  await dialog.locator(".account-form").getByRole("button", { name: mode === "register" ? "Create account" : "Sign in", exact: true }).click();
  const response = await submitted;
  assert.equal(response.status(), expectedStatus, await response.text());
  if (expectedStatus >= 200 && expectedStatus < 300) await dialog.locator(".account-saved").waitFor();
  else await dialog.getByRole("alert").waitFor();
  return dialog;
};
const resume = async (page, roomName) => {
  const response = page.waitForResponse(response => response.request().method() === "POST" && /\/api\/account\/rooms\/[A-Z0-9]{6}\/resume$/.test(new URL(response.url()).pathname));
  await accountDialog(page).getByRole("button", { name: `Return to ${roomName}`, exact: true }).click();
  const received = await response;
  assert.equal(received.status(), 200, await received.text());
  await accountDialog(page).waitFor({ state: "hidden" });
  await page.locator(".app-shell.in-auction.tab-room").waitFor();
  await paint(page);
  return received.json();
};
const uiAction = async (page, type, click) => {
  const pending = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/action") && response.request().postDataJSON()?.action?.type === type);
  await click();
  const response = await pending;
  assert.equal(response.status(), 200, await response.text());
  await paint(page);
  return (await response.json()).state;
};
const refreshState = async (page, member, version) => {
  const observed = page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || new URL(response.url()).pathname !== pathFor(member) || !response.ok()) return false;
    try { const value = await response.json(); return (value.state?.version ?? value.version ?? -1) >= version; } catch { return false; }
  });
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await observed;
  await paint(page);
};
const nav = async (page, label, tab) => {
  await page.bringToFront();
  const button = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: label });
  if (!await button.isVisible()) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await button.click();
  await page.locator(`.app-shell.tab-${tab}`).waitFor();
  await paint(page);
};
const checkGeometry = async (page, dialog) => {
  await paint(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, "page has no horizontal overflow");
  if (dialog) {
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1 && bounds.y + bounds.height <= page.viewportSize().height + 1, "account dialog fits viewport");
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, "account dialog has no sideways overflow");
  }
};
const capture = async (page, name) => { await page.evaluate(() => document.fonts.ready); await paint(page); await page.screenshot({ path: resolve(screenshots, name), fullPage: true }); };

let host;
let guestRoom;
try {
  const firstHost = await openBrowser();
  await authenticate(firstHost.page, hostUsername, "register", password, 201);
  const authCookies = await firstHost.context.cookies();
  assert.ok(authCookies.some(cookie => cookie.httpOnly), "account authentication must use HTTP-only cookies");
  host = await request("/api/rooms", { context: firstHost.context, body: { name: "Two-day account recovery", hostName: "Account creator" } });
  assert.equal(host.accountLinked, true, "rooms created while signed in are saved automatically");
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const manager = await request(`${pathFor(host)}/join`, { body: { name: "Returning RCB manager", teamId: "rcb", teamPassword } });
  const rival = await request(`${pathFor(host)}/join`, { body: { name: "MI rival", teamId: "mi", teamPassword } });
  const [signed, unsold, current] = host.state.players.filter(player => player.status === "available" && !player.catalogArchived && player.eligibilityVerified !== false && player.basePrice <= 500).slice(0, 3);
  assert.ok(signed && unsold && current);
  await act(host, { type: "select_player", playerId: signed.id });
  let state = await act(host, { type: "start" });
  await bid(manager, state, 500);
  await act(host, { type: "lock" });
  await act(host, { type: "sell" });
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: [null, null, null, null, null, null, signed.id], substitutes: [], captainId: signed.id, viceCaptainId: null } });
  await act(manager, { type: "set_target_picks", teamId: "rcb", expectedRevision: 0, playerIds: [current.id], maxBids: { [current.id]: 713 } });
  await act(host, { type: "select_player", playerId: unsold.id });
  await act(host, { type: "start" });
  await act(host, { type: "lock" });
  await act(host, { type: "unsold" });
  await act(host, { type: "select_player", playerId: current.id });
  state = await act(host, { type: "start" });
  state = await bid(rival, state, 500);

  await accountDialog(firstHost.page).getByRole("button", { name: "Refresh saved rooms", exact: true }).click();
  await accountDialog(firstHost.page).getByRole("heading", { name: host.state.name, exact: true }).waitFor();
  await checkGeometry(firstHost.page, accountDialog(firstHost.page));
  await capture(firstHost.page, "accounts-saved-auctions-desktop.png");
  const initialRecovery = await resume(firstHost.page, host.state.name);
  assert.equal(initialRecovery.memberId, host.memberId);
  assert.equal(initialRecovery.state.members.find(member => member.id === host.memberId).role, "auctioneer");
  assert.equal(await firstHost.page.locator('[data-metric="own-spending"]').count(), 0, "auctioneer has no personal spending metric");
  assert.equal(initialRecovery.state.myTargetPicks, undefined, "auctioneer cannot recover another team's private plans");
  console.log("PASS: UI registration, HTTP-only account cookie, automatic room saving and account-based creator recovery.");

  const firstManager = await openBrowser({ member: manager });
  assert.match(await firstManager.page.locator('[data-metric="own-spending"]').innerText(), /₹5\.00 Cr/);
  await authenticate(firstManager.page, managerUsername, "register", password, 201);
  await accountDialog(firstManager.page).getByRole("button", { name: "Save this room", exact: true }).click();
  await accountDialog(firstManager.page).getByRole("heading", { name: host.state.name, exact: true }).waitFor();
  await accountDialog(firstManager.page).getByRole("button", { name: "Close dialog", exact: true }).click();
  const custom = firstManager.page.locator(".custom-bid");
  await custom.getByRole("textbox", { name: "Custom bid in crore", exact: true }).fill("6.27");
  assert.match(await custom.innerText(), /multiples of ₹0\.25 Cr/);
  assert.equal(await custom.getByRole("button", { name: "Place bid", exact: true }).isDisabled(), true);
  await custom.getByRole("textbox", { name: "Custom bid in crore", exact: true }).fill("6.50");
  state = await uiAction(firstManager.page, "bid", () => custom.getByRole("button", { name: "Bid ₹6.50 Cr", exact: true }).click());
  assert.equal(state.currentBid, 650);
  assert.equal(state.leadingTeamId, "rcb");
  await nav(firstManager.page, "Player pool", "players");
  const available = state.players.filter(player => !player.catalogArchived && ["available", "unsold"].includes(player.status)).length;
  assert.equal(Number(await firstManager.page.locator(".manage-pool-summary > span").first().locator("strong").innerText()), available);
  await firstManager.page.getByLabel("Filter player status", { exact: true }).selectOption("available");
  await firstManager.page.getByRole("textbox", { name: "Search player name or country", exact: true }).fill(unsold.name);
  const unsoldRow = firstManager.page.getByRole("row").filter({ has: firstManager.page.getByRole("button", { name: `View details for ${unsold.name}`, exact: true }) });
  await unsoldRow.waitFor();
  assert.match(await unsoldRow.innerText(), /Unsold/);
  console.log("PASS: legacy participant seat saved explicitly, own-team spending, invalid custom bid rejected and valid quarter-crore bid accepted; Available includes unsold players.");

  await refreshState(firstHost.page, host, state.version);
  const paused = await uiAction(firstHost.page, "pause_auction", () => firstHost.page.locator(".topbar").getByRole("button", { name: "Pause auction", exact: true }).click());
  assert.ok(paused.auctionPausedAt);
  assert.equal(paused.phase, "live");
  await firstHost.page.getByRole("status", { name: "Auction break", exact: true }).waitFor();
  await refreshState(firstManager.page, manager, paused.version);
  await firstManager.page.getByRole("status", { name: "Auction break", exact: true }).waitFor();
  assert.equal(await firstManager.page.getByRole("button", { name: "Resume auction", exact: true }).count(), 0);
  for (const [page, member] of [[firstManager.page, manager], [firstHost.page, host]]) {
    await page.bringToFront();
    await page.getByRole("button", { name: "Exit to home", exact: true }).click();
    await page.locator(".app-shell.in-lobby.tab-home").waitFor();
    const storedAccess = await page.evaluate(code => JSON.parse(localStorage.getItem(`pavilion-session-${code}`)), member.state.code);
    assert.equal(storedAccess.memberId, member.memberId, "exiting a paused auction retains browser recovery access");
    assert.ok((await read(member)).members.some(entry => entry.id === member.memberId), "exiting a paused auction never releases the saved seat");
  }
  assert.equal((await read(manager)).myTargetPicks.maxBids[current.id], 713, "private plans survive exit to home during a break");
  console.log("PASS: paused-auction Exit to home preserves creator and bidder seats, saved browser credentials and private plans.");
  await firstHost.context.close();
  await firstManager.context.close();

  const returnHost = await openBrowser({ width: 390 });
  let dialog = await authenticate(returnHost.page, hostUsername.toUpperCase(), "login", "Incorrect account passphrase", 401);
  assert.match(await dialog.getByRole("alert").innerText(), /username|password|credentials/i);
  await checkGeometry(returnHost.page, dialog);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  dialog = await authenticate(returnHost.page, hostUsername.toUpperCase());
  await dialog.getByRole("heading", { name: host.state.name, exact: true }).waitFor();
  assert.match(await dialog.locator(".account-room-status").innerText(), /Paused/);
  await checkGeometry(returnHost.page, dialog);
  await capture(returnHost.page, "accounts-saved-auctions-390.png");
  const recovered = await resume(returnHost.page, host.state.name);
  assert.equal(recovered.memberId, host.memberId);
  assert.equal(recovered.state.auctionPausedAt, paused.auctionPausedAt);
  assert.equal(recovered.state.phase, paused.phase);
  assert.equal(recovered.state.currentPlayerId, current.id);
  assert.equal(recovered.state.currentBid, 650);
  assert.equal(recovered.state.leadingTeamId, "rcb");
  assert.deepEqual(recovered.state.teams, paused.teams);
  assert.equal(recovered.state.myTargetPicks, undefined);
  assert.equal(await returnHost.page.locator('[data-metric="own-spending"]').count(), 0);
  await checkGeometry(returnHost.page);
  await capture(returnHost.page, "accounts-auction-break-390.png");

  const returnManager = await openBrowser({ width: 390 });
  await authenticate(returnManager.page, managerUsername);
  const managerRecovered = await resume(returnManager.page, host.state.name);
  assert.equal(managerRecovered.memberId, manager.memberId);
  assert.deepEqual(managerRecovered.state.myTargetPicks.playerIds, [current.id]);
  assert.equal(managerRecovered.state.myTargetPicks.maxBids[current.id], 713);
  assert.equal(managerRecovered.state.teams.find(team => team.id === "rcb").lineup.playingXI[6], signed.id);
  assert.equal(managerRecovered.state.teams.find(team => team.id === "rcb").lineup.captainId, signed.id);
  assert.equal(await returnManager.page.locator(".custom-bid input").isDisabled(), true, "no bidding during the whole-auction break");
  await nav(returnManager.page, "My Squad", "my-squad");
  await returnManager.page.getByRole("heading", { name: signed.name, exact: true }).waitFor();
  await nav(returnManager.page, /^My Target Picks/, "targets");
  const privateLimit = returnManager.page.getByRole("textbox", { name: `Private limit for ${current.name} in crores`, exact: true });
  await privateLimit.waitFor();
  assert.equal(await privateLimit.inputValue(), "7.13");
  await checkGeometry(returnManager.page);
  console.log("PASS: fresh browser contexts recover creator and manager accounts, case-insensitive usernames, wrong-password rejection, exact paused player/bid/squads, private targets and saved captain/position seven lineup.");

  state = await uiAction(returnHost.page, "resume_auction", () => returnHost.page.getByRole("status", { name: "Auction break", exact: true }).getByRole("button", { name: "Resume auction", exact: true }).click());
  assert.equal(state.auctionPausedAt, undefined);
  assert.equal(state.phase, "live");
  assert.equal(state.currentBid, 650);
  assert.equal(state.currentPlayerId, current.id);
  await returnHost.page.getByRole("status", { name: "Auction break", exact: true }).waitFor({ state: "hidden" });
  await refreshState(returnManager.page, manager, state.version);
  await returnManager.page.getByRole("status", { name: "Auction break", exact: true }).waitFor({ state: "hidden" });
  assert.deepEqual((await read(rival)).myTargetPicks.maxBids ?? {}, {}, "other teams never receive saved private budgets");

  guestRoom = await request("/api/rooms", { body: { name: "Unlinked guest recovery", hostName: "Guest creator" } });
  await returnManager.page.evaluate(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), { code: guestRoom.state.code, token: guestRoom.token, memberId: guestRoom.memberId });
  dialog = await openAccount(returnManager.page);
  await dialog.getByRole("heading", { name: host.state.name, exact: true }).waitFor();
  await checkGeometry(returnManager.page, dialog);
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await returnManager.page.locator(".app-shell.in-lobby.tab-home").waitFor();
  assert.equal((await request("/api/account", { context: returnManager.context })).user, null);
  assert.deepEqual(await returnManager.page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("pavilion-session-"))), [`pavilion-session-${guestRoom.state.code}`], "sign-out removes account access but retains the only recovery key for an unlinked guest room");
  assert.equal((await read(guestRoom)).hostId, guestRoom.memberId, "the unlinked guest creator can still recover their room");
  assert.ok((await read(host)).members.some(member => member.id === manager.memberId), "signing out never releases the saved team seat");
  assert.deepEqual(pageErrors, []);
  console.log("PASS: creator resumes the saved auction, pause clears across devices, account forms fit 390px, sign-out clears linked room access without releasing the team or deleting unlinked guest recovery.");
} finally {
  if (host) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }).catch(() => undefined);
  if (guestRoom) await request(`${pathFor(guestRoom)}/delete`, { token: guestRoom.token, body: { confirmationCode: guestRoom.state.code } }).catch(() => undefined);
  for (const context of contexts) await context.close().catch(() => undefined);
  await browser.close();
}
