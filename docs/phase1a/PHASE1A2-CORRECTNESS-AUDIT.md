# Phase 1A.2 — Correctness Audit (MIGRATION-GOV-09 through MIGRATION-GOV-18)

**Repository:** rayobrian6/Solarpro, branch `dev`
**Audit base commit:** `100114c2` (HEAD aligned with `origin/dev`)
**Predecessor phases:** Phase 1A (`cf63eb6d` history), Phase 1A.1 (final commit `cf63eb6d`)
**Audit date:** See git commit metadata
**Auditor:** SuperNinja (senior SolarPro platform architect, acting as change-control reviewer)
**Scope:** Migration Governance Activation and Correctness Closure only

---

## 0. Purpose and Methodology

This document is the exact-state audit required before implementing Phase 1A.2.
Per the authorization, each governance issue (GOV-09 through GOV-18) was
audited against live source code in the repository at commit `100114c2`.
The methodology was:

1. Read all Phase 1A and Phase 1A.1 documentation to establish the intended
   architecture and the defects already resolved.
2. Read every governance-related source file in full.
3. For each GOV issue, locate the exact line(s) where the defect exists (or
   where the behavior is already correct) and record a verbatim code snippet.
4. Classify each issue as CONFIRMED (defect present), ALREADY_CORRECT (no
   change needed), or INFORMATIONAL (documentation/metadata gap, not a code
   defect).
5. Record the fix plan for each confirmed defect, scoped to the authorized
   Phase 1A.2 changes only.

The MFA boundary (`lib/mfa.ts` and related MFA artifacts) is FROZEN. No MFA
code was modified during this audit, and no MFA code will be modified during
implementation. The audit confirms that MFA Phase 3 code is imported from but
not altered.

The authorization explicitly does NOT include: migration 105, any new numbered
SQL migration, organization tables, membership tables, active organization
context, resource ownership, collaboration, billing, tenant cutover, changes
to frozen MFA Phase 3 code, or production migration execution.

---

## 1. Audit Summary

| Issue | Title | Status | Defect Location |
|-------|-------|--------|-----------------|
| GOV-09 | BASELINE_VERIFIED permits execution before activation | CONFIRMED | `lib/migrations/ledger.ts:833` |
| GOV-10 | Durable audit persistence may fail open | CONFIRMED | `lib/migrations/ledger.ts:298-313` |
| GOV-11 | No governed baseline reconciliation control plane | CONFIRMED | `app/api/admin/migrations/route.ts` (missing) |
| GOV-12 | Non-transactional execution safety insufficient | CONFIRMED | `lib/migrations/runner.ts:685-740` |
| GOV-13 | Legacy mutation paths may remain reactivatable | CONFIRMED | 3 route files, 3 feature flags |
| GOV-14 | Ledger identifier and status contracts require exact enforcement | CONFIRMED | `lib/migrations/types.ts:55-60`, `lib/migrations/ledger.ts:135` |
| GOV-15 | Governance behavior lacks real PostgreSQL integration proof | CONFIRMED | `tests/phase1a-migration-governance.test.ts` (no DB tests) |
| GOV-16 | Documentation and commit metadata inconsistent | INFORMATIONAL | Documentation set |
| GOV-17 | TOTP replay-step selection requires exact verification | ALREADY_CORRECT | `lib/migrations/runner.ts:295-316` |
| GOV-18 | Failure and denial run-history semantics require exact verification | CONFIRMED | `lib/migrations/runner.ts:793,824` |

**Result:** 8 confirmed code defects, 1 informational (documentation), 1 already
correct (no change). GOV-17 is verified correct and will be documented with
evidence rather than modified.

---

## 2. GOV-09 — BASELINE_VERIFIED Permits Execution Before Activation

**Status:** CONFIRMED DEFECT

**Spec requirement:** Only `EXECUTION_ENABLED` should permit schema mutation.
The `BASELINE_VERIFIED` state means reconciliation is complete, but execution
has not been explicitly activated. Allowing mutation in `BASELINE_VERIFIED`
collapses two distinct governance states into one and bypasses the explicit
activation step.

### 2.1 Exact Location and Code

File: `lib/migrations/ledger.ts`, function `assertExecutionPermitted()`,
approximately line 833:

```typescript
const permitted =
  lifecycle === 'BASELINE_VERIFIED' || lifecycle === 'EXECUTION_ENABLED';
```

The function `assertExecutionPermitted()` is the execution gate called by the
runner before applying any migration. When `permitted` is true, the runner
proceeds to mutate the database schema. By including `BASELINE_VERIFIED` in the
permitted set, the gate allows schema mutation immediately after baseline
reconciliation completes — before any operator has explicitly activated
execution.

