"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, Check, CircleHelp, Globe2, Layers3, LockKeyhole, Pencil, Plus, Search, ShieldCheck, SlidersHorizontal, Trash2, Trophy, Users, Video, Wallet, X } from "lucide-react";
import { formatMoney, PLAYER_ROLES, type AuctionAction, type Player, type RoomState } from "@/lib/auction";
import "./auction-panels.css";

type ManagementProps = { state: RoomState; isHost: boolean; onAction: (action: AuctionAction) => Promise<void> };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("");
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
  const [country, setCountry] = useState(player?.country ?? "India");
  const [role, setRole] = useState<Player["role"]>(player?.role ?? "Batter");
  const [basePrice, setBasePrice] = useState(String((player?.basePrice ?? 50) / 100));
  const [isOverseas, setOverseas] = useState(player?.isOverseas ?? false);
  const [stats, setStats] = useState(player?.stats ?? { matches: 0, runs: 0, wickets: 0, strikeRate: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const price = Math.round(Number(basePrice) * 100);
    if (!name.trim() || !country.trim() || !Number.isFinite(price) || price < 1) { setError("Enter a player name, country, and a base price of at least ₹1 L."); return; }
    const values = { name: name.trim(), country: country.trim(), role, basePrice: price, isOverseas, stats };
    setBusy(true);
    try {
      await onAction(player ? { type: "update_player", player: { ...player, ...values } } : { type: "add_player", player: values });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The player could not be saved. Please try again."); }
    finally { setBusy(false); }
  }
  return <Modal title={player ? "Edit player" : "Add a player"} subtitle="Build your player pool, your way." onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="manage-form">
      <div className="manage-form-grid">
        <label className="manage-field manage-full">Player name<input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Rishabh Pant" /></label>
        <label className="manage-field">Country<input required maxLength={50} value={country} onChange={(event) => setCountry(event.target.value)} placeholder="e.g. India" /></label>
        <label className="manage-field">Player category<select value={role} onChange={(event) => setRole(event.target.value as Player["role"])}>{PLAYER_ROLES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="manage-field manage-full">Base price (₹ crore)<input type="number" min="0.01" max="100" step="0.01" required value={basePrice} onChange={(event) => setBasePrice(event.target.value)} /><span className="manage-field-note">1 crore = 100 lakh. The opening bid starts here.</span></label>
      </div>
      <label className="manage-check"><input type="checkbox" checked={isOverseas} onChange={(event) => setOverseas(event.target.checked)} /><span>Overseas player<small>Counts towards the team’s overseas limit.</small></span><Globe2 size={18} /></label>
      <details className="manage-stat-details"><summary>Player statistics <span>Optional</span></summary><div className="manage-form-grid">{(["matches", "runs", "wickets", "strikeRate"] as const).map((key) => <label className="manage-field" key={key}>{key === "strikeRate" ? "Strike rate" : key[0].toUpperCase() + key.slice(1)}<input type="number" min="0" step={key === "strikeRate" ? "0.01" : "1"} value={stats[key]} onChange={(event) => setStats({ ...stats, [key]: Number(event.target.value) })} /></label>)}</div></details>
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
  return <Modal title="Remove from the pool?" subtitle={`${player.name} will no longer be available for this auction.`} onClose={onClose} busy={busy}><div className="manage-form">{error && <ErrorMessage>{error}</ErrorMessage>}<div className="manage-dialog-actions"><button className="manage-button" disabled={busy} onClick={onClose}>Keep player</button><button className="manage-button manage-danger" disabled={busy} onClick={remove}>{busy ? "Removing…" : "Remove player"}<Trash2 size={16} /></button></div></div></Modal>;
}

export function PlayerPool({ state, isHost, onAction }: ManagementProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("All players");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<Player | "new" | null>(null);
  const [deleting, setDeleting] = useState<Player | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const available = state.players.filter((player) => player.status === "available").length;
  const sold = state.players.filter((player) => player.status === "sold").length;
  const filtered = state.players.filter((player) => (role === "All players" || player.role === role) && (status === "all" || player.status === status) && `${player.name} ${player.country}`.toLowerCase().includes(query.trim().toLowerCase()));
  const roundActive = ["live", "paused", "locked"].includes(state.phase);
  async function select(player: Player) {
    setPendingId(player.id); setError("");
    try { await onAction({ type: "select_player", playerId: player.id }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This player could not be selected."); }
    finally { setPendingId(null); }
  }
  return <section className="manage-panel" aria-labelledby="manage-pool-title">
    <div className="manage-section-heading"><div><div className="manage-eyebrow">THE SHORTLIST</div><h2 id="manage-pool-title">Player pool <span className="manage-count">{state.players.length}</span></h2><p>Every great squad starts with a good shortlist.</p></div>{isHost && <button className="manage-button manage-primary" onClick={() => setEditing("new")}><Plus size={17} />Add player</button>}</div>
    <div className="manage-pool-summary"><span><i className="manage-dot" />{available} available</span><span><i className="manage-dot manage-dot-green" />{sold} sold</span><span><i className="manage-dot manage-dot-gray" />{state.players.length - available - sold} unsold</span><span className="manage-summary-note"><ShieldCheck size={15} />{isHost ? "You control the auction order" : "Managed by your auctioneer"}</span></div>
    <div className="manage-filters"><label className="manage-search"><Search size={18} /><input aria-label="Search player name or country" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players or countries…" />{query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={15} /></button>}</label><label className="manage-status-filter"><SlidersHorizontal size={16} /><select aria-label="Filter player status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="available">Available</option><option value="sold">Sold</option><option value="unsold">Unsold</option></select></label></div>
    <div className="manage-role-tabs" aria-label="Filter player category">{["All players", ...PLAYER_ROLES].map((value) => <button key={value} className={role === value ? "manage-role-active" : ""} onClick={() => setRole(value)} aria-pressed={role === value}>{value}</button>)}</div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    <div className="manage-player-table-wrap"><table className="manage-player-table"><thead><tr><th>Player</th><th>Category</th><th>Base price</th><th>Status</th>{isHost && <th><span className="manage-sr-only">Actions</span></th>}</tr></thead><tbody>{filtered.map((player) => {
      const current = state.currentPlayerId === player.id;
      const onBlock = current && !["sold", "unsold"].includes(state.phase);
      const locked = current || player.status === "sold";
      const team = state.teams.find((item) => item.id === player.soldTo);
      return <tr key={player.id}><td><div className="manage-player-name"><div className={`manage-avatar manage-avatar-${player.role === "Marquee" ? "orange" : player.isOverseas ? "blue" : "green"}`}>{initials(player.name)}</div><div><strong>{player.name}</strong><span>{player.country}{player.isOverseas && <Globe2 size={11} aria-label="Overseas player" />}</span></div></div></td><td><span className="manage-category">{player.role}</span></td><td className="manage-price">{formatMoney(player.basePrice)}</td><td><div className="manage-player-status"><span className={`manage-status manage-status-${onBlock ? "current" : player.status}`}>{onBlock ? "On the block" : player.status === "sold" ? "Sold" : player.status === "unsold" ? "Unsold" : "Available"}</span>{player.status === "sold" && <small>{team?.shortName ?? "Team"} · {formatMoney(player.soldFor ?? 0)}</small>}</div></td>{isHost && <td><div className="manage-row-actions"><button className="manage-select-button" disabled={player.status === "sold" || roundActive || onBlock || pendingId !== null} title={roundActive ? "Finish the current round before selecting another player" : "Put this player on the auction block"} onClick={() => select(player)}>{pendingId === player.id ? "Selecting…" : "Select"}<ArrowUpRight size={14} /></button><button className="manage-icon-button" aria-label={`Edit ${player.name}`} disabled={locked} title={locked ? "Current and sold players cannot be edited" : "Edit player"} onClick={() => setEditing(player)}><Pencil size={15} /></button><button className="manage-icon-button manage-delete-icon" aria-label={`Remove ${player.name}`} disabled={locked} onClick={() => setDeleting(player)}><Trash2 size={15} /></button></div></td>}</tr>;
    })}</tbody></table></div>
    {filtered.length === 0 && <div className="manage-empty"><Search size={28} /><h3>No players found</h3><p>{query || role !== "All players" || status !== "all" ? "Try another search or adjust your filters." : "Add your first player to start building the pool."}</p>{(query || role !== "All players" || status !== "all") && <button className="manage-button" onClick={() => { setQuery(""); setRole("All players"); setStatus("all"); }}>Clear filters</button>}</div>}
    <div className="manage-table-footer"><span>Showing {filtered.length} of {state.players.length} players</span><span><CircleHelp size={14} />Prices shown in INR</span></div>
    {editing && <PlayerEditor player={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onAction={onAction} />}
    {deleting && <DeletePlayer player={deleting} onClose={() => setDeleting(null)} onAction={onAction} />}
  </section>;
}

export function Squads({ state }: { state: RoomState; isHost?: boolean; onAction?: ManagementProps["onAction"] }) {
  const totalSold = state.teams.reduce((sum, team) => sum + team.squad.length, 0);
  return <section className="manage-panel" aria-labelledby="manage-squads-title"><div className="manage-section-heading"><div><div className="manage-eyebrow">THE BIG PICTURE</div><h2 id="manage-squads-title">Team squads</h2><p>Watch the teams take shape, one winning bid at a time.</p></div><span className="manage-soft-pill"><Users size={16} />{totalSold} players signed</span></div><div className="manage-squad-grid">{state.teams.map((team) => {
    const overseas = team.squad.filter((entry) => state.players.find((player) => player.id === entry.playerId)?.isOverseas).length;
    const spent = team.squad.reduce((sum, entry) => sum + entry.amount, 0);
    const pursePercentage = Math.max(0, Math.min(100, team.purse / Math.max(1, team.purse + spent) * 100));
    return <article className="manage-squad-card" key={team.id} style={{ "--manage-team-color": team.color } as CSSProperties}><div className="manage-squad-header"><div className="manage-team-badge">{team.shortName}</div><div><h3>{team.name}</h3><p>{team.squad.length} / {state.settings.maxSquadSize} players</p></div><Trophy size={20} className="manage-squad-trophy" /></div><div className="manage-squad-purse"><span>Purse remaining<strong>{formatMoney(team.purse)}</strong></span><span>Spent<strong>{formatMoney(spent)}</strong></span></div><div className="manage-purse-track" role="meter" aria-label={`${team.name} purse remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pursePercentage)}><span style={{ width: `${pursePercentage}%` }} /></div><div className="manage-squad-meta"><span><Users size={14} />{team.squad.length} players</span><span><Globe2 size={14} />{overseas} / {state.settings.maxOverseas} overseas</span></div><div className="manage-roster">{team.squad.length ? team.squad.map((entry) => {
      const player = state.players.find((item) => item.id === entry.playerId);
      return <div className="manage-roster-player" key={entry.playerId}><div><strong>{player?.name ?? "Player"}{player?.isOverseas && <Globe2 size={11} />}</strong><small>{player?.role}</small></div><span>{formatMoney(entry.amount)}</span></div>;
    }) : <div className="manage-roster-empty"><Layers3 size={22} /><span>A fresh slate.</span><p>The next winning bid could be theirs.</p></div>}</div></article>;
  })}</div></section>;
}

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
  return <section className="manage-panel" aria-labelledby="manage-settings-title"><div className="manage-section-heading"><div><div className="manage-eyebrow">MAKE IT YOURS</div><h2 id="manage-settings-title">Room settings</h2><p>A few ground rules for a great auction.</p></div><span className="manage-soft-pill"><ShieldCheck size={16} />{isHost ? "Auctioneer controls" : "View only"}</span></div><form className="manage-settings-form" onSubmit={submit}><fieldset disabled={!isHost || busy}>
    <div className="manage-settings-section"><div className="manage-setting-intro"><div className="manage-setting-icon"><SlidersHorizontal size={19} /></div><h3>Bidding rhythm</h3><p>A short pause between accepted bids keeps everyone in sync.</p></div><div className="manage-setting-fields"><span className="manage-field-label" id="manage-cooldown-label">Bid cooldown</span><div className="manage-cooldowns" role="group" aria-labelledby="manage-cooldown-label">{[1000, 2000].map((value) => <button type="button" disabled={roundActive} className={cooldown === value ? "manage-cooldown-selected" : ""} aria-pressed={cooldown === value} key={value} onClick={() => { setCooldown(value); setSaved(false); }}><span>{value / 1000} second{value === 2000 ? "s" : ""}</span><small>{value === 1000 ? "Quick & flowing" : "A little breathing room"}</small>{cooldown === value && <Check size={16} />}</button>)}</div><label className="manage-field manage-compact-field">Bid increment (₹ lakh)<input type="number" required min="5" max="500" step="1" disabled={roundActive} value={increment} onChange={(event) => { setIncrement(event.target.value); setSaved(false); }} /><span className="manage-field-note">{roundActive ? <><LockKeyhole size={12} />Change bidding rules between players.</> : "Each new bid increases by this amount."}</span></label></div></div>
    <div className="manage-settings-section"><div className="manage-setting-intro"><div className="manage-setting-icon"><Wallet size={19} /></div><h3>Team rules</h3><p>Equal purses. Clear limits. Let the strategy do the talking.</p></div><div className="manage-setting-fields manage-form-grid"><label className="manage-field manage-full">Starting purse (₹ crore)<input type="number" required min="1" max="1000" step="1" value={purse} disabled={hasStarted || !isHost || busy} onChange={(event) => { setPurse(event.target.value); setSaved(false); }} /><span className="manage-field-note">{hasStarted ? <><LockKeyhole size={12} />Locked after the first bid or sale.</> : "The same starting budget for every team."}</span></label><label className="manage-field">Maximum squad size<input type="number" required min="1" max="30" step="1" value={maxSquad} onChange={(event) => { setMaxSquad(event.target.value); setSaved(false); }} /></label><label className="manage-field">Maximum overseas players<input type="number" required min="0" max="30" step="1" value={maxOverseas} onChange={(event) => { setMaxOverseas(event.target.value); setSaved(false); }} /></label></div></div>
    <div className="manage-settings-section"><div className="manage-setting-intro"><div className="manage-setting-icon"><Video size={19} /></div><h3>Bring the room together</h3><p>Add your Google Meet, Zoom, or other call link for everyone to join.</p></div><div className="manage-setting-fields"><label className="manage-field">Voice or video call link <span className="manage-optional">Optional</span><input type="url" value={callUrl} maxLength={2000} placeholder="https://meet.google.com/…" onChange={(event) => { setCallUrl(event.target.value); setSaved(false); }} /><span className="manage-field-note">The call opens in a new tab, alongside your auction.</span></label><div className="manage-info-note"><Video size={17} /><span>Use your favorite calling app. Your shared link stays with this room.</span></div></div></div>
  </fieldset>{error && <ErrorMessage>{error}</ErrorMessage>}<div className="manage-settings-actions"><span>{saved ? <><Check size={15} />Settings saved</> : <><ShieldCheck size={15} />{isHost ? "Changes apply to everyone in this room." : "Only the auctioneer can change these settings."}</>}</span>{isHost && <button type="submit" className="manage-button manage-primary" disabled={busy}>{busy ? "Saving…" : "Save settings"}<Check size={16} /></button>}</div></form></section>;
}
