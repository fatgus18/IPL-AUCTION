"use client";

import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowUpRight, ChartNoAxesCombined, Coins, Crown, Medal, ShieldCheck, Sparkles, Trophy, UsersRound } from "lucide-react";
import type { SeasonTeam } from "@/lib/auction-season";
import type { SeasonAnalytics as SeasonAnalyticsData, SeasonStatBoard, SeasonStatRow } from "@/lib/season-analytics";
import { formatMoney } from "@/lib/auction-display";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import "./season-analytics.css";

type GroupKey = "tournament" | "squad" | "value";
type Props = { analytics: SeasonAnalyticsData; teams: SeasonTeam[]; ownTeamId?: string; onTeamSelect: (teamId: string) => void };
type CrestTeam = Pick<SeasonTeam, "id" | "name" | "shortName" | "color">;
const GROUPS = [
  { key: "tournament", label: "Tournament", icon: Trophy, boards: ["top-mvp", "orange-cap", "purple-cap", "real-team-mvp", "efficient-franchises", "undrafted-gems"] },
  { key: "squad", label: "Squad analysis", icon: UsersRound, boards: ["overall", "points-per-match", "purist", "captains", "dynamic-duo", "roster-depth", "franchise-loyalty", "dead-weight", "hardest-carry", "captaincy-regret", "heavy-top-order"] },
  { key: "value", label: "Auction value", icon: Coins, boards: ["best-value", "worst-value", "expensive-duds"] },
] as const;
const fullNumber = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 7 });
const rateNumber = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const formatNumber = (value: number | null | undefined) => value == null ? "—" : fullNumber.format(value);
const numberSizing = (text: string): CSSProperties => ({
  "--sa-number-mobile": `${Math.min(24, (text.length > 13 ? 360 : 210) / Math.max(1, text.length))}px`,
  "--sa-podium-mobile": `${Math.min(28, (text.length > 13 ? 420 : 240) / Math.max(1, text.length))}px`,
} as CSSProperties);
const UNIT_LABELS: Record<SeasonStatBoard["unit"], string> = {
  points: "points", "points-per-match": "pts / match", "points-per-crore": "pts / crore", percent: "share", players: "players", runs: "runs", wickets: "wickets",
};
const boardValue = (value: number | null, unit: SeasonStatBoard["unit"]) => value === null ? "—" : unit === "percent" ? `${rateNumber.format(value)}%` : unit === "points-per-match" || unit === "points-per-crore" ? rateNumber.format(value) : fullNumber.format(value);
const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** These boards render the server's verified calculations; switching views never fetches a source. */
export function SeasonAnalytics({ analytics, teams, ownTeamId, onTeamSelect }: Props) {
  const prefix = useId();
  const [groupKey, setGroupKey] = useState<GroupKey>("tournament");
  const [selections, setSelections] = useState<Record<GroupKey, string>>({ tournament: "top-mvp", squad: "overall", value: "best-value" });
  const group = GROUPS.find(entry => entry.key === groupKey)!;
  const boards = group.boards.flatMap(id => analytics.boards.find(board => board.id === id) ?? []);
  const selected = boards.find(board => board.id === selections[groupKey]) ?? boards[0];
  const teamsById = useMemo(() => new Map(teams.map(team => [team.id, team])), [teams]);

  function changeGroup(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % GROUPS.length;
    else if (event.key === "ArrowLeft") next = (index + GROUPS.length - 1) % GROUPS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = GROUPS.length - 1;
    else return;
    event.preventDefault(); setGroupKey(GROUPS[next].key);
    document.getElementById(`${prefix}-${GROUPS[next].key}`)?.focus();
  }

  return <section className="season-analytics" aria-labelledby={`${prefix}-heading`}>
    <header className="sa-heading"><div><span className="season-eyebrow"><ChartNoAxesCombined size={16}/>BEYOND THE SCORE</span><h2 id={`${prefix}-heading`}>Season intelligence<span>.</span></h2><p>The tournament, your squad and every rupee spent.</p></div><span className="sa-board-count"><Sparkles size={17}/>{analytics.boards.length} perspectives</span></header>
    {!analytics.ready ? <div className="sa-empty"><ChartNoAxesCombined size={35} strokeWidth={1.2}/><h3>The numbers start here.</h3><p>Fetch or import a source above to explore tournament leaders, squad performance and auction value.</p></div> : <>
      <div className="sa-tabs" role="tablist" aria-label="Season statistics categories">{GROUPS.map((entry, index) => { const Icon = entry.icon; return <button key={entry.key} id={`${prefix}-${entry.key}`} role="tab" aria-selected={groupKey === entry.key} aria-controls={`${prefix}-panel`} tabIndex={groupKey === entry.key ? 0 : -1} onKeyDown={event => changeGroup(event, index)} onClick={() => setGroupKey(entry.key)}><Icon size={19}/><span>{entry.label}</span><b>{entry.boards.length}</b></button>; })}</div>
      <div className="sa-panel" id={`${prefix}-panel`} role="tabpanel" aria-labelledby={`${prefix}-${groupKey}`}>
        {groupKey === "tournament" && <TournamentSummary analytics={analytics} teams={teams}/>}
        {groupKey === "squad" && <SeasonPodium rows={analytics.podium} teamsById={teamsById} onTeamSelect={onTeamSelect}/>}
        <div className="sa-board-choices" role="group" aria-label={`${group.label} statistics`}>{boards.map(board => <button key={board.id} type="button" aria-pressed={selected?.id === board.id} data-board={board.id} onClick={() => setSelections(previous => ({ ...previous, [groupKey]: board.id }))}>{board.title}</button>)}</div>
        {selected && <StatsBoard key={selected.id} board={selected} teams={teams} ownTeamId={ownTeamId} onTeamSelect={onTeamSelect}/>}
        <div className="sa-method-note"><ShieldCheck size={16}/><span>Missing data stays pending. Rankings use known values and include negative points.{groupKey === "tournament" && analytics.coverage.unmappedSourcePlayers > 0 ? ` ${analytics.coverage.unmappedSourcePlayers} source players are not linked to the pool.` : ""}{(selected?.id === "real-team-mvp" || selected?.id === "efficient-franchises" || selected?.id === "franchise-loyalty") && analytics.coverage.sourcePlayersWithoutTeam > 0 ? ` ${analytics.coverage.sourcePlayersWithoutTeam} source entries have no confirmed IPL franchise.` : ""}</span></div>
      </div>
    </>}
  </section>;
}

