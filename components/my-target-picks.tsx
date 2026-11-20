"use client";

import { useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowDownRight, ArrowRight, Check, ChevronRight, GitBranch, LockKeyhole, Plus, Radio, RotateCcw, Save, Search, Target, X } from "lucide-react";
import type { AuctionAction, Player, RoomState, Team } from "@/lib/auction";
import { AuctionRequestError } from "@/lib/auction-client";
import { formatMoney } from "@/lib/auction-display";
import { budgetInputsFromSaved, budgetInputValue, budgetLimitValue, parseBudgetInputs, privateBudgetPlan, sameBudgetInputs, sameBudgetValues, type BudgetInputs } from "@/lib/private-budget-display";
import { getPlayingRole, PLAYING_ROLES, type PlayingRole } from "@/lib/player-roles";
import { getTargetChains, getTargetPlayerIds, isTargetPlayerEligible } from "@/lib/target-chains";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import { TargetBackupPicker } from "./target-backup-picker";
import "./my-target-picks.css";

type Props = { state: RoomState; memberId: string; onAction: (action: AuctionAction) => Promise<void>; connected?: boolean };
type Draft = { playerIds: string[]; baseline: string[]; backups: Record<string, string>; baselineBackups: Record<string, string>; budgets: BudgetInputs; baselineBudgets: BudgetInputs; revision: number };
type Availability = "all" | "available" | "on-table" | "unsold" | "sold";
type TargetStatus = { label: string; tone: "available" | "live" | "won" | "sold" | "removed" | "unsold" };
const PAGE_SIZE = 24;
const samePicks = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
const sameBackups = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([id, backupId]) => Object.hasOwn(b, id) && b[id] === backupId);

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
  const [backupFor, setBackupFor] = useState<string | null>(null);
  const savingRef = useRef(false);
  const saved = state.myTargetPicks?.teamId === team.id ? state.myTargetPicks.playerIds : [];
  const savedRevision = state.myTargetPicks?.teamId === team.id ? state.myTargetPicks.revision : 0;
  const savedBudgets = state.myTargetPicks?.teamId === team.id ? state.myTargetPicks.maxBids ?? {} : {};
  const savedBackups = state.myTargetPicks?.teamId === team.id ? state.myTargetPicks.backups ?? {} : {};
  const savedInputs = budgetInputsFromSaved(savedBudgets);
  const localAmounts = local ? parseBudgetInputs(getTargetPlayerIds(local), local.budgets) : null;
  const acknowledged = Boolean(local && localAmounts && !localAmounts.invalidIds.length && savedRevision > local.revision && samePicks(local.playerIds, saved) && sameBackups(local.backups, savedBackups) && sameBudgetValues(localAmounts.maxBids, savedBudgets));
  const activeDraft = !state.endedAt && local && (!samePicks(local.playerIds, local.baseline) || !sameBackups(local.backups, local.baselineBackups) || !sameBudgetInputs(local.budgets, local.baselineBudgets)) && !acknowledged ? local : null;
  const draft = activeDraft?.playerIds ?? saved;
  const backups = activeDraft?.backups ?? savedBackups;
  const budgetInputs = activeDraft?.budgets ?? savedInputs;
  const targetIds = getTargetPlayerIds({ playerIds: draft, backups });
  const parsedBudgets = parseBudgetInputs(targetIds, budgetInputs);
  const invalidBudgets = new Set(parsedBudgets.invalidIds);
  const budgetPlan = privateBudgetPlan(state.players, draft, parsedBudgets.maxBids, team.purse, backups, team.id);
  const chains = getTargetChains(state.players, { teamId: team.id, playerIds: draft, backups });
  const chainMap = new Map(chains.map((chain) => [chain.firstChoiceId, chain]));
  const revision = activeDraft?.revision ?? savedRevision;
  const dirty = Boolean(activeDraft);
  const remoteChanged = Boolean(activeDraft && activeDraft.revision !== savedRevision);
  const unresolvedConflict = conflict && !acknowledged;
  const selected = new Set(draft);
  const backupIds = new Set(Object.values(backups));
  const playerMap = new Map(state.players.map((player) => [player.id, player]));
  const teamMap = new Map(state.teams.map((entry) => [entry.id, entry]));
  const liveId = !state.endedAt && !["sold", "unsold"].includes(state.phase) ? state.currentPlayerId : null;
  const pool = state.players.filter((player) => !player.catalogArchived);
  const query = search.trim().toLowerCase();
  const filtered = pool.filter((player) => {
    if (role && getPlayingRole(player) !== role) return false;
    if (availability === "on-table" && player.id !== liveId) return false;
    if (["available", "sold", "unsold"].includes(availability) && player.status !== availability) return false;
    return !query || `${player.name} ${player.country} ${getPlayingRole(player) ?? ""}`.toLowerCase().includes(query);
  });
  const remaining = chains.filter((chain) => chain.activePlayerId).length;
  const secured = chains.filter((chain) => chain.status === "secured").length;
  const activeBackups = chains.filter((chain) => chain.status === "backup-active").length;

  function statusFor(player?: Player): TargetStatus {
    if (!player || player.catalogArchived) return { label: "Removed from pool", tone: "removed" };
    if (player.status === "sold") return player.soldTo === team.id
      ? { label: "In your squad", tone: "won" }
      : { label: `Signed by ${teamMap.get(player.soldTo ?? "")?.shortName ?? "another team"}`, tone: "sold" };
    if (player.eligibilityVerified === false) return { label: "Unavailable for auction", tone: "removed" };
    if (player.id === liveId) return { label: "On the table", tone: "live" };
    return player.status === "unsold" ? { label: "Unsold", tone: "unsold" } : { label: "Available", tone: "available" };
  }

  function edit(playerId: string, remove = false) {
    if (savingRef.current || state.endedAt) return;
    const player = playerMap.get(playerId);
    if (!selected.has(playerId) && (!player || !isTargetPlayerEligible(player) || backupIds.has(playerId))) return;
    const next = selected.has(playerId) || remove ? draft.filter((id) => id !== playerId) : [...draft, playerId];
    const nextBackups = Object.fromEntries(Object.entries(backups).filter(([id]) => next.includes(id)));
    updateDraft(next, nextBackups, budgetInputs);
  }

  function updateDraft(playerIds: string[], nextBackups: Record<string, string>, budgets: BudgetInputs) {
    const ids = new Set(getTargetPlayerIds({ playerIds, backups: nextBackups }));
    const nextBudgets = Object.fromEntries(Object.entries(budgets).filter(([id]) => ids.has(id)));
    setLocal({ playerIds, baseline: activeDraft?.baseline ?? saved, backups: nextBackups, baselineBackups: activeDraft?.baselineBackups ?? savedBackups, budgets: nextBudgets, baselineBudgets: activeDraft?.baselineBudgets ?? savedInputs, revision });
    setNotice("");
    setError("");
    if (acknowledged) setConflict(false);
  }

  function editBudget(playerId: string, value: string) {
    if (savingRef.current || state.endedAt || !targetIds.includes(playerId)) return;
    updateDraft(draft, backups, { ...budgetInputs, [playerId]: value });
  }

  function editBackup(firstChoiceId: string, backupId?: string) {
    if (savingRef.current || state.endedAt || !selected.has(firstChoiceId)) return;
    const backupPlayer = backupId ? playerMap.get(backupId) : undefined;
    if (backupId && (selected.has(backupId) || (backupIds.has(backupId) && backups[firstChoiceId] !== backupId) || !backupPlayer || !isTargetPlayerEligible(backupPlayer))) return;
    const nextBackups = Object.fromEntries(Object.entries(backups).filter(([id]) => id !== firstChoiceId));
    if (backupId) Object.defineProperty(nextBackups, firstChoiceId, { value: backupId, enumerable: true, writable: true, configurable: true });
    updateDraft(draft, nextBackups, budgetInputs);
    setBackupFor(null);
  }

  async function save() {
    if (state.endedAt || savingRef.current || !dirty || !connected || remoteChanged || unresolvedConflict || invalidBudgets.size) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await onAction({ type: "set_target_picks", teamId: team.id, playerIds: draft, backups, maxBids: parsedBudgets.maxBids, expectedRevision: revision });
      setLocal(null);
      setConflict(false);
      setNotice("Targets saved. You’ll be notified when they come up.");
    } catch (failure) {
      if (failure instanceof AuctionRequestError && failure.code === "TARGET_PICKS_CONFLICT") {
        setConflict(true);
        setError("Your targets or budgets changed in another tab. Reload the saved list before making more changes.");
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
    setBackupFor(null);
  }

  function budgetField(id: string, chainSecured = false) {
    const player = playerMap.get(id);
    const inputId = `target-budget-${id}`;
    const invalid = invalidBudgets.has(id);
    const amount = budgetLimitValue(parsedBudgets.maxBids, id);
    const belowBase = player && amount !== undefined && amount < player.basePrice;
    const settled = chainSecured || !player || player.catalogArchived || player.status === "sold";
    return <>
      <div className={`target-budget-field${invalid ? " is-invalid" : ""}`}><label htmlFor={inputId}>Your max bid <span>Optional · ₹ Cr</span></label><input id={inputId} type="text" inputMode="decimal" autoComplete="off" aria-label={`Private limit for ${player?.name ?? "unavailable player"} in crores`} aria-invalid={invalid} aria-describedby={invalid || belowBase || settled ? `${inputId}-hint` : undefined} value={budgetInputValue(budgetInputs, id)} placeholder="No limit set" maxLength={12} disabled={saving || !!state.endedAt || settled} onChange={(event) => editBudget(id, event.target.value)} /></div>
      {(invalid || belowBase || settled) && <p id={`${inputId}-hint`} className={`target-budget-hint${invalid || (belowBase && !settled) ? " is-warning" : ""}`}>{invalid ? "Enter a positive amount with up to two decimal places." : settled ? "Excluded from your remaining plan." : `Below base price of ${formatMoney(player!.basePrice)}.`}</p>}
    </>;
  }

  return <section className="target-picks" aria-labelledby="target-picks-title" style={{ "--target-color": team.color } as CSSProperties} aria-busy={saving}>
    <header className="target-heading">
      <div className="target-heading-copy"><span className="target-team-crest"><TeamCrest team={team} /></span><div><span className="target-eyebrow">{team.shortName} / Private scouting room</span><h2 id="target-picks-title">My Target <em>Picks.</em></h2><p>Your first choice. A plan for what comes next.</p></div></div>
      <div className="target-private"><LockKeyhole size={16} /><span>Visible only to you</span></div>
    </header>

    <div className="target-strategy-strip"><div><span className="target-strategy-icon"><GitBranch size={23} strokeWidth={1.5} /></span><div><strong>One target. One optional backup.</strong><p>Keep your first choice in focus. Your backup becomes active if they join another team or leave the pool.</p></div></div><div className="target-strategy-metric"><strong>{String(activeBackups).padStart(2, "0")}</strong><span>Backups<br />active now</span></div></div>

    <div className="target-save-bar">
      <p className={`target-save-status ${dirty ? "is-dirty" : ""}`} role="status" aria-live="polite">{state.endedAt ? "Auction complete · Saved target list" : !connected ? "Reconnecting · Selections kept" : dirty ? `${draft.length} selected · Unsaved changes` : acknowledged ? "Targets saved. You’ll be notified when they come up." : notice || `${saved.length} saved targets · Edit anytime`}</p>
      <div>{(dirty || unresolvedConflict) && <button type="button" className="target-reload" onClick={reload} disabled={saving}><RotateCcw size={16} /><span>Reload saved targets</span></button>}<button type="button" className="target-save" disabled={!!state.endedAt || !dirty || saving || !connected || remoteChanged || unresolvedConflict || invalidBudgets.size > 0} onClick={save}>{saving ? <span className="target-spinner" /> : <Save size={17} />}{saving ? "Saving targets…" : "Save targets"}</button></div>
    </div>
    {(remoteChanged || unresolvedConflict) && <p className="target-warning" role="alert">Your targets or budgets changed in another tab. Your draft is preserved here. Reload saved targets to use the latest list.</p>}
    {error && !acknowledged && <p className="target-warning" role="alert">{error}</p>}
    {invalidBudgets.size > 0 && <p className="target-warning" role="alert">Check {invalidBudgets.size === 1 ? "the highlighted limit" : "the highlighted limits"} before saving. Use ₹0.01–1,000 Cr with up to two decimal places, or leave blank.</p>}

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
            const isBackup = backupIds.has(player.id);
            const unavailable = (!isTargetPlayerEligible(player) || isBackup) && !isSelected;
            return <li className={`target-player-card ${isSelected ? "is-selected" : ""}`} key={player.id} data-player-id={player.id}>
              <div className="target-player-art"><span className={`target-player-status tone-${status.tone}`}>{status.tone === "live" && <Radio size={12} />}{status.tone === "won" && <Check size={12} />}{status.label}</span><PlayerImage player={player} className="target-portrait" /><span className="target-art-ring" aria-hidden="true" /></div>
              <div className="target-player-copy"><h4>{player.name}</h4><p>{getPlayingRole(player) ?? "Role unavailable"}<span aria-hidden="true">·</span>{player.country}</p><div className="target-player-bottom"><span>Base<strong>{formatMoney(player.basePrice)}</strong></span><button type="button" className="target-toggle" role="checkbox" aria-checked={isSelected} aria-label={`Target ${player.name}`} disabled={!!state.endedAt || saving || unavailable} onClick={() => edit(player.id)}>{isSelected ? <Check size={17} /> : isBackup ? <GitBranch size={17} /> : <Plus size={17} />}<span>{isSelected ? "Targeted" : isBackup ? "Backup" : player.status === "sold" ? "Sold" : unavailable ? "Unavailable" : "Target"}</span></button></div></div>
            </li>;
          })}
        </ul>
        {!filtered.length && <div className="target-empty-results"><Search size={29} strokeWidth={1.4} /><h4>No match this time.</h4><p>Try another name or open up your filters.</p><button type="button" onClick={() => { setSearch(""); setRole(null); setAvailability("all"); setLimit(PAGE_SIZE); }}>Show every player<ChevronRight size={16} /></button></div>}
        {filtered.length > limit && <button type="button" className="target-load-more" onClick={() => setLimit((value) => value + PAGE_SIZE)}><ArrowDown size={17} />Load more players<span>{filtered.length - limit} remaining</span></button>}
      </section>

      <aside className="target-board" aria-labelledby="target-board-title">
        <div className="target-board-heading"><span className="target-section-kicker">02 / Your game plan</span><div><h3 id="target-board-title">The targets.</h3><span>{draft.length.toString().padStart(2, "0")}</span></div><p>Add an optional backup and private limits. Save your plan for timely bidding reminders.</p></div>
        <section className="target-budget-plan" aria-label="Private budget plan">
          <div><span>Remaining purse</span><strong>{formatMoney(team.purse)}</strong></div>
          <div><span>Planned limits{dirty ? " · Draft" : ""}</span><strong>{formatMoney(budgetPlan.planned)}</strong></div>
          <p className={budgetPlan.overallocated ? "is-overallocated" : ""}>{budgetPlan.overallocated ? `${formatMoney(budgetPlan.overallocated)} over your remaining purse` : `${formatMoney(budgetPlan.unallocated)} outside this plan`}</p>
          <span>{budgetPlan.unpriced} remaining {Object.keys(backups).length ? budgetPlan.unpriced === 1 ? "plan with an unset limit" : "plans with an unset limit" : budgetPlan.unpriced === 1 ? "target without a limit" : "targets without a limit"}</span>
          <p className="target-budget-note">{Object.keys(backups).length > 0 && <>Each pair counts its higher remaining limit once. </>}Planning only. Limits don’t reserve your purse or place bids.</p>
        </section>
        <div className="target-board-summary"><span><strong>{remaining}</strong>Still in play</span><span><strong>{secured}</strong>In your squad</span></div>
        {draft.length ? <ul className="target-shortlist" aria-label="Your target list">
          {draft.map((id, index) => {
            const player = playerMap.get(id);
            const status = statusFor(player);
            const chain = chainMap.get(id)!;
            const backup = chain.backupId ? playerMap.get(chain.backupId) : undefined;
            const backupStatus = statusFor(backup);
            const chainLabel = chain.status === "secured" ? "Target secured" : chain.status === "backup-active" ? "Backup active" : chain.status === "unavailable" ? "No active target" : "First choice active";
            const backupLabel = chain.status === "secured" ? "Plan complete · no backup reminder" : chain.status === "backup-active" ? "Your active target" : chain.status === "first-choice" && backup && isTargetPlayerEligible(backup) ? "On standby" : backupStatus.label;
            const canChooseBackup = !state.endedAt && !saving && chain.status !== "secured";
            return <li className={`target-chain is-${chain.status}`} key={id} data-player-id={id} data-chain-status={chain.status}>
              <div className="target-chain-heading"><span><span className="target-shortlist-number">{String(index + 1).padStart(2, "0")}</span>First choice</span><span className="target-chain-status">{chain.status === "secured" ? <Check size={12} /> : <span aria-hidden="true" />}{chainLabel}</span></div>
              <div className="target-first-choice"><div className="target-shortlist-person"><span className="target-shortlist-photo">{player ? <PlayerImage player={player} /> : <Target size={23} />}</span><div className="target-shortlist-copy"><strong>{player?.name ?? "Unavailable player"}</strong><small>{player ? getPlayingRole(player) ?? "Role unavailable" : ""}</small><span className={`tone-${status.tone}`}>{status.label}</span></div><button type="button" aria-label={`Remove ${player?.name ?? "unavailable player"} from targets`} disabled={!!state.endedAt || saving} onClick={() => edit(id, true)}><X size={16} /></button></div>
                {budgetField(id, chain.status === "secured")}</div>
              <div className="target-chain-connector" aria-hidden="true"><ArrowDownRight size={16} /><span>If unavailable</span></div>
              {chain.backupId ? <div className={`target-backup-slot${chain.status === "backup-active" ? " is-active" : ""}`} data-backup-player-id={chain.backupId}>
                <div className="target-backup-label"><span><GitBranch size={13} />Backup</span><button type="button" onClick={() => setBackupFor(id)} disabled={!canChooseBackup} aria-label={`Change backup for ${player?.name ?? "unavailable player"}`}>Change<ArrowRight size={12} /></button></div>
                <div className="target-shortlist-person"><span className="target-shortlist-photo">{backup ? <PlayerImage player={backup} /> : <Target size={23} />}</span><div className="target-shortlist-copy"><strong>{backup?.name ?? "Unavailable player"}</strong><small>{backup ? getPlayingRole(backup) ?? "Role unavailable" : ""}</small><span className={chain.status === "backup-active" ? "tone-backup-active" : `tone-${backupStatus.tone}`}>{backupLabel}</span></div><button type="button" aria-label={`Remove backup for ${player?.name ?? "unavailable player"}`} disabled={!!state.endedAt || saving} onClick={() => editBackup(id)}><X size={16} /></button></div>
                {budgetField(chain.backupId, chain.status === "secured")}
              </div> : <button type="button" className="target-add-backup" aria-label={`Add backup for ${player?.name ?? "unavailable player"}`} disabled={!canChooseBackup} onClick={() => setBackupFor(id)}><span><Plus size={18} /></span><span><strong>Add a backup</strong><small>Optional · one alternative</small></span><ChevronRight size={16} /></button>}
              {chain.status === "secured" && <p className="target-chain-note"><Check size={13} />Signing secured. This plan is complete.</p>}
            </li>;
          })}
        </ul> : <div className="target-shortlist-empty"><span><Target size={35} strokeWidth={1.3} /></span><h4>Who’s on your radar?</h4><p>Choose players from the pool. Add a few now and more as the auction unfolds.</p></div>}
        <div className="target-board-foot"><LockKeyhole size={14} /><span>Your targets stay private.</span>{dirty && <span className="target-board-unsaved">Unsaved</span>}</div>
      </aside>
    </div>
    {backupFor && selected.has(backupFor) && !state.endedAt && <TargetBackupPicker key={backupFor} firstChoice={playerMap.get(backupFor)} players={state.players} selectedIds={targetIds} currentBackupId={Object.hasOwn(backups, backupFor) ? backups[backupFor] : undefined} onSelect={(backupId) => editBackup(backupFor, backupId)} onClose={() => setBackupFor(null)} />}
  </section>;
}
