// lib/migrations/types.ts
//
// Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
//
// Type definitions for the canonical migration execution model.
// This module defines ALL shared types used across the migration governance
// subsystem (manifest, validation, ledger, runner, authorization, audit).
//
// Scope boundary: MIGRATION-GOV-01 ONLY. No org/membership/ownership changes.

/**
 * The lifecycle status of a migration as recorded in the `schema_migrations`
 * ledger.
 *
 * - `pending`   — The migration has been discovered in the manifest but has not
 *                 yet been attempted in this environment.
 * - `running`   — The migration is currently executing (recorded at start;
 *                  updated to `applied` or `failed` on completion).
 * - `applied`   — The migration was successfully applied in this environment.
 *                  This is a terminal state for a given environment; the row is
 *                  never deleted or mutated (append-only history).
 * - `failed`    — The migration was attempted and failed. The transaction was
 *                  rolled back. May be retried (which creates a new `running`
 *                  → `applied`/`failed` cycle; the failed row is retained for
 *                  history).
 * - `superseded` — Explicitly deprecated by an administrative act. Terminal.
 */
export type MigrationStatus =
  | 'pending'
  | 'running'
  | 'applied'
  | 'failed'
  | 'superseded';

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
 * A row in the `schema_migrations` ledger, as read from the database.
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
  environment: string | null;
  applied_by_actor_type: string | null;
  applied_by_actor_id: string | null;
  execution_id: string | null;
  error_code: string | null;
  error_summary: string | null;
  rollback_reference: string | null;
  created_at: string;
}

/**
 * The type of actor initiating a migration operation.
 *
 * - `human`       — An authenticated admin user (requires fresh TOTP).
 * - `migration-actor` — An automated service token (exempt from TOTP, but still
 *                    subject to environment allowlist and production flag).
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
 * disk) with the ledger (applied state in the database).
 */
export interface MigrationInspectionState {
  /** Whether the schema_migrations ledger exists. */
  ledgerExists: boolean;
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
  | 'migration.conflict.detected'
  | 'migration.checksum_mismatch'
  | 'migration.lock_denied'
  | 'migration.legacy.invoked'
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
 * 64-bit big-endian integer, used with pg_advisory_xact_lock.
 */
export const MIGRATION_LOCK_KEY = 0x534f4c504d474452; // "SOLPMGDR"

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
  /** Feature flag for the legacy inline runner (default: disabled). */
  LEGACY_INLINE_ENABLED: 'MIGRATION_LEGACY_INLINE_ENABLED',
  /** Feature flag for the legacy system-tools run_migration path. */
  LEGACY_SYSTEM_TOOLS_RUN_ENABLED: 'MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED',
} as const;

/**
 * The platform permission strings.
 */
export const MIGRATION_PERMISSIONS = {
  EXECUTE: 'platform.migrations.execute',
  INSPECT: 'platform.migrations.inspect',
} as const;
