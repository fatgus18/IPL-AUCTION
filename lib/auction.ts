/** All monetary values are integer lakhs: 100 lakhs = 1 crore. */
export const PLAYER_ROLES = ["Marquee", "Batter", "Bowler", "All-rounder", "Wicketkeeper"] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];
export type Phase = "waiting" | "live" | "paused" | "locked" | "sold" | "unsold";
export type Player = {
  id: string; name: string; country: string; role: PlayerRole; basePrice: number;
  isOverseas: boolean; status: "available" | "sold" | "unsold";
  soldTo?: string; soldFor?: number; image?: string;
  stats: { matches: number; runs: number; wickets: number; strikeRate: number };
};
export type Team = {
  id: string; name: string; shortName: string; color: string; purse: number;
  squad: { playerId: string; amount: number }[];
};
export type Member = {
  id: string; name: string; role: "auctioneer" | "bidder" | "spectator";
  teamId: string | null; joinedAt: number; lastSeenAt: number; flagRaisedAt: number | null;
};
export type Bid = { id: string; playerId: string; teamId: string; memberId: string; amount: number; at: number };
export type Activity = { id: string; type: string; text: string; at: number; memberId?: string };
export type RoomSettings = {
  purse: number; maxSquadSize: number; maxOverseas: number;
  bidCooldownMs: number; bidIncrement: number; callUrl: string;
};
export type RoomState = {
  id: string; code: string; name: string; version: number; createdAt: number;
  serverTime: number; hostId: string; members: Member[]; players: Player[]; teams: Team[];
  currentPlayerId: string | null; currentBid: number; leadingTeamId: string | null;
  phase: Phase; lastBidAt: number | null; bidHistory: Bid[]; activity: Activity[];
  settings: RoomSettings;
};
export type PlayerInput = Omit<Player, "id" | "status" | "soldTo" | "soldFor"> & { id?: string };
export type AuctionAction =
  | { type: "select_player"; playerId: string }
  | { type: "start" | "pause" | "resume" | "lock" | "sell" | "unsold" | "raise_flag" | "leave" | "ping" }
  | { type: "bid"; expectedAmount: number; expectedPlayerId: string }
  | { type: "add_player"; player: PlayerInput }
  | { type: "update_player"; player: Player }
  | { type: "delete_player"; playerId: string }
  | { type: "update_settings"; settings: Partial<RoomSettings> }
  | { type: "chat"; text: string }
  | { type: "claim_team"; teamId: string | null };

export const TEAM_SEEDS = [
  { id: "csk", name: "Chennai Super Kings", shortName: "CSK", color: "#edc447" },
  { id: "mi", name: "Mumbai Indians", shortName: "MI", color: "#4d8dff" },
  { id: "rcb", name: "Royal Challengers Bengaluru", shortName: "RCB", color: "#ef595e" },
  { id: "kkr", name: "Kolkata Knight Riders", shortName: "KKR", color: "#a68ce5" },
  { id: "srh", name: "Sunrisers Hyderabad", shortName: "SRH", color: "#f79651" },
  { id: "rr", name: "Rajasthan Royals", shortName: "RR", color: "#ec79ae" },
  { id: "dc", name: "Delhi Capitals", shortName: "DC", color: "#61bde9" },
  { id: "pbks", name: "Punjab Kings", shortName: "PBKS", color: "#e87878" },
] as const;

export const DEFAULT_SETTINGS: RoomSettings = {
  purse: 10000, maxSquadSize: 25, maxOverseas: 8, bidCooldownMs: 1000,
  bidIncrement: 25, callUrl: "",
};

// Illustrative career figures for the starter pool; organizers can edit every field.
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
  return seedData.map(([name, country, role, basePrice, matches, runs, wickets, strikeRate]) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, country, role, basePrice,
    isOverseas: country !== "India", status: "available", stats: { matches, runs, wickets, strikeRate },
  }));
}

export function formatMoney(lakhs: number): string {
  return lakhs >= 100 ? `₹${(lakhs / 100).toFixed(2)} Cr` : `₹${lakhs} L`;
}

export function getNextBid(state: RoomState): number {
  const player = state.players.find((entry) => entry.id === state.currentPlayerId);
  if (!player) return 0;
  return state.leadingTeamId ? state.currentBid + state.settings.bidIncrement : player.basePrice;
}

