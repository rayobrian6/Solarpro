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
  isLegacyInlineEnabled,
  isLegacySystemToolsRunEnabled,
  getCurrentEnvironment,
} from '@/lib/migrations/runner';
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
} from '@/lib/migrations/ledger';
import { generateBaselineEvidence } from '@/lib/migrations/baselineEvidence';
import { buildOperatorReadiness } from '@/lib/migrations/operatorReadiness';
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
  const isExecutionActivation = ['enable-execution', 'disable-execution'].includes(action);

  // Operator-recovery surface classification.
  // - inspect-readiness / generate-baseline-evidence: READ-ONLY (no mutation,
  //   no TOTP) but super_admin-only (they reveal governance internals + the
  //   operator's MFA gate signal). Enforced explicitly below.
  // - bootstrap: MUTATION (creates ledger tables) — super_admin + fresh TOTP +
  //   reason + production typed-confirmation, same bar as execution activation.
  const isReadiness = action === 'inspect-readiness';
  const isEvidence = action === 'generate-baseline-evidence';
  const isBootstrap = action === 'bootstrap';
  const isOperatorReadonly = isReadiness || isEvidence;

  // Determine the migration action type for authorization.
  let migrationAction: MigrationAction;
  if (isExecute || isExecutionActivation) {
    migrationAction = 'execute';
  } else if (isBaselineMutation || isBootstrap) {
    migrationAction = 'bootstrap';
  } else {
    migrationAction = 'inspect';
  }

  // Operator-console surface is super_admin-only (matches the page's access
  // model). The read-only operator actions need an explicit gate because
  // authorizeMigration('inspect') otherwise permits plain 'admin'.
  if ((isOperatorReadonly || isBootstrap) && adminUser.role !== 'super_admin') {
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
  let totpVerified = false;
  if (isExecute || isExecutionActivation || isBootstrap) {
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
      return NextResponse.json({
        success: true,
        action: 'generate-baseline-evidence',
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
      // Create the ledger tables (idempotent). super_admin + fresh TOTP +
      // reason enforced above; authorizeMigration enforced env allowlist +
      // production two-key. Production also requires typed env confirmation.
      const reason = (body?.reason as string | undefined)?.trim();
      if (!reason) {
        return NextResponse.json(
          { success: false, error: 'A non-empty "reason" is required for bootstrap.' },
          { status: 400 },
        );
      }
      if (getCurrentEnvironment() === 'production'
          && (body?.productionConfirmation as string | undefined) !== 'production') {
        return NextResponse.json(
          { success: false, error: 'Production bootstrap requires productionConfirmation === "production".' },
          { status: 400 },
        );
      }
      const result = await bootstrapMigrationLedger('human', adminUser.id);
      emitAuditEvent({
        type: result.success ? 'migration.bootstrap.completed' : 'migration.bootstrap.failed',
        actorType: 'human',
        actorId: adminUser.id,
        environment: getCurrentEnvironment(),
        executionId: null,
        migrationIdentifier: null,
        filename: null,
        details: { reason, alreadyExisted: result.alreadyExisted, viaOperatorConsole: true, error: result.error ?? null },
      });
      return NextResponse.json({
        success: result.success,
        action: 'bootstrap',
        alreadyExisted: result.alreadyExisted,
        error: result.error ?? undefined,
        lifecycleState: (await getGovernanceLifecycleState()) ?? 'UNBOOTSTRAPPED',
      }, { status: result.success ? 200 : 500 });
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
