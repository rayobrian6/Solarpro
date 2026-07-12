/**
 * lib/organizations/authorization.ts
 *
 * Phase 1B — Organization Authority Foundation
 * Commit 5: Permission and Authorization Foundation
 *
 * The centralized authorization engine for organization-scoped operations.
 *
 * DESIGN PRINCIPLES:
 *
 *   1. DEFAULT-DENY: If any check fails, the result is denied. There is
 *      no "allow by default" path. Every authorization decision goes
 *      through a deny-first evaluation.
 *
 *   2. SERVER-AUTHORITATIVE: All authorization decisions are made
 *      server-side using data from the database. The client never
 *      sends authorization decisions — it can only request actions,
 *      and the server decides whether to allow them.
 *
 *   3. CONTEXT-AWARE: Authorization considers:
 *      - The user's org role within the target org
 *      - The org's status (active/suspended/archived)
 *      - The user's membership status (active/invited/suspended/removed)
 *      - Owner protection rules (last-owner checks)
 *
 *   4. PLATFORM ROLES ARE SEPARATE FROM ORG ROLES (ADR-004): A platform
 *      role (admin/super_admin) does NOT confer org-scoped permissions.
 *      Org-scoped access requires org membership with a sufficient org
 *      role. Platform admin status alone never grants cross-tenant
 *      org access.
 *
 *   5. SUPPORT ELEVATION IS FAIL-CLOSED: Support access (if any) is
 *      gated by isSupportElevationActive(), which defaults to false.
 *      When no support-elevation mechanism is active, platform admins
 *      are subject to the same membership and role checks as every
 *      other user. This establishes the integration boundary for
 *      future, explicit, time-limited, scoped, reason-bound, audited,
 *      and revocable support access (ADR-012). Until such a mechanism
 *      is implemented and explicitly enabled, support elevation is
 *      disabled and the default is deny.
 *
 *   6. ENFORCEMENT IS UNCONDITIONAL: Denied decisions always block the
 *      action when the new authority path is taken. The enforcement
 *      flag does not convert a denial into an allow. (Corrected in
 *      Phase 1B.1 Workstream 2.)
 */

import { getDbReady } from '@/lib/db-neon';
import { isValidUUID } from '@/lib/db-neon';
import {
  type OrgRole,
  isOrgFeatureEnabled,
  isOrgAuthorityEnabled,
  canManageRole,
} from './types';
import {
  getMembership,
  countActiveOwners,
  getOrgRole,
  hasRoleAtLeast,
} from './memberships';
import { type OrgAction, roleCanPerform, getRequiredRole } from './permissions';

// ============================================================================
// Authorization Result
// ============================================================================

/**
 * The result of an authorization check.
 * Uses a discriminated union so callers can safely narrow the outcome.
 */
export type DeniedAuthzResult = {
  allowed: false;
  reason: AuthzDenyReason;
  detail: string;
};

export type AllowedAuthzResult = {
  allowed: true;
  reason: 'allowed';
};

export type AuthzResult = AllowedAuthzResult | DeniedAuthzResult;

/**
 * Categorized deny reasons for meaningful error responses.
 */
export type AuthzDenyReason =
  | 'no_org_context'              // The user has no active org
  | 'not_a_member'                // The user is not a member of the org
  | 'membership_inactive'         // The user's membership is not active (invited/suspended)
  | 'org_not_found'               // The org doesn't exist
  | 'org_suspended'               // The org is suspended
  | 'org_archived'                // The org has been archived
  | 'insufficient_role'           // The user's role doesn't grant the action
  | 'last_owner_protection'       // The action violates last-owner protection
  | 'self_target'                 // The action targets the user themselves (forbidden)
  | 'cannot_manage_peer'          // The user cannot manage someone of equal/higher role
  | 'unknown_action'              // The action is not in the permission matrix
  | 'support_elevation_not_active'; // Support elevation is disabled — platform admin denied

// ============================================================================
// Platform Role Helpers
// ============================================================================

/**
 * Get a user's platform role from the database.
 * Platform roles: 'admin', 'super_admin', 'user' (default).
 *
 * These are SEPARATE from org roles (ADR-004). A platform role does NOT
 * confer org-scoped permissions. Org-scoped access requires org membership
 * with a sufficient org role.
 */
