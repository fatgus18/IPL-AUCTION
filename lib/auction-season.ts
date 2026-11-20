import type { Player, RoomState } from "./auction.ts";
import type { SeasonSourceRow, SeasonSourceSnapshot } from "./season-source.ts";
import { getPlayerSeasonIdentity, normalizeSeasonName } from "./player-identities.ts";
import { getPlayingRole } from "./player-roles.ts";

export const DEFAULT_SEASON_SOURCE_URL = "https://www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players";
export type SeasonMappings = Record<string, string>;
export type SeasonAcquisition = "fetch" | "import" | "reference";
export type SeasonReferenceMetadata = Pick<SeasonSourceSnapshot, "sourceUrl" | "seriesId" | "seriesName" | "fetchedAt"> & { playerCount: number };
export type SeasonSourceAvailability = { mode: "direct" | "worker"; available: boolean; lastSeenAt: string | null };
export type StoredAuctionSeason = {
  sourceUrl: string; snapshot: SeasonSourceSnapshot | null; method: SeasonAcquisition | null;
  mappings: SeasonMappings; lastFetchAttemptAt: number | null; fetchRequestId?: string;
};
export type SeasonSourceRowView = SeasonSourceRow & {
  key: string; playerId: string | null; match: "id" | "name" | "alias" | "manual" | null;
};
export type SeasonPlayer = {
  id: string; name: string; role: string; country: string; image?: string;
  amountLakhs: number; selection: "Playing XI" | "Substitute" | "Squad"; position: number | null;
  captain: boolean; viceCaptain: boolean; multiplier: 1 | 1.5 | 2;
  rawPoints: number | null; points: number | null; sourceKey: string | null; sourceName: string | null;
  matches: number | null; runs: number | null; wickets: number | null;
};
export type SeasonTeam = {
  id: string; name: string; shortName: string; color: string; manager: string; rank: number | null;
  points: number | null; knownPoints: number; matchedPlayers: number; totalPlayers: number; complete: boolean;
  purseLakhs: number; spentLakhs: number; players: SeasonPlayer[];
};
export type AuctionSeasonView = {
  code: string; name: string; revision: number; roomVersion: number; sourceUrl: string;
  canManage: boolean; provisional: boolean; updatedAt: number | null; lastFetchAttemptAt: number | null;
  snapshot: (Omit<SeasonSourceSnapshot, "rows"> & { method: SeasonAcquisition }) | null;
  reference: SeasonReferenceMetadata | null;
  sourceFetch: SeasonSourceAvailability;
  sourceChanged: boolean; teams: SeasonTeam[];
  coverage: { matchedPlayers: number; totalPlayers: number; sourceRows: number; unmatchedPlayers: number };
  sourceRows: SeasonSourceRowView[];
  unmatchedPlayers: { id: string; name: string; teamId: string; teamName: string }[];
  mappings: SeasonMappings;
};

export function emptyAuctionSeason(): StoredAuctionSeason {
  return { sourceUrl: DEFAULT_SEASON_SOURCE_URL, snapshot: null, method: null, mappings: {}, lastFetchAttemptAt: null };
}

export function seasonSourceKey(row: Pick<SeasonSourceRow, "providerPlayerId" | "name">): string {
  return row.providerPlayerId ? `id:${row.providerPlayerId}` : `name:${normalizeSeasonName(row.name)}`;
}

/** Preserve provider decimal precision, including half-points, without intermediate rounding. */
export function sumSeasonPoints(values: readonly number[]): number {
  const parts = values.map(value => {
    const [coefficient, exponentText] = value.toString().toLowerCase().split("e");
    const decimals = coefficient.includes(".") ? coefficient.split(".")[1].length : 0;
    return { integer: BigInt(coefficient.replace(".", "")), scale: decimals - Number(exponentText ?? 0) };
  });
  const scale = Math.max(0, ...parts.map(part => part.scale));
  const total = parts.reduce((sum, part) => sum + part.integer * BigInt(10) ** BigInt(scale - part.scale), BigInt(0));
  return Number(`${total}e-${scale}`);
}

function weightedPoints(points: number, multiplier: 1 | 1.5 | 2): number {
  return multiplier === 1 ? points : multiplier === 2 ? sumSeasonPoints([points, points]) : sumSeasonPoints([points, points / 2]);
}