### 2.2 Call Site

File: `lib/migrations/runner.ts`, function `runSinglePendingMigration()`,
approximately line 815:

```typescript
if (!dryRun) {
  const gate = await assertExecutionPermitted(false);
  if (!gate.permitted) {
    // ... returns MIGRATION_BASELINE_REQUIRED ...
  }
}
```

The same pattern exists in `runPendingMigrations()`. Dry-run paths correctly
bypass the gate.

### 2.3 Related Defect in enableExecution()

File: `lib/migrations/ledger.ts`, function `enableExecution()`,
approximately lines 756-770:

```typescript
await sql`
  UPDATE governance_lifecycle
  SET execution_enabled_by = ${enabledBy},
      execution_enabled_at = now(),
      lifecycle_state = 'EXECUTION_ENABLED',
      last_state_change_at = now()
  WHERE environment = ${environment}
    AND lifecycle_state = 'BASELINE_VERIFIED'
`;
```

The `enableExecution()` function does transition from `BASELINE_VERIFIED` to
`EXECUTION_ENABLED`, but it performs no TOTP verification, no reason capture,
no checksum-set match verification, and no persistent audit verification. It
is a library function with no API control plane entry point (see GOV-11). Even
if the gate were fixed, `enableExecution()` is currently unreachable from any
authorized API route.

### 2.4 Fix Plan

1. Change `assertExecutionPermitted()` to permit ONLY `EXECUTION_ENABLED`:
   ```typescript
   const permitted = lifecycle === 'EXECUTION_ENABLED';
   ```
2. Update all error messages and audit event details to reference
   `EXECUTION_ENABLED` as the sole execution-permitting state.
3. Update the JSDoc comment on `assertExecutionPermitted()` to reflect the
   single-state gate.
4. Add unit tests verifying that `BASELINE_VERIFIED` is NOT a
   execution-permitting state and that `EXECUTION_ENABLED` is.

### 2.5 Risk and Rollback

This is a tightening of the execution gate. The only behavioral change is that
mutations are blocked in `BASELINE_VERIFIED` until explicit activation. Since
no production environment has executed migrations under the governance model
yet (the system is pre-cutover), there is no risk of breaking existing
production behavior. Rollback: revert the single-line change to restore the
two-state gate.

---

## 3. GOV-10 — Durable Audit Persistence May Fail Open

**Status:** CONFIRMED DEFECT

**Spec requirement:** For mutation paths (schema changes), durable audit
persistence must fail closed. If the audit log cannot be written, the mutation
must not proceed (or must be treated as failed). The current implementation
swallows audit persistence failures for ALL paths, including mutations.

### 3.1 Exact Location and Code

File: `lib/migrations/ledger.ts`, function `emitAuditEvent()`,
approximately lines 298-313:

```typescript
export function emitAuditEvent(event: Omit<MigrationAuditEvent, 'timestamp'>): void {
  const fullEvent: MigrationAuditEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  // Structured JSON log line — parseable by log aggregators. Synchronous.
  console.log(JSON.stringify({ level: 'audit', ...fullEvent }));

  // Durable persistence to audit_log table (fire-and-forget, never throws).
  // The .catch() ensures no unhandled promise rejection propagates.
  persistMigrationAuditEvent(fullEvent).catch(() => {
    // writeAuditLog already falls back to console on failure; this catch is a
    // safety net for any unexpected error in the promise chain itself.
  });
}
```

The function is `void` (synchronous, fire-and-forget). The
`persistMigrationAuditEvent` call is not awaited, and the `.catch(() => {})`
silently discards any persistence failure. This means that if the `audit_log`
table is unreachable, the mutation that triggered the audit event still
succeeds, and the audit record is lost (only the console log remains).

### 3.2 The Underlying Persistence Function

File: `lib/auditLog.ts`, function `writeAuditLog()`:

`writeAuditLog()` returns `Promise<string | null>` — it returns the entry hash
on success and `null` on failure (it never throws). This is the durable
persistence function that `persistMigrationAuditEvent` calls. The fire-and-forget
pattern in `emitAuditEvent` means the return value is never checked.

### 3.3 Why This Is a Defect for Mutation Paths

For read-only/inspection audit events, fire-and-forget is acceptable — losing
an inspection audit record is not a safety violation. For mutation events
(schema changes, lifecycle transitions, execution activation), the audit
record is the durable evidence that a change occurred. If it is lost, there is
no append-only record of the mutation, which defeats the purpose of the
governance ledger.

### 3.4 Fix Plan

1. Add an async variant of audit emission for mutation paths:
   `emitAuditEventAsync()` that awaits `persistMigrationAuditEvent` and
   returns the persistence result.