async function getPlatformRole(userId: string): Promise<string> {
  if (!isValidUUID(userId)) return 'user';

  const sql = await getDbReady();
  const rows = await sql`
    SELECT role FROM users WHERE id = ${userId} LIMIT 1
  `;
  if (rows.length === 0) return 'user';
  return String(rows[0].role ?? 'user');
}

/**
 * Check if a platform role is an administrative platform role.
 * 'super_admin' and 'admin' are platform admin roles.
 *
 * NOTE: This function identifies platform admins for informational purposes
 * only. It does NOT grant them org-scoped access. Platform admin status alone
 * never bypasses org membership or role checks (ADR-004, Phase 1B.1
 * Workstream 1). Support access — if any — is gated by
 * isSupportElevationActive() and must be explicit, time-limited, scoped,
 * reason-bound, audited, and revocable (ADR-012).
 */
function isPlatformAdmin(platformRole: string): boolean {
  const r = platformRole.toLowerCase();
  return r === 'super_admin' || r === 'admin';
}

/**
 * Whether a support-elevation mechanism is active.
 *
 * Support elevation is the ONLY authorized pathway for platform staff to
 * access tenant organizations without org membership. It must be explicit,
 * time-limited, scoped, reason-bound, audited, read-only by default, and
 * revocable (ADR-012, Canonical Model Diagram 7).
 *
 * This function establishes the integration boundary. It defaults to false
 * (fail-closed). No support-elevation mechanism is implemented in Phase 1B.1;
 * this is a placeholder that returns false so that platform admins are always
 * subject to the same membership and role checks as every other user. When a
 * future phase implements support elevation, it will gate the actual elevation
 * pathway through this function (or a successor), which will check for active,
 * unexpired, scoped elevation grants at that time.
 *
 * @returns false — support elevation is disabled by default (fail-closed).
 */
export function isSupportElevationActive(): boolean {
  return false;
}

// ============================================================================
// Core Authorization Check
// ============================================================================

/**
 * Check whether a user is authorized to perform an action within an
 * organization context.
 *
 * This is the PRIMARY authorization function. All org-scoped operations
 * should route through this check.
 *
 * Evaluation order (first deny wins):
 *   1. Validate IDs (deny if invalid).
 *   2. Check org exists and is active (deny if not found/suspended/archived).
 *   3. Check user is an active member of the org (deny if not).
 *   4. Check user's org role grants the action (deny if insufficient).
 *   5. ALLOW.
 *
 * Platform admin/super_admin roles do NOT bypass any of these checks
 * (ADR-004). A platform admin without org membership is denied, identical
 * to any other non-member. Support elevation, if active (ADR-012), would
 * be checked here in a future phase — but is fail-closed by default
 * (isSupportElevationActive() returns false).
 *
 * Note: Owner protection checks (last-owner) are handled separately
 * by checkOwnerProtection(), because they require knowing the specific
 * target of the action, not just the action type.
 *
 * @param userId         The user requesting the action.
 * @param organizationId The org context for the action.
 * @param action         The action to authorize.
 * @returns              Authorization result.
 */
export async function authorize(
  userId: string,
  organizationId: string,
  action: OrgAction
): Promise<AuthzResult> {
  // 1. Validate IDs
  if (!isValidUUID(userId) || !isValidUUID(organizationId)) {
    return { allowed: false, reason: 'no_org_context', detail: 'Invalid user or organization ID' };
  }

  // 2. Check org exists and is active
  const sql = await getDbReady();
  const orgRows = await sql`
    SELECT status FROM organizations WHERE id = ${organizationId} LIMIT 1
  `;
  if (orgRows.length === 0) {
    return { allowed: false, reason: 'org_not_found', detail: 'Organization not found' };
  }
  const orgStatus = String(orgRows[0].status);
  if (orgStatus === 'suspended') {
    return { allowed: false, reason: 'org_suspended', detail: 'Organization is suspended' };
  }
  if (orgStatus === 'archived' || orgStatus === 'deleted') {
    return { allowed: false, reason: 'org_archived', detail: 'Organization has been archived' };
  }

  // 3. Check user is an active member
  const membership = await getMembership(organizationId, userId);
  if (!membership) {
    return { allowed: false, reason: 'not_a_member', detail: 'You are not a member of this organization' };
  }
  if (membership.status !== 'active') {
    return {
      allowed: false,
      reason: 'membership_inactive',
      detail: `Your membership is ${membership.status}, not active`,
    };
  }

  // 4. Check org role grants the action
  if (!roleCanPerform(membership.role, action)) {
    const required = getRequiredRole(action);
    return {
      allowed: false,
      reason: 'insufficient_role',
      detail: `Action '${action}' requires role '${required ?? 'unknown'}', you have '${membership.role}'`,
    };
  }

  // 5. Allow
  return { allowed: true, reason: 'allowed' };
}

