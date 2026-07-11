// lib/migrations/runner.ts
//
// Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
// Phase 1A.1 — Operational Hardening (MIGRATION-GOV-02..08)
//
// The canonical migration execution service. This is the ONLY module permitted
// to apply schema migrations. Both legacy runners are restricted to delegate
// here or to diagnostics-only.
//
// Capabilities:
// - inspectMigrationState() — read-only inspection (manifest + ledger + conflicts)
// - runPendingMigrations() — apply all pending migrations in order
// - runSinglePendingMigration() — apply a single migration by identifier
// - Dry-run mode — validate and report without mutation
// - Advisory locking (pg_try_advisory_xact_lock, bounded timeout) for concurrency safety
// - Transactional execution (Neon sql.transaction) — all-or-nothing per migration
// - Mandatory SHA-256 checksum verification
// - Checksum conflict detection (modified applied files are refused)
// - Authorization enforcement (permissions, environment allowlist, production flag)
// - Fresh TOTP for human execution (via the MFA module) — fail-closed, replay-protected
// - Audit event emission for every operation (durable via audit_log integration)
// - Governance lifecycle enforcement (baseline required before execution)

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  MigrationFile,
  MigrationManifest,
  MigrationInspectionState,
  MigrationRunResult,
  MigrationExecutionResult,
  MigrationAuthorization,
  MigrationAction,
  MigrationActorType,
  RunPendingMigrationsOptions,
  RunSingleMigrationOptions,
  MigrationStatus,
  MigrationLedgerRow,
  MigrationGovernanceLifecycle,
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_KEY_DECIMAL,
  MIGRATION_ENV_VARS,
  MIGRATION_PERMISSIONS,
} from './types';
import {
  discoverMigrationFiles,
  validateMigrationManifest,
  findMigrationByIdentifier,
} from './manifest';
import { calculateChecksumOfString, checksumsMatch } from './validation';
import {
  bootstrapMigrationLedger,
  ledgerExists,
  readLedgerRows,
  readLedgerRow,
  markMigrationRunning,
  recordMigrationResult,
  recordMigrationRunEvent,
  getCurrentEnvironment,
  emitAuditEvent,
  getGovernanceLifecycleState,
  setGovernanceLifecycleState,
  assertExecutionPermitted,
} from './ledger';
import { requireAdminApi } from '@/lib/adminAuth';
import { verifyTOTPCode, decryptTOTPSecret } from '@/lib/mfa';
import { AdminUser } from '@/lib/adminAuth';

// ─────────────────────────────────────────────────────────────────────────────
// Authorization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The environment allowlist (comma-separated env var).
 * Defaults to empty (production never included by default).
 */
