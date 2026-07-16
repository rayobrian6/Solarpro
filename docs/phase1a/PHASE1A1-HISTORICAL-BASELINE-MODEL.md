# Phase 1A.1 — Historical Baseline Model

> **Document status:** Authoritative specification for the historical baseline
> reconciliation model introduced in Phase 1A.1 (MIGRATION-GOV-02).
> **Scope:** Operational hardening of migration governance ONLY.
> No org/membership/ownership/collaboration/billing/cutover implementation.
> **Branch:** `dev`. **Commit:** Phase 1A.1, Commit 3.

## 1. Purpose

The SolarPro migration governance system was introduced in Phase 1A. That phase
created a canonical migration runner with a ledger, advisory locking, checksum
verification, and MFA-gated authorization. However, Phase 1A made a critical
assumption: that the migration ledger starts empty and all migrations will be
applied through the governance system from a clean database.

In practice, SolarPro's database has a history of schema changes applied
through various mechanisms — early developer scripts, manual psql sessions,
feature-branch experiments, and the legacy system-tools migration path. The
production and staging databases contain schema objects that were created by
migrations whose provenance was never recorded in any governance ledger. This
means that when the governance system is first introduced to an environment,
it has no way to know which migrations have already been applied and which have
not. Running the canonical migration flow without this knowledge would either
re-apply already-applied migrations (causing errors) or skip migrations that
were never applied (leaving the schema in an inconsistent state).

The historical baseline model solves this problem. It provides a structured,
evidence-based workflow for reconciling the historical state of every migration
against the actual database schema, classifying each migration's applied
status, and gating execution until that reconciliation is complete.

## 2. The Problem: Unknown Historical Baseline (MIGRATION-GOV-02)

Before Phase 1A.1, the migration governance system's `inspectMigrationState()`
function compared the manifest of migration files against the ledger rows. If
the ledger was empty (freshly bootstrapped), ALL migrations would appear as
"pending" — including migrations that had already been applied to the database
through other means. An operator could then execute the pending migrations,
which would attempt to re-apply already-applied DDL, producing errors like
"relation already exists" or "column already exists."

Conversely, some migrations might have been partially applied (a CREATE TABLE
succeeded but a subsequent CREATE INDEX failed), leaving the database in a
state that doesn't match any single migration's expected before/after state.

The core risk is: **executing migrations on top of a database whose historical
state is unknown is unsafe.** You might re-apply DDL that already exists,
skip DDL that was never applied, or build new schema on top of a partially
applied migration whose intermediate state was never recorded.

## 3. The Baseline Reconciliation Workflow

The baseline reconciliation workflow is a structured process that an operator
follows once per environment, after the ledger is bootstrapped and before any
migrations are executed through the governance system.

### 3.1 Lifecycle States

The governance lifecycle for each environment progresses through the following
states (defined in `lib/migrations/types.ts` as `MigrationGovernanceLifecycle`):

```
UNBOOTSTRAPPED → LEDGER_BOOTSTRAPPED → BASELINE_REQUIRED →
BASELINE_IN_PROGRESS → BASELINE_VERIFIED → EXECUTION_ENABLED
```

| State | Meaning | Mutations Permitted? |
|-------|---------|---------------------|
| `UNBOOTSTRAPPED` | No ledger tables exist. The system cannot operate. | No |
| `LEDGER_BOOTSTRAPPED` | Ledger tables created but baseline not started. | No |
| `BASELINE_REQUIRED` | Baseline reconciliation is required before execution. This is the initial state after bootstrap. | No |
| `BASELINE_IN_PROGRESS` | An operator is actively reconciling the baseline. | No |
| `BASELINE_VERIFIED` | All migrations have been reconciled with non-blocking statuses. Execution is technically possible but not yet explicitly enabled. | Yes |
| `EXECUTION_ENABLED` | An operator has explicitly enabled execution after verifying the baseline. | Yes |

The initial state after `bootstrapMigrationLedger()` is `BASELINE_REQUIRED`.
The bootstrap function inserts a row into `governance_lifecycle` with this
state. An operator then progresses through the reconciliation workflow,
eventually reaching `BASELINE_VERIFIED` and then `EXECUTION_ENABLED`.

### 3.2 Reconciliation Statuses

Each migration in the manifest must be classified with one of the following
reconciliation statuses (defined in `lib/migrations/types.ts` as
`BaselineReconciliationStatus`):

