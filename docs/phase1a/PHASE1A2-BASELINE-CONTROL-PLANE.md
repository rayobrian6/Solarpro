# Phase 1A.2 — Baseline Control Plane (MIGRATION-GOV-09, GOV-11)

> **Document type:** Implementation specification and operational reference
> **Repository:** `rayobrian6/Solarpro`, branch `dev`
> **Commits:** `d3b4fff3` (Commit 2), `6268b71a` (Commit 7)
> **Scope:** Lifecycle activation gate and baseline control plane API
> **Related issues:** MIGRATION-GOV-09 (execution gate), MIGRATION-GOV-11 (baseline control plane)

---

## 1. Purpose

This document describes the baseline control plane implemented during Phase
1A.2 — the set of API actions, ledger functions, and lifecycle state machine
transitions that govern when schema migrations may be applied and how a
historical baseline is reconciled before execution is enabled.

Two governance issues are addressed:

- **MIGRATION-GOV-09:** The lifecycle state `BASELINE_VERIFIED` incorrectly
  permitted schema mutation. Only `EXECUTION_ENABLED` should permit schema
  mutation. The activation gate now requires an explicit two-step process:
  reconcile the baseline, then separately enable execution.

- **MIGRATION-GOV-11:** There was no governed baseline reconciliation control
  plane. Phase 1A.1 introduced the ledger tables and functions for baseline
  reconciliation, but the canonical migration API route did not expose any
  actions for an operator to inspect, record, verify, enable, or disable
  execution. Phase 1A.2 adds five new API actions to the canonical route.

---

## 2. Lifecycle State Machine

The `governance_lifecycle` table tracks a six-state lifecycle per environment:

```
UNBOOTSTRAPPED → LEDGER_BOOTSTRAPPED → BASELINE_REQUIRED
    → BASELINE_IN_PROGRESS → BASELINE_VERIFIED → EXECUTION_ENABLED
```

| State | Meaning | Permits schema mutation? |
|-------|---------|--------------------------|
| `UNBOOTSTRAPPED` | Ledger has not been created. | No |
| `LEDGER_BOOTSTRAPPED` | Ledger tables created; no baseline reconciled. | No |
| `BASELINE_REQUIRED` | Bootstrap has advanced; baseline reconciliation needed. | No |
| `BASELINE_IN_PROGRESS` | Operator is recording baseline entries. | No |
| `BASELINE_VERIFIED` | All migrations reconciled; baseline verified. | No |
| `EXECUTION_ENABLED` | Execution explicitly enabled with a reason. | **Yes** |

The critical GOV-09 fix: `BASELINE_VERIFIED` is a prerequisite for enabling
execution, but it does **not** itself permit schema mutation. The operator
must explicitly call `enable-execution` (with a reason and TOTP) to transition
to `EXECUTION_ENABLED`. Only `EXECUTION_ENABLED` passes the
`assertExecutionPermitted()` gate in the runner.

### Execution Gate (GOV-09)

The function `assertExecutionPermitted()` in `lib/migrations/ledger.ts` is
called by the runner before any schema mutation:

```typescript
export async function assertExecutionPermitted(isDryRun: boolean): Promise<{
  permitted: boolean;
  lifecycleState: MigrationLifecycleState | null;
  errorCode?: string;
}> {
  // Dry-run/inspect operations are exempt — they do not mutate schema.
  if (isDryRun) {
    return { permitted: true, lifecycleState: null };
  }
  const lifecycle = await getGovernanceLifecycleState();
  if (lifecycle === 'EXECUTION_ENABLED') {
    return { permitted: true, lifecycleState: lifecycle };
  }
  // All other states (including BASELINE_VERIFIED) are blocked.
  return {
    permitted: false,
    lifecycleState: lifecycle,
    errorCode: 'LIFECYCLE_NOT_EXECUTION_ENABLED',
  };
}
```

The runner calls this gate at two points: `run-single` and `run-pending`. Both
return `423 Locked` with the error message directing the operator to call
`enable-execution` if the lifecycle is in `BASELINE_VERIFIED`:

```
Lifecycle state 'BASELINE_VERIFIED' does not permit execution.
Required state: EXECUTION_ENABLED.
If the lifecycle is BASELINE_VERIFIED, call enable-execution (with a reason) to activate execution.
```

### Enable / Disable Execution (GOV-09)

`enableExecution()` in `ledger.ts` transitions from `BASELINE_VERIFIED` to
`EXECUTION_ENABLED`. It uses a `WHERE lifecycle_state = 'BASELINE_VERIFIED'`
clause so the transition can only occur from the correct predecessor state. It
records the actor ID and a reason:

```typescript
export async function enableExecution(
  enabledBy: string,
  reason: string,
): Promise<boolean> {
  // ... UPDATE governance_lifecycle SET lifecycle_state = 'EXECUTION_ENABLED',
  //     execution_enabled_by = $enabledBy, execution_enabled_at = now()
  //     WHERE lifecycle_state = 'BASELINE_VERIFIED' ...
}
```

