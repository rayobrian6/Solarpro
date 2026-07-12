# Phase 1A.2 — PostgreSQL Integration Validation (MIGRATION-GOV-15)

> **Document type:** Integration test specification and validation report
> **Repository:** `rayobrian6/Solarpro`, branch `dev`
> **Commits:** `611586a5` (Commit 6), `6268b71a` (Commit 7)
> **Scope:** Real PostgreSQL integration harness for migration governance DDL
> **Related issue:** MIGRATION-GOV-15 (governance behavior lacks real PostgreSQL integration proof)

---

## 1. Purpose

Phase 1A and Phase 1A.1 established a five-table migration governance ledger
with CHECK constraints, UNIQUE constraints, indexes, and advisory locking.
However, all governance tests were source-scanning tests that verify the
presence of code patterns, SQL strings, and function signatures by reading
source files. There were no tests that actually executed the bootstrap DDL
against a real PostgreSQL database and verified that the constraints enforce
the intended behavior.

MIGRATION-GOV-15 identified this gap: the governance behavior lacked real
PostgreSQL integration proof. The CHECK constraints, UNIQUE constraints,
advisory locks, and transaction semantics could only be trusted if they were
exercised against a real database engine.

Phase 1A.2 closes this gap with a dedicated PostgreSQL integration test
harness (`tests/phase1a2-postgres-integration.test.ts`) that executes the
actual `BOOTSTRAP_LEDGER_DDL` against a real PostgreSQL 15 database and
verifies the constraint behavior through 55 integration tests.

---

## 2. Test Harness Design

### Environment

The integration tests connect to a PostgreSQL database via the
`TEST_DATABASE_URL` environment variable:

```
TEST_DATABASE_URL=postgresql://testuser:testpass@localhost:5432/migration_gov_test
```

When `TEST_DATABASE_URL` is not set, the entire integration suite is skipped
gracefully using `describe.skip`:

```typescript
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;
```

This ensures the test suite passes in environments without a PostgreSQL
database (such as CI without a database service) while running the full
integration tests when a database is available.

An always-run informational test (outside the `describeOrSkip` block) logs
whether the integration tests ran or were skipped, providing visibility in
test output regardless of environment.

### Test Schema Isolation

Each test run creates a unique test schema (`phase1a2_intg_test`) to avoid
interference between runs or with other test suites:

```typescript
beforeEach(async () => {
  const client = await pool.connect();
  try {
    await execSQL(client, `DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await execSQL(client, `CREATE SCHEMA ${TEST_SCHEMA}`);
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
    // Execute the actual BOOTSTRAP_LEDGER_DDL statement-by-statement
    const statements = BOOTSTRAP_LEDGER_DDL.split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const stmt of statements) {
      await client.query(stmt);
    }
  } finally {
    client.release();
  }
});
```

The DDL is split on `;` and executed statement-by-statement. This mirrors
how the bootstrap function would execute the DDL in production.

### Connection Management

The harness uses a `pg.Pool` for connection management:

```typescript
let pool: Pool | null = null;

beforeAll(async () => {
  if (HAS_TEST_DB) {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  }
});

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});
```

Each test acquires a client from the pool, executes SQL, and releases the
client in a `finally` block.

### Helper Function

The `execSQL` helper executes a query and returns rows:

```typescript
async function execSQL(client: PoolClient, sql: string): Promise<Record<string, unknown>[]> {
  const result = await client.query(sql);
  return result.rows;
}
```

---

## 3. Test Coverage (55 Tests)

The integration tests are organized into 18 sections covering all aspects of
the governance ledger DDL.

### Sections 1-11 (Commit 6 — 38 tests)

**Section 1: Table Creation (5 tests)**
- Verifies all 5 governance tables are created: `governance_lifecycle`,
  `schema_migrations`, `schema_migration_runs`, `migration_baseline`,
  `migration_totp_uses`.

**Section 2: Identifier CHECK Constraint (3 tests)**
- Valid identifiers (`001`, `074a`, `100`) are accepted.
- Invalid identifiers (`1`, `abc`, `1234`, `12a3`) are rejected by the
  `CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$')` constraint.
- The regex matches the grammar `^[0-9]{3}[a-z]?$` — exactly 3 digits
  optionally followed by one lowercase letter.

**Section 3: schema_migrations Status CHECK (2 tests)**
- All 5 valid statuses are accepted: `pending`, `running`, `applied`,
  `failed`, `superseded`.
- Invalid status is rejected.

**Section 4: schema_migration_runs Status CHECK (2 tests)**
- All 9 valid statuses are accepted: `started`, `applied`, `failed`,
  `denied`, `skipped`, `dry_run`, `conflict`, `lock_timeout`,
  `baseline_blocked`.
- Invalid status is rejected.

