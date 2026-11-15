import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { TEAM_SEEDS } from "@/lib/team-catalog";
import { TEAM_LOGOS } from "@/lib/visual-assets";

type HeroTab = "home" | "room" | "players" | "squads" | "my-squad" | "build-xi" | "settings";

const COPY: Record<HeroTab, { kicker: string; first: string; second: string; description: string }> = {
  home: { kicker: "THE IPL AUCTION EXPERIENCE", first: "EVERY BID.", second: "A NEW LEGACY.", description: "The biggest names. Your next dynasty." },
  room: { kicker: "THE IPL AUCTION EXPERIENCE", first: "EVERY BID.", second: "A NEW LEGACY.", description: "The biggest names. Your next dynasty." },
  players: { kicker: "THE SHARED PLAYER COLLECTION", first: "THE TALENT.", second: "YOUR VISION.", description: "Find your next match-winner. Build something unforgettable." },
  squads: { kicker: "TWELVE FRANCHISES. ONE AMBITION.", first: "RIVALS TODAY.", second: "LEGENDS NEXT.", description: "Every signing is a statement. This is where it takes shape." },
  "my-squad": { kicker: "YOUR COLOURS. YOUR CALL.", first: "YOUR SQUAD.", second: "YOUR LEGACY.", description: "Every winning bid. Every player you bring home." },
  "build-xi": { kicker: "MATCHDAY", first: "BUILD", second: "YOUR XI.", description: "Your players. Your batting order." },
  settings: { kicker: "YOUR AUCTION. YOUR CALL.", first: "SET THE STAGE.", second: "OWN THE NIGHT.", description: "Fine-tune your room. Let the rivalry begin." },
};

const FACES = [
  { id: "hardik-pandya", name: "Hardik Pandya", x: 7, height: .94, depth: 1, mobileX: 88, row: 0 },
  { id: "shreyas-iyer", name: "Shreyas Iyer", x: 19.3, height: .98, depth: 2, mobileX: 63, row: 0 },
  { id: "shubman-gill", name: "Shubman Gill", x: 31.6, height: .96, depth: 3, mobileX: 37, row: 0 },
  { id: "virat-kohli", name: "Virat Kohli", x: 43.9, height: 1.04, depth: 6, mobileX: 37, row: 1 },
  { id: "rohit-sharma", name: "Rohit Sharma", x: 56.1, height: 1.02, depth: 5, mobileX: 12, row: 1 },
  { id: "rishabh-pant", name: "Rishabh Pant", x: 68.4, height: .96, depth: 4, mobileX: 63, row: 1 },
  { id: "jasprit-bumrah", name: "Jasprit Bumrah", x: 80.7, height: .98, depth: 2, mobileX: 12, row: 0 },
  { id: "kl-rahul", name: "KL Rahul", x: 93, height: .94, depth: 3, mobileX: 88, row: 1 },
];

/** Pre-sized static artwork: no video, timers, observers or animation state. */
export function CinematicHero({ tab, playerCount, children, posterSrc = "/hero-player/stadium.webp" }: {
  tab: HeroTab;
  playerCount: number;
  children?: ReactNode;
  posterSrc?: string;
}) {
  const copy = COPY[tab];
  const isRoom = tab === "room" || tab === "home";

  return <section className={`cinematic-hero cinematic-${tab}${tab === "home" ? " cinematic-room" : ""}`} aria-label={isRoom ? "Welcome to Pavilion" : copy.kicker}>
    {isRoom && <div className="cinematic-scene" aria-hidden="true" style={{ backgroundImage: `url('${posterSrc}')` }} />}
    {isRoom && <div className="cinematic-lineup" aria-label="Featured IPL players">
      {FACES.map(player => <div key={player.id} className={`cinematic-cast-player cast-row-${player.row}`} style={{ "--cast-x": `${player.x}%`, "--cast-scale": player.height, "--cast-depth": player.depth, "--mobile-x": `${player.mobileX}%` } as CSSProperties}>
        <Image unoptimized src={`/hero-player/${player.id}.webp`} alt={player.name} width={360} height={500} loading="eager" fetchPriority={player.id === "virat-kohli" ? "high" : "auto"} />
      </div>)}
    </div>}
    {isRoom && <div className="cinematic-lower-shade" aria-hidden="true" />}
    <div className="cinematic-content">
      <p className="cinematic-kicker"><span />{copy.kicker}</p>
      <h1>{copy.first} <em>{copy.second}</em></h1>
      <p className="cinematic-description">{copy.description}</p>
      {children && <div className="cinematic-actions">{children}</div>}
    </div>
    {isRoom && <div className="cinematic-foot">
      <div className="cinematic-franchises" aria-label="Twelve IPL franchises, including Gujarat Titans, Lucknow Super Giants, Deccan Chargers and Pune Warriors India">
        {TEAM_SEEDS.map(team => <span key={team.id} title={team.name}>{TEAM_LOGOS[team.id] ? <Image unoptimized src={TEAM_LOGOS[team.id]} width={36} height={36} alt={`${team.name} crest`} /> : <span className="cinematic-team-initials">{team.shortName}</span>}</span>)}
      </div>
      <span className="cinematic-pool-count"><strong>{playerCount.toLocaleString("en-IN")}</strong> players. Endless possibilities.<ArrowUpRight size={17}/></span>
    </div>}
  </section>;
}