/** IDs take precedence. Names are exact normalized identities, never a fuzzy surname guess.
 * Ambiguous source rows or catalog identities remain unmatched for explicit creator review. */
export function matchSeasonRows(players: readonly Player[], rows: readonly SeasonSourceRow[], mappings: SeasonMappings = {}): SeasonSourceRowView[] {
  const identities = players.map(player => ({ player, identity: getPlayerSeasonIdentity(player) }));
  const playerIds = new Set(players.map(player => player.id));
  const assigned = new Set<string>();
  const result: SeasonSourceRowView[] = rows.map(row => ({ ...row, key: seasonSourceKey(row), playerId: null, match: null }));
  const keyCounts = new Map<string, number>();
  for (const row of result) keyCounts.set(row.key, (keyCounts.get(row.key) ?? 0) + 1);
  const manualCounts = new Map<string, number>();
  for (const playerId of Object.values(mappings)) manualCounts.set(playerId, (manualCounts.get(playerId) ?? 0) + 1);
  for (const row of result) {
    const playerId = Object.hasOwn(mappings, row.key) ? mappings[row.key] : undefined;
    if (playerId && playerIds.has(playerId) && manualCounts.get(playerId) === 1 && keyCounts.get(row.key) === 1) {
      const identity = identities.find(entry => entry.player.id === playerId)!.identity;
      if (identity.providerPlayerId && (
        (row.providerPlayerId && row.providerPlayerId !== identity.providerPlayerId)
        || result.some(other => other !== row && other.providerPlayerId === identity.providerPlayerId)
      )) continue;
      row.playerId = playerId; row.match = "manual"; assigned.add(playerId);
    }
  }
  // Resolve each priority as a batch: two source rows must not silently claim the same player.
  for (const priority of ["id", "name"] as const) {
    const candidates = new Map<SeasonSourceRowView, { id: string; match: SeasonSourceRowView["match"] }>();
    for (const row of result) {
      if (row.playerId || keyCounts.get(row.key) !== 1) continue;
      const normalized = normalizeSeasonName(row.name);
      const found = identities.filter(({ player, identity }) => !assigned.has(player.id) && (
        priority === "id" ? !!row.providerPlayerId && identity.providerPlayerId === row.providerPlayerId
          : (!row.providerPlayerId || !identity.providerPlayerId || identity.providerPlayerId === row.providerPlayerId)
            && identity.names.some(name => normalizeSeasonName(name) === normalized)
      ));
      if (found.length === 1) candidates.set(row, { id: found[0].player.id, match: priority === "id" ? "id" : normalizeSeasonName(found[0].player.name) === normalized ? "name" : "alias" });
    }
    const counts = new Map<string, number>();
    for (const candidate of candidates.values()) counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1);
    for (const [row, candidate] of candidates) if (counts.get(candidate.id) === 1) {
      row.playerId = candidate.id; row.match = candidate.match; assigned.add(candidate.id);
    }
  }
  return result;
}

