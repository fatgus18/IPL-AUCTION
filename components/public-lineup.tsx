"use client";

import { useId, useRef, type RefObject } from "react";
import { Popover } from "@base-ui/react/popover";
import { Crown, Globe2, Shield, UserRound, X } from "lucide-react";
import type { Player, RoomState, Team } from "@/lib/auction";
import { getPlayingRole } from "@/lib/player-roles";
import { getSquadCaptaincy } from "@/lib/squad-captaincy";
import { PlayerImage } from "./ipl-visuals";
import { LineupPlayerStats } from "./lineup-player-stats";
import "./public-lineup.css";

/** Public selections come from room updates; private targets and bids are never read. */
export function PublicLineup({ state, team }: { state: RoomState; team: Team }) {
  const headingId = useId();
  const portalRef = useRef<HTMLDivElement>(null);
  const players = new Map(state.players.map(player => [player.id, player]));
  const purchased = new Set(team.squad.map(purchase => purchase.playerId));
  const positions = (ids: (string | null)[] | undefined, count: number) => Array.from({ length: count }, (_, index) => {
    const id = ids?.[index];
    return id && purchased.has(id) ? id : null;
  });
  const xi = positions(team.lineup?.playingXI, 11);
  const substitutes = positions(team.lineup?.substitutes, 5);
  const xiCount = xi.filter(Boolean).length;
  const subCount = substitutes.filter(Boolean).length;
  const { captainId, viceCaptainId } = getSquadCaptaincy(team, state.players);
  const leadership = [
    { id: captainId, label: "Captain", badge: "C", Icon: Crown },
    { id: viceCaptainId, label: "Vice captain", badge: "VC", Icon: Shield },
  ];

  const slots = (ids: (string | null)[], group: "xi" | "substitutes") => ids.map((id, index) => {
    const player = id ? players.get(id) : undefined;
    const leader = id ? leadership.find(entry => entry.id === id) : undefined;
    const position = `${group === "xi" ? "Batting position" : "Substitute"} ${index + 1}`;
    return <li className={`public-xi-slot ${id ? "public-xi-slot-filled" : "public-xi-slot-empty"}`} key={index} data-position={index + 1} data-player-id={id ?? ""}>
      <span className="public-xi-position" aria-label={position}>{String(index + 1).padStart(2, "0")}</span>
      {player ? <PublicPlayer player={player} badge={leader?.badge} leadership={leader?.label} portalRef={portalRef}/> : <div className="public-xi-unfilled"><UserRound size={25} strokeWidth={1.2} aria-hidden="true"/><span>{id ? "Player details unavailable" : "Not selected"}</span></div>}
    </li>;
  });

  return <section className="public-xi" aria-labelledby={headingId} data-team-id={team.id} data-lineup-revision={team.lineup?.revision ?? 0}>
    <div className="public-xi-heading"><div><span className="public-xi-eyebrow">{team.shortName} · Matchday selection</span><h3 id={headingId}>{xiCount ? "The playing XI" : "XI not picked yet"}</h3><p>{xiCount ? "Saved batting order, substitutes and team leadership." : "Saved selections will appear here as the manager builds their team."}</p></div><span className="public-xi-status"><i aria-hidden="true"/>{xiCount === 11 ? "Eleven selected" : `${xiCount} / 11 selected`}</span></div>

    <div className="public-xi-leaders" aria-label="Team leadership">
      {leadership.map(({ id, label, badge, Icon }) => {
        const validId = id && purchased.has(id) ? id : null;
        const player = validId ? players.get(validId) : undefined;
        const xiPosition = validId ? xi.indexOf(validId) : -1;
        const subPosition = validId ? substitutes.indexOf(validId) : -1;
        const placement = xiPosition >= 0 ? `Batting position ${String(xiPosition + 1).padStart(2, "0")}` : subPosition >= 0 ? `Substitute ${String(subPosition + 1).padStart(2, "0")}` : "Squad · outside playing XI";
        return <div className="public-xi-leader" key={badge} data-leadership={badge} data-player-id={validId ?? ""}>
          <span className="public-xi-leader-art" aria-hidden="true">{player ? <PlayerImage player={player}/> : <Icon size={24} strokeWidth={1.3}/>}</span>
          <span className="public-xi-leader-copy"><span>{label}</span><strong>{player?.name ?? (validId ? "Player details unavailable" : "Not appointed")}</strong>{validId && <small>{placement}</small>}</span><span className="public-xi-leader-badge" aria-hidden="true">{badge}</span>
        </div>;
      })}
    </div>

    <div className="public-xi-ground">
      <div className="public-xi-group-heading"><h4>Batting order</h4><span>{xiCount} / 11</span></div>
      <ol className="public-xi-slots" aria-label="Saved playing XI in batting order">{slots(xi, "xi")}</ol>
    </div>
    <div className="public-xi-bench">
      <div className="public-xi-group-heading"><h4>Substitutes</h4><span>{subCount} / 5</span></div>
      <ol className="public-xi-slots" aria-label="Saved substitutes">{slots(substitutes, "substitutes")}</ol>
    </div>
    <p className="public-xi-footnote">Visible to everyone in this room. Hover or select a player to view their statistics.</p>
    <div ref={portalRef}/>
  </section>;
}

function PublicPlayer({ player, badge, leadership, portalRef }: { player: Player; badge?: string; leadership?: string; portalRef: RefObject<HTMLDivElement | null> }) {
  return <Popover.Root>
    <Popover.Trigger className="public-xi-player" openOnHover delay={180} closeDelay={120} aria-label={`View ${player.name} statistics${leadership ? `, ${leadership}` : ""}`}>
      <span className="public-xi-photo" aria-hidden="true"><PlayerImage player={player}/></span>
      <span className="public-xi-player-copy"><strong>{player.name}</strong><span>{getPlayingRole(player) ?? "Role unclassified"}</span><small>{player.isOverseas && <Globe2 size={12} aria-label="Overseas"/>}{player.country}</small></span>
      {badge && <span className="public-xi-badge" aria-label={leadership}>{badge}</span>}
    </Popover.Trigger>
    <Popover.Portal container={portalRef}>
      <Popover.Positioner className="public-xi-stats-positioner" positionMethod="fixed" side="top" sideOffset={9} collisionPadding={16}>
        <Popover.Popup className="public-xi-stats-popup" initialFocus={type => type === "keyboard"}>
          <div className="public-xi-stats-title"><Popover.Title>{player.name}</Popover.Title><Popover.Close aria-label="Close player statistics"><X size={17}/></Popover.Close></div>
          <LineupPlayerStats player={player}/>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
