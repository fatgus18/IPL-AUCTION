import type { Player } from "./auction.ts";
import type { AuctionSeasonView, SeasonPlayer, SeasonSourceRowView, SeasonTeam } from "./auction-season.ts";

export type SeasonStatRow = {
  id: string; entity: "player" | "team"; name: string; rank: number | null; value: number | null;
  teamId?: string; teamName?: string; shortName?: string; color?: string; manager?: string;
  image?: string; playerId?: string; sourceTeamName?: string; amountLakhs?: number;
  rawPoints?: number | null; weightedPoints?: number | null; detail?: string;
  coverage?: { matched: number; total: number; pending: number }; relatedNames?: string[];
  draftStatus?: "owned" | "available" | "unsold" | "unmapped" | "excluded";
};
export type SeasonStatBoard = {
  id: string; title: string; description: string; category: "overview" | "franchises" | "players" | "strategy";
  unit: "points" | "points-per-match" | "points-per-crore" | "percent" | "players" | "runs" | "wickets";
  direction: "desc" | "asc"; rows: SeasonStatRow[]; limit?: number;
};
export type SeasonAnalytics = {
  ready: boolean;
  tournament: { trackedPlayers: number; totalPoints: number | null; averagePoints: number | null; highestPlayers: SeasonStatRow[]; lowestPlayers: SeasonStatRow[] };
  /** Competition ranks 1–3. A tied position includes every tied team. */
  podium: SeasonStatRow[]; boards: SeasonStatBoard[];
  coverage: { unmappedSourcePlayers: number; sourcePlayersWithoutTeam: number };
};
type BaseSeason = Omit<AuctionSeasonView, "analytics">;
type Sum = (values: readonly number[]) => number;
const coverage = (matched: number, total: number) => ({ matched, total, pending: Math.max(0, total - matched) });
const labelKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function ranked(rows: SeasonStatRow[], direction: "desc" | "asc", limit?: number): SeasonStatRow[] {
  const sorted = rows.map(row => ({ ...row, rank: null as number | null })).sort((a, b) => {
    if (a.value === null) return b.value === null ? a.name.localeCompare(b.name) : 1;
    if (b.value === null) return -1;
    return (direction === "desc" ? b.value - a.value : a.value - b.value) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  let previous: number | null = null, rank = 0;
  sorted.forEach((row, index) => { if (row.value !== null) { if (previous !== row.value) rank = index + 1; row.rank = rank; previous = row.value; } });
  if (limit === undefined || sorted.length <= limit) return sorted;
  const boundary = sorted[limit - 1].value;
  return sorted.filter((row, index) => index < limit || (boundary !== null && row.value === boundary));
}

/** All analytics use the same public snapshot, current confirmed purchases and saved XI. */
export function deriveSeasonAnalytics(season: BaseSeason, catalog: readonly Pick<Player, "id" | "name" | "status" | "image" | "catalogArchived" | "eligibilityVerified">[], sum: Sum): SeasonAnalytics {
  const ready = !!season.snapshot && season.sourceRows.length > 0;
  const source = ready ? season.sourceRows : [];
  const byCatalogId = new Map(catalog.map(player => [player.id, player]));
  const bySourceId = new Map(source.filter(row => row.playerId).map(row => [row.playerId!, row]));
  const owners = new Map<string, { player: SeasonPlayer; team: SeasonTeam }>();
  for (const team of season.teams) for (const player of team.players) owners.set(player.id, { player, team });
  const teams = ready ? season.teams.filter(team => team.totalPlayers > 0) : [];
  const purchases = teams.flatMap(team => team.players.map(player => ({ player, team })));
  const known = (team: SeasonTeam) => team.players.filter(player => player.rawPoints !== null);
  const knownTotal = (players: SeasonPlayer[], field: "rawPoints" | "points" | "pointsPerMatch") => {
    const values = players.flatMap(player => player[field] === null ? [] : [player[field]!]);
    return values.length ? sum(values) : null;
  };
  const teamRow = (team: SeasonTeam, value: number | null, extra: Partial<SeasonStatRow> = {}): SeasonStatRow => ({
    id: team.id, entity: "team", name: team.name, rank: null, value,
    teamId: team.id, teamName: team.name, shortName: team.shortName, color: team.color, manager: team.manager,
    coverage: coverage(team.matchedPlayers, team.totalPlayers), ...extra,
  });
  const playerRow = (player: SeasonPlayer, team: SeasonTeam, value: number | null, extra: Partial<SeasonStatRow> = {}): SeasonStatRow => ({
    id: player.id, playerId: player.id, entity: "player", name: player.name, rank: null, value,
    teamId: team.id, teamName: team.name, shortName: team.shortName, color: team.color, manager: team.manager,
    ...(player.image ? { image: player.image } : {}), amountLakhs: player.amountLakhs,
    rawPoints: player.rawPoints, weightedPoints: player.points, draftStatus: "owned", ...extra,
  });
  const sourceRow = (row: SeasonSourceRowView, value: number): SeasonStatRow => {
    const owner = row.playerId ? owners.get(row.playerId) : undefined;
    const player = row.playerId ? byCatalogId.get(row.playerId) : undefined;
    const excluded = player?.catalogArchived || player?.eligibilityVerified === false;
    const draftStatus = owner ? "owned" : excluded ? "excluded" : player?.status === "available" ? "available" : player?.status === "unsold" ? "unsold" : "unmapped";
    return owner ? playerRow(owner.player, owner.team, value, { name: row.name, sourceTeamName: row.teamName ?? undefined }) : {
      id: row.key, entity: "player", name: row.name, rank: null, value, rawPoints: row.points,
      ...(player ? { playerId: player.id, image: player.image } : {}),
      sourceTeamName: row.teamName ?? undefined, draftStatus,
      detail: draftStatus === "excluded" ? "Archived or ineligible for this auction" : draftStatus === "unmapped" ? "Not matched to this room's pool" : draftStatus === "unsold" ? "Unsold in this auction" : "Available in this auction",
    };
  };
  const totalPoints = source.length ? sum(source.map(row => row.points)) : null;
  const averagePoints = totalPoints === null ? null : totalPoints / source.length;
  const rawRanking = ranked(source.map(row => sourceRow(row, row.points)), "desc");
  const lowRanking = ranked(source.map(row => sourceRow(row, row.points)), "asc");
  const boards: SeasonStatBoard[] = [];
  const add = (id: string, title: string, description: string, category: SeasonStatBoard["category"], unit: SeasonStatBoard["unit"], rows: SeasonStatRow[], direction: "desc" | "asc" = "desc", limit?: number) => {
    const board: SeasonStatBoard = { id, title, description, category, unit, direction, rows: ranked(rows, direction, limit), ...(limit === undefined ? {} : { limit }) };
    boards.push(board); return board;
  };
  const overall = add("overall", "Overall leaderboard", "Known squad points with captain ×2 and vice captain ×1.5. Partial squads show source coverage.", "overview", "points", teams.map(team => teamRow(team, team.points)));
  add("points-per-match", "Average points per match", "Sum of each purchased player's weighted points divided by their matches. Players without positive match counts stay pending.", "overview", "points-per-match", teams.map(team => teamRow(team, knownTotal(team.players, "pointsPerMatch"), { coverage: coverage(team.players.filter(player => player.pointsPerMatch !== null).length, team.totalPlayers) })));

  const franchiseAliases: Record<string, string> = { royalchallengersbangalore: "rcb", kingsxipunjab: "pbks", kxip: "pbks", delhidaredevils: "dc" };
  function franchise(name: string) {
    const key = labelKey(name);
    const team = season.teams.find(team => labelKey(team.name) === key || labelKey(team.shortName) === key || team.id === franchiseAliases[key]);
    return { key: team?.id ?? key, name: team?.name ?? name, team };
  }
  const realTeams = new Map<string, { name: string; team?: SeasonTeam; rows: SeasonSourceRowView[] }>();
  for (const row of source) if (row.teamName) {
    const real = franchise(row.teamName);
    const group = realTeams.get(real.key) ?? { name: real.name, team: real.team, rows: [] };
    group.rows.push(row); realTeams.set(real.key, group);
  }
  const realRows = [...realTeams].map(([key, group]): SeasonStatRow => ({
    id: `real:${key}`, entity: "team", name: group.name, rank: null, value: sum(group.rows.map(row => row.points)), sourceTeamName: group.name,
    ...(group.team ? { teamId: group.team.id, shortName: group.team.shortName, color: group.team.color } : {}),
    coverage: coverage(group.rows.length, group.rows.length), detail: `${group.rows.length} tracked players`,
  }));
  add("real-team-mvp", "IPL team MVP standings", "Raw source points grouped by each player's real IPL franchise, independent of auction ownership.", "franchises", "points", realRows);
  add("efficient-franchises", "Efficient franchises", "Average raw MVP points per tracked player in each real IPL franchise.", "franchises", "points", realRows.map(row => ({ ...row, value: row.value! / row.coverage!.total })));
  add("purist", "Purist leaderboard", "All purchased players' raw MVP points, without captain or vice-captain multipliers.", "strategy", "points", teams.map(team => teamRow(team, knownTotal(team.players, "rawPoints"))));
  add("franchise-loyalty", "Franchise loyalty", "Largest group of purchased players from one real IPL team. Tied franchises are shown together; missing source teams stay pending.", "strategy", "players", teams.map(team => {
    const groups = new Map<string, { name: string; count: number }>();
    let matched = 0;
    for (const player of team.players) {
      const name = bySourceId.get(player.id)?.teamName;
      if (name) { const real = franchise(name); const group = groups.get(real.key) ?? { name: real.name, count: 0 }; group.count++; matched++; groups.set(real.key, group); }
    }
    const maximum = groups.size ? Math.max(...[...groups.values()].map(group => group.count)) : null;
    const tied = [...groups.values()].filter(group => group.count === maximum).map(group => group.name).sort();
    return teamRow(team, maximum, { relatedNames: tied, detail: tied.length ? tied.join(" · ") : "Source franchise data pending", coverage: coverage(matched, team.totalPlayers) });
  }));
  const priced = purchases.filter(({ player }) => player.rawPoints !== null && player.amountLakhs > 0);
  add("best-value", "Best value signings", "Raw MVP points per crore spent. Zero-price purchases are excluded. Ties at the cut-off are included.", "players", "points-per-crore", priced.map(({ player, team }) => playerRow(player, team, player.rawPoints! / (player.amountLakhs / 100))), "desc", 10);
  add("top-mvp", "Top 20 MVP", "The highest raw MVP scores across the full source table, with verified auction owners where matched.", "players", "points", source.map(row => sourceRow(row, row.points)), "desc", 20);
  add("undrafted-gems", "Undrafted gems", "Highest raw MVP scores among verified available or unsold pool players. Unmapped source names are excluded.", "players", "points", source.map(row => sourceRow(row, row.points)).filter(row => row.draftStatus === "available" || row.draftStatus === "unsold"), "desc", 5);
  add("captains", "Captains leaderboard", "The saved captain's weighted points. Missing captain selections or source scores remain pending.", "strategy", "points", teams.map(team => {
    const captain = team.players.find(player => player.captain);
    return captain ? playerRow(captain, team, captain.points, { coverage: coverage(captain.points === null ? 0 : 1, 1) }) : teamRow(team, null, { detail: "Captain not selected", coverage: coverage(0, 1) });
  }));
  add("dead-weight", "Dead weight", "Purchased players with known zero or negative raw points. Unmatched players are counted separately as pending.", "strategy", "players", teams.map(team => teamRow(team, team.matchedPlayers ? known(team).filter(player => player.rawPoints! <= 0).length : null)));
  add("hardest-carry", "Hardest carry", "Each squad's leading weighted scorer as a share of its positive known weighted total. Negative teammates can push the share above 100%.", "strategy", "percent", teams.flatMap(team => {
    const scored = team.players.filter(player => player.points !== null);
    if (!scored.length || team.points === null || team.points <= 0) return [teamRow(team, null, { detail: "Requires a positive known squad total" })];
    const top = Math.max(...scored.map(player => player.points!));
    return scored.filter(player => player.points === top).map(player => playerRow(player, team, player.points! / team.points! * 100, { coverage: coverage(team.matchedPlayers, team.totalPlayers) }));
  }));
  add("dynamic-duo", "The dynamic duo", "Combined weighted points of the saved captain and vice captain. Both selections and source scores are required.", "strategy", "points", teams.map(team => {
    const duo = team.players.filter(player => player.captain || player.viceCaptain);
    const matched = duo.filter(player => player.points !== null).length;
    return teamRow(team, duo.length === 2 && matched === 2 ? sum(duo.map(player => player.points!)) : null, { relatedNames: duo.map(player => player.name), coverage: coverage(matched, 2), detail: matched === 2 ? "Captain + vice captain" : "Captain or vice-captain selection/points pending" });
  }));
  add("roster-depth", "Roster depth", "Known points from purchased players excluding the saved captain and vice captain. Both leadership selections must be saved first.", "strategy", "points", teams.map(team => {
    const leadership = team.players.filter(player => player.captain || player.viceCaptain);
    const rest = team.players.filter(player => !player.captain && !player.viceCaptain);
    const matched = rest.filter(player => player.points !== null).length;
    return teamRow(team, leadership.length !== 2 ? null : rest.length === 0 ? 0 : knownTotal(rest, "points"), { coverage: coverage(matched, rest.length), ...(leadership.length !== 2 ? { detail: "Captain and vice captain must be selected" } : {}) });
  }));
  add("worst-value", "Worst value signings", "Lowest raw MVP points per crore among signings costing at least ₹2 Cr. Negative returns remain negative.", "players", "points-per-crore", priced.filter(({ player }) => player.amountLakhs >= 200).map(({ player, team }) => playerRow(player, team, player.rawPoints! / (player.amountLakhs / 100))), "asc", 5);
  add("orange-cap", "Orange cap", "Top run scorers across the full source table. Only known, positive run totals qualify.", "players", "runs", source.filter(row => row.runs !== null && row.runs > 0).map(row => sourceRow(row, row.runs!)), "desc", 10);
  add("purple-cap", "Purple cap", "Top wicket takers across the full source table. Only known, positive wicket totals qualify.", "players", "wickets", source.filter(row => row.wickets !== null && row.wickets > 0).map(row => sourceRow(row, row.wickets!)), "desc", 10);
  add("captaincy-regret", "Captaincy regret", "Known best raw squad score minus the saved captain's raw score, floored at zero. This is a captain-only comparison, not an optimal XI calculation.", "strategy", "points", teams.map(team => {
    const captain = team.players.find(player => player.captain);
    const scored = known(team);
    if (!captain || captain.rawPoints === null || !scored.length) return teamRow(team, null, { detail: "Captain selection or source score pending" });
    const best = Math.max(...scored.map(player => player.rawPoints!));
    return teamRow(team, Math.max(0, sum([best, -captain.rawPoints])), { relatedNames: scored.filter(player => player.rawPoints === best).map(player => player.name), detail: `Compared with ${captain.name}'s raw points` });
  }));
  add("heavy-top-order", "Heavy top order", "Raw points from the saved XI's actual positions 1–3 divided by a positive known raw squad total. Empty or unmatched top positions remain pending.", "strategy", "percent", teams.map(team => {
    const top = [1, 2, 3].map(position => team.players.find(player => player.selection === "Playing XI" && player.position === position));
    const matched = top.filter(player => player && player.rawPoints !== null).length;
    const denominator = knownTotal(team.players, "rawPoints");
    const valid = matched === 3 && denominator !== null && denominator > 0;
    return teamRow(team, valid ? sum(top.map(player => player!.rawPoints!)) / denominator! * 100 : null, { relatedNames: top.flatMap(player => player ? [player.name] : []), coverage: coverage(matched, 3), detail: matched < 3 ? "Positions 1–3 must be assigned and matched" : denominator === null || denominator <= 0 ? "Requires a positive known raw squad total" : `${team.matchedPlayers}/${team.totalPlayers} squad scores known` });
  }));
  add("expensive-duds", "Expensive duds", "The five lowest non-negative raw MVP scores among purchases costing at least ₹5 Cr. Unknown and negative scores are excluded.", "players", "points", priced.filter(({ player }) => player.amountLakhs >= 500 && player.rawPoints! >= 0).map(({ player, team }) => playerRow(player, team, player.rawPoints!)), "asc", 5);

  return {
    ready,
    tournament: { trackedPlayers: source.length, totalPoints, averagePoints, highestPlayers: rawRanking.filter(row => row.value === rawRanking[0]?.value), lowestPlayers: lowRanking.filter(row => row.value === lowRanking[0]?.value) },
    podium: overall.rows.filter(row => row.rank !== null && row.rank <= 3), boards,
    coverage: { unmappedSourcePlayers: source.filter(row => !row.playerId).length, sourcePlayersWithoutTeam: source.filter(row => !row.teamName).length },
  };
}
