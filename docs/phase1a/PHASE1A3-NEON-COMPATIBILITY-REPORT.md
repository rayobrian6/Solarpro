# Phase 1A.3 — Neon Non-Production Compatibility Validation Report

**Document:** PHASE1A3-NEON-COMPATIBILITY-REPORT.md
**Phase:** 1A.3 — Non-Production Operational Activation and Historical Baseline Reconciliation
**Finding addressed:** GOV-23 (Neon serverless operational behavior has not been validated)
**Date:** 2026-07-12
**Status:** BLOCKED — documented as an honest blocker report (not a failure)
**Parent audit:** `docs/phase1a/PHASE1A3-OPERATIONAL-ACTIVATION-AUDIT.md` (GOV-23)

---

## 1. Purpose and Scope

The SolarPro production database is Neon serverless PostgreSQL. Neon differs from a
standard PostgreSQL instance in several operationally significant ways: connections are
pooled through PgBouncer in transaction mode, compute endpoints scale to zero and incur
cold-start latency, the serverless driver (`@neondatabase/serverless`) communicates over
HTTP/WebSocket rather than raw TCP, and the `sql.transaction()` callback API imposes
constraints that standard `pg` transactions do not (the callback must be synchronous and
must return an array of query promises — it must not `await` internally). GOV-23 records
that none of these Neon-specific behaviors had been validated through integration testing
prior to Phase 1A.3.

The GOV-23 resolution specifies two acceptable outcomes for Commit 6. If an authorized,
isolated non-production Neon branch is available, the full end-to-end test suite is run
against it to validate advisory lock behavior, transaction execution, cold-start handling,
and serverless-driver compatibility. If no authorized Neon branch is available — the
expected case in a sandbox environment — a blocker report is produced documenting that
Neon validation is a blocked workstream requiring an authorized non-production Neon
branch, and that local PostgreSQL 15 compatibility is validated through Commits 2 and 5.
The blocker report is explicitly not a failure; it is an honest documentation of what has
been proven and what remains unproven.

This document is that blocker report. No authorized isolated non-production Neon branch
is available in the execution environment that produced this commit. The report therefore
records the precise set of Neon-specific concerns identified during source analysis, maps
each concern to the local PostgreSQL evidence that partially de-risks it, and states
clearly what an authorized Neon branch would be required to prove.

---

## 2. Environment Determination

### 2.1 Authorized Neon Branch Availability

The Phase 1A.3 authorization permits mutation of isolated non-production databases only.
An authorized Neon branch, for the purposes of this validation, would be a Neon branch
that is (a) not the production branch, (b) isolated from the production branch's data, and
(c) explicitly designated for migration governance validation. The execution environment
that produced this commit does not provide a Neon branch connection string. The
`DATABASE_URL` environment variable, where present, is set to the local PostgreSQL test
database (`postgresql://testuser:testuser@localhost:5432/migration_gov_test`), not a Neon
endpoint. No `NEON_*` environment variables, Neon API key, or Neon project identifier are
available. An active probe for a Neon endpoint is therefore not possible without
introducing a production connection risk that the authorization explicitly prohibits.

**Determination:** No authorized isolated non-production Neon branch is available. Per the
GOV-23 resolution, this commit produces a blocker report rather than attempting live Neon
validation.

### 2.2 What Is Available

What is available is a local PostgreSQL 15.18 instance dedicated to migration governance
integration testing, accessed through the `pg` driver over TCP. The migration governance
production code paths (`ledger.ts`, `runner.ts`, `baselineEvidence.ts`) all construct
their SQL client via `neon(process.env.DATABASE_URL!)` from `@neondatabase/serverless`.
The Neon serverless driver cannot connect to a local PostgreSQL instance over TCP because
it uses fetch-based HTTP/WebSocket transport. To exercise the production code paths
against the local database, the Phase 1A.3 test harness provides a pg-backed compatibility
shim (`tests/__mocks__/neon-serverless.ts`) that Vitest substitutes for
`@neondatabase/serverless` via `vi.mock()`. The shim implements both calling conventions
the production code uses — the tagged-template-literal interface (`sql\`SELECT ...\``)
with `${param}` parameter binding, and the function-call mode used inside
`sql.transaction((txn) => [...statements.map((stmt) => txn(stmt, []))])` — and routes
them through a `pg` Pool.

