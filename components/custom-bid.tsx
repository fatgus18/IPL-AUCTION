"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Gavel } from "lucide-react";
import type { AuctionAction, RoomState, Team } from "@/lib/auction";
import { formatMoney, getNextBid } from "@/lib/auction-display";
import { isValidBidAmount, parseCroreBid } from "@/lib/bid-input";
import "./custom-bid.css";

export function CustomBid({ state, team, cooldown, busy, connected, onAction }: {
  state: RoomState; team: Team; cooldown: number; busy: boolean; connected: boolean;
  onAction: (action: AuctionAction) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const id = useId();
  const amount = parseCroreBid(input);
  const minimum = getNextBid(state);
  const unavailable = busy || !connected || state.auctionPausedAt !== undefined || state.phase !== "live" || state.leadingTeamId === team.id;
  const validation = !input.trim() ? "" : amount === null ? "Use a value in crores, such as 5 or 5.25."
    : !isValidBidAmount(amount) ? "Use multiples of ₹0.25 Cr, such as 5.25, 5.50 or 5.75."
    : amount > team.purse ? "This bid exceeds your remaining purse."
      : amount < minimum ? `The minimum bid is now ${formatMoney(minimum)}.` : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || unavailable || cooldown > 0 || amount === null || validation || !state.currentPlayerId) return;
    pending.current = true;
    setError("");
    try {
      await onAction({ type: "bid", expectedPlayerId: state.currentPlayerId, expectedAmount: minimum, customAmount: amount });
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your bid could not be confirmed. Check the current price before trying again.");
    } finally { pending.current = false; }
  }

  return <form className="custom-bid" onSubmit={submit}>
    <label htmlFor={id}>Custom bid <span>₹ crore</span></label>
    <div className="custom-bid-fields">
      <input id={id} aria-label="Custom bid in crore" aria-describedby={`${id}-hint`} inputMode="decimal" autoComplete="off" placeholder="e.g. 5.00" maxLength={10} value={input} disabled={unavailable} onChange={event => { setInput(event.target.value); setError(""); }}/>
      <button className="button secondary" type="submit" disabled={unavailable || cooldown > 0 || amount === null || !!validation}><Gavel size={15}/>{amount !== null && !validation ? `Bid ${formatMoney(amount)}` : "Place bid"}</button>
    </div>
    <p id={`${id}-hint`} className={error || validation ? "custom-bid-error" : "custom-bid-hint"} role={error ? "alert" : undefined}>{error || validation || `Minimum ${formatMoney(minimum)}. Use multiples of ₹0.25 Cr.`}</p>
  </form>;
}
