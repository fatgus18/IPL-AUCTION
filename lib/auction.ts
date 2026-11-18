import { CATALOG_VERSION, CATALOG_DATA_REVISION, buildCatalogPool, legacyPlayerDetails } from "./player-catalog.ts";
import { PLAYER_ROLES, formatMoney, getNextBid } from "./auction-display.ts";
import { TEAM_SEEDS, TEAM_CATALOG_VERSION, PRACTICE_MANAGER_NAMES } from "./team-catalog.ts";
export { PLAYER_ROLES, formatMoney, getNextBid } from "./auction-display.ts";
export { TEAM_SEEDS } from "./team-catalog.ts";

/** All monetary values are integer lakhs: 100 lakhs = 1 crore. */
export type PlayerRole = (typeof PLAYER_ROLES)[number];
export type Phase = "waiting" | "live" | "paused" | "locked" | "sold" | "unsold";
export type PlayerStats = { matches: number | null; runs: number | null; wickets: number | null; strikeRate: number | null };
export type PlayerDataSource = { label: string; url: string };
export type Player = {
  id: string; name: string; country: string; role: PlayerRole; basePrice: number;
  isOverseas: boolean; status: "available" | "sold" | "unsold";
  soldTo?: string; soldFor?: number; image?: string;
  stats: PlayerStats;
  statsFormat?: "IPL" | "T20" | "T20I" | "ODI" | "Test" | "Unknown";
  dataStatus?: "verified" | "partial" | "manual" | "illustrative";
  profileUrl?: string;
  dataSources?: PlayerDataSource[];
  dataUpdatedAt?: string;
  playingRole?: string;
  battingStyle?: string;
  bowlingStyle?: string;
  birthDate?: string;
  eligibilityVerified?: boolean;
  catalogSheets?: string[];
  catalogArchived?: boolean;
};
export type TeamLineupInput = {
  /** Array indices are positions; null keeps an unassigned position in place. */
  playingXI: (string | null)[]; substitutes: (string | null)[];
  captainId: string | null; viceCaptainId: string | null;
};
export type TeamLineup = TeamLineupInput & { revision: number };
/** Private to the authenticated manager; never stored in the shared room state. */
export type TargetPicks = { teamId: string; playerIds: string[]; revision: number };
export type Team = {
  id: string; name: string; shortName: string; color: string; purse: number;
  squad: { playerId: string; amount: number }[];
  lineup?: TeamLineup;
};
export type Member = {
  id: string; name: string; role: "auctioneer" | "bidder" | "spectator";
  teamId: string | null; joinedAt: number; lastSeenAt: number; flagRaisedAt: number | null;
};
export type Bid = { id: string; playerId: string; teamId: string; memberId: string; amount: number; at: number };
export type Activity = {
  id: string; type: string; text: string; at: number; memberId?: string;
  senderName?: string; senderTeamId?: string | null;
};
export type SaleCorrection = {
  id: string; at: number; actorId: string; actorName: string;
  playerId: string; playerName: string; reason: string; revision: number;
  before: { teamId: string; teamName: string; amount: number };
  after: { teamId: string; teamName: string; amount: number } | null;
};
export type RoomSettings = {
  purse: number; maxSquadSize: number; maxOverseas: number;
  bidCooldownMs: number; bidIncrement: number; callUrl: string;
};
export type RoomState = {
  id: string; code: string; name: string; version: number; createdAt: number;
  mode?: "practice";
  serverTime: number; hostId: string; members: Member[]; players: Player[]; teams: Team[];
  currentPlayerId: string | null; currentBid: number; leadingTeamId: string | null;
  phase: Phase; lastBidAt: number | null; bidHistory: Bid[]; activity: Activity[];
  /** Identifies the latest lock cycle independently of chat and other room changes. */
  bidLockVersion?: number;
  settings: RoomSettings;
  catalogVersion?: string;
  catalogDataRevision?: string;
  sharedCatalogVersion?: number;
  catalogCount?: number;
  teamCatalogVersion?: number;
  /** Response-only projection for this manager. Other members never receive it. */
  myTargetPicks?: TargetPicks;
  /** Completed rooms remain readable; corrections and lineups can still be saved. */
  endedAt?: number;
  endedBy?: string;
  resultsRevision?: number;
  completedManagers?: Record<string, { id: string; name: string }>;
  /** Durable audit history, independent of the rolling activity feed. */
  saleCorrections?: SaleCorrection[];
};
export type PlayerInput = Omit<Player, "id" | "status" | "soldTo" | "soldFor"> & { id?: string };
export type AuctionAction =
  | { type: "select_player"; playerId: string }
  | { type: "start" | "pause" | "resume" | "lock" | "sell" | "unsold" | "leave" | "ping" }
  | { type: "unlock"; expectedPlayerId: string; expectedAmount: number; expectedLockVersion: number }
  | { type: "bid"; expectedAmount: number; expectedPlayerId: string; customAmount?: number }
  | { type: "add_player"; player: PlayerInput }
  | { type: "update_player"; player: Player }
  | { type: "delete_player"; playerId: string }
  | { type: "update_settings"; settings: Partial<RoomSettings> }
  | { type: "chat"; text: string }
  | { type: "set_lineup"; teamId: string; lineup: TeamLineupInput; expectedRevision: number }
  | { type: "set_target_picks"; teamId: string; playerIds: string[]; expectedRevision: number }
  | { type: "end_auction"; expectedResultsRevision: number }
  | { type: "correct_sale"; playerId: string; expectedTeamId: string; expectedAmount: number; expectedResultsRevision: number; teamId: string | null; amount?: number; reason: string }
  | { type: "claim_team"; teamId: string | null; teamPassword?: string };

