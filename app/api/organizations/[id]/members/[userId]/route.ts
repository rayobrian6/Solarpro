// ============================================================================
// /api/organizations/[id]/members/[userId]
//
// Phase 1B.1 — Organization Authority Boundary Correction
//
// PATCH  — change a member's role (requires member:change_role permission)
// DELETE — remove a member from the org (requires member:remove permission)
//
// Authorization is enforced through the centralized authorization engine.
// When the authority master switch (ENTERPRISE_ORG_AUTHORITY_ENABLED) is on,
// deny decisions are always enforced (fail-closed). There is no advisory
// mode — a denied authorization always blocks the action. Platform admins
// do NOT bypass membership checks (ADR-004).
//
// Owner protection rules are enforced:
//   - The last active owner cannot be removed or demoted.
//   - A user cannot remove or suspend themselves.
//   - An admin cannot manage another admin.
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
  changeMemberRole,
  removeMember,
  suspendMember,
  reactivateMember,
  isOrgAuthorityEnabled,
  isOrgFeatureEnabled,
  enforceMemberAction,
  type OrgRole,
} from '@/lib/organizations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * PATCH /api/organizations/[id]/members/[userId]
 *
 * Updates a member's role or status. The body can contain:
 *   { role: OrgRole }              — change the member's role
 *   { action: 'suspend' }          — suspend the member
 *   { action: 'reactivate' }       — reactivate a suspended member
 *
 * Authorization:
 *   - role change requires member:change_role permission
 *   - suspend requires member:suspend permission
 *   - reactivate requires member:reactivate permission
 *   - owner protection prevents demoting the last owner
 *   - role hierarchy prevents managing peers
 *
 * When ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED is off, returns 501.
 */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; userId: string }> }
) {
  const params = await props.params;
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: orgId, userId: targetUserId } = params;
  if (!isValidUUID(orgId) || !isValidUUID(targetUserId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid organization or user ID' },
      { status: 400 }
    );
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

    // --- Role change ---
    if (body?.role) {
      const newRole: OrgRole = body.role;
      if (!['owner', 'admin', 'member', 'viewer'].includes(newRole)) {
        return NextResponse.json(
          { success: false, error: 'Invalid role. Must be one of: owner, admin, member, viewer' },
          { status: 400 }
        );
      }

      // Enforce authorization — always throws on denied (fail-closed).
      // Platform admins do NOT bypass this (ADR-004).
      if (isOrgAuthorityEnabled()) {
        await enforceMemberAction(user.id, orgId, targetUserId, 'change_role');
      }

      const result = await changeMemberRole(orgId, targetUserId, newRole);

      if (!result.ok) {
        const err = (result as { ok: false; error: { code: string; message: string } }).error;
        const status =
          err.code === 'NOT_FOUND' ? 404 :
          err.code === 'CANNOT_DEMOTE_LAST_OWNER' || err.code === 'LAST_OWNER' ? 409 :
          err.code === 'INVALID_ROLE' ? 400 :
          err.code === 'NOT_A_MEMBER' ? 404 :
          400;

        return NextResponse.json(
          { success: false, error: err.message, code: err.code },
          { status }
        );
      }

      return NextResponse.json({ success: true, membership: (result as { ok: true; data: unknown }).data });
    }

    // --- Suspend ---
    if (body?.action === 'suspend') {
      if (isOrgAuthorityEnabled()) {
        await enforceMemberAction(user.id, orgId, targetUserId, 'suspend');
      }

      const result = await suspendMember(orgId, targetUserId, user.id);

      if (!result.ok) {
        const err = (result as { ok: false; error: { code: string; message: string } }).error;
        const status =
          err.code === 'NOT_FOUND' ? 404 :
          err.code === 'CANNOT_SUSPEND_LAST_OWNER' || err.code === 'LAST_OWNER' ? 409 :
          err.code === 'MEMBER_SUSPENDED' ? 409 :
          err.code === 'SELF_TARGET' ? 400 :
          err.code === 'NOT_A_MEMBER' ? 404 :
          400;

        return NextResponse.json(
          { success: false, error: err.message, code: err.code },
          { status }
        );
      }

      return NextResponse.json({ success: true, membership: (result as { ok: true; data: unknown }).data });
    }

    // --- Reactivate ---
    if (body?.action === 'reactivate') {
      if (isOrgAuthorityEnabled()) {
        await enforceMemberAction(user.id, orgId, targetUserId, 'reactivate');
      }

      const result = await reactivateMember(orgId, targetUserId);

      if (!result.ok) {
        const err = (result as { ok: false; error: { code: string; message: string } }).error;
        const status =
          err.code === 'NOT_FOUND' ? 404 :
          err.code === 'NOT_A_MEMBER' ? 404 :
          400;

        return NextResponse.json(
          { success: false, error: err.message, code: err.code },
          { status }
        );
      }

      return NextResponse.json({ success: true, membership: (result as { ok: true; data: unknown }).data });
    }

    return NextResponse.json(
      { success: false, error: 'Body must contain role, action: "suspend", or action: "reactivate"' },
      { status: 400 }
    );
  } catch (e) {
    if (e && typeof e === 'object' && 'reason' in e && 'statusCode' in e) {
      const authzErr = e as { reason: string; statusCode: number; message: string };
      return NextResponse.json(
        { success: false, error: authzErr.message, code: authzErr.reason },
        { status: authzErr.statusCode }
      );
    }
    return handleRouteDbError('[PATCH /api/organizations/[id]/members/[userId]]', e);
  }
}

