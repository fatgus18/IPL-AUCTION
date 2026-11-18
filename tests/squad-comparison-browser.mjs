import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run only against the isolated test database.");
const base = process.env.BASE_URL;
assert.ok(base);
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const errors = [];
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
const request = async (path, token, body) => {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = await response.json();
  assert.ok(response.ok, `${response.status}: ${value.error}`);
  return value;
};
try {
  const host = await request("/api/rooms", undefined, { name: "Comparison checks", hostName: "Comparison auctioneer" });
  const path = `/api/rooms/${host.state.code}`;
  const { teamPassword } = await request(`${path}/access`, host.token, {});
  const manager = await request(`${path}/join`, undefined, { name: "RCB manager", teamId: "rcb", teamPassword });
  const rival = await request(`${path}/join`, undefined, { name: "Chennai manager", teamId: "csk", teamPassword });
  const act = (member, action) => request(`${path}/action`, member.token, { action }).then(result => result.state);
  const buy = async (member, playerId, amount) => {
    const player = host.state.players.find(player => player.id === playerId);
    assert.ok(player);
    await act(host, { type: "select_player", playerId });
    await act(host, { type: "start" });
    await act(member, { type: "bid", expectedPlayerId: playerId, expectedAmount: player.basePrice, customAmount: amount });
    await act(host, { type: "lock" });
    return act(host, { type: "sell" });
  };
  await buy(manager, "marco-jansen", 700);
  await buy(manager, "axar-patel", 300);
  await buy(manager, "sanju-samson", 200);
  await buy(rival, "virat-kohli", 500);
  await act(manager, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: ["sanju-samson", null, null, null, null, null, "marco-jansen"], substitutes: ["axar-patel"], captainId: "marco-jansen", viceCaptainId: "sanju-samson" } });

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const access = { code: host.state.code, token: manager.token, memberId: manager.memberId };
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), access);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${access.code}&view=squads`);
  await page.getByRole("button", { name: "Compare squads", exact: true }).click();
  const comparison = page.getByLabel("Side-by-side squad comparison");
  await comparison.waitFor();
  const first = page.getByRole("combobox", { name: "First comparison team" });
  const second = page.getByRole("combobox", { name: "Second comparison team" });
  assert.equal(await first.locator("option").count(), 12);
  await first.selectOption("rcb");
  await second.selectOption("csk");
  assert.equal(await first.locator('option[value="csk"]').isDisabled(), true);
  assert.equal(await second.locator('option[value="rcb"]').isDisabled(), true);
  assert.equal(await comparison.locator(".squad-compare-franchise").nth(0).locator(".squad-compare-manager").innerText(), "Owned and Managed by : RCB manager");
  const values = async label => {
    const row = comparison.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
    return row.getByRole("cell").allTextContents();
  };
  assert.deepEqual(await values("Total spent"), ["₹12.00 Cr", "₹5.00 Cr"]);
  assert.deepEqual(await values("All-rounder"), ["2", "0"]);
  assert.deepEqual(await values("Wicketkeeper"), ["1", "0"]);
  assert.deepEqual(await values("Batter"), ["0", "1"]);
  assert.deepEqual(await values("Captain"), ["Marco Jansen", "Not selected"]);
  assert.deepEqual(await values("Vice captain"), ["Sanju Samson", "Not selected"]);
  assert.deepEqual(await values("Playing XI"), ["2 / 11", "0 / 11"]);
  assert.deepEqual(await values("Substitutes"), ["1 / 5", "0 / 5"]);
  await page.evaluate(() => document.fonts.ready);
  await comparison.screenshot({ path: resolve(screenshots, "squad-comparison-1440.png") });

  const current = (await request(path, host.token)).state;
  await act(host, { type: "correct_sale", playerId: "marco-jansen", expectedTeamId: "rcb", expectedAmount: 700, expectedResultsRevision: current.resultsRevision ?? 0, teamId: "csk", amount: 600, reason: "Wrong franchise was recorded." });
  await comparison.getByRole("cell", { name: "₹5.00 Cr", exact: true }).waitFor();
  await comparison.getByRole("cell", { name: "₹11.00 Cr", exact: true }).waitFor();
  assert.deepEqual(await values("Total spent"), ["₹5.00 Cr", "₹11.00 Cr"]);
  assert.deepEqual(await values("All-rounder"), ["1", "1"]);
  assert.deepEqual(await values("Captain"), ["Not selected", "Not selected"]);
  assert.deepEqual(await values("Playing XI"), ["1 / 11", "0 / 11"]);
  assert.deepEqual(await comparison.locator(".squad-compare-purse strong").allTextContents(), ["₹95.00 Cr", "₹89.00 Cr"]);
  await comparison.getByRole("button", { name: "View CSK squad", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Chennai Super Kings", exact: true });
  await detail.waitFor();
  assert.equal(await detail.locator(".squad-detail-player").count(), 2);
  await detail.getByRole("button", { name: "Close squad details" }).click();

  for (const width of [768, 390, 360]) {
    await page.setViewportSize({ width, height: 950 });
    await comparison.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `comparison fits ${width}px`);
    for (const control of [first, second, comparison.getByRole("button", { name: "View RCB squad", exact: true }), comparison.getByRole("button", { name: "View CSK squad", exact: true })]) {
      const box = await control.boundingBox();
      assert.ok(box && box.height >= 44, "comparison controls have 44px touch targets");
    }
    const boxes = await comparison.locator(".squad-compare-franchise").evaluateAll(cards => cards.map(card => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y, width: card.getBoundingClientRect().width })));
    assert.equal(boxes[0].y, boxes[1].y, "franchises remain side by side");
    assert.ok(boxes[0].x + boxes[0].width <= boxes[1].x + 1, "franchise panels do not overlap");
  }
  await comparison.screenshot({ path: resolve(screenshots, "squad-comparison-360.png") });
  await second.selectOption("gt");
  assert.equal(await comparison.locator(".squad-compare-manager").nth(1).innerText(), "No manager has taken charge");
  assert.deepEqual(await values("Total spent"), ["₹5.00 Cr", "₹0 L"]);
  await second.selectOption("lsg");
  assert.equal(await second.inputValue(), "lsg");
  assert.deepEqual(errors, []);
  console.log("PASS: side-by-side squads compare all 12 franchises, current corrected budgets/roles/leadership, distinct selectors, full-roster dialogs and 360–1440px layouts.");
} finally {
  await browser.close();
}
