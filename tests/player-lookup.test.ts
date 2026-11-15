import assert from "node:assert/strict";
import test from "node:test";

const { validateProfileUrl, parseStatistic, parseSearchCandidates, parsePlayerProfile, fetchPublicProfile, lookupPlayer, PlayerLookupError }: typeof import("../lib/player-lookup") = await import(new URL("../lib/player-lookup.ts", import.meta.url).href);

const profileUrl = "https://www.cricbuzz.com/profiles/999999/sample-player";
const identity = `<script type="application/ld+json">${JSON.stringify({ "@type": "WebPage", name: "Sample Player - Cricketer - Batsman - India", mainEntity: { type: "Person", name: "Sample Player", nationality: "India", birthDate: "2000-01-01" } })}</script>`;
function table(heading: string, rows: string[][]) {
  return `${heading}<table><thead><tr><th></th><th>Test</th><th>ODI</th><th>T20</th><th>IPL</th></tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
const fixture = `${identity}<div>Role</div><div>Batsman</div><div>Batting Style</div><div>Right Handed Bat</div><img alt="sample-player" src="https://static.cricbuzz.com/a/img/v1/i1/c123/sample-player.jpg"/>${table("Batting Career Summary", [["Matches", "10", "20", "30", "45"], ["Runs", "500", "700", "900", "1,234"], ["SR", "50.0", "80.0", "130.0", "142.37"]])}${table("Bowling Career Summary", [["Matches", "10", "20", "30", "45"], ["Wickets", "10", "20", "30", "0"], ["SR", "40.0", "30.0", "20.0", "999.0"]])}`;

test("canonicalizes supported profiles and discards tracking query strings", () => {
  assert.equal(validateProfileUrl("https://m.cricbuzz.com/profiles/1413/virat-kohli?ref=foo").url.href, "https://www.cricbuzz.com/profiles/1413/virat-kohli");
  assert.equal(validateProfileUrl("https://www.espncricinfo.com/cricketers/virat-kohli-253802/bowling-batting-stats").id, "253802");
  assert.equal(validateProfileUrl("https://www.espncricinfo.com/india/content/player/253802.html").id, "253802");
});

test("rejects SSRF inputs, credentials, ports, scheme confusion and non-profile routes", () => {
  for (const url of ["http://www.cricbuzz.com/profiles/1/a", "https://127.0.0.1/profiles/1/a", "https://[::1]/profiles/1/a", "https://www.cricbuzz.com.evil.test/profiles/1/a", "https://www.cricbuzz.com@evil.test/profiles/1/a", "https://evil@www.cricbuzz.com/profiles/1/a", "https://www.cricbuzz.com:3000/profiles/1/a", "file:///etc/passwd", "https://www.cricbuzz.com/api/private", "https://www.cricbuzz.com/profiles/1/a/../../api/private", "https://www.cricbuzz.com\\@127.0.0.1/profiles/1/a", "https://www.cricbuzz.com/profiles/1/%2f%2f127.0.0.1"]) assert.throws(() => validateProfileUrl(url), PlayerLookupError, url);
});

test("missing and invalid statistics stay null; explicit zeros stay zero", () => {
  for (const input of [undefined, null, "", "-", "N/A", "NaN", "Infinity", "3e8", "12foo", "-1", -1, NaN, Infinity]) assert.equal(parseStatistic(input), null);
  assert.equal(parseStatistic("0"), 0);
  assert.equal(parseStatistic("1,234"), 1234);
  assert.equal(parseStatistic("134.37"), 134.37);
});

test("selects a single IPL format, keeps bowling strike rate out of batting statistics", () => {
  const player = parsePlayerProfile(fixture, profileUrl, "2026-11-14T00:00:00.000Z");
  assert.ok(player);
  assert.equal(player.name, "Sample Player");
  assert.equal(player.country, "India");
  assert.equal(player.role, "Batter");
  assert.equal(player.statsFormat, "IPL");
  assert.deepEqual(player.stats, { matches: 45, runs: 1234, wickets: 0, strikeRate: 142.37 });
  assert.deepEqual(player.sourceUrls, [profileUrl]);
  assert.equal(player.fetchedAt, "2026-11-14T00:00:00.000Z");
  assert.match(player.image!, /static\.cricbuzz\.com/);
});

test("Cricbuzz WK-Batsman maps to wicketkeeper before the broader batsman role", () => {
  assert.equal(parsePlayerProfile(fixture.replace("<div>Batsman</div>", "<div>WK-Batsman</div>"), profileUrl)!.role, "Wicketkeeper");
});

test("labels Cricbuzz T20 column as internationals when IPL data is unavailable", () => {
  const player = parsePlayerProfile(fixture.replace(/<td>45<\/td>/g, "<td>-</td>"), profileUrl)!;
  assert.equal(player.statsFormat, "T20I");
  assert.equal(player.stats.matches, 30);
  assert.equal(player.stats.runs, 900);
  assert.match(player.warnings.join(" "), /No IPL/);
});

test("missing wicket totals stay null and mismatched tables are flagged", () => {
  const missing = parsePlayerProfile(fixture.replace("<td>0</td>", "<td>-</td>"), profileUrl)!;
  assert.equal(missing.stats.wickets, null);
  assert.ok(missing.missingFields.includes("stats.wickets"));
  const conflict = parsePlayerProfile(fixture.replace("Bowling Career Summary", "Bowling Career Summary").replace(/(<td>45<\/td>)(?![\s\S]*<td>45<\/td>)/, "<td>44</td>"), profileUrl)!;
  assert.equal(conflict.stats.matches, null);
  assert.equal(conflict.stats.wickets, null);
  assert.match(conflict.warnings.join(" "), /disagree/);
});

test("challenge HTML, JavaScript and unrelated JSON-LD are not player data", () => {
  assert.equal(parsePlayerProfile('<html><script>throw new Error("must not execute")</script>Please verify</html>', profileUrl), null);
  assert.equal(parsePlayerProfile('<script type="application/ld+json">{"@type":"Organization","name":"Provider"}</script>', profileUrl), null);
  const player = parsePlayerProfile(identity, profileUrl)!;
  assert.deepEqual(player.stats, { matches: null, runs: null, wickets: null, strikeRate: null });
  assert.equal(player.statsFormat, null);
});

test("unsafe photos and standard silhouettes are excluded", () => {
  for (const image of ["http://127.0.0.1/private", "https://private.test/track.jpg", "javascript:alert(1)", "https://static.cricbuzz.com/a/img/v1/i1/c182026/unknown.jpg"]) {
    assert.equal(parsePlayerProfile(fixture.replace("https://static.cricbuzz.com/a/img/v1/i1/c123/sample-player.jpg", image), profileUrl)!.image, null);
  }
});

test("search keeps distinct people with the same name and rejects unsafe IDs", () => {
  const candidates = parseSearchCandidates(JSON.stringify({ player: [{ id: "1", name: "Same Name", teamName: "India", faceImageId: 182026 }, { id: "2", name: "Same Name", teamName: "Nepal", faceImageId: 321 }, { id: "../../etc", name: "Bad" }] }));
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].id, candidates[1].id);
  assert.equal(candidates[0].image, null);
});

test("remote redirects cannot escape trusted hosts or permitted paths", async () => {
  let calls = 0;
  await assert.rejects(fetchPublicProfile(new URL(profileUrl), async () => { calls++; return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data/" } }); }), (error: unknown) => error instanceof PlayerLookupError && error.code === "UNSAFE_REDIRECT");
  assert.equal(calls, 1);
});

test("provider errors and oversized streamed bodies produce friendly errors", async () => {
  await assert.rejects(fetchPublicProfile(new URL(profileUrl), async () => new Response("secret stack", { status: 503 })), /temporarily unavailable/);
  await assert.rejects(fetchPublicProfile(new URL(profileUrl), async () => new Response("x".repeat(2_000_001))), /too large/);
});

test("ambiguous exact names require a choice and do not fetch a guessed profile", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ player: [{ id: "989991", name: "Ambiguous Test", teamName: "India" }, { id: "989992", name: "Ambiguous Test", teamName: "Nepal" }] }));
  const result = await lookupPlayer("Ambiguous Test");
  assert.equal(result.status, "candidates");
  assert.equal(result.candidates.length, 2);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("partial name matches require confirmation even when the provider returns one candidate", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ player: [{ id: "989993", name: "Unusual Fullname", teamName: "India" }] }));
  assert.equal((await lookupPlayer("Unusual")).status, "candidates");
});

test("unique exact name fetches profile and successful lookup is cached", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (url: URL) => String(url).includes("player-search") ? Response.json({ player: [{ id: "999999", name: "Sample Player", teamName: "India" }] }) : new Response(fixture));
  const first = await lookupPlayer("Sample Player");
  assert.equal(first.status, "found");
  assert.equal(first.player!.stats.runs, 1234);
  assert.equal(fetchMock.mock.callCount(), 2);
  const second = await lookupPlayer("Sample Player");
  assert.equal(second.cached, true);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("ESPN blocking falls back to candidate review instead of trusting an unverified URL slug", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: URL) => String(url).includes("espncricinfo") ? new Response("access denied", { status: 403 }) : Response.json({ player: [{ id: "989994", name: "Fallback Player", teamName: "India" }] }));
  const result = await lookupPlayer("https://www.espncricinfo.com/cricketers/fallback-player-9999");
  assert.equal(result.status, "candidates");
  assert.equal(result.candidates[0].name, "Fallback Player");
  assert.match(result.warnings.join(" "), /ESPNcricinfo/);
});

const live = process.env.PAVILION_LIVE_LOOKUP === "1";
test("live provider: full name resolves canonical identity, photo and one career format", { skip: !live }, async () => {
  const result = await lookupPlayer("Virat Kohli", { refresh: true });
  assert.equal(result.status, "found");
  assert.equal(result.player!.name, "Virat Kohli");
  assert.equal(result.player!.country, "India");
  assert.equal(result.player!.statsFormat, "IPL");
  assert.ok(result.player!.stats.matches! > 0);
  assert.ok(result.player!.stats.runs! > 0);
  assert.match(result.player!.image!, /^https:\/\/static\.cricbuzz\.com\//);
});

test("live provider: explicit profile URL selects the requested player", { skip: !live }, async () => {
  const result = await lookupPlayer("https://www.cricbuzz.com/profiles/10808/mohammed-siraj", { refresh: true });
  assert.equal(result.status, "found");
  assert.equal(result.player!.id, "cricbuzz-10808");
  assert.equal(result.player!.role, "Bowler");
  assert.ok(result.player!.stats.wickets! > 0);
});

test("live provider: namesakes remain distinct candidates", { skip: !live }, async () => {
  const result = await lookupPlayer("Rashid Khan", { refresh: true });
  assert.equal(result.status, "candidates");
  assert.ok(result.candidates.length > 1);
  assert.ok(result.candidates.some((candidate) => candidate.country === "Afghanistan"));
});