| Status | Meaning | Blocks Execution? |
|--------|---------|-------------------|
| `CONFIRMED_APPLIED` | Verified as applied to this environment. The schema objects it creates exist. | No |
| `CONFIRMED_NOT_APPLIED` | Verified as not applied to this environment. The schema objects it creates do not exist. | No |
| `PARTIALLY_APPLIED` | Some statements applied, others did not. The database is in an intermediate state. | **Yes** |
| `NOT_APPLICABLE` | Not relevant to this environment (e.g., a feature-specific migration for a feature not deployed here). | No |
| `UNKNOWN` | Cannot be determined. Insufficient evidence to classify. | **Yes** |

### 3.3 Evidence Types

Each reconciliation status must be backed by evidence. The evidence type
records how the status was determined (defined in `lib/migrations/types.ts` as
`BaselineEvidenceType`):

| Evidence Type | Description |
|--------------|-------------|
| `SCHEMA_INTROSPECTION` | Determined by querying `information_schema` or `pg_catalog` to check for the presence of schema objects. |
| `LEDGER_RECORD` | Determined by an existing ledger row (from a prior governance system or manual ledger entry). |
| `MANUAL_VERIFICATION` | Determined by a human operator inspecting the database directly. |
| `CHECKSUM_MATCH` | Determined by matching the migration file's checksum against a recorded checksum. |
| `OBJECT_EXISTENCE` | Determined by checking for specific named schema objects (tables, indexes, functions, etc.). |
| `NONE` | No evidence available. The status will be `UNKNOWN`. |

### 3.4 The Reconciliation Process

1. **Bootstrap the ledger** (if not already done). This creates the
   `governance_lifecycle`, `schema_migrations`, `schema_migration_runs`, and
   `migration_baseline` tables. The lifecycle is set to `BASELINE_REQUIRED`.

2. **Transition to `BASELINE_IN_PROGRESS`**. An operator calls
   `setGovernanceLifecycleState('BASELINE_IN_PROGRESS', operatorId)` to
   indicate that baseline reconciliation has begun.

3. **For each migration in the manifest**, determine and record its
   reconciliation status:
   - Use schema introspection (`information_schema.tables`,
     `information_schema.columns`, `pg_indexes`, etc.) to check whether the
     objects created by the migration exist.
   - Compare the findings against the migration's expected DDL to classify
     the status as `CONFIRMED_APPLIED`, `CONFIRMED_NOT_APPLIED`,
     `PARTIALLY_APPLIED`, or `UNKNOWN`.
   - Record the result via `recordBaselineReconciliation()` with the
     appropriate evidence type and a human-readable evidence summary.

4. **Verify completeness**. Call `verifyBaselineComplete(manifestIdentifiers)`
   to check that every migration has a baseline row and that none have a
   blocking status (`UNKNOWN` or `PARTIALLY_APPLIED`). If any migrations are
   unreconciled or blocking, the baseline is not complete.

5. **Resolve blocking statuses**. For any `UNKNOWN` or `PARTIALLY_APPLIED`
   migrations, the operator must investigate further, apply manual fixes, or
   re-record with a non-blocking status backed by stronger evidence. There is
   no "skip" or "force" — blocking statuses must be resolved.

6. **Advance to `BASELINE_VERIFIED`**. Once `verifyBaselineComplete()` returns
   `ok=true`, call `advanceToBaselineVerified(operatorId)`. This records who
   verified the baseline and when.

7. **Enable execution**. Call `enableExecution(operatorId)` to transition to
   `EXECUTION_ENABLED`. This records who enabled execution and when. Migrations
   can now be applied through the canonical runner.

### 3.5 No Bulk Mark-All-Applied

A critical design decision: there is no function to bulk-mark all migrations as
`CONFIRMED_APPLIED`. Each migration must be individually reconciled with
evidence. This prevents the dangerous shortcut of assuming "everything is
applied" without verification. An operator who wants to mark many migrations
as applied must call `recordBaselineReconciliation()` for each one, providing
evidence for each.

This is enforced at the API level: the only way to record a baseline
reconciliation is through `recordBaselineReconciliation()`, which accepts a
single migration identifier. There is no array variant, no "mark all" variant,
and no SQL-level mechanism to insert multiple baseline rows in a single call
without individual evidence.

## 4. Execution Blocking

The execution gate is enforced in the runner's `runSinglePendingMigration()`
and `runPendingMigrations()` functions. Before any non-dry-run migration
execution, the runner calls `assertExecutionPermitted(dryRun)` to check the
governance lifecycle state.