2. For mutation paths in the runner and lifecycle transitions, call the async
   variant and check the result. If persistence fails, the mutation must be
   treated as failed (the schema change may have applied, but the run must be
   recorded as failed with an `AUDIT_PERSISTENCE_FAILED` error code, and the
   ledger state must reflect the audit failure).
3. Keep `emitAuditEvent()` (fire-and-forget) for read-only/inspection events
   where losing the audit record is acceptable.
4. Add unit tests verifying that mutation paths fail when audit persistence
   fails.

### 3.5 Risk and Rollback

The risk is that a mutation could apply to the database but be recorded as
failed due to an audit persistence issue, leaving the schema and ledger out of
sync. This is acceptable under the fail-closed principle — it is better to
have a visible failure than a silent audit gap. The operator can reconcile by
re-checking the ledger and the audit log. Rollback: revert to fire-and-forget
for all paths.

---

## 4. GOV-11 — No Governed Baseline Reconciliation Control Plane

**Status:** CONFIRMED DEFECT

**Spec requirement:** Baseline reconciliation must be driven through an
authorized API control plane with the following operations:
`inspect-baseline`, `record-baseline-entry`, `verify-baseline`,
`enable-execution`, and `disable-execution`. Each operation must enforce
authorization, TOTP for activation, and persistent audit.

### 4.1 Exact Location and Code

File: `app/api/admin/migrations/route.ts` — the canonical migration API route.

The route supports these actions (verified by grep):
- `inspect` (GET and POST)
- `run-pending`
- `run-single`
- `dry-run-pending`
- `dry-run-single`

There are NO baseline control plane operations. A grep for `baseline`,
`enableExecution`, `enable-execution`, `verify-baseline`,
`record-baseline-entry`, `inspect-baseline`, and `disable-execution` in the
route file returned ZERO matches. The functions exist in `lib/migrations/ledger.ts`
(`recordBaselineReconciliation`, `readBaselineReconciliation`,
`readAllBaselineReconciliations`, `verifyBaselineComplete`,
`advanceToBaselineVerified`, `enableExecution`) but they are exported and
never called from any API route.

### 4.2 Consequence

The baseline reconciliation functions are library-only. There is no way for
an operator to:
1. Inspect the current baseline reconciliation state.
2. Record a baseline entry (mark a migration as confirmed-applied or
   confirmed-not-applied for the current environment).
3. Verify that the baseline is complete (all migrations reconciled).
4. Enable execution (transition to `EXECUTION_ENABLED` with TOTP).
5. Disable execution (transition back to `BASELINE_VERIFIED`).

Without these operations, the governance lifecycle cannot progress beyond
`BASELINE_VERIFIED` through any authorized path, and since GOV-09 currently
allows mutation in `BASELINE_VERIFIED`, the activation step is bypassed
entirely.

### 4.3 Fix Plan

1. Add new POST actions to `app/api/admin/migrations/route.ts`:
   - `inspect-baseline`: read-only, returns all baseline reconciliation entries
     for the current environment. Requires `platform.migrations.inspect`.
   - `record-baseline-entry`: records a single baseline reconciliation entry.
     Requires `platform.migrations.baseline` (super_admin). Accepts
     `identifier`, `reconciliationStatus`, and `evidenceType`.
   - `verify-baseline`: checks that all manifest migrations have a
     reconciliation entry and that none are `UNKNOWN` or `PARTIALLY_APPLIED`.
     If complete, advances lifecycle to `BASELINE_VERIFIED`. Requires
     super_admin.
   - `enable-execution`: transitions from `BASELINE_VERIFIED` to
     `EXECUTION_ENABLED`. Requires super_admin + fresh TOTP + reason.
     Records persistent audit.
   - `disable-execution`: transitions from `EXECUTION_ENABLED` back to
     `BASELINE_VERIFIED`. Requires super_admin + fresh TOTP + reason.
     Records persistent audit.
2. Harden `enableExecution()` in `ledger.ts` to require a reason and to
   verify the baseline checksum set matches the current manifest checksums
   before allowing the transition. This prevents enabling execution against a
   stale baseline.
3. Add a `disableExecution()` function to `ledger.ts`.
4. Add unit tests for each control plane operation.

### 4.4 Risk and Rollback

This adds a new API surface. The risk is that the new operations could be
called incorrectly, but since they all require super_admin + TOTP for state
transitions, the blast radius is limited. Rollback: remove the new actions
from the route file.

---

## 5. GOV-12 — Non-Transactional Execution Safety Insufficient

**Status:** CONFIRMED DEFECT