export const DEFAULT_SETTINGS: RoomSettings = {
  purse: 10000, maxSquadSize: 25, maxOverseas: 8, bidCooldownMs: 1000,
  bidIncrement: 25, callUrl: "",
};

// Original sample values identify untouched legacy entries during non-destructive migration.
const seedData: [string, string, PlayerRole, number, number, number, number, number][] = [
  ["Rishabh Pant", "India", "Marquee", 200, 111, 3284, 0, 148.93],
  ["Virat Kohli", "India", "Marquee", 200, 252, 8004, 4, 131.97],
  ["Jasprit Bumrah", "India", "Marquee", 200, 133, 69, 165, 85.19],
  ["Rohit Sharma", "India", "Marquee", 200, 257, 6628, 15, 131.14],
  ["Jos Buttler", "England", "Wicketkeeper", 200, 107, 3582, 0, 147.53],
  ["Rashid Khan", "Afghanistan", "Bowler", 200, 121, 545, 149, 161.72],
  ["Hardik Pandya", "India", "All-rounder", 200, 137, 2525, 64, 145.61],
  ["Shubman Gill", "India", "Batter", 200, 103, 3216, 0, 135.70],
  ["Travis Head", "Australia", "Batter", 200, 25, 772, 2, 173.87],
  ["Pat Cummins", "Australia", "Bowler", 200, 58, 515, 63, 147.14],
  ["Suryakumar Yadav", "India", "Batter", 200, 150, 3594, 0, 145.33],
  ["Ravindra Jadeja", "India", "All-rounder", 200, 240, 2959, 160, 129.36],
  ["KL Rahul", "India", "Wicketkeeper", 200, 132, 4683, 0, 134.61],
  ["Andre Russell", "West Indies", "All-rounder", 200, 126, 2484, 115, 174.93],
  ["Yuzvendra Chahal", "India", "Bowler", 200, 160, 37, 205, 43.53],
  ["Sanju Samson", "India", "Wicketkeeper", 200, 168, 4419, 0, 138.96],
  ["Mitchell Starc", "Australia", "Bowler", 200, 41, 102, 51, 96.23],
  ["Shreyas Iyer", "India", "Batter", 200, 116, 3127, 0, 127.48],
  ["Nicholas Pooran", "West Indies", "Wicketkeeper", 200, 76, 1769, 0, 162.29],
  ["Mohammed Shami", "India", "Bowler", 150, 110, 69, 127, 93.24],
  ["Axar Patel", "India", "All-rounder", 150, 150, 1653, 123, 130.88],
  ["Yashasvi Jaiswal", "India", "Batter", 150, 53, 1607, 0, 150.61],
  ["Arshdeep Singh", "India", "Bowler", 150, 65, 25, 76, 64.10],
  ["Glenn Maxwell", "Australia", "All-rounder", 200, 134, 2771, 37, 156.73],
  ["Rinku Singh", "India", "Batter", 100, 45, 893, 0, 143.34],
  ["Ishan Kishan", "India", "Wicketkeeper", 150, 105, 2644, 0, 135.86],
  ["Kuldeep Yadav", "India", "Bowler", 150, 84, 191, 87, 79.25],
  ["Sunil Narine", "West Indies", "All-rounder", 200, 177, 1534, 180, 165.84],
  ["Shivam Dube", "India", "All-rounder", 100, 65, 1502, 5, 146.67],
  ["Sai Sudharsan", "India", "Batter", 100, 25, 1034, 0, 139.17],
  ["T Natarajan", "India", "Bowler", 100, 61, 3, 67, 60],
  ["Dhruv Jurel", "India", "Wicketkeeper", 50, 28, 347, 0, 151.53],
];

export function createPlayerPool(): Player[] {
  const knownCountries = Object.fromEntries(seedData.map(([name, country]) => [name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), country]));
  return buildCatalogPool(knownCountries);
}

