import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export * from "./auth-schema";

export const auctionRooms = sqliteTable("auction_rooms", {
  code: text("code").primaryKey(),
  stateJson: text("state_json").notNull(),
  version: integer("version").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/** Season source snapshots are fetched separately from the fast auction poll. */
export const auctionSeasons = sqliteTable("auction_seasons", {
  roomCode: text("room_code").primaryKey(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

/** Source jobs contain only public provider URLs and validated results. */
export const seasonSourceJobs = sqliteTable("season_source_jobs", {
  id: text("id").primaryKey(), sourceUrl: text("source_url").notNull(), status: text("status").notNull(),
  createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(),
  claimedAt: integer("claimed_at"), leaseExpiresAt: integer("lease_expires_at"), leaseTokenHash: text("lease_token_hash"),
  resultJson: text("result_json"), errorJson: text("error_json"),
}, table => [index("season_source_jobs_url_status").on(table.sourceUrl, table.status)]);

export const seasonSourceWorkerState = sqliteTable("season_source_worker_state", {
  id: text("id").primaryKey(), lastSeenAt: integer("last_seen_at").notNull(),
});

/** One canonical player pool for this installation, independent of browser credentials. */
export const sharedPlayerCatalog = sqliteTable("shared_player_catalog", {
  id: text("id").primaryKey(),
  playersJson: text("players_json").notNull(),
  version: integer("version").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** A retry key is a host credential. Only its digest is stored, atomically with the room. */
export const roomCreationRequests = sqliteTable("room_creation_requests", {
  keyHash: text("key_hash").primaryKey(),
  requestJson: text("request_json").notNull(),
  roomCode: text("room_code").notNull(),
  memberId: text("member_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Reserve deleted codes and authenticate an idempotent creator deletion retry. */
export const roomDeletions = sqliteTable("room_deletions", {
  code: text("code").primaryKey(),
  hostTokenHash: text("host_token_hash").notNull(),
  deletedAt: integer("deleted_at").notNull(),
});

/** Catalog-only editing capabilities do not grant membership in an auction room. */
export const catalogEditorSessions = sqliteTable("catalog_editor_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
