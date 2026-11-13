"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, CircleHelp, ClipboardList, Copy, Crown, Flag, Gavel, LayoutGrid, LockKeyhole, LogOut, Menu, MessageCircle, Pause, Play, Plus, Radio, RotateCcw, Send, Settings2, ShieldCheck, Sparkles, Trophy, Users, Video, Wallet, X } from "lucide-react";
import { applyAction, createDemoState, formatMoney, getNextBid, type AuctionAction, type RoomState } from "@/lib/auction";
import { PlayerPool, RoomSettings, Squads } from "./auction-panels";
import "./auction-panels.css";

type Tab = "room" | "players" | "squads" | "settings";
type Session = { code: string; token: string; memberId: string };
type Modal = "create" | "join" | "help" | "invite" | null;
const titles: Record<Tab, string> = { room: "The auction room", players: "A pool of possibilities", squads: "Dream teams in the making", settings: "Your auction. Your rules." };
const subtitles: Record<Tab, string> = { room: "Big players. Bold calls. Build a squad that makes history.", players: "Curate the talent. Set the price. Let the bidding begin.", squads: "Every winning bid brings the perfect XI a little closer.", settings: "Set the ground rules for a great day at the auction." };

async function request(path: string, body?: unknown, token?: string) {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
  const data = await response.json() as { state: RoomState; token: string; memberId: string; error?: string };
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function Jersey({ number, name }: { number: string; name: string }) {
  return <div className="jersey-art" aria-hidden="true"><div className="jersey-orbit orbit-one" /><div className="jersey-orbit orbit-two" /><span className="jersey-spark">✦</span><svg viewBox="0 0 260 300"><defs><linearGradient id="shirt" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#317bc8"/><stop offset="100%" stopColor="#124478"/></linearGradient><linearGradient id="sleeve" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#fba568"/><stop offset="100%" stopColor="#e8733c"/></linearGradient></defs><path d="M76 54 32 79 9 144 54 163 69 132 65 272 Q130 289 195 272L191 132 206 163 251 144 228 79 184 54 158 44H102Z" fill="url(#shirt)"/><path d="m76 54-44 25-23 65 45 19 15-31 9-69Zm108 0 44 25 23 65-45 19-15-31-9-69Z" fill="url(#sleeve)"/><path d="M102 44q28 33 56 0l12 6q-40 58-80 0Z" fill="#102d49"/><path d="M105 43q25 22 50 0" fill="none" stroke="#f5cda0" strokeWidth="5"/><path d="M70 231q60 15 122 0M68 242q63 15 126 0" fill="none" stroke="#5394d0" strokeWidth="1" opacity=".5"/><text x="130" y="119" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="700" letterSpacing="5">PAVILION</text><text x="130" y="209" textAnchor="middle" fill="#f3b56f" fontSize="91" fontWeight="800" fontFamily="Arial">{number}</text><text x="130" y="247" textAnchor="middle" fill="#d8e7f7" fontSize="13" fontWeight="600" letterSpacing="3">{name.toUpperCase()}</text><path d="m86 93 5-8 5 8-5 8Z" fill="#e8bd6c"/></svg><span className="jersey-caption">THE NEXT BIG SIGNING</span></div>;
}

export default function AuctionApp({ initialState }: { initialState: RoomState }) {
  const [state, setState] = useState<RoomState>(initialState);
  const [session, setSession] = useState<Session | null>(null);
  const [demoMember, setDemoMember] = useState("demo-host");
  const [tab, setTab] = useState<Tab>("room");
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(initialState.serverTime);
  const [clockOffset, setClockOffset] = useState(0);
  const [sidebar, setSidebar] = useState(false);
  const [sideTab, setSideTab] = useState<"activity" | "chat">("activity");
  const [chat, setChat] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("The Sunday Super Auction");
  const [joinTeam, setJoinTeam] = useState("");
  const [muted, setMuted] = useState(false);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const isDemo = !session;
  const memberId = session?.memberId ?? demoMember;
  const member = state.members.find(m => m.id === memberId) ?? state.members.find(m => m.role === "auctioneer");
  const isHost = member?.role === "auctioneer";
  const player = state.players.find(p => p.id === state.currentPlayerId);
  const leadingTeam = state.teams.find(t => t.id === state.leadingTeamId);
  const ownTeam = state.teams.find(t => t.id === member?.teamId);
  const sold = state.players.filter(p => p.status === "sold");
  const spent = state.teams.reduce((sum, team) => sum + team.squad.reduce((total, p) => total + p.amount, 0), 0);
  const nextBid = getNextBid(state);
  const cooldown = Math.max(0, (state.lastBidAt ?? 0) + state.settings.bidCooldownMs - (now + clockOffset));
  const activeBidHistory = state.bidHistory.filter(b => b.playerId === state.currentPlayerId).slice(-5).reverse();
  const available = state.players.filter(p => p.status === "available" && p.id !== state.currentPlayerId);

  const notify = useCallback((text: string) => { setToast(text); }, []);
  const acceptState = useCallback((incoming: RoomState) => {
    setClockOffset(incoming.serverTime - Date.now());
    setState(previous => previous.code !== incoming.code || incoming.version >= previous.version ? incoming : previous);
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("room");
    try {
      const active = code || localStorage.getItem("pavilion-active-room");
      const stored = active && localStorage.getItem(`pavilion-session-${active}`);
      if (stored) { const saved = JSON.parse(stored) as Session; if (saved.code && saved.token && saved.memberId) setSession(saved); }
      else if (code) { setJoinCode(code.toUpperCase()); setModal("join"); }
    } catch { /* Storage may be disabled; the room still works for this visit. */ }
  }, []);
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(interval); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4300); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (modal) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [modal]);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const result = await request(`/api/rooms/${session!.code}`, undefined, session!.token); if (!cancelled) { acceptState(result.state); setConnected(true); } }
      catch { if (!cancelled) setConnected(false); }
      if (!cancelled) timer = setTimeout(poll, document.hidden ? 3000 : 650);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session, acceptState]);

  const runAction = useCallback(async (action: AuctionAction) => {
    if (session && stateRef.current.code !== session.code) throw new Error("The room is reconnecting. Please wait a moment.");
    if (busyRef.current) throw new Error("Please wait for your current action to finish.");
    busyRef.current = true; setBusy(true);
    try {
      if (!session) { const updated = applyAction(stateRef.current, action, demoMember, Date.now()); setState(updated); setClockOffset(0); }
      else { const result = await request(`/api/rooms/${session.code}/action`, { action }, session.token); acceptState(result.state); setConnected(true); }
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Unable to complete this action."; notify(message); throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  }, [session, demoMember, acceptState, notify]);
  const act = (action: AuctionAction) => { void runAction(action).catch(() => {}); };
  const closeModal = () => { setModal(null); setError(""); };

  async function connectRoom(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = modal === "create"
        ? await request("/api/rooms", { name: roomName, hostName: name })
        : await request(`/api/rooms/${joinCode.trim().toUpperCase()}/join`, { name, teamId: joinTeam || undefined });
      const nextSession = { code: result.state.code, token: result.token, memberId: result.memberId };
      setSession(nextSession); acceptState(result.state); setTab("room"); setConnected(true);
      try { localStorage.setItem(`pavilion-session-${nextSession.code}`, JSON.stringify(nextSession)); localStorage.setItem("pavilion-active-room", nextSession.code); } catch { notify("Connected. Keep this tab open; this browser cannot save your session."); }
      window.history.replaceState(null, "", `?room=${nextSession.code}`);
      closeModal(); notify(modal === "create" ? "Your room is ready. Invite your team owners!" : "You're in. Welcome to the auction.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect."); }
    finally { setBusy(false); }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/?room=${state.code}`); notify("Invite link copied to clipboard."); }
    catch { setModal("invite"); }
  }

  async function leaveRoom() {
    if (isHost && !window.confirm("Leave this view? Your room and auctioneer access will be saved on this browser.")) return;
    if (!isHost && session) { try { await runAction({ type: "leave" }); } catch { return; } }
    try { localStorage.removeItem("pavilion-active-room"); if (!isHost && session) localStorage.removeItem(`pavilion-session-${session.code}`); } catch {}
    setSession(null); setState(createDemoState()); setDemoMember("demo-host"); setClockOffset(0); window.history.replaceState(null, "", "/");
    notify("Back in the practice room.");
  }

  if (session && state.code !== session.code) return <main className="room-loading"><div className="dialog-symbol"><Gavel size={26}/></div><h1>Taking you to your table.</h1><p>{connected ? "Restoring your auction room…" : "The room could not be reached. Retrying your connection…"}</p><button className="button secondary" onClick={() => { setSession(null); setState(createDemoState()); setConnected(true); try { localStorage.removeItem("pavilion-active-room"); } catch {} window.history.replaceState(null, "", "/"); }}>Return to the practice room</button></main>;

  return <div className="app-shell">
    {sidebar && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? "is-open" : ""}`}>
      <a className="brand" href="/" aria-label="Pavilion home"><span className="brand-mark"><Gavel size={22} strokeWidth={2.5} /></span>pavilion<span className="brand-dot">.</span></a>
      <div className="workspace-label">THE OWNER'S BOX</div>
      <nav aria-label="Main navigation">
        {([{ key: "room", label: "Auction room", icon: Gavel }, { key: "players", label: "Player pool", icon: ClipboardList }, { key: "squads", label: "Team squads", icon: Users }, { key: "settings", label: "Room settings", icon: Settings2 }] as const).map(item => <button key={item.key} className={`nav-item ${tab === item.key ? "active" : ""}`} onClick={() => { setTab(item.key); setSidebar(false); }} aria-current={tab === item.key ? "page" : undefined}><item.icon size={19}/><span>{item.label}</span>{item.key === "players" && <span className="nav-count">{state.players.length}</span>}{item.key === "room" && <span className="nav-live-dot"/>}</button>)}
      </nav>
      <div className="sidebar-season"><span className="tiny-label">A NEW SEASON. A NEW SQUAD.</span><Trophy size={35} strokeWidth={1.4}/><h3>Every legend starts<br/>with a bold bid.</h3><p>The auction is yours.<br/>Make it a memorable one.</p><div className="season-lines"/></div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setModal("help")}><CircleHelp size={19}/>How it works<ArrowUpRight size={15}/></button><div className="sidebar-profile"><div className="avatar coral">{(member?.name ?? "A").slice(0, 1).toUpperCase()}</div><div><strong>{member?.name ?? "Auctioneer"}</strong><span>{isHost ? "Auctioneer" : ownTeam?.shortName ?? "Spectator"}</span></div><ShieldCheck size={17}/></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="icon-btn mobile-menu" aria-label="Open navigation" onClick={() => setSidebar(true)}><Menu size={21}/></button><span className="breadcrumb">Workspace</span><span className="breadcrumb-slash">/</span><strong>{isDemo ? "IPL Mega Auction" : state.name}</strong><span className="season-tag">MOCK AUCTION</span></div><div className="topbar-right"><span className={`connection ${!connected ? "offline" : ""}`}><i/>{isDemo ? "Practice room" : connected ? "Connected" : "Reconnecting…"}</span><div className="topbar-divider"/><button className="avatar small" aria-label="How this auction works" onClick={() => setModal("help")}>{member?.name.slice(0, 1) ?? "A"}</button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span/>MATCHDAY STARTS HERE</div><h1>{titles[tab]}</h1><p>{subtitles[tab]}</p></div><div className="heading-actions">{isDemo ? <><button className="button secondary" onClick={() => setModal("join")}><ArrowDownLeft size={16}/>Join a room</button><button className="button primary" onClick={() => setModal("create")}><Plus size={17}/>Create a room</button></> : <><button className="button secondary" onClick={() => setModal("invite")}><Copy size={16}/><span>{state.code}</span></button><button className="button primary" onClick={copyInvite}><Plus size={17}/>Invite people</button></>}</div></div>

        {isDemo && <div className="practice-bar"><div><Sparkles size={16}/><span><strong>A little practice before the big day.</strong> Try the controls, then create a room for your crew.</span></div><label>View as <select value={demoMember} onChange={e => setDemoMember(e.target.value)} aria-label="Practice as a participant">{state.members.map(m => <option key={m.id} value={m.id}>{m.role === "auctioneer" ? "Auctioneer" : state.teams.find(t => t.id === m.teamId)?.shortName ?? m.name}</option>)}</select><ChevronDown size={13}/></label></div>}

        {!isDemo && !connected && <div className="offline-banner" role="status">Connection interrupted. Bidding is disabled until we reconnect. Your room is saved.</div>}

        <section className="metrics" aria-label="Auction overview"><div className="metric"><span className="metric-icon mint"><Users size={20}/></span><div><span>TEAMS AT THE TABLE</span><strong>{state.teams.length.toString().padStart(2, "0")}<small> / 08</small></strong></div><span className="metric-note">{state.members.filter(m => m.role === "bidder").length} seats claimed</span></div><div className="metric"><span className="metric-icon apricot"><Gavel size={20}/></span><div><span>PLAYERS SOLD</span><strong>{sold.length.toString().padStart(2, "0")}<small> / {state.players.length}</small></strong></div><div className="mini-progress"><i style={{ width: `${sold.length / Math.max(1, state.players.length) * 100}%` }}/></div></div><div className="metric"><span className="metric-icon lilac"><Wallet size={20}/></span><div><span>TOTAL SPENT</span><strong>{formatMoney(spent)}</strong></div><span className="metric-note">Across all teams</span></div><div className="metric"><span className="metric-icon blue"><ClipboardList size={20}/></span><div><span>STILL IN THE POOL</span><strong>{state.players.filter(p => p.status === "available").length.toString().padStart(2, "0")}</strong></div><button className="metric-link" aria-label="View player pool" onClick={() => setTab("players")}><ArrowUpRight size={20}/></button></div></section>

        {tab === "players" && <PlayerPool state={state} isHost={!!isHost} onAction={runAction}/>}
        {tab === "squads" && <Squads state={state}/>}
        {tab === "settings" && <RoomSettings state={state} isHost={!!isHost} onAction={runAction}/>}
        {tab === "room" && <>
          <div className="auction-layout"><div className="auction-primary">
            <section className="player-card"><div className="card-topline"><span className={`status-pill ${state.phase === "live" ? "live" : ""}`}><i/>{state.phase === "live" ? "LIVE AUCTION" : state.phase === "waiting" ? "READY WHEN YOU ARE" : state.phase.toUpperCase()}</span><span className="lot-label">{player ? `LOT ${String(state.players.findIndex(p => p.id === player.id) + 1).padStart(2, "0")} · ${player.role.toUpperCase()} SET` : "THE STAGE IS SET"}</span></div>
              {player ? <div className="player-hero"><div className="player-bio"><div className="player-country"><span className={player.country === "India" ? "country-dot" : "country-neutral"}/>{player.country}<span>•</span>{player.isOverseas ? "Overseas" : "Domestic"}</div><h2>{player.name.split(" ").slice(0, -1).join(" ")}<br/><span>{player.name.split(" ").at(-1)}</span></h2><div className="player-tags"><span>{player.role}</span>{player.role === "Marquee" && <span><Sparkles size={12}/>Marquee player</span>}</div><div className="base-price"><span>BASE PRICE</span><strong>{formatMoney(player.basePrice)}</strong></div></div><Jersey number={player.name.includes("Pant") ? "17" : player.name.includes("Kohli") ? "18" : "07"} name={player.name.split(" ").at(-1) ?? "PLAYER"}/></div> : <div className="no-player"><Gavel size={48} strokeWidth={1.2}/><h2>The next big name is up to you.</h2><p>{isHost ? "Choose a player from the pool to open the bidding." : "Your auctioneer is choosing the next player."}</p>{isHost && <button className="button primary" onClick={() => setTab("players")}>Choose a player<ArrowRight size={16}/></button>}</div>}
              {player && <div className="player-stats"><div><span>MATCHES</span><strong>{player.stats.matches}</strong></div><div><span>RUNS</span><strong>{player.stats.runs.toLocaleString()}</strong></div><div><span>STRIKE RATE</span><strong>{player.stats.strikeRate.toFixed(1)}</strong></div><div><span>WICKETS</span><strong>{player.stats.wickets}</strong></div><span className="stats-note">Illustrative<br/>career stats</span></div>}
            </section>

            <section className="table-section"><div className="section-heading"><div><h3><LayoutGrid size={17}/>A seat at the table</h3><p>Eight teams. One dream squad.</p></div><span className="small-label"><span className="green-dot"/>{state.members.filter(m => m.role === "bidder").length} team owners</span></div><div className="team-tables">{state.teams.map((team, index) => { const owner = state.members.find(m => m.teamId === team.id); const leading = team.id === state.leadingTeamId; const flag = owner?.flagRaisedAt && now + clockOffset - owner.flagRaisedAt < 10000; return <div key={team.id} className={`team-table ${leading ? "leading" : ""} ${ownTeam?.id === team.id ? "your-table" : ""}`} style={{ "--team-color": team.color } as CSSProperties}><div className="table-top"><span>TABLE {String(index + 1).padStart(2, "0")}</span>{leading ? <span className="table-leading"><Flag size={10} fill="currentColor"/>LEADING</span> : flag ? <span className="raised-flag"><Flag size={13}/>Raised</span> : <span className={`presence-dot ${owner ? "present" : ""}`}/>}</div><div className="team-identity"><div className="team-badge">{team.shortName}</div><div><h4>{team.shortName}{ownTeam?.id === team.id && <span>YOU</span>}</h4><span>{owner?.name ?? "Waiting for an owner"}</span></div></div><div className="table-purse"><span>Purse left</span><strong>{formatMoney(team.purse)}</strong></div><div className="table-floor"><span>{team.squad.length}/{state.settings.maxSquadSize} players</span><div className="table-seats">{[0,1,2].map(i => <i key={i}/>)}</div><span>{leading ? formatMoney(state.currentBid) : "—"}</span></div></div>; })}</div></section>
          </div>

          <aside className="bidding-column"><section className="bid-card"><div className="bid-card-heading"><h3>{state.phase === "sold" ? "The winning bid" : "On the paddle"}</h3><span><Radio size={14}/>{state.phase === "live" ? "Bidding open" : state.phase === "locked" ? "Bidding locked" : state.phase === "paused" ? "Paused" : state.phase === "sold" ? "Sold!" : "Awaiting the call"}</span></div><div className="bid-price"><span>{leadingTeam ? state.phase === "sold" ? "FINAL SALE PRICE" : "CURRENT HIGHEST BID" : "OPENING BID"}</span><strong>{formatMoney(leadingTeam ? state.currentBid : player?.basePrice ?? 0)}</strong><div className="leading-team">{leadingTeam ? <><span className="tiny-team" style={{ background: leadingTeam.color }}>{leadingTeam.shortName}</span><span>{leadingTeam.name}</span><Crown size={15}/></> : <span>The first move is yours.</span>}</div></div>
            <div className="bid-controls">{isHost ? <><div className="control-label"><ShieldCheck size={14}/>AUCTIONEER CONTROLS</div>{state.phase === "live" || state.phase === "paused" ? <div className="host-buttons"><button className="button lock-button" disabled={busy || !connected} onClick={() => act({ type: "lock" })}><LockKeyhole size={17}/>Lock bidding</button><button className="button secondary icon-square" disabled={busy || !connected} onClick={() => act({ type: state.phase === "live" ? "pause" : "resume" })} aria-label={state.phase === "live" ? "Pause bidding" : "Resume bidding"}>{state.phase === "live" ? <Pause size={18}/> : <Play size={18}/>}</button></div> : state.phase === "locked" ? <button className="button primary full" disabled={busy || !connected} onClick={() => act({ type: leadingTeam ? "sell" : "unsold" })}><Gavel size={18}/>{leadingTeam ? `Sell to ${leadingTeam.shortName}` : "Mark as unsold"}</button> : state.phase === "waiting" && player ? <button className="button primary full" disabled={busy || !connected} onClick={() => act({ type: "start" })}><Play size={17}/>Open the bidding</button> : <button className="button primary full" onClick={() => setTab("players")}><Plus size={17}/>Choose next player</button>}<p className="control-hint"><LockKeyhole size={12}/>Your call. Bids stop the moment you lock.</p></> : ownTeam ? <><button className="button primary full bid-button" disabled={busy || !connected || state.phase !== "live" || cooldown > 0 || leadingTeam?.id === ownTeam.id || ownTeam.purse < nextBid} onClick={() => act({ type: "bid", expectedAmount: nextBid, expectedPlayerId: state.currentPlayerId! })}><Gavel size={18}/>{busy ? "Placing bid…" : leadingTeam?.id === ownTeam.id ? "You're leading the bidding" : state.phase !== "live" ? "Waiting for the auctioneer" : cooldown > 0 ? `Next bid in ${(cooldown / 1000).toFixed(1)}s` : `Raise to ${formatMoney(nextBid)}`}</button><p className="control-hint">{ownTeam.purse < nextBid ? "Your purse is below the next bid." : `${formatMoney(state.settings.bidIncrement)} increments · ${state.settings.bidCooldownMs / 1000}s bid cooldown`}</p></> : <div className="spectator-note"><Users size={18}/>You have a front-row seat as a spectator.</div>}</div>
            <div className="bid-history"><div className="subsection-heading"><h4>Bid history</h4><span>{state.bidHistory.filter(b => b.playerId === state.currentPlayerId).length} bids</span></div>{activeBidHistory.length ? activeBidHistory.map((bid, index) => { const team = state.teams.find(t => t.id === bid.teamId); return <div className={`history-row ${index === 0 ? "latest" : ""}`} key={bid.id}><span className="history-dot" style={{ background: team?.color }}/><span>{team?.shortName}<small>{new Date(bid.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</small></span><strong>{formatMoney(bid.amount)}</strong>{index === 0 && <ArrowUpRight size={14}/>}</div>; }) : <div className="quiet-state"><Gavel size={22}/><p>Every great squad starts<br/>with the first bid.</p></div>}</div>
          </section>

          <section className="activity-card"><div className="activity-tabs"><button className={sideTab === "activity" ? "selected" : ""} onClick={() => setSideTab("activity")}>Room activity</button><button className={sideTab === "chat" ? "selected" : ""} onClick={() => setSideTab("chat")}><MessageCircle size={14}/>Chat</button><button className="activity-mute" aria-label={muted ? "Show all room activity" : "Show only auction activity"} title={muted ? "Show all activity" : "Hide join notifications"} onClick={() => setMuted(!muted)}>{muted ? <CheckCheck size={15}/> : <Settings2 size={15}/>}</button></div><div className="activity-feed" aria-live="polite">{state.activity.filter(a => sideTab === "chat" ? a.type === "chat" : a.type !== "chat" && (!muted || a.type !== "room")).slice(-6).reverse().map(a => <div className="activity-entry" key={a.id}><span className={`activity-dot ${a.type === "sold" ? "orange" : ""}`}>{a.type === "chat" ? <MessageCircle size={12}/> : a.type === "bid" ? <Gavel size={12}/> : <Check size={12}/>}</span><div><p>{a.text}</p><time>{new Date(a.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</time></div></div>)}{!state.activity.some(a => sideTab === "chat" ? a.type === "chat" : a.type !== "chat") && <p className="feed-empty">{sideTab === "chat" ? "Talk strategy. Celebrate a signing. Say hello." : "The room's story unfolds here."}</p>}</div>{sideTab === "chat" && <form className="chat-form" onSubmit={e => { e.preventDefault(); if (chat.trim()) void runAction({ type: "chat", text: chat.trim() }).then(() => setChat("")).catch(() => {}); }}><input aria-label="Message to room" maxLength={300} placeholder="Message the room…" value={chat} onChange={e => setChat(e.target.value)}/><button aria-label="Send message" disabled={busy || !chat.trim()}><Send size={16}/></button></form>}</section>
          </aside></div>

          <section className="up-next"><div className="up-next-heading"><span className="tiny-label">KEEP AN EYE ON</span><h3>Still on the board</h3><button onClick={() => setTab("players")}>View player pool<ArrowRight size={15}/></button></div><div className="up-next-players">{available.slice(0, 3).map((p, i) => <button className="up-next-player" key={p.id} onClick={() => setTab("players")}><span className={`player-initial initial-${i}`}>{p.name.split(" ").map(n => n[0]).slice(0, 2).join("")}</span><div><strong>{p.name}</strong><span>{p.role} <i>·</i> {p.country}</span></div><span className="next-base"><small>BASE</small>{formatMoney(p.basePrice)}</span><ArrowUpRight size={15}/></button>)}{available.length === 0 && <p className="feed-empty">All players have had their moment. Add more to your pool.</p>}</div></section>
        </>}

        <footer className="page-footer"><span><ShieldCheck size={13}/>Human-led. Fair by design.</span><span>Made for the love of the game <span className="footer-star">✦</span> pavilion</span></footer>
      </main>

      <div className="room-dock"><div className="dock-status"><span className="dock-icon"><Users size={19}/></span><div><strong>{isDemo ? "The practice pavilion" : state.name}</strong><span>{state.members.length} participants <i>·</i> {isDemo ? "Try it before matchday" : `Room ${state.code}`}</span></div></div><div className="dock-actions"><button aria-label="Raise flag" className="dock-button" disabled={busy || !connected} onClick={() => { void runAction({ type: "raise_flag" }).then(() => notify("Flag raised. The room can see you for 10 seconds.")).catch(() => {}); }}><Flag size={16}/><span>Raise flag</span></button>{state.settings.callUrl ? <a aria-label="Join room call" className="dock-button" href={state.settings.callUrl} target="_blank" rel="noopener noreferrer"><Video size={17}/><span>Join room call</span><ArrowUpRight size={13}/></a> : <button aria-label={isHost ? "Add call link" : "Room call"} className="dock-button" onClick={() => { if (isHost) { setTab("settings"); notify("Add your Meet, Zoom, or other call link in room settings."); } else notify("Your auctioneer can add a call link in room settings."); }}><Video size={17}/><span>{isHost ? "Add call link" : "Room call"}</span></button>}<span className="dock-divider"/>{isDemo ? <button aria-label="Reset practice room" className="dock-button reset-demo" onClick={() => { setState(createDemoState()); setDemoMember("demo-host"); setClockOffset(0); notify("Practice room reset. Fresh start!"); }}><RotateCcw size={15}/><span>Reset</span></button> : <button aria-label="Leave room" className="dock-button leave" onClick={() => void leaveRoom()}><LogOut size={16}/><span>Leave room</span></button>}</div></div>
    </div>

    <dialog aria-label={modal === "create" ? "Create auction room" : modal === "join" ? "Join auction room" : modal === "invite" ? "Invite people" : "How it works"} className="app-dialog" ref={dialogRef} onCancel={closeModal} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}><div className="dialog-inner"><button className="dialog-close icon-btn" aria-label="Close dialog" onClick={closeModal}><X size={20}/></button><div className="dialog-symbol"><Gavel size={25}/></div>{modal === "create" || modal === "join" ? <><span className="eyebrow">YOUR SEAT IS WAITING</span><h2>{modal === "create" ? "Let’s make auction day." : "Welcome to the pavilion."}</h2><p>{modal === "create" ? "Create a room, invite your friends, and take the auctioneer’s chair." : "Enter your room code and claim a team. Let’s build something great."}</p><form onSubmit={connectRoom}><label>Your name<input required autoComplete="name" minLength={2} maxLength={32} placeholder="e.g. Anmol" value={name} onChange={e => setName(e.target.value)}/></label>{modal === "create" ? <label>Room name<input required minLength={3} maxLength={60} value={roomName} onChange={e => setRoomName(e.target.value)}/></label> : <><label>Room code<input required autoCapitalize="characters" maxLength={10} placeholder="ABC123" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}/></label><label>Your team<select value={joinTeam} onChange={e => setJoinTeam(e.target.value)}><option value="">Join as a spectator</option>{state.teams.map(team => <option key={team.id} value={team.id}>{team.name} ({team.shortName})</option>)}</select></label></>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy} type="submit">{busy ? "Setting up your seat…" : modal === "create" ? "Create auction room" : "Join auction room"}<ArrowRight size={17}/></button></form><p className="dialog-footnote"><ShieldCheck size={13}/>{modal === "create" ? "You control every player, pause, and final call." : "Each team has one owner. Spectators are welcome."}</p></> : modal === "invite" ? <><h2>Good auctions need good company.</h2><p>Share the room code or invite link with your team owners. They’ll need access to this site.</p><div className="invite-code">{state.code}</div><input className="invite-url" aria-label="Room invitation link" readOnly value={typeof window !== "undefined" ? `${window.location.origin}/?room=${state.code}` : state.code} onFocus={e => e.currentTarget.select()}/><button className="button primary full" onClick={copyInvite}><Copy size={16}/>Copy invite link</button></> : <><h2>The auction, your way.</h2><p>All the excitement. You make the calls.</p><ol className="how-it-works"><li><span>01</span><div><strong>Set your stage</strong><p>Create a room, curate your player pool, and invite up to eight team owners.</p></div></li><li><span>02</span><div><strong>Let the paddles do the talking</strong><p>The auctioneer chooses a player and opens bidding. Accepted bids have a short cooldown so every raise is clear.</p></div></li><li><span>03</span><div><strong>Going, going… yours.</strong><p>Lock bidding to stop all raises, then confirm the sale. Purses and squads update together.</p></div></li></ol><div className="help-note">This is an independent mock auction. Player prices and stats are illustrative. Use a room call link for voice or video alongside the auction.</div><button className="button primary full" onClick={closeModal}>Got it. Let’s play.<ArrowRight size={17}/></button></>}</div></dialog>
    {toast && <div className="toast" role="status"><span><Check size={15}/></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={15}/></button></div>}
  </div>;
}



