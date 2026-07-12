// lib/migrations/types.ts
//
// Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
// Phase 1A.1 — Operational Hardening (MIGRATION-GOV-02..08)
//
// Type definitions for the canonical migration execution model.
// This module defines ALL shared types used across the migration governance
// subsystem (manifest, validation, ledger, runner, authorization, audit).
//
// Scope boundary: Migration governance ONLY. No org/membership/ownership changes.

/**
 * The current-state status of a migration as recorded in the `schema_migrations`
 * current-state table (one row per migration+environment).
 *
 * This table reflects the LATEST known state of each migration. It is NOT the
 * attempt history — attempt history is recorded in `schema_migration_runs`
 * (append-only, one row per event).
 *
 * - `pending`   — The migration has been discovered in the manifest but has not
 *                 yet been attempted in this environment.
 * - `running`   — The migration is currently executing (recorded at start;
 *                  updated to `applied` or `failed` on completion).
 * - `applied`   — The migration was successfully applied in this environment.
 *                  Terminal state for the current-state row.
 * - `failed`    — The migration was attempted and failed. The transaction was
 *                  rolled back. May be retried (which creates a new attempt
 *                  record in `schema_migration_runs`; the current-state row is
 *                  updated to reflect the latest attempt).
 * - `superseded` — Explicitly deprecated by an administrative act. Terminal.
 */
export type MigrationStatus =
  | 'pending'
  | 'running'
  | 'applied'
  | 'failed'
  | 'superseded';

/**
 * The status of an individual migration attempt event, recorded in the
 * `schema_migration_runs` append-only history table.
 *
 * Each row in `schema_migration_runs` represents a single event in a migration
 * attempt's lifecycle. A single attempt (identified by `execution_id`) may
 * produce multiple rows: typically a `started` row followed by an `applied`,
 * `failed`, `denied`, `skipped`, or other terminal row. Rows are INSERT-only —
 * never updated or deleted.
 *
 * - `started`          — The attempt was started (execution began; recorded
 *                        before the transaction).
 * - `applied`          — The attempt succeeded (the migration was applied).
 * - `failed`           — The attempt failed (the transaction was rolled back).
 * - `denied`           — The attempt was denied by authorization.
 * - `skipped`          — The attempt was skipped (already applied, checksum
 *                        matched).
 * - `dry_run`          — The attempt was a dry-run (no mutation, simulated
 *                        only).
 * - `conflict`         — The attempt was blocked due to a checksum conflict.
 * - `lock_timeout`     — The attempt was blocked because another migration was
 *                        already running (concurrent execution prevented).
 * - `baseline_blocked` — The attempt was blocked by the governance lifecycle
 *                        gate (execution not enabled).
 *
 * MIGRATION-GOV-14 (Phase 1A.2): Added dry_run, conflict, lock_timeout,
 * baseline_blocked to enable exact run-history recording for all denied/
 * blocked paths (MIGRATION-GOV-18).
 */
export type MigrationRunStatus =
  | 'started'
  | 'applied'
  | 'failed'
  | 'denied'
  | 'skipped'
  | 'dry_run'
  | 'conflict'
  | 'lock_timeout'
  | 'baseline_blocked';

/**
 * The governance lifecycle state of the migration system for a given
 * environment.
 *
 * The lifecycle progresses through these states in order:
 *
 * UNBOOTSTRAPPED → LEDGER_BOOTSTRAPPED → BASELINE_REQUIRED →
 * BASELINE_IN_PROGRESS → BASELINE_VERIFIED → EXECUTION_ENABLED
 *
 * - `UNBOOTSTRAPPED`       — No ledger tables exist yet. The system cannot
 *                            record or execute migrations.
 * - `LEDGER_BOOTSTRAPPED`  — The ledger tables have been created but the
 *                            historical baseline has not been reconciled.
 * - `BASELINE_REQUIRED`    — The system requires baseline reconciliation before
 *                            any migration execution. This is the state
 *                            immediately after bootstrap.
 * - `BASELINE_IN_PROGRESS` — Baseline reconciliation is in progress. No
 *                            migrations may be executed.
 * - `BASELINE_VERIFIED`    — The historical baseline has been reconciled and
 *                            verified. Migrations may be inspected but not yet
 *                            executed.
 * - `EXECUTION_ENABLED`    — Migrations may be executed. Requires
 *                            BASELINE_VERIFIED and explicit administrative
 *                            enablement.
 *
 * Mutations (execute, bootstrap) are denied unless the lifecycle state is
 * BASELINE_VERIFIED or EXECUTION_ENABLED. Dry-run (inspect) is always allowed.
 */
