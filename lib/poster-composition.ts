import { createElement, type CSSProperties, type ReactNode } from "react";
import type { FranchisePoster, PosterPlayer } from "./franchise-poster.ts";
import { getBalancedPosterRows } from "./poster-layout.ts";

const box = (style: CSSProperties, ...children: ReactNode[]) => createElement("div", { style: { display: "flex", boxSizing: "border-box", flexShrink: 0, ...style } }, ...children);
const label = (text: string, style: CSSProperties = {}) => box({ fontSize: 22, color: "#cad0d8", ...style }, text);

function portraitRow(players: PosterPlayer[], images: (string | null)[], rowWidth: number, slotWidth: number, rowHeight: number, accent: string, dense: boolean) {
  const inset = (rowWidth - players.length * slotWidth) / 2;
  const imageHeight = Math.min(1080, rowHeight * (dense ? 1.55 : 1.3));
  // Wide transparent image boxes let tall portraits share a height; shoulders
  // can overlap while every head remains centred in its own formation slot.
  const imageWidth = Math.min(1100, Math.max(slotWidth * 1.48, imageHeight));
  // Outer shoulders sit behind the central figures. Batting order stays left-to-right.
  const layering = players.map((_, index) => index).sort((a, b) => Math.abs(b - (players.length - 1) / 2) - Math.abs(a - (players.length - 1) / 2));
  const portraits = layering.map(index => {
    const player = players[index], image = images[index];
    const left = inset + (index + .5) * slotWidth - imageWidth / 2;
    return box({ position: "absolute", left, top: 0, width: imageWidth, height: imageHeight, alignItems: "flex-start", justifyContent: "center" },
      image ? createElement("img", { src: image, width: imageWidth, height: imageHeight, style: { objectFit: "contain", objectPosition: "center top" } })
        : box({ width: slotWidth * .78, height: imageHeight, flexDirection: "column", alignItems: "center", paddingTop: 10 },
          box({ width: slotWidth * .3, height: slotWidth * .3, borderRadius: 200, background: `${accent}44` }),
          box({ width: "100%", height: imageHeight * .7, borderRadius: "100px 100px 0 0", background: `linear-gradient(180deg, ${accent}44, ${accent}00)`, marginTop: 14, alignItems: "flex-start", justifyContent: "center", paddingTop: 35, color: "#f3eee6", fontSize: 36, fontWeight: 700 }, player.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("")),
        ),
    );
  });
  const captions = players.map((player, index) => {
    const fontSize = player.name.length > 50 ? 16 : player.name.length > 30 ? 22 : dense ? 29 : 35;
    return box({ position: "absolute", left: inset + index * slotWidth, bottom: 0, width: slotWidth, minHeight: dense ? 61 : 73, padding: "0 8px 2px", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" },
      label(player.name.toUpperCase(), { maxWidth: slotWidth - 16, fontFamily: "PosterDisplay", fontWeight: 800, fontSize, lineHeight: 1.04, textAlign: "center", color: "#fff9ee", wordBreak: player.name.split(/\s+/).some(part => part.length > 20) ? "break-all" : "normal" }),
      box({ alignItems: "center", justifyContent: "center", gap: 8, marginTop: 7 },
        label(player.selection, { fontSize: dense ? 14 : 17, letterSpacing: 1.3, color: "#c3ccd7" }),
        player.captain || player.viceCaptain ? box({ padding: "2px 8px", borderRadius: 4, background: accent, color: "#08101b", fontWeight: 700, fontSize: dense ? 14 : 17, lineHeight: 1.15 }, player.captain ? "C" : "VC") : null,
      ),
    );
  });
  return box({ position: "relative", width: rowWidth, height: rowHeight },
    box({ position: "absolute", left: 0, top: 0, width: rowWidth, height: rowHeight, overflow: "hidden", maskImage: "linear-gradient(to bottom, #000 0%, #000 59%, transparent 96%)" }, ...portraits),
    ...captions,
  );
}

/** All row positions use one slot size, so short rows are centred without enlarging faces. */
export function createPosterComposition(poster: FranchisePoster, images: (string | null)[], logo: string | null, stadium: string): ReactNode {
  const rowCounts = getBalancedPosterRows(poster.players.length);
  if (!rowCounts.length) throw new RangeError("A poster needs at least one player.");
  if (images.length !== poster.players.length) throw new RangeError("Every player needs a portrait or an explicit fallback.");
  const stageWidth = 1320, stageHeight = 1330;
  const maxColumns = Math.max(...rowCounts);
  const slotWidth = Math.min(850, Math.floor(stageWidth / maxColumns));
  const gap = rowCounts.length > 4 ? 17 : 24;
  const rowHeight = Math.min(1100, Math.floor((stageHeight - gap * (rowCounts.length - 1)) / rowCounts.length));
  const formationHeight = rowHeight * rowCounts.length + gap * (rowCounts.length - 1);
  let offset = 0;
  const rows = rowCounts.map(count => {
    const row = portraitRow(poster.players.slice(offset, offset + count), images.slice(offset, offset + count), stageWidth, slotWidth, rowHeight, poster.accent, rowCounts.length >= 4);
    offset += count;
    return row;
  });
  const date = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(poster.endedAt).toUpperCase();
  return box({ position: "relative", width: 1440, height: 1800, background: poster.background, color: "#fff9ee", fontFamily: "Pavilion", flexDirection: "column", overflow: "hidden" },
    createElement("img", { src: stadium, width: 1440, height: 1800, style: { position: "absolute", top: 0, left: 0, objectFit: "cover", opacity: .24 } }),
    box({ position: "absolute", top: 0, left: 0, width: 1440, height: 1800, background: `linear-gradient(180deg, ${poster.background}d9, #09111c75 45%, #070e18ef 100%)` }),
    box({ position: "absolute", top: 0, left: 0, width: 1440, height: 7, background: poster.accent }),
    box({ position: "absolute", left: 64, top: 38, width: 1312, height: 31, alignItems: "center", justifyContent: "space-between" }, label("PAVILION / FRANCHISE EDITION", { fontSize: 17, letterSpacing: 2.8, fontWeight: 700, color: poster.accent }), label(date, { fontSize: 17, letterSpacing: 1.7 })),
    box({ position: "absolute", left: 64, top: 84, width: 1312, height: 143, alignItems: "center", justifyContent: "space-between" },
      box({ width: 1100, flexDirection: "column" }, label(poster.teamName.toUpperCase(), { fontFamily: "PosterDisplay", fontWeight: 800, fontSize: poster.teamName.length > 28 ? 76 : 90, lineHeight: 1.02, color: "#fff9ee" }), label(`THE FINAL SQUAD  /  ${poster.players.length} SIGNINGS`, { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: poster.accent, marginTop: 12 })),
      logo ? createElement("img", { src: logo, width: 140, height: 140, style: { objectFit: "contain" } }) : label(poster.shortName, { fontSize: 42, fontWeight: 700, color: poster.accent }),
    ),
    box({ position: "absolute", top: 252 + (stageHeight - formationHeight) / 2, left: 60, width: stageWidth, height: formationHeight, flexDirection: "column", gap }, ...rows),
    box({ position: "absolute", left: 64, top: 1620, width: 1312, height: 134, flexDirection: "column", justifyContent: "space-between", borderTop: "1px solid #ffffff2b", paddingTop: 18 },
      box({ alignItems: "center", justifyContent: "space-between", width: "100%" },
        box({ width: 900, flexShrink: 1, gap: 14, alignItems: "center" }, label("MANAGED BY", { fontSize: 16, letterSpacing: 1.6, color: "#aebbc9" }), label(poster.manager, { maxWidth: 675, fontSize: poster.manager.length > 30 ? 21 : 26, fontWeight: 700, wordBreak: "break-all", color: "#fff9ee" })),
        label(`₹${(poster.spentLakhs / 100).toFixed(2)} CR INVESTED`, { fontSize: 20, letterSpacing: .5, color: poster.accent, fontWeight: 700 }),
      ),
      box({ width: "100%", alignItems: "center", justifyContent: "space-between" }, label(poster.auctionName, { maxWidth: 980, fontSize: poster.auctionName.length > 55 ? 17 : 20, wordBreak: "break-all", color: "#c4cdd8" }), label(`RESULTS / ${String(poster.revision).padStart(2, "0")}`, { fontSize: 16, letterSpacing: 2, color: poster.accent })),
      label("C  CAPTAIN     VC  VICE CAPTAIN     XI  PLAYING ELEVEN     SUB  SUBSTITUTE", { fontSize: 13, letterSpacing: 1.4, color: "#94a4b6" }),
    ),
  );
}
