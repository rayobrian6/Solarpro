-- ============================================================
-- Migration 014: Webhook delivery idempotency index (F-11)
--
-- Adds a partial unique index on webhook_deliveries(source, event_id)
-- for rows where signature_valid = true.
--
-- This prevents double-ingest from concurrent duplicate webhook deliveries
-- (TOCTOU race between SELECT and INSERT in the idempotency check).
--
-- Failed/invalid deliveries (signature_valid = false) are intentionally
-- excluded — ops needs to be able to log multiple failed attempts for
-- the same event_id (useful for diagnosing misconfigured senders).
--
-- Safe to re-run (IF NOT EXISTS guard).
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_valid_event_unique
  ON webhook_deliveries(source, event_id)
  WHERE signature_valid = true;