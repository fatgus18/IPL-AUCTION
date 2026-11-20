import assert from "node:assert/strict";
import test from "node:test";
import { seasonSourceMode } from "../lib/season-source-mode.ts";

test("Vercel defaults to managed cloud even when obsolete desktop credentials still exist", () => {
  assert.equal(seasonSourceMode({ VERCEL: "1" }), "cloud");
  assert.equal(seasonSourceMode({ VERCEL: "1", PAVILION_SOURCE_WORKER_TOKEN: "old-desktop-token" }), "cloud");
});
test("local development never silently inherits the desktop service", () => {
  assert.equal(seasonSourceMode({}), "direct");
  assert.equal(seasonSourceMode({ PAVILION_SOURCE_WORKER_TOKEN: "old-desktop-token" }), "direct");
});
test("only explicit valid server configuration can select a different executor", () => {
  for (const mode of ["cloud", "direct", "worker"] as const) assert.equal(seasonSourceMode({ PAVILION_SEASON_FETCH_MODE: mode }), mode);
  assert.throws(() => seasonSourceMode({ PAVILION_SEASON_FETCH_MODE: "automatic-anywhere" }), /configuration is invalid/);
});