/** Append new catalog identities once; never reset sales, bids, purses, or manual edits. */
export function upgradeRoomCatalog(source: RoomState, now = Date.now()): RoomState {
  if (source.endedAt !== undefined) return source;
  if (source.catalogVersion === CATALOG_VERSION && source.catalogDataRevision === CATALOG_DATA_REVISION) return source;
  const state = structuredClone(source);
  const canonical = createPlayerPool();
  const normalize = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const present = new Set(state.players.map(player => normalize(player.name)));
  const existingIds = new Set(state.players.map(player => player.id));
  let added = 0;
  for (const player of canonical) {
    if (source.catalogVersion !== CATALOG_VERSION && !existingIds.has(player.id) && !present.has(normalize(player.name))) {
      state.players.push(player); existingIds.add(player.id); present.add(normalize(player.name)); added += 1;
    }
  }
  const catalogById = new Map(canonical.map(player => [player.id, player]));
  state.players = state.players.map(player => {
    const legacyDetails = legacyPlayerDetails(player.id);
    const entry = catalogById.get(player.id) ?? (legacyDetails ? { ...player, ...legacyDetails } : undefined);
    if (!entry) return player;
    const legacy = seedData.find(([name]) => normalize(name) === normalize(player.name));
    const untouchedSample = !player.dataStatus && legacy &&
      player.stats.matches === legacy[4] && player.stats.runs === legacy[5] &&
      player.stats.wickets === legacy[6] && player.stats.strikeRate === legacy[7];
    const replaceFacts = untouchedSample || player.dataStatus === "illustrative" ||
      (player.dataStatus === "partial" && !!player.catalogSheets?.length);
    return {
      ...player,
      catalogSheets: entry.catalogSheets,
      ...(replaceFacts ? {
        stats: entry.stats, statsFormat: entry.statsFormat, dataStatus: entry.dataStatus,
        dataSources: entry.dataSources, dataUpdatedAt: entry.dataUpdatedAt,
        profileUrl: entry.profileUrl, playingRole: entry.playingRole,
        battingStyle: entry.battingStyle, bowlingStyle: entry.bowlingStyle, birthDate: entry.birthDate,
        image: player.image || entry.image,
        ...(player.eligibilityVerified === false && entry.eligibilityVerified ? { country: entry.country, isOverseas: entry.isOverseas, eligibilityVerified: true } : {}),
      } : {}),
    };
  });
  state.catalogVersion = CATALOG_VERSION;
  state.catalogDataRevision = CATALOG_DATA_REVISION;
  state.version += 1; state.serverTime = now;
  if (added) state.activity.push({ id: `catalog-${state.version}-${now}`, type: "pool", text: `${added} players from the imported workbook were added to the pool. Existing auction results were preserved.`, at: now });
  state.activity = state.activity.slice(-150);
  return state;
}

/** Append franchise choices once without rewriting existing teams or auction records. */
export function upgradeRoomTeams(source: RoomState, now = Date.now()): RoomState {
  if (source.endedAt !== undefined) return source;
  if (source.teamCatalogVersion === TEAM_CATALOG_VERSION) return source;
  const existingIds = new Set(source.teams.map(team => team.id));
  const added = TEAM_SEEDS.filter(team => !existingIds.has(team.id));
  const teams: Team[] = [...source.teams, ...added.map(team => ({ ...team, purse: source.settings.purse, squad: [] }))];
  const members = [...source.members];
  if (source.mode === "practice") {
    for (const team of added) {
      if (!members.some(member => member.teamId === team.id || member.id === `demo-${team.id}`)) {
        members.push({
          id: `demo-${team.id}`, name: PRACTICE_MANAGER_NAMES[team.id], role: "bidder", teamId: team.id,
          joinedAt: now, lastSeenAt: now, flagRaisedAt: null,
        });
      }
    }
  }
  return { ...source, teams, members, teamCatalogVersion: TEAM_CATALOG_VERSION, version: source.version + 1, serverTime: now };
}

export function createRoomState(code: string, name: string, host: Member, now = Date.now()): RoomState {
  return {
    id: code, code, name, version: 0, createdAt: now, serverTime: now, hostId: host.id,
    members: [host], players: createPlayerPool(),
    teams: TEAM_SEEDS.map((team) => ({ ...team, purse: DEFAULT_SETTINGS.purse, squad: [] })),
    currentPlayerId: null, currentBid: 0, leadingTeamId: null, phase: "waiting", lastBidAt: null,
    bidHistory: [], activity: [{ id: `created-${now}`, type: "room", text: `${host.name} opened the auction room.`, at: now }],
    settings: { ...DEFAULT_SETTINGS }, catalogVersion: CATALOG_VERSION, catalogDataRevision: CATALOG_DATA_REVISION,
    teamCatalogVersion: TEAM_CATALOG_VERSION, resultsRevision: 0, saleCorrections: [],
  };
}

export function createDemoState(options: { hostName?: string } = {}): RoomState {
  const now = Date.now();
  const host: Member = { id: "demo-host", name: options.hostName || "You", role: "auctioneer", teamId: null, joinedAt: now - 300000, lastSeenAt: now, flagRaisedAt: null };
  const state = createRoomState("DEMO26", "The Premier Auction", host, now - 300000);
  state.members.push(...TEAM_SEEDS.map((team) => ({
    id: `demo-${team.id}`, name: PRACTICE_MANAGER_NAMES[team.id], role: "bidder" as const, teamId: team.id,
    joinedAt: now - 240000, lastSeenAt: now, flagRaisedAt: null,
  })));
  state.currentPlayerId = "rishabh-pant";
  state.phase = "live"; state.currentBid = 725; state.leadingTeamId = "rcb";
  state.lastBidAt = now - 5000; state.serverTime = now;
  state.bidHistory = [
    { id: "demo-bid-1", playerId: "rishabh-pant", teamId: "mi", memberId: "demo-mi", amount: 675, at: now - 31000 },
    { id: "demo-bid-2", playerId: "rishabh-pant", teamId: "csk", memberId: "demo-csk", amount: 700, at: now - 17000 },
    { id: "demo-bid-3", playerId: "rishabh-pant", teamId: "rcb", memberId: "demo-rcb", amount: 725, at: now - 5000 },
  ];
  state.activity.push(
    { id: "demo-activity-1", type: "player", text: "Rishabh Pant is on the auction floor.", at: now - 45000 },
    { id: "demo-activity-2", type: "bid", text: "Chennai Super Kings bid ₹7.00 Cr.", at: now - 17000 },
    { id: "demo-activity-3", type: "bid", text: "Royal Challengers Bengaluru bid ₹7.25 Cr.", at: now - 5000 },
  );
  return state;
}

