"use client";

import { Activity, useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, CheckCheck, CircleHelp, ClipboardList, Copy, Crown, Gavel, House, LayoutGrid, LockKeyhole, LogOut, Menu, MessageCircle, Pause, Play, Plus, Radio, Send, Settings2, ShieldCheck, Sparkles, Trophy, Users, Video, Wallet, X } from "lucide-react";
import { formatMoney, getNextBid } from "@/lib/auction-display";
import type { AuctionAction, RoomState } from "@/lib/auction";
import { AuctionRequestError, requestAuction } from "@/lib/auction-client";
import { parseRoomSession, type RoomSession } from "@/lib/practice-session";
import { createBootstrapState } from "@/lib/bootstrap-state";
import { editLobbyCatalog, type CatalogSnapshot } from "@/lib/lobby-catalog-client";
import { TEAM_SEEDS } from "@/lib/team-catalog";
import { finishRoomCreation, prepareRoomCreation, readPendingRoomCreation, type PendingRoomCreation } from "@/lib/room-creation";
import { PlayerPool, RoomSettings, Squads } from "./auction-panels";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import { SoundControls, useAuctionAudio } from "./sound-controls";
import { CinematicHero } from "./cinematic-hero";
import { SoldCelebration } from "./sold-celebration";
import { MySquad } from "./my-squad";
import { BuildMyXI } from "./build-my-xi";
import { canBuildXI, canViewMySquad, normalizeRoomView, parseRoomView, type RoomView } from "@/lib/room-navigation";
import { RoomAccessPanel } from "./room-access-panel";
import { FranchiseHero } from "./franchise-hero";
import { CustomBid } from "./custom-bid";
import { ChatAuthor } from "./chat-author";
import { LotNotificationTracker, type LotNotification } from "@/lib/lot-notifications";
import { LiveLotStatus, isOngoingLot } from "./live-lot-status";
import { NewLotNotice } from "./new-lot-notice";
import "./auction-panels.css";
import "./cinematic-experience.css";
import "./lobby-navigation.css";
import "./profile-identity.css";
import "./franchise-theme.css";
import "./live-lot.css";

type Tab = "home" | RoomView;
type Session = RoomSession;
type Modal = "create" | "join" | "help" | "invite" | null;

async function request(path: string, body?: unknown, token?: string) {
  return requestAuction<{ state: RoomState; token: string; memberId: string; unchanged?: boolean; serverTime?: number }>(path, body, token);
}

