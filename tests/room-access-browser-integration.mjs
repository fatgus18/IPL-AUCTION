import { navigateTo, navigationItem as nav } from "./browser-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated API runner, never a user's auction database.");
assert.ok(process.env.DATABASE_URL, "The isolated runner must supply a temporary database.");
assert.ok(process.env.BASE_URL, "The isolated runner must supply its own server URL.");
const base = process.env.BASE_URL;
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const screenshots = resolve(".sites-runtime/screenshots");
const browserErrors = [];
const secrets = [];
const calls = [];
const newPage = async (width = 1440) => {
  const context = await browser.newContext({ viewport: { width, height: width > 1000 ? 1000 : 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("request", request => calls.push({ page, path: new URL(request.url()).pathname, method: request.method() }));
  return page;
};
const clickNav = async (page, name) => {
  await navigateTo(page, name);
};
const joinDialog = page => page.getByRole("dialog", { name: "Join auction room", exact: true });
const roomAccess = (page, code) => page.evaluate(code => JSON.parse(localStorage.getItem(`pavilion-session-${code}`)), code);
const request = async (path, body, token) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
};
const stateFor = async access => {
  const response = await request(`/api/rooms/${access.code}`, undefined, access.token);
  assert.equal(response.status, 200);
  return response.data.state;
};
const noPassword = (value, password, location) => {
  assert.ok(!JSON.stringify(value).includes(password), `The private password must not appear in ${location}.`);
};
const noStoredPassword = async (page, password) => {
  const saved = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  noPassword(saved, password, "browser storage");
  noPassword(page.url(), password, "the page URL");
};
const submitJoin = (page) => joinDialog(page).getByRole("button", { name: "Join auction room", exact: true }).click();
const noCreatorControls = async page => {
  await clickNav(page, "Room settings");
  await page.getByRole("heading", { name: "Room settings", exact: true }).waitFor();
  assert.equal(await page.locator(".room-access-panel").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Delete room", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Team password", { exact: true }).count(), 0);
};

try {
  const host = await newPage();
  await host.goto(base);
  await host.getByRole("button", { name: "Create an auction", exact: true }).click();
  const create = host.getByRole("dialog", { name: "Create auction room", exact: true });
  await create.getByLabel("Your name", { exact: true }).fill("Access Browser Host");
  await create.getByLabel("Room name", { exact: true }).fill("Private team access browser verification");
  const createdResponse = host.waitForResponse(response => new URL(response.url()).pathname === "/api/rooms" && response.request().method() === "POST");
  await create.getByRole("button", { name: "Create auction room", exact: true }).click();
  const createdData = await (await createdResponse).json();
  await nav(host, "Room settings").waitFor();
  const code = new URL(host.url()).searchParams.get("room");
  assert.match(code, /^[A-Z0-9]{6}$/);
  const hostAccess = await roomAccess(host, code);
  assert.ok(hostAccess?.token);
  secrets.push(hostAccess.token);

  await clickNav(host, "Room settings");
  const passwordInput = host.getByLabel("Team password", { exact: true });
  await passwordInput.waitFor();
  const teamPassword = await passwordInput.inputValue();
  secrets.push(teamPassword);
  assert.ok(teamPassword.length >= 16, "The room gets a strong generated team password.");
  assert.equal(await passwordInput.getAttribute("type"), "password");
  await host.getByRole("button", { name: "Show team password", exact: true }).click();
  assert.equal(await passwordInput.getAttribute("type"), "text");
  await host.reload();
  await passwordInput.waitFor();
  assert.equal(await passwordInput.getAttribute("type"), "password", "Reload must reset the private field to masked.");
  assert.ok(await passwordInput.inputValue() === teamPassword, "The creator password stays stable across reload.");
  noPassword(createdData, teamPassword, "the room creation response");
  noPassword(await stateFor(hostAccess), teamPassword, "a regular room snapshot");
  await noStoredPassword(host, teamPassword);
  await host.evaluate(() => document.fonts.ready);
  await mkdir(screenshots, { recursive: true });
  await host.locator(".room-access-panel").screenshot({ path: resolve(screenshots, "room-access-masked.png") });
  await host.getByRole("button", { name: "Invite people", exact: true }).click();
  const invite = host.getByRole("dialog", { name: "Invite people", exact: true });
  const invitation = await invite.getByLabel("Room invitation link", { exact: true }).inputValue();
  assert.equal(new URL(invitation).search, `?room=${code}`);
  noPassword(invitation, teamPassword, "the invitation URL");
  noPassword(await invite.innerText(), teamPassword, "the invitation dialog");
  await invite.getByRole("button", { name: "Close dialog", exact: true }).click();
  console.log("PASS: creator password is private, masked by default, stable after reload, and absent from storage, invitations and ordinary responses.");

  const spectator = await newPage();
  await spectator.goto(`${base}/?room=${code}`);
  const spectatorJoin = joinDialog(spectator);
  await spectatorJoin.waitFor();
  assert.equal(await spectatorJoin.locator("select").inputValue(), "", "New visitors default to spectator.");
  assert.equal(await spectatorJoin.getByLabel("Team password", { exact: true }).count(), 0);
  await spectatorJoin.getByLabel("Your name", { exact: true }).fill("Access Browser Spectator");
  await submitJoin(spectator);
  await spectator.locator(".in-auction").waitFor();
  const spectatorAccess = await roomAccess(spectator, code);
  secrets.push(spectatorAccess.token);
  let publicState = await stateFor(spectatorAccess);
  assert.equal(publicState.members.find(member => member.id === spectatorAccess.memberId).role, "spectator");
  noPassword(publicState, teamPassword, "a spectator response");
  await noCreatorControls(spectator);
  const privateDenied = await request(`/api/rooms/${code}/access`, {}, spectatorAccess.token);
  assert.equal(privateDenied.status, 403);
  noPassword(privateDenied.data, teamPassword, "a rejected private-access response");
  console.log("PASS: a new visitor joins freely as spectator and cannot view creator controls or the private password.");

  const bidder = await newPage();
  await bidder.goto(`${base}/?room=${code}`);
  const bidderJoin = joinDialog(bidder);
  await bidderJoin.getByLabel("Your name", { exact: true }).fill("Access Browser Bidder");
  await bidderJoin.locator("select").selectOption("mi");
  await bidderJoin.getByLabel("Team password", { exact: true }).fill("DefinitelyWrongPassword");
  const beforeWrong = (await stateFor(hostAccess)).members.length;
  const wrongResponse = bidder.waitForResponse(response => new URL(response.url()).pathname === `/api/rooms/${code}/join` && response.request().method() === "POST");
  await submitJoin(bidder);
  assert.equal((await wrongResponse).status(), 403);
  await bidderJoin.getByRole("alert").waitFor();
  assert.match(await bidderJoin.getByRole("alert").innerText(), /password/i);
  assert.equal((await stateFor(hostAccess)).members.length, beforeWrong, "An invalid password must not create a member.");
  assert.equal(await roomAccess(bidder, code), null);
  await bidderJoin.getByLabel("Team password", { exact: true }).fill(teamPassword);
  await submitJoin(bidder);
  await bidder.locator(".in-auction").waitFor();
  const bidderAccess = await roomAccess(bidder, code);
  secrets.push(bidderAccess.token);
  publicState = await stateFor(bidderAccess);
  const bidderMember = publicState.members.find(member => member.id === bidderAccess.memberId);
  assert.equal(bidderMember.role, "bidder");
  assert.equal(bidderMember.teamId, "mi");
  noPassword(publicState, teamPassword, "a bidder response");
  await noStoredPassword(bidder, teamPassword);
  await noCreatorControls(bidder);
  console.log("PASS: incorrect team passwords fail without taking a seat; the correct password admits a bidder with no creator controls.");

  // A saved spectator must claim a team on that same membership, not join again.
  const beforeUpgrade = (await stateFor(hostAccess)).members.length;
  const joinsBeforeUpgrade = calls.filter(call => call.page === spectator && call.path === `/api/rooms/${code}/join`).length;
  await spectator.getByRole("link", { name: "Pavilion home", exact: true }).click();
  await spectator.locator(".in-lobby").waitFor();
  await spectator.getByRole("button", { name: "Join a room", exact: true }).click();
  await spectatorJoin.getByLabel("Your name", { exact: true }).fill("Existing Spectator Seat");
  await spectatorJoin.getByLabel("Room code", { exact: true }).fill(code);
  await spectatorJoin.locator("select").selectOption("rcb");
  await spectatorJoin.getByLabel("Team password", { exact: true }).fill(teamPassword);
  await submitJoin(spectator);
  await spectator.locator(".in-auction").waitFor();
  const upgradedAccess = await roomAccess(spectator, code);
  assert.ok(JSON.stringify(upgradedAccess) === JSON.stringify(spectatorAccess), "Upgrading a spectator preserves the original member and credential.");
  const upgraded = await stateFor(upgradedAccess);
  assert.equal(upgraded.members.length, beforeUpgrade);
  assert.equal(upgraded.members.find(member => member.id === spectatorAccess.memberId).teamId, "rcb");
  assert.equal(upgraded.members.find(member => member.id === spectatorAccess.memberId).role, "bidder");
  assert.equal(calls.filter(call => call.page === spectator && call.path === `/api/rooms/${code}/join`).length, joinsBeforeUpgrade);
  await noStoredPassword(spectator, teamPassword);
  console.log("PASS: an existing spectator can claim a team using the password while retaining their exact member and credential.");

  const watcher = await newPage(390);
  await watcher.goto(`${base}/?room=${code}`);
  await joinDialog(watcher).getByLabel("Your name", { exact: true }).fill("Access Mobile Spectator");
  await submitJoin(watcher);
  await watcher.locator(".in-auction").waitFor();
  await noCreatorControls(watcher);
  const watcherAccess = await roomAccess(watcher, code);
  secrets.push(watcherAccess.token);
  const catalogBefore = await request("/api/players/catalog");

  await host.getByRole("button", { name: "Delete room", exact: true }).click();
  const deletion = host.getByRole("dialog", { name: "Delete auction room?", exact: true });
  await deletion.waitFor();
  const deleteButton = deletion.getByRole("button", { name: "Permanently delete", exact: true });
  assert.equal(await deleteButton.isDisabled(), true);
  await deletion.locator("input").fill("WRONG");
  assert.equal(await deleteButton.isDisabled(), true);
  await deletion.getByRole("button", { name: "Keep room", exact: true }).click();
  await deletion.waitFor({ state: "hidden" });
  assert.equal((await request(`/api/rooms/${code}`, undefined, hostAccess.token)).status, 200);
  assert.equal(calls.filter(call => call.path === `/api/rooms/${code}/delete`).length, 0, "Cancelling must not send a deletion request.");
  await host.getByRole("button", { name: "Delete room", exact: true }).click();
  await deletion.locator("input").fill(code.toLowerCase());
  assert.equal(await deleteButton.isEnabled(), true);
  const deletedResponse = host.waitForResponse(response => new URL(response.url()).pathname === `/api/rooms/${code}/delete` && response.request().method() === "POST");
  const deletedNotice = "This room has been deleted by its creator. The shared player pool is unchanged.";
  await Promise.all([
    deleteButton.click(),
    ...[host, bidder, spectator, watcher].map(async page => {
      await page.getByText(deletedNotice, { exact: true }).waitFor({ timeout: 25000 });
      await page.locator(".in-lobby").waitFor();
      assert.equal(new URL(page.url()).search, "");
      assert.equal(await nav(page, "Team squads").count(), 0);
      assert.equal(await roomAccess(page, code), null, "Deleted-room access is removed from the browser.");
      assert.equal(await page.locator(".room-access-panel, .offline-banner").count(), 0);
    }),
  ]);
  assert.equal((await deletedResponse).status(), 200);
  const catalogAfter = await request("/api/players/catalog");
  assert.deepEqual(catalogAfter, catalogBefore, "Room deletion must leave the shared catalog intact.");
  for (const access of [hostAccess, bidderAccess, spectatorAccess, watcherAccess]) {
    const ended = await request(`/api/rooms/${code}`, undefined, access.token);
    assert.equal(ended.status, 410);
    assert.equal(ended.data.code, "ROOM_DELETED");
  }
  console.log("PASS: typed deletion can be cancelled; confirmed deletion sends the creator, bidders and mobile spectator Home and preserves the shared pool.");

  const lateVisitor = await newPage();
  await lateVisitor.goto(`${base}/?room=${code}`);
  await joinDialog(lateVisitor).getByLabel("Your name", { exact: true }).fill("Late Browser Visitor");
  await submitJoin(lateVisitor);
  await joinDialog(lateVisitor).getByRole("alert").waitFor();
  assert.match(await joinDialog(lateVisitor).getByRole("alert").innerText(), /deleted/i);
  assert.equal(await lateVisitor.locator(".in-auction").count(), 0);
  assert.equal(await roomAccess(lateVisitor, code), null);
  await host.reload();
  await host.locator(".in-lobby").waitFor();
  assert.equal(await host.getByRole("dialog", { name: "Create auction room", exact: true }).count(), 0, "Deleted rooms must not reopen a pending creation recovery form.");

  // A stale browser may first learn about deletion while restoring its room URL.
  await bidder.evaluate(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), bidderAccess);
  await bidder.goto(`${base}/?room=${code}&view=my-squad`);
  await bidder.getByText(deletedNotice, { exact: true }).waitFor();
  await bidder.locator(".in-lobby").waitFor();
  assert.equal(new URL(bidder.url()).search, "");
  assert.equal(await roomAccess(bidder, code), null);

  // A previously unconfirmed creation must never resurrect the deleted auction.
  const createsBeforeRecovery = calls.filter(call => call.page === host && call.path === "/api/rooms" && call.method === "POST").length;
  await host.evaluate(creationKey => sessionStorage.setItem("pavilion-pending-room-creation", JSON.stringify({ creationKey, name: "Private team access browser verification", hostName: "Access Browser Host" })), hostAccess.token);
  await host.reload();
  await create.waitFor();
  await create.getByRole("button", { name: "Retry room creation", exact: true }).waitFor();
  assert.equal(calls.filter(call => call.page === host && call.path === "/api/rooms" && call.method === "POST").length, createsBeforeRecovery, "Restoring a pending creation must not automatically create a room.");
  const recoveryResponse = host.waitForResponse(response => new URL(response.url()).pathname === "/api/rooms" && response.request().method() === "POST");
  await create.getByRole("button", { name: "Retry room creation", exact: true }).click();
  assert.equal((await recoveryResponse).status(), 410);
  await create.getByText("That room was deleted. You can now create a new room.", { exact: true }).waitFor();
  assert.equal(await create.getByRole("button", { name: "Create auction room", exact: true }).isEnabled(), true);
  assert.equal(await host.evaluate(() => sessionStorage.getItem("pavilion-pending-room-creation")), null);
  assert.equal(calls.filter(call => call.page === host && call.path === "/api/rooms" && call.method === "POST").length, createsBeforeRecovery + 1, "A rejected recovery must not automatically start a replacement room.");
  assert.equal((await request(`/api/rooms/${code}`, undefined, hostAccess.token)).status, 410);
  await create.getByRole("button", { name: "Close dialog", exact: true }).click();
  for (const page of [host, bidder, spectator, watcher, lateVisitor]) await noStoredPassword(page, teamPassword);
  assert.ok(browserErrors.length === 0, `Browser errors occurred: ${browserErrors.join("; ")}`);
  console.log("PASS: old room links and stale saved credentials recover safely; rejected creation recovery clears its key without resurrecting or replacing the deleted room.");
  console.log("PASS: no private passwords are stored and no browser errors were emitted.");
} catch (cause) {
  // Playwright failures can include field values; never print private test credentials.
  let message = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  throw new Error(message);
} finally {
  await browser.close();
}
