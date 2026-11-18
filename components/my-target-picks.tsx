"use client";

import { useRef, useState, type CSSProperties } from "react";
import { ArrowDown, Check, ChevronRight, LockKeyhole, Plus, Radio, RotateCcw, Save, Search, Target, X } from "lucide-react";
import type { AuctionAction, Player, RoomState, Team } from "@/lib/auction";
import { AuctionRequestError } from "@/lib/auction-client";
import { formatMoney } from "@/lib/auction-display";
import { getPlayingRole, PLAYING_ROLES, type PlayingRole } from "@/lib/player-roles";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import "./my-target-picks.css";

type Props = { state: RoomState; memberId: string; onAction: (action: AuctionAction) => Promise<void>; connected?: boolean };
type Draft = { playerIds: string[]; baseline: string[]; revision: number };
type Availability = "all" | "available" | "on-table" | "unsold" | "sold";
type TargetStatus = { label: string; tone: "available" | "live" | "won" | "sold" | "removed" | "unsold" };
const PAGE_SIZE = 24;
const samePicks = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

export function MyTargetPicks({ state, memberId, onAction, connected = true }: Props) {
  const member = state.members.find((entry) => entry.id === memberId);
  const team = member?.role === "bidder" && member.id !== state.hostId ? state.teams.find((entry) => entry.id === member.teamId) : undefined;
  if (!team) return null;
  return <TargetPicksStudio key={`${state.id}:${memberId}:${team.id}`} state={state} team={team} onAction={onAction} connected={connected} />;
}