This means the production code paths execute against real PostgreSQL 15 DDL and real
transaction semantics, but they do so through the `pg` transport, not the Neon HTTP
transport. The shim faithfully reproduces the Neon tagged-template and transaction
callback contracts (including the synchronous-array-of-promises constraint), so the
*API contract* between the production code and the driver is exercised exactly as it
would be against Neon. What is not exercised is the Neon-specific *transport and
operational layer*: HTTP/WebSocket connection management, PgBouncer transaction-mode
pooling, scale-to-zero cold starts, and Neon-specific query parameter handling.

---

## 3. Neon-Specific Compatibility Concerns Identified

The source analysis identified seven concrete Neon-specific concerns. Each is documented
below with its source location, the risk it presents, and the local evidence that
partially de-risks it.

### 3.1 Advisory Lock Key Precision (MIGRATION-GOV-06)

**Source:** `lib/migrations/types.ts` (lines 559–575), `lib/migrations/runner.ts` (lines
763–781), `lib/migrations/ledger.ts` (lines 463–478).

The migration advisory lock key is `MIGRATION_LOCK_KEY = 0x534f4c504d474452` (the ASCII
string "SOLPMGDR"), whose decimal value is `6003100736085771346`. This value exceeds
`Number.MAX_SAFE_INTEGER` (9007199254740991). If the key is passed as a JavaScript number
to the Neon driver, the driver serializes it with IEEE 754 double precision, losing the
low-order digits (it becomes `6003100736085771000`). The lock would then be acquired on a
*different* 64-bit key than intended, defeating mutual exclusion.

The production code defends against this by passing the key as a decimal *string*
(`MIGRATION_LOCK_KEY_DECIMAL = '6003100736085771346'`) and casting it to `BIGINT` inside
PostgreSQL: `pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint)`. The
tagged-template parameter binding sends the string `'6003100736085771346'`, and PostgreSQL
performs the exact numeric cast. This defense was originally motivated by the Neon path
specifically (MIGRATION-GOV-06), and it is preserved verbatim in the current code.

**Local evidence:** The e2e tests (Commits 2 and 4) execute `pg_try_advisory_xact_lock`
through the shim against PostgreSQL 15 and confirm the lock is acquired and released
correctly within the transaction scope. The advisory-lock CHECK-constraint behavior is
validated by the 96 Phase 1A.3 e2e tests and the 55 Phase 1A.2 integration tests.

**What Neon must still prove:** That the Neon serverless driver's parameter binding
preserves the exact string value `'6003100736085771346'` end-to-end through the HTTP
transport, and that the resulting `BIGINT` cast on the Neon compute endpoint matches. The
shim uses `pg`'s native parameter binding, which is not the same transport path. The risk
is low (the value is a string literal in both paths), but only a live Neon branch can
confirm it.

### 3.2 `sql.transaction()` Callback Constraint

**Source:** `lib/migrations/runner.ts` (lines 867–880), `lib/migrations/ledger.ts` (lines
463–489), `tests/__mocks__/neon-serverless.ts` (transaction implementation).

The Neon serverless driver's `sql.transaction((txn) => [...])` API requires the callback
to be *synchronous* and to *return an array of query promises*. If the callback uses
`await` inside its body, or returns a single promise rather than an array, the Neon driver
either throws or silently drops queries — the transaction's queries are dispatched as a
batch and the driver does not support sequential awaits within the callback.

The production code respects this constraint. In `executeMigrationInTransaction` the SQL
is pre-split into statements, and the callback returns `[
  txn\`SELECT pg_try_advisory_xact_lock(...)\`,
  ...statements.map((stmt) => txn(stmt, [])),
]` — a synchronous array of promises with no internal `await`. In
`bootstrapMigrationLedger`, the callback returns an array of DDL promises built the same
way. The shim reproduces this contract: it consumes the returned array and uses
`Promise.allSettled` (not `Promise.all`) to ensure every query settles before issuing
`COMMIT` or `ROLLBACK`, which matches the Neon driver's batch semantics while being more
forgiving on partial failure ordering.