`disableExecution()` is the inverse: it transitions from `EXECUTION_ENABLED`
back to `BASELINE_VERIFIED`, blocking all further schema mutations. This
provides a controlled shutdown mechanism.

---

## 3. Baseline Control Plane API (GOV-11)

Five new actions were added to the canonical migration route
(`app/api/admin/migrations/route.ts`). All require admin authentication and
TOTP verification (MFA Phase 3, frozen).

### Action: `inspect-baseline` (read-only)

**Purpose:** Return all baseline reconciliation entries for the current
environment, the current lifecycle state, the manifest migration count, and
any unreconciled migrations.

**Request:** No body fields required.

**Response fields:**
- `success: boolean`
- `action: 'inspect-baseline'`
- `environment: string`
- `lifecycleState: string` (current lifecycle state, or `UNBOOTSTRAPPED`)
- `manifestCount: number` (number of migrations in the manifest)
- `baselines: Array<{ identifier, reconciliationStatus, evidenceType, evidenceSummary, reconciledBy, reconciledAt }>`
- `unreconciled: string[]` (manifest identifiers without a baseline entry)

**Status code:** `200 OK`

### Action: `record-baseline-entry`

**Purpose:** Record a single migration's baseline reconciliation status with
evidence. This is the core operator action during baseline reconciliation.

**Request body fields:**
- `identifier: string` (required) — migration identifier (e.g. `001`, `074a`)
- `reconciliationStatus: string` (required) — one of: `CONFIRMED_APPLIED`,
  `CONFIRMED_NOT_APPLIED`, `PARTIALLY_APPLIED`, `NOT_APPLICABLE`, `UNKNOWN`
- `evidenceType: string` (required) — one of: `SCHEMA_INTROSPECTION`,
  `LEDGER_RECORD`, `MANUAL_VERIFICATION`, `CHECKSUM_MATCH`,
  `OBJECT_EXISTENCE`, `NONE`
- `evidenceSummary: string | null` (optional) — free-text evidence summary

**Response fields:**
- `success: boolean`
- `action: 'record-baseline-entry'`
- `identifier: string`
- `reconciliationStatus: string`
- `evidenceType: string`

**Validation:** Returns `400` if `identifier` is missing, if
`reconciliationStatus` is not one of the 5 valid values, or if `evidenceType`
is not one of the 6 valid values. The `reconciledBy` field is set to the
authenticated admin user's ID.

**Ledger function:** Calls `recordBaselineReconciliation()` in `ledger.ts`,
which performs an `INSERT ... ON CONFLICT (migration_identifier, environment)
DO UPDATE` — allowing re-recording of a baseline entry if the operator needs
to correct a mistake.

### Action: `verify-baseline`

**Purpose:** Verify that all manifest migrations have been reconciled with a
non-blocking status, then advance the lifecycle to `BASELINE_VERIFIED`.

**Request:** No body fields required.

**Response fields (success):**
- `success: boolean`
- `action: 'verify-baseline'`
- `ok: true`
- `advancedToBaselineVerified: boolean`
- `lifecycleState: 'BASELINE_VERIFIED' | null`

**Response fields (incomplete baseline):**
- `success: false`
- `ok: false`
- `unreconciled: string[]` (migrations without a baseline entry)
- `blocking: string[]` (migrations with a blocking status: `PARTIALLY_APPLIED`
  or `UNKNOWN`)
- `error: string` (explanatory message)
- **Status code:** `409 Conflict`

**Logic:** Calls `verifyBaselineComplete(manifestIds)` which checks that every
manifest migration has a baseline entry with a non-blocking status
(`CONFIRMED_APPLIED`, `CONFIRMED_NOT_APPLIED`, or `NOT_APPLICABLE`). If
complete, calls `advanceToBaselineVerified(adminUser.id)`.

### Action: `enable-execution`

**Purpose:** Transition from `BASELINE_VERIFIED` to `EXECUTION_ENABLED`,
permitting schema mutations via the canonical runner.

**Request body fields:**
- `reason: string` (required, non-empty) — the operator's justification for
  enabling execution

**Response fields (success):**
- `success: boolean`
- `action: 'enable-execution'`
- `enabled: boolean`
- `lifecycleState: 'EXECUTION_ENABLED'`
- `reason: string`

**Validation:** Returns `400` if `reason` is missing or empty. Returns `409`
if the lifecycle is not in `BASELINE_VERIFIED`.

**Ledger function:** Calls `enableExecution(adminUser.id, reason)` in
`ledger.ts`.

### Action: `disable-execution`

**Purpose:** Transition from `EXECUTION_ENABLED` back to `BASELINE_VERIFIED`,
blocking all further schema mutations.

**Request body fields:**
- `reason: string` (required, non-empty) — the operator's justification for
  disabling execution

**Response fields (success):**
- `success: boolean`
- `action: 'disable-execution'`
- `disabled: boolean`
- `lifecycleState: 'BASELINE_VERIFIED'`
- `reason: string`

**Validation:** Returns `400` if `reason` is missing or empty. Returns `409`
if the lifecycle is not in `EXECUTION_ENABLED`.

**Ledger function:** Calls `disableExecution(adminUser.id, reason)` in
`ledger.ts`.

