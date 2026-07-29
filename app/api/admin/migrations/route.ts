// app/api/admin/migrations/route.ts
//
// Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
//
// The canonical migration API route. This is the single authorized entry point
// for migration inspection and execution under the governance model.
//
// Actions:
// - GET: inspect migration state (manifest + ledger + pending/conflicts). Read-only.
//        Requires admin or super_admin session (platform.migrations.inspect).
// - POST: execute migrations. Body:
//   { action: 'inspect' | 'run-pending' | 'run-single' | 'dry-run-pending' | 'dry-run-single',
//     identifier?: string,       // for run-single/dry-run-single
//     totpCode?: string,         // fresh TOTP for human execution (required for non-dry-run)
//     limit?: number }           // optional limit for run-pending
//
// Authorization:
// - inspect/dry-run: admin or super_admin session.
// - execute: super_admin session + environment allowlist + production flag + fresh TOTP.
// - Production execution is disabled by default (two-key requirement).
//
// Security:
// - No client-supplied SQL. Only migration identifiers from the canonical manifest.
// - No arbitrary filename input. Filenames are derived from the manifest.
// - No path traversal (manifest is built from a fixed directory scan).

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import {
  inspectMigrationState,
  runPendingMigrations,
  runSinglePendingMigration,
  authorizeMigration,
  verifyFreshTotp,
  verifyTotpStepValidity,
  isLegacyInlineEnabled,
  isLegacySystemToolsRunEnabled,
  getCurrentEnvironment,
} from '@/lib/migrations/runner';
import {
  generateCorrelationId,
  beginGovernedAction,
  completeGovernedAction,
  failGovernedAction,
} from '@/lib/migrations/governedTotpAction';
import {
  REGISTRY_DEPLOYMENT,
  analyzeRegistryMigration,
  verifyTablesState,
} from '@/lib/migrations/targetedRegistryDeployment';
import { readFileSync } from 'node:fs';
import type { TargetedExecutionPermit } from '@/lib/migrations/types';
import { validateMigrationManifest, discoverMigrationFiles } from '@/lib/migrations/manifest';
import {
  emitAuditEvent,
  getGovernanceLifecycleState,
  recordBaselineReconciliation,
  readBaselineReconciliation,
  readAllBaselineReconciliations,
  verifyBaselineComplete,
  advanceToBaselineVerified,
  enableExecution,
  disableExecution,
  bootstrapMigrationLedger,
  recordBaselineBatchRows,
  enableExecutionTemporary,
  readExecutionActivation,
  readLedgerRow,
  readMigrationRunHistory,
} from '@/lib/migrations/ledger';
import {
  buildExecutionIdentity,
  computeExecutionDigest,
  assessExecutionEligibility,
} from '@/lib/migrations/executionReview';
import {
  canonicalizeExecutionBatch,
  computeExecutionBatchDigest,
  batchExecutionOrder,
} from '@/lib/migrations/executionBatch';
import { generateBaselineEvidence } from '@/lib/migrations/baselineEvidence';
import { buildOperatorReadiness } from '@/lib/migrations/operatorReadiness';
import {
  canonicalizeBaselineBatch,
  computeBaselineBatchDigest,
  validateBaselineBatch,
  baselineBatchStatusCounts,
  recordBaselineBatch,
  type ClientBaselineReview,
} from '@/lib/migrations/baselineBatch';
import type {
  MigrationAction,
  MigrationActorType,
  RunPendingMigrationsOptions,
  RunSingleMigrationOptions,
} from '@/lib/migrations/runner';
import type {
  BaselineReconciliationStatus,
  BaselineEvidenceType,
} from '@/lib/migrations/types';

/**
 * GET /api/admin/migrations — inspect migration state (read-only).
 */