export class AuctionError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "INVALID_ACTION") {
    super(message); this.name = "AuctionError"; this.status = status; this.code = code;
  }
}

function requireCondition(value: unknown, message: string, status = 400, code = "INVALID_ACTION"): asserts value {
  if (!value) throw new AuctionError(message, status, code);
}

export function cleanText(value: unknown, label: string, maxLength = 80): string {
  requireCondition(typeof value === "string", `${label} is required.`);
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  requireCondition(text.length >= 1 && text.length <= maxLength, `${label} must contain 1–${maxLength} characters.`);
  return text;
}

function numberInRange(value: unknown, label: string, min: number, max: number, integer = true): number {
  requireCondition(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), `${label} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`);
  return value;
}

function safeUrl(value: unknown, label: string): string {
  if (value === "" || value === undefined) return "";
  requireCondition(typeof value === "string" && value.length <= 2048, `${label} must be a valid HTTPS URL.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new AuctionError(`${label} must be a valid HTTPS URL.`); }
  requireCondition(url.protocol === "https:" && !url.username && !url.password, `${label} must be a valid HTTPS URL.`);
  return url.toString();
}

function validatePlayer(input: PlayerInput | Player, id: string): Player {
  requireCondition(input && typeof input === "object", "Player details are required.");
  requireCondition(PLAYER_ROLES.includes(input.role), "Choose a valid player category.");
  requireCondition(typeof input.isOverseas === "boolean", "Choose whether this player is overseas.");
  const stats = input.stats || { matches: null, runs: null, wickets: null, strikeRate: null };
  const statistic = (value: unknown, label: string, maximum: number, integer = true) => value === null || value === undefined ? null : numberInRange(value, label, 0, maximum, integer);
  const country = cleanText(input.country, "Country", 50);
  requireCondition(!input.statsFormat || ["IPL", "T20", "T20I", "ODI", "Test", "Unknown"].includes(input.statsFormat), "Choose a valid statistics format.");
  requireCondition(!input.dataStatus || ["verified", "partial", "manual", "illustrative"].includes(input.dataStatus), "Invalid player data status.");
  requireCondition(input.dataSources === undefined || (Array.isArray(input.dataSources) && input.dataSources.length <= 5), "A player can have up to five data sources.");
  requireCondition(input.eligibilityVerified === undefined || typeof input.eligibilityVerified === "boolean", "Invalid player eligibility status.");
  return {
    id, name: cleanText(input.name, "Player name"), country,
    role: input.role, basePrice: numberInRange(input.basePrice, "Base price", 1, 100000),
    isOverseas: input.isOverseas, status: "available", image: safeUrl(input.image, "Player image"),
    stats: {
      matches: statistic(stats.matches, "Matches", 10000), runs: statistic(stats.runs, "Runs", 1000000),
      wickets: statistic(stats.wickets, "Wickets", 10000), strikeRate: statistic(stats.strikeRate, "Strike rate", 1000, false),
    },
    statsFormat: input.statsFormat || "Unknown", dataStatus: input.dataStatus || "manual",
    profileUrl: safeUrl(input.profileUrl, "Player profile"),
    dataSources: input.dataSources?.map(source => ({ label: cleanText(source.label, "Source name", 50), url: safeUrl(source.url, "Source URL") })) || [],
    dataUpdatedAt: input.dataUpdatedAt ? cleanText(input.dataUpdatedAt, "Data timestamp", 40) : undefined,
    playingRole: input.playingRole ? cleanText(input.playingRole, "Playing role", 80) : undefined,
    battingStyle: input.battingStyle ? cleanText(input.battingStyle, "Batting style", 80) : undefined,
    bowlingStyle: input.bowlingStyle ? cleanText(input.bowlingStyle, "Bowling style", 80) : undefined,
    birthDate: input.birthDate ? cleanText(input.birthDate, "Birth date", 40) : undefined,
    eligibilityVerified: !["unverified", "unknown", "not supplied", "not available", "n/a"].includes(country.toLowerCase()) && input.eligibilityVerified !== false,
  };
}

function validateTeamBid(state: RoomState, team: Team, player: Player, amount: number) {
  requireCondition(player.eligibilityVerified !== false, "The auctioneer must confirm this player's country and overseas status before bidding.", 409, "PLAYER_REVIEW_REQUIRED");
  requireCondition(team.purse >= amount, `${team.shortName} does not have enough purse remaining.`, 409, "INSUFFICIENT_PURSE");
  requireCondition(team.squad.length < state.settings.maxSquadSize, `${team.shortName}'s squad is full.`, 409, "SQUAD_FULL");
  const overseas = team.squad.filter((sale) => state.players.find((entry) => entry.id === sale.playerId)?.isOverseas).length;
  requireCondition(!player.isOverseas || overseas < state.settings.maxOverseas, `${team.shortName} has reached the overseas player limit.`, 409, "OVERSEAS_LIMIT");
}

function validateLineup(input: unknown, state: RoomState, team: Team): TeamLineupInput {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "Lineup details are required.");
  const value = input as Record<string, unknown>;
  const owned = new Set(team.squad.map(sale => sale.playerId));
  const purchased = new Set(state.players.filter(player => player.status === "sold" && player.soldTo === team.id).map(player => player.id));
  const playerIds = (candidate: unknown, label: string, maximum: number): (string | null)[] => {
    requireCondition(Array.isArray(candidate) && candidate.length <= maximum, `Choose up to ${maximum} players for ${label}.`);
    for (const id of candidate) {
      if (id === null) continue;
      requireCondition(typeof id === "string" && id.length > 0 && id.length <= 100, "Choose valid player IDs for your lineup.");
      requireCondition(owned.has(id) && purchased.has(id), "Your lineup can only include players purchased by your team.", 400, "LINEUP_PLAYER_NOT_OWNED");
    }
    const selected = candidate.filter(id => id !== null);
    requireCondition(new Set(selected).size === selected.length, "A player can only appear once in your lineup.");
    const positions = [...candidate] as (string | null)[];
    while (positions.at(-1) === null) positions.pop();
    return positions;
  };
  const playingXI = playerIds(value.playingXI, "the playing XI", 11);
  const substitutes = playerIds(value.substitutes, "the substitutes", 5);
  requireCondition(!substitutes.some(id => id !== null && playingXI.includes(id)), "A player cannot be in both the playing XI and substitutes.");
  const captain = (id: unknown, label: string): string | null => {
    requireCondition(id === null || (typeof id === "string" && playingXI.includes(id)), `${label} must be selected from your playing XI.`);
    return id as string | null;
  };
  const captainId = captain(value.captainId, "The captain");
  const viceCaptainId = captain(value.viceCaptainId, "The vice-captain");
  requireCondition(captainId === null || captainId !== viceCaptainId, "Choose different players as captain and vice-captain.");
  return { playingXI, substitutes, captainId, viceCaptainId };
}

