# Phase 1A.3 — Non-Production Operational Activation and Historical Baseline Reconciliation

## Section 0: Initial Verification
- [x] Verify git state (branch dev, HEAD aligned with origin/dev, worktree clean)
- [x] Verify no migration 105 exists; 101 SQL files in lib/migrations/ (001-104)
- [x] Verify tsc passes (0 errors)
- [x] Verify source-scanning tests pass (306/306)
- [x] Verify PostgreSQL integration tests pass (55/55 with TEST_DATABASE_URL)
- [x] Verify PostgreSQL 15 test DB accessible (migration_gov_test, testuser/testpass)
- [x] Audit source files: manifest.ts, runner.ts, ledger.ts, types.ts, route.ts
- [x] Confirm discoverMigrationFiles(dirOverride) supports test fixture injection
- [x] Confirm lib/mfa.ts FROZEN — no modifications

## Section 1: Commit 1 — Exact-State and Environment Safety Audit
- [x] Create docs/phase1a/PHASE1A3-OPERATIONAL-ACTIVATION-AUDIT.md
  - Document exact-state findings for GOV-19..25
  - Document environment safety classification (is_production=false, is_isolated=true)
  - Document manifest discovery injection point (dirOverride param)
  - Document runner execution gate (assertExecutionPermitted → EXECUTION_ENABLED)
  - Document baseline evidence generator design (read-only PostgreSQL catalog)
  - Document canary migration fixture requirements
  - Document Neon serverless compatibility test plan
- [x] Verify tsc still passes after doc-only commit
- [x] Commit 1: docs(migrations): Phase 1A.3 exact-state and environment safety audit

## Section 2: Commit 2 — End-to-End Harness and Test-Only Migration Fixtures
- [x] Create tests/fixtures/migrations/ directory (NOT lib/migrations/)
- [x] Create 900_canary_test_table.sql fixture (canary migration, transactional)
- [x] Create 901_canary_add_column.sql fixture (second canary migration)
- [x] Create 902_canary_add_index.sql fixture (third canary, with index)
- [x] Create 903_canary_seed_data.sql fixture (fourth canary, with INSERT)
- [x] Create tests/phase1a3-migration-governance-e2e.test.ts
  - Test manifest discovery with fixture dirOverride
  - Test full lifecycle: UNBOOTSTRAPPED → BOOTSTRAP → BASELINE_REQUIRED →
    BASELINE_IN_PROGRESS → BASELINE_VERIFIED → EXECUTION_ENABLED
  - Test canary migration execution in EXECUTION_ENABLED state
  - Test migration blocked before EXECUTION_ENABLED
  - Test migration blocked after disable-execution
  - Test TOTP fail-closed (no MFA secret → denied)
  - Test TOTP replay prevention
  - Test audit event persistence (fail-closed)
  - Test append-only run history (started → applied)
  - Test checksum conflict detection
  - Test FORBIDDEN transaction mode blocking
  - Test SQL statement splitting (dollar-quoted, strings, comments)
  - Test advisory lock key isolation
- [x] Verify tsc passes
- [x] Verify e2e tests pass (with TEST_DATABASE_URL)
- [ ] Commit 2: test(migrations): Phase 1A.3 e2e harness and test-only migration fixtures

## Section 3: Commit 3 — Baseline Evidence Generator
- [ ] Create lib/migrations/baselineEvidence.ts
  - Read-only PostgreSQL catalog inspection (pg_class, pg_namespace, pg_attribute,
    pg_indexes, pg_constraint, pg_proc, pg_trigger, pg_type, pg_policy,
    information_schema)
  - classifyMigrationEvidence(migration, catalogSnapshot) → evidence status
  - generateBaselineEvidence(manifest, sql) → per-migration evidence report
  - Evidence statuses: CONFIRMED_APPLIED, CONFIRMED_NOT_APPLIED,
    PARTIALLY_APPLIED, UNKNOWN, NOT_APPLICABLE
  - No automatic approval — returns evidence for operator confirmation
  - Pure function: takes catalog snapshot, returns classification (testable without DB)
- [ ] Create tests/phase1a3-baseline-evidence.test.ts (unit tests for classifier)
- [ ] Verify tsc passes
- [ ] Verify baseline evidence tests pass
- [ ] Commit 3: feat(migrations): baseline evidence generator (read-only catalog inspection)

## Section 4: Commit 4 — Runtime Route, MFA, Audit, and Lifecycle Tests
- [ ] Expand tests/phase1a3-migration-governance-e2e.test.ts with runtime tests
  - Route action validation (inspect, run-pending, run-single, dry-run, baseline control)
  - Authorization matrix (super_admin vs admin vs none, env allowlist, prod flag)
  - TOTP verification (fail-closed, replay, invalid)
  - Audit event emission paths (console JSON + durable persistence)
  - Lifecycle state machine transitions (all 6 states)
  - Execution gate enforcement (block before EXECUTION_ENABLED)
  - enable-execution / disable-execution with reason
  - verify-baseline completeness check
  - record-baseline-entry validation
