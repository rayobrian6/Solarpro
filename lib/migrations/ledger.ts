// lib/migrations/ledger.ts
//
// Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
//
// The schema_migrations database ledger: creation (bootstrap), reading
// (inspection), and recording results.
//
// Bootstrap problem: The ledger must exist before it can record ordinary
// migrations. bootstrapMigrationLedger() creates the table via a fixed,
// idempotent DDL that runs outside the normal migration flow. This bootstrap is
// itself guarded by the advisory lock and authorization.
//
// Advisory locking: We use pg_advisory_xact_lock (transaction-scoped) rather than
// pg_advisory_lock (session-scoped) because Neon serverless uses short-lived
// HTTP connections — session-scoped locks would not persist across calls.
// Transaction-scoped locks are released automatically when the transaction
// commits or rolls back, which is the safe failure mode.

import { neon } from '@neondatabase/serverless';
import {
  MigrationLedgerRow,
  MigrationStatus,
  MigrationAuditEvent,
  MigrationActorType,
  MIGRATION_LOCK_KEY,
} from './types';
import { getNodeEnv } from '@/lib/env';

/**
 * The fixed bootstrap DDL that creates the schema_migrations ledger table.
 *
 * This is idempotent (IF NOT EXISTS) and is the ONLY DDL that runs outside the
 * normal migration transaction flow. It is executed by bootstrapMigrationLedger()
 * before any pending-migration logic.
 */
export const BOOTSTRAP_LEDGER_DDL = `
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
  environment             TEXT,
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
`;

/**
 * Emit a structured audit event to the console (observability).
 *
 * Phase 1A logs audit events as structured JSON to console. A future phase may
 * persist them to an audit store. This function is the single emission point.
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
 * Bootstrap the schema_migrations ledger table.
 *
 * This creates the table if it does not exist, using the fixed idempotent DDL.
 * It acquires an advisory lock first (to prevent concurrent bootstraps) and
 * emits audit events.
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

    // Acquire advisory lock and create the table in a single transaction.
    // pg_advisory_xact_lock is transaction-scoped — released on commit/rollback.
    //
    // NEON TRANSACTION CONSTRAINT: the callback must be SYNCHRONOUS and return an
    // array of query promises. No `await` inside the callback. We build the array
    // of queries (lock + all DDL statements) and return it in one shot.
    const statements = BOOTSTRAP_LEDGER_DDL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    await sql.transaction((txn) => [
      // First query: acquire the transaction-scoped advisory lock.
      txn`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`,
      // Subsequent queries: the bootstrap DDL statements.
      ...statements.map((stmt) => txn(stmt, [])),
    ]);

    emitAuditEvent({
      type: 'migration.bootstrap.completed',
      actorType,
      actorId,
      environment,
      executionId,
      migrationIdentifier: null,
      filename: null,
      details: { alreadyExisted: false, created: true },
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
 * Record a migration result in the ledger.
 *
 * This inserts a new row (for a fresh attempt) or updates the existing row for
 * the given (migration_identifier, environment) pair.
 *
 * Status transitions:
 * - `pending` → `running` (at start)
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

  // Upsert by (migration_identifier, environment).
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
 * Mark a migration as `running` in the ledger (at the start of execution).
 *
 * This is a lightweight insert/upsert that records the attempt has begun.
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
}
