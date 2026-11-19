import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { validateSeasonSourceUrl, parseSeasonSourceHtml, parseSeasonSourceImport, fetchSeasonSource, SeasonSourceError }: typeof import("../lib/season-source") = await import(new URL("../lib/season-source.ts", import.meta.url).href);
const fixture = JSON.parse(await readFile(new URL("./fixtures/season-source.json", import.meta.url), "utf8"));
const sourceUrl = fixture.sourceUrl as string;
const html = (data: unknown = fixture) => `<html><script type="application/json" id="__NEXT_DATA__">${JSON.stringify(data)}</script></html>`;
const copy = () => structuredClone(fixture);
const rawRows = (data: typeof fixture) => data.props.appPageProps.data.content.smartStats;
const isSourceError = (code: string) => (error: unknown) => error instanceof SeasonSourceError && error.code === code;

test("series links accept both official hostnames, preserve series and discard tracking", () => {
  const result = validateSeasonSourceUrl("https://www.espncricinfo.com/series/ipl-2026-1510719/most-valuable-players/?ref=share#top");
  assert.equal(result.url.href, sourceUrl);
  assert.equal(result.seriesId, "1510719");
  assert.equal(validateSeasonSourceUrl("https://cricinfo.com/series/ipl-2025-1449924/most-valuable-players").seriesId, "1449924");
});

test("source validation rejects SSRF, credentials, custom ports and unrelated provider paths", () => {
  for (const input of [
    "http://www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players", "https://localhost/series/ipl-2026-1510719/most-valuable-players",
    "https://127.0.0.1/series/ipl-2026-1510719/most-valuable-players", "https://[::1]/series/ipl-2026-1510719/most-valuable-players",
    "https://www.cricinfo.com.evil.test/series/ipl-2026-1510719/most-valuable-players", "https://www.cricinfo.com@evil.test/series/ipl-2026-1510719/most-valuable-players",
    "https://user@www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players", "https://www.cricinfo.com:3000/series/ipl-2026-1510719/most-valuable-players",
    "https://www.cricinfo.com\\@127.0.0.1/series/ipl-2026-1510719/most-valuable-players", "https://www.cricinfo.com/api/private",
    "https://www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players/%2f%2fexample.com", "file:///etc/passwd", "javascript:alert(1)", "",
  ]) assert.throws(() => validateSeasonSourceUrl(input), SeasonSourceError, input);
});

test("observed ESPN rows retain exact long names, public IDs and full Total Impact precision", () => {
  const result = parseSeasonSourceHtml(html(), sourceUrl, "2026-11-20T00:00:00.000Z");
  assert.equal(result.seriesId, "1510719");
  assert.equal(result.seriesName, "IPL 2026");
  assert.equal(result.provider, "espncricinfo");
  assert.equal(result.fetchedAt, "2026-11-20T00:00:00.000Z");
  assert.deepEqual(result.rows[0], {
    providerPlayerId: "1408688", name: "Vaibhav Sooryavanshi", profileUrl: "https://www.cricinfo.com/cricketers/vaibhav-sooryavanshi-1408688",
    points: 1012.29, matches: 16, runs: 776, wickets: null, teamName: "Rajasthan Royals", battingImpact: 1012.29, bowlingImpact: 0,
  });
  assert.equal(result.rows[1].points, 791.42);
  assert.equal(result.rows[1].wickets, 28);
});

test("negative impact scores are preserved, unknown wickets stay null and known zeros stay zero", () => {
  const row = parseSeasonSourceHtml(html(), sourceUrl).rows[2];
  assert.equal(row.points, -25.81);
  assert.equal(row.bowlingImpact, -25.81);
  assert.equal(row.battingImpact, 0);
  assert.equal(row.runs, 0);
  assert.equal(row.wickets, null);
});

test("HTML attributes may be reordered; unrelated scripts are never executed", () => {
  const result = parseSeasonSourceHtml(`<script>throw new Error('never evaluate')</script><script id='__NEXT_DATA__' type='application/json'>${JSON.stringify(fixture)}</script>`, sourceUrl);
  assert.equal(result.rows.length, 3);
  for (const content of ["<html>Access denied</html>", "<script id='__NEXT_DATA__'>{broken}</script>", "<script id='__NEXT_DATA__'>{}</script>"]) {
    assert.throws(() => parseSeasonSourceHtml(content, sourceUrl), isSourceError("SEASON_SOURCE_RESPONSE"));
  }
});

test("mismatched series, partial tables and empty tables cannot overwrite saved points", () => {
  const wrong = copy(); wrong.props.appPageProps.data.series.objectId = 1449924;
  const partial = copy(); rawRows(partial).total = 202;
  const empty = copy(); rawRows(empty).results = []; rawRows(empty).total = 0;
  for (const data of [wrong, partial, empty]) assert.throws(() => parseSeasonSourceHtml(html(data), sourceUrl), isSourceError("SEASON_SOURCE_RESPONSE"));
});

