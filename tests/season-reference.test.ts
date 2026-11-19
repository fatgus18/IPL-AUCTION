import assert from "node:assert/strict";
import test from "node:test";

const { getSeasonReference, SEASON_REFERENCE_METADATA }: typeof import("../lib/season-reference") = await import(new URL("../lib/season-reference.ts", import.meta.url).href);
const source = "https://www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players";

test("the reference contains the complete observed series and preserves actual capture time and negative points", () => {
  const snapshot = getSeasonReference(source)!;
  assert.equal(snapshot.sourceUrl, source);
  assert.equal(snapshot.provider, "espncricinfo");
  assert.equal(snapshot.seriesId, "1510719");
  assert.equal(snapshot.seriesName, "IPL 2026");
  assert.equal(snapshot.fetchedAt, "2026-11-19T20:00:31.557Z");
  assert.equal(snapshot.rows.length, 202);
  assert.equal(new Set(snapshot.rows.map(row => row.providerPlayerId)).size, 202);
  assert.equal(snapshot.rows.find(row => row.providerPlayerId === "1408688")?.points, 1012.29);
  assert.equal(snapshot.rows.find(row => row.providerPlayerId === "1403153")?.points, -31.54);
  assert.equal(snapshot.rows.filter(row => row.points < 0).length, 13);
  assert.deepEqual(SEASON_REFERENCE_METADATA, { sourceUrl: source, seriesId: "1510719", seriesName: "IPL 2026", fetchedAt: snapshot.fetchedAt, playerCount: 202 });
});

test("only the same official MVP series is eligible for the explicit reference fallback", () => {
  assert.ok(getSeasonReference(source.replace("www.cricinfo.com", "www.espncricinfo.com")));
  for (const url of [source.replace("1510719", "1449924"), source.replace("https:", "http:"), source.replace("www.cricinfo.com", "evil.test"), source.replace("most-valuable-players", "points-table-standings"), "", "file:///etc/passwd"]) {
    assert.equal(getSeasonReference(url), null, url);
  }
});

test("reference snapshots are independent clones and never overwrite the original capture timestamp", () => {
  const first = getSeasonReference(source)!;
  first.rows[0].points = 999;
  first.rows[0].name = "Room-local edit";
  first.rows.pop();
  first.fetchedAt = "2099-01-01T00:00:00.000Z";
  const second = getSeasonReference(source)!;
  assert.equal(second.rows.length, 202);
  assert.equal(second.rows[0].name, "Vaibhav Sooryavanshi");
  assert.equal(second.rows[0].points, 1012.29);
  assert.equal(second.fetchedAt, SEASON_REFERENCE_METADATA.fetchedAt);
  assert.ok(Object.isFrozen(SEASON_REFERENCE_METADATA));
});
