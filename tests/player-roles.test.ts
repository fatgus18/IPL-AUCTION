import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PlayerRoleSource } from "../lib/player-roles";

const { getPlayingRole, countPlayingRoles, PLAYING_ROLES }: typeof import("../lib/player-roles") =
  await import(new URL("../lib/player-roles.ts", import.meta.url).href);

test("marquee players count toward their actual cricket role", () => {
  assert.equal(getPlayingRole({ role: "Marquee", playingRole: "All-rounder" }), "All-rounder");
  assert.equal(getPlayingRole({ role: "Marquee", playingRole: "Wicketkeeper" }), "Wicketkeeper");
  const counts = countPlayingRoles([
    { role: "Marquee", playingRole: "All-rounder" },
    { role: "Marquee", playingRole: "All-rounder" },
    { role: "Marquee", playingRole: "Wicketkeeper" },
  ]);
  assert.deepEqual(counts, [
    { role: "Batter", count: 0 }, { role: "Bowler", count: 0 },
    { role: "All-rounder", count: 2 }, { role: "Wicketkeeper", count: 1 },
  ]);
  assert.equal(counts.reduce((total, entry) => total + entry.count, 0), 3);
});

test("common provider role aliases normalize without changing their meaning", () => {
  for (const playingRole of ["All rounder", "ALL-ROUNDER", "Batting Allrounder", "Bowling All-rounder"]) {
    assert.equal(getPlayingRole({ role: "Marquee", playingRole }), "All-rounder");
  }
  for (const playingRole of ["WK-Batsman", "Wicketkeeper Batter", "Wicket-keeper/Batsman", "WK Batter", "Wicket keeper"]) {
    assert.equal(getPlayingRole({ role: "Marquee", playingRole }), "Wicketkeeper");
  }
  assert.equal(getPlayingRole({ role: "Marquee", playingRole: "Batsman" }), "Batter");
  assert.equal(getPlayingRole({ role: "Marquee", playingRole: "Bowler" }), "Bowler");
});

test("recognized playing metadata takes precedence over the auction category", () => {
  assert.equal(getPlayingRole({ role: "Batter", playingRole: "Wicketkeeper" }), "Wicketkeeper");
  assert.equal(getPlayingRole({ role: "Bowler", playingRole: "Bowling Allrounder" }), "All-rounder");
  assert.equal(getPlayingRole({ role: "All-rounder", playingRole: "Unknown" }), "All-rounder");
  assert.equal(getPlayingRole({ role: "Batter" }), "Batter");
});

test("unrecognized marquee and unavailable player data remain unclassified", () => {
  const players: PlayerRoleSource[] = [
    { role: "Marquee" }, { role: "Marquee", playingRole: "Unknown" },
    { role: "Marquee", playingRole: "Batting coach" }, null, undefined,
  ];
  for (const player of players) assert.equal(getPlayingRole(player), null);
  assert.deepEqual(countPlayingRoles(players).at(-1), { role: "Unclassified", count: 5 });
  assert.deepEqual(countPlayingRoles([]), PLAYING_ROLES.map(role => ({ role, count: 0 })));
});

test("every supplied catalog player has a known playing role, including the marquee set", () => {
  const catalog = JSON.parse(readFileSync(new URL("../data/player-catalog.json", import.meta.url), "utf8"));
  const { profiles } = JSON.parse(readFileSync(new URL("../data/player-profiles.json", import.meta.url), "utf8"));
  const players = catalog.players.map((player: { id: string; name: string; role: string; playingRole?: string }) => {
    const merged = { ...player, playingRole: player.playingRole || profiles[player.id]?.role };
    assert.ok(getPlayingRole(merged as PlayerRoleSource), `Missing playing role for ${player.name}`);
    return merged;
  });
  const counts = countPlayingRoles(players);
  assert.ok(catalog.players.length > 0);
  assert.equal(counts.reduce((total, entry) => total + entry.count, 0), catalog.players.length);
  assert.equal(counts.some(entry => entry.role === "Unclassified"), false);
  assert.equal(getPlayingRole(players.find((player: { id: string }) => player.id === "marco-jansen")), "All-rounder");
  assert.equal(getPlayingRole(players.find((player: { id: string }) => player.id === "sanju-samson")), "Wicketkeeper");
});
