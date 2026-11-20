"use client";

import { ArrowRight, GitBranch, LockKeyhole, TriangleAlert } from "lucide-react";
import type { RoomState } from "@/lib/auction";
import { formatMoney } from "@/lib/auction-display";
import { currentPrivateBudget } from "@/lib/private-budget-display";
import { getTargetChains } from "@/lib/target-chains";
import "./private-bid-budget.css";

type Props = { state: RoomState; memberId: string; onViewAuction?: () => void; compact?: boolean };

export function PrivateBidBudget({ state, memberId, onViewAuction, compact = false }: Props) {
  const budget = currentPrivateBudget(state, memberId);
  if (!budget || (compact && budget.warning === "within")) return null;
  const chain = state.myTargetPicks ? getTargetChains(state.players, state.myTargetPicks).find((entry) => entry.activePlayerId === budget.player.id) : undefined;
  const isBackup = chain?.status === "backup-active";
  const firstChoice = isBackup ? state.players.find((player) => player.id === chain.firstChoiceId) : undefined;
  const warning = budget.warning !== "within";
  const message = budget.warning === "over" ? `Current bid is ${formatMoney(budget.currentBid - budget.limit)} above your limit.`
    : budget.warning === "at" ? "The current bid has reached your planned limit."
      : budget.warning === "next-over" ? `${state.leadingTeamId ? "The next bid" : "The opening bid"} of ${formatMoney(budget.nextBid)} exceeds your limit.`
        : "A private reminder. You decide what to bid.";
  return <aside className={`private-bid-budget${warning ? " is-warning" : ""}${compact ? " is-compact" : ""}${isBackup ? " is-backup" : ""}`} aria-label="Your private bidding budget" role="status" aria-live="polite" aria-atomic="true">
    <span className="private-budget-icon" aria-hidden="true">{warning ? <TriangleAlert size={19} /> : isBackup ? <GitBranch size={18} /> : <LockKeyhole size={18} />}</span>
    <div className="private-budget-copy"><span className="private-budget-eyebrow">{isBackup ? `Active backup${firstChoice ? ` · ${firstChoice.name}` : ""}` : "Your private game plan"}</span><p>{compact ? budget.player.name : isBackup ? "Your backup limit" : "Your private limit"}<strong>{formatMoney(budget.limit)}</strong></p><span>{message}</span></div>
    {onViewAuction && <button type="button" onClick={onViewAuction}>View auction<ArrowRight size={16} /></button>}
  </aside>;
}