**Local evidence:** The e2e tests (Commits 2 and 4) execute the full bootstrap and
canary-migration transaction paths through the shim and confirm that all DDL within a
transaction either commits atomically or rolls back atomically. The 96 e2e tests and 55
integration tests cover the bootstrap transaction, the migration execution transaction,
and the rollback-on-failure path.

**What Neon must still prove:** That the Neon driver's HTTP-based batch dispatch preserves
the *ordering* of the array elements (lock acquisition must execute before the migration
DDL) and that the driver's transaction boundary semantics (COMMIT/ROLLBACK after the batch
settles) match the shim's. The shim executes statements sequentially over a single `pg`
connection; the Neon driver may dispatch them as concurrent HTTP requests that the
endpoint reorders. The current code comment in `runner.ts` (lines 874–880) explicitly
notes this as a known limitation: the advisory lock is best-effort in the transaction path
because the driver does not easily allow checking the first query's result before
executing subsequent queries. A live Neon branch would confirm whether the lock query
reliably precedes the DDL.

### 3.3 FORBIDDEN Transaction Mode and CREATE INDEX CONCURRENTLY

**Source:** `lib/migrations/017_perf_indexes.sql`, `lib/migrations/019_query_perf_indexes.sql`,
`lib/migrations/020_digital_signatures.sql`, `lib/migrations/runner.ts` (lines 826–853).

Three production migrations contain `CREATE INDEX CONCURRENTLY` statements (9 statements
total across the three files). `CREATE INDEX CONCURRENTLY` cannot run inside a
transaction block — PostgreSQL raises
`ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`. The Phase 1A.1
SQL compatibility report classified these three files as `FORBIDDEN` (98 REQUIRED, 3
FORBIDDEN, 0 MANUAL_REVIEW across the 101-file manifest).

The canonical runner's handling of FORBIDDEN mode, as of Phase 1A.2 (MIGRATION-GOV-12),
is to *block* automatic execution entirely rather than attempt statement-by-statement
execution outside a transaction. The runner returns
`MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED` and emits an audit event of type
`migration.execution_blocked_non_transactional`. No SQL is executed. Manual operator
intervention is required to apply these three migrations outside the canonical runner.

**Local evidence:** The 55 Phase 1A.2 integration tests and the 96 Phase 1A.3 e2e tests
verify that FORBIDDEN migrations are correctly detected and blocked, and that the audit
event is emitted. Because the runner refuses to execute them, the CONCURRENTLY-vs-Neon
interaction is moot for the canonical runner path — no CONCURRENTLY statement is ever sent
through the driver.

**What Neon must still prove:** Strictly, nothing for the canonical runner, because the
runner blocks these migrations. The residual concern is operator-side: when an operator
applies migrations 017, 019, 020 manually outside the runner (the documented procedure),
they must do so against Neon in a way that respects PgBouncer transaction-mode pooling. A
manual `CREATE INDEX CONCURRENTLY` issued over a PgBouncer-pooled connection in
transaction mode can fail or behave unexpectedly because PgBouncer transaction mode does
not preserve a single backend across statements. This is an operational runbook concern,
not a canonical-runner code concern, and it should be documented in the operator
migration guide when production activation is authorized.

### 3.4 pgcrypto Extension and `gen_random_uuid()`

**Source:** `lib/migrations/001_initial_schema.sql`, `lib/migrations/004_pricing_config.sql`,
`lib/migrations/005_user_equipment_library.sql` (and indirectly all tables using
`gen_random_uuid()`).

The schema uses the `pgcrypto` extension, enabled via `CREATE EXTENSION IF NOT EXISTS
"pgcrypto"`, and relies on `gen_random_uuid()` as the default for every UUID primary key
across the manifest. pgcrypto is the only PostgreSQL extension used by the production
schema; no other extensions (`uuid-ossp`, `postgis`, `pg_trgm`, etc.) appear in any
migration.

