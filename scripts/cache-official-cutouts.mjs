/** Cache named official portraits without altering image pixels or backgrounds.
 * Reproduce the reviewed manifest: node scripts/cache-official-cutouts.mjs
 * Add reviewed candidate records: --candidates=path/to/candidates.json
 * Refresh an existing file explicitly: --refresh
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestFile = path.join(root, "public/ipl/asset-sources.json");
const assetModule = path.join(root, "lib/visual-assets.ts");
const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
const candidateFile = process.argv.find(arg => arg.startsWith("--candidates="))?.slice(13);
const incoming = candidateFile ? JSON.parse(await fs.readFile(path.resolve(candidateFile), "utf8")) : [];
const refresh = process.argv.includes("--refresh");
const allowedHosts = new Set(["www.iplt20.com", "resources.ecb.co.uk", "www.delhicapitals.in", "documents.iplt20.com", "static-files.cricket-australia.pulselive.com"]);
const result = new Map(manifest.map(record => [record.id, record]));
const jobs = new Map(manifest.map(record => [record.id, { ...record, candidates: [record] }]));
for (const record of incoming) jobs.set(record.id, record);
let stopped = false;
let requestQueue = Promise.resolve();
let lastStart = 0;
let cursor = 0;
const failures = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function trusted(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Untrusted portrait source");
  return url;
}

async function download(value) {
  const slot = requestQueue.then(async () => {
    await wait(Math.max(0, lastStart + 200 - Date.now()));
    if (stopped) throw new Error("Stopped after HTTP 429");
    lastStart = Date.now();
  });
  requestQueue = slot.catch(() => {});
  await slot;
  const signal = AbortSignal.timeout(15_000);
  let url = trusted(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, { signal, redirect: "manual", headers: { Accept: "image/webp,image/png,image/*;q=0.8", "User-Agent": "Pavilion-Official-Portrait-Cache/1.0" } });
    if (response.status === 429) { stopped = true; await response.body?.cancel(); throw new Error("HTTP 429"); }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Missing redirect location");
      url = trusted(new URL(location, url).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 3 * 1024 * 1024) throw new Error("Portrait exceeds 3 MB limit");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Too many redirects");
}

const queue = [...jobs.values()];
await Promise.all([0, 1].map(async () => {
  while (cursor < queue.length) {
    const player = queue[cursor++];
    const current = result.get(player.id);
    if (!refresh && current && await fs.stat(path.join(root, "public", current.path)).then(() => true, () => false)) continue;
    const errors = [];
    for (const candidate of player.candidates) {
      try {
        const downloadUrl = candidate.downloadUrl ?? candidate.sourceUrl;
        const bytes = await download(downloadUrl);
        // Metadata inspection only: keep official image bytes unchanged.
        const meta = await sharp(bytes).metadata();
        if (!["webp", "png"].includes(meta.format) || !meta.hasAlpha || meta.width < 300 || meta.height < 300) throw new Error("Not a full-size transparent portrait");
        const slug = player.name.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const localPath = `/ipl/players/${slug}.${meta.format}`;
        await fs.writeFile(path.join(root, "public", localPath), bytes);
        result.set(player.id, { id: player.id, name: player.name, path: localPath, ...candidate, downloadUrl, width: meta.width, height: meta.height, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: new Date().toISOString() });
        console.log(`Cached ${player.name}: ${bytes.length} bytes (${candidate.season})`);
        break;
      } catch (error) { errors.push(error.message); }
    }
    if (!result.has(player.id)) { failures.push({ id: player.id, name: player.name, errors }); console.log(`Unavailable ${player.name}: ${errors.join(", ")}`); }
  }
}));

const records = [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
await fs.writeFile(manifestFile, `${JSON.stringify(records, null, 2)}\n`);
const images = Object.fromEntries(records.map(record => [record.id, record.path]));
const aliases = new Map();
for (const record of records) {
  for (const name of [record.name, record.officialName].filter(Boolean)) {
    const alias = name.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const matches = aliases.get(alias) ?? new Set();
    matches.add(record.path);
    aliases.set(alias, matches);
  }
}
// Exact, unambiguous published-name aliases also cover generated import IDs.
// Never use partial/fuzzy matching or overwrite a different catalog identity.
for (const [alias, matches] of aliases) {
  if (matches.size !== 1) continue;
  const [imagePath] = matches;
  if (!images[alias] || images[alias] === imagePath) images[alias] = imagePath;
}
const originalModule = await fs.readFile(assetModule, "utf8");
const updatedModule = originalModule.replace(/export const PLAYER_IMAGES: Record<string, string> = \{[\s\S]*?\n\};/, `export const PLAYER_IMAGES: Record<string, string> = ${JSON.stringify(images, null, 2)};`);
if (updatedModule === originalModule && records.length !== manifest.length) throw new Error("Player image declaration not found");
await fs.writeFile(assetModule, updatedModule);
console.log(JSON.stringify({ portraits: records.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
