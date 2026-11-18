import { Pause, Play, ShieldCheck } from "lucide-react";

export function AuctionBreak({ paused, creator, busy, onResume }: {
  paused: boolean; creator: boolean; busy: boolean; onResume: () => void;
}) {
  if (!paused) return null;
  return <section className="auction-break" aria-label="Auction break" role="status">
    <span className="auction-break-icon"><Pause size={22}/></span>
    <div><strong>Auction paused</strong><p>The current player, bids and squads are saved. {creator ? "Resume whenever your league is ready." : "The auctioneer will resume the auction."}</p></div>
    {creator ? <button type="button" className="button primary" disabled={busy} onClick={onResume}><Play size={17}/>Resume auction</button> : <ShieldCheck className="auction-break-saved" size={22} aria-label="Progress saved"/>}
  </section>;
}
