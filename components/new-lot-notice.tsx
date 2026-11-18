import { ArrowRight, Target, X } from "lucide-react";
import type { Phase, Player } from "@/lib/auction";
import { PlayerImage } from "./ipl-visuals";
import { LOT_PHASE_LABELS } from "./live-lot-status";

export function NewLotNotice({ player, phase, onView, onDismiss, isTarget = false, onAuctionPage = false }: {
  player: Player; phase: Phase; onView: () => void; onDismiss: () => void; isTarget?: boolean; onAuctionPage?: boolean;
}) {
  return <aside className={`new-lot-notice${isTarget ? " target-lot-notice" : ""}`} role="status" aria-live="polite" aria-atomic="true">
    <div className="new-lot-photo" aria-hidden="true"><PlayerImage player={player}/></div>
    <div className="new-lot-copy"><span>{isTarget && <Target size={15} aria-hidden="true"/>}{isTarget ? "Your target is up" : "Up for auction"}</span><strong>{player.name}</strong><span className="new-lot-phase"><i aria-hidden="true"/>{LOT_PHASE_LABELS[phase]}</span>{!onAuctionPage && <button type="button" className="new-lot-view" onClick={onView}>View auction<ArrowRight size={15}/></button>}</div>
    <button type="button" className="new-lot-dismiss" aria-label="Dismiss player notification" onClick={onDismiss}><X size={18}/></button>
  </aside>;
}
