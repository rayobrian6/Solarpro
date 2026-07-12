// ============================================================================
// /api/organizations/[id]
//
// Phase 1B — Organization Authority Foundation
//
// GET — return organization details with member list (requires membership)
//
// This route uses the new organization authority module. When the
// ENTERPRISE_ORG_AUTHORITY_ENABLED flag is off, it falls back to the
// legacy behavior (checking users.org_id directly).
//
// Authorization:
//   - The caller must be an active member of the org (or a platform admin).
//   - Platform admins (admin/super_admin) bypass membership checks.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { rateLimitGuard } from '@/lib/rateLimitGuard';
import {
  getOrganizationWithMembers,
  isOrgAuthorityEnabled,
  isMember,
  isPlatformAdminUser,
} from '@/lib/organizations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/organizations/[id]
 *
 * Returns the organization details and its member list. The caller must
 * be a member of the org (or a platform admin).
 *
 * In legacy mode (feature flag off), falls back to checking users.org_id.
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
    // --- New authority path (feature-flagged) ---
    if (isOrgAuthorityEnabled()) {
      // Platform admins bypass membership checks
      const isPlatformAdmin = await isPlatformAdminUser(user.id);

      if (!isPlatformAdmin) {
        // Check membership in the requested org directly using the new system
        const member = await isMember(orgId, user.id);
        if (!member) {
          return NextResponse.json(
            { success: false, error: 'You are not a member of this organization' },
            { status: 403 }
          );
        }
      }

      const orgWithMembers = await getOrganizationWithMembers(orgId);
      if (!orgWithMembers) {
        return NextResponse.json(
          { success: false, error: 'Organization not found' },
          { status: 404 }
        );
      }

      // Flatten into a client-friendly shape so the UI receives a single
      // object with the organization fields at the top level and a members
      // array whose entries use display-friendly field names.
      return NextResponse.json({
        success: true,
        organization: {
          id: orgWithMembers.organization.id,
          name: orgWithMembers.organization.name,
          plan: orgWithMembers.organization.plan,
          status: orgWithMembers.organization.status,
          slug: orgWithMembers.organization.slug,
          ownerId: orgWithMembers.organization.ownerId,
          members: (orgWithMembers.members ?? []).map((m) => ({
            id: m.id,
            userId: m.userId,
            name: m.userName,
            email: m.userEmail,
            role: m.role,
            status: m.status,
            joinedAt: m.createdAt,
          })),
        },
      });
    }

    // --- Legacy path (feature flag off) ---
    // Fall back to the existing behavior: check users.org_id
    const sql = await getDbReady();
    const rows = await sql`
      SELECT o.id, o.name, o.plan, o.created_at, o.status, o.slug,
             u.org_role,
             (SELECT COUNT(*) FROM users m WHERE m.org_id = o.id) AS member_count,
             (SELECT json_agg(json_build_object(
               'id', m.id, 'name', m.name, 'email', m.email, 'org_role', m.org_role
             )) FROM users m WHERE m.org_id = o.id) AS members
        FROM organizations o
        JOIN users u ON u.id = ${user.id}
       WHERE o.id = ${orgId} AND u.org_id = o.id
       LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Organization not found or you are not a member' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, organization: rows[0] });
  } catch (e) {
    return handleRouteDbError('[GET /api/organizations/[id]]', e);
  }
}
