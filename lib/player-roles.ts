import type { Player } from "./auction";

/** Auction sets (for example Marquee) are independent of a player's on-field role. */
export const PLAYING_ROLES = ["Batter", "Bowler", "All-rounder", "Wicketkeeper"] as const;
export type PlayingRole = (typeof PLAYING_ROLES)[number];
export type PlayerRoleSource = Pick<Player, "role" | "playingRole"> | null | undefined;
export type PlayingRoleCount = { role: PlayingRole | "Unclassified"; count: number };

const ROLE_ALIASES: Readonly<Record<string, PlayingRole>> = {
  batter: "Batter", batters: "Batter", batsman: "Batter", batsmen: "Batter",
  bowler: "Bowler", bowlers: "Bowler",
  allrounder: "All-rounder", allrounders: "All-rounder",
  battingallrounder: "All-rounder", bowlingallrounder: "All-rounder",
  wicketkeeper: "Wicketkeeper", wicketkeepers: "Wicketkeeper",
  wicketkeeperbatter: "Wicketkeeper", wicketkeeperbatsman: "Wicketkeeper",
  wkbatter: "Wicketkeeper", wkbatsman: "Wicketkeeper", wk: "Wicketkeeper",
};

function normalizeRole(value: string | undefined): PlayingRole | null {
  if (!value) return null;
  const key = value.toLowerCase().replace(/[^a-z]/g, "");
  return Object.hasOwn(ROLE_ALIASES, key) ? ROLE_ALIASES[key] : null;
}

/** Prefer explicit playing-role metadata; never infer a playing role from Marquee. */
export function getPlayingRole(player: PlayerRoleSource): PlayingRole | null {
  return normalizeRole(player?.playingRole) ?? normalizeRole(player?.role);
}

/** Counts purchased players once each, including missing/unknown metadata honestly. */
export function countPlayingRoles(players: readonly PlayerRoleSource[]): PlayingRoleCount[] {
  const counts = new Map<PlayingRole | "Unclassified", number>(PLAYING_ROLES.map(role => [role, 0]));
  for (const player of players) {
    const role = getPlayingRole(player) ?? "Unclassified";
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts].map(([role, count]) => ({ role, count }));
}
