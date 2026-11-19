/** Server-side import of complete ESPNcricinfo series MVP tables. Never execute provider scripts. */
const MAX_SOURCE_BYTES = 4_000_000;
const MAX_PLAYERS = 1_000;
const SOURCE_TIMEOUT_MS = 15_000;
const SOURCE_HOSTS = new Set(["cricinfo.com", "www.cricinfo.com", "espncricinfo.com", "www.espncricinfo.com"]);
let activeFetches = 0;

export class SeasonSourceError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "SEASON_SOURCE_INVALID") {
    super(message);
    this.name = "SeasonSourceError";
    this.status = status;
    this.code = code;
  }
}

export type SeasonSourceRow = {
  providerPlayerId: string | null;
  name: string;
  profileUrl: string | null;
  points: number;
  matches: number | null;
  runs: number | null;
  wickets: number | null;
  teamName: string | null;
  battingImpact: number | null;
  bowlingImpact: number | null;
};

export type SeasonSourceSnapshot = {
  sourceUrl: string;
  provider: "espncricinfo";
  seriesId: string;
  seriesName: string;
  fetchedAt: string;
  rows: SeasonSourceRow[];
};

/** Only public series MVP pages are accepted. Tracking parameters are discarded, never fetched. */
export function validateSeasonSourceUrl(input: string): { url: URL; seriesId: string } {
  if (typeof input !== "string" || input.length > 2_048 || /[\\\u0000-\u0020]/.test(input)) {
    throw new SeasonSourceError("Use a complete ESPNcricinfo most-valuable-players link.");
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new SeasonSourceError("Use a complete ESPNcricinfo most-valuable-players link."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !SOURCE_HOSTS.has(url.hostname)) {
    throw new SeasonSourceError("Use an HTTPS ESPNcricinfo or Cricinfo series MVP link without a custom port or credentials.");
  }
  const match = url.pathname.match(/^\/series\/((?:[a-zA-Z][a-zA-Z0-9-]*-)?([1-9]\d{0,9}))\/most-valuable-players\/?$/);
  if (!match) throw new SeasonSourceError("Open a series’ Most valuable players page and paste that page’s link.");
  // ESPN's current public canonical host. Both provider domains are accepted on input and redirects.
  return { url: new URL(`https://www.cricinfo.com/series/${match[1]}/most-valuable-players`), seriesId: match[2] };
}

export function normalizeSeasonSourceUrl(input: string): string {
  return validateSeasonSourceUrl(input).url.href;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 120 && !/[<>\u0000-\u001f\u007f]/.test(name) ? name : null;
}

function providerId(value: unknown): string | null {
  return (typeof value === "number" || typeof value === "string") && /^[1-9]\d{0,9}$/.test(String(value)) ? String(value) : null;
}

function numeric(value: unknown, signed = false): number | null {
  if (value == null || value === "" || value === "-" || value === "—") return null;
  if (typeof value === "string" && !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim())) return null;
  const normalized = typeof value === "string" ? value.trim().replace(/,/g, "") : value;
  if (typeof normalized !== "number" && (typeof normalized !== "string" || !/^-?\d+(?:\.\d+)?$/.test(normalized))) return null;
  const number = Number(normalized);
  // The observed provider uses two decimals. Six supports finer manual data while
  // excluding subnormal/excess-precision values that cannot produce stable totals.
  return Number.isFinite(number) && Math.abs(number) <= 1_000_000 && /^-?\d+(?:\.\d{1,6})?$/.test(String(number)) && (signed || number >= 0) ? number : null;
}