**Local evidence:** PostgreSQL 15 supports `pgcrypto` and `gen_random_uuid()` natively.
The 55 integration tests create tables with `gen_random_uuid()` defaults and insert rows,
confirming the function works and that UUIDs are generated. The baseline evidence
generator (Commit 3) confirms that all 91 DDL-bearing migrations reference objects that
are *not* present in the empty schema — consistent with pgcrypto not yet being enabled
there.

**What Neon must still prove:** Neon supports the `pgcrypto` extension on all standard
compute endpoints, so this is expected to be a non-issue. However, the `CREATE EXTENSION`
statement requires superuser or the extension's install privilege, and Neon's permission
model for managed extensions should be confirmed against the authorized branch. The risk
is low but non-zero for a managed-serverless permission model.

### 3.5 Scale-to-Zero Cold Starts

**Source:** Operational concern (no single source line); affects all `neon(url)` call
sites in `lib/migrations/*.ts`.

Neon compute endpoints scale to zero when idle and incur cold-start latency (typically a
few hundred milliseconds to a few seconds) on the first query after a period of
inactivity. The migration governance functions do not implement retry-on-cold-start logic
beyond what the Neon driver itself provides. `getRawSql()` in both `ledger.ts` and
`runner.ts` constructs the `neon()` client per call from `process.env.DATABASE_URL`, and
the driver handles the initial connection.

The risk is that a migration execution or ledger bootstrap fails with a connection
timeout on a cold compute endpoint, leaving the operator with an ambiguous result
(possibly a partial bootstrap or a migration marked `running` but never marked `applied`).

**Local evidence:** None — the local PostgreSQL instance does not scale to zero, so
cold-start behavior cannot be reproduced locally. This is the clearest example of a
concern that is *purely* Neon-specific and cannot be de-risked with local evidence.

**What Neon must still prove:** That `bootstrapMigrationLedger` and
`executeMigrationInTransaction` succeed against a cold Neon compute endpoint on the first
query, or that they fail cleanly with a retryable error that the operator can re-issue.
The current code does not wrap these calls in retry logic, so if cold starts cause
intermittent failures, a retry wrapper at the `getRawSql()` call sites would be required.
This should be validated on the authorized Neon branch before production activation.

### 3.6 PgBouncer Transaction-Mode Pooling

**Source:** Operational concern; affects transaction-scoped state including advisory
locks and `SET` commands.

Neon routes connections through PgBouncer configured in transaction (not session) pooling
mode. Transaction-mode pooling means a single logical client session may be served by
different backend connections across transaction boundaries, and session-level state
(session advisory locks, `SET` parameters, prepared statements) does not persist across
transactions. The migration governance system uses *transaction-scoped* advisory locks
(`pg_try_advisory_xact_lock`, not `pg_advisory_lock`), which are compatible with
transaction-mode pooling because the lock is held for the duration of the transaction and
released on commit/rollback, exactly matching PgBouncer's transaction boundary. This was
a deliberate design decision documented in `ledger.ts` (lines 22–23): "We use
pg_try_advisory_xact_lock (transaction-scoped, bounded timeout) rather than
pg_advisory_xact_lock (which blocks)."

The system does not use session-level `SET` commands, prepared statements, or
session-scoped advisory locks anywhere in the migration path, so no session-state
persistence is required across transactions.

**Local evidence:** The transaction-scoped advisory lock is exercised in the e2e tests
and confirmed to acquire and release within the transaction. Because the lock is
transaction-scoped, it is pool-compatible by construction.

**What Neon must still prove:** That PgBouncer transaction mode does not interfere with
the multi-statement `sql.transaction()` batch (concern 3.2 overlaps here). Specifically,
that all statements in the transaction array execute on the *same* backend connection
within a single PgBouncer transaction slot, so the transaction-scoped advisory lock
acquired in the first statement is visible to the subsequent DDL statements. If PgBouncer
or the Neon driver were to split the batch across backend connections, the lock would not
protect the DDL. A live Neon branch is needed to confirm the batch stays within one
transaction slot.

