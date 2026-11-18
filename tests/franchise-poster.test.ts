import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

const { createDemoState, AuctionError }: typeof import("../lib/auction") = await import(new URL("../lib/auction.ts", import.meta.url).href);
const { buildFranchisePoster, createFranchisePosterPng, renderFranchisePosterSvg, loadPosterAsset, franchisePosterFilename }: typeof import("../lib/franchise-poster") = await import(new URL("../lib/franchise-poster.ts", import.meta.url).href);

function fixture(count = 3) {
  const state = createDemoState(); state.endedAt = Date.UTC(2026, 10, 18, 14); state.resultsRevision = 5;
  const team = state.teams.find(team => team.id === "rcb")!;
  team.squad = state.players.slice(0, count).map((player, index) => ({ playerId: player.id, amount: 200 + index * 10 }));
  team.lineup = { playingXI: Array.from({ length: 11 }, (_, index) => index === 0 ? team.squad[1]?.playerId ?? null : index === 6 ? team.squad[0]?.playerId ?? null : null), substitutes: [null, team.squad[2]?.playerId ?? null], captainId: team.squad[0]?.playerId ?? null, viceCaptainId: team.squad[1]?.playerId ?? null, revision: 2 };
  state.completedManagers = { rcb: { id: "archived", name: "Archived franchise manager" } };
  state.members = state.members.filter(member => member.teamId !== "rcb");
  state.myTargetPicks = { teamId: "rcb", playerIds: ["SECRET-TARGET"], revision: 8 };
  state.activity.push({ id: "secret-chat", type: "chat", text: "PRIVATE-CHAT", at: state.endedAt });
  return state;
}

test("posters are available only after completion, for an existing nonempty franchise", () => {
  const state = fixture(); const endedAt = state.endedAt; delete state.endedAt;
  assert.throws(() => buildFranchisePoster(state, "rcb"), (error: unknown) => error instanceof AuctionError && error.code === "AUCTION_NOT_ENDED" && error.status === 409);
  state.endedAt = endedAt;
  assert.throws(() => buildFranchisePoster(state, "unknown"), (error: unknown) => error instanceof AuctionError && error.code === "TEAM_NOT_FOUND" && error.status === 404);
  assert.throws(() => buildFranchisePoster(state, "gt"), (error: unknown) => error instanceof AuctionError && error.code === "POSTER_EMPTY_SQUAD");
});

test("poster projection preserves every signing, actual roles, free-position XI, bench and archived manager without private data", () => {
  const state = fixture(30); const before = structuredClone(state);
  state.players[0].role = "Marquee"; state.players[0].playingRole = "All-rounder";
  const poster = buildFranchisePoster(state, "rcb");
  assert.equal(poster.players.length, 30); assert.equal(new Set(poster.players.map(player => player.id)).size, 30);
  assert.equal(poster.manager, "Archived franchise manager"); assert.equal(poster.spentLakhs, 10350);
  assert.deepEqual(poster.players.slice(0, 3).map(player => [player.selection, player.captain, player.viceCaptain]), [["XI 01", false, true], ["XI 07", true, false], ["SUB 2", false, false]]);
  assert.equal(poster.players[1].role, "All-rounder");
  assert.doesNotMatch(JSON.stringify(poster), /SECRET-TARGET|PRIVATE-CHAT|myTargetPicks|password|token|memberId|archived"/);
  assert.deepEqual(state.teams, before.teams, "projection does not mutate squads or lineup");
});

test("all twelve franchises have local crests and distinct poster palettes", async () => {
  const state = fixture(1); const palettes = new Set<string>();
  for (const team of state.teams) {
    team.squad = [{ playerId: state.players[0].id, amount: 200 }];
    const poster = buildFranchisePoster(state, team.id); palettes.add(poster.background);
    assert.match((await loadPosterAsset(poster.logo)) ?? "", /^data:image\/png;base64,/, team.name);
  }
  assert.equal(state.teams.length, 12); assert.equal(palettes.size, 12);
});

test("asset loader refuses arbitrary local paths, data URIs and remote URLs; unknown portraits use a safe fallback", async () => {
  for (const input of ["../../.env.local", "/ipl/players/../../.env.local", "https://example.com/portrait.svg", "file:///etc/passwd", "data:image/svg+xml,<svg/>", null]) assert.equal(await loadPosterAsset(input), null);
  const state = fixture(1); const player = state.players[0];
  player.image = "https://private.example/secret"; player.id = "unknown-import"; player.name = "New signing";
  state.teams.find(team => team.id === "rcb")!.squad[0].playerId = player.id;
  assert.equal(buildFranchisePoster(state, "rcb").players[0].portrait, null);
});

test("full 30-player poster is a real 1440×1800 PNG with embedded fonts, bounded file size and no external image references", async () => {
  const poster = buildFranchisePoster(fixture(30), "rcb");
  const bytes = await createFranchisePosterPng(poster);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const metadata = await sharp(bytes).metadata(); assert.equal(metadata.width, 1440); assert.equal(metadata.height, 1800);
  assert.ok(bytes.byteLength > 50_000 && bytes.byteLength < 5_000_000, `PNG size: ${bytes.byteLength}`);
  const svg = await renderFranchisePosterSvg({ ...poster, players: [poster.players[0]], manager: '<script>alert("x")</script>', auctionName: "<img src=https://private.example>", teamName: "Long & safe franchise" });
  assert.doesNotMatch(svg, /<script|<text|https:\/\/private\.example|file:\/\//);
  assert.match(svg, /data:image\/png;base64,/); assert.match(svg, /<path/);
});

test("download filename is safe for response headers and changes with results revision", () => {
  assert.equal(franchisePosterFilename({ code: 'ROOM\r\nInjected: yes', shortName: '../RCB"', revision: 7 }), "pavilion-ROOMInjected-RCB-squad-r7.png");
});

test("maximum-length unbroken manager and room names remain complete in the poster model", () => {
  const state = fixture(); state.completedManagers!.rcb.name = "W".repeat(40); state.name = "W".repeat(80);
  const poster = buildFranchisePoster(state, "rcb");
  assert.equal(poster.manager, state.completedManagers!.rcb.name);
  assert.equal(poster.auctionName, state.name);
});

test("repeated poster snapshots are consistent and saved captaincy or manager changes produce a fresh image", async () => {
  const poster = buildFranchisePoster(fixture(2), "rcb");
  const [first, simultaneous] = await Promise.all([createFranchisePosterPng(poster), createFranchisePosterPng(poster)]);
  assert.deepEqual(first, simultaneous);
  assert.deepEqual(first, await createFranchisePosterPng(structuredClone(poster)));
  const revised = structuredClone(poster); revised.manager = "Updated franchise manager";
  revised.players[0].captain = true; revised.players[0].viceCaptain = false;
  revised.players[1].captain = false; revised.players[1].viceCaptain = true;
  assert.notDeepEqual(first, await createFranchisePosterPng(revised), "latest saved public details must invalidate any cached image");
});