---

## 4. Operator Workflow

The intended operator workflow for activating migration execution:

1. **Bootstrap the ledger.** Call `bootstrap` action. The lifecycle advances
   from `UNBOOTSTRAPPED` to `LEDGER_BOOTSTRAPPED`, then automatically to
   `BASELINE_REQUIRED`.

2. **Inspect the baseline.** Call `inspect-baseline` to see which migrations
   are in the manifest and which have already been reconciled.

3. **Record baseline entries.** For each migration in the manifest, call
   `record-baseline-entry` with the reconciliation status and evidence type.
   Use `SCHEMA_INTROSPECTION` or `OBJECT_EXISTENCE` for migrations whose
   schema objects can be verified, `LEDGER_RECORD` for migrations with prior
   ledger records, and `MANUAL_VERIFICATION` for migrations requiring manual
   inspection.

4. **Verify the baseline.** Call `verify-baseline`. If all migrations are
   reconciled with non-blocking statuses, the lifecycle advances to
   `BASELINE_VERIFIED`. If any are unreconciled or blocking, the response
   includes the `unreconciled` and `blocking` lists.

5. **Enable execution.** Call `enable-execution` with a reason. The lifecycle
   advances to `EXECUTION_ENABLED`. Schema mutations are now permitted via
   the canonical runner.

6. **Run migrations.** Call `run-single` or `run-pending`. The
   `assertExecutionPermitted()` gate passes because the lifecycle is
   `EXECUTION_ENABLED`.

7. **Disable execution (optional).** Call `disable-execution` with a reason
   to return the lifecycle to `BASELINE_VERIFIED` and block further mutations.

---

## 5. Ledger Tables

The baseline control plane operates on three of the five governance ledger
tables:

### `governance_lifecycle`

Tracks the lifecycle state per environment. Columns: `id`, `environment`
(UNIQUE), `lifecycle_state` (CHECK: 6 states, default
`LEDGER_BOOTSTRAPPED`), `baseline_reconciled_by`, `baseline_reconciled_at`,
`execution_enabled_by`, `execution_enabled_at`, `last_state_change_at`,
`created_at`.

### `migration_baseline`

Records per-migration baseline reconciliation entries. Columns:
`migration_identifier` (CHECK: `^[0-9]{3}[a-z]?$`), `environment`,
`reconciliation_status` (CHECK: 5 values), `evidence_type` (CHECK: 6 values,
default `NONE`), `evidence_summary`, `reconciled_by`, `reconciled_at`.
UNIQUE constraint on `(migration_identifier, environment)`.

### `schema_migrations`

The canonical migration ledger. The `status` column tracks 5 states:
`pending`, `running`, `applied`, `failed`, `superseded`. UNIQUE on
`(migration_identifier, environment)`.

---

## 6. Verification

The baseline control plane and execution gate are verified by:

- **Source-scanning tests** (`tests/phase1a-migration-governance.test.ts`):
  306 tests across 26 describe blocks, including dedicated sections for the
  lifecycle activation gate (GOV-09) and baseline control plane API (GOV-11).

- **PostgreSQL integration tests**
  (`tests/phase1a2-postgres-integration.test.ts`): 55 tests against a real
  PostgreSQL database, including governance lifecycle state machine
  transitions, baseline reconciliation operations, and the UNIQUE environment
  constraint.

- **TypeScript compilation:** `tsc --noEmit` passes with 0 errors.

---

## 7. Files Changed

| File | Commit | Change |
|------|--------|--------|
| `lib/migrations/ledger.ts` | `d3b4fff3` | `assertExecutionPermitted()` gate (EXECUTION_ENABLED only); `enableExecution()` and `disableExecution()` functions with reason recording |
| `lib/migrations/runner.ts` | `d3b4fff3` | `assertExecutionPermitted()` calls at `run-single` and `run-pending`; 423 Locked responses with guidance |
| `lib/migrations/runner.ts` | `d3b4fff3` | Re-export of `enableExecution`, `disableExecution`, `assertExecutionPermitted` |
| `app/api/admin/migrations/route.ts` | `d3b4fff3` | 5 new actions: `inspect-baseline`, `record-baseline-entry`, `verify-baseline`, `enable-execution`, `disable-execution` |
| `tests/phase1a-migration-governance.test.ts` | `d3b4fff3`, `4d4c6efa` | Tests for lifecycle gate and baseline control plane |
| `tests/phase1a2-postgres-integration.test.ts` | `611586a5`, `6268b71a` | Integration tests for lifecycle state machine and baseline operations |

---

## 8. Exclusions

Per the Phase 1A.2 authorization, this work does **not** include:
- Migration 105 or any new numbered SQL migration
- Organization tables, membership tables, active organization context
- Resource ownership, collaboration, billing, tenant cutover
- Changes to frozen MFA Phase 3 code (`lib/mfa.ts`)
- Production migration execution

The MFA Phase 3 code is imported from but never modified. TOTP verification
is performed by the frozen `lib/mfa.ts` module; the baseline control plane
API relies on TOTP verification that occurs earlier in the route handler.
