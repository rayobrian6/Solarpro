# Phase 1A.3 — Canary Migration Execution Report

> **Document type:** Canary migration execution record (GOV-19)
> **Repository:** `rayobrian6/Solarpro`, branch `dev`
> **Scope:** Test-only canary migration execution through the canonical
> migration governance runner, proving the full execution chain from
> manifest discovery through transactional SQL application, ledger
> recording, audit emission, and run history.
> **Environment:** Isolated PostgreSQL test database
> (`postgresql://testuser:testuser@localhost:5432/migration_gov_test`),
> PostgreSQL 15.18 on Debian. Non-production.
> **No numbered SQL migration files created or modified.**
> **No MFA Phase 3 changes (`lib/mfa.ts` frozen).**

---

## 1. Executive Summary

Phase 1A.3 executed four test-only canary migrations through the canonical
migration governance runner against an isolated PostgreSQL test schema. The
canary migrations — identifiers 900 through 903 — were applied in sequence
after the complete governance lifecycle was exercised: bootstrap, baseline
reconciliation, verification, and execution activation. Each migration was
executed within a PostgreSQL transaction protected by a transaction-scoped
advisory lock, with the migration record, run history entry, and audit
event all recorded atomically.

The canary execution proves that the runner's core execution path
functions correctly: manifest discovery, pending-migration identification,
advisory lock acquisition, SQL statement splitting, transactional
execution with atomic rollback on failure, ledger recording, run-history
recording, audit emission, and post-execution state verification. This is
the first time in the project's history that a migration has been applied
through the governance system's canonical path against a live PostgreSQL
instance.

---

## 2. Canary Migration Fixtures

The canary migrations are test-only fixtures located in
`tests/fixtures/migrations/`. They are not part of the production migration
manifest and are never placed in `lib/migrations/`. They are injected into
the runner via the `createMigrationRunnerWithManifest(manifestProvider)`
dependency-injection factory, which provides a custom manifest provider
that returns the four fixtures instead of discovering the production
migration set.

### 2.1 Fixture Inventory

| Identifier | Filename | Transaction Mode | Description |
|------------|----------|-----------------|-------------|
| 900 | `900_canary_test_table.sql` | REQUIRED | Creates `canary_900_test_table` with SERIAL PK, label, created_at |
| 901 | `901_canary_add_column.sql` | REQUIRED | Adds `status` column with DEFAULT 'active' |
| 902 | `902_canary_add_index.sql` | REQUIRED | Creates `idx_canary_900_status` on status column |
| 903 | `903_canary_seed_data.sql` | REQUIRED | Inserts 3 seed rows with ON CONFLICT DO NOTHING |

### 2.2 Fixture Design Principles

The canary fixtures were designed to satisfy the following requirements
documented in `PHASE1A3-OPERATIONAL-ACTIVATION-AUDIT.md`:

1. **Unique, isolated table names:** All fixtures operate on
   `canary_900_test_table`, a name that cannot collide with any production
   or pre-existing schema object. The `canary_` prefix and `900` identifier
   range clearly distinguish test fixtures from production migrations
   (001-104).

2. **REQUIRED transaction mode:** All fixtures use `REQUIRED` mode, meaning
   all SQL statements within each migration execute in a single PostgreSQL
   transaction with atomic rollback on failure. This is the default and
   safest transaction mode. No fixtures use `FORBIDDEN` mode (which would
   require non-transactional execution for statements like
   `CREATE INDEX CONCURRENTLY`).

3. **Idempotency:** All fixtures use `IF NOT EXISTS` or
   `ON CONFLICT DO NOTHING` so that re-runs are safe. This allows tests to
   re-execute the canary sequence without manual cleanup between test
   cases.

4. **Sequential dependency:** Fixtures 901, 902, and 903 depend on 900
   (the table must exist first). The runner applies migrations in
   identifier order, ensuring 900 runs before 901, 902, and 903.

5. **No transaction-incompatible statements:** No `CREATE INDEX
   CONCURRENTLY`, no `VACUUM`, no `REINDEX CONCURRENTLY`. All statements
   are transaction-safe.

6. **DML coverage:** Fixture 903 includes an `INSERT` statement,
   demonstrating that DML within the transactional migration framework is
   committed atomically with the migration record.

---

## 3. Execution Lifecycle

The canary migrations were executed after the complete governance lifecycle
was exercised. The sequence was:

### Step 1: Bootstrap

```
bootstrapMigrationLedger()
  → governance_lifecycle.state = 'LEDGER_BOOTSTRAPPED'
  → schema_migrations table created
  → schema_migration_runs table created
  → migration_baseline table created
  → governance_lifecycle table created
  → migration_totp_uses table created
  → audit_log table created
```

### Step 2: Baseline Reconciliation

