-- Valueless simulation only. These tables never credit the live exchange ledger.
CREATE TABLE IF NOT EXISTS exchange_sandbox_accounts (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id),
  confirmed_points INTEGER NOT NULL DEFAULT 0 CHECK(typeof(confirmed_points)='integer' AND confirmed_points BETWEEN 0 AND 1000000000000),
  reserved_points INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reserved_points)='integer' AND reserved_points BETWEEN 0 AND confirmed_points),
  last_refill_at INTEGER NOT NULL CHECK(typeof(last_refill_at)='integer' AND last_refill_at>=0),
  updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>=0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_sandbox_refills (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  idempotency_key TEXT NOT NULL,
  points INTEGER NOT NULL CHECK(typeof(points)='integer' AND points=10000),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  UNIQUE(user_id,idempotency_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_sandbox_quotes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  points INTEGER NOT NULL CHECK(typeof(points)='integer' AND points BETWEEN 1000 AND 1000000),
  receive_satoshis INTEGER NOT NULL CHECK(typeof(receive_satoshis)='integer' AND receive_satoshis=points),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at=created_at+300000),
  UNIQUE(id,user_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_sandbox_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  quote_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved','cancelled','simulated_paid')),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>=created_at),
  FOREIGN KEY(quote_id,user_id) REFERENCES exchange_sandbox_quotes(id,user_id),
  UNIQUE(user_id,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_sandbox_requests_owner_idx ON exchange_sandbox_requests(user_id,created_at DESC,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_sandbox_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('credit','reserve','release','simulated_payment')),
  points_delta INTEGER NOT NULL CHECK(typeof(points_delta)='integer' AND points_delta BETWEEN -1000000000000 AND 1000000000000),
  reserved_delta INTEGER NOT NULL CHECK(typeof(reserved_delta)='integer' AND reserved_delta BETWEEN -1000000000000 AND 1000000000000),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  CHECK((kind='credit' AND points_delta=10000 AND reserved_delta=0) OR
    (kind='reserve' AND points_delta=0 AND reserved_delta BETWEEN 1000 AND 1000000) OR
    (kind='release' AND points_delta=0 AND reserved_delta BETWEEN -1000000 AND -1000) OR
    (kind='simulated_payment' AND points_delta BETWEEN -1000000 AND -1000 AND reserved_delta=points_delta))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_sandbox_ledger_owner_idx ON exchange_sandbox_ledger(user_id,id DESC);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_refill_valid BEFORE INSERT ON exchange_sandbox_refills BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM exchange_sandbox_accounts WHERE user_id=NEW.user_id AND last_refill_at+1500>NEW.created_at) THEN RAISE(ABORT,'sandbox_refill_cooldown') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM exchange_sandbox_accounts WHERE user_id=NEW.user_id AND confirmed_points>1000000000000-NEW.points) THEN RAISE(ABORT,'sandbox_balance_limit') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_refill_recorded AFTER INSERT ON exchange_sandbox_refills BEGIN
  INSERT INTO exchange_sandbox_accounts(user_id,confirmed_points,reserved_points,last_refill_at,updated_at) VALUES(NEW.user_id,NEW.points,0,NEW.created_at,NEW.created_at)
    ON CONFLICT(user_id) DO UPDATE SET confirmed_points=confirmed_points+NEW.points,last_refill_at=NEW.created_at,updated_at=NEW.created_at;
  INSERT INTO exchange_sandbox_ledger(user_id,event_key,kind,points_delta,reserved_delta,created_at)
    VALUES(NEW.user_id,'refill:'||NEW.id,'credit',NEW.points,0,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_quote_valid BEFORE INSERT ON exchange_sandbox_quotes BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM exchange_sandbox_accounts WHERE user_id=NEW.user_id AND confirmed_points-reserved_points>=NEW.points) THEN RAISE(ABORT,'sandbox_insufficient_balance') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_request_valid BEFORE INSERT ON exchange_sandbox_requests BEGIN
  SELECT CASE WHEN NEW.status<>'reserved' THEN RAISE(ABORT,'sandbox_invalid_transition') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM exchange_sandbox_quotes WHERE id=NEW.quote_id AND user_id=NEW.user_id AND created_at<=NEW.created_at AND expires_at>NEW.created_at) THEN RAISE(ABORT,'sandbox_quote_expired') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_request_reserved AFTER INSERT ON exchange_sandbox_requests BEGIN
  UPDATE exchange_sandbox_accounts SET reserved_points=reserved_points+(SELECT points FROM exchange_sandbox_quotes WHERE id=NEW.quote_id),updated_at=NEW.created_at
    WHERE user_id=NEW.user_id AND confirmed_points-reserved_points>=(SELECT points FROM exchange_sandbox_quotes WHERE id=NEW.quote_id);
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'sandbox_insufficient_balance') END;
  INSERT INTO exchange_sandbox_ledger(user_id,event_key,kind,points_delta,reserved_delta,created_at)
    SELECT NEW.user_id,'reserve:'||NEW.id,'reserve',0,points,NEW.created_at FROM exchange_sandbox_quotes WHERE id=NEW.quote_id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_request_transition BEFORE UPDATE ON exchange_sandbox_requests BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.quote_id<>OLD.quote_id OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.created_at<>OLD.created_at THEN RAISE(ABORT,'sandbox_request_immutable') END;
  SELECT CASE WHEN OLD.status<>'reserved' OR NEW.status NOT IN ('cancelled','simulated_paid') OR NEW.updated_at<OLD.updated_at THEN RAISE(ABORT,'sandbox_invalid_transition') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_request_released AFTER UPDATE OF status ON exchange_sandbox_requests WHEN OLD.status='reserved' AND NEW.status='cancelled' BEGIN
  UPDATE exchange_sandbox_accounts SET reserved_points=reserved_points-(SELECT points FROM exchange_sandbox_quotes WHERE id=NEW.quote_id),updated_at=NEW.updated_at
    WHERE user_id=NEW.user_id AND reserved_points>=(SELECT points FROM exchange_sandbox_quotes WHERE id=NEW.quote_id);
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'sandbox_ledger_invalid') END;
  INSERT INTO exchange_sandbox_ledger(user_id,event_key,kind,points_delta,reserved_delta,created_at)
    SELECT NEW.user_id,'release:'||NEW.id,'release',0,-points,NEW.updated_at FROM exchange_sandbox_quotes WHERE id=NEW.quote_id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_request_completed AFTER UPDATE OF status ON exchange_sandbox_requests WHEN OLD.status='reserved' AND NEW.status='simulated_paid' BEGIN
  UPDATE exchange_sandbox_accounts SET confirmed_points=confirmed_points-(SELECT points FROM exchange_sandbox_quotes WHERE id=NEW.quote_id),reserved_points=reserved_points-(SELECT points FROM exchange_sandbox_quotes WHERE id=NEW.quote_id),updated_at=NEW.updated_at
    WHERE user_id=NEW.user_id AND reserved_points>=(SELECT points FROM exchange_sandbox_quotes WHERE id=NEW.quote_id);
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'sandbox_ledger_invalid') END;
  INSERT INTO exchange_sandbox_ledger(user_id,event_key,kind,points_delta,reserved_delta,created_at)
    SELECT NEW.user_id,'complete:'||NEW.id,'simulated_payment',-points,-points,NEW.updated_at FROM exchange_sandbox_quotes WHERE id=NEW.quote_id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_refills_immutable BEFORE UPDATE ON exchange_sandbox_refills BEGIN SELECT RAISE(ABORT,'sandbox_refill_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_refills_no_delete BEFORE DELETE ON exchange_sandbox_refills BEGIN SELECT RAISE(ABORT,'sandbox_refill_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_quotes_immutable BEFORE UPDATE ON exchange_sandbox_quotes BEGIN SELECT RAISE(ABORT,'sandbox_quote_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_quotes_no_delete BEFORE DELETE ON exchange_sandbox_quotes BEGIN SELECT RAISE(ABORT,'sandbox_quote_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_requests_no_delete BEFORE DELETE ON exchange_sandbox_requests BEGIN SELECT RAISE(ABORT,'sandbox_request_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_ledger_immutable BEFORE UPDATE ON exchange_sandbox_ledger BEGIN SELECT RAISE(ABORT,'sandbox_ledger_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_sandbox_ledger_no_delete BEFORE DELETE ON exchange_sandbox_ledger BEGIN SELECT RAISE(ABORT,'sandbox_ledger_immutable'); END;
