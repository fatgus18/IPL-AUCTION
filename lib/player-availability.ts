import type { Player } from "./auction";

/** Unsold players remain eligible for another call until they are signed. */
export function isAvailableForAuction(player: Pick<Player, "status" | "catalogArchived">): boolean {
  return !player.catalogArchived && (player.status === "available" || player.status === "unsold");
}
