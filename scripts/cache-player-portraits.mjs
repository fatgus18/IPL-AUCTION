/** Run from the app folder: node scripts/cache-player-portraits.mjs */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const root = process.cwd();
const sourcePath = path.join(root, "data/player-profiles.json");
const outputDir = path.join(root, "public/player-portraits");
const manifestPath = path.join(outputDir, "sources.json");
const modulePath = path.join(root, "lib/catalog-portraits.ts");
const allowedHost = "static.cricbuzz.com";
const concurrency = 3;
const requestGapMs = 250;
const maxBytes = 5 * 1024 * 1024;
const { PLAYER_IMAGES } = await import(pathToFileURL(path.join(root, "lib/visual-assets.ts")).href);
const { profiles } = JSON.parse(await fs.readFile(sourcePath, "utf8"));
await fs.mkdir(outputDir, { recursive: true });

let previous = { portraits: [] };
try {
  previous = JSON.parse(await fs.readFile(manifestPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const previousById = new Map(previous.portraits.map((portrait) => [portrait.playerId, portrait]));
const portraits = [];
const failures = [];
const localCatalog = {};
let stoppedForRateLimit = false;
let cursor = 0;
let completed = 0;
let lastRequestAt = 0;
let requestQueue = Promise.resolve();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts are at least 250 ms apart globally, even with three active workers.
function reserveRequestSlot() {
  const slot = requestQueue.then(async () => {
    await wait(Math.max(0, lastRequestAt + requestGapMs - Date.now()));
    if (stoppedForRateLimit) throw new Error("Stopped after the source returned HTTP 429.");
    lastRequestAt = Date.now();
  });
  requestQueue = slot.catch(() => {});
  return slot;
}

function trustedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== allowedHost || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Image URL is outside the trusted portrait host.");
  }
  return url;
}

function profilePortraitUrl(value) {
  const url = trustedUrl(value);
  // Cricbuzz's "det" variant is a wide editorial crop and can cut faces off.
  // The profile thumbnail returns the complete headshot (currently 168px).
  url.searchParams.set("d", "high");
  url.searchParams.set("p", "gthumb");
  return url.href;
}

async function downloadImage(sourceUrl) {
  let url = trustedUrl(sourceUrl);
  // One timeout covers every redirect and the response body.
  const signal = AbortSignal.timeout(10_000);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await reserveRequestSlot();
    const response = await fetch(url, {
      signal,
      redirect: "manual",
      headers: { Accept: "image/webp,image/jpeg,image/png,image/*;q=0.8", "User-Agent": "Pavilion-Local-Portrait-Cache/1.0" },
    });
    if (response.status === 429) {
      stoppedForRateLimit = true;
      await response.body?.cancel();
      throw new Error("HTTP 429: stopped further requests; rerun later to resume.");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirect has no location.");
      url = trustedUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}.`);
    }
    if (!/^image\/(?:jpeg|png|webp|avif|gif)(?:;|$)/i.test(response.headers.get("content-type") || "")) {
      await response.body?.cancel();
      throw new Error("Response is not a supported image content type.");
    }
    if (Number(response.headers.get("content-length")) > maxBytes || !response.body) {
      await response.body?.cancel();
      throw new Error("Image exceeds the five-megabyte download limit or has no body.");
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > maxBytes) throw new Error("Image exceeds the five-megabyte download limit.");
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), resolvedUrl: url.href };
  }
  throw new Error("Too many redirects.");
}

async function verifyLocal(filePath) {
  const metadata = await sharp(filePath, { limitInputPixels: 16_000_000 }).metadata();
  if (!metadata.width || !metadata.height || !["webp", "png", "jpeg"].includes(metadata.format)) {
    throw new Error("Cached file is not a valid portrait image.");
  }
  return { width: metadata.width, height: metadata.height, bytes: (await fs.stat(filePath)).size };
}

// Reuse all existing IPL portraits, including any used by previously saved rooms.
for (const [playerId, localPath] of Object.entries(PLAYER_IMAGES)) {
  const dimensions = await verifyLocal(path.join(root, "public", localPath.slice(1)));
  portraits.push({ playerId, name: profiles[playerId]?.name || playerId, localPath, provider: "IPL", provenance: "/ipl/asset-sources.json", reused: true, ...dimensions });
}

const entries = Object.entries(profiles).filter(([playerId, profile]) => profile.image && !PLAYER_IMAGES[playerId]);
async function cachePortrait(playerId, profile) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(playerId)) throw new Error("Invalid player ID for a local filename.");
  trustedUrl(profile.image);
  const previousPortrait = previousById.get(playerId);
  const previousPath = previousPortrait?.localPath;
  const safePaths = ["webp", "jpg", "png"].map(extension => `/player-portraits/${playerId}.${extension}`);
  let localPath = safePaths.includes(previousPath) ? previousPath : `/player-portraits/${playerId}.webp`;
  let destination = path.join(root, "public", localPath.slice(1));
  let existing = false;
  try {
    await fs.access(destination);
    existing = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let resolvedUrl = previousById.get(playerId)?.resolvedUrl || null;
  let sourceUrl = previousPortrait?.sourceUrl || profile.image;
  if (existing) {
    const dimensions = await verifyLocal(destination);
    // Repair only cached editorial crops; retain existing full portraits.
    if (dimensions.width > dimensions.height * 1.4) existing = false;
  }
  if (!existing) {
    sourceUrl = profilePortraitUrl(profile.image);
    const downloaded = await downloadImage(sourceUrl);
    const metadata = await sharp(downloaded.buffer, { limitInputPixels: 16_000_000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width > 400 || metadata.height > 400 || metadata.width !== metadata.height || !["jpeg", "png", "webp"].includes(metadata.format)) {
      throw new Error("Source did not return a bounded square profile portrait.");
    }
    const extension = metadata.format === "jpeg" ? "jpg" : metadata.format;
    localPath = `/player-portraits/${playerId}.${extension}`;
    destination = path.join(outputDir, `${playerId}.${extension}`);
    // Keep original source bytes; no enlargement, crop, or re-encoding.
    await fs.writeFile(destination, downloaded.buffer);
    resolvedUrl = downloaded.resolvedUrl;
  }
  const dimensions = await verifyLocal(destination);
  localCatalog[playerId] = localPath;
  portraits.push({
    playerId, name: profile.name, localPath, provider: profile.provider || "Cricbuzz",
    sourceUrl,
    ...(previousPortrait?.originalSourceUrl ? { originalSourceUrl: previousPortrait.originalSourceUrl } : {}),
    resolvedUrl, profileUrl: profile.profileUrl || null,
    retrievedAt: existing ? previousPortrait?.retrievedAt || new Date().toISOString() : new Date().toISOString(),
    reused: existing, ...dimensions,
  });
}

async function worker() {
  while (cursor < entries.length) {
    const [playerId, profile] = entries[cursor++];
    try {
      await cachePortrait(playerId, profile);
    } catch (error) {
      failures.push({ playerId, name: profile.name, sourceUrl: profile.image, reason: error.message });
    }
    completed += 1;
    if (completed % 25 === 0 || completed === entries.length) {
      console.log(`Processed ${completed}/${entries.length} portraits; ${failures.length} failures.`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
portraits.sort((a, b) => a.playerId.localeCompare(b.playerId));
const sortedCatalog = Object.fromEntries(Object.entries(localCatalog).sort(([a], [b]) => a.localeCompare(b)));
const moduleText = `/** Generated by scripts/cache-player-portraits.mjs. Provenance: public/player-portraits/sources.json. */\nimport { PLAYER_IMAGES } from "./visual-assets";\n\nexport const CATALOG_PORTRAITS: Record<string, string> = {\n  ...PLAYER_IMAGES,\n${Object.entries(sortedCatalog).map(([id, value]) => `  ${JSON.stringify(id)}: ${JSON.stringify(value)},`).join("\n")}\n};\n`;
await fs.writeFile(modulePath, moduleText);
await fs.writeFile(manifestPath, JSON.stringify({
  generatedAt: new Date().toISOString(), sourceCatalog: "data/player-profiles.json",
  imageProcessing: "Existing IPL cutouts and full cached portraits reused unchanged. New or repaired profile thumbnails use original square source bytes, at most 400px, without cropping or re-encoding.",
  stoppedForRateLimit, portraits, failures,
}, null, 2) + "\n");
console.log(JSON.stringify({ knownPortraitsReused: Object.keys(PLAYER_IMAGES).length, catalogPortraits: Object.keys(localCatalog).length, totalMappings: portraits.length, failures: failures.length, stoppedForRateLimit }));
if (failures.length) console.log("Failures are recorded in public/player-portraits/sources.json; other portraits remain usable.");
