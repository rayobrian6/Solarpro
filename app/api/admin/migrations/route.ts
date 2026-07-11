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
import { emitAuditEvent } from '@/lib/migrations/ledger';
import type {
  MigrationAction,
  MigrationActorType,
  RunPendingMigrationsOptions,
  RunSingleMigrationOptions,
} from '@/lib/migrations/runner';

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
  const validActions = ['inspect', 'run-pending', 'run-single', 'dry-run-pending', 'dry-run-single'];
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
  const migrationAction: MigrationAction = isExecute ? 'execute' : 'inspect';
  const actorType: MigrationActorType = 'human';

  // Verify fresh TOTP for non-dry-run execution (MIGRATION-GOV-05).
  // verifyFreshTotp now returns a result object with fail-closed semantics:
  // - MFA_NOT_ENABLED: user has no MFA secret → DENIED (not waived)
  // - TOTP_INVALID: code doesn't match → retry allowed
  // - TOTP_REPLAY: time-step already consumed → must wait for next step
  let totpVerified = false;
  if (isExecute) {
    if (!totpCode || typeof totpCode !== 'string') {
      return NextResponse.json(
        { success: false, error: 'A fresh TOTP code is required for migration execution. Provide it in the "totpCode" field.' },
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
