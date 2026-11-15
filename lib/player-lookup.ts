import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LookupCandidate, LookupPlayer, LookupRole, LookupStats, PlayerLookupResult } from "./player-lookup-types";

const MAX_BYTES = 2_000_000;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expires: number; result: PlayerLookupResult }>();
const inFlight = new Map<string, Promise<PlayerLookupResult>>();
let activeFetches = 0;

export class PlayerLookupError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "LOOKUP_INVALID") { super(message); this.name = "PlayerLookupError"; this.status = status; this.code = code; }
}

export function normalizePlayerName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function text(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&(?:amp|quot|apos|#39|#x27|lt|gt|nbsp);/gi, (entity) => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&#x27;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " }[entity.toLowerCase()] || " ")).replace(/\s+/g, " ").trim();
}

function shortText(value: unknown, max = 100): string | null {
  if (typeof value !== "string") return null;
  const clean = text(value).replace(/[\u0000-\u001f\u007f]/g, "");
  return clean && clean.length <= max ? clean : null;
}

export function parseStatistic(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? value : null;
  if (typeof value !== "string") return null;
  const clean = text(value).replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  return parseStatistic(Number(clean));
}

function slug(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

/** URLs are parsed and canonicalized before ANY network request. Only profile paths are public input. */
export function validateProfileUrl(input: string): { url: URL; provider: "Cricbuzz" | "ESPNcricinfo"; id: string; nameHint: string | null } {
  let url: URL;
  try { url = new URL(input); } catch { throw new PlayerLookupError("Enter a player name or a complete Cricbuzz / ESPNcricinfo profile URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || /[\\\u0000-\u0020]/.test(input)) {
    throw new PlayerLookupError("Use a public HTTPS player profile without credentials or a custom port.");
  }
  if (["www.cricbuzz.com", "cricbuzz.com", "m.cricbuzz.com"].includes(url.hostname)) {
    const match = url.pathname.match(/^\/profiles\/([1-9]\d{0,9})(?:\/([a-zA-Z0-9-]+))?\/?$/);
    if (!match) throw new PlayerLookupError("Use a Cricbuzz player profile, such as cricbuzz.com/profiles/1413/virat-kohli.");
    return { provider: "Cricbuzz", id: match[1], url: new URL(`https://www.cricbuzz.com/profiles/${match[1]}/${match[2] || "player"}`), nameHint: match[2]?.replace(/-/g, " ") || null };
  }
  if (["www.espncricinfo.com", "espncricinfo.com"].includes(url.hostname)) {
    const current = url.pathname.match(/^\/cricketers\/(?:([a-zA-Z][a-zA-Z0-9-]*)-)?([1-9]\d{0,9})(?:\/(?:bowling-batting-stats|stats))?\/?$/);
    const legacy = url.pathname.match(/^\/(?:[^/]+\/)?content\/player\/([1-9]\d{0,9})\.html$/);
    if (!current && !legacy) throw new PlayerLookupError("Use an ESPNcricinfo cricketer profile URL.");
    const id = current?.[2] || legacy![1];
    return { provider: "ESPNcricinfo", id, url: new URL(`https://www.espncricinfo.com/cricketers/${current?.[1] ? `${current[1]}-` : ""}${id}`), nameHint: current?.[1]?.replace(/-/g, " ") || null };
  }
  throw new PlayerLookupError("That website is not supported. Paste a Cricbuzz or ESPNcricinfo player profile, or search by name.");
}

function allowedFetchUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (url.hostname === "www.cricbuzz.com") return /^\/profiles\/[1-9]\d{0,9}\/[a-zA-Z0-9-]+\/?$/.test(url.pathname) || /^\/api\/player-search\/[^/]{2,300}$/.test(url.pathname);
  return url.hostname === "www.espncricinfo.com" && /^\/cricketers\/(?:[a-zA-Z][a-zA-Z0-9-]*-)?[1-9]\d{0,9}\/?$/.test(url.pathname);
}

/** Redirects remain on a small exact-host/path allowlist; never follow provider links blindly. */
export async function fetchPublicProfile(input: URL, fetcher: typeof fetch = fetch): Promise<string> {
  if (activeFetches >= 4) throw new PlayerLookupError("Player search is busy. Try again in a moment.", 429, "LOOKUP_BUSY");
  activeFetches++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let url = input;
    for (let redirect = 0; redirect <= 3; redirect++) {
      if (!allowedFetchUrl(url)) throw new PlayerLookupError("The profile redirected to an unsupported destination.", 502, "UNSAFE_REDIRECT");
      const response = await fetcher(url, { redirect: "manual", signal: controller.signal, cache: "no-store", headers: { Accept: "text/html,application/json", "User-Agent": "PavilionAuction/1.0 (public cricket profile lookup)" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const target = response.headers.get("location");
        if (!target || redirect === 3) throw new PlayerLookupError("The provider could not resolve this profile.", 502, "PROVIDER_REDIRECT");
        url = new URL(target, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new PlayerLookupError("The cricket provider has paused searches. Try again in a minute.", 429, "PROVIDER_RATE_LIMIT");
        throw new PlayerLookupError(response.status === 404 ? "This player profile was not found. Check the URL or search by name." : "The cricket provider is temporarily unavailable. Try again or search by name.", 502, "PROVIDER_UNAVAILABLE");
      }
      if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) { await response.body?.cancel(); throw new PlayerLookupError("The provider response was too large.", 502, "PROVIDER_RESPONSE"); }
      const reader = response.body?.getReader();
      if (!reader) return "";
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) { await reader.cancel(); throw new PlayerLookupError("The provider response was too large.", 502, "PROVIDER_RESPONSE"); }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    }
    throw new PlayerLookupError("The provider could not resolve this profile.", 502, "PROVIDER_REDIRECT");
  } catch (error) {
    if (error instanceof PlayerLookupError) throw error;
    throw new PlayerLookupError(controller.signal.aborted ? "Player search took too long. Try again in a moment." : "Could not reach the cricket provider. Check your connection and try again.", 502, "PROVIDER_UNAVAILABLE");
  } finally { clearTimeout(timeout); activeFetches--; }
}

function safeImage(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(text(input));
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["static.cricbuzz.com", "img1.hscicdn.com", "a.espncdn.com"].includes(url.hostname)) return null;
    // Cricbuzz's standard silhouette is not a player photograph.
    if (/\/c182026\//.test(url.pathname)) return null;
    if (url.hostname === "static.cricbuzz.com") { url.searchParams.set("d", "high"); url.searchParams.set("p", "det"); }
    return url.toString();
  } catch { return null; }
}

export function parseSearchCandidates(body: string): LookupCandidate[] {
  let data: { player?: unknown };
  try { data = JSON.parse(body); } catch { throw new PlayerLookupError("The provider returned an unreadable search response.", 502, "PROVIDER_RESPONSE"); }
  if (!data || typeof data !== "object") throw new PlayerLookupError("The provider returned an unreadable search response.", 502, "PROVIDER_RESPONSE");
  if (!Array.isArray(data.player)) return [];
  const result: LookupCandidate[] = [];
  for (const item of data.player.slice(0, 25)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id || "");
    const name = shortText(row.name);
    if (!/^[1-9]\d{0,9}$/.test(id) || !name) continue;
    const imageId = String(row.faceImageId || "");
    result.push({ id: `cricbuzz-${id}`, name, country: shortText(row.teamName), dateOfBirth: typeof row.dob === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.dob) ? row.dob : null, image: /^\d+$/.test(imageId) ? safeImage(`https://static.cricbuzz.com/a/img/v1/i1/c${imageId}/${slug(name)}.jpg?d=high&p=det`) : null, profileUrl: `https://www.cricbuzz.com/profiles/${id}/${slug(name)}`, provider: "Cricbuzz" });
  }
  return [...new Map(result.map((candidate) => [candidate.id, candidate])).values()];
}

