# Phase 1A.3 — Non-Production Operational Activation and Historical Baseline Reconciliation

## Operational Activation Audit (GOV-19..25)

**Document type:** Exact-state and environment safety audit
**Phase:** 1A.3
**Branch:** `dev`
**Audit date:** 2025-07-12
**Author:** Senior platform architect (change-control review)
**Predecessor phases:** Phase 1A (GOV-01), Phase 1A.1 (GOV-02..08), Phase 1A.2 (GOV-09..18)
**Scope:** Operational validation of the migration governance control plane against isolated non-production databases. No production access. No new numbered migrations in `lib/migrations/`. No MFA Phase 3 modifications.

---

## 1. Executive Summary

Phase 1A established the migration governance source code. Phase 1A.1 hardened it operationally (TOTP fail-closed, replay prevention, checksum verification, advisory locking, append-only history, audit persistence). Phase 1A.2 closed all remaining code-level governance issues (identifier grammar, status vocabulary, legacy elimination, baseline control plane API, execution gate, PostgreSQL integration harness, transaction mode enforcement).

However, through Phase 1A.2 the governance system has been validated almost entirely through source-scanning tests (306 tests that inspect source code without connecting to a database) and DDL-level integration tests (55 tests that execute the bootstrap DDL against a local PostgreSQL schema but do not exercise the full runtime execution path). No test has ever driven the complete lifecycle from an empty database through bootstrap, baseline reconciliation, verification, execution activation, and a successful migration application. No test has proven that the route, authorization layer, TOTP verification, audit emission, ledger recording, and runner execute together as a single coherent system. No test has generated historical baseline evidence for the 101 existing migrations. No test has validated that the system behaves correctly on a Neon serverless PostgreSQL instance.

Phase 1A.3 closes these gaps. It proves the control plane works end-to-end, generates historical baseline evidence, exercises the EXECUTION_ENABLED activation/deactivation cycle, runs test-only canary migrations against an isolated schema, and produces an honest operational-state report.

The seven governance issues addressed are GOV-19 through GOV-25. Each is a gap between "the source code is correct" and "the system has been proven to work operationally."

---

## 2. Governance Issues Addressed

### GOV-19: No full lifecycle end-to-end execution proof

**Finding:** The migration governance system has never been exercised through its complete lifecycle in any test. The source-scanning tests in `tests/phase1a-migration-governance.test.ts` verify that source code contains the expected strings, function signatures, and logic patterns, but they do not execute any database operations. The PostgreSQL integration tests in `tests/phase1a2-postgres-integration.test.ts` execute the bootstrap DDL and verify CHECK constraints, UNIQUE constraints, advisory locking, and INSERT/UPDATE behavior, but they do not call `runSinglePendingMigration()`, `runPendingMigrations()`, `authorizeMigration()`, `verifyFreshTotp()`, `bootstrapMigrationLedger()`, `assertExecutionPermitted()`, `enableExecution()`, `disableExecution()`, `recordBaselineReconciliation()`, `verifyBaselineComplete()`, or any other runtime function. The complete chain — manifest discovery → authorization → execution gate → bootstrap → baseline reconciliation → verification → execution activation → migration execution → ledger recording → audit persistence → run history — has never been tested as a single integrated flow.

**Impact:** A system that passes all 361 existing tests can still fail at runtime if any function in the chain has a bug that only manifests when called in sequence with real database state. For example, `assertExecutionPermitted()` might return the wrong value when the `governance_lifecycle` table has a specific state, or `enableExecution()` might fail to transition from `BASELINE_VERIFIED` to `EXECUTION_ENABLED` due to a SQL syntax issue that only surfaces against a real PostgreSQL instance.

**Resolution:** Commit 2 creates a full end-to-end test harness (`tests/phase1a3-migration-governance-e2e.test.ts`) that drives the complete lifecycle against an isolated PostgreSQL test schema. The harness uses test-only migration fixtures in `tests/fixtures/migrations/` (never in `lib/migrations/`) and injects them via the `discoverMigrationFiles(dirOverride)` parameter that already exists in `manifest.ts`. The harness exercises every lifecycle state transition, every authorization path, every execution gate, and every audit emission path.

### GOV-20: Existing environment historical baseline remains unreconciled

**Finding:** The 101 historical migration files in `lib/migrations/` (prefixes 001-104, with 074 having two variants 074a/074b) represent the complete schema evolution of the SolarPro platform. These migrations were applied to the production Neon database over time through legacy migration mechanisms that predate the governance system. The governance lifecycle requires that every migration in the manifest be reconciled with a baseline status (`CONFIRMED_APPLIED`, `CONFIRMED_NOT_APPLIED`, `PARTIALLY_APPLIED`, `NOT_APPLICABLE`, or `UNKNOWN`) before the lifecycle can advance from `BASELINE_IN_PROGRESS` to `BASELINE_VERIFIED`. No baseline reconciliation has ever been performed. The `migration_baseline` table has never been populated for any environment. The production database's historical state is entirely unverified from the governance system's perspective.

**Impact:** Without baseline reconciliation, the governance lifecycle can never reach `BASELINE_VERIFIED`, which means execution can never be activated (`EXECUTION_ENABLED`), which means no migration can ever be applied through the canonical runner. The governance system is structurally complete but operationally frozen because the historical baseline has not been reconciled.

**Resolution:** Commit 3 creates a baseline evidence generator (`lib/migrations/baselineEvidence.ts`) that performs read-only PostgreSQL catalog inspection to classify each migration's applied state. The generator queries `pg_class`, `pg_namespace`, `pg_attribute`, `pg_indexes`, `pg_constraint`, `pg_proc`, `pg_trigger`, `pg_type`, `pg_policy`, and `information_schema` to determine whether the schema objects created by each migration exist in the target database. It does NOT automatically approve anything — it generates evidence that an operator must review and confirm with a fresh TOTP. Commit 5 runs the generator against a local PostgreSQL test database and produces a baseline evidence report. In a future phase (outside Phase 1A.3 scope), an operator would run the generator against the production Neon database, review the evidence, and confirm each entry through the `record-baseline-entry` API action.