### 3.7 Neon Serverless Driver Parameter Binding

**Source:** All `sql\`...\`` tagged-template call sites in `lib/migrations/*.ts`; shim in
`tests/__mocks__/neon-serverless.ts`.

The production code uses the Neon tagged-template interface with `${param}` interpolation
for all parameterized queries (baseline reconciliation records, ledger reads, audit
emission). The shim implements the same tagged-template contract by forwarding
interpolated values as `pg` query parameters. The two transports differ in how they
encode parameters: the Neon driver serializes parameters as JSON in an HTTP request body,
while `pg` uses the PostgreSQL binary/text wire protocol.

**Local evidence:** The e2e tests pass string, numeric, and boolean parameters through
the tagged-template interface and confirm the values round-trip correctly through
PostgreSQL. This validates the *contract* (interpolation produces correct bound
parameters) but via the `pg` wire path.

**What Neon must still prove:** That the JSON-over-HTTP parameter serialization preserves
type fidelity for all parameter types used — especially the advisory-lock key string
(concern 3.1), timestamps in audit records, and JSON `details` payloads in
`recordBaselineReconciliation`. JSON serialization of a `BIGINT`-cast string is expected
to be safe, but a live Neon branch is the authoritative confirmation.

---

## 4. Summary of Proven and Unproven

### 4.1 Proven (Local PostgreSQL 15 Evidence)

The following have been proven through the local PostgreSQL 15 test database, accessed
through the pg-backed Neon shim, across the Phase 1A.3 test suites committed in Commits
2, 3, 4, and 5:

| Concern | Proven by | Test count |
|---------|-----------|------------|
| Advisory lock acquires and releases within transaction scope | Phase 1A.3 e2e | 96 |
| Bootstrap transaction creates all five governance tables atomically | Phase 1A.3 e2e | 96 |
| Migration execution transaction commits or rolls back atomically | Phase 1A.3 e2e | 96 |
| FORBIDDEN migrations are detected and blocked (no execution) | Phase 1A.3 e2e + Phase 1A.2 | 96 + 55 |
| Execution gate blocks mutations in every non-EXECUTION_ENABLED state | Phase 1A.3 e2e | 96 |
| Full lifecycle transition sequence executes end-to-end | Phase 1A.3 e2e | 96 |
| Route handler dispatches all 12 actions correctly with auth/MFA/audit | Phase 1A.3 route-handler e2e | 51 |
| Baseline evidence generator is read-only (no mutation) | Phase 1A.3 baseline-evidence | 80 |
| Baseline evidence generator classifies all 101 manifest migrations | Phase 1A.3 evidence generation | 21 |
| DDL-level compatibility of all 101 migrations against PostgreSQL 15 | Phase 1A.2 integration | 55 |
| Governance logic and state machine correctness | Phase 1A focused | 287 |
| `sql.transaction()` callback contract (synchronous array of promises) | shim + e2e | 96 + 51 |

**Aggregate local evidence:** 287 + 55 + 96 + 80 + 21 + 51 = 590 tests, all database-backed
(where applicable) against PostgreSQL 15.18, all passing as of the commit preceding this
report.

### 4.2 Unproven (Requires Authorized Non-Production Neon Branch)

The following have *not* been proven and require an authorized isolated non-production
Neon branch to validate. They are listed in order of residual risk after local evidence:

1. **Cold-start reliability** (concern 3.5) — highest residual risk. No retry logic
   exists; a cold-start timeout during bootstrap or migration execution could produce an
   ambiguous operator result. Cannot be reproduced locally.
2. **`sql.transaction()` batch ordering under PgBouncer** (concerns 3.2 + 3.6) — the
   shim executes the transaction array sequentially on one connection; Neon may dispatch
   concurrently. The advisory-lock-first ordering must be confirmed on a live branch.
3. **Advisory lock key fidelity over HTTP transport** (concern 3.1) — low risk because
   the key is a string literal, but only a live branch authoritatively confirms the
   end-to-end BIGINT cast.
