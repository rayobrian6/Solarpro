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
 *      - The user's platform role (admin/super_admin grant cross-tenant
 *        access, bypassing org role checks)
 *      - The user's org role within the target org
 *      - The org's status (active/suspended/deleted)
 *      - The user's membership status (active/invited/suspended)
 *      - Owner protection rules (last-owner checks)
 *
 *   4. FEATURE-FLAGGED ENFORCEMENT: When
 *      ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED is true, authorization
 *      decisions are ENFORCED (deny results block the action). When
 *      false, decisions are ADVISORY (the result is computed and
 *      logged, but the caller is responsible for enforcement).
 *
 *   5. PLATFORM ROLES SEPARATE FROM ORG ROLES: Platform admin/super_admin
 *      can access all orgs (cross-tenant). Org roles grant scoped access
 *      within a single org. These are checked independently.
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
  | 'no_org_context'        // The user has no active org
  | 'not_a_member'          // The user is not a member of the org
  | 'membership_inactive'   // The user's membership is not active (invited/suspended)
  | 'org_not_found'         // The org doesn't exist
  | 'org_suspended'         // The org is suspended
  | 'org_deleted'           // The org is soft-deleted
  | 'insufficient_role'     // The user's role doesn't grant the action
  | 'last_owner_protection' // The action violates last-owner protection
  | 'self_target'           // The action targets the user themselves (forbidden)
  | 'cannot_manage_peer'    // The user cannot manage someone of equal/higher role
  | 'unknown_action';       // The action is not in the permission matrix

// ============================================================================
// Platform Role Helpers
// ============================================================================

/**
 * Get a user's platform role from the database.
 * Platform roles: 'admin', 'super_admin', 'user' (default).
 *
 * These are SEPARATE from org roles. A platform admin can access all
 * orgs cross-tenant, while an org role grants scoped access within
 * one org.
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
 * Check if a platform role grants cross-tenant administrative access.
 * 'super_admin' and 'admin' bypass org-role checks.
 */
function isPlatformAdmin(platformRole: string): boolean {
  const r = platformRole.toLowerCase();
  return r === 'super_admin' || r === 'admin';
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
 *   2. Check platform role — if super_admin/admin, ALLOW (cross-tenant).
 *   3. Check org exists and is active (deny if not found/suspended/deleted).
 *   4. Check user is an active member of the org (deny if not).
 *   5. Check user's org role grants the action (deny if insufficient).
 *   6. ALLOW.
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

  // 2. Check platform role — super_admin/admin bypass org checks
  const platformRole = await getPlatformRole(userId);
  if (isPlatformAdmin(platformRole)) {
    return { allowed: true, reason: 'allowed' };
  }

  // 3. Check org exists and is active
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
  if (orgStatus === 'deleted') {
    return { allowed: false, reason: 'org_deleted', detail: 'Organization has been deleted' };
  }

  // 4. Check user is an active member
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

  // 5. Check org role grants the action
  if (!roleCanPerform(membership.role, action)) {
    const required = getRequiredRole(action);
    return {
      allowed: false,
      reason: 'insufficient_role',
      detail: `Action '${action}' requires role '${required ?? 'unknown'}', you have '${membership.role}'`,
    };
  }

  // 6. Allow
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

  // 3. Platform admins bypass member-to-member checks
  const platformRole = await getPlatformRole(actorId);
  if (isPlatformAdmin(platformRole)) {
    // But still check owner protection (even admins can't remove the last owner)
    if (action === 'remove' || action === 'change_role' || action === 'suspend') {
      const ownerProtection = await checkOwnerProtection(organizationId, targetUserId, action);
      if (!ownerProtection.allowed) return ownerProtection;
    }
    return { allowed: true, reason: 'allowed' };
  }

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

  // 2. Platform admins bypass role assignment checks
  const platformRole = await getPlatformRole(actorId);
  if (isPlatformAdmin(platformRole)) {
    // But still check owner protection (can't demote last owner)
    const ownerProtection = await checkOwnerProtection(organizationId, targetUserId, 'change_role');
    if (!ownerProtection.allowed) return ownerProtection;
    return { allowed: true, reason: 'allowed' };
  }

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
    case 'org_deleted':
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
