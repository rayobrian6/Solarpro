// app/api/admin/personnel/route.ts
// AAC WS-6 — Personnel roles of record: the System Config surface.
//
// GET  ?project_id=            — the resolved per-role authority for a project
//                                (project override > org default > user default)
//      (no project_id)         — the caller's own roster
// POST { op: 'upsert' }        — add / replace a roster row (scoped to the caller)
// POST { op: 'assign', projectId } — an authorized per-project override
//
// Mirrors app/api/admin/reconciliation/route.ts exactly: requireAdminApi, rate
// limit, handleRouteDbError (fail-LOUD here — an admin must see 42P01 when
// migration 115 has not been run), logAdminAction, and never trusting a
// client-supplied actor id.
//
// THE HARD BOUNDARY (WS-6): storing an engineer_of_record / approving_engineer
// row here is a CONFIGURATION record only. The permit resolver populates the
// DESIGNER role and nothing else — it can never fabricate a PE, a signature, a
// seal or a digest-bound approval from anything written through this route.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { handleRouteDbError } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import {
  listPersonnel, listProjectAssignments, resolveProjectPersonnel, resolveProjectScope,
  resolveUserScope, upsertPersonnel, assignProjectPersonnel,
} from '@/lib/personnel/store';
import {
  PERSONNEL_ROLES, AUTO_POPULATABLE_ROLES, LICENSED_ROLES,
  isPersonnelRole, validatePersonnelInput,
} from '@/lib/personnel/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  try {
    if (projectId) {
      const [authority, assignments, scope] = await Promise.all([
        resolveProjectPersonnel(projectId),
        listProjectAssignments(projectId),
        resolveProjectScope(projectId),
      ]);
      const roster = await listPersonnel(scope ?? { orgId: null, userId: null });
      return NextResponse.json({
        success: true, authority, assignments, roster,
        roles: PERSONNEL_ROLES, autoPopulatable: AUTO_POPULATABLE_ROLES, licensedRoles: LICENSED_ROLES,
      });
    }
    const scope = await resolveUserScope(admin.id);
    const roster = await listPersonnel(scope);
    return NextResponse.json({
      success: true, roster, scope,
      roles: PERSONNEL_ROLES, autoPopulatable: AUTO_POPULATABLE_ROLES, licensedRoles: LICENSED_ROLES,
    });
  } catch (err) {
    // Fail-LOUD by design: an admin needs to see "relation personnel_roles does
    // not exist" so migration 115 gets run, not a silent empty roster.
    return handleRouteDbError('[admin/personnel GET]', err);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const op = String(body.op ?? 'upsert');
  const role = String(body.role ?? '');
  if (!isPersonnelRole(role)) {
    return NextResponse.json({ success: false, error: `role must be one of ${PERSONNEL_ROLES.join(' | ')}` }, { status: 400 });
  }

  try {
    if (op === 'assign') {
      const projectId = String(body.projectId ?? '');
      if (!projectId) return NextResponse.json({ success: false, error: 'projectId is required for an assignment' }, { status: 400 });
      const result = await assignProjectPersonnel({
        projectId, role,
        personnelId: (body.personnelId as string | undefined) ?? null,
        personName: String(body.personName ?? ''),
        personTitle: (body.personTitle as string | undefined) ?? null,
        licenseNumber: (body.licenseNumber as string | undefined) ?? null,
        licenseState: (body.licenseState as string | undefined) ?? null,
        // The actor is the authenticated admin — never a client-supplied id.
        assignedBy: admin.id,
        reason: (body.reason as string | undefined) ?? null,
      });
      await logAdminAction({
        adminId: admin.id, action: 'personnel_project_assignment',
        metadata: { projectId, role, assignmentId: result.id },
      });
      return NextResponse.json({ success: true, assignment: result });
    }

    // Roster upsert, scoped to the caller's organisation (or the caller).
    const { orgId } = await resolveUserScope(admin.id);
    const input = {
      orgId, userId: orgId ? null : admin.id,
      role,
      personName: String(body.personName ?? ''),
      personTitle: (body.personTitle as string | undefined) ?? null,
      email: (body.email as string | undefined) ?? null,
      phone: (body.phone as string | undefined) ?? null,
      licenseNumber: (body.licenseNumber as string | undefined) ?? null,
      licenseState: (body.licenseState as string | undefined) ?? null,
      licenseExpiresOn: (body.licenseExpiresOn as string | undefined) ?? null,
      isDefault: body.isDefault !== false,
      notes: (body.notes as string | undefined) ?? null,
      createdBy: admin.id,
    };
    const v = validatePersonnelInput(input);
    if (!v.ok) return NextResponse.json({ success: false, error: v.error }, { status: 400 });

    const record = await upsertPersonnel(input);
    await logAdminAction({
      adminId: admin.id, action: 'personnel_roster_upsert',
      metadata: { role, personnelId: record.id, scope: orgId ? `org:${orgId}` : `user:${admin.id}` },
    });
    return NextResponse.json({ success: true, record });
  } catch (err: unknown) {
    if (err instanceof Error && /required|must be one of|licenseNumber|scope/i.test(err.message)) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    return handleRouteDbError('[admin/personnel POST]', err);
  }
}