// ============================================================================
// Owner Protection
// ============================================================================

/**
 * Check whether an action on a target member would violate owner
 * protection rules.
 *
 * Owner protection rules:
 *   - The last active owner cannot be removed.
 *   - The last active owner cannot be demoted (role changed from owner).
 *   - The last active owner cannot be suspended.
 *
 * These rules ensure an org always has at least one active owner who
 * can manage it.
 *
 * @param organizationId  The org context.
 * @param targetUserId    The user being acted upon.
 * @param action          The action being performed on the target.
 * @returns               Authorization result (allowed or denied with reason).
 */
export async function checkOwnerProtection(
  organizationId: string,
  targetUserId: string,
  action: 'remove' | 'change_role' | 'suspend'
): Promise<AuthzResult> {
  if (!isValidUUID(organizationId) || !isValidUUID(targetUserId)) {
    return { allowed: false, reason: 'no_org_context', detail: 'Invalid ID' };
  }

  // Get the target's membership
  const membership = await getMembership(organizationId, targetUserId);
  if (!membership) {
    return { allowed: false, reason: 'not_a_member', detail: 'Target is not a member' };
  }

  // Owner protection only applies to active owners
  if (membership.role !== 'owner' || membership.status !== 'active') {
    return { allowed: true, reason: 'allowed' };
  }

  // Count active owners
  const ownerCount = await countActiveOwners(organizationId);

  // If this is the last owner, deny the action
  if (ownerCount <= 1) {
    const actionVerb = action === 'remove' ? 'remove' : action === 'change_role' ? 'demote' : 'suspend';
    return {
      allowed: false,
      reason: 'last_owner_protection',
      detail: `Cannot ${actionVerb} the last owner of an organization. Assign another owner first.`,
    };
  }

  return { allowed: true, reason: 'allowed' };
}

// ============================================================================
// Member-to-Member Authorization
// ============================================================================

/**
 * Check whether a user (actor) can perform an action on another user
 * (target) within an organization.
 *
 * This combines:
 *   - The actor's authorization for the action (authorize()).
 *   - Role hierarchy checks (can the actor manage the target's role?).
 *   - Self-target protection (can't remove/suspend yourself).
 *   - Owner protection (can't remove/demote/suspend the last owner).
 *
 * @param actorId         The user performing the action.
 * @param organizationId  The org context.
 * @param targetUserId    The user being acted upon.
 * @param action          The member action.
 * @returns               Authorization result.
 */
