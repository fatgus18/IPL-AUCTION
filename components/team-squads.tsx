"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Globe2, Users, X } from "lucide-react";
import type { RoomState, Team } from "@/lib/auction";
import { formatMoney } from "@/lib/auction-display";
import { countPlayingRoles, getPlayingRole } from "@/lib/player-roles";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import "./team-squads.css";

export function TeamSquads({ state }: { state: RoomState }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = state.teams.find(team => team.id === selectedId);
  return <section className="team-squads" aria-labelledby="team-squads-title">
    <div className="team-squads-heading"><h2 id="team-squads-title">Team squads</h2><p>Select a team to view its full squad.</p></div>
    <div className="team-squad-overview">
      {state.teams.map(team => {
        const owner = state.members.find(member => member.teamId === team.id && member.role === "bidder");
        return <button className="team-squad-summary" type="button" key={team.id} aria-label={`View ${team.name} squad`} aria-haspopup="dialog" onClick={() => setSelectedId(team.id)} style={{ "--summary-team-color": team.color } as CSSProperties}>
          <span className="team-squad-summary-identity">
            <span className="team-squad-summary-crest"><TeamCrest team={team}/></span>
            <span className="team-squad-summary-name"><strong>{team.name}</strong><span className="team-squad-summary-manager">{owner ? <>Owned and Managed by : <strong>{owner.name}</strong></> : "No manager has taken charge"}</span></span>
            <ArrowUpRight size={19}/>
          </span>
          <span className="team-squad-summary-stats"><span>Purse remaining<strong>{formatMoney(team.purse)}</strong></span><span>Spots filled<strong>{team.squad.length}<small> / {state.settings.maxSquadSize}</small></strong></span></span>
        </button>;
      })}
    </div>
    {selected && <SquadDialog key={`${state.code}:${selected.id}`} state={state} team={selected} onClose={() => setSelectedId(null)}/>}
  </section>;
}

function SquadDialog({ state, team, onClose }: { state: RoomState; team: Team; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const playerMap = new Map(state.players.map(player => [player.id, player]));
  const owner = state.members.find(member => member.teamId === team.id && member.role === "bidder");
  const spent = team.squad.reduce((total, purchase) => total + purchase.amount, 0);
  const overseas = team.squad.filter(purchase => playerMap.get(purchase.playerId)?.isOverseas).length;
  const roles = countPlayingRoles(team.squad.map(purchase => playerMap.get(purchase.playerId)));
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return <dialog ref={ref} className="squad-detail-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} style={{ "--detail-accent": team.color } as CSSProperties}>
    <header className="squad-detail-header"><span className="squad-detail-crest"><TeamCrest team={team}/></span><div><h2 id={titleId}>{team.name}</h2><p>{owner ? <>Owned and Managed by : <strong>{owner.name}</strong></> : "No manager has taken charge"}</p></div><button type="button" aria-label="Close squad details" onClick={onClose}><X size={22}/></button></header>
    <div className="squad-detail-content">
      <dl className="squad-detail-totals"><div><dt>Purse remaining</dt><dd>{formatMoney(team.purse)}</dd></div><div><dt>Spots filled</dt><dd>{team.squad.length} / {state.settings.maxSquadSize}</dd></div><div><dt>Overseas</dt><dd>{overseas} / {state.settings.maxOverseas}</dd></div><div><dt>Total invested</dt><dd>{formatMoney(spent)}</dd></div></dl>
      {!!team.squad.length && <dl className="squad-detail-roles" aria-label="Squad by playing role">{roles.map(({ role, count }) => <div key={role} data-playing-role={role} data-count={count}><dt>{role}</dt><dd>{count}</dd></div>)}</dl>}
      {team.squad.length ? <ul className="squad-detail-roster" aria-label={`${team.shortName} full squad`}>
        {team.squad.map(purchase => {
          const player = playerMap.get(purchase.playerId);
          const xi = team.lineup?.playingXI.indexOf(purchase.playerId) ?? -1;
          const sub = team.lineup?.substitutes.indexOf(purchase.playerId) ?? -1;
          const captain = team.lineup?.captainId === purchase.playerId;
          const vice = team.lineup?.viceCaptainId === purchase.playerId;
          return <li className="squad-detail-player" key={purchase.playerId}>
            <div className="squad-detail-portrait">{player ? <PlayerImage player={player}/> : <Users size={48}/>}<span className="squad-detail-selection">{captain ? "Captain" : vice ? "Vice captain" : xi >= 0 ? `XI · No. ${xi + 1}` : sub >= 0 ? `Substitute ${sub + 1}` : "Squad"}</span></div>
            <div className="squad-detail-player-copy"><h3>{player?.name ?? "Player details unavailable"}</h3>{player && <p>{getPlayingRole(player) ?? "Role unclassified"}<br/>{player.country}{player.isOverseas && <Globe2 size={13} aria-label="Overseas"/>}</p>}<div className="squad-detail-price"><span>Signed for</span><strong>{formatMoney(purchase.amount)}</strong></div>
              {player && <details className="squad-player-stats"><summary>Player details</summary><dl><div><dt>Matches</dt><dd>{player.stats.matches ?? "—"}</dd></div><div><dt>Runs</dt><dd>{player.stats.runs ?? "—"}</dd></div><div><dt>Wickets</dt><dd>{player.stats.wickets ?? "—"}</dd></div><div><dt>Strike rate</dt><dd>{player.stats.strikeRate ?? "—"}</dd></div></dl><p>{player.statsFormat && player.statsFormat !== "Unknown" ? `${player.statsFormat} career stats` : "Career stats unavailable"}</p>{player.profileUrl && <a href={player.profileUrl} target="_blank" rel="noreferrer">Source profile<ArrowUpRight size={13}/></a>}</details>}
            </div>
          </li>;
        })}
      </ul> : <div className="squad-detail-empty"><Users size={32}/><h3>{owner ? "No signings yet" : "No manager has taken charge"}</h3><p>{owner ? "Confirmed purchases will appear here." : "This franchise is available to manage."}</p></div>}
    </div>
  </dialog>;
}
