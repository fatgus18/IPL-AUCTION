import { useId, useState, type ReactElement } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import type { Player } from "@/lib/auction";
import "./lineup-player-stats.css";

const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const metrics = [["matches", "Matches"], ["runs", "Runs"], ["wickets", "Wickets"], ["strikeRate", "Strike rate"]] as const;

/** The room already carries these values. Opening stats never starts a request. */
export function LineupPlayerStats({ player, showName = false }: { player: Player; showName?: boolean }) {
  const format = player.statsFormat && player.statsFormat !== "Unknown" ? player.statsFormat : null;
  const provenance = player.dataStatus === "manual" ? "Organizer stats" : player.dataStatus === "illustrative" ? "Illustrative stats" : "Career stats";
  const available = metrics.some(([key]) => typeof player.stats[key] === "number" && Number.isFinite(player.stats[key]));

  return <section className="lineup-player-stats" aria-label={`${player.name} statistics`}>
    <header>
      {showName && <strong>{player.name}</strong>}
      <span>{format && <b>{format}</b>}{provenance}</span>
    </header>
    <dl>{metrics.map(([key, label]) => {
      const value = player.stats[key];
      return <div key={key} data-stat={key}><dt>{label}</dt><dd>{typeof value === "number" && Number.isFinite(value) ? numberFormat.format(value) : <span aria-label="Not available">—</span>}</dd></div>;
    })}</dl>
    {!available ? <p>Statistics not available</p> : !format ? <p>Format not supplied</p> : null}
  </section>;
}

export function LineupPlayerTooltip({ player, disabled, children }: { player?: Player; disabled: boolean; children: ReactElement }) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  // Keep the trigger mounted when a slot fills so the picker can restore focus.
  return <Tooltip.Root disabled={disabled || !player} disableHoverablePopup={false} open={open} onOpenChange={setOpen}>
    <Tooltip.Trigger render={children} aria-describedby={open && !disabled && player ? tooltipId : undefined} />
    {player && <Tooltip.Portal>
      <Tooltip.Positioner className="lineup-stats-positioner" positionMethod="fixed" side="top" sideOffset={10} collisionPadding={{ top: 80, right: 16, bottom: 104, left: 16 }}>
        <Tooltip.Popup className="lineup-stats-popup" id={tooltipId} role="tooltip">
          <LineupPlayerStats player={player} showName />
          <Tooltip.Arrow className="lineup-stats-arrow"><svg viewBox="0 0 12 8" aria-hidden="true"><path d="M0 8 6 1 12 8" /></svg></Tooltip.Arrow>
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>}
  </Tooltip.Root>;
}

export function LineupStatsProvider({ children }: { children: ReactElement }) {
  return <Tooltip.Provider delay={180} closeDelay={120}>{children}</Tooltip.Provider>;
}
