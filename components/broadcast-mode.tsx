"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Check, Gavel, Maximize, Minimize, Pause, Radio, Trophy, Volume2, VolumeX, WifiOff } from "lucide-react";
import type { BroadcastState } from "@/lib/broadcast-display";
import { formatMoney } from "@/lib/auction-display";
import { getPlayingRole } from "@/lib/player-roles";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import type { AuctionAudioControls } from "./sound-controls";
import "./broadcast-mode.css";

type BroadcastModeProps = {
  state: BroadcastState;
  connected: boolean;
  onExit: () => void;
  sound: AuctionAudioControls;
};

const PHASE_LABELS = {
  waiting: "Awaiting the call",
  live: "Bidding open",
  paused: "Bidding paused",
  locked: "Bidding locked",
  sold: "Sale confirmed",
  unsold: "Unsold",
} as const;

function statValue(value: number | null | undefined, decimals = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", { maximumFractionDigits: decimals ? 2 : 0 });
}

export function BroadcastMode({ state, connected, onExit, sound }: BroadcastModeProps) {
  const root = useRef<HTMLElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [displayMessage, setDisplayMessage] = useState("");
  const current = state.players.find(player => player.id === state.currentPlayerId);
  const completed = state.endedAt !== undefined;
  const leader = state.teams.find(team => team.id === (state.phase === "sold" ? current?.soldTo ?? state.leadingTeamId : state.leadingTeamId));
  const soldPlayers = state.players.filter(player => player.status === "sold");
  const catalogPlayers = state.players.filter(player => !player.catalogArchived);
  const availableCount = catalogPlayers.filter(player => player.status === "available").length;
  const auctionSpend = state.teams.reduce((sum, team) => sum + team.squad.reduce((spent, purchase) => spent + purchase.amount, 0), 0);
  const currentBids = state.bidHistory.filter(bid => bid.playerId === current?.id).slice(-3).reverse();
  const leadingSignings = [...soldPlayers].sort((a, b) => (b.soldFor ?? 0) - (a.soldFor ?? 0) || a.name.localeCompare(b.name)).slice(0, 3);
  const activeBid = state.phase === "sold" ? current?.soldFor ?? state.currentBid : state.currentBid;
  const hasBid = !!leader && activeBid > 0;
  const bidDisplay = state.phase === "unsold" ? "UNSOLD" : formatMoney(hasBid ? activeBid : current?.basePrice ?? 0);
  const phaseLabel = completed ? "Auction complete" : !current ? "Ready for the first player" : PHASE_LABELS[state.phase];
  const live = connected && !completed && !!current && state.phase === "live";
  const accent = !completed && leader ? leader.color : "#e6c48a";

  useEffect(() => {
    const element = root.current;
    const syncFullscreen = () => {
      setFullscreen(document.fullscreenElement === element);
      fullscreenButton.current?.focus({ preventScroll: true });
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    exitButton.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      // Never close a fullscreen session belonging to another element.
      if (element && document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  const toggleFullscreen = async () => {
    const element = root.current;
    if (!element) return;
    setDisplayMessage("");
    if (document.fullscreenElement === element) {
      try { await document.exitFullscreen(); }
      catch { setDisplayMessage("Press Escape to leave fullscreen."); }
      return;
    }
    if (!document.fullscreenEnabled || !element.requestFullscreen) {
      setDisplayMessage("Fullscreen isn’t available in this browser. Broadcast mode still fills this page.");
      return;
    }
    try { await element.requestFullscreen(); }
    catch { setDisplayMessage("Fullscreen couldn’t start. You can keep watching in this page."); }
  };

  const exitBroadcast = async () => {
    if (root.current && document.fullscreenElement === root.current) {
      try { await document.exitFullscreen(); } catch { /* Unmount also releases this fullscreen element. */ }
    }
    onExit();
  };

  return <section
    ref={root}
    className="broadcast-room"
    role="region"
    aria-label="Auction broadcast"
    data-phase={state.phase}
    data-player-id={current?.id ?? ""}
    data-completed={completed ? "true" : "false"}
    data-connected={connected ? "true" : "false"}
    style={{ "--broadcast-accent": accent } as CSSProperties}
  >
    <header className="broadcast-header">
      <div className="broadcast-wordmark" aria-label="Pavilion broadcast"><Gavel size={25} aria-hidden="true" /><strong>PAVILION<span>.</span></strong><span className="broadcast-wordmark-mode">Broadcast</span></div>
      <div className="broadcast-room-identity"><span>{state.name}</span><strong>{state.code}</strong></div>
      <div className="broadcast-controls">
        <button type="button" onClick={() => void sound.toggle()} aria-label={`Turn sound ${sound.enabled ? "off" : "on"}`} aria-pressed={sound.enabled} title={`Sound ${sound.enabled ? "on" : "off"}`}>{sound.enabled ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
        <button ref={fullscreenButton} type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} aria-pressed={fullscreen} title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>
        <button ref={exitButton} className="broadcast-exit" type="button" onClick={() => void exitBroadcast()}><ArrowLeft size={17} aria-hidden="true" /><span>Exit broadcast</span></button>
      </div>
    </header>

    {(displayMessage || sound.unavailable) && <p className="broadcast-display-message" role="status">{displayMessage || "Sound is unavailable in this browser."}</p>}
    {!connected && <div className="broadcast-reconnecting" role="status"><WifiOff size={18} aria-hidden="true" /><strong>Connection interrupted</strong><span>Saved view · reconnecting</span></div>}

    <div className="broadcast-content">
      <div className="broadcast-scorebar">
        <div className={`broadcast-phase ${live ? "is-live" : ""} ${completed ? "is-complete" : ""}`} role="status" aria-live="polite" aria-atomic="true">
          <span className="broadcast-status-icon" aria-hidden="true">{completed || state.phase === "sold" ? <Check size={15} /> : state.phase === "paused" ? <Pause size={14} /> : state.phase === "locked" ? <Gavel size={15} /> : <i />}</span>
          <strong>{!connected ? "Reconnecting" : live ? "LIVE" : phaseLabel}</strong>
          {live && <span>{phaseLabel}</span>}
        </div>
        <div className="broadcast-running-totals"><span><strong>{soldPlayers.length}</strong> signed</span><span><strong>{availableCount}</strong> available</span><span>Auction spend <strong>{formatMoney(auctionSpend)}</strong></span></div>
      </div>

      {completed ? <div className="broadcast-completion">
        <div className="broadcast-completion-story"><span className="broadcast-finale-icon" aria-hidden="true"><Trophy size={52} strokeWidth={1.2} /></span><p className="broadcast-eyebrow">The final hammer</p><h1>Auction<br /><span>complete.</span></h1><p>{soldPlayers.length} {soldPlayers.length === 1 ? "signing" : "signings"}. {state.teams.filter(team => team.squad.length > 0).length} {state.teams.filter(team => team.squad.length > 0).length === 1 ? "franchise" : "franchises"}. A new chapter.</p><dl><div><dt>Total auction spend</dt><dd>{formatMoney(auctionSpend)}</dd></div><div><dt>Players signed</dt><dd>{soldPlayers.length}</dd></div></dl></div>
        <div className="broadcast-final-signings"><h2>Headline signings</h2>{leadingSignings.length ? <ol>{leadingSignings.map((player, index) => {
          const team = state.teams.find(entry => entry.id === player.soldTo);
          return <li key={player.id}><span className="broadcast-signing-rank">0{index + 1}</span><div className="broadcast-signing-art"><PlayerImage player={player} /></div><div className="broadcast-signing-info"><h3>{player.name}</h3><span>{team?.name ?? "Confirmed signing"}</span><strong>{formatMoney(player.soldFor ?? 0)}</strong></div>{team && <TeamCrest key={team.id} team={team} className="broadcast-signing-crest" />}</li>;
        })}</ol> : <div className="broadcast-final-empty"><Gavel size={48} strokeWidth={1.2} aria-hidden="true" /><p>This auction ended with no confirmed signings.</p></div>}</div>
      </div> : current ? <div className="broadcast-stage">
        <article className="broadcast-player" aria-labelledby="broadcast-player-name">
          <div className="broadcast-player-copy"><p className="broadcast-eyebrow">On the auction floor</p><h1 id="broadcast-player-name">{current.name}</h1><p className="broadcast-player-role">{getPlayingRole(current) ?? current.role}<span aria-hidden="true">/</span>{current.country}</p><div className="broadcast-base-price"><span>Base price</span><strong>{formatMoney(current.basePrice)}</strong></div></div>
          <div className="broadcast-player-visual" aria-hidden="true"><span className="broadcast-player-ring" /><PlayerImage key={current.id} player={current} priority className="broadcast-player-portrait" /></div>
          <div className="broadcast-career"><div className="broadcast-career-label">{current.statsFormat && current.statsFormat !== "Unknown" ? `${current.statsFormat} career` : "Career stats"}</div><dl>{([["Matches", current.stats.matches], ["Runs", current.stats.runs], ["Strike rate", current.stats.strikeRate], ["Wickets", current.stats.wickets]] as const).map(([label, value]) => {
            const display = statValue(value, label === "Strike rate");
            return <div key={label}><dt>{label}</dt><dd style={{ "--broadcast-stat-length": display.length } as CSSProperties}>{display}</dd></div>;
          })}</dl></div>
        </article>

        <aside className={`broadcast-bidding ${state.phase === "sold" ? "is-sold" : ""}`} aria-label="Current auction bid">
          <div className="broadcast-bid-primary"><p className="broadcast-eyebrow">{state.phase === "sold" ? "Winning bid" : state.phase === "unsold" ? "No sale" : hasBid ? "Current bid" : "Opening bid"}</p><strong className="broadcast-bid-amount" data-testid="broadcast-bid-amount" key={`${current.id}-${activeBid}-${state.phase}`} style={{ "--broadcast-price-length": bidDisplay.length } as CSSProperties}>{bidDisplay}</strong><p className="broadcast-bid-note">{state.phase === "sold" ? "SOLD · Confirmed by the auctioneer" : state.phase === "unsold" ? "Back to the player pool" : state.phase === "locked" ? "Bids are closed" : state.phase === "paused" ? "Waiting for the auctioneer to resume" : state.phase === "waiting" ? "Waiting for the auctioneer to open" : hasBid ? "Highest accepted bid" : "Waiting for the first bid"}</p></div>
          {leader && state.phase !== "unsold" ? <div className="broadcast-leader" data-testid="broadcast-leading-team"><TeamCrest key={leader.id} team={leader} className="broadcast-leader-crest" /><div><span>{state.phase === "sold" ? "Signed by" : "Leading franchise"}</span><h2>{leader.name}</h2></div></div> : <div className="broadcast-no-leader"><Gavel size={26} strokeWidth={1.4} aria-hidden="true" /><span>{state.phase === "unsold" ? "The next opportunity awaits" : "The next move is yours"}</span></div>}
          <div className="broadcast-bid-trail"><h3>Latest bids</h3>{currentBids.length ? <ol>{currentBids.map(bid => {
            const team = state.teams.find(entry => entry.id === bid.teamId);
            return <li key={bid.id}><span>{team?.shortName ?? "Franchise"}</span><strong>{formatMoney(bid.amount)}</strong></li>;
          })}</ol> : <p>No bids placed yet</p>}</div>
        </aside>
      </div> : <div className="broadcast-waiting-stage"><div className="broadcast-waiting-emblem" aria-hidden="true"><Gavel size={72} strokeWidth={1.05} /><span /><span /></div><div><p className="broadcast-eyebrow">Welcome to the auction</p><h1>Auction<br /><span>starts here.</span></h1><p>The first player will appear when the auctioneer makes the call.</p></div><div className="broadcast-waiting-count"><strong>{catalogPlayers.length}</strong><span>players in the pool</span></div></div>}

      <section className="broadcast-franchises" aria-label="Franchise purses and squad sizes">
        <div className="broadcast-franchises-heading"><h2>The franchises</h2><span>Remaining purse · Squad filled</span></div>
        <ul>{state.teams.map(team => <li key={team.id} className={!completed && leader?.id === team.id ? "is-leading" : ""} style={{ "--franchise-strip-color": team.color } as CSSProperties} aria-label={`${team.name}, purse ${formatMoney(team.purse)}, ${team.squad.length} of ${state.settings.maxSquadSize} squad spots filled`}><TeamCrest team={team} className="broadcast-franchise-crest" /><div><strong>{team.shortName}</strong><span>{formatMoney(team.purse)}</span></div><span className="broadcast-franchise-count">{team.squad.length}<small>/{state.settings.maxSquadSize}</small></span></li>)}</ul>
      </section>
      <footer className="broadcast-footer"><span><Radio size={14} aria-hidden="true" />{!connected ? "Reconnecting to the auction" : completed ? "Final auction results" : "Synced with the auction room"}</span><span>Room {state.code}</span></footer>
    </div>
  </section>;
}
