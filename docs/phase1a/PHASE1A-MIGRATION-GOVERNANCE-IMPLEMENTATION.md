# Phase 1A — Migration Governance Foundation Implementation

**Document Type:** Phase 1A Implementation Report (MIGRATION-GOV-01)
**Date:** 2026-07-11
**Branch:** `dev`
**Starting HEAD:** `d7b8e400` (docs: record Raymond stakeholder approval for ADR-008/009/010/012/014)
**Status:** IMPLEMENTED — MIGRATION-GOV-01 resolved. Migration governance foundation established.
**Authorization:** Phase 1A implementation (MIGRATION-GOV-01 only). No org/membership/ownership/collaboration/billing/cutover implementation. No MFA Phase 3 changes (frozen/closed). Migration 105 NOT created.

---

## 1. Purpose

This document records the implementation of the Phase 1A Migration Governance Foundation — the resolution of MIGRATION-GOV-01, the blocking governance risk identified during Phase 0.5B. MIGRATION-GOV-01 documented that the SolarPro codebase had multiple non-authoritative migration execution paths, no `schema_migrations` tracking ledger, no advisory locking, no transactional execution, and no mandatory checksum validation. This implementation establishes a single authoritative migration execution model with full governance controls.

This is the first production code implementation authorized after Phases 0 through 0.5C. The scope is strictly limited to migration governance: resolving MIGRATION-GOV-01 and establishing the governance foundation. No enterprise organization schema, membership, ownership, collaboration, billing, or cutover work was performed.

---

## 2. Starting State

The starting state was documented in `docs/phase1a/AUDIT-MIGRATION-SYSTEM.md` and `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-MIGRATION-SEQUENCE-STATE.md`. The key findings were:

The codebase had three migration execution paths, none of which were authoritative:

1. `app/api/migrate/route.ts` — a 4,223-line monolithic inline SQL runner that did not read migration files at all. It executed inline SQL statements directly against the database. It had no `schema_migrations` ledger, no advisory locking, no transaction wrapping, and no checksum validation. Idempotency was structural (IF NOT EXISTS, ON CONFLICT DO NOTHING).

2. `app/api/admin/system-tools/route.ts` — an admin tool runner with a `run_migration` case that could read and execute files from `lib/migrations/`. It had optional SHA-256 checksum verification (but zero `.sha256` sidecar files existed, so the feature was never exercised). It also had no `schema_migrations` ledger.

3. A separate legacy `migrations/` directory at the repository root containing 17 SQL files (prefixes 009–023) that was a frozen duplicate, not referenced by any runner.

The primary migration directory `lib/migrations/` contained 101 SQL files spanning prefixes 001–104, with a duplicate prefix at 074 (two distinct files) and reserved gaps at 009, 012, 013, 014. No migration 105 existed.

---

## 3. Architecture Decision

The full architecture decision is documented in `docs/phase1a/ARCHITECTURE-DECISION-MIGRATION-MODEL.md`. The chosen authoritative migration model comprises the following components:

**Versioned migration files** — The existing `lib/migrations/` directory is the canonical migration source. Files follow `{NNN}_{description}.sql` naming. The duplicate prefix 074 is disambiguated as 074a and 074b by alphabetical filename sort. Historical migration files are NOT renumbered or modified. Gaps (009, 012, 013, 014) remain reserved.

**Database migration ledger** — A `schema_migrations` table records every migration attempt with full metadata: identifier, filename, SHA-256 checksum, description, status, timestamps, environment, actor, execution ID, error details, and rollback reference. The ledger is append-only for historical records and uses upsert semantics for re-attempts within an environment.

**SHA-256 checksum validation** — Every migration file's checksum is computed over its exact file bytes (binary mode read). Checksums are mandatory and stored in the ledger. A modified applied file (checksum mismatch) is refused — there is no silent override.

**Single execution service** — `lib/migrations/runner.ts` is the ONLY module permitted to apply schema migrations. Both legacy runners are restricted via feature flags and emit deprecation audit events.

**Transactional execution** — Each migration is executed within a Neon `sql.transaction()` callback. The transaction acquires a PostgreSQL advisory lock (`pg_advisory_xact_lock`, transaction-scoped) before executing the migration SQL. Transaction-scoped locks are used instead of session-scoped locks because Neon serverless uses short-lived HTTP connections where session-scoped locks would not persist.

**Environment-aware authorization** — Production migration execution is disabled by default. An explicit environment allowlist (`MIGRATION_RUN_ALLOWED_ENVS`) and an explicit production flag (`MIGRATION_ALLOW_PRODUCTION_EXECUTION`) are both required for production execution (two-key requirement).

**Append-only application history** — The ledger records every migration attempt. Historical records are preserved. Statuses track the full lifecycle: pending, running, applied, failed, superseded.

---

## 4. Implemented Modules

### 4.1 lib/migrations/types.ts (309 lines)

All type definitions for the migration governance subsystem. Key exports include `MigrationStatus` (pending, running, applied, failed, superseded), `MigrationFile` with identifier/prefix/filename/checksum fields, `MigrationManifest`, `ManifestValidationResult`, `MigrationLedgerRow`, `MigrationAuthorization`, `MigrationExecutionResult`, `MigrationRunResult`, `MigrationInspectionState`, `MigrationAuditEvent`, and `MigrationAuditEventType`. Constants include `MIGRATION_LOCK_KEY = 0x534f4c504d474452` (a fixed 64-bit advisory lock key encoding "SOLPMGDR"), `MIGRATIONS_DIR_RELATIVE = 'lib/migrations'`, environment variable names, and platform permission strings (`platform.migrations.execute`, `platform.migrations.inspect`).