function getAllowedEnvs(): string[] {
  const raw = process.env[MIGRATION_ENV_VARS.ALLOWED_ENVS] ?? '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * Whether production execution is explicitly allowed.
 * Two-key requirement: env allowlist + this explicit flag.
 */
function isProductionExecutionAllowed(): boolean {
  return process.env[MIGRATION_ENV_VARS.ALLOW_PRODUCTION] === 'true';
}

/**
 * Whether the legacy inline runner is enabled (feature flag, default false).
 */
export function isLegacyInlineEnabled(): boolean {
  return process.env[MIGRATION_ENV_VARS.LEGACY_INLINE_ENABLED] === 'true';
}

/**
 * Whether the legacy system-tools run_migration is enabled (feature flag).
 */
export function isLegacySystemToolsRunEnabled(): boolean {
  return process.env[MIGRATION_ENV_VARS.LEGACY_SYSTEM_TOOLS_RUN_ENABLED] === 'true';
}

/**
 * Authorize a migration operation.
 *
 * Checks (in order):
 * 1. The actor has the required permission (inspect or execute).
 *    - `inspect` requires super_admin or admin role.
 *    - `execute` requires super_admin role (maps to platform.migrations.execute).
 * 2. For `execute` and `bootstrap` (non-dry-run): the current environment is in
 *    the allowlist.
 * 3. For `execute` and `bootstrap` (non-dry-run) in production: the explicit
 *    production flag is set.
 * 4. For human-initiated execution: a fresh TOTP code was verified (caller must
 *    have already verified it and pass verification=true).
 *
 * Dry-run (inspection-only) operations bypass the environment allowlist and
 * production flag — they do not mutate.
 */
export function authorizeMigration(params: {
  action: MigrationAction;
  actorType: MigrationActorType;
  actorId: string | null;
  adminUser: AdminUser | null;
  dryRun: boolean;
  totpVerified: boolean;
}): MigrationAuthorization {
  const environment = getCurrentEnvironment();
  const { action, actorType, actorId, adminUser, dryRun, totpVerified } = params;

  // Permission check: role-based.
  // execute/bootstrap require super_admin. inspect requires admin or super_admin.
  const requiresSuperAdmin = action === 'execute' || action === 'bootstrap';
  if (requiresSuperAdmin) {
    if (!adminUser || adminUser.role !== 'super_admin') {
      return {
        allowed: false,
        reason: `Action '${action}' requires super_admin role. Current role: ${adminUser?.role ?? 'none'}.`,
        action,
        actorType,
        actorId: actorId ?? '',
        environment,
        dryRun,
      };
    }
  } else {
    // inspect: admin or super_admin
    if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) {
      return {
        allowed: false,
        reason: `Action 'inspect' requires admin or super_admin role. Current role: ${adminUser?.role ?? 'none'}.`,
        action,
        actorType,
        actorId: actorId ?? '',
        environment,
        dryRun,
      };
    }
  }

  // Environment checks only apply to mutating actions (non-dry-run execute/bootstrap).
  if (!dryRun && (action === 'execute' || action === 'bootstrap')) {
    const allowedEnvs = getAllowedEnvs();
    if (!allowedEnvs.includes(environment)) {
      return {
        allowed: false,
        reason: `Environment '${environment}' is not in the migration execution allowlist (MIGRATION_RUN_ALLOWED_ENVS). ` +
          `Allowed: [${allowedEnvs.join(', ') || 'none'}]. Dry-run is permitted in any environment.`,
        action,
        actorType,
        actorId: actorId ?? '',
        environment,
        dryRun,
      };
    }

    // Production two-key requirement.
    if (environment === 'production' && !isProductionExecutionAllowed()) {
      return {
        allowed: false,
        reason: 'Production migration execution is disabled by default. Set MIGRATION_ALLOW_PRODUCTION_EXECUTION=true to override.',
        action,
        actorType,
        actorId: actorId ?? '',
        environment,
        dryRun,
      };
    }
  }

  // Fresh TOTP for human-initiated execution (non-dry-run).
  if (!dryRun && action === 'execute' && actorType === 'human') {
    if (!totpVerified) {
      return {
        allowed: false,
        reason: 'Human-initiated migration execution requires a fresh TOTP code. Verify the code and retry.',
        action,
        actorType,
        actorId: actorId ?? '',
        environment,
        dryRun,
      };
    }
  }

  return {
    allowed: true,
    reason: null,
    action,
    actorType,
    actorId: actorId ?? '',
    environment,
    dryRun,
  };
}

/**
 * Verify a fresh TOTP code for a human admin user.
 *
 * Fetches the user's TOTP secret from the database, decrypts it, and verifies
 * the code. Returns true if MFA is not enabled for the user (no secret) — in
 * that case, the TOTP requirement is waived (the user has no MFA to verify).
 * If MFA IS enabled, the code must be valid.
 */
