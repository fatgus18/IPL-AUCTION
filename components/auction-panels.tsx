"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleHelp, Globe2, LockKeyhole, Pencil, Plus, Search, ShieldCheck, SlidersHorizontal, Star, Trash2, Video, Wallet, X } from "lucide-react";
import { formatMoney, PLAYER_ROLES } from "@/lib/auction-display";
import type { AuctionAction, Player, RoomState } from "@/lib/auction";
import { PlayerImage } from "./ipl-visuals";
import { PlayerImporter } from "./player-importer";
import "./auction-panels.css";

type ManagementProps = { state: RoomState; isHost: boolean; onAction: (action: AuctionAction) => Promise<void> };

function PlayerPortrait({ player }: { player: Player }) {
  return <div className={`manage-avatar manage-avatar-${player.role === "Marquee" ? "gold" : player.isOverseas ? "blue" : "green"}`} aria-hidden="true">
    <PlayerImage player={player} className="manage-avatar-portrait"/>
  </div>;
}

function ErrorMessage({ children }: { children: ReactNode }) {
  return <p className="manage-error" role="alert">{children}</p>;
}

function Modal({ title, subtitle, children, onClose, busy = false }: { title: string; subtitle: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  return <dialog className="manage-dialog" ref={ref} aria-labelledby={titleId} aria-describedby={subtitleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="manage-dialog-head"><div><h2 id={titleId}>{title}</h2><p id={subtitleId}>{subtitle}</p></div><button type="button" className="manage-icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={19} /></button></div>
    {children}
  </dialog>;
}

function PlayerEditor({ player, onClose, onAction }: { player?: Player; onClose: () => void; onAction: ManagementProps["onAction"] }) {
  const [name, setName] = useState(player?.name ?? "");
  const [country, setCountry] = useState(player?.country === "Unverified" ? "" : player?.country ?? "");
  const [role, setRole] = useState<Player["role"] | "">(player?.role ?? "");
  const [basePrice, setBasePrice] = useState(String((player?.basePrice ?? 50) / 100));
  const [isOverseas, setOverseas] = useState(player?.isOverseas ?? false);
  const [overseasExplicit, setOverseasExplicit] = useState(false);
  const [stats, setStats] = useState(player?.stats ?? { matches: null, runs: null, wickets: null, strikeRate: null });
  const [statsFormat, setStatsFormat] = useState<Player["statsFormat"]>(player?.statsFormat ?? "Unknown");
  const [statsEdited, setStatsEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const price = Math.round(Number(basePrice) * 100);
    if (!name.trim() || !country.trim() || ["unverified", "unknown"].includes(country.trim().toLowerCase()) || !role || !Number.isFinite(price) || price < 1) { setError("Enter a player name, confirmed country, category, and a base price of at least ₹1 L."); return; }
    const factsEdited = !player || statsEdited || name.trim() !== player.name || country.trim() !== player.country;
    const values = { name: name.trim(), country: country.trim(), role, basePrice: price, isOverseas, stats, statsFormat, eligibilityVerified: true, ...(factsEdited ? { dataStatus: "manual" as const, dataUpdatedAt: undefined } : {}) };
    setBusy(true);
    try {
      await onAction(player ? { type: "update_player", player: { ...player, ...values } } : { type: "add_player", player: values });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The player could not be saved. Please try again."); }
    finally { setBusy(false); }
  }
  return <Modal title={player ? "Edit player" : "Add a player"} subtitle="Changes to this player are shared with every room." onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="manage-form">
      <div className="manage-form-grid">
        <label className="manage-field manage-full">Player name<input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Rishabh Pant" /></label>
        <label className="manage-field">Country<input required maxLength={50} value={country} onChange={(event) => { setCountry(event.target.value); if (!overseasExplicit) setOverseas(Boolean(event.target.value.trim()) && event.target.value.trim().toLowerCase() !== "india"); }} placeholder="e.g. India" /></label>
        <label className="manage-field">Player category<select required value={role} onChange={(event) => setRole(event.target.value as Player["role"])}><option value="">Choose a category</option>{PLAYER_ROLES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="manage-field manage-full">Base price (₹ crore)<input type="number" min="0.01" max="100" step="0.01" required value={basePrice} onChange={(event) => setBasePrice(event.target.value)} /><span className="manage-field-note">1 crore = 100 lakh. The opening bid starts here.</span></label>
      </div>
      <label className="manage-check"><input type="checkbox" checked={isOverseas} onChange={(event) => { setOverseas(event.target.checked); setOverseasExplicit(true); }} /><span>Overseas player<small>Counts towards the team’s overseas limit.</small></span><Globe2 size={18} /></label>
      <details className="manage-stat-details"><summary>Player statistics <span>Optional · leave unknown values blank</span></summary><div className="manage-form-grid"><label className="manage-field manage-full">Statistics format<select value={statsFormat} onChange={event => { setStatsFormat(event.target.value as Player["statsFormat"]); setStatsEdited(true); }}>{["Unknown", "IPL", "T20", "T20I", "ODI", "Test"].map(value => <option key={value}>{value}</option>)}</select></label>{(["matches", "runs", "wickets", "strikeRate"] as const).map((key) => <label className="manage-field" key={key}>{key === "strikeRate" ? "Strike rate" : key[0].toUpperCase() + key.slice(1)}<input type="number" min="0" placeholder="Not available" step={key === "strikeRate" ? "0.01" : "1"} value={stats[key] ?? ""} onChange={(event) => { setStats({ ...stats, [key]: event.target.value === "" ? null : Number(event.target.value) }); setStatsEdited(true); }} /></label>)}</div><p className="import-fact-note">Manually entered statistics are labeled as manual, with your selected format.</p></details>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="manage-dialog-actions"><button type="button" className="manage-button" disabled={busy} onClick={onClose}>Cancel</button><button className="manage-button manage-primary" disabled={busy} type="submit">{busy ? "Saving…" : player ? "Save changes" : "Add player"}{!busy && <Check size={16} />}</button></div>
    </form>
  </Modal>;
}

function DeletePlayer({ player, onClose, onAction }: { player: Player; onClose: () => void; onAction: ManagementProps["onAction"] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    try { await onAction({ type: "delete_player", playerId: player.id }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove this player."); }
    finally { setBusy(false); }
  }
  return <Modal title="Remove from the common catalog?" subtitle={`${player.name} will be removed for everyone. Players involved in an active auction or purchase cannot be removed.`} onClose={onClose} busy={busy}><div className="manage-form">{error && <ErrorMessage>{error}</ErrorMessage>}<div className="manage-dialog-actions"><button className="manage-button" disabled={busy} onClick={onClose}>Keep player</button><button className="manage-button manage-danger" disabled={busy} onClick={remove}>{busy ? "Removing…" : "Remove player"}<Trash2 size={16} /></button></div></div></Modal>;
}

type PlayerPoolProps = ManagementProps & { inRoom?: boolean; canSelect?: boolean };

export function PlayerPool({ state: roomState, isHost, onAction, inRoom = true, canSelect = isHost }: PlayerPoolProps) {
  const state = { ...roomState, players: roomState.players.filter(player => !player.catalogArchived) };
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("All players");
  const [status, setStatus] = useState("all");
  const [sheet, setSheet] = useState("all");
  const [quality, setQuality] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Player | "new" | null>(null);
  const [importing, setImporting] = useState<string | "new" | null>(null);
  const [deleting, setDeleting] = useState<Player | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const tableRef = useRef<HTMLDivElement>(null);
  const available = state.players.filter((player) => player.status === "available").length;
  const sold = state.players.filter((player) => player.status === "sold").length;
  const sourcedProfiles = state.players.filter(player => player.profileUrl && player.dataSources?.length && player.eligibilityVerified !== false).length;
  const completeStatistics = state.players.filter(player => Object.values(player.stats).every(value => value !== null)).length;
  const missingStatistics = state.players.length - completeStatistics;
  const sheets = [...new Set(state.players.flatMap(player => player.catalogSheets ?? []))].sort();
  const filtered = state.players.filter((player) =>
    (role === "All players" || player.role === role) &&
    (!inRoom || status === "all" || player.status === status) &&
    (sheet === "all" || (sheet === "custom" ? !player.catalogSheets?.length : player.catalogSheets?.includes(sheet))) &&
    (quality === "all" || (quality === "verified" ? Object.values(player.stats).every(value => value !== null) && player.eligibilityVerified !== false : quality === "manual" ? player.dataStatus === "manual" : Object.values(player.stats).some(value => value === null) || player.eligibilityVerified === false)) &&
    `${player.name} ${player.country} ${player.playingRole ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pageSize = 24;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visiblePlayers = filtered.slice(pageStart, pageStart + pageSize);
  const roundActive = ["live", "paused", "locked"].includes(state.phase);
  const hasFilters = Boolean(query || role !== "All players" || (inRoom && status !== "all") || sheet !== "all" || quality !== "all");
  function clearFilters() { setQuery(""); setRole("All players"); setStatus("all"); setSheet("all"); setQuality("all"); setPage(1); }
  function movePage(nextPage: number) { setPage(nextPage); tableRef.current?.scrollIntoView({ block: "start" }); }
  async function select(player: Player) {
    if (!inRoom || !canSelect) return;
    setPendingId(player.id); setError("");
    try { await onAction({ type: "select_player", playerId: player.id }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This player could not be selected."); }
    finally { setPendingId(null); }
  }
  return <section className="manage-panel" aria-labelledby="manage-pool-title">
    <div className="manage-section-heading"><div><div className="manage-eyebrow">SCOUT. SHORTLIST. SIGN.</div><h2 id="manage-pool-title">Player pool <span className="manage-count">{state.players.length}</span></h2><p>{inRoom ? "One catalog for everyone. Choose a player to bring to this room’s auction floor." : "Explore and curate the shared catalog. Every auction starts here."}</p></div>{isHost && <button className="manage-button manage-primary" onClick={() => setImporting("new")}><Plus size={17} />Add player</button>}</div>
    {inRoom ? <div className="manage-pool-summary"><span><i className="manage-dot" /><strong>{available.toString().padStart(2, "0")}</strong><span>Available<br /><small>Ready for the block</small></span></span><span><i className="manage-dot manage-dot-green" /><strong>{sold.toString().padStart(2, "0")}</strong><span>Signed<br /><small>Dreams taking shape</small></span></span><span><i className="manage-dot manage-dot-gray" /><strong>{(state.players.length - available - sold).toString().padStart(2, "0")}</strong><span>Unsold<br /><small>Another opportunity</small></span></span><span className="manage-summary-note"><ShieldCheck size={18} /><span>{isHost ? "Shared pool. Your auction." : "Auctioneer managed"}<small>{isHost ? "Choose who goes under the hammer." : "The next star is one selection away."}</small></span></span></div> : <div className="manage-pool-summary"><span><i className="manage-dot" /><strong>{state.players.length}</strong><span>Players</span></span><span><i className="manage-dot manage-dot-green" /><strong>{new Set(state.players.map(player => player.role)).size}</strong><span>Categories</span></span><span><i className="manage-dot manage-dot-gray" /><strong>{state.players.filter(player => player.isOverseas).length}</strong><span>Overseas</span></span><span className="manage-summary-note"><ShieldCheck size={18} /><span>One shared catalog<small>Player updates are available in every room.</small></span></span></div>}
    <div className="pool-data-summary"><span><ShieldCheck size={16} /><strong>{sourcedProfiles}</strong> sourced profiles</span><span><Check size={16} /><strong>{completeStatistics}</strong> complete career stat sets</span><span><CircleHelp size={16} /><strong>{missingStatistics}</strong> with unavailable statistics</span><span>Open any player to inspect sources and statistics.</span></div>
    <div className="manage-filters"><label className="manage-search"><Search size={18} /><input aria-label="Search player name or country" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search the full player catalog…" />{query && <button aria-label="Clear search" onClick={() => { setQuery(""); setPage(1); }}><X size={15} /></button>}</label>{inRoom && <label className="manage-status-filter"><SlidersHorizontal size={16} /><select aria-label="Filter player status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="available">Available</option><option value="sold">Sold</option><option value="unsold">Unsold</option></select></label>}</div>
    <div className="pool-source-filters"><label>Source sheet<select aria-label="Filter source sheet" value={sheet} onChange={event => { setSheet(event.target.value); setPage(1); }}><option value="all">All source sheets</option>{sheets.map(value => <option key={value}>{value}</option>)}<option value="custom">Custom additions</option></select></label><label>Profile data<select aria-label="Filter profile data quality" value={quality} onChange={event => { setQuality(event.target.value); setPage(1); }}><option value="all">All profile data</option><option value="verified">Complete career stats</option><option value="needs_review">Missing statistics or unverified</option><option value="manual">Manual details</option></select></label>{hasFilters && <button type="button" onClick={clearFilters}><X size={14} />Clear filters</button>}</div>
    <div className="manage-role-tabs" aria-label="Filter player category">{["All players", ...PLAYER_ROLES].map((value) => <button key={value} className={role === value ? "manage-role-active" : ""} onClick={() => { setRole(value); setPage(1); }} aria-pressed={role === value}>{value === "Marquee" && <Star size={12} />}{value}<span>{value === "All players" ? state.players.length : state.players.filter((player) => player.role === value).length}</span></button>)}</div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    <div className="manage-player-table-wrap" ref={tableRef}><table className="manage-player-table"><thead><tr><th>Player / profile</th><th>Category</th><th>Base price</th>{inRoom && <th>In this room</th>}{isHost && <th><span className="manage-sr-only">Actions</span></th>}</tr></thead><tbody>{visiblePlayers.map((player) => {
      const current = inRoom && state.currentPlayerId === player.id;
      const onBlock = current && !["sold", "unsold"].includes(state.phase);
      const locked = inRoom && (player.status === "sold" || (current && (state.phase !== "waiting" || state.leadingTeamId !== null)));
      const team = state.teams.find((item) => item.id === player.soldTo);
      const sourced = Boolean(player.profileUrl && player.dataSources?.length && player.eligibilityVerified !== false);
      const allStatsMissing = Object.values(player.stats).every(value => value === null);
      const profileLabel = player.dataStatus === "manual" ? "Manual details · Review" : player.dataStatus === "verified" ? `${player.statsFormat && player.statsFormat !== "Unknown" ? `${player.statsFormat} · ` : ""}Sourced stats` : sourced ? allStatsMissing ? "Profile · stats unavailable" : "Profile · partial career stats" : "Fetch player details";
      return <tr key={player.id} className={onBlock ? "manage-row-current" : ""}><td><div className="manage-player-name"><PlayerPortrait player={player} /><div><button type="button" className="pool-player-profile" onClick={() => setImporting(player.id)} aria-label={`View details for ${player.name}`}>{player.name}<ArrowUpRight size={13} /></button><span>{player.country === "Unverified" ? "Country needs confirmation" : player.country}{player.isOverseas && <Globe2 size={12} aria-label="Overseas player" />}</span><button type="button" className={`pool-profile-status ${player.dataStatus === "verified" ? "pool-profile-verified" : ""}`} onClick={() => setImporting(player.id)}>{sourced ? <ShieldCheck size={12} /> : <Search size={12} />}{profileLabel}</button></div></div></td><td><span className={`manage-category ${player.role === "Marquee" ? "manage-category-marquee" : ""}`}>{player.role === "Marquee" && <Star size={11} />}{player.role}</span></td><td className="manage-price">{formatMoney(player.basePrice)}</td>{inRoom && <td><div className="manage-player-status"><span className={`manage-status manage-status-${onBlock ? "current" : player.status}`}>{onBlock ? "On the block" : player.status === "sold" ? "Sold" : player.status === "unsold" ? "Unsold" : "Available"}</span>{player.status === "sold" && <small>{team?.shortName ?? "Team"} · {formatMoney(player.soldFor ?? 0)}</small>}{player.eligibilityVerified === false && <small className="pool-eligibility-warning">Confirm eligibility</small>}</div></td>}{isHost && <td><div className="manage-row-actions">{inRoom && canSelect && <button className="manage-select-button" disabled={player.status === "sold" || roundActive || onBlock || pendingId !== null} title={roundActive ? "Finish the current round before selecting another player" : "Put this player on the auction block"} onClick={() => select(player)}>{pendingId === player.id ? "Selecting…" : "Select"}<ArrowUpRight size={14} /></button>}<button className="manage-icon-button" aria-label={`Edit ${player.name}`} disabled={locked} title={locked ? "Sold players and active auctions cannot be edited" : "Edit player manually"} onClick={() => setEditing(player)}><Pencil size={15} /></button><button className="manage-icon-button manage-delete-icon" aria-label={`Remove ${player.name}`} disabled={inRoom && (current || player.status === "sold")} onClick={() => setDeleting(player)}><Trash2 size={15} /></button></div></td>}</tr>;
    })}</tbody></table></div>
    {filtered.length === 0 && <div className="manage-empty"><Search size={28} /><h3>No players found</h3><p>{hasFilters ? "Try another search or adjust your filters." : "Add your first player to start building the pool."}</p>{hasFilters && <button className="manage-button" onClick={clearFilters}>Clear filters</button>}</div>}
    <div className="pool-pagination"><span>Showing {filtered.length ? pageStart + 1 : 0}–{Math.min(pageStart + pageSize, filtered.length)} of {filtered.length} players{hasFilters ? ` · ${state.players.length} in pool` : ""}</span><nav aria-label="Player pool pages"><button type="button" aria-label="Previous player page" disabled={currentPage <= 1} onClick={() => movePage(currentPage - 1)}><ChevronLeft size={17} /></button><span>Page {currentPage} of {pageCount}</span><button type="button" aria-label="Next player page" disabled={currentPage >= pageCount} onClick={() => movePage(currentPage + 1)}><ChevronRight size={17} /></button></nav></div>
    {importing && <PlayerImporter state={state} isHost={isHost} existingPlayer={importing === "new" ? undefined : state.players.find(player => player.id === importing)} initialQuery={importing === "new" ? query : undefined} onClose={() => setImporting(null)} onAction={onAction} onManual={player => { setImporting(null); setEditing(player ?? "new"); }} />}
    {editing && <PlayerEditor player={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onAction={onAction} />}
    {deleting && <DeletePlayer player={deleting} onClose={() => setDeleting(null)} onAction={onAction} />}
  </section>;
}

export { TeamSquads as Squads } from "./team-squads";

export function RoomSettings(props: ManagementProps) {
  const [savedRoom, setSavedRoom] = useState<string | null>(null);
  return <SettingsForm key={JSON.stringify(props.state.settings)} {...props} saved={savedRoom === props.state.code} setSaved={(value) => setSavedRoom(value ? props.state.code : null)} />;
}

function SettingsForm({ state, isHost, onAction, saved, setSaved }: ManagementProps & { saved: boolean; setSaved: (value: boolean) => void }) {
  const [cooldown, setCooldown] = useState(state.settings.bidCooldownMs);
  const [increment, setIncrement] = useState(String(state.settings.bidIncrement));
  const [purse, setPurse] = useState(String(state.settings.purse / 100));
  const [maxSquad, setMaxSquad] = useState(String(state.settings.maxSquadSize));
  const [maxOverseas, setMaxOverseas] = useState(String(state.settings.maxOverseas));
  const [callUrl, setCallUrl] = useState(state.settings.callUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasStarted = state.bidHistory.length > 0 || state.teams.some((team) => team.squad.length > 0) || state.currentBid > 0;
  const roundActive = ["live", "paused", "locked"].includes(state.phase);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaved(false);
    const trimmedUrl = callUrl.trim();
    if (trimmedUrl) {
      try { const url = new URL(trimmedUrl); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
      catch { setError("Use a complete, secure call link starting with https://."); return; }
    }
    if (Number(maxOverseas) > Number(maxSquad)) { setError("The overseas limit cannot be higher than the squad size."); return; }
    setBusy(true);
    try {
      await onAction({ type: "update_settings", settings: { ...(!roundActive ? { bidCooldownMs: cooldown, bidIncrement: Number(increment) } : {}), maxSquadSize: Number(maxSquad), maxOverseas: Number(maxOverseas), callUrl: trimmedUrl, ...(!hasStarted ? { purse: Math.round(Number(purse) * 100) } : {}) } });
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The settings could not be saved. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="manage-panel" aria-labelledby="manage-settings-title"><div className="manage-section-heading"><div><div className="manage-eyebrow">YOUR AUCTION. YOUR RULES.</div><h2 id="manage-settings-title">Room settings</h2><p>Set the pace, the purse, and the path to a championship squad.</p></div><span className="manage-soft-pill"><ShieldCheck size={16} />{isHost ? "Auctioneer controls" : "View only"}</span></div><form className="manage-settings-form" onSubmit={submit}><fieldset disabled={!isHost || busy}>
    <div className="manage-settings-section"><div className="manage-setting-intro"><div className="manage-setting-icon"><SlidersHorizontal size={19} /></div><h3>Bidding rhythm</h3><p>A short pause between accepted bids keeps everyone in sync.</p></div><div className="manage-setting-fields"><span className="manage-field-label" id="manage-cooldown-label">Bid cooldown</span><div className="manage-cooldowns" role="group" aria-labelledby="manage-cooldown-label">{[1000, 2000].map((value) => <button type="button" disabled={roundActive} className={cooldown === value ? "manage-cooldown-selected" : ""} aria-pressed={cooldown === value} key={value} onClick={() => { setCooldown(value); setSaved(false); }}><span>{value / 1000} second{value === 2000 ? "s" : ""}</span><small>{value === 1000 ? "Quick & flowing" : "A little breathing room"}</small>{cooldown === value && <Check size={16} />}</button>)}</div><label className="manage-field manage-compact-field">Bid increment (₹ lakh)<input type="number" required min="5" max="500" step="1" disabled={roundActive} value={increment} onChange={(event) => { setIncrement(event.target.value); setSaved(false); }} /><span className="manage-field-note">{roundActive ? <><LockKeyhole size={12} />Change bidding rules between players.</> : "Each new bid increases by this amount."}</span></label></div></div>
    <div className="manage-settings-section"><div className="manage-setting-intro"><div className="manage-setting-icon"><Wallet size={19} /></div><h3>Team rules</h3><p>Equal purses. Clear limits. Let the strategy do the talking.</p></div><div className="manage-setting-fields manage-form-grid"><label className="manage-field manage-full">Starting purse (₹ crore)<input type="number" required min="1" max="1000" step="1" value={purse} disabled={hasStarted || !isHost || busy} onChange={(event) => { setPurse(event.target.value); setSaved(false); }} /><span className="manage-field-note">{hasStarted ? <><LockKeyhole size={12} />Locked after the first bid or sale.</> : "The same starting budget for every team."}</span></label><label className="manage-field">Maximum squad size<input type="number" required min="1" max="30" step="1" value={maxSquad} onChange={(event) => { setMaxSquad(event.target.value); setSaved(false); }} /></label><label className="manage-field">Maximum overseas players<input type="number" required min="0" max="30" step="1" value={maxOverseas} onChange={(event) => { setMaxOverseas(event.target.value); setSaved(false); }} /></label></div></div>
    <div className="manage-settings-section"><div className="manage-setting-intro"><div className="manage-setting-icon"><Video size={19} /></div><h3>Bring the room together</h3><p>Add your Google Meet, Zoom, or other call link for everyone to join.</p></div><div className="manage-setting-fields"><label className="manage-field">Voice or video call link <span className="manage-optional">Optional</span><input type="url" value={callUrl} maxLength={2000} placeholder="https://meet.google.com/…" onChange={(event) => { setCallUrl(event.target.value); setSaved(false); }} /><span className="manage-field-note">The call opens in a new tab, alongside your auction.</span></label><div className="manage-info-note"><Video size={17} /><span>Use your favorite calling app. Your shared link stays with this room.</span></div></div></div>
  </fieldset>{error && <ErrorMessage>{error}</ErrorMessage>}<div className="manage-settings-actions"><span>{saved ? <><Check size={15} />Settings saved</> : <><ShieldCheck size={15} />{isHost ? "Changes apply to everyone in this room." : "Only the auctioneer can change these settings."}</>}</span>{isHost && <button type="submit" className="manage-button manage-primary" disabled={busy}>{busy ? "Saving…" : "Save settings"}<Check size={16} /></button>}</div></form></section>;
}
