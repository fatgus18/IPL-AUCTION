import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run browser unlock checks only through the isolated API runner.");
assert.ok(process.env.DATABASE_URL?.startsWith("file:"), "The runner must use a temporary local database.");
const base = process.env.BASE_URL;
assert.ok(base);
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const errors = [];
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
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
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } }).then(value => value.state);
const read = member => request(pathFor(member), { token: member.token }).then(value => value.state);
const openMember = async member => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const access = { code: member.state.code, token: member.token, memberId: member.memberId };
  await context.addInitScript(access => {
    localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access));
    localStorage.setItem("pavilion-active-room", access.code);
  }, access);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${access.code}&view=room`);
  await page.locator(".app-shell.in-auction.tab-room").waitFor();
  await page.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  return page;
};
const clickAction = async (page, name, type) => {
  await page.bringToFront();
  const response = page.waitForResponse(response => response.url().endsWith("/action") && response.request().method() === "POST" && response.request().postDataJSON()?.action?.type === type);
  await page.getByRole("button", { name, exact: true }).click();
  const result = await response;
  const value = await result.json();
  assert.equal(result.status(), 200, value.error);
  return { state: value.state, action: result.request().postDataJSON().action };
};
const live = async page => {
  await page.bringToFront();
  await page.locator(".player-card.phase-live").waitFor();
  await page.locator(".player-card .live-lot-status").getByText("LIVE", { exact: true }).waitFor();
  await page.locator(".bid-card-heading").getByText("Bidding open", { exact: true }).waitFor();
};
const noUnlock = async page => assert.equal(await page.getByRole("button", { name: "Unlock bidding", exact: true }).count(), 0);
const mobileControlsFit = async (page, settlementLabel) => {
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    const panel = page.locator(".locked-decision");
    await panel.scrollIntoViewIfNeeded();
    assert.equal(await panel.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `locked controls overflow at ${width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `page overflows at ${width}px`);
    const rectangles = [];
    for (const name of [settlementLabel, "Unlock bidding"]) {
      const box = await panel.getByRole("button", { name, exact: true }).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `${name} must fit at ${width}px`);
      assert.ok(box.height >= 42, `${name} needs a usable mobile touch target`);
      rectangles.push(box);
    }
    const [a, b] = rectangles;
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    assert.ok(overlapX <= 0 || overlapY <= 0, `locked actions must not overlap at ${width}px`);
  }
};

