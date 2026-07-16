-- ============================================================================
-- 903_canary_seed_data.sql — Phase 1A.3 Test-Only Canary Migration Fixture
-- ============================================================================
-- This is a TEST-ONLY migration fixture used by the Phase 1A.3 e2e test harness.
-- It is NOT in lib/migrations/ and is NOT part of the production migration set.
--
-- This fixture inserts seed data into the canary_900_test_table, demonstrating
-- DML (INSERT) within the transactional migration governance framework and
-- verifying that data changes are committed atomically.
--
-- Canary requirements:
-- - Depends on 900 (table must exist first).
-- - Transaction mode: REQUIRED. The INSERT runs inside the transaction and is
--   committed atomically with the migration record.
-- - Uses ON CONFLICT DO NOTHING for idempotency (safe to re-run).
-- - The seed data uses deterministic values for test assertions.
-- ============================================================================

INSERT INTO canary_900_test_table (label, status)
VALUES ('canary-seed-001', 'active'),
       ('canary-seed-002', 'active'),
       ('canary-seed-003', 'verified')
ON CONFLICT DO NOTHING;
