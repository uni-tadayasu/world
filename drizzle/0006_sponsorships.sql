-- A separate advertising order book. No game/reward/treasury tables are read
-- or credited here. Only verified Stripe webhook facts can create orders.
-- Each event INSERT and its fulfillment/hold/audit triggers are one SQLite
-- transaction, including retries, out-of-order delivery and operator races.
CREATE TABLE sponsor_events (
  id TEXT PRIMARY KEY NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 120),
  account_id TEXT NOT NULL,
  event_at INTEGER NOT NULL CHECK(typeof(event_at)='integer' AND event_at BETWEEN 0 AND 253402297199999),
  received_at INTEGER NOT NULL CHECK(typeof(received_at)='integer' AND received_at BETWEEN 0 AND 253402297199999),
  effect TEXT NOT NULL CHECK(effect IN ('checkout','charge','hold')),
  order_id TEXT,
  session_id TEXT,
  payment_intent_id TEXT,
  charge_id TEXT,
  payment_link_id TEXT,
  offer_id TEXT,
  amount INTEGER CHECK(amount IS NULL OR (typeof(amount)='integer' AND amount BETWEEN 0 AND 1000000000000)),
  currency TEXT,
  payment_state TEXT CHECK(payment_state IS NULL OR payment_state IN ('unpaid','failed','paid')),
  sponsor_name TEXT,
  sponsor_url TEXT,
  sponsor_message TEXT,
  content_valid INTEGER CHECK(content_valid IS NULL OR content_valid IN (0,1)),
  content_error TEXT,
  content_fingerprint TEXT,
  charge_paid INTEGER CHECK(charge_paid IS NULL OR charge_paid IN (0,1)),
  charge_captured INTEGER CHECK(charge_captured IS NULL OR charge_captured IN (0,1)),
  amount_captured INTEGER CHECK(amount_captured IS NULL OR (typeof(amount_captured)='integer' AND amount_captured BETWEEN 0 AND amount)),
  amount_refunded INTEGER CHECK(amount_refunded IS NULL OR (typeof(amount_refunded)='integer' AND amount_refunded BETWEEN 0 AND amount)),
  charge_disputed INTEGER CHECK(charge_disputed IS NULL OR charge_disputed IN (0,1)),
  hold_reason TEXT CHECK(hold_reason IS NULL OR hold_reason IN ('refund','refund_failed','dispute')),
  CHECK(effect<>'checkout' OR (order_id IS NOT NULL AND session_id IS NOT NULL AND payment_link_id IS NOT NULL AND offer_id='sponsor-directory-30d-v1' AND amount=3300 AND currency='jpy' AND payment_state IS NOT NULL AND sponsor_name IS NOT NULL AND sponsor_url IS NOT NULL AND sponsor_message IS NOT NULL AND content_valid IS NOT NULL AND content_error IS NOT NULL AND content_fingerprint IS NOT NULL)),
  CHECK(effect<>'charge' OR (charge_id IS NOT NULL AND payment_intent_id IS NOT NULL AND amount IS NOT NULL AND currency IS NOT NULL AND charge_paid IS NOT NULL AND charge_captured IS NOT NULL AND amount_captured IS NOT NULL AND amount_refunded IS NOT NULL AND charge_disputed IS NOT NULL)),
  CHECK(effect<>'hold' OR (hold_reason IS NOT NULL AND (session_id IS NOT NULL OR payment_intent_id IS NOT NULL OR charge_id IS NOT NULL))),
  CHECK(payment_state IS NOT 'paid' OR payment_intent_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE sponsor_orders (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=35 AND substr(id,1,3)='sp_'),
  session_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT UNIQUE,
  payment_link_id TEXT NOT NULL,
  offer_id TEXT NOT NULL CHECK(offer_id='sponsor-directory-30d-v1'),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount=3300),
  currency TEXT NOT NULL CHECK(currency='jpy'),
  payment_state TEXT NOT NULL CHECK(payment_state IN ('unpaid','failed','paid')),
  state TEXT NOT NULL CHECK(state IN ('payment_pending','payment_failed','paid_pending_review','approved','paused','refund_required')),
  sponsor_name TEXT NOT NULL CHECK(length(sponsor_name)<=60),
  sponsor_url TEXT NOT NULL CHECK(length(sponsor_url)<=2048),
  sponsor_message TEXT NOT NULL CHECK(length(sponsor_message)<=80),
  content_valid INTEGER NOT NULL CHECK(content_valid IN (0,1)),
  content_error TEXT NOT NULL CHECK(length(content_error)<=300),
  content_fingerprint TEXT NOT NULL CHECK(length(content_fingerprint)=64),
  paid_at INTEGER CHECK(paid_at IS NULL OR (typeof(paid_at)='integer' AND paid_at BETWEEN 0 AND 253402297199999)),
  starts_at INTEGER CHECK(starts_at IS NULL OR (typeof(starts_at)='integer' AND starts_at BETWEEN 0 AND 253399705199999)),
  ends_at INTEGER CHECK(ends_at IS NULL OR (typeof(ends_at)='integer' AND ends_at BETWEEN 0 AND 253402297199999)),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 0 AND 253402297199999),
  updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>=created_at AND updated_at<=253402297199999),
  CHECK((payment_state='paid' AND paid_at IS NOT NULL AND payment_intent_id IS NOT NULL) OR (payment_state<>'paid' AND paid_at IS NULL)),
  CHECK((payment_state='unpaid' AND state='payment_pending') OR (payment_state='failed' AND state='payment_failed') OR (payment_state='paid' AND state IN ('paid_pending_review','approved','paused','refund_required'))),
  CHECK((starts_at IS NULL AND ends_at IS NULL) OR (starts_at IS NOT NULL AND ends_at=starts_at+2592000000)),
  CHECK(state NOT IN ('approved','paused') OR starts_at IS NOT NULL),
  CHECK(state<>'paid_pending_review' OR starts_at IS NULL)
);
--> statement-breakpoint
CREATE INDEX sponsor_orders_state_created ON sponsor_orders(state,created_at);
--> statement-breakpoint
CREATE TABLE sponsor_charges (
  charge_id TEXT PRIMARY KEY NOT NULL,
  payment_intent_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 0 AND 1000000000000),
  currency TEXT NOT NULL CHECK(length(currency)=3),
  paid INTEGER NOT NULL CHECK(paid IN (0,1)),
  captured INTEGER NOT NULL CHECK(captured IN (0,1)),
  amount_captured INTEGER NOT NULL CHECK(typeof(amount_captured)='integer' AND amount_captured BETWEEN 0 AND amount),
  amount_refunded INTEGER NOT NULL CHECK(typeof(amount_refunded)='integer' AND amount_refunded BETWEEN 0 AND amount),
  disputed INTEGER NOT NULL CHECK(disputed IN (0,1)),
  last_event_at INTEGER NOT NULL CHECK(typeof(last_event_at)='integer' AND last_event_at BETWEEN 0 AND 253402297199999),
  updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at BETWEEN 0 AND 253402297199999)
);
--> statement-breakpoint
CREATE INDEX sponsor_charges_payment_intent ON sponsor_charges(payment_intent_id);
--> statement-breakpoint
CREATE TABLE sponsor_payment_holds (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES sponsor_events(id),
  session_id TEXT,
  payment_intent_id TEXT,
  charge_id TEXT,
  reason TEXT NOT NULL CHECK(reason IN ('refund','refund_failed','dispute')),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 0 AND 253402297199999),
  CHECK(session_id IS NOT NULL OR payment_intent_id IS NOT NULL OR charge_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX sponsor_holds_payment_intent ON sponsor_payment_holds(payment_intent_id);
--> statement-breakpoint
CREATE INDEX sponsor_holds_charge ON sponsor_payment_holds(charge_id);
--> statement-breakpoint
CREATE INDEX sponsor_holds_session ON sponsor_payment_holds(session_id);
--> statement-breakpoint
CREATE TABLE sponsor_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES sponsor_orders(id),
  source TEXT NOT NULL CHECK(source IN ('webhook','operator')),
  from_state TEXT,
  to_state TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 0 AND 253402297199999)
);
--> statement-breakpoint
CREATE TRIGGER sponsor_event_guard BEFORE INSERT ON sponsor_events BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM sponsor_events WHERE id=NEW.id AND payload_hash<>NEW.payload_hash) THEN RAISE(ABORT,'sponsor_event_conflict') END;
  SELECT CASE WHEN NEW.effect='checkout' AND EXISTS(SELECT 1 FROM sponsor_orders WHERE session_id=NEW.session_id AND (content_fingerprint<>NEW.content_fingerprint OR payment_link_id<>NEW.payment_link_id OR offer_id<>NEW.offer_id OR amount<>NEW.amount OR currency<>NEW.currency OR (payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS NOT NULL AND payment_intent_id<>NEW.payment_intent_id))) THEN RAISE(ABORT,'sponsor_order_conflict') END;
  SELECT CASE WHEN NEW.effect='charge' AND EXISTS(SELECT 1 FROM sponsor_charges WHERE charge_id=NEW.charge_id AND (payment_intent_id<>NEW.payment_intent_id OR amount<>NEW.amount OR currency<>NEW.currency)) THEN RAISE(ABORT,'sponsor_charge_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER sponsor_event_checkout AFTER INSERT ON sponsor_events WHEN NEW.effect='checkout' BEGIN
  INSERT INTO sponsor_orders(id,session_id,payment_intent_id,payment_link_id,offer_id,amount,currency,payment_state,state,sponsor_name,sponsor_url,sponsor_message,content_valid,content_error,content_fingerprint,paid_at,starts_at,ends_at,created_at,updated_at)
  VALUES(NEW.order_id,NEW.session_id,NEW.payment_intent_id,NEW.payment_link_id,NEW.offer_id,NEW.amount,NEW.currency,NEW.payment_state,CASE NEW.payment_state WHEN 'paid' THEN 'paid_pending_review' WHEN 'failed' THEN 'payment_failed' ELSE 'payment_pending' END,NEW.sponsor_name,NEW.sponsor_url,NEW.sponsor_message,NEW.content_valid,NEW.content_error,NEW.content_fingerprint,CASE WHEN NEW.payment_state='paid' THEN min(NEW.event_at,NEW.received_at) ELSE NULL END,NULL,NULL,NEW.received_at,NEW.received_at)
  ON CONFLICT(session_id) DO UPDATE SET
    payment_intent_id=coalesce(sponsor_orders.payment_intent_id,excluded.payment_intent_id),
    payment_state=CASE WHEN sponsor_orders.payment_state='paid' OR excluded.payment_state='paid' THEN 'paid' WHEN sponsor_orders.payment_state='failed' OR excluded.payment_state='failed' THEN 'failed' ELSE 'unpaid' END,
    state=CASE WHEN sponsor_orders.payment_state='paid' THEN sponsor_orders.state WHEN excluded.payment_state='paid' THEN 'paid_pending_review' WHEN sponsor_orders.payment_state='failed' OR excluded.payment_state='failed' THEN 'payment_failed' ELSE 'payment_pending' END,
    paid_at=CASE WHEN sponsor_orders.paid_at IS NULL THEN excluded.paid_at WHEN excluded.paid_at IS NULL THEN sponsor_orders.paid_at ELSE min(sponsor_orders.paid_at,excluded.paid_at) END,
    updated_at=max(sponsor_orders.updated_at+1,excluded.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER sponsor_event_charge AFTER INSERT ON sponsor_events WHEN NEW.effect='charge' BEGIN
  INSERT INTO sponsor_charges(charge_id,payment_intent_id,amount,currency,paid,captured,amount_captured,amount_refunded,disputed,last_event_at,updated_at)
  VALUES(NEW.charge_id,NEW.payment_intent_id,NEW.amount,NEW.currency,NEW.charge_paid,NEW.charge_captured,NEW.amount_captured,NEW.amount_refunded,NEW.charge_disputed,NEW.event_at,NEW.received_at)
  ON CONFLICT(charge_id) DO UPDATE SET
    paid=excluded.paid,captured=excluded.captured,amount_captured=excluded.amount_captured,
    amount_refunded=max(sponsor_charges.amount_refunded,excluded.amount_refunded),
    disputed=max(sponsor_charges.disputed,excluded.disputed),
    last_event_at=excluded.last_event_at,updated_at=max(sponsor_charges.updated_at,excluded.updated_at)
  WHERE excluded.last_event_at>=sponsor_charges.last_event_at;
END;
--> statement-breakpoint
CREATE TRIGGER sponsor_event_hold AFTER INSERT ON sponsor_events WHEN NEW.hold_reason IS NOT NULL BEGIN
  INSERT INTO sponsor_payment_holds(event_id,session_id,payment_intent_id,charge_id,reason,created_at)
  VALUES(NEW.id,NEW.session_id,NEW.payment_intent_id,NEW.charge_id,NEW.hold_reason,NEW.received_at);
END;
--> statement-breakpoint
CREATE TRIGGER sponsor_order_insert_guard BEFORE INSERT ON sponsor_orders BEGIN
  SELECT CASE WHEN NEW.state NOT IN ('payment_pending','payment_failed','paid_pending_review') OR NEW.starts_at IS NOT NULL OR NEW.ends_at IS NOT NULL THEN RAISE(ABORT,'sponsor_invalid_transition') END;
END;
--> statement-breakpoint
CREATE TRIGGER sponsor_order_update_guard BEFORE UPDATE ON sponsor_orders BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id OR NEW.payment_link_id IS NOT OLD.payment_link_id OR NEW.offer_id IS NOT OLD.offer_id OR NEW.amount IS NOT OLD.amount OR NEW.currency IS NOT OLD.currency OR NEW.sponsor_name IS NOT OLD.sponsor_name OR NEW.sponsor_url IS NOT OLD.sponsor_url OR NEW.sponsor_message IS NOT OLD.sponsor_message OR NEW.content_valid IS NOT OLD.content_valid OR NEW.content_error IS NOT OLD.content_error OR NEW.content_fingerprint IS NOT OLD.content_fingerprint OR NEW.created_at IS NOT OLD.created_at OR (OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS NOT OLD.payment_intent_id) THEN RAISE(ABORT,'sponsor_order_conflict') END;
  SELECT CASE WHEN NEW.updated_at<OLD.updated_at OR (NEW.state<>OLD.state AND NEW.updated_at<=OLD.updated_at) OR (OLD.payment_state='paid' AND NEW.payment_state<>'paid') OR (OLD.payment_state='failed' AND NEW.payment_state='unpaid') OR (OLD.paid_at IS NOT NULL AND (NEW.paid_at IS NULL OR NEW.paid_at>OLD.paid_at)) THEN RAISE(ABORT,'sponsor_invalid_transition') END;
  SELECT CASE WHEN (OLD.starts_at IS NOT NULL AND (NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at)) OR (OLD.starts_at IS NULL AND NEW.starts_at IS NOT NULL AND NEW.state<>'approved') THEN RAISE(ABORT,'sponsor_invalid_transition') END;
  SELECT CASE WHEN NEW.state<>OLD.state AND NOT (
    (OLD.state='payment_pending' AND NEW.state IN ('payment_failed','paid_pending_review')) OR
    (OLD.state='payment_failed' AND NEW.state='paid_pending_review') OR
    (OLD.state='paid_pending_review' AND NEW.state IN ('approved','refund_required')) OR
    (OLD.state='approved' AND NEW.state IN ('paused','refund_required')) OR
    (OLD.state='paused' AND NEW.state IN ('approved','refund_required'))
  ) THEN RAISE(ABORT,'sponsor_invalid_transition') END;
  SELECT CASE WHEN NEW.state='approved' AND OLD.state<>'approved' AND (
    NEW.payment_state<>'paid' OR NEW.content_valid<>1 OR NEW.starts_at IS NULL OR NEW.ends_at<=NEW.updated_at OR
    (OLD.starts_at IS NULL AND (NEW.starts_at>NEW.updated_at OR NEW.starts_at>=NEW.paid_at+604800000)) OR
    NOT EXISTS(SELECT 1 FROM sponsor_charges c WHERE c.payment_intent_id=NEW.payment_intent_id AND c.amount=3300 AND c.currency='jpy' AND c.paid=1 AND c.captured=1 AND c.amount_captured=3300 AND c.amount_refunded=0 AND c.disputed=0) OR
    EXISTS(SELECT 1 FROM sponsor_payment_holds h WHERE h.session_id=NEW.session_id OR h.payment_intent_id=NEW.payment_intent_id OR h.charge_id IN (SELECT charge_id FROM sponsor_charges WHERE payment_intent_id=NEW.payment_intent_id))
  ) THEN RAISE(ABORT,'sponsor_approval_blocked') END;
END;
--> statement-breakpoint
CREATE TRIGGER sponsor_order_audit_insert AFTER INSERT ON sponsor_orders BEGIN
  INSERT INTO sponsor_audit(order_id,source,from_state,to_state,created_at) VALUES(NEW.id,'webhook',NULL,NEW.state,NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER sponsor_order_audit_update AFTER UPDATE ON sponsor_orders WHEN OLD.state<>NEW.state BEGIN
  INSERT INTO sponsor_audit(order_id,source,from_state,to_state,created_at) VALUES(NEW.id,CASE WHEN OLD.payment_state<>NEW.payment_state THEN 'webhook' ELSE 'operator' END,OLD.state,NEW.state,NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER sponsor_charges_update_guard BEFORE UPDATE ON sponsor_charges BEGIN
  SELECT CASE WHEN NEW.charge_id IS NOT OLD.charge_id OR NEW.payment_intent_id IS NOT OLD.payment_intent_id OR NEW.amount IS NOT OLD.amount OR NEW.currency IS NOT OLD.currency OR NEW.last_event_at<OLD.last_event_at OR NEW.amount_refunded<OLD.amount_refunded OR NEW.disputed<OLD.disputed THEN RAISE(ABORT,'sponsor_charge_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER sponsor_events_no_update BEFORE UPDATE ON sponsor_events BEGIN SELECT RAISE(ABORT,'sponsor_records_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sponsor_events_no_delete BEFORE DELETE ON sponsor_events BEGIN SELECT RAISE(ABORT,'sponsor_records_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sponsor_orders_no_delete BEFORE DELETE ON sponsor_orders BEGIN SELECT RAISE(ABORT,'sponsor_records_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sponsor_charges_no_delete BEFORE DELETE ON sponsor_charges BEGIN SELECT RAISE(ABORT,'sponsor_records_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sponsor_holds_no_update BEFORE UPDATE ON sponsor_payment_holds BEGIN SELECT RAISE(ABORT,'sponsor_records_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sponsor_holds_no_delete BEFORE DELETE ON sponsor_payment_holds BEGIN SELECT RAISE(ABORT,'sponsor_records_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sponsor_audit_no_update BEFORE UPDATE ON sponsor_audit BEGIN SELECT RAISE(ABORT,'sponsor_records_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sponsor_audit_no_delete BEFORE DELETE ON sponsor_audit BEGIN SELECT RAISE(ABORT,'sponsor_records_immutable'); END;
