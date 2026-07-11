# Phase 1A.1 — Operational Hardening Audit (MIGRATION-GOV-02 through MIGRATION-GOV-08)

> **Document type:** Pre-implementation exact-state audit
> **Branch:** `dev`
> **Starting HEAD:** `4d390683` (Phase 1A final report commit)
> **Scope:** Operational hardening of Phase 1A migration governance ONLY.
> No org/membership/ownership/collaboration/billing/cutover implementation.
> No numbered SQL migration files created or modified.
> No MFA Phase 3 changes. Changes to the fixed bootstrap DDL inside
> migration-governance code are allowed (ledger has not been applied to any
> database yet).
>
> **Baseline established:**
> - `npx tsc --noEmit` — exit 0 (clean)
> - `npx vitest run tests/phase1a-migration-governance.test.ts` — 114/114 pass

## Purpose

This document records the exact state of the migration-governance code at the
start of Phase 1A.1, before any hardening changes are made. Each governance
risk (MIGRATION-GOV-02 through MIGRATION-GOV-08) is confirmed against the
actual source files with exact line numbers and code snippets. This audit
serves as the baseline against which all Phase 1A.1 changes are measured.

## Files Audited

| File | Lines | Role |
|------|-------|------|
| `lib/migrations/types.ts` | 309 | Shared type definitions and constants |
| `lib/migrations/ledger.ts` | 350 | Ledger bootstrap DDL, upsert/recording functions, audit emission |
| `lib/migrations/runner.ts` | 946 | Authorization, TOTP verification, SQL splitting, execution |
| `lib/migrations/manifest.ts` | 295 | File discovery, prefix extraction, duplicate detection |
| `lib/migrations/validation.ts` | 91 | SHA-256 checksum computation and verification |
| `app/api/admin/migrations/route.ts` | 300 | Canonical migration API route (GET/POST) |
| `app/api/migrate/route.ts` | ~1400 | Legacy inline migration runner (feature-flagged, disabled) |
| `app/api/admin/system-tools/route.ts` | 1014 | Legacy system tools (run_migration feature-flagged, disabled) |
| `app/api/admin/prospects/seed/route.ts` | 86 | Ungoverned prospect seed DDL path |
| `lib/auditLog.ts` | 400+ | Existing durable, hash-chained audit logging system |

---

## MIGRATION-GOV-02: Historical Applied-State Baseline Is Unknown

### Finding: CONFIRMED

The migration governance code has no concept of a historical baseline. When the
ledger is first bootstrapped into a database that already has migrations applied
(the production reality for SolarPro), the ledger table starts empty. Every
migration is then treated as `pending`, regardless of whether the schema objects
it creates already exist in the database.

### Exact Code Evidence

**`lib/migrations/runner.ts` — `inspectMigrationState()` and execution flow:**

The runner's `runSinglePendingMigration()` function (line 522) bootstraps the
ledger (line 570), then checks `readLedgerRow(identifier)` (line 602). On an
empty ledger, `existingRow` is `null`, so the code proceeds to
`markMigrationRunning` (line 688) and `executeMigrationInTransaction` (line 696)
without any baseline check.

There is no governance lifecycle state stored anywhere — not in the database,
not in a configuration table. The only "state" is the existence or
non-existence of rows in `schema_migrations`. An empty ledger means "everything
is pending," which is incorrect for a database where migrations 001–104 may
have already been applied outside the governance system.

**`lib/migrations/types.ts` — Missing lifecycle type:**

```typescript
// Line 28-34: MigrationStatus only has execution states, no baseline states
export type MigrationStatus =
  | 'pending'
  | 'running'
  | 'applied'
  | 'failed'
  | 'superseded';
```

There is no `MigrationGovernanceLifecycle` type. There is no
`BaselineReconciliationStatus` type. The code has no mechanism to distinguish
"the ledger is bootstrapped but the historical baseline has not been
reconciled" from "the ledger is bootstrapped and the baseline is verified."

### Impact

