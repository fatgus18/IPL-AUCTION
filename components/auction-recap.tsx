"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeftRight, ArrowUpRight, Download, FileSpreadsheet, FileText, ShieldCheck, Trophy } from "lucide-react";
import type { RoomState } from "@/lib/auction";
import { formatMoney } from "@/lib/auction-display";
import { summarizeSquad } from "@/lib/squad-summary";
import { TeamCrest } from "./ipl-visuals";
import { SaleAudit } from "./auction-administration";
import "./auction-results.css";

const AuctionAwards = dynamic(() => import("./auction-awards").then(module => module.AuctionAwards));
const FranchisePosters = dynamic(() => import("./franchise-posters").then(module => module.FranchisePosters));

export function AuctionRecap({ state, token, connected, onSquads, onSettings, isCreator, preferredTeamId }: {
  state: RoomState; token: string; preferredTeamId?: string; connected: boolean; onSquads: () => void; onSettings: () => void; isCreator: boolean;
}) {
  const [downloading, setDownloading] = useState<"pdf" | "xlsx" | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort("navigation"); }, []);
  const teams = state.teams.map(team => ({ team, summary: summarizeSquad(state, team) }));
  const sales = teams.reduce((sum, entry) => sum + entry.summary.spots, 0);
  const spent = teams.reduce((sum, entry) => sum + entry.summary.spent, 0);
  const represented = teams.filter(entry => entry.summary.manager || entry.summary.spots).length;

  async function download(format: "pdf" | "xlsx") {
    if (controller.current || !connected) return;
    const pending = new AbortController();
    controller.current = pending; setDownloading(format); setError("");
    const timer = setTimeout(() => pending.abort(), 60000);
    try {
      const response = await fetch(`/api/rooms/${state.code}/export?format=${format}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: pending.signal });
      if (!response.ok) throw new Error(response.status === 401 ? "Your room session needs to reconnect before downloading." : response.status === 409 ? "Finish the auction before downloading its recap." : "The download could not be prepared. Please try again.");
      const expectedType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (!response.headers.get("content-type")?.includes(expectedType)) throw new Error("The server returned an incomplete download. Please try again.");
      const blob = await response.blob();
      if (controller.current !== pending) return;
      if (!blob.size) throw new Error("The export is empty. Please try again.");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `Pavilion-${state.code}-${format === "pdf" ? "recap" : "squads"}.${format}`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (cause) { if (controller.current === pending && pending.signal.reason !== "navigation") setError(pending.signal.aborted ? "The download took too long. Please try again." : cause instanceof Error ? cause.message : "The download could not be prepared."); }
    finally { clearTimeout(timer); if (controller.current === pending) { controller.current = null; setDownloading(null); } }
  }

  return <section className="auction-recap" aria-labelledby="auction-recap-heading">
    <header className="recap-heading"><div><span className="result-overline"><ShieldCheck size={16}/>AUCTION COMPLETE</span><h1 id="auction-recap-heading">Auction recap<span>.</span></h1><p>{state.name}</p><span className="recap-date">{new Date(state.endedAt!).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST · Results revision {state.resultsRevision ?? 0}</span></div><span className="recap-trophy" aria-hidden="true"><Trophy strokeWidth={1} size={100}/></span></header>
    <dl className="recap-totals"><div><dt>Players signed</dt><dd>{sales.toString().padStart(2, "0")}</dd></div><div><dt>League spending</dt><dd>{formatMoney(spent)}</dd></div><div><dt>Teams represented</dt><dd>{represented}<small> / {state.teams.length}</small></dd></div></dl>
    <div className="recap-downloads"><div><h2>Take the auction with you.</h2><p>Full squads, managers, spending and captaincy. The workbook also has editable match stats and points.</p><span>Downloads use the latest saved XI and audited corrections.</span></div><div className="recap-download-actions"><button className="button primary" disabled={!connected || !!downloading} onClick={() => void download("pdf")}><FileText size={19}/>{downloading === "pdf" ? "Preparing PDF…" : "Download recap PDF"}<Download size={16}/></button><button className="button secondary" disabled={!connected || !!downloading} onClick={() => void download("xlsx")}><FileSpreadsheet size={19}/>{downloading === "xlsx" ? "Preparing workbook…" : "Download Excel workbook"}<Download size={16}/></button></div></div>
    {error && <p className="result-error" role="alert">{error}</p>}
    <AuctionAwards state={state}/>
    <FranchisePosters state={state} token={token} connected={connected} preferredTeamId={preferredTeamId}/>
    <div className="recap-team-heading"><h2>The final squads</h2><button className="button secondary" onClick={onSquads}>View & compare squads<ArrowUpRight size={17}/></button></div>
    <p className="recap-table-hint"><ArrowLeftRight size={16}/>Swipe to see spending and captaincy</p>
    <div className="recap-table-wrap" tabIndex={0} role="region" aria-label="Auction results by franchise"><table className="recap-table"><thead><tr><th scope="col">Franchise / manager</th><th scope="col">Players</th><th scope="col">Spent</th><th scope="col">Purse left</th><th scope="col">Captain</th><th scope="col">Vice captain</th></tr></thead><tbody>{teams.map(({ team, summary }) => <tr key={team.id}><th scope="row"><span className="recap-franchise"><TeamCrest team={team}/><span><strong>{team.name}</strong><small>{summary.manager?.name ?? "No manager assigned"}</small></span></span></th><td>{summary.spots}</td><td>{formatMoney(summary.spent)}</td><td>{formatMoney(summary.remaining)}</td><td>{summary.captain?.name ?? "Not selected"}</td><td>{summary.viceCaptain?.name ?? "Not selected"}</td></tr>)}</tbody></table></div>
    <SaleAudit state={state}/>
    {isCreator && <div className="recap-correction-link"><span>Need to correct a purchase? Every change stays in the audit trail.</span><button className="button secondary" onClick={onSettings}>Manage sale corrections<ArrowUpRight size={17}/></button></div>}
  </section>;
}