export default function AuctionApp({ initialState }: { initialState: RoomState }) {
  const [state, setState] = useState<RoomState>(initialState);
  const [session, setSession] = useState<Session | null>(null);
  const [bootReady, setBootReady] = useState(false);
  const [bootError, setBootError] = useState("");
  const [bootAttempt, setBootAttempt] = useState(0);
  const [sessionSaveError, setSessionSaveError] = useState("");
  const [pendingCreation, setPendingCreation] = useState<PendingRoomCreation | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const tabRef = useRef<Tab>("home");
  const lotTrackerRef = useRef<LotNotificationTracker | null>(null);
  if (lotTrackerRef.current === null) lotTrackerRef.current = new LotNotificationTracker();
  const [lotNotice, setLotNotice] = useState<(LotNotification & { roomCode: string }) | null>(null);
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
  const [joinPassword, setJoinPassword] = useState("");
  const [muted, setMuted] = useState(false);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stateRef = useRef(state);
  const targetRef = useRef<Session | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const catalogRef = useRef<CatalogSnapshot | null>(null);
  const inRoom = !!session;
  const sound = useAuctionAudio({ roomId: state.id, activity: state.activity, connected: inRoom && bootReady && connected });
  const playSound = sound.play;
  const changeTab = useCallback((requested: Tab) => {
    const target = targetRef.current;
    const viewer = target ? stateRef.current.members.find(member => member.id === target.memberId) : undefined;
    const next = target ? normalizeRoomView(requested === "home" ? "room" : requested, viewer) : requested === "players" ? "players" : "home";
    tabRef.current = next;
    if (next === "room" || next === "home") setLotNotice(null);
    playSound("navigate"); setTab(next); window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const url = new URL(window.location.href);
    url.searchParams.delete("practice");
    if (next === "home") url.searchParams.delete("view"); else url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [playSound]);
  const memberId = session?.memberId ?? "";
  const member = state.members.find(m => m.id === memberId);
  const isHost = member?.role === "auctioneer";
  const isCreator = isHost && member?.id === state.hostId;
  const player = state.players.find(p => p.id === state.currentPlayerId);
  const leadingTeam = state.teams.find(t => t.id === state.leadingTeamId);
  const ownTeam = state.teams.find(t => t.id === member?.teamId);
  const showMySquad = inRoom && canViewMySquad(member);
  const showBuildXI = inRoom && canBuildXI(member) && !!ownTeam;
  const franchiseId = inRoom && ownTeam ? ownTeam.id : undefined;
  const sold = state.players.filter(p => p.status === "sold");
  const ownSpent = ownTeam?.squad.reduce((total, purchase) => total + purchase.amount, 0) ?? 0;
  const nextBid = getNextBid(state);
  const cooldown = Math.max(0, (state.lastBidAt ?? 0) + state.settings.bidCooldownMs - (now + clockOffset));
  const activeBidHistory = state.bidHistory.filter(b => b.playerId === state.currentPlayerId).slice(-5).reverse();
  const available = state.players.filter(p => !p.catalogArchived && p.status === "available" && p.id !== state.currentPlayerId);
  const catalogCount = state.catalogCount ?? state.players.filter(p => !p.catalogArchived).length;
  const saleEvent = inRoom && state.phase === "sold" ? state.activity.findLast(event => event.type === "sold") : undefined;

  useEffect(() => {
    // Theme the page-level gavel too, without changing anyone else's room view.
    if (franchiseId) document.documentElement.dataset.franchise = franchiseId;
    else delete document.documentElement.dataset.franchise;
    return () => { delete document.documentElement.dataset.franchise; };
  }, [franchiseId]);

  const notify = useCallback((text: string) => { setToast(text); }, []);
  const acceptCatalog = useCallback((incoming: CatalogSnapshot) => {
    if (catalogRef.current && incoming.version < catalogRef.current.version) return;
    catalogRef.current = incoming;
    if (targetRef.current) return;
    const lobby = { ...createBootstrapState(), players: incoming.players, catalogCount: incoming.players.length, sharedCatalogVersion: incoming.version };
    stateRef.current = lobby;
    setState(lobby);
  }, []);
  const acceptState = useCallback((incoming: RoomState) => {
    if (incoming.code !== targetRef.current?.code) return;
    const previous = stateRef.current;
    if (previous.code === incoming.code && incoming.version < previous.version) return;
    const viewer = incoming.members.find(member => member.id === targetRef.current?.memberId);
    const allowedView = normalizeRoomView(tabRef.current === "home" ? "room" : tabRef.current, viewer);
    if (allowedView !== tabRef.current) {
      tabRef.current = allowedView;
      setTab(allowedView);
      const url = new URL(window.location.href);
      url.searchParams.set("view", allowedView);
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
    const announcement = lotTrackerRef.current!.observe(incoming, { connected: true, away: tabRef.current !== "room" });
    if (announcement) setLotNotice({ ...announcement, roomCode: incoming.code });
    else setLotNotice(current => current && tabRef.current !== "room" && current.roomCode === incoming.code && current.playerId === incoming.currentPlayerId && isOngoingLot(incoming.currentPlayerId, incoming.phase) ? current : null);
    stateRef.current = incoming;
    setClockOffset(incoming.serverTime - Date.now());
    setState(incoming);
  }, []);

  const finishDeletedRoom = useCallback((code: string) => {
    const ended = targetRef.current;
    if (!ended || ended.code !== code) return;
    targetRef.current = null;
    tabRef.current = "home"; lotTrackerRef.current?.reset(); setLotNotice(null);
    try {
      localStorage.removeItem(`pavilion-session-${code}`);
      if (localStorage.getItem("pavilion-active-room") === code) localStorage.removeItem("pavilion-active-room");
    } catch { /* The server also permanently rejects these old credentials. */ }
    try {
      const pending = readPendingRoomCreation();
      if (pending?.creationKey === ended.token) { finishRoomCreation(ended.token); setPendingCreation(null); }
    } catch { /* A later recovery attempt receives the definitive deleted-room response. */ }
    setSession(null); setTab("home"); setSidebar(false); setModal(null);
    setError(""); setSessionSaveError(""); setJoinPassword(""); setJoinTeam("");
    const lobby = createBootstrapState();
    stateRef.current = lobby; setState(lobby);
    if (catalogRef.current) acceptCatalog(catalogRef.current);
    setConnected(true); setBootReady(true); setBootError("");
    window.history.replaceState(null, "", "/");
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    notify("This room has been deleted by its creator. The shared player pool is unchanged.");
  }, [acceptCatalog, notify]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("room")?.toUpperCase();
    const view = params.get("view");
    async function restore() {
      // Read the browser-only URL and storage after hydration without enabling the seed UI.
      await Promise.resolve();
      if (cancelled) return;
      setBootReady(false); setBootError("");
      try {
        let pending: PendingRoomCreation | null = null;
        try { pending = readPendingRoomCreation(); setPendingCreation(pending); } catch { /* A creation-specific storage problem is shown when opening that form. */ }
        // Bare Home always remains the lobby. Only an explicit room link restores membership.
        const raw = code ? localStorage.getItem(`pavilion-session-${code}`) : null;
        const saved = parseRoomSession(raw);
        if (raw && (!saved || saved.code !== code)) throw new Error("Your saved room access could not be read. Use the original room link in this browser.");
        if (saved) {
          if (cancelled) return;
          targetRef.current = saved; setSession(saved); setBootReady(true);
          const restoredTab = parseRoomView(view);
          tabRef.current = restoredTab; setTab(restoredTab);
          window.history.replaceState(null, "", `/?room=${saved.code}&view=${restoredTab}`);
          return;
        }
        targetRef.current = null; setSession(null); setConnected(true); setBootReady(true);
        tabRef.current = view === "players" ? "players" : "home";
        setTab(tabRef.current); lotTrackerRef.current?.reset(); setLotNotice(null);
        window.history.replaceState(null, "", code ? `/?room=${encodeURIComponent(code)}${view === "players" ? "&view=players" : ""}` : view === "players" ? "/?view=players" : "/");
        if (code) { setJoinCode(code); setModal("join"); }
        else if (pending) {
          setName(pending.hostName); setRoomName(pending.name); setModal("create");
          setError("A previous room creation wasn't confirmed. Retry safely to open that same room.");
        }
      } catch (cause) {
        if (!cancelled) setBootError(cause instanceof Error ? cause.message : "Your saved auction could not be loaded. Please retry.");
      }
    }
    void restore();
    return () => { cancelled = true; };
  }, [bootAttempt]);
  const bidUntil = (state.lastBidAt ?? 0) + state.settings.bidCooldownMs;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const time = Date.now();
      if (document.hidden) return;
      setNow(time);
      if (tab === "room" && time + clockOffset < bidUntil) {
        timer = setTimeout(tick, 100);
      }
    };
    tick();
    const visible = () => { clearTimeout(timer); tick(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [bidUntil, clockOffset, tab]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4300); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (modal && bootReady) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [modal, bootReady]);
  useEffect(() => {
    if (session || !bootReady) return;
    let cancelled = false, running = false, failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function pollCatalog() {
      if (cancelled || running) return;
      running = true;
      try {
        const known = catalogRef.current;
        const result = await requestAuction<CatalogSnapshot | { unchanged: true; version: number }>(`/api/players/catalog${known ? `?since=${known.version}` : ""}`, undefined, undefined, { signal: controller.signal });
        if (!cancelled && !targetRef.current) { if ("players" in result) acceptCatalog(result); setConnected(true); }
        failures = 0;
      } catch { failures++; if (!cancelled && !targetRef.current) setConnected(false); }
      finally { running = false; }
      if (!cancelled) {
        clearTimeout(timer);
        timer = setTimeout(pollCatalog, document.hidden ? 30000 : failures ? Math.min(15000, 2500 * 2 ** Math.min(failures - 1, 3)) : tab === "players" ? 2500 : 10000);
      }
    }
    const refresh = () => { if (!document.hidden) { clearTimeout(timer); void pollCatalog(); } };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pavilion-room-updates") : null;
    channelRef.current = channel;
    if (channel) channel.onmessage = event => { if (event.data?.catalogChanged === true) refresh(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    void pollCatalog();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); channel?.close(); if (channelRef.current === channel) channelRef.current = null; document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, [session, bootReady, acceptCatalog, tab]);
  useEffect(() => {
    if (!session || !bootReady) return;
    const pollingSession = session;
    let cancelled = false;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      if (cancelled || running) return;
      running = true;
      try {
        const current = stateRef.current;
        const suffix = current.code === pollingSession.code ? `?since=${current.version}` : "";
        const result = await requestAuction<{ state?: RoomState; unchanged?: boolean }>(`/api/rooms/${pollingSession.code}${suffix}`, undefined, pollingSession.token, { signal: controller.signal });
        failures = 0;
        if (!cancelled && targetRef.current === pollingSession) { if (result.state) acceptState(result.state); setConnected(true); }
      }
      catch (cause) {
        if (!cancelled && targetRef.current === pollingSession) {
          if (cause instanceof AuctionRequestError && cause.code === "ROOM_DELETED") {
            finishDeletedRoom(pollingSession.code);
            return;
          }
          failures += 1; setConnected(false);
        }
      }
      finally { running = false; }
      if (!cancelled) {
        clearTimeout(timer);
        const current = stateRef.current;
        const liveAuction = current.mode !== "practice" && current.phase === "live" && tab === "room";
        const delay = document.hidden ? 15000 : failures ? Math.min(15000, 2500 * 2 ** Math.min(failures - 1, 3)) : liveAuction ? 750 : 2500;
        timer = setTimeout(poll, delay);
      }
    }
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    // A tab sends only an invalidation hint; every receiver fetches authenticated server state.
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pavilion-room-updates") : null;
    channelRef.current = channel;
    if (channel) channel.onmessage = event => { if (!document.hidden && (event.data?.code === pollingSession.code || event.data?.catalogChanged === true)) { clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    void poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); channel?.close(); if (channelRef.current === channel) channelRef.current = null; document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); };
  }, [session, bootReady, acceptState, finishDeletedRoom, tab]);

  const runAction = useCallback(async (action: AuctionAction) => {
    const destination = targetRef.current;
    const catalogChanged = ["add_player", "update_player", "delete_player"].includes(action.type);
    if (!bootReady || (destination && stateRef.current.code !== destination.code)) throw new Error("Your room is still loading. Please wait a moment.");
    if (!destination && !catalogChanged) throw new Error("Create or join an auction room first.");
    if (busyRef.current) throw new Error("Please wait for your current action to finish.");
    busyRef.current = true; setBusy(true);
    try {
      if (destination) {
        const result = await request(`/api/rooms/${destination.code}/action`, { action }, destination.token);
        if (targetRef.current === destination) {
          acceptState(result.state); setConnected(true);
          if (action.type === "select_player") changeTab("room");
        }
      } else {
        acceptCatalog(await editLobbyCatalog(action));
        if (!targetRef.current) setConnected(true);
      }
      channelRef.current?.postMessage({ code: destination?.code, catalogChanged });
      if (catalogChanged) notify(action.type === "add_player" ? "Player added to the common catalog. Every room can now see them." : action.type === "update_player" ? "Shared player profile updated." : "Player removed from the common catalog.");
    } catch (cause) {
      if (destination && cause instanceof AuctionRequestError && cause.code === "ROOM_DELETED") finishDeletedRoom(destination.code);
      else {
        if (destination && cause instanceof AuctionRequestError && cause.code === "LINEUP_CONFLICT" && targetRef.current === destination) {
          try {
            const fresh = await requestAuction<{ state: RoomState }>(`/api/rooms/${destination.code}`, undefined, destination.token, { timeoutMs: 5000 });
            if (targetRef.current === destination) acceptState(fresh.state);
          } catch { /* Normal room polling can still refresh the conflicting lineup. */ }
        }
        notify(cause instanceof Error ? cause.message : "Unable to complete this action.");
      }
      throw cause;
    }
    finally { busyRef.current = false; setBusy(false); }
  }, [bootReady, acceptState, acceptCatalog, finishDeletedRoom, notify, changeTab]);
  const act = (action: AuctionAction) => { void runAction(action).catch(() => {}); };
  const closeModal = () => {
    if (modal === "join" && !targetRef.current) {
      const url = new URL(window.location.href); url.searchParams.delete("room");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
    setModal(null); setError(""); setJoinPassword("");
  };
  function openCreate() {
    if (pendingCreation) { setName(pendingCreation.hostName); setRoomName(pendingCreation.name); }
    setModal("create"); setError("");
  }

  function saveRoomAccess(nextSession: Session, pending: PendingRoomCreation | null = pendingCreation) {
    try {
      const serialized = JSON.stringify(nextSession);
      localStorage.setItem(`pavilion-session-${nextSession.code}`, serialized);
      localStorage.setItem("pavilion-active-room", nextSession.code);
      if (localStorage.getItem(`pavilion-session-${nextSession.code}`) !== serialized) throw new Error("Access was not retained");
      if (pending?.creationKey === nextSession.token) { finishRoomCreation(pending.creationKey); setPendingCreation(null); }
      setSessionSaveError("");
      return true;
    } catch {
      setSessionSaveError("Your room is saved, but this browser could not finish saving access. Keep this tab open, allow site storage, then retry saving access before refreshing.");
      return false;
    }
  }

  async function connectRoom(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    const creating = modal === "create";
    let attempt: PendingRoomCreation | null = null;
    try {
      if (creating) {
        attempt = prepareRoomCreation(roomName, name);
        setPendingCreation(attempt); setRoomName(attempt.name); setName(attempt.hostName);
      }
      let result: Awaited<ReturnType<typeof request>> | undefined;
      if (creating) {
        result = await request("/api/rooms", attempt);
      } else {
        const code = joinCode.trim().toUpperCase();
        const saved = parseRoomSession(localStorage.getItem(`pavilion-session-${code}`));
        if (saved?.code === code) {
          try {
            const restored = await request(`/api/rooms/${code}`, undefined, saved.token);
            result = { ...restored, token: saved.token, memberId: saved.memberId };
          } catch (cause) {
            // Only a definitive rejection permits a fresh join. Never replace valid
            // auctioneer/team access because a recovery request was slow or offline.
            if (!(cause instanceof AuctionRequestError) || ![401, 404].includes(cause.status ?? 0)) throw cause;
          }
        }
        if (result && joinTeam) {
          const restoredMemberId = result.memberId;
          const savedMember = result.state.members.find(entry => entry.id === restoredMemberId);
          if (savedMember && savedMember.role !== "auctioneer" && savedMember.teamId !== joinTeam) {
            const claimed = await request(`/api/rooms/${code}/action`, { action: { type: "claim_team", teamId: joinTeam, teamPassword: joinPassword.trim() } }, result.token);
            result = { ...result, state: claimed.state };
          }
        }
        result ??= await request(`/api/rooms/${code}/join`, { name, ...(joinTeam ? { teamId: joinTeam, teamPassword: joinPassword.trim() } : {}) });
      }
      const nextSession = { code: result.state.code, token: result.token, memberId: result.memberId };
      targetRef.current = nextSession; setSession(nextSession); acceptState(result.state); changeTab("room"); setConnected(true);
      const accessSaved = saveRoomAccess(nextSession, attempt);
      window.history.replaceState(null, "", `?room=${nextSession.code}&view=room`);
      closeModal();
      if (accessSaved) notify(creating ? "Room ready. Your private team-entry password is in Room settings." : "You're in. Welcome to the auction.");
    } catch (cause) {
      if (attempt && cause instanceof AuctionRequestError && cause.code === "ROOM_DELETED") {
        try {
          finishRoomCreation(attempt.creationKey); setPendingCreation(null);
          setError("That room was deleted. You can now create a new room.");
        } catch {
          setError("That room was deleted. Allow site storage, then retry to clear its saved creation attempt.");
        }
        return;
      }
      const uncertain = cause instanceof AuctionRequestError && ["REQUEST_TIMEOUT", "NETWORK_ERROR", "INVALID_RESPONSE"].includes(cause.code || "");
      const message = uncertain && attempt ? "The server hasn't confirmed your room yet." : cause instanceof Error ? cause.message : "Could not connect.";
      setError(attempt ? `${message} This attempt is saved. Retry safely to recover the same room.` : message);
    }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/?room=${state.code}`); notify("Invite link copied to clipboard."); }
    catch { setModal("invite"); }
  }

  function returnHome() {
    if (busyRef.current) return;
    if (sessionSaveError && session && !saveRoomAccess(session)) {
      notify("Save your room access before returning home. Allow site storage, then retry saving access.");
      return;
    }
    targetRef.current = null; setSession(null); setTab("home"); setSidebar(false);
    tabRef.current = "home"; lotTrackerRef.current?.reset(); setLotNotice(null);
    const lobby = createBootstrapState();
    stateRef.current = lobby; setState(lobby);
    if (catalogRef.current) acceptCatalog(catalogRef.current);
    setConnected(true); setBootReady(true); setBootError(""); setSessionSaveError("");
    window.history.replaceState(null, "", "/");
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  async function leaveRoom() {
    if (busyRef.current) return;
    if (isHost && !window.confirm("Leave this view? Your room and auctioneer access will be saved on this browser.")) return;
    if (!isHost && session) { try { await runAction({ type: "leave" }); } catch { return; } }
    try { localStorage.removeItem("pavilion-active-room"); if (!isHost && session) localStorage.removeItem(`pavilion-session-${session.code}`); } catch {}
    returnHome();
  }

  if (!bootReady) return <main className="room-loading"><div className="dialog-symbol"><Gavel size={26}/></div><h1>{bootError ? "Your saved room needs a moment." : "Opening your pavilion."}</h1><p role={bootError ? "alert" : "status"}>{bootError || "Getting the stage ready…"}</p>{bootError && <><button className="button primary" onClick={() => setBootAttempt(attempt => attempt + 1)}>Retry connection</button><button className="button secondary" onClick={returnHome}>Return home</button></>}</main>;
  if (session && state.code !== session.code) return <main className="room-loading"><div className="dialog-symbol"><Gavel size={26}/></div><h1>Taking you to your table.</h1><p>{connected ? "Restoring your auction room…" : "The room could not be reached. Retrying your connection…"}</p><button className="button secondary" onClick={returnHome}>Return home</button></main>;

  const heroActions = !inRoom ? <><button className="button primary" onClick={openCreate}><Plus size={17}/>Create an auction</button><button className="button secondary" onClick={() => setModal("join")}><ArrowDownLeft size={16}/>Join a room</button></> : <><button className="button primary" onClick={() => setModal("invite")}><Plus size={17}/>Invite people</button><button className="button secondary" onClick={() => setModal("invite")}><Copy size={16}/><span>{state.code}</span></button></>;
  const navigation: { key: Tab; label: string; icon: typeof Gavel }[] = inRoom ? [
    { key: "room", label: "Auction room", icon: Gavel },
    { key: "players", label: "Player pool", icon: ClipboardList },
    ...(showMySquad ? [{ key: "my-squad" as const, label: "My Squad", icon: ShieldCheck }] : []),
    ...(showBuildXI ? [{ key: "build-xi" as const, label: "Build my XI", icon: LayoutGrid }] : []),
    { key: "squads", label: "Team squads", icon: Users },
    { key: "settings", label: "Room settings", icon: Settings2 },
  ] : [{ key: "home", label: "Home", icon: House }, { key: "players", label: "Player pool", icon: ClipboardList }];

  return <div className={`app-shell ${inRoom ? "in-auction" : "in-lobby"}${franchiseId ? " franchise-room" : ""} tab-${tab}`} data-franchise={franchiseId}>
    {inRoom && connected && tab !== "room" && lotNotice?.roomCode === state.code && lotNotice.playerId === state.currentPlayerId && player && isOngoingLot(state.currentPlayerId, state.phase) && <NewLotNotice key={lotNotice.key} player={player} phase={state.phase} onView={() => changeTab("room")} onDismiss={() => setLotNotice(null)}/>}
    <SoldCelebration roomId={state.id} connected={connected} sale={saleEvent && player && leadingTeam ? { id: saleEvent.id, at: saleEvent.at, playerName: player.name, teamName: leadingTeam.shortName, amount: formatMoney(state.currentBid), teamColor: leadingTeam.color } : null}/>
    {sidebar && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? "is-open" : ""}`}>
      <Link className="brand" href="/" prefetch={false} onClick={event => { event.preventDefault(); returnHome(); }} aria-label="Pavilion home"><span className="brand-mark"><Gavel size={24} strokeWidth={2.5} /></span><span className="brand-word">PAVILION<span className="brand-dot">.</span><small>THE AUCTION EXPERIENCE</small></span></Link>
      <div className="workspace-label">YOUR DUGOUT</div>
      <nav aria-label="Main navigation">
        {navigation.map(item => <button key={item.key} className={`nav-item ${tab === item.key ? "active" : ""}`} onClick={() => { changeTab(item.key); setSidebar(false); }} aria-current={tab === item.key ? "page" : undefined}><item.icon size={19}/><span>{item.label}</span>{item.key === "players" && <span className="nav-count">{catalogCount || "—"}</span>}{item.key === "my-squad" && !!ownTeam?.squad.length && <span className="nav-count">{ownTeam.squad.length}</span>}{item.key === "room" && <span className="nav-live-dot"/>}</button>)}
      </nav>
      <div className="sidebar-season"><span className="tiny-label">A NEW SEASON. A NEW SQUAD.</span><Trophy size={35} strokeWidth={1.4}/><h3>Every legend starts<br/>with a bold bid.</h3><p>The auction is yours.<br/>Make it a memorable one.</p><div className="season-lines"/></div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setModal("help")}><CircleHelp size={19}/>How it works<ArrowUpRight size={15}/></button>{inRoom && <div className="sidebar-profile"><div className={ownTeam ? "profile-franchise-crest" : "avatar coral"}>{ownTeam ? <TeamCrest key={ownTeam.id} team={ownTeam}/> : (member?.name ?? "A").slice(0, 1).toUpperCase()}</div><div><strong>{member?.name ?? "Guest"}</strong><span>{isHost ? "Auctioneer" : ownTeam?.shortName ?? "Spectator"}</span></div><ShieldCheck size={17}/></div>}</div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="icon-btn mobile-menu" aria-label="Open navigation" onClick={() => setSidebar(true)}><Menu size={21}/></button><span className="breadcrumb"><Trophy size={13}/>IPL</span><span className="breadcrumb-slash">/</span><strong>{inRoom ? state.name : "The auction starts here"}</strong><span className="season-tag">MOCK AUCTION</span></div><div className="topbar-right"><SoundControls sound={sound}/>{inRoom && <><span className={`connection ${!connected ? "offline" : ""}`}><i/>{!connected ? "Reconnecting…" : "Connected"}</span><div className="topbar-divider"/></>}<button className={`avatar small${ownTeam ? " profile-franchise-crest" : ""}`} aria-label="How this auction works" onClick={() => setModal("help")}>{ownTeam ? <TeamCrest key={ownTeam.id} team={ownTeam}/> : member?.name.slice(0, 1) ?? "?"}</button></div></header>
      <main>
        {inRoom && ownTeam ? <FranchiseHero team={ownTeam} ownerName={member?.name ?? "Team owner"}/> : <CinematicHero tab={tab} playerCount={catalogCount}>{heroActions}</CinematicHero>}

        {sessionSaveError && session && <div className="offline-banner" role="alert"><span>{sessionSaveError}</span><button className="button secondary" onClick={() => { if (saveRoomAccess(session)) notify("Room access saved. You can safely refresh."); }}>Retry saving access</button></div>}

        {!connected && <div className="offline-banner" role="status">{inRoom ? "Connection interrupted. Bidding is disabled until we reconnect. Your room is saved." : "The shared player pool is reconnecting. Your saved players are safe."}</div>}

        {tab === "room" && <section className="metrics" aria-label="Auction overview"><div className="metric"><span className="metric-icon mint"><Users size={20}/></span><div><span>TEAMS AT THE TABLE</span><strong>{state.members.filter(member => member.role === "bidder").length.toString().padStart(2, "0")}<small> / {state.teams.length.toString().padStart(2, "0")}</small></strong></div><span className="metric-note">{state.members.filter(m => m.role === "bidder").length} seats claimed</span></div><div className="metric"><span className="metric-icon apricot"><Gavel size={20}/></span><div><span>PLAYERS SOLD</span><strong>{sold.length.toString().padStart(2, "0")}<small> / {catalogCount}</small></strong></div><div className="mini-progress"><i style={{ width: `${sold.length / Math.max(1, state.players.length) * 100}%` }}/></div></div><div className="metric" data-metric="own-spending"><span className="metric-icon lilac"><Wallet size={20}/></span><div><span>YOUR SPENDING</span><strong>{ownTeam ? formatMoney(ownSpent) : "—"}</strong></div><span className="metric-note">{ownTeam ? `${ownTeam.shortName} signings` : "No team assigned"}</span></div><div className="metric"><span className="metric-icon blue"><ClipboardList size={20}/></span><div><span>STILL IN THE POOL</span><strong>{state.players.filter(p => !p.catalogArchived && p.status === "available").length.toString().padStart(2, "0")}</strong></div><button className="metric-link" aria-label="View player pool" onClick={() => changeTab("players")}><ArrowUpRight size={20}/></button></div></section>}

        {tab === "players" && (!inRoom && !state.sharedCatalogVersion ? <div className="lobby-pool-loading" role="status">{connected ? "Loading the shared player pool…" : "Waiting for the player pool to reconnect…"}</div> : <PlayerPool state={state} isHost={!inRoom || !!isHost} inRoom={inRoom} canSelect={inRoom && !!isHost} onAction={runAction}/>)}
        {inRoom && tab === "squads" && <Squads state={state}/>}
        {showMySquad && tab === "my-squad" && <MySquad state={state} memberId={memberId}/>}
        {showBuildXI && session && <Activity key={`${session.code}:${memberId}:${ownTeam?.id}`} mode={tab === "build-xi" ? "visible" : "hidden"}><BuildMyXI state={state} memberId={memberId} onAction={runAction} connected={connected}/></Activity>}
        {inRoom && tab === "settings" && <><RoomSettings state={state} isHost={!!isHost} onAction={runAction}/>{isCreator && <RoomAccessPanel key={session.code} code={session.code} token={session.token} onDeleted={() => { channelRef.current?.postMessage({ code: session.code }); finishDeletedRoom(session.code); }}/>}</>}
        {inRoom && tab === "room" && <>
          <div className="auction-titlebar"><div><span className="eyebrow"><span/>THE LIVE FLOOR</span><h2>WHERE LEGENDS FIND A HOME.</h2></div><span className="floor-note"><ShieldCheck size={15}/><span>HUMAN-LED AUCTION<br/><strong>You make the final call.</strong></span></span></div><div className="auction-layout"><div className="auction-primary">
            <section className={`player-card phase-${state.phase}`}><div className="card-topline"><LiveLotStatus playerId={state.currentPlayerId} phase={state.phase} connected={connected}/><span className="lot-label">{player ? `LOT ${String(state.players.findIndex(p => p.id === player.id) + 1).padStart(2, "0")} · ${player.role.toUpperCase()} SET` : "THE STAGE IS SET"}</span></div>
              {player ? <div className="player-hero" key={player.id}><div className="player-ghost" aria-hidden="true">{player.name.split(" ").at(-1)}</div><div className="player-bio"><div className="player-country"><span className={player.country === "India" ? "country-dot" : "country-neutral"}/>{player.country}<span>•</span>{player.eligibilityVerified === false ? "Review needed" : player.isOverseas ? "Overseas" : "Domestic"}</div><h2>{player.name.split(" ").slice(0, -1).join(" ")}<br/><span style={{ "--surname-length": Math.max(4, (player.name.split(" ").at(-1) ?? "").length) } as CSSProperties} title={player.name}>{player.name.split(" ").at(-1)}</span></h2><div className="player-tags"><span>{player.playingRole || player.role}</span>{player.role === "Marquee" && <span><Sparkles size={12}/>Marquee player</span>}</div><div className="base-price"><span>BASE PRICE</span><strong>{formatMoney(player.basePrice)}</strong></div></div><div className="player-art"><div className="player-halo"/><div className="player-orbit"/><span className="player-art-label">READY TO MAKE HISTORY</span><PlayerImage key={player.id} player={player} className="hero-player-image" priority/>{state.phase === "sold" && <span className="sold-stamp">SOLD<Gavel size={24}/></span>}<span className="portrait-floor"/></div></div> : <div className="no-player"><Gavel size={48} strokeWidth={1.2}/><h2>The next big name is up to you.</h2><p>{isHost ? "Choose a player from the pool to open the bidding." : "Your auctioneer is choosing the next player."}</p>{isHost && <button className="button primary" onClick={() => changeTab("players")}>Choose a player<ArrowRight size={16}/></button>}</div>}
              {player && <div className="player-stats"><div><span>MATCHES</span><strong>{player.stats.matches?.toLocaleString("en-IN") ?? "—"}</strong></div><div><span>RUNS</span><strong>{player.stats.runs?.toLocaleString("en-IN") ?? "—"}</strong></div><div><span>STRIKE RATE</span><strong>{player.stats.strikeRate?.toFixed(1) ?? "—"}</strong></div><div><span>WICKETS</span><strong>{player.stats.wickets?.toLocaleString("en-IN") ?? "—"}</strong></div><span className="stats-note">{player.statsFormat && player.statsFormat !== "Unknown" ? player.statsFormat : ""}<br/>{player.dataStatus === "manual" ? "ORGANIZER STATS" : "CAREER STATS"}</span></div>}
              {player && <div className="player-data-note"><span>{player.statsFormat && player.statsFormat !== "Unknown" ? `${player.statsFormat} career statistics` : "Career statistics not available"}{player.dataStatus === "manual" ? " · Organizer-provided" : player.dataSources?.length ? ` · ${player.dataSources[0].label}` : ""}</span>{player.profileUrl && <a href={player.profileUrl} target="_blank" rel="noreferrer">Player profile<ArrowUpRight size={14}/></a>}</div>}
            </section>

            <section className="table-section"><div className="section-heading"><div><h3><LayoutGrid size={17}/>THE FRANCHISE DUGOUTS</h3><p>{state.teams.length} tables. One winning bid.</p></div><span className="small-label"><span className="green-dot"/>{state.members.filter(m => m.role === "bidder").length} team owners</span></div><div className="team-tables">{state.teams.map((team, index) => { const owner = state.members.find(m => m.teamId === team.id); const leading = team.id === state.leadingTeamId; return <div key={team.id} className={`team-table ${leading ? "leading" : ""} ${ownTeam?.id === team.id ? "your-table" : ""}`} style={{ "--team-color": team.color } as CSSProperties}><div className="table-top"><span>TABLE {String(index + 1).padStart(2, "0")}</span>{leading ? <span className="table-leading"><Crown size={10}/>LEADING</span> : <span className={`presence-dot ${owner ? "present" : ""}`}/>}</div><div className="team-identity"><div className="team-badge"><TeamCrest team={team}/></div><div><h4>{team.shortName}{ownTeam?.id === team.id && <span>YOU</span>}</h4><span>{owner?.name ?? "Waiting for an owner"}</span></div></div><div className="table-purse"><span>Purse left</span><strong>{formatMoney(team.purse)}</strong></div><div className="team-purse-track" aria-hidden="true"><span style={{width: `${Math.max(0,Math.min(100,team.purse/state.settings.purse*100))}%`}}/></div><div className="table-floor"><span>{team.squad.length}/{state.settings.maxSquadSize} players</span><div className="table-seats">{[0,1,2].map(i => <i key={i}/>)}</div><span>{leading ? formatMoney(state.currentBid) : "—"}</span></div></div>; })}</div></section>
          </div>

          <aside className="bidding-column"><section className="bid-card"><div className="bid-card-heading"><h3>{state.phase === "sold" ? "THE WINNING BID" : "THE BIDDING ROOM"}</h3><span><Radio size={14}/>{state.phase === "live" ? "Bidding open" : state.phase === "locked" ? "Bidding locked" : state.phase === "paused" ? "Paused" : state.phase === "sold" ? "Sold!" : "Awaiting the call"}</span></div><div className="bid-price"><span>{leadingTeam ? state.phase === "sold" ? "FINAL SALE PRICE" : "CURRENT HIGHEST BID" : "OPENING BID"}</span><strong key={`${state.currentPlayerId}-${state.currentBid}`}>{formatMoney(leadingTeam ? state.currentBid : player?.basePrice ?? 0)}</strong><div className="leading-team">{leadingTeam ? <><span className="tiny-team"><TeamCrest team={leadingTeam}/></span><span>{leadingTeam.name}</span><Crown size={15}/></> : <span>The first move is yours.</span>}</div></div>
            <div className="bid-controls">{isHost ? <><div className="control-label"><ShieldCheck size={14}/>AUCTIONEER CONTROLS</div>{state.phase === "live" || state.phase === "paused" ? <div className="host-buttons"><button className="button lock-button" disabled={busy || !connected} onClick={() => act({ type: "lock" })}><LockKeyhole size={17}/>Lock bidding</button><button className="button secondary icon-square" disabled={busy || !connected} onClick={() => act({ type: state.phase === "live" ? "pause" : "resume" })} aria-label={state.phase === "live" ? "Pause bidding" : "Resume bidding"}>{state.phase === "live" ? <Pause size={18}/> : <Play size={18}/>}</button></div> : state.phase === "locked" ? <button className="button primary full" disabled={busy || !connected} onClick={() => act({ type: leadingTeam ? "sell" : "unsold" })}><Gavel size={18}/>{leadingTeam ? `Sell to ${leadingTeam.shortName}` : "Mark as unsold"}</button> : state.phase === "waiting" && player ? <button className="button primary full" disabled={busy || !connected} onClick={() => act({ type: "start" })}><Play size={17}/>Open the bidding</button> : <button className="button primary full" onClick={() => changeTab("players")}><Plus size={17}/>Choose next player</button>}<p className="control-hint"><LockKeyhole size={12}/>Your call. Bids stop the moment you lock.</p></> : ownTeam ? <><button className="button primary full bid-button" disabled={busy || !connected || state.phase !== "live" || cooldown > 0 || leadingTeam?.id === ownTeam.id || ownTeam.purse < nextBid} onClick={() => act({ type: "bid", expectedAmount: nextBid, expectedPlayerId: state.currentPlayerId! })}><Gavel size={18}/>{busy ? "Placing bid…" : state.phase !== "live" ? (state.phase === "sold" && leadingTeam?.id === ownTeam.id ? "Signed by your team" : state.phase === "locked" ? "Bidding locked" : state.phase === "paused" ? "Auction paused" : "Waiting for the auctioneer") : leadingTeam?.id === ownTeam.id ? "You're leading the bidding" : cooldown > 0 ? `Next bid in ${(cooldown / 1000).toFixed(1)}s` : `Raise to ${formatMoney(nextBid)}`}</button><p className="control-hint">{ownTeam.purse < nextBid ? "Your purse is below the next bid." : `${formatMoney(state.settings.bidIncrement)} increments · ${state.settings.bidCooldownMs / 1000}s bid cooldown`}</p>{player && <CustomBid key={player.id} state={state} team={ownTeam} cooldown={cooldown} busy={busy} connected={connected} onAction={runAction}/>}</> : <div className="spectator-note"><Users size={18}/>You have a front-row seat as a spectator.</div>}</div>
            <div className="bid-history"><div className="subsection-heading"><h4>Bid history</h4><span>{state.bidHistory.filter(b => b.playerId === state.currentPlayerId).length} bids</span></div>{activeBidHistory.length ? activeBidHistory.map((bid, index) => { const team = state.teams.find(t => t.id === bid.teamId); return <div className={`history-row ${index === 0 ? "latest" : ""}`} key={bid.id}><span className="history-dot" style={{ background: team?.color }}/><span>{team?.shortName}<small>{new Date(bid.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</small></span><strong>{formatMoney(bid.amount)}</strong>{index === 0 && <ArrowUpRight size={14}/>}</div>; }) : <div className="quiet-state"><Gavel size={22}/><p>Every great squad starts<br/>with the first bid.</p></div>}</div>
          </section>

          <section className="activity-card"><div className="activity-tabs"><button className={sideTab === "activity" ? "selected" : ""} onClick={() => { if (sideTab !== "activity") sound.play("navigate"); setSideTab("activity"); }}>Room activity</button><button className={sideTab === "chat" ? "selected" : ""} onClick={() => { if (sideTab !== "chat") sound.play("navigate"); setSideTab("chat"); }}><MessageCircle size={14}/>Chat</button><button className="activity-mute" aria-label={muted ? "Show all room activity" : "Show only auction activity"} title={muted ? "Show all activity" : "Hide join notifications"} onClick={() => setMuted(!muted)}>{muted ? <CheckCheck size={15}/> : <Settings2 size={15}/>}</button></div><div className="activity-feed" aria-live="polite">{state.activity.filter(a => sideTab === "chat" ? a.type === "chat" : a.type !== "chat" && (!muted || a.type !== "room")).slice(-6).reverse().map(a => <div className="activity-entry" key={a.id}><span className={`activity-dot ${a.type === "sold" ? "orange" : ""}`}>{a.type === "chat" ? <MessageCircle size={12}/> : a.type === "bid" ? <Gavel size={12}/> : <Check size={12}/>}</span><div>{a.type === "chat" && <ChatAuthor activity={a} state={state}/>}<p>{a.text}</p><time>{new Date(a.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</time></div></div>)}{!state.activity.some(a => sideTab === "chat" ? a.type === "chat" : a.type !== "chat") && <p className="feed-empty">{sideTab === "chat" ? "Talk strategy. Celebrate a signing. Say hello." : "The room's story unfolds here."}</p>}</div>{sideTab === "chat" && <form className="chat-form" onSubmit={e => { e.preventDefault(); if (chat.trim()) void runAction({ type: "chat", text: chat.trim() }).then(() => setChat("")).catch(() => {}); }}><input aria-label="Message to room" maxLength={300} placeholder="Message the room…" value={chat} onChange={e => setChat(e.target.value)}/><button aria-label="Send message" disabled={busy || !chat.trim()}><Send size={16}/></button></form>}</section>
          </aside></div>

          <section className="up-next"><div className="up-next-heading"><span className="tiny-label">THE NEXT BIG SIGNING?</span><h3>STILL IN PLAY.</h3><button onClick={() => changeTab("players")}>View player pool<ArrowRight size={15}/></button></div><div className="up-next-players">{available.slice(0, 3).map((p, i) => <button className="up-next-player" key={p.id} onClick={() => changeTab("players")}><span className={`player-initial initial-${i}`}><PlayerImage player={p}/></span><div><strong>{p.name}</strong><span>{p.role} <i>·</i> {p.country}</span></div><span className="next-base"><small>BASE</small>{formatMoney(p.basePrice)}</span><ArrowUpRight size={15}/></button>)}{available.length === 0 && <p className="feed-empty">All players have had their moment. Add more to your pool.</p>}</div></section>
        </>}


      </main>

      {inRoom && <div className="room-dock"><div className="dock-status"><span className="dock-icon"><Users size={19}/></span><div><strong>{state.name}</strong><span>{state.members.length} participants <i>·</i> Room {state.code}</span></div></div><div className="dock-actions">{state.settings.callUrl ? <a aria-label="Join room call" className="dock-button" href={state.settings.callUrl} target="_blank" rel="noopener noreferrer"><Video size={17}/><span>Join room call</span><ArrowUpRight size={13}/></a> : <button aria-label={isHost ? "Add call link" : "Room call"} className="dock-button" onClick={() => { if (isHost) { changeTab("settings"); notify("Add your Meet, Zoom, or other call link in room settings."); } else notify("Your auctioneer can add a call link in room settings."); }}><Video size={17}/><span>{isHost ? "Add call link" : "Room call"}</span></button>}<span className="dock-divider"/><button aria-label="Leave room" className="dock-button leave" disabled={busy} onClick={() => void leaveRoom()}><LogOut size={16}/><span>Leave room</span></button></div></div>}
    </div>

    <dialog aria-label={modal === "create" ? "Create auction room" : modal === "join" ? "Join auction room" : modal === "invite" ? "Invite people" : "How it works"} className="app-dialog" ref={dialogRef} onCancel={closeModal} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}><div className="dialog-inner"><button className="dialog-close icon-btn" aria-label="Close dialog" onClick={closeModal}><X size={20}/></button><div className="dialog-symbol"><Gavel size={25}/></div>{modal === "create" || modal === "join" ? <><span className="eyebrow">YOUR SEAT IS WAITING</span><h2>{modal === "create" ? "Let’s make auction day." : "Welcome to the pavilion."}</h2><p>{modal === "create" ? "Start with the shared player pool. You choose who goes up for bidding." : "Join freely as a spectator, or enter the creator’s password to take a team."}</p><form onSubmit={connectRoom}><label>Your name<input required autoComplete="name" readOnly={modal === "create" && !!pendingCreation} minLength={pendingCreation ? 1 : 2} maxLength={32} placeholder="e.g. Anmol" value={name} onChange={e => setName(e.target.value)}/></label>{modal === "create" ? <label>Room name<input required readOnly={!!pendingCreation} minLength={pendingCreation ? 1 : 3} maxLength={60} value={roomName} onChange={e => setRoomName(e.target.value)}/></label> : <><label>Room code<input required autoCapitalize="characters" maxLength={10} placeholder="ABC123" value={joinCode} onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinPassword(""); }}/></label><label>Your team<select value={joinTeam} onChange={e => { setJoinTeam(e.target.value); setJoinPassword(""); }}><option value="">Join as a spectator</option>{TEAM_SEEDS.map(team => <option key={team.id} value={team.id}>{team.name} ({team.shortName})</option>)}</select></label>{joinTeam && <label>Team password<input type="password" required maxLength={128} autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder="Ask the room creator" value={joinPassword} onChange={e => setJoinPassword(e.target.value)}/></label>}</>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy} type="submit">{busy ? "Setting up your seat…" : modal === "create" ? pendingCreation ? "Retry room creation" : "Create auction room" : "Join auction room"}<ArrowRight size={17}/></button></form><p className="dialog-footnote"><ShieldCheck size={13}/>{modal === "create" ? "Your team-entry password is available privately in Room settings." : "Spectators join freely. Team seats need the creator’s password."}</p></> : modal === "invite" ? <><h2>Good auctions need good company.</h2><p>Share this link to invite spectators. Taking a team also requires the private password from the room creator.</p><div className="invite-code">{state.code}</div><input className="invite-url" aria-label="Room invitation link" readOnly value={typeof window !== "undefined" ? `${window.location.origin}/?room=${state.code}` : state.code} onFocus={e => e.currentTarget.select()}/><button className="button primary full" onClick={copyInvite}><Copy size={16}/>Copy invite link</button>{isCreator && <button className="button secondary full" onClick={() => { closeModal(); changeTab("settings"); }}><LockKeyhole size={16}/>Manage team password</button>}</> : <><h2>The auction, your way.</h2><p>All the excitement. You make the calls.</p><ol className="how-it-works"><li><span>01</span><div><strong>Set your stage</strong><p>Create a room, curate your player pool, and invite a manager for each team.</p></div></li><li><span>02</span><div><strong>Let the paddles do the talking</strong><p>The auctioneer chooses a player and opens bidding. Accepted bids have a short cooldown so every raise is clear.</p></div></li><li><span>03</span><div><strong>Going, going… yours.</strong><p>Lock bidding to stop all raises, then confirm the sale. Purses and squads update together.</p></div></li></ol><button className="button primary full" onClick={closeModal}>Got it. Let’s play.<ArrowRight size={17}/></button></>}</div></dialog>
    {toast && <div className="toast" role="status"><span><Check size={15}/></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={15}/></button></div>}
  </div>;
}