export type MigrationGovernanceLifecycle =
  | 'UNBOOTSTRAPPED'
  | 'LEDGER_BOOTSTRAPPED'
  | 'BASELINE_REQUIRED'
  | 'BASELINE_IN_PROGRESS'
  | 'BASELINE_VERIFIED'
  | 'EXECUTION_ENABLED';

/**
 * The reconciliation status of a migration in the historical baseline.
 *
 * Used during baseline reconciliation (Phase 1A.1 Issue 2) to classify each
 * migration's applied state in a database that may have had migrations applied
 * outside the governance system.
 *
 * - `CONFIRMED_APPLIED`     — Verified as applied to this environment.
 * - `CONFIRMED_NOT_APPLIED` — Verified as not applied to this environment.
 * - `PARTIALLY_APPLIED`     — Some statements applied, others not. Blocks
 *                              execution.
 * - `NOT_APPLICABLE`        — Not relevant to this environment (e.g.,
 *                              feature-specific migration not deployed here).
 * - `UNKNOWN`               — Cannot be determined. Blocks execution.
 */
export type BaselineReconciliationStatus =
  | 'CONFIRMED_APPLIED'
  | 'CONFIRMED_NOT_APPLIED'
  | 'PARTIALLY_APPLIED'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN';

/**
 * The type of evidence used to determine a baseline reconciliation status.
 *
 * - `SCHEMA_INTROSPECTION`  — Determined by querying information_schema.
 * - `LEDGER_RECORD`         — Determined by an existing ledger row.
 * - `MANUAL_VERIFICATION`   — Determined by human inspection.
 * - `CHECKSUM_MATCH`        — Determined by matching the file checksum.
 * - `OBJECT_EXISTENCE`      — Determined by checking for specific schema objects.
 * - `NONE`                  — No evidence available (status will be UNKNOWN).
 */
export type BaselineEvidenceType =
  | 'SCHEMA_INTROSPECTION'
  | 'LEDGER_RECORD'
  | 'MANUAL_VERIFICATION'
  | 'CHECKSUM_MATCH'
  | 'OBJECT_EXISTENCE'
  | 'NONE';

/**
 * The transaction mode for a migration file, determining how it should be
 * executed relative to database transactions.
 *
 * - `REQUIRED`      — The migration must be executed inside a transaction.
 *                     This is the default for most migrations.
 * - `FORBIDDEN`     — The migration contains transaction-incompatible
 *                     statements (e.g., CREATE INDEX CONCURRENTLY, VACUUM,
 *                     REINDEX CONCURRENTLY) and cannot be executed
 *                     automatically. Per MIGRATION-GOV-12 (Phase 1A.2), the
 *                     canonical runner BLOCKS FORBIDDEN migrations and
 *                     returns MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED.
 *                     Manual operator intervention is required.
 * - `MANUAL_REVIEW` — The migration's transaction compatibility cannot be
 *                     automatically determined and requires manual review
 *                     before execution.
 */
export type TransactionMode = 'REQUIRED' | 'FORBIDDEN' | 'MANUAL_REVIEW';