test("duplicate IDs, missing player identity and invalid impact cause whole-snapshot rejection", () => {
  const duplicate = copy(); rawRows(duplicate).results[1].player.objectId = 1408688;
  const missingId = copy(); delete rawRows(missingId).results[0].player.objectId;
  const badName = copy(); rawRows(badName).results[0].player.longName = "<script>alert(1)</script>";
  const missingPoints = copy(); rawRows(missingPoints).results[0].totalImpact = null;
  const wrongType = copy(); rawRows(wrongType).results[0].type = "MATCH";
  for (const data of [duplicate, missingId, badName, missingPoints, wrongType]) assert.throws(() => parseSeasonSourceHtml(html(data), sourceUrl), isSourceError("SEASON_SOURCE_RESPONSE"));
});

test("a standard fetch returns a validated complete table and uses no cookie or authorization", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const result = await fetchSeasonSource(sourceUrl, async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(html(), { headers: { "content-type": "text/html; charset=utf-8" } });
  });
  assert.equal(result.rows.length, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, sourceUrl);
  assert.equal(calls[0].init?.redirect, "manual");
  assert.equal(calls[0].init?.cache, "no-store");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("cookie"), false);
  assert.ok(calls[0].init?.signal instanceof AbortSignal);
});

test("redirects to the other official domain work for the same series", async () => {
  let calls = 0;
  const result = await fetchSeasonSource(sourceUrl, async (input) => {
    if (calls++ === 0) return new Response(null, { status: 302, headers: { location: sourceUrl.replace("www.cricinfo.com", "www.espncricinfo.com") } });
    assert.match(String(input), /www\.espncricinfo\.com/);
    return new Response(html(), { headers: { "content-type": "text/html" } });
  });
  assert.equal(calls, 2);
  assert.equal(result.rows.length, 3);
});

test("redirect validation prevents a second request to private, unrelated or wrong-series locations", async () => {
  for (const target of ["http://169.254.169.254/latest/meta-data/", "https://evil.test/", "https://www.cricinfo.com/api/private", sourceUrl.replace("1510719", "1449924"), "https://user@www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players"]) {
    let calls = 0;
    await assert.rejects(fetchSeasonSource(sourceUrl, async () => { calls++; return new Response(null, { status: 302, headers: { location: target } }); }), isSourceError("SEASON_SOURCE_REDIRECT"));
    assert.equal(calls, 1);
  }
});

test("redirect loops stop after four responses", async () => {
  let calls = 0;
  await assert.rejects(fetchSeasonSource(sourceUrl, async () => { calls++; return new Response(null, { status: 302, headers: { location: sourceUrl } }); }), isSourceError("SEASON_SOURCE_REDIRECT"));
  assert.equal(calls, 4);
});

test("provider denial and rate limiting report honest errors, not invented or stale rows", async () => {
  for (const status of [401, 403, 404, 500]) await assert.rejects(fetchSeasonSource(sourceUrl, async () => new Response("Unavailable", { status })), isSourceError("SEASON_SOURCE_UNAVAILABLE"));
  await assert.rejects(fetchSeasonSource(sourceUrl, async () => new Response("Slow down", { status: 429 })), isSourceError("SEASON_SOURCE_RATE_LIMIT"));
  await assert.rejects(fetchSeasonSource(sourceUrl, async () => { throw new Error("Network failed"); }), isSourceError("SEASON_SOURCE_UNAVAILABLE"));
});

test("HTML byte limits apply to content length and streamed data; binary responses are rejected", async () => {
  await assert.rejects(fetchSeasonSource(sourceUrl, async () => new Response("", { headers: { "content-length": "4000001", "content-type": "text/html" } })), isSourceError("SEASON_SOURCE_RESPONSE"));
  await assert.rejects(fetchSeasonSource(sourceUrl, async () => new Response("x".repeat(4_000_001), { headers: { "content-type": "text/html" } })), isSourceError("SEASON_SOURCE_RESPONSE"));
  await assert.rejects(fetchSeasonSource(sourceUrl, async () => new Response("binary", { headers: { "content-type": "image/png" } })), isSourceError("SEASON_SOURCE_RESPONSE"));
  assert.throws(() => parseSeasonSourceHtml("x".repeat(4_000_001), sourceUrl), isSourceError("SEASON_SOURCE_RESPONSE"));
});