**Spec requirement:** FORBIDDEN transaction mode (migrations containing
`CREATE INDEX CONCURRENTLY` and similar non-transactional statements) must be
BLOCKED from automatic execution. The canonical runner must return
`MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED` and NOT execute
statement-by-statement outside a transaction. The current implementation
executes FORBIDDEN migrations statement-by-statement with a session-scoped
advisory lock, which means a partial failure leaves the schema in an
inconsistent state with no rollback.

### 5.1 Exact Location and Code

File: `lib/migrations/runner.ts`, function `executeMigrationInTransaction()`,
approximately lines 685-740:

```typescript
// ── FORBIDDEN mode: execute outside a transaction, statement by statement ──
if (file.transactionMode === 'FORBIDDEN') {
  try {
    // Acquire a session-scoped advisory lock ...
    const lockResult = await sql`
      SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint) AS acquired
    `;
    const acquired = Boolean(lockResult[0]?.acquired);
    if (!acquired) {
      // ... LOCK_DENIED ...
    }
    // ... lock acquired audit event ...

    // Execute each statement individually (no transaction wrapper).
    // CONCURRENTLY statements cannot run inside a transaction block.
    try {
      for (const stmt of statements) {
        await sql(stmt, []);
      }
      return { success: true };
    } finally {
      // Always release the session lock, even on failure.
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint)`.catch(() => {});
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, errorCode: 'FORBIDDEN_MODE_STATEMENT_ERROR', error: errorMsg };
  }
}
```

The code acquires a session-scoped advisory lock and then executes each SQL
statement individually. If statement 3 of 5 fails, statements 1 and 2 have
already been committed, leaving the schema partially migrated. There is no
rollback, no idempotent retry, and no way to detect the partial state without
manual inspection.

### 5.2 MANUAL_REVIEW Mode (Already Correct)

MANUAL_REVIEW mode is correctly blocked at approximately lines 665-680:

```typescript
if (file.transactionMode === 'MANUAL_REVIEW') {
  return {
    success: false,
    errorCode: 'TRANSACTION_MODE_MANUAL_REVIEW',
    error: `Migration '${file.identifier}' ... requires manual review before execution.`,
  };
}
```

This is the correct pattern. FORBIDDEN should follow the same blocking pattern.

### 5.3 Affected Migrations

Per the Phase 1A.1 SQL Compatibility Report, 3 migrations are classified as
FORBIDDEN due to `CREATE INDEX CONCURRENTLY`:
- `017` — contains `CREATE INDEX CONCURRENTLY`
- `019` — contains `CREATE INDEX CONCURRENTLY`
- `020` — contains `CREATE INDEX CONCURRENTLY`

These 3 migrations will be blocked from automatic execution and will require
manual operator intervention (or a future transaction-safe migration
replacement).

### 5.4 Fix Plan

1. Replace the FORBIDDEN execution block with a blocking return:
   ```typescript
   if (file.transactionMode === 'FORBIDDEN') {
     emitAuditEvent({ ... type: 'migration.execution_blocked_non_transactional' ... });
     return {
       success: false,
       errorCode: 'MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED',
       error: `Migration '${file.identifier}' contains non-transactional ` +
         `statements (${file.incompatibleStatements.map(s => s.label).join(', ')}) ` +
         `and cannot be executed automatically. Manual operator intervention required.`,
     };
   }
   ```
2. Remove the session-scoped advisory lock acquisition for FORBIDDEN mode
   (it is no longer needed since no execution occurs).
3. Add unit tests verifying that FORBIDDEN migrations are blocked with the
   correct error code and do not execute any SQL.
4. Update documentation to note that FORBIDDEN migrations require manual
   execution.

### 5.5 Risk and Rollback

This blocks 3 historical migrations from automatic execution. Since these
migrations are historical (already applied in production or not applicable),
and the system is pre-cutover, there is no risk of breaking existing behavior.
If a FORBIDDEN migration needs to be applied, it will require manual operator
intervention (connecting to the database directly). Rollback: revert to the
statement-by-statement execution block.

---

## 6. GOV-13 — Legacy Mutation Paths May Remain Reactivatable

**Status:** CONFIRMED DEFECT

**Spec requirement:** Legacy migration execution paths must be permanently
eliminated, not merely feature-flagged. A feature flag that can restore
ungoverned DDL is a latent risk — if the flag is accidentally set to `true`,
the system reverts to executing migrations without the governance ledger,
advisory locks, transaction enforcement, or authorization controls.

### 6.1 Three Legacy Paths

#### 6.1.1 Legacy Inline Migration Runner

File: `app/api/migrate/route.ts`, approximately line 67:

```typescript
const legacyInlineEnabled = process.env.MIGRATION_LEGACY_INLINE_ENABLED === 'true';
```

When enabled, this route executes migrations directly from the request body,
bypassing the governance ledger entirely. The route is approximately 4,275
lines and is the original inline migration runner from before Phase 1A. When
disabled, it returns HTTP 423 Locked.

#### 6.1.2 Legacy System Tools Migration Runner

File: `app/api/admin/system-tools/route.ts`, approximately line 56:

```typescript
const legacySystemToolsRunEnabled = process.env.MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED === 'true';
```

When enabled, the `run_migration` action in the system tools route executes a
migration file directly by filename, bypassing the governance ledger.

#### 6.1.3 Legacy Prospects Seed Route

File: `app/api/admin/prospects/seed/route.ts`, approximately line 69:

```typescript
const legacyProspectsSeedEnabled = process.env.MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED === 'true';
```

When enabled, this route seeds prospect data, which includes DDL operations
(table creation, index creation) that bypass the governance ledger.

### 6.2 Fix Plan

1. Replace the feature-flag-gated execution in each legacy route with a
   permanent block that returns HTTP 423 Locked (or 410 Gone) with a message
   directing the operator to the canonical migration API.
2. Remove the feature flag checks entirely — the routes will ALWAYS return
   locked/gone.
3. Preserve the route files (do not delete them) so that any existing
   integrations receive a clear error response rather than a 404.
4. Remove the feature flag environment variable references from
   documentation.
5. Add unit tests verifying that the legacy routes always return
   locked/gone regardless of environment variables.

### 6.3 Risk and Rollback

This permanently disables 3 legacy routes. Since all 3 are already disabled by
default, the only behavioral change is that setting the feature flags to
`true` will no longer re-enable them. There is no risk of breaking existing
behavior because the default state is already disabled. Rollback: restore the
feature flag checks.

---

## 7. GOV-14 — Ledger Identifier and Status Contracts Require Exact Enforcement

**Status:** CONFIRMED DEFECT

**Spec requirement:** The `MigrationRunStatus` type must include all
governance-relevant statuses: `started`, `applied`, `failed`, `denied`,
`skipped`, `dry_run`, `conflict`, `lock_timeout`, `baseline_blocked`. The DDL
CHECK constraint on `schema_migration_runs.status` must enforce the same
vocabulary. The identifier grammar `^[0-9]{3}[a-z]?$` must be enforced in all
ledger tables.

### 7.1 Type Definition Defect

File: `lib/migrations/types.ts`, approximately lines 55-60:

```typescript
export type MigrationRunStatus =
  | 'started'
  | 'applied'
  | 'failed'
  | 'denied'
  | 'skipped';
