"use client";

import { useState, type CSSProperties } from "react";
import { Globe2, Shield, Sparkles, Trophy, Users, Wallet } from "lucide-react";
import type { RoomState } from "@/lib/auction";
import { formatMoney } from "@/lib/auction-display";
import { countPlayingRoles, getPlayingRole, type PlayingRole } from "@/lib/player-roles";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import "./my-squad.css";

type MySquadProps = { state: RoomState; memberId: string };

/** The room snapshot is the only source of truth for purchases and balances. */
export function MySquad({ state, memberId }: MySquadProps) {
  const [selectedRole, setSelectedRole] = useState<PlayingRole | "Unclassified" | null>(null);
  const member = state.members.find((entry) => entry.id === memberId);
  const team = state.teams.find((entry) => entry.id === member?.teamId);

  if (!team) {
    return <section className="personal-squad" aria-labelledby="personal-squad-title">
      <div className="personal-squad-unassigned">
        <span className="personal-squad-empty-icon" aria-hidden="true"><Shield size={32} strokeWidth={1.4} /></span>
        <h2 id="personal-squad-title">My Squad</h2>
        <h3>{member?.role === "auctioneer" ? "You’re running the auction." : member?.role === "spectator" ? "You’re watching from the pavilion." : "No team assigned."}</h3>
        <p>{member?.role === "auctioneer"
          ? "Your auctioneer seat doesn’t own a team. Open Team squads to follow every franchise’s signings."
          : member?.role === "spectator"
            ? "Spectators don’t own a squad. Open Team squads to follow the auction’s signings."
            : "Your squad will appear here when you join the auction with a team."}</p>
      </div>
    </section>;
  }

  const playersById = new Map(state.players.map((player) => [player.id, player]));
  const roster = team.squad.map((purchase) => ({ ...purchase, player: playersById.get(purchase.playerId) }));
  const spent = team.squad.reduce((total, purchase) => total + purchase.amount, 0);
  const overseas = roster.filter(({ player }) => player?.isOverseas).length;
  const slotsRemaining = Math.max(0, state.settings.maxSquadSize - team.squad.length);
  const categories = countPlayingRoles(roster.map(({ player }) => player));
  const visibleRoster = selectedRole
    ? roster.filter(({ player }) => (getPlayingRole(player) ?? "Unclassified") === selectedRole)
    : roster;

  return <section className="personal-squad" aria-labelledby="personal-squad-title" style={{ "--squad-color": team.color } as CSSProperties}>
    <header className="personal-squad-header">
      <h2 id="personal-squad-title">My Squad</h2>
      <span className="personal-squad-confirmed"><Shield size={16} aria-hidden="true" />Confirmed purchases</span>
    </header>

    <div className="personal-squad-totals">
      <div><Wallet size={20} aria-hidden="true" /><dl><dt>Purse remaining</dt><dd>{formatMoney(team.purse)}</dd></dl></div>
      <div><Trophy size={20} aria-hidden="true" /><dl><dt>Total invested</dt><dd>{formatMoney(spent)}</dd></dl></div>
      <div><Users size={20} aria-hidden="true" /><dl><dt>Squad places</dt><dd>{team.squad.length}<span> / {state.settings.maxSquadSize}</span></dd></dl></div>
      <div><Globe2 size={20} aria-hidden="true" /><dl><dt>Overseas players</dt><dd>{overseas}<span> / {state.settings.maxOverseas}</span></dd></dl></div>
    </div>

    <div className="personal-squad-roster-heading">
      <div><h3>Your signings</h3><p aria-live="polite" aria-atomic="true">{team.squad.length} {team.squad.length === 1 ? "player signed" : "players signed"} <span aria-hidden="true">·</span> {slotsRemaining} {slotsRemaining === 1 ? "place" : "places"} remaining</p></div>
    </div>

    {roster.length ? <>
      <div className="personal-squad-categories" role="group" aria-label="Filter signings by playing role">
        <button type="button" aria-pressed={selectedRole === null} onClick={() => setSelectedRole(null)}><span>All players</span><strong>{roster.length}</strong></button>
        {categories.map(({ role, count }) => <button type="button" key={role} data-playing-role={role} data-count={count} aria-pressed={selectedRole === role} onClick={() => setSelectedRole(role)}><span>{role}</span><strong>{count}</strong></button>)}
      </div>
      <ul className="personal-squad-roster" aria-label={selectedRole ? `${selectedRole} signings` : "All signings"}>
        {visibleRoster.map(({ playerId, amount, player }) => <li className="personal-squad-player" key={playerId}>
          <div className="personal-squad-player-art">
            <span className="personal-squad-player-crest" aria-hidden="true"><TeamCrest team={team} /></span>
            {player?.role === "Marquee" && <span className="personal-squad-marquee"><Sparkles size={12} aria-hidden="true" />Marquee</span>}
            {player ? <PlayerImage player={player} className="personal-squad-portrait" /> : <span className="personal-squad-missing-photo" aria-hidden="true"><Users size={60} strokeWidth={1} /></span>}
          </div>
          <div className="personal-squad-player-info">
            <h4>{player?.name ?? "Player details unavailable"}</h4>
            {player && <p>{getPlayingRole(player) ?? "Role unclassified"} <span aria-hidden="true">·</span> {player.country}{player.isOverseas && <Globe2 size={14} aria-label="Overseas player" />}</p>}
            <div className="personal-squad-purchase"><span>Signed for</span><strong>{formatMoney(amount)}</strong></div>
          </div>
        </li>)}
      </ul>
      {!visibleRoster.length && <div className="personal-squad-filter-empty" role="status"><p>No {selectedRole?.toLowerCase()} signings yet.</p><button type="button" onClick={() => setSelectedRole(null)}>Show all players</button></div>}
    </> : <div className="personal-squad-empty">
      <span className="personal-squad-empty-icon" aria-hidden="true"><Trophy size={34} strokeWidth={1.4} /></span>
      <h3>Your first signing starts here.</h3>
      <p>Win a bid on the auction floor. Once the auctioneer confirms the sale, your player appears here automatically.</p>
    </div>}
  </section>;
}
