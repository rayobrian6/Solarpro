// ============================================================================
// /api/organizations/mine
//
// Phase 1B — Organization Authority Foundation
// Commit 7: Feature-Flagged Organization UI
//
// GET — returns all active organizations the current user is a member of,
// enriched with org name, status, and the user's role within each org.
//
// This endpoint powers the organization switcher dropdown in the
// OrganizationAuthorityPanel. It uses the new membership system
// (organization_members table) when ENTERPRISE_ORG_AUTHORITY_ENABLED is on.
// When the flag is off, it returns an empty list (the legacy system only
// supports a single 1:1 org per user).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { rateLimitGuard } from '@/lib/rateLimitGuard';
import { getMembershipsWithOrgByUser, isOrgAuthorityEnabled } from '@/lib/organizations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * GET /api/organizations/mine
 *
 * Returns the current user's active organization memberships with org details.
 * Each entry includes the organizationId, orgName, role, and org status.
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // When the feature flag is off, the legacy 1:1 model means the user has
  // at most one org. Return an empty list — the active org context is
  // derived from users.org_id via resolveActiveOrg instead.
  if (!isOrgAuthorityEnabled()) {
    return NextResponse.json({ success: true, organizations: [] });
  }

  try {
    const memberships = await getMembershipsWithOrgByUser(user.id);
    return NextResponse.json({
      success: true,
      organizations: memberships.map((m) => ({
        organizationId: m.organizationId,
        orgName: m.orgName,
        role: m.role,
        orgStatus: m.orgStatus,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: 'Failed to load your organizations' },
      { status: 500 }
    );
  }
}
