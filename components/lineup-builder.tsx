import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, Check, ChevronRight, Crown, Globe2, Plus, RotateCcw, Save, Search, Shield, Users, X } from "lucide-react";
import type { AuctionAction, Player, Team, TeamLineupInput } from "@/lib/auction";
import { AuctionRequestError } from "@/lib/auction-client";
import { countPlayingRoles, getPlayingRole } from "@/lib/player-roles";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import { LineupPlayerStats, LineupPlayerTooltip, LineupStatsProvider } from "./lineup-player-stats";
import "./lineup-builder.css";

type Lineup = TeamLineupInput;
type Draft = { value: Lineup; baseline: Lineup; revision: number };
type Group = "playingXI" | "substitutes";
type Position = { group: Group; index: number };
type LineupBuilderProps = { team: Team; players: Player[]; connected: boolean; onAction: (action: AuctionAction) => Promise<void> };
const LIMITS = { playingXI: 11, substitutes: 5 };
const filled = (ids: Array<string | null>) => ids.filter((id): id is string => Boolean(id));
const pad = (ids: Array<string | null> | undefined, length: number) => Array.from({ length }, (_, index) => ids?.[index] ?? null);

function readLineup(team: Team): Lineup {
  return {
    playingXI: pad(team.lineup?.playingXI, 11),
    substitutes: pad(team.lineup?.substitutes, 5),
    captainId: team.lineup?.captainId ?? null,
    viceCaptainId: team.lineup?.viceCaptainId ?? null,
  };
}

function sameLineup(left: Lineup, right: Lineup) {
  return left.captainId === right.captainId && left.viceCaptainId === right.viceCaptainId
    && pad(left.playingXI, 11).every((id, index) => id === (right.playingXI[index] ?? null))
    && pad(left.substitutes, 5).every((id, index) => id === (right.substitutes[index] ?? null));
}

