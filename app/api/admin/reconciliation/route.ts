// app/api/admin/reconciliation/route.ts
// W4 §7 — Equipment-identity reconciliation operator API.
//
// GET  ?project_id=            — reconciliation audit history for a project
//      ?project_id=&invalidations=1 — active snapshot/approval invalidations
// POST — perform a reconciliation (requires explicit selection + reason).
//        Body: ReconciliationRequest (+ optional knownSnapshot).
//
// No automatic scan of any project. No timestamp silently wins — a canonical
// value only changes via an explicit operator POST here, with a reason recorded.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { handleRouteDbError } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import {
  reconcileEquipmentIdentity,
  validateReconciliationRequest,
  listReconciliationAudit,
  listActiveInvalidations,
} from '@/lib/reconciliation/reconcile';
import type { ReconciliationRequest } from '@/lib/reconciliation/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ success: false, error: 'project_id is required' }, { status: 400 });
  try {
    if (searchParams.get('invalidations') === '1') {
      const invalidations = await listActiveInvalidations(projectId);
      return NextResponse.json({ success: true, invalidations, count: invalidations.length });
    }
    const audit = await listReconciliationAudit(projectId);
    return NextResponse.json({ success: true, audit, count: audit.length });
  } catch (err) {
    return handleRouteDbError('[admin/reconciliation GET]', err);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });

  let body: ReconciliationRequest & { knownSnapshot?: { digest?: string | null; snapshotId?: string | null; engineeringApprovalRef?: string | null } };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  // The operator is the authenticated admin — never trust a client-supplied operatorId.
  const request: ReconciliationRequest = {
    projectId: body.projectId,
    conflictField: body.conflictField,
    subsystemKey: body.subsystemKey ?? null,
    sources: body.sources,
    chosenSource: body.chosenSource,
    reason: body.reason,
    operatorId: admin.id,
    operatorName: admin.name,
  };

  const v = validateReconciliationRequest(request);
  if (!v.ok) return NextResponse.json({ success: false, error: v.error }, { status: 400 });

  try {
    const result = await reconcileEquipmentIdentity(request, body.knownSnapshot);
    await logAdminAction({
      adminId: admin.id,
      action: 'equipment_reconciliation',
      metadata: { projectId: result.projectId, field: result.conflictField, chosen: result.chosenSource, auditId: result.auditId, invalidations: result.invalidations.length },
    });
    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    if (err instanceof Error && /required|not found|not among|null value|reason/i.test(err.message)) {
      const status = /not found/i.test(err.message) ? 404 : 400;
      return NextResponse.json({ success: false, error: err.message }, { status });
    }
    return handleRouteDbError('[admin/reconciliation POST]', err);
  }
}