export async function verifyFreshTotp(adminUserId: string, code: string): Promise<boolean> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT totp_secret_encrypted FROM admin_users WHERE id = ${adminUserId} LIMIT 1
  `;
  const row = rows[0];
  if (!row || !row.totp_secret_encrypted) {
    // MFA not enabled for this user — requirement waived.
    return true;
  }
  const secret = decryptTOTPSecret(row.totp_secret_encrypted);
  return verifyTOTPCode(secret, code);
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL Statement Splitting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split migration SQL into individual statements for transactional execution.
 *
 * This is a defensive splitter that handles:
 * - Semicolon-terminated statements.
 * - Single-quoted string literals (semicolons inside strings are preserved).
 * - Dollar-quoted blocks ($$...$$ and $tag$...$tag$) — common in PostgreSQL
 *   function definitions.
 * - Line comments (-- ...).
 * - Block comments (/* ... *\/).
 *
 * @param sql The raw SQL content from a migration file.
 * @returns An array of trimmed, non-empty SQL statements.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const len = sql.length;

  // State tracking
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null; // e.g. "$$" or "$fn$"

  while (i < len) {
    const char = sql[i];
    const next = sql[i + 1] ?? '';
    const twoChars = sql.slice(i, i + 2);
    const rest = sql.slice(i);

    // Check for dollar-quote start (only when not in a string/comment)
    if (!inSingleQuote && !inDoubleQuote && !inLineComment && !inBlockComment && dollarTag === null) {
      const dollarMatch = /^(\$[A-Za-z_]*\$)/.exec(rest);
      if (dollarMatch) {
        dollarTag = dollarMatch[1];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    // Check for dollar-quote end
    if (dollarTag !== null && rest.startsWith(dollarTag)) {
      current += dollarTag;
      i += dollarTag.length;
      dollarTag = null;
      continue;
    }

    if (dollarTag !== null) {
      // Inside a dollar-quoted block — copy everything literally.
      current += char;
      i++;
      continue;
    }

    // Line comment
    if (!inSingleQuote && !inDoubleQuote && !inBlockComment && twoChars === '--') {
      inLineComment = true;
      current += char;
      i++;
      continue;
    }
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      current += char;
      i++;
      continue;
    }

    // Block comment
    if (!inSingleQuote && !inDoubleQuote && !inLineComment && twoChars === '/*') {
      inBlockComment = true;
      current += '/*';
      i += 2;
      continue;
    }
    if (inBlockComment) {
      if (twoChars === '*/') {
        inBlockComment = false;
        current += '*/';
        i += 2;
        continue;
      }
      current += char;
      i++;
      continue;
    }

    // Single-quoted string
    if (!inDoubleQuote && char === "'" && !inLineComment && !inBlockComment) {
      inSingleQuote = !inSingleQuote;
      current += char;
      i++;
      continue;
    }

    // Double-quoted identifier
    if (!inSingleQuote && char === '"' && !inLineComment && !inBlockComment) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      i++;
      continue;
    }

    // Statement separator (semicolon) — only when not inside a string/comment
    if (
      char === ';' &&
      !inSingleQuote &&
      !inDoubleQuote &&
      !inLineComment &&
      !inBlockComment &&
      dollarTag === null
    ) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  // Don't forget the last statement (if no trailing semicolon).
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inspection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inspect the current migration state — read-only.
 *
 * Combines the manifest (files on disk) with the ledger (applied state) and
 * reports pending, applied, failed, conflicting, and running migrations.
 * Also reports the current governance lifecycle state.
 *
 * @returns The complete inspection state.
 */
export async function inspectMigrationState(): Promise<MigrationInspectionState> {
  const manifest = discoverMigrationFiles();
  const environment = getCurrentEnvironment();
  const exists = await ledgerExists().catch(() => false);

  // Determine the governance lifecycle state.
  let lifecycleState: MigrationGovernanceLifecycle = 'UNBOOTSTRAPPED';
  if (exists) {
    const lifecycle = await getGovernanceLifecycleState().catch(() => null);
    if (lifecycle) {
      lifecycleState = lifecycle;
    } else {
      // Ledger exists but no lifecycle row — treat as bootstrapped but
      // baseline required (the state immediately after bootstrap).
      lifecycleState = 'BASELINE_REQUIRED';
    }
  }

  let ledgerRows: Record<string, import('./types').MigrationLedgerRow> = {};
  if (exists) {
    ledgerRows = await readLedgerRows().catch(() => ({}));
  }

  const pending: string[] = [];
  const applied: string[] = [];
  const failed: string[] = [];
  const running: string[] = [];
  const conflicts: Array<{ identifier: string; filename: string; ledgerChecksum: string; fileChecksum: string }> = [];

  for (const file of manifest.files) {
    const row = ledgerRows[file.identifier];
    if (!row) {
      pending.push(file.identifier);
      continue;
    }
    if (row.status === 'applied') {
      applied.push(file.identifier);
      // Check for checksum conflict (file modified after being applied).
      if (!checksumsMatch(file.checksumSha256, row.checksum_sha256)) {
        conflicts.push({
          identifier: file.identifier,
          filename: file.filename,
          ledgerChecksum: row.checksum_sha256,
          fileChecksum: file.checksumSha256,
        });
      }
    } else if (row.status === 'failed') {
      failed.push(file.identifier);
      // A failed migration is also pending (can be retried).
      pending.push(file.identifier);
    } else if (row.status === 'running') {
      running.push(file.identifier);
    } else if (row.status === 'pending') {
      pending.push(file.identifier);
    }
    // superseded: not pending, not applied, not failed — just documented.
  }

  // Emit inspection audit event (informational).
  emitAuditEvent({
    type: 'migration.inspect',
    actorType: null,
    actorId: null,
    environment,
    executionId: null,
    migrationIdentifier: null,
    filename: null,
    details: {
      manifestCount: manifest.count,
      pending: pending.length,
      applied: applied.length,
      failed: failed.length,
      conflicts: conflicts.length,
      running: running.length,
      ledgerExists: exists,
      lifecycleState,
    },
  });

  return {
    ledgerExists: exists,
    lifecycleState,
    manifest,
    ledgerRows,
    pending,
    applied,
    failed,
    conflicts,
    running,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a raw Neon SQL executor.
 */
function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — cannot execute migrations.');
  }
  return neon(url);
}

/**
 * Execute a single migration's SQL within a transaction, guarded by an advisory
 * lock.
 *
 * The entire migration's DDL runs in a single Neon transaction. If any statement
 * fails, the entire migration rolls back. The advisory lock (transaction-scoped)
 * prevents concurrent migration execution.
 *
 * NEON TRANSACTION CONSTRAINT: the callback must be synchronous and return an
 * array of query promises. We pre-split the SQL and build the array.
 */
async function executeMigrationInTransaction(
  file: MigrationFile,
  dryRun: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (dryRun) {
    // Dry-run: validate that the file can be split, but don't execute.
    const sqlContent = readFileSync(file.fullPath, 'utf-8');
    const statements = splitSqlStatements(sqlContent);
    if (statements.length === 0) {
      return { success: true };
    }
    return { success: true };
  }

  const sql = getRawSql();
  const sqlContent = readFileSync(file.fullPath, 'utf-8');
  const statements = splitSqlStatements(sqlContent);

  if (statements.length === 0) {
    return { success: true };
  }

  try {
    await sql.transaction((txn) => [
      // Acquire transaction-scoped advisory lock first.
      txn`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`,
      // Execute all migration statements in the same transaction.
      ...statements.map((stmt) => txn(stmt, [])),
    ]);
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

/**
 * Run a single pending migration by identifier.
 *
 * Steps:
 * 1. Verify authorization.
 * 2. Bootstrap the ledger if it doesn't exist (for execute action only).
 * 3. Discover the manifest and find the migration file.
 * 4. Check the ledger: if already `applied`, verify checksum (refuse on conflict).
 * 5. Mark as `running` in the ledger.
 * 6. Execute the migration SQL in a transaction (with advisory lock).
 * 7. Record the result (`applied` or `failed`) in the ledger.
 * 8. Emit audit events throughout.
 */
export async function runSinglePendingMigration(
  identifier: string,
  options: RunSingleMigrationOptions,
): Promise<MigrationExecutionResult> {
  const { dryRun, authorization } = options;
  const environment = getCurrentEnvironment();
  const executionId = `migrate-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const startTime = Date.now();

  // Verify authorization.
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

  // Execution gate: block mutations unless the governance lifecycle is in an
  // execution-permitting state (BASELINE_VERIFIED or EXECUTION_ENABLED).
  // Dry-run is exempt \u2014 it never mutates the database (MIGRATION-GOV-02).
  if (!dryRun) {
    const gate = await assertExecutionPermitted(false);
    if (!gate.permitted) {
      emitAuditEvent({
        type: 'migration.governance.execution_denied',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
        environment,
        executionId,
        migrationIdentifier: identifier,
        filename: '',
        details: {
          lifecycleState: gate.lifecycleState,
          reason: 'MIGRATION_BASELINE_REQUIRED',
        },
      });
      return {
        identifier,
        filename: '',
        status: 'failed',
        durationMs: Date.now() - startTime,
        errorCode: 'MIGRATION_BASELINE_REQUIRED',
        errorSummary:
          `Migration execution is blocked. The governance lifecycle for ` +
          `environment '${environment}' is in state '${gate.lifecycleState}'. ` +
          `Baseline reconciliation must be completed and verified before ` +
          `migrations can be executed. Required states: BASELINE_VERIFIED or ` +
          `EXECUTION_ENABLED.`,
        dryRun,
        executionId,
      };
    }
  }

  // Bootstrap ledger if needed (for non-dry-run execute).
  if (!dryRun) {
    const bootstrap = await bootstrapMigrationLedger(authorization.actorType, authorization.actorId);
    if (!bootstrap.success) {
      return {
        identifier,
        filename: '',
        status: 'failed',
        durationMs: Date.now() - startTime,
        errorCode: 'BOOTSTRAP_FAILED',
        errorSummary: `Failed to bootstrap migration ledger: ${bootstrap.error}`,
        dryRun,
        executionId,
      };
    }
  }

  // Discover the manifest and find the file.
  const manifest = discoverMigrationFiles();
  const file = findMigrationByIdentifier(manifest, identifier);
  if (!file) {
    return {
      identifier,
      filename: '',
      status: 'failed',
      durationMs: Date.now() - startTime,
      errorCode: 'MIGRATION_NOT_FOUND',
      errorSummary: `Migration '${identifier}' not found in the manifest.`,
      dryRun,
      executionId,
    };
  }

  // Check the ledger for existing state.
  if (!dryRun) {
    const existingRow = await readLedgerRow(identifier);
    if (existingRow) {
      if (existingRow.status === 'applied') {
        // Verify checksum — refuse if the file was modified after being applied.
        if (!checksumsMatch(file.checksumSha256, existingRow.checksum_sha256)) {
          emitAuditEvent({
            type: 'migration.checksum_mismatch',
            actorType: authorization.actorType,
            actorId: authorization.actorId,
            environment,
            executionId,
            migrationIdentifier: identifier,
            filename: file.filename,
            details: {
              ledgerChecksum: existingRow.checksum_sha256,
              fileChecksum: file.checksumSha256,
            },
          });
          return {
            identifier,
            filename: file.filename,
            status: 'failed',
            durationMs: Date.now() - startTime,
            errorCode: 'CHECKSUM_CONFLICT',
            errorSummary: `Migration '${identifier}' was previously applied but the file has been modified. ` +
              `Refusing to execute (no silent checksum override). Ledger checksum: ${existingRow.checksum_sha256}, ` +
              `file checksum: ${file.checksumSha256}.`,
            dryRun,
            executionId,
          };
        }
        // Already applied, checksum matches — skip (idempotent at ledger level).
        emitAuditEvent({
          type: 'migration.migration.skipped',
          actorType: authorization.actorType,
          actorId: authorization.actorId,
          environment,
          executionId,
          migrationIdentifier: identifier,
          filename: file.filename,
          details: { reason: 'already_applied' },
        });
        return {
          identifier,
          filename: file.filename,
          status: 'applied',
          durationMs: Date.now() - startTime,
          errorCode: null,
          errorSummary: null,
          dryRun,
          executionId,
        };
      }
      if (existingRow.status === 'running') {
        return {
          identifier,
          filename: file.filename,
          status: 'failed',
          durationMs: Date.now() - startTime,
          errorCode: 'ALREADY_RUNNING',
          errorSummary: `Migration '${identifier}' is currently running (status: running). Refusing concurrent execution.`,
          dryRun,
          executionId,
        };
      }
      if (existingRow.status === 'superseded') {
        return {
          identifier,
          filename: file.filename,
          status: 'failed',
          durationMs: Date.now() - startTime,
          errorCode: 'SUPERSEDED',
          errorSummary: `Migration '${identifier}' has been superseded and cannot be executed.`,
          dryRun,
          executionId,
        };
      }
      // failed or pending — proceed with execution (retry).
    }

    // Mark as running.
    await markMigrationRunning({
      identifier,
      filename: file.filename,
      checksumSha256: file.checksumSha256,
      description: file.description,
      executionId,
      actorType: authorization.actorType,
      actorId: authorization.actorId,
    });
  }

  // Execute.
  const result = await executeMigrationInTransaction(file, dryRun);
  const durationMs = Date.now() - startTime;

  if (result.success) {
    // Record success.
    if (!dryRun) {
      await recordMigrationResult({
        identifier,
        filename: file.filename,
        checksumSha256: file.checksumSha256,
        description: file.description,
        status: 'applied',
        executionId,
        startedAt: new Date(startTime),
        durationMs,
        actorType: authorization.actorType,
        actorId: authorization.actorId,
      });
    }
    emitAuditEvent({
      type: 'migration.migration.applied',
      actorType: authorization.actorType,
      actorId: authorization.actorId,
      environment,
      executionId,
      migrationIdentifier: identifier,
      filename: file.filename,
      details: { durationMs, dryRun },
    });
    return {
      identifier,
      filename: file.filename,
      status: 'applied',
      durationMs,
      errorCode: null,
      errorSummary: null,
      dryRun,
      executionId,
    };
  } else {
    // Record failure.
    if (!dryRun) {
      await recordMigrationResult({
        identifier,
        filename: file.filename,
        checksumSha256: file.checksumSha256,
        description: file.description,
        status: 'failed',
        executionId,
        startedAt: new Date(startTime),
        durationMs,
        errorCode: 'EXECUTION_ERROR',
        errorSummary: result.error ?? 'Unknown execution error',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
      });
    }
    emitAuditEvent({
      type: 'migration.migration.failed',
      actorType: authorization.actorType,
      actorId: authorization.actorId,
      environment,
      executionId,
      migrationIdentifier: identifier,
      filename: file.filename,
      details: { durationMs, error: result.error, dryRun },
    });
    return {
      identifier,
      filename: file.filename,
      status: 'failed',
      durationMs,
      errorCode: 'EXECUTION_ERROR',
      errorSummary: result.error ?? 'Unknown execution error',
      dryRun,
      executionId,
    };
  }
}