function roleFrom(value: string | null): LookupRole | null {
  if (!value) return null;
  if (/keeper|wicket|\bwk\b/i.test(value)) return "Wicketkeeper";
  if (/all.?round/i.test(value)) return "All-rounder";
  if (/batsman|batswoman|batter|batting/i.test(value)) return "Batter";
  if (/bowler|bowling/i.test(value)) return "Bowler";
  return null;
}

function field(html: string, label: string): string | null {
  const matched = html.match(new RegExp(`>\\s*${label}\\s*<\\/[^>]+>\\s*<(?:div|span)[^>]*>([^<]{1,150})<`, "i"));
  return matched ? shortText(matched[1], 150) : null;
}

type Table = Map<string, Record<string, number | null>>;
function careerTable(html: string, label: string): Table {
  const index = html.indexOf(label);
  const table = index >= 0 ? html.slice(index).match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1] : undefined;
  const result: Table = new Map();
  if (!table) return result;
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => text(cell[1])));
  const headers = rows.shift();
  if (!headers) return result;
  // Current Cricbuzz table puts formats in columns; older public markup put formats in rows.
  if (headers.some((header) => /^(IPL|T20I?|ODI|Test)$/i.test(header))) {
    headers.forEach((format, index) => {
      if (!/^(IPL|T20I?|ODI|Test)$/i.test(format)) return;
      const stats: Record<string, number | null> = {};
      for (const row of rows) if (row[0]) stats[row[0].toLowerCase()] = parseStatistic(row[index]);
      result.set(format.toUpperCase(), stats);
    });
  } else {
    for (const row of rows) {
      if (!/^(IPL|T20I?|ODI|Test)$/i.test(row[0])) continue;
      result.set(row[0].toUpperCase(), Object.fromEntries(headers.slice(1).map((header, index) => [header.toLowerCase(), parseStatistic(row[index + 1])])));
    }
  }
  return result;
}

