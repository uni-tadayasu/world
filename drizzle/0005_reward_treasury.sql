-- Recorded, verified Bitcoin funding only. This is not a live wallet balance.
-- No unlimited budget, synthetic deposit, wallet key or payout state exists.
CREATE TABLE IF NOT EXISTS reward_treasury_pool (
  id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
  confirmed_satoshis INTEGER NOT NULL DEFAULT 0 CHECK(typeof(confirmed_satoshis)='integer' AND confirmed_satoshis BETWEEN 0 AND 1000000000000),
  allocated_satoshis INTEGER NOT NULL DEFAULT 0 CHECK(typeof(allocated_satoshis)='integer' AND allocated_satoshis BETWEEN 0 AND confirmed_satoshis),
  updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>=0)
);
--> statement-breakpoint
INSERT INTO reward_treasury_pool(id,confirmed_satoshis,allocated_satoshis,updated_at) VALUES(1,0,0,0) ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reward_treasury_funding (
  receipt_id TEXT PRIMARY KEY NOT NULL CHECK(length(receipt_id) BETWEEN 66 AND 75 AND substr(receipt_id,65,1)=':' AND substr(receipt_id,1,64) NOT GLOB '*[^0-9a-f]*' AND substr(receipt_id,66) NOT GLOB '*[^0-9]*' AND CAST(substr(receipt_id,66) AS INTEGER) BETWEEN 0 AND 4294967295 AND CAST(CAST(substr(receipt_id,66) AS INTEGER) AS TEXT)=substr(receipt_id,66)),
  provider_id TEXT NOT NULL,
  asset TEXT NOT NULL CHECK(asset='BTC'),
  network TEXT NOT NULL CHECK(network='bitcoin'),
  amount_satoshis INTEGER NOT NULL CHECK(typeof(amount_satoshis)='integer' AND amount_satoshis BETWEEN 1 AND 1000000000000),
  destination_ref TEXT NOT NULL,
  confirmations INTEGER NOT NULL CHECK(typeof(confirmations)='integer' AND confirmations BETWEEN 6 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 0 AND 253402268399999)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reward_treasury_allocations (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  beneficiary_ref TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  reward_day TEXT NOT NULL,
  country TEXT NOT NULL CHECK(country='JP'),
  age_over_18 INTEGER NOT NULL CHECK(typeof(age_over_18)='integer' AND age_over_18=1),
  verification_expires_at INTEGER NOT NULL CHECK(typeof(verification_expires_at)='integer' AND verification_expires_at BETWEEN 0 AND 9007199254740991),
  policy_version TEXT NOT NULL CHECK(policy_version='machi-reward-draft-v1'),
  reward_mr INTEGER NOT NULL CHECK(typeof(reward_mr)='integer' AND reward_mr=100),
  amount_satoshis INTEGER NOT NULL CHECK(typeof(amount_satoshis)='integer' AND amount_satoshis=100),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 0 AND 253402268399999),
  UNIQUE(subject_id,reward_day)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reward_treasury_allocations_owner_idx ON reward_treasury_allocations(user_id,created_at DESC,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reward_treasury_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('funding','allocation')),
  confirmed_delta INTEGER NOT NULL CHECK(typeof(confirmed_delta)='integer' AND confirmed_delta BETWEEN 0 AND 1000000000000),
  allocated_delta INTEGER NOT NULL CHECK(typeof(allocated_delta)='integer' AND allocated_delta BETWEEN 0 AND 1000000000000),
  funding_receipt_id TEXT REFERENCES reward_treasury_funding(receipt_id),
  allocation_id TEXT REFERENCES reward_treasury_allocations(id),
  created_at INTEGER NOT NULL,
  CHECK((kind='funding' AND confirmed_delta>0 AND allocated_delta=0 AND funding_receipt_id IS NOT NULL AND allocation_id IS NULL) OR (kind='allocation' AND confirmed_delta=0 AND allocated_delta=100 AND funding_receipt_id IS NULL AND allocation_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_funding_recorded AFTER INSERT ON reward_treasury_funding BEGIN
  UPDATE reward_treasury_pool SET confirmed_satoshis=confirmed_satoshis+NEW.amount_satoshis,updated_at=MAX(updated_at,NEW.created_at)
    WHERE id=1 AND confirmed_satoshis<=1000000000000-NEW.amount_satoshis;
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'reward_treasury_funding_limit') END;
  INSERT INTO reward_treasury_audit(event_key,kind,confirmed_delta,allocated_delta,funding_receipt_id,allocation_id,created_at)
    VALUES('funding:'||NEW.receipt_id,'funding',NEW.amount_satoshis,0,NEW.receipt_id,NULL,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_allocation_valid BEFORE INSERT ON reward_treasury_allocations BEGIN
  SELECT CASE WHEN NEW.verification_expires_at<=NEW.created_at THEN RAISE(ABORT,'reward_treasury_verification_expired') END;
  SELECT CASE WHEN NEW.reward_day<>COALESCE(date(NEW.created_at/1000,'unixepoch','+9 hours'),'') THEN RAISE(ABORT,'reward_treasury_invalid_day') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_reward_recorded AFTER INSERT ON reward_treasury_allocations BEGIN
  UPDATE reward_treasury_pool SET allocated_satoshis=allocated_satoshis+NEW.amount_satoshis,updated_at=MAX(updated_at,NEW.created_at)
    WHERE id=1 AND confirmed_satoshis-allocated_satoshis>=NEW.amount_satoshis;
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'reward_treasury_insufficient_funding') END;
  INSERT INTO exchange_reward_events(provider_id,event_id,user_id,points,receipt_ref,created_at)
    VALUES('machi-treasury','daily:'||NEW.id,NEW.user_id,NEW.reward_mr,'treasury-allocation:'||NEW.id,NEW.created_at);
  INSERT INTO reward_treasury_audit(event_key,kind,confirmed_delta,allocated_delta,funding_receipt_id,allocation_id,created_at)
    VALUES('allocation:'||NEW.id,'allocation',0,NEW.amount_satoshis,NULL,NEW.id,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_funding_immutable BEFORE UPDATE ON reward_treasury_funding BEGIN SELECT RAISE(ABORT,'reward_treasury_funding_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_funding_no_delete BEFORE DELETE ON reward_treasury_funding BEGIN SELECT RAISE(ABORT,'reward_treasury_funding_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_allocations_immutable BEFORE UPDATE ON reward_treasury_allocations BEGIN SELECT RAISE(ABORT,'reward_treasury_allocation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_allocations_no_delete BEFORE DELETE ON reward_treasury_allocations BEGIN SELECT RAISE(ABORT,'reward_treasury_allocation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_audit_immutable BEFORE UPDATE ON reward_treasury_audit BEGIN SELECT RAISE(ABORT,'reward_treasury_audit_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_audit_no_delete BEFORE DELETE ON reward_treasury_audit BEGIN SELECT RAISE(ABORT,'reward_treasury_audit_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_treasury_pool_no_delete BEFORE DELETE ON reward_treasury_pool BEGIN SELECT RAISE(ABORT,'reward_treasury_pool_immutable'); END;