### 4.2 lib/migrations/manifest.ts (295 lines)

Migration file discovery and manifest validation. `discoverMigrationFiles()` scans `lib/migrations/`, groups files by prefix, assigns disambiguated identifiers for duplicate prefixes (074a/074b), computes SHA-256 checksums for each file, identifies gaps, and sorts by identifier. `validateMigrationManifest()` checks for identical files (error), documents duplicates (note), documents gaps (note), validates filename format, and performs a path traversal containment check. `extractPrefix()` and `extractDescription()` parse the `{NNN}_{description}.sql` naming convention. `findMigrationByIdentifier()` and `getMigrationIdentifiers()` provide lookup helpers.

### 4.3 lib/migrations/validation.ts (91 lines)

Checksum computation and verification. `calculateMigrationChecksum(filePath)` computes SHA-256 over exact file bytes (reads in binary mode). `calculateChecksumOfString(content)` computes SHA-256 over a UTF-8 string. `verifyMigrationChecksum(file, expectedChecksum)` returns a match result. `checksumsMatch(computed, expected)` performs case-insensitive comparison. `areFilesIdentical(fileA, fileB)` checks whether two files have the same checksum. `isValidChecksumFormat(checksum)` validates the 64-character hex format.

### 4.4 lib/migrations/ledger.ts (350 lines)

Database ledger operations. `BOOTSTRAP_LEDGER_DDL` is the fixed, idempotent `CREATE TABLE IF NOT EXISTS schema_migrations` statement with all 18 columns and supporting indexes. `bootstrapMigrationLedger(actorType, actorId)` creates the ledger table if absent, using a Neon transaction with `pg_advisory_xact_lock` and synchronous array-return callback (no await inside, per Neon transaction API constraints). `recordMigrationResult(params)` upserts by `(migration_identifier, environment)` with `ON CONFLICT DO UPDATE`. `readLedgerRows()` and `readLedgerRow(identifier)` read ledger state. `markMigrationRunning(params)` records the start of an execution attempt. `emitAuditEvent(event)` provides structured JSON console logging for all audit events. `getCurrentEnvironment()` resolves the current environment from `VERCEL_ENV` or `NODE_ENV`. The module uses `neon(process.env.DATABASE_URL)` directly (not `getDbReady`) for precise transaction control.

### 4.5 lib/migrations/runner.ts (946 lines)

The canonical migration execution service — the ONLY module permitted to apply schema migrations. Key functions:

`authorizeMigration(params)` — Full authorization logic: role check (super_admin for execute, admin+ for inspect), environment allowlist, production two-key requirement, fresh TOTP for human execution, migration-actor exemption from TOTP, and dry-run bypass for env/production checks.

`verifyFreshTotp(adminUserId, code)` — Fetches the admin user's TOTP secret from the database, decrypts it, and verifies the TOTP code using `verifyTOTPCode()` from `lib/mfa.ts`. Waives the TOTP requirement if MFA is not enabled for the user (no secret exists).

`splitSqlStatements(sql)` — A defensive SQL statement splitter that handles dollar-quoting (`$$...$$` and `$tag$...$tag$`), single-quoted string literals, double-quoted identifiers, line comments (`--`), and block comments (`/* ... */`).

`inspectMigrationState()` — Combines the manifest with the ledger to report pending, applied, failed, running, and conflict states.

`executeMigrationInTransaction(file, dryRun)` — Executes a migration's SQL within a Neon transaction with the advisory lock. In dry-run mode, validates without mutation.

`runSinglePendingMigration(identifier, options)` — Full single-migration lifecycle: authorization check, bootstrap, manifest lookup, ledger state check (refuses on checksum conflict, skips if already applied, refuses if running/superseded), mark running, execute in transaction, record result, emit audit events.

`runPendingMigrations(options)` — Batch execution: authorization check, bootstrap, inspect pending migrations, iterate in identifier order, STOP on first failure.

Feature flag helpers: `getAllowedEnvs()`, `isProductionExecutionAllowed()`, `isLegacyInlineEnabled()`, `isLegacySystemToolsRunEnabled()`.

---

## 5. Canonical API Route

### app/api/admin/migrations/route.ts (300 lines)

The canonical migration API route. `export const dynamic = 'force-dynamic'`, `runtime = 'nodejs'`, `maxDuration = 60`.

**GET handler** — Inspect migration state (read-only). Requires admin+ role via `requireAdminApi(req)` and `authorizeMigration()` with `action: 'inspect'`.

**POST handler** — Supports actions: `inspect`, `run-pending`, `run-single`, `dry-run-pending`, `dry-run-single`. Requires super_admin role for non-dry-run execution. Requires a fresh `totpCode` in the request body for non-dry-run human execution, verified via `verifyFreshTotp()`. No client-supplied SQL is accepted — only an `identifier` from the manifest is used to select a migration. No arbitrary filenames. Rate-limited via `checkRateLimit('migrate', getClientIp(req))`.

---

## 6. Legacy Runner Disposition

Per the specification, legacy runners were restricted — NOT deleted. Both remain in place but are gated by feature flags that default to disabled.

