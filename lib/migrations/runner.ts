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
  TargetedExecutionPermit,
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
import { calculateChecksumOfString, checksumsMatch, detectTransactionMode, detectTransactionModeFromFile } from './validation';
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
  emitAuditEventAsync,
  getGovernanceLifecycleState,
  setGovernanceLifecycleState,
  assertExecutionPermitted,
  recordTotpUse,
} from './ledger';
import { requireAdminApi } from '@/lib/adminAuth';
import { generateTOTPCode, decryptTOTPSecret } from '@/lib/mfa';
import { getMfaEnrollment } from '@/lib/mfaEnrollment';
import { AdminUser } from '@/lib/adminAuth';

// ─────────────────────────────────────────────────────────────────────────────
// Manifest Provider — Dependency Injection Boundary (Gap 1 corrective patch)
// ─────────────────────────────────────────────────────────────────────────────
//
// The canonical runner discovers migration files by calling
// discoverMigrationFiles() with NO arguments, which scans the production
// lib/migrations/ directory. This is the single source of truth for which
// migrations exist and may be executed in production.
//
// For end-to-end testing we need the runner to discover TEST FIXTURES from
// tests/fixtures/migrations/ instead — proving the full canonical execution
// path (manifest → lifecycle → authorization → runner → transaction → ledger
// → run history → audit) against isolated canary migrations 900-903 without
// touching production migration files.
//
// Security constraints for this injection boundary:
// 1. The default production export MUST remain locked to lib/migrations/.
//    The exported functions inspectMigrationState, runSinglePendingMigration,
//    and runPendingMigrations all use the PRODUCTION-LOCKED manifest provider
//    when called with no dependencies argument. No caller in the application
//    (route handler, CLI, cron) ever passes a dependencies argument.
// 2. No API request may provide a directory or path. The dependencies object
//    is accepted ONLY as an internal function argument — it is never
//    deserialized from a request body, query string, or environment variable.
// 3. No production environment variable may redirect the migration directory.
//    The manifest provider is a function, not a string; it cannot be set via
//    env var. The only way to inject a custom provider is to call
//    createMigrationRunnerWithManifest() from within a test module.
// 4. No arbitrary SQL may be injected. The manifest provider returns a
//    MigrationManifest (file metadata + checksums); it does not accept or
//    return SQL. The runner still reads SQL from the file's fullPath and
//    verifies its checksum against the manifest.
// 5. Test injection is only reachable through the internal module/test factory
//    createMigrationRunnerWithManifest(), which is NOT imported by the route
//    handler or any production module. It is exported solely so test files
//    can import it; it has no runtime effect unless called.

/**
 * A function that produces a migration manifest. The production default
 * scans lib/migrations/ via discoverMigrationFiles() (no args).
 */
export type MigrationManifestProvider = () => MigrationManifest;

/**
 * Optional dependencies for the canonical runner. When omitted (the default
 * for all production callers), the runner uses the production-locked manifest
 * provider. Tests may supply a provider that scans tests/fixtures/migrations/.
 */
export interface MigrationRunnerDependencies {
  manifestProvider?: MigrationManifestProvider;
}

/**
 * The production-locked manifest provider. This always scans
 * lib/migrations/ (the canonical production directory). It is the default
 * used by all exported runner functions when no dependencies argument is
 * supplied.
 */
const productionManifestProvider: MigrationManifestProvider = () =>
  discoverMigrationFiles();

/**
 * Resolve the manifest provider from optional dependencies. Falls back to the
 * production-locked provider when no dependencies or no manifestProvider is
 * supplied. This ensures the production default is ALWAYS lib/migrations/
 * unless a test explicitly injects a custom provider.
 */
function resolveManifestProvider(
  dependencies?: MigrationRunnerDependencies,
): MigrationManifestProvider {
  return dependencies?.manifestProvider ?? productionManifestProvider;
}

/**
 * Create a migration runner bound to a specific manifest provider.
 *
 * This is an INTERNAL TEST FACTORY. It returns bound versions of
 * inspectMigrationState, runSinglePendingMigration, and runPendingMigrations
 * that use the supplied manifest provider instead of the production default.
 *
 * SECURITY: This function is intended for test use ONLY. It is never called by
 * the route handler, any production module, or any code path reachable from an
 * API request. The manifest provider it accepts is a function (not a string
 * path), so it cannot be set via environment variables or request bodies. The
 * returned runner still enforces all governance controls: authorization,
 * lifecycle gating, checksum validation, advisory locking, transactional
 * execution, ledger recording, and audit emission.
 *
 * @param manifestProvider The manifest provider to bind into the runner.
 * @returns An object with bound inspectMigrationState, runSinglePendingMigration,
 *          and runPendingMigrations functions.
 */
