import { createElement, type CSSProperties, type ReactNode } from "react";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import satori from "satori";
import sharp from "sharp";
import { AuctionError, type RoomState } from "./auction.ts";
import { getPlayingRole } from "./player-roles.ts";
import { PLAYER_IMAGES, TEAM_LOGOS } from "./visual-assets.ts";

export const POSTER_WIDTH = 1440;
export const POSTER_HEIGHT = 1800;
export type PosterPlayer = { id: string; name: string; role: string; portrait: string | null; selection: string; captain: boolean; viceCaptain: boolean };
export type FranchisePoster = {
  code: string; auctionName: string; endedAt: number; revision: number;
  teamId: string; teamName: string; shortName: string; manager: string;
  accent: string; background: string; logo: string | null; spentLakhs: number;
  players: PosterPlayer[];
};

const TEAM_BACKGROUNDS: Record<string, string> = {
  csk: "#292309", mi: "#081e41", rcb: "#300e18", kkr: "#211334", srh: "#321a0c", rr: "#301028",
  dc: "#082437", pbks: "#310f18", dch: "#142333", pwi: "#09292b", gt: "#101e2b", lsg: "#0b2044",
};
const safeText = (value: string, max = 100) => Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " ")).slice(0, max).join("");

/** Only public squad fields enter the renderer. Never hand it an entire room snapshot. */
export function buildFranchisePoster(state: RoomState, teamId: string): FranchisePoster {
  if (state.endedAt === undefined) throw new AuctionError("Finish the auction before creating a squad poster.", 409, "AUCTION_NOT_ENDED");
  const team = state.teams.find(team => team.id === teamId);
  if (!team) throw new AuctionError("Choose a franchise in this auction.", 404, "TEAM_NOT_FOUND");
  if (!team.squad.length) throw new AuctionError("This franchise has no signings to include in a poster.", 409, "POSTER_EMPTY_SQUAD");
  if (team.squad.length > 30) throw new AuctionError("This squad exceeds the supported poster size.", 409, "POSTER_SQUAD_TOO_LARGE");
  const byId = new Map(state.players.map(player => [player.id, player]));
  const players = team.squad.map(purchase => {
    const player = byId.get(purchase.playerId);
    const xi = team.lineup?.playingXI.indexOf(purchase.playerId) ?? -1;
    const sub = team.lineup?.substitutes.indexOf(purchase.playerId) ?? -1;
    const slug = player?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ?? "";
    return {
      id: purchase.playerId, name: safeText(player?.name ?? "Player unavailable"), role: getPlayingRole(player) ?? "Player",
      portrait: PLAYER_IMAGES[purchase.playerId] ?? PLAYER_IMAGES[slug] ?? null,
      selection: xi >= 0 ? `XI ${String(xi + 1).padStart(2, "0")}` : sub >= 0 ? `SUB ${sub + 1}` : "SQUAD",
      captain: xi >= 0 && team.lineup?.captainId === purchase.playerId,
      viceCaptain: xi >= 0 && team.lineup?.viceCaptainId === purchase.playerId,
      order: xi >= 0 ? xi : sub >= 0 ? 11 + sub : 16 + team.squad.indexOf(purchase),
    };
  }).sort((a, b) => a.order - b.order).map(player => ({ id: player.id, name: player.name, role: player.role, portrait: player.portrait, selection: player.selection, captain: player.captain, viceCaptain: player.viceCaptain }));
  return {
    code: safeText(state.code, 12), auctionName: safeText(state.name), endedAt: state.endedAt, revision: state.resultsRevision ?? 0,
    teamId: team.id, teamName: safeText(team.name), shortName: safeText(team.shortName, 8),
    manager: safeText(state.completedManagers?.[team.id]?.name ?? state.members.find(member => member.role === "bidder" && member.teamId === team.id)?.name ?? "No manager assigned"),
    accent: /^#[a-f\d]{6}$/i.test(team.color) ? team.color : "#d5b477", background: TEAM_BACKGROUNDS[team.id] ?? "#101c28",
    logo: TEAM_LOGOS[team.id] ?? null, spentLakhs: team.squad.reduce((sum, purchase) => sum + purchase.amount, 0), players,
  };
}

