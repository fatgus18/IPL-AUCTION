import type { Player, RoomState } from "./auction.ts";

export type SharedPlayerCatalog = { players: Player[]; version: number };

/** A catalog has no auction outcome; those belong to an individual room. */
export function availableCatalogPlayers(players: Player[]): Player[] {
  return structuredClone(players).map((player) => {
    delete player.soldTo;
    delete player.soldFor;
    delete player.catalogArchived;
    return { ...player, status: "available" };
  });
}

export function playerIdentity(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

export function playerProfileIdentity(value?: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const cricbuzz = host === "cricbuzz.com" && /^\/profiles\/(\d+)(?:\/|$)/.exec(url.pathname);
    if (cricbuzz) return `cricbuzz:${cricbuzz[1]}`;
    const cricinfo = host === "espncricinfo.com" && /^\/cricketers\/[^/]*-(\d+)\/?$/.exec(url.pathname);
    if (cricinfo) return `cricinfo:${cricinfo[1]}`;
    return `${host}${url.pathname.replace(/\/$/, "")}`;
  } catch { return value; }
}

export function findDuplicatePlayer(players: Player[], player: Player): Player | undefined {
  const profile = playerProfileIdentity(player.profileUrl);
  return players.find(entry => entry.id !== player.id && (
    (profile && playerProfileIdentity(entry.profileUrl) === profile) ||
    (playerIdentity(entry.name) === playerIdentity(player.name) && playerIdentity(entry.country) === playerIdentity(player.country))
  ));
}

export function hasProtectedReference(state: RoomState, playerId: string): boolean {
  return state.currentPlayerId === playerId ||
    state.players.some(player => player.id === playerId && player.status === "sold") ||
    state.teams.some(team => team.squad.some(sale => sale.playerId === playerId));
}

/** Reconcile shared facts without transporting another room's bidding or accounting. */
export function syncRoomPlayerCatalog(source: RoomState, catalog: SharedPlayerCatalog, now = Date.now(), force = false): RoomState {
  if (!force && source.sharedCatalogVersion === catalog.version && source.catalogCount === catalog.players.length) return source;
  const previous = new Map(source.players.map(player => [player.id, player]));
  const sharedIds = new Set(catalog.players.map(player => player.id));
  const players = catalog.players.map(shared => {
    const local = previous.get(shared.id);
    if (!local) return structuredClone(shared);
    const protectedTerms = local.status === "sold" ||
      (local.id === source.currentPlayerId && (source.phase !== "waiting" || !!source.leadingTeamId));
    return {
      ...structuredClone(shared), status: local.status,
      ...(local.soldTo ? { soldTo: local.soldTo } : {}),
      ...(local.soldFor !== undefined ? { soldFor: local.soldFor } : {}),
      ...(protectedTerms ? {
        basePrice: local.basePrice, country: local.country, isOverseas: local.isOverseas,
        eligibilityVerified: local.eligibilityVerified, role: local.role,
      } : {}),
    };
  });
  // Old installations may contain historical sales outside the imported workbook.
  // Keep those records until an audited migration adds them to the shared catalog.
  for (const local of source.players) {
    if (!sharedIds.has(local.id) && (hasProtectedReference(source, local.id) || source.bidHistory.some(bid => bid.playerId === local.id))) {
      players.push({ ...structuredClone(local), catalogArchived: true });
    }
  }
  return { ...source, players, sharedCatalogVersion: catalog.version, catalogCount: catalog.players.length, version: source.version + 1, serverTime: now };
}
