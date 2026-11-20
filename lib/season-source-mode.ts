import { SeasonSourceError } from "./season-source.ts";

export type SeasonSourceMode = "cloud" | "direct" | "worker";

/** Production defaults to managed execution, never to a workstation heartbeat. */
export function seasonSourceMode(env: Record<string, string | undefined> = process.env): SeasonSourceMode {
  const selected = env.PAVILION_SEASON_FETCH_MODE?.trim();
  if (selected && !["cloud", "direct", "worker"].includes(selected)) {
    throw new SeasonSourceError("The season refresh service configuration is invalid. Your saved points are unchanged.", 503, "SEASON_SOURCE_CONFIGURATION");
  }
  return selected as SeasonSourceMode || (env.VERCEL === "1" ? "cloud" : "direct");
}