### 4.1 assertExecutionPermitted()

```typescript
export async function assertExecutionPermitted(
  dryRun: boolean,
): Promise<{
  permitted: boolean;
  lifecycleState: MigrationGovernanceLifecycle;
}>
```

This function reads the current governance lifecycle state and returns whether
execution is permitted. The logic is:

- If `dryRun` is `true`: always returns `permitted=true`. Dry-runs never
  mutate the database and are always allowed for inspection and planning.
- If the lifecycle state is `BASELINE_VERIFIED` or `EXECUTION_ENABLED`:
  returns `permitted=true`.
- For any other state (`UNBOOTSTRAPPED`, `LEDGER_BOOTSTRAPPED`,
  `BASELINE_REQUIRED`, `BASELINE_IN_PROGRESS`): returns `permitted=false` and
  emits a `migration.governance.execution_denied` audit event.

### 4.2 MIGRATION_BASELINE_REQUIRED Error

When execution is denied by the gate, the runner returns a result with:

- `errorCode: 'MIGRATION_BASELINE_REQUIRED'`
- `errorSummary`: A human-readable message explaining that baseline
  reconciliation must be completed, naming the current lifecycle state and
  the required states.

For `runSinglePendingMigration()`, this is returned as a single
`MigrationExecutionResult`. For `runPendingMigrations()`, this is returned
as a `MigrationRunResult` with `fatalErrors` containing the message.

### 4.3 Dry-Run Exemption

Dry-runs are always permitted regardless of the lifecycle state. This is
essential for the baseline reconciliation workflow itself: an operator needs
to be able to dry-run migrations to understand what they would do, compare
against the actual schema, and classify their baseline status — all before
the baseline is verified. Blocking dry-runs would make the reconciliation
workflow impossible.

## 5. Environment-Specific Baselines

Baseline reconciliation is per-environment. Each environment (development,
staging, production) has its own row in `governance_lifecycle` and its own
set of rows in `migration_baseline`. The `environment` column in both tables
is `NOT NULL`, and the unique constraints include `environment`.

There is no mechanism to copy a baseline from one environment to another.
This is intentional: the historical state of each environment may differ. A
migration that was applied in development might not have been applied in
staging. A migration that was partially applied in production might have been
fully applied in development. Each environment must be independently
reconciled against its own actual schema state.

The `getCurrentEnvironment()` function (from `lib/migrations/ledger.ts`)
determines the current environment from the `NODE_ENV` or
`MIGRATION_RUN_ENVIRONMENT` environment variable. All baseline functions
operate on the current environment only.

## 6. No Database Access Scenario

If the migration governance system is initialized in an environment where
there is no database access (e.g., a build server, a CI pipeline that only
runs static analysis), the lifecycle remains at `BASELINE_REQUIRED`. The
bootstrap function will fail (it cannot create the tables), and
`getGovernanceLifecycleState()` will return `null`, which
`assertExecutionPermitted()` treats as `UNBOOTSTRAPPED` — execution is denied.

This is the correct behavior: if there is no database to introspect, there is
no way to reconcile the baseline, and therefore no way to safely execute
migrations. The system fails closed.

## 7. Database Schema

The `migration_baseline` table (created in `BOOTSTRAP_LEDGER_DDL`):

```sql
CREATE TABLE IF NOT EXISTS migration_baseline (
  id                        SERIAL PRIMARY KEY,
  migration_identifier      TEXT NOT NULL
    CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$'),
  environment               TEXT NOT NULL,
  reconciliation_status     TEXT NOT NULL
    CHECK (reconciliation_status IN (
      'CONFIRMED_APPLIED',
      'CONFIRMED_NOT_APPLIED',
      'PARTIALLY_APPLIED',
      'NOT_APPLICABLE',
      'UNKNOWN'
    )),
  evidence_type             TEXT NOT NULL DEFAULT 'NONE'
    CHECK (evidence_type IN (
      'SCHEMA_INTROSPECTION',
      'LEDGER_RECORD',
      'MANUAL_VERIFICATION',
      'CHECKSUM_MATCH',
      'OBJECT_EXISTENCE',
      'NONE'
    )),
  evidence_summary          TEXT,
  reconciled_by             TEXT,
  reconciled_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT migration_baseline_env_identifier_unique
    UNIQUE (migration_identifier, environment)
);
```

