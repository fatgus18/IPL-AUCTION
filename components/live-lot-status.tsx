import type { Phase } from "@/lib/auction";

export function isOngoingLot(playerId: string | null, phase: Phase): boolean {
  return Boolean(playerId) && ["waiting", "live", "paused", "locked"].includes(phase);
}

export const LOT_PHASE_LABELS: Record<Phase, string> = {
  waiting: "Awaiting bidding", live: "Bidding open", paused: "Bidding paused",
  locked: "Bidding locked", sold: "Sold", unsold: "Unsold",
};

export function LiveLotStatus({ playerId, phase, connected }: { playerId: string | null; phase: Phase; connected: boolean }) {
  if (!connected) return <span className="status-pill">Reconnecting</span>;
  if (!isOngoingLot(playerId, phase)) return <span className="status-pill"><i/>{playerId ? phase.toUpperCase() : "READY WHEN YOU ARE"}</span>;
  return <span className={`live-lot-status ${phase === "live" ? "live-lot-bidding" : ""}`}>
    <span className="live-lot-badge"><i aria-hidden="true"/>LIVE</span>
    <span className="live-lot-phase">{LOT_PHASE_LABELS[phase]}</span>
  </span>;
}