**Section 5: Actor Type CHECK (3 tests)**
- Valid actor types accepted: `human`, `migration-actor`.
- Invalid actor type rejected.
- NULL actor type accepted (CHECK permits NULL — the constraint is
  `actor_type IN ('human', 'migration-actor') OR actor_type IS NULL`).

**Section 6: checksum_sha256 CHECK (2 tests)**
- Valid 64-character lowercase hex checksum accepted.
- Invalid checksum (wrong length, uppercase, non-hex) rejected by the
  `CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')` constraint.

**Section 7: TOTP Replay Prevention (3 tests)**
- UNIQUE constraint on `(user_id, time_step)` prevents duplicate TOTP
  time-step usage for the same user.
- `ON CONFLICT DO NOTHING` returns 0 rows on duplicate (replay) and 1 row
  on first use — matching the `recordTotpUse()` replay detection logic.
- Different time_step for the same user is allowed.

**Section 8: Governance Lifecycle CHECK (2 tests)**
- All 6 valid lifecycle states accepted: `UNBOOTSTRAPPED`,
  `LEDGER_BOOTSTRAPPED`, `BASELINE_REQUIRED`, `BASELINE_IN_PROGRESS`,
  `BASELINE_VERIFIED`, `EXECUTION_ENABLED`.
- Invalid state rejected.

**Section 9: Baseline Reconciliation CHECK (2 tests)**
- All 5 `reconciliation_status` values accepted: `CONFIRMED_APPLIED`,
  `CONFIRMED_NOT_APPLIED`, `PARTIALLY_APPLIED`, `NOT_APPLICABLE`, `UNKNOWN`.
- All 6 `evidence_type` values accepted: `SCHEMA_INTROSPECTION`,
  `LEDGER_RECORD`, `MANUAL_VERIFICATION`, `CHECKSUM_MATCH`,
  `OBJECT_EXISTENCE`, `NONE`.

**Section 10: Advisory Locking (5 tests)**
- Advisory lock can be acquired with `pg_try_advisory_xact_lock`.
- Lock is automatically released on COMMIT.
- Lock is automatically released on ROLLBACK.
- Concurrent transaction cannot acquire the same lock key (contention).
- Different lock keys do not conflict (isolation).

**Section 11: Transaction Semantics (3 tests)**
- INSERT within a transaction is visible within the same transaction.
- ROLLBACK discards INSERTed rows.
- COMMIT persists INSERTed rows.

**Section 11b: UNIQUE Constraints (3 tests)**
- `schema_migrations` UNIQUE on `(migration_identifier, environment)` —
  duplicate rejected.
- `migration_totp_uses` UNIQUE on `(user_id, time_step)` — duplicate
  rejected.
- Same identifier with different environment is allowed.

### Sections 12-18 (Commit 7 — 17 expanded tests)

**Section 12: ON CONFLICT DO NOTHING (TOTP Replay Detection Logic) (2 tests)**
- First-use INSERT with `ON CONFLICT DO NOTHING RETURNING id` returns 1
  row; replay INSERT returns 0 rows. This directly validates the
  `recordTotpUse()` replay detection logic that uses
  `rows.length > 0` to determine first-use vs. replay.
- Different time_step for the same user is allowed (not a replay).

**Section 13: Governance Lifecycle State Machine (3 tests)**
- `environment` column is UNIQUE — duplicate environment rejected.
- Default `lifecycle_state` is `LEDGER_BOOTSTRAPPED` when not specified.
- All 6 valid lifecycle states can be INSERTed.

**Section 14: Append-Only Run History (3 tests)**
- Multiple `schema_migration_runs` rows for the same migration with
  different statuses are allowed — confirms the run history is append-only,
  not an upsert.
- `denied` status can be recorded — confirms the GOV-18 denied-path
  recording works at the DDL level.
- `baseline_blocked` status can be recorded — confirms the GOV-09
  baseline-blocked recording works at the DDL level.

**Section 15: Baseline Reconciliation Operations (2 tests)**
- `migration_baseline` allows multiple environments for the same
  migration identifier — confirms per-environment baseline tracking.
- Default `evidence_type` is `NONE` when not specified — confirms the DDL
  default.

**Section 16: Advisory Lock Key Isolation (1 test)**
- Two different advisory lock keys can be held simultaneously without
  conflict — confirms lock key isolation. The lock key
  `MIGRATION_LOCK_KEY_DECIMAL = '6003100736085771346'` is unique to the
  migration governance system and does not interfere with other advisory
  locks.

**Section 17: Index Verification (4 tests)**
- `schema_migrations` has an index on `status`.
- `schema_migration_runs` has an index on `execution_id`.
- `schema_migration_runs` has an index on
  `(migration_identifier, environment)`.
- `migration_totp_uses` has an index on `user_id`.