export async function GET(req: NextRequest) {
  // Rate limit.
  const rl = await checkRateLimit('migrate', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  // Auth: admin or super_admin.
  const adminUser = await requireAdminApi(req);
  if (!adminUser) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Authorize inspect.
  const auth = authorizeMigration({
    action: 'inspect',
    actorType: 'human',
    actorId: adminUser.id,
    adminUser,
    dryRun: true,
    totpVerified: false,
  });
  if (!auth.allowed) {
    return NextResponse.json({ success: false, error: auth.reason }, { status: 403 });
  }

  try {
    const state = await inspectMigrationState();
    const validation = validateMigrationManifest(state.manifest);

    return NextResponse.json({
      success: true,
      environment: getCurrentEnvironment(),
      ledgerExists: state.ledgerExists,
      manifest: {
        count: state.manifest.count,
        highestPrefix: state.manifest.highestPrefix,
        duplicates: state.manifest.duplicates,
        gaps: state.manifest.gaps,
      },
      validation: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        notes: validation.notes,
      },
      pending: state.pending,
      applied: state.applied,
      failed: state.failed,
      conflicts: state.conflicts,
      running: state.running,
      legacyFlags: {
        inlineEnabled: isLegacyInlineEnabled(),
        systemToolsRunEnabled: isLegacySystemToolsRunEnabled(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Inspection failed: ${msg}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/migrations — execute or dry-run migrations.
 */
export async function POST(req: NextRequest) {
  // Rate limit.
  const rl = await checkRateLimit('migrate', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  // Auth: super_admin for execution, admin for inspect/dry-run.
  const adminUser = await requireAdminApi(req);
  if (!adminUser) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string | undefined;
  const identifier = body?.identifier as string | undefined;
  const totpCode = body?.totpCode as string | undefined;
  const limit = body?.limit as number | undefined;

  // Sanitized per-request correlation id. Logged on every governed branch so a
  // duplicate submission (same idempotencyKey, different correlationId) is
  // provable from the logs. NEVER contains the TOTP code or any secret.
  const correlationId = generateCorrelationId();
  // Client-supplied idempotency key (one per confirmed submission). Duplicate
  // concurrent requests share it and collapse onto a single mutation; absent it,
  // each request is treated as a distinct attempt.
  const rawIdemKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const idempotencyKey = rawIdemKey.length > 0 && rawIdemKey.length <= 200 ? rawIdemKey : correlationId;
  // Typed production confirmation — case/whitespace-insensitive so browser
  // auto-capitalization ("Production") does not silently block a legitimate
  // operator. The gate still requires the operator to type the word.
  const productionConfirmed =
    typeof body?.productionConfirmation === 'string' &&
    body.productionConfirmation.trim().toLowerCase() === 'production';
  const logGov = (msg: string, extra: Record<string, unknown> = {}) => {
    // eslint-disable-next-line no-console
    console.info(`[migrations] ${correlationId} action=${action ?? '?'} actor=${adminUser.id.slice(0, 8)}… ${msg}`, extra);
  };

  // Validate action.
  const validActions = [
    'inspect',
    'run-pending',
    'run-single',
    'dry-run-pending',
    'dry-run-single',
    // Baseline control plane (MIGRATION-GOV-11, Phase 1A.2):
    'inspect-baseline',
    'record-baseline-entry',
    'verify-baseline',
    'enable-execution',
    'disable-execution',
    // Operator-recovery surface (Phase 1A operator console):
    'inspect-readiness',        // consolidated read-only dashboard
    'generate-baseline-evidence', // read-only schema-introspection evidence
    'bootstrap',                // create the ledger tables (super_admin + TOTP)
    'prepare-baseline-batch',   // read-only: canonicalize + digest a reviewed set
    'record-baseline-batch',    // mutation: record whole reviewed batch (1 TOTP)
    'activation-status',        // read-only: bounded-activation status + expiry
    'enable-execution-temporary', // mutation: bounded activation window (TOTP)
    'prepare-execution-single', // read-only: reviewed execution payload + digest
    'execute-reviewed-single',  // mutation: run ONE migration (canonical runner)
    'prepare-execution-batch',  // read-only: reviewed batch (canonical order + digest)
    'execute-reviewed-batch',   // mutation: run selected batch, stop-on-first-failure
    'execute-registry-113',     // mutation: TARGETED deployment of ONLY migration 113 (document registry)
    'execute-reconciliation-114', // mutation: TARGETED deployment of ONLY migration 114 (reconciliation audit + digest invalidations)
    'execute-personnel-115',    // mutation: TARGETED deployment of ONLY migration 115 (personnel roles of record — AAC WS-6)
    'execute-engineering-review-116', // mutation: TARGETED deployment of ONLY migration 116 (digest-bound engineering review — AAC WS-8/WS-9)
  ];
  if (!action || !validActions.includes(action)) {
    return NextResponse.json(
      { success: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
      { status: 400 },
    );
  }

  // MIGRATION-GOV-05: The actor type is ALWAYS 'human' for API-route
  // requests. The 'migration-actor' type (automated service token) is a
  // server-side-only concept and CANNOT be client-selected. We explicitly
  // ignore any client-supplied actorType field to prevent privilege
  // escalation.
  const clientActorType = body?.actorType as string | undefined;
  if (clientActorType && clientActorType !== 'human') {
    return NextResponse.json(
      { success: false, error: "Client-supplied actorType is not permitted. Actor type is determined server-side." },
      { status: 403 },
    );
  }

  const isDryRun = action.startsWith('dry-run');
  const isExecute = action.startsWith('run') && !isDryRun;
  const isBaselineControl = [
    'inspect-baseline',
    'record-baseline-entry',
    'verify-baseline',
    'enable-execution',
    'disable-execution',
  ].includes(action);

  // MIGRATION-GOV-11 (Phase 1A.2): Baseline control plane actions.
  // - inspect-baseline: read-only (inspect action).
  // - record-baseline-entry, verify-baseline: baseline governance (bootstrap
  //   action — super_admin required, no TOTP needed for reconciliation
  //   recording, but env checks apply to verify-baseline since it advances
  //   the lifecycle).
  // - enable-execution, disable-execution: critical governance mutations
  //   (execute action — super_admin + TOTP + env checks required).
  const isBaselineReadonly = action === 'inspect-baseline';
  const isBaselineMutation = ['record-baseline-entry', 'verify-baseline'].includes(action);
  const isExecutionActivation = ['enable-execution', 'disable-execution', 'enable-execution-temporary'].includes(action);
  const isActivationStatus = action === 'activation-status';

  // Operator-recovery surface classification.
  // - inspect-readiness / generate-baseline-evidence: READ-ONLY (no mutation,
  //   no TOTP) but super_admin-only (they reveal governance internals + the
  //   operator's MFA gate signal). Enforced explicitly below.
  // - bootstrap: MUTATION (creates ledger tables) — super_admin + fresh TOTP +
  //   reason + production typed-confirmation, same bar as execution activation.
  const isReadiness = action === 'inspect-readiness';
  const isEvidence = action === 'generate-baseline-evidence';
  const isBootstrap = action === 'bootstrap';
  const isPrepareBatch = action === 'prepare-baseline-batch';
  const isRecordBatch = action === 'record-baseline-batch';
  const isPrepareExec = action === 'prepare-execution-single';
  const isExecuteReviewed = action === 'execute-reviewed-single';
  const isPrepareExecBatch = action === 'prepare-execution-batch';
  const isExecuteReviewedBatch = action === 'execute-reviewed-batch';
  // TARGETED authority-registry deployment — each action executes ONLY its one
  // migration (113 document registry, or 114 reconciliation audit + digest
  // invalidations) via the canonical runner under a bounded, identifier-scoped
  // permit. Real execution (full bar: super_admin + fresh TOTP + reason + typed
  // production confirmation + production allowlist + MIGRATION_ALLOW_PRODUCTION_
  // EXECUTION). Statically verified idempotent CREATE-TABLE-only + non-
  // destructive before any permit is issued (targetedRegistryDeployment.ts).
  const isRegistry113 = action === 'execute-registry-113';
  const isReconciliation114 = action === 'execute-reconciliation-114';
  // AAC WS-6 — migration 115 (personnel_roles + project_personnel_assignments),
  // the same pure additive CREATE-TABLE-only shape, through the same static gate.
  const isPersonnel115 = action === 'execute-personnel-115';
  const isEngineeringReview116 = action === 'execute-engineering-review-116';
  const isRegistryDeploy = isRegistry113 || isReconciliation114 || isPersonnel115 || isEngineeringReview116;
  const isOperatorReadonly = isReadiness || isEvidence || isPrepareBatch || isActivationStatus || isPrepareExec || isPrepareExecBatch;

  // Determine the migration action type for authorization.
  let migrationAction: MigrationAction;
  if (isExecute || isExecutionActivation || isExecuteReviewed || isExecuteReviewedBatch || isRegistryDeploy) {
    migrationAction = 'execute';
  } else if (isBaselineMutation || isBootstrap || isRecordBatch) {
    migrationAction = 'bootstrap';
  } else {
    migrationAction = 'inspect';
  }

  // Operator-console surface is super_admin-only (matches the page's access
  // model). The read-only operator actions need an explicit gate because
  // authorizeMigration('inspect') otherwise permits plain 'admin'.
  if ((isOperatorReadonly || isBootstrap || isRecordBatch || isExecuteReviewed || isExecuteReviewedBatch || isRegistryDeploy) && adminUser.role !== 'super_admin') {
    return NextResponse.json(
      { success: false, error: `Action '${action}' requires super_admin role.` },
      { status: 403 },
    );
  }
  const actorType: MigrationActorType = 'human';

  // Verify fresh TOTP for non-dry-run execution AND execution activation/
  // deactivation (MIGRATION-GOV-05, MIGRATION-GOV-11 Phase 1A.2).
  // verifyFreshTotp now returns a result object with fail-closed semantics:
  // - MFA_NOT_ENABLED: user has no MFA secret → DENIED (not waived)
  // - TOTP_INVALID: code doesn't match → retry allowed
  // - TOTP_REPLAY: time-step already consumed → must wait for next step
  // NOTE: `bootstrap` is deliberately EXCLUDED here. Its TOTP is verified and
  // consumed inside its own branch AFTER authorizeMigration, via the idempotent,
  // action-scoped, release-on-failure reservation (governedTotpAction). Consuming
  // it here — before authorization and with no idempotency — was the root cause
  // of the "new code still says already used" replay: an authorization rejection
  // or a losing duplicate burned the step while the real error was hidden.
  let totpVerified = false;
  if (isExecute || isExecutionActivation || isRecordBatch || isExecuteReviewed || isExecuteReviewedBatch || isRegistryDeploy) {
    if (!totpCode || typeof totpCode !== 'string') {
      return NextResponse.json(
        { success: false, error: 'A fresh TOTP code is required for this action. Provide it in the "totpCode" field.' },
        { status: 403 },
      );
    }
    try {
      const totpResult = await verifyFreshTotp(adminUser.id, totpCode);
      totpVerified = totpResult.verified;
      if (!totpVerified) {
        const reasonMessages: Record<string, string> = {
          MFA_NOT_ENABLED: 'MFA is not enabled for this account. Migration execution requires MFA enrollment. Enable MFA in your account settings and retry.',
          TOTP_INVALID: 'TOTP verification failed. The code is invalid or expired. Generate a fresh code and retry.',
          TOTP_REPLAY: 'This TOTP code has already been used for a migration mutation. Wait for the next 30-second time-step and generate a new code.',
        };
        const message = totpResult.deniedReason
          ? (reasonMessages[totpResult.deniedReason] ?? 'TOTP verification failed.')
          : 'TOTP verification failed.';
        // Emit audit event for MFA denial (MIGRATION-GOV-05).
        emitAuditEvent({
          type: totpResult.deniedReason === 'TOTP_REPLAY'
            ? 'migration.mfa.replay_detected'
            : 'migration.mfa.denied',
          actorType: 'human',
          actorId: adminUser.id,
          environment: getCurrentEnvironment(),
          executionId: null,
          migrationIdentifier: identifier ?? null,
          filename: null,
          details: {
            deniedReason: totpResult.deniedReason,
            timeStep: totpResult.timeStep,
          },
        });
        return NextResponse.json(
          { success: false, error: message, deniedReason: totpResult.deniedReason },
          { status: 403 },
        );
      }
    } catch {
      totpVerified = false;
      // Emit audit event for MFA error (MIGRATION-GOV-05).
      emitAuditEvent({
        type: 'migration.mfa.denied',
        actorType: 'human',
        actorId: adminUser.id,
        environment: getCurrentEnvironment(),
        executionId: null,
        migrationIdentifier: identifier ?? null,
        filename: null,
        details: { deniedReason: 'MFA_ERROR' },
      });
      return NextResponse.json(
        { success: false, error: 'TOTP verification encountered an error. Retry with a fresh code.' },
        { status: 403 },
      );
    }
  }

  // Authorize.
  const auth = authorizeMigration({
    action: migrationAction,
    actorType,
    actorId: adminUser.id,
    adminUser,
    dryRun: isDryRun,
    totpVerified,
  });
  if (!auth.allowed) {
    return NextResponse.json({ success: false, error: auth.reason }, { status: 403 });
  }

  try {
    // ── Operator-recovery surface (Phase 1A operator console) ──────────────

    if (isReadiness) {
      // Consolidated read-only readiness dashboard — one round-trip for the
      // console. Server-derives identity + role + environment; never trusts
      // client claims. Redacted: no DB URL / secret / token / MFA secret.
      const readiness = await buildOperatorReadiness({
        id: adminUser.id,
        role: adminUser.role,
      });
      return NextResponse.json({ success: true, action: 'inspect-readiness', readiness });
    }

    if (isEvidence) {
      // Read-only historical baseline evidence generation. Zero mutation
      // (schema introspection only). The generator asserts read-only SQL
      // internally. Returns one proposal per manifest migration for review.
      const report = await generateBaselineEvidence();
      // Already-recorded baselines ride along so the console can LOCK those
      // rows instead of re-proposing them as UNKNOWN — regenerating evidence
      // was silently discarding the operator's recorded review work (Ray,
      // 2026-07-20: "recorded 82" then the table showed UNKNOWN again).
      const recordedBaselines = await readAllBaselineReconciliations().catch(() => ({} as Record<string, { reconciliation_status: string }>));
      return NextResponse.json({
        success: true,
        action: 'generate-baseline-evidence',
        recorded: Object.fromEntries(Object.entries(recordedBaselines).map(([k, v]) => [k, (v as { reconciliation_status: string }).reconciliation_status])),
        environment: report.environment,
        generatedAt: report.generatedAt,
        manifestCount: report.manifestCount,
        performedMutation: report.performedMutation, // always false
        statusCounts: report.statusCounts,
        evidenceTypeCounts: report.evidenceTypeCounts,
        hasManualReviewRequired: report.hasManualReviewRequired,
        errors: report.errors,
        proposals: report.proposals.map((p) => ({
          identifier: p.migrationIdentifier,
          filename: p.filename,
          checksumSha256: p.checksumSha256,
          transactionMode: p.transactionMode,
          proposedStatus: p.proposedStatus,
          confidence: p.confidence,
          evidenceType: p.evidenceType,
          manualReviewRequired: p.manualReviewRequired,
          expectedObjectCount: p.expectedObjects.length,
          detectedObjectCount: p.detectedObjects.length,
          missingObjects: p.missingObjects.map((o) => `${o.kind}:${o.parentTable ? `${o.parentTable}.` : ''}${o.name}`),
          conflictingObjects: p.conflictingObjects.map((o) => `${o.kind}:${o.parentTable ? `${o.parentTable}.` : ''}${o.name}`),
          notes: p.notes,
        })),
      });
    }

    if (isBootstrap) {
      // Create the ledger tables (idempotent). super_admin enforced above;
      // authorizeMigration (run already) enforced env allowlist + production
      // two-key WITHOUT consuming any TOTP. Now: validate cheap inputs, verify
      // TOTP *validity*, reserve ONE idempotent attempt, run, and settle.
      const reason = (body?.reason as string | undefined)?.trim();
      if (!reason) {
        return NextResponse.json(
          { success: false, error: 'A non-empty "reason" is required for bootstrap.', correlationId },
          { status: 400 },
        );
      }
      if (getCurrentEnvironment() === 'production'
          && !productionConfirmed) {
        return NextResponse.json(
          { success: false, error: 'Production bootstrap requires productionConfirmation === "production".', correlationId },
          { status: 400 },
        );
      }
      if (!totpCode || typeof totpCode !== 'string') {
        return NextResponse.json(
          { success: false, error: 'A fresh TOTP code is required for bootstrap. Provide it in the "totpCode" field.', correlationId },
          { status: 403 },
        );
      }

      // ── TOTP validity (no ledger write; a failed auth never burns a code) ──
      const validity = await verifyTotpStepValidity(adminUser.id, totpCode);
      if (!validity.verified || validity.timeStep === null) {
        const reasonMessages: Record<string, string> = {
          MFA_NOT_ENABLED: 'MFA is not enabled for this account. Migration execution requires MFA enrollment. Enable MFA in your account settings and retry.',
          TOTP_INVALID: 'TOTP verification failed. The code is invalid or expired. Generate a fresh code and retry.',
        };
        const message = validity.deniedReason ? (reasonMessages[validity.deniedReason] ?? 'TOTP verification failed.') : 'TOTP verification failed.';
        emitAuditEvent({
          type: 'migration.mfa.denied', actorType: 'human', actorId: adminUser.id,
          environment: getCurrentEnvironment(), executionId: null, migrationIdentifier: null,
          filename: null, details: { deniedReason: validity.deniedReason, correlationId },
        });
        logGov('bootstrap TOTP invalid', { deniedReason: validity.deniedReason });
        return NextResponse.json(
          { success: false, error: message, deniedReason: validity.deniedReason, correlationId },
          { status: 403 },
        );
      }

      // ── Reserve exactly ONE bootstrap attempt for this accepted step ──
      const begin = await beginGovernedAction({
        userId: adminUser.id, actionKey: 'bootstrap', timeStep: validity.timeStep,
        idempotencyKey, correlationId,
      });

      if (begin.outcome === 'REPLAY') {
        emitAuditEvent({
          type: 'migration.mfa.replay_detected', actorType: 'human', actorId: adminUser.id,
          environment: getCurrentEnvironment(), executionId: null, migrationIdentifier: null,
          filename: null, details: { deniedReason: 'TOTP_REPLAY', timeStep: validity.timeStep, correlationId },
        });
        logGov('bootstrap TOTP replay denied', { timeStep: validity.timeStep });
        return NextResponse.json(
          { success: false, error: 'This TOTP code has already been used for a migration mutation. Wait for the next 30-second time-step and generate a new code.', deniedReason: 'TOTP_REPLAY', correlationId },
          { status: 403 },
        );
      }

      if (begin.outcome === 'IDEMPOTENT') {
        // A duplicate of THIS submission. Return the winning request's actual
        // result verbatim — this is what stops a duplicate from masking the
        // first request's real error behind a spurious replay.
        const stored = begin.stored;
        const body2 = (stored.body && typeof stored.body === 'object')
          ? { ...(stored.body as Record<string, unknown>), idempotentReplay: true, correlationId }
          : stored.body;
        logGov('bootstrap idempotent duplicate collapsed', { httpStatus: stored.httpStatus });
        return NextResponse.json(body2, { status: stored.httpStatus });
      }

      // ── PROCEED: run the mutation, then settle the reservation ──
      logGov('bootstrap proceeding', { timeStep: validity.timeStep });
      const consume = async (httpStatus: number, respBody: Record<string, unknown>, ok: boolean) => {
        const settled = { ...respBody, correlationId };
        try {
          if (ok) {
            await completeGovernedAction(adminUser.id, 'bootstrap', validity.timeStep!, { httpStatus, body: settled });
          } else {
            // Release-on-failure: a failed bootstrap must not burn the next code.
            await failGovernedAction(adminUser.id, 'bootstrap', validity.timeStep!, { httpStatus, body: settled });
          }
        } catch { /* settling is best-effort; never mask the real response */ }
        return NextResponse.json(settled, { status: httpStatus });
      };

      let result: { success: boolean; alreadyExisted: boolean; error?: string };
      try {
        result = await bootstrapMigrationLedger('human', adminUser.id);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        emitAuditEvent({
          type: 'migration.bootstrap.failed', actorType: 'human', actorId: adminUser.id,
          environment: getCurrentEnvironment(), executionId: null, migrationIdentifier: null,
          filename: null, details: { reason, viaOperatorConsole: true, error: errMsg, correlationId },
        });
        logGov('bootstrap threw — reservation released', { error: errMsg });
        return await consume(500, {
          success: false, action: 'bootstrap', alreadyExisted: false, error: errMsg,
          lifecycleState: (await getGovernanceLifecycleState().catch(() => null)) ?? 'UNBOOTSTRAPPED',
        }, false);
      }

      emitAuditEvent({
        type: result.success ? 'migration.bootstrap.completed' : 'migration.bootstrap.failed',
        actorType: 'human', actorId: adminUser.id, environment: getCurrentEnvironment(),
        executionId: null, migrationIdentifier: null, filename: null,
        details: { reason, alreadyExisted: result.alreadyExisted, viaOperatorConsole: true, error: result.error ?? null, correlationId },
      });
      logGov(result.success ? 'bootstrap completed' : 'bootstrap failed', { alreadyExisted: result.alreadyExisted, error: result.error ?? null });
      return await consume(result.success ? 200 : 500, {
        success: result.success,
        action: 'bootstrap',
        alreadyExisted: result.alreadyExisted,
        error: result.error ?? undefined,
        lifecycleState: (await getGovernanceLifecycleState()) ?? 'UNBOOTSTRAPPED',
      }, result.success);
    }

    if (isRegistryDeploy) {
      // ── TARGETED authority-registry deployment: execute ONLY 113 or 114 ────
      // super_admin + active MFA + fresh TOTP + production allowlist +
      // MIGRATION_ALLOW_PRODUCTION_EXECUTION=true are ALREADY enforced above
      // (super_admin gate + shared fresh-TOTP gate + authorizeMigration('execute')).
      // Here: reason + typed production confirmation, read-only static analysis
      // (idempotent CREATE-TABLE-only + non-destructive + creates exactly the
      // expected table(s)) and a tables-present check, then a bounded,
      // identifier-scoped permit through the CANONICAL runner (advisory lock +
      // checksum + ledger + run-history + durable audit). Success is read back
      // from the ledger + run-history + the ACTUAL tables, with an automatic
      // relock. Each action is HARDCODED to its one identifier (body.identifier
      // is ignored). It NEVER runs any other migration, never "all pending", and
      // never marks the historical baseline verified. Idempotent: if the
      // table(s) already exist it is a safe no-op.
      const identifier = isRegistry113 ? '113'
        : isReconciliation114 ? '114'
        : isPersonnel115 ? '115'
        : '116';
      const spec = REGISTRY_DEPLOYMENT[identifier];
      const reason = (body?.reason as string | undefined)?.trim();
      if (!reason) {
        return NextResponse.json({ success: false, action, error: 'A non-empty "reason" is required.', correlationId }, { status: 400 });
      }
      const env = getCurrentEnvironment();
      if (env === 'production' && !productionConfirmed) {
        return NextResponse.json({ success: false, action, error: 'Production targeted deployment requires productionConfirmation === "production".', correlationId }, { status: 400 });
      }

      // Read the target migration from the canonical manifest, server-side —
      // exact SQL, no client input; body.identifier is deliberately ignored.
      const manifest = discoverMigrationFiles();
      const file = manifest.files.find((f) => f.identifier === identifier);
      if (!file) {
        return NextResponse.json({ success: false, action, error: `Migration ${identifier} is missing from the manifest.`, correlationId }, { status: 409 });
      }
      const sql = readFileSync(file.fullPath, 'utf8');

      // Static analysis: idempotent CREATE-TABLE-only, non-destructive, creates
      // exactly the expected table(s).
      const shape = analyzeRegistryMigration(identifier, sql, spec.expectedTables);
      if (!shape.ok) {
        return NextResponse.json({ success: false, action, error: `Static verification failed: ${shape.problems.join(' ')}`, verification: shape, correlationId }, { status: 409 });
      }

      // Read-only table state before.
      const before = await verifyTablesState(spec.expectedTables);
      const verification = {
        idempotent: shape.idempotent,
        nonDestructive: shape.nonDestructive,
        expectedTables: spec.expectedTables,
        createdTables: shape.createdTables,
        tablesMatchExpected: shape.tablesMatchExpected,
        tablesPresentBefore: before.presentTables,
        tablesAbsentBefore: before.absentTables,
      };

      // Idempotent short-circuit: if ALL expected tables already exist, the
      // migration is effectively applied — do nothing (never re-run).
      if (before.allPresent) {
        logGov(`registry-${identifier} tables already present — no-op`, {});
        emitAuditEvent({ type: 'migration.migration.skipped', actorType: 'human', actorId: adminUser.id, environment: env, executionId: null, migrationIdentifier: identifier, filename: file.filename, details: { targetedRegistryDeployment: true, reason, note: 'expected table(s) already present (idempotent no-op)', correlationId } });
        return NextResponse.json({
          success: true, action, identifier, alreadyApplied: true,
          scope: 'Targeted authority-registry deployment only. Historical baseline remains incomplete.',
          verification, tablesPresentAfter: true,
          lifecycleState: (await getGovernanceLifecycleState().catch(() => null)) ?? 'UNBOOTSTRAPPED',
          correlationId,
        }, { status: 200 });
      }

      // Bounded, identifier-scoped permit (the activation window). Bypasses ONLY
      // the global EXECUTION_ENABLED gate — never "run all pending", never
      // another identifier.
      const permit: TargetedExecutionPermit = { identifier, issuedAtMs: Date.now(), ttlMs: 3 * 60 * 1000, reason };

      // Canonical runner: forced dry-run first (proof, not execution), then run.
      const dryRunResult = await runSinglePendingMigration(identifier, { dryRun: true, authorization: auth, targetedPermit: permit } as RunSingleMigrationOptions);
      const execution = await runSinglePendingMigration(identifier, { dryRun: false, authorization: auth, targetedPermit: permit } as RunSingleMigrationOptions);

      // Success from the LEDGER + run-history + the ACTUAL tables — never HTTP.
      const ledgerRow = await readLedgerRow(identifier).catch(() => null);
      const runHistory = await readMigrationRunHistory(identifier, 5).catch(() => []);
      const appliedInLedger = ledgerRow?.status === 'applied';
      const appliedRun = runHistory.some((r) => r.status === 'applied' && r.execution_id === execution.executionId);
      const after = await verifyTablesState(spec.expectedTables);
      const verifiedSuccess = appliedInLedger && appliedRun && after.allPresent;

      // Automatic relock: the permit is single-use and consumed, and the global
      // lifecycle was NEVER enabled — so execution is not left open. Defensive:
      // if the lifecycle somehow reads EXECUTION_ENABLED, relock it. NEVER
      // advance/verify the historical baseline.
      let lifecycleAfter = (await getGovernanceLifecycleState().catch(() => null)) ?? 'UNBOOTSTRAPPED';
      if (lifecycleAfter === 'EXECUTION_ENABLED') {
        await disableExecution(adminUser.id, `auto-relock after targeted registry deployment of ${identifier}`).catch(() => false);
        lifecycleAfter = (await getGovernanceLifecycleState().catch(() => null)) ?? 'UNBOOTSTRAPPED';
      }
      const relocked = lifecycleAfter !== 'EXECUTION_ENABLED';

      emitAuditEvent({
        type: verifiedSuccess ? 'migration.run.completed' : 'migration.run.failed',
        actorType: 'human', actorId: adminUser.id, environment: env,
        executionId: execution.executionId, migrationIdentifier: identifier, filename: file.filename,
        details: { targetedRegistryDeployment: true, reason, checksum: file.checksumSha256, verification: { ...verification, tablesPresentAfter: after.presentTables }, ledgerStatus: ledgerRow?.status ?? null, verifiedSuccess, relocked, lifecycleAfter, baselineVerified: false, correlationId },
      });
      logGov(verifiedSuccess ? `registry-${identifier} applied` : `registry-${identifier} failed`, { ledgerStatus: ledgerRow?.status ?? null, relocked });

      return NextResponse.json({
        success: verifiedSuccess,
        action,
        identifier,
        scope: 'Targeted authority-registry deployment only. Historical baseline remains incomplete.',
        verifiedFrom: 'ledger+run_history+tables',
        checksum: file.checksumSha256,
        verification: { ...verification, tablesPresentAfter: after.presentTables, tablesAbsentAfter: after.absentTables },
        dryRun: { status: dryRunResult.status, errorCode: dryRunResult.errorCode },
        execution: { status: execution.status, executionId: execution.executionId, durationMs: execution.durationMs, errorCode: execution.errorCode, errorSummary: execution.errorSummary },
        ledger: ledgerRow ? { status: ledgerRow.status, appliedAt: ledgerRow.applied_at, executionId: ledgerRow.execution_id } : null,
        runHistory: runHistory.map((r) => ({ status: r.status, executionId: r.execution_id, completedAt: r.completed_at, errorCode: r.error_code })),
        tablesPresentAfter: after.allPresent,
        relock: { relocked, lifecycleState: lifecycleAfter, baselineVerified: false },
        correlationId,
      }, { status: verifiedSuccess ? 200 : 409 });
    }

    if (isPrepareBatch || isRecordBatch) {
      // ── Reviewed baseline batch (Commit 3) ──────────────────────────────
      // The client supplies ONLY per-identifier review decisions; the server
      // owns identifiers/filenames/checksums/order from the manifest and
      // computes the tamper-evident digest. Reordered/tampered client input
      // cannot change the recorded facts.
      const rawReviews = Array.isArray(body?.reviews) ? body.reviews : null;
      if (!rawReviews) {
        return NextResponse.json(
          { success: false, error: '"reviews" (array of { identifier, status, notes }) is required.' },
          { status: 400 },
        );
      }
      const VALID_STATUSES = new Set<BaselineReconciliationStatus>([
        'CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'PARTIALLY_APPLIED',
        'NOT_APPLICABLE', 'UNKNOWN',
      ]);
      const clientReviews: ClientBaselineReview[] = [];
      for (const r of rawReviews) {
        const id = typeof r?.identifier === 'string' ? r.identifier : '';
        const status = r?.status as BaselineReconciliationStatus;
        if (!id || !VALID_STATUSES.has(status)) {
          return NextResponse.json(
            { success: false, error: `Each review needs an identifier and a valid status. Bad entry: ${JSON.stringify(r)?.slice(0, 120)}` },
            { status: 400 },
          );
        }
        clientReviews.push({ identifier: id, status, notes: typeof r?.notes === 'string' ? r.notes : null });
      }

      // Server-owned entries from the manifest (filenames + checksums + order).
      const manifest = discoverMigrationFiles();
      const serverEntries = manifest.files.map((f, i) => ({
        identifier: f.identifier,
        filename: f.filename,
        checksumSha256: f.checksumSha256,
        order: i,
      }));

      let batch;
      try {
        batch = canonicalizeBaselineBatch({
          environment: getCurrentEnvironment(),
          serverEntries,
          clientReviews,
        });
      } catch (e) {
        return NextResponse.json(
          { success: false, error: (e as Error).message },
          { status: 400 },
        );
      }

      // Checksum-conflicted identifiers are blocking. Guarded — a missing
      // ledger (fresh env) simply yields no conflicts.
      let conflictIdentifiers: string[] = [];
      try {
        const state = await inspectMigrationState();
        conflictIdentifiers = state.conflicts.map((c) => c.identifier);
      } catch { /* no ledger yet — no conflicts */ }

      const digest = computeBaselineBatchDigest(batch);
      const validation = validateBaselineBatch(batch, { conflictIdentifiers });
      const statusCounts = baselineBatchStatusCounts(batch);

      if (isPrepareBatch) {
        return NextResponse.json({
          success: true,
          action: 'prepare-baseline-batch',
          environment: batch.environment,
          digest,
          entryCount: batch.entries.length,
          canonicalOrder: batch.entries.map((e) => e.identifier),
          statusCounts,
          blocking: !validation.ok,
          issues: validation.issues,
        });
      }

      // record-baseline-batch — super_admin + fresh TOTP already verified.
      const reason = (body?.reason as string | undefined)?.trim();
      const confirmedDigest = typeof body?.confirmedDigest === 'string' ? body.confirmedDigest : '';
      if (!reason) {
        return NextResponse.json({ success: false, error: 'A non-empty "reason" is required.' }, { status: 400 });
      }
      if (!confirmedDigest) {
        return NextResponse.json({ success: false, error: '"confirmedDigest" (from prepare-baseline-batch) is required.' }, { status: 400 });
      }
      const recordResult = await recordBaselineBatch({
        batch,
        confirmedDigest,
        reconciledBy: adminUser.id,
        reason,
        conflictIdentifiers,
        deps: {
          environment: batch.environment,
          runTransaction: (entries, reconciledBy) =>
            recordBaselineBatchRows(
              entries.map((e) => ({ identifier: e.identifier, status: e.status, notes: e.notes })),
              reconciledBy,
            ),
          audit: (ev) => emitAuditEvent({
            type: 'migration.baseline.completed',
            actorType: 'human',
            actorId: ev.reconciledBy,
            environment: ev.environment,
            executionId: null,
            migrationIdentifier: null,
            filename: null,
            details: {
              reviewedBatch: true,
              digest: ev.digest,
              identifiers: ev.identifiers,
              statusCounts: ev.statusCounts,
              reason: ev.reason,
            },
          }),
        },
      });
      return NextResponse.json({
        success: recordResult.success,
        action: 'record-baseline-batch',
        recorded: recordResult.recorded,
        digest: recordResult.digest,
        error: recordResult.error,
      }, { status: recordResult.success ? 200 : 409 });
    }

    if (isActivationStatus) {
      // Read-only bounded-activation snapshot (Commit 4).
      const activation = await readExecutionActivation();
      return NextResponse.json({ success: true, action: 'activation-status', activation });
    }

    if (action === 'enable-execution-temporary') {
      // Bounded activation (Commit 4). super_admin + fresh TOTP verified above;
      // authorizeMigration enforced env allowlist + production two-key.
      const reason = (body?.reason as string | undefined)?.trim();
      if (!reason) {
        return NextResponse.json({ success: false, error: 'A non-empty "reason" is required.' }, { status: 400 });
      }
      if (getCurrentEnvironment() === 'production'
          && !productionConfirmed) {
        return NextResponse.json(
          { success: false, error: 'Production activation requires productionConfirmation === "production".' },
          { status: 400 },
        );
      }
      // Duration is server-clamped to [1,15] (default 10); a client can never
      // exceed the maximum.
      const result = await enableExecutionTemporary(adminUser.id, reason, body?.durationMinutes);
      return NextResponse.json({
        success: result.success,
        action: 'enable-execution-temporary',
        grantedMinutes: result.grantedMinutes,
        expiresAt: result.expiresAt,
        error: result.error,
        lifecycleState: (await getGovernanceLifecycleState()) ?? 'UNBOOTSTRAPPED',
      }, { status: result.success ? 200 : 409 });
    }

    if (isPrepareExec || isExecuteReviewed) {
      // ── Reviewed single-migration execution (Commit 5) ──────────────────
      // The client supplies ONLY the identifier (+ confirmedDigest/reason for
      // execute). The SERVER derives filename, checksum, transaction mode,
      // current migration state, baseline status, conflicts, activation window,
      // and env authorization — the client can substitute none of them.
      const identifier = typeof body?.identifier === 'string' ? body.identifier : '';
      if (!identifier) {
        return NextResponse.json({ success: false, error: '"identifier" is required.' }, { status: 400 });
      }

      const env = getCurrentEnvironment();
      const allowedEnvs = (process.env.MIGRATION_RUN_ALLOWED_ENVS ?? '')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const isProd = env === 'production';
      const prodAllowed = process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION === 'true';

      const manifest = discoverMigrationFiles();
      const file = manifest.files.find((f) => f.identifier === identifier);

      // Live state (guarded — a fresh env yields no ledger).
      let currentStatus: string | null = null;
      let hasConflict = false;
      try {
        const state = await inspectMigrationState();
        currentStatus = state.ledgerRows[identifier]?.status ?? null;
        hasConflict = state.conflicts.some((c) => c.identifier === identifier);
      } catch { /* no ledger */ }
      const baselineRow = await readBaselineReconciliation(identifier).catch(() => null);
      const activation = await readExecutionActivation();

      const identity = buildExecutionIdentity({
        environment: env,
        identifier,
        filename: file?.filename ?? '',
        checksumSha256: file?.checksumSha256 ?? '',
        transactionMode: file?.transactionMode ?? 'MANUAL_REVIEW',
      });
      const digest = computeExecutionDigest(identity);
      const eligibility = assessExecutionEligibility({
        foundInManifest: !!file,
        currentStatus: currentStatus as any,
        hasChecksumConflict: hasConflict,
        transactionMode: file?.transactionMode ?? 'MANUAL_REVIEW',
        baselineStatus: (baselineRow?.reconciliation_status ?? null) as any,
        hasValidActivationWindow: activation.active,
        environmentAllowed: allowedEnvs.includes(env),
        isProduction: isProd,
        productionExecutionAllowed: prodAllowed,
      });

      if (isPrepareExec) {
        return NextResponse.json({
          success: true,
          action: 'prepare-execution-single',
          environment: env,
          identifier,
          filename: identity.filename,
          checksumSha256: identity.checksumSha256,
          transactionMode: identity.transactionMode,
          currentStatus: currentStatus ?? 'pending',
          baselineStatus: baselineRow?.reconciliation_status ?? null,
          activation: { active: activation.active, expiresAt: activation.expiresAt, secondsRemaining: activation.secondsRemaining },
          digest,
          eligible: eligibility.eligible,
          blockReasons: eligibility.blockReasons,
        });
      }

      // ── execute-reviewed-single ──────────────────────────────────────────
      // super_admin + fresh TOTP verified above; authorizeMigration('execute')
      // enforced env allowlist + production two-key.
      const reason = (body?.reason as string | undefined)?.trim();
      const confirmedDigest = typeof body?.confirmedDigest === 'string' ? body.confirmedDigest : '';
      if (!reason) {
        return NextResponse.json({ success: false, error: 'A non-empty "reason" is required.' }, { status: 400 });
      }
      if (!confirmedDigest) {
        return NextResponse.json({ success: false, error: '"confirmedDigest" (from prepare-execution-single) is required.' }, { status: 400 });
      }
      if (isProd && !productionConfirmed) {
        return NextResponse.json({ success: false, error: 'Production execution requires productionConfirmation === "production".' }, { status: 400 });
      }
      // Rebuilt-and-verified digest (the target file/checksum/env cannot have
      // changed since review).
      if (digest !== confirmedDigest) {
        return NextResponse.json({
          success: false, action: 'execute-reviewed-single',
          error: 'DIGEST_MISMATCH: the migration or environment changed since preparation. Re-prepare and confirm again.',
          expectedDigest: digest,
        }, { status: 409 });
      }
      // Live eligibility re-check immediately before execution.
      if (!eligibility.eligible) {
        return NextResponse.json({
          success: false, action: 'execute-reviewed-single',
          error: `INELIGIBLE: ${eligibility.blockReasons.join(', ')}`,
          blockReasons: eligibility.blockReasons,
        }, { status: 409 });
      }

      // Force a canonical dry-run first (a dry-run is NOT execution proof).
      const dryRun = await runSinglePendingMigration(identifier, { dryRun: true, authorization: auth } as RunSingleMigrationOptions);
      // Real execution — ONLY through the canonical runner.
      const execution = await runSinglePendingMigration(identifier, { dryRun: false, authorization: auth } as RunSingleMigrationOptions);

      // Determine success from the LEDGER + run history — never from HTTP/dry-run.
      const ledgerRow = await readLedgerRow(identifier).catch(() => null);
      const runHistory = await readMigrationRunHistory(identifier, 5).catch(() => []);
      const appliedInLedger = ledgerRow?.status === 'applied';
      const appliedRun = runHistory.some((r) => r.status === 'applied' && r.execution_id === execution.executionId);
      const verifiedSuccess = appliedInLedger && appliedRun;

      // Auto-relock after success OR failure (single-use window).
      const relock = await disableExecution(adminUser.id, `auto-relock after reviewed single execution of ${identifier}`).catch(() => false);
      const lifecycleAfter = (await getGovernanceLifecycleState()) ?? 'UNBOOTSTRAPPED';

      emitAuditEvent({
        type: verifiedSuccess ? 'migration.run.completed' : 'migration.run.failed',
        actorType: 'human', actorId: adminUser.id, environment: env,
        executionId: execution.executionId, migrationIdentifier: identifier,
        filename: identity.filename,
        details: {
          reviewedSingle: true, digest, reason,
          ledgerStatus: ledgerRow?.status ?? null,
          verifiedSuccess, relock, lifecycleAfter,
        },
      });

      return NextResponse.json({
        success: verifiedSuccess,
        action: 'execute-reviewed-single',
        identifier,
        // Proof is the ledger + run history, not this HTTP status.
        verifiedFrom: 'ledger+run_history',
        dryRun: { status: dryRun.status, errorCode: dryRun.errorCode },
        execution: { status: execution.status, executionId: execution.executionId, durationMs: execution.durationMs, errorCode: execution.errorCode, errorSummary: execution.errorSummary },
        ledger: ledgerRow ? { status: ledgerRow.status, appliedAt: ledgerRow.applied_at, executionId: ledgerRow.execution_id } : null,
        runHistory: runHistory.map((r) => ({ status: r.status, executionId: r.execution_id, completedAt: r.completed_at, errorCode: r.error_code })),
        relock: { relocked: relock, lifecycleState: lifecycleAfter },
      }, { status: verifiedSuccess ? 200 : 409 });
    }

    if (isPrepareExecBatch || isExecuteReviewedBatch) {
      // ── Reviewed BATCH execution (Commit 6) ─────────────────────────────
      // Secondary to single execution (proven in Commit 5). The client selects
      // identifiers ONLY; the server canonicalizes to manifest order and binds a
      // batch digest. Execution runs in canonical order and STOPS ON THE FIRST
      // FAILURE; remaining migrations stay pending; auto-relock afterward. There
      // is no unreviewed "run everything".
      const rawIds = Array.isArray(body?.identifiers) ? body.identifiers : null;
      if (!rawIds || rawIds.length === 0) {
        return NextResponse.json({ success: false, error: '"identifiers" (non-empty array) is required.' }, { status: 400 });
      }
      const selectedIdentifiers = rawIds.filter((x: unknown): x is string => typeof x === 'string');

      const env = getCurrentEnvironment();
      const isProd = env === 'production';
      const manifest = discoverMigrationFiles();
      const serverEntries = manifest.files.map((f, i) => ({
        identifier: f.identifier, filename: f.filename,
        checksumSha256: f.checksumSha256, transactionMode: f.transactionMode, order: i,
      }));

      let batch;
      try {
        batch = canonicalizeExecutionBatch({ environment: env, serverEntries, selectedIdentifiers });
      } catch (e) {
        return NextResponse.json({ success: false, error: (e as Error).message }, { status: 400 });
      }
      const batchDigest = computeExecutionBatchDigest(batch);
      const order = batchExecutionOrder(batch);

      // Per-entry live eligibility (same rules as single).
      const activation = await readExecutionActivation();
      const allowedEnvs = (process.env.MIGRATION_RUN_ALLOWED_ENVS ?? '')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const prodAllowed = process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION === 'true';
      let stateSnapshot: Awaited<ReturnType<typeof inspectMigrationState>> | null = null;
      try { stateSnapshot = await inspectMigrationState(); } catch { /* no ledger */ }
      const eligibilityFor = async (id: string) => {
        const f = manifest.files.find((x) => x.identifier === id)!;
        const baselineRow = await readBaselineReconciliation(id).catch(() => null);
        return assessExecutionEligibility({
          foundInManifest: true,
          currentStatus: (stateSnapshot?.ledgerRows[id]?.status ?? null) as any,
          hasChecksumConflict: stateSnapshot?.conflicts.some((c) => c.identifier === id) ?? false,
          transactionMode: f.transactionMode,
          baselineStatus: (baselineRow?.reconciliation_status ?? null) as any,
          hasValidActivationWindow: activation.active,
          environmentAllowed: allowedEnvs.includes(env),
          isProduction: isProd,
          productionExecutionAllowed: prodAllowed,
        });
      };

      if (isPrepareExecBatch) {
        const entries = [];
        for (const id of order) {
          const e = await eligibilityFor(id);
          entries.push({ identifier: id, eligible: e.eligible, blockReasons: e.blockReasons });
        }
        return NextResponse.json({
          success: true,
          action: 'prepare-execution-batch',
          environment: env,
          digest: batchDigest,
          order,
          entries,
          allEligible: entries.every((e) => e.eligible),
        });
      }

      // ── execute-reviewed-batch — super_admin + fresh TOTP verified above ──
      const reason = (body?.reason as string | undefined)?.trim();
      const confirmedDigest = typeof body?.confirmedDigest === 'string' ? body.confirmedDigest : '';
      if (!reason) return NextResponse.json({ success: false, error: 'A non-empty "reason" is required.' }, { status: 400 });
      if (!confirmedDigest) return NextResponse.json({ success: false, error: '"confirmedDigest" (from prepare-execution-batch) is required.' }, { status: 400 });
      if (batchDigest !== confirmedDigest) {
        return NextResponse.json({
          success: false, action: 'execute-reviewed-batch',
          error: 'DIGEST_MISMATCH: the selection or a migration changed since preparation. Re-prepare and confirm again.',
          expectedDigest: batchDigest,
        }, { status: 409 });
      }
      if (isProd && !productionConfirmed) {
        return NextResponse.json({ success: false, error: 'Production execution requires productionConfirmation === "production".' }, { status: 400 });
      }
      if (!activation.active) {
        return NextResponse.json({ success: false, action: 'execute-reviewed-batch', error: 'INELIGIBLE: NO_ACTIVE_WINDOW' }, { status: 409 });
      }

      // Run in canonical order; STOP ON FIRST FAILURE.
      const results: Array<{ identifier: string; status: string; verified: boolean; executionId?: string; errorCode?: string | null; blockReasons?: string[] }> = [];
      let stopped = false;
      for (const id of order) {
        if (stopped) { results.push({ identifier: id, status: 'not_run', verified: false }); continue; }
        const elig = await eligibilityFor(id);
        if (!elig.eligible) {
          results.push({ identifier: id, status: 'blocked', verified: false, blockReasons: elig.blockReasons });
          stopped = true;
          continue;
        }
        await runSinglePendingMigration(id, { dryRun: true, authorization: auth } as RunSingleMigrationOptions);
        const exec = await runSinglePendingMigration(id, { dryRun: false, authorization: auth } as RunSingleMigrationOptions);
        const ledgerRow = await readLedgerRow(id).catch(() => null);
        const verified = ledgerRow?.status === 'applied';
        results.push({ identifier: id, status: verified ? 'applied' : 'failed', verified, executionId: exec.executionId, errorCode: exec.errorCode });
        if (!verified) stopped = true;
        // Refresh snapshot so subsequent eligibility sees the just-applied state.
        try { stateSnapshot = await inspectMigrationState(); } catch { /* ignore */ }
      }

      const appliedCount = results.filter((r) => r.status === 'applied').length;
      const failedEntry = results.find((r) => r.status === 'failed' || r.status === 'blocked');
      const allApplied = appliedCount === order.length;

      // Auto-relock after the batch (success or failure).
      const relock = await disableExecution(adminUser.id, `auto-relock after reviewed batch execution (${appliedCount}/${order.length})`).catch(() => false);
      const lifecycleAfter = (await getGovernanceLifecycleState()) ?? 'UNBOOTSTRAPPED';
      // Remaining pending (not applied) after the batch.
      let remainingPending: string[] = [];
      try { remainingPending = (await inspectMigrationState()).pending; } catch { /* ignore */ }

      emitAuditEvent({
        type: allApplied ? 'migration.run.completed' : 'migration.run.failed',
        actorType: 'human', actorId: adminUser.id, environment: env,
        executionId: null, migrationIdentifier: null, filename: null,
        details: { reviewedBatch: true, digest: batchDigest, reason, order, appliedCount, total: order.length, results, relock, lifecycleAfter },
      });

      return NextResponse.json({
        success: allApplied,
        action: 'execute-reviewed-batch',
        digest: batchDigest,
        verifiedFrom: 'ledger+run_history',
        appliedCount,
        total: order.length,
        stoppedAt: failedEntry?.identifier ?? null,
        results,
        remainingPending,
        relock: { relocked: relock, lifecycleState: lifecycleAfter },
      }, { status: allApplied ? 200 : 409 });
    }

    // ── Baseline control plane (MIGRATION-GOV-11, Phase 1A.2) ──────────────

    if (action === 'inspect-baseline') {
      // Read-only: return all baseline reconciliation entries for this env.
      const baselines = await readAllBaselineReconciliations();
      const lifecycle = await getGovernanceLifecycleState();
      const manifest = discoverMigrationFiles();
      const manifestIds = manifest.files.map((f) => f.identifier);
      return NextResponse.json({
        success: true,
        action: 'inspect-baseline',
        environment: getCurrentEnvironment(),
        lifecycleState: lifecycle ?? 'UNBOOTSTRAPPED',
        manifestCount: manifestIds.length,
        baselines: Object.values(baselines).map((b) => ({
          identifier: b.migration_identifier,
          reconciliationStatus: b.reconciliation_status,
          evidenceType: b.evidence_type,
          evidenceSummary: b.evidence_summary,
          reconciledBy: b.reconciled_by,
          reconciledAt: b.reconciled_at,
        })),
        unreconciled: manifestIds.filter((id) => !baselines[id]),
      });
    }

    if (action === 'record-baseline-entry') {
      // Record a single baseline reconciliation entry.
      const baselineIdentifier = body?.identifier as string | undefined;
      const reconciliationStatus = body?.reconciliationStatus as string | undefined;
      const evidenceType = body?.evidenceType as string | undefined;
      const evidenceSummary = body?.evidenceSummary as string | undefined;

      if (!baselineIdentifier) {
        return NextResponse.json(
          { success: false, error: 'identifier is required for record-baseline-entry' },
          { status: 400 },
        );
      }
      const validStatuses: BaselineReconciliationStatus[] = [
        'CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'PARTIALLY_APPLIED',
        'NOT_APPLICABLE', 'UNKNOWN',
      ];
      if (!reconciliationStatus || !validStatuses.includes(reconciliationStatus as BaselineReconciliationStatus)) {
        return NextResponse.json(
          { success: false, error: `reconciliationStatus is required and must be one of: ${validStatuses.join(', ')}` },
          { status: 400 },
        );
      }
      const validEvidenceTypes: BaselineEvidenceType[] = [
        'SCHEMA_INTROSPECTION', 'LEDGER_RECORD', 'MANUAL_VERIFICATION',
        'CHECKSUM_MATCH', 'OBJECT_EXISTENCE', 'NONE',
      ];
      if (!evidenceType || !validEvidenceTypes.includes(evidenceType as BaselineEvidenceType)) {
        return NextResponse.json(
          { success: false, error: `evidenceType is required and must be one of: ${validEvidenceTypes.join(', ')}` },
          { status: 400 },
        );
      }

      const ok = await recordBaselineReconciliation({
        identifier: baselineIdentifier,
        status: reconciliationStatus as BaselineReconciliationStatus,
        evidenceType: evidenceType as BaselineEvidenceType,
        evidenceSummary: evidenceSummary ?? null,
        reconciledBy: adminUser.id,
      });
      return NextResponse.json({
        success: ok,
        action: 'record-baseline-entry',
        identifier: baselineIdentifier,
        reconciliationStatus,
        evidenceType,
      });
    }

    if (action === 'verify-baseline') {
      // Verify that all manifest migrations have been reconciled and advance
      // to BASELINE_VERIFIED if complete.
      const manifest = discoverMigrationFiles();
      const manifestIds = manifest.files.map((f) => f.identifier);
      const result = await verifyBaselineComplete(manifestIds);
      if (!result.ok) {
        return NextResponse.json({
          success: false,
          action: 'verify-baseline',
          ok: false,
          unreconciled: result.unreconciled,
          blocking: result.blocking,
          error: 'Baseline reconciliation is not complete. All migrations must be reconciled with a non-blocking status (CONFIRMED_APPLIED, CONFIRMED_NOT_APPLIED, or NOT_APPLICABLE).',
        }, { status: 409 });
      }
      const advanced = await advanceToBaselineVerified(adminUser.id);
      return NextResponse.json({
        success: advanced,
        action: 'verify-baseline',
        ok: true,
        advancedToBaselineVerified: advanced,
        lifecycleState: advanced ? 'BASELINE_VERIFIED' : null,
      });
    }

    if (action === 'enable-execution') {
      // Transition from BASELINE_VERIFIED to EXECUTION_ENABLED.
      // Requires TOTP (already verified above) and a reason.
      const reason = body?.reason as string | undefined;
      if (!reason || reason.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: 'A non-empty "reason" field is required for enable-execution.' },
          { status: 400 },
        );
      }
      const lifecycle = await getGovernanceLifecycleState();
      if (lifecycle !== 'BASELINE_VERIFIED') {
        return NextResponse.json({
          success: false,
          error: `Cannot enable execution. The lifecycle must be in state BASELINE_VERIFIED. Current state: ${lifecycle ?? 'UNBOOTSTRAPPED'}.`,
          lifecycleState: lifecycle ?? 'UNBOOTSTRAPPED',
        }, { status: 409 });
      }
      const ok = await enableExecution(adminUser.id, reason);
      return NextResponse.json({
        success: ok,
        action: 'enable-execution',
        enabled: ok,
        lifecycleState: ok ? 'EXECUTION_ENABLED' : (lifecycle ?? 'UNBOOTSTRAPPED'),
        reason: reason.trim(),
      });
    }

    if (action === 'disable-execution') {
      // Transition from EXECUTION_ENABLED back to BASELINE_VERIFIED.
      // Requires TOTP (already verified above) and a reason.
      const reason = body?.reason as string | undefined;
      if (!reason || reason.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: 'A non-empty "reason" field is required for disable-execution.' },
          { status: 400 },
        );
      }
      const lifecycle = await getGovernanceLifecycleState();
      if (lifecycle !== 'EXECUTION_ENABLED') {
        return NextResponse.json({
          success: false,
          error: `Cannot disable execution. The lifecycle must be in state EXECUTION_ENABLED. Current state: ${lifecycle ?? 'UNBOOTSTRAPPED'}.`,
          lifecycleState: lifecycle ?? 'UNBOOTSTRAPPED',
        }, { status: 409 });
      }
      const ok = await disableExecution(adminUser.id, reason);
      return NextResponse.json({
        success: ok,
        action: 'disable-execution',
        disabled: ok,
        lifecycleState: ok ? 'BASELINE_VERIFIED' : (lifecycle ?? 'UNBOOTSTRAPPED'),
        reason: reason.trim(),
      });
    }

    // ── Existing migration actions ─────────────────────────────────────────
    // Handle each action.
    if (action === 'inspect' || action === 'dry-run-pending') {
      // For inspect and dry-run-pending, return the inspection state.
      const state = await inspectMigrationState();

      if (action === 'dry-run-pending') {
        // Simulate the run: validate each pending migration can be split.
        const manifest = discoverMigrationFiles();
        const dryRunResults: Array<{ identifier: string; filename: string; wouldExecute: boolean }> = [];
        for (const id of state.pending) {
          const file = manifest.files.find((f) => f.identifier === id);
          if (file) {
            dryRunResults.push({ identifier: id, filename: file.filename, wouldExecute: true });
          }
        }
        return NextResponse.json({
          success: true,
          action: 'dry-run-pending',
          dryRun: true,
          environment: getCurrentEnvironment(),
          pending: state.pending,
          conflicts: state.conflicts,
          wouldExecute: dryRunResults,
        });
      }

      return NextResponse.json({
        success: true,
        action: 'inspect',
        environment: getCurrentEnvironment(),
        ledgerExists: state.ledgerExists,
        pending: state.pending,
        applied: state.applied,
        failed: state.failed,
        conflicts: state.conflicts,
        running: state.running,
        manifest: {
          count: state.manifest.count,
          highestPrefix: state.manifest.highestPrefix,
          duplicates: state.manifest.duplicates,
          gaps: state.manifest.gaps,
        },
      });
    }

    if (action === 'dry-run-single') {
      if (!identifier) {
        return NextResponse.json(
          { success: false, error: 'identifier is required for dry-run-single' },
          { status: 400 },
        );
      }
      const result = await runSinglePendingMigration(identifier, {
        dryRun: true,
        authorization: auth,
      } as RunSingleMigrationOptions);
      return NextResponse.json({ success: true, action: 'dry-run-single', result });
    }

    if (action === 'run-single') {
      if (!identifier) {
        return NextResponse.json(
          { success: false, error: 'identifier is required for run-single' },
          { status: 400 },
        );
      }
      const result = await runSinglePendingMigration(identifier, {
        dryRun: false,
        authorization: auth,
      } as RunSingleMigrationOptions);
      return NextResponse.json({ success: result.status === 'applied', action: 'run-single', result });
    }

    if (action === 'run-pending') {
      const runOpts: RunPendingMigrationsOptions = {
        dryRun: false,
        authorization: auth,
        limit: typeof limit === 'number' ? limit : undefined,
      };
      const result = await runPendingMigrations(runOpts);
      return NextResponse.json({
        success: result.failed === 0,
        action: 'run-pending',
        result,
      });
    }

    // Should not reach here.
    return NextResponse.json({ success: false, error: 'Unhandled action' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitAuditEvent({
      type: 'migration.run.failed',
      actorType,
      actorId: adminUser.id,
      environment: getCurrentEnvironment(),
      executionId: null,
      migrationIdentifier: identifier ?? null,
      filename: null,
      details: { error: msg, action },
    });
    return NextResponse.json(
      { success: false, error: `Migration operation failed: ${msg}` },
      { status: 500 },
    );
  }
}