```

Missing: `dry_run`, `conflict`, `lock_timeout`, `baseline_blocked`. These
statuses are needed to accurately record denied/blocked execution attempts
in the append-only run history (see GOV-18).

### 7.2 DDL CHECK Constraint Defect

File: `lib/migrations/ledger.ts`, `schema_migration_runs` table DDL,
approximately line 135:

```sql
status TEXT NOT NULL
  CHECK (status IN ('started', 'applied', 'failed', 'denied', 'skipped')),
```

This CHECK constraint would reject INSERTs with the new statuses, causing
`recordMigrationRunEvent()` to fail when recording a `dry_run`, `conflict`,
`lock_timeout`, or `baseline_blocked` event. The constraint must be expanded
to match the type definition.

### 7.3 Identifier Grammar (Already Correct)

The identifier CHECK constraint `CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$')`
is present on all three ledger tables:
- `schema_migrations` (approximately line 94)
- `schema_migration_runs` (approximately line 127)
- `migration_baseline` (approximately line 155)

This is correct and enforces the exact grammar: 3 digits followed by an
optional lowercase letter. Valid: `001`, `074a`, `074b`. Invalid: `1`,
`010aa`, `abc`, `105-extra`.

### 7.4 Fix Plan

1. Expand `MigrationRunStatus` type to include all 9 statuses:
   `started`, `applied`, `failed`, `denied`, `skipped`, `dry_run`,
   `conflict`, `lock_timeout`, `baseline_blocked`.
2. Expand the DDL CHECK constraint on `schema_migration_runs.status` to
   include all 9 statuses.
3. Update the JSDoc comment on `MigrationRunStatus` to document each status.
4. Add unit tests verifying that the type and DDL vocabulary are aligned and
   that invalid statuses are rejected.

### 7.5 Risk and Rollback

Expanding the type and DDL is additive — existing statuses continue to work.
The new statuses are only used by the new run-history recording paths added
in GOV-18. Rollback: revert the type and DDL to the 5-status set.

---

## 8. GOV-15 — Governance Behavior Lacks Real PostgreSQL Integration Proof

**Status:** CONFIRMED DEFECT