export async function authorizeMemberAction(
  actorId: string,
  organizationId: string,
  targetUserId: string,
  action: 'remove' | 'change_role' | 'suspend' | 'reactivate' | 'invite'
): Promise<AuthzResult> {
  // Map member actions to permission actions
  const permAction: OrgAction =
    action === 'remove' ? 'member:remove' :
    action === 'change_role' ? 'member:change_role' :
    action === 'suspend' ? 'member:suspend' :
    action === 'reactivate' ? 'member:reactivate' :
    'member:invite';

  // 1. Authorize the actor for the action
  const actorAuthz = await authorize(actorId, organizationId, permAction);
  if (!actorAuthz.allowed) return actorAuthz;

  // Invite doesn't target a specific existing member
  if (action === 'invite') return { allowed: true, reason: 'allowed' };

  // 2. Self-target protection for destructive actions
  if (actorId === targetUserId && (action === 'remove' || action === 'suspend')) {
    return {
      allowed: false,
      reason: 'self_target',
      detail: 'Cannot perform this action on yourself',
    };
  }

  // 3. Platform admins do NOT bypass member-to-member checks (ADR-004).
  // A platform admin without org membership is denied by authorize() at
  // step 1 above (the actorAuthz check). Support elevation, if active
  // (ADR-012), would be checked here in a future phase — but is
  // fail-closed by default (isSupportElevationActive() returns false).

  // 4. Get both roles
  const actorRole = await getOrgRole(organizationId, actorId);
  const targetRole = await getOrgRole(organizationId, targetUserId);

  if (!actorRole) {
    return { allowed: false, reason: 'not_a_member', detail: 'You are not a member of this organization' };
  }

  if (!targetRole) {
    if (action === 'reactivate') {
      return { allowed: false, reason: 'not_a_member', detail: 'Target is not a member' };
    }
    // For remove, if the target isn't a member, it's a no-op (allowed)
    return { allowed: true, reason: 'allowed' };
  }

  // 5. Role hierarchy check: can the actor manage the target's role?
  if (!canManageRole(actorRole, targetRole)) {
    return {
      allowed: false,
      reason: 'cannot_manage_peer',
      detail: `Your role (${actorRole}) cannot manage a ${targetRole}`,
    };
  }

  // Special case: admins cannot manage other admins (even though canManageRole
  // already prevents this, be explicit for clarity)
  if (actorRole === 'admin' && targetRole === 'admin') {
    return {
      allowed: false,
      reason: 'cannot_manage_peer',
      detail: 'Admins cannot manage other admins',
    };
  }

  // 6. Owner protection for destructive actions on owners
  if (action === 'remove' || action === 'change_role' || action === 'suspend') {
    const ownerProtection = await checkOwnerProtection(organizationId, targetUserId, action);
    if (!ownerProtection.allowed) return ownerProtection;
  }

  return { allowed: true, reason: 'allowed' };
}

/**
 * Check whether a user can assign a specific role to a target member.
 *
 * @param actorId         The user performing the role change.
 * @param organizationId  The org context.
 * @param targetUserId    The user whose role would change.
 * @param newRole         The role to assign.
 * @returns               Authorization result.
 */
export async function authorizeRoleChange(
  actorId: string,
  organizationId: string,
  targetUserId: string,
  newRole: OrgRole
): Promise<AuthzResult> {
  // 1. Authorize the role change action
  const authz = await authorizeMemberAction(actorId, organizationId, targetUserId, 'change_role');
  if (!authz.allowed) return authz;

  // 2. Platform admins do NOT bypass role assignment checks (ADR-004).
  // The actorAuthz check at step 1 already verified the actor's org role.
  // Support elevation, if active (ADR-012), would be checked here in a
  // future phase — but is fail-closed by default.

  // 3. Get the actor's role
  const actorRole = await getOrgRole(organizationId, actorId);
  if (!actorRole) {
    return { allowed: false, reason: 'not_a_member', detail: 'You are not a member' };
  }

  // 4. Check if the actor can assign the target role
  // Owners can assign any role. Admins can only assign member/viewer.
  if (actorRole !== 'owner' && (newRole === 'owner' || newRole === 'admin')) {
    return {
      allowed: false,
      reason: 'insufficient_role',
      detail: `Only owners can assign the ${newRole} role`,
    };
  }

  // 5. Owner protection: can't demote the last owner
  const targetRole = await getOrgRole(organizationId, targetUserId);
  if (targetRole === 'owner' && newRole !== 'owner') {
    const ownerProtection = await checkOwnerProtection(organizationId, targetUserId, 'change_role');
    if (!ownerProtection.allowed) return ownerProtection;
  }

  return { allowed: true, reason: 'allowed' };
}

// ============================================================================
// Enforcement Wrapper
// ============================================================================

/**
 * Whether authorization decisions are enforced (vs advisory).
 *
 * When ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED is true, deny results
 * should block the action. When false, deny results are advisory
 * (computed and logged, but the caller decides).
 */
export function isEnforcementEnabled(): boolean {
  return isOrgFeatureEnabled('ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED');
}

/**
 * Log an authorization decision for audit purposes.
 * This is called internally by enforceAuthz() but can also be called
 * directly for advisory checks.
 */
