import { navigateTo } from "./browser-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run browser purchases only through the isolated API runner.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const errors = [];
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
const money = value => value >= 100 ? `₹${(value / 100).toFixed(2)} Cr` : `₹${value} L`;
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
const accessFor = member => ({ code: member.state.code, token: member.token, memberId: member.memberId });
const openMember = async (member, view = "room") => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const access = accessFor(member);
  await context.addInitScript(access => {
    localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access));
    localStorage.setItem("pavilion-active-room", access.code);
  }, access);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${access.code}&view=${view}`);
  await page.locator(".app-shell.in-auction").waitFor();
  return { context, page };
};
const clickNav = async (page, name) => {
  await navigateTo(page, name);
};
const noOverflow = async page => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
};
const actionResponse = (page, type) => page.waitForResponse(response => response.url().endsWith("/action") && response.request().method() === "POST" && response.request().postDataJSON()?.action?.type === type);
const sendChat = async (page, text) => {
  await page.bringToFront();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("textbox", { name: "Message to room", exact: true }).fill(text);
  const response = actionResponse(page, "chat");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  assert.equal((await response).status(), 200);
};
const chatAuthor = async (page, text, name, team) => {
  const entry = page.locator(".activity-entry").filter({ has: page.getByText(text, { exact: true }) });
  await entry.waitFor();
  const author = await entry.locator(".chat-author").innerText();
  assert.ok(author.includes(name), author);
  if (team) assert.ok(author.includes(team), author);
};

try {
  const host = await request("/api/rooms", { body: { name: "Auction UI upgrade check", hostName: "Test auctioneer" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword } : {}) } });
  const owner = await join("Red manager", "rcb");
  const rival = await join("Blue manager", "mi");
  const spectator = await join("Departing viewer");
  const eligible = host.state.players.filter(player => player.status === "available" && player.eligibilityVerified !== false && !player.isOverseas);
  const axar = eligible.find(player => player.id === "axar-patel");
  assert.ok(axar);
  const purchases = [axar, ...eligible.filter(player => player.id !== axar.id).slice(0, 24)];
  assert.equal(purchases.length, 25);
  await act(host, { type: "select_player", playerId: axar.id });
  await act(host, { type: "start" });
  const hostBrowser = await openMember(host);
  const ownerBrowser = await openMember(owner);
  const rivalBrowser = await openMember(rival);
  const page = ownerBrowser.page;

  for (const [view, name, team] of [[page, "Red manager", "Royal Challengers Bengaluru"], [rivalBrowser.page, "Blue manager", "Mumbai Indians"]]) {
    assert.equal(await view.locator(".franchise-hero h1").innerText(), name);
    assert.equal(await view.locator(".franchise-hero-copy p").innerText(), team);
    assert.equal(await view.locator(".franchise-hero button").count(), 0);
    assert.doesNotMatch(await view.locator(".franchise-hero").innerText(), /your colours|your identity|your xi|invite people/i);
    await noOverflow(view);
  }
  assert.equal(await hostBrowser.page.locator(".custom-bid").count(), 0, "auctioneers cannot place participant bids");
  await page.bringToFront();
  const input = page.getByRole("textbox", { name: "Custom bid in crore", exact: true });
  const submit = page.locator(".custom-bid button[type=submit]");
  await input.fill("0.01");
  await page.locator(".custom-bid-error").filter({ hasText: "The minimum bid is now" }).waitFor();
  assert.equal(await submit.isDisabled(), true);
  await input.fill("101");
  await page.getByText("This bid exceeds your remaining purse.", { exact: true }).waitFor();
  assert.equal(await submit.isDisabled(), true);
  await input.fill("5.001");
  await page.getByText("Use a value in crores, such as 5 or 5.25.", { exact: true }).waitFor();
  assert.equal(await submit.isDisabled(), true);
  assert.equal((await read(owner)).bidHistory.length, 0, "invalid custom inputs cannot submit a bid");
  await input.fill("5");
  const placed = actionResponse(page, "bid");
  await page.getByRole("button", { name: "Bid ₹5.00 Cr", exact: true }).click();
  const bidResponse = await placed;
  assert.equal(bidResponse.status(), 200);
  const bidAction = bidResponse.request().postDataJSON().action;
  assert.equal(bidAction.customAmount, 500);
  assert.equal(bidAction.expectedAmount, axar.basePrice);
  assert.equal(bidAction.expectedPlayerId, axar.id);
  assert.equal((await bidResponse.json()).state.currentBid, 500);
  await page.getByRole("button", { name: "You're leading the bidding", exact: true }).waitFor();
  assert.equal(await input.isDisabled(), true, "the leading participant cannot outbid themselves");
  for (const view of [hostBrowser.page, rivalBrowser.page]) {
    await view.bringToFront();
    await view.locator(".bid-price > strong").filter({ hasText: "₹5.00 Cr" }).waitFor();
  }
  await rivalBrowser.page.getByRole("button", { name: "Raise to ₹5.25 Cr", exact: true }).waitFor();
  await rivalBrowser.page.getByRole("textbox", { name: "Custom bid in crore", exact: true }).fill("6");
  await hostBrowser.page.bringToFront();
  const locked = actionResponse(hostBrowser.page, "lock");
  await hostBrowser.page.getByRole("button", { name: "Lock bidding", exact: true }).click();
  assert.equal((await locked).status(), 200);
  await rivalBrowser.page.bringToFront();
  await rivalBrowser.page.getByRole("button", { name: "Bidding locked", exact: true }).waitFor();
  assert.equal(await rivalBrowser.page.getByRole("textbox", { name: "Custom bid in crore", exact: true }).isDisabled(), true);
  assert.equal(await rivalBrowser.page.locator(".custom-bid button[type=submit]").isDisabled(), true);
  await hostBrowser.page.bringToFront();
  const sold = actionResponse(hostBrowser.page, "sell");
  await hostBrowser.page.getByRole("button", { name: "Sell to RCB", exact: true }).click();
  assert.equal((await sold).status(), 200);
  console.log("PASS: custom ₹5 Cr bidding validates inputs, updates independent browsers, advances the normal bid to ₹5.25 Cr, and disables on lock.");

  await sendChat(hostBrowser.page, "Auctioneer says welcome");
  await sendChat(page, "My signing is confirmed");
  await chatAuthor(page, "Auctioneer says welcome", "Test auctioneer");
  await chatAuthor(page, "My signing is confirmed", "Red manager", "RCB");
  await hostBrowser.page.bringToFront();
  await chatAuthor(hostBrowser.page, "My signing is confirmed", "Red manager", "RCB");
  await act(spectator, { type: "chat", text: "Leaving after this message" });
  await act(spectator, { type: "leave" });
  const lateJoiner = await join("Late viewer");
  const lateBrowser = await openMember(lateJoiner);
  await lateBrowser.page.getByRole("button", { name: "Chat", exact: true }).click();
  await chatAuthor(lateBrowser.page, "Leaving after this message", "Departing viewer");
  await chatAuthor(lateBrowser.page, "My signing is confirmed", "Red manager", "RCB");
  assert.equal(await lateBrowser.page.locator(".custom-bid").count(), 0);
  console.log("PASS: chat shows authenticated sender names and franchises; a newly joined viewer still sees the name of a departed participant.");
  for (const session of [hostBrowser, ownerBrowser, rivalBrowser, lateBrowser]) await session.context.close();

  for (const player of purchases.slice(1)) {
    await act(host, { type: "select_player", playerId: player.id });
    await act(host, { type: "start" });
    await act(owner, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice });
    await act(host, { type: "lock" });
    await act(host, { type: "sell" });
  }
  const final = await read(owner);
  const team = final.teams.find(team => team.id === "rcb");
  assert.equal(team.squad.length, 25);
  const spent = 500 + purchases.slice(1).reduce((sum, player) => sum + player.basePrice, 0);
  assert.equal(team.purse, final.settings.purse - spent);
  const squadBrowser = await openMember(owner, "squads");
  const squadPage = squadBrowser.page;
  await squadPage.locator(".team-squad-summary").first().waitFor();
  assert.equal(await squadPage.locator(".team-squad-summary").count(), final.teams.length);
  assert.equal(await squadPage.locator(".team-squad-summary .squad-detail-player, .team-squad-summary .player-portrait").count(), 0);
  assert.equal(await squadPage.locator(".squad-detail-dialog").count(), 0);
  const summary = squadPage.getByRole("button", { name: `View ${team.name} squad`, exact: true });
  const text = await summary.innerText();
  assert.ok(text.includes(money(team.purse)));
  assert.match(text, /25\s*\/\s*25/);
  assert.doesNotMatch(text, /Axar Patel|Total invested|Overseas/);
  assert.ok((await summary.boundingBox()).height < 250, "a full squad must not make its summary card taller");
  await noOverflow(squadPage);
  await summary.click();
  const dialog = squadPage.getByRole("dialog", { name: team.name, exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.locator(".squad-detail-player").count(), 25);
  const rosterNames = await dialog.locator(".squad-detail-player h3").allTextContents();
  assert.deepEqual(new Set(rosterNames), new Set(purchases.map(player => player.name)));
  assert.match(await dialog.locator(".squad-detail-totals").innerText(), /25\s*\/\s*25/);
  const axarCard = dialog.locator(".squad-detail-player").filter({ has: squadPage.getByRole("heading", { name: axar.name, exact: true }) });
  assert.equal(await axarCard.locator(".squad-detail-price strong").innerText(), "₹5.00 Cr");
  await axarCard.locator("summary").click();
  assert.equal(await axarCard.locator("details").getAttribute("open"), "");
  assert.ok((await axarCard.locator("details").innerText()).includes("Matches"));
  assert.ok((await axarCard.locator("details").innerText()).includes(String(axar.stats.matches ?? "—")));
  assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false);
  await squadPage.evaluate(() => document.fonts.ready);
  await squadPage.screenshot({ path: resolve(screenshots, "team-squad-detail-1440.png") });
  await squadPage.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await squadPage.setViewportSize({ width: 390, height: 844 });
  await noOverflow(squadPage);
  await summary.click();
  await dialog.waitFor();
  assert.equal(await dialog.locator(".squad-detail-player").count(), 25);
  assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false);
  await dialog.locator(".squad-detail-player").last().scrollIntoViewIfNeeded();
  assert.equal(await dialog.locator(".squad-detail-player").last().isVisible(), true);
  await dialog.evaluate(element => element.scrollTo(0, 0));
  await squadPage.screenshot({ path: resolve(screenshots, "team-squad-detail-390.png") });
  await squadPage.getByRole("button", { name: "Close squad details", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  for (const destination of ["My Squad", "Team squads", "Auction room"]) {
    await clickNav(squadPage, destination);
    await noOverflow(squadPage);
    assert.equal(await squadPage.locator(".franchise-hero h1").innerText(), "Red manager");
  }
  assert.deepEqual(errors, []);
  console.log("PASS: a 25-player squad keeps a compact purse/spots summary, opens every purchase with price and stats, and works at desktop and 390px without horizontal overflow.");
} finally {
  await browser.close();
}