- [ ] Verify tsc passes
- [ ] Verify all tests pass
- [ ] Commit 4: test(migrations): runtime route, MFA, audit, and lifecycle tests

## Section 5: Commit 5 — Non-Production Baseline Evidence Generation
- [ ] Create tests/phase1a3-baseline-evidence-generation.test.ts
  - Connect to local PostgreSQL test DB
  - Run baseline evidence generator against all 101 migrations
  - Generate evidence report (all CONFIRMED_NOT_APPLIED for fresh DB)
  - Verify evidence report correctness
  - Verify no mutation occurred (read-only)
- [ ] Create docs/phase1a/PHASE1A3-BASELINE-EVIDENCE-REPORT.md
  - Document evidence generation run against local test DB
  - Summary: 101 migrations classified
  - Methodology: PostgreSQL catalog inspection
  - Evidence status breakdown
- [ ] Verify tsc passes
- [ ] Verify evidence generation tests pass
- [ ] Commit 5: test(migrations): non-production baseline evidence generation

## Section 6: Commit 6 — Neon Non-Production Compatibility Validation
- [ ] Check for authorized Neon branch (NEON_TEST_BRANCH or similar)
- [ ] If no authorized Neon branch: create blocker report
  - Document in PHASE1A3-NEON-COMPATIBILITY-REPORT.md that Neon validation
    is a BLOCKED workstream requiring authorized non-production Neon branch
  - Document what tests WOULD run (advisory lock, transaction, cold start)
  - Document that local PostgreSQL 15 compatibility is validated (Commit 2,5)
- [ ] If authorized Neon branch available: run compatibility tests
  - Advisory lock behavior
  - Transaction execution
  - Cold-start/scale-to-zero
  - serverless driver compatibility
- [ ] Create docs/phase1a/PHASE1A3-NEON-COMPATIBILITY-REPORT.md
- [ ] Verify tsc passes
- [ ] Commit 6: docs(migrations): Neon non-production compatibility validation (or blocker report)

## Section 7: Commit 7 — Expanded Tests and Cleanup
- [ ] Review all Phase 1A.3 test files for coverage gaps
- [ ] Add edge-case tests (empty manifest, non-existent identifier, etc.)
- [ ] Verify all fixture SQL files are valid (no path traversal, no FORBIDDEN mode)
- [ ] Run full test suite (source-scanning + integration + e2e + baseline evidence)
- [ ] Verify tsc passes (0 errors)
- [ ] Commit 7: test(migrations): expanded tests and cleanup (Phase 1A.3)

## Section 8: Commit 8 — Documentation and Final Report
- [ ] Create docs/phase1a/PHASE1A3-E2E-VALIDATION.md (e2e harness documentation)
- [ ] Create docs/phase1a/PHASE1A3-CANARY-MIGRATION.md (canary fixture requirements)
- [ ] Create docs/phase1a/PHASE1A3-OPERATIONAL-STATE-REPORT.md (GOV-25 — honest readiness)
- [ ] Create docs/phase1a/PHASE1A3-FINAL-REPORT.md (comprehensive final report)
- [ ] Update PHASE1A-FINAL-REPORT.md (link to Phase 1A.3)
- [ ] Update PHASE1A2-FINAL-REPORT.md (link to Phase 1A.3)
- [ ] Update ARCHITECTURE-DECISION-MIGRATION-MODEL.md (reference baseline evidence generator)
- [ ] Update AUDIT-MIGRATION-SYSTEM.md (reference e2e validation)
- [ ] Update PHASE1A-MIGRATION-GOVERNANCE-IMPLEMENTATION.md (Phase 1A.3 additions)
- [ ] Update PHASE1A1-FINAL-REPORT.md (link to Phase 1A.3)
- [ ] Update PHASE1A1-OPERATIONAL-HARDENING-AUDIT.md (link to Phase 1A.3)
- [ ] Verify tsc passes
- [ ] Commit 8: docs(migrations): Phase 1A.3 documentation and final report

## Section 9: Final Verification
- [ ] Run tsc --noEmit (0 errors)
- [ ] Run source-scanning tests (306+ pass)
- [ ] Run PostgreSQL integration tests (55+ pass)
- [ ] Run e2e tests (pass with TEST_DATABASE_URL)
- [ ] Run baseline evidence tests (pass)
- [ ] Verify git status clean
- [ ] Push all commits to origin/dev
- [ ] Verify origin/dev HEAD matches local HEAD
- [ ] Verify all 8 commits present on dev
- [ ] Verify 28 acceptance criteria met
- [ ] Mark all todo items complete