/**
 * The canonical migration identifier grammar, enforced as a CHECK constraint
 * on all three ledger tables (`schema_migrations`, `schema_migration_runs`,
 * `migration_baseline`):
 *
 *   CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$')
 *
 * The grammar is: exactly 3 digits (zero-padded prefix) followed by an
 * optional single lowercase letter (duplicate-prefix disambiguation suffix).
 * Valid: `001`, `074`, `074a`, `074b`. Invalid: `1`, `12`, `010aa`, `abc`,
 * `105-extra`, `074A` (uppercase).
 *
 * MIGRATION-GOV-14 (Phase 1A.2): This TypeScript constant mirrors the DDL
 * CHECK constraint so the identifier contract is enforced in code as well
 * as at the database level. The `isValidMigrationIdentifier()` function
 * should be used to validate identifiers before any ledger operation.
 */
export const MIGRATION_IDENTIFIER_REGEX = /^[0-9]{3}[a-z]?$/;

/**
 * Validate that a string conforms to the canonical migration identifier
 * grammar (`^[0-9]{3}[a-z]?$`).
 *
 * This is the TypeScript-side enforcement of the same contract enforced by
 * the DDL CHECK constraint on all ledger tables. Use this before any
 * ledger INSERT or lookup to fail fast on malformed identifiers rather than
 * relying on a database error.
 *
 * @param identifier The string to validate.
 * @returns `true` if the identifier matches the grammar, `false` otherwise.
 */
export function isValidMigrationIdentifier(identifier: string): boolean {
  return MIGRATION_IDENTIFIER_REGEX.test(identifier);
}

/**
 * A single migration file discovered from the canonical `lib/migrations/`
 * directory.
 *
 * `identifier` is the stable, unique key used in the ledger. For normal files it
 * is the zero-padded 3-digit prefix (e.g. `073`). For duplicate prefixes, a
 * suffix disambiguates (e.g. `074a`, `074b`), assigned by alphabetical filename
 * sort within the duplicate group.
 */
export interface MigrationFile {
  /** Stable unique identifier (prefix, or prefix+suffix for duplicates). */
  identifier: string;
  /** Raw numeric prefix extracted from the filename (e.g. `074`). */
  prefix: string;
  /** Full filename including extension (e.g. `074_photo_vision_jobs_dedup_index.sql`). */
  filename: string;
  /** Absolute filesystem path to the `.sql` file. */
  fullPath: string;
  /** Human-readable description extracted from the filename suffix, if any. */
  description: string;
  /** Whether this file shares its numeric prefix with another file. */
  isDuplicatePrefix: boolean;
  /** SHA-256 checksum over the exact file bytes (computed at discovery). */
  checksumSha256: string;
  /** Size of the file in bytes. */
  sizeBytes: number;
  /**
   * Transaction compatibility mode for this file (MIGRATION-GOV-06).
   *
   * - `REQUIRED` \u2014 The file contains only transaction-compatible statements and
   *   must be executed inside a transaction.
   * - `FORBIDDEN` \u2014 The file contains transaction-incompatible statements
   *   (CREATE INDEX CONCURRENTLY, VACUUM, REINDEX CONCURRENTLY, etc.) and
   *   cannot be executed automatically. Per MIGRATION-GOV-12 (Phase 1A.2),
   *   the canonical runner BLOCKS execution of FORBIDDEN migrations and
   *   returns MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED. Manual
   *   operator intervention is required.
   * - `MANUAL_REVIEW` \u2014 The file's compatibility cannot be automatically
   *   determined and requires manual review.
   *
   * Determined at discovery time by scanning the SQL content for known
   * transaction-incompatible statements.
   */
  transactionMode: TransactionMode;
}

/**
 * The complete discovered and validated set of migration files.
 */
export interface MigrationManifest {
  /** All migration files, sorted by identifier (prefix, then suffix). */
  files: MigrationFile[];
  /** Map of duplicate prefixes to their disambiguated identifiers. */
  duplicates: Record<string, string[]>;
  /** Reserved gap prefixes (prefixes with no file). */
  gaps: string[];
  /** The highest numeric prefix found. */
  highestPrefix: string;
  /** Total file count. */
  count: number;
}

/**
 * Result of validating a manifest.
 */