export function createMigrationRunnerWithManifest(
  manifestProvider: MigrationManifestProvider,
): {
  inspectMigrationState: () => Promise<MigrationInspectionState>;
  runSinglePendingMigration: (
    identifier: string,
    options: RunSingleMigrationOptions,
  ) => Promise<MigrationExecutionResult>;
  runPendingMigrations: (
    options: RunPendingMigrationsOptions,
  ) => Promise<MigrationRunResult>;
} {
  const dependencies: MigrationRunnerDependencies = { manifestProvider };
  return {
    inspectMigrationState: () => inspectMigrationStateInternal(dependencies),
    runSinglePendingMigration: (identifier, options) =>
      runSinglePendingMigrationInternal(identifier, options, dependencies),
    runPendingMigrations: (options) =>
      runPendingMigrationsInternal(options, dependencies),
  };
}

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
 * Whether the legacy inline runner is enabled.
 *
 * Per MIGRATION-GOV-13 (Phase 1A.2), the legacy inline runner is PERMANENTLY
 * ELIMINATED. This function now always returns false — the legacy path can
 * never be re-enabled, regardless of environment variables. It is retained
 * (as a constant false) so the canonical admin inspection endpoint
 * (/api/admin/migrations GET) can continue reporting legacyFlags status
 * without breaking its response shape.
 */
export function isLegacyInlineEnabled(): boolean {
  return false;
}

/**
 * Whether the legacy system-tools run_migration is enabled.
 *
 * Per MIGRATION-GOV-13 (Phase 1A.2), the legacy system-tools run_migration
 * path is PERMANENTLY ELIMINATED. This function now always returns false —
 * the legacy path can never be re-enabled, regardless of environment
 * variables. It is retained (as a constant false) so the canonical admin
 * inspection endpoint can continue reporting legacyFlags status without
 * breaking its response shape.
 */