function jsonLdIdentity(html: string): { person: Record<string, unknown>; pageName: string | null } | null {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const objects = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
      for (const item of objects) {
        if (!item || typeof item !== "object") continue;
        const entity = item.mainEntity || item;
        if (["Person", "SportsPerson"].includes(entity["@type"] || entity.type) && shortText(entity.name)) return { person: entity, pageName: shortText(item.name, 200) };
      }
    } catch { /* Unrelated malformed JSON-LD is not executed or trusted. */ }
  }
  return null;
}

function stat(row: Record<string, number | null> | undefined, ...keys: string[]): number | null {
  if (!row) return null;
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return null;
}

export function parsePlayerProfile(html: string, profileUrl: string, now = new Date().toISOString()): LookupPlayer | null {
  const validated = validateProfileUrl(profileUrl);
  const identity = jsonLdIdentity(html);
  if (!identity) return null; // A 200 challenge page is not a successful profile.
  const { person, pageName } = identity;
  const name = shortText(person.name)!;
  const nationality = person.nationality;
  const country = shortText(typeof nationality === "object" && nationality ? (nationality as Record<string, unknown>).name : nationality);
  const role = roleFrom(field(html, "Role") || pageName?.split(" - ")[2] || null);
  const batting = careerTable(html, "Batting Career Summary");
  const bowling = careerTable(html, "Bowling Career Summary");
  const selected = ["IPL", "T20I", "T20", "ODI", "TEST"].find((format) => Math.max(stat(batting.get(format), "matches", "m", "mat") ?? 0, stat(bowling.get(format), "matches", "m", "mat") ?? 0) > 0);
  const battingRow = selected ? batting.get(selected) : undefined;
  const bowlingRow = selected ? bowling.get(selected) : undefined;
  const batMatches = stat(battingRow, "matches", "m", "mat");
  const bowlMatches = stat(bowlingRow, "matches", "m", "mat");
  const conflicting = batMatches !== null && bowlMatches !== null && batMatches !== bowlMatches;
  const stats: LookupStats = { matches: conflicting ? null : batMatches ?? bowlMatches, runs: stat(battingRow, "runs"), wickets: conflicting ? null : stat(bowlingRow, "wickets", "wkts", "wkts."), strikeRate: stat(battingRow, "sr", "strike rate") };
  // Cricbuzz labels its international T20 career column "T20". Do not present it as all domestic T20s.
  const statsFormat = selected === "TEST" ? "Test" : selected === "T20" && validated.provider === "Cricbuzz" ? "T20I" : selected as LookupPlayer["statsFormat"] | undefined;
  const imageObject = Array.isArray(person.image) ? person.image[0] : person.image;
  let image = safeImage(typeof imageObject === "object" && imageObject ? (imageObject as Record<string, unknown>).url : imageObject);
  if (!image) {
    for (const img of html.matchAll(/<img\b[^>]*>/gi)) {
      const alt = img[0].match(/\balt=["']([^"']*)["']/i)?.[1];
      if (alt && normalizePlayerName(text(alt)) === normalizePlayerName(name)) {
        image = safeImage(img[0].match(/\bsrc=["']([^"']*)["']/i)?.[1]);
        if (image) break;
      }
    }
  }
  const warnings: string[] = [];
  if (conflicting) warnings.push("The provider's batting and bowling match totals disagree. Match and wicket totals need review.");
  if (statsFormat && statsFormat !== "IPL") warnings.push(`No IPL career totals were available. These are ${statsFormat} career statistics.`);
  const missingFields = [!country && "country", !role && "role", !image && "image", ...Object.entries(stats).filter(([, value]) => value === null).map(([key]) => `stats.${key}`)].filter((value): value is string => Boolean(value));
  if (missingFields.some((value) => value.startsWith("stats."))) warnings.push("Unavailable statistics are left blank for review.");
  return { id: `${validated.provider === "Cricbuzz" ? "cricbuzz" : "cricinfo"}-${validated.id}`, name, country, role, image, dateOfBirth: shortText(person.birthDate), battingStyle: field(html, "Batting Style"), bowlingStyle: field(html, "Bowling Style"), profileUrl: validated.url.toString(), provider: validated.provider, stats, statsFormat: statsFormat || null, statsScope: "career", fetchedAt: now, sourceUrls: [validated.url.toString()], missingFields, warnings, basePriceSuggested: 30 };
}