export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Informational events (e.g. duplicate_prefix detected, gap reserved). */
  notes: string[];
}

/**
 * A row in the `schema_migrations` current-state table, as read from the
 * database. This table has one row per (migration_identifier, environment)
 * pair and reflects the LATEST known state. Attempt history is in
 * `schema_migration_runs`.
 */
export interface MigrationLedgerRow {
  id: number;
  migration_identifier: string;
  filename: string;
  checksum_sha256: string;
  description: string | null;
  status: MigrationStatus;
  started_at: string | null;
  applied_at: string | null;
  failed_at: string | null;
  execution_duration_ms: number | null;
  environment: string;
  applied_by_actor_type: string | null;
  applied_by_actor_id: string | null;
  execution_id: string | null;
  error_code: string | null;
  error_summary: string | null;
  rollback_reference: string | null;
  /** ID of the most recent run record in schema_migration_runs (if any). */
  last_run_id: number | null;
  created_at: string;
}

/**
 * A row in the `schema_migration_runs` append-only attempt-history table.
 *
 * Each row represents a single event in a migration attempt's lifecycle.
 * A single attempt (identified by `execution_id`) may produce multiple rows
 * (e.g., `started` then `applied`). Rows are INSERT-only — never updated or
 * deleted. This preserves the full history of every attempt, including
 * failures that were later retried and succeeded.
 */
export interface MigrationRunRow {
  id: number;
  run_id: string;
  execution_id: string;
  migration_identifier: string;
  filename: string;
  checksum_sha256: string;
  environment: string;
  status: MigrationRunStatus;
  actor_type: string | null;
  actor_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  execution_duration_ms: number | null;
  error_code: string | null;
  error_summary: string | null;
  created_at: string;
}

/**
 * A row in the `governance_lifecycle` table, recording the governance state
 * for a given environment.
 */
export interface GovernanceLifecycleRow {
  id: number;
  environment: string;
  lifecycle_state: MigrationGovernanceLifecycle;
  baseline_reconciled_by: string | null;
  baseline_reconciled_at: string | null;
  execution_enabled_by: string | null;
  execution_enabled_at: string | null;
  last_state_change_at: string;
  created_at: string;
}

/**
 * A row in the `migration_baseline` table, recording the historical baseline
 * reconciliation status for each migration in each environment.
 */
export interface MigrationBaselineRow {
  id: number;
  migration_identifier: string;
  environment: string;
  reconciliation_status: BaselineReconciliationStatus;
  evidence_type: BaselineEvidenceType;
  evidence_summary: string | null;
  reconciled_by: string | null;
  reconciled_at: string;
  created_at: string;
}

/**
 * The type of actor initiating a migration operation.
 *
 * - `human`       — An authenticated admin user (requires fresh TOTP).
 * - `migration-actor` — An automated service token (exempt from TOTP, but still
 *                    subject to environment allowlist and production flag).
 *
 * MIGRATION-GOV-14 (Phase 1A.2): The `actor_type` vocabulary is enforced by
 * CHECK constraints on both `schema_migrations.applied_by_actor_type` and
 * `schema_migration_runs.actor_type`. Only these two values are permitted.
 * The route layer hardcodes `actorType = 'human'` and rejects any
 * client-supplied actor type to prevent privilege escalation
 * (MIGRATION-GOV-05). The `migration-actor` type is reserved for future
 * automated service-token execution and is never accepted from API clients.
 */
export type MigrationActorType = 'human' | 'migration-actor';

/**
 * Authorization context for a migration operation.
 */
export interface MigrationAuthorization {
  /** Whether the operation is authorized. */
  allowed: boolean;
  /** If not allowed, the reason. */
  reason: string | null;
  /** The action being authorized. */
  action: MigrationAction;
  /** The actor type. */
  actorType: MigrationActorType;
  /** The actor's identifier (admin user ID or service token ID). */
  actorId: string;
  /** The current environment name. */
  environment: string;
  /** Whether this is a dry-run (inspection only, no mutation). */
  dryRun: boolean;
}

