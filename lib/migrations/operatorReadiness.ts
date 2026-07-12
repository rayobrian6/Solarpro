// lib/migrations/operatorReadiness.ts
//
// Operator-recovery workstream (Phase 1A operator surface).
//
// Server-side aggregation of everything the migration operator console needs to
// render its readiness dashboard in ONE call: environment + role + MFA gate
// status + governance lifecycle + ledger status + manifest counts + baseline
// reconciliation counts + checksum conflicts + execution activation status and
// expiry. Plain-language blockers are derived here so the UI never has to
// interpret internal status codes to tell the operator what to do next.
//
// SECURITY / SAFETY:
// - READ-ONLY. This module never mutates. Every sub-read is independently
//   guarded so a missing table (fresh/UNBOOTSTRAPPED environment) yields a
//   sensible state, never a throw and never a silent mutation.
// - It never returns database URLs, secrets, tokens, MFA secrets, or private
//   environment variables. The MFA field is a boolean gate signal only.
// - The operator identity, role, and environment are all server-derived by the
//   caller (the route) and passed in — never client-claimed.

import { neon } from '@neondatabase/serverless';
import { discoverMigrationFiles } from './manifest';
import {
  inspectMigrationState,
  getCurrentEnvironment,
} from './runner';
import {
  ledgerExists,
  getGovernanceLifecycleState,
  readAllBaselineReconciliations,
  readExecutionActivation,
} from './ledger';
import type {
  MigrationGovernanceLifecycle,
  BaselineReconciliationStatus,
} from './types';

/** Reconciliation statuses that do NOT block baseline verification. */
const NON_BLOCKING_BASELINE: ReadonlySet<BaselineReconciliationStatus> = new Set([
  'CONFIRMED_APPLIED',
  'CONFIRMED_NOT_APPLIED',
  'NOT_APPLICABLE',
]);

export interface ExecutionActivation {
  /** Whether the lifecycle is currently EXECUTION_ENABLED. */
  active: boolean;
  /** ISO timestamp execution was enabled, if known. */
  enabledAt: string | null;
  /** Actor that enabled execution, if known. */
  enabledBy: string | null;
  /** ISO expiry timestamp for a bounded activation window (null = no expiry
   *  column yet, or not activated). */
  expiresAt: string | null;
  /** Whether a bounded activation has expired (expiresAt in the past). Expired
   *  activation is treated as NOT active by the execution gate. */
  expired: boolean;
  /** Seconds remaining until expiry (0 if expired/none). */
  secondsRemaining: number;
}

export interface OperatorReadiness {
  // ── Identity / environment (all server-derived by the caller) ──
  environment: string;
  isProduction: boolean;
  operatorId: string | null;
  operatorRole: string | null;
  /** Whether the operator can pass the migration TOTP gate (admin_users has an
   *  encrypted TOTP secret). Boolean signal only — never the secret. */
  mfaEnrolled: boolean;
  /** Whether production execution is unlocked by env (two-key). */
  productionExecutionAllowedByEnv: boolean;
  /** Whether this environment is in the execution allowlist. */
  environmentAllowed: boolean;

  // ── Governance / ledger ──
  ledgerExists: boolean;
  lifecycleState: MigrationGovernanceLifecycle | 'UNBOOTSTRAPPED';

  // ── Manifest / migration counts ──
  manifestCount: number;
  highestIdentifier: string | null;
  appliedCount: number;
  pendingCount: number;
  conflictCount: number;
  runningCount: number;

  // ── Baseline reconciliation ──
  baselineReconciledCount: number;
  baselineUnresolvedCount: number;
  /** Identifiers with no baseline row yet. */
  baselineUnreconciled: string[];
  /** Identifiers reconciled with a blocking status (UNKNOWN/PARTIALLY_APPLIED). */
  baselineBlocking: string[];

  // ── Execution activation ──
  activation: ExecutionActivation;

