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

import { isMfaEnrolled } from '@/lib/mfaEnrollment';
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
  /** Whether the operator can pass the migration TOTP gate — resolved from the
   *  canonical users.mfa_enabled + users.mfa_secret_encrypted (same record the
   *  Settings Security page uses). Boolean signal only — never the secret. */
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

/** Read the MFA gate signal for the operator from the CANONICAL enrollment
 *  source (users.mfa_enabled + users.mfa_secret_encrypted) — the exact record
 *  the Settings Security page and the migration fresh-TOTP gate use. Read-only,
 *  never decrypts, never returns the secret. Returns false on any error. */
async function readMfaEnrolled(operatorId: string | null): Promise<boolean> {
  return isMfaEnrolled(operatorId);
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

  // Diagnosis-only, sanitized: confirm the canonical MFA lookup resolved for
  // this operator on the deployed environment. Truncated id; NO secret.
  console.log('[migration-readiness] mfa-check', JSON.stringify({
    operatorId: operator.id ? `${String(operator.id).slice(0, 8)}…` : null,
    role: operator.role,
    mfaEnrolled,
    lifecycleState,
  }));

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
  if (!activation.active) {
    if (lifecycleState !== 'EXECUTION_ENABLED') {
      blockers.push('Migration execution is not enabled. Temporarily enable execution (bounded window) to run a migration.');
    } else if (activation.expired) {
      blockers.push('The execution activation window has expired. Re-enable execution (bounded window) to run a migration.');
    } else if (activation.expiresAt === null) {
      // EXECUTION_ENABLED but no bounded window (legacy indefinite). Fail-closed:
      // the gate treats this as disabled and auto-relocks on next check.
      blockers.push('Execution is flagged enabled without a bounded window (legacy/indefinite) — this fails closed. Temporarily enable execution to get a valid window.');
    }
  }
  // The execution allowlist + production two-key are the ACTUAL-EXECUTION gate.
  // They do NOT gate bootstrap or baseline governance, so only surface them once
  // the operator has reached the execution stage (baseline verified / execution
  // enabled). Presenting them earlier made it look like an execution-only env
  // gate was blocking bootstrap, which it must not.
  const atExecutionStage =
    lifecycleState === 'BASELINE_VERIFIED' || lifecycleState === 'EXECUTION_ENABLED';
  if (atExecutionStage && !allowedEnvs.includes(environment)) {
    blockers.push(`This environment ("${environment}") is not in MIGRATION_RUN_ALLOWED_ENVS. Migration EXECUTION is blocked here (bootstrap, baseline, and dry-run are unaffected).`);
  }
  if (atExecutionStage && isProduction && process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION !== 'true') {
    blockers.push('Production migration EXECUTION is disabled by default (MIGRATION_ALLOW_PRODUCTION_EXECUTION is not "true"). This gates running migrations only — not bootstrap or baseline.');
  }

  // Next action: the first thing standing between the operator and a run.
  let nextAction: string;
  if (operator.role !== 'super_admin') nextAction = 'Sign in as a platform super_admin.';
  else if (!hasLedger || lifecycleState === 'UNBOOTSTRAPPED') nextAction = 'Bootstrap migration governance.';
  else if (baselineUnreconciled.length > 0) nextAction = 'Generate baseline evidence and review the historical baseline batch.';
  else if (baselineBlocking.length > 0) nextAction = 'Resolve UNKNOWN / PARTIALLY_APPLIED baseline entries.';
  else if (lifecycleState !== 'BASELINE_VERIFIED' && lifecycleState !== 'EXECUTION_ENABLED') nextAction = 'Verify the historical baseline.';
  else if (!activation.active) nextAction = 'Temporarily enable migration execution (bounded window).';
  else if (pendingCount > 0) nextAction = 'Dry-run then run a pending migration.';
  else nextAction = 'Nothing pending — all migrations are applied.';

  const canExecuteNow =
    operator.role === 'super_admin' &&
    mfaEnrolled &&
    activation.active && // EXECUTION_ENABLED + valid bounded window (fail-closed)
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
