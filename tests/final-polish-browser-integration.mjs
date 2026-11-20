import { navigateTo } from "./browser-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run only through the isolated API runner; never change the user's rooms.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
const errors = [];
const money = amount => amount >= 100 ? `₹${(amount / 100).toFixed(2)} Cr` : `₹${amount} L`;
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
const roomPath = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${roomPath(member)}/action`, { token: member.token, body: { action } });
const clickNav = async (page, name) => {
  await navigateTo(page, name);
};
const watch = page => {
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
};
const openMember = async (member, view = "room") => {
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const access = { code: member.state.code, token: member.token, memberId: member.memberId };
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), access);
  const page = await context.newPage();
  watch(page);
  await page.goto(`${base}/?room=${access.code}&view=${view}`);
  await page.locator(".app-shell.in-auction").waitFor();
  return { context, page };
};
const spentValue = page => page.locator('.metrics .metric[data-metric="own-spending"] strong');
const expectSpent = async (page, amount) => {
  await page.bringToFront();
  await spentValue(page).filter({ hasText: money(amount) }).waitFor();
  assert.equal(await spentValue(page).innerText(), money(amount));
};
const removedChrome = async page => {
  assert.equal(await page.locator(".page-footer").count(), 0);
  assert.equal(await page.getByText("FAN-MADE. GAME-READY. NOT AFFILIATED WITH IPL.", { exact: true }).count(), 0);
  assert.equal(await page.getByText("ORIGINAL STADIUM ART · PAVILION", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Raise flag", exact: true }).count(), 0);
};
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
const capture = async (page, name) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(screenshots, name), fullPage: false });
};
const expectBareCrest = async (page, team) => {
  const image = page.locator(".sidebar-profile").getByRole("img", { name: `${team.name} crest`, exact: true });
  await image.waitFor({ state: "visible" });
  await image.evaluate(image => image.decode());
  assert.equal(await page.locator(".sidebar-profile .avatar").count(), 0, "a franchise profile must not use the old circular initial avatar");
  const presentation = await image.evaluate(image => {
    const imageStyle = getComputedStyle(image);
    const parentStyle = getComputedStyle(image.parentElement);
    return { loaded: image.naturalWidth > 0, imageRadius: imageStyle.borderRadius, parentRadius: parentStyle.borderRadius, parentBackground: parentStyle.backgroundColor, parentBorder: parentStyle.borderTopWidth };
  });
  assert.equal(presentation.loaded, true);
  assert.equal(presentation.imageRadius, "0px");
  assert.equal(presentation.parentRadius, "0px");
  assert.equal(presentation.parentBackground, "rgba(0, 0, 0, 0)");
  assert.equal(presentation.parentBorder, "0px");
};

try {
  const host = await request("/api/rooms", { body: { name: "Final franchise polish", hostName: "Final auctioneer" } });
  assert.equal(host.state.teams.length, 12);
  const gt = host.state.teams.find(team => team.id === "gt");
  const lsg = host.state.teams.find(team => team.id === "lsg");
  assert.equal(gt?.name, "Gujarat Titans");
  assert.equal(lsg?.name, "Lucknow Super Giants");
  const { teamPassword } = await request(`${roomPath(host)}/access`, { token: host.token, body: {} });
  const join = (name, teamId) => request(`${roomPath(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword } : {}) } });
  const owner = await join("Titans manager", "gt");
  const rival = await join("Super Giants manager", "lsg");
  await join("Chennai manager", "csk");
  const spectator = await join("Final viewer");

  const lobbyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const lobbyPage = await lobbyContext.newPage();
  watch(lobbyPage);
  await lobbyPage.goto(base);
  await lobbyPage.getByRole("button", { name: "Join a room", exact: true }).click();
  const joinDialog = lobbyPage.getByRole("dialog", { name: "Join auction room", exact: true });
  await joinDialog.waitFor();
  const choices = await joinDialog.locator("select option").evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent })));
  assert.ok(choices.some(option => option.value === "gt" && option.text.includes("Gujarat Titans")));
  assert.ok(choices.some(option => option.value === "lsg" && option.text.includes("Lucknow Super Giants")));
  await joinDialog.locator("select").selectOption("gt");
  assert.equal(await joinDialog.getByLabel("Team password", { exact: true }).isVisible(), true);
  await lobbyPage.keyboard.press("Escape");
  await removedChrome(lobbyPage);
  await clickNav(lobbyPage, "Player pool");
  await removedChrome(lobbyPage);
  await lobbyContext.close();

  const ownerBrowser = await openMember(owner);
  const rivalBrowser = await openMember(rival);
  const page = ownerBrowser.page;
  const rivalPage = rivalBrowser.page;
  const accents = [];
  for (const [memberPage, team] of [[page, gt], [rivalPage, lsg]]) {
    assert.equal(await memberPage.locator(".app-shell").getAttribute("data-franchise"), team.id);
    assert.equal(await memberPage.evaluate(() => document.documentElement.dataset.franchise), team.id);
    assert.equal(await memberPage.locator(".franchise-hero-copy p").innerText(), team.name);
    await expectBareCrest(memberPage, team);
    accents.push(await memberPage.locator(".app-shell").evaluate(element => getComputedStyle(element).getPropertyValue("--franchise-accent").trim()));
    await expectSpent(memberPage, 0);
    await removedChrome(memberPage);
    assert.equal(await memberPage.getByText("Owned and Managed by :", { exact: false }).count(), 0, "ownership copy belongs only on Team Squads");
    await noOverflow(memberPage);
  }
  assert.ok(accents.every(Boolean));
  assert.notEqual(accents[0], accents[1], "GT and LSG have separate franchise palettes");
  const first = host.state.players.find(player => player.name === "Axar Patel");
  const second = host.state.players.find(player => player.name === "Virat Kohli");
  assert.ok(first && second);
  const buy = async (buyer, player, amount) => {
    await act(host, { type: "select_player", playerId: player.id });
    await act(host, { type: "start" });
    await act(buyer, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice, customAmount: amount });
    await act(host, { type: "lock" });
    return (await act(host, { type: "sell" })).state;
  };
  await buy(owner, first, 300);
  await expectSpent(page, 300);
  await expectSpent(rivalPage, 0);
  const afterSales = await buy(rival, second, 500);
  await expectSpent(page, 300);
  await expectSpent(rivalPage, 500);
  assert.equal(afterSales.teams.reduce((total, team) => total + team.squad.reduce((sum, purchase) => sum + purchase.amount, 0), 0), 800);
  await page.reload();
  await expectSpent(page, 300);
  await expectBareCrest(page, gt);
  await capture(page, "final-gt-own-spending-1680.png");
  await capture(rivalPage, "final-lsg-own-spending-1680.png");
  console.log("PASS: GT and LSG are joinable with their own palettes and unframed profile crests; separate browsers show only their own spending after live purchases and reload.");

  for (const identity of [host, spectator]) {
    const { context, page: unassignedPage } = await openMember(identity);
    assert.equal(await spentValue(unassignedPage).innerText(), "—", "unassigned viewers must not see the room's total as their own spending");
    await removedChrome(unassignedPage);
    await context.close();
  }
  for (const destination of ["My Squad", "Build my XI", "Player pool", "Room settings"]) {
    await clickNav(page, destination);
    await removedChrome(page);
    assert.equal(await page.getByText("Owned and Managed by :", { exact: false }).count(), 0);
    await noOverflow(page);
  }
  await clickNav(page, "Team squads");
  await removedChrome(page);
  assert.equal(await page.locator(".team-squad-summary").count(), 12);
  const summary = name => page.getByRole("button", { name: `View ${name} squad`, exact: true });
  assert.equal(await summary(gt.name).locator(".team-squad-summary-manager").innerText(), "Owned and Managed by : Titans manager");
  assert.equal(await summary("Mumbai Indians").locator(".team-squad-summary-manager").innerText(), "No manager has taken charge");
  assert.equal(await page.locator(".team-squad-summary .squad-detail-player, .team-squad-summary .player-portrait").count(), 0, "overview cards remain compact");
  const openSquad = async name => {
    await summary(name).click();
    const dialog = page.getByRole("dialog", { name, exact: true });
    await dialog.waitFor();
    return dialog;
  };
  const closeSquad = async dialog => {
    await dialog.getByRole("button", { name: "Close squad details", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  };
  const owned = await openSquad(gt.name);
  assert.equal(await owned.locator(".squad-detail-header p").innerText(), "Owned and Managed by : Titans manager");
  assert.equal(await owned.locator(".squad-detail-player").count(), 1);
  await closeSquad(owned);
  const unowned = await openSquad("Mumbai Indians");
  assert.equal(await unowned.getByRole("heading", { name: "No manager has taken charge", exact: true }).count(), 1);
  assert.equal(await unowned.getByText("No signings yet", { exact: true }).count(), 0);
  await capture(page, "final-unowned-squad-1680.png");
  await closeSquad(unowned);
  const emptyOwned = await openSquad("Chennai Super Kings");
  assert.equal(await emptyOwned.locator(".squad-detail-header p").innerText(), "Owned and Managed by : Chennai manager");
  assert.equal(await emptyOwned.getByRole("heading", { name: "No signings yet", exact: true }).count(), 1);
  await closeSquad(emptyOwned);
  await rivalBrowser.context.close();
  await act(rival, { type: "leave" });
  await page.bringToFront();
  await summary(lsg.name).locator(".team-squad-summary-manager").filter({ hasText: "No manager has taken charge" }).waitFor();
  const departed = await openSquad(lsg.name);
  assert.equal(await departed.locator(".squad-detail-header p").innerText(), "No manager has taken charge");
  assert.equal(await departed.locator(".squad-detail-player").count(), 1, "an absent manager must not erase the franchise's purchased roster");
  assert.equal(await departed.getByRole("heading", { name: second.name, exact: true }).count(), 1);
  assert.equal(await departed.locator(".squad-detail-price strong").innerText(), money(500));
  await closeSquad(departed);
  console.log("PASS: only Team Squads shows explicit manager attribution; unowned and owned empty teams differ, and a departing manager leaves purchases intact.");

  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
    const purses = await page.locator(".team-squad-summary-stats > span:first-child strong").evaluateAll(values => values.map(value => {
      const range = document.createRange();
      range.selectNodeContents(value);
      return { text: value.textContent, lines: range.getClientRects().length, textWidth: range.getBoundingClientRect().width, availableWidth: value.getBoundingClientRect().width };
    }));
    for (const purse of purses) {
      assert.equal(purse.lines, 1, `${purse.text} must stay on one line at ${width}px`);
      assert.ok(purse.textWidth <= purse.availableWidth + 0.5, `${purse.text} must fit its column at ${width}px`);
    }
    const mobileDialog = await openSquad(gt.name);
    assert.equal(await mobileDialog.evaluate(element => element.scrollWidth > element.clientWidth), false);
    assert.equal(await mobileDialog.locator(".squad-detail-header p").innerText(), "Owned and Managed by : Titans manager");
    await closeSquad(mobileDialog);
    await clickNav(page, "Auction room");
    await expectSpent(page, 300);
    await removedChrome(page);
    await noOverflow(page);
    await clickNav(page, "Team squads");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "final-team-managers-390.png");
  assert.deepEqual(errors, []);
  console.log("PASS: footer text and Raise flag are absent throughout Home and room pages; own spending and manager details remain correct at 360/390/768px without browser errors.");
} finally {
  await browser.close();
}