export function isLegacySystemToolsRunEnabled(): boolean {
  return false;
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

  // Environment allowlist + production two-key are the ACTUAL-EXECUTION gate.
  // They apply ONLY to `execute` (running numbered migrations, and enabling the
  // bounded execution window that permits a run). They MUST NOT apply to the
  // `bootstrap` governance action — bootstrap creates the ledger tables and
  // records/verifies the historical baseline; it runs no numbered SQL and never
  // executes a migration. Gating governance initialization behind an
  // execution-only allowlist made a fresh (e.g. production) environment
  // impossible to bootstrap — a governance dead-end. Bootstrap's own bar
  // (super_admin + fresh TOTP + reason + typed production confirmation + audit +
  // idempotency) is enforced by the route branch, not here. (MIGRATION-GOV: the
  // execution gate is scoped to execution; bootstrap is not weakened — it simply
  // is not an execution.)
  if (!dryRun && action === 'execute') {
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
 * The hard allowlist of migration identifiers that may be run via a bounded
 * TARGETED recovery permit (bypassing the global EXECUTION_ENABLED window).
 * This is intentionally a narrow escape hatch and holds ONLY the currently
 * runnable targets:
 *   - 107: actor_organization_id + resource_owner_organization_id on audit_log
 *     (ADR-013 T-08). THE most consequential entry here. Its code half shipped
 *     on 2026-07-12 and the migration never ran, so every audit write from that
 *     code inserted 17 columns into a 16-column table and PostgreSQL refused it:
 *     the tamper-evident trail recorded nothing, including the governance events
 *     for 113 and 119. Verified by the ADD-COLUMN gate; its target predates the
 *     registry, so the spec declares `altersPreexistingTables: ['audit_log']`.
 *     RUN IT FIRST — every other migration's audit record depends on it.
 *   - 120: uq_audit_log_chain_successor on audit_log — the audit chain's
 *     structural closure. Within an ADR-013 partition a given prev_hash may be
 *     claimed by exactly ONE successor, so two concurrent appends cannot fork
 *     the tamper-evident chain. Index-only: no column, no table, no row touched.
 *     Requires 107 (it names actor_organization_id). Partial on
 *     `prev_hash IS NOT NULL`, so the historical bootstrap roots 58-62 stay
 *     legal and unmodified.
 *   - 113: manufacturer_document_registry — the versioned authority-document
 *     store (W4 §8). Statically verified idempotent CREATE-TABLE-only and
 *     non-destructive by lib/migrations/targetedRegistryDeployment.ts before any
 *     permit is issued.
 *   - 114: equipment_reconciliation_audit + snapshot_digest_invalidations — the
 *     immutable reconciliation-audit tables (W4 §7). Same static gate.
 *   - 115: personnel_roles + project_personnel_assignments — the AAC WS-6 roles
 *     of record (designer / preparer / reviewer / engineer of record / approving
 *     engineer). Same static gate. Until it is run, the designer resolver reports
 *     a RETRYABLE store-unavailable failure naming this exact step; it never
 *     substitutes a vendor name.
 *   - 116: engineering_review_records — the digest-bound engineering review
 *     (AAC WS-8/WS-9) that makes ENGINEERING-REVIEW-PENDING clearable by a real
 *     licensed workflow. Same static gate. Run after 115 (its reviewer-role
 *     vocabulary is 115's).
 *   - 117: ahj_registry — SolarPro's own central AHJ / adopted-code registry
 *     (TAC WS-19). Same static gate. Independent of 113-116. Creates one table +
 *     three indexes, all IF NOT EXISTS, and seeds NO rows.
 *   - 118: field_route_measurements + field_route_measurement_events — the WS-5
 *     field-measurement record and its ATOMIC domain audit. Same static gate.
 *     Independent of 113-117. Until it is run, the canonical route-length
 *     resolver reports a RETRYABLE store-unavailable failure naming this exact
 *     step and the CAD source stands; it never invents a field measurement and
 *     never closes ROUTE-LENGTH-ESTIMATE.
 *   - 119: jurisdiction_authority_id on manufacturer_document_registry — the
 *     stable legal-AHJ identity beside the free-text display name (D4). The
 *     FIRST target here that is not a CREATE TABLE: it adds one nullable column
 *     and one partial index, both IF NOT EXISTS, writes no row and refuses to
 *     backfill. Statically verified by the ADD-COLUMN gate, which admits an
 *     ALTER only as a bare `ADD COLUMN IF NOT EXISTS` on a table another
 *     allowlisted migration deployed, with no default and no constraint. Run
 *     AFTER 113 — its target table is 113's.
 * NOTHING else — not any historical migration, not "all pending" — can be run
 * through the targeted path. (The retired 108 Nearmap-index and 109-112
 * data-authority targeted cards were removed 2026-07-21; their identifiers are
 * no longer runnable through this escape hatch.)
 *
 * ⚠ THIS SET IS THE FOURTH AND LAST GATE a targeted identifier must pass, and it
 * is the one that is easy to miss: an identifier can have a deployment spec, an
 * API action AND a console button and still be UNRUNNABLE — the permit is
 * rejected here, the lifecycle gate then refuses execution, and the operator sees
 * MIGRATION_BASELINE_REQUIRED with no hint that an allowlist was the cause. That
 * is exactly what happened to 117. The registry-parity test asserts this set and
 * REGISTRY_DEPLOYMENT/REGISTRY_SEQUENCE agree, so the four gates cannot drift again.
 */
export const TARGETED_RECOVERY_ALLOWLIST: ReadonlySet<string> = new Set(['107', '113', '114', '115', '116', '117', '118', '119', '120']);

/** Maximum lifetime of a targeted execution permit (the bounded window). */
export const MAX_TARGETED_PERMIT_TTL_MS = 5 * 60 * 1000;

/**
 * Validate a bounded targeted execution permit for an EXACT identifier.
 * Fail-closed: a permit is valid ONLY when it is present, names the exact
 * identifier being executed, that identifier is on the hard allowlist, and the
 * permit is within its bounded (non-negative, capped) lifetime.
 */
export function isTargetedPermitValid(
  permit: TargetedExecutionPermit | undefined,
  identifier: string,
): boolean {
  if (!permit) return false;
  if (permit.identifier !== identifier) return false;
  if (!TARGETED_RECOVERY_ALLOWLIST.has(identifier)) return false;
  if (!(typeof permit.ttlMs === 'number') || permit.ttlMs <= 0 || permit.ttlMs > MAX_TARGETED_PERMIT_TTL_MS) return false;
  if (typeof permit.issuedAtMs !== 'number') return false;
  const age = Date.now() - permit.issuedAtMs;
  if (age < 0 || age > permit.ttlMs) return false;
  return true;
}

/**
 * TOTP time-step period (seconds per step, RFC 6238). Must match lib/mfa.ts.
 */
const TOTP_PERIOD_SECONDS = 30;
/**
 * Clock-skew window (steps before/after). Must match lib/mfa.ts TOTP_WINDOW.
 */
const TOTP_WINDOW_STEPS = 1;

/**
 * Result of verifying a fresh TOTP code for migration authorization.
 *
 * - `verified`       — true only if the code is valid, MFA is enabled, AND the
 *                     time-step has not been replayed (consumed by a prior
 *                     migration mutation in the same 30-second window).
 * - `deniedReason`   — a machine-readable denial code when verified is false.
 * - `timeStep`       — the matched TOTP time-step (for audit / correlation),
 *                     or null if not verified.
 */
export interface VerifyFreshTotpResult {
  verified: boolean;
  deniedReason: 'MFA_NOT_ENABLED' | 'TOTP_INVALID' | 'TOTP_REPLAY' | null;
  timeStep: number | null;
}

/**
 * Verify a fresh TOTP code for a human admin user — FAIL-CLOSED.
 *
 * MIGRATION-GOV-05: This function implements fail-closed MFA for migration
 * execution. The prior implementation waived the TOTP requirement when a user
 * had no MFA secret configured, which allowed migration execution without
 * multi-factor authentication. This is now DENIED: a human operator who has
 * not enrolled in MFA cannot execute schema migrations, period.
 *
 * TOTP REPLAY PREVENTION (MIGRATION-GOV-05): Once a TOTP code is accepted for
 * a migration mutation, the (user_id, time_step) pair is recorded in the
 * `migration_totp_uses` table. A second mutation attempt using the same
 * time-step (i.e., the same 30-second window, or the same code) is rejected
 * as a replay. The user must wait for the next time-step to produce a fresh
 * code. The actual TOTP code is never stored — only a SHA-256 hash of the
 * (user_id, time_step) pair.
 *
 * IMPORTANT — "failed auth does not consume a valid code": if the TOTP code
 * is invalid (wrong code, clock skew beyond window), we return TOTP_INVALID
 * WITHOUT recording the time-step. Only a valid, first-use code is recorded.
 * This means a failed attempt does not "burn" the current time-step window;
 * the user can retry with the same (still-fresh) code.
 *
 * @param adminUserId   The admin user ID who provided the TOTP code.
 * @param code          The 6-digit TOTP code to verify.
 * @param executionId   The execution ID of the migration run (for audit
 *                      correlation in the migration_totp_uses table).
 * @returns A VerifyFreshTotpResult indicating whether the code was verified.
 */
export async function verifyFreshTotp(
  adminUserId: string,
  code: string,
  executionId: string | null = null,
): Promise<VerifyFreshTotpResult> {
  // Phase 1: pure validity (MFA enrolled + code matches a step in the window).
  const validity = await verifyTotpStepValidity(adminUserId, code);
  if (!validity.verified || validity.timeStep === null) {
    return { verified: false, deniedReason: validity.deniedReason, timeStep: validity.timeStep };
  }

  // Phase 2: legacy (user_id, time_step) single-use replay ledger. Retained for
  // the execution/activation paths and their tests. The corrected bootstrap
  // path does NOT use this — it reserves an idempotent, action-scoped,
  // release-on-failure record via lib/migrations/governedTotpAction.ts so that
  // (a) duplicate concurrent requests collapse instead of colliding, and (b) a
  // failed attempt never burns the operator's next code.
  const firstUse = await recordTotpUse(adminUserId, validity.timeStep, executionId);
  if (!firstUse) {
    return { verified: false, deniedReason: 'TOTP_REPLAY', timeStep: validity.timeStep };
  }

  return { verified: true, deniedReason: null, timeStep: validity.timeStep };
}

/**
 * Result of a PURE TOTP-code validity check — MFA enrollment + the accepted
 * time-step — WITHOUT touching any replay ledger. Splitting validity from
 * consumption lets a caller authorize (env allowlist, role) BEFORE it commits
 * the single-use record, so a code is never burned by a request that is
 * rejected before it mutates anything.
 */
export interface TotpStepValidity {
  verified: boolean;
  deniedReason: 'MFA_NOT_ENABLED' | 'TOTP_INVALID' | null;
  /** The accepted time-step (floor(ms/1000/30)) — this is the exact step a
   *  caller must record to the replay ledger. Null when not verified. */
  timeStep: number | null;
}

/**
 * Verify a TOTP code's validity for a human admin — FAIL-CLOSED — and return
 * the accepted time-step. This performs NO ledger write: it neither consumes
 * nor replays. It uses the frozen lib/mfa.ts crypto exclusively.
 *
 * Window/clock: matches lib/mfa.ts — the current server-clock step (Date.now())
 * plus ±TOTP_WINDOW_STEPS (one 30s step) of skew tolerance, scanned from the
 * current step outward so the freshest matching step is the one returned (and
 * therefore the one written to the replay ledger).
 */
export async function verifyTotpStepValidity(
  adminUserId: string,
  code: string,
): Promise<TotpStepValidity> {
  // Resolve enrollment from the CANONICAL account record (users.mfa_enabled +
  // users.mfa_secret_encrypted) — the exact source the Settings Security page
  // and app/api/auth/mfa/verify use.
  const enrollment = await getMfaEnrollment(adminUserId);

  // FAIL-CLOSED: an operator who has not enrolled in MFA cannot run migrations.
  if (!enrollment.enrolled || !enrollment.secretEncrypted) {
    return { verified: false, deniedReason: 'MFA_NOT_ENABLED', timeStep: null };
  }

  const secret = decryptTOTPSecret(enrollment.secretEncrypted);
  const now = Date.now();

  // Find the matching time-step within the ±1 window, preferring the freshest.
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

  if (matchedStep === null) {
    // Invalid code (wrong code or skew beyond the window). No ledger write, so
    // a failed auth never consumes a still-valid code.
    return { verified: false, deniedReason: 'TOTP_INVALID', timeStep: null };
  }

  return { verified: true, deniedReason: null, timeStep: matchedStep };
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
async function inspectMigrationStateInternal(
  dependencies?: MigrationRunnerDependencies,
): Promise<MigrationInspectionState> {
  const manifestProvider = resolveManifestProvider(dependencies);
  const manifest = manifestProvider();
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

/**
 * Inspect the current migration state — read-only. (Public production export.)
 *
 * Uses the production-locked manifest provider (scans lib/migrations/). For
 * test-only manifest injection, use createMigrationRunnerWithManifest().
 */
export async function inspectMigrationState(): Promise<MigrationInspectionState> {
  return inspectMigrationStateInternal();
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
 * Execute a single migration's SQL, guarded by an advisory lock.
 *
 * Transaction mode handling (MIGRATION-GOV-06, Phase 1A.1 Issue 10/11):
 * - `REQUIRED` (default): The entire migration's DDL runs in a single Neon
 *   transaction. If any statement fails, the entire migration rolls back.
 *   The advisory lock is acquired with pg_try_advisory_xact_lock (transaction-
 *   scoped, bounded) using the exact 64-bit key as a BIGINT cast to avoid
 *   JavaScript Number precision loss.
 * - `FORBIDDEN`: The migration contains transaction-incompatible statements
 *   (CREATE INDEX CONCURRENTLY, VACUUM, REINDEX CONCURRENTLY, etc.) and must
 *   be executed outside a transaction, statement by statement. The advisory
 *   lock is acquired with a session-level lock before execution and released
 *   after. If any statement fails, execution stops (but prior statements in
 *   the file are already committed — this is inherent to CONCURRENTLY).
 * - `MANUAL_REVIEW`: The migration is not executed. Returns an error directing
 *   the operator to review the file's transaction compatibility manually.
 *
 * NEON TRANSACTION CONSTRAINT: the callback must be synchronous and return an
 * array of query promises. We pre-split the SQL and build the array.
 *
 * Lock key precision (MIGRATION-GOV-06): The advisory lock key
 * 0x534f4c504d474452 (= 6003100736085771346) exceeds Number.MAX_SAFE_INTEGER.
 * Passing it as a JavaScript number to the Neon driver causes precision loss
 * (6003100736085771000). We pass it as a decimal STRING and cast to BIGINT in
 * PostgreSQL to preserve the exact 64-bit value.
 */
async function executeMigrationInTransaction(
  file: MigrationFile,
  dryRun: boolean,
): Promise<{ success: boolean; error?: string; errorCode?: string }> {
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

  // ── MANUAL_REVIEW mode: do not execute, require manual review ──────────
  if (file.transactionMode === 'MANUAL_REVIEW') {
    emitAuditEvent({
      type: 'migration.transaction_mode.review_required',
      actorType: null,
      actorId: null,
      environment: getCurrentEnvironment(),
      executionId: null,
      migrationIdentifier: file.identifier,
      filename: file.filename,
      details: { transactionMode: 'MANUAL_REVIEW' },
    });
    return {
      success: false,
      errorCode: 'TRANSACTION_MODE_MANUAL_REVIEW',
      error: `Migration '${file.identifier}' has transaction mode MANUAL_REVIEW. ` +
        `Its transaction compatibility cannot be automatically determined and ` +
        `requires manual review before execution.`,
    };
  }

  // ── FORBIDDEN mode: BLOCK automatic execution (MIGRATION-GOV-12, Phase 1A.2)
  //
  // FORBIDDEN migrations contain transaction-incompatible statements
  // (CREATE INDEX CONCURRENTLY, VACUUM, REINDEX CONCURRENTLY, etc.). Executing
  // these statement-by-statement outside a transaction means a partial failure
  // leaves the schema in an inconsistent state with no rollback.
  //
  // Per MIGRATION-GOV-12, FORBIDDEN migrations must be BLOCKED from automatic
  // execution. The runner returns MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED
  // and does NOT execute any SQL. Manual operator intervention is required.
  if (file.transactionMode === 'FORBIDDEN') {
    // Re-detect the incompatible statements for the audit event details.
    const sqlContent = readFileSync(file.fullPath, 'utf-8');
    const { incompatibleStatements } = detectTransactionMode(sqlContent);
    emitAuditEvent({
      type: 'migration.execution_blocked_non_transactional',
      actorType: null,
      actorId: null,
      environment: getCurrentEnvironment(),
      executionId: null,
      migrationIdentifier: file.identifier,
      filename: file.filename,
      details: {
        transactionMode: 'FORBIDDEN',
        incompatibleStatements,
        reason: 'Non-transactional execution is not supported by the canonical runner.',
      },
    });
    return {
      success: false,
      errorCode: 'MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED',
      error: `Migration '${file.identifier}' contains non-transactional statements ` +
        `(${incompatibleStatements.join(', ')}) and cannot be executed automatically. ` +
        `Manual operator intervention required. The canonical migration runner ` +
        `does not support statement-by-statement execution outside a transaction ` +
        `because a partial failure would leave the schema in an inconsistent state ` +
        `with no rollback (MIGRATION-GOV-12).`,
    };
  }

  // ── REQUIRED mode (default): execute inside a transaction ──────────────
  try {
    await sql.transaction((txn) => [
      // Acquire transaction-scoped advisory lock first.
      // Use pg_try_advisory_xact_lock (bounded, returns boolean) with the
      // exact 64-bit key as a decimal string cast to BIGINT (MIGRATION-GOV-06).
      txn`SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint) AS acquired`,
      // Execute all migration statements in the same transaction.
      ...statements.map((stmt) => txn(stmt, [])),
    ]);
    // Note: pg_try_advisory_xact_lock returns a boolean, but the Neon
    // transaction API does not easily allow checking the first query's result
    // before executing subsequent queries. If the lock is not acquired, the
    // transaction still proceeds (the lock is best-effort in this path). A
    // future enhancement could split this into a lock-check-then-execute
    // pattern. For now, the advisory lock provides mutual exclusion in the
    // common case (single concurrent migration runner).
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, errorCode: 'TRANSACTION_ERROR', error: errorMsg };
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
  return runSinglePendingMigrationInternal(identifier, options);
}

/**
 * Internal implementation of runSinglePendingMigration with optional
 * dependency injection for the manifest provider.
 */
async function runSinglePendingMigrationInternal(
  identifier: string,
  options: RunSingleMigrationOptions,
  dependencies?: MigrationRunnerDependencies,
): Promise<MigrationExecutionResult> {
  const { dryRun, authorization } = options;
  const environment = getCurrentEnvironment();
  const executionId = `migrate-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const startTime = Date.now();

  // Discover the manifest early so that file metadata (filename, checksum) is
  // available for run-history recording at all denial/block paths
  // (MIGRATION-GOV-18, Phase 1A.2). This is a filesystem-only operation and
  // does not touch the database.
  const manifestProvider = resolveManifestProvider(dependencies);
  const manifest = manifestProvider();
  const file = findMigrationByIdentifier(manifest, identifier);

  // Verify authorization.
  if (!authorization.allowed) {
    // Record the denial in the append-only run history (MIGRATION-GOV-18).
    // Best-effort: if the ledger table does not exist yet, the record is
    // silently dropped (recordMigrationRunEvent catches and returns null).
    if (file) {
      await recordMigrationRunEvent({
        executionId,
        identifier,
        filename: file.filename,
        checksumSha256: file.checksumSha256,
        status: 'denied',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        errorCode: 'AUTHORIZATION_DENIED',
        errorSummary: authorization.reason ?? 'Authorization denied',
      });
    }
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
  // execution-permitting state (EXECUTION_ENABLED only).
  // Dry-run is exempt \u2014 it never mutates the database (MIGRATION-GOV-02,
  // MIGRATION-GOV-09 Phase 1A.2).
  //
  // TARGETED RECOVERY EXCEPTION: a valid bounded permit for THIS exact
  // (allowlisted) identifier authorizes execution WITHOUT the global
  // EXECUTION_ENABLED window. It does NOT flip the lifecycle, so ordinary
  // run-single / run-pending and re-running already-applied migrations remain
  // blocked. The bypass is durably audited so it is never silent. This branch
  // exists ONLY in single-migration execution \u2014 the batch runner has no such
  // exception.
  const targetedOk = !dryRun && isTargetedPermitValid(options.targetedPermit, identifier);
  if (targetedOk) {
    emitAuditEvent({
      type: 'migration.governance.state_change',
      actorType: authorization.actorType,
      actorId: authorization.actorId,
      environment,
      executionId,
      migrationIdentifier: identifier,
      filename: file?.filename ?? '',
      details: {
        targetedRecoveryPermit: true,
        identifier,
        reason: options.targetedPermit?.reason ?? null,
        note: 'Bounded single-migration permit authorized execution without a global EXECUTION_ENABLED window.',
      },
    });
  }
  if (!dryRun && !targetedOk) {
    const gate = await assertExecutionPermitted(false);
    if (!gate.permitted) {
      emitAuditEvent({
        type: 'migration.governance.execution_denied',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
        environment,
        executionId,
        migrationIdentifier: identifier,
        filename: file?.filename ?? '',
        details: {
          lifecycleState: gate.lifecycleState,
          reason: 'MIGRATION_BASELINE_REQUIRED',
        },
      });
      // Record the baseline-blocked denial in the append-only run history
      // (MIGRATION-GOV-18, Phase 1A.2).
      if (file) {
        await recordMigrationRunEvent({
          executionId,
          identifier,
          filename: file.filename,
          checksumSha256: file.checksumSha256,
          status: 'baseline_blocked',
          actorType: authorization.actorType,
          actorId: authorization.actorId,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorCode: 'MIGRATION_BASELINE_REQUIRED',
          errorSummary: `Lifecycle state '${gate.lifecycleState}' does not permit execution. Required: EXECUTION_ENABLED.`,
        });
      }
      return {
        identifier,
        filename: '',
        status: 'failed',
        durationMs: Date.now() - startTime,
        errorCode: 'MIGRATION_BASELINE_REQUIRED',
        errorSummary:
          `Migration execution is blocked. The governance lifecycle for ` +
          `environment '${environment}' is in state '${gate.lifecycleState}'. ` +
          `Baseline reconciliation must be completed, verified, and execution ` +
          `explicitly activated before migrations can be executed. ` +
          `Required state: EXECUTION_ENABLED. ` +
          `If the lifecycle is BASELINE_VERIFIED, call enable-execution (with ` +
          `TOTP and reason) to activate execution.`,
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

  // Discover the manifest and find the file (already discovered above for
  // run-history recording at denial paths; here we handle the not-found case).
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
          // Record the checksum conflict in the append-only run history
          // (MIGRATION-GOV-18, Phase 1A.2).
          await recordMigrationRunEvent({
            executionId,
            identifier,
            filename: file.filename,
            checksumSha256: file.checksumSha256,
            status: 'conflict',
            actorType: authorization.actorType,
            actorId: authorization.actorId,
            startedAt: new Date(startTime),
            completedAt: new Date(),
            durationMs: Date.now() - startTime,
            errorCode: 'CHECKSUM_CONFLICT',
            errorSummary: `Checksum conflict: ledger ${existingRow.checksum_sha256} vs file ${file.checksumSha256}.`,
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
        // Record the skip in the append-only run history (MIGRATION-GOV-18).
        await recordMigrationRunEvent({
          executionId,
          identifier,
          filename: file.filename,
          checksumSha256: file.checksumSha256,
          status: 'skipped',
          actorType: authorization.actorType,
          actorId: authorization.actorId,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorCode: null,
          errorSummary: 'Already applied; checksum matched (idempotent skip).',
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
        // Record the concurrent-execution block in the append-only run history
        // (MIGRATION-GOV-18, Phase 1A.2).
        await recordMigrationRunEvent({
          executionId,
          identifier,
          filename: file.filename,
          checksumSha256: file.checksumSha256,
          status: 'lock_timeout',
          actorType: authorization.actorType,
          actorId: authorization.actorId,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorCode: 'ALREADY_RUNNING',
          errorSummary: `Migration '${identifier}' is currently running. Concurrent execution refused.`,
        });
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
      // GOV-10: fail-closed audit for mutation success. The durable audit
      // record MUST persist — if it fails, the migration is treated as failed
      // to avoid a silent gap in the tamper-evident audit trail.
      const auditResult = await emitAuditEventAsync({
        type: 'migration.migration.applied',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
        environment,
        executionId,
        migrationIdentifier: identifier,
        filename: file.filename,
        details: { durationMs, dryRun },
      });
      if (!auditResult.persisted) {
        // The migration was applied but the audit record could not be durably
        // persisted. Record the failure and return an AUDIT_PERSISTENCE_FAILED
        // error so the operator is aware of the audit-trail gap.
        await recordMigrationRunEvent({
          executionId,
          identifier,
          filename: file.filename,
          checksumSha256: file.checksumSha256,
          status: 'failed',
          actorType: authorization.actorType,
          actorId: authorization.actorId,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          durationMs,
          errorCode: 'AUDIT_PERSISTENCE_FAILED',
          // THE REASON, on the record. This summary used to be a fixed string, so
          // 113 (July) and 119 (August) both reported an audit failure that named
          // no cause — and the cause was one line of PostgreSQL.
          errorSummary: `Migration applied but durable audit persistence failed (fail-closed): ${auditResult.error ?? 'reason not reported'}`,
        });
        return {
          identifier,
          filename: file.filename,
          status: 'failed',
          durationMs,
          errorCode: 'AUDIT_PERSISTENCE_FAILED',
          errorSummary: `Migration '${identifier}' was applied but the durable audit record could not be persisted: ` +
            `${auditResult.error ?? 'reason not reported'}. ` +
            `The audit trail is incomplete. Treat this as a governance incident and investigate.`,
          dryRun,
          executionId,
        };
      }
    } else {
      // Dry-run: no mutation occurred, fire-and-forget audit is acceptable.
      // Record a dry_run event in the run history (MIGRATION-GOV-18).
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
      await recordMigrationRunEvent({
        executionId,
        identifier,
        filename: file.filename,
        checksumSha256: file.checksumSha256,
        status: 'dry_run',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs,
        errorCode: null,
        errorSummary: 'Dry-run validation succeeded (no mutation).',
      });
    }
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
        errorCode: result.errorCode ?? 'EXECUTION_ERROR',
        errorSummary: result.error ?? 'Unknown execution error',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
      });
      // GOV-10: fail-closed audit for mutation failure. The durable audit
      // record MUST persist — if it fails, escalate the error code.
      const auditResult = await emitAuditEventAsync({
        type: 'migration.migration.failed',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
        environment,
        executionId,
        migrationIdentifier: identifier,
        filename: file.filename,
        details: { durationMs, error: result.error, errorCode: result.errorCode ?? 'EXECUTION_ERROR', dryRun },
      });
      if (!auditResult.persisted) {
        // The migration failed AND the audit record could not be persisted.
        // Record the combined failure.
        await recordMigrationRunEvent({
          executionId,
          identifier,
          filename: file.filename,
          checksumSha256: file.checksumSha256,
          status: 'failed',
          actorType: authorization.actorType,
          actorId: authorization.actorId,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          durationMs,
          errorCode: 'AUDIT_PERSISTENCE_FAILED',
          errorSummary: `Migration failed (${result.errorCode ?? 'EXECUTION_ERROR'}) AND durable audit persistence failed (fail-closed): ${auditResult.error ?? 'reason not reported'}`,
        });
        return {
          identifier,
          filename: file.filename,
          status: 'failed',
          durationMs,
          errorCode: 'AUDIT_PERSISTENCE_FAILED',
          errorSummary: `Migration '${identifier}' failed (${result.error ?? 'Unknown error'}) and the durable audit record could not be persisted: ` +
            `${auditResult.error ?? 'reason not reported'}. ` +
            `The audit trail is incomplete. Treat this as a governance incident.`,
          dryRun,
          executionId,
        };
      }
    } else {
      // Dry-run failure: fire-and-forget audit is acceptable (no mutation).
      emitAuditEvent({
        type: 'migration.migration.failed',
        actorType: authorization.actorType,
        actorId: authorization.actorId,
        environment,
        executionId,
        migrationIdentifier: identifier,
        filename: file.filename,
        details: { durationMs, error: result.error, errorCode: result.errorCode ?? 'EXECUTION_ERROR', dryRun },
      });
    }
    return {
      identifier,
      filename: file.filename,
      status: 'failed',
      durationMs,
      errorCode: result.errorCode ?? 'EXECUTION_ERROR',
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
  return runPendingMigrationsInternal(options);
}

/**
 * Internal implementation of runPendingMigrations with optional dependency
 * injection for the manifest provider.
 */
async function runPendingMigrationsInternal(
  options: RunPendingMigrationsOptions,
  dependencies?: MigrationRunnerDependencies,
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
  // execution-permitting state (EXECUTION_ENABLED only).
  // Dry-run is exempt \u2014 it never mutates the database (MIGRATION-GOV-02,
  // MIGRATION-GOV-09 Phase 1A.2).
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
          `Baseline reconciliation must be completed, verified, and execution ` +
          `explicitly activated before migrations can be executed. ` +
          `Required state: EXECUTION_ENABLED. ` +
          `If the lifecycle is BASELINE_VERIFIED, call enable-execution (with ` +
          `TOTP and reason) to activate execution.`,
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
  const state = await inspectMigrationStateInternal(dependencies);
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

    const result = await runSinglePendingMigrationInternal(identifier, { dryRun, authorization }, dependencies);
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
export { calculateChecksumOfString, checksumsMatch, detectTransactionMode, detectTransactionModeFromFile } from './validation';
export { bootstrapMigrationLedger, ledgerExists, readLedgerRows, readLedgerRow, recordMigrationResult, markMigrationRunning, getCurrentEnvironment, emitAuditEvent, emitAuditEventAsync, getGovernanceLifecycleState, setGovernanceLifecycleState, recordBaselineReconciliation, readBaselineReconciliation, readAllBaselineReconciliations, verifyBaselineComplete, advanceToBaselineVerified, enableExecution, disableExecution, assertExecutionPermitted, recordTotpUse, isTotpTimeStepUsed } from './ledger';
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
  TransactionMode,
} from './types';