**Spec requirement:** Governance behavior (ledger bootstrap, advisory locking,
transaction execution, baseline reconciliation, TOTP replay prevention) must
be validated against a real PostgreSQL instance, not just source-code
scanning. The current test suite uses source-code scanning (regex matching
against source files) to verify that the code contains certain patterns, but
no test actually connects to a PostgreSQL database and exercises the SQL.

### 8.1 Current Test Suite

File: `tests/phase1a-migration-governance.test.ts` — 1,572 lines, 185 tests,
18 describe blocks. All 185 tests pass at baseline. The tests verify:
- Type definitions and vocabulary
- Manifest discovery and checksum computation
- Validation patterns and transaction mode detection
- Ledger DDL string construction (by reading the source and checking for
  expected substrings)
- Runner function signatures and return shapes
- API route action handling (by reading the source)

None of these tests connect to a real PostgreSQL database. The ledger DDL is
verified by checking that the source code string contains expected
`CREATE TABLE` statements, not by executing the DDL against a database.

### 8.2 What Integration Tests Would Validate

Real PostgreSQL integration tests would validate:
1. Ledger bootstrap creates all 5 tables with the correct columns and
   constraints.
2. Advisory locking (`pg_try_advisory_xact_lock`) works as expected under
   concurrent access.
3. Transaction execution commits on success and rolls back on failure.
4. Baseline reconciliation INSERT/UPDATE operations respect the CHECK
   constraints.
5. TOTP replay prevention (`migration_totp_uses` UNIQUE constraint) rejects
   duplicate (user_id, time_step) pairs.
6. The identifier CHECK constraint rejects invalid identifiers.
7. The status CHECK constraint rejects invalid statuses.

### 8.3 Fix Plan

1. Determine if a real PostgreSQL instance is available in the sandbox
   environment. If `pg` (libpq) or a local PostgreSQL server is available,
   build an integration test harness.
2. If PostgreSQL is available:
   - Create a test database (or use a temporary schema).
   - Write integration tests that execute the ledger DDL and exercise the
     governance operations.
   - Run the integration tests and report results.
3. If PostgreSQL is NOT available:
   - Document the blocker.
   - Create a test harness that is ready to run when PostgreSQL is available
     (the tests are written but skip when no DATABASE_URL is provided).
   - Report the blocker in the final report.

### 8.4 Risk and Rollback

Integration tests do not change production code. The risk is that the
integration tests may reveal defects in the DDL or SQL that were not caught by
source-code scanning. This is desirable — finding defects is the purpose of
integration testing. Rollback: remove the integration test files.

---

## 9. GOV-16 — Documentation and Commit Metadata Inconsistent

**Status:** INFORMATIONAL (not a code defect)

**Spec requirement:** Documentation must be consistent, complete, and
accurate. Commit metadata must reference the GOV issue numbers. The existing
Phase 1A and 1A.1 documentation is comprehensive but does not yet document
the Phase 1A.2 changes. This issue will be resolved by creating the required
Phase 1A.2 documentation and ensuring commit messages reference GOV-09
through GOV-18.

### 9.1 Required New Documentation

1. `docs/phase1a/PHASE1A2-CORRECTNESS-AUDIT.md` — this document.
2. `docs/phase1a/PHASE1A2-BASELINE-CONTROL-PLANE.md` — documents the baseline
   control plane API operations and authorization model.
3. `docs/phase1a/PHASE1A2-POSTGRES-INTEGRATION-VALIDATION.md` — documents the
   PostgreSQL integration test harness and results (or blocker).
4. `docs/phase1a/PHASE1A2-FINAL-REPORT.md` — final report for Phase 1A.2.

### 9.2 Required Documentation Updates

1. Update `docs/phase1a/PHASE1A-MIGRATION-GOVERNANCE-IMPLEMENTATION.md` with
   Phase 1A.2 resolution notes.
2. Update `docs/phase1a/ARCHITECTURE-DECISION-MIGRATION-MODEL.md` with the
   corrected lifecycle gate (EXECUTION_ENABLED only).
3. Update `docs/phase1a/PHASE1A1-SQL-COMPATIBILITY-REPORT.md` with the
   FORBIDDEN blocking decision.

### 9.3 Commit Message Convention

Each commit will reference the GOV issues it resolves:
- `feat(migrations): lifecycle activation gate and baseline control plane (MIGRATION-GOV-09, GOV-11)`
- `feat(migrations): fail-closed audit and run-history correctness (MIGRATION-GOV-10, GOV-18)`
- etc.

---

## 10. GOV-17 — TOTP Replay-Step Selection Requires Exact Verification

**Status:** ALREADY CORRECT — no change needed

**Spec requirement:** The TOTP replay prevention must record the EXACT
matched time-step, not the current server time-step. This prevents a subtle
replay attack where a code from the previous step is accepted and recorded
against the current step, leaving the previous step available for reuse.

