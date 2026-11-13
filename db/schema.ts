import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const auctionRooms = sqliteTable("auction_rooms", {
  code: text("code").primaryKey(),
  stateJson: text("state_json").notNull(),
  version: integer("version").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});
