"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Sparkles } from "lucide-react";

export type ConfirmedSale = {
  id: string;
  at: number;
  playerName: string;
  teamName: string;
  amount: string;
  teamColor?: string;
};

/** A short receipt for a newly confirmed sale, never replayed on load or reconnect. */
export function SoldCelebration({ roomId, sale, connected = true }: { roomId: string; sale: ConfirmedSale | null; connected?: boolean }) {
  const previous = useRef<{ roomId: string; id: string | null; connected: boolean } | null>(null);
  const [visibleSale, setVisibleSale] = useState<ConfirmedSale | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = { roomId, id: sale?.id ?? null, connected };
    if (!before || before.roomId !== roomId || !connected || !before.connected) {
      if (timeout.current) clearTimeout(timeout.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => { frame.current = null; setVisibleSale(null); });
      return;
    }
    if (!sale || before.id === sale.id) return;
    const age = Date.now() - sale.at;
    if (!Number.isFinite(age) || age < -1000 || age > 6000) return;
    if (timeout.current) clearTimeout(timeout.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (document.hidden || Date.now() - sale.at > 6000) return;
      setVisibleSale(sale);
      timeout.current = setTimeout(() => { setVisibleSale(null); timeout.current = null; }, 2500);
    });
    // Do not cancel this receipt on a harmless parent render with the same sale.
    // The event was already marked seen, so cancelling it would lose it entirely.
  }, [roomId, sale, connected]);

  useEffect(() => () => {
    if (timeout.current) clearTimeout(timeout.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  if (!visibleSale) return null;
  return <aside key={visibleSale.id} className="cinematic-sale" role="status" aria-live="polite" aria-atomic="true" style={{ "--sale-team-color": visibleSale.teamColor || "#e6c48a" } as CSSProperties}>
    <div className="cinematic-sale-confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ "--particle-x": `${(index * 61 + 13) % 100}%`, "--particle-delay": `${(index % 6) * 60}ms`, "--particle-angle": `${index * 37}deg`, "--particle-drift": `${(index % 2 ? 1 : -1) * (20 + index * 4)}px` } as CSSProperties} />)}</div>
    <span className="cinematic-sale-icon"><Check size={27} strokeWidth={2.5}/></span>
    <div className="cinematic-sale-copy"><span className="cinematic-sale-label"><Sparkles size={14}/>A NEW CHAPTER</span><strong>SOLD.</strong><p>{visibleSale.playerName} <span>joins</span> {visibleSale.teamName}</p></div>
    <span className="cinematic-sale-amount">{visibleSale.amount}</span>
  </aside>;
}
