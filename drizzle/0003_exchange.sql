-- Server-confirmed reward points are isolated from client-side game money.
-- Amounts are integers; confirmed_points includes funds currently reserved.
CREATE TABLE IF NOT EXISTS exchange_accounts (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id),
  confirmed_points INTEGER NOT NULL DEFAULT 0 CHECK(typeof(confirmed_points)='integer' AND confirmed_points BETWEEN 0 AND 1000000000000),
  reserved_points INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reserved_points)='integer' AND reserved_points BETWEEN 0 AND confirmed_points),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_reward_events (
  provider_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  points INTEGER NOT NULL CHECK(typeof(points)='integer' AND points BETWEEN 1 AND 1000000000000),
  receipt_ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(provider_id,event_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_quotes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  provider_id TEXT NOT NULL,
  provider_quote_id TEXT NOT NULL,
  asset TEXT NOT NULL CHECK(asset='BTC'),
  points INTEGER NOT NULL CHECK(typeof(points)='integer' AND points BETWEEN 1 AND 1000000000000),
  receive_satoshis INTEGER NOT NULL CHECK(typeof(receive_satoshis)='integer' AND receive_satoshis BETWEEN 1 AND 2100000000000000),
  fee_satoshis INTEGER NOT NULL CHECK(typeof(fee_satoshis)='integer' AND fee_satoshis BETWEEN 0 AND 2100000000000000),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  UNIQUE(provider_id,provider_quote_id),
  UNIQUE(id,user_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  quote_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  destination_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved','cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(quote_id,user_id) REFERENCES exchange_quotes(id,user_id),
  UNIQUE(user_id,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_requests_owner_idx ON exchange_requests(user_id,created_at DESC,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('credit','reserve','release')),
  points_delta INTEGER NOT NULL CHECK(typeof(points_delta)='integer' AND points_delta BETWEEN 0 AND 1000000000000),
  reserved_delta INTEGER NOT NULL CHECK(typeof(reserved_delta)='integer' AND reserved_delta BETWEEN -1000000000000 AND 1000000000000),
  created_at INTEGER NOT NULL,
  CHECK((kind='credit' AND points_delta>0 AND reserved_delta=0) OR (kind='reserve' AND points_delta=0 AND reserved_delta>0) OR (kind='release' AND points_delta=0 AND reserved_delta<0))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_ledger_owner_idx ON exchange_ledger(user_id,id DESC);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_credit_recorded AFTER INSERT ON exchange_reward_events BEGIN
  INSERT INTO exchange_accounts(user_id,confirmed_points,reserved_points,updated_at) VALUES(NEW.user_id,NEW.points,0,NEW.created_at)
    ON CONFLICT(user_id) DO UPDATE SET confirmed_points=confirmed_points+NEW.points,updated_at=NEW.created_at;
  INSERT INTO exchange_ledger(user_id,event_key,kind,points_delta,reserved_delta,created_at)
    VALUES(NEW.user_id,'credit:'||NEW.provider_id||':'||NEW.event_id,'credit',NEW.points,0,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_request_valid BEFORE INSERT ON exchange_requests BEGIN
  SELECT CASE WHEN NEW.status<>'reserved' THEN RAISE(ABORT,'exchange_invalid_transition') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM exchange_quotes WHERE id=NEW.quote_id AND user_id=NEW.user_id AND expires_at>NEW.created_at) THEN RAISE(ABORT,'exchange_quote_expired') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_request_reserved AFTER INSERT ON exchange_requests BEGIN
  UPDATE exchange_accounts SET reserved_points=reserved_points+(SELECT points FROM exchange_quotes WHERE id=NEW.quote_id),updated_at=NEW.created_at
    WHERE user_id=NEW.user_id AND confirmed_points-reserved_points>=(SELECT points FROM exchange_quotes WHERE id=NEW.quote_id);
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'exchange_insufficient_balance') END;
  INSERT INTO exchange_ledger(user_id,event_key,kind,points_delta,reserved_delta,created_at)
    SELECT NEW.user_id,'reserve:'||NEW.id,'reserve',0,points,NEW.created_at FROM exchange_quotes WHERE id=NEW.quote_id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_request_transition BEFORE UPDATE ON exchange_requests BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.quote_id<>OLD.quote_id OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.destination_ref<>OLD.destination_ref OR NEW.created_at<>OLD.created_at THEN RAISE(ABORT,'exchange_request_immutable') END;
  SELECT CASE WHEN OLD.status<>'reserved' OR NEW.status<>'cancelled' THEN RAISE(ABORT,'exchange_invalid_transition') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_request_released AFTER UPDATE OF status ON exchange_requests WHEN OLD.status='reserved' AND NEW.status='cancelled' BEGIN
  UPDATE exchange_accounts SET reserved_points=reserved_points-(SELECT points FROM exchange_quotes WHERE id=NEW.quote_id),updated_at=NEW.updated_at WHERE user_id=NEW.user_id;
  INSERT INTO exchange_ledger(user_id,event_key,kind,points_delta,reserved_delta,created_at)
    SELECT NEW.user_id,'release:'||NEW.id,'release',0,-points,NEW.updated_at FROM exchange_quotes WHERE id=NEW.quote_id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_quotes_immutable BEFORE UPDATE ON exchange_quotes BEGIN SELECT RAISE(ABORT,'exchange_quote_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_events_immutable BEFORE UPDATE ON exchange_reward_events BEGIN SELECT RAISE(ABORT,'exchange_event_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_events_no_delete BEFORE DELETE ON exchange_reward_events BEGIN SELECT RAISE(ABORT,'exchange_event_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_requests_no_delete BEFORE DELETE ON exchange_requests BEGIN SELECT RAISE(ABORT,'exchange_request_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_ledger_immutable BEFORE UPDATE ON exchange_ledger BEGIN SELECT RAISE(ABORT,'exchange_ledger_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_ledger_no_delete BEFORE DELETE ON exchange_ledger BEGIN SELECT RAISE(ABORT,'exchange_ledger_immutable'); END;
