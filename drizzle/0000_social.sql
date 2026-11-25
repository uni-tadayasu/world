PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY NOT NULL,
  auth_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '旅人',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS profiles_name_idx ON profiles(name);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS friends (
  id TEXT PRIMARY KEY NOT NULL,
  user_a TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(user_a < user_b),
  CHECK(requester_id <> recipient_id),
  UNIQUE(user_a,user_b)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS friends_recipient_idx ON friends(recipient_id,status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS friends_requester_idx ON friends(requester_id,status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES profiles(id),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS members (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(org_id,user_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS members_user_idx ON members(user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages(channel,id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_sender_time_idx ON messages(sender_id,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  CHECK(blocker_id <> blocked_id),
  PRIMARY KEY(blocker_id,blocked_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks(blocked_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY NOT NULL,
  reporter_id TEXT NOT NULL REFERENCES profiles(id),
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  reported_user_id TEXT NOT NULL REFERENCES profiles(id),
  message_snapshot TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(reporter_id,message_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS voice_members (
  channel TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(channel,user_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS voice_members_time_idx ON voice_members(updated_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  from_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('offer','answer','ice')),
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS signals_recipient_idx ON signals(channel,to_id,id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS signals_sender_time_idx ON signals(from_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS signals_time_idx ON signals(created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS player_rooms (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  layout_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS player_belongings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
