// ============================================================================
// /api/organizations/[id]/members
//
// Phase 1B.1 — Organization Authority Boundary Correction
//
// GET  — list all members of an organization (requires member:view permission)
// POST — add a new member to the organization (requires member:invite permission)
//
// Authorization is enforced through the centralized authorization engine
// (lib/organizations/authorization.ts). When the authority master switch
// (ENTERPRISE_ORG_AUTHORITY_ENABLED) is on, deny decisions are always enforced
// (fail-closed). There is no advisory fall-through — a denied authorization
// always blocks the action. Platform admins do NOT bypass membership checks
// (ADR-004).
//
// Feature flags:
//   - ENTERPRISE_ORG_AUTHORITY_ENABLED (master switch — gates the authority path)
//   - ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED (allow write operations)
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { rateLimitGuard } from '@/lib/rateLimitGuard';
import {
  getMembersByOrg,
  addMember,
  isOrgAuthorityEnabled,
  isOrgFeatureEnabled,
  enforceAuthz,
  type OrgRole,
} from '@/lib/organizations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/organizations/[id]/members
 *
 * Returns the list of members for the given organization. Requires
 * the member:view permission (members and above).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: orgId } = params;
  if (!isValidUUID(orgId)) {
    return NextResponse.json({ success: false, error: 'Invalid organization ID' }, { status: 400 });
  }

  try {
    // --- New authority path ---
    if (isOrgAuthorityEnabled()) {
      // Enforce authorization — always throws on denied (fail-closed).
      // Platform admins do NOT bypass this (ADR-004).
      await enforceAuthz(user.id, orgId, 'member:view');

      const members = await getMembersByOrg(orgId);
      return NextResponse.json({ success: true, members });
    }

    // --- Legacy path ---
    const sql = await getDbReady();
    const rows = await sql`
      SELECT m.id, m.name, m.email, m.org_role
        FROM users m
       WHERE m.org_id = ${orgId}
       ORDER BY m.name
    `;

    // Verify the caller is a member of this org (legacy check)
    const callerCheck = await sql`
      SELECT 1 FROM users WHERE id = ${user.id} AND org_id = ${orgId} LIMIT 1
    `;
    if (callerCheck.length === 0) {
      return NextResponse.json(
        { success: false, error: 'You are not a member of this organization' },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true, members: rows });
  } catch (e) {
    // Check if it's an AuthzError
    if (e && typeof e === 'object' && 'reason' in e && 'statusCode' in e) {
      const authzErr = e as { reason: string; statusCode: number; message: string };
      return NextResponse.json(
        { success: false, error: authzErr.message, code: authzErr.reason },
        { status: authzErr.statusCode }
      );
    }
    return handleRouteDbError('[GET /api/organizations/[id]/members]', e);
  }
}

/**
 * POST /api/organizations/[id]/members
 *
 * Adds a new member to the organization. Requires the member:invite
 * permission (admins and above).
 *
 * Body: { userId: string, role?: OrgRole }
 *
 * The role defaults to 'member' if not specified. The caller must have
 * permission to assign the requested role (owners can assign any role,
 * admins can only assign member/viewer).
 *
 * When ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED is off, returns 501.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: orgId } = params;
  if (!isValidUUID(orgId)) {
    return NextResponse.json({ success: false, error: 'Invalid organization ID' }, { status: 400 });
  }

  // Membership write operations require the feature flag
  if (!isOrgFeatureEnabled('ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED')) {
    return NextResponse.json(
      { success: false, error: 'Organization membership management is not enabled' },
      { status: 501 }
    );
  }

  try {
    const body = await req.json();
    const targetUserId = body?.userId;
    const role: OrgRole = body?.role ?? 'member';

    if (!targetUserId || !isValidUUID(targetUserId)) {
      return NextResponse.json(
        { success: false, error: 'A valid userId is required' },
        { status: 400 }
      );
    }

    if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Invalid role. Must be one of: owner, admin, member, viewer' },
        { status: 400 }
      );
    }

    // Enforce authorization — always throws on denied (fail-closed).
    // Platform admins do NOT bypass this (ADR-004).
    await enforceAuthz(user.id, orgId, 'member:invite');

    const result = await addMember(orgId, targetUserId, role, user.id);

    if (!result.ok) {
      const err = (result as { ok: false; error: { code: string; message: string } }).error;
      const status =
        err.code === 'ALREADY_MEMBER' ? 409 :
        err.code === 'NOT_FOUND' ? 404 :
        err.code === 'LAST_OWNER' || err.code === 'CANNOT_REMOVE_LAST_OWNER' ? 409 :
        err.code === 'ORG_SUSPENDED' ? 403 :
        400;

      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status }
      );
    }

    return NextResponse.json(
      { success: true, membership: (result as { ok: true; data: unknown }).data },
      { status: 201 }
    );
  } catch (e) {
    if (e && typeof e === 'object' && 'reason' in e && 'statusCode' in e) {
      const authzErr = e as { reason: string; statusCode: number; message: string };
      return NextResponse.json(
        { success: false, error: authzErr.message, code: authzErr.reason },
        { status: authzErr.statusCode }
      );
    }
    return handleRouteDbError('[POST /api/organizations/[id]/members]', e);
  }
}