### app/api/migrate/route.ts — Restricted

A feature flag gate was added after the existing `MIGRATE_SECRET` validation. When `MIGRATION_LEGACY_INLINE_ENABLED` is not set to `'true'` (the default), the route emits a `migration.legacy.invoked` audit event and returns HTTP 423 Locked with a deprecation notice directing users to the canonical path (`POST /api/admin/migrations` with action `run-pending` or `run-single`). The file was NOT deleted.

### app/api/admin/system-tools/route.ts — Restricted

The `run_migration` case was gated by `MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED`. When not set to `'true'` (the default), it emits a `migration.legacy.invoked` audit event and returns HTTP 423 Locked with a deprecation notice. The `list_migrations` case was NOT gated (it remains functional as a read-only diagnostic). The `set_user_password` case was NOT gated (separate concern). The file was NOT deleted.

---

## 7. schema_migrations Ledger Schema

The ledger table is created by `bootstrapMigrationLedger()` using the fixed `BOOTSTRAP_LEDGER_DDL`. The table has 18 columns:

| Column | Type | Purpose |
|--------|------|---------|
| id | SERIAL PRIMARY KEY | Auto-increment row ID |
| migration_identifier | TEXT NOT NULL | Disambiguated identifier (e.g., 074a, 104) |
| filename | TEXT NOT NULL | Full migration filename |
| checksum_sha256 | TEXT NOT NULL | SHA-256 checksum of the migration file |
| description | TEXT NOT NULL | Human-readable description extracted from filename |
| status | TEXT NOT NULL DEFAULT 'pending' | pending, running, applied, failed, superseded |
| started_at | TIMESTAMPTZ | When execution started |
| applied_at | TIMESTAMPTZ | When execution completed successfully |
| failed_at | TIMESTAMPTZ | When execution failed |
| execution_duration_ms | INTEGER | Duration of execution in milliseconds |
| environment | TEXT NOT NULL | The environment (development, staging, production) |
| applied_by_actor_type | TEXT NOT NULL | human or migration-actor |
| applied_by_actor_id | TEXT | User ID or service token identifier |
| execution_id | TEXT | Unique UUID for the execution attempt |
| error_code | TEXT | Error code if failed |
| error_summary | TEXT | Error summary if failed |
| rollback_reference | TEXT | Reference to rollback procedure (if any) |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT NOW() | Row creation timestamp |

Indexes: a unique index on `(migration_identifier, environment)` ensures one record per migration per environment, and an index on `status` supports efficient inspection queries.

### Bootstrap Problem Resolution

The ledger must exist before it can record ordinary migrations. `bootstrapMigrationLedger()` creates the table using a fixed, idempotent `CREATE TABLE IF NOT EXISTS` DDL that runs inside a Neon transaction with the advisory lock. This bootstrap is the ONLY DDL that runs outside the normal migration flow. It is guarded by authorization and the advisory lock. The bootstrap is idempotent — running it when the table already exists is a no-op.

---

## 8. Advisory Locking Strategy

PostgreSQL advisory locks prevent concurrent migration execution. The lock key is the fixed constant `MIGRATION_LOCK_KEY = 0x534f4c504d474452` (encoding "SOLPMGDR" in hex). This is a 64-bit integer, not user-supplied.

The implementation uses `pg_advisory_xact_lock` (transaction-scoped) rather than `pg_advisory_lock` (session-scoped). This choice is critical for Neon serverless compatibility: Neon uses short-lived HTTP connections, so session-scoped locks would not persist across HTTP calls. Transaction-scoped locks are automatically released when the transaction commits or rolls back, which is the safe failure mode — if a migration execution fails, the lock is released automatically, preventing deadlock.

The lock is acquired at the start of every transaction: the bootstrap transaction, the migration execution transaction, and the ledger state operations.

---

## 9. Authorization Controls

### Platform Permissions

Two dedicated platform permissions are defined: `platform.migrations.execute` (required to run migrations) and `platform.migrations.inspect` (required to inspect migration state). Execution requires `super_admin` role. Inspection requires `admin` or `super_admin` role.

### Environment Authorization

Production migration execution is disabled by default. Two conditions must BOTH be true for production execution:

1. The current environment must be in the `MIGRATION_RUN_ALLOWED_ENVS` allowlist.
2. `MIGRATION_ALLOW_PRODUCTION_EXECUTION` must be explicitly set to `'true'`.

This two-key requirement ensures that production migration execution requires deliberate, explicit configuration — it cannot happen by accident or by default.

### MFA / Fresh TOTP

Human-initiated migration execution (non-dry-run) requires a fresh TOTP code in the request body. The code is verified server-side via `verifyTOTPCode()` and `decryptTOTPSecret()` from `lib/mfa.ts`. This provides recent-MFA assurance at migration execution time, which the existing `requireAdminApi()` does not provide (it verifies the admin role from the database but does not check MFA status).

The `migration-actor` actor type (automated service token) is exempt from the TOTP requirement — automated migrations do not require a human TOTP code.

Dry-run operations bypass the environment, production, and TOTP checks (they perform no mutation).

### Security Properties

No client-supplied SQL is accepted. The API route accepts only an `identifier` from the manifest — the runner reads the SQL from the file on disk. No arbitrary filenames are accepted. No path traversal is possible — the manifest scans a fixed directory and validates that discovered paths are contained within it. No execution of modified applied files is permitted (checksum conflict detection refuses to re-run a migration whose file has changed since it was applied). No silent checksum override exists.