**Section 18: Nullable Actor Type (2 tests)**
- `schema_migration_runs` allows NULL `actor_type` — confirms the CHECK
  constraint permits NULL.
- `schema_migrations` allows NULL `applied_by_actor_type` — confirms the
  CHECK constraint permits NULL.

---

## 4. Test Results

### With PostgreSQL (TEST_DATABASE_URL set)

```
Test Files  1 passed (1)
     Tests  55 passed (55)
  Duration  ~1.1s
```

All 55 integration tests pass against PostgreSQL 15.18.

### Without PostgreSQL (TEST_DATABASE_URL not set)

```
Test Files  1 passed (1)
     Tests  1 passed | 54 skipped (55)
  Duration  ~0.5s
```

54 tests are gracefully skipped; 1 informational test passes and logs that
integration tests were skipped.

---

## 5. DDL Verification Summary

The integration tests confirm that the `BOOTSTRAP_LEDGER_DDL` in
`lib/migrations/ledger.ts` enforces the following constraints when executed
against a real PostgreSQL database:

| Constraint | Table | Column(s) | Verified by |
|------------|-------|-----------|-------------|
| Identifier grammar `^[0-9]{3}[a-z]?$` | schema_migrations, schema_migration_runs, migration_baseline | migration_identifier | Sections 2, 18 |
| Status CHECK (5 values) | schema_migrations | status | Section 3 |
| Status CHECK (9 values) | schema_migration_runs | status | Sections 4, 14 |
| Actor type CHECK (nullable) | schema_migrations, schema_migration_runs | actor_type / applied_by_actor_type | Sections 5, 18 |
| checksum_sha256 CHECK (64-char hex) | schema_migrations, schema_migration_runs | checksum_sha256 | Section 6 |
| TOTP UNIQUE (user_id, time_step) | migration_totp_uses | user_id, time_step | Sections 7, 11b, 12 |
| Lifecycle CHECK (6 states) | governance_lifecycle | lifecycle_state | Sections 8, 13 |
| Baseline reconciliation CHECK (5 values) | migration_baseline | reconciliation_status | Sections 9, 15 |
| Baseline evidence CHECK (6 values) | migration_baseline | evidence_type | Sections 9, 15 |
| Environment UNIQUE | governance_lifecycle | environment | Section 13 |
| (identifier, environment) UNIQUE | schema_migrations | migration_identifier, environment | Section 11b |
| Advisory lock acquire/release/contention | N/A | N/A | Sections 10, 16 |
| Transaction commit/rollback | N/A | N/A | Section 11 |
| Indexes exist | Various | Various | Section 17 |

---

## 6. Required Columns

The integration tests confirmed that `schema_migration_runs` requires both
`run_id` and `execution_id` (both NOT NULL). All INSERT statements in the
tests include these columns. This matches the DDL:

```sql
run_id        TEXT NOT NULL,
execution_id  TEXT NOT NULL,
```

The `migration_baseline` table does **not** have a `checksum_sha256` column.
The checksum CHECK constraint exists only on `schema_migrations` and
`schema_migration_runs`. This was verified by the integration tests and the
source-scanning tests.

---

## 7. Local PostgreSQL Setup

For running the integration tests locally, PostgreSQL 15 was installed and
configured:

```bash
# Install PostgreSQL 15
apt-get install -y postgresql-15

# Create test user and database
sudo -u postgres psql -c "CREATE USER testuser WITH PASSWORD 'testpass';"
sudo -u postgres psql -c "CREATE DATABASE migration_gov_test OWNER testuser;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE migration_gov_test TO testuser;"

# Start PostgreSQL
pg_ctlcluster 15 main start

# Run integration tests
TEST_DATABASE_URL="postgresql://testuser:testpass@localhost:5432/migration_gov_test" \
  npx vitest run tests/phase1a2-postgres-integration.test.ts
```

The test database uses a dedicated schema (`phase1a2_intg_test`) that is
dropped and recreated before each test, ensuring complete isolation.

---

## 8. Files Changed

| File | Commit | Change |
|------|--------|--------|
| `tests/phase1a2-postgres-integration.test.ts` | `611586a5` | Created: 38 integration tests (Sections 1-11b) |
| `tests/phase1a2-postgres-integration.test.ts` | `6268b71a` | Expanded: 17 additional tests (Sections 12-18) |

---

## 9. Exclusions

The integration tests verify the DDL constraint behavior only. They do not
test:
- The route handler logic (covered by source-scanning tests)
- The MFA/TOTP verification flow (MFA Phase 3 is frozen)
- Production database execution
- Migration 105 or any numbered SQL migration
- Organization/membership/ownership/collaboration/billing tables

The integration tests execute the `BOOTSTRAP_LEDGER_DDL` as-is, without
modifying it. The DDL is the same string used by the production bootstrap
function, ensuring the tests validate real-world constraint behavior.
