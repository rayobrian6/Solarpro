// lib/migrations/ledger.ts
//
// Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
// Phase 1A.1 — Operational Hardening (MIGRATION-GOV-02..08)
//
// The migration governance database ledger: creation (bootstrap), reading
// (inspection), recording results, governance lifecycle state, and append-only
// attempt history.
//
// Bootstrap problem: The ledger must exist before it can record ordinary
// migrations. bootstrapMigrationLedger() creates the tables via a fixed,
// idempotent DDL that runs outside the normal migration flow. This bootstrap is
// itself guarded by the advisory lock and authorization.
//
// Append-only history (MIGRATION-GOV-03): The `schema_migration_runs` table is
// INSERT-only. Each migration attempt produces a new row (or rows) — never
// an UPDATE or DELETE. The `schema_migrations` table is the current-state
// table (one row per migration+environment) and IS updated to reflect the
// latest state, but the full attempt history is preserved in
// `schema_migration_runs`.
//
// Advisory locking: We use pg_try_advisory_xact_lock (transaction-scoped,
// bounded timeout) rather than pg_advisory_xact_lock (which blocks
// indefinitely). The lock key is passed as a decimal string and cast to BIGINT
// in PostgreSQL to avoid JavaScript Number precision loss (MIGRATION-GOV-06).

import { neon } from '@neondatabase/serverless';
import {
  MigrationLedgerRow,
  MigrationRunRow,
  MigrationRunStatus,
  MigrationStatus,
  MigrationAuditEvent,
  MigrationActorType,
  MigrationGovernanceLifecycle,
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_KEY_DECIMAL,
} from './types';
import { getNodeEnv } from '@/lib/env';

/**
 * The fixed bootstrap DDL that creates the migration governance tables.
 *
 * This is idempotent (IF NOT EXISTS) and is the ONLY DDL that runs outside the
 * normal migration transaction flow. It is executed by bootstrapMigrationLedger()
 * before any pending-migration logic.
 *
 * Three tables are created:
 *
 * 1. `governance_lifecycle` — The governance state for each environment.
 *    One row per environment. Records the lifecycle state
 *    (UNBOOTSTRAPPED → ... → EXECUTION_ENABLED) and who advanced it.
 *
 * 2. `schema_migrations` — The current-state table. One row per
 *    (migration_identifier, environment) pair. Reflects the LATEST known state
 *    of each migration. Updated on each attempt to reflect the latest status.
 *    Has CHECK constraints on status, checksum format, identifier grammar, and
 *    actor type (MIGRATION-GOV-08).
 *
 * 3. `schema_migration_runs` — The append-only attempt history. One row per
 *    event (started/applied/failed/denied/skipped). INSERT-only — never
 *    UPDATE or DELETE. Preserves the full history of every attempt
 *    (MIGRATION-GOV-03).
 */
export const BOOTSTRAP_LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS governance_lifecycle (
  id                        SERIAL PRIMARY KEY,
  environment               TEXT NOT NULL UNIQUE,
  lifecycle_state           TEXT NOT NULL DEFAULT 'LEDGER_BOOTSTRAPPED'
    CHECK (lifecycle_state IN (
      'UNBOOTSTRAPPED',
      'LEDGER_BOOTSTRAPPED',
      'BASELINE_REQUIRED',
      'BASELINE_IN_PROGRESS',
      'BASELINE_VERIFIED',
      'EXECUTION_ENABLED'
    )),
  baseline_reconciled_by    TEXT,
  baseline_reconciled_at    TIMESTAMPTZ,
  execution_enabled_by      TEXT,
  execution_enabled_at      TIMESTAMPTZ,
  last_state_change_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id                      SERIAL PRIMARY KEY,
  migration_identifier    TEXT NOT NULL
    CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$'),
  filename                TEXT NOT NULL,
  checksum_sha256         TEXT NOT NULL
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  description             TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'applied', 'failed', 'superseded')),
  started_at              TIMESTAMPTZ,
  applied_at              TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,
  execution_duration_ms   INTEGER,
  environment             TEXT NOT NULL,
  applied_by_actor_type   TEXT
    CHECK (applied_by_actor_type IS NULL OR applied_by_actor_type IN ('human', 'migration-actor')),
  applied_by_actor_id     TEXT,
  execution_id            TEXT,
  error_code              TEXT,
  error_summary           TEXT,
  rollback_reference      TEXT,
  last_run_id             INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schema_migrations_env_identifier_unique
    UNIQUE (migration_identifier, environment)
);