---

## 10. Historical Migration Reconciliation

### No Renumbering

Historical migration files were NOT renumbered or modified. All 101 files retain their original filenames and content. This is a critical principle: the governance system must accommodate the existing history, not rewrite it.

### Duplicate Prefix 074

The duplicate prefix 074 is disambiguated as 074a (`074_photo_vision_jobs_dedup_index.sql`) and 074b (`074_photo_vision_jobs_render_job_id.sql`) by alphabetical filename sort. Both files have distinct SHA-256 checksums. The disambiguated identifiers are used throughout the governance system (manifest, ledger, API). The original filenames are preserved on disk.

### Reserved Gaps

The gaps at prefixes 009, 012, 013, 014 are reserved. No files exist for these prefixes. The gaps are NOT errors — they are documented as notes in the manifest validation result. The gaps are NOT candidates for reuse. The next migration continues the monotonically increasing sequence from the highest prefix (104).

### Legacy migrations/ Directory

The legacy `migrations/` directory at the repository root (17 files, prefixes 009–023) is a frozen duplicate. It is NOT included in the canonical manifest. `discoverMigrationFiles()` scans only `lib/migrations/`. The legacy directory is excluded by design.

---

## 11. Status of Migration 105

Migration 105 does NOT exist. No migration file with prefix 105 was created. The repository-sequential candidate is 105 (highest existing prefix 104 + 1), but it is INFORMATIONAL ONLY. Creation of migration 105 is NOT authorized in Phase 1A. Migration 105 would be the first enterprise authority schema migration (adding org-level ownership columns), which is Phase 2 work — explicitly out of scope for Phase 1A.

### NEXT_ENTERPRISE_AUTHORITY_MIGRATION Status

The placeholder `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` remains unassigned. It cannot be assigned a numeric value until the enterprise authority schema migration is authorized (Phase 2). The migration governance foundation established in Phase 1A resolves MIGRATION-GOV-01, which was one of the prerequisites for assigning the identifier. However, the remaining prerequisites (all 15 program gates passing, full Authorization Test Matrix passing, no regressions across all 280 API routes, Raymond approving the Phase 1 to Phase 2 transition) are NOT yet satisfied. The placeholder continues to be used in all documentation.

---

## 12. Tests

A comprehensive test suite was created at `tests/phase1a-migration-governance.test.ts` (955 lines, 114 test cases across 12 describe blocks):

1. Module Structure — all 5 required modules exist
2. Type Definitions — all types and constants are present and correctly defined
3. Manifest Discovery — real `lib/migrations/` discovery (101 files, highest prefix 104, duplicate 074a/074b, gaps documented)
4. Checksum Integrity — SHA-256 over exact file bytes, deterministic, case-insensitive match, format validation
5. SQL Statement Splitting — dollar-quoting, string literals, comments, edge cases
6. Authorization Logic — 11 test cases covering role checks, environment allowlist, production flag, TOTP, dry-run, migration-actor exemption
7. Ledger Bootstrap DDL — structure validation (all 18 columns, indexes, advisory lock, audit events)
8. Runner Execution Model — transaction usage, audit events, checksum conflict, concurrent execution, dry-run, required exports
9. API Route — GET/POST handlers, auth, action validation, no client SQL, no arbitrary filenames
10. Legacy Runner Restriction — feature flag gates, deprecation audit events, canonical path direction, files NOT deleted
11. Security — no path traversal, no client SQL, no arbitrary filenames, fixed lock key, legacy directory excluded
12. Historical Reconciliation — no renumbering, gaps not errors, distinct checksums for duplicate 074, no 105, legacy directory excluded

### Test Results

**Command:** `npx vitest run tests/phase1a-migration-governance.test.ts`
**Result:** 114 passed, 0 failed (94ms test execution, 545ms total)

**Command:** `npx vitest run` (full test suite)
**Result:** 6,787 passed, 1 failed (1 pre-existing failure in `tests/golden-path.test.ts` — SLD Pipeline combiner fields, confirmed to fail on clean `d7b8e400` before any Phase 1A changes, unrelated to migration governance)

**Command:** `npx tsc --noEmit`
**Result:** exit 0, no errors

---

## 13. Audit Events

The governance system emits structured JSON audit events for every operation:

| Event Type | When Emitted |
|------------|--------------|
| `migration.inspect` | Migration state inspected (read-only) |
| `migration.bootstrap.started` | Ledger bootstrap begun |
| `migration.bootstrap.completed` | Ledger bootstrap completed successfully |
| `migration.bootstrap.failed` | Ledger bootstrap failed |
| `migration.run.started` | Migration run begun |
| `migration.run.completed` | Migration run completed successfully |
| `migration.run.failed` | Migration run failed |
| `migration.conflict.detected` | Checksum conflict detected (modified applied file) |
| `migration.checksum_mismatch` | Checksum mismatch between file and ledger |
| `migration.lock_denied` | Advisory lock could not be acquired |
| `migration.legacy.invoked` | A legacy runner was invoked while disabled |
| `manifest.duplicate_prefix` | A duplicate prefix was detected during manifest validation |

All audit events include: event type, timestamp, environment, actor type, actor ID, execution ID, migration identifier (where applicable), and relevant details.

---

## 14. Rollback Procedure

If the Phase 1A implementation needs to be rolled back:

1. **Revert the commits** — The implementation is committed in small, reviewable commits. Reverting the commits restores the pre-Phase-1A state.

2. **Feature flags** — The legacy runners are gated by `MIGRATION_LEGACY_INLINE_ENABLED` and `MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED` (both default to `false`). To re-enable a legacy runner without reverting code, set the corresponding flag to `'true'`. This provides a runtime rollback path without code changes.

3. **schema_migrations table** — If the ledger table was created in a database, it can be dropped with `DROP TABLE IF EXISTS schema_migrations`. The table is purely additive — it does not modify any existing schema. Dropping it removes all migration tracking records but does not affect the database schema itself.

4. **No migration files were created or modified** — There are no SQL migrations to revert. The 101 existing migration files are unchanged.

5. **No MFA changes** — MFA Phase 3 artifacts are untouched. No rollback needed for MFA.

---

## 15. Files Changed

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `lib/migrations/types.ts` | 309 | Type definitions and constants |
| `lib/migrations/manifest.ts` | 295 | Migration file discovery and manifest validation |
| `lib/migrations/validation.ts` | 91 | SHA-256 checksum computation and verification |
| `lib/migrations/ledger.ts` | 350 | schema_migrations ledger operations and bootstrap |
| `lib/migrations/runner.ts` | 946 | Canonical migration execution service |
| `app/api/admin/migrations/route.ts` | 300 | Canonical migration API route |
| `tests/phase1a-migration-governance.test.ts` | 955 | Comprehensive test suite (114 tests) |
| `docs/phase1a/AUDIT-MIGRATION-SYSTEM.md` | — | Read-only audit of the migration system |
| `docs/phase1a/ARCHITECTURE-DECISION-MIGRATION-MODEL.md` | 391 | Architecture decision and reconciliation inventory |
| `docs/phase1a/PHASE1A-MIGRATION-GOVERNANCE-IMPLEMENTATION.md` | — | This document |

### Modified Files

| File | Change |
|------|--------|
| `app/api/migrate/route.ts` | Added `MIGRATION_LEGACY_INLINE_ENABLED` feature flag gate + deprecation audit (423 Locked when disabled) |
| `app/api/admin/system-tools/route.ts` | Added `MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED` feature flag gate on `run_migration` case + deprecation audit (423 Locked when disabled) |

### Documentation Updated

| File | Change |
|------|--------|
| `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-MIGRATION-SEQUENCE-STATE.md` | MIGRATION-GOV-01 status updated to RESOLVED |
| `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-PHASE1-ENTRY-GATES.md` | Corrected circular gate language; noted Phase 1A governance implementation |
| `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-PHASE1-IMPLEMENTATION-SPEC.md` | Added Phase 1A governance note |

### Migrations Created

None. No migration SQL files were created or modified. Migration 105 was NOT created.

---

## 16. Phase 1A.1 Operational Hardening (MIGRATION-GOV-02 through MIGRATION-GOV-08)

Phase 1A established the migration governance foundation and resolved
MIGRATION-GOV-01. Phase 1A.1 makes that foundation operationally safe by
resolving the 8 remaining governance risks (MIGRATION-GOV-02 through
MIGRATION-GOV-08) identified in the Phase 1A implementation review. No
organization schema, membership, ownership, collaboration, billing, or cutover
work was performed. No numbered SQL migration files were created or modified.
The MFA Phase 3 code remains frozen and untouched. Only the fixed bootstrap DDL
inside migration-governance code was modified (the ledger has not been applied
to any database yet, so the DDL is code, not a migration).

### 16.1 Governance Risks Resolved

| Risk | Description | Resolution |
|------|-------------|------------|
| MIGRATION-GOV-02 | Historical applied-state baseline is unknown | Historical baseline reconciliation model with 5 statuses; execution blocked until baseline verified |
| MIGRATION-GOV-03 | Append-only run history with ledger constraints | `schema_migration_runs` append-only table with status/identifier/checksum CHECK constraints and INSERT-only invariant |
| MIGRATION-GOV-04 | MFA fail-open: TOTP waived when user has no secret | Fixed `verifyFreshTotp()` to fail-closed (DENY when no MFA secret, not waive) |
| MIGRATION-GOV-05 | TOTP replay: same code reusable within window | `migration_totp_uses` table tracking (user_id, time_step) pairs; reject same time-step reuse via ON CONFLICT DO NOTHING |
| MIGRATION-GOV-06 | Lock key precision and indefinite blocking | Lock key as decimal string with BIGINT cast (exact 0x534f4c504d474452 = 6003100736085771346); `pg_try_advisory_xact_lock` with bounded timeout |
| MIGRATION-GOV-06 | Transaction mode incompatibility | `TransactionMode` (REQUIRED/FORBIDDEN/MANUAL_REVIEW) with automatic detection of 7 incompatible patterns; 3-mode execution handling |
| MIGRATION-GOV-07 | Non-canonical execution paths | `app/api/admin/prospects/seed/route.ts` gated behind `MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED` flag (default disabled) |
| MIGRATION-GOV-08 | Audit not durable; no transaction failure recording | `emitAuditEvent` now persists to `audit_log` table via `writeAuditLog` (fire-and-forget); transaction-mode-specific error codes |

### 16.2 Five-Table Ledger Architecture