test("CSV and clipboard TSV accept explicit Player/Total Impact columns without guessing other statistics", () => {
  const csv = parseSeasonSourceImport('Player,Total Impact,Matches,Runs,Wkts,Team,Player ID\nVaibhav Sooryavanshi,"1,012.29",16,776,-,RR,1408688\nMayank Markande,-25.81,3,0,-,MI,1081442', sourceUrl);
  assert.equal(csv.rows[0].points, 1012.29);
  assert.equal(csv.rows[0].providerPlayerId, "1408688");
  assert.equal(csv.rows[1].points, -25.81);
  assert.equal(csv.rows[1].wickets, null);
  const tsv = parseSeasonSourceImport("Name\tPoints\tRuns\r\nSample Player\t0\t0\r\n", sourceUrl);
  assert.equal(tsv.rows[0].points, 0);
  assert.equal(tsv.rows[0].providerPlayerId, null);
  assert.equal(tsv.rows[0].profileUrl, null);
  assert.throws(() => parseSeasonSourceImport("Player,Runs\nSample Player,10", sourceUrl), SeasonSourceError);
});

test("manual JSON values preserve provenance and support an array or rows wrapper", () => {
  const values = [{ name: "Player One", points: 0.5, providerPlayerId: "123", matches: 2 }, { name: "Player Two", totalImpact: -10.2 }];
  for (const data of [values, { rows: values }]) {
    const result = parseSeasonSourceImport(JSON.stringify(data), sourceUrl, "2026-11-20T00:00:00.000Z");
    assert.equal(result.sourceUrl, sourceUrl);
    assert.equal(result.rows[0].points, 0.5);
    assert.equal(result.rows[1].points, -10.2);
    assert.equal(result.rows[1].matches, null);
  }
});

test("manual import rejects ambiguous columns, duplicate identities, malformed quoting and non-numeric points", () => {
  for (const text of [
    'Player,Points,Total Impact\nPlayer One,1,2', 'Player,Points\n"Player One,1', 'Player,Points\n"Player One"junk,1',
    'Player,Points\nPlayer One,1,2', 'Player,Points\nPlayer One,1\nPlayer One,2', 'Player,Points\nPlayer One,NaN',
    'Player,Points\nPlayer One,Infinity', 'Player,Points\nPlayer One,3e7', 'Player,Points\nPlayer One,"1,2"',
    '[]', '{}', '{invalid}', JSON.stringify([{ name: "A", points: 2, totalImpact: 4 }]),
    JSON.stringify([{ name: "A", points: true }]), JSON.stringify([{ name: "A", points: 1, matches: -1 }]),
    JSON.stringify([{ name: "A", points: 1, providerPlayerId: "../../private" }]),
  ]) assert.throws(() => parseSeasonSourceImport(text, sourceUrl), SeasonSourceError, text);
});

test("identical names need distinct provider IDs, and unknown-ID duplicates never guess", () => {
  const people = [{ name: "Same Name", points: 1, providerPlayerId: "1" }, { name: "Same Name", points: 2, providerPlayerId: "2" }];
  assert.equal(parseSeasonSourceImport(JSON.stringify(people), sourceUrl).rows.length, 2);
  assert.throws(() => parseSeasonSourceImport(JSON.stringify([...people, { name: "Same Name", points: 3 }]), sourceUrl), SeasonSourceError);
});

test("imports are bounded and escaped quotation marks do not become executable markup", () => {
  const result = parseSeasonSourceImport('Player,Points\n"Sample ""Nickname"" Player",12.4', sourceUrl);
  assert.equal(result.rows[0].name, 'Sample "Nickname" Player');
  assert.throws(() => parseSeasonSourceImport("x".repeat(4_000_001), sourceUrl), SeasonSourceError);
  assert.throws(() => parseSeasonSourceImport(JSON.stringify(Array.from({ length: 1_001 }, (_, i) => ({ name: `Player ${i}`, points: 1 }))), sourceUrl), SeasonSourceError);
  assert.throws(() => parseSeasonSourceImport('Player,Points\n<script>alert(1)</script>,10', sourceUrl), SeasonSourceError);
});

test("subnormal and excessive-precision points cannot overflow decimal aggregation", () => {
  for (const points of [5e-324, 1e-100, 1e-7, 0.12345678901234567]) {
    assert.throws(() => parseSeasonSourceImport(JSON.stringify([{ name: "Example", points }]), sourceUrl), SeasonSourceError);
  }
  assert.equal(parseSeasonSourceImport(JSON.stringify([{ name: "Example", points: 0.000001 }]), sourceUrl).rows[0].points, 0.000001);
});

test("prototype-shaped headers and JSON keys cannot alter the importer or objects", () => {
  const table = parseSeasonSourceImport('Player,Points,constructor,__proto__\nExample,2,ignored,ignored', sourceUrl);
  assert.equal(table.rows[0].points, 2);
  const json = parseSeasonSourceImport('[{"name":"Example","points":2,"__proto__":{"polluted":true}}]', sourceUrl);
  assert.equal(json.rows[0].points, 2);
  assert.equal(Object.hasOwn({}, "polluted"), false);
});
