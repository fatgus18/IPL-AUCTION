import { ArrowRight, BellRing, Check, Crown, Gavel, LockKeyhole, Target, Users, X } from "lucide-react";
import "./how-it-works.css";

export function HowItWorks({ onClose }: { onClose: () => void }) {
  return <section className="pavilion-guide" aria-labelledby="pavilion-guide-title">
    <button type="button" className="guide-close" aria-label="Close how it works" onClick={onClose}><X size={21} /></button>
    <header className="guide-header"><span className="guide-wordmark"><Gavel size={18} />PAVILION<span>.</span></span><span className="guide-edition">The playbook / 01</span><h2 id="pavilion-guide-title">How it <em>works.</em></h2><p>Make the calls. Build your team. Own auction day.</p><div className="guide-header-art" aria-hidden="true"><span /><Gavel strokeWidth={.8} /></div></header>
    <div className="guide-steps">
      <article className="guide-step"><div className="guide-step-top"><span>01</span><Users size={24} strokeWidth={1.4} /></div><h3>Take your seat.</h3><p>Create a room and invite your league. Spectators join freely; team managers use the creator’s team password.</p><span className="guide-step-note"><LockKeyhole size={13} />One manager. One franchise.</span></article>
      <article className="guide-step"><div className="guide-step-top"><span>02</span><Target size={24} strokeWidth={1.4} /></div><h3>Make your shortlist.</h3><p>Save players in My Target Picks before or during the auction. Your list is private, and you can change it anytime.</p><span className="guide-step-note"><BellRing size={13} />An alert when your target comes up.</span></article>
      <article className="guide-step"><div className="guide-step-top"><span>03</span><Gavel size={24} strokeWidth={1.4} /></div><h3>Win the bidding.</h3><p>The auctioneer brings a player to the table. Managers bid, including custom amounts. Locking stops all raises. Reopen bidding before the final call, or confirm the sale to update the squad and purse.</p><span className="guide-step-note"><Check size={13} />The auctioneer makes the final call.</span></article>
      <article className="guide-step"><div className="guide-step-top"><span>04</span><Crown size={24} strokeWidth={1.4} /></div><h3>Build your XI.</h3><p>Your purchases appear in My Squad. Open Build my XI to set any batting position, pick five substitutes, and name your captain and vice captain.</p><span className="guide-step-note"><Users size={13} />Your squad. Your selection.</span></article>
    </div>
    <footer className="guide-footer"><span><span className="guide-live-dot" />Your league is waiting.</span><button type="button" onClick={onClose}>Ready to play<ArrowRight size={18} /></button></footer>
  </section>;
}
