import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.PAVILION_TEST_ISOLATED, "1", "Use the isolated runner; never select players in a user's room.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || ".sites-runtime/browser-tools/node_modules/playwright/index.mjs")));
const base = process.env.BASE_URL;
async function request(path, body, token) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal(response.ok, true, `Portrait fixture request failed: ${response.status}`);
  return response.json();
}
const host = await request("/api/rooms", { name: "Portrait framing check", hostName: "Photo reviewer" });
// Another isolated suite deliberately removes Kohli to verify catalog deletion.
const cutoutId = ["virat-kohli", "rishabh-pant", "kl-rahul", "axar-patel"].find(id => host.state.players.some(player => player.id === id));
assert.ok(cutoutId, "A known IPL cutout is available for visual validation");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true });
const screenshots = resolve(".sites-runtime/screenshots");
await mkdir(screenshots, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.evaluate(session => localStorage.setItem(`pavilion-session-${session.code}`, JSON.stringify(session)), { code: host.state.code, token: host.token, memberId: host.memberId });
  await page.goto(`${base}/?room=${host.state.code}&view=room`);
  await page.locator(".auction-layout").waitFor();
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const id of ["marco-jansen", "abhishek-sharma", "axar-patel", cutoutId]) {
      const player = host.state.players.find(entry => entry.id === id);
      assert.ok(player, `Missing photo fixture ${id}`);
      await request(`/api/rooms/${host.state.code}/action`, { action: { type: "select_player", playerId: id } }, host.token);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const photo = page.locator(".player-card img.hero-player-image");
      await page.waitForFunction(name => document.querySelector(".player-card img.hero-player-image")?.getAttribute("alt") === name, player.name);
      await photo.evaluate(image => image.decode());
      await photo.evaluate(image => Promise.all(image.getAnimations().map(animation => animation.finished.catch(() => {}))));
      const metrics = await photo.evaluate(image => {
        const box = image.getBoundingClientRect();
        const art = image.closest(".player-art").getBoundingClientRect();
        const card = image.closest(".player-card").getBoundingClientRect();
        const css = getComputedStyle(image);
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, fit: css.objectFit, className: image.className, art: { x: art.x, y: art.y, right: art.right, bottom: art.bottom }, card: { x: card.x, right: card.right }, border: parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      assert.equal(metrics.fit, "contain", `${id} must not crop to fill at ${width}px`);
      assert.equal(metrics.overflow, false);
      assert.ok(metrics.x >= metrics.art.x - 1 && metrics.right <= metrics.art.right + 1, `${id} exceeds its art frame horizontally at ${width}px`);
      assert.ok(metrics.y >= metrics.art.y - 1 && metrics.bottom <= metrics.art.bottom + 1, `${id} exceeds its art frame vertically at ${width}px`);
      assert.match(metrics.className, /portrait-cutout/, `${id} uses its official cutout instead of a boxed headshot`);
      assert.ok(metrics.naturalWidth >= 400 && metrics.naturalHeight >= 400, `${id} has a high-quality portrait source`);
      if (id === "marco-jansen" || id === "abhishek-sharma" || (width === 1440 && id === cutoutId)) {
        await page.evaluate(() => document.fonts.ready);
        await page.locator(".player-card").screenshot({ path: resolve(screenshots, `portrait-${id}-${width}.png`) });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: Marco, Abhishek, Axar and another IPL star all use sharp official cutouts, framed correctly on desktop/tablet/mobile without browser errors.");
} finally { await browser.close(); }