Running `runPendingMigrations()` on a populated database with an empty ledger
would attempt to re-apply all 101 migration files, most of which would fail
with "relation already exists" or "column already exists" errors. The code
treats this as a legitimate execution rather than blocking and requiring
baseline reconciliation first.

---

## MIGRATION-GOV-03: Ledger Attempt History Is Not Truly Append-Only

### Finding: CONFIRMED — Two upsert sites that overwrite prior attempt history

The ledger uses `ON CONFLICT (migration_identifier, environment) DO UPDATE SET`
in both the result recording and the "mark running" functions. This means each
migration+environment pair has exactly one row that is overwritten on every
attempt. Prior attempt details (previous `started_at`, `execution_id`,
`error_code`, `error_summary`, `applied_at`) are destroyed when a new attempt
is recorded.

### Exact Code Evidence

**`lib/migrations/ledger.ts` — `recordMigrationResult()` at line 228:**

```typescript
// Line 261-289: ON CONFLICT DO UPDATE overwrites all fields
await sql`
  INSERT INTO schema_migrations (
    migration_identifier, filename, checksum_sha256, description,
    status, started_at, applied_at, failed_at, execution_duration_ms,
    environment, applied_by_actor_type, applied_by_actor_id, execution_id,
    error_code, error_summary
  ) VALUES (
    ${params.identifier}, ${params.filename}, ${params.checksumSha256}, ${params.description},
    ${params.status}, ${params.startedAt ?? null}, ${appliedAt}, ${failedAt}, ${params.durationMs},
    ${environment}, ${params.actorType}, ${params.actorId}, ${params.executionId},
    ${params.errorCode ?? null}, ${params.errorSummary ?? null}
  )
  ON CONFLICT (migration_identifier, environment)
  DO UPDATE SET
    filename = EXCLUDED.filename,
    checksum_sha256 = EXCLUDED.checksum_sha256,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    started_at = EXCLUDED.started_at,
    applied_at = EXCLUDED.applied_at,
    failed_at = EXCLUDED.failed_at,
    execution_duration_ms = EXCLUDED.execution_duration_ms,
    applied_by_actor_type = EXCLUDED.applied_by_actor_type,
    applied_by_actor_id = EXCLUDED.applied_by_actor_id,
    execution_id = EXCLUDED.execution_id,
    error_code = EXCLUDED.error_code,
    error_summary = EXCLUDED.error_summary
`;
```

**`lib/migrations/ledger.ts` — `markMigrationRunning()` at line 314:**

```typescript
// Line 337-348: Same upsert pattern, overwrites prior state with 'running'
await sql`
  INSERT INTO schema_migrations (
    migration_identifier, filename, checksum_sha256, description,
    status, started_at, environment, applied_by_actor_type,
    applied_by_actor_id, execution_id
  ) VALUES (
    ${params.identifier}, ${params.filename}, ${params.checksumSha256}, ${params.description},
    'running', ${now}, ${environment}, ${params.actorType},
    ${params.actorId}, ${params.executionId}
  )
  ON CONFLICT (migration_identifier, environment)
  DO UPDATE SET
    filename = EXCLUDED.filename,
    checksum_sha256 = EXCLUDED.checksum_sha256,
    description = EXCLUDED.description,
    status = 'running',
    started_at = EXCLUDED.started_at,
    applied_by_actor_type = EXCLUDED.applied_by_actor_type,
    applied_by_actor_id = EXCLUDED.applied_by_actor_id,
    execution_id = EXCLUDED.execution_id,
    error_code = NULL,
    error_summary = NULL
`;
```

### Impact

If migration `073` is attempted, fails with `EXECUTION_ERROR`, and is later
retried and succeeds, the failure record is completely destroyed. The ledger
shows only the final successful attempt. There is no audit trail of the failed
attempt — no record of when it was attempted, who attempted it, what error
occurred, or how long it took. This violates the append-only history
requirement for enterprise governance.

The `MigrationStatus` type documentation (line 25-26) explicitly claims:
"the row is never deleted or mutated (append-only history)" — but the code
mutates the row on every attempt via `ON CONFLICT DO UPDATE`.

