import type { RoomState } from "./auction.ts";
import { TEAM_CATALOG_VERSION } from "./team-catalog.ts";

type PollEntry = {
  version: number;
  catalogVersion: number | undefined;
  practice: boolean;
  members: Map<string, number>;
};

/** Authorization metadata only, never room/player payloads or bearer tokens.
 * Every hit must first match BOTH database versions read by the caller. */
export function createRoomPollCache(capacity = 128) {
  const entries = new Map<string, PollEntry>();
  return {
    forget(code: string) {
      entries.delete(code);
    },
    remember(state: RoomState, tokenHashes: Record<string, string>) {
      // Old rooms must pass through the append-only team upgrade before a fast poll.
      if (state.teamCatalogVersion !== TEAM_CATALOG_VERSION) {
        entries.delete(state.code);
        return;
      }
      const members = new Map<string, number>();
      for (const member of state.members) {
        const hash = tokenHashes[member.id];
        if (hash) members.set(hash, member.lastSeenAt);
      }
      entries.delete(state.code);
      entries.set(state.code, {
        version: state.version, catalogVersion: state.sharedCatalogVersion,
        practice: state.mode === "practice", members,
      });
      if (entries.size > capacity) entries.delete(entries.keys().next().value!);
    },
    check(code: string, version: number, catalogVersion: number | null, hash: string, now = Date.now()): "unchanged" | "unauthorized" | "miss" {
      const entry = entries.get(code);
      if (!entry || entry.version !== version || entry.catalogVersion !== catalogVersion) return "miss";
      const lastSeen = entry.members.get(hash);
      if (lastSeen === undefined) return "unauthorized";
      if (!entry.practice && now - lastSeen >= 25000) return "miss";
      entries.delete(code);
      entries.set(code, entry);
      return "unchanged";
    },
  };
}