function TournamentSummary({ analytics, teams }: { analytics: SeasonAnalyticsData; teams: SeasonTeam[] }) {
  const { tournament } = analytics;
  return <section className="sa-tournament-summary" aria-label="Tournament stats">
    <div className="sa-tournament-metrics"><div><span>Tracked players</span><strong>{formatNumber(tournament.trackedPlayers)}</strong></div><div><span>Total MVP points</span><strong style={numberSizing(formatNumber(tournament.totalPoints))}>{formatNumber(tournament.totalPoints)}</strong></div><div><span>Average per player</span><strong>{tournament.averagePoints === null ? "—" : rateNumber.format(tournament.averagePoints)}</strong></div></div>
    <div className="sa-extremes"><ExtremePlayers label="Highest MVP" rows={tournament.highestPlayers} teams={teams}/><ExtremePlayers label="Lowest MVP" rows={tournament.lowestPlayers} teams={teams} low/></div>
  </section>;
}

function ExtremePlayers({ label, rows, teams, low = false }: { label: string; rows: SeasonStatRow[]; teams: SeasonTeam[]; low?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 3);
  return <div className={`sa-extreme${low ? " is-low" : ""}`}><span className="sa-extreme-label">{label}{rows.length > 1 ? " · tied" : ""}</span>{visible.length ? visible.map(row => <div key={row.id} className="sa-extreme-player"><StatAvatar row={row} teams={teams}/><span><strong>{row.name}</strong><small>{row.sourceTeamName ? `IPL · ${row.sourceTeamName}` : "Source leader"}</small></span><b className={(row.value ?? 0) < 0 ? "sa-negative" : ""}>{formatNumber(row.value)}</b></div>) : <p>Not available in this source.</p>}{rows.length > 3 && <button className="sa-more-ties" onClick={() => setExpanded(previous => !previous)}>{expanded ? "Show fewer players" : `Show all ${rows.length} tied players`}</button>}</div>;
}

