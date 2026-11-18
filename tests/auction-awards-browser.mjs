import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import ExcelJS from "exceljs";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Awards browser checks must only use isolated test rooms.");
const base = process.env.BASE_URL; assert.ok(base);
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const output = resolve(".sites-runtime/screenshots"); await mkdir(output, { recursive: true });
const errors = [], rooms = [];
const request = async (path, { token, body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const value = await response.json(); assert.ok(response.ok, `${response.status}: ${value.error}`); return value;
};
const pathFor = member => `/api/rooms/${member.state.code}`;
const act = (member, action) => request(`${pathFor(member)}/action`, { token: member.token, body: { action } }).then(value => value.state);
const read = member => request(pathFor(member), { token: member.token }).then(value => value.state);
const create = async name => { const room = await request("/api/rooms", { body: { name, hostName: "Honours creator" } }); rooms.push(room); return room; };
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const openMember = async member => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(access => localStorage.setItem(`pavilion-session-${access.code}`, JSON.stringify(access)), { code: member.state.code, token: member.token, memberId: member.memberId });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?room=${member.state.code}&view=room`);
  await page.locator(".app-shell.in-auction.tab-room").waitFor();
  await page.locator(".connection").filter({ hasText: "Connected" }).waitFor();
  return { page, context };
};
const refreshSnapshot = async (page, member, version) => {
  const observed = page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || new URL(response.url()).pathname !== pathFor(member) || !response.ok()) return false;
    try { const value = await response.json(); return (value.state?.version ?? value.version ?? -1) >= version; } catch { return false; }
  });
  await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await observed; await paint(page);
};
const card = (page, id) => page.locator(`.auction-award-card[data-award="${id}"]`);
const snapshot = page => page.locator(".auction-award-card").evaluateAll(cards => cards.map(card => ({
  id: card.getAttribute("data-award"), metric: card.querySelector(".award-card-metric")?.textContent,
  winners: [...card.querySelectorAll(".auction-award-winner strong")].map(winner => winner.textContent),
  explanation: card.querySelector(".award-criterion p")?.textContent,
  empty: card.querySelector(".award-empty")?.textContent,
})));
const noOverflow = async page => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `${page.viewportSize().width}px page overflow`);
  for (const article of await page.locator(".auction-award-card").all()) {
    assert.equal(await article.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, "award content must fit its card");
  }
};
const capture = async (page, name) => {
  await page.evaluate(() => document.fonts.ready); await paint(page);
  await page.locator(".auction-awards").screenshot({ path: resolve(output, name) });
};
const download = async (page, label, filename) => {
  const pending = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: label, exact: true }).click();
  const file = await pending; assert.equal(await file.failure(), null);
  const location = resolve(output, filename); await file.saveAs(location); return readFile(location);
};
// The application's PDFKit exports embed subset fonts. Decode their ToUnicode
// maps to check actual exported text, instead of assuming a PDF header proves it.
function pdfText(bytes) {
  const streams = [...bytes.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap(match => {
    try { return [inflateSync(Buffer.from(match[1], "latin1")).toString("latin1")]; } catch { return []; }
  });
  const maps = streams.filter(stream => stream.includes("begincmap")).map(stream => {
    const map = new Map();
    for (const match of stream.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]+)\]/gi)) {
      const first = parseInt(match[1], 16);
      [...match[3].matchAll(/<([0-9a-f\s]+)>/gi)].forEach((entry, index) => {
        const units = entry[1].replace(/\s/g, "").match(/.{4}/g) ?? [];
        map.set(first + index, String.fromCharCode(...units.map(unit => parseInt(unit, 16))));
      });
    }
    return map;
  });
  return streams.filter(stream => stream.includes("BT")).flatMap(stream => maps.map(map => [...stream.matchAll(/<([0-9a-f]+)>/gi)].map(match => (match[1].match(/.{4}/g) ?? []).map(unit => map.get(parseInt(unit, 16)) ?? "").join("")).join(""))).join("\n");
}

try {
  const host = await create("The Pavilion honours night");
  const { teamPassword } = await request(`${pathFor(host)}/access`, { token: host.token, body: {} });
  const join = (name, teamId) => request(`${pathFor(host)}/join`, { body: { name, ...(teamId ? { teamId, teamPassword } : {}) } });
  const red = await join("Honours RCB", "rcb"), blue = await join("Honours MI", "mi"), yellow = await join("Honours CSK", "csk"), titan = await join("Honours GT", "gt");
  const viewer = await join("Honours spectator");
  const players = host.state.players.filter(player => !player.isOverseas && player.eligibilityVerified !== false && !player.catalogArchived).slice(0, 5);
  await act(red, { type: "set_target_picks", teamId: "rcb", playerIds: [players[4].id], expectedRevision: 0, maxBids: { [players[4].id]: 98371 } });
  for (const [index, buyer] of [blue, red, yellow, titan].entries()) {
    const player = players[index];
    await act(host, { type: "select_player", playerId: player.id }); await act(host, { type: "start" });
    if (index === 0) {
      const bid = await act(red, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice, customAmount: 475 });
      await new Promise(resolve => setTimeout(resolve, Math.max(0, bid.lastBidAt + bid.settings.bidCooldownMs - Date.now() + 20)));
      await act(buyer, { type: "bid", expectedPlayerId: player.id, expectedAmount: 500, customAmount: 500 });
    } else await act(buyer, { type: "bid", expectedPlayerId: player.id, expectedAmount: player.basePrice, customAmount: 500 });
    await act(host, { type: "lock" }); await act(host, { type: "sell" });
  }
  const hostBrowser = await openMember(host), managerBrowser = await openMember(red), viewerBrowser = await openMember(viewer);
  const hp = hostBrowser.page, mp = managerBrowser.page, vp = viewerBrowser.page;
  for (const page of [hp, mp, vp]) assert.equal(await page.locator(".auction-awards").count(), 0, "awards are not shown before completion");
  let state = await read(host);
  state = await act(host, { type: "end_auction", expectedResultsRevision: state.resultsRevision ?? 0 });
  for (const [page, member] of [[hp, host], [mp, red], [vp, viewer]]) {
    await refreshSnapshot(page, member, state.version);
    await page.getByRole("heading", { name: "Auction awards.", exact: true }).waitFor();
    assert.equal(await page.locator(".auction-award-card").count(), 6);
    assert.equal(await card(page, "headline").getByText("4 tied", { exact: true }).count(), 1);
    assert.equal(await card(page, "roster").getByText("4 tied", { exact: true }).count(), 1);
    assert.equal(await card(page, "purse").locator(".auction-award-winner").count(), 0);
    assert.match(await card(page, "purse").innerText(), /at least 11 signings/);
    assert.match(await card(page, "battle").innerText(), /2 bids/);
    assert.equal((await page.locator(".auction-awards").textContent()).includes("98371"), false);
  }
  const expected = await snapshot(hp);
  assert.deepEqual(await snapshot(mp), expected, "manager receives the same awards as the creator");
  assert.deepEqual(await snapshot(vp), expected, "spectator receives the same awards as the creator");
  await hp.bringToFront();
  for (const id of ["headline", "roster"]) {
    const shared = card(hp, id).locator(".award-extra-winners summary");
    await shared.focus(); await hp.keyboard.press("Enter");
    assert.equal(await card(hp, id).locator(".award-extra-winners").evaluate(element => element.open), true);
    assert.equal(await card(hp, id).locator(".auction-award-winner:visible").count(), 4, "all tied winners are reachable by keyboard");
  }
  const criterion = card(hp, "battle").locator(".award-criterion summary");
  await criterion.focus(); await hp.keyboard.press("Enter");
  assert.equal(await card(hp, "battle").locator(".award-criterion").evaluate(element => element.open), true);
  await card(hp, "battle").getByText(/at least two franchises competed/).waitFor();
  for (const width of [1440, 390, 360]) {
    await hp.setViewportSize({ width, height: 1000 }); await paint(hp); await noOverflow(hp);
    for (const control of await hp.locator(".auction-awards summary").all()) {
      if (await control.isVisible()) assert.ok((await control.boundingBox()).height >= 43.5, "award disclosures need a practical tap target");
    }
    await capture(hp, `auction-awards-${width}.png`);
  }
  await hp.setViewportSize({ width: 1440, height: 1000 });
  const xlsx = await download(hp, "Download Excel workbook", "auction-awards-recap.xlsx");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(new Uint8Array(xlsx).buffer);
  const sheet = workbook.getWorksheet("Awards"); assert.ok(sheet, "recap includes its dedicated Awards worksheet");
  const rows = []; sheet.eachRow((row, number) => { if (number > 4) rows.push(row.values); });
  const headlineRows = rows.filter(row => row[1] === "Headline signing");
  assert.equal(headlineRows.length, 4);
  assert.deepEqual(new Set(headlineRows.map(row => row[2])), new Set(players.slice(0, 4).map(player => player.name)));
  assert.ok(rows.every(row => typeof row[5] === "string" && row[5].length > 0), "workbook carries award criteria");
  assert.equal(JSON.stringify(rows).includes("98371"), false);
  const pdf = await download(hp, "Download recap PDF", "auction-awards-recap.pdf");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const extracted = pdfText(pdf);
  assert.ok(extracted.includes("THE AUCTION HONOURS"), "the actual PDF includes its honours section");
  assert.ok(extracted.includes("Headline signing"), "award names are present in the PDF's embedded-font text");

  const oldLedger = structuredClone(state.awardLedger);
  state = await act(host, { type: "correct_sale", playerId: players[0].id, expectedTeamId: "mi", expectedAmount: 500, expectedResultsRevision: state.resultsRevision, teamId: "rcb", amount: 700, reason: "Correct the winning franchise and final sale amount." });
  for (const [page, member] of [[hp, host], [mp, red], [vp, viewer]]) {
    await refreshSnapshot(page, member, state.version);
    await card(page, "headline").getByText("₹7.00 Cr", { exact: true }).waitFor();
    assert.equal(await card(page, "headline").locator(".auction-award-winner").count(), 1);
    assert.equal(await card(page, "roster").locator(".auction-award-winner").count(), 1);
    assert.match(await card(page, "roster").innerText(), /Royal Challengers Bengaluru/);
    assert.match(await card(page, "battle").innerText(), /2 bids/);
  }
  assert.deepEqual(state.awardLedger, oldLedger);
  assert.deepEqual(await snapshot(mp), await snapshot(hp)); assert.deepEqual(await snapshot(vp), await snapshot(hp));
  await hp.setViewportSize({ width: 1440, height: 1000 }); await capture(hp, "auction-awards-corrected-desktop.png");

  await managerBrowser.context.close(); await viewerBrowser.context.close();
  const empty = await create("An empty completed auction");
  await act(empty, { type: "end_auction", expectedResultsRevision: 0 });
  const emptyBrowser = await openMember(empty), ep = emptyBrowser.page;
  await ep.getByRole("heading", { name: "Auction awards.", exact: true }).waitFor();
  assert.equal(await ep.locator(".auction-award-winner").count(), 0);
  assert.equal(await ep.locator(".auction-award-card .award-empty").count(), 6);
  for (const width of [1440, 360]) {
    await ep.setViewportSize({ width, height: 1000 }); await paint(ep); await noOverflow(ep);
    await capture(ep, `auction-awards-empty-${width}.png`);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: awards appear only after ending, match for creator/manager/spectator, expose all ties and keyboard criteria, fit 360/390/1440px, update corrected purchases, handle empty auctions and are included in real Excel/PDF downloads.");
} finally {
  for (const host of rooms) await request(`${pathFor(host)}/delete`, { token: host.token, body: { confirmationCode: host.state.code } }).catch(() => undefined);
  await browser.close();
}
