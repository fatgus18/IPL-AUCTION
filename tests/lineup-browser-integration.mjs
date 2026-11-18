import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated API runner; never purchase players in the user's rooms.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
const errors = [];
const requests = [];
const capture = async (page, name) => {
  await page.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: resolve(screenshots, name), fullPage: true });
};
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${response.status}: ${value.error}`);
  return value;
};
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } });
const read = member => request(pathFor(member), { token: member.token }).then(value => value.state);
const team = state => state.teams.find(entry => entry.id === "rcb");
const accessFor = member => ({ code: member.state.code, token: member.token, memberId: member.memberId });
const nav = (page, name) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name });
const clickNav = async (page, name) => {
  if (!await nav(page, name).isVisible()) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await nav(page, name).click();
};
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const navigationGeometry = async page => {
  for (const width of [1051, 1100, 1279]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); });
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    const items = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button");
    assert.equal(await items.count(), 7);
    for (const item of await items.all()) {
      assert.equal(await item.isVisible(), true, `all seven destinations must be reachable in the ${width}px drawer`);
      const box = await item.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 0.5 && box.y >= 0 && box.y + box.height <= 1000);
    }
    await nav(page, "Build my XI").click();
    assert.equal(await overflow(page), false);
  }
  for (const width of [1280, 1281, 1440, 1441, 1600, 1680]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const items = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button");
    assert.equal(await items.count(), 7, `all participant destinations should be present at ${width}px`);
    const boxes = [];
    for (const item of await items.all()) {
      assert.equal(await item.isVisible(), true, `desktop navigation must remain visible at ${width}px`);
      const box = await item.boundingBox();
      const label = await item.innerText();
      assert.ok(box && box.width > 0 && box.height > 0);
      assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5, `${label} extends outside ${width}px: ${JSON.stringify(box)}`);
      assert.ok(box.y >= 0 && box.y + box.height <= 1000, `${label} extends outside the header viewport`);
      boxes.push(box);
    }
    for (let index = 1; index < boxes.length; index += 1) {
      assert.ok(boxes[index - 1].x + boxes[index - 1].width <= boxes[index].x + 0.5, `adjacent navigation buttons overlap at ${width}px`);
    }
    const brand = await page.getByRole("link", { name: "Pavilion home", exact: true }).boundingBox();
    assert.ok(brand.x + brand.width <= boxes[0].x + 0.5, `navigation overlaps the brand at ${width}px`);
    const tools = page.locator(".sidebar-bottom");
    if (await tools.isVisible()) {
      const box = await tools.boundingBox();
      assert.ok(boxes.at(-1).x + boxes.at(-1).width <= box.x + 0.5, `Room settings overlaps profile/help controls at ${width}px`);
      assert.ok(box.x + box.width <= width + 0.5, `profile/help controls exceed ${width}px`);
    }
    assert.equal(await nav(page, "Build my XI").getAttribute("aria-current"), "page");
    assert.equal(await page.locator('nav[aria-label="Main navigation"] [aria-current="page"]').count(), 1);
  }
};
const lineupGeometry = async page => {
  await page.mouse.move(0, 0);
  await page.locator(".lineup-slot-filled .lineup-portrait").evaluateAll(images => Promise.all(images.flatMap(image => image.getAnimations().map(animation => animation.finished.catch(() => undefined)))));
  const measurements = await page.locator(".lineup-slot-filled").evaluateAll(slots => slots.map(slot => {
    const box = element => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, right: x + width, bottom: y + height };
    };
    return { name: slot.querySelector(".lineup-selection-copy strong")?.textContent, slot: box(slot), photo: box(slot.querySelector(".lineup-player-photo")), image: box(slot.querySelector(".lineup-player-photo img")), caption: box(slot.querySelector(".lineup-selection-copy")), manage: box(slot.querySelector(".lineup-manage")) };
  }));
  for (const { name, slot, photo, image, caption, manage } of measurements) {
    assert.ok(photo && image && caption && manage, `${name} needs a real photo and accessible controls`);
    assert.ok(image.y >= photo.y - 1 && image.bottom <= photo.bottom + 1 && image.x >= photo.x - 1 && image.right <= photo.right + 1, `${name}'s portrait escapes its photo frame`);
    assert.ok(caption.y >= photo.bottom - 1, `${name}'s name overlaps their portrait instead of its own caption area`);
    assert.ok(manage.y >= caption.bottom - 1 && manage.bottom <= slot.bottom + 1, `${name}'s Manage control is clipped or overlaps its caption`);
  }
  const balance = await page.locator(".lineup-balance").boundingBox();
  for (const value of await page.locator(".lineup-balance dd, .lineup-balance dd strong").all()) {
    const box = await value.boundingBox();
    assert.ok(box.x >= balance.x - 1 && box.x + box.width <= balance.x + balance.width + 1, "role totals must stay inside the XI balance card");
  }
};
const stickySaveGeometry = async page => {
  const lastPosition = page.locator(".lineup-xi-slots .lineup-slot").last();
  await lastPosition.scrollIntoViewIfNeeded();
  const save = await page.getByRole("button", { name: "Save lineup", exact: true }).boundingBox();
  const controls = await page.locator(".lineup-save-bar").boundingBox();
  const position = await lastPosition.locator(".lineup-slot-pick").boundingBox();
  const viewport = page.viewportSize();
  assert.ok(save && save.y >= 0 && save.y + save.height <= viewport.height, "Save lineup must stay in view when editing the last batting position");
  assert.ok(position.y >= controls.y + controls.height - 1 || position.y + position.height <= controls.y + 1, "the sticky save controls must not cover the focused batting position");
  await page.screenshot({ path: resolve(screenshots, `build-xi-scrolled-${viewport.width}.png`) });
  await page.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: resolve(screenshots, `build-xi-top-${viewport.width}.png`) });
};
const slot = (page, group, number) => page.locator(group === "Playing XI" ? ".lineup-xi-slots .lineup-slot" : ".lineup-bench .lineup-slot").nth(number - 1);
const captain = page => page.locator('[data-leadership="captainId"]');
const viceCaptain = page => page.locator('[data-leadership="viceCaptainId"]');
const values = (page, selector) => page.locator(selector).evaluateAll(elements => elements.map(element => element.dataset.playerId || null));
const choose = async (page, group, number, player) => {
  await slot(page, group, number).locator(".lineup-slot-pick").click();
  await page.getByRole("dialog", { name: `${group === "Playing XI" ? "XI" : "Substitute"} position ${number}`, exact: true }).waitFor();
  await page.getByRole("searchbox", { name: "Search your squad", exact: true }).fill(player.name);
  await page.getByRole("button", { name: `Select ${player.name}`, exact: true }).click();
};
const manage = async (page, player) => {
  const close = page.getByRole("button", { name: "Close player controls", exact: true });
  if ((page.viewportSize()?.width ?? 1440) <= 940 && await close.isVisible()) await close.click();
  await page.getByRole("button", { name: `Manage ${player.name}`, exact: true }).click();
};
const appoint = async (page, player, role = "captain") => {
  await manage(page, player);
  await page.getByRole("button", { name: `Make ${player.name} ${role}`, exact: true }).click();
  if ((page.viewportSize()?.width ?? 1440) <= 940) await page.getByRole("button", { name: "Close player controls", exact: true }).click();
};
const observedVersion = async (page, member, version) => {
  await page.bringToFront();
  await page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || new URL(response.url()).pathname !== pathFor(member) || !response.ok()) return false;
    try { const value = await response.json(); return (value.state?.version ?? value.version ?? -1) >= version; }
    catch { return false; }
  }, { timeout: 20000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
const financials = state => ({
  currentPlayerId: state.currentPlayerId, currentBid: state.currentBid, leadingTeamId: state.leadingTeamId,
  phase: state.phase, bidHistory: state.bidHistory, players: state.players,
  teams: state.teams.map(team => ({ ...team, lineup: undefined })),
});
const watch = page => {
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(new URL(request.url()).pathname));
};
const openMember = async (member, view = "room") => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const access = accessFor(member);
  await context.addInitScript(access => {
    localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access));
    localStorage.setItem("pavilion-active-room", access.code);
  }, access);
  const page = await context.newPage();
  watch(page);
  await page.goto(`${base}/?room=${access.code}&view=${view}`);
  await page.locator(".app-shell.in-auction").waitFor();
  return { context, page };
};
const palette = page => page.evaluate(() => ({
  primary: getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--franchise-accent"),
  navigation: getComputedStyle(document.querySelector(".nav-item.active")).color,
  background: getComputedStyle(document.querySelector(".app-shell")).backgroundColor,
}));
const assertLineup = async (page, expected) => {
  const pad = (ids, length) => Array.from({ length }, (_, index) => ids[index] ?? null);
  assert.deepEqual(await values(page, '.lineup-xi-slots .lineup-slot'), pad(expected.playingXI, 11));
  assert.deepEqual(await values(page, '.lineup-bench .lineup-slot'), pad(expected.substitutes, 5));
  assert.equal(await captain(page).getAttribute("data-player-id"), expected.captainId ?? "");
  assert.equal(await viceCaptain(page).getAttribute("data-player-id"), expected.viceCaptainId ?? "");
};
const saveThroughUI = async page => {
  const response = page.waitForResponse(response => response.url().includes("/action") && response.request().method() === "POST" && response.request().postDataJSON()?.action?.type === "set_lineup");
  await page.getByRole("button", { name: "Save lineup", exact: true }).click();
  const saved = await response;
  assert.equal(saved.status(), 200, await saved.text());
  await page.getByText("Lineup saved to your room.", { exact: true }).waitFor();
  return (await saved.json()).state;
};