const allowedAssets = new Set([...Object.values(PLAYER_IMAGES), ...Object.values(TEAM_LOGOS)]);
const assetCache = new Map<string, Promise<string | null>>();
/** Accept only catalogued repository assets. Player-provided image URLs never reach disk or the network. */
export async function loadPosterAsset(asset: string | null): Promise<string | null> {
  if (!asset || !allowedAssets.has(asset)) return null;
  let cached = assetCache.get(asset);
  if (!cached) {
    cached = readFile(path.join(process.cwd(), "public", asset.slice(1)))
      .then(bytes => sharp(bytes, { limitInputPixels: 16_000_000 }).resize(384, 480, { fit: "inside", withoutEnlargement: true }).png().toBuffer())
      .then(bytes => `data:image/png;base64,${bytes.toString("base64")}`)
      .catch(() => { assetCache.delete(asset); return null; });
    assetCache.set(asset, cached);
  }
  return cached;
}

let fontPromise: Promise<[Buffer, Buffer]> | undefined;
const fonts = () => fontPromise ??= Promise.all([
  readFile(path.join(process.cwd(), "lib/export-assets/NotoSans-Regular.ttf")),
  readFile(path.join(process.cwd(), "lib/export-assets/NotoSans-Bold.ttf")),
]).catch(error => { fontPromise = undefined; throw error; });
const box = (style: CSSProperties, ...children: ReactNode[]) => createElement("div", { style: { display: "flex", boxSizing: "border-box", flexShrink: 0, ...style } }, ...children);
const label = (text: string, style: CSSProperties = {}) => box({ fontSize: 22, color: "#cad0d8", ...style }, text);