/** Pure authoritative transition, shared with the interactive demo. Throws AuctionError on rejection. */
export function applyAction(source: RoomState, action: AuctionAction, memberId: string, now = Date.now()): RoomState {
  requireCondition(action && typeof action === "object" && typeof action.type === "string", "An action is required.");
  const state = structuredClone(source);
  const member = state.members.find((entry) => entry.id === memberId);
  requireCondition(member, "Join this room to continue.", 401, "UNAUTHORIZED");
  const hostActions = ["select_player", "start", "pause", "resume", "lock", "unlock", "sell", "unsold", "add_player", "update_player", "delete_player", "update_settings", "end_auction", "correct_sale"];
  if (hostActions.includes(action.type)) requireCondition(member.id === state.hostId && member.role === "auctioneer", "Only the auctioneer can do that.", 403, "FORBIDDEN");
  if (state.endedAt !== undefined && !["end_auction", "correct_sale", "set_lineup", "chat", "ping", "leave"].includes(action.type)) {
    throw new AuctionError("This auction has ended. Its results remain available in the recap.", 409, "AUCTION_ENDED");
  }
  const player = state.players.find((entry) => entry.id === state.currentPlayerId);
  const log = (type: string, text: string) => state.activity.push({
    id: `${state.version + 1}-${now}-${state.activity.length}`, type, text, at: now, memberId,
    ...(type === "chat" ? { senderName: member.name, senderTeamId: member.teamId } : {}),
  });
  const requireResultsRevision = (expected: number) => {
    requireCondition(Number.isSafeInteger(expected) && expected >= 0 && expected < Number.MAX_SAFE_INTEGER && expected === (state.resultsRevision ?? 0), "The auction results changed. Review the latest results before confirming.", 409, "RESULTS_CONFLICT");
  };
  switch (action.type) {
    case "select_player": {
      requireCondition(["waiting", "sold", "unsold"].includes(state.phase), "Close the current auction before selecting another player.", 409);
      const next = state.players.find((entry) => entry.id === action.playerId);
      requireCondition(next && !next.catalogArchived && next.status !== "sold", "Choose an available or unsold player from the shared pool.");
      next.status = "available"; state.currentPlayerId = next.id; state.currentBid = 0; state.leadingTeamId = null;
      state.lastBidAt = null; state.phase = "waiting"; log("player", `${next.name} is on the auction floor.`); break;
    }
    case "start":
      requireCondition(player && state.phase === "waiting", "Select a player before opening bidding.", 409);
      requireCondition(player.eligibilityVerified !== false, "Confirm this player's country and overseas status before opening bidding.", 409, "PLAYER_REVIEW_REQUIRED");
      state.phase = "live"; log("auction", `Bidding is open for ${player.name}.`); break;
    case "pause":
      requireCondition(state.phase === "live", "Bidding is not live.", 409);
      state.phase = "paused"; log("auction", "The auctioneer paused bidding."); break;
    case "resume":
      requireCondition(state.phase === "paused", "Bidding is not paused.", 409);
      state.phase = "live"; log("auction", "Bidding has resumed."); break;
    case "lock":
      requireCondition(player && (state.phase === "live" || state.phase === "paused"), "There is no open bidding to lock.", 409);
      state.phase = "locked"; state.bidLockVersion = state.version + 1;
      log("auction", "Bidding locked. No further bids are accepted."); break;
    case "unlock":
      requireCondition(player && player.status === "available" && state.phase === "locked", "Only a locked, unsettled player can be reopened for bidding.", 409, "BIDDING_NOT_LOCKED");
      requireCondition(typeof action.expectedLockVersion === "number" && Number.isSafeInteger(action.expectedLockVersion) && action.expectedLockVersion >= 0 && action.expectedLockVersion === (state.bidLockVersion ?? 0), "This bidding lock has changed. Review the latest lock before reopening bidding.", 409, "STALE_LOCK");
      requireCondition(action.expectedPlayerId === player.id, "The auctioneer has moved to another player. Review the current lot before reopening bidding.", 409, "STALE_PLAYER");
      requireCondition(typeof action.expectedAmount === "number" && Number.isSafeInteger(action.expectedAmount) && action.expectedAmount >= 0, "A valid locked bid amount is required.", 400, "INVALID_UNLOCK_AMOUNT");
      requireCondition(action.expectedAmount === state.currentBid, "The locked bid has changed. Review the current price before reopening bidding.", 409, "STALE_BID");
      state.phase = "live"; log("unlock", `The auctioneer reopened bidding for ${player.name}.`); break;
    case "sell": {
      requireCondition(player && state.phase === "locked" && state.leadingTeamId && state.currentBid > 0, "Lock a winning bid before confirming the sale.", 409);
      const team = state.teams.find((entry) => entry.id === state.leadingTeamId)!;
      requireCondition(player.status !== "sold", "This player has already been sold.", 409);
      validateTeamBid(state, team, player, state.currentBid);
      team.purse -= state.currentBid; team.squad.push({ playerId: player.id, amount: state.currentBid });
      player.status = "sold"; player.soldTo = team.id; player.soldFor = state.currentBid;
      state.resultsRevision = (state.resultsRevision ?? 0) + 1;
      state.phase = "sold"; log("sold", `${player.name} sold to ${team.shortName} for ${formatMoney(state.currentBid)}.`); break;
    }
    case "unsold":
      requireCondition(player && state.phase === "locked" && !state.leadingTeamId, "Lock bidding with no bids before marking a player unsold.", 409);
      player.status = "unsold"; state.phase = "unsold"; log("unsold", `${player.name} goes unsold.`); break;
    case "end_auction": {
      requireCondition(state.endedAt === undefined, "This auction has already ended.", 409, "AUCTION_ALREADY_ENDED");
      requireResultsRevision(action.expectedResultsRevision);
      requireCondition(!["live", "paused", "locked"].includes(state.phase), "Settle the current player before ending the auction.", 409, "ROUND_UNSETTLED");
      state.endedAt = now; state.endedBy = member.id;
      state.resultsRevision = (state.resultsRevision ?? 0) + 1;
      state.completedManagers = Object.fromEntries(state.members.filter(entry => entry.role === "bidder" && entry.teamId).map(entry => [entry.teamId!, { id: entry.id, name: entry.name }]));
      log("auction_ended", `${member.name} ended the auction. The recap and squads are available.`);
      break;
    }
    case "correct_sale": {
      requireResultsRevision(action.expectedResultsRevision);
      requireCondition(!["live", "paused", "locked"].includes(state.phase), "Settle the current player before correcting a sale.", 409, "ROUND_UNSETTLED");
      const target = state.players.find(entry => entry.id === action.playerId);
      requireCondition(target?.status === "sold" && target.soldTo && target.soldFor !== undefined, "This player no longer has a sale to correct.", 409, "SALE_CONFLICT");
      requireCondition(action.expectedTeamId === target.soldTo && action.expectedAmount === target.soldFor, "This sale changed. Review the latest team and price before correcting it.", 409, "SALE_CONFLICT");
      const reason = cleanText(action.reason, "Correction reason", 500);
      const previousTeam = state.teams.find(entry => entry.id === target.soldTo);
      const previousSale = previousTeam?.squad.find(entry => entry.playerId === target.id);
      requireCondition(previousTeam && previousSale?.amount === target.soldFor, "This sale's squad record needs review before it can be corrected.", 409, "SALE_CONFLICT");
      requireCondition(action.teamId === null || (typeof action.teamId === "string" && state.teams.some(entry => entry.id === action.teamId)), "Choose a valid receiving team or cancel the sale.");
      const nextTeam = action.teamId === null ? undefined : state.teams.find(entry => entry.id === action.teamId)!;
      const amount = nextTeam ? numberInRange(action.amount, "Sale price in lakhs", target.basePrice, 100000) : 0;
      requireCondition(!nextTeam || nextTeam.id !== previousTeam.id || amount !== previousSale.amount, "Change the team or price, or cancel this sale.", 400, "NO_CORRECTION_CHANGE");
      const before = { teamId: previousTeam.id, teamName: previousTeam.name, amount: previousSale.amount };
      // Work on the cloned state: any failed validation leaves every purse and lineup intact.
      previousTeam.purse += previousSale.amount;
      previousTeam.squad = previousTeam.squad.filter(entry => entry.playerId !== target.id);
      if (nextTeam) {
        requireCondition(!nextTeam.squad.some(entry => entry.playerId === target.id), "The receiving squad already contains this player.", 409, "SALE_CONFLICT");
        validateTeamBid(state, nextTeam, target, amount);
        nextTeam.purse -= amount;
        if (nextTeam.id === previousTeam.id) {
          const oldIndex = source.teams.find(entry => entry.id === previousTeam.id)!.squad.findIndex(entry => entry.playerId === target.id);
          nextTeam.squad.splice(oldIndex, 0, { playerId: target.id, amount });
        } else nextTeam.squad.push({ playerId: target.id, amount });
        target.soldTo = nextTeam.id; target.soldFor = amount;
      } else {
        target.status = "available"; delete target.soldTo; delete target.soldFor;
      }
      if (nextTeam?.id !== previousTeam.id && previousTeam.lineup) {
        const lineup = previousTeam.lineup;
        if (lineup.playingXI.includes(target.id) || lineup.substitutes.includes(target.id) || lineup.captainId === target.id || lineup.viceCaptainId === target.id) {
          previousTeam.lineup = {
            playingXI: lineup.playingXI.map(id => id === target.id ? null : id),
            substitutes: lineup.substitutes.map(id => id === target.id ? null : id),
            captainId: lineup.captainId === target.id ? null : lineup.captainId,
            viceCaptainId: lineup.viceCaptainId === target.id ? null : lineup.viceCaptainId,
            revision: lineup.revision + 1,
          };
        }
      }
      if (state.currentPlayerId === target.id) {
        state.currentBid = amount; state.leadingTeamId = nextTeam?.id ?? null;
        state.phase = nextTeam ? "sold" : "waiting";
        if (!nextTeam) state.lastBidAt = null;
      }
      const revision = (state.resultsRevision ?? 0) + 1;
      state.resultsRevision = revision;
      state.saleCorrections = [...(state.saleCorrections ?? []), {
        id: `correction-${revision}-${now}`, at: now, actorId: member.id, actorName: member.name,
        playerId: target.id, playerName: target.name, reason, revision, before,
        after: nextTeam ? { teamId: nextTeam.id, teamName: nextTeam.name, amount } : null,
      }];
      log("sale_corrected", nextTeam ? `${member.name} corrected ${target.name}'s sale to ${nextTeam.shortName} for ${formatMoney(amount)}.` : `${member.name} cancelled ${target.name}'s sale and refunded ${previousTeam.shortName}.`);
      break;
    }
    case "bid": {
      requireCondition(player && state.phase === "live", "Bidding is closed. Wait for the auctioneer to open it.", 409, "BIDDING_CLOSED");
      requireCondition(action.expectedPlayerId === player.id, "The auctioneer has moved to another player. Review the current lot before bidding.", 409, "STALE_PLAYER");
      const team = state.teams.find((entry) => entry.id === member.teamId);
      requireCondition(team, "You need a team seat to place a bid.", 403, "NO_TEAM");
      requireCondition(team.id !== state.leadingTeamId, "Your team already holds the highest bid.", 409, "ALREADY_LEADING");
      const nextAmount = getNextBid(state);
      requireCondition(action.expectedAmount === nextAmount, "Another bid arrived first. Review the updated price and bid again.", 409, "STALE_BID");
      const amount = action.customAmount === undefined ? nextAmount : action.customAmount;
      requireCondition(typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0, "Enter a whole number of lakhs for your bid.", 400, "INVALID_BID_AMOUNT");
      requireCondition(amount >= nextAmount, `Your bid must be at least ${formatMoney(nextAmount)}.`, 400, "BID_TOO_LOW");
      requireCondition(state.lastBidAt === null || now - state.lastBidAt >= state.settings.bidCooldownMs, "The next bid opens in a moment.", 429, "BID_COOLDOWN");
      validateTeamBid(state, team, player, amount);
      state.currentBid = amount; state.leadingTeamId = team.id; state.lastBidAt = now;
      state.bidHistory.push({ id: `bid-${state.version + 1}-${now}`, playerId: player.id, teamId: team.id, memberId, amount, at: now });
      log("bid", `${team.name} bid ${formatMoney(amount)}.`); break;
    }
    case "add_player": {
      requireCondition(state.players.length < 500, "A room can contain up to 500 players.");
      const id = action.player?.id || `player-${now}-${state.version + 1}`;
      requireCondition(typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id), "Invalid player ID.");
      requireCondition(!state.players.some((entry) => entry.id === id), "A player with this ID already exists.", 409);
      const added = validatePlayer(action.player, id);
      const normalizeIdentity = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
      requireCondition(!state.players.some(entry => !entry.catalogArchived && (
        (added.profileUrl && entry.profileUrl === added.profileUrl) ||
        (normalizeIdentity(entry.name) === normalizeIdentity(added.name) && entry.country.toLowerCase() === added.country.toLowerCase())
      )), "This player is already in the pool. Update their existing profile instead.", 409, "PLAYER_EXISTS");
      state.players.push(added); log("pool", `${added.name} added to the player pool.`); break;
    }
    case "update_player": {
      const index = state.players.findIndex((entry) => entry.id === action.player?.id);
      requireCondition(index >= 0, "Player not found.", 404);
      requireCondition(state.players[index].status !== "sold" && (action.player.id !== state.currentPlayerId || (state.phase === "waiting" && !state.leadingTeamId)), "Players in active bidding and sold players cannot be edited.", 409);
      state.players[index] = { ...validatePlayer(action.player, action.player.id), status: state.players[index].status, catalogSheets: state.players[index].catalogSheets };
      log("pool", `${state.players[index].name}'s details were updated.`); break;
    }
    case "delete_player": {
      const target = state.players.find((entry) => entry.id === action.playerId);
      requireCondition(target, "Player not found.", 404);
      requireCondition(target.status !== "sold" && target.id !== state.currentPlayerId, "Current and sold players cannot be removed.", 409);
      state.players = state.players.filter((entry) => entry.id !== target.id); log("pool", `${target.name} removed from the player pool.`); break;
    }
    case "update_settings": {
      requireCondition(action.settings && typeof action.settings === "object", "Settings are required.");
      const value = { ...state.settings, ...action.settings };
      const settings: RoomSettings = {
        purse: numberInRange(value.purse, "Starting purse", 100, 100000), maxSquadSize: numberInRange(value.maxSquadSize, "Squad limit", 1, 30),
        maxOverseas: numberInRange(value.maxOverseas, "Overseas limit", 0, 30), bidCooldownMs: numberInRange(value.bidCooldownMs, "Bid cooldown", 1000, 2000),
        bidIncrement: numberInRange(value.bidIncrement, "Bid increment", 5, 500), callUrl: safeUrl(value.callUrl, "Call link"),
      };
      requireCondition(settings.maxOverseas <= settings.maxSquadSize, "Overseas limit cannot exceed squad size.");
      requireCondition(!["live", "paused", "locked"].includes(state.phase) || (settings.bidIncrement === state.settings.bidIncrement && settings.bidCooldownMs === state.settings.bidCooldownMs), "Change bidding rules between players.", 409);
      if (settings.purse !== state.settings.purse) {
        requireCondition(state.bidHistory.length === 0 && state.teams.every((team) => team.squad.length === 0), "Starting purse can only change before the first bid.", 409);
        state.teams.forEach((team) => { team.purse = settings.purse; });
      }
      for (const team of state.teams) {
        requireCondition(team.squad.length <= settings.maxSquadSize, "Squad limit cannot be lower than an existing squad.", 409);
        const overseas = team.squad.filter((sale) => state.players.find((entry) => entry.id === sale.playerId)?.isOverseas).length;
        requireCondition(overseas <= settings.maxOverseas, "Overseas limit cannot be lower than an existing squad's overseas count.", 409);
      }
      if (state.leadingTeamId && player && ["live", "paused", "locked"].includes(state.phase)) validateTeamBid({ ...state, settings }, state.teams.find((team) => team.id === state.leadingTeamId)!, player, state.currentBid);
      state.settings = settings; log("settings", "The auctioneer updated room settings."); break;
    }
    case "chat": {
      const text = cleanText(action.text, "Message", 500);
      const recent = state.activity.filter((entry) => entry.type === "chat" && entry.memberId === memberId).at(-1);
      requireCondition(!recent || now - recent.at >= 1000, "Please wait a moment before sending another message.", 429);
      log("chat", text); break;
    }
    case "set_lineup": {
      requireCondition(typeof action.teamId === "string" && action.teamId.length > 0, "Choose a valid team.");
      requireCondition(member.role === "bidder" && member.id !== state.hostId && member.teamId === action.teamId, "Only this team's manager can edit its lineup.", 403, "FORBIDDEN");
      const team = state.teams.find(entry => entry.id === action.teamId);
      requireCondition(team, "Team not found.", 404);
      requireCondition(Number.isSafeInteger(action.expectedRevision) && action.expectedRevision >= 0 && action.expectedRevision < Number.MAX_SAFE_INTEGER, "A valid lineup revision is required.");
      const revision = team.lineup?.revision ?? 0;
      requireCondition(action.expectedRevision === revision, "Your lineup changed in another tab. Review the latest lineup before saving again.", 409, "LINEUP_CONFLICT");
      team.lineup = { ...validateLineup(action.lineup, state, team), revision: revision + 1 };
      log("lineup", `${team.shortName} updated their playing XI and substitutes.`); break;
    }
    case "claim_team": {
      requireCondition(action.teamId === null || state.teams.some((team) => team.id === action.teamId), "Choose a valid team.");
      requireCondition(action.teamId === null || !state.members.some((entry) => entry.id !== memberId && entry.teamId === action.teamId), "This team already has a manager.", 409, "TEAM_TAKEN");
      requireCondition(!state.leadingTeamId || member.teamId !== state.leadingTeamId || !["live", "paused", "locked"].includes(state.phase), "Keep your seat until your leading bid is settled.", 409);
      member.teamId = action.teamId; member.role = member.id === state.hostId ? "auctioneer" : action.teamId ? "bidder" : "spectator";
      log("room", `${member.name} ${action.teamId ? `took the ${state.teams.find((team) => team.id === action.teamId)!.shortName} seat` : "joined the spectators"}.`); break;
    }
    case "leave":
      requireCondition(member.id !== state.hostId, "The auctioneer must stay in the room.", 409);
      requireCondition(!state.leadingTeamId || member.teamId !== state.leadingTeamId || !["live", "paused", "locked"].includes(state.phase), "Your leading bid must be settled before leaving.", 409);
      state.members = state.members.filter((entry) => entry.id !== memberId); log("room", `${member.name} left the room.`); break;
    case "ping": break;
    default: throw new AuctionError("Unknown auction action.");
  }
  member.lastSeenAt = now; state.activity = state.activity.slice(-150); state.bidHistory = state.bidHistory.slice(-2000);
  state.serverTime = now; state.version += 1;
  return state;
}