/**
 * DELETE /api/organizations/[id]/members/[userId]
 *
 * Removes a member from the organization. Requires the member:remove
 * permission (admins and above). Owner protection prevents removing
 * the last active owner. Self-removal is not allowed through this route
 * (use the leave-org flow instead).
 *
 * When ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED is off, returns 501.
 */
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; userId: string }> }
) {
  const params = await props.params;
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: orgId, userId: targetUserId } = params;
  if (!isValidUUID(orgId) || !isValidUUID(targetUserId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid organization or user ID' },
      { status: 400 }
    );
  }

  // Membership write operations require the feature flag
  if (!isOrgFeatureEnabled('ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED')) {
    return NextResponse.json(
      { success: false, error: 'Organization membership management is not enabled' },
      { status: 501 }
    );
  }

  try {
    // Enforce authorization — always throws on denied (fail-closed).
    // Platform admins do NOT bypass this (ADR-004).
    if (isOrgAuthorityEnabled()) {
      await enforceMemberAction(user.id, orgId, targetUserId, 'remove');
    }

    const result = await removeMember(orgId, targetUserId, user.id);

    if (!result.ok) {
      const err = (result as { ok: false; error: { code: string; message: string } }).error;
      const status =
        err.code === 'NOT_FOUND' || err.code === 'NOT_A_MEMBER' ? 404 :
        err.code === 'CANNOT_REMOVE_LAST_OWNER' || err.code === 'LAST_OWNER' ? 409 :
        err.code === 'SELF_TARGET' ? 400 :
        400;

      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status }
      );
    }

    // Sync legacy org_id for the removed member
    try {
      const sql = await getDbReady();
      await sql`UPDATE users SET org_id = NULL WHERE id = ${targetUserId}`;
    } catch {
      // Non-fatal — the membership record was removed, legacy sync is best-effort
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e && typeof e === 'object' && 'reason' in e && 'statusCode' in e) {
      const authzErr = e as { reason: string; statusCode: number; message: string };
      return NextResponse.json(
        { success: false, error: authzErr.message, code: authzErr.reason },
        { status: authzErr.statusCode }
      );
    }
    return handleRouteDbError('[DELETE /api/organizations/[id]/members/[userId]]', e);
  }
}