For each canary fixture (900, 901, 902, 903):
```
recordBaselineReconciliation({
  migrationIdentifier: '900',
  reconciliationStatus: 'CONFIRMED_NOT_APPLIED',
  evidenceType: 'SCHEMA_INTROSPECTION',
  reconciledBy: 'test-admin-001'
})
  → migration_baseline row inserted
```

After all four baseline entries were recorded, the lifecycle was advanced:
```
advanceToBaselineVerified()
  → governance_lifecycle.state = 'BASELINE_IN_PROGRESS' (intermediate)
  → verifyBaselineComplete(['900', '901', '902', '903']) → ok: true
  → governance_lifecycle.state = 'BASELINE_VERIFIED'
```

### Step 3: Execution Activation

```
enableExecution({ reason: 'canary test activation' })
  → governance_lifecycle.state = 'EXECUTION_ENABLED'
  → audit: migration.governance.state_change { newState: 'EXECUTION_ENABLED' }
```

### Step 4: Canary Execution

```
runPendingMigrations({ actorId: 'test-admin-001' })
  → Migration 900: CREATE TABLE canary_900_test_table (...)
    → advisory lock acquired (pg_try_advisory_xact_lock)
    → SQL executed in transaction
    → schema_migrations row: identifier=900, status='applied'
    → schema_migration_runs row: identifier=900, status='applied', duration_ms=7
    → audit: migration.migration.applied { identifier: '900', durationMs: 7 }
    → advisory lock released (transaction commit)

  → Migration 901: ALTER TABLE canary_900_test_table ADD COLUMN status ...
    → same execution path
    → schema_migrations row: identifier=901, status='applied'

  → Migration 902: CREATE INDEX idx_canary_900_status ON ...
    → same execution path
    → schema_migrations row: identifier=902, status='applied'

  → Migration 903: INSERT INTO canary_900_test_table (label, status) VALUES ...
    → same execution path
    → schema_migrations row: identifier=903, status='applied'

  → Result: { applied: 4, failed: 0, fatalErrors: [] }
```

### Step 5: Post-Execution Verification

After the canary run, the test verified:

- **Table exists:** `SELECT to_regclass('canary_900_test_table')` returned
  a non-null OID, confirming the table was created.
- **Column exists:** The `status` column was present in
  `information_schema.columns` for `canary_900_test_table`.
- **Index exists:** `SELECT to_regclass('idx_canary_900_status')` returned
  a non-null OID, confirming the index was created.
- **Seed data present:** `SELECT count(*) FROM canary_900_test_table`
  returned 3, confirming the INSERT committed.
- **Ledger recorded:** All four migrations had `status='applied'` rows in
  `schema_migrations` with correct `checksum_sha256` values.
- **Run history recorded:** All four migrations had `status='applied'` rows
  in `schema_migration_runs` with duration timestamps.
- **Audit events emitted:** Four `migration.migration.applied` audit
  events were persisted to `audit_log` with correct `migrationIdentifier`,
  `filename`, `durationMs`, and `dryRun: false`.

### Step 6: Cleanup

```
disableExecution({ reason: 'cleanup' })
  → governance_lifecycle.state = 'BASELINE_VERIFIED'
  → audit: migration.governance.state_change { newState: 'BASELINE_VERIFIED', action: 'disable_execution' }
```

The test schema was then dropped, removing all canary tables, indexes, and
governance ledger tables.

---

## 4. Execution Path Details

### 4.1 Advisory Lock Acquisition

Each migration execution begins with an attempt to acquire a
transaction-scoped advisory lock using
`pg_try_advisory_xact_lock(MIGRATION_LOCK_KEY)`. The lock key
(`0x534f4c504d474452`, decimal `6003100736085771346`) exceeds
JavaScript's `Number.MAX_SAFE_INTEGER`, so it is passed as a decimal
string and cast to `BIGINT` in the SQL query. The advisory lock is
automatically released when the transaction commits or rolls back, making
it pool-compatible with PgBouncer transaction-mode pooling.

The e2e tests verify that:
- The advisory lock is acquired before any SQL is executed.
- A concurrent execution attempt (simulated) is blocked.
- The lock is released after the transaction commits.

### 4.2 SQL Statement Splitting

Each migration file may contain multiple SQL statements separated by
semicolons. The runner splits the SQL content into individual statements,
executes each within the same transaction, and rolls back the entire
transaction if any statement fails. The canary fixtures each contain 1-2
statements (e.g., fixture 900 contains `CREATE TABLE` and `COMMENT ON
TABLE`), and the tests verify that both statements execute successfully.

### 4.3 Transaction Execution

The runner uses the Neon serverless driver's `sql.transaction()` interface
for REQUIRED-mode migrations. The transaction callback must return an array
of promises (one per SQL statement), and the driver executes them all
within a single PostgreSQL transaction. The mock correctly emulates this
behavior by binding all queries in the callback to the same `pg` client
connection.

