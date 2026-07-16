-- ============================================================================
-- 902_canary_add_index.sql — Phase 1A.3 Test-Only Canary Migration Fixture
-- ============================================================================
-- This is a TEST-ONLY migration fixture used by the Phase 1A.3 e2e test harness.
-- It is NOT in lib/migrations/ and is NOT part of the production migration set.
--
-- This fixture creates an index on the canary_900_test_table, demonstrating
-- index creation within the transactional migration governance framework.
--
-- Canary requirements:
-- - Depends on 900 (table must exist first).
-- - Transaction mode: REQUIRED. Uses a standard (non-concurrent) index
--   build so the index is created within the transaction. Concurrent index
--   builds are transaction-incompatible (FORBIDDEN mode) and are
--   intentionally NOT used here.
-- - Idempotent: uses IF NOT EXISTS.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_canary_900_status
  ON canary_900_test_table (status);
