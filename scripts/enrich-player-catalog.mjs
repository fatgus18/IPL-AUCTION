/** Public-provider enrichment: exact unambiguous names only, resumable checkpoints, no invented fields. */
import { readFile, writeFile, rename } from "node:fs/promises";
import { lookupPlayer } from "../lib/player-lookup.ts";

const catalog = JSON.parse(await readFile(new URL("../data/player-catalog.json", import.meta.url), "utf8"));
const destination = new URL("../data/player-profiles.json", import.meta.url);
let snapshot;
try { snapshot = JSON.parse(await readFile(destination, "utf8")); } catch { snapshot = { profiles: {}, unresolved: [] }; }
const refreshKeepers = process.argv.includes("--refresh-wicketkeepers");
const remaining = catalog.players.filter((player) => !snapshot.profiles[player.id] || (player.profileUrl && player.profileUrl !== snapshot.profiles[player.id].profileUrl) || (refreshKeepers && (player.role === "Wicketkeeper" || player.playingRole === "Wicketkeeper")));
let cursor = 0;
let completed = 0;
let writing = Promise.resolve();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function checkpoint() {
  const content = JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() }, null, 2) + "\n";
  writing = writing.then(async () => { const temporary = new URL("../data/player-profiles.json.tmp", import.meta.url); await writeFile(temporary, content); await rename(temporary, destination); });
  return writing;
}
async function worker() {
  while (cursor < remaining.length) {
    const player = remaining[cursor++];
    try {
      const result = await lookupPlayer(player.profileUrl || (refreshKeepers ? snapshot.profiles[player.id]?.profileUrl : null) || player.name, { refresh: refreshKeepers });
      snapshot.unresolved = snapshot.unresolved.filter((entry) => entry.id !== player.id);
      if (result.status === "found" && result.player) snapshot.profiles[player.id] = result.player;
      else snapshot.unresolved.push({ id: player.id, name: player.name, reason: result.status === "candidates" ? "Choose the matching identity" : result.warnings.join(" "), candidates: result.candidates });
      completed++;
      console.log(`${completed}/${remaining.length} ${player.name}: ${result.status}`);
      if (completed % 5 === 0) await checkpoint();
    } catch (error) {
      snapshot.unresolved = snapshot.unresolved.filter((entry) => entry.id !== player.id);
      snapshot.unresolved.push({ id: player.id, name: player.name, reason: error.message });
      console.log(`${player.name}: provider unavailable (${error.code || "error"})`);
      if (error.status === 429) { await checkpoint(); console.log("Provider requested a pause; stopping this run."); cursor = remaining.length; break; }
    }
    await wait(350);
  }
}
await Promise.all([worker(), worker()]);
await checkpoint();
console.log(JSON.stringify({ verifiedProfiles: Object.keys(snapshot.profiles).length, unresolved: snapshot.unresolved.length }));
