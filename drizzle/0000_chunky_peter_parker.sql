CREATE TABLE `auction_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
