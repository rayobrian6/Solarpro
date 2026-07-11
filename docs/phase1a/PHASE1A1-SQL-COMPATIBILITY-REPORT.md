# Phase 1A.1 — SQL Transaction Compatibility Report

> **Document status:** Authoritative report on transaction compatibility of all
> migration SQL files in the SolarPro repository.
> **Scope:** Operational hardening of migration governance ONLY.
> **Branch:** `dev`. **Commit:** Phase 1A.1, Commit 4.
> **Scan date:** Phase 1A.1 implementation.

## 1. Purpose

PostgreSQL enforces strict rules about which statements can and cannot run
inside a transaction block. The most common transaction-incompatible
statements in migration files are:

- `CREATE INDEX CONCURRENTLY` — cannot run inside a transaction block
- `REINDEX CONCURRENTLY` — cannot run inside a transaction block
- `VACUUM` — cannot run inside a transaction block
- `ALTER TYPE ... ADD VALUE` — cannot run inside a transaction block (PG < 12)
- `CREATE DATABASE` / `DROP DATABASE` — cannot run inside a transaction block
- `CREATE TABLESPACE` — cannot run inside a transaction block

If a migration file containing any of these statements is executed inside a
single transaction (as the Phase 1A runner does by default), PostgreSQL will
reject the statement with an error like:
`ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`.

The Phase 1A.1 migration governance system now detects these statements at
manifest discovery time and classifies each migration file with a
`TransactionMode`:

- `REQUIRED` — All statements are transaction-compatible. Execute inside a
  transaction (all-or-nothing rollback on failure).
- `FORBIDDEN` — Contains transaction-incompatible statements. Execute outside
  a transaction, statement by statement.
- `MANUAL_REVIEW` — Compatibility cannot be automatically determined. Do not
  execute; require manual review.

This report documents the scan of all 101 migration SQL files in
`lib/migrations/`.

## 2. Scan Methodology

The scan was performed using the `detectTransactionMode()` function in
`lib/migrations/validation.ts`. This function tests the SQL content of each
file against a set of regular expression patterns for known
transaction-incompatible statements:

| Pattern | Label | Reason |
|---------|-------|--------|
| `CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY` | CREATE INDEX CONCURRENTLY | Cannot run inside a transaction block |
| `REINDEX\s+(?:\w+\s+)*CONCURRENTLY` | REINDEX CONCURRENTLY | Cannot run inside a transaction block |
| `VACUUM` | VACUUM | Cannot run inside a transaction block |
| `ALTER\s+TYPE.*ADD\s+VALUE` | ALTER TYPE ADD VALUE | Cannot run inside a transaction block (PG < 12) |
| `CREATE\s+DATABASE` | CREATE DATABASE | Cannot run inside a transaction block |
| `CREATE\s+TABLESPACE` | CREATE TABLESPACE | Cannot run inside a transaction block |
| `DROP\s+DATABASE` | DROP DATABASE | Cannot run inside a transaction block |

The scan was also manually verified using `grep` to cross-check the automated
results.

## 3. Scan Results

### 3.1 Summary

| Metric | Count |
|--------|-------|
| Total migration SQL files scanned | 101 |
| Files classified as `REQUIRED` (transaction-compatible) | 98 |
| Files classified as `FORBIDDEN` (transaction-incompatible) | 3 |
| Files classified as `MANUAL_REVIEW` | 0 |
| Total `CREATE INDEX CONCURRENTLY` statements found | 9 |
| Total `REINDEX CONCURRENTLY` statements found | 0 |
| Total `VACUUM` statements found | 0 |
| Total `ALTER TYPE ADD VALUE` statements found | 0 |
| Total `CREATE DATABASE` statements found | 0 |
| Total `CREATE TABLESPACE` statements found | 0 |
| Total `DROP DATABASE` statements found | 0 |

### 3.2 Files Classified as FORBIDDEN (3 files)

These three files contain `CREATE INDEX CONCURRENTLY` statements and must be
executed outside a transaction block.

#### 017_perf_indexes.sql

| Line | Statement |
|------|-----------|
| 10 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_versions_project_user_version` |
| 15 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_versions_project_created` |
| 21 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_layouts_project_user_updated` |
| 26 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_project_user_created` |

