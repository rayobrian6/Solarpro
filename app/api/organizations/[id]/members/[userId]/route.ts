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

/**
 * 🚨 THE LEGACY GUARD. WITHOUT IT, THESE MUTATIONS RAN WITH NO AUTHORIZATION AT ALL.
 *
 * Two independent flags govern this file, and they govern DIFFERENT things:
 *   ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED  — may these mutations run at all (501)
 *   ENTERPRISE_ORG_AUTHORITY_ENABLED         — is the authority engine in the path
 *
 * Every mutation below wraps its `enforceMemberAction` call in the SECOND flag, which
 * is the documented architecture and is correct: `docs/enterprise-multi-tenant/
 * phase1b1/AUTHORITY-BOUNDARY.md` says the flag "controls whether routes enter the
 * authority path at all — it does not weaken enforcement within that path", and this
 * file's own header scopes its fail-closed promise to "when the authority master
 * switch is on".
 *
 * THE DEFECT WAS WHAT SAT BEHIND IT: NOTHING. With WRITE=true and AUTHORITY unset —
 * the natural order, since the 501 message names only the WRITE flag — the role
 * change, suspend, reactivate and remove paths executed with no caller check
 * whatsoever. `changeMemberRole` and `removeMember` take no actor argument and
 * validate only that the TARGET is a member plus the last-owner rule, and
 * `lib/organizations/service.ts` states outright that "Authorization is NOT enforced
 * here — callers must check authorize()". So any authenticated user who knew an
 * organization UUID and a member UUID could PATCH `{role:'owner'}` onto that member,
 * or DELETE them — and a viewer could promote themselves to owner of an org they
 * merely belonged to. `changeMemberRole` also writes `users.org_role`, which is the
 * column the legacy path itself reads, so the escalation persisted into the very
 * source of truth that governs while the switch is off.
 *
 * The sibling route already had a legacy branch for exactly this case
 * (`../route.ts` — "Verify the caller is a member of this org (legacy check)"). That
 * shape is right for a READ and insufficient for a MUTATION: mere membership would
 * still let a viewer promote themselves. So the legacy rule here is role-aware, and
 * deliberately conservative — it is a stop-gap for a switched-off authority engine,
 * not a second authority.
 *
 * Returns a response to send when the caller is not permitted, or null to proceed.
 */
async function legacyMemberManagementGuard(
  callerId: string,
  orgId: string,
  opts: { grantingOwner?: boolean } = {},
): Promise<NextResponse | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT org_role FROM users WHERE id = ${callerId} AND org_id = ${orgId} LIMIT 1
  `;
  const callerRole = (rows as Array<{ org_role?: string }>)[0]?.org_role ?? null;

  if (!callerRole) {
    return NextResponse.json(
      { success: false, error: 'You are not a member of this organization' },
      { status: 403 }
    );
  }
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to manage members of this organization' },
      { status: 403 }
    );
  }
  // Only an owner may create another owner. An admin who could grant ownership
  // could grant it to themselves, which is the escalation this guard exists to stop.
  if (opts.grantingOwner && callerRole !== 'owner') {
    return NextResponse.json(
      { success: false, error: 'Only an organization owner may grant the owner role' },
      { status: 403 }
    );
  }
  return null;
}
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
      } else {
        const denied = await legacyMemberManagementGuard(user.id, orgId, { grantingOwner: newRole === 'owner' });
        if (denied) return denied;
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
      } else {
        const denied = await legacyMemberManagementGuard(user.id, orgId);
        if (denied) return denied;
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
      } else {
        const denied = await legacyMemberManagementGuard(user.id, orgId);
        if (denied) return denied;
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
    } else {
      const denied = await legacyMemberManagementGuard(user.id, orgId);
      if (denied) return denied;
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

    // ══ 🚨 THE LEGACY org_id SYNC IS REMOVED HERE, NOT REPAIRED ═══════════════
    //
    // This block ran:
    //
    //     UPDATE users SET org_id = NULL WHERE id = ${targetUserId}
    //
    // with NO organization in the WHERE clause. Removing a user from organization
    // A therefore cleared their `org_id` even when it pointed at organization B —
    // a mutation in one tenant detaching a user from a different one.
    //
    // And it was not merely unscoped, it was DESTRUCTIVE OF A CORRECT RESULT.
    // `removeMember` (lib/organizations/memberships.ts) already does this properly,
    // moments earlier and under its own comment "clear users.org_id if it pointed
    // to this org":
    //
    //     UPDATE users SET org_id = NULL, org_role = 'owner'
    //      WHERE id = ${userId} AND org_id = ${organizationId}
    //
    // and then calls `syncLegacyOrgId`, which re-points the legacy column at any
    // OTHER active membership the user still holds. This block ran afterwards and
    // wiped that re-point out, so a user removed from one of two organizations was
    // left detached from both — and the org that still had them was under-counted
    // by every legacy query that reads `users.org_id`.
    //
    // There is nothing to repair: the library's version is scoped, sets org_role
    // too, and re-syncs. The correct fix is for the route to stop second-guessing
    // it.

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
