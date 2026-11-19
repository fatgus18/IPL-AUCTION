import catalog from "../data/player-catalog.json" with { type: "json" };
import profileSnapshot from "../data/player-profiles.json" with { type: "json" };
import legacySnapshot from "../data/legacy-player-profiles.json" with { type: "json" };
import type { Player, PlayerRole } from "./auction";
import type { LookupPlayer } from "./player-lookup-types";
import { alignVerifiedPlayerNames } from "./player-identities.ts";

const profiles = profileSnapshot.profiles as Record<string, LookupPlayer>;
export const CATALOG_VERSION = `${catalog.version}:${catalog.source.sha256.slice(0, 16)}`;
export const CATALOG_DATA_REVISION = `${profileSnapshot.updatedAt}|${legacySnapshot.updatedAt}`;
export const CATALOG_PLAYER_COUNT = catalog.players.length;

/** Existing rooms may retain legacy players that are intentionally absent from the supplied workbook. */
export function legacyPlayerDetails(id: string): Partial<Player> | undefined {
  const profile = (legacySnapshot.profiles as Record<string, LookupPlayer>)[id];
  if (!profile) return undefined;
  return {
    stats: profile.stats, statsFormat: profile.statsFormat ?? "Unknown",
    dataStatus: Object.values(profile.stats).every(value => value !== null) ? "verified" : "partial",
    image: profile.image || undefined, profileUrl: profile.profileUrl,
    dataSources: profile.sourceUrls.map(url => ({ label: profile.provider, url })), dataUpdatedAt: profile.fetchedAt,
    playingRole: profile.role || undefined, battingStyle: profile.battingStyle || undefined,
    bowlingStyle: profile.bowlingStyle || undefined, birthDate: profile.dateOfBirth || undefined,
  };
}

export function buildCatalogPool(knownCountries: Record<string, string> = {}): Player[] {
  return alignVerifiedPlayerNames(catalog.players.map(entry => {
    const profile = profiles[entry.id];
    const country = profile?.country || knownCountries[entry.id] || "Unverified";
    const stats = profile?.stats ?? { matches: null, runs: null, wickets: null, strikeRate: null };
    return {
      id: entry.id, name: entry.name, country, role: entry.role as PlayerRole,
      playingRole: entry.playingRole || profile?.role || undefined,
      basePrice: entry.basePrice, isOverseas: country !== "Unverified" && country.toLowerCase() !== "india",
      eligibilityVerified: country !== "Unverified", status: "available" as const,
      stats, statsFormat: profile?.statsFormat ?? "Unknown",
      dataStatus: profile && Object.values(stats).every(value => value !== null) ? "verified" as const : "partial" as const,
      image: profile?.image || undefined, profileUrl: profile?.profileUrl,
      dataSources: profile?.sourceUrls.map(url => ({ label: profile.provider, url })) ?? [],
      dataUpdatedAt: profile?.fetchedAt,
      battingStyle: profile?.battingStyle || undefined, bowlingStyle: profile?.bowlingStyle || undefined,
      birthDate: profile?.dateOfBirth || undefined,
      catalogSheets: [...new Set(entry.sourceRows.map(source => source.sheet))],
    };
  }));
}