export function buildAuctionSeason(
  state: RoomState, stored: StoredAuctionSeason = emptyAuctionSeason(),
  metadata: { revision?: number; updatedAt?: number | null; canManage?: boolean; reference?: SeasonReferenceMetadata | null; sourceFetch?: SeasonSourceAvailability } = {},
): AuctionSeasonView {
  const sourceRows = matchSeasonRows(state.players, stored.snapshot?.rows ?? [], stored.mappings);
  const sourceByPlayer = new Map(sourceRows.filter(row => row.playerId).map(row => [row.playerId!, row]));
  const playersById = new Map(state.players.map(player => [player.id, player]));
  const teams: SeasonTeam[] = state.teams.map(team => {
    const seen = new Set<string>();
    const purchases = team.squad.filter(purchase => {
      const player = playersById.get(purchase.playerId);
      if (!player || player.status !== "sold" || player.soldTo !== team.id || seen.has(player.id)) return false;
      seen.add(player.id); return true;
    });
    const xi = new Set((team.lineup?.playingXI ?? []).filter(id => id && seen.has(id)));
    const captainId = team.lineup?.captainId && xi.has(team.lineup.captainId) ? team.lineup.captainId : null;
    const viceCaptainId = team.lineup?.viceCaptainId && xi.has(team.lineup.viceCaptainId) && team.lineup.viceCaptainId !== captainId ? team.lineup.viceCaptainId : null;
    const players: SeasonPlayer[] = purchases.map(purchase => {
      const player = playersById.get(purchase.playerId)!;
      const source = sourceByPlayer.get(player.id);
      const xiPosition = team.lineup?.playingXI.indexOf(player.id) ?? -1;
      const subPosition = team.lineup?.substitutes.indexOf(player.id) ?? -1;
      const captain = captainId === player.id, viceCaptain = viceCaptainId === player.id;
      const multiplier = captain ? 2 : viceCaptain ? 1.5 : 1;
      return {
        id: player.id, name: player.name, role: getPlayingRole(player) ?? "Unclassified", country: player.country,
        ...(player.image ? { image: player.image } : {}), amountLakhs: purchase.amount,
        selection: xiPosition >= 0 ? "Playing XI" : subPosition >= 0 ? "Substitute" : "Squad",
        position: xiPosition >= 0 ? xiPosition + 1 : subPosition >= 0 ? subPosition + 1 : null,
        captain, viceCaptain, multiplier, rawPoints: source?.points ?? null,
        points: source ? weightedPoints(source.points, multiplier) : null,
        sourceKey: source?.key ?? null, sourceName: source?.name ?? null,
        matches: source?.matches ?? null, runs: source?.runs ?? null, wickets: source?.wickets ?? null,
      };
    });
    const matchedPlayers = players.filter(player => player.points !== null).length;
    const knownPoints = sumSeasonPoints(players.flatMap(player => player.points === null ? [] : [player.points]));
    const selectionOrder = { "Playing XI": 0, Substitute: 1, Squad: 2 };
    players.sort((a, b) => selectionOrder[a.selection] - selectionOrder[b.selection] || (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));
    return {
      id: team.id, name: team.name, shortName: team.shortName, color: team.color,
      manager: state.completedManagers?.[team.id]?.name ?? state.members.find(member => member.role === "bidder" && member.teamId === team.id)?.name ?? "No manager assigned",
      rank: null, points: matchedPlayers ? knownPoints : null, knownPoints, matchedPlayers, totalPlayers: players.length,
      complete: !!stored.snapshot && matchedPlayers === players.length,
      purseLakhs: team.purse, spentLakhs: purchases.reduce((sum, purchase) => sum + purchase.amount, 0), players,
    };
  });
  teams.sort((a, b) => (a.points === null ? 1 : 0) - (b.points === null ? 1 : 0) || b.knownPoints - a.knownPoints || a.name.localeCompare(b.name));
  let lastPoints: number | null = null, lastRank = 0;
  teams.forEach((team, index) => { if (team.points !== null) { if (lastPoints !== team.points) lastRank = index + 1; team.rank = lastRank; lastPoints = team.points; } });
  const unmatchedPlayers = teams.flatMap(team => team.players.filter(player => player.points === null).map(player => ({ id: player.id, name: player.name, teamId: team.id, teamName: team.name })));
  const matchedPlayers = teams.reduce((sum, team) => sum + team.matchedPlayers, 0);
  const totalPlayers = teams.reduce((sum, team) => sum + team.totalPlayers, 0);
  return {
    code: state.code, name: state.name, revision: metadata.revision ?? 0, roomVersion: state.version,
    sourceUrl: stored.sourceUrl, canManage: metadata.canManage ?? false, provisional: !state.endedAt,
    updatedAt: metadata.updatedAt ?? null, lastFetchAttemptAt: stored.lastFetchAttemptAt,
    snapshot: stored.snapshot ? { sourceUrl: stored.snapshot.sourceUrl, provider: stored.snapshot.provider, seriesId: stored.snapshot.seriesId, seriesName: stored.snapshot.seriesName, fetchedAt: stored.snapshot.fetchedAt, method: stored.method ?? "fetch" } : null,
    reference: metadata.reference ?? null,
    sourceFetch: metadata.sourceFetch ?? { mode: "direct", available: true, lastSeenAt: null },
    sourceChanged: !!stored.snapshot && stored.snapshot.sourceUrl !== stored.sourceUrl
      && !(stored.method === "reference" && metadata.reference?.seriesId === stored.snapshot.seriesId),
    teams, coverage: { matchedPlayers, totalPlayers, sourceRows: sourceRows.length, unmatchedPlayers: unmatchedPlayers.length },
    sourceRows, unmatchedPlayers, mappings: { ...stored.mappings },
  };
}
