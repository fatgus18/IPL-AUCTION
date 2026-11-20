import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import satori from "satori";
import sharp from "sharp";
import { AuctionError, type RoomState } from "./auction.ts";
import { getPlayingRole } from "./player-roles.ts";
import { PLAYER_IMAGES, TEAM_LOGOS } from "./visual-assets.ts";
import { createPosterComposition } from "./poster-composition.ts";
import { getSquadCaptaincy } from "./squad-captaincy.ts";

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
  const { captainId, viceCaptainId } = getSquadCaptaincy(team, state.players);
  const players = team.squad.map(purchase => {
    const player = byId.get(purchase.playerId);
    const xi = team.lineup?.playingXI.indexOf(purchase.playerId) ?? -1;
    const sub = team.lineup?.substitutes.indexOf(purchase.playerId) ?? -1;
    const slug = player?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ?? "";
    return {
      id: purchase.playerId, name: safeText(player?.name ?? "Player unavailable"), role: getPlayingRole(player) ?? "Player",
      portrait: PLAYER_IMAGES[purchase.playerId] ?? PLAYER_IMAGES[slug] ?? null,
      selection: xi >= 0 ? `XI ${String(xi + 1).padStart(2, "0")}` : sub >= 0 ? `SUB ${sub + 1}` : "SQUAD",
      captain: captainId === purchase.playerId,
      viceCaptain: viceCaptainId === purchase.playerId,
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

const portraitAssets = new Set(Object.values(PLAYER_IMAGES));
const allowedAssets = new Set([...portraitAssets, ...Object.values(TEAM_LOGOS)]);
const assetCache = new Map<string, Promise<string | null>>();
/** Accept only catalogued repository assets. Player-provided image URLs never reach disk or the network. */
export async function loadPosterAsset(asset: string | null): Promise<string | null> {
  if (!asset || !allowedAssets.has(asset)) return null;
  let cached = assetCache.get(asset);
  if (!cached) {
    cached = readFile(path.join(process.cwd(), "public", asset.slice(1)))
      .then(async bytes => {
        const input = sharp(bytes, { limitInputPixels: 16_000_000 });
        const metadata = await input.metadata();
        if (portraitAssets.has(asset) && metadata.hasAlpha) input.trim({ background: "#00000000", threshold: 12 });
        return input.resize(portraitAssets.has(asset)
          ? { width: 512, height: 768, fit: "inside", withoutEnlargement: true }
          : { width: 384, height: 480, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      })
      .then(bytes => `data:image/png;base64,${bytes.toString("base64")}`)
      .catch(() => { assetCache.delete(asset); return null; });
    assetCache.set(asset, cached);
  }
  return cached;
}

let fontPromise: Promise<[Buffer, Buffer, Buffer]> | undefined;
const fonts = () => fontPromise ??= Promise.all([
  readFile(path.join(process.cwd(), "lib/export-assets/NotoSans-Regular.ttf")),
  readFile(path.join(process.cwd(), "lib/export-assets/NotoSans-Bold.ttf")),
  readFile(path.join(process.cwd(), "public/fonts/barlow-condensed-800.woff2")),
]).catch(error => { fontPromise = undefined; throw error; });
let stadiumPromise: Promise<string> | undefined;
function stadiumBackdrop(): Promise<string> {
  return stadiumPromise ??= readFile(path.join(process.cwd(), "public/cinematic/stadium-poster.webp"))
    // JPEG is reliably decoded when embedded in SVG on every deployment platform.
    .then(bytes => sharp(bytes).resize(1440, 1800, { fit: "cover" }).jpeg({ quality: 72 }).toBuffer())
    .then(bytes => "data:image/jpeg;base64," + bytes.toString("base64"))
    .catch(error => { stadiumPromise = undefined; throw error; });
}

/** Balanced vertical cutout formation with only packaged assets. */
export async function renderFranchisePosterSvg(poster: FranchisePoster): Promise<string> {
  const [fontData, logo, stadium] = await Promise.all([fonts(), loadPosterAsset(poster.logo), stadiumBackdrop()]);
  const images: (string | null)[] = [];
  for (let index = 0; index < poster.players.length; index += 4) images.push(...await Promise.all(poster.players.slice(index, index + 4).map(player => loadPosterAsset(player.portrait))));
  const element = createPosterComposition(poster, images, logo, stadium);
  return satori(element, { width: POSTER_WIDTH, height: POSTER_HEIGHT, fonts: [{ name: "Pavilion", data: fontData[0], weight: 400 }, { name: "Pavilion", data: fontData[1], weight: 700 }, { name: "PosterDisplay", data: fontData[2], weight: 800 }], embedFont: true });
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
