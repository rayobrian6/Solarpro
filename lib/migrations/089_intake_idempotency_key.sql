-- ============================================================================
-- Migration 089: Add intake_idempotency_key to network_opportunities
-- ============================================================================
-- Stores the per-delivery idempotency key for an inbound lead so a retried or
-- concurrent re-delivery of the SAME lead (e.g. a webhook the provider retries
-- after a timeout) does not create a duplicate marketplace opportunity.
--
-- The unique index is a backstop: the intake pipeline also does an application
-- pre-check, but the index guarantees that two non-null keys can never coexist.
-- NULLs are allowed to repeat (Postgres treats them as distinct), so leads
-- without a key (e.g. plain form submissions) are unaffected.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
-- No destructive operations.
-- ============================================================================

ALTER TABLE network_opportunities
  ADD COLUMN IF NOT EXISTS intake_idempotency_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_network_opportunities_intake_idempotency
  ON network_opportunities (intake_idempotency_key);