export function logAuthzDecision(
  userId: string,
  organizationId: string,
  action: string,
  result: AuthzResult
): void {
  const status = result.allowed ? 'ALLOWED' : `DENIED(${(result as DeniedAuthzResult).reason})`;
  const detail = result.allowed ? '' : `: ${(result as DeniedAuthzResult).detail}`;
  // Using console.warn so it appears in server logs for audit purposes.
  // In production, this would be routed to the audit log (lib/auditLog.ts).
  console.warn(
    `[AUTHZ] user=${userId} org=${organizationId} action=${action} → ${status}${detail}`
  );
}

/**
 * Enforce an authorization decision.
 *
 * When enforcement is enabled (ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED=true),
 * a denied result throws an AuthzError. When enforcement is disabled,
 * the decision is logged but not thrown (advisory mode).
 *
 * @param userId         The user requesting the action.
 * @param organizationId The org context.
 * @param action         The action to authorize.
 * @returns              void if allowed.
 * @throws               AuthzError if denied and enforcement is enabled.
 */
export async function enforceAuthz(
  userId: string,
  organizationId: string,
  action: OrgAction
): Promise<void> {
  const result = await authorize(userId, organizationId, action);
  logAuthzDecision(userId, organizationId, action, result);

  if (!result.allowed && isEnforcementEnabled()) {
    const denied = result as DeniedAuthzResult;
    throw new AuthzError(denied.reason, denied.detail);
  }
}

/**
 * Enforce a member-to-member authorization decision:
 */
export async function enforceMemberAction(
  actorId: string,
  organizationId: string,
  targetUserId: string,
  action: 'remove' | 'change_role' | 'suspend' | 'reactivate' | 'invite'
): Promise<void> {
  const result = await authorizeMemberAction(actorId, organizationId, targetUserId, action);
  logAuthzDecision(actorId, organizationId, `member:${action}:${targetUserId}`, result);

  if (!result.allowed) {
    const denied = result as DeniedAuthzResult;
    if (isEnforcementEnabled()) {
      throw new AuthzError(denied.reason, denied.detail);
    }
  }
}

// ============================================================================
// Error Class
// ============================================================================

/**
 * Authorization error thrown when enforcement is enabled and a check
 * denies the action.
 */
export class AuthzError extends Error {
  readonly reason: AuthzDenyReason;
  readonly statusCode: number;

  constructor(reason: AuthzDenyReason, detail: string) {
    super(detail);
    this.name = 'AuthzError';
    this.reason = reason;
    this.statusCode = authzReasonToStatusCode(reason);
  }
}

/**
 * Map an authorization deny reason to an HTTP status code.
 */
export function authzReasonToStatusCode(reason: AuthzDenyReason): number {
  switch (reason) {
    case 'no_org_context':
    case 'not_a_member':
    case 'membership_inactive':
      return 403;
    case 'org_not_found':
      return 404;
    case 'org_suspended':
    case 'org_archived':
      return 403;
    case 'insufficient_role':
    case 'cannot_manage_peer':
      return 403;
    case 'last_owner_protection':
      return 409; // Conflict — the action conflicts with a business rule
    case 'self_target':
      return 400; // Bad request — self-targeting is a client error
    case 'unknown_action':
      return 400;
    case 'support_elevation_not_active':
      return 403;
    default:
      return 403;
  }
}

// ============================================================================
// Quick-Check Helpers (for UI and route guards)
// ============================================================================

/**
 * Quick check: is the user an active member of the org with at least
 * the given role? (Does not check platform admin or org status — use
 * authorize() for full checks.)
 */
export async function quickCheckRole(
  userId: string,
  organizationId: string,
  minRole: OrgRole
): Promise<boolean> {
  return hasRoleAtLeast(organizationId, userId, minRole);
}

/**
 * Quick check: is the user a platform admin (admin/super_admin)?
 *
 * This is an informational check only. It does NOT grant org-scoped
 * access. Platform admin status alone never bypasses org membership or
 * role checks (ADR-004, Phase 1B.1 Workstream 1). Callers must not use
 * this function to grant cross-tenant org access.
 */
export async function isPlatformAdminUser(userId: string): Promise<boolean> {
  const role = await getPlatformRole(userId);
  return isPlatformAdmin(role);
}

/**
 * Check if the org authority system is fully enabled (master switch
 * + enforcement). When this is false, the system operates in legacy
 * mode and authorization is not enforced.
 */
export function isOrgAuthzActive(): boolean {
  return isOrgAuthorityEnabled() && isEnforcementEnabled();
}