try {
  const host = await request("/api/rooms", { body: { name: "Browser reopen check", hostName: "Reopen auctioneer" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const red = await request(`${pathFor(host)}/join`, { body: { name: "Red unlock manager", teamId: "rcb", teamPassword } });
  const blue = await request(`${pathFor(host)}/join`, { body: { name: "Blue unlock manager", teamId: "mi", teamPassword } });
  const players = host.state.players.filter(player => player.status === "available" && player.eligibilityVerified !== false && !player.isOverseas).slice(0, 2);
  assert.equal(players.length, 2);
  const [first, second] = players;
  await act(host, { type: "select_player", playerId: first.id });
  await act(host, { type: "start" });
  const hostPage = await openMember(host);
  const redPage = await openMember(red);
  const bluePage = await openMember(blue);
  for (const page of [hostPage, redPage, bluePage]) await noUnlock(page);

  const firstBid = (await clickAction(redPage, `Raise to ${money(first.basePrice)}`, "bid")).state;
  await hostPage.bringToFront();
  await hostPage.locator(".bid-price > strong").getByText(money(first.basePrice), { exact: true }).waitFor();
  // Waiting for the leading-team text distinguishes the accepted bid from the same opening price.
  await hostPage.locator(".leading-team").getByText("Royal Challengers Bengaluru", { exact: true }).waitFor();
  const locked = (await clickAction(hostPage, "Lock bidding", "lock")).state;
  await hostPage.locator(".player-card.phase-locked").waitFor();
  await hostPage.locator(".locked-decision").getByRole("button", { name: "Unlock bidding", exact: true }).waitFor();
  for (const page of [redPage, bluePage]) {
    await page.bringToFront();
    await page.getByRole("button", { name: "Bidding locked", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Bidding locked", exact: true }).isDisabled(), true);
    await noUnlock(page);
  }
  await hostPage.bringToFront();
  await mobileControlsFit(hostPage, "Sell to RCB");
  await hostPage.setViewportSize({ width: 390, height: 844 });
  await hostPage.locator(".locked-decision").scrollIntoViewIfNeeded();
  await hostPage.screenshot({ path: resolve(screenshots, "unlock-controls-390.png") });
  const reopened = await clickAction(hostPage, "Unlock bidding", "unlock");
  assert.deepEqual(reopened.action, { type: "unlock", expectedPlayerId: first.id, expectedAmount: locked.currentBid, expectedLockVersion: locked.bidLockVersion });
  assert.equal(reopened.state.phase, "live");
  for (const key of ["currentPlayerId", "currentBid", "leadingTeamId", "lastBidAt", "bidHistory", "bidLockVersion", "teams", "players"]) {
    assert.deepEqual(reopened.state[key], locked[key], `${key} must survive UI reopening`);
  }
  assert.equal(reopened.state.currentBid, firstBid.currentBid);
  for (const page of [hostPage, redPage, bluePage]) {
    await live(page);
    await noUnlock(page);
  }
  await redPage.bringToFront();
  await redPage.getByRole("button", { name: "You're leading the bidding", exact: true }).waitFor();
  const nextBid = locked.currentBid + locked.settings.bidIncrement;
  const secondBid = (await clickAction(bluePage, `Raise to ${money(nextBid)}`, "bid")).state;
  assert.equal(secondBid.leadingTeamId, "mi");
  assert.equal(secondBid.currentBid, nextBid);
  assert.equal(secondBid.bidHistory.length, locked.bidHistory.length + 1);
  assert.deepEqual(secondBid.teams, locked.teams, "a new bid after reopening must not debit any purse yet");

  await hostPage.bringToFront();
  await hostPage.locator(".leading-team").getByText("Mumbai Indians", { exact: true }).waitFor();
  await clickAction(hostPage, "Lock bidding", "lock");
  const sold = (await clickAction(hostPage, "Sell to MI", "sell")).state;
  assert.equal(sold.phase, "sold");
  const purchased = sold.teams.find(team => team.id === "mi");
  assert.equal(purchased.purse, locked.teams.find(team => team.id === "mi").purse - nextBid);
  assert.deepEqual(purchased.squad, [{ playerId: first.id, amount: nextBid }]);
  for (const page of [hostPage, redPage, bluePage]) {
    await page.bringToFront();
    await page.locator(".player-card.phase-sold").waitFor();
    await noUnlock(page);
  }
  console.log("PASS: auctioneer unlock restores LIVE bidding across two independent managers, preserves leader/history/purses, accepts the next bid, and cannot reopen a completed sale.");

  await act(host, { type: "select_player", playerId: second.id });
  await act(host, { type: "start" });
  await live(hostPage);
  const noBidLocked = (await clickAction(hostPage, "Lock bidding", "lock")).state;
  assert.equal(noBidLocked.currentBid, 0);
  await mobileControlsFit(hostPage, "Mark as unsold");
  const noBidOpened = await clickAction(hostPage, "Unlock bidding", "unlock");
  assert.equal(noBidOpened.action.expectedAmount, 0, "a no-bid unlock must send zero, not the opening price");
  assert.equal(noBidOpened.action.expectedLockVersion, noBidLocked.bidLockVersion);
  assert.equal(noBidOpened.state.currentBid, 0);
  assert.equal(noBidOpened.state.leadingTeamId, null);
  assert.deepEqual(noBidOpened.state.teams, noBidLocked.teams);
  await live(hostPage);
  await clickAction(hostPage, "Lock bidding", "lock");
  await clickAction(hostPage, "Mark as unsold", "unsold");
  await hostPage.locator(".player-card.phase-unsold").waitFor();
  await noUnlock(hostPage);
  const latest = await read(host);
  assert.equal(latest.players.find(player => player.id === first.id).soldFor, nextBid);
  assert.deepEqual(latest.teams.find(team => team.id === "mi"), purchased);
  assert.deepEqual(errors, []);
  console.log("PASS: zero-bid locks reopen and settle correctly; host controls fit 360px, 390px and 768px without overlap or horizontal scroll. No browser errors.");
} finally {
  await browser.close();
}