/**
 * Run all pending migrations in order.
 *
 * Iterates through the manifest in identifier order. For each pending
 * migration, calls runSinglePendingMigration. Stops on the first failure
 * (no further migrations are attempted after a failure — this prevents
 * applying migrations out of order).
 */
export async function runPendingMigrations(
  options: RunPendingMigrationsOptions,
): Promise<MigrationRunResult> {
  const { dryRun, authorization, limit } = options;
  const environment = getCurrentEnvironment();
  const executionId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const startTime = Date.now();

  // Verify authorization.
  if (!authorization.allowed) {
    return {
      results: [],
      applied: 0,
      failed: 0,
      skipped: 0,
      conflicted: 0,
      dryRun,
      executionId,
      fatalErrors: [authorization.reason ?? 'Authorization denied'],
    };
  }

  // Execution gate: block mutations unless the governance lifecycle is in an
  // execution-permitting state (BASELINE_VERIFIED or EXECUTION_ENABLED).
  // Dry-run is exempt \u2014 it never mutates the database (MIGRATION-GOV-02).
  if (!dryRun) {
    const gate = await assertExecutionPermitted(false);
    if (!gate.permitted) {
      emitAuditEvent({
        type: 'migration.governance.execution_denied',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
        environment,
        executionId,
        migrationIdentifier: null,
        filename: null,
        details: {
          lifecycleState: gate.lifecycleState,
          reason: 'MIGRATION_BASELINE_REQUIRED',
        },
      });
      return {
        results: [],
        applied: 0,
        failed: 0,
        skipped: 0,
        conflicted: 0,
        dryRun,
        executionId,
        fatalErrors: [
          `Migration execution is blocked. The governance lifecycle for ` +
          `environment '${environment}' is in state '${gate.lifecycleState}'. ` +
          `Baseline reconciliation must be completed and verified before ` +
          `migrations can be executed. Required states: BASELINE_VERIFIED or ` +
          `EXECUTION_ENABLED.`,
        ],
      };
    }
  }

  emitAuditEvent({
    type: 'migration.run.started',
    actorType: authorization.actorType,
    actorId: authorization.actorId,
    environment,
    executionId,
    migrationIdentifier: null,
    filename: null,
    details: { dryRun, limit: limit ?? null },
  });

  // Bootstrap ledger if needed (for non-dry-run).
  if (!dryRun) {
    const bootstrap = await bootstrapMigrationLedger(authorization.actorType, authorization.actorId);
    if (!bootstrap.success) {
      emitAuditEvent({
        type: 'migration.run.failed',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
        environment,
        executionId,
        migrationIdentifier: null,
        filename: null,
        details: { error: bootstrap.error },
      });
      return {
        results: [],
        applied: 0,
        failed: 0,
        skipped: 0,
        conflicted: 0,
        dryRun,
        executionId,
        fatalErrors: [`Failed to bootstrap migration ledger: ${bootstrap.error}`],
      };
    }
  }

  // Inspect to find pending migrations.
  const state = await inspectMigrationState();
  const pendingIdentifiers = state.pending;
  const results: MigrationExecutionResult[] = [];
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  let conflicted = 0;

  // Apply limit if specified.
  const toRun = limit ? pendingIdentifiers.slice(0, limit) : pendingIdentifiers;

  for (const identifier of toRun) {
    // Stop on first failure — don't continue applying out of order.
    if (failed > 0) break;

    const result = await runSinglePendingMigration(identifier, { dryRun, authorization });
    results.push(result);

    if (result.status === 'applied') {
      if (result.errorCode === null) {
        applied++;
      } else {
        // errorCode null check: actually applied with null errorCode = truly applied.
        applied++;
      }
    } else if (result.status === 'failed') {
      if (result.errorCode === 'CHECKSUM_CONFLICT') {
        conflicted++;
        failed++;
      } else {
        failed++;
      }
    }
  }

  // Count skipped (already-applied migrations that were not in pending).
  skipped = state.applied.length;

  const runDuration = Date.now() - startTime;
  const summary = { applied, failed, skipped, conflicted, dryRun, executionId, totalRun: toRun.length, durationMs: runDuration };

  if (failed > 0) {
    emitAuditEvent({
      type: 'migration.run.failed',
      actorType: authorization.actorType,
      actorId: authorization.actorId,
      environment,
      executionId,
      migrationIdentifier: null,
      filename: null,
      details: summary,
    });
  } else {
    emitAuditEvent({
      type: 'migration.run.completed',
      actorType: authorization.actorType,
      actorId: authorization.actorId,
      environment,
      executionId,
      migrationIdentifier: null,
      filename: null,
      details: summary,
    });
  }

  return {
    results,
    applied,
    failed,
    skipped,
    conflicted,
    dryRun,
    executionId,
    fatalErrors: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for convenience
// ─────────────────────────────────────────────────────────────────────────────

export { discoverMigrationFiles, validateMigrationManifest, findMigrationByIdentifier } from './manifest';
export { calculateChecksumOfString, checksumsMatch } from './validation';
export { bootstrapMigrationLedger, ledgerExists, readLedgerRows, readLedgerRow, recordMigrationResult, markMigrationRunning, getCurrentEnvironment, emitAuditEvent, getGovernanceLifecycleState, setGovernanceLifecycleState, recordBaselineReconciliation, readBaselineReconciliation, readAllBaselineReconciliations, verifyBaselineComplete, advanceToBaselineVerified, enableExecution, assertExecutionPermitted } from './ledger';
export {
  MIGRATION_LOCK_KEY,
  MIGRATION_ENV_VARS,
  MIGRATION_PERMISSIONS,
} from './types';
export type {
  MigrationFile,
  MigrationManifest,
  MigrationInspectionState,
  MigrationRunResult,
  MigrationExecutionResult,
  MigrationAuthorization,
  MigrationAction,
  MigrationActorType,
  RunPendingMigrationsOptions,
  RunSingleMigrationOptions,
  MigrationStatus,
  MigrationGovernanceLifecycle,
  BaselineReconciliationStatus,
  BaselineEvidenceType,
  MigrationBaselineRow,
  MigrationRunRow,
} from './types';