try {
  const host = await request("/api/rooms", { body: { name: "Franchise and lineup browser check", hostName: "Browser auctioneer" } });
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword } : {}) } });
  const owner = await join("RCB browser manager", "rcb");
  const rival = await join("MI browser manager", "mi");
  const spectator = await join("Browser spectator");
  const candidates = host.state.players.filter(player => player.status === "available" && player.eligibilityVerified !== false && !player.isOverseas).slice(0, 17);
  assert.equal(candidates.length, 17);
  const ids = candidates.map(player => player.id);
  const buy = async player => {
    await act(host, { type: "select_player", playerId: player.id });
    await act(host, { type: "start" });
    await act(owner, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice });
    await act(host, { type: "lock" });
    await act(host, { type: "sell" });
  };
  for (const player of candidates.slice(0, 16)) await buy(player);

  const managerBrowser = await openMember(owner);
  const page = managerBrowser.page;
  const rivalBrowser = await openMember(rival);
  await page.waitForFunction(() => document.documentElement.dataset.franchise === "rcb");
  await rivalBrowser.page.waitForFunction(() => document.documentElement.dataset.franchise === "mi");
  assert.equal(await page.locator(".app-shell").getAttribute("data-franchise"), "rcb");
  assert.equal(await rivalBrowser.page.locator(".app-shell").getAttribute("data-franchise"), "mi");
  assert.equal(await page.locator(".franchise-hero-copy p").innerText(), "Royal Challengers Bengaluru");
  assert.equal(await rivalBrowser.page.locator(".franchise-hero-copy p").innerText(), "Mumbai Indians");
  for (const themedPage of [page, rivalBrowser.page]) {
    await themedPage.locator(".franchise-hero-crest img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.equal(await themedPage.locator(".franchise-hero-crest img").count(), 1);
    assert.equal(await overflow(themedPage), false);
  }
  const rcbPalette = await palette(page);
  const miPalette = await palette(rivalBrowser.page);
  for (const key of ["primary", "navigation", "background"]) assert.notEqual(rcbPalette[key], miPalette[key], `${key} must follow each participant's own franchise`);
  await rivalBrowser.context.close();
  for (const member of [host, spectator]) {
    const neutral = await openMember(member, "my-squad");
    assert.equal(await neutral.page.locator(".app-shell").getAttribute("data-franchise"), null);
    assert.equal(await neutral.page.evaluate(() => document.documentElement.dataset.franchise), undefined);
    assert.equal(await neutral.page.locator(".franchise-hero, .lineup-builder").count(), 0);
    assert.equal(await nav(neutral.page, "Build my XI").count(), 0);
    if (member === host) {
      assert.equal(await nav(neutral.page, "My Squad").count(), 0);
      await neutral.page.locator(".app-shell.tab-room").waitFor();
      assert.equal(new URL(neutral.page.url()).searchParams.get("view"), "room");
    } else {
      await neutral.page.getByRole("heading", { name: "You’re watching from the pavilion.", exact: true }).waitFor();
    }
    await neutral.page.goto(`${base}/?room=${member.state.code}&view=build-xi`);
    await neutral.page.locator(".app-shell.in-auction.tab-room").waitFor();
    assert.equal(new URL(neutral.page.url()).searchParams.get("view"), "room");
    assert.equal(await neutral.page.locator(".lineup-builder").count(), 0);
    await neutral.context.close();
  }
  console.log("PASS: independent RCB/MI browsers receive their own franchise themes; auctioneers have no personal pages and direct URLs are guarded; spectators cannot build a team.");

  await page.bringToFront();
  await clickNav(page, "My Squad");
  await page.getByRole("heading", { name: "Your signings", exact: true }).waitFor();
  assert.equal(await page.locator(".personal-squad-player").count(), 16);
  assert.equal(await page.locator(".personal-squad .lineup-builder").count(), 0, "My Squad is a gallery, not a lineup editor");
  assert.equal(await page.locator(".lineup-builder:visible").count(), 0);
  await clickNav(page, "Build my XI");
  await page.locator(".lineup-builder:visible").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("view"), "build-xi");
  assert.equal(await page.locator(".personal-squad:visible").count(), 0, "Build my XI is a separate page");
  assert.equal(await page.locator(".lineup-builder select").count(), 0, "position and leadership controls do not use dropdowns");
  assert.equal(await page.locator(".lineup-slot-pick:enabled").count(), 16, "every position can be opened before an opener is selected");
  await navigationGeometry(page);
  await page.evaluate(() => document.fonts.ready);
  await capture(page, "build-xi-empty-1440.png");
  await choose(page, "Playing XI", 7, candidates[6]);
  await choose(page, "Substitute", 5, candidates[15]);
  const partial = { playingXI: [...Array(6).fill(null), ids[6]], substitutes: [...Array(4).fill(null), ids[15]], captainId: null, viceCaptainId: null };
  const partialSaved = await saveThroughUI(page);
  assert.deepEqual(team(partialSaved).lineup, { ...partial, revision: 1 });
  await page.reload();
  await page.locator(".lineup-builder:visible").waitFor();
  await assertLineup(page, partial);
  console.log("PASS: XI position seven and substitute five can be assigned first; earlier empty positions remain empty after save and reload.");
  for (let index = 0; index < 11; index += 1) if (index !== 6) await choose(page, "Playing XI", index + 1, candidates[index]);
  for (let index = 0; index < 4; index += 1) await choose(page, "Substitute", index + 1, candidates[index + 11]);
  await appoint(page, candidates[0]);
  await appoint(page, candidates[1], "vice captain");
  const complete = { playingXI: ids.slice(0, 11), substitutes: ids.slice(11, 16), captainId: ids[0], viceCaptainId: ids[1] };
  await assertLineup(page, complete);
  await slot(page, "Playing XI", 1).locator(".lineup-slot-pick").click();
  assert.equal(await page.getByRole("button", { name: `Select ${candidates[1].name}`, exact: true }).isDisabled(), true, "another XI slot cannot be selected twice");
  assert.equal(await page.getByRole("button", { name: `Select ${candidates[11].name}`, exact: true }).isDisabled(), true, "substitutes cannot also enter the XI");
  await page.keyboard.press("Escape");
  assert.equal(await slot(page, "Playing XI", 1).locator(".lineup-slot-pick").evaluate(element => element === document.activeElement), true, "Escape returns keyboard focus to the position that opened the picker");
  await manage(page, candidates[1]);
  assert.equal(await page.getByRole("button", { name: `Make ${candidates[1].name} captain`, exact: true }).isDisabled(), true, "the vice-captain cannot simultaneously be captain");
  await clickNav(page, "Auction room");
  await page.locator(".auction-layout").waitFor();
  await clickNav(page, "Build my XI");
  await assertLineup(page, complete);
  await act(rival, { type: "chat", text: "Checking the live lineup updates" });
  await act(host, { type: "select_player", playerId: candidates[16].id });
  const newLot = page.locator(".new-lot-notice").filter({ hasText: candidates[16].name });
  await newLot.waitFor();
  assert.equal(new URL(page.url()).searchParams.get("view"), "build-xi", "a new lot must not interrupt a lineup draft");
  await newLot.getByRole("button", { name: "View auction", exact: true }).click();
  await page.locator(".auction-layout").waitFor();
  await clickNav(page, "Build my XI");
  await assertLineup(page, complete);
  await act(host, { type: "start" });
  await act(owner, { type: "bid", expectedPlayerId: candidates[16].id, expectedAmount: candidates[16].basePrice });
  await act(host, { type: "lock" });
  const lastPurchase = (await act(host, { type: "sell" })).state;
  await page.bringToFront();
  await observedVersion(page, owner, lastPurchase.version);
  await assertLineup(page, complete);
  await slot(page, "Playing XI", 1).locator(".lineup-slot-pick").click();
  assert.equal(await page.getByRole("button", { name: `Select ${candidates[16].name}`, exact: true }).isEnabled(), true, "a new purchase is available without clearing the dirty draft");
  await page.getByRole("button", { name: "Close player picker", exact: true }).click();
  const saved = await saveThroughUI(page);
  assert.deepEqual(team(saved).lineup, { ...complete, revision: 2 });
  assert.deepEqual(financials(saved), financials(lastPurchase), "lineup saves cannot change any purchases, purses or bidding state");
  await page.reload();
  await page.locator(".lineup-builder:visible").waitFor();
  await assertLineup(page, complete);
  assert.equal(await overflow(page), false);
  await lineupGeometry(page);
  await stickySaveGeometry(page);
  await page.evaluate(() => document.fonts.ready);
  await capture(page, "franchise-lineup-1440.png");
  console.log("PASS: the full XI, five substitutes and leadership survive navigation/polls/new purchases, save through the UI, and restore after a page reload.");

  const second = await managerBrowser.context.newPage();
  watch(second);
  await second.goto(`${base}/?room=${owner.state.code}&view=build-xi`);
  await second.locator(".lineup-builder:visible").waitFor();
  await appoint(page, candidates[2]);
  await second.bringToFront();
  await appoint(second, candidates[3]);
  const remote = await saveThroughUI(second);
  assert.equal(team(remote).lineup.revision, 3);
  await page.bringToFront();
  await page.locator(".lineup-warning").filter({ hasText: "A newer lineup was saved in another tab." }).waitFor();
  assert.equal(await captain(page).getAttribute("data-player-id"), ids[2], "a remote save must preserve the local draft until the manager chooses to reload it");
  assert.equal(await page.getByRole("button", { name: "Save lineup", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Reload saved lineup", exact: true }).click();
  assert.equal(await captain(page).getAttribute("data-player-id"), ids[3]);
  assert.equal(await page.locator(".lineup-warning").count(), 0);
  await second.close();
  console.log("PASS: two manager tabs cannot overwrite each other; the unsaved draft remains visible until Reload saved lineup is chosen.");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await overflow(page), false);
  await manage(page, candidates[0]);
  await page.getByRole("button", { name: `Move ${candidates[0].name} down in batting order`, exact: true }).click();
  assert.equal(await slot(page, "Playing XI", 1).getAttribute("data-player-id"), ids[1]);
  assert.equal(await slot(page, "Playing XI", 2).getAttribute("data-player-id"), ids[0]);
  assert.equal(await captain(page).getAttribute("data-player-id"), ids[3], "reordering must preserve leadership by player identity");
  await manage(page, candidates[3]);
  await page.getByRole("button", { name: `Remove ${candidates[3].name} from playing XI`, exact: true }).click();
  assert.equal(await captain(page).getAttribute("data-player-id"), "", "removing the captain from the XI clears that appointment");
  assert.equal(await slot(page, "Playing XI", 4).getAttribute("data-player-id"), "", "removing position four leaves its slot empty");
  assert.equal(await slot(page, "Playing XI", 5).getAttribute("data-player-id"), ids[4], "removing one player never shifts the remaining batting order");
  await choose(page, "Playing XI", 4, candidates[3]);
  await appoint(page, candidates[3]);
  const mobileSaved = await saveThroughUI(page);
  assert.equal(team(mobileSaved).lineup.revision, 4);
  assert.equal(team(mobileSaved).lineup.playingXI.length, 11);
  assert.equal(team(mobileSaved).lineup.substitutes.length, 5);
  assert.equal(team(mobileSaved).lineup.captainId, ids[3]);
  assert.equal(await overflow(page), false);
  await capture(page, "franchise-lineup-390.png");
  assert.deepEqual(team(await read(owner)).lineup, team(mobileSaved).lineup);
  assert.deepEqual(financials(await read(owner)), financials(lastPurchase), "reordering and leadership updates must preserve every financial record");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    assert.equal(await overflow(page), false, `Build my XI must fit ${width}px`);
    await lineupGeometry(page);
    await stickySaveGeometry(page);
    const pickerTrigger = slot(page, "Playing XI", 7).locator(".lineup-slot-pick");
    await pickerTrigger.focus();
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "XI position 7", exact: true });
    await picker.waitFor();
    assert.equal(await picker.evaluate(element => element.scrollWidth > element.clientWidth), false, `player picker must fit ${width}px`);
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "detached" });
    assert.equal(await pickerTrigger.evaluate(element => element === document.activeElement), true);
    await capture(page, `build-xi-${width}.png`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await manage(page, candidates[2]);
  const upcoming = host.state.players.find(player => !ids.includes(player.id) && player.status === "available" && player.eligibilityVerified !== false);
  assert.ok(upcoming);
  const nominated = (await act(host, { type: "select_player", playerId: upcoming.id })).state;
  await observedVersion(page, owner, nominated.version);
  const mobileNotice = page.locator(".new-lot-notice").filter({ hasText: upcoming.name });
  assert.equal(await mobileNotice.count(), 1, "a new lot is retained while the mobile player controls are open");
  assert.equal(await mobileNotice.isVisible(), false, "the lot notification cannot cover mobile lineup controls");
  await page.keyboard.press("Escape");
  await mobileNotice.waitFor({ state: "visible" });
  await mobileNotice.getByRole("button", { name: "View auction", exact: true }).click();
  await page.locator(".auction-layout").waitFor();
  await clickNav(page, "Build my XI");
  await assertLineup(page, team(mobileSaved).lineup);
  console.log("PASS: mobile player controls temporarily defer new-lot banners; Escape reveals the notification and visiting the auction preserves the lineup.");
  await page.getByRole("link", { name: "Pavilion home", exact: true }).click();
  await page.locator(".app-shell.in-lobby").waitFor();
  await page.waitForFunction(() => !document.documentElement.dataset.franchise);
  assert.equal(await page.locator(".app-shell").getAttribute("data-franchise"), null);
  assert.equal(await page.locator(".cinematic-cast-player img").count(), 8);
  assert.equal(await page.locator(".lineup-builder, .franchise-hero").count(), 0);
  assert.equal(await overflow(page), false);
  assert.deepEqual(errors, []);
  assert.equal(requests.some(path => /\.(mp4|webm)$/.test(path)), false);
  console.log("PASS: mobile editing, batting-order moves and leadership cleanup work without horizontal overflow; Home restores the neutral eight-player design.");
} finally {
  await browser.close();
}