Key constraints:
- `migration_identifier` must match the grammar `^[0-9]{3}[a-z]?$` (three
  digits optionally followed by a lowercase letter, supporting 074a/074b).
- `reconciliation_status` must be one of the five defined statuses.
- `evidence_type` must be one of the six defined types, defaulting to `NONE`.
- The unique constraint ensures one baseline row per migration per environment.

## 8. API Functions

The following functions are exported from `lib/migrations/ledger.ts` and
re-exported from `lib/migrations/runner.ts`:

| Function | Purpose |
|----------|---------|
| `recordBaselineReconciliation(params)` | Record or update a single migration's baseline status with evidence. |
| `readBaselineReconciliation(identifier)` | Read the baseline status for a single migration. |
| `readAllBaselineReconciliations()` | Read all baseline statuses for the current environment as a map. |
| `verifyBaselineComplete(manifestIdentifiers)` | Check that all migrations are reconciled with non-blocking statuses. |
| `advanceToBaselineVerified(reconciledBy)` | Transition lifecycle to BASELINE_VERIFIED. |
| `enableExecution(enabledBy)` | Transition lifecycle from BASELINE_VERIFIED to EXECUTION_ENABLED. |
| `assertExecutionPermitted(dryRun)` | Check whether execution is permitted for the current lifecycle state. |
| `getGovernanceLifecycleState()` | Read the current lifecycle state. |
| `setGovernanceLifecycleState(newState, changedBy)` | Set the lifecycle state (with audit). |

## 9. Audit Events

The baseline reconciliation workflow emits the following audit event types:

| Event Type | When Emitted |
|-----------|--------------|
| `migration.baseline.completed` | After successfully recording a baseline reconciliation. |
| `migration.baseline.failed` | When recording a baseline reconciliation fails. |
| `migration.governance.state_change` | When the lifecycle state changes (including to BASELINE_VERIFIED and EXECUTION_ENABLED). |
| `migration.governance.execution_denied` | When execution is blocked by the baseline gate. |

These events are currently emitted as structured JSON to the console as
supplemental telemetry. Durable persistence to the `audit_log` table is
addressed in Phase 1A.1 Section 8 (Persistent Audit Integration).

## 10. Security Considerations

- **Fail-closed by design**: If the lifecycle state cannot be read (database
  error, table missing), execution is denied. The system never assumes
  execution is permitted when it cannot verify the lifecycle state.

- **No bulk operations**: The absence of a bulk mark-all-applied function
  prevents the most dangerous shortcut in baseline reconciliation. Each
  migration must be individually justified with evidence.

- **Blocking statuses enforced**: `UNKNOWN` and `PARTIALLY_APPLIED` statuses
  block the lifecycle from advancing to `BASELINE_VERIFIED`. The
  `verifyBaselineComplete()` function explicitly checks for these.

- **Environment isolation**: Baselines are per-environment. There is no
  cross-environment copying mechanism. Each environment must be independently
  reconciled.

- **Dry-run exemption is safe**: Dry-runs never mutate the database. Allowing
  them regardless of lifecycle state does not create a mutation path.

## 11. Relationship to Phase 1A

The historical baseline model is fully backward-compatible with Phase 1A's
migration governance foundation. The Phase 1A functions (`bootstrapMigrationLedger`,
`inspectMigrationState`, `runSinglePendingMigration`, `runPendingMigrations`)
continue to work as before, with the addition of the execution gate.

The `inspectMigrationState()` function now also returns the current
`lifecycleState`, allowing API consumers to display the governance state to
operators and guide them through the baseline reconciliation workflow.

## 12. Future Considerations (Out of Scope)

The following items are explicitly out of scope for Phase 1A.1 and are noted
here only for future planning:

- **Automated introspection tooling**: A tool that automatically queries
  `information_schema` and classifies migrations. Phase 1A.1 provides the
  data model and API; the introspection tool is a future enhancement.
- **Baseline reconciliation API endpoint**: A REST endpoint for the
  reconciliation workflow. Phase 1A.1 provides the library functions; the
  API endpoint is a future enhancement.
- **Cross-environment baseline templates**: Templates that suggest likely
  baseline statuses based on environment type. Explicitly NOT a copy
  mechanism — each environment must still be independently verified.
- **Baseline rollback**: Reverting a verified baseline to re-reconcile.
  Currently, the lifecycle can be set back to `BASELINE_IN_PROGRESS` via
  `setGovernanceLifecycleState()`, but there is no dedicated rollback API.