function playerCard(player: PosterPlayer, image: string | null, width: number, height: number, accent: string) {
  const dense = height < 240;
  const fontSize = dense ? 21 : width < 300 ? 25 : 29;
  const imageHeight = height - (dense ? 82 : 102);
  const portrait = image ? createElement("img", { src: image, width: width - 26, height: imageHeight, style: { objectFit: "contain", objectPosition: "center bottom" } })
    : box({ width: width - 26, height: imageHeight, alignItems: "center", justifyContent: "center", fontSize: Math.min(90, imageHeight / 2), fontWeight: 700, color: `${accent}aa` }, player.name.split(/\s+/).slice(0, 2).map(part => part[0]).join(""));
  return box({ width, height, position: "relative", flexDirection: "column", alignItems: "center", borderRadius: 15, overflow: "hidden", background: "linear-gradient(150deg, #ffffff0d, #ffffff02)", border: `1px solid ${player.captain || player.viceCaptain ? `${accent}a0` : "#ffffff1c"}` },
    box({ position: "absolute", top: 13, left: 15, fontSize: dense ? 14 : 17, letterSpacing: 1.4, color: "#cbd2dc" }, player.selection),
    player.captain || player.viceCaptain ? box({ position: "absolute", right: 12, top: 10, width: dense ? 32 : 40, height: dense ? 32 : 40, borderRadius: 20, background: accent, color: "#10151c", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }, player.captain ? "C" : "VC") : null,
    box({ height: imageHeight, alignItems: "flex-end", justifyContent: "center", marginTop: 7 }, portrait),
    box({ width: "100%", flex: 1, padding: dense ? "4px 12px 10px" : "8px 12px 15px", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#080e15aa" },
      box({ fontSize: player.name.length > 50 ? 14 : player.name.length > 35 ? 16 : player.name.length > 26 ? fontSize - 3 : fontSize, wordBreak: player.name.split(/\s+/).some(part => part.length > 20) ? "break-all" : "normal", fontWeight: 700, textAlign: "center", lineHeight: 1.13, color: "#fff9ee" }, player.name),
      label(player.role, { fontSize: dense ? 15 : 18, marginTop: 5, color: "#bac2cc" }),
    ),
  );
}

/** Returns self-contained SVG with embedded image data and text converted into font paths. */
export async function renderFranchisePosterSvg(poster: FranchisePoster): Promise<string> {
  const [fontData, logo] = await Promise.all([fonts(), loadPosterAsset(poster.logo)]);
  // Bound image decoding concurrency, even for a 30-player squad.
  const images: (string | null)[] = [];
  for (let index = 0; index < poster.players.length; index += 4) images.push(...await Promise.all(poster.players.slice(index, index + 4).map(player => loadPosterAsset(player.portrait))));
  const count = poster.players.length;
  const columns = count <= 2 ? count : count <= 9 ? 3 : count <= 16 ? 4 : 5;
  const rows = Math.ceil(count / columns);
  const gap = count > 16 ? 18 : 23;
  const cardWidth = Math.min(570, Math.floor((1304 - gap * (columns - 1)) / columns));
  const cardHeight = Math.min(Math.floor(cardWidth * 1.5), 900, Math.floor((1170 - gap * (rows - 1)) / rows));
  const date = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(poster.endedAt).toUpperCase();
  const gridRows = Array.from({ length: rows }, (_, row) => box({ gap, justifyContent: "center", width: "100%" }, ...poster.players.slice(row * columns, (row + 1) * columns).map((player, column) => playerCard(player, images[row * columns + column], cardWidth, cardHeight, poster.accent))));
  const element = box({ position: "relative", width: POSTER_WIDTH, height: POSTER_HEIGHT, background: `linear-gradient(145deg, ${poster.background}, #070c13 82%)`, color: "#fff9ee", fontFamily: "Pavilion", flexDirection: "column", overflow: "hidden" },
    box({ position: "absolute", right: -100, top: -200, width: 850, height: 850, borderRadius: 425, border: `1px solid ${poster.accent}40` }),
    box({ position: "absolute", right: -45, top: -140, width: 735, height: 735, borderRadius: 370, border: `1px solid ${poster.accent}22` }),
    box({ position: "absolute", top: 0, left: 0, width: POSTER_WIDTH, height: 9, background: poster.accent }),
    box({ position: "absolute", left: 68, top: 56, width: 1304, height: 1702, flexDirection: "column" },
    box({ height: 38, justifyContent: "space-between", alignItems: "center" }, label("PAVILION / FRANCHISE EDITION", { color: poster.accent, letterSpacing: 3, fontSize: 19, fontWeight: 700 }), label(date, { fontSize: 18, letterSpacing: 2 })),
    box({ height: 212, alignItems: "center", justifyContent: "space-between" },
      box({ flexDirection: "column", maxWidth: 1080 }, label("THE SQUAD", { fontWeight: 700, fontSize: 89, letterSpacing: -4, lineHeight: 1.03, color: "#fff9ee" }), label(poster.teamName.toUpperCase(), { fontWeight: 700, fontSize: poster.teamName.length > 25 ? 32 : 38, color: poster.accent, marginTop: 13, letterSpacing: 1 })),
      logo ? createElement("img", { src: logo, width: 170, height: 170, style: { objectFit: "contain" } }) : label(poster.shortName, { color: poster.accent, fontWeight: 700, fontSize: 50 }),
    ),
    box({ height: 83, alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #ffffff22", borderBottom: "1px solid #ffffff22", marginBottom: 32 },
      box({ width: 840, maxWidth: 840, flexShrink: 1, alignItems: "center", gap: 13 }, label("MANAGER", { fontSize: 17, letterSpacing: 2, color: "#a8b1c0" }), label(poster.manager, { maxWidth: 660, flexShrink: 1, wordBreak: poster.manager.split(/\s+/).some(part => part.length > 20) ? "break-all" : "normal", lineHeight: 1.15, fontSize: poster.manager.length > 35 ? 22 : 27, color: "#fff9ee", fontWeight: 700 })),
      box({ gap: 27, alignItems: "center" }, label(`${count} SIGNINGS`, { color: poster.accent, fontSize: 19, fontWeight: 700 }), label(`₹${(poster.spentLakhs / 100).toFixed(2)} Cr`, { fontSize: 30, fontWeight: 700, color: "#fff9ee" })),
    ),
    box({ height: 1170, flexDirection: "column", gap, justifyContent: "center" }, ...gridRows),
    box({ flex: 1, minHeight: 100, flexDirection: "column", justifyContent: "flex-end" },
      box({ justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #ffffff22", paddingTop: 22 }, label(poster.auctionName, { maxWidth: 980, flexShrink: 1, wordBreak: poster.auctionName.split(/\s+/).some(part => part.length > 30) ? "break-all" : "normal", lineHeight: 1.2, fontSize: poster.auctionName.length > 55 ? 19 : 23, color: "#e0e3e7" }), label(`RESULTS / ${String(poster.revision).padStart(2, "0")}`, { fontSize: 16, letterSpacing: 2, color: poster.accent })),
      label("C CAPTAIN  ·  VC VICE CAPTAIN  ·  XI PLAYING ELEVEN  ·  SUB SUBSTITUTE", { fontSize: 18, color: "#9da8b8", letterSpacing: 1, marginTop: 17 }),
    )),
  );
  return satori(element, { width: POSTER_WIDTH, height: POSTER_HEIGHT, fonts: [{ name: "Pavilion", data: fontData[0], weight: 400 }, { name: "Pavilion", data: fontData[1], weight: 700 }], embedFont: true });
}

const renderedPosters = new Map<string, { bytes: Buffer; expiresAt: number }>();
const pendingPosters = new Map<string, Promise<Buffer>>();
const MAX_POSTER_CACHE_BYTES = 12_000_000;
let cachedPosterBytes = 0;

/** Cache only the public projection, with a short lifetime and a strict memory ceiling. */
export async function createFranchisePosterPng(poster: FranchisePoster): Promise<Buffer> {
  const key = createHash("sha256").update(JSON.stringify(poster)).digest("hex");
  const now = Date.now();
  for (const [cachedKey, cached] of renderedPosters) if (cached.expiresAt <= now) { renderedPosters.delete(cachedKey); cachedPosterBytes -= cached.bytes.byteLength; }
  const cached = renderedPosters.get(key);
  if (cached) { renderedPosters.delete(key); renderedPosters.set(key, cached); return cached.bytes; }
  const pending = pendingPosters.get(key); if (pending) return pending;
  const rendering = (async () => {
    const svg = await renderFranchisePosterSvg(poster);
    const bytes = await sharp(Buffer.from(svg), { limitInputPixels: POSTER_WIDTH * POSTER_HEIGHT }).png({ compressionLevel: 6 }).toBuffer();
    while (renderedPosters.size && (renderedPosters.size >= 6 || cachedPosterBytes + bytes.byteLength > MAX_POSTER_CACHE_BYTES)) {
      const oldest = renderedPosters.entries().next().value!; renderedPosters.delete(oldest[0]); cachedPosterBytes -= oldest[1].bytes.byteLength;
    }
    if (bytes.byteLength <= MAX_POSTER_CACHE_BYTES) { renderedPosters.set(key, { bytes, expiresAt: Date.now() + 120_000 }); cachedPosterBytes += bytes.byteLength; }
    return bytes;
  })();
  pendingPosters.set(key, rendering);
  try { return await rendering; } finally { pendingPosters.delete(key); }
}

export function franchisePosterFilename(poster: Pick<FranchisePoster, "code" | "shortName" | "revision">): string {
  const clean = (value: string) => value.replace(/[^a-z0-9-]/gi, "").slice(0, 12) || "squad";
  return `pavilion-${clean(poster.code)}-${clean(poster.shortName)}-squad-r${poster.revision}.png`;
}
