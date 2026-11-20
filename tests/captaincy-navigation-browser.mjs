import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { navigateTo } from './browser-navigation.mjs';

assert.equal(process.env.PAVILION_TEST_ISOLATED, '1', 'Only use an isolated test database.');
const base = process.env.BASE_URL;
assert.ok(base);
const { chromium } = await import(pathToFileURL(resolve('.sites-runtime/browser-tools/node_modules/playwright/index.mjs')));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: true });
const output = resolve('.sites-runtime/screenshots'); await mkdir(output, { recursive: true });
const errors = [];
const api = async (path, { member, body } = {}) => {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(member ? { Authorization: `Bearer ${member.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
  const value = await response.json(); assert.ok(response.ok, `${response.status}: ${value.error}`); return value;
};
const roomPath = member => '/api/rooms/' + member.state.code;
const act = (member, action) => api(roomPath(member) + '/action', { member, body: { action } }).then(result => result.state);
const read = member => api(roomPath(member), { member }).then(result => result.state);
const rcb = state => state.teams.find(team => team.id === 'rcb');
const open = async (member, view, width = 1440) => {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.addInitScript(access => localStorage.setItem('pavilion-session-' + access.code, JSON.stringify(access)), { code: member.state.code, token: member.token, memberId: member.memberId });
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?room=${member.state.code}&view=${view}`);
  await page.locator(`.in-auction.tab-${view}`).waitFor(); return page;
};
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `${page.viewportSize().width}px page fits`);
const saveCaptaincy = async (page, name) => {
  const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/action') && response.request().postDataJSON()?.action?.type === 'set_captaincy');
  await page.getByRole('button', { name, exact: true }).click();
  const result = await response; const value = await result.json(); assert.equal(result.status(), 200, value.error);
  await page.locator('.personal-squad-leadership-status').filter({ hasText: 'Captaincy saved to your room.' }).waitFor(); return value.state;
};
const showXI = async (page, teamName = 'Royal Challengers Bengaluru') => {
  await page.getByRole('button', { name: `View ${teamName} squad`, exact: true }).click();
  const dialog = page.locator('.squad-detail-dialog[open]'); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Playing XI', exact: true }).click();
  await dialog.locator('.public-xi').waitFor(); return dialog;
};
let host;
try {
  host = await api('/api/rooms', { body: { name: 'Captaincy and public XI', hostName: 'Captaincy creator' } });
  const { teamPassword } = await api(roomPath(host) + '/access', { member: host, body: {} });
  const owner = await api(roomPath(host) + '/join', { body: { name: 'RCB captaincy manager', teamId: 'rcb', teamPassword } });
  const rival = await api(roomPath(host) + '/join', { body: { name: 'MI XI viewer', teamId: 'mi', teamPassword } });
  const watcher = await api(roomPath(host) + '/join', { body: { name: 'XI spectator' } });
  const players = host.state.players.filter(player => player.eligibilityVerified !== false && !player.catalogArchived && !player.isOverseas).slice(0, 4);
  for (const [index, player] of players.entries()) {
    await act(host, { type: 'select_player', playerId: player.id }); await act(host, { type: 'start' });
    await act(index === 3 ? rival : owner, { type: 'bid', expectedPlayerId: player.id, expectedAmount: Math.max(25, Math.ceil(player.basePrice / 25) * 25) });
    await act(host, { type: 'lock' }); await act(host, { type: 'sell' });
  }
  await act(host, { type: 'end_auction', expectedResultsRevision: (await read(host)).resultsRevision });
  await api(roomPath(host) + '/season', { member: host, body: { type: 'import', expectedRevision: 0, text: ['Name,Points,Matches,Runs,Wickets', ...players.map((player, index) => `${player.name},${[100, 50, -10, 20][index]},10,100,5`)].join('\n') } });
  const before = await read(owner);
  const page = await open(owner, 'build-xi');
  await page.getByRole('button', { name: 'Choose player for XI position 7', exact: true }).click();
  await page.getByRole('button', { name: `Select ${players[0].name}`, exact: true }).click();
  await page.locator('.lineup-picker[open]').waitFor({ state: 'hidden' });
  await navigateTo(page, 'My Squad');
  await page.locator('.personal-squad-leadership').waitFor();
  let saved = await saveCaptaincy(page, `Make ${players[1].name} captain`);
  assert.equal(rcb(saved).lineup.playingXI.length, 0, 'Captaincy does not force any XI selection.');
  saved = await saveCaptaincy(page, `Make ${players[2].name} vice captain`);
  assert.equal(rcb(saved).lineup.captainId, players[1].id); assert.equal(rcb(saved).lineup.viceCaptainId, players[2].id);
  await navigateTo(page, 'Build my XI');
  await page.getByRole('button', { name: 'Change player at XI position 7', exact: true }).waitFor();
  assert.equal(await page.locator('.lineup-leader-copy small').filter({ hasText: 'Outside this XI' }).count(), 2);
  assert.equal(await page.getByText('Your lineup or captaincy changed elsewhere.', { exact: false }).count(), 0, 'Separate captaincy edits rebase without losing the position draft.');
  const lineupResponse = page.waitForResponse(response => response.url().endsWith('/action') && response.request().method() === 'POST' && response.request().postDataJSON()?.action?.type === 'set_lineup');
  await page.getByRole('button', { name: 'Save lineup', exact: true }).click();
  assert.equal((await lineupResponse).status(), 200);
  saved = await read(owner);
  assert.equal(rcb(saved).lineup.playingXI[6], players[0].id);
  assert.equal(rcb(saved).lineup.captainId, players[1].id); assert.equal(rcb(saved).lineup.viceCaptainId, players[2].id);
  assert.deepEqual(saved.teams.map(team => ({ purse: team.purse, squad: team.squad })), before.teams.map(team => ({ purse: team.purse, squad: team.squad })));
  assert.equal((await api(roomPath(host) + '/season', { member: owner })).season.teams.find(team => team.id === 'rcb').points, 185);
  console.log('PASS: My Squad appoints C/VC after auction completion, without changing XI slots, finances or source data; Build XI preserves a position draft and shared leaders.');

  await navigateTo(page, 'My Squad');
  await saveCaptaincy(page, `Make ${players[0].name} captain`);
  await page.reload(); await page.locator('.personal-squad-leader[data-leadership="C"][data-player-id="' + players[0].id + '"]').waitFor();
  const season = (await api(roomPath(host) + '/season', { member: owner })).season;
  assert.equal(season.revision, 1); assert.equal(season.teams.find(team => team.id === 'rcb').points, 235);
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  assert.equal(await nav.getByRole('button').count(), 5, 'Desktop exposes four main choices and the settings control.');
  assert.equal(await nav.locator('button[data-destination]').count(), 8, 'All eight destinations remain available.');
  const navGeometry = await nav.getByRole('button').evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect(), icon = button.querySelector('svg');
    return { center: box.y + box.height / 2, visibleIcon: !!icon && getComputedStyle(icon).display !== 'none' };
  }));
  assert.ok(navGeometry.every(button => Math.abs(button.center - navGeometry[0].center) < 2), 'Header controls share a consistent vertical center.');
  assert.ok(navGeometry.every(button => button.visibleIcon), 'Navigation icons, including settings, remain visible.');
  const teamTrigger = nav.getByRole('button', { name: 'My team navigation', exact: true });
  await teamTrigger.focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await nav.locator('button[data-destination="targets"]').isVisible(), true);
  await page.keyboard.press('Escape'); assert.equal(await teamTrigger.getAttribute('aria-expanded'), 'false');
  assert.ok(await teamTrigger.evaluate(element => element === document.activeElement));
  await noOverflow(page); await page.screenshot({ path: resolve(output, 'captaincy-my-squad-1440.png'), fullPage: true });
  await teamTrigger.click(); await page.screenshot({ path: resolve(output, 'grouped-navigation-1440.png') });
  await page.keyboard.press('Escape');

  for (const viewer of [rival, watcher, host]) {
    const currentLineup = rcb(await read(owner)).lineup;
    const other = await open(viewer, 'squads');
    const dialog = await showXI(other);
    assert.equal(await dialog.getByRole('list', { name: 'Saved playing XI in batting order' }).locator(':scope > li').count(), 11);
    assert.equal(await dialog.getByRole('list', { name: 'Saved substitutes' }).locator(':scope > li').count(), 5);
    assert.equal(await dialog.locator('.public-xi-ground .public-xi-slot[data-position="7"]').getAttribute('data-player-id'), players[0].id);
    assert.equal(await dialog.locator('.public-xi-ground .public-xi-slot[data-position="1"]').getAttribute('data-player-id'), '');
    assert.equal(await dialog.locator('.public-xi-leader[data-leadership="VC"]').getAttribute('data-player-id'), currentLineup.viceCaptainId);
    const outsideBadge = currentLineup.playingXI.includes(currentLineup.viceCaptainId) ? 'C' : 'VC';
    assert.match(await dialog.locator(`.public-xi-leader[data-leadership="${outsideBadge}"]`).innerText(), /outside playing XI/);
    assert.equal(await dialog.getByRole('button', { name: /Save lineup|Make .* captain|Remove .* playing XI/ }).count(), 0);
    if (viewer === rival) {
      await dialog.getByRole('button', { name: `View ${players[0].name} statistics, Captain`, exact: true }).click();
      const stats = other.locator('.public-xi-stats-popup'); await stats.waitFor();
      assert.match(await stats.innerText(), /Matches/); await stats.getByRole('button', { name: 'Close player statistics' }).click();
      const previousRevision = Number(await dialog.locator('.public-xi').getAttribute('data-lineup-revision'));
      const latest = await read(owner);
      await act(owner, { type: 'set_captaincy', teamId: 'rcb', captainId: players[1].id, viceCaptainId: players[0].id, expectedRevision: rcb(latest).lineup.revision });
      await other.waitForFunction(previous => Number(document.querySelector('.public-xi')?.getAttribute('data-lineup-revision')) > previous, previousRevision);
      assert.equal(await dialog.locator('.public-xi-leader[data-leadership="C"]').getAttribute('data-player-id'), players[1].id);
      await dialog.screenshot({ path: resolve(output, 'public-xi-1440.png') });
      await other.setViewportSize({ width: 360, height: 900 }); await paint(other); await noOverflow(other);
      await dialog.screenshot({ path: resolve(output, 'public-xi-360.png') });
    }
    await dialog.getByRole('button', { name: 'Close squad details', exact: true }).click();
    await showXI(other, 'Chennai Super Kings'); await other.getByText('XI not picked yet', { exact: true }).waitFor();
    await other.close();
  }
  console.log('PASS: managers, spectators and creator view read-only rival XIs, stable empty positions, substitutes, live leadership changes and player statistics.');

  await page.setViewportSize({ width: 360, height: 900 }); await paint(page); await noOverflow(page);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  assert.equal(await nav.locator('button[data-destination]:visible').count(), 8);
  const bounds = await nav.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360);
  await page.screenshot({ path: resolve(output, 'grouped-navigation-360.png') });
  await page.keyboard.press('Escape'); assert.equal(await nav.isVisible(), false);
  assert.ok(await page.getByRole('button', { name: 'Open navigation', exact: true }).evaluate(element => element === document.activeElement));
  await page.screenshot({ path: resolve(output, 'captaincy-my-squad-360.png'), fullPage: true });
  await navigateTo(page, 'Auction Season'); await page.locator('.auction-season').waitFor(); await noOverflow(page);
  assert.deepEqual(errors, []);
  console.log('PASS: compact grouped navigation and captaincy work on desktop and mobile, keyboard dismissal restores focus, and no browser errors occur.');
} finally {
  await browser.close();
  if (host) await api(roomPath(host) + '/delete', { member: host, body: { confirmationCode: host.state.code } });
}
