import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated runner; never change a user's auction for broadcast tests.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
const errors = [];
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
const broadcast = page => page.getByRole("region", { name: "Auction broadcast", exact: true });
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const focus = async page => {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
};
const observe = async (page, attributes) => {
  await focus(page);
  await page.waitForFunction(attributes => {
    const screen = document.querySelector('[aria-label="Auction broadcast"]');
    return screen && Object.entries(attributes).every(([key, value]) => screen.getAttribute(`data-${key}`) === String(value));
  }, attributes);
  await paint(page);
};
const watch = page => {
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
};
const openMember = async (member, view = "room") => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), { code: member.state.code, token: member.token, memberId: member.memberId });
  const page = await context.newPage(); watch(page);
  await page.goto(`${base}/?room=${member.state.code}&view=${view}`);
  if (view === "broadcast") await observe(page, { connected: true });
  else {
    await page.locator(`.app-shell.in-auction.tab-${view}`).waitFor();
    await page.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  }
  return { page, context };
};
const enter = async page => {
  await page.getByRole("button", { name: "Broadcast mode", exact: true }).click();
  await broadcast(page).waitFor();
  await observe(page, { connected: true });
  assert.equal(new URL(page.url()).searchParams.get("view"), "broadcast");
};
const exit = async (page, view) => {
  await page.getByRole("button", { name: "Exit broadcast", exact: true }).click();
  await broadcast(page).waitFor({ state: "hidden" });
  await page.locator(`.app-shell.in-auction.tab-${view}`).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("view"), view);
};
const navigate = async (page, name, view) => {
  const button = page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name, exact: true });
  if (!await button.isVisible()) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await button.click();
  await page.locator(`.app-shell.in-auction.tab-${view}`).waitFor();
};
const privacy = async (page, password) => {
  assert.equal(await page.locator("dialog[open]").count(), 0, "No native modal may remain in the top layer while broadcast is open");
  const text = await page.locator("body").innerText();
  for (const forbidden of ["Private limit", "My Target Picks", "Your private bidding budget", "Your target is up", "7.13", "8.88", "Projection private manager", "PRIVATE_CHAT_SENTINEL", password]) {
    assert.equal(text.includes(forbidden), false, `${forbidden} must not appear in the projected screen`);
  }
  for (const name of ["Open the bidding", "Lock bidding", "Unlock bidding", "Confirm sale", "Copy team password", "Save targets"]) {
    assert.equal(await page.getByRole("button", { name, exact: true }).isVisible(), false, `Broadcast is read-only: ${name}`);
  }
  assert.equal(await page.getByRole("textbox", { name: "Custom bid in crore", exact: true }).isVisible(), false);
  assert.equal(await page.getByRole("textbox", { name: "Message to room", exact: true }).isVisible(), false);
};
const noOverflow = async page => {
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `Broadcast must fit ${page.viewportSize().width}px`);
  for (const name of ["Exit broadcast", "Enter fullscreen"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (!await button.isVisible()) continue;
    const box = await button.boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= page.viewportSize().width + 1, `${name} must remain reachable`);
  }
  const price = page.getByTestId("broadcast-bid-amount");
  if (await price.isVisible()) {
    const bounds = await price.evaluate(amount => {
      const range = document.createRange();
      range.selectNodeContents(amount);
      const text = range.getBoundingClientRect();
      const panel = amount.closest(".broadcast-bid-primary").getBoundingClientRect();
      return { text: { left: text.left, right: text.right }, panel: { left: panel.left, right: panel.right }, scrollWidth: amount.scrollWidth, clientWidth: amount.clientWidth };
    });
    assert.ok(bounds.text.left >= bounds.panel.left - 1 && bounds.text.right <= bounds.panel.right + 1, `The bid text must fit its own panel at ${page.viewportSize().width}px: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, `The full bid amount must not overflow into the adjacent franchise at ${page.viewportSize().width}px`);
  }
  const careerStats = await page.locator(".broadcast-career dd").evaluateAll(values => values.map(value => {
    const range = document.createRange();
    range.selectNodeContents(value);
    const text = range.getBoundingClientRect();
    const cell = value.parentElement.getBoundingClientRect();
    return { label: value.previousElementSibling?.textContent, value: value.textContent, text: { left: text.left, right: text.right }, cell: { left: cell.left, right: cell.right }, scrollWidth: value.scrollWidth, clientWidth: value.clientWidth };
  }));
  for (const stat of careerStats) {
    assert.ok(stat.text.left >= stat.cell.left - 1 && stat.text.right <= stat.cell.right + 1, `${stat.label} ${stat.value} must fit its own career-stat cell at ${page.viewportSize().width}px: ${JSON.stringify(stat)}`);
    assert.ok(stat.scrollWidth <= stat.clientWidth + 1, `${stat.label} must not overlap a neighboring statistic at ${page.viewportSize().width}px`);
  }
};

let host;
try {
  host = await request("/api/rooms", { body: { name: "Pavilion broadcast verification", hostName: "Broadcast creator" } });
  await act(host, { type: "update_settings", settings: { purse: 100000 } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword } : {}) } });
  const owner = await join("Projection private manager", "rcb");
  const rival = await join("Broadcast MI manager", "mi");
  const spectator = await join("Broadcast spectator");
  const [player, other] = host.state.players.filter(entry => entry.status === "available" && !entry.catalogArchived && entry.eligibilityVerified !== false && !entry.isOverseas && entry.basePrice <= 200);
  assert.ok(player && other);
  await act(owner, { type: "set_target_picks", teamId: "rcb", playerIds: [player.id, other.id], expectedRevision: 0, maxBids: { [player.id]: 713 } });
  await act(owner, { type: "chat", text: "PRIVATE_CHAT_SENTINEL" });

  for (const [member, view] of [[host, "settings"], [spectator, "squads"]]) {
    const opened = await openMember(member, view);
    await enter(opened.page);
    await observe(opened.page, { phase: "waiting", "player-id": "", completed: false });
    await privacy(opened.page, teamPassword);
    await exit(opened.page, view);
    assert.ok((await read(member)).members.some(entry => entry.id === member.memberId), "Exiting broadcast must not leave the room");
    await opened.context.close();
  }
  console.log("PASS: auctioneers and spectators can enter broadcast from their current page and return without leaving the room.");

  const manager = await openMember(owner, "targets");
  const page = manager.page;
  const privateInput = page.getByRole("textbox", { name: `Private limit for ${player.name} in crores`, exact: true });
  await privateInput.fill("8.88");
  await enter(page);
  await privacy(page, teamPassword);
  await exit(page, "targets");
  assert.equal(await privateInput.inputValue(), "8.88", "Unsaved private planning drafts must survive broadcast mode");
  assert.equal((await read(owner)).myTargetPicks.maxBids[player.id], 713, "Viewing broadcast must not submit or change private budgets");
  await enter(page);
  await page.reload();
  await observe(page, { connected: true, phase: "waiting", "player-id": "" });
  assert.equal(new URL(page.url()).searchParams.get("view"), "broadcast", "Reload restores broadcast mode");
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), false, "Restoring a route must not request fullscreen without a gesture");
  await exit(page, "room");
  await enter(page);
  console.log("PASS: managers can broadcast without revealing private planning; drafts survive entry/exit and reload restores the broadcast route.");

  await act(host, { type: "select_player", playerId: player.id });
  await observe(page, { phase: "waiting", "player-id": player.id });
  await broadcast(page).getByRole("heading", { name: player.name, exact: true }).waitFor();
  await privacy(page, teamPassword);
  await act(host, { type: "start" });
  await observe(page, { phase: "live", "player-id": player.id });
  await act(owner, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice, customAmount: 500 });
  await page.getByTestId("broadcast-bid-amount").filter({ hasText: "₹5.00 Cr" }).waitFor();
  await page.getByTestId("broadcast-leading-team").filter({ hasText: "Royal Challengers Bengaluru" }).waitFor();
  await privacy(page, teamPassword);
  await act(host, { type: "pause" });
  await observe(page, { phase: "paused" });
  const locked = await act(host, { type: "lock" });
  await observe(page, { phase: "locked" });
  await act(host, { type: "unlock", expectedPlayerId: player.id, expectedAmount: 500, expectedLockVersion: locked.bidLockVersion ?? 0 });
  await observe(page, { phase: "live" });
  await act(rival, { type: "bid", expectedPlayerId: player.id, expectedAmount: 500 + locked.settings.bidIncrement, customAmount: 700 });
  await page.getByTestId("broadcast-bid-amount").filter({ hasText: "₹7.00 Cr" }).waitFor();
  await page.getByTestId("broadcast-leading-team").filter({ hasText: "Mumbai Indians" }).waitFor();
  await page.screenshot({ path: resolve(screenshots, "broadcast-live-desktop.png"), fullPage: true });
  console.log("PASS: selection, live bids, leading franchises, pause, lock and unlock sync into the projection without refreshing.");

  if (await page.evaluate(() => document.fullscreenEnabled)) {
    await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await broadcast(page).isVisible(), true, "Exiting native fullscreen keeps the broadcast open");
    console.log("PASS: native fullscreen is user-initiated, reversible and independent of leaving broadcast mode.");
  }

  await act(owner, { type: "bid", expectedPlayerId: player.id, expectedAmount: 700 + locked.settings.bidIncrement, customAmount: 100000 });
  await page.getByTestId("broadcast-bid-amount").filter({ hasText: "₹1000.00 Cr" }).waitFor();
  await page.getByTestId("broadcast-leading-team").filter({ hasText: "Royal Challengers Bengaluru" }).waitFor();

  const roomPattern = `**/api/rooms/${host.state.code}?*`;
  const interrupt = route => route.abort("internetdisconnected");
  await page.route(roomPattern, interrupt);
  await observe(page, { connected: false });
  assert.match(await broadcast(page).innerText(), /Connection interrupted|reconnecting/i);
  await privacy(page, teamPassword);
  await page.unroute(roomPattern, interrupt);
  await observe(page, { connected: true });
  await page.getByTestId("broadcast-bid-amount").filter({ hasText: "₹1000.00 Cr" }).waitFor();
  console.log("PASS: a lost connection is clearly marked and the broadcast recovers without a page refresh.");

  for (const width of [360, 390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1080 });
    await paint(page);
    await noOverflow(page);
    if (width === 390 || width === 1920) await page.screenshot({ path: resolve(screenshots, `broadcast-live-max-price-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await paint(page);
  await noOverflow(page);
  const projector = await page.evaluate(() => {
    const franchises = Array.from(document.querySelectorAll(".broadcast-franchises li"));
    return {
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      stageHeight: Math.round(document.querySelector(".broadcast-stage").getBoundingClientRect().height),
      fullyVisibleFranchises: franchises.filter(team => { const box = team.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; }).length,
      totalFranchises: franchises.length,
      footerBottom: Math.round(document.querySelector(".broadcast-footer").getBoundingClientRect().bottom),
    };
  });
  await page.screenshot({ path: resolve(screenshots, "broadcast-projector-1280x720.png") });
  console.log(`INFO: 1280×720 projector geometry ${JSON.stringify(projector)}`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await act(host, { type: "lock" });
  await act(host, { type: "sell" });
  await observe(page, { phase: "sold", "player-id": player.id });
  await page.getByTestId("broadcast-bid-amount").filter({ hasText: "₹1000.00 Cr" }).waitFor();
  await exit(page, "room");
  await navigate(page, "Build my XI", "build-xi");
  const seventh = page.locator(".lineup-xi-slots .lineup-slot").nth(6);
  await seventh.locator(".lineup-slot-pick").click();
  const picker = page.getByRole("dialog", { name: "XI position 7", exact: true });
  await picker.waitFor();
  await picker.getByRole("searchbox", { name: "Search your squad", exact: true }).fill(player.name);
  await picker.getByRole("button", { name: `Select ${player.name}`, exact: true }).click();
  assert.equal(await seventh.getAttribute("data-player-id"), player.id);
  await enter(page);
  await privacy(page, teamPassword);
  await exit(page, "build-xi");
  assert.equal(await seventh.getAttribute("data-player-id"), player.id, "Unsaved XI positions must survive broadcast entry and exit");
  assert.equal((await read(owner)).teams.find(team => team.id === "rcb").lineup?.playingXI?.[6] ?? null, null, "Broadcast must not auto-submit an unsaved lineup");
  await navigate(page, "Auction room", "room");
  await enter(page);
  console.log("PASS: the maximum custom bid fits its own panel at every tested width, and unsaved XI position seven survives broadcast entry and exit.");
  await act(host, { type: "select_player", playerId: other.id });
  await observe(page, { phase: "waiting", "player-id": other.id });
  await privacy(page, teamPassword);
  await act(host, { type: "start" });
  await act(host, { type: "lock" });
  let state = await act(host, { type: "unsold" });
  await observe(page, { phase: "unsold", "player-id": other.id });
  state = await act(host, { type: "end_auction", expectedResultsRevision: state.resultsRevision ?? 0 });
  await observe(page, { completed: true });
  assert.match(await broadcast(page).innerText(), /Auction complete/i);
  assert.equal(await broadcast(page).getByText("LIVE", { exact: true }).isVisible(), false, "An ended auction must not be advertised as live");
  await privacy(page, teamPassword);
  await page.screenshot({ path: resolve(screenshots, "broadcast-complete-desktop.png"), fullPage: true });
  await exit(page, "room");
  assert.equal((await read(owner)).endedAt, state.endedAt);
  await manager.context.close();
  console.log("PASS: sold, unsold and final recap states remain synchronized; broadcast fits phones through projector-size displays.");

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage(); watch(guest);
  await guest.goto(`${base}/?room=${host.state.code}&view=broadcast`);
  const joinDialog = guest.getByRole("dialog", { name: "Join auction room", exact: true });
  await joinDialog.waitFor();
  await joinDialog.getByLabel("Your name", { exact: true }).fill("New broadcast guest");
  await joinDialog.getByRole("button", { name: "Join auction room", exact: true }).click();
  await observe(guest, { connected: true, completed: true });
  assert.equal(new URL(guest.url()).searchParams.get("view"), "broadcast", "New spectator admission preserves the requested broadcast destination");
  await privacy(guest, teamPassword);
  await noOverflow(guest);
  await exit(guest, "room");
  await guestContext.close();
  console.log("PASS: a fresh spectator can join through a broadcast link and arrive in the broadcast view after authenticating.");
  assert.deepEqual(errors, [], "The broadcast flow must not produce browser runtime errors");
} finally {
  await browser.close();
  if (host) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }).catch(() => undefined);
}