### GOV-21: Baseline evidence generation is largely manual

**Finding:** The baseline control plane API (added in Phase 1A.2, GOV-11) provides the `record-baseline-entry` action for recording a single migration's baseline reconciliation status. However, the operator must manually determine the status for each of the 101 migrations by inspecting the database schema — a tedious, error-prone process. There is no tool that automates the evidence-gathering step. The operator would need to manually query `information_schema.tables`, `information_schema.columns`, `pg_indexes`, etc. for each migration's expected schema objects and then classify the migration based on what they find.

**Impact:** Manual baseline evidence generation for 101 migrations is impractical and error-prone. An operator working under time pressure might mark all migrations as `CONFIRMED_APPLIED` without actually verifying each one, defeating the purpose of the baseline reconciliation gate. The lack of an automated evidence generator makes the baseline control plane theoretically usable but practically unworkable.

**Resolution:** Commit 3 creates the baseline evidence generator as a pure, testable module. The generator takes a migration manifest and a PostgreSQL catalog snapshot (a plain object containing the results of catalog queries) and returns a per-migration evidence classification. The pure-function design means the classifier logic can be unit-tested without a database connection, and the catalog-gathering function can be tested separately against a real PostgreSQL instance. The generator produces evidence, not approvals — the operator must still confirm each entry through the API with a fresh TOTP.

### GOV-22: Route, authorization, TOTP, audit, ledger, and runner have not been proven together

**Finding:** The migration governance system has six major components: (1) the API route (`app/api/admin/migrations/route.ts`) that receives HTTP requests and dispatches to actions, (2) the authorization layer (`authorizeMigration()` in `runner.ts`) that checks permissions, environment allowlist, and production flag, (3) the TOTP verification (`verifyFreshTotp()` in `runner.ts`) that enforces fail-closed MFA with replay prevention, (4) the audit emission (`emitAuditEvent()` and `emitAuditEventAsync()` in `ledger.ts`) that records events to console and the durable `audit_log` table, (5) the ledger (`ledger.ts`) that records migration state in `schema_migrations`, `schema_migration_runs`, `migration_baseline`, `governance_lifecycle`, and `migration_totp_uses`, and (6) the runner (`runner.ts`) that executes migration SQL in transactions with advisory locks. Each component has been tested individually (source-scanning for logic, integration for DDL), but no test has ever exercised all six components in a single flow.

**Impact:** Integration bugs between components are invisible to the existing test suite. For example, the route might pass the wrong `actorType` to `authorizeMigration()`, or `verifyFreshTotp()` might fail to call `recordTotpUse()` in the correct order, or `runSinglePendingMigration()` might call `emitAuditEventAsync()` but not check the `persisted` return value. These are cross-component bugs that only surface when the components are exercised together.

**Resolution:** Commits 2 and 4 create e2e tests that exercise all six components together. The tests use the `pg` module to connect directly to the PostgreSQL test database (bypassing the HTTP route layer, which requires a full Next.js server context) and call the governance functions directly: `bootstrapMigrationLedger()`, `recordBaselineReconciliation()`, `verifyBaselineComplete()`, `advanceToBaselineVerified()`, `enableExecution()`, `disableExecution()`, `assertExecutionPermitted()`, `authorizeMigration()`, `runSinglePendingMigration()`, `runPendingMigrations()`. The tests verify that each function's output is consistent with the expected lifecycle state and that the database state (ledger rows, run history, baseline entries, lifecycle state) matches expectations after each operation.

### GOV-23: Neon serverless operational behavior has not been validated

**Finding:** The SolarPro platform uses Neon serverless PostgreSQL as its production database. Neon has specific operational characteristics that differ from a standard PostgreSQL instance: connection pooling via PgBouncer, scale-to-zero cold starts, the Neon serverless driver (`@neondatabase/serverless`) that uses HTTP/WebSocket rather than raw TCP, and transaction API constraints (the `sql.transaction()` callback must be synchronous and return an array of query promises). The migration governance system uses `neon()` from `@neondatabase/serverless` for all database operations and uses `sql.transaction()` for bootstrap and migration execution. None of these Neon-specific behaviors have been validated through integration tests. The 55 Phase 1A.2 integration tests use the `pg` module (raw TCP, standard PostgreSQL) and execute the DDL directly — they do not use the Neon serverless driver.

**Impact:** The governance system might work correctly against standard PostgreSQL but fail against Neon due to driver differences, transaction API constraints, or cold-start behavior. For example, the `sql.transaction()` callback constraint (synchronous, return array of promises) could cause the bootstrap or migration execution to fail silently if the callback accidentally uses `await` inside it. The advisory lock key precision issue (MIGRATION-GOV-06) was specifically caused by JavaScript Number precision loss in the Neon driver path — similar issues could exist elsewhere.

**Resolution:** Commit 6 validates Neon serverless compatibility. If an authorized non-production Neon branch is available, the e2e tests are run against it to verify advisory lock behavior, transaction execution, cold-start handling, and serverless driver compatibility. If no authorized Neon branch is available (the expected case in this sandbox environment), a blocker report is produced documenting that Neon validation is a blocked workstream requiring an authorized non-production Neon branch, and that local PostgreSQL 15 compatibility is validated through Commits 2 and 5. The blocker report is not a failure — it is an honest documentation of what has been proven and what remains unproven.

### GOV-24: Execution activation has not been safely exercised

