-- ============================================================================
-- 900_canary_test_table.sql — Phase 1A.3 Test-Only Canary Migration Fixture
-- ============================================================================
-- This is a TEST-ONLY migration fixture used by the Phase 1A.3 e2e test harness.
-- It is NOT in lib/migrations/ and is NOT part of the production migration set.
-- It exists solely to exercise the migration governance lifecycle end-to-end
-- (bootstrap → baseline → execution → apply) against an isolated test database.
--
-- Canary requirements (per PHASE1A3-OPERATIONAL-ACTIVATION-AUDIT.md):
-- - Uses a unique, isolated table name (canary_900_test_table) to avoid
--   collisions with any production or pre-existing schema objects.
-- - Transaction mode: REQUIRED (default). All statements run in a single
--   transaction with atomic rollback on failure.
-- - Idempotent: uses IF NOT EXISTS so re-runs are safe.
-- - No transaction-incompatible statements (no concurrent index builds,
--   no V-A-C-U-U-M, no reindex concurrent, etc.).
-- ============================================================================

CREATE TABLE IF NOT EXISTS canary_900_test_table (
  id          SERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE canary_900_test_table IS
  'Phase 1A.3 test-only canary migration fixture table. Not part of the production schema.';
