-- ============================================================================
-- 901_canary_add_column.sql — Phase 1A.3 Test-Only Canary Migration Fixture
-- ============================================================================
-- This is a TEST-ONLY migration fixture used by the Phase 1A.3 e2e test harness.
-- It is NOT in lib/migrations/ and is NOT part of the production migration set.
--
-- This fixture adds a column to the canary_900_test_table created by migration
-- 900, demonstrating sequential migration execution and ordering.
--
-- Canary requirements:
-- - Depends on 900 (table must exist first). The runner applies migrations in
--   identifier order, ensuring 900 runs before 901.
-- - Transaction mode: REQUIRED (default).
-- - Idempotent: uses ADD COLUMN IF NOT EXISTS.
-- ============================================================================

ALTER TABLE canary_900_test_table
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

COMMENT ON COLUMN canary_900_test_table.status IS
  'Phase 1A.3 test-only canary column. Default active status.';
