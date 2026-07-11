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

## 16. Remaining Blockers

MIGRATION-GOV-01 is resolved. The migration governance foundation is established. The remaining blockers for the enterprise authority initiative are:

1. **Phase 1 foundation implementation (Gates 1–12):** Canonical organization table, organization members junction, organization roles namespace, active org context, extended session/user object, authorization interface, org-scoped query helper, audit log org context, tenant-aware audit query API, dev auth bypass audit, impersonation hardening. These are NOT part of Phase 1A — they are the core Phase 1 implementation work.

2. **Later program phases (Gates 13–15):** Legacy ownership backfill script (dry-run), ambiguity queue admin API, full program entry gate verification. These belong to later program phases.

3. **Raymond's approval for Phase 1 to Phase 2 transition:** Required before NEXT_ENTERPRISE_AUTHORITY_MIGRATION can be assigned and executed.

4. **Production database state verification:** The applied-migration state of the production database has not been inspected. The governance system is ready to record migrations, but the historical applied state has not been reconciled into the ledger. This reconciliation is a separate operational task that requires database access and is NOT part of Phase 1A code implementation.

---

## 17. Gate Language Correction

A documentation correction was applied regarding the interpretation of the 15 implementation gates from ADR-014. The 15 gates are the FULL program sequence — they describe the complete work from Phase 1 foundation through final validation. They are NOT all prerequisites to beginning Phase 1.

Phase 1 entry gates (Gates A through I in the Entry Gates document) are the prerequisites to beginning Phase 1 implementation. These entry gates are satisfied. The 15 program gates are the implementation milestones that are passed AS Phase 1 (and later phases) progress. Phase 1 is foundation-only (Gates 1–12); Gates 13–15 belong to later program phases.

The corrected language clarifies that Phase 1 implementation can begin (and has begun with Phase 1A) once the entry gates are satisfied, and that the 15 program gates are passed progressively through the implementation work, not all required before starting.

---

## 18. Cross-References

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
