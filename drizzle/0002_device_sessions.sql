-- Browser-owned identities. Existing hosted-account profiles and their data remain untouched.
CREATE TABLE IF NOT EXISTS device_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES profiles(id),
  created_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS device_sessions_expiry_idx ON device_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS device_session_limits (
  bucket_key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS device_session_limits_expiry_idx ON device_session_limits(expires_at);