let snapshotPromise: Promise<LookupPlayer[]> | undefined;
async function snapshot(): Promise<LookupPlayer[]> {
  snapshotPromise ??= readFile(path.join(process.cwd(), "data", "player-profiles.json"), "utf8").then((body) => {
    const data = JSON.parse(body);
    return (Array.isArray(data) ? data : data.profiles ? Object.values(data.profiles) : data.players || []) as LookupPlayer[];
  }).catch(() => []);
  return snapshotPromise;
}

let catalogPromise: Promise<{ name: string; profileUrl?: string | null }[]> | undefined;
async function catalogAliases(): Promise<{ name: string; profileUrl?: string | null }[]> {
  catalogPromise ??= readFile(path.join(process.cwd(), "data", "player-catalog.json"), "utf8").then((body) => {
    const data = JSON.parse(body);
    return Array.isArray(data.players) ? data.players : [];
  }).catch(() => []);
  return catalogPromise;
}

function remember(key: string, result: PlayerLookupResult): PlayerLookupResult {
  if (result.status !== "not_found") {
    while (cache.size >= 250) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + CACHE_TTL, result: structuredClone(result) });
  }
  return result;
}

async function lookup(query: string, refresh = false): Promise<PlayerLookupResult> {
  const isUrl = /^(?:[a-z][a-z\d+.-]*:|www\.|[^\s]+\.(?:com|net|org)\/)/i.test(query);
  const validated = isUrl ? validateProfileUrl(query) : null;
  const saved = await snapshot();
  const aliases = validated ? [] : (await catalogAliases()).filter((entry) => normalizePlayerName(entry.name) === normalizePlayerName(query));
  const aliasUrls = new Set(aliases.map((entry) => entry.profileUrl).filter(Boolean));
  const matchingSaved = saved.filter((player) => validated ? player.id === `${validated.provider === "Cricbuzz" ? "cricbuzz" : "cricinfo"}-${validated.id}` : normalizePlayerName(player.name) === normalizePlayerName(query) || aliasUrls.has(player.profileUrl));
  // The snapshot may contain only one of several namesakes, so a name must still be disambiguated remotely.
  const freshSaved = !refresh && validated && matchingSaved.length === 1 && Date.now() - Date.parse(matchingSaved[0].fetchedAt) < CACHE_TTL ? matchingSaved[0] : null;
  if (freshSaved) return { status: "found", player: freshSaved, candidates: [], warnings: freshSaved.warnings, cached: true };
  const warnings: string[] = [];
  try {
    if (validated) {
      let html = "";
      try { html = await fetchPublicProfile(validated.url); }
      catch (error) { if (validated.provider !== "ESPNcricinfo") throw error; }
      const player = parsePlayerProfile(html, validated.url.toString());
      if (player) return { status: "found", player, candidates: [], warnings: player.warnings, cached: false };
      if (validated.provider === "Cricbuzz") throw new PlayerLookupError("This profile could not be read. Try searching by the player's name.", 502, "PROVIDER_RESPONSE");
      warnings.push("ESPNcricinfo did not expose this profile to automatic lookup. Choose the matching Cricbuzz profile below; its statistics will be clearly attributed.");
      if (!validated.nameHint) return { status: "not_found", candidates: [], warnings: [...warnings, "Search by the player's name to continue."], cached: false };
    }
    const search = validated?.nameHint || query;
    const remoteCandidates = parseSearchCandidates(await fetchPublicProfile(new URL(`https://www.cricbuzz.com/api/player-search/${encodeURIComponent(search)}`)));
    // Audited workbook aliases may reveal a different namesake omitted by public search (e.g. Akash Singh).
    // Present both identities; a partial provider result must not silently override the known catalog identity.
    const candidates = [...new Map([...remoteCandidates, ...matchingSaved].map((candidate) => [candidate.id, candidate])).values()];
    if (candidates.length === 0) return { status: "not_found", candidates, warnings: [...warnings, "No matching profile was found. Try the full name, paste a profile URL, or enter the player manually."], cached: false };
    const exact = candidates.filter((candidate) => normalizePlayerName(candidate.name) === normalizePlayerName(search));
    // A supplied ESPN slug is only a hint until confirmed; it does not prove the identity of its numeric ID.
    if (!validated && exact.length === 1 && !matchingSaved.some((candidate) => candidate.id !== exact[0].id)) {
      const player = parsePlayerProfile(await fetchPublicProfile(new URL(exact[0].profileUrl)), exact[0].profileUrl);
      if (player && normalizePlayerName(player.name) === normalizePlayerName(exact[0].name)) return { status: "found", player, candidates: [], warnings: player.warnings, cached: false };
    }
    return { status: "candidates", candidates, warnings: [...warnings, "Choose the correct player before importing."], cached: false };
  } catch (error) {
    if (error instanceof PlayerLookupError && error.status === 429) throw error;
    if (matchingSaved.length === 1 && validated) {
      const player = matchingSaved[0];
      return { status: "found", player, candidates: [], warnings: [...player.warnings, `Live refresh is unavailable. Showing the saved profile fetched ${player.fetchedAt.slice(0, 10)}.`], cached: true };
    }
    if (matchingSaved.length > 0) return { status: "candidates", candidates: matchingSaved, warnings: ["Live search is unavailable. Confirm the matching identity from the saved catalog."], cached: true };
    throw error;
  }
}

export async function lookupPlayer(input: unknown, options: { refresh?: boolean } = {}): Promise<PlayerLookupResult> {
  if (typeof input !== "string") throw new PlayerLookupError("Enter a player name or profile URL.");
  const query = input.trim();
  if (query.length < 2 || query.length > 500 || /[\u0000-\u001f\u007f]/.test(query)) throw new PlayerLookupError("Enter a name or profile URL between 2 and 500 characters.");
  if (!/^(?:https?:|www\.)/i.test(query) && query.length > 100) throw new PlayerLookupError("Player names can contain at most 100 characters.");
  if (!/^(?:[a-z][a-z\d+.-]*:|www\.|[^\s]+\.(?:com|net|org)\/)/i.test(query) && !/^[\p{L}\p{M}\d .’'-]+$/u.test(query)) throw new PlayerLookupError("Enter a player's name, or paste their complete profile URL.");
  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (!options.refresh && cached && cached.expires > Date.now()) return { ...structuredClone(cached.result), cached: true };
  const pending = inFlight.get(key);
  if (pending) return structuredClone(await pending);
  const promise = lookup(query, options.refresh).then((result) => remember(key, result));
  inFlight.set(key, promise);
  try { return await promise; } finally { inFlight.delete(key); }
}