/** Slot indexes are stable; room snapshots cannot erase an unsaved local draft. */
export function LineupBuilder({ team, players, connected, onAction }: LineupBuilderProps) {
  const [local, setLocal] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [picker, setPicker] = useState<Position | null>(null);
  const [inspected, setInspected] = useState<Position | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLElement | null>(null);
  const manageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const savingRef = useRef(false);
  const saved = readLineup(team);
  const savedRevision = team.lineup?.revision ?? 0;
  const acknowledged = Boolean(local && savedRevision > local.revision && sameLineup(local.value, saved));
  const activeDraft = local && !sameLineup(local.value, local.baseline) && !acknowledged ? local : null;
  const draft = activeDraft?.value ?? saved;
  const dirty = Boolean(activeDraft);
  const remoteChanged = Boolean(activeDraft && activeDraft.revision !== savedRevision);
  const revision = activeDraft?.revision ?? savedRevision;
  const playerMap = new Map(players.map((player) => [player.id, player]));
  const roster = team.squad.map(({ playerId }) => playerMap.get(playerId)).filter((player): player is Player => Boolean(player));
  const xiCount = filled(draft.playingXI).length;
  const subCount = filled(draft.substitutes).length;
  const selected = new Set([...filled(draft.playingXI), ...filled(draft.substitutes)]);
  const ready = xiCount === 11 && subCount === 5 && Boolean(draft.captainId && draft.viceCaptainId);
  const unavailable = [...selected].some((id) => !team.squad.some((purchase) => purchase.playerId === id));
  const busy = saving;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!picker || !dialog) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      const trigger = pickerTriggerRef.current;
      queueMicrotask(() => {
        if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
      });
    };
  }, [picker]);

  function edit(next: Lineup) {
    if (savingRef.current) return;
    if (!next.playingXI.includes(next.captainId ?? "")) next.captainId = null;
    if (!next.playingXI.includes(next.viceCaptainId ?? "")) next.viceCaptainId = null;
    setLocal({ value: next, baseline: activeDraft?.baseline ?? saved, revision });
    setNotice("");
    setError("");
    if (acknowledged) setConflict(false);
  }

  function openPicker(group: Group, index: number) {
    pickerTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearch("");
    setPicker({ group, index });
  }

  function choose(group: Group, index: number, playerId: string) {
    if (savingRef.current || !roster.some((player) => player.id === playerId)
      || (selected.has(playerId) && draft[group][index] !== playerId)) return;
    const next = [...draft[group]];
    next[index] = playerId;
    edit({ ...draft, [group]: next });
    setInspected({ group, index });
    setControlsOpen(false);
    setPicker(null);
  }

  function manage(group: Group, index: number, trigger: HTMLButtonElement) {
    manageTriggerRef.current = trigger;
    setInspected({ group, index });
    setControlsOpen(true);
    requestAnimationFrame(() => inspectorRef.current?.focus({ preventScroll: true }));
  }

  function closeControls() {
    setControlsOpen(false);
    setInspected(null);
    const trigger = manageTriggerRef.current;
    if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
  }

  function remove(group: Group, index: number) {
    const next = [...draft[group]];
    next[index] = null;
    edit({ ...draft, [group]: next });
  }

  function reorder(group: Group, index: number, direction: -1 | 1) {
    const next = [...draft[group]];
    const target = index + direction;
    if (target < 0 || target >= LIMITS[group]) return;
    [next[index], next[target]] = [next[target], next[index]];
    edit({ ...draft, [group]: next });
    setInspected({ group, index: target });
  }

  function move(group: Group, index: number) {
    const destination = group === "playingXI" ? "substitutes" : "playingXI";
    const open = draft[destination].findIndex((id) => !id);
    if (open === -1) return;
    const source = [...draft[group]];
    const target = [...draft[destination]];
    target[open] = source[index];
    source[index] = null;
    edit({ ...draft, [group]: source, [destination]: target });
    setInspected({ group: destination, index: open });
  }

  async function save() {
    if (savingRef.current || !dirty || !connected || remoteChanged || conflict) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await onAction({ type: "set_lineup", teamId: team.id, lineup: draft, expectedRevision: revision });
      setLocal(null);
      setConflict(false);
      setNotice("Lineup saved to your room.");
    } catch (failure) {
      if (failure instanceof AuctionRequestError && failure.code === "LINEUP_CONFLICT") {
        setConflict(true);
        setError("Your lineup changed in another tab. Your edits are still here; reload the saved lineup before continuing.");
      } else {
        setError(failure instanceof Error ? failure.message : "Your lineup could not be saved. Your edits are still here.");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function reload() {
    setLocal(null);
    setConflict(false);
    setError("");
    setNotice("Showing your saved lineup.");
  }

  function slots(group: Group) {
    const isXI = group === "playingXI";
    return draft[group].map((id, index) => {
      const player = id ? playerMap.get(id) : undefined;
      const title = `${isXI ? "XI" : "substitute"} position ${index + 1}`;
      const captain = Boolean(id && id === draft.captainId);
      const viceCaptain = Boolean(id && id === draft.viceCaptainId);
      const active = inspected?.group === group && inspected.index === index;
      return <li className={`lineup-slot ${id ? "lineup-slot-filled" : "lineup-slot-empty"} ${active ? "lineup-slot-inspected" : ""}`} key={`${group}-${index}`} data-player-id={id ?? ""} data-position={index + 1}>
        <span className="lineup-position" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <LineupPlayerTooltip player={player} disabled={busy || Boolean(picker) || controlsOpen}><button className="lineup-slot-pick" type="button" disabled={busy} onClick={() => openPicker(group, index)} aria-label={`${id ? "Change player at" : "Choose player for"} ${title}`}>
          {player ? <><span className="lineup-player-photo"><PlayerImage player={player} className="lineup-portrait" /></span><span className="lineup-selection-copy"><strong>{player.name}</strong><span className="lineup-player-detail">{getPlayingRole(player) ?? "Role unavailable"}</span></span></>
            : id ? <span className="lineup-selection-copy"><strong>Player unavailable</strong><span className="lineup-player-detail">Choose a replacement</span></span>
            : <><span className="lineup-empty-figure" aria-hidden="true"><span className="lineup-empty-number">{String(index + 1).padStart(2, "0")}</span><span className="lineup-add"><Plus size={23} strokeWidth={1.5} /></span></span><span className="lineup-selection-copy"><strong>{isXI ? `Position ${index + 1}` : `Substitute ${index + 1}`}</strong><span className="lineup-player-detail">Choose player</span></span></>}
        </button></LineupPlayerTooltip>
        {(captain || viceCaptain) && <span className="lineup-captain-badge" aria-label={captain ? "Captain" : "Vice captain"}>{captain ? "C" : "VC"}</span>}
        {player && <button className="lineup-manage" type="button" disabled={busy} aria-label={`Manage ${player.name}`} aria-pressed={active} onClick={(event) => manage(group, index, event.currentTarget)}>Manage<ChevronRight size={13} /></button>}
      </li>;
    });
  }

  const filteredRoster = roster.filter((player) => `${player.name} ${getPlayingRole(player) ?? ""} ${player.country}`.toLowerCase().includes(search.toLowerCase().trim()));
  const xiPlayers = filled(draft.playingXI).map((id) => playerMap.get(id)).filter((player): player is Player => Boolean(player));
  const composition = countPlayingRoles(xiPlayers);
  const focusedId = inspected ? draft[inspected.group][inspected.index] : null;
  const focusedPlayer = focusedId ? playerMap.get(focusedId) : undefined;
  const focusedXI = inspected?.group === "playingXI";
  const focusedCaptain = Boolean(focusedId && draft.captainId === focusedId);
  const focusedVice = Boolean(focusedId && draft.viceCaptainId === focusedId);

  return <LineupStatsProvider><section className="lineup-builder" aria-labelledby="lineup-title" aria-busy={saving} style={{ "--squad-color": team.color } as CSSProperties}>
    <header className="lineup-header">
      <div className="lineup-heading"><span className="lineup-team-crest"><TeamCrest team={team} /></span><div><span className="lineup-eyebrow">{team.shortName} / Team sheet</span><h2 id="lineup-title">Build my <em>XI.</em></h2></div></div>
      <div className="lineup-header-progress"><span className={`lineup-readiness ${ready ? "lineup-ready" : ""}`}>{ready ? <Check size={17} /> : <Users size={17} />}{ready ? "Matchday ready" : `${xiCount} / 11 starters`}</span><span>{subCount} / 5 substitutes</span></div>
    </header>

    {(remoteChanged || (conflict && !acknowledged)) && <div className="lineup-warning" role="alert">A newer lineup was saved in another tab. Your draft is preserved. Reload the saved lineup to discard these edits and use the latest version.</div>}
    {unavailable && <div className="lineup-warning" role="alert">A selected player is no longer in your squad. Remove them before saving.</div>}
    {error && !acknowledged && <p className="lineup-error" role="alert">{error}</p>}
    <div className="lineup-save-bar">
      <p className={`lineup-save-status ${dirty ? "lineup-save-pending" : ""}`} role="status" aria-live="polite">{!connected ? "Reconnecting · Draft kept" : dirty ? "Unsaved changes" : acknowledged ? "Lineup saved to your room." : notice || (savedRevision ? "Your saved lineup is up to date." : "Partial lineups can be saved.")}</p>
      <div>{(dirty || conflict) && <button type="button" className="lineup-reload" onClick={reload} disabled={saving} aria-label="Reload saved lineup" title="Reload saved lineup"><RotateCcw size={16} /><span>Reload saved lineup</span></button>}<button type="button" className="lineup-save" onClick={save} disabled={!dirty || saving || !connected || remoteChanged || conflict || unavailable}>{saving ? <span className="lineup-spinner" aria-hidden="true" /> : <Save size={17} />}{saving ? "Saving lineup…" : "Save lineup"}</button></div>
    </div>

    <div className="lineup-studio">
      <div className="lineup-ground-column">
        <div className="lineup-ground">
          <div className="lineup-ground-top"><span><span className="lineup-ground-dot" />Playing XI</span><span>Batting order · 01—11</span></div>
          <div className="lineup-field-markings" aria-hidden="true"><div className="lineup-inner-circle" /><div className="lineup-pitch"><i /><i /></div><span>{team.shortName}</span></div>
          <div className="lineup-starting"><ol className="lineup-slots lineup-xi-slots" aria-label="Playing XI in batting order">{slots("playingXI")}</ol></div>
          <div className="lineup-ground-bottom"><Shield size={14} /><span>Choose any position to add a player</span></div>
        </div>
        <div className="lineup-bench"><div className="lineup-group-heading"><h3>THE BENCH <span>{subCount} / 5</span></h3><span>Substitutes</span></div><ol className="lineup-slots" aria-label="Substitutes">{slots("substitutes")}</ol></div>
      </div>

      <aside className="lineup-console" aria-label="Lineup management">
        <div className="lineup-leadership">
          <h3>Leadership</h3>
          {([{ key: "captainId", label: "Captain", badge: "C" }, { key: "viceCaptainId", label: "Vice captain", badge: "VC" }] as const).map(({ key, label, badge }) => {
            const leader = draft[key] ? playerMap.get(draft[key]) : undefined;
            return <div className="lineup-leader" key={key} data-leadership={key} data-player-id={draft[key] ?? ""}>
              <span className="lineup-leader-art" aria-hidden="true">{leader ? <PlayerImage player={leader} /> : badge === "C" ? <Crown size={24} strokeWidth={1.2} /> : <Shield size={24} strokeWidth={1.2} />}</span>
              <span className="lineup-leader-copy"><span>{label}</span><strong>{draft[key] ? leader?.name ?? "Player unavailable" : "Choose your leader"}</strong></span>
              <span className="lineup-leader-badge" aria-hidden="true">{badge}</span>
            </div>;
          })}
        </div>

        <div className={`lineup-inspector ${controlsOpen ? "lineup-controls-open" : ""}`} ref={inspectorRef} tabIndex={-1} role="region" aria-label="Selected position" onKeyDown={(event) => { if (event.key === "Escape" && controlsOpen) { event.preventDefault(); event.stopPropagation(); closeControls(); } }}>
          {focusedPlayer && inspected ? <>
            <div className="lineup-inspector-top"><span>{focusedXI ? "Batting position" : "Substitute"} <strong>{String(inspected.index + 1).padStart(2, "0")}</strong></span><button type="button" aria-label="Close player controls" onClick={closeControls}><X size={17} /></button></div>
            <div className="lineup-inspector-player"><span className="lineup-inspector-photo"><PlayerImage player={focusedPlayer} /></span><span><strong>{focusedPlayer.name}</strong><span>{getPlayingRole(focusedPlayer) ?? "Role unavailable"}</span><span className="lineup-inspector-country">{focusedPlayer.isOverseas && <Globe2 size={13} />}{focusedPlayer.country}</span></span></div>
            <LineupPlayerStats player={focusedPlayer} />
            {focusedXI && <div className="lineup-leader-choices" aria-label={`Leadership for ${focusedPlayer.name}`}>
              <button type="button" aria-label={`Make ${focusedPlayer.name} captain`} aria-pressed={focusedCaptain} disabled={busy || focusedVice} onClick={() => edit({ ...draft, captainId: focusedCaptain ? null : focusedId })}><Crown size={16} />Captain</button>
              <button type="button" aria-label={`Make ${focusedPlayer.name} vice captain`} aria-pressed={focusedVice} disabled={busy || focusedCaptain} onClick={() => edit({ ...draft, viceCaptainId: focusedVice ? null : focusedId })}><Shield size={16} />Vice captain</button>
            </div>}
            <div className="lineup-order-controls"><span>{focusedXI ? "Batting order" : "Bench order"}</span><div><button type="button" disabled={busy || inspected.index === 0} onClick={() => reorder(inspected.group, inspected.index, -1)} aria-label={`Move ${focusedPlayer.name} up in ${focusedXI ? "batting order" : "substitute order"}`} title="Move up"><ArrowUp size={17} /></button><button type="button" disabled={busy || inspected.index === LIMITS[inspected.group] - 1} onClick={() => reorder(inspected.group, inspected.index, 1)} aria-label={`Move ${focusedPlayer.name} down in ${focusedXI ? "batting order" : "substitute order"}`} title="Move down"><ArrowDown size={17} /></button></div></div>
            <div className="lineup-slot-actions"><button type="button" disabled={busy || !draft[focusedXI ? "substitutes" : "playingXI"].includes(null)} onClick={() => move(inspected.group, inspected.index)} aria-label={`Move ${focusedPlayer.name} to ${focusedXI ? "substitutes" : "playing XI"}`}><ArrowLeftRight size={15} />{focusedXI ? "Move to bench" : "Move to XI"}</button><button className="lineup-remove" type="button" disabled={busy} onClick={() => remove(inspected.group, inspected.index)} aria-label={`Remove ${focusedPlayer.name} from ${focusedXI ? "playing XI" : "substitutes"}`}><X size={15} />Remove</button></div>
          </> : <div className="lineup-inspector-empty"><span className="lineup-inspector-diagram" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span><h3>{roster.length ? "Every position is yours." : "Your team starts here."}</h3><p>{roster.length ? "Pick a position on the ground. Manage a selected player to set leadership or change the order." : "Players you buy will be available to place in your XI."}</p></div>}
        </div>

        <div className="lineup-balance"><div className="lineup-console-heading"><h3>XI balance</h3><span>{xiCount} selected</span></div><dl>{composition.map(({ role, count }) => <div key={role}><dt>{role}</dt><dd><span className="lineup-balance-meter" aria-hidden="true"><i style={{ width: `${count / 11 * 100}%` }} /></span><strong>{count}</strong></dd></div>)}</dl><div className="lineup-overseas"><Globe2 size={15} /><span>Overseas in XI</span><strong>{xiPlayers.filter((player) => player.isOverseas).length}</strong></div></div>
      </aside>
    </div>

    <dialog className="lineup-picker" ref={dialogRef} aria-labelledby="lineup-picker-title" onCancel={() => setPicker(null)} onClose={(event) => { if (!event.currentTarget.open) setPicker(null); }} onClick={(event) => { if (event.target === event.currentTarget) setPicker(null); }}>
      {picker && <div className="lineup-picker-content">
        <header className="lineup-picker-header"><div><span>{team.shortName} · Your squad</span><h3 id="lineup-picker-title">{picker.group === "playingXI" ? "XI" : "Substitute"} position {picker.index + 1}</h3></div><button type="button" className="lineup-picker-close" onClick={() => setPicker(null)} aria-label="Close player picker"><X size={22} /></button></header>
        <label className="lineup-picker-search"><Search size={19} /><span className="lineup-sr-only">Search your squad</span><input type="search" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your squad" /></label>
        <div className="lineup-picker-grid">
          {filteredRoster.map((player) => {
            const current = draft[picker.group][picker.index] === player.id;
            const occupied = selected.has(player.id) && !current;
            const xiIndex = draft.playingXI.indexOf(player.id);
            const subIndex = draft.substitutes.indexOf(player.id);
            return <button key={player.id} className={`lineup-picker-player ${current ? "lineup-picker-current" : ""}`} type="button" disabled={occupied || busy} aria-label={`Select ${player.name}`} aria-pressed={current} onClick={() => choose(picker.group, picker.index, player.id)}>
              <span className="lineup-picker-art"><PlayerImage player={player} className="lineup-picker-portrait" /></span>
              <span className="lineup-picker-player-copy"><strong>{player.name}</strong><span>{getPlayingRole(player) ?? "Role unavailable"}</span></span>
              <span className="lineup-picker-availability">{current ? <><Check size={14} />Selected</> : occupied ? (xiIndex >= 0 ? `XI · ${String(xiIndex + 1).padStart(2, "0")}` : `Sub · ${String(subIndex + 1).padStart(2, "0")}`) : <><Plus size={14} />Select player</>}</span>
            </button>;
          })}
        </div>
        {!filteredRoster.length && <p className="lineup-picker-empty">{roster.length ? "No players match your search." : "Your purchased players will appear here."}</p>}
      </div>}
    </dialog>
  </section></LineupStatsProvider>;
}
