import identities from "../data/player-identities.json" with { type: "json" };
import type { Player } from "./auction";

const byId = new Map(identities.players.map(player => [player.id, player]));
export const PLAYER_IDENTITY_REVISION = identities.version;

export function normalizeSeasonName(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
}

function profileIdentity(profileUrl?: string): string | null {
  if (!profileUrl) return null;
  try {
    const url = new URL(profileUrl);
    if (!["www.cricinfo.com", "cricinfo.com", "www.espncricinfo.com", "espncricinfo.com"].includes(url.hostname)) return null;
    const modern = /^\/cricketers\/(?:[^/]+-)?(\d+)\/?$/.exec(url.pathname)?.[1];
    const legacy = /^\/ci\/content\/player\/(\d+)\.html$/.exec(url.pathname)?.[1];
    return modern ?? legacy ?? null;
  } catch { return null; }
}

export function getPlayerSeasonIdentity(player: Pick<Player, "id" | "name" | "profileUrl">): {
  providerPlayerId: string | null; names: string[]; displayName: string;
} {
  const known = byId.get(player.id);
  return {
    providerPlayerId: known?.providerPlayerId ?? profileIdentity(player.profileUrl),
    names: [...new Set([player.name, ...(known ? [known.canonicalName, ...known.aliases] : [])])],
    displayName: known?.canonicalName ?? player.name,
  };
}

/** Correct verified spelling variants only; preserve IDs and every other field. */
export function alignVerifiedPlayerNames<T extends Pick<Player, "id" | "name">>(players: T[]): T[] {
  let changed = false;
  const aligned = players.map(player => {
    const known = byId.get(player.id);
    if (!known || player.name === known.canonicalName || !known.aliases.some(name => normalizeSeasonName(name) === normalizeSeasonName(player.name))) return player;
    changed = true;
    return { ...player, name: known.canonicalName };
  });
  return changed ? aligned : players;
}