---

## MIGRATION-GOV-04: Non-Canonical Execution Paths Remain Recoverable

### Finding: CONFIRMED — Three non-canonical paths, two feature-flagged and one completely ungated

There are three execution paths that bypass the canonical migration governance
runner (`lib/migrations/runner.ts`). Two are gated behind feature flags that
default to disabled but can be re-enabled by setting environment variables,
restoring ungoverned DDL execution. The third has no feature flag at all.

### Exact Code Evidence

**Path 1: `app/api/migrate/route.ts` — Legacy inline runner:**

```typescript
// Line 67: Feature flag check
const legacyInlineEnabled = process.env.MIGRATION_LEGACY_INLINE_ENABLED === 'true';

// Line 92: When disabled, returns 423 Locked with a message telling the user
// how to re-enable it:
'To re-enable this legacy path (NOT recommended), set MIGRATION_LEGACY_INLINE_ENABLED=true.'
```

When `MIGRATION_LEGACY_INLINE_ENABLED=true` is set, the route executes raw DDL
directly using `neon()` — no ledger, no checksum, no transaction, no advisory
lock, no TOTP verification. The feature flag message itself instructs the user
how to restore ungoverned DDL execution.

**Path 2: `app/api/admin/system-tools/route.ts` — Legacy run_migration:**

```typescript
// Line 56: Feature flag check
const legacySystemToolsRunEnabled =
  process.env.MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED === 'true';

// Line 78: When disabled, returns 423 Locked:
'To re-enable this legacy path (NOT recommended), set MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED=true.'
```

When enabled, the `run_migration` case reads a `.sql` file, strips comments,
splits on `;`, and executes statements individually with `rawSql(stmt, [])` —
no transaction wrapping, no advisory lock, no ledger recording, and it
explicitly ignores "already exists" errors.

**Path 3: `app/api/admin/prospects/seed/route.ts` — Completely ungated DDL:**

```typescript
// Line 50-56: Reads 092 schema migration and executes directly
const schemaSql = fs.readFileSync(
  path.join(dir, "092_installer_prospects.sql"), "utf-8");
for (const stmt of schemaSql.split(";").map((s) => s.trim()).filter(Boolean)) {
  try { await sql(stmt, []); } catch (e) { /* ignore already exists */ }
}

// Line 63-68: Reads 093 seed migration and executes directly
const seedRaw = fs.readFileSync(
  path.join(dir, "093_seed_installer_prospects_batch1.sql"), "utf-8");
await sql(seedRaw, []);
```

This route:
- Reads numbered migration files (092, 093) directly from `lib/migrations/`
- Executes them via `neon()` with no governance controls
- Has NO feature flag gate
- Has NO advisory lock
- Has NO transaction wrapping
- Has NO ledger recording
- Has NO MFA/TOTP verification
- Has NO audit event emission
- Only requires `admin` role (not `super_admin`)
- Ignores "already exists" errors silently

This is a third non-canonical execution path that bypasses ALL governance
controls. Unlike the other two legacy paths, it cannot even be disabled via
an environment variable.

### Impact

Setting `MIGRATION_LEGACY_INLINE_ENABLED=true` or
`MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED=true` restores ungoverned DDL
execution that bypasses the ledger, checksum verification, advisory locking,
and MFA requirements. The prospects/seed route is always available to any
admin user. An operator who sets these flags (which the code's own error
messages instruct them how to do) can apply schema changes outside the
governance system, defeating the entire purpose of the migration governance
subsystem.

---

## MIGRATION-GOV-05: Human Migration MFA Can Fail Open or Permit TOTP Replay

### Finding: CONFIRMED — Fail-open defect and no replay prevention

Two distinct security defects exist in the MFA verification path:

1. `verifyFreshTotp()` returns `true` (success) when the user has no MFA secret,
   waiving the TOTP requirement entirely.
2. There is no TOTP replay prevention mechanism. The same TOTP code can be used
   for multiple migration executions within the same 30-second time window.

### Exact Code Evidence

