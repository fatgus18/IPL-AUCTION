import type { RoomState } from "./auction.ts";

export type LotNotificationSnapshot = Pick<RoomState,
  "id" | "code" | "version" | "currentPlayerId" | "phase" | "activity"
>;

export type LotNotification = { key: string; playerId: string };
export type LotNotificationOptions = { connected: boolean; away: boolean };

/**
 * Tracks accepted room snapshots, not renders or navigation events. Keep one
 * instance for the mounted app and observe every accepted snapshot, including
 * while the participant is on the auction page. No event history is retained.
 */
export class LotNotificationTracker {
  private roomKey: string | null = null;
  private version = -1;
  private playerId: string | null = null;
  private selectionId: string | null = null;
  private selectionAt = -Infinity;

  reset(): void {
    this.roomKey = null;
    this.version = -1;
    this.playerId = null;
    this.selectionId = null;
    this.selectionAt = -Infinity;
  }

  observe(snapshot: LotNotificationSnapshot | null, options: LotNotificationOptions): LotNotification | null {
    if (!snapshot) {
      this.reset();
      return null;
    }
    // Do not consume a missed selection until an authoritative connection is
    // restored. The next accepted snapshot announces only its current lot.
    if (!options.connected) return null;

    const roomKey = `${snapshot.id}:${snapshot.code}`;
    const firstSnapshot = roomKey !== this.roomKey;
    if (firstSnapshot) {
      this.reset();
      this.roomKey = roomKey;
    } else if (snapshot.version <= this.version) {
      return null;
    }

    // Activity is appended in commit order. Prefer that order to wall-clock
    // sorting: two selections can legitimately share the same timestamp.
    let selection: LotNotificationSnapshot["activity"][number] | undefined;
    for (let index = snapshot.activity.length - 1; index >= 0; index--) {
      if (snapshot.activity[index].type === "player") {
        selection = snapshot.activity[index];
        break;
      }
    }

    const changedPlayer = snapshot.currentPlayerId !== this.playerId;
    const newSelection = selection !== undefined && selection.id !== this.selectionId
      && selection.at >= this.selectionAt;

    this.version = snapshot.version;
    this.playerId = snapshot.currentPlayerId;
    if (newSelection && selection) {
      this.selectionId = selection.id;
      this.selectionAt = selection.at;
    }

    // A selection may already have been settled while this page was offline.
    // Consume it above, but never invite someone to a completed auction lot.
    if (firstSnapshot || !options.away || !snapshot.currentPlayerId
      || snapshot.phase === "sold" || snapshot.phase === "unsold"
      || (!changedPlayer && !newSelection)) return null;

    return {
      key: `${roomKey}:${newSelection && selection ? selection.id : `version-${snapshot.version}`}:${snapshot.currentPlayerId}`,
      playerId: snapshot.currentPlayerId,
    };
  }
}
