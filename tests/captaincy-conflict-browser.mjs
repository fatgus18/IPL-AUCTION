import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Run only against the isolated test database.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const errors = [];
const api = async (path, { member, body } = {}) => {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(member ? { Authorization: `Bearer ${member.token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${response.status}: ${value.error}`);
  return value;
};
const roomPath = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => api(`${roomPath(member)}/action`, { member, body: { action } }).then(result => result.state);
const read = member => api(roomPath(member), { member }).then(result => result.state);
const team = state => state.teams.find(entry => entry.id === "rcb");
const slot = (page, index) => page.locator(".lineup-xi-slots .lineup-slot").nth(index);
const leader = (page, role) => page.locator(`.lineup-leader[data-leadership="${role}"]`);
const lineupResponse = response => response.request().method() === "POST" && response.url().endsWith("/action") && response.request().postDataJSON()?.action?.type === "set_lineup";
const saveButton = page => page.getByRole("button", { name: "Save lineup", exact: true });
const reorderDown = async (page, player) => {
  await page.getByRole("button", { name: `Manage ${player.name}`, exact: true }).click();
  await page.getByRole("button", { name: `Move ${player.name} down in batting order`, exact: true }).click();
};

// Hold the already-submitted stale action until the competing update is durable.
// This exercises the server's real revision rejection, not a mocked error response.
const saveWithRace = async (page, owner, remoteUpdate) => {
  const pattern = `**${roomPath(owner)}/action`;
  let intercepted;
  let remote;
  let routeError;
  const handler = async route => {
    const action = route.request().postDataJSON()?.action;
    if (action?.type !== "set_lineup" || intercepted) return route.continue();
    intercepted = action;
    try {
      remote = await remoteUpdate(action);
      await route.continue();
    } catch (error) {
      routeError = error;
      await route.abort();
    }
  };
  await page.route(pattern, handler);
  try {
    const responsePromise = page.waitForResponse(lineupResponse);
    await saveButton(page).click();
    const response = await responsePromise;
    if (routeError) throw routeError;
    assert.equal(response.status(), 409, "The original save must reach the server with its stale revision.");
    assert.equal((await response.json()).code, "LINEUP_CONFLICT");
    await page.locator('.lineup-builder[aria-busy="false"]').waitFor();
    assert.ok(intercepted && remote);
    return { intercepted, remote };
  } finally {
    await page.unroute(pattern, handler);
  }
};

let host;
try {
  host = await api("/api/rooms", { body: { name: "Captaincy conflict recovery", hostName: "Conflict creator" } });
  const { teamPassword } = await api(`${roomPath(host)}/access`, { member: host, body: {} });
  const owner = await api(`${roomPath(host)}/join`, { body: { name: "RCB conflict manager", teamId: "rcb", teamPassword } });
  const players = host.state.players.filter(player => player.status === "available" && player.eligibilityVerified !== false && !player.catalogArchived && !player.isOverseas).slice(0, 3);
  assert.equal(players.length, 3);
  for (const player of players) {
    await act(host, { type: "select_player", playerId: player.id });
    await act(host, { type: "start" });
    await act(owner, { type: "bid", expectedPlayerId: player.id, expectedAmount: Math.max(25, Math.ceil(player.basePrice / 25) * 25) });
    await act(host, { type: "lock" });
    await act(host, { type: "sell" });
  }
  const ids = players.map(player => player.id);
  await act(owner, { type: "set_lineup", teamId: "rcb", expectedRevision: 0, lineup: { playingXI: [ids[0], ids[1]], substitutes: [], captainId: ids[0], viceCaptainId: ids[1] } });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), { code: owner.state.code, token: owner.token, memberId: owner.memberId });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${owner.state.code}&view=build-xi`);
  await page.locator(".lineup-builder:visible").waitFor();

  await reorderDown(page, players[0]);
  const first = await saveWithRace(page, owner, stale => act(owner, { type: "set_captaincy", teamId: "rcb", captainId: ids[2], viceCaptainId: ids[1], expectedRevision: stale.expectedRevision }));
  await page.locator(`.lineup-leader[data-leadership="captainId"][data-player-id="${ids[2]}"]`).waitFor();
  await page.waitForFunction(() => document.querySelector(".lineup-save")?.disabled === false);
  assert.equal(await slot(page, 0).getAttribute("data-player-id"), ids[1], "The position draft survives the rejected save.");
  assert.equal(await slot(page, 1).getAttribute("data-player-id"), ids[0]);
  assert.equal(await leader(page, "viceCaptainId").getAttribute("data-player-id"), ids[1]);
  assert.equal(await page.locator(".lineup-warning, .lineup-error").count(), 0, "A safe captaincy merge must clear the stale conflict feedback.");
  const retryResponse = page.waitForResponse(lineupResponse);
  await saveButton(page).click();
  const retried = await retryResponse;
  assert.equal(retried.status(), 200);
  const retryAction = retried.request().postDataJSON().action;
  assert.equal(retryAction.expectedRevision, team(first.remote).lineup.revision, "Retry uses the refreshed revision.");
  const saved = team((await retried.json()).state).lineup;
  assert.deepEqual(saved.playingXI.slice(0, 2), [ids[1], ids[0]]);
  assert.equal(saved.captainId, ids[2]);
  assert.equal(saved.viceCaptainId, ids[1]);
  await page.getByText("Lineup saved to your room.", { exact: true }).waitFor();
  console.log("PASS: a real 409 from a captaincy-only race permits retry without reloading or losing the XI draft or latest leaders.");

  await reorderDown(page, players[1]);
  const positions = await saveWithRace(page, owner, async stale => {
    const latest = team(await read(owner)).lineup;
    return act(owner, { type: "set_lineup", teamId: "rcb", expectedRevision: stale.expectedRevision, lineup: { ...latest, playingXI: [ids[1], ids[0], ids[2]] } });
  });
  await page.locator(".lineup-warning").filter({ hasText: "Your lineup or captaincy changed elsewhere." }).waitFor();
  assert.equal(await saveButton(page).isDisabled(), true, "Overlapping position changes must still require review.");
  assert.equal(await slot(page, 0).getAttribute("data-player-id"), ids[0]);
  assert.equal(await slot(page, 2).getAttribute("data-player-id"), "", "The server's positions cannot silently replace the draft.");
  assert.deepEqual(team(await read(owner)).lineup, team(positions.remote).lineup);
  await page.getByRole("button", { name: "Reload saved lineup", exact: true }).click();
  assert.equal(await slot(page, 2).getAttribute("data-player-id"), ids[2]);

  await page.getByRole("button", { name: `Manage ${players[0].name}`, exact: true }).click();
  await page.getByRole("button", { name: `Make ${players[0].name} captain`, exact: true }).click();
  const leadership = await saveWithRace(page, owner, stale => act(owner, { type: "set_captaincy", teamId: "rcb", captainId: ids[1], viceCaptainId: ids[2], expectedRevision: stale.expectedRevision }));
  await page.locator(".lineup-warning").filter({ hasText: "Your lineup or captaincy changed elsewhere." }).waitFor();
  assert.equal(await saveButton(page).isDisabled(), true, "Overlapping leadership changes must not be merged.");
  assert.equal(await leader(page, "captainId").getAttribute("data-player-id"), ids[0], "The unsaved leadership choice remains visible for review.");
  assert.deepEqual(team(await read(owner)).lineup, team(leadership.remote).lineup);
  await page.getByRole("button", { name: "Reload saved lineup", exact: true }).click();
  assert.equal(await leader(page, "captainId").getAttribute("data-player-id"), ids[1]);
  assert.equal(await leader(page, "viceCaptainId").getAttribute("data-player-id"), ids[2]);
  assert.deepEqual(errors, []);
  console.log("PASS: real position conflicts and locally edited leadership remain protected from automatic overwrites.");
} finally {
  await browser.close();
  if (host) await api(`${roomPath(host)}/delete`, { member: host, body: { confirmationCode: host.state.code } });
}
