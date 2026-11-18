"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, Crown, Scale, Users, Wallet } from "lucide-react";
import type { RoomState } from "@/lib/auction";
import { formatMoney } from "@/lib/auction-display";
import { summarizeSquad } from "@/lib/squad-summary";
import { TeamCrest } from "./ipl-visuals";
import "./squad-comparison.css";

type Summary = ReturnType<typeof summarizeSquad>;

export function SquadComparison({ state, onViewSquad }: { state: RoomState; onViewSquad: (teamId: string) => void }) {
  const [selection, setSelection] = useState(() => [state.teams[0]?.id, state.teams[1]?.id]);
  const left = state.teams.find(team => team.id === selection[0]) ?? state.teams[0];
  const right = state.teams.find(team => team.id === selection[1] && team.id !== left?.id) ?? state.teams.find(team => team.id !== left?.id);
  const id = useId();
  if (!left || !right) return <div className="squad-compare-empty"><Scale size={26}/><p>Two franchises are needed to compare squads.</p></div>;
  const teams = [left, right] as const;
  const summaries = teams.map(team => summarizeSquad(state, team)) as [Summary, Summary];
  const hasUnclassified = summaries.some(summary => summary.roles.some(role => role.role === "Unclassified"));
  const roleNames = ["Batter", "Bowler", "All-rounder", "Wicketkeeper", ...(hasUnclassified ? ["Unclassified"] : [])];
  const style = { "--compare-left": left.color, "--compare-right": right.color } as CSSProperties;
  const choose = (side: number, teamId: string) => {
    const other = side === 0 ? right.id : left.id;
    if (teamId === other || !state.teams.some(team => team.id === teamId)) return;
    setSelection(side === 0 ? [teamId, right.id] : [left.id, teamId]);
  };

  return <div className="squad-comparison" style={style} aria-label="Side-by-side squad comparison">
    <div className="squad-compare-selectors">
      {teams.map((team, index) => <div className="squad-compare-franchise" key={index} style={{ "--compare-accent": team.color } as CSSProperties}>
        <div className="squad-compare-selector">
          <span className="squad-compare-crest"><TeamCrest key={team.id} team={team}/></span>
          <div><label htmlFor={`${id}-${index}`}>{index === 0 ? "First franchise" : "Second franchise"}</label><span className="squad-compare-select-wrap"><select id={`${id}-${index}`} aria-label={index === 0 ? "First comparison team" : "Second comparison team"} value={team.id} onChange={event => choose(index, event.target.value)}>{state.teams.map(option => <option key={option.id} value={option.id} disabled={option.id === teams[1 - index].id}>{option.name}</option>)}</select><ChevronDown size={17} aria-hidden="true"/></span></div>
        </div>
        <p className="squad-compare-manager">{summaries[index].manager ? <>Owned and Managed by : <strong>{summaries[index].manager!.name}</strong></> : "No manager has taken charge"}</p>
        <div className="squad-compare-purse"><span>Purse remaining</span><strong>{formatMoney(summaries[index].remaining)}</strong></div>
        <div className="squad-compare-budget" aria-label={`${team.shortName}: ${formatMoney(summaries[index].spent)} spent, ${formatMoney(summaries[index].remaining)} remaining`}><span style={{ width: `${summaries[index].spentPercent}%` }}/></div>
        <p className="squad-compare-budget-key"><span><i/>Spent</span><span><i/>Remaining</span></p>
      </div>)}
    </div>

    <div className="squad-compare-matrix" role="table" aria-label={`${left.name} and ${right.name} comparison`}>
      <div className="squad-compare-row squad-compare-column-headings" role="row"><span role="columnheader">Squad overview</span><strong role="columnheader">{left.shortName}</strong><strong role="columnheader">{right.shortName}</strong></div>
      <ComparisonSection icon={<Wallet size={17}/>} label="Budget & squad"/>
      <ComparisonRow label="Starting budget" values={summaries.map(summary => formatMoney(summary.startingBudget))}/>
      <ComparisonRow label="Total spent" values={summaries.map(summary => formatMoney(summary.spent))}/>
      <ComparisonRow label="Spots filled" values={summaries.map(summary => <span key="spots">{summary.spots}<small> / {state.settings.maxSquadSize}</small></span>)}/>
      <ComparisonRow label="Overseas players" values={summaries.map(summary => <span key="overseas">{summary.overseas}<small> / {state.settings.maxOverseas}</small></span>)}/>
      <ComparisonSection icon={<Users size={17}/>} label="Role balance"/>
      {roleNames.map(role => <ComparisonRow key={role} label={role} className="squad-compare-role-row" values={summaries.map((summary, index) => {
        const count = summary.roles.find(entry => entry.role === role)?.count ?? 0;
        return <span className="squad-compare-role" key={teams[index].id}><strong>{count}</strong><span className="squad-compare-role-track" aria-hidden="true"><i style={{ width: `${summary.spots ? count / summary.spots * 100 : 0}%` }}/></span></span>;
      })}/>)}
      <ComparisonSection icon={<Crown size={17}/>} label="Matchday selection"/>
      <ComparisonRow label="Playing XI" values={summaries.map(summary => <span key="xi">{summary.playingXI}<small> / 11</small></span>)}/>
      <ComparisonRow label="Substitutes" values={summaries.map(summary => <span key="subs">{summary.substitutes}<small> / 5</small></span>)}/>
      <ComparisonRow label="Captain" className="squad-compare-leader-row" values={summaries.map(summary => summary.captain?.name ?? <span key="captain" className="squad-compare-unassigned">Not selected</span>)}/>
      <ComparisonRow label="Vice captain" className="squad-compare-leader-row" values={summaries.map(summary => summary.viceCaptain?.name ?? <span key="vice-captain" className="squad-compare-unassigned">Not selected</span>)}/>
    </div>
    <div className="squad-compare-actions">{teams.map(team => <button key={team.id} type="button" onClick={() => onViewSquad(team.id)} style={{ "--compare-accent": team.color } as CSSProperties}>View {team.shortName} squad<ArrowUpRight size={17}/></button>)}</div>
  </div>;
}

function ComparisonSection({ icon, label }: { icon: ReactNode; label: string }) {
  return <div className="squad-compare-section" role="row"><div role="cell" aria-colspan={3}>{icon}<h3>{label}</h3></div></div>;
}

function ComparisonRow({ label, values, className = "" }: { label: string; values: ReactNode[]; className?: string }) {
  return <div className={`squad-compare-row ${className}`} role="row"><span className="squad-compare-label" role="rowheader">{label}</span>{values.map((value, index) => <div key={index} role="cell" className={`squad-compare-value squad-compare-value-${index}`}>{value}</div>)}</div>;
}
