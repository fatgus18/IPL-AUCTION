"use client";

import { useRef, useState, type CSSProperties } from "react";
import { ArrowLeftRight, Check, Crown, Globe2, RotateCcw, Shield, Sparkles, Trophy, Users, Wallet } from "lucide-react";
import type { AuctionAction, RoomState } from "@/lib/auction";
import { AuctionRequestError } from "@/lib/auction-client";
import { formatMoney } from "@/lib/auction-display";
import { countPlayingRoles, getPlayingRole, type PlayingRole } from "@/lib/player-roles";
import { getSquadCaptaincy } from "@/lib/squad-captaincy";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import "./my-squad.css";

type MySquadProps = { state: RoomState; memberId: string; connected: boolean; onAction: (action: AuctionAction) => Promise<void> };
type Captaincy = { captainId: string | null; viceCaptainId: string | null };
type CaptaincyAttempt = Captaincy & { teamId: string; revision: number; status: "pending" | "accepted" | "failed"; error?: string; conflict?: boolean };

/** The room snapshot is the only source of truth for purchases and balances. */
export function MySquad({ state, memberId, connected, onAction }: MySquadProps) {
  const [selectedRole, setSelectedRole] = useState<PlayingRole | "Unclassified" | null>(null);
  const [attempt, setAttempt] = useState<CaptaincyAttempt | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const savingRef = useRef(false);
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
  const { captainId, viceCaptainId } = getSquadCaptaincy(team, state.players);
  const revision = team.lineup?.revision ?? 0;
  const currentAttempt = attempt?.teamId === team.id ? attempt : null;
  const refreshed = Boolean(currentAttempt && revision > currentAttempt.revision);
  const confirmed = Boolean(refreshed && currentAttempt?.captainId === captainId && currentAttempt?.viceCaptainId === viceCaptainId);
  const waitingForSnapshot = Boolean(currentAttempt?.status === "accepted" && !refreshed);
  const saving = requestPending || waitingForSnapshot;
  const conflictAwaitingRefresh = Boolean(currentAttempt?.conflict && !refreshed);
  const canManage = member?.role === "bidder" && member.id !== state.hostId;
  const controlsDisabled = !canManage || !connected || saving || conflictAwaitingRefresh;
  const error = !confirmed && currentAttempt?.status === "failed" ? currentAttempt.error : "";
  const status = saving ? "Saving captaincy…"
    : !connected ? "Reconnecting · Captaincy controls will return when you’re online."
      : conflictAwaitingRefresh ? "Waiting for the latest team selection…"
        : confirmed ? "Captaincy saved to your room."
          : currentAttempt?.status === "accepted" && refreshed ? "Captaincy changed in another tab. The latest selection is shown."
            : !canManage ? "Only this team’s manager can change its captaincy."
              : !roster.length ? "Your captain and vice captain can be chosen after your first signing."
                : "Changes save immediately. Select a chosen role again to clear it.";

  async function saveCaptaincy(next: Captaincy) {
    if (!team || controlsDisabled || savingRef.current || (next.captainId === captainId && next.viceCaptainId === viceCaptainId)) return;
    savingRef.current = true;
    setRequestPending(true);
    const pending: CaptaincyAttempt = { ...next, teamId: team.id, revision, status: "pending" };
    setAttempt(pending);
    try {
      await onAction({ type: "set_captaincy", teamId: team.id, ...next, expectedRevision: revision });
      // A successful request is acknowledged only when the room snapshot agrees.
      setAttempt({ ...pending, status: "accepted" });
    } catch (failure) {
      const conflict = failure instanceof AuctionRequestError && failure.code === "LINEUP_CONFLICT";
      setAttempt({ ...pending, status: "failed", conflict, error: conflict
        ? "Your team selection changed elsewhere. Review the latest captain and vice captain, then choose again."
        : failure instanceof Error ? failure.message : "Captaincy could not be saved. Check your selection and try again." });
    } finally {
      savingRef.current = false;
      setRequestPending(false);
    }
  }

  function chooseCaptaincy(playerId: string, role: keyof Captaincy) {
    if (role === "captainId") {
      void saveCaptaincy({ captainId: captainId === playerId ? null : playerId, viceCaptainId: viceCaptainId === playerId ? captainId : viceCaptainId });
    } else {
      void saveCaptaincy({ captainId: captainId === playerId ? viceCaptainId : captainId, viceCaptainId: viceCaptainId === playerId ? null : playerId });
    }
  }

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

    <section className="personal-squad-leadership" aria-labelledby="personal-squad-leadership-title" aria-busy={saving}>
      <div className="personal-squad-leadership-heading">
        <div><h3 id="personal-squad-leadership-title"><Crown size={18} aria-hidden="true" />Squad leadership</h3><p>Choose any signing, including players outside your XI. Update your leaders throughout the season.</p></div>
        <div className="personal-squad-leadership-tools">
          <button type="button" disabled={controlsDisabled || !captainId || !viceCaptainId} onClick={() => void saveCaptaincy({ captainId: viceCaptainId, viceCaptainId: captainId })} title="Swap captain and vice captain"><ArrowLeftRight size={14} aria-hidden="true" />Swap roles</button>
          <button type="button" disabled={controlsDisabled || (!captainId && !viceCaptainId)} onClick={() => void saveCaptaincy({ captainId: null, viceCaptainId: null })} title="Clear captain and vice captain"><RotateCcw size={14} aria-hidden="true" />Reset</button>
        </div>
      </div>
      <div className="personal-squad-leaders">
        {([{ id: captainId, label: "Captain", badge: "C" }, { id: viceCaptainId, label: "Vice captain", badge: "VC" }] as const).map(({ id, label, badge }) => {
          const leader = id ? playersById.get(id) : undefined;
          return <div className={`personal-squad-leader ${id ? "personal-squad-leader-selected" : ""}`} key={badge} data-leadership={badge} data-player-id={id ?? ""}>
            <span className="personal-squad-leader-art" aria-hidden="true">{leader ? <PlayerImage player={leader} /> : badge === "C" ? <Crown size={24} strokeWidth={1.4} /> : <Shield size={24} strokeWidth={1.4} />}</span>
            <span className="personal-squad-leader-copy"><span>{label}</span><strong>{id ? leader?.name ?? "Player details unavailable" : "Not assigned"}</strong>{!id && <small>Choose {badge} on a player below</small>}</span>
            <span className="personal-squad-leader-badge" aria-hidden="true">{badge}</span>
          </div>;
        })}
      </div>
      <p className={`personal-squad-leadership-status ${confirmed && !saving ? "personal-squad-leadership-saved" : ""}`} role="status" aria-live="polite">{saving ? <span className="personal-squad-saving" aria-hidden="true" /> : confirmed ? <Check size={14} aria-hidden="true" /> : null}{status}</p>
      {error && <p className="personal-squad-leadership-error" role="alert">{error}</p>}
    </section>

    <div className="personal-squad-roster-heading">
      <div><h3>Your signings</h3><p aria-live="polite" aria-atomic="true">{team.squad.length} {team.squad.length === 1 ? "player signed" : "players signed"} <span aria-hidden="true">·</span> {slotsRemaining} {slotsRemaining === 1 ? "place" : "places"} remaining</p></div>
    </div>

    {roster.length ? <>
      <div className="personal-squad-categories" role="group" aria-label="Filter signings by playing role">
        <button type="button" aria-pressed={selectedRole === null} onClick={() => setSelectedRole(null)}><span>All players</span><strong>{roster.length}</strong></button>
        {categories.map(({ role, count }) => <button type="button" key={role} data-playing-role={role} data-count={count} aria-pressed={selectedRole === role} onClick={() => setSelectedRole(role)}><span>{role}</span><strong>{count}</strong></button>)}
      </div>
      <ul className="personal-squad-roster" aria-label={selectedRole ? `${selectedRole} signings` : "All signings"}>
        {visibleRoster.map(({ playerId, amount, player }) => <li className="personal-squad-player" key={playerId} data-captaincy={captainId === playerId ? "captain" : viceCaptainId === playerId ? "vice-captain" : undefined}>
          <div className="personal-squad-player-art">
            <span className="personal-squad-player-crest" aria-hidden="true"><TeamCrest team={team} /></span>
            {player?.role === "Marquee" && <span className="personal-squad-marquee"><Sparkles size={12} aria-hidden="true" />Marquee</span>}
            {(captainId === playerId || viceCaptainId === playerId) && <span className="personal-squad-player-leader" aria-label={captainId === playerId ? "Captain" : "Vice captain"}>{captainId === playerId ? "C" : "VC"}</span>}
            {player ? <PlayerImage player={player} className="personal-squad-portrait" /> : <span className="personal-squad-missing-photo" aria-hidden="true"><Users size={60} strokeWidth={1} /></span>}
          </div>
          <div className="personal-squad-player-info">
            <h4>{player?.name ?? "Player details unavailable"}</h4>
            {player && <p>{getPlayingRole(player) ?? "Role unclassified"} <span aria-hidden="true">·</span> {player.country}{player.isOverseas && <Globe2 size={14} aria-label="Overseas player" />}</p>}
            <div className="personal-squad-purchase"><span>Signed for</span><strong>{formatMoney(amount)}</strong></div>
            <div className="personal-squad-captaincy-actions" role="group" aria-label={`Captaincy for ${player?.name ?? "unavailable player"}`}>
              <button type="button" aria-pressed={captainId === playerId} disabled={controlsDisabled || !player} onClick={() => chooseCaptaincy(playerId, "captainId")} aria-label={captainId === playerId ? `Clear ${player?.name} as captain` : viceCaptainId === playerId && captainId ? `Swap roles: make ${player?.name} captain` : `Make ${player?.name} captain`}><span aria-hidden="true">C</span>Captain{captainId === playerId && <Check size={13} aria-hidden="true" />}</button>
              <button type="button" aria-pressed={viceCaptainId === playerId} disabled={controlsDisabled || !player} onClick={() => chooseCaptaincy(playerId, "viceCaptainId")} aria-label={viceCaptainId === playerId ? `Clear ${player?.name} as vice captain` : captainId === playerId && viceCaptainId ? `Swap roles: make ${player?.name} vice captain` : `Make ${player?.name} vice captain`}><span aria-hidden="true">VC</span>Vice captain{viceCaptainId === playerId && <Check size={13} aria-hidden="true" />}</button>
            </div>
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