  // ── Derived operator guidance ──
  /** The single next action the operator should take, in plain language. */
  nextAction: string;
  /** Every current blocker, in plain language (empty when execution is ready). */
  blockers: string[];
  /** Whether a single migration could be executed right now. */
  canExecuteNow: boolean;
}

function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  return neon(url);
}

/** Read the MFA gate signal for the operator — mirrors verifyFreshTotp's source
 *  (admin_users.totp_secret_encrypted). Read-only, never decrypts, never
 *  returns the secret. Returns false on any error (fail-closed signal). */
async function readMfaEnrolled(operatorId: string | null): Promise<boolean> {
  if (!operatorId) return false;
  try {
    const sql = getRawSql();
    const rows = (await sql`
      SELECT (totp_secret_encrypted IS NOT NULL) AS enrolled
      FROM admin_users WHERE id = ${operatorId} LIMIT 1
    `) as Array<{ enrolled: boolean }>;
    return Boolean(rows[0]?.enrolled);
  } catch {
    return false;
  }
}

function getAllowedEnvs(): string[] {
  return (process.env.MIGRATION_RUN_ALLOWED_ENVS ?? '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Aggregate the full operator readiness snapshot. READ-ONLY.
 *
 * @param operator Server-derived operator identity + role (never client-claimed).
 */
export async function buildOperatorReadiness(operator: {
  id: string | null;
  role: string | null;
}): Promise<OperatorReadiness> {
  const environment = getCurrentEnvironment();
  const isProduction = environment === 'production';
  const allowedEnvs = getAllowedEnvs();

  // Manifest is always readable (filesystem). Everything DB-backed is guarded.
  const manifest = discoverMigrationFiles();
  const manifestIds = manifest.files.map((f) => f.identifier);

  const [
    mfaEnrolled,
    hasLedger,
    lifecycleRaw,
    baselines,
  ] = await Promise.all([
    readMfaEnrolled(operator.id),
    ledgerExists().catch(() => false),
    getGovernanceLifecycleState().catch(() => null),
    readAllBaselineReconciliations().catch(() => ({} as Record<string, { reconciliation_status: BaselineReconciliationStatus }>)),
  ]);

  const lifecycleState: MigrationGovernanceLifecycle | 'UNBOOTSTRAPPED' =
    lifecycleRaw ?? 'UNBOOTSTRAPPED';

  // Canonical activation snapshot (single source: ledger.readExecutionActivation).
  const act = await readExecutionActivation().catch(() => null);
  const activation: ExecutionActivation = {
    active: act?.active ?? false,
    enabledAt: act?.enabledAt ?? null,
    enabledBy: act?.enabledBy ?? null,
    expiresAt: act?.expiresAt ?? null,
    expired: act?.expired ?? false,
    secondsRemaining: act?.secondsRemaining ?? 0,
  };

  // Ledger-derived counts — only meaningful when the ledger exists.
  let appliedCount = 0, pendingCount = 0, conflictCount = 0, runningCount = 0;
  if (hasLedger) {
    try {
      const state = await inspectMigrationState();
      appliedCount = state.applied.length;
      pendingCount = state.pending.length;
      conflictCount = state.conflicts.length;
      runningCount = state.running.length;
    } catch { /* leave zeros — fail-closed */ }
  } else {
    pendingCount = manifestIds.length; // nothing applied yet
  }

  // Baseline reconciliation counts against the current manifest.
  const baselineUnreconciled = manifestIds.filter((id) => !baselines[id]);
  const baselineBlocking = manifestIds.filter((id) => {
    const b = baselines[id];
    return b && !NON_BLOCKING_BASELINE.has(b.reconciliation_status);
  });
  const baselineReconciledCount = manifestIds.length - baselineUnreconciled.length;

  // ── Derive plain-language blockers + next action ──
  const blockers: string[] = [];
  if (operator.role !== 'super_admin') {
    blockers.push('You must be a platform super_admin to operate migration governance.');
  }
  if (!mfaEnrolled) {
    blockers.push('MFA is not enrolled for your account. Migration execution requires a fresh TOTP; enroll MFA in account settings.');
  }
  if (!hasLedger || lifecycleState === 'UNBOOTSTRAPPED') {
    blockers.push('Migration governance is not bootstrapped. Bootstrap the ledger to begin.');
  } else if (baselineUnreconciled.length > 0) {
    blockers.push(`${baselineUnreconciled.length} historical migration(s) still require baseline review before execution can be verified.`);
  } else if (baselineBlocking.length > 0) {
    blockers.push(`${baselineBlocking.length} baseline entr(y/ies) are UNKNOWN or PARTIALLY_APPLIED and must be resolved before verification.`);
  }
  if (hasLedger && lifecycleState !== 'UNBOOTSTRAPPED'
      && baselineUnreconciled.length === 0 && baselineBlocking.length === 0
      && lifecycleState !== 'BASELINE_VERIFIED' && lifecycleState !== 'EXECUTION_ENABLED') {
    blockers.push('Baseline is reconciled but not yet verified. Run "Verify Historical Baseline".');
  }
  if (lifecycleState !== 'EXECUTION_ENABLED') {
    blockers.push('Migration execution is not enabled. Temporarily enable execution (bounded window) to run a migration.');
  } else if (activation.expired) {
    blockers.push('The execution activation window has expired. Re-enable execution to run a migration.');
  }
  if (!allowedEnvs.includes(environment)) {
    blockers.push(`This environment ("${environment}") is not in MIGRATION_RUN_ALLOWED_ENVS. Execution is blocked here (dry-run still allowed).`);
  }
  if (isProduction && process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION !== 'true') {
    blockers.push('Production execution is disabled by default (MIGRATION_ALLOW_PRODUCTION_EXECUTION is not "true").');
  }

  // Next action: the first thing standing between the operator and a run.
  let nextAction: string;
  if (operator.role !== 'super_admin') nextAction = 'Sign in as a platform super_admin.';
  else if (!hasLedger || lifecycleState === 'UNBOOTSTRAPPED') nextAction = 'Bootstrap migration governance.';
  else if (baselineUnreconciled.length > 0) nextAction = 'Generate baseline evidence and review the historical baseline batch.';
  else if (baselineBlocking.length > 0) nextAction = 'Resolve UNKNOWN / PARTIALLY_APPLIED baseline entries.';
  else if (lifecycleState !== 'BASELINE_VERIFIED' && lifecycleState !== 'EXECUTION_ENABLED') nextAction = 'Verify the historical baseline.';
  else if (lifecycleState !== 'EXECUTION_ENABLED' || activation.expired) nextAction = 'Temporarily enable migration execution.';
  else if (pendingCount > 0) nextAction = 'Dry-run then run a pending migration.';
  else nextAction = 'Nothing pending — all migrations are applied.';

  const canExecuteNow =
    operator.role === 'super_admin' &&
    mfaEnrolled &&
    lifecycleState === 'EXECUTION_ENABLED' &&
    !activation.expired &&
    allowedEnvs.includes(environment) &&
    (!isProduction || process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION === 'true') &&
    pendingCount > 0;

  return {
    environment,
    isProduction,
    operatorId: operator.id,
    operatorRole: operator.role,
    mfaEnrolled,
    productionExecutionAllowedByEnv: process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION === 'true',
    environmentAllowed: allowedEnvs.includes(environment),
    ledgerExists: hasLedger,
    lifecycleState,
    manifestCount: manifest.count,
    highestIdentifier: manifest.highestPrefix ?? null,
    appliedCount,
    pendingCount,
    conflictCount,
    runningCount,
    baselineReconciledCount,
    baselineUnresolvedCount: baselineUnreconciled.length + baselineBlocking.length,
    baselineUnreconciled,
    baselineBlocking,
    activation,
    nextAction,
    blockers,
    canExecuteNow,
  };
}
