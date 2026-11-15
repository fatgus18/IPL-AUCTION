"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";
import { UserRound } from "lucide-react";
import { PLAYER_IMAGES, TEAM_LOGOS } from "@/lib/visual-assets";
import { CATALOG_PORTRAITS } from "@/lib/catalog-portraits";
import "./player-portraits.css";

const CUTOUT_SOURCES = new Set(Object.values(PLAYER_IMAGES));

export function PlayerImage({ player, className = "", priority = false }: {
  player: { id: string; name: string; image?: string };
  className?: string;
  priority?: boolean;
}) {
  // Known IPL cutouts are sharper than imported profile thumbnails. If a source
  // fails, try the next available photo and classify the source actually used.
  const normalizedName = player.name.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const sources = [PLAYER_IMAGES[player.id] ?? PLAYER_IMAGES[normalizedName], CATALOG_PORTRAITS[player.id], player.image];
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const src = sources.find((source) => source && !failedSources.includes(source));
  const [dimensions, setDimensions] = useState<{ src: string; width: number; height: number } | null>(null);
  if (!src) return <span className={`portrait-fallback ${className}`} role="img" aria-label={player.name}><UserRound strokeWidth={1}/><span>{player.name.split(" ").map(part => part[0]).slice(0, 2).join("")}</span></span>;
  const cutout = CUTOUT_SOURCES.has(src);
  const size = dimensions?.src === src ? dimensions : null;
  const scale = size ? Math.min(1.5, 320 / size.width, 260 / size.height) : 1;
  const style = size && !cutout ? {
    // Do not blow up a 112px Cricbuzz thumbnail to the size of a hero cutout.
    "--portrait-display-width": `${size.width * scale}px`,
    "--portrait-display-height": `${size.height * scale}px`,
    "--portrait-aspect-ratio": size.width / size.height,
  } as CSSProperties : undefined;
  return <Image
    key={src}
    className={`player-portrait ${className} ${cutout ? "portrait-cutout" : "profile-headshot"}`}
    src={src}
    width={size?.width ?? 600}
    height={size?.height ?? 600}
    alt={player.name}
    style={style}
    loading={priority ? "eager" : "lazy"}
    fetchPriority={priority ? "high" : "auto"}
    unoptimized
    onLoad={(event) => {
      const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
      if (width && height) setDimensions((previous) => previous?.src === src && previous.width === width && previous.height === height ? previous : { src, width, height });
    }}
    onError={() => setFailedSources((previous) => previous.includes(src) ? previous : [...previous, src])}
  />;
}

export function TeamCrest({ team, className = "" }: {
  team: { id: string; name: string; shortName: string };
  className?: string;
}) {
  const src = TEAM_LOGOS[team.id];
  const [failed, setFailed] = useState(false);
  return src && !failed
    ? <Image className={className} src={src} width={96} height={96} alt={`${team.name} crest`} unoptimized onError={() => setFailed(true)}/>
    : <span className={`crest-fallback ${className}`}>{team.shortName}</span>;
}