### 10.1 Exact Location and Code

File: `lib/migrations/runner.ts`, function `verifyFreshTotp()`,
approximately lines 295-316:

```typescript
let matchedStep: number | null = null;
for (let delta = 0; delta <= TOTP_WINDOW_STEPS; delta++) {
  for (const sign of delta === 0 ? [1] : [-1, 1]) {
    const stepTime = now + sign * delta * TOTP_PERIOD_SECONDS * 1000;
    const expectedCode = generateTOTPCode(secret, stepTime);
    if (code === expectedCode) {
      matchedStep = Math.floor(stepTime / 1000 / TOTP_PERIOD_SECONDS);
      break;
    }
  }
  if (matchedStep !== null) break;
}
```

The code iterates the ±1 window (delta 0 = current, delta 1 with sign -1 =
previous, delta 1 with sign +1 = next). When a match is found, it computes
`matchedStep` from the EXACT `stepTime` that produced the matching code:
`Math.floor(stepTime / 1000 / TOTP_PERIOD_SECONDS)`. This is the exact
matched step, not the current server step.

### 10.2 Replay Prevention Verification

After finding the matched step, the code calls `recordTotpUse()` with the
exact `matchedStep` (approximately line 340):

```typescript
const firstUse = await recordTotpUse(adminUserId, matchedStep, executionId);
if (!firstUse) {
  return {
    verified: false,
    deniedReason: 'TOTP_REPLAY',
    timeStep: matchedStep,
  };
}
```

`recordTotpUse()` inserts into `migration_totp_uses` with
`ON CONFLICT DO NOTHING`. If the (user_id, time_step) pair already exists,
the INSERT returns no rows, and `firstUse` is false, indicating a replay.

### 10.3 Conclusion

The implementation is correct. The exact matched step is recorded, not the
current server step. A code from the previous step is recorded against the
previous step, preventing reuse of that step. A code from the next step is
recorded against the next step. This satisfies the spec requirement.

**No code change is needed for GOV-17.** The existing test suite includes
tests for TOTP replay prevention. We will add an explicit test that
verifies the exact-step recording behavior to strengthen the evidence.

### 10.4 Evidence Preservation

The `lib/mfa.ts` file (FROZEN, 317 lines) contains `verifyTOTPCode()`,
`generateTOTPCode()`, and `decryptTOTPSecret()`. The `verifyFreshTotp()`
function in `runner.ts` reimplements the TOTP window iteration (rather than
calling `verifyTOTPCode()` directly) specifically because it needs the
matched step for replay tracking. This design is correct and will be
documented as evidence of GOV-17 resolution.

---

## 11. GOV-18 — Failure and Denial Run-History Semantics Require Exact Verification

**Status:** CONFIRMED DEFECT

**Spec requirement:** The append-only run history (`schema_migration_runs`)
must record ALL execution attempts, including denials and baseline blocks,
with the correct status. Denied attempts must be recorded as `denied` (or
`baseline_blocked`), not as `failed`. The current implementation returns
`status: 'failed'` for denied/blocked paths and does NOT call
`recordMigrationRunEvent()` for these paths, meaning denials are not recorded
in the append-only run history at all.

### 11.1 Exact Location and Code

File: `lib/migrations/runner.ts`, function `runSinglePendingMigration()`.

#### 11.1.1 Authorization Denial (approximately line 793)

```typescript
if (!authorization.allowed) {
  return {
    identifier,
    filename: '',
    status: 'failed',
    durationMs: 0,
    errorCode: 'AUTHORIZATION_DENIED',
    errorSummary: authorization.reason ?? 'Authorization denied',
    dryRun,
    executionId,
  };
}
```

This returns `status: 'failed'` with `errorCode: 'AUTHORIZATION_DENIED'` but
does NOT call `recordMigrationRunEvent()` to record the denial in
`schema_migration_runs`. The denial is only emitted as an audit event (console
log + fire-and-forget persistence).

#### 11.1.2 Baseline Gate Denial (approximately line 824)

```typescript
return {
  identifier,
  filename: '',
  status: 'failed',
  durationMs: Date.now() - startTime,
  errorCode: 'MIGRATION_BASELINE_REQUIRED',
  errorSummary: `Migration execution is blocked ...`,
  dryRun,
  executionId,
};
```

Same pattern: returns `status: 'failed'` with `errorCode:
'MIGRATION_BASELINE_REQUIRED'` but does NOT record the denial in the run
history.

### 11.2 What Is Recorded