/**
 * The migration action being authorized.
 */
export type MigrationAction = 'inspect' | 'execute' | 'bootstrap';

/**
 * Result of executing a single migration.
 */
export interface MigrationExecutionResult {
  /** The migration identifier. */
  identifier: string;
  /** The migration filename. */
  filename: string;
  /** Final status. */
  status: MigrationStatus;
  /** Execution duration in milliseconds. */
  durationMs: number;
  /** Error code if failed. */
  errorCode: string | null;
  /** Error summary if failed. */
  errorSummary: string | null;
  /** Whether this was a dry-run (no mutation). */
  dryRun: boolean;
  /** The execution ID (unique per attempt). */
  executionId: string;
}

/**
 * Result of running pending migrations (batch).
 */
export interface MigrationRunResult {
  /** Individual results for each migration attempted. */
  results: MigrationExecutionResult[];
  /** Total migrations applied successfully. */
  applied: number;
  /** Total migrations that failed. */
  failed: number;
  /** Total migrations skipped (already applied, checksum matched). */
  skipped: number;
  /** Total migrations conflicted (checksum mismatch on applied file). */
  conflicted: number;
  /** Whether the run was a dry-run. */
  dryRun: boolean;
  /** The execution ID for this batch. */
  executionId: string;
  /** Any errors that prevented the run from starting. */
  fatalErrors: string[];
}

/**
 * The inspection state of the migration system — combines the manifest (files on
 * disk) with the ledger (applied state in the database) and the governance
 * lifecycle state.
 */
export interface MigrationInspectionState {
  /** Whether the schema_migrations ledger exists. */
  ledgerExists: boolean;
  /** The current governance lifecycle state for this environment. */
  lifecycleState: MigrationGovernanceLifecycle;
  /** The discovered manifest. */
  manifest: MigrationManifest;
  /** Ledger rows keyed by migration_identifier. */
  ledgerRows: Record<string, MigrationLedgerRow>;
  /** Migrations that are pending (in manifest but not applied in ledger). */
  pending: string[];
  /** Migrations that are applied. */
  applied: string[];
  /** Migrations that failed (last attempt). */
  failed: string[];
  /** Migrations with checksum conflicts (file changed after being applied). */
  conflicts: Array<{ identifier: string; filename: string; ledgerChecksum: string; fileChecksum: string }>;
  /** Whether a migration is currently running. */
  running: string[];
}

/**
 * Audit event types emitted by the migration governance subsystem.
 */
export type MigrationAuditEventType =
  | 'migration.inspect'
  | 'migration.bootstrap.started'
  | 'migration.bootstrap.completed'
  | 'migration.bootstrap.failed'
  | 'migration.run.started'
  | 'migration.run.completed'
  | 'migration.run.failed'
  | 'migration.migration.applied'
  | 'migration.migration.failed'
  | 'migration.migration.skipped'
  | 'migration.migration.started'
  | 'migration.conflict.detected'
  | 'migration.checksum_mismatch'
  | 'migration.lock_denied'
  | 'migration.lock_acquired'
  | 'migration.legacy.invoked'
  | 'migration.baseline.started'
  | 'migration.baseline.completed'
  | 'migration.baseline.failed'
  | 'migration.governance.state_change'
  | 'migration.governance.execution_denied'
  | 'migration.mfa.denied'
  | 'migration.mfa.replay_detected'
  | 'migration.transaction_mode.review_required'
  | 'migration.execution_blocked_non_transactional'
  | 'manifest.duplicate_prefix';

/**
 * An audit event emitted by the migration governance subsystem.
 *
 * Audit events are logged via console (structured JSON) and may be persisted to
 * an audit store in a future phase. Phase 1A logs them to console with a
 * structured format for observability.
 */
export interface MigrationAuditEvent {
  type: MigrationAuditEventType;
  timestamp: string;
  actorType: MigrationActorType | null;
  actorId: string | null;
  environment: string;
  executionId: string | null;
  migrationIdentifier: string | null;
  filename: string | null;
  details: Record<string, unknown>;
}