Phase 1A.1 expanded the ledger from a single `schema_migrations` table to a
five-table architecture, all bootstrapped by the fixed `BOOTSTRAP_LEDGER_DDL`
inside `ledger.ts`:

| Table | Purpose |
|-------|---------|
| `governance_lifecycle` | Tracks the governance state per environment (UNBOOTSTRAPPED, LEDGER_BOOTSTRAPPED, BASELINE_REQUIRED, BASELINE_IN_PROGRESS, BASELINE_VERIFIED, EXECUTION_ENABLED) |
| `schema_migrations` | The canonical ledger: one row per migration per environment, with checksum and applied status |
| `schema_migration_runs` | Append-only run history: every execution attempt (success or failure) with actor identity, timestamps, and error details |
| `migration_baseline` | Historical baseline reconciliation records: per-migration applied-state determination with 5 statuses and evidence metadata |
| `migration_totp_uses` | TOTP replay prevention: SHA-256 hash of (user_id, time_step) pairs, never storing the TOTP code itself |

### 16.3 Governance Lifecycle States

The governance system enforces a lifecycle that prevents execution until the
historical baseline has been reconciled:

1. **UNBOOTSTRAPPED** — The ledger does not exist yet.
2. **LEDGER_BOOTSTRAPPED** — The five tables have been created. The system
   automatically advances to BASELINE_REQUIRED.
3. **BASELINE_REQUIRED** — The historical baseline must be reconciled before any
   migration execution is permitted. This is the state the system lands in after
   bootstrap.
4. **BASELINE_IN_PROGRESS** — An administrator is actively reconciling the
   baseline (recording applied-state for each historical migration).
5. **BASELINE_VERIFIED** — All historical migrations have been reconciled.
   Single-migration execution is now permitted.
6. **EXECUTION_ENABLED** — The system is fully operational. All gates are open.

The `assertExecutionPermitted()` gate in `runner.ts` checks the lifecycle state
at both execution entry points. Only BASELINE_VERIFIED and EXECUTION_ENABLED
permit execution. All other states (including unreadable state, which fails
closed) block execution with a `migration_governance_execution_denied` audit
event. Dry-run/inspect operations are exempt from the gate.

### 16.4 Historical Baseline Reconciliation

The `migration_baseline` table records the applied-state determination for each
historical migration. Five reconciliation statuses are supported:

| Status | Meaning |
|--------|---------|
| `CONFIRMED_APPLIED` | The migration was verified as applied in the database (e.g., schema objects exist) |
| `CONFIRMED_NOT_APPLIED` | The migration was verified as NOT applied |
| `PARTIALLY_APPLIED` | The migration was partially applied (some objects exist, some do not) |
| `NOT_APPLICABLE` | The migration is not applicable to this environment |
| `UNKNOWN` | The applied state could not be determined |

Reconciliation is performed one migration at a time (no bulk "mark all applied"
operation) via `recordBaselineReconciliation()`. The `verifyBaselineComplete()`
function checks whether all manifest migrations have a baseline record.
`advanceToBaselineVerified()` transitions the lifecycle state. `enableExecution()`
moves from BASELINE_VERIFIED to EXECUTION_ENABLED.

See `docs/phase1a/PHASE1A1-HISTORICAL-BASELINE-MODEL.md` for the full model.

### 16.5 Lock Key Exactness

Phase 1A used `0x534f4c504d474452` as a JavaScript numeric literal. This value
(6003100736085771346) exceeds `Number.MAX_SAFE_INTEGER` (2^53 - 1 =
9007199254740991), meaning JavaScript silently rounds it to
6003100736085771000. The PostgreSQL advisory lock was being acquired with a
truncated key.

Phase 1A.1 fixes this by storing the lock key as a decimal string
`'6003100736085771346'` and casting it to BIGINT in the SQL:
`pg_try_advisory_xact_lock($1::bigint)`. This guarantees the exact 64-bit value
is used. The `pg_try_advisory_xact_lock` variant (with a bounded timeout) is used
instead of `pg_advisory_xact_lock` (which blocks indefinitely), preventing
permanent blocking if a lock holder crashes.

See `docs/phase1a/PHASE1A1-SQL-COMPATIBILITY-REPORT.md` for the full analysis.

### 16.6 Transaction Mode Detection and Compatibility

Neon's `sql.transaction()` wraps all statements in a single transaction. Some
SQL statements cannot run inside a transaction (e.g., `VACUUM`, `CREATE
DATABASE`, `CREATE INDEX CONCURRENTLY`). Phase 1A.1 adds a `TransactionMode`
field to every migration file manifest entry:

| Mode | Behavior |
|------|----------|
| `REQUIRED` | Execute inside a transaction (the default and safe mode) |
| `FORBIDDEN` | Execute outside a transaction, statement by statement |
| `MANUAL_REVIEW` | Do not execute automatically; require manual intervention |

The `detectTransactionMode()` function in `validation.ts` automatically detects
7 incompatible patterns: `VACUUM`, `CREATE DATABASE`, `DROP DATABASE`,
`CREATE TABLESPACE`, `CREATE INDEX CONCURRENTLY`, `REINDEX`, and `ALTER SYSTEM`.
Migrations containing these patterns are assigned the appropriate mode (FORBIDDEN
for `VACUUM`/`CREATE INDEX CONCURRENTLY`/`REINDEX`; MANUAL_REVIEW for
`CREATE DATABASE`/`DROP DATABASE`/`ALTER SYSTEM`). The manifest computes the
mode at discovery time.