function count(value: unknown): number | null {
  const number = numeric(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function invalidResponse(message = "The provider returned an unrecognised MVP table. Your last successful update has been kept."): never {
  throw new SeasonSourceError(message, 502, "SEASON_SOURCE_RESPONSE");
}

function uniqueRows(rows: SeasonSourceRow[]): SeasonSourceRow[] {
  if (!rows.length || rows.length > MAX_PLAYERS) invalidResponse("The source must contain between 1 and 1,000 player rows.");
  const ids = new Set<string>();
  const unnamedIds = new Set<string>();
  const names = new Map<string, string | null>();
  for (const row of rows) {
    const name = row.name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    if (names.has(name) && (!row.providerPlayerId || !names.get(name))) invalidResponse("Repeated names need distinct ESPN player IDs. No points were changed.");
    names.set(name, row.providerPlayerId);
    const key = row.providerPlayerId ?? name;
    const seen = row.providerPlayerId ? ids : unnamedIds;
    if (seen.has(key)) invalidResponse("The source contains duplicate player rows. Import a complete table with one row per player.");
    seen.add(key);
  }
  return rows;
}

function snapshot(sourceUrl: string, rows: SeasonSourceRow[], fetchedAt: string, seriesName?: string): SeasonSourceSnapshot {
  const { url, seriesId } = validateSeasonSourceUrl(sourceUrl);
  return {
    sourceUrl: url.href,
    provider: "espncricinfo",
    seriesId,
    seriesName: seriesName || url.pathname.split("/")[2].replace(/-\d+$/, "").replace(/-/g, " "),
    fetchedAt,
    rows: uniqueRows(rows),
  };
}

/** Parse the observed provider schema, retaining full Total Impact precision and negative scores. */
export function parseSeasonSourceHtml(html: string, sourceUrl: string, fetchedAt = new Date().toISOString()): SeasonSourceSnapshot {
  const { seriesId } = validateSeasonSourceUrl(sourceUrl);
  if (Buffer.byteLength(html, "utf8") > MAX_SOURCE_BYTES) invalidResponse("The provider response was too large.");
  const script = html.match(/<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  if (!script) invalidResponse("ESPNcricinfo did not provide its MVP table. Try again later or import a copied CSV/JSON table.");
  let next: Record<string, unknown> | null;
  try { next = object(JSON.parse(script[1])); } catch { invalidResponse(); }
  const props = object(next?.props);
  const page = object(props?.appPageProps) ?? object(props?.pageProps);
  const data = object(page?.data);
  const series = object(data?.series);
  if (providerId(series?.objectId) !== seriesId) invalidResponse("The returned series does not match your source link. No points were changed.");
  const stats = object(object(data?.content)?.smartStats);
  const rawRows = stats?.results;
  if (!Array.isArray(rawRows) || rawRows.length === 0 || rawRows.length > MAX_PLAYERS || count(stats?.total) !== rawRows.length) {
    invalidResponse("ESPNcricinfo returned an empty or incomplete MVP table. Your last successful update has been kept.");
  }
  const rows = rawRows.map((entry): SeasonSourceRow => {
    const row = object(entry);
    const player = object(row?.player);
    const id = providerId(player?.objectId);
    const name = cleanName(player?.longName);
    const slug = typeof player?.slug === "string" && /^[a-zA-Z0-9-]{1,160}$/.test(player.slug) ? player.slug : null;
    const points = numeric(row?.totalImpact, true);
    if (row?.type !== "SERIES" || !id || !name || points === null) invalidResponse("An MVP player row is incomplete. No points were changed.");
    return {
      providerPlayerId: id,
      name,
      profileUrl: `https://www.cricinfo.com/cricketers/${slug ? `${slug}-` : ""}${id}`,
      points,
      matches: count(row.matches),
      runs: count(row.runs),
      wickets: count(row.wickets),
      teamName: cleanName(object(row.team)?.longName),
      battingImpact: numeric(row.battingImpact, true),
      bowlingImpact: numeric(row.bowlingImpact, true),
    };
  });
  return snapshot(sourceUrl, rows, fetchedAt, cleanName(series?.seoName) ?? cleanName(series?.longName) ?? undefined);
}

/** Fetches never follow arbitrary redirects, forward cookies, or access caller-supplied hosts. */
export async function fetchSeasonSource(input: string, fetcher: typeof fetch = fetch): Promise<SeasonSourceSnapshot> {
  const source = validateSeasonSourceUrl(input);
  if (activeFetches >= 3) throw new SeasonSourceError("Season imports are busy. Try again in a moment.", 429, "SEASON_SOURCE_BUSY");
  activeFetches++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    let url = source.url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const checked = validateSeasonSourceUrl(url.href);
      if (checked.seriesId !== source.seriesId) throw new SeasonSourceError("The provider redirected to a different series.", 502, "SEASON_SOURCE_REDIRECT");
      // Validate without canonicalizing redirect hosts again, avoiding a redirect loop if the provider changes hosts.
      const response = await fetcher(url, {
        redirect: "manual", signal: controller.signal, cache: "no-store",
        headers: { Accept: "text/html", "User-Agent": "PavilionAuction/1.0 (public series MVP table)" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const target = response.headers.get("location");
        if (!target || redirects === 3) throw new SeasonSourceError("ESPNcricinfo could not resolve that series link.", 502, "SEASON_SOURCE_REDIRECT");
        let destination: URL;
        try {
          if (/[\\\u0000-\u0020]/.test(target)) throw new Error("Invalid redirect");
          destination = new URL(target, url);
          if (validateSeasonSourceUrl(destination.href).seriesId !== source.seriesId) throw new Error("Different series");
        } catch { throw new SeasonSourceError("The provider redirected to an unsupported destination.", 502, "SEASON_SOURCE_REDIRECT"); }
        destination.search = "";
        destination.hash = "";
        url = destination;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new SeasonSourceError("ESPNcricinfo is limiting requests. Wait a minute before fetching again.", 429, "SEASON_SOURCE_RATE_LIMIT");
        throw new SeasonSourceError(response.status === 404
          ? "That MVP page was not found. Check the series link."
          : "ESPNcricinfo is not allowing this fetch right now. Your saved points are unchanged; try later or import a copied CSV/JSON table.", 502, "SEASON_SOURCE_UNAVAILABLE");
      }
      const type = response.headers.get("content-type") ?? "";
      if (type && !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type)) {
        await response.body?.cancel();
        invalidResponse("The source returned a file instead of an MVP page.");
      }
      if (Number(response.headers.get("content-length") || 0) > MAX_SOURCE_BYTES) {
        await response.body?.cancel();
        invalidResponse("The provider response was too large.");
      }
      const reader = response.body?.getReader();
      if (!reader) invalidResponse();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_SOURCE_BYTES) {
          await reader.cancel();
          invalidResponse("The provider response was too large.");
        }
        chunks.push(value);
      }
      return parseSeasonSourceHtml(Buffer.concat(chunks).toString("utf8"), source.url.href);
    }
    throw new SeasonSourceError("ESPNcricinfo could not resolve that series link.", 502, "SEASON_SOURCE_REDIRECT");
  } catch (error) {
    if (error instanceof SeasonSourceError) throw error;
    throw new SeasonSourceError(controller.signal.aborted
      ? "Fetching the MVP table took too long. Your saved points are unchanged; try again in a moment."
      : "Could not reach ESPNcricinfo. Your saved points are unchanged; try again later.", 502, "SEASON_SOURCE_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
    activeFetches--;
  }
}

function delimitedRows(input: string): string[][] {
  const delimiter = input.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const finishCell = () => { row.push(cell.trim()); cell = ""; closed = false; };
  const finishRow = () => { finishCell(); if (row.some(Boolean)) rows.push(row); row = []; if (rows.length > MAX_PLAYERS + 1) invalidResponse("Import at most 1,000 players at a time."); };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === delimiter) finishCell();
    else if (char === "\n" || char === "\r") { if (char === "\r" && input[index + 1] === "\n") index++; finishRow(); }
    else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === '"' || (closed && char.trim())) invalidResponse("The copied table has malformed quotation marks.");
    else if (!closed) cell += char;
  }
  if (quoted) invalidResponse("The copied table has an unfinished quoted value.");
  if (cell || row.length || closed) finishRow();
  return rows;
}