Only successful executions (`status: 'applied'`) and execution failures
(`status: 'failed'`) are recorded to `schema_migration_runs` via
`recordMigrationResult()` (approximately lines 973 and 1009). The
`recordMigrationResult()` function updates the current-state row in
`schema_migrations` AND inserts a row in `schema_migration_runs`.

Denied and blocked attempts are NOT recorded in `schema_migration_runs` at
all. They only appear as audit events in the `audit_log` table (and only if
the fire-and-forget persistence succeeds — see GOV-10).

### 11.3 Consequence

An operator who inspects the run history cannot see denied or blocked
attempts. This means:
1. Repeated unauthorized execution attempts are invisible in the run history.
2. Baseline gate denials are invisible in the run history.
3. The audit trail is incomplete — the run history only shows what was
   attempted and executed, not what was denied.

### 11.4 Fix Plan

1. For the authorization denial path, call `recordMigrationRunEvent()` with
   `status: 'denied'` before returning the result.
2. For the baseline gate denial path, call `recordMigrationRunEvent()` with
   `status: 'baseline_blocked'` before returning the result.
3. For the `CHECKSUM_CONFLICT` path (approximately line 890), call
   `recordMigrationRunEvent()` with `status: 'conflict'`.
4. For the `ALREADY_RUNNING` path (approximately line 918), call
   `recordMigrationRunEvent()` with `status: 'lock_timeout'` (or a more
   specific status if appropriate).
5. For the `MIGRATION_NOT_FOUND` path (approximately line 864), record with
   `status: 'failed'` (this is a genuine failure, not a denial).
6. For dry-run paths, record with `status: 'dry_run'`.
7. This requires the `MigrationRunStatus` type and DDL CHECK to be expanded
   first (GOV-14).
8. Add unit tests verifying that each denial/blocked path records the correct
   status in the run history.

### 11.5 Risk and Rollback

This adds run-history recording for paths that previously did not record. The
risk is that `recordMigrationRunEvent()` could fail (it returns null on
failure and never throws), but this is acceptable — the denial is still
returned to the caller, and the audit event is still emitted. Rollback: remove
the `recordMigrationRunEvent()` calls from the denial paths.

---

## 12. Authorization Boundary Confirmation

This audit and the subsequent implementation are strictly limited to:

- **Allowed:** Migration governance lifecycle activation, baseline control
  plane, audit fail-closed, run-history correctness, non-transactional
  blocking, legacy path closure, identifier/status contracts, TOTP step
  verification (evidence only), PostgreSQL integration validation,
  documentation, and tests.

- **NOT allowed:** Migration 105, any new numbered SQL migration,
  organization tables, membership tables, active organization context,
  resource ownership, collaboration, billing, tenant cutover, changes to
  frozen MFA Phase 3 code (`lib/mfa.ts`), or production migration execution.

The MFA boundary is confirmed frozen. `lib/mfa.ts` (317 lines) was read in
full and will not be modified. The `verifyFreshTotp()` function in
`runner.ts` that wraps MFA verification will not alter the MFA functions it
imports from `lib/mfa.ts`.

---

## 13. Test Baseline at Audit Time

- **TypeScript compile:** `npx tsc --noEmit` — exit 0 (clean)
- **Focused tests:** `npx vitest run tests/phase1a-migration-governance.test.ts`
  — 185/185 pass (18 describe blocks)
- **Full suite:** Not re-run during audit (previous session confirmed 6,863
  passed, 1 pre-existing fail in `tests/golden-path.test.ts` — SLD Pipeline
  combiner fields, unrelated to migration governance)

The pre-existing `golden-path.test.ts` failure is documented and unrelated to
this work. It will not be addressed in Phase 1A.2.

---

## 14. Commit Plan

The implementation will proceed across the following commits, all on the
`dev` branch directly:

| Commit | Scope | GOV Issues |
|--------|-------|------------|
| 1 | Exact-state audit document (this file) | Documentation |
| 2 | Lifecycle activation gate + baseline control plane API | GOV-09, GOV-11 |
| 3 | Fail-closed persistent audit + run-history correctness | GOV-10, GOV-18 |
| 4 | Non-transactional blocking + legacy path closure | GOV-12, GOV-13 |
| 5 | Identifier, status, TOTP-step, actor correctness | GOV-14, GOV-17 |
| 6 | PostgreSQL integration harness & tests | GOV-15 |
| 7 | Expanded unit and integration tests | All |
| 8 | Documentation & final report | GOV-16 |

---

## 15. End of Audit

This audit is complete. All 10 governance issues have been examined against
live code at commit `100114c2`. 8 confirmed defects will be fixed, 1
informational issue will be resolved through documentation, and 1 issue
(GOV-17) is already correct and will be documented with evidence. The
implementation will proceed commit by commit as outlined in Section 14.