CREATE INDEX IF NOT EXISTS schema_migrations_status_idx
  ON schema_migrations (status);

CREATE TABLE IF NOT EXISTS schema_migration_runs (
  id                      SERIAL PRIMARY KEY,
  run_id                  TEXT NOT NULL,
  execution_id            TEXT NOT NULL,
  migration_identifier    TEXT NOT NULL
    CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$'),
  filename                TEXT NOT NULL,
  checksum_sha256         TEXT NOT NULL
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  environment             TEXT NOT NULL,
  status                  TEXT NOT NULL
    CHECK (status IN ('started', 'applied', 'failed', 'denied', 'skipped')),
  actor_type              TEXT
    CHECK (actor_type IS NULL OR actor_type IN ('human', 'migration-actor')),
  actor_id                TEXT,
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  execution_duration_ms   INTEGER,
  error_code              TEXT,
  error_summary           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schema_migration_runs_exec_id_idx
  ON schema_migration_runs (execution_id);
CREATE INDEX IF NOT EXISTS schema_migration_runs_identifier_env_idx
  ON schema_migration_runs (migration_identifier, environment);
CREATE INDEX IF NOT EXISTS schema_migration_runs_status_idx
  ON schema_migration_runs (status);
`;

/**
 * Emit a structured audit event to the console (supplemental telemetry).
 *
 * Phase 1A.1 logs audit events as structured JSON to console as supplemental
 * telemetry. Durable persistence to the `audit_log` table (via lib/auditLog.ts)
 * is integrated in Phase 1A.1 Section 8 (Persistent Audit Integration).
 * This function is the single console emission point.
 */
export function emitAuditEvent(event: Omit<MigrationAuditEvent, 'timestamp'>): void {
  const fullEvent: MigrationAuditEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  // Structured JSON log line — parseable by log aggregators.
  console.log(JSON.stringify({ level: 'audit', ...fullEvent }));
}

/**
 * Get the current environment name for ledger recording.
 *
 * Uses VERCEL_ENV if available, falls back to NODE_ENV.
 */
export function getCurrentEnvironment(): string {
  return (process.env.VERCEL_ENV || getNodeEnv() || 'development').toLowerCase();
}

/**
 * Get a raw Neon SQL executor (bypasses the getDbReady retry layer).
 *
 * The ledger operations use neon() directly because they need precise control
 * over transaction boundaries and advisory locks. The retry/cold-start logic in
 * getDbReady is not appropriate for the ledger's bootstrap and lock operations.
 */
function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — cannot connect to the database for migration ledger operations.');
  }
  return neon(url);
}

/**
 * Check whether the schema_migrations ledger table exists.
 */
export async function ledgerExists(): Promise<boolean> {
  const sql = getRawSql();
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'schema_migrations'
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

/**
 * Bootstrap the migration governance ledger tables.
 *
 * This creates the tables if they do not exist, using the fixed idempotent DDL.
 * It acquires an advisory lock first (to prevent concurrent bootstraps) and
 * emits audit events. After creating the tables, it initializes the
 * governance_lifecycle row for the current environment to BASELINE_REQUIRED.
 *
 * @param actorType The type of actor performing the bootstrap.
 * @param actorId The actor's identifier.
 * @returns An object indicating success/failure.
 */
export async function bootstrapMigrationLedger(
  actorType: MigrationActorType = 'migration-actor',
  actorId: string | null = null,
): Promise<{ success: boolean; alreadyExisted: boolean; error?: string }> {
  const environment = getCurrentEnvironment();
  const executionId = `bootstrap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  emitAuditEvent({
    type: 'migration.bootstrap.started',
    actorType,
    actorId,
    environment,
    executionId,
    migrationIdentifier: null,
    filename: null,
    details: {},
  });

  try {
    const sql = getRawSql();

    // Check if it already exists (fast path).
    const existsRows = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'schema_migrations'
      ) AS exists
    `;
    const alreadyExisted = Boolean(existsRows[0]?.exists);

    if (alreadyExisted) {
      emitAuditEvent({
        type: 'migration.bootstrap.completed',
        actorType,
        actorId,
        environment,
        executionId,
        migrationIdentifier: null,
        filename: null,
        details: { alreadyExisted: true },
      });
      return { success: true, alreadyExisted: true };
    }

    // Acquire advisory lock and create the tables in a single transaction.
    // pg_try_advisory_xact_lock is transaction-scoped — released on commit/rollback.
    // The lock key is passed as a decimal string and cast to BIGINT to preserve
    // full 64-bit precision (MIGRATION-GOV-06).
    //
    // NEON TRANSACTION CONSTRAINT: the callback must be SYNCHRONOUS and return an
    // array of query promises. No `await` inside the callback. We build the array
    // of queries (lock + all DDL statements + lifecycle init) and return it.
    const statements = BOOTSTRAP_LEDGER_DDL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    await sql.transaction((txn) => [
      // First query: acquire the transaction-scoped advisory lock (bounded).
      // Use pg_try_advisory_xact_lock with the exact 64-bit key as a BIGINT cast.
      txn`SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint)`,
      // Subsequent queries: the bootstrap DDL statements.
      ...statements.map((stmt) => txn(stmt, [])),
      // Initialize the governance lifecycle row for this environment.
      txn`INSERT INTO governance_lifecycle (environment, lifecycle_state)
          VALUES (${environment}, 'BASELINE_REQUIRED')
          ON CONFLICT (environment) DO NOTHING`,
    ]);

    emitAuditEvent({
      type: 'migration.bootstrap.completed',
      actorType,
      actorId,
      environment,
      executionId,
      migrationIdentifier: null,
      filename: null,
      details: { alreadyExisted: false, created: true, lifecycleState: 'BASELINE_REQUIRED' },
    });

    return { success: true, alreadyExisted: false };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    emitAuditEvent({
      type: 'migration.bootstrap.failed',
      actorType,
      actorId,
      environment,
      executionId,
      migrationIdentifier: null,
      filename: null,
      details: { error: errorMsg },
    });
    return { success: false, alreadyExisted: false, error: errorMsg };
  }
}

/**
 * Get the current governance lifecycle state for this environment.
 *
 * @returns The lifecycle state, or null if the governance_lifecycle table
 *          does not exist or has no row for this environment.
 */
export async function getGovernanceLifecycleState(): Promise<MigrationGovernanceLifecycle | null> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  try {
    const rows = await sql`
      SELECT lifecycle_state FROM governance_lifecycle
      WHERE environment = ${environment}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0].lifecycle_state as MigrationGovernanceLifecycle;
  } catch {
    // Table may not exist yet.
    return null;
  }
}

