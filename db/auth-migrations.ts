/** Additive, idempotent schema initialization for SQLite and hosted Turso. */
export const AUTH_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, username TEXT NOT NULL UNIQUE, display_username TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_accounts (
    id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER, scope TEXT, password TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS auth_accounts_user_idx ON auth_accounts(user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_verifications (
    id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx ON auth_verifications(identifier)`,
  `CREATE TABLE IF NOT EXISTS auth_rate_limits (
    id TEXT PRIMARY KEY NOT NULL, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL,
    last_request INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS account_rooms (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    room_code TEXT NOT NULL, member_id TEXT NOT NULL, encrypted_token TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS account_rooms_user_room_unique ON account_rooms(user_id, room_code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS account_rooms_member_unique ON account_rooms(room_code, member_id)`,
  `CREATE TABLE IF NOT EXISTS account_request_limits (
    key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
  )`,
];
