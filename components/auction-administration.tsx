"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Check, ClipboardCheck, FileCheck2, History, Pencil, Search, ShieldCheck, X } from "lucide-react";
import type { AuctionAction, Player, RoomState } from "@/lib/auction";
import { formatMoney } from "@/lib/auction-display";
import { parseCroreBid } from "@/lib/bid-input";
import { PlayerImage } from "./ipl-visuals";
import "./auction-results.css";

type Props = { state: RoomState; connected: boolean; onAction: (action: AuctionAction) => Promise<void> };
type SaleSelection = { player: Player; teamId: string; amount: number; revision: number };

function ResultDialog({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog className="result-dialog" ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><span className="result-dialog-symbol"><ShieldCheck size={24}/></span><h2 id={titleId}>{title}</h2><button type="button" aria-label="Close result dialog" disabled={busy} onClick={onClose}><X size={21}/></button></header>{children}
  </dialog>;
}

export function SaleAudit({ state }: { state: RoomState }) {
  const [limit, setLimit] = useState(15);
  const entries = state.saleCorrections ?? [];
  if (!entries.length) return null;
  return <details className="sale-audit"><summary><History size={19}/><span>Sale corrections</span><strong>{entries.length}</strong></summary><div className="sale-audit-content">
    <p>Recorded permanently with the creator’s reason and the original sale.</p>
    <ol>{entries.slice(-limit).reverse().map(entry => <li key={entry.id}>
      <div className="sale-audit-top"><strong>{entry.playerName}</strong><time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST</time></div>
      <div className="sale-audit-change"><span>{entry.before.teamName} · {formatMoney(entry.before.amount)}</span><ArrowRight size={16}/><strong>{entry.after ? `${entry.after.teamName} · ${formatMoney(entry.after.amount)}` : "Sale cancelled · purse refunded"}</strong></div>
      <p>{entry.reason}</p><span className="sale-audit-author">{entry.actorName} · Revision {entry.revision}</span>
    </li>)}</ol>
    {entries.length > limit && <button type="button" className="button secondary" onClick={() => setLimit(count => count + 30)}>Show earlier corrections</button>}
  </div></details>;
}

export function AuctionAdministration({ state, connected, onAction }: Props) {
  const [ending, setEnding] = useState<number | null>(null);
  const [selected, setSelected] = useState<SaleSelection | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(12);
  const activeRound = (state.auctionPausedAt !== undefined || ["live", "paused", "locked"].includes(state.phase));
  const players = new Map(state.players.map(player => [player.id, player]));
  const sales = state.teams.flatMap(team => team.squad.map(sale => ({ ...sale, team, player: players.get(sale.playerId) }))).filter(sale => sale.player);
  const filtered = sales.filter(sale => `${sale.player!.name} ${sale.team.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="auction-admin" aria-labelledby="auction-admin-heading">
    <div className="result-section-heading"><div><span className="result-overline"><ShieldCheck size={15}/>CREATOR CONTROLS</span><h2 id="auction-admin-heading">Results & final call</h2></div><span className="result-revision">Revision {state.resultsRevision ?? 0}</span></div>
    <div className="auction-end-card"><span className="auction-end-icon"><FileCheck2 size={28}/></span><div><h3>{state.endedAt ? "Auction completed" : "Ready to close the auction?"}</h3><p>{state.endedAt ? "Bidding is closed. Corrections remain available and are included in new downloads." : "End bidding and make the recap and Excel workbook available to everyone in the room."}</p></div>{!state.endedAt && <button type="button" className="button primary" disabled={!connected || activeRound} onClick={() => setEnding(state.resultsRevision ?? 0)}>End auction<ArrowRight size={17}/></button>}</div>
    {activeRound && <p className="result-notice">{state.auctionPausedAt !== undefined ? "Resume the auction before ending it or correcting a sale." : "Settle the current player before ending the auction or correcting a sale."}</p>}
    <div className="sale-management"><div className="sale-management-heading"><div><h3>Correct a sale</h3><p>Change the team or price, or cancel a purchase and refund it.</p></div><span>{sales.length} signings</span></div>
      {!!sales.length && <label className="result-search"><Search size={18}/><input aria-label="Search confirmed sales" placeholder="Search player or franchise" value={query} onChange={event => { setQuery(event.target.value); setLimit(12); }}/></label>}
      <ul className="sale-management-list">{filtered.slice(0, limit).map(sale => <li key={sale.playerId}><span className="sale-management-photo"><PlayerImage player={sale.player!}/></span><span className="sale-management-name"><strong>{sale.player!.name}</strong><span>{sale.team.name}</span></span><strong className="sale-management-price">{formatMoney(sale.amount)}</strong><button type="button" className="button secondary" aria-label={`Correct sale for ${sale.player!.name}`} disabled={!connected || activeRound} onClick={() => setSelected({ player: sale.player!, teamId: sale.team.id, amount: sale.amount, revision: state.resultsRevision ?? 0 })}><Pencil size={15}/><span>Correct</span></button></li>)}</ul>
      {!filtered.length && <p className="result-empty">{sales.length ? "No matching sales." : "Confirmed purchases will appear here."}</p>}
      {filtered.length > limit && <button className="button secondary full" onClick={() => setLimit(count => count + 20)}>Show more sales</button>}
    </div>
    <SaleAudit state={state}/>
    {selected && <CorrectionDialog key={`${selected.player.id}:${selected.revision}`} state={state} selection={selected} connected={connected} onAction={onAction} onClose={() => setSelected(null)}/>}
    {ending !== null && !state.endedAt && <EndAuctionDialog state={state} revision={ending} connected={connected} onAction={onAction} onClose={() => setEnding(null)}/>}
  </section>;
}

function CorrectionDialog({ state, selection, connected, onAction, onClose }: Props & { selection: SaleSelection; onClose: () => void }) {
  const [mode, setMode] = useState<"update" | "cancel">("update");
  const [teamId, setTeamId] = useState(selection.teamId);
  const [price, setPrice] = useState((selection.amount / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const nextAmount = parseCroreBid(price);
  const changed = mode === "cancel" || teamId !== selection.teamId || nextAmount !== selection.amount;
  const stale = selection.revision !== (state.resultsRevision ?? 0);
  const roundActive = (state.auctionPausedAt !== undefined || ["live", "paused", "locked"].includes(state.phase));
  const oldTeam = state.teams.find(team => team.id === selection.teamId);
  const newTeam = state.teams.find(team => team.id === teamId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || stale || !connected || roundActive) return;
    if (!changed || !reason.trim() || (mode === "update" && (nextAmount === null || nextAmount < selection.player.basePrice))) { setError(`Provide a reason and a changed sale. The price must be at least ${formatMoney(selection.player.basePrice)}.`); return; }
    pending.current = true; setBusy(true); setError("");
    try { await onAction({ type: "correct_sale", playerId: selection.player.id, expectedTeamId: selection.teamId, expectedAmount: selection.amount, expectedResultsRevision: selection.revision, teamId: mode === "cancel" ? null : teamId, ...(mode === "update" ? { amount: nextAmount! } : {}), reason: reason.trim() }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The correction could not be saved."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <ResultDialog title="Correct confirmed sale" busy={busy} onClose={onClose}><form className="result-dialog-body" onSubmit={submit}>
    <div className="correction-player"><span><PlayerImage player={selection.player}/></span><div><h3>{selection.player.name}</h3><p>{oldTeam?.name} · {formatMoney(selection.amount)}</p></div></div>
    <fieldset className="correction-mode"><legend>Correction type</legend><label><input type="radio" name="correction-mode" checked={mode === "update"} onChange={() => setMode("update")}/>Update team or price</label><label><input type="radio" name="correction-mode" checked={mode === "cancel"} onChange={() => setMode("cancel")}/>Cancel and refund sale</label></fieldset>
    {mode === "update" && <div className="result-form-grid"><label>Correct franchise<select aria-label="Correct franchise" value={teamId} onChange={event => setTeamId(event.target.value)}>{state.teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label><label>Correct price (₹ crore)<input inputMode="decimal" required value={price} onChange={event => setPrice(event.target.value)} placeholder="e.g. 5.00"/></label></div>}
    <label className="result-reason">Reason for correction<textarea required maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain what happened. Everyone can see this audit entry."/></label>
    <div className="correction-preview"><span>{oldTeam?.shortName} · {formatMoney(selection.amount)}</span><ArrowRight size={18}/><strong>{mode === "cancel" ? "Refund & return to pool" : `${newTeam?.shortName} · ${nextAmount === null ? "Enter price" : formatMoney(nextAmount)}`}</strong></div>
    {(mode === "cancel" || teamId !== selection.teamId) && <p className="result-notice">The player will also be removed from the previous team’s XI, substitutes and leadership selections.</p>}
    {stale && <p role="alert" className="result-error">Results changed while this form was open. Close it and review the latest sale before correcting.</p>}
    {roundActive && <p role="alert" className="result-error">{state.auctionPausedAt !== undefined ? "Resume the auction before applying this correction." : "Bidding has started. Settle the current player before applying this correction."}</p>}
    {error && <p role="alert" className="result-error">{error}</p>}
    <footer className="result-dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Keep current sale</button><button type="submit" className="button primary" disabled={busy || !connected || stale || roundActive || !changed || !reason.trim() || (mode === "update" && nextAmount === null)}>{busy ? "Saving correction…" : "Confirm correction"}<Check size={17}/></button></footer>
  </form></ResultDialog>;
}

function EndAuctionDialog({ state, revision, connected, onAction, onClose }: Props & { revision: number; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const sales = state.teams.flatMap(team => team.squad);
  const changed = revision !== (state.resultsRevision ?? 0);
  const activeRound = (state.auctionPausedAt !== undefined || ["live", "paused", "locked"].includes(state.phase));
  async function finish() {
    if (pending.current || changed || activeRound || !connected || state.endedAt) return;
    pending.current = true; setBusy(true);
    try { await onAction({ type: "end_auction", expectedResultsRevision: revision }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The auction could not be ended."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <ResultDialog title="End this auction?" busy={busy} onClose={onClose}><div className="result-dialog-body">
    <p className="result-dialog-intro">Bidding will close and team ownership will be fixed. The room and every purchase stay available.</p>
    <dl className="end-auction-totals"><div><dt>Players signed</dt><dd>{sales.length}</dd></div><div><dt>League spending</dt><dd>{formatMoney(sales.reduce((sum, sale) => sum + sale.amount, 0))}</dd></div></dl>
    <ul className="end-auction-inclusions"><li><ClipboardCheck size={18}/>Download a PDF recap and editable Excel workbook.</li><li><Check size={18}/>Managers can still finalise their XI and captaincy.</li><li><History size={18}/>Creator corrections remain recorded in the audit trail.</li></ul>
    <p className="result-notice">This finishes bidding permanently for this room.</p>
    {(changed || activeRound) && <p className="result-error" role="alert">The auction changed. Close this dialog and settle any current bidding before reviewing the final results.</p>}
    {error && <p className="result-error" role="alert">{error}</p>}
    <footer className="result-dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Keep auction open</button><button type="button" className="button primary" disabled={busy || !connected || changed || activeRound || !!state.endedAt} onClick={finish}>{busy ? "Ending auction…" : "End auction and create recap"}<FileCheck2 size={17}/></button></footer>
  </div></ResultDialog>;
}
