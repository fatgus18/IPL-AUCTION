"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ShieldCheck, Trophy, X, type LucideIcon } from "lucide-react";
import type { RoomView } from "@/lib/room-navigation";
import "./room-navigation.css";

export type RoomNavigationItem = { key: RoomView; label: string; icon: LucideIcon };
type Props = {
  items: RoomNavigationItem[]; current: string; onNavigate: (view: RoomView) => void;
  playerCount: number; squadCount: number; targetCount: number; live: boolean;
  drawerOpen: boolean; onCloseDrawer: () => void;
};
const MY_TEAM = new Set<RoomView>(["my-squad", "build-xi", "targets"]);
const LEAGUE = new Set<RoomView>(["squads", "season"]);
const descriptions: Partial<Record<RoomView, string>> = {
  "my-squad": "Signings & captaincy", "build-xi": "Your matchday lineup", targets: "Your private shortlist",
  squads: "Every squad & playing XI", season: "Points, rankings & statistics",
};

/** Group destinations without fetching data or introducing another route state. */
export function RoomNavigation({ items, current, onNavigate, playerCount, squadCount, targetCount, live, drawerOpen, onCloseDrawer }: Props) {
  const id = useId();
  const navRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<"team" | "league" | null>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const personal = items.filter(item => MY_TEAM.has(item.key));
  const league = items.filter(item => LEAGUE.has(item.key));

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!groupRefs.current[expanded]?.contains(event.target as Node)) setExpanded(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  useEffect(() => {
    if (!drawerOpen) return;
    closeRef.current?.focus();
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseDrawer(); }
      if (event.key !== "Tab" || !navRef.current) return;
      const buttons = [...navRef.current.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.getClientRects().length > 0 && !button.disabled);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [drawerOpen, onCloseDrawer]);

  function navigate(view: RoomView) { setExpanded(null); onNavigate(view); }
  function entry(item: RoomNavigationItem, nested = false) {
    const Icon = item.icon;
    const count = item.key === "players" ? playerCount : item.key === "my-squad" ? squadCount : item.key === "targets" ? targetCount : 0;
    return <button type="button" key={item.key} data-destination={item.key} className={`nav-item${current === item.key ? " active" : ""}${nested ? " room-nav-destination" : ""}${item.key === "settings" ? " room-nav-settings" : ""}`} onClick={() => navigate(item.key)} aria-current={current === item.key ? "page" : undefined} aria-label={item.label} title={item.key === "settings" ? item.label : undefined}>
      <Icon size={18}/><span className="room-nav-copy"><span>{item.label}</span>{nested && <small>{descriptions[item.key]}</small>}</span>
      {nested && count > 0 ? <span className="nav-count">{count}</span> : null}
      {item.key === "room" && live && <span className="nav-live-dot" aria-label="Auction in progress"/>}
    </button>;
  }
  function group(key: "team" | "league", label: string, entries: RoomNavigationItem[], Icon: LucideIcon) {
    if (!entries.length) return null;
    const active = entries.find(item => item.key === current);
    const isExpanded = expanded === key;
    const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && isExpanded) { event.preventDefault(); setExpanded(null); triggerRefs.current[key]?.focus(); }
    };
    return <div className={`room-nav-group${isExpanded ? " is-expanded" : ""}`} ref={element => { groupRefs.current[key] = element; }} onKeyDown={keyboard}>
      <span className="room-nav-group-heading">{label}</span>
      <button type="button" ref={element => { triggerRefs.current[key] = element; }} className={`nav-item room-nav-trigger${active ? " active" : ""}`} aria-label={`${label} navigation`} aria-expanded={isExpanded} aria-controls={`${id}-${key}`} onClick={() => setExpanded(isExpanded ? null : key)} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setExpanded(key); requestAnimationFrame(() => groupRefs.current[key]?.querySelector<HTMLButtonElement>(".room-nav-destination")?.focus()); }
      }}><Icon size={18}/><span>{active?.label ?? label}</span><ChevronDown size={14} className="room-nav-chevron"/></button>
      <div className="room-nav-submenu" id={`${id}-${key}`} onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setExpanded(null); }}>
        <span className="room-nav-menu-title">{label}</span>{entries.map(item => entry(item, true))}
      </div>
    </div>;
  }

  return <nav ref={navRef} className="room-navigation" aria-label="Main navigation">
    <div className="room-nav-drawer-heading"><span>Your room</span><button ref={closeRef} type="button" aria-label="Close navigation menu" onClick={onCloseDrawer}><X size={22}/></button></div>
    <div className="room-nav-primary">{items.filter(item => item.key === "room" || item.key === "players").map(item => entry(item))}</div>
    {group("team", "My team", personal, ShieldCheck)}
    {group("league", "League", league, Trophy)}
    {items.filter(item => item.key === "settings").map(item => entry(item))}
  </nav>;
}