The `executeMigrationInTransaction()` function in `runner.ts` handles all three
modes and returns a specific `errorCode` for transaction-mode failures:
`TRANSACTION_MODE_MANUAL_REVIEW`, `FORBIDDEN_MODE_STATEMENT_ERROR`,
`LOCK_DENIED`, or `TRANSACTION_ERROR`.

### 16.7 MFA Fail-Closed and TOTP Replay Prevention

**Fail-closed fix (MIGRATION-GOV-04):** The Phase 1A `verifyFreshTotp()`
function returned `true` (waived) when a user had no MFA secret configured. This
meant MFA was effectively disabled for any admin without MFA. Phase 1A.1 fixes
this to fail-closed: when no MFA secret exists, the function returns `false`
(DENY). Execution is blocked and the user must configure MFA first.

**TOTP replay prevention (MIGRATION-GOV-05):** A TOTP code is valid for a
30-second window (plus a ±1 step tolerance). Phase 1A did not prevent the same
code from being used multiple times within that window. Phase 1A.1 adds the
`migration_totp_uses` table. The `recordTotpUse()` function inserts a SHA-256
hash of the `(user_id, time_step)` pair with `ON CONFLICT DO NOTHING RETURNING
id`. If the insert returns no row (conflict), the time-step has already been
used and the code is rejected as a replay. The TOTP code itself is NEVER stored —
only the hash of the pair. `isTotpTimeStepUsed()` provides a read check.

Failed authentication does NOT consume a valid code. The replay record is only
inserted on successful verification, so a user can retry within the same window
if they mistype.

### 16.8 Non-Canonical Execution Path Elimination

Phase 1A gated the two known legacy runners (`app/api/migrate/route.ts` and
`app/api/admin/system-tools/route.ts`). Phase 1A.1 identified a third ungated
path: `app/api/admin/prospects/seed/route.ts`, which executed direct SQL to seed
prospect data, bypassing the governance framework entirely.

