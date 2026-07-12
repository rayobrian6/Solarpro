/**
 * lib/organizations/service.ts
 *
 * Phase 1B — Organization Authority Foundation
 * Commit 3: Organization Membership Services and Compatibility Layer
 *
 * High-level organization service that orchestrates membership operations,
 * compatibility checks, and provides a unified API for the rest of the
 * application.
 *
 * This module is the primary entry point for organization-related business
 * logic. It wraps the lower-level memberships module and adds:
 *   - Permission checking (who can perform which action)
 *   - Compatibility fallbacks (legacy vs new path based on feature flags)
 *   - Aggregate operations (list orgs, get org with members)
 *
 * AUTHORIZATION NOTE:
 *   This commit (Commit 3) establishes the service skeleton and
 *   compatibility layer. Full authorization enforcement (default-deny,
 *   role-based permission matrix) is implemented in Commit 5
 *   (lib/organizations/authorization.ts). Until then, the permission
 *   checks here are advisory — they return the correct result but
 *   enforcement is gated on ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED.
 */

import { getDbReady } from '@/lib/db-neon';
import { isValidUUID } from '@/lib/db-neon';
import {
  type OrgRole,
  type OrganizationMembership,
  type MembershipWithUser,
  type MembershipWithOrg,
  type MembershipResult,
  type Organization,
  type OrgStatus,
  isOrgFeatureEnabled,
  isOrgAuthorityEnabled,
  canManageRole,
  isValidOrgRole,
} from './types';
import {
  getMembership,
  getMembershipsByUser,
  getMembershipsWithOrgByUser,
  getMembersByOrg,
  countActiveOwners,
  getActiveOwners,
  getOrgRole,
  isMember,
  hasRoleAtLeast,
  addMember,
  removeMember,
  changeMemberRole,
  suspendMember,
  reactivateMember,
  syncLegacyOrgId,
  backfillMembershipForUser,
  createOrganizationWithOwner,
} from './memberships';

// Re-export key functions for convenience
export {
  getMembership,
  getMembershipsByUser,
  getMembersByOrg,
  countActiveOwners,
  getActiveOwners,
  getOrgRole,
  isMember,
  hasRoleAtLeast,
  addMember,
  removeMember,
  changeMemberRole,
  suspendMember,
  reactivateMember,
  syncLegacyOrgId,
  backfillMembershipForUser,
  createOrganizationWithOwner,
};

// ============================================================================
// Organization Read Operations
// ============================================================================

/**
 * Get an organization by ID.
 * Returns null if not found or if soft-deleted/archived (unless includeDeleted).
 *
 * Both 'deleted' (legacy Phase 1B status) and 'archived' (canonical Phase 1B.1
 * status) are treated as terminal — the org is not visible in normal queries.
 */