**Incompatible statement count:** 4
**Transaction mode:** `FORBIDDEN`

#### 019_query_perf_indexes.sql

| Line | Statement |
|------|-----------|
| 37 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_user_active_updated` |
| 47 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_productions_project_calc` |
| 52 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_user_active_created` |

**Incompatible statement count:** 3 (one additional match is a comment on
line 29: "All three indexes are CONCURRENTLY-safe" — this is a comment, not an
executable statement, but the pattern matches it. The actual executable
CONCURRENTLY statements are 3.)

**Transaction mode:** `FORBIDDEN`

#### 020_digital_signatures.sql

| Line | Statement |
|------|-----------|
| 20 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_signed_at` |
| 25 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_user_status` |

**Incompatible statement count:** 2
**Transaction mode:** `FORBIDDEN`

### 3.3 Files Classified as REQUIRED (98 files)

All remaining 98 migration files (001 through 104, excluding 017, 019, 020)
contain only transaction-compatible DDL statements. These files are safe to
execute inside a single transaction with all-or-nothing rollback semantics.

### 3.4 Reserved Gaps

The manifest contains reserved gaps at prefixes 009, 012, 013, and 014. These
are not files — they are prefixes with no corresponding migration file. They
do not affect the transaction compatibility scan.

### 3.5 Duplicate Prefix 074

Files `074a` and `074b` (duplicate prefix 074) were both scanned. Neither
contains transaction-incompatible statements. Both are classified as
`REQUIRED`.

## 4. Execution Behavior by Transaction Mode

### 4.1 REQUIRED Mode (default)

The runner executes the migration inside a single Neon transaction:

```sql
BEGIN;
SELECT pg_try_advisory_xact_lock(6003100736085771346::bigint);
-- migration statements...
COMMIT;
```

If any statement fails, the entire transaction rolls back. The advisory lock
is released on commit or rollback (transaction-scoped).

### 4.2 FORBIDDEN Mode

The runner acquires a session-level advisory lock and executes each statement
individually (no transaction wrapper):

```sql
SELECT pg_try_advisory_lock(6003100736085771346::bigint);
-- statement 1 (committed immediately)
-- statement 2 (committed immediately)
-- ...
SELECT pg_advisory_unlock(6003100736085771346::bigint);
```

**Important consequence:** If a statement fails midway through a FORBIDDEN
migration, the prior statements are already committed. There is no
transactional rollback. This is inherent to `CREATE INDEX CONCURRENTLY` and
other transaction-incompatible statements — they cannot be rolled back because
they are not in a transaction. The runner stops execution on the first failure
and records the failure in the ledger, but the partially-applied state is
permanent.

This is acceptable for index creation migrations because:
1. `CREATE INDEX CONCURRENTLY IF NOT EXISTS` is idempotent — re-running a
   partially-applied migration will skip already-created indexes.
2. Index creation is non-destructive — a failed index build does not corrupt
   existing data.
3. The ledger records the failure, and the operator can re-run the migration
   after fixing the underlying issue.

### 4.3 MANUAL_REVIEW Mode

The runner does not execute the migration. It returns an error directing the
operator to review the file's transaction compatibility manually. An audit
event `migration.transaction_mode.review_required` is emitted.

No files are currently classified as `MANUAL_REVIEW`. This mode is reserved
for future cases where automatic detection cannot make a confident
determination.

## 5. Lock Key Precision (MIGRATION-GOV-06)

The advisory lock key `0x534f4c504d474452` (ASCII "SOLPMGDR") equals the
decimal value `6003100736085771346`. This value exceeds
`Number.MAX_SAFE_INTEGER` (2^53 - 1 = 9007199254740991), which means it
cannot be represented exactly as a JavaScript number.

When passed as a JavaScript number to the Neon driver, the value is rounded
to `6003100736085771000` — a loss of 346 in the least significant digits.
This means the lock key used by the application would not match the intended
key, potentially causing lock collisions with other advisory lock users or
failing to provide the intended mutual exclusion.

**Fix:** The lock key is now passed as a decimal string
(`'6003100736085771346'`) and cast to `BIGINT` in PostgreSQL:

```sql
SELECT pg_try_advisory_xact_lock('6003100736085771346'::bigint)
```

This preserves the exact 64-bit value. The constant
`MIGRATION_LOCK_KEY_DECIMAL = '6003100736085771346'` is defined in
`lib/migrations/types.ts` and used in both the bootstrap (ledger.ts) and the
execution path (runner.ts).

## 6. Lock Timeout Behavior (MIGRATION-GOV-06)

### 6.1 Previous Behavior (Phase 1A)

Phase 1A used `pg_advisory_xact_lock(key)`, which blocks indefinitely if the
lock is held by another process. If two migration runners attempted to
execute concurrently, the second would hang forever waiting for the lock,
with no timeout and no way to detect the deadlock.

### 6.2 Current Behavior (Phase 1A.1)

Phase 1A.1 uses `pg_try_advisory_xact_lock(key)`, which returns `true` if the
lock was acquired and `false` if it was not (without blocking). This provides
bounded behavior: the runner either acquires the lock immediately or gets a
`false` result that it can handle as a lock-denied error.

For the `FORBIDDEN` transaction mode (statement-by-statement execution), the
runner uses `pg_try_advisory_lock(key)` (session-scoped) with the same
bounded behavior, and explicitly releases it with `pg_advisory_unlock(key)`
after execution.

### 6.3 Session vs. Transaction-Scoped Locks

- **Transaction-scoped** (`pg_try_advisory_xact_lock`): The lock is
  automatically released when the transaction commits or rolls back. Used for
  `REQUIRED` mode migrations (inside a transaction).
- **Session-scoped** (`pg_try_advisory_lock`): The lock is held until
  explicitly released with `pg_advisory_unlock` or the session ends. Used for
  `FORBIDDEN` mode migrations (outside a transaction, statement by statement).

## 7. Transaction Failure Recording (MIGRATION-GOV-03)

The append-only run history ensures that a migration failure is always
recorded, even if the transaction rolls back:

1. **Before execution:** `markMigrationRunning()` inserts a `'started'` row
   into `schema_migration_runs` (append-only history) and upserts the
   current-state row in `schema_migrations` to `running` status. The
   `'started'` history row is committed immediately — it is NOT inside the
   migration execution transaction.

2. **During execution:** The migration SQL runs inside a transaction
   (REQUIRED mode) or statement by statement (FORBIDDEN mode).

3. **After execution (success):** `recordMigrationResult()` inserts an
   `'applied'` row into `schema_migration_runs` and updates the current-state
   row to `applied`.

4. **After execution (failure):** `recordMigrationResult()` inserts a
   `'failed'` row into `schema_migration_runs` (with error code and summary)
   and updates the current-state row to `failed`. This insertion happens
   OUTSIDE the rolled-back migration transaction, so it persists even though
   the migration's DDL was rolled back.

The key insight is that the `'started'` and `'failed'` history rows are
inserted in separate transactions from the migration execution itself. If the
migration transaction rolls back, the history rows are NOT rolled back — they
were already committed. This ensures a durable record of every attempt,
including crashed or failed ones.

## 8. Verification

The scan results in this report were verified by:

1. **Automated scan:** Running `detectTransactionMode()` on all 101 files via
   the manifest discovery function.
2. **Manual grep verification:**
   ```bash
   grep -rln "CONCURRENTLY" lib/migrations/*.sql
   # Result: 017_perf_indexes.sql, 019_query_perf_indexes.sql, 020_digital_signatures.sql

   grep -rln "VACUUM" lib/migrations/*.sql
   # Result: (none)

   grep -rln "REINDEX" lib/migrations/*.sql
   # Result: (none)

   grep -rln "ALTER TYPE.*ADD VALUE" lib/migrations/*.sql
   # Result: (none)
   ```
3. **TypeScript compilation:** `npx tsc --noEmit` — clean (exit 0).
4. **Test suite:** `npx vitest run tests/phase1a-migration-governance.test.ts`
   — 114/114 pass.

## 9. No Historical Files Modified

No migration SQL files were created, modified, or deleted during this scan.
The transaction compatibility detection is a read-only analysis performed at
manifest discovery time. The migration files themselves are unchanged.

This is a critical scope boundary: Phase 1A.1 does not create or modify any
numbered SQL migration file. The `transactionMode` field is computed at
runtime from the file content, not stored in the file.
