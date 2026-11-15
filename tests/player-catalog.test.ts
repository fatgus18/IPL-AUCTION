import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type SourceRow = { sheet: string; row: number; originalName: string; originalRole: string | null; originalBasePrice: string };
type CatalogPlayer = { id: string; name: string; role: string; playingRole: string; country: null; basePrice: number; basePriceSource: string; stats: null; sourceRows: SourceRow[]; reviewNotes: string[] };
const catalog = JSON.parse(readFileSync(new URL("../data/player-catalog.json", import.meta.url), "utf8")) as { source: { fileName: string; sha256: string }; players: CatalogPlayer[] };
const report = JSON.parse(readFileSync(new URL("../data/player-catalog-report.json", import.meta.url), "utf8"));

test("every workbook player-list row is represented, including unsold and TO BE SOLD = 0 rows", () => {
  const expectedSheets: Record<string, number> = {
    "MARQUEE SET": 25, "BATTERS SET 1": 26, "BOWLERS SET 1": 48,
    "ALL ROUNDERS SET 1": 28, "WICKET KEEPERS SET 1": 15,
    "BATTERS SET 2": 37, "BOWLERS SET 2": 48, "ALL ROUNDERS SET 2": 22,
  };
  assert.equal(catalog.players.length, 249);
  assert.equal(new Set(catalog.players.map((player) => player.id)).size, 249);
  const rows = catalog.players.flatMap((player) => player.sourceRows);
  assert.equal(rows.length, 249);
  assert.deepEqual([...new Set(rows.map((row) => row.sheet))].sort(), Object.keys(expectedSheets).sort());
  for (const [sheet, count] of Object.entries(expectedSheets)) {
    assert.deepEqual(rows.filter((row) => row.sheet === sheet).map((row) => row.row).sort((a, b) => a - b), Array.from({ length: count }, (_, index) => index + 2));
  }
  for (const name of ["AKEAL HOSEIN", "ANUJ RAWAT (WK)", "HARSH DUBEY", "MUKESH CHOUDHARY"]) {
    assert.ok(rows.some((row) => row.originalName.trim() === name));
  }
});

test("excluded sheets, historical sales and rules never become player records", () => {
  assert.deepEqual(report.sheets.filter((sheet: { status: string }) => sheet.status === "excluded_by_request").map((sheet: { sheet: string }) => sheet.sheet), ["THE TEAMS", "POINTS"]);
  assert.equal(report.sheets.find((sheet: { sheet: string }) => sheet.sheet === "RULES").status, "no_player_list");
  for (const player of catalog.players) {
    assert.ok(!("soldTo" in player));
    assert.ok(!("soldFor" in player));
    assert.ok(!("status" in player));
    assert.ok(player.sourceRows.every((row) => !["THE TEAMS", "POINTS", "RULES"].includes(row.sheet)));
  }
});

test("base prices preserve explicit crore/lakh units and no statistical facts are invented", () => {
  for (const player of catalog.players) {
    const match = player.sourceRows[0].originalBasePrice.match(/^(\d+(?:\.\d+)?)\s*(CR|L)$/);
    assert.ok(match, player.name);
    assert.equal(player.basePrice, Number(match[1]) * (match[2] === "CR" ? 100 : 1), player.name);
    assert.equal(player.basePriceSource, "workbook");
    assert.equal(player.country, null);
    assert.equal(player.stats, null);
  }
  assert.equal(report.counts.defaultsApplied, 0);
  assert.equal(report.counts.unresolvedRows, 0);
  assert.match(catalog.source.sha256, /^[a-f0-9]{64}$/);
});

test("marquee playing roles and explicit wicketkeeping annotations survive normalization", () => {
  const marquee = catalog.players.filter((player) => player.sourceRows[0].sheet === "MARQUEE SET");
  assert.equal(marquee.length, 25);
  assert.ok(marquee.every((player) => player.role === "Marquee" && player.playingRole !== "Marquee"));
  const wicketkeepers = catalog.players.filter((player) => player.sourceRows.some((row) => row.originalName.includes("(WK)")));
  assert.ok(wicketkeepers.length > 0);
  assert.ok(wicketkeepers.every((player) => player.role === "Wicketkeeper" && player.playingRole === "Wicketkeeper" && !player.name.includes("(WK)")));
});

test("documented spelling corrections keep originals and ambiguous identities remain separate", () => {
  const jaiswal = catalog.players.find((player) => player.id === "yashasvi-jaiswal");
  assert.equal(jaiswal?.name, "Yashasvi Jaiswal");
  assert.equal(jaiswal?.sourceRows[0].originalName, "YAHASVI JAISWAL");
  assert.equal(report.aliases.length, 4);
  assert.ok(report.aliases.every((alias: { sourceUrl: string }) => new URL(alias.sourceUrl).protocol === "https:"));
  assert.ok(catalog.players.some((player) => player.id === "akshat-raghuvanshi" && player.reviewNotes.length > 0));
  assert.ok(catalog.players.some((player) => player.id === "angkrish-raghuvanshi"));
  assert.ok(catalog.players.some((player) => player.id === "ajay-jadav" && player.reviewNotes.length > 0));
});

test("every catalog identity has a distinct sourced profile; unknown career totals stay unknown", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../data/player-profiles.json", import.meta.url), "utf8"));
  const profiles = snapshot.profiles as Record<string, { id: string; country: string; image: string | null; profileUrl: string; sourceUrls: string[]; statsFormat: string | null; stats: Record<string, number | null> }>;
  assert.deepEqual(Object.keys(profiles).sort(), catalog.players.map((player) => player.id).sort());
  assert.equal(new Set(Object.values(profiles).map((profile) => profile.id)).size, 249);
  assert.deepEqual(snapshot.unresolved, []);
  for (const profile of Object.values(profiles)) {
    assert.ok(profile.country.length > 0);
    assert.equal(new URL(profile.profileUrl).hostname, "www.cricbuzz.com");
    assert.ok(profile.sourceUrls.includes(profile.profileUrl));
    if (profile.statsFormat === null) assert.ok(Object.values(profile.stats).every((value) => value === null));
    for (const value of Object.values(profile.stats)) assert.ok(value === null || (Number.isFinite(value) && value >= 0));
    if (profile.image) assert.ok(!profile.image.includes("c182026/"), "Provider placeholder is not a player photo");
  }
  assert.equal(profiles["rashid-khan"].country, "Afghanistan");
  assert.equal(profiles["akash-singh"].id, "cricbuzz-14696");
  assert.equal(profiles["prince-yadav"].id, "cricbuzz-54735");
  assert.equal(profiles["amit-kumar"].id, "cricbuzz-1466014");
  assert.equal(profiles["akshat-raghuvanshi"].id, "cricbuzz-24431");
  assert.notEqual(profiles["akshat-raghuvanshi"].id, profiles["angkrish-raghuvanshi"].id);
});