const HEADER_KEYS: Record<string, string> = {
  player: "name", name: "name", playername: "name",
  points: "points", totalimpact: "points", impactpoints: "points",
  providerplayerid: "providerPlayerId", espnplayerid: "providerPlayerId", playerid: "providerPlayerId",
  matches: "matches", mats: "matches", runs: "runs", wickets: "wickets", wkts: "wickets",
  team: "teamName", teamname: "teamName", battingimpact: "battingImpact", bowlingimpact: "bowlingImpact",
};

/** Explicit manual fallback; the UI must label these as imported values, not a successful remote fetch. */
export function parseSeasonSourceImport(input: string, sourceUrl: string, fetchedAt = new Date().toISOString()): SeasonSourceSnapshot {
  validateSeasonSourceUrl(sourceUrl);
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_SOURCE_BYTES) throw new SeasonSourceError("Import a CSV, TSV or JSON table smaller than 4 MB.");
  const text = input.replace(/^\uFEFF/, "").trim();
  if (!text) throw new SeasonSourceError("Paste a CSV, TSV or JSON player points table first.");
  let data: unknown[];
  if (/^[\[{]/.test(text)) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new SeasonSourceError("The JSON is not valid. Use an array of player rows or an object with a rows array."); }
    const rows = Array.isArray(parsed) ? parsed : object(parsed)?.rows;
    if (!Array.isArray(rows)) throw new SeasonSourceError("The JSON must contain an array of player rows.");
    data = rows;
  } else {
    const [headers, ...records] = delimitedRows(text);
    const keys = headers?.map((header) => {
      const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, "");
      return Object.hasOwn(HEADER_KEYS, normalized) ? HEADER_KEYS[normalized] : null;
    });
    if (!keys?.includes("name") || !keys.includes("points")) throw new SeasonSourceError("Include Player and Total Impact (or Name and Points) columns.");
    const known = keys.filter(Boolean);
    if (new Set(known).size !== known.length) throw new SeasonSourceError("Each points-table column must appear only once.");
    data = records.map((values) => {
      if (values.length !== headers.length) throw new SeasonSourceError("A table row has a different number of columns than the header.");
      return Object.fromEntries(keys.flatMap((key, index) => key ? [[key, values[index]]] : []));
    });
  }
  if (data.length > MAX_PLAYERS) throw new SeasonSourceError("Import at most 1,000 players at a time.");
  const rows = data.map((entry, index): SeasonSourceRow => {
    const row = object(entry);
    const name = cleanName(row?.name);
    const points = numeric(row?.points ?? row?.totalImpact, true);
    if (!row || !name || points === null) throw new SeasonSourceError(`Row ${index + 1} needs a player name and a numeric points value.`);
    if (row.points != null && row.totalImpact != null && numeric(row.points, true) !== numeric(row.totalImpact, true)) throw new SeasonSourceError(`Row ${index + 1} has conflicting Points and Total Impact values.`);
    const rawId = row.providerPlayerId;
    const id = rawId == null || rawId === "" ? null : providerId(rawId);
    if (rawId != null && rawId !== "" && !id) throw new SeasonSourceError(`Row ${index + 1} has an invalid ESPN player ID.`);
    for (const key of ["matches", "runs", "wickets"] as const) {
      if (row[key] != null && !["", "-", "—"].includes(String(row[key])) && count(row[key]) === null) throw new SeasonSourceError(`Row ${index + 1} has an invalid ${key} value.`);
    }
    return {
      providerPlayerId: id, name, profileUrl: id ? `https://www.cricinfo.com/cricketers/${id}` : null,
      points, matches: count(row.matches), runs: count(row.runs), wickets: count(row.wickets),
      teamName: cleanName(row.teamName), battingImpact: numeric(row.battingImpact, true), bowlingImpact: numeric(row.bowlingImpact, true),
    };
  });
  return snapshot(sourceUrl, rows, fetchedAt);
}
