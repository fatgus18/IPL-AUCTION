"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check, GitBranch, Search, X } from "lucide-react";
import type { Player } from "@/lib/auction";
import { formatMoney } from "@/lib/auction-display";
import { getPlayingRole, PLAYING_ROLES, type PlayingRole } from "@/lib/player-roles";
import { isTargetPlayerEligible } from "@/lib/target-chains";
import { PlayerImage } from "./ipl-visuals";
import "./target-backup-picker.css";

type Props = {
  firstChoice?: Player;
  players: readonly Player[];
  selectedIds: readonly string[];
  currentBackupId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

const PAGE_SIZE = 12;

/** Native modal focus management; only one page of portraits is mounted at a time. */
export function TargetBackupPicker({ firstChoice, players, selectedIds, currentBackupId, onSelect, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRequestedRef = useRef(false);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<PlayingRole | null>(null);
  const [availability, setAvailability] = useState<"all" | "available" | "unsold">("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const selected = new Set(selectedIds);
  const query = search.trim().toLowerCase();
  const candidates = players.filter((player) => {
    if (!isTargetPlayerEligible(player) || player.id === firstChoice?.id || (selected.has(player.id) && player.id !== currentBackupId)) return false;
    if (role && getPlayingRole(player) !== role) return false;
    if (availability !== "all" && player.status !== availability) return false;
    return !query || `${player.name} ${player.country} ${getPlayingRole(player) ?? ""}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected && document.activeElement !== trigger) trigger.focus({ preventScroll: true });
    };
  }, []);

  function requestClose() {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
    onClose();
  }

  return <dialog ref={dialogRef} className="target-backup-picker" aria-labelledby="backup-picker-title" aria-describedby="backup-picker-description" onKeyDownCapture={(event) => {
    if (event.key !== "Escape" || (event.target instanceof Element && event.target.closest("dialog") !== event.currentTarget)) return;
    // Search inputs otherwise consume the first Escape to clear their text.
    event.preventDefault();
    event.stopPropagation();
    requestClose();
  }} onCancel={(event) => { event.preventDefault(); requestClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose(); } }}>
    <div className="backup-picker-top"><span className="target-section-kicker"><GitBranch size={14} /> Your next option</span><button type="button" aria-label="Close backup picker" onClick={requestClose}><X size={20} /></button></div>
    <header className="backup-picker-heading"><h2 id="backup-picker-title">Choose a <em>backup.</em></h2><p id="backup-picker-description">One optional alternative for <strong>{firstChoice?.name ?? "your first choice"}</strong>. They become active if your first choice joins another team or leaves the pool.</p></header>
    <div className="target-search"><Search size={19} /><input type="search" aria-label="Search backup players" placeholder="Find a player, country or role" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} />{search && <button type="button" aria-label="Clear backup search" onClick={() => { setSearch(""); setLimit(PAGE_SIZE); }}><X size={17} /></button>}</div>
    <div className="target-role-filters" role="group" aria-label="Filter backups by playing role"><button type="button" aria-pressed={!role} onClick={() => { setRole(null); setLimit(PAGE_SIZE); }}>All roles</button>{PLAYING_ROLES.map((entry) => <button type="button" key={entry} aria-pressed={role === entry} onClick={() => { setRole(entry); setLimit(PAGE_SIZE); }}>{entry}</button>)}</div>
    <div className="backup-picker-pool-heading"><div className="target-availability" role="group" aria-label="Filter backups by availability">{([{ value: "all", label: "All eligible" }, { value: "available", label: "Available" }, { value: "unsold", label: "Unsold" }] as const).map((entry) => <button type="button" key={entry.value} aria-pressed={availability === entry.value} onClick={() => { setAvailability(entry.value); setLimit(PAGE_SIZE); }}>{entry.label}</button>)}</div><span role="status">{candidates.length} options</span></div>
    <ul className="backup-picker-grid" aria-label="Available backup players">{candidates.slice(0, limit).map((player) => <li key={player.id} data-backup-option-id={player.id}><button type="button" className={`backup-picker-option${player.id === currentBackupId ? " is-current" : ""}`} aria-label={`Choose ${player.name} as backup`} onClick={() => onSelect(player.id)}>
      <span className="backup-picker-portrait"><PlayerImage player={player} /><span className="backup-picker-status">{player.status === "unsold" ? "Unsold" : "Available"}</span></span>
      <span className="backup-picker-player"><strong>{player.name}</strong><span>{getPlayingRole(player) ?? "Role unavailable"} · {player.country}</span><span className="backup-picker-price">Base <b>{formatMoney(player.basePrice)}</b></span></span><span className="backup-picker-select" aria-hidden="true">{player.id === currentBackupId ? <Check size={18} /> : <ArrowRight size={18} />}</span>
    </button></li>)}</ul>
    {!candidates.length && <div className="backup-picker-empty"><Search size={28} strokeWidth={1.4} /><strong>No available match.</strong><p>Try another search. Players already in your plan are kept out of this list.</p></div>}
    {candidates.length > limit && <button type="button" className="target-load-more" onClick={() => setLimit((value) => value + PAGE_SIZE)}><ArrowDown size={16} />More backup options<span>{candidates.length - limit} remaining</span></button>}
    <footer className="backup-picker-footer"><span>Optional. Your first choice works on its own.</span><button type="button" onClick={requestClose}>Keep my plan</button></footer>
  </dialog>;
}