/**
 * Options for running pending migrations.
 */
export interface RunPendingMigrationsOptions {
  /** If true, validate and report but do NOT execute any DDL or mutate the ledger. */
  dryRun: boolean;
  /** The authorization context. */
  authorization: MigrationAuthorization;
  /** Optional limit on the number of migrations to run (for safety). */
  limit?: number;
}

/**
 * Options for running a single pending migration.
 */
export interface RunSingleMigrationOptions {
  /** If true, validate and report but do NOT execute. */
  dryRun: boolean;
  /** The authorization context. */
  authorization: MigrationAuthorization;
}

/**
 * A fixed 64-bit advisory lock key used to guard migration execution.
 *
 * This is the ASCII encoding of "SOLPMGDR" (SolarPro Migration Governance) as a
 * 64-bit big-endian integer. The exact decimal value is 6003100736085771346.
 *
 * IMPORTANT: This value exceeds Number.MAX_SAFE_INTEGER (9007199254740991),
 * so it CANNOT be stored as a plain JavaScript number without precision loss.
 * A JS number renders it as 6003100736085771000 (rounded), which is a different
 * key. Phase 1A.1 stores the lock key as a decimal string and casts it to
 * BIGINT in PostgreSQL to preserve exactness. See MIGRATION-GOV-06.
 *
 * The lock is used with pg_try_advisory_xact_lock (transaction-scoped, bounded
 * timeout) rather than pg_advisory_xact_lock (which blocks indefinitely).
 */
export const MIGRATION_LOCK_KEY = 0x534f4c504d474452; // "SOLPMGDR"
/**
 * The exact decimal representation of MIGRATION_LOCK_KEY as a string.
 * This is used in SQL to cast to BIGINT, preserving full 64-bit precision.
 */
export const MIGRATION_LOCK_KEY_DECIMAL = '6003100736085771346';

/**
 * The canonical migrations directory (relative to project root).
 */
export const MIGRATIONS_DIR_RELATIVE = 'lib/migrations';

/**
 * The environment variable names used by the migration governance subsystem.
 */
export const MIGRATION_ENV_VARS = {
  /** Comma-separated list of environments where migration execution is allowed. */
  ALLOWED_ENVS: 'MIGRATION_RUN_ALLOWED_ENVS',
  /** Explicit flag to allow production execution (two-key requirement). */
  ALLOW_PRODUCTION: 'MIGRATION_ALLOW_PRODUCTION_EXECUTION',
  /**
   * Legacy inline runner flag. PERMANENTLY DEAD per MIGRATION-GOV-13 (Phase 1A.2).
   * The env var name is retained for historical reference, but the legacy path
   * is now permanently blocked (always 423) and can never be re-enabled.
   * isLegacyInlineEnabled() always returns false.
   */
  LEGACY_INLINE_ENABLED: 'MIGRATION_LEGACY_INLINE_ENABLED',
  /**
   * Legacy system-tools run_migration flag. PERMANENTLY DEAD per MIGRATION-GOV-13.
   * The env var name is retained for historical reference, but the legacy path
   * is now permanently blocked (always 423) and can never be re-enabled.
   * isLegacySystemToolsRunEnabled() always returns false.
   */
  LEGACY_SYSTEM_TOOLS_RUN_ENABLED: 'MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED',
  /**
   * Legacy prospects-seed flag. PERMANENTLY DEAD per MIGRATION-GOV-13 (Phase 1A.2).
   * The env var name is retained for historical reference, but the legacy path
   * is now permanently blocked (always 423) and can never be re-enabled.
   */
  LEGACY_PROSPECTS_SEED_ENABLED: 'MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED',
} as const;

/**
 * The platform permission strings.
 */
export const MIGRATION_PERMISSIONS = {
  EXECUTE: 'platform.migrations.execute',
  INSPECT: 'platform.migrations.inspect',
} as const;
