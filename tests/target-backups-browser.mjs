import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { navigateTo } from "./browser-navigation.mjs";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run only against an isolated database; never change a user's room.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const errors = [];
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = await response.json();
  assert.ok(response.ok, `${response.status}: ${value.error}`);
  return value;
};
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } }).then(value => value.state);
const read = member => request(pathFor(member), { token: member.token }).then(value => value.state);
const settleUnsold = async host => {
  await act(host, { type: "start" });
  await act(host, { type: "lock" });
  return act(host, { type: "unsold" });
};
const openMember = async member => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const access = { code: member.state.code, token: member.token, memberId: member.memberId };
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), access);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${access.code}&view=targets`);
  await page.locator(".app-shell.tab-targets").waitFor();
  await page.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  return { page, context };
};
const refresh = async (page, member, version) => {
  const received = page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || new URL(response.url()).pathname !== pathFor(member) || !response.ok()) return false;
    try { const data = await response.json(); return (data.state?.version ?? data.version ?? -1) >= version; } catch { return false; }
  });
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await received;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
const chain = (page, player) => page.locator(`.target-shortlist > li[data-player-id="${player.id}"]`);
const limit = (page, player) => page.getByRole("textbox", { name: `Private limit for ${player.name} in crores`, exact: true });
const target = async (page, player) => {
  await page.getByRole("searchbox", { name: "Search target players", exact: true }).fill(player.name);
  await page.getByRole("region", { name: "Player pool for targeting", exact: true }).getByRole("checkbox", { name: `Target ${player.name}`, exact: true }).click();
};
const picker = page => page.getByRole("dialog", { name: "Choose a backup.", exact: true });
const chooseBackup = async (page, firstChoice, backup, change = false) => {
  await page.getByRole("button", { name: `${change ? "Change" : "Add"} backup for ${firstChoice.name}`, exact: true }).click();
  await picker(page).getByRole("searchbox", { name: "Search backup players", exact: true }).fill(backup.name);
  await picker(page).getByRole("button", { name: `Choose ${backup.name} as backup`, exact: true }).click();
  await picker(page).waitFor({ state: "detached" });
};
const save = async page => {
  const received = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/action") && response.request().postDataJSON()?.action?.type === "set_target_picks");
  await page.getByRole("button", { name: "Save targets", exact: true }).click();
  const response = await received;
  assert.equal(response.status(), 200, await response.text());
  return (await response.json()).state;
};
const dismiss = async page => {
  const button = page.getByRole("button", { name: "Dismiss player notification", exact: true });
  if (await button.isVisible()) await button.click();
};
const correct = async (host, player, teamId) => {
  const state = await read(host);
  const sale = state.players.find(entry => entry.id === player.id);
  return act(host, { type: "correct_sale", playerId: player.id, expectedTeamId: sale.soldTo, expectedAmount: sale.soldFor, expectedResultsRevision: state.resultsRevision ?? 0, teamId, ...(teamId ? { amount: sale.soldFor } : {}), reason: "Verify saved target plan after a reversible sale correction" });
};

try {
  const host = await request("/api/rooms", { body: { name: "Optional backup browser", hostName: "Backup host" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, teamId, teamPassword } });
  const owner = await join("Backup RCB manager", "rcb");
  const rival = await join("Backup MI manager", "mi");
  const [first, backup, solo, replacement] = host.state.players.filter(player => player.status === "available" && !player.catalogArchived && player.eligibilityVerified !== false && player.basePrice <= 200);
  assert.ok(first && backup && solo && replacement);
  await act(host, { type: "select_player", playerId: backup.id });
  await settleUnsold(host);
  const { page, context } = await openMember(owner);

  await target(page, first);
  await target(page, solo);
  let state = await save(page);
  assert.deepEqual(state.myTargetPicks.playerIds, [first.id, solo.id]);
  assert.deepEqual(state.myTargetPicks.backups ?? {}, {}, "first choices save without a backup or budget");
  await page.getByRole("button", { name: `Add backup for ${first.name}`, exact: true }).click();
  assert.equal(await picker(page).locator("[data-backup-option-id]").count(), 12, "backup portraits are paged");
  for (const unavailable of [first, solo]) {
    await picker(page).getByRole("searchbox", { name: "Search backup players", exact: true }).fill(unavailable.name);
    assert.equal(await picker(page).getByRole("button", { name: `Choose ${unavailable.name} as backup`, exact: true }).count(), 0, "first choices cannot also be backups");
  }
  await page.keyboard.press("Escape");
  await picker(page).waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: `Add backup for ${first.name}`, exact: true }).evaluate(element => element === document.activeElement), true, "Escape restores the trigger focus");
  await chooseBackup(page, first, backup);
  await limit(page, first).fill("8.00");
  await limit(page, backup).fill("6.50");
  assert.match(await page.getByRole("region", { name: "Private budget plan" }).innerText(), /Planned limits.*\s*₹8\.00 Cr/, "alternative limits count once");
  state = await save(page);
  assert.deepEqual(state.myTargetPicks.backups, { [first.id]: backup.id });
  assert.deepEqual(state.myTargetPicks.maxBids, { [first.id]: 800, [backup.id]: 650 });
  assert.equal((await read(host)).myTargetPicks, undefined);
  assert.deepEqual((await read(rival)).myTargetPicks.backups ?? {}, {});
  await page.reload();
  await chain(page, first).locator(`[data-backup-player-id="${backup.id}"]`).waitFor();
  assert.equal(await limit(page, backup).inputValue(), "6.50");
  assert.equal(await chain(page, first).getAttribute("data-chain-status"), "first-choice");
  await page.getByRole("button", { name: `Add backup for ${solo.name}`, exact: true }).click();
  await picker(page).getByRole("searchbox", { name: "Search backup players", exact: true }).fill(backup.name);
  assert.equal(await picker(page).getByRole("button", { name: `Choose ${backup.name} as backup`, exact: true }).count(), 0, "a backup cannot be shared between first choices");
  await picker(page).getByRole("button", { name: "Close backup picker", exact: true }).click();
  console.log("PASS: targets work alone; one optional unsold backup and separate budgets persist privately without double-counting the plan.");

  await chooseBackup(page, first, replacement, true);
  state = await save(page);
  assert.equal(state.myTargetPicks.backups[first.id], replacement.id);
  assert.equal(state.myTargetPicks.maxBids[backup.id], undefined, "changing a backup removes its old limit");
  await page.getByRole("button", { name: `Remove backup for ${first.name}`, exact: true }).click();
  state = await save(page);
  assert.deepEqual(state.myTargetPicks.backups ?? {}, {});
  await chooseBackup(page, first, backup);
  await limit(page, backup).fill("6.50");
  await save(page);

  const second = await openMember(owner);
  await chooseBackup(second.page, first, replacement, true);
  await limit(page, first).fill("8.25");
  state = await save(page);
  await refresh(second.page, owner, state.version);
  assert.equal(await second.page.getByRole("button", { name: "Save targets", exact: true }).isDisabled(), true);
  assert.equal(await chain(second.page, first).locator(`[data-backup-player-id="${replacement.id}"]`).count(), 1, "remote polling preserves the unsaved backup draft");
  await second.page.getByRole("button", { name: "Reload saved targets", exact: true }).click();
  assert.equal(await chain(second.page, first).locator(`[data-backup-player-id="${backup.id}"]`).count(), 1);
  await second.context.close();
  console.log("PASS: backup replacement/removal prune obsolete limits; concurrent edits preserve drafts and require explicit conflict resolution.");

  await act(host, { type: "select_player", playerId: first.id });
  await act(host, { type: "start" });
  await act(rival, { type: "bid", expectedAmount: first.basePrice, expectedPlayerId: first.id });
  await act(host, { type: "lock" });
  state = await act(host, { type: "sell" });
  await refresh(page, owner, state.version);
  await dismiss(page);
  assert.equal(await chain(page, first).getAttribute("data-chain-status"), "backup-active");
  await page.locator(".target-board").screenshot({ path: resolve(screenshots, "target-backup-active-desktop.png") });
  assert.match(await page.getByRole("region", { name: "Private budget plan" }).innerText(), /Planned limits\s*₹6.50 Cr/);
  await navigateTo(page, "Auction room");
  state = await act(host, { type: "select_player", playerId: backup.id });
  await refresh(page, owner, state.version);
  const notice = page.locator(".new-lot-notice").filter({ hasText: backup.name });
  await notice.getByText("Your target is up", { exact: true }).waitFor();
  await dismiss(page);
  await page.locator(".my-target-lot-badge").waitFor();
  const reminder = page.getByRole("status", { name: "Your private bidding budget" });
  await reminder.waitFor();
  assert.match(await reminder.innerText(), /6.50/);
  assert.match(await reminder.innerText(), /Active backup/i);
  assert.equal((await read(owner)).leadingTeamId, null, "a backup reminder never places a bid");
  await settleUnsold(host);
  state = await correct(host, first, "rcb");
  await refresh(page, owner, state.version);
  await navigateTo(page, "My Target Picks");
  assert.equal(await chain(page, first).getAttribute("data-chain-status"), "secured");
  assert.match(await page.getByRole("region", { name: "Private budget plan" }).innerText(), /Planned limits\s*₹0 L/);
  await navigateTo(page, "Auction room");
  state = await act(host, { type: "select_player", playerId: backup.id });
  await refresh(page, owner, state.version);
  assert.equal(await page.locator(".my-target-lot-badge").count(), 0);
  assert.equal(await page.locator(".private-bid-budget").count(), 0);
  assert.equal(await page.locator(".new-lot-notice").filter({ hasText: "Your target is up" }).count(), 0);
  await dismiss(page);
  await settleUnsold(host);
  state = await correct(host, first, "mi");
  await refresh(page, owner, state.version);
  await navigateTo(page, "My Target Picks");
  assert.equal(await chain(page, first).getAttribute("data-chain-status"), "backup-active");
  state = await correct(host, first, null);
  await refresh(page, owner, state.version);
  assert.equal(await chain(page, first).getAttribute("data-chain-status"), "first-choice");
  assert.equal((await read(owner)).myTargetPicks.backups[first.id], backup.id, "sale corrections never rewrite the saved pair");
  console.log("PASS: rival purchase activates the backup and its own reminder; owner purchase completes the plan; sale corrections reversibly restore the correct active target.");

  await chooseBackup(page, solo, replacement);
  await save(page);
  await act(host, { type: "select_player", playerId: solo.id });
  await act(host, { type: "start" });
  await act(owner, { type: "bid", expectedAmount: solo.basePrice, expectedPlayerId: solo.id });
  await act(host, { type: "lock" });
  state = await act(host, { type: "sell" });
  await refresh(page, owner, state.version);
  await dismiss(page);
  assert.equal(await chain(page, solo).getAttribute("data-chain-status"), "secured", "winning the first choice immediately completes its plan");
  await navigateTo(page, "Auction room");
  state = await act(host, { type: "select_player", playerId: replacement.id });
  await refresh(page, owner, state.version);
  assert.equal(await page.locator(".my-target-lot-badge").count(), 0, "a standby backup must not activate after an own first-choice purchase");
  assert.equal(await page.locator(".new-lot-notice").filter({ hasText: "Your target is up" }).count(), 0);
  await dismiss(page);
  await settleUnsold(host);
  await navigateTo(page, "My Target Picks");

  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 360 || width === 1440) await page.locator(".target-board").screenshot({ path: resolve(screenshots, `target-backup-board-${width}.png`) });
    await page.getByRole("button", { name: `Change backup for ${first.name}`, exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    const bounds = await picker(page).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${width}px backup picker fits`);
    if (width === 360 || width === 1440) await picker(page).screenshot({ path: resolve(screenshots, `target-backup-picker-${width}.png`) });
    await picker(page).getByRole("button", { name: "Close backup picker", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS: the keyboard-accessible portrait picker fits mobile, tablet, and desktop without overflow or browser errors.");
} finally {
  await browser.close();
}