function SeasonPodium({ rows, teamsById, onTeamSelect }: { rows: SeasonStatRow[]; teamsById: Map<string, SeasonTeam>; onTeamSelect: (id: string) => void }) {
  const places = [1, 2, 3].map(rank => ({ rank, teams: rows.filter(row => row.rank === rank) })).filter(place => place.teams.length > 0);
  if (!places.length) return null;
  return <section className="sa-podium" aria-label="Season podium" style={{ "--sa-podium-columns": places.length } as CSSProperties}>{places.map(place => <div className={`sa-podium-place sa-place-${place.rank}`} key={place.rank}><div className="sa-podium-rank">{place.rank === 1 ? <Crown size={20}/> : <Medal size={20}/>}<span>{place.rank === 1 ? "First" : place.rank === 2 ? "Second" : "Third"} place{place.teams.length > 1 ? " · tied" : ""}</span></div>{place.teams.map(row => { const team = teamsById.get(row.teamId ?? row.id); const score = formatNumber(row.value); return <button className={`sa-podium-team${score.length > 13 ? " has-long-score" : ""}`} key={row.id} disabled={!team} onClick={() => team && onTeamSelect(team.id)} style={{ "--sa-accent": row.color ?? team?.color ?? "#e6c48a", ...numberSizing(score) } as CSSProperties}>{team && <TeamCrest team={team}/>}<span><strong>{row.name}</strong><small>{row.manager ?? team?.manager}</small></span><b>{score}<small>points{row.coverage?.pending ? " · partial" : ""}</small></b></button>; })}</div>)}</section>;
}

function teamForRow(row: SeasonStatRow, teams: SeasonTeam[]): CrestTeam | undefined {
  const id = row.teamId ?? (row.entity === "team" ? row.id : "");
  const known = teams.find(team => team.id === id);
  if (known) return known;
  if (row.entity !== "team") return undefined;
  const names = [row.name, row.shortName, row.sourceTeamName].filter((name): name is string => !!name).map(normalized);
  return teams.find(team => names.includes(normalized(team.name)) || names.includes(normalized(team.shortName)));
}

function StatAvatar({ row, teams }: { row: SeasonStatRow; teams: SeasonTeam[] }) {
  const team = teamForRow(row, teams);
  return <span className={`sa-row-avatar${row.entity === "team" ? " is-team" : ""}`} aria-hidden="true">{row.entity === "player" ? <PlayerImage player={{ id: row.playerId ?? row.id, name: row.name, image: row.image }}/> : team ? <TeamCrest team={team}/> : <span className="sa-text-crest">{row.shortName ?? row.name.slice(0, 3).toUpperCase()}</span>}</span>;
}