**Fail-open defect — `lib/migrations/runner.ts` lines 222-237:**

```typescript
export async function verifyFreshTotp(adminUserId: string, code: string): Promise<boolean> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT totp_secret_encrypted FROM admin_users WHERE id = ${adminUserId} LIMIT 1
  `;
  const row = rows[0];
  if (!row || !row.totp_secret_encrypted) {
    // MFA not enabled for this user — requirement waived.
    return true;  // ← FAIL-OPEN DEFECT
  }
  const secret = decryptTOTPSecret(row.totp_secret_encrypted);
  return verifyTOTPCode(secret, code);
}
```

When `adminUserId` refers to a user with no `totp_secret_encrypted` (MFA not
enrolled), the function returns `true`. The `authorizeMigration()` function
(line 189) then treats this as `totpVerified = true` and allows execution. A
super_admin who has not enrolled in MFA can execute schema migrations without
any second factor.

**No TOTP replay prevention:**

Searching the entire `lib/migrations/` directory for any replay prevention
table or mechanism:

```
grep -rn "totp_uses\|migration_totp\|replay" lib/migrations/
→ (no results)
```

There is no `migration_totp_uses` table, no tracking of used TOTP time-steps,
no mechanism to prevent the same code from being used twice. The
`verifyTOTPCode()` function (from the MFA subsystem) validates the code against
the current time window but does not record that the code has been used. A
captured TOTP code can be replayed for a second mutation within the same
30-second window.

### Impact

A super_admin without MFA enrollment can execute migrations without a second
factor — this is a fail-open design that should be fail-closed. A captured or
observed TOTP code can be replayed for additional migrations within the time
window, violating the "one code, one mutation" principle for high-risk schema
operations.

### Test That Must Change

**`tests/phase1a-migration-governance.test.ts` line 773:**

```typescript
it('verifyFreshTotp waives requirement when MFA not enabled (no secret)', () => {
  expect(runnerSrc).toContain('MFA not enabled for this user');
});
```

This test currently **expects** the fail-open behavior and asserts that the
code contains the waive comment. After Phase 1A.1, this test must be changed
to expect DENY behavior instead — the code should deny execution when no MFA
secret exists, not waive the requirement.

---

## MIGRATION-GOV-06: Advisory-Lock Key Suffers JavaScript Number Precision Loss

### Finding: CONFIRMED — Proven precision loss and indefinite blocking lock

The advisory lock key `0x534f4c504d474452` is defined as a plain JavaScript
number. This value exceeds `Number.MAX_SAFE_INTEGER` (9007199254740991), so
JavaScript cannot represent it exactly. The actual value passed to PostgreSQL
is a rounded approximation, not the intended key. Additionally, the code uses
`pg_advisory_xact_lock` (which blocks indefinitely) rather than
`pg_try_advisory_xact_lock` (which has a bounded timeout).

### Exact Code Evidence

**`lib/migrations/types.ts` line 282:**

```typescript
export const MIGRATION_LOCK_KEY = 0x534f4c504d474452; // "SOLPMGDR"
```

**Precision loss proven via Node.js execution:**

```
JS number value:         6003100736085771000
Exact BigInt:            6003100736085771346n
JS number as BigInt:     6003100736085771264n
Difference (exact - js): 82n
Number.MAX_SAFE_INTEGER: 9007199254740991
Exceeds MAX_SAFE_INTEGER: true
```

The intended key value is `6003100736085771346` (the ASCII encoding of
"SOLPMGDR" as a 64-bit big-endian integer). JavaScript renders this as
`6003100736085771000`, a rounded approximation. When this number is sent to
PostgreSQL via the Neon driver, PostgreSQL receives `6003100736085771264` (the
exact value of the JS double-precision float reinterpreted as an integer),
which is a different key than intended. This means:

1. The lock is acquired on a key that is not the intended "SOLPMGDR" value.
2. If any other code path or tool uses the correct key, the locks will not
   collide, and the mutual exclusion guarantee is broken.

**Indefinite blocking — `lib/migrations/runner.ts` line 521:**

```typescript
await sql.transaction((txn) => [
  txn`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`,
  ...statements.map((stmt) => txn(stmt, [])),
]);
```

`pg_advisory_xact_lock` blocks indefinitely if the lock is already held. If a
previous migration execution crashed without releasing the lock (or if another
process holds it), the current execution will hang forever with no timeout.
The code should use `pg_try_advisory_xact_lock` which returns `true`/`false`
immediately, allowing a bounded timeout and graceful failure.

**`lib/migrations/ledger.ts` line 176 — Same pattern in bootstrap:**

```typescript
await sql.transaction((txn) => [
  txn`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`,
  ...statements.map((stmt) => txn(stmt, [])),
]);
```

**Documentation inconsistency:**

The comment at `ledger.ts` line 155 correctly states "transaction-scoped" but
other documentation may use "session-scoped" wording. The
`ARCHITECTURE-DECISION-MIGRATION-MODEL.md` document must be checked and
corrected where it describes the lock as session-scoped.

### Impact

The advisory lock does not protect what it claims to protect — the actual key
value used is an approximation, not the intended value. The indefinite blocking
behavior means a stuck lock can hang the entire migration system with no
recovery path short of killing the process.

### Tests That Must Change

**`tests/phase1a-migration-governance.test.ts` line 676:**

```typescript
it('bootstrap uses pg_advisory_xact_lock (transaction-scoped, not session-scoped)', () => {
  expect(ledgerSrc).toContain('pg_advisory_xact_lock');
  expect(ledgerSrc).toMatch(/pg_advisory_xact_lock\s*\(/);
  // ...
});
```

This test asserts `pg_advisory_xact_lock` is used. After Phase 1A.1, the code
should use `pg_try_advisory_xact_lock`, and this test must be updated.

**`tests/phase1a-migration-governance.test.ts` line 687:**

```typescript
it('MIGRATION_LOCK_KEY is a 64-bit integer constant', () => {
  const typesSrc = readSrc('lib/migrations/types.ts');
  expect(typesSrc).toMatch(/MIGRATION_LOCK_KEY\s*=\s*0x[0-9a-fA-F]+/);
});
```

This test only checks that the key matches a hex pattern. After Phase 1A.1,
a test must verify the exact decimal value `6003100736085771346` with no
precision loss.

---

## MIGRATION-GOV-07: Migration Audit Events Are Not Durably Persisted

### Finding: CONFIRMED — console.log only, but durable infrastructure exists

The `emitAuditEvent()` function writes structured JSON to `console.log` only.
Console output is ephemeral — it is not stored in a database, cannot be queried
after the fact, and is lost if the process restarts or if the log aggregator
misses the line. This is not durable enterprise audit recording.

However, SolarPro already has a durable, tamper-evident audit logging system in
`lib/auditLog.ts` that should be integrated with.

### Exact Code Evidence

**`lib/migrations/ledger.ts` lines 69-77:**

```typescript
export function emitAuditEvent(event: Omit<MigrationAuditEvent, 'timestamp'>): void {
  const fullEvent: MigrationAuditEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  // Structured JSON log line — parseable by log aggregators.
  console.log(JSON.stringify({ level: 'audit', ...fullEvent }));
}
```

The function is `void` (not `async`) and has no return value. It does not
write to any database table. The comment itself acknowledges this is for
log aggregators, not durable storage.

**`lib/migrations/types.ts` lines 232-238 — Acknowledges the limitation:**

```typescript
/**
 * An audit event emitted by the migration governance subsystem.
 *
 * Audit events are logged via console (structured JSON) and may be persisted to
 * an audit store in a future phase. Phase 1A logs them to console with a
 * structured format for observability.
 */
```

### Existing Durable Infrastructure (Integration Target)

**`lib/auditLog.ts` — `writeAuditLog()` function:**

SolarPro already has a production-grade, durable, tamper-evident audit logging
system. Key components:

```typescript
// Line 208: The durable audit function
export async function writeAuditLog(
  entry: Omit<AuditLogEntry, 'id' | 'prev_hash' | 'entry_hash' | 'timestamp'>,
  timestamp?: Date,
): Promise<string | null>
```

- **`audit_log` table**: PostgreSQL table that persists every audit entry with
  hash-chain integrity. Each entry includes a SHA-256 hash of the previous
  entry (`prev_hash`), making the chain tamper-evident.
- **`AuditCategory`** (line 25): Includes `'admin'`, `'security'`, `'config'`
  — suitable categories for migration governance events.
- **`AuditAction`** (line 35): Includes `'config_change'`,
  `'feature_flag_toggle'` — can be extended for migration-specific actions.
- **`redactMetadata()`**: Prevents sensitive data from entering audit entries.
- **Graceful degradation**: Falls back to `console.error` if the DB write fails.
- **`verifyChain()`**: Can verify the tamper-evidence of the audit chain.

This is the durable store that `emitAuditEvent` should integrate with. The
migration audit events should be persisted to `audit_log` via `writeAuditLog()`
with appropriate categories and actions, while console logging remains as
supplemental telemetry.

### Impact

Migration governance events (bootstrap, baseline, run, denied, conflict,
checksum mismatch, lock denied, legacy invoked) are not durably recorded. If
a log aggregator misses a line, or if the process restarts, the audit trail is
incomplete. For enterprise governance, audit events must be durably persisted
and tamper-evident. The infrastructure to do this already exists and only needs
integration.

---

## MIGRATION-GOV-08: Ledger Schema Constraints Are Insufficient

### Finding: CONFIRMED — Missing NOT NULL, no CHECK constraints

The `BOOTSTRAP_LEDGER_DDL` creates the `schema_migrations` table with
inadequate constraints. The `environment` column allows NULL, there are no
CHECK constraints on `status`, `checksum_sha256`, or `migration_identifier`
format, and there are no constraints enforcing the identifier grammar.

### Exact Code Evidence

**`lib/migrations/ledger.ts` lines 36-65:**

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id                      SERIAL PRIMARY KEY,
  migration_identifier    TEXT NOT NULL,
  filename                TEXT NOT NULL,
  checksum_sha256         TEXT NOT NULL,
  description             TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending',
  started_at              TIMESTAMPTZ,
  applied_at              TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,
  execution_duration_ms   INTEGER,
  environment             TEXT,           -- ← NOT NULL MISSING
  applied_by_actor_type   TEXT,
  applied_by_actor_id     TEXT,
  execution_id            TEXT,
  error_code              TEXT,
  error_summary           TEXT,
  rollback_reference      TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS schema_migrations_identifier_env_idx
  ON schema_migrations (migration_identifier, environment);
CREATE INDEX IF NOT EXISTS schema_migrations_status_idx
  ON schema_migrations (status);
```

Missing constraints:

1. **`environment TEXT` lacks `NOT NULL`** — A ledger row with no environment
   is meaningless. The environment must always be specified.

2. **No CHECK constraint on `status`** — Any string value can be inserted into
   `status`. There is no enforcement that it must be one of `pending`,
   `running`, `applied`, `failed`, or `superseded`. A bug could insert
   `'executing'` or `'unknown'` without a database-level error.

3. **No CHECK constraint on `checksum_sha256` format** — Any string can be
   inserted. There is no enforcement that it must be a 64-character lowercase
   hex string (SHA-256 format).

4. **No CHECK constraint on `migration_identifier` grammar** — Any string can
   be inserted. The manifest system produces identifiers matching
   `^[0-9]{3}[a-z]?$` (e.g., `073`, `074a`, `074b`), but the database does not
   enforce this. A bug could insert `'migration-073'` or `'73'` without a
   database-level error.

5. **No CHECK constraint on `applied_by_actor_type`** — Any string can be
   inserted. Should be restricted to `'human'` or `'migration-actor'`.

### Impact

The database does not enforce the invariants that the application code depends
on. Data corruption from bugs, race conditions, or direct SQL access can
produce rows that violate the expected schema constraints, leading to
incorrect governance decisions. The identifier grammar (`^[0-9]{3}[a-z]?$`)
that the manifest system relies on (including the `074a`/`074b` suffix
disambiguation) is not enforced at the database level.

---

## Transaction Compatibility Scan: All 101 Migration Files

A scan of all 101 migration SQL files (`lib/migrations/*.sql`) was performed
to identify transaction-incompatible statements that cannot run inside a
`BEGIN ... COMMIT` transaction block.

### Findings

| File | Statement Type | Count | Details |
|------|----------------|-------|---------|
| `017_perf_indexes.sql` | `CREATE INDEX CONCURRENTLY` | 4 | Lines 10, 15, 21, 26 |
| `019_query_perf_indexes.sql` | `CREATE INDEX CONCURRENTLY` | 3 | Lines 37, 47, 52 (line 29 is a comment) |
| `020_digital_signatures.sql` | `CREATE INDEX CONCURRENTLY` | 2 | Lines 20, 25 |

**No instances of:**
- `VACUUM` (cannot run in transaction)
- `REINDEX CONCURRENTLY` (cannot run in transaction)
- `ALTER TYPE ... ADD VALUE` (cannot run in transaction block in PostgreSQL < 12)

### Impact

The canonical runner wraps all migration statements in a single transaction
(`sql.transaction(...)`). If migration `017`, `019`, or `020` is executed
through the canonical runner, PostgreSQL will reject the
`CREATE INDEX CONCURRENTLY` statement with:

```
ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

The entire transaction will roll back, and the migration will be recorded as
`failed`. The runner needs a `transaction_mode` metadata field per migration
file (`REQUIRED`, `FORBIDDEN`, or `MANUAL_REVIEW`) so that
transaction-incompatible migrations are executed outside a transaction block
or flagged for manual review.

### Transaction Failure Recording Deficit

Additionally, the current execution flow has a transaction failure recording
gap:

1. `markMigrationRunning()` is called (line 688) — records `status='running'`
   via upsert.
2. `executeMigrationInTransaction()` is called (line 696) — if the transaction
   fails, it is rolled back, and the function returns `{ success: false }`.
3. `recordMigrationResult()` with `status='failed'` is called (line 712) —
   this runs OUTSIDE the rolled-back transaction, so the failure record
   survives.

However, there is no `STARTED` record inserted before the transaction begins
that would survive a process crash. If the process is killed between
`markMigrationRunning` and `recordMigrationResult`, the ledger shows
`status='running'` with no corresponding completion record. The
`markMigrationRunning` upsert also overwrites any prior `running` state,
losing the history of the previous attempt.

---

## Summary of Confirmed Defects

| Risk ID | Defect | Files Affected | Severity |
|---------|--------|----------------|----------|
| MIGRATION-GOV-02 | No historical baseline lifecycle; empty ledger treats all as pending | `runner.ts`, `types.ts` | High |
| MIGRATION-GOV-03 | `ON CONFLICT DO UPDATE` overwrites attempt history (not append-only) | `ledger.ts:261,337` | High |
| MIGRATION-GOV-04 | 3 non-canonical paths: 2 feature-flagged, 1 completely ungated | `migrate/route.ts`, `system-tools/route.ts`, `prospects/seed/route.ts` | Critical |
| MIGRATION-GOV-05 | TOTP fail-open (returns true with no secret); no replay prevention | `runner.ts:230` | Critical |
| MIGRATION-GOV-06 | Lock key precision loss (346-bit error); indefinite blocking lock | `types.ts:282`, `runner.ts:521`, `ledger.ts:176` | High |
| MIGRATION-GOV-07 | Audit events are console.log only (not durable); durable infra exists | `ledger.ts:69` | High |
| MIGRATION-GOV-08 | Missing NOT NULL on environment; no CHECK constraints on status/checksum/identifier | `ledger.ts:36-65` | Medium |

All 8 risks (MIGRATION-GOV-02 through MIGRATION-GOV-08) are confirmed against
the actual source code. The Phase 1A.1 implementation will resolve each of
these in the subsequent sections.
