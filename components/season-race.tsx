"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, CircleHelp, Crown, Flag, History, Minus, TrendingUp } from "lucide-react";
import type { SeasonRaceHistory, SeasonRaceCheckpointView } from "@/lib/season-race";
import { TeamCrest } from "./ipl-visuals";
import "./season-race.css";

type Props = { history: SeasonRaceHistory; ownTeamId?: string };
type Metric = "points" | "rank";
const precise = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const short = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const number = (value: number | null | undefined) => value == null ? "—" : precise.format(value);
const signed = (value: number | null | undefined) => value == null ? "—" : `${value > 0 ? "+" : ""}${precise.format(value)}`;
const when = (value: number | string, compact = false) => new Date(value).toLocaleString("en-IN", compact ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const method = (point: SeasonRaceCheckpointView) => point.reason === "map" ? "Player matching updated" : point.reason === "reference" ? "Verified snapshot loaded" : point.reason === "import" ? "Points table imported" : "Source refreshed";

/** A small SVG renders saved public checkpoints. Interaction never refetches a source. */
export function SeasonRaceTimeline({ history, ownTeamId }: Props) {
  const id = useId();
  const [metric, setMetric] = useState<Metric>("points");
  const [segment, setSegment] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<string | null>(ownTeamId ?? null);
  const segments = [...new Map(history.checkpoints.map(point => [point.segmentId, point])).values()];
  const segmentId = segments.some(point => point.segmentId === segment) ? segment : history.currentSegmentId;
  const records = history.checkpoints.filter(point => point.segmentId === segmentId);
  const storedIndex = records.findIndex(point => point.id === selectedId);
  const selectedIndex = storedIndex >= 0 ? storedIndex : records.length - 1;
  const index = hoverIndex !== null && hoverIndex < records.length ? hoverIndex : selectedIndex;
  const current = records[index];
  const teams = [...new Map(records.flatMap(point => point.teams.filter(team => team.totalPlayers > 0).map(team => [team.id, team] as const))).values()];
  const focusId = teams.some(team => team.id === highlight) ? highlight : null;
  const rows = current?.teams.filter(team => team.totalPlayers > 0).toSorted((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name)) ?? [];
  const leaders = rows.filter(team => team.rank === 1);
  const climb = current?.teamChanges.filter(change => (change.rankDelta ?? 0) > 0).toSorted((a, b) => b.rankDelta! - a.rankDelta!)[0];
  const gain = current?.teamChanges.filter(change => (change.pointsDelta ?? 0) !== 0).toSorted((a, b) => Math.abs(b.pointsDelta!) - Math.abs(a.pointsDelta!))[0];
  const climbTeam = rows.find(team => team.id === climb?.teamId);
  const gainTeam = rows.find(team => team.id === gain?.teamId);
  const selectedTeam = rows.find(team => team.id === focusId);
  const change = current?.teamChanges.find(entry => entry.teamId === focusId);

  function choose(next: number) { setHoverIndex(null); setSelectedId(records[next]?.id ?? null); }

  return <section className="season-race" aria-labelledby={`${id}-title`}>
    <header className="race-heading"><div><span className="race-kicker"><History size={16}/>THE LONG GAME</span><h2 id={`${id}-title`}>The season <em>race.</em></h2><p>Every update. Every lead change. Your season, in motion.</p></div><span className="race-record-count"><i/>{history.totalCheckpoints} {history.totalCheckpoints === 1 ? "checkpoint" : "checkpoints"}</span></header>
    {!current ? <div className="race-empty"><span><Flag size={36} strokeWidth={1.1}/></span><div><h3>Every race has a starting line.</h3><p>Your next successful points update records the first checkpoint. Future updates reveal how the season unfolds.</p></div></div> : <>
      <div className="race-toolbar"><div className="race-metric-toggle" role="group" aria-label="Timeline metric"><button type="button" aria-pressed={metric === "points"} onClick={() => setMetric("points")}><TrendingUp size={16}/>Points</button><button type="button" aria-pressed={metric === "rank"} onClick={() => setMetric("rank")}><Crown size={16}/>Position</button></div><div className="race-series">{segments.length > 1 ? <label><span>Recorded series</span><select aria-label="Timeline series" value={segmentId ?? ""} onChange={event => { setSegment(event.target.value); setSelectedId(null); setHoverIndex(null); }}>{segments.map(point => <option key={point.segmentId} value={point.segmentId}>{point.seriesName || "Points source"} · #{history.checkpoints.find(entry => entry.segmentId === point.segmentId)?.sequence}</option>)}</select></label> : <span>{current.seriesName || "Season points"}</span>}</div></div>
      <div className="race-highlights">
        <div><Crown size={18}/><span>In front<strong>{leaders.length ? leaders.map(team => team.shortName).join(" / ") : "Awaiting scores"}</strong><small>{leaders.length > 1 ? "Shared lead" : leaders[0] ? `${number(leaders[0].points)} points` : "No ranked franchise yet"}</small></span></div>
        <div><ArrowUpRight size={20}/><span>Biggest climb<strong>{climbTeam ? <>{climbTeam.shortName}<b>↑ {climb?.rankDelta}</b></> : "—"}</strong><small>{current.previousCheckpointId ? climbTeam ? "places since last checkpoint" : "No position gains" : "Opening checkpoint"}</small></span></div>
        <div><TrendingUp size={19}/><span>Largest points change<strong>{gainTeam ? <>{gainTeam.shortName}<b className={(gain?.pointsDelta ?? 0) < 0 ? "race-negative" : ""}>{signed(gain?.pointsDelta)}</b></> : "—"}</strong><small>{gain && (gain.squadChanged || gain.captaincyChanged || gain.coverageChanged) ? "Includes team or scoring changes" : "Since previous checkpoint"}</small></span></div>
      </div>
      <div className="race-content">
        <div className="race-plot-panel">
          <div className="race-plot-label"><span>{metric === "points" ? "CUMULATIVE POINTS" : "FRANCHISE POSITION"}</span><span>{records.length === 1 ? "First checkpoint recorded" : `${records.length} recorded updates`}</span></div>
          <RaceChart records={records} teams={teams} index={index} metric={metric} focusId={focusId} onHover={setHoverIndex} onChoose={choose}/>
          <div className="race-legend" role="group" aria-label="Highlight a franchise"><button type="button" aria-pressed={focusId === null} onClick={() => setHighlight(null)}>All teams</button>{teams.map(team => <button type="button" key={team.id} aria-pressed={focusId === team.id} onClick={() => setHighlight(focusId === team.id ? null : team.id)} style={{ "--race-team": team.color } as CSSProperties}><i/>{team.shortName}{team.id === ownTeamId && <span>YOU</span>}</button>)}</div>
          <div className="race-playhead"><button type="button" aria-label="Previous checkpoint" disabled={selectedIndex <= 0} onClick={() => choose(selectedIndex - 1)}><ChevronLeft size={19}/></button><div><div><label htmlFor={`${id}-range`}>Checkpoint {current.sequence}</label><time dateTime={new Date(current.recordedAt).toISOString()}>{when(current.recordedAt)}</time></div><input id={`${id}-range`} type="range" min={0} max={Math.max(0, records.length - 1)} value={selectedIndex} disabled={records.length < 2} onChange={event => choose(Number(event.target.value))} aria-label="Season checkpoint" aria-valuetext={`Checkpoint ${records[selectedIndex]?.sequence}, ${when(records[selectedIndex]?.recordedAt ?? 0)}`}/></div><button type="button" aria-label="Next checkpoint" disabled={selectedIndex >= records.length - 1} onClick={() => choose(selectedIndex + 1)}><ChevronRight size={19}/></button></div>
          <div className="race-capture-note"><span>{method(current)}{current.provisional ? " · Provisional squads" : ""}</span><span>Source captured {when(current.sourceCapturedAt)}</span></div>
        </div>
        <aside className="race-snapshot" aria-label="Standings at selected checkpoint">
          <div className="race-snapshot-heading"><span>AT THIS MOMENT</span><b>#{String(current.sequence).padStart(2, "0")}</b></div>
          {rows.length ? <ol>{rows.map(team => { const movement = current.teamChanges.find(entry => entry.teamId === team.id); return <li key={team.id}><button type="button" onClick={() => setHighlight(focusId === team.id ? null : team.id)} aria-label={`Highlight ${team.name} in timeline`} aria-pressed={focusId === team.id} style={{ "--race-team": team.color } as CSSProperties}><span className="race-row-rank">{team.rank ?? "—"}</span><TeamCrest team={team}/><span className="race-row-name"><strong>{team.shortName}</strong><small>{team.manager}</small>{!team.complete && <small className="race-row-coverage">{team.matchedPlayers}/{team.totalPlayers} scores known</small>}</span><span className="race-row-total"><strong title={team.points == null ? "Points pending" : String(team.points)}>{number(team.points)}</strong><small className={(movement?.pointsDelta ?? 0) < 0 ? "race-negative" : ""}>{movement?.pointsDelta == null ? team.complete ? "points" : `${team.matchedPlayers}/${team.totalPlayers} matched` : signed(movement.pointsDelta)}</small></span><span className={`race-row-move${(movement?.rankDelta ?? 0) > 0 ? " is-up" : (movement?.rankDelta ?? 0) < 0 ? " is-down" : ""}`} aria-label={movement?.rankDelta == null ? "No comparison" : movement.rankDelta === 0 ? "Position unchanged" : `${Math.abs(movement.rankDelta)} places ${movement.rankDelta > 0 ? "up" : "down"}`}>{movement?.rankDelta ? <>{movement.rankDelta > 0 ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>}<span>{Math.abs(movement.rankDelta)}</span></> : <Minus size={13}/>}</span></button></li>; })}</ol> : <p className="race-no-squads">Standings appear after the first confirmed signing.</p>}
          {selectedTeam && <div className="race-team-detail"><strong>{selectedTeam.name}</strong><span>C · {selectedTeam.captainName ?? "Not selected"}</span><span>VC · {selectedTeam.viceCaptainName ?? "Not selected"}</span><small>{selectedTeam.matchedPlayers}/{selectedTeam.totalPlayers} scores known{change?.captaincyChanged ? " · Captaincy changed" : ""}{change?.squadChanged ? " · Squad changed" : ""}{change?.coverageChanged ? " · Coverage changed" : ""}</small></div>}
        </aside>
      </div>
      {!!current.overtakes.length && <div className="race-overtakes" aria-label="Overtakes at selected checkpoint"><Flag size={16}/><span>{current.overtakes.slice(0, 3).map((move, index) => <span key={`${move.teamId}:${move.passedTeamId}`}>{index > 0 && <i>·</i>}<strong>{rows.find(team => team.id === move.teamId)?.shortName}</strong><ArrowRight size={13}/>{rows.find(team => team.id === move.passedTeamId)?.shortName}</span>)}{current.overtakes.length > 3 && <small>+{current.overtakes.length - 3} more overtakes</small>}</span></div>}
      {(history.currentTeamsChanged || current.comparisonGap || history.omittedCheckpoints > 0) && <p className="race-context-note"><CircleHelp size={15}/><span>{history.currentTeamsChanged ? "Squads or captaincy have changed since the latest checkpoint. The next points update records those changes. " : ""}{current.comparisonGap ? "Earlier checkpoints were trimmed; no change is calculated across this gap. " : ""}{history.omittedCheckpoints > 0 ? `${history.omittedCheckpoints} earlier checkpoints were trimmed. The first and latest ${history.limit - 1} are retained.` : ""}</span></p>}
      <p className="race-history-note"><History size={14}/>Scores and captaincy are preserved as recorded. Source, squad and captaincy updates can all change standings.</p>
    </>}
  </section>;
}

function RaceChart({ records, teams, index, metric, focusId, onHover, onChoose }: {
  records: SeasonRaceCheckpointView[]; teams: SeasonRaceCheckpointView["teams"]; index: number; metric: Metric;
  focusId: string | null; onHover: (index: number | null) => void; onChoose: (index: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => setWidth(Math.max(240, Math.round(svg.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const height = 300, left = width < 420 ? 44 : 58, right = width < 420 ? 21 : 30, top = 22, bottom = 36;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = records.flatMap(point => point.teams.flatMap(team => team[metric] == null ? [] : [team[metric]!]));
  const maximum = metric === "rank" ? Math.max(2, ...values) : Math.max(0, ...values);
  const minimum = metric === "rank" ? 1 : Math.min(0, ...values);
  const padding = metric === "rank" ? 0 : Math.max(1, maximum - minimum) * .12;
  const low = minimum - padding, high = maximum + padding;
  const x = (item: number) => records.length < 2 ? left + plotWidth / 2 : left + item / (records.length - 1) * plotWidth;
  const y = (value: number) => top + (metric === "rank" ? (value - low) / (high - low) : (high - value) / (high - low)) * plotHeight;
  const ticks = metric === "rank" ? [...new Set([1, Math.ceil(maximum / 2), maximum])] : Array.from({ length: 5 }, (_, tick) => low + (high - low) * tick / 4);
  const dates = [...new Set([0, Math.floor((records.length - 1) / 2), records.length - 1])];
  function atPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(records.length - 1, Math.round(((event.clientX - rect.left) / rect.width * width - left) / plotWidth * (records.length - 1))));
  }
  return <svg ref={svgRef} className="race-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric === "rank" ? "Position" : "Points"} history across ${records.length} recorded checkpoints. Use the checkpoint slider to explore exact standings.`} onPointerMove={event => { if (event.pointerType === "mouse") onHover(atPointer(event)); }} onPointerLeave={() => onHover(null)} onPointerDown={event => onChoose(atPointer(event))}>
    {ticks.map((tick, i) => <g key={i} className="race-grid"><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)}/><text x={left - 15} y={y(tick) + 4} textAnchor="end">{metric === "rank" ? `#${tick}` : short.format(tick)}</text></g>)}
    {dates.map(item => <text className="race-axis-date" key={item} x={x(item)} y={height - 8} textAnchor="middle">{when(records[item].recordedAt, true)}</text>)}
    {teams.map(team => {
      let path = "", previous: number | null = null;
      records.forEach((point, i) => {
        const value = point.teams.find(entry => entry.id === team.id)?.[metric];
        if (value == null) { previous = null; return; }
        path += `${previous === null || point.comparisonGap ? "M" : "L"}${x(i).toFixed(2)} ${y(value).toFixed(2)} `;
        previous = i;
      });
      const value = records[index].teams.find(entry => entry.id === team.id)?.[metric];
      return <g key={team.id} className={`race-series-path${focusId && team.id !== focusId ? " is-muted" : ""}`} style={{ color: team.color }}><path d={path} stroke="currentColor" strokeWidth={focusId === team.id ? 3.5 : 2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>{value != null && <><circle cx={x(index)} cy={y(value)} r={focusId === team.id ? 10 : 6} fill="currentColor" opacity=".13"/><circle cx={x(index)} cy={y(value)} r={focusId === team.id ? 4.8 : 3.8} fill="currentColor" stroke="#0a111a" strokeWidth="2"/></>}</g>;
    })}
    <line className="race-crosshair" x1={x(index)} x2={x(index)} y1={top} y2={height - bottom}/>
    {!values.length && <text x={width / 2} y={height / 2} className="race-chart-empty" textAnchor="middle">Waiting for matched squad points</text>}
  </svg>;
}