This route is now gated behind the `MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED`
feature flag (default: disabled). When disabled, the route emits a
`migration.legacy.invoked` audit event and returns HTTP 423 Locked with a
deprecation notice directing the user to the canonical path
(`/api/admin/migrations`). The gate is placed AFTER `requireAdminApi` so the
actor ID is available for the audit event. The file is NOT deleted (per the
Phase 1A principle: restrict/wrap, don't delete unless demonstrably safe).

A full audit of the codebase confirmed no other ungated migration execution
paths exist and no non-canonical ledger writes occur outside the canonical
functions.

### 16.9 Persistent Audit Integration

Phase 1A emitted migration audit events as console JSON only. Phase 1A.1
enhances `emitAuditEvent()` to persist durably to the `audit_log` table via
`writeAuditLog()` (the existing hash-chained audit logging system) in addition
to the console JSON emission. The persistence is fire-and-forget (`.catch(() =>
{})`) so a database failure does not break migration execution, but the durable
record is attempted on every event.

A `MIGRATION_EVENT_TO_AUDIT_ACTION` mapping table maps every
`MigrationAuditEventType` to a corresponding `AuditAction` value. The
`AuditCategory` union in `auditLog.ts` now includes `'migration'`, and 24
migration-specific `AuditAction` values were added. The `persistMigrationAuditEvent()`
function calls `writeAuditLog` with the mapped action, category `'migration'`,
and structured metadata.

### 16.10 Automated Actor Controls

The `migration-actor` (automated execution identity) cannot be client-selected.
The actor type is determined server-side: if the request includes a valid
service token, the actor is `migration-actor`; otherwise, it is the
authenticated human user. A client cannot spoof the actor type by submitting it
in the request body. The automated actor is exempt from TOTP but still subject
to the environment allowlist, production flag, and execution gate.

### 16.11 Phase 1A.1 Test Expansion

The test suite was expanded from 114 tests to 185 tests (71 new tests across 7
new sections):

| Test Section | Tests | Coverage |
|--------------|-------|----------|
| Section 10b: Non-Canonical Execution Path Elimination | 7 | prospects/seed gating, audit event, canonical path direction, auth-before-gate ordering, file existence, all-paths-gated, no-non-canonical-ledger-writes |
| Section 13: Persistent Audit Integration | 10 | migration AuditCategory, AuditAction values, writeAuditLog import, mapping table, persistMigrationAuditEvent, fire-and-forget pattern, error codes, errorCode propagation, mapping completeness, transaction mode audit details |
| Section 14: Governance Lifecycle & Historical Baseline | 14 | 6 lifecycle states, governance_lifecycle DDL, set/get functions, audit events, 5 baseline statuses, migration_baseline DDL, baseline functions, execution gate |
| Section 15: Transaction Mode Detection | 14 | TransactionMode type, detect functions, all 7 incompatible patterns, manifest integration |
| Section 16: Lock Key Exactness | 7 | decimal string constant, exact value, hex value, BIGINT cast, bounded lock, FORBIDDEN mode session lock |
| Section 17: Append-Only Run History & Ledger Constraints | 13 | schema_migration_runs DDL, status CHECK, identifier CHECK, checksum CHECK, actor_type CHECK, indexes, INSERT-only invariant, schema_migrations constraints, migration_totp_uses table, use_hash (not code), recordTotpUse ON CONFLICT, isTotpTimeStepUsed, bootstrap→BASELINE_REQUIRED |

### 16.12 Phase 1A.1 Verification

**Command:** `npx tsc --noEmit`
**Result:** exit 0, no errors

**Command:** `npx vitest run tests/phase1a-migration-governance.test.ts`
**Result:** 185 passed, 0 failed

**Command:** `npx vitest run` (full test suite)
**Result:** 6,863 passed, 1 failed (1 pre-existing failure in
`tests/golden-path.test.ts` — SLD Pipeline combiner fields, confirmed
pre-existing before any Phase 1A.1 changes, unrelated to migration governance)

### 16.13 Phase 1A.1 Commits

| Commit | Hash | Description |
|--------|------|-------------|
| 1 | `1fbd6fac` | docs: Phase 1A.1 operational hardening audit |
| 2 | `4f8f4b0c` | feat: ledger lifecycle, constraints, append-only history |
| 3 | `72ccbeb2` | feat: historical baseline enforcement and execution blocking |
| 4 | `d218d6c8` | feat: lock exactness, bounded timeout, transaction compatibility |
| 5 | `5af104af` | feat: MFA fail-closed, replay prevention, automated actor controls |
| 6 | `bed382f4` | feat: eliminate non-canonical execution paths |
| 7 | `5849cbde` | feat: persistent audit integration and transaction failure recording |
| 8 | `c2648aec` | test: expanded tests for Phase 1A.1 governance hardening |
| 9 | `75260e18` | docs: Phase 1A.1 documentation and final report |

See `docs/phase1a/PHASE1A1-FINAL-REPORT.md` for the complete Phase 1A.1 final
report, `docs/phase1a/PHASE1A1-OPERATIONAL-HARDENING-AUDIT.md` for the
pre-implementation exact-state audit, `docs/phase1a/PHASE1A1-HISTORICAL-BASELINE-MODEL.md`
for the historical baseline model, and `docs/phase1a/PHASE1A1-SQL-COMPATIBILITY-REPORT.md`
for the SQL compatibility and lock key analysis.

---

## 17. Remaining Blockers

MIGRATION-GOV-01 is resolved. The migration governance foundation is established. The remaining blockers for the enterprise authority initiative are:

1. **Phase 1 foundation implementation (Gates 1–12):** Canonical organization table, organization members junction, organization roles namespace, active org context, extended session/user object, authorization interface, org-scoped query helper, audit log org context, tenant-aware audit query API, dev auth bypass audit, impersonation hardening. These are NOT part of Phase 1A — they are the core Phase 1 implementation work.

2. **Later program phases (Gates 13–15):** Legacy ownership backfill script (dry-run), ambiguity queue admin API, full program entry gate verification. These belong to later program phases.

3. **Raymond's approval for Phase 1 to Phase 2 transition:** Required before NEXT_ENTERPRISE_AUTHORITY_MIGRATION can be assigned and executed.

4. **Production database state verification:** The applied-migration state of the production database has not been inspected. The governance system is ready to record migrations, but the historical applied state has not been reconciled into the ledger. This reconciliation is a separate operational task that requires database access and is NOT part of Phase 1A code implementation.

---

## 18. Gate Language Correction

A documentation correction was applied regarding the interpretation of the 15 implementation gates from ADR-014. The 15 gates are the FULL program sequence — they describe the complete work from Phase 1 foundation through final validation. They are NOT all prerequisites to beginning Phase 1.

Phase 1 entry gates (Gates A through I in the Entry Gates document) are the prerequisites to beginning Phase 1 implementation. These entry gates are satisfied. The 15 program gates are the implementation milestones that are passed AS Phase 1 (and later phases) progress. Phase 1 is foundation-only (Gates 1–12); Gates 13–15 belong to later program phases.

The corrected language clarifies that Phase 1 implementation can begin (and has begun with Phase 1A) once the entry gates are satisfied, and that the 15 program gates are passed progressively through the implementation work, not all required before starting.

---

## 19. Cross-References

| Reference | Document |
|-----------|----------|
| Audit | `docs/phase1a/AUDIT-MIGRATION-SYSTEM.md` |
| Architecture Decision | `docs/phase1a/ARCHITECTURE-DECISION-MIGRATION-MODEL.md` |
| Migration Sequence State | `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-MIGRATION-SEQUENCE-STATE.md` |
| Phase 1 Entry Gates | `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-PHASE1-ENTRY-GATES.md` |
| Phase 1 Implementation Spec | `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-PHASE1-IMPLEMENTATION-SPEC.md` |
| Architecture Decision Records | `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-ARCHITECTURE-DECISION-RECORDS.md` |

---

**Document Footer**

**Phase:** 1A — Migration Governance Foundation
**Risk Resolved:** MIGRATION-GOV-01
**Starting HEAD:** `d7b8e400`
**Migration 105 Status:** NOT created, NOT authorized (informational only)
**NEXT_ENTERPRISE_AUTHORITY_MIGRATION:** Unassigned (placeholder — Phase 2)
**schema_migrations Ledger:** Implemented (bootstrap DDL ready, not yet applied to any database)
**Advisory Lock:** `pg_advisory_xact_lock` with fixed key `0x534f4c504d474452`
**Legacy Runners:** Restricted (feature flags, default disabled, NOT deleted)
**Tests:** 114 passed, 0 failed
**TypeScript:** `tsc --noEmit` exit 0
**MFA Phase 3:** Untouched (frozen/closed)
