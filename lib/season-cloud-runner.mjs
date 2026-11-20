// Fixed cloud task: public provider input only. No application data or credentials.
import { writeFile } from "node:fs/promises";
import { fetchSeasonSource } from "./season-source.ts";

let result;
try {
  const snapshot = await fetchSeasonSource(process.argv[2]);
  result = { ok: true, snapshot, totalRows: snapshot.rows.length };
} catch (error) {
  result = { ok: false, error: { code: error?.code === "SEASON_SOURCE_RATE_LIMIT" ? "SEASON_SOURCE_RATE_LIMIT" : error?.code === "SEASON_SOURCE_RESPONSE" ? "SEASON_SOURCE_RESPONSE" : "SEASON_SOURCE_UNAVAILABLE" } };
  process.exitCode = 1;
}
let text = JSON.stringify(result);
if (Buffer.byteLength(text, "utf8") > 1_000_000) {
  text = JSON.stringify({ ok: false, error: { code: "SEASON_SOURCE_RESPONSE" } });
  process.exitCode = 1;
}
await writeFile("/tmp/result.json", text, { encoding: "utf8", mode: 0o600 });