export function createRoomState(code: string, name: string, host: Member, now = Date.now()): RoomState {
  return {
    id: code, code, name, version: 0, createdAt: now, serverTime: now, hostId: host.id,
    members: [host], players: createPlayerPool(),
    teams: TEAM_SEEDS.map((team) => ({ ...team, purse: DEFAULT_SETTINGS.purse, squad: [] })),
    currentPlayerId: null, currentBid: 0, leadingTeamId: null, phase: "waiting", lastBidAt: null,
    bidHistory: [], activity: [{ id: `created-${now}`, type: "room", text: `${host.name} opened the auction room.`, at: now }],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function createDemoState(options: { hostName?: string } = {}): RoomState {
  const now = Date.now();
  const host: Member = { id: "demo-host", name: options.hostName || "You", role: "auctioneer", teamId: null, joinedAt: now - 300000, lastSeenAt: now, flagRaisedAt: null };
  const state = createRoomState("DEMO26", "The Premier Auction", host, now - 300000);
  const names = ["Aarav", "Priya", "Anmol", "Kabir", "Riya", "Arjun", "Neha", "Dev"];
  state.members.push(...TEAM_SEEDS.map((team, index) => ({
    id: `demo-${team.id}`, name: names[index], role: "bidder" as const, teamId: team.id,
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
  const stats = input.stats || { matches: 0, runs: 0, wickets: 0, strikeRate: 0 };
  return {
    id, name: cleanText(input.name, "Player name"), country: cleanText(input.country, "Country", 50),
    role: input.role, basePrice: numberInRange(input.basePrice, "Base price", 1, 100000),
    isOverseas: input.isOverseas, status: "available", image: safeUrl(input.image, "Player image"),
    stats: {
      matches: numberInRange(stats.matches, "Matches", 0, 10000), runs: numberInRange(stats.runs, "Runs", 0, 1000000),
      wickets: numberInRange(stats.wickets, "Wickets", 0, 10000), strikeRate: numberInRange(stats.strikeRate, "Strike rate", 0, 1000, false),
    },
  };
}

function validateTeamBid(state: RoomState, team: Team, player: Player, amount: number) {
  requireCondition(team.purse >= amount, `${team.shortName} does not have enough purse remaining.`, 409, "INSUFFICIENT_PURSE");
  requireCondition(team.squad.length < state.settings.maxSquadSize, `${team.shortName}'s squad is full.`, 409, "SQUAD_FULL");
  const overseas = team.squad.filter((sale) => state.players.find((entry) => entry.id === sale.playerId)?.isOverseas).length;
  requireCondition(!player.isOverseas || overseas < state.settings.maxOverseas, `${team.shortName} has reached the overseas player limit.`, 409, "OVERSEAS_LIMIT");
}

/** Pure authoritative transition, shared with the interactive demo. Throws AuctionError on rejection. */
export function applyAction(source: RoomState, action: AuctionAction, memberId: string, now = Date.now()): RoomState {
  requireCondition(action && typeof action === "object" && typeof action.type === "string", "An action is required.");
  const state = structuredClone(source);
  const member = state.members.find((entry) => entry.id === memberId);
  requireCondition(member, "Join this room to continue.", 401, "UNAUTHORIZED");
  const hostActions = ["select_player", "start", "pause", "resume", "lock", "sell", "unsold", "add_player", "update_player", "delete_player", "update_settings"];
  if (hostActions.includes(action.type)) requireCondition(member.id === state.hostId && member.role === "auctioneer", "Only the auctioneer can do that.", 403, "FORBIDDEN");
  const player = state.players.find((entry) => entry.id === state.currentPlayerId);
  const log = (type: string, text: string) => state.activity.push({ id: `${state.version + 1}-${now}-${state.activity.length}`, type, text, at: now, memberId });
  switch (action.type) {
    case "select_player": {
      requireCondition(["waiting", "sold", "unsold"].includes(state.phase), "Close the current auction before selecting another player.", 409);
      const next = state.players.find((entry) => entry.id === action.playerId);
      requireCondition(next && next.status !== "sold", "Choose an available or unsold player.");
      next.status = "available"; state.currentPlayerId = next.id; state.currentBid = 0; state.leadingTeamId = null;
      state.lastBidAt = null; state.phase = "waiting"; log("player", `${next.name} is on the auction floor.`); break;
    }
    case "start":
      requireCondition(player && state.phase === "waiting", "Select a player before opening bidding.", 409);
      state.phase = "live"; log("auction", `Bidding is open for ${player.name}.`); break;
    case "pause":
      requireCondition(state.phase === "live", "Bidding is not live.", 409);
      state.phase = "paused"; log("auction", "The auctioneer paused bidding."); break;
    case "resume":
      requireCondition(state.phase === "paused", "Bidding is not paused.", 409);
      state.phase = "live"; log("auction", "Bidding has resumed."); break;
    case "lock":
      requireCondition(player && (state.phase === "live" || state.phase === "paused"), "There is no open bidding to lock.", 409);
      state.phase = "locked"; log("auction", "Bidding locked. No further bids are accepted."); break;
    case "sell": {
      requireCondition(player && state.phase === "locked" && state.leadingTeamId && state.currentBid > 0, "Lock a winning bid before confirming the sale.", 409);
      const team = state.teams.find((entry) => entry.id === state.leadingTeamId)!;
      requireCondition(player.status !== "sold", "This player has already been sold.", 409);
      validateTeamBid(state, team, player, state.currentBid);
      team.purse -= state.currentBid; team.squad.push({ playerId: player.id, amount: state.currentBid });
      player.status = "sold"; player.soldTo = team.id; player.soldFor = state.currentBid;
      state.phase = "sold"; log("sold", `${player.name} sold to ${team.shortName} for ${formatMoney(state.currentBid)}.`); break;
    }
    case "unsold":
      requireCondition(player && state.phase === "locked" && !state.leadingTeamId, "Lock bidding with no bids before marking a player unsold.", 409);
      player.status = "unsold"; state.phase = "unsold"; log("unsold", `${player.name} goes unsold.`); break;
    case "bid": {
      requireCondition(player && state.phase === "live", "Bidding is closed. Wait for the auctioneer to open it.", 409, "BIDDING_CLOSED");
      requireCondition(action.expectedPlayerId === player.id, "The auctioneer has moved to another player. Review the current lot before bidding.", 409, "STALE_PLAYER");
      const team = state.teams.find((entry) => entry.id === member.teamId);
      requireCondition(team, "You need a team seat to place a bid.", 403, "NO_TEAM");
      requireCondition(team.id !== state.leadingTeamId, "Your team already holds the highest bid.", 409, "ALREADY_LEADING");
      const nextAmount = getNextBid(state);
      requireCondition(action.expectedAmount === nextAmount, "Another bid arrived first. Review the updated price and bid again.", 409, "STALE_BID");
      requireCondition(state.lastBidAt === null || now - state.lastBidAt >= state.settings.bidCooldownMs, "The next bid opens in a moment.", 429, "BID_COOLDOWN");
      validateTeamBid(state, team, player, nextAmount);
      state.currentBid = nextAmount; state.leadingTeamId = team.id; state.lastBidAt = now; member.flagRaisedAt = now;
      state.bidHistory.push({ id: `bid-${state.version + 1}-${now}`, playerId: player.id, teamId: team.id, memberId, amount: nextAmount, at: now });
      log("bid", `${team.name} bid ${formatMoney(nextAmount)}.`); break;
    }
    case "add_player": {
      requireCondition(state.players.length < 500, "A room can contain up to 500 players.");
      const id = action.player?.id || `player-${now}-${state.version + 1}`;
      requireCondition(typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id), "Invalid player ID.");
      requireCondition(!state.players.some((entry) => entry.id === id), "A player with this ID already exists.", 409);
      const added = validatePlayer(action.player, id); state.players.push(added); log("pool", `${added.name} added to the player pool.`); break;
    }
    case "update_player": {
      const index = state.players.findIndex((entry) => entry.id === action.player?.id);
      requireCondition(index >= 0, "Player not found.", 404);
      requireCondition(state.players[index].status !== "sold" && action.player.id !== state.currentPlayerId, "Current and sold players cannot be edited.", 409);
      state.players[index] = { ...validatePlayer(action.player, action.player.id), status: state.players[index].status };
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
    case "raise_flag":
      member.flagRaisedAt = member.flagRaisedAt && now - member.flagRaisedAt < 10000 ? null : now;
      if (member.flagRaisedAt) log("flag", `${member.name} raised a paddle.`); break;
    case "chat": {
      const text = cleanText(action.text, "Message", 500);
      const recent = state.activity.filter((entry) => entry.type === "chat" && entry.memberId === memberId).at(-1);
      requireCondition(!recent || now - recent.at >= 1000, "Please wait a moment before sending another message.", 429);
      log("chat", text); break;
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