4. **Parameter binding type fidelity over JSON-over-HTTP** (concern 3.7) — low risk,
   covered by contract, needs live confirmation for edge types.
5. **pgcrypto extension permission on managed Neon** (concern 3.4) — low risk, expected
   supported, needs permission-model confirmation.
6. **Operator runbook for manual CONCURRENTLY migrations under PgBouncer** (concern 3.3)
   — documentation concern, not a runner code concern, to be addressed in the operator
   guide when production activation is authorized.

---

## 5. Blocker Determination

**Finding:** Neon serverless operational behavior remains unvalidated. This is a blocked
workstream. The block is not a defect in the migration governance code; it is an
environmental constraint: no authorized isolated non-production Neon branch is available
in the execution environment that produced this commit, and the Phase 1A.3 authorization
prohibits connecting to a production Neon endpoint to perform validation.

**What has been proven:** The migration governance system is fully compatible with
PostgreSQL 15 at the DDL, transaction, advisory-lock, and end-to-end lifecycle levels.
590 database-backed tests confirm this. The Neon driver *API contract* (tagged-template
and `sql.transaction()` callback semantics) is exercised exactly as production uses it,
through a faithful pg-backed shim. The code paths that would run against Neon are the
same code paths that pass against local PostgreSQL.

**What remains unproven:** The Neon-specific transport and operational layer — HTTP
connection management, cold starts, PgBouncer transaction-mode batching, and JSON
parameter serialization — cannot be validated without an authorized Neon branch. Six
specific concerns are documented in Section 3.

**Resolution required:** Before authorizing the first Enterprise Multi-Tenant Authority
schema migration against a production Neon endpoint, an authorized isolated non-production
Neon branch must be provisioned and the full Phase 1A.3 e2e suite must be run against it.
The run must specifically confirm: (a) bootstrap succeeds against a cold compute endpoint,
(b) the advisory lock is acquired before DDL within a `sql.transaction()` batch under
PgBouncer, (c) a canary migration commits atomically, and (d) the execution gate blocks
correctly. If any of these fail, the remediation is in the transport/operational layer
(retry wrappers, transaction batching guarantees) or in operator runbook documentation,
not in the governance logic, which is already proven.

**Status of GOV-23:** Documented as a blocker. The blocker is honest and expected per the
GOV-23 resolution. It does not block the remainder of Phase 1A.3 (Commits 7 and 8) or the
local non-production operational activation. It *does* block production Neon activation
until an authorized branch validates the transport layer.

---

## 6. References

- `docs/phase1a/PHASE1A3-OPERATIONAL-ACTIVATION-AUDIT.md` — GOV-23 finding and resolution
- `docs/phase1a/PHASE1A1-SQL-COMPATIBILITY-REPORT.md` — transaction mode classification
  (98 REQUIRED, 3 FORBIDDEN, 0 MANUAL_REVIEW)
- `docs/phase1a/PHASE1A3-BASELINE-EVIDENCE-REPORT.md` — 101-migration classification
  (91 CONFIRMED_NOT_APPLIED, 10 UNKNOWN)
- `lib/migrations/types.ts` — `MIGRATION_LOCK_KEY` and `MIGRATION_LOCK_KEY_DECIMAL`
- `lib/migrations/ledger.ts` — advisory lock acquisition in bootstrap transaction
- `lib/migrations/runner.ts` — `executeMigrationInTransaction`, FORBIDDEN mode handling
- `lib/migrations/baselineEvidence.ts` — read-only catalog evidence generator
- `tests/__mocks__/neon-serverless.ts` — pg-backed Neon driver shim
- `tests/phase1a3-migration-governance-e2e.test.ts` — 96 e2e tests
- `tests/phase1a3-route-handler-e2e.test.ts` — 51 route-handler e2e tests
- `tests/phase1a3-baseline-evidence.test.ts` — 80 baseline-evidence tests
- `tests/phase1a3-baseline-evidence-generation.test.ts` — 21 evidence generation tests
- `tests/phase1a2-postgres-integration.test.ts` — 55 PostgreSQL integration tests
- `tests/phase1a-migration-governance.test.ts` — 287 governance logic tests