/** A room update may refresh the pool, but never replaces an unsaved shortlist. */
function TargetPicksStudio({ state, team, onAction, connected }: Omit<Props, "memberId"> & { team: Team; connected: boolean }) {
  const [local, setLocal] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<PlayingRole | null>(null);
  const [availability, setAvailability] = useState<Availability>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const savingRef = useRef(false);
  const saved = state.myTargetPicks?.teamId === team.id ? state.myTargetPicks.playerIds : [];
  const savedRevision = state.myTargetPicks?.teamId === team.id ? state.myTargetPicks.revision : 0;
  const acknowledged = Boolean(local && savedRevision > local.revision && samePicks(local.playerIds, saved));
  const activeDraft = local && !samePicks(local.playerIds, local.baseline) && !acknowledged ? local : null;
  const draft = activeDraft?.playerIds ?? saved;
  const revision = activeDraft?.revision ?? savedRevision;
  const dirty = Boolean(activeDraft);
  const remoteChanged = Boolean(activeDraft && activeDraft.revision !== savedRevision);
  const unresolvedConflict = conflict && !acknowledged;
  const selected = new Set(draft);
  const playerMap = new Map(state.players.map((player) => [player.id, player]));
  const teamMap = new Map(state.teams.map((entry) => [entry.id, entry]));
  const liveId = !["sold", "unsold"].includes(state.phase) ? state.currentPlayerId : null;
  const pool = state.players.filter((player) => !player.catalogArchived);
  const query = search.trim().toLowerCase();
  const filtered = pool.filter((player) => {
    if (role && getPlayingRole(player) !== role) return false;
    if (availability === "on-table" && player.id !== liveId) return false;
    if (["available", "sold", "unsold"].includes(availability) && player.status !== availability) return false;
    return !query || `${player.name} ${player.country} ${getPlayingRole(player) ?? ""}`.toLowerCase().includes(query);
  });
  const remaining = draft.filter((id) => { const player = playerMap.get(id); return player && !player.catalogArchived && player.status !== "sold"; }).length;
  const secured = draft.filter((id) => playerMap.get(id)?.soldTo === team.id).length;

  function statusFor(player?: Player): TargetStatus {
    if (!player || player.catalogArchived) return { label: "Removed from pool", tone: "removed" };
    if (player.status === "sold") return player.soldTo === team.id
      ? { label: "In your squad", tone: "won" }
      : { label: `Signed by ${teamMap.get(player.soldTo ?? "")?.shortName ?? "another team"}`, tone: "sold" };
    if (player.id === liveId) return { label: "On the table", tone: "live" };
    return player.status === "unsold" ? { label: "Unsold", tone: "unsold" } : { label: "Available", tone: "available" };
  }

  function edit(playerId: string, remove = false) {
    if (savingRef.current) return;
    const player = playerMap.get(playerId);
    if (!selected.has(playerId) && (!player || player.catalogArchived || player.status === "sold")) return;
    const next = selected.has(playerId) || remove ? draft.filter((id) => id !== playerId) : [...draft, playerId];
    setLocal({ playerIds: next, baseline: activeDraft?.baseline ?? saved, revision });
    setNotice("");
    setError("");
    if (acknowledged) setConflict(false);
  }

  async function save() {
    if (savingRef.current || !dirty || !connected || remoteChanged || unresolvedConflict) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await onAction({ type: "set_target_picks", teamId: team.id, playerIds: draft, expectedRevision: revision });
      setLocal(null);
      setConflict(false);
      setNotice("Targets saved. You’ll be notified when they come up.");
    } catch (failure) {
      if (failure instanceof AuctionRequestError && failure.code === "TARGET_PICKS_CONFLICT") {
        setConflict(true);
        setError("Your targets changed in another tab. Reload the saved list before making more changes.");
      } else setError(failure instanceof Error ? failure.message : "Your targets could not be saved. Your selections are still here.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function reload() {
    setLocal(null);
    setConflict(false);
    setError("");
    setNotice("Showing your saved targets.");
  }

  return <section className="target-picks" aria-labelledby="target-picks-title" style={{ "--target-color": team.color } as CSSProperties} aria-busy={saving}>
    <header className="target-heading">
      <div className="target-heading-copy"><span className="target-team-crest"><TeamCrest team={team} /></span><div><span className="target-eyebrow">{team.shortName} / Scouting board</span><h2 id="target-picks-title">My Target <em>Picks.</em></h2><p>Your shortlist. Your next signing.</p></div></div>
      <div className="target-private"><LockKeyhole size={16} /><span>Visible only to you</span></div>
    </header>

    <div className="target-save-bar">
      <p className={`target-save-status ${dirty ? "is-dirty" : ""}`} role="status" aria-live="polite">{!connected ? "Reconnecting · Selections kept" : dirty ? `${draft.length} selected · Unsaved changes` : acknowledged ? "Targets saved. You’ll be notified when they come up." : notice || `${saved.length} saved targets · Edit anytime`}</p>
      <div>{(dirty || unresolvedConflict) && <button type="button" className="target-reload" onClick={reload} disabled={saving}><RotateCcw size={16} /><span>Reload saved targets</span></button>}<button type="button" className="target-save" disabled={!dirty || saving || !connected || remoteChanged || unresolvedConflict} onClick={save}>{saving ? <span className="target-spinner" /> : <Save size={17} />}{saving ? "Saving targets…" : "Save targets"}</button></div>
    </div>
    {(remoteChanged || unresolvedConflict) && <p className="target-warning" role="alert">A newer target list was saved in another tab. Your selections are preserved here. Reload saved targets to use the latest list.</p>}
    {error && !acknowledged && <p className="target-warning" role="alert">{error}</p>}

    <div className="target-workspace">
      <section className="target-pool" aria-label="Player pool for targeting">
        <div className="target-pool-heading"><div><span className="target-section-kicker">01 / Discover</span><h3>The player pool</h3></div><span className="target-pool-total">{pool.length}<span>players</span></span></div>
        <div className="target-search"><Search size={19} aria-hidden="true" /><input type="search" aria-label="Search target players" placeholder="Search a player, country or role" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} />{search && <button type="button" aria-label="Clear target search" onClick={() => { setSearch(""); setLimit(PAGE_SIZE); }}><X size={17} /></button>}</div>
        <div className="target-role-filters" role="group" aria-label="Filter targets by playing role"><button type="button" aria-pressed={!role} onClick={() => { setRole(null); setLimit(PAGE_SIZE); }}>All roles</button>{PLAYING_ROLES.map((entry) => <button type="button" key={entry} aria-pressed={role === entry} onClick={() => { setRole(entry); setLimit(PAGE_SIZE); }}>{entry}</button>)}</div>
        <div className="target-availability" role="group" aria-label="Filter pool by availability">{([{ value: "all", label: "All players" }, { value: "available", label: "Available" }, { value: "on-table", label: "On the table" }, { value: "unsold", label: "Unsold" }, { value: "sold", label: "Sold" }] as const).map(({ value, label }) => <button type="button" key={value} aria-pressed={availability === value} onClick={() => { setAvailability(value); setLimit(PAGE_SIZE); }}>{label}</button>)}</div>
        <p className="target-results-count" role="status">{filtered.length ? `${Math.min(limit, filtered.length)} of ${filtered.length} players` : "No players match these filters"}</p>
        <ul className="target-player-grid">
          {filtered.slice(0, limit).map((player) => {
            const isSelected = selected.has(player.id);
            const status = statusFor(player);
            const unavailable = player.status === "sold" && !isSelected;
            return <li className={`target-player-card ${isSelected ? "is-selected" : ""}`} key={player.id} data-player-id={player.id}>
              <div className="target-player-art"><span className={`target-player-status tone-${status.tone}`}>{status.tone === "live" && <Radio size={12} />}{status.tone === "won" && <Check size={12} />}{status.label}</span><PlayerImage player={player} className="target-portrait" /><span className="target-art-ring" aria-hidden="true" /></div>
              <div className="target-player-copy"><h4>{player.name}</h4><p>{getPlayingRole(player) ?? "Role unavailable"}<span aria-hidden="true">·</span>{player.country}</p><div className="target-player-bottom"><span>Base<strong>{formatMoney(player.basePrice)}</strong></span><button type="button" className="target-toggle" role="checkbox" aria-checked={isSelected} aria-label={`Target ${player.name}`} disabled={saving || unavailable} onClick={() => edit(player.id)}>{isSelected ? <Check size={17} /> : <Plus size={17} />}<span>{isSelected ? "Targeted" : unavailable ? "Sold" : "Target"}</span></button></div></div>
            </li>;
          })}
        </ul>
        {!filtered.length && <div className="target-empty-results"><Search size={29} strokeWidth={1.4} /><h4>No match this time.</h4><p>Try another name or open up your filters.</p><button type="button" onClick={() => { setSearch(""); setRole(null); setAvailability("all"); setLimit(PAGE_SIZE); }}>Show every player<ChevronRight size={16} /></button></div>}
        {filtered.length > limit && <button type="button" className="target-load-more" onClick={() => setLimit((value) => value + PAGE_SIZE)}><ArrowDown size={17} />Load more players<span>{filtered.length - limit} remaining</span></button>}
      </section>

      <aside className="target-board" aria-labelledby="target-board-title">
        <div className="target-board-heading"><span className="target-section-kicker">02 / Your shortlist</span><div><h3 id="target-board-title">The targets.</h3><span>{draft.length.toString().padStart(2, "0")}</span></div><p>Save your picks to get a personal alert when they reach the auction floor.</p></div>
        <div className="target-board-summary"><span><strong>{remaining}</strong>Still in play</span><span><strong>{secured}</strong>In your squad</span></div>
        {draft.length ? <ul className="target-shortlist" aria-label="Your target list">
          {draft.map((id, index) => {
            const player = playerMap.get(id);
            const status = statusFor(player);
            return <li key={id} data-player-id={id}><span className="target-shortlist-number">{String(index + 1).padStart(2, "0")}</span><span className="target-shortlist-photo">{player ? <PlayerImage player={player} /> : <Target size={23} />}</span><div className="target-shortlist-copy"><strong>{player?.name ?? "Unavailable player"}</strong><span className={`tone-${status.tone}`}>{status.label}</span></div><button type="button" aria-label={`Remove ${player?.name ?? "unavailable player"} from targets`} disabled={saving} onClick={() => edit(id, true)}><X size={16} /></button></li>;
          })}
        </ul> : <div className="target-shortlist-empty"><span><Target size={35} strokeWidth={1.3} /></span><h4>Who’s on your radar?</h4><p>Choose players from the pool. Add a few now and more as the auction unfolds.</p></div>}
        <div className="target-board-foot"><LockKeyhole size={14} /><span>Your targets stay private.</span>{dirty && <span className="target-board-unsaved">Unsaved</span>}</div>
      </aside>
    </div>
  </section>;
}
