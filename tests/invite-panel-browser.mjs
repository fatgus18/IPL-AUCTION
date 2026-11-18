import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated runner; never modify a user's room.");
const base = process.env.BASE_URL;
assert.ok(base, "The isolated runner must supply BASE_URL.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const errors = [];
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });

const request = async (path, body, token) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  assert.ok(response.ok, `Fixture request failed with HTTP ${response.status}`);
  return response.json();
};

async function openMember(member) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(access => {
    localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access));
    window.__clipboardValue = "";
    window.__failClipboard = false;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async value => {
        if (window.__failClipboard) throw new DOMException("Clipboard blocked for this test", "NotAllowedError");
        window.__clipboardValue = value;
      },
    } });
  }, { code: member.state.code, token: member.token, memberId: member.memberId });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", error => errors.push(error.message));
  const accessRequests = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.endsWith("/access")) accessRequests.push(request.url());
  });
  await page.goto(`${base}/?room=${member.state.code}`);
  await page.locator(".app-shell.in-auction").waitFor();
  return { page, context, accessRequests };
}

const invite = page => page.getByRole("dialog", { name: "Invite people", exact: true });
const openInvite = async page => {
  await page.getByRole("button", { name: "Invite people", exact: true }).click();
  await invite(page).waitFor();
};
const closeInvite = page => invite(page).getByRole("button", { name: "Close dialog", exact: true }).click();
const assertHidden = async (page, secret) => {
  const exposed = await page.evaluate(() => ({
    html: document.documentElement.outerHTML,
    inputValues: [...document.querySelectorAll("input,textarea")].map(input => input.value),
    local: { ...localStorage }, session: { ...sessionStorage }, url: location.href,
  }));
  assert.ok(!JSON.stringify(exposed).includes(secret), "The team password must stay out of DOM, attributes, inputs, URLs and browser storage.");
};
const clipboardEquals = async (page, value) => assert.ok(await page.evaluate(expected => window.__clipboardValue === expected, value), "Clipboard must contain the exact requested value.");

try {
  const host = await request("/api/rooms", { name: "Invitation copy verification", hostName: "Invite creator" });
  const roomPath = `/api/rooms/${host.state.code}`;
  const { teamPassword } = await request(`${roomPath}/access`, {}, host.token);
  const spectator = await request(`${roomPath}/join`, { name: "Invite spectator" });
  const bidder = await request(`${roomPath}/join`, { name: "Invite manager", teamId: "rcb", teamPassword });
  const { page, accessRequests } = await openMember(host);
  assert.equal(accessRequests.length, 0, "Password loading must wait until the creator opens an invitation.");
  await openInvite(page);
  const dialog = invite(page);
  const passwordCopy = dialog.getByRole("button", { name: "Copy team password", exact: true });
  await passwordCopy.waitFor();
  assert.equal(await passwordCopy.isEnabled(), true);
  assert.equal(accessRequests.length, 1);
  const link = dialog.getByLabel("Room invitation link", { exact: true });
  assert.equal(await link.inputValue(), `${base}/?room=${host.state.code}`);
  await dialog.getByRole("button", { name: "Copy invite link", exact: true }).click();
  await dialog.getByRole("button", { name: "Invite link copied", exact: true }).waitFor();
  await clipboardEquals(page, `${base}/?room=${host.state.code}`);
  await passwordCopy.click();
  await dialog.getByRole("button", { name: "Team password copied", exact: true }).waitFor();
  await clipboardEquals(page, teamPassword);
  await assertHidden(page, teamPassword);
  console.log("PASS: the creator copies the exact room link and a separately prefetched password without exposing the password in the page or storage.");

  await page.evaluate(() => { window.__failClipboard = true; });
  await dialog.getByRole("button", { name: "Team password copied", exact: true }).click();
  await dialog.getByText("Clipboard access was blocked. Your password stays hidden; try copying again.", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Team password copied", exact: true }).count(), 0);
  await assertHidden(page, teamPassword);
  await dialog.getByRole("button", { name: "Invite link copied", exact: true }).click();
  await dialog.getByText("Copy is unavailable. Select the invitation link above and copy it manually.", { exact: true }).waitFor();
  await page.evaluate(() => { window.__failClipboard = false; });
  await dialog.getByRole("button", { name: "Retry copying team password", exact: true }).click();
  await dialog.getByRole("button", { name: "Team password copied", exact: true }).waitFor();
  await clipboardEquals(page, teamPassword);
  await dialog.getByRole("button", { name: "Retry copying invite link", exact: true }).click();
  await dialog.getByRole("button", { name: "Invite link copied", exact: true }).waitFor();
  await clipboardEquals(page, `${base}/?room=${host.state.code}`);
  console.log("PASS: blocked clipboard writes show accurate feedback, keep the password concealed, and support a successful retry.");

  await closeInvite(page);
  let failLoad = true;
  await page.route(`**${roomPath}/access`, route => failLoad
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: teamPassword }) })
    : route.continue());
  await openInvite(page);
  await dialog.getByRole("button", { name: "Retry password load", exact: true }).waitFor();
  await assertHidden(page, teamPassword);
  failLoad = false;
  await dialog.getByRole("button", { name: "Retry password load", exact: true }).click();
  await passwordCopy.waitFor();
  await passwordCopy.click();
  await dialog.getByRole("button", { name: "Team password copied", exact: true }).waitFor();
  await clipboardEquals(page, teamPassword);
  await assertHidden(page, teamPassword);
  console.log("PASS: private-access fetch failures never display response content; creator retry loads and copies the password correctly.");

  await page.evaluate(() => document.fonts.ready);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false);
    for (const button of await dialog.locator("button").all()) {
      const box = await button.boundingBox();
      assert.ok(box && box.height >= 44, "Invitation controls must remain comfortably tappable.");
    }
    await page.screenshot({ path: resolve(screenshots, `invite-panel-${width}.png`) });
  }
  await closeInvite(page);
  await page.unroute(`**${roomPath}/access`);
  console.log("PASS: invitation layout and touch targets fit at 360, 390, 768 and 1440 pixels without horizontal overflow.");

  for (const [name, member] of [["spectator", spectator]]) {
    const other = await openMember(member);
    await openInvite(other.page);
    const otherInvite = invite(other.page);
    assert.equal(await otherInvite.locator(".invitation-private").count(), 0);
    assert.equal(await otherInvite.getByRole("button", { name: "Manage team password", exact: true }).count(), 0);
    assert.equal(other.accessRequests.length, 0, `A ${name} must not request the private creator endpoint.`);
    await otherInvite.getByRole("button", { name: "Copy invite link", exact: true }).click();
    await otherInvite.getByRole("button", { name: "Invite link copied", exact: true }).waitFor();
    await clipboardEquals(other.page, `${base}/?room=${host.state.code}`);
    await assertHidden(other.page, teamPassword);
    assert.equal(other.accessRequests.length, 0);
    await other.context.close();
  }
  const manager = await openMember(bidder);
  assert.equal(await manager.page.getByRole("button", { name: "Invite people", exact: true }).count(), 0, "The manager's compact identity header has no invitation entry point.");
  assert.equal(await manager.page.locator(".invitation-private").count(), 0);
  assert.equal(manager.accessRequests.length, 0, "A team manager must not request the private creator endpoint.");
  await assertHidden(manager.page, teamPassword);
  await manager.context.close();
  assert.deepEqual(errors, []);
  console.log("PASS: spectators can copy the public invitation; neither spectators nor team managers receive password controls or request the private creator endpoint.");
} finally {
  await browser.close();
}