function StatsBoard({ board, teams, ownTeamId, onTeamSelect }: { board: SeasonStatBoard; teams: SeasonTeam[]; ownTeamId?: string; onTeamSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const unit = UNIT_LABELS[board.unit];
  const maxValue = Math.max(1, ...board.rows.map(row => Math.abs(row.value ?? 0)));
  const initialLimit = board.limit ?? 12;
  const visibleRows = expanded ? board.rows : board.rows.slice(0, initialLimit);
  return <section className="sa-board" aria-label={board.title} data-board-id={board.id}>
    <header className="sa-board-heading"><div><h3>{board.title}</h3><p>{board.description}</p></div><span className="sa-unit">{unit}</span></header>
    {board.rows.length ? <ol className={`sa-leader-list${visibleRows.length > 5 ? " is-split" : ""}`} aria-label={`${board.title} rankings`}>{visibleRows.map(row => {
      const ownedTeam = row.teamId ? teams.find(team => team.id === row.teamId) : undefined;
      const canOpen = !!ownedTeam && (row.entity === "player" || board.id !== "real-team-mvp" && board.id !== "efficient-franchises");
      const isOwn = canOpen && row.teamId === ownTeamId;
      const showPrice = row.amountLakhs !== undefined && (board.unit === "points-per-crore" || board.id === "expensive-duds");
      const realFranchiseBoard = board.id === "real-team-mvp" || board.id === "efficient-franchises";
      const subline = row.entity === "player"
        ? ownedTeam ? [ownedTeam.shortName, row.manager && row.manager !== "No manager assigned" ? row.manager : null].filter(Boolean).join(" · ") : row.sourceTeamName ? `IPL · ${row.sourceTeamName}` : null
        : realFranchiseBoard ? "Real IPL franchise" : row.manager && row.manager !== "No manager assigned" ? row.manager : row.sourceTeamName;
      const status = row.draftStatus === "available" ? "Available" : row.draftStatus === "unsold" ? "Unsold" : row.draftStatus === "unmapped" ? "Not linked to pool" : row.draftStatus === "excluded" ? "Not eligible" : null;
      const score = boardValue(row.value, board.unit);
      const identity = <><strong>{row.name}{isOwn && <b className="sa-you">YOU</b>}</strong>{subline && <small>{subline}</small>}</>;
      return <li key={row.id} className={`sa-leader-row${isOwn ? " is-own" : ""}${row.value === null ? " is-pending" : ""}${score.length > 13 ? " has-long-score" : ""}`} style={{ "--sa-accent": row.color ?? ownedTeam?.color ?? "#d6b57c", "--sa-meter": `${Math.min(100, Math.abs(row.value ?? 0) / maxValue * 100)}%`, ...numberSizing(score) } as CSSProperties}>
        <span className="sa-rank">{row.rank === null ? "—" : String(row.rank).padStart(2, "0")}</span><StatAvatar row={row} teams={teams}/>
        <div className="sa-row-copy">{canOpen ? <button className="sa-identity" onClick={() => onTeamSelect(ownedTeam.id)} aria-label={`View ${ownedTeam.name} squad for ${row.name}`}>{identity}<ArrowUpRight size={13}/></button> : <div className="sa-identity">{identity}</div>}
          {(status || row.coverage?.pending || showPrice) ? <span className="sa-row-tags">{status && <span>{status}</span>}{row.coverage?.pending ? <span className="sa-partial">{row.coverage.matched}/{row.coverage.total} known</span> : null}{showPrice && <span>{formatMoney(row.amountLakhs!)}</span>}</span> : null}
          {row.detail && !status && row.detail !== row.relatedNames?.join(" · ") && <p className="sa-row-detail">{row.detail}</p>}{row.relatedNames?.length ? <p className="sa-row-related">{board.id === "franchise-loyalty" ? "IPL · " : ""}{row.relatedNames.join(" · ")}</p> : null}
        </div>
        <div className={`sa-row-value${(row.value ?? 0) < 0 ? " sa-negative" : ""}`} title={row.value === null ? "No confirmed value" : `${row.value} ${unit}`}><strong>{score}</strong><small>{row.value === null ? "Pending" : unit}</small></div>
        <i className="sa-row-meter" aria-hidden="true"/>
      </li>;
    })}</ol> : <div className="sa-board-empty"><ChartNoAxesCombined size={30} strokeWidth={1.2}/><h4>No qualifying entries yet</h4><p>This board appears when the saved source and squad selections meet its criteria.</p></div>}
    {board.rows.length > initialLimit && <button className="sa-more-results" onClick={() => setExpanded(previous => !previous)}>{expanded ? "Show fewer entries" : `Show all ${board.rows.length} entries`}</button>}
  </section>;
}