export async function getOrganization(
  organizationId: string,
  includeDeleted = false
): Promise<Organization | null> {
  if (!isValidUUID(organizationId)) return null;

  const sql = await getDbReady();
  const rows = includeDeleted
    ? await sql`
        SELECT id, name, owner_id, plan, status, suspended_at, archived_at,
               deleted_at, slug, settings, created_at, updated_at
        FROM organizations
        WHERE id = ${organizationId}
        LIMIT 1
      `
    : await sql`
        SELECT id, name, owner_id, plan, status, suspended_at, archived_at,
               deleted_at, slug, settings, created_at, updated_at
        FROM organizations
        WHERE id = ${organizationId}
          AND status NOT IN ('deleted', 'archived')
        LIMIT 1
      `;

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: String(row.id),
    name: String(row.name),
    ownerId: String(row.owner_id),
    plan: String(row.plan),
    status: row.status as OrgStatus,
    suspendedAt: row.suspended_at ? String(row.suspended_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    slug: row.slug ? String(row.slug) : null,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Get all organizations a user belongs to (active memberships only,
 * active orgs only). Enriched with membership info.
 */
export async function getOrganizationsForUser(
  userId: string
): Promise<MembershipWithOrg[]> {
  if (!isValidUUID(userId)) return [];

  if (isOrgAuthorityEnabled()) {
    return getMembershipsWithOrgByUser(userId);
  }

  // Legacy fallback: use users.org_id (1:1 model)
  return getOrganizationsForUserLegacy(userId);
}

/**
 * Legacy path: get the user's single org from users.org_id.
 */
async function getOrganizationsForUserLegacy(
  userId: string
): Promise<MembershipWithOrg[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT o.id AS organization_id, o.name AS org_name, o.status AS org_status,
           o.id, o.name, o.status, u.org_role,
           NULL::uuid AS user_id_col, NULL::text AS role_col,
           NULL::text AS status_col, NULL::text AS invited_by,
           NULL::timestamptz AS invited_at, NULL::timestamptz AS accepted_at,
           NULL::timestamptz AS suspended_at, NULL::uuid AS suspended_by,
           o.created_at AS created_at, o.updated_at AS updated_at,
           NULL::uuid AS membership_id
    FROM users u
    JOIN organizations o ON o.id = u.org_id
    WHERE u.id = ${userId}
      AND u.org_id IS NOT NULL
      AND o.status = 'active'
  `;

  if (rows.length === 0) return [];

  const row = rows[0];
  // Construct a MembershipWithOrg from the legacy 1:1 data
  return [{
    id: String(row.membership_id ?? row.id),
    organizationId: String(row.organization_id),
    userId,
    role: (row.org_role ?? 'member') as OrgRole,
    status: 'active',
    invitedBy: null,
    invitedAt: null,
    acceptedAt: null,
    joinedAt: null,
    suspendedAt: null,
    suspendedBy: null,
    removedAt: null,
    removedBy: null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    orgName: String(row.org_name),
    orgStatus: row.org_status as OrgStatus,
  }];
}

/**
 * Get an organization with all its members.
 * Returns null if the org doesn't exist.
 */
export async function getOrganizationWithMembers(
  organizationId: string
): Promise<{ organization: Organization; members: MembershipWithUser[] } | null> {
  const org = await getOrganization(organizationId);
  if (!org) return null;

  const members = await getMembersByOrg(organizationId, 'active');
  return { organization: org, members };
}

// ============================================================================
// Permission Checks (advisory until Commit 5 enforcement)
// ============================================================================

/**
 * Determine whether a user can perform an action on a target member
 * within an organization.
 *
 * This is the advisory permission check. When ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED
 * is true (Commit 5+), the API layer will enforce these results. Until then,
 * the results are returned but enforcement is the caller's responsibility.
 *
 * Rules:
 *   - Owners can manage all roles (including other owners, subject to
 *     last-owner protection in the service layer).
 *   - Admins can manage members and viewers, but NOT owners or other admins.
 *   - Members and viewers cannot manage anyone.
 *   - A user cannot target themselves for suspension/removal (self-target
 *     protection).
 *
 * @param organizationId  The org context.
 * @param actorId         The user performing the action.
 * @param targetId        The user being acted upon.
 * @param action          The action type.
 */
export async function checkMemberPermission(
  organizationId: string,
  actorId: string,
  targetId: string,
  action: 'remove' | 'changeRole' | 'suspend' | 'reactivate'
): Promise<{ allowed: boolean; reason?: string }> {
  if (!isValidUUID(organizationId) || !isValidUUID(actorId) || !isValidUUID(targetId)) {
    return { allowed: false, reason: 'Invalid ID' };
  }

  // Self-target protection for destructive actions
  if (actorId === targetId && (action === 'remove' || action === 'suspend')) {
    return { allowed: false, reason: 'Cannot perform this action on yourself' };
  }

  // Get the actor's role
  const actorRole = await getOrgRole(organizationId, actorId);
  if (!actorRole) {
    return { allowed: false, reason: 'You are not a member of this organization' };
  }

  // Get the target's role (if they're a member)
  const targetRole = await getOrgRole(organizationId, targetId);

  // If the target isn't a member, only remove makes sense (and it's a no-op)
  if (!targetRole && action !== 'remove') {
    return { allowed: false, reason: 'Target user is not a member of this organization' };
  }

  // Check role-based management permission
  if (targetRole && !canManageRole(actorRole, targetRole)) {
    return {
      allowed: false,
      reason: `Your role (${actorRole}) cannot manage a ${targetRole}`,
    };
  }

  // Special case: an admin cannot remove/suspend/reactivate another admin
  // (canManageRole already prevents this, but be explicit)
  if (actorRole === 'admin' && targetRole === 'admin') {
    return { allowed: false, reason: 'Admins cannot manage other admins' };
  }

  return { allowed: true };
}

/**
 * Check if a user can invite new members to an organization.
 * Owners and admins can invite. Members and viewers cannot.
 */
export async function canInviteMembers(
  organizationId: string,
  userId: string
): Promise<boolean> {
  return hasRoleAtLeast(organizationId, userId, 'admin');
}

/**
 * Check if a user can change org settings.
 * Only owners can change org settings.
 */
export async function canManageOrgSettings(
  organizationId: string,
  userId: string
): Promise<boolean> {
  return hasRoleAtLeast(organizationId, userId, 'owner');
}

// ============================================================================
// Compatibility: Legacy Fallback Resolution
// ============================================================================

/**
 * Resolve a user's organization context using the appropriate path
 * based on feature flags.
 *
 * When ENTERPRISE_ORG_AUTHORITY_ENABLED is true:
 *   - Use the new organization_members table (many-to-many).
 *   - Return all active memberships.
 *
 * When false (legacy):
 *   - Use users.org_id (1:1 model).
 *   - Return a single membership.
 *
 * This function is the compatibility bridge for code that needs to
 * know "what org(s) does this user belong to?" without caring about
 * the implementation.
 */
export async function resolveUserOrgs(
  userId: string
): Promise<MembershipWithOrg[]> {
  return getOrganizationsForUser(userId);
}

/**
 * Resolve a user's PRIMARY organization.
 *
 * In the new model: the user's active org from active_organization_context
 * (if set), otherwise their highest-role membership, otherwise null.
 *   NOTE: The active_organization_context resolution is implemented in
 *   Commit 4 (lib/organizations/context.ts). Until then, we fall back
 *   to the highest-role membership.
 *
 * In the legacy model: users.org_id (single org).
 */
export async function resolvePrimaryOrg(
  userId: string
): Promise<{ organizationId: string; role: OrgRole } | null> {
  if (!isValidUUID(userId)) return null;

  if (isOrgAuthorityEnabled()) {
    // New path: find the highest-role active membership
    // (Active org context resolution is added in Commit 4)
    const memberships = await getMembershipsWithOrgByUser(userId);
    if (memberships.length === 0) return null;

    // Sort by role priority (owner > admin > member > viewer), then by created_at
    const roleOrder: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
    memberships.sort((a, b) => {
      const roleDiff = roleOrder[a.role] - roleOrder[b.role];
      if (roleDiff !== 0) return roleDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return {
      organizationId: memberships[0].organizationId,
      role: memberships[0].role,
    };
  }

  // Legacy path: users.org_id
  const sql = await getDbReady();
  const rows = await sql`
    SELECT org_id, org_role FROM users WHERE id = ${userId} LIMIT 1
  `;
  if (rows.length === 0 || !rows[0].org_id) return null;

  const role: OrgRole = isValidOrgRole(rows[0].org_role) ? rows[0].org_role : 'member';
  return {
    organizationId: String(rows[0].org_id),
    role,
  };
}

/**
 * Get the member count for an organization.
 *
 * In the new model: count from organization_members WHERE status='active'.
 * In the legacy model: count from users WHERE org_id = orgId.
 */
export async function getOrgMemberCount(
  organizationId: string
): Promise<number> {
  if (!isValidUUID(organizationId)) return 0;

  const sql = await getDbReady();

  if (isOrgAuthorityEnabled()) {
    const rows = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM organization_members
      WHERE organization_id = ${organizationId}
        AND status = 'active'
    `;
    return rows.length > 0 ? Number(rows[0].cnt) : 0;
  }

  // Legacy: count users with org_id
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt
    FROM users
    WHERE org_id = ${organizationId}
  `;
  return rows.length > 0 ? Number(rows[0].cnt) : 0;
}

// ============================================================================
// Type Re-exports
// ============================================================================

export type {
  OrgRole,
  OrganizationMembership,
  MembershipWithUser,
  MembershipWithOrg,
  MembershipResult,
  Organization,
  OrgStatus,
} from './types';