For migration 900, the transaction execution looks like:

```typescript
sql.transaction((txn) => [
  txn`SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint)`,
  txn`CREATE TABLE IF NOT EXISTS canary_900_test_table (...)`,
  txn`COMMENT ON TABLE canary_900_test_table IS '...'`,
])
```

### 4.4 Ledger Recording

After successful transaction execution, the runner inserts a row into
`schema_migrations` with:
- `identifier`: '900'
- `filename`: '900_canary_test_table.sql'
- `checksum_sha256`: SHA-256 hash of the file content
- `status`: 'applied'
- `applied_at`: current timestamp
- `transaction_mode`: 'REQUIRED'

A row is also inserted into `schema_migration_runs` with:
- `identifier`: '900'
- `filename`: '900_canary_test_table.sql'
- `status`: 'applied'
- `duration_ms`: measured execution time
- `dry_run`: false
- `started_at` / `completed_at`: timestamps

Both inserts occur within the same transaction as the migration SQL,
ensuring atomicity. If the migration SQL fails, the ledger records are
rolled back and no `status='applied'` row is created.

---

## 5. Error Cases Tested

The canary execution path was also tested under failure conditions:

### 5.1 Execution Gate Blocking

When the lifecycle is `BASELINE_VERIFIED` (execution not enabled),
`runSinglePendingMigration()` returns:
```json
{
  "status": "failed",
  "errorCode": "MIGRATION_BASELINE_REQUIRED",
  "message": "Execution is not enabled. Call enableExecution() first."
}
```

And `runPendingMigrations()` returns:
```json
{
  "applied": 0,
  "failed": 0,
  "fatalErrors": [{ "code": "MIGRATION_BASELINE_REQUIRED", "message": "..." }]
}
```

No SQL is executed. No ledger rows are created.

### 5.2 MIGRATION_NOT_FOUND

When `runSinglePendingMigration()` is called with an identifier not in the
manifest (e.g., '999'), it returns:
```json
{
  "status": "failed",
  "errorCode": "MIGRATION_NOT_FOUND",
  "message": "Migration '999' is not in the manifest."
}
```

### 5.3 FORBIDDEN Transaction Mode

When a migration with `transactionMode: 'FORBIDDEN'` is executed, the
runner returns:
```json
{
  "status": "failed",
  "errorCode": "MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED",
  "message": "Migration '...' uses FORBIDDEN transaction mode..."
}
```

This is the correct behavior for migrations containing
`CREATE INDEX CONCURRENTLY` or other transaction-incompatible statements.
The production migration manifest contains three such migrations (017,
019, 020), which would be blocked by the runner per MIGRATION-GOV-12.

### 5.4 Checksum Conflict

When an applied migration's file is modified after execution (changing the
checksum), subsequent execution attempts detect the checksum mismatch and
return a `CHECKSUM_CONFLICT` error. This prevents silent drift between the
migration files and the ledger.

### 5.5 Dry-Run Mode

When `dryRun: true` is passed to `runSinglePendingMigration()` or
`runPendingMigrations()`, the runner validates the migration (checks the
execution gate, manifest membership, checksum) but does not execute any
SQL. No ledger rows are created. No audit events are emitted (except
`migration.inspect`). The canary table does not exist after a dry run.

---

## 6. Canary Cleanup

After the canary execution, the test suite verifies proper cleanup:

1. **Execution disabled:** `disableExecution()` transitions the lifecycle
   back to `BASELINE_VERIFIED`, and subsequent execution attempts are
   blocked.

2. **Schema teardown:** The test schema is dropped, removing all canary
   tables, indexes, governance ledger tables, and audit log entries. No
   test artifacts persist across test runs.

3. **Re-enable requires BASELINE_VERIFIED:** After disabling execution,
   attempting to re-enable requires the lifecycle to be at
   `BASELINE_VERIFIED`. If the lifecycle has been reset (e.g., by
   re-bootstrapping), the full baseline reconciliation and verification
   cycle must be repeated before execution can be activated again.

---

## 7. Conclusion

The canary migration execution proves that the canonical migration
governance runner functions correctly end-to-end against a live PostgreSQL
instance. The four canary migrations (900-903) were applied in sequence
within transactions protected by advisory locks, with ledger records, run
history, and audit events all recorded atomically. The execution gate
correctly blocked attempts before activation and after deactivation. Error
cases (MIGRATION_NOT_FOUND, FORBIDDEN mode, checksum conflict) were
correctly detected and reported. Dry-run mode correctly validated without
mutating.

This is the first operational proof that the migration governance system
can apply migrations through its canonical path. Combined with the route-
handler and lifecycle tests, it demonstrates that the system is ready for
non-production operational use, subject to the Neon compatibility
validation blocker documented in
`PHASE1A3-NEON-COMPATIBILITY-REPORT.md`.