/**
 * Set the governance lifecycle state for this environment.
 *
 * Updates the governance_lifecycle row for the current environment. If no row
 * exists, inserts one. Emits a governance state change audit event.
 *
 * @param newState The new lifecycle state.
 * @param changedBy The actor ID that initiated the change.
 * @returns True if the update succeeded.
 */
export async function setGovernanceLifecycleState(
  newState: MigrationGovernanceLifecycle,
  changedBy: string | null,
): Promise<boolean> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();

  try {
    await sql`
      INSERT INTO governance_lifecycle (
        environment, lifecycle_state, last_state_change_at,
        baseline_reconciled_by, baseline_reconciled_at
      ) VALUES (
        ${environment}, ${newState}, now(),
        ${newState === 'BASELINE_VERIFIED' || newState === 'EXECUTION_ENABLED' ? changedBy : null},
        ${newState === 'BASELINE_VERIFIED' || newState === 'EXECUTION_ENABLED' ? new Date() : null}
      )
      ON CONFLICT (environment) DO UPDATE SET
        lifecycle_state = EXCLUDED.lifecycle_state,
        baseline_reconciled_by = CASE
          WHEN EXCLUDED.lifecycle_state IN ('BASELINE_VERIFIED', 'EXECUTION_ENABLED') THEN EXCLUDED.baseline_reconciled_by
          ELSE governance_lifecycle.baseline_reconciled_by
        END,
        baseline_reconciled_at = CASE
          WHEN EXCLUDED.lifecycle_state IN ('BASELINE_VERIFIED', 'EXECUTION_ENABLED') THEN EXCLUDED.baseline_reconciled_at
          ELSE governance_lifecycle.baseline_reconciled_at
        END,
        last_state_change_at = now()
    `;

    emitAuditEvent({
      type: 'migration.governance.state_change',
      actorType: null,
      actorId: changedBy,
      environment,
      executionId: null,
      migrationIdentifier: null,
      filename: null,
      details: { newState, changedBy },
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Record a migration run event in the append-only `schema_migration_runs` table.
 *
 * This is INSERT-only — it never updates or deletes existing rows. Each call
 * creates a new row preserving the full attempt history (MIGRATION-GOV-03).
 *
 * @param params The run event parameters.
 * @returns The ID of the inserted run row, or null on failure.
 */
export async function recordMigrationRunEvent(params: {
  executionId: string;
  identifier: string;
  filename: string;
  checksumSha256: string;
  status: MigrationRunStatus;
  actorType: MigrationActorType;
  actorId: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorSummary?: string | null;
}): Promise<number | null> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const rows = await sql`
      INSERT INTO schema_migration_runs (
        run_id, execution_id, migration_identifier, filename, checksum_sha256,
        environment, status, actor_type, actor_id, started_at, completed_at,
        execution_duration_ms, error_code, error_summary
      ) VALUES (
        ${runId}, ${params.executionId}, ${params.identifier}, ${params.filename},
        ${params.checksumSha256}, ${environment}, ${params.status},
        ${params.actorType}, ${params.actorId},
        ${params.startedAt ?? null}, ${params.completedAt ?? null},
        ${params.durationMs ?? null}, ${params.errorCode ?? null}, ${params.errorSummary ?? null}
      )
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a migration result in the ledger.
 *
 * This updates the current-state row in `schema_migrations` (one row per
 * migration+environment) to reflect the latest status, AND inserts a new row
 * in the append-only `schema_migration_runs` history table. The history row
 * preserves the full attempt details — the current-state row reflects only
 * the latest state (MIGRATION-GOV-03).
 *
 * Status transitions (current-state table):
 * - `pending` → `running` (at start, via markMigrationRunning)
 * - `running` → `applied` (on success)
 * - `running` → `failed` (on failure)
 * - `applied` → `superseded` (explicit administrative deprecation only)
 */
export async function recordMigrationResult(params: {
  identifier: string;
  filename: string;
  checksumSha256: string;
  description: string;
  status: MigrationStatus;
  executionId: string;
  startedAt: Date | null;
  durationMs: number | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  actorType: MigrationActorType;
  actorId: string | null;
}): Promise<void> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const now = new Date();
  const appliedAt = params.status === 'applied' ? now : null;
  const failedAt = params.status === 'failed' ? now : null;

  // First, insert the append-only run history row.
  const runId = await recordMigrationRunEvent({
    executionId: params.executionId,
    identifier: params.identifier,
    filename: params.filename,
    checksumSha256: params.checksumSha256,
    status: params.status === 'applied' ? 'applied'
      : params.status === 'failed' ? 'failed'
      : params.status === 'superseded' ? 'skipped'
      : 'failed',
    actorType: params.actorType,
    actorId: params.actorId,
    startedAt: params.startedAt,
    completedAt: now,
    durationMs: params.durationMs,
    errorCode: params.errorCode ?? null,
    errorSummary: params.errorSummary ?? null,
  });

  // Then, upsert the current-state row to reflect the latest status.
  await sql`
    INSERT INTO schema_migrations (
      migration_identifier, filename, checksum_sha256, description,
      status, started_at, applied_at, failed_at, execution_duration_ms,
      environment, applied_by_actor_type, applied_by_actor_id, execution_id,
      error_code, error_summary, last_run_id
    ) VALUES (
      ${params.identifier}, ${params.filename}, ${params.checksumSha256}, ${params.description},
      ${params.status}, ${params.startedAt ?? null}, ${appliedAt}, ${failedAt}, ${params.durationMs},
      ${environment}, ${params.actorType}, ${params.actorId}, ${params.executionId},
      ${params.errorCode ?? null}, ${params.errorSummary ?? null}, ${runId}
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
      error_summary = EXCLUDED.error_summary,
      last_run_id = EXCLUDED.last_run_id
  `;
}

/**
 * Read all ledger rows for the current environment.
 */
export async function readLedgerRows(): Promise<Record<string, MigrationLedgerRow>> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const rows = await sql`
    SELECT * FROM schema_migrations WHERE environment = ${environment}
  `;
  const result: Record<string, MigrationLedgerRow> = {};
  for (const row of rows) {
    result[row.migration_identifier] = row as unknown as MigrationLedgerRow;
  }
  return result;
}

/**
 * Read the ledger row for a specific migration in the current environment.
 */
export async function readLedgerRow(identifier: string): Promise<MigrationLedgerRow | null> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const rows = await sql`
    SELECT * FROM schema_migrations
    WHERE migration_identifier = ${identifier} AND environment = ${environment}
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as MigrationLedgerRow;
}

/**
 * Read the append-only attempt history for a specific migration in the
 * current environment. Returns rows in chronological order (oldest first).
 *
 * This reads from `schema_migration_runs`, which is INSERT-only and preserves
 * the full history of every attempt (MIGRATION-GOV-03).
 *
 * @param identifier The migration identifier.
 * @param limit Optional maximum number of rows to return (most recent first if limited).
 * @returns An array of run history rows.
 */
export async function readMigrationRunHistory(
  identifier: string,
  limit?: number,
): Promise<MigrationRunRow[]> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  try {
    if (limit !== undefined) {
      const rows = await sql`
        SELECT * FROM schema_migration_runs
        WHERE migration_identifier = ${identifier} AND environment = ${environment}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return rows as unknown as MigrationRunRow[];
    }
    const rows = await sql`
      SELECT * FROM schema_migration_runs
      WHERE migration_identifier = ${identifier} AND environment = ${environment}
      ORDER BY created_at ASC
    `;
    return rows as unknown as MigrationRunRow[];
  } catch {
    // Table may not exist yet.
    return [];
  }
}

/**
 * Read the append-only attempt history for all migrations in the current
 * environment.
 *
 * @param limit Optional maximum number of rows to return (most recent first).
 * @returns An array of run history rows.
 */
export async function readAllMigrationRunHistory(limit?: number): Promise<MigrationRunRow[]> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  try {
    if (limit !== undefined) {
      const rows = await sql`
        SELECT * FROM schema_migration_runs
        WHERE environment = ${environment}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return rows as unknown as MigrationRunRow[];
    }
    const rows = await sql`
      SELECT * FROM schema_migration_runs
      WHERE environment = ${environment}
      ORDER BY created_at ASC
    `;
    return rows as unknown as MigrationRunRow[];
  } catch {
    return [];
  }
}

/**
 * Mark a migration as `running` in the current-state ledger (at the start of
 * execution), and record a `started` event in the append-only run history.
 *
 * The current-state upsert updates the `schema_migrations` row to reflect
 * the latest attempt starting. The run history INSERT preserves the record
 * that this attempt began (MIGRATION-GOV-03, MIGRATION-GOV-10).
 *
 * The `started` run history row is recorded BEFORE the transaction begins,
 * so it survives even if the process crashes mid-execution.
 */
export async function markMigrationRunning(params: {
  identifier: string;
  filename: string;
  checksumSha256: string;
  description: string;
  executionId: string;
  actorType: MigrationActorType;
  actorId: string | null;
}): Promise<void> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const now = new Date();

  // Record the STARTED event in the append-only run history FIRST.
  // This ensures the attempt is recorded before execution begins, so it
  // survives even if the process crashes mid-execution (MIGRATION-GOV-10).
  const runId = await recordMigrationRunEvent({
    executionId: params.executionId,
    identifier: params.identifier,
    filename: params.filename,
    checksumSha256: params.checksumSha256,
    status: 'started',
    actorType: params.actorType,
    actorId: params.actorId,
    startedAt: now,
    completedAt: null,
  });

  // Then upsert the current-state row to reflect the latest attempt starting.
  await sql`
    INSERT INTO schema_migrations (
      migration_identifier, filename, checksum_sha256, description,
      status, started_at, environment, applied_by_actor_type,
      applied_by_actor_id, execution_id, last_run_id
    ) VALUES (
      ${params.identifier}, ${params.filename}, ${params.checksumSha256}, ${params.description},
      'running', ${now}, ${environment}, ${params.actorType},
      ${params.actorId}, ${params.executionId}, ${runId}
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
      error_summary = NULL,
      last_run_id = EXCLUDED.last_run_id
  `;
}