**Finding:** The `enableExecution()` function in `ledger.ts` transitions the governance lifecycle from `BASELINE_VERIFIED` to `EXECUTION_ENABLED`. The `disableExecution()` function transitions back from `EXECUTION_ENABLED` to `BASELINE_VERIFIED`. These are the most critical state transitions in the governance system — they control whether schema mutations are permitted. Neither function has ever been called in any test. The execution gate (`assertExecutionPermitted()`) has been tested at the DDL level (the Phase 1A.2 integration tests verify the lifecycle CHECK constraint), but the runtime behavior of `assertExecutionPermitted()` returning `permitted: false` when the lifecycle is in any state other than `EXECUTION_ENABLED` has never been verified against a real database with a real lifecycle row.

**Impact:** If `enableExecution()` has a SQL bug (e.g., the `WHERE lifecycle_state = 'BASELINE_VERIFIED'` clause doesn't match due to a whitespace or encoding issue), execution would silently fail to activate, and the operator would receive a success response from the API but the lifecycle would remain in `BASELINE_VERIFIED`. The operator might then attempt to run migrations, which would be blocked by the execution gate, causing confusion. Alternatively, if `disableExecution()` has a bug, execution might fail to deactivate, leaving the system in an execution-permitting state when the operator intended to lock it down.

**Resolution:** Commits 2 and 4 create tests that exercise the full activation/deactivation cycle. The tests bootstrap the ledger, perform baseline reconciliation for all test fixtures, verify the baseline, enable execution, run a canary migration, verify the migration was applied, disable execution, verify that further migrations are blocked, and verify the lifecycle state at each step. The tests also verify the edge cases: enabling execution when the lifecycle is not in `BASELINE_VERIFIED` (should fail), disabling execution when the lifecycle is not in `EXECUTION_ENABLED` (should fail), and the execution gate blocking mutations in every non-`EXECUTION_ENABLED` state.

### GOV-25: Current operational-state documentation overstates readiness

**Finding:** The existing documentation (Phase 1A, 1A.1, 1A.2 final reports and implementation docs) describes the migration governance system as "implemented," "hardened," and "closed." While accurate at the source-code level, these descriptions do not clearly communicate that the system has never been exercised end-to-end, that the historical baseline has not been reconciled, and that no migration has ever been applied through the canonical runner. A reader of the documentation might conclude that the system is ready for production use, when in fact it has only been proven to compile and pass source-scanning and DDL-level tests.

**Impact:** Overstated readiness documentation can lead to premature production activation. An operator reading the Phase 1A.2 final report might believe the system is ready for production baseline reconciliation and migration execution, when in fact the end-to-end lifecycle has never been tested and the baseline evidence generator does not exist yet. This is a governance documentation integrity issue — the documentation must accurately reflect the proven operational state, not just the source-code state.

**Resolution:** Commit 8 creates the `PHASE1A3-OPERATIONAL-STATE-REPORT.md` document that provides an honest, evidence-based assessment of the system's operational readiness. The report distinguishes between "proven at source level" (Phase 1A/1A.1/1A.2), "proven at DDL level" (Phase 1A.2 integration tests), and "proven at end-to-end level" (Phase 1A.3). It clearly states what has been proven, what has not been proven, and what remains blocked (Neon validation). The report also updates the existing Phase 1A, 1A.1, and 1A.2 documentation to cross-reference the Phase 1A.3 findings and to add caveats about the distinction between source-level and operational-level proof.

---

## 3. Environment Safety Classification

Before any database mutation in Phase 1A.3, the target environment must be classified according to three criteria:

### 3.1 Classification Criteria

**is_production:** Whether the target database is a production database. Determined by checking the `DATABASE_URL` environment variable against known production connection strings. In this sandbox environment, `DATABASE_URL` is not set to a production Neon connection string. The local PostgreSQL test database (`postgresql://testuser:testpass@localhost:5432/migration_gov_test`) is explicitly non-production.

**is_isolated:** Whether the target database is isolated from other environments. The local test database `migration_gov_test` is a dedicated database used only for migration governance integration tests. It is not shared with any other application or test suite. The test harness uses a unique schema (`phase1a3_e2e_test`) that is dropped and recreated for each test run, ensuring complete isolation.

**authorized_for_mutation:** Whether the operator (in this case, the Phase 1A.3 authorization) explicitly permits mutation of the target database. The Phase 1A.3 authorization explicitly permits end-to-end validation against isolated non-production databases, exercising the baseline control plane, generating historical migration baseline evidence, testing `EXECUTION_ENABLED` activation/deactivation, and running test-only canary migrations. Production databases are explicitly excluded.

### 3.2 Classification Result

| Criterion | Value | Evidence |
|-----------|-------|----------|
| is_production | false | `DATABASE_URL` is not set to a production Neon connection string. The target is `postgresql://testuser:testpass@localhost:5432/migration_gov_test`. |
| is_isolated | true | The `migration_gov_test` database is dedicated to migration governance integration tests. The e2e harness uses schema `phase1a3_e2e_test`, dropped and recreated per test run. |
| authorized_for_mutation | true | Phase 1A.3 authorization explicitly permits non-production database mutation for end-to-end validation, baseline evidence generation, execution activation testing, and canary migrations. |

**Conclusion:** The local PostgreSQL test database is safe for mutation. All Phase 1A.3 database operations target this database only. No production Neon database is accessed or mutated.

### 3.3 Mutation Safety Guarantees

1. **No production access:** No Phase 1A.3 code or test connects to a production Neon database. The `DATABASE_URL` environment variable used by the governance functions is set to the local test database URL for all e2e tests. The Neon serverless driver is not used for any Phase 1A.3 database operation (the e2e tests use the `pg` module for direct PostgreSQL access, and the governance functions' `neon()` calls are tested through the `pg`-based integration path).

2. **Schema isolation:** Each e2e test run uses a unique schema (`phase1a3_e2e_test`) that is dropped and recreated at the start of each test. No test modifies the `public` schema or any other schema in the test database.

3. **Transactional rollback:** Canary migrations are executed inside transactions. If a test fails mid-execution, the transaction rolls back, leaving no partial state. The test harness also drops the test schema in the `afterEach` hook as a safety net.

4. **No new numbered migrations:** No files are added to or modified in `lib/migrations/`. All test-only migration fixtures live in `tests/fixtures/migrations/` and are injected via the `discoverMigrationFiles(dirOverride)` parameter. The fixture identifiers (900-903) are outside the production range (001-104) and use the same `NNN_description.sql` naming convention.

5. **No MFA Phase 3 modifications:** The `lib/mfa.ts` module is frozen. No Phase 1A.3 code modifies it. The e2e tests mock TOTP verification at the `verifyFreshTotp()` level rather than modifying the MFA module.

6. **No governance table bootstrapping in production:** The `bootstrapMigrationLedger()` function is called only against the local test database. No production governance tables are bootstrapped.

---

## 4. Architecture Audit — Current State

### 4.1 Manifest Discovery (`lib/migrations/manifest.ts`)

The `discoverMigrationFiles(dirOverride?: string)` function is the single entry point for building the migration manifest. It scans the `lib/migrations/` directory (or the `dirOverride` path) for `.sql` files, extracts numeric prefixes, detects duplicate prefixes (assigning `a`/`b` suffixes), computes SHA-256 checksums, identifies reserved gaps, and sorts files by identifier.

**Key finding for Phase 1A.3:** The `dirOverride` parameter already exists and is used by the Phase 1A.2 integration tests (they pass a temporary directory to test manifest discovery without touching `lib/migrations/`). This means the e2e harness can inject test-only migration fixtures without modifying any production code. The harness will call `discoverMigrationFiles(testFixtureDir)` to build a manifest from `tests/fixtures/migrations/`, then use that manifest with the governance functions.

**Security:** The manifest discovery function validates filenames against the `NNN_description.sql` pattern, checks for path traversal (the resolved path must start with the migrations directory), and computes checksums over exact file bytes. These security properties apply equally to the test fixture directory.

### 4.2 Runner (`lib/migrations/runner.ts`)

The runner is the canonical migration execution service. Key functions:

- `authorizeMigration()`: Checks admin role, environment allowlist, production flag, and TOTP verification. Returns a `MigrationAuthorization` object with `allowed: boolean` and `reason: string | null`.
- `verifyFreshTotp()`: Fail-closed TOTP verification with replay prevention. Returns `{ verified, deniedReason, timeStep }`. Uses `recordTotpUse()` for replay prevention (ON CONFLICT DO NOTHING).
- `inspectMigrationState()`: Read-only inspection. Combines manifest + ledger + lifecycle state. Returns pending, applied, failed, running, conflicts arrays.
- `runSinglePendingMigration()`: Executes a single migration. Verifies authorization, checks execution gate, bootstraps ledger if needed, checks ledger for existing state (checksum conflict, already running, already applied), marks as running, executes SQL in transaction with advisory lock, records result, emits audit event (fail-closed for mutations).
- `runPendingMigrations()`: Iterates through pending migrations in order. Stops on first failure.
- `splitSqlStatements()`: Defensive SQL splitter handling single-quoted strings, dollar-quoted blocks, line comments, block comments.
- `executeMigrationInTransaction()`: Executes migration SQL inside a Neon transaction with `pg_try_advisory_xact_lock`. Handles REQUIRED, FORBIDDEN, and MANUAL_REVIEW transaction modes. FORBIDDEN migrations are blocked (MIGRATION-GOV-12).

**Key finding for Phase 1A.3:** The runner uses `neon(process.env.DATABASE_URL!)` for all database operations. For the e2e tests, `DATABASE_URL` will be set to the local test database URL. However, the Neon serverless driver (`@neondatabase/serverless`) may behave differently from the `pg` module when connecting to a standard PostgreSQL instance. The e2e tests will need to either (a) set `DATABASE_URL` to the local test database and use the Neon driver (testing that the driver works against standard PostgreSQL), or (b) mock the `neon()` calls and use `pg` directly (testing the governance logic without the Neon driver). Approach (a) is preferred because it tests the real code path, but it requires the Neon driver to be able to connect to a standard PostgreSQL instance via a standard connection string. The `@neondatabase/serverless` driver supports standard PostgreSQL connection strings via the `neon()` function, so approach (a) is viable.

**Important architectural note:** The `neon()` function from `@neondatabase/serverless` uses HTTP/WebSocket by default when given a Neon connection string, but it falls back to standard PostgreSQL wire protocol when given a standard `postgresql://` connection string. This means the e2e tests can set `DATABASE_URL=postgresql://testuser:testpass@localhost:5432/migration_gov_test` and the governance functions will connect to the local PostgreSQL instance through the Neon driver's standard-PostgreSQL path. This tests the real governance code path (including the `sql.transaction()` callback constraint) against a real PostgreSQL instance, without requiring a Neon branch.

### 4.3 Ledger (`lib/migrations/ledger.ts`)

The ledger manages all database state for the migration governance system. Key functions:

- `bootstrapMigrationLedger()`: Creates the 5 governance tables (governance_lifecycle, schema_migrations, schema_migration_runs, migration_baseline, migration_totp_uses) using the fixed `BOOTSTRAP_LEDGER_DDL`. Idempotent (IF NOT EXISTS). Acquires advisory lock. Initializes the governance_lifecycle row to `BASELINE_REQUIRED`.
- `getGovernanceLifecycleState()`: Reads the lifecycle state for the current environment.
- `setGovernanceLifecycleState()`: Updates the lifecycle state. Emits a governance state change audit event.
- `recordBaselineReconciliation()`: Upserts a baseline row for a migration. Emits a baseline.completed audit event.
- `readBaselineReconciliation()` / `readAllBaselineReconciliations()`: Read baseline rows.
- `verifyBaselineComplete()`: Checks that all manifest migrations have been reconciled with non-blocking statuses. Returns `{ ok, unreconciled, blocking }`.
- `advanceToBaselineVerified()`: Transitions lifecycle to `BASELINE_VERIFIED`.
- `enableExecution()`: Transitions from `BASELINE_VERIFIED` to `EXECUTION_ENABLED`. Requires a non-empty reason. Records `execution_enabled_by/at`.
- `disableExecution()`: Transitions from `EXECUTION_ENABLED` back to `BASELINE_VERIFIED`. Requires a non-empty reason. Clears `execution_enabled_by/at`.
- `assertExecutionPermitted()`: Returns `{ permitted, lifecycleState }`. Only `EXECUTION_ENABLED` permits mutation (dry-run is always permitted).
- `recordTotpUse()`: Records a TOTP time-step use. ON CONFLICT DO NOTHING returns no rows for replays.
- `emitAuditEvent()` / `emitAuditEventAsync()`: Emits audit events to console (JSON) and durable `audit_log` table. `emitAuditEventAsync()` awaits persistence and returns `{ persisted, entryHash }` for fail-closed mutation paths.
- `recordMigrationRunEvent()`: INSERT-only into `schema_migration_runs` (append-only history).
- `recordMigrationResult()`: Upserts current-state row in `schema_migrations` AND inserts run history row.
- `markMigrationRunning()`: Sets status to `running` and records a `started` run history event.

**Key finding for Phase 1A.3:** All ledger functions use `neon(process.env.DATABASE_URL!)`. The `getCurrentEnvironment()` function returns `VERCEL_ENV || NODE_ENV || 'development'`. For the e2e tests, the environment will be `development` (or `test` if `NODE_ENV=test` is set). The environment allowlist (`MIGRATION_RUN_ALLOWED_ENVS`) must include the test environment for execution to be authorized. The e2e tests will set `MIGRATION_RUN_ALLOWED_ENVS=development,test` to permit execution in the test environment.

### 4.4 Types (`lib/migrations/types.ts`)

The types module defines all shared types and constants:

- `MigrationStatus`: `pending | running | applied | failed | superseded`
- `MigrationRunStatus`: `started | applied | failed | denied | skipped | dry_run | conflict | lock_timeout | baseline_blocked`
- `MigrationGovernanceLifecycle`: `UNBOOTSTRAPPED | LEDGER_BOOTSTRAPPED | BASELINE_REQUIRED | BASELINE_IN_PROGRESS | BASELINE_VERIFIED | EXECUTION_ENABLED`
- `BaselineReconciliationStatus`: `CONFIRMED_APPLIED | CONFIRMED_NOT_APPLIED | PARTIALLY_APPLIED | NOT_APPLICABLE | UNKNOWN`
- `BaselineEvidenceType`: `SCHEMA_INTROSPECTION | LEDGER_RECORD | MANUAL_VERIFICATION | CHECKSUM_MATCH | OBJECT_EXISTENCE | NONE`
- `TransactionMode`: `REQUIRED | FORBIDDEN | MANUAL_REVIEW`
- `MIGRATION_IDENTIFIER_REGEX`: `/^[0-9]{3}[a-z]?$/`
- `MIGRATION_LOCK_KEY_DECIMAL`: `'6003100736085771346'` (decimal string for BIGINT cast)
- `MIGRATIONS_DIR_RELATIVE`: `'lib/migrations'`

**Key finding for Phase 1A.3:** The identifier regex `^[0-9]{3}[a-z]?$` means test fixture identifiers must be exactly 3 digits with an optional lowercase letter. The fixture identifiers 900, 901, 902, 903 conform to this grammar. The `MIGRATIONS_DIR_RELATIVE` constant is used by `discoverMigrationFiles()` when no `dirOverride` is provided — the e2e harness will always provide a `dirOverride` pointing to `tests/fixtures/migrations/`.

### 4.5 API Route (`app/api/admin/migrations/route.ts`)

The route handles 10 actions:
- `GET`: Inspect migration state (read-only).
- `POST` actions: `inspect`, `run-pending`, `run-single`, `dry-run-pending`, `dry-run-single`, `inspect-baseline`, `record-baseline-entry`, `verify-baseline`, `enable-execution`, `disable-execution`.

The route enforces:
- Rate limiting via `checkRateLimit()`.
- Admin authentication via `requireAdminApi()`.
- Authorization via `authorizeMigration()`.
- TOTP verification via `verifyFreshTotp()` for execute and execution activation actions.
- Client-supplied `actorType` rejection (always `human`).
- Reason requirement for `enable-execution` and `disable-execution`.
- Lifecycle state precondition checks for `enable-execution` (must be `BASELINE_VERIFIED`) and `disable-execution` (must be `EXECUTION_ENABLED`).

**Key finding for Phase 1A.3:** The route requires a full Next.js server context (NextRequest, NextResponse, session authentication). The e2e tests cannot easily exercise the HTTP route layer without starting a Next.js dev server. Instead, the e2e tests will call the governance functions directly (the same functions the route calls), testing the route's logic through the function layer. The route's HTTP-specific logic (rate limiting, session auth, JSON parsing) is tested through the source-scanning tests in `phase1a-migration-governance.test.ts`. The e2e tests focus on the governance function layer that the route delegates to.

---

## 5. Workstream Design

### 5.1 Workstream 1: Full E2E Test Harness

**Goal:** Create a test harness that drives the complete migration governance lifecycle from an empty database to a successful migration application.

**Design:** The harness (`tests/phase1a3-migration-governance-e2e.test.ts`) uses the `pg` module for direct PostgreSQL access to the local test database. It sets `DATABASE_URL` to the test database URL so the governance functions (which use `neon()`) connect to the same database. Each test run uses a unique schema (`phase1a3_e2e_test`) that is dropped and recreated. The harness calls governance functions directly (not through the HTTP route) to test the function layer.

**Test fixture injection:** The harness calls `discoverMigrationFiles('tests/fixtures/migrations')` to build a manifest from the test fixture directory. This manifest is used with the governance functions. The fixture directory contains 4 canary migrations (900-903) that create temporary tables, add columns, add indexes, and insert data. These fixtures are transactional (REQUIRED mode), deterministic, and use isolated schema names to avoid conflicts.

### 5.2 Workstream 2: Complete Lifecycle Validation

**Goal:** Prove that the 6-state lifecycle machine works end-to-end.

**Design:** The e2e tests exercise each lifecycle transition:
1. `UNBOOTSTRAPPED` → `BASELINE_REQUIRED`: Call `bootstrapMigrationLedger()`. Verify the 5 governance tables are created. Verify the `governance_lifecycle` row is initialized to `BASELINE_REQUIRED`.
2. `BASELINE_REQUIRED` → `BASELINE_IN_PROGRESS`: Call `recordBaselineReconciliation()` for each test fixture migration. Verify the `migration_baseline` rows are created.
3. `BASELINE_IN_PROGRESS` → `BASELINE_VERIFIED`: Call `verifyBaselineComplete()`. Verify it returns `ok: true` when all migrations are reconciled with non-blocking statuses. Call `advanceToBaselineVerified()`. Verify the lifecycle state is `BASELINE_VERIFIED`.
4. `BASELINE_VERIFIED` → `EXECUTION_ENABLED`: Call `enableExecution()` with a reason. Verify the lifecycle state is `EXECUTION_ENABLED`. Verify `execution_enabled_by/at` are set.
5. `EXECUTION_ENABLED` → `BASELINE_VERIFIED`: Call `disableExecution()` with a reason. Verify the lifecycle state is `BASELINE_VERIFIED`. Verify `execution_enabled_by/at` are cleared.
6. Execution gate enforcement: Call `assertExecutionPermitted(false)` in each lifecycle state. Verify it returns `permitted: true` only in `EXECUTION_ENABLED` and `permitted: false` in all other states. Verify `assertExecutionPermitted(true)` (dry-run) always returns `permitted: true`.

### 5.3 Workstream 3: Runtime Route Validation

**Goal:** Prove that the governance functions (which the route delegates to) work correctly for all 10 actions.

**Design:** The e2e tests exercise the governance function layer for each route action:
- `inspect`: Call `inspectMigrationState()`. Verify it returns the correct manifest count, pending/applied/failed/running arrays, and lifecycle state.
- `run-pending`: Call `runPendingMigrations()` with authorization. Verify migrations are applied in order.
- `run-single`: Call `runSinglePendingMigration()` with authorization. Verify the migration is applied.
- `dry-run-pending` / `dry-run-single`: Call with `dryRun: true`. Verify no mutation occurs.
- `inspect-baseline`: Call `readAllBaselineReconciliations()`. Verify baseline entries are returned.
- `record-baseline-entry`: Call `recordBaselineReconciliation()`. Verify the baseline row is created.
- `verify-baseline`: Call `verifyBaselineComplete()` and `advanceToBaselineVerified()`. Verify the lifecycle advances.
- `enable-execution`: Call `enableExecution()` with a reason. Verify the lifecycle transitions.
- `disable-execution`: Call `disableExecution()` with a reason. Verify the lifecycle transitions.

### 5.4 Workstream 4: Historical Baseline Evidence Generator

**Goal:** Create a tool that automates the evidence-gathering step of baseline reconciliation.

**Design:** The generator (`lib/migrations/baselineEvidence.ts`) has two parts:
1. **Catalog gathering function:** `gatherCatalogSnapshot(sql)` — connects to the database via `neon()` and queries PostgreSQL catalog views (`pg_class`, `pg_namespace`, `pg_attribute`, `pg_indexes`, `pg_constraint`, `pg_proc`, `pg_trigger`, `pg_type`, `pg_policy`, `information_schema.tables`, `information_schema.columns`, `information_schema.routines`). Returns a plain object containing the query results. This function is read-only — it never mutates the database.

2. **Classification function:** `classifyMigrationEvidence(migration, catalogSnapshot)` — a pure function that takes a `MigrationFile` and a `CatalogSnapshot` and returns a `BaselineEvidenceClassification` with `status`, `evidenceType`, and `evidenceSummary`. The classification logic examines the migration's SQL content to determine what schema objects it creates (tables, columns, indexes, constraints, functions, triggers, types, policies) and then checks the catalog snapshot to see if those objects exist. The classification is deterministic and testable without a database connection.

**Evidence statuses:** The classifier returns one of the 5 `BaselineReconciliationStatus` values:
- `CONFIRMED_APPLIED`: All schema objects created by the migration exist in the catalog.
- `CONFIRMED_NOT_APPLIED`: None of the schema objects created by the migration exist in the catalog.
- `PARTIALLY_APPLIED`: Some but not all schema objects exist (blocking status).
- `NOT_APPLICABLE`: The migration creates no schema objects that can be checked (e.g., data-only migration, or ALTER on a table that might have a different name in this environment).
- `UNKNOWN`: The migration's SQL cannot be parsed to determine expected schema objects.

**No automatic approval:** The generator returns evidence classifications, not baseline reconciliation records. The operator must review the evidence and call `recordBaselineReconciliation()` for each migration through the API with a fresh TOTP. The generator is a decision-support tool, not an automation tool.

### 5.5 Workstream 5: Non-Production Existing-Schema Reconciliation

**Goal:** Run the baseline evidence generator against the local PostgreSQL test database and produce a baseline evidence report.

**Design:** The test (`tests/phase1a3-baseline-evidence-generation.test.ts`) connects to the local test database, gathers a catalog snapshot, runs the classifier against all 101 migrations from the production manifest, and produces a baseline evidence report. Since the test database is a fresh database with no migrations applied, all 101 migrations should be classified as `CONFIRMED_NOT_APPLIED` (none of their schema objects exist). The test verifies this expectation and produces the evidence report as a markdown document (`docs/phase1a/PHASE1A3-BASELINE-EVIDENCE-REPORT.md`).

### 5.6 Workstream 6: Persistent Audit Runtime Proof

**Goal:** Prove that audit events are emitted and persisted correctly during runtime operations.

**Design:** The e2e tests verify audit event emission by:
1. Checking that `emitAuditEvent()` produces structured JSON console output (captured via console.log spy).
2. Checking that `emitAuditEventAsync()` returns `{ persisted: true }` when the `audit_log` table is available. (The `audit_log` table may not exist in the test database — the e2e tests will create a minimal `audit_log` table for testing purposes, or mock the `writeAuditLog` function.)
3. Checking that `runSinglePendingMigration()` calls `emitAuditEventAsync()` for mutation success/failure and checks the `persisted` return value (fail-closed).
4. Checking that `enableExecution()` and `disableExecution()` emit governance state change audit events.

### 5.7 Workstream 7: Neon Serverless Compatibility

**Goal:** Validate that the governance system works correctly on a Neon serverless PostgreSQL instance.

**Design:** This workstream is conditional on the availability of an authorized non-production Neon branch. If available, the e2e tests are run against the Neon branch to verify:
- Advisory lock behavior (`pg_try_advisory_xact_lock` with the 64-bit key cast to BIGINT).
- Transaction execution via `sql.transaction()` (synchronous callback, array of query promises).
- Cold-start/scale-to-zero behavior (the first query after idle may take longer).
- Serverless driver compatibility (HTTP/WebSocket vs. raw TCP).

If no authorized Neon branch is available, a blocker report is produced documenting the validation gap and that local PostgreSQL 15 compatibility is validated through Commits 2 and 5.

### 5.8 Workstream 8: Canary Migration Requirements

**Goal:** Define and implement test-only canary migrations that prove the migration execution path works safely.

**Design:** The canary migrations are test fixtures in `tests/fixtures/migrations/`:
- `900_canary_test_table.sql`: Creates a temporary table `canary_test_table` with an `id` SERIAL column and a `name` TEXT column. Transactional (REQUIRED mode). Deterministic. Uses an isolated table name that will not conflict with any production schema.
- `901_canary_add_column.sql`: Adds an `email` TEXT column to `canary_test_table`. Transactional. Depends on 900.
- `902_canary_add_index.sql`: Creates an index `canary_test_table_email_idx` on `canary_test_table(email)`. Transactional. Depends on 901.
- `903_canary_seed_data.sql`: Inserts deterministic seed data into `canary_test_table`. Transactional. Depends on 900.

**Safety requirements:**
- All canary migrations use `REQUIRED` transaction mode (no FORBIDDEN statements like CREATE INDEX CONCURRENTLY).
- All canary migrations use isolated table/index names prefixed with `canary_` to avoid conflicts.
- All canary migrations are deterministic (no random values, no time-dependent logic).
- All canary migrations are in `tests/fixtures/migrations/`, never in `lib/migrations/`.
- The test harness drops the test schema after each test, ensuring complete cleanup.
- The canary migrations are injected via `discoverMigrationFiles(dirOverride)`, not through any modification to the production manifest discovery path.

### 5.9 Workstream 9: Operational State Report

**Goal:** Produce an honest, evidence-based assessment of the system's operational readiness.

**Design:** The `PHASE1A3-OPERATIONAL-STATE-REPORT.md` document (created in Commit 8) provides:
- A summary of what has been proven at each level (source, DDL, end-to-end).
- A summary of what has NOT been proven (Neon serverless compatibility, if blocked).
- A summary of the historical baseline reconciliation status (evidence generated but not confirmed by an operator).
- A clear statement of the distinction between "source code is correct" and "system has been proven to work operationally."
- Recommendations for next steps (production baseline reconciliation, Neon validation, production execution activation).

---

## 6. Commit Strategy

| Commit | Title | Scope | Files |
|--------|-------|-------|-------|
| 1 | docs(migrations): Phase 1A.3 exact-state and environment safety audit | Documentation | `docs/phase1a/PHASE1A3-OPERATIONAL-ACTIVATION-AUDIT.md` |
| 2 | test(migrations): Phase 1A.3 e2e harness and test-only migration fixtures | Tests + fixtures | `tests/fixtures/migrations/900-903_*.sql`, `tests/phase1a3-migration-governance-e2e.test.ts` |
| 3 | feat(migrations): baseline evidence generator (read-only catalog inspection) | Source + tests | `lib/migrations/baselineEvidence.ts`, `tests/phase1a3-baseline-evidence.test.ts` |
| 4 | test(migrations): runtime route, MFA, audit, and lifecycle tests | Tests | `tests/phase1a3-migration-governance-e2e.test.ts` (expanded) |
| 5 | test(migrations): non-production baseline evidence generation | Tests + docs | `tests/phase1a3-baseline-evidence-generation.test.ts`, `docs/phase1a/PHASE1A3-BASELINE-EVIDENCE-REPORT.md` |
| 6 | docs(migrations): Neon non-production compatibility validation | Documentation | `docs/phase1a/PHASE1A3-NEON-COMPATIBILITY-REPORT.md` |
| 7 | test(migrations): expanded tests and cleanup (Phase 1A.3) | Tests | Various test files |
| 8 | docs(migrations): Phase 1A.3 documentation and final report | Documentation | 4 new docs + 6 existing doc updates |

---

## 7. Acceptance Criteria Summary

Phase 1A.3 acceptance criteria (28 items) are verified in Section 9 of `todo.md`. The key criteria are:

1. Full lifecycle e2e test exists and passes (all 6 states exercised).
2. Test-only migration fixtures exist in `tests/fixtures/migrations/` (not `lib/migrations/`).
3. Canary migration execution proven in `EXECUTION_ENABLED` state.
4. Migration execution blocked before `EXECUTION_ENABLED` proven.
5. `enable-execution` / `disable-execution` cycle proven.
6. TOTP fail-closed behavior proven (no MFA → denied).
7. TOTP replay prevention proven.
8. Audit event emission proven (console + durable).
9. Append-only run history proven (started → applied).
10. Checksum conflict detection proven.
11. FORBIDDEN transaction mode blocking proven.
12. SQL statement splitting proven (dollar-quoted, strings, comments).
13. Advisory lock key isolation proven.
14. Baseline evidence generator exists as a pure, testable module.
15. Baseline evidence classifier unit tests pass.
16. Baseline evidence generated against local test DB (101 migrations).
17. Baseline evidence report produced.
18. Neon compatibility validated or blocker report produced.
19. No production database accessed or mutated.
20. No new numbered migrations in `lib/migrations/`.
21. No MFA Phase 3 modifications.
22. tsc passes with 0 errors.
23. Source-scanning tests pass (306+).
24. PostgreSQL integration tests pass (55+).
25. e2e tests pass with TEST_DATABASE_URL.
26. Baseline evidence tests pass.
27. All 8 commits pushed to `origin/dev`.
28. Operational state report provides honest readiness assessment.

---

## 8. Exclusions (Explicit)

The following are explicitly excluded from Phase 1A.3:

1. **No production database access or mutation.** The local PostgreSQL test database is the only target.
2. **No governance table bootstrapping in production.** `bootstrapMigrationLedger()` is called only against the local test database.
3. **No creation of migration 105.** No files are added to `lib/migrations/`. The highest prefix remains 104.
4. **No creation or modification of numbered files in `lib/migrations/`.** All 101 existing SQL files (001-104) remain unchanged.
5. **No organization, membership, active-org-context, resource-ownership, collaboration, billing, or tenant-cutover implementation.** These are out of scope.
6. **No modification of MFA Phase 3 code, tests, evidence, or frozen artifacts.** `lib/mfa.ts` is frozen.
7. **No modification of the existing Phase 1A, 1A.1, or 1A.2 governance source code** (`runner.ts`, `ledger.ts`, `types.ts`, `manifest.ts`, `validation.ts`, `route.ts`). Phase 1A.3 adds new files only (baseline evidence generator, test fixtures, e2e tests, documentation).

---

## 9. Rollback Plan

If any Phase 1A.3 commit introduces a regression:

1. **Revert the commit:** `git revert <commit-hash>` on `dev`.
2. **Verify tsc and tests:** Run `npx tsc --noEmit` and the full test suite to confirm the revert restores the prior state.
3. **Push the revert:** Push the revert commit to `origin/dev`.
4. **Document the rollback:** Add a note to the Phase 1A.3 final report explaining what was rolled back and why.

Since Phase 1A.3 adds only new files (no modifications to existing governance source code), a revert of any commit removes only the new files without affecting the existing governance system. The existing 361 tests (306 source-scanning + 55 integration) continue to pass regardless of Phase 1A.3 commits.

---

## 10. References

- Phase 1A final report: `docs/phase1a/PHASE1A-FINAL-REPORT.md`
- Phase 1A.1 final report: `docs/phase1a/PHASE1A1-FINAL-REPORT.md`
- Phase 1A.2 final report: `docs/phase1a/PHASE1A2-FINAL-REPORT.md`
- Phase 1A.2 baseline control plane: `docs/phase1a/PHASE1A2-BASELINE-CONTROL-PLANE.md`
- Phase 1A.2 PostgreSQL integration validation: `docs/phase1a/PHASE1A2-POSTGRES-INTEGRATION-VALIDATION.md`
- Phase 1A.3 final report: `docs/phase1a/PHASE1A3-FINAL-REPORT.md`
- Phase 1A.3 e2e validation: `docs/phase1a/PHASE1A3-E2E-VALIDATION.md`
- Phase 1A.3 canary migration: `docs/phase1a/PHASE1A3-CANARY-MIGRATION.md`
- Phase 1A.3 operational state report: `docs/phase1a/PHASE1A3-OPERATIONAL-STATE-REPORT.md`
- Phase 1A.3 baseline evidence report: `docs/phase1a/PHASE1A3-BASELINE-EVIDENCE-REPORT.md`
- Phase 1A.3 Neon compatibility report: `docs/phase1a/PHASE1A3-NEON-COMPATIBILITY-REPORT.md`
- Architecture decision: `docs/phase1a/ARCHITECTURE-DECISION-MIGRATION-MODEL.md`
- Audit system: `docs/phase1a/AUDIT-MIGRATION-SYSTEM.md`
- Source-scanning tests: `tests/phase1a-migration-governance.test.ts`
- PostgreSQL integration tests: `tests/phase1a2-postgres-integration.test.ts`
- Manifest discovery: `lib/migrations/manifest.ts`
- Runner: `lib/migrations/runner.ts`
- Ledger: `lib/migrations/ledger.ts`
- Types: `lib/migrations/types.ts`
- API route: `app/api/admin/migrations/route.ts`
