/**
 * lib/organizations/memberships.ts
 *
 * Phase 1B — Organization Authority Foundation
 * Commit 3: Organization Membership Services and Compatibility Layer
 *
 * This module provides the data access layer for the organization_members
 * table (the authoritative many-to-many membership source) and the
 * compatibility layer that keeps users.org_id in sync with the new model.
 *
 * DESIGN PRINCIPLES:
 *
 *   1. Authoritative source: organization_members is the canonical
 *      membership record. users.org_id is a legacy pointer kept in sync
 *      by the compatibility layer for code paths that haven't migrated.
 *
 *   2. Feature-flagged writes: All mutating operations check
 *      ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED. When false, writes
 *      are rejected (the legacy API routes handle their own writes).
 *
 *   3. Owner protection: The last active owner of an org cannot be
 *      removed, demoted, or suspended. This is enforced at the service
 *      layer (not just the DB) to provide meaningful error messages.
 *
 *   4. Server-authoritative: All reads go to the DB. No caching of
 *      membership state in the JWT or session.
 *
 * Neon SQL conventions:
 *   - sql`` auto-parameterizes ${value} interpolations.
 *   - Do NOT append ::uuid after interpolated values.
 *   - Postgres infers UUID type from column definitions.
 */

import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { isValidUUID } from '@/lib/db-neon';
import {
  type OrgRole,
  type MembershipStatus,
  type OrganizationMembership,
  type MembershipWithUser,
  type MembershipWithOrg,
  type MembershipResult,
  type MembershipError,
  isValidOrgRole,
  isOrgFeatureEnabled,
} from './types';

// A Neon SQL executor — tagged template function that auto-parameterizes.
type SqlExecutor = ReturnType<typeof getDbReady> extends Promise<infer T> ? T : never;

// ============================================================================
// Row Mapper
// ============================================================================

/**
 * Map a raw DB row (snake_case) to an OrganizationMembership (camelCase).
 *
 * Includes lifecycle timestamp fields (joined_at, removed_at, removed_by)
 * added in Phase 1B.1 migration 106.
 */
function mapMembership(row: Record<string, unknown>): OrganizationMembership {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    role: row.role as OrgRole,
    status: row.status as MembershipStatus,
    invitedBy: row.invited_by ? String(row.invited_by) : null,
    invitedAt: row.invited_at ? String(row.invited_at) : null,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
    joinedAt: row.joined_at ? String(row.joined_at) : null,
    suspendedAt: row.suspended_at ? String(row.suspended_at) : null,
    suspendedBy: row.suspended_by ? String(row.suspended_by) : null,
    removedAt: row.removed_at ? String(row.removed_at) : null,
    removedBy: row.removed_by ? String(row.removed_by) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Map a raw DB row to a MembershipWithUser (includes user name/email).
 */
function mapMembershipWithUser(row: Record<string, unknown>): MembershipWithUser {
  return {
    ...mapMembership(row),
    userName: String(row.user_name ?? ''),
    userEmail: String(row.user_email ?? ''),
  };
}

// ============================================================================
// Error Helpers
// ============================================================================

function err(code: MembershipError['code'], message: string): MembershipError {
  return { code, message } as MembershipError;
}

function fail(code: MembershipError['code'], message: string): { ok: false; error: MembershipError } {
  return { ok: false, error: err(code, message) };
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get a single membership by org ID and user ID.
 * Returns null if no membership exists (or if it's not found).
 */
export async function getMembership(
  organizationId: string,
  userId: string
): Promise<OrganizationMembership | null> {
  if (!isValidUUID(organizationId) || !isValidUUID(userId)) return null;

  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM organization_members
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  return rows.length > 0 ? mapMembership(rows[0]) : null;
}

/**
 * Get all memberships for a user (across all orgs).
 * Optionally filter by status (default: active only).
 */
export async function getMembershipsByUser(
  userId: string,
  status?: MembershipStatus
): Promise<OrganizationMembership[]> {
  if (!isValidUUID(userId)) return [];

  const sql = await getDbReady();
  const rows = status
    ? await sql`
        SELECT * FROM organization_members
        WHERE user_id = ${userId}
          AND status = ${status}
        ORDER BY created_at ASC
      `
    : await sql`
        SELECT * FROM organization_members
        WHERE user_id = ${userId}
        ORDER BY created_at ASC
      `;
  return rows.map(mapMembership);
}

/**
 * Get all active memberships for a user, enriched with org details.
 */
export async function getMembershipsWithOrgByUser(
  userId: string
): Promise<MembershipWithOrg[]> {
  if (!isValidUUID(userId)) return [];

  const sql = await getDbReady();
  const rows = await sql`
    SELECT om.*, o.name AS org_name, o.status AS org_status
    FROM organization_members om
    JOIN organizations o ON o.id = om.organization_id
    WHERE om.user_id = ${userId}
      AND om.status = 'active'
      AND o.status = 'active'
    ORDER BY o.name ASC
  `;
  return rows.map((row) => ({
    ...mapMembership(row),
    orgName: String(row.org_name ?? ''),
    orgStatus: row.org_status as 'active' | 'suspended' | 'archived' | 'deleted',
  }));
}

/**
 * Get all members of an organization.
 * Optionally filter by status (default: active only).
 * Returns enriched rows with user name and email.
 */
export async function getMembersByOrg(
  organizationId: string,
  status?: MembershipStatus | 'all'
): Promise<MembershipWithUser[]> {
  if (!isValidUUID(organizationId)) return [];

  const sql = await getDbReady();

  // Default: return only 'active' members. This is the correct lifecycle
  // semantics — removed, suspended, and invited members should not appear
  // in the normal member listing. Pass 'all' (or an explicit status) to
  // override.
  const effectiveStatus = status === undefined ? 'active' : status;

  const rows = effectiveStatus === 'all'
    ? await sql`
        SELECT om.*, u.name AS user_name, u.email AS user_email
        FROM organization_members om
        JOIN users u ON u.id = om.user_id
        WHERE om.organization_id = ${organizationId}
        ORDER BY
          CASE om.role
            WHEN 'owner' THEN 0
            WHEN 'admin' THEN 1
            WHEN 'member' THEN 2
            WHEN 'viewer' THEN 3
          END,
          u.name ASC
      `
    : await sql`
        SELECT om.*, u.name AS user_name, u.email AS user_email
        FROM organization_members om
        JOIN users u ON u.id = om.user_id
        WHERE om.organization_id = ${organizationId}
          AND om.status = ${effectiveStatus}
        ORDER BY
          CASE om.role
            WHEN 'owner' THEN 0
            WHEN 'admin' THEN 1
            WHEN 'member' THEN 2
            WHEN 'viewer' THEN 3
          END,
          u.name ASC
      `;
  return rows.map(mapMembershipWithUser);
}

/**
 * Count active owners of an organization.
 * Used for last-owner protection checks.
 */
export async function countActiveOwners(
  organizationId: string
): Promise<number> {
  if (!isValidUUID(organizationId)) return 0;

  const sql = await getDbReady();
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt
    FROM organization_members
    WHERE organization_id = ${organizationId}
      AND role = 'owner'
      AND status = 'active'
  `;
  return rows.length > 0 ? Number(rows[0].cnt) : 0;
}

/**
 * Get the active owner(s) of an organization.
 */
export async function getActiveOwners(
  organizationId: string
): Promise<MembershipWithUser[]> {
  if (!isValidUUID(organizationId)) return [];

  const sql = await getDbReady();
  const rows = await sql`
    SELECT om.*, u.name AS user_name, u.email AS user_email
    FROM organization_members om
    JOIN users u ON u.id = om.user_id
    WHERE om.organization_id = ${organizationId}
      AND om.role = 'owner'
      AND om.status = 'active'
    ORDER BY u.name ASC
  `;
  return rows.map(mapMembershipWithUser);
}

/**
 * Get the role of a user within a specific organization.
 * Returns null if the user is not an active member.
 */
export async function getOrgRole(
  organizationId: string,
  userId: string
): Promise<OrgRole | null> {
  const membership = await getMembership(organizationId, userId);
  if (!membership || membership.status !== 'active') return null;
  return membership.role;
}

/**
 * Check if a user is an active member of an organization.
 */
export async function isMember(
  organizationId: string,
  userId: string
): Promise<boolean> {
  const membership = await getMembership(organizationId, userId);
  return membership !== null && membership.status === 'active';
}

/**
 * Check if a user has a specific role (or higher) in an organization.
 */
export async function hasRoleAtLeast(
  organizationId: string,
  userId: string,
  minRole: OrgRole
): Promise<boolean> {
  const role = await getOrgRole(organizationId, userId);
  if (!role) return false;

  const order: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
  return order[role] <= order[minRole];
}

// ============================================================================
// Write Operations (feature-flagged)
// ============================================================================

/**
 * Guard: check that membership writes are enabled.
 */
function assertMembershipWritesEnabled(): MembershipResult<never> | null {
  if (!isOrgFeatureEnabled('ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED')) {
    return fail(
      'INSUFFICIENT_PERMISSIONS',
      'Organization membership writes are not enabled. Set ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED=true to use the new membership system.'
    );
  }
  return null;
}

/**
 * Add a member to an organization.
 *
 * If the user already has a membership (any status), returns ALREADY_MEMBER.
 * Creates an 'active' membership with the specified role (default 'member').
 *
 * Also syncs users.org_id if the user has no legacy org_id (compatibility).
 *
 * @param organizationId  The org to add the member to.
 * @param userId           The user to add.
 * @param role             The role to assign (default 'member').
 * @param invitedBy        The user ID of the inviter (optional).
 */
export async function addMember(
  organizationId: string,
  userId: string,
  role: OrgRole = 'member',
  invitedBy?: string
): Promise<MembershipResult<OrganizationMembership>> {
  const guard = assertMembershipWritesEnabled();
  if (guard) return guard;

  if (!isValidUUID(organizationId) || !isValidUUID(userId)) {
    return fail('NOT_FOUND', 'Invalid organization or user ID');
  }
  if (!isValidOrgRole(role)) {
    return fail('INVALID_ROLE', `Invalid role: ${role}`);
  }

  const sql = await getDbReady();

  // Check for existing membership (any status)
  const existing = await getMembership(organizationId, userId);
  if (existing) {
    // If the member was previously removed, reactivate the existing row
    // instead of returning ALREADY_MEMBER. This preserves the membership
    // history and audit trail (ADR-001). The removed_at/removed_by fields
    // are cleared, and joined_at is updated to the current time (re-join).
    if (existing.status === 'removed') {
      const now = new Date().toISOString();
      const rows = await sql`
        UPDATE organization_members
        SET status = 'active',
            role = ${role},
            removed_at = NULL,
            removed_by = NULL,
            suspended_at = NULL,
            suspended_by = NULL,
            joined_at = ${now}
        WHERE organization_id = ${organizationId}
          AND user_id = ${userId}
        RETURNING *
      `;
      const membership = mapMembership(rows[0]);

      // Compatibility: sync users.org_id if the user has no legacy org_id
      await syncLegacyOrgId(sql, userId);

      return ok(membership);
    }
    return fail('ALREADY_MEMBER', 'User is already a member of this organization');
  }

  // Verify the org exists and is active
  const orgRows = await sql`
    SELECT status FROM organizations WHERE id = ${organizationId} LIMIT 1
  `;
  if (orgRows.length === 0) {
    return fail('NOT_FOUND', 'Organization not found');
  }
  if (orgRows[0].status === 'suspended') {
    return fail('ORG_SUSPENDED', 'Cannot add members to a suspended organization');
  }
  if (orgRows[0].status === 'deleted' || orgRows[0].status === 'archived') {
    return fail('NOT_FOUND', 'Organization not found');
  }

  // Insert the membership
  const now = new Date().toISOString();
  const rows = await sql`
    INSERT INTO organization_members
      (organization_id, user_id, role, status, invited_by, invited_at, accepted_at, joined_at, created_at, updated_at)
    VALUES
      (${organizationId}, ${userId}, ${role}, 'active',
       ${invitedBy ?? null}, ${invitedBy ? now : null}, ${now}, ${now}, ${now}, ${now})
    RETURNING *
  `;
  const membership = mapMembership(rows[0]);

  // Compatibility: sync users.org_id if the user has no legacy org_id
  await syncLegacyOrgId(sql, userId);

  return ok(membership);
}

/**
 * Remove a member from an organization (soft-delete).
 *
 * Instead of hard-deleting the membership row, this sets status to 'removed'
 * and records removed_at and removed_by for audit trail integrity (ADR-001,
 * Threat Model T-12). The row is retained so the removal is auditable and
 * the member can be re-added later without losing history.
 *
 * Enforces last-owner protection: if the target is the last active owner,
 * returns CANNOT_REMOVE_LAST_OWNER.
 *
 * Also clears users.org_id if it pointed to this org (compatibility) and
 * invalidates the active org context if the removed member had this org set
 * as their active context.
 *
 * @param organizationId  The org to remove from.
 * @param userId           The user to remove.
 * @param removedBy        The user ID of the remover (for audit).
 */
export async function removeMember(
  organizationId: string,
  userId: string,
  removedBy?: string
): Promise<MembershipResult<void>> {
  const guard = assertMembershipWritesEnabled();
  if (guard) return guard;

  if (!isValidUUID(organizationId) || !isValidUUID(userId)) {
    return fail('NOT_FOUND', 'Invalid organization or user ID');
  }

  const sql = await getDbReady();

  // Check membership exists
  const membership = await getMembership(organizationId, userId);
  if (!membership) {
    return fail('NOT_A_MEMBER', 'User is not a member of this organization');
  }

  // If already removed, this is a no-op success (idempotent)
  if (membership.status === 'removed') {
    return ok(undefined);
  }

  // Last-owner protection (only applies to active owners)
  if (membership.role === 'owner' && membership.status === 'active') {
    const ownerCount = await countActiveOwners(organizationId);
    if (ownerCount <= 1) {
      return fail(
        'CANNOT_REMOVE_LAST_OWNER',
        'Cannot remove the last owner of an organization. Assign another owner first.'
      );
    }
  }

  // Soft-delete: set status to 'removed' and record the audit fields
  const now = new Date().toISOString();
  await sql`
    UPDATE organization_members
    SET status = 'removed',
        removed_at = ${now},
        removed_by = ${removedBy ?? null}
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
  `;

  // Invalidate the active org context if this org was the user's active context.
  // This prevents a removed member from continuing to operate in the org's
  // context until they switch to another org or are re-added.
  try {
    await sql`
      DELETE FROM active_organization_context
      WHERE user_id = ${userId}
        AND organization_id = ${organizationId}
    `;
  } catch {
    // Best-effort: active context cleanup should not block the removal
  }

  // Compatibility: clear users.org_id if it pointed to this org
  try {
    await sql`
      UPDATE users SET org_id = NULL, org_role = 'owner'
      WHERE id = ${userId} AND org_id = ${organizationId}
    `;
    // Re-sync the legacy pointer to pick up any other active memberships
    await syncLegacyOrgId(sql, userId);
  } catch {
    // Best-effort: legacy sync failure should not block the removal
  }

  return ok(undefined);
}

/**
 * Change a member's role within an organization.
 *
 * Enforces last-owner protection: if demoting the last active owner,
 * returns CANNOT_DEMOTE_LAST_OWNER.
 *
 * @param organizationId  The org.
 * @param userId           The user whose role to change.
 * @param newRole          The new role.
 */
export async function changeMemberRole(
  organizationId: string,
  userId: string,
  newRole: OrgRole
): Promise<MembershipResult<OrganizationMembership>> {
  const guard = assertMembershipWritesEnabled();
  if (guard) return guard;

  if (!isValidUUID(organizationId) || !isValidUUID(userId)) {
    return fail('NOT_FOUND', 'Invalid organization or user ID');
  }
  if (!isValidOrgRole(newRole)) {
    return fail('INVALID_ROLE', `Invalid role: ${newRole}`);
  }

  const sql = await getDbReady();

  // Check membership exists and is active
  const membership = await getMembership(organizationId, userId);
  if (!membership || membership.status !== 'active') {
    return fail('NOT_A_MEMBER', 'User is not an active member of this organization');
  }

  // Last-owner protection: cannot demote the last owner
  if (membership.role === 'owner' && newRole !== 'owner') {
    const ownerCount = await countActiveOwners(organizationId);
    if (ownerCount <= 1) {
      return fail(
        'CANNOT_DEMOTE_LAST_OWNER',
        'Cannot demote the last owner of an organization. Assign another owner first.'
      );
    }
  }

  // Update the role
  const rows = await sql`
    UPDATE organization_members
    SET role = ${newRole}
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
    RETURNING *
  `;

  // Compatibility: sync users.org_role if this is the user's legacy org
  await sql`
    UPDATE users SET org_role = ${newRole}
    WHERE id = ${userId} AND org_id = ${organizationId}
  `;

  return ok(mapMembership(rows[0]));
}

/**
 * Suspend a member (set status to 'suspended').
 *
 * Enforces last-owner protection: if suspending the last active owner,
 * returns CANNOT_SUSPEND_LAST_OWNER.
 *
 * @param organizationId  The org.
 * @param userId           The user to suspend.
 * @param suspendedBy      The user ID of the suspender.
 */
export async function suspendMember(
  organizationId: string,
  userId: string,
  suspendedBy: string
): Promise<MembershipResult<OrganizationMembership>> {
  const guard = assertMembershipWritesEnabled();
  if (guard) return guard;

  if (!isValidUUID(organizationId) || !isValidUUID(userId)) {
    return fail('NOT_FOUND', 'Invalid organization or user ID');
  }
  if (userId === suspendedBy) {
    return fail('SELF_TARGET', 'Cannot suspend yourself');
  }

  const sql = await getDbReady();

  const membership = await getMembership(organizationId, userId);
  if (!membership || membership.status !== 'active') {
    return fail('NOT_A_MEMBER', 'User is not an active member of this organization');
  }

  // Last-owner protection
  if (membership.role === 'owner') {
    const ownerCount = await countActiveOwners(organizationId);
    if (ownerCount <= 1) {
      return fail(
        'CANNOT_SUSPEND_LAST_OWNER',
        'Cannot suspend the last owner of an organization. Assign another owner first.'
      );
    }
  }

  const now = new Date().toISOString();
  const rows = await sql`
    UPDATE organization_members
    SET status = 'suspended', suspended_at = ${now}, suspended_by = ${suspendedBy}
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
    RETURNING *
  `;

  // Invalidate the active org context if this org was the user's active
  // context. A suspended member should not continue operating in the org's
  // context. The next resolution will fall back to another active membership.
  try {
    await sql`
      DELETE FROM active_organization_context
      WHERE user_id = ${userId}
        AND organization_id = ${organizationId}
    `;
  } catch {
    // Best-effort: active context cleanup should not block the suspension
  }

  return ok(mapMembership(rows[0]));
}

/**
 * Reactivate a suspended member (set status back to 'active').
 */
export async function reactivateMember(
  organizationId: string,
  userId: string
): Promise<MembershipResult<OrganizationMembership>> {
  const guard = assertMembershipWritesEnabled();
  if (guard) return guard;

  if (!isValidUUID(organizationId) || !isValidUUID(userId)) {
    return fail('NOT_FOUND', 'Invalid organization or user ID');
  }

  const sql = await getDbReady();

  const membership = await getMembership(organizationId, userId);
  if (!membership) {
    return fail('NOT_A_MEMBER', 'User is not a member of this organization');
  }
  if (membership.status !== 'suspended') {
    return fail('NOT_A_MEMBER', 'User is not suspended');
  }

  const rows = await sql`
    UPDATE organization_members
    SET status = 'active', suspended_at = NULL, suspended_by = NULL
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
    RETURNING *
  `;

  return ok(mapMembership(rows[0]));
}

// ============================================================================
// Compatibility Layer
// ============================================================================

/**
 * Sync users.org_id to match the user's "primary" membership.
 *
 * The primary membership is determined as:
 *   1. The user's active membership with the highest role (owner > admin > member > viewer).
 *   2. If multiple memberships have the same role, the earliest created one.
 *   3. If no active memberships, set org_id to NULL.
 *
 * This is called after membership changes to keep the legacy pointer
 * consistent for code paths that haven't migrated to the new model.
 *
 * This operation is NOT feature-flagged — it's a compatibility sync that
 * should run regardless of whether the new write path is enabled, because
 * it's keeping the legacy pointer consistent with reality.
 */
export async function syncLegacyOrgId(
  sql: SqlExecutor,
  userId: string
): Promise<void> {
  if (!isValidUUID(userId)) return;

  // Find the user's primary membership (highest role, earliest created)
  const rows = await sql`
    SELECT organization_id, role
    FROM organization_members
    WHERE user_id = ${userId}
      AND status = 'active'
    ORDER BY
      CASE role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'member' THEN 2
        WHEN 'viewer' THEN 3
      END,
      created_at ASC
    LIMIT 1
  `;

  if (rows.length === 0) {
    // No active memberships — clear the legacy pointer
    await sql`
      UPDATE users SET org_id = NULL, org_role = 'owner'
      WHERE id = ${userId} AND org_id IS NOT NULL
    `;
  } else {
    // Set the legacy pointer to the primary membership
    const primaryOrgId = rows[0].organization_id;
    const primaryRole = rows[0].role;
    await sql`
      UPDATE users SET org_id = ${primaryOrgId}, org_role = ${primaryRole}
      WHERE id = ${userId}
    `;
  }
}

/**
 * Backfill memberships from users.org_id for a single user.
 *
 * If a user has users.org_id set but no corresponding organization_members
 * row, create one with the role from users.org_role. This is idempotent
 * (ON CONFLICT DO NOTHING) and safe to call multiple times.
 *
 * This is the runtime equivalent of the migration 105 backfill, useful
 * for users who were added through the legacy path after migration.
 */
export async function backfillMembershipForUser(
  userId: string
): Promise<MembershipResult<OrganizationMembership | null>> {
  if (!isValidUUID(userId)) {
    return fail('NOT_FOUND', 'Invalid user ID');
  }

  const sql = await getDbReady();

  // Get the user's legacy org_id and org_role
  const userRows = await sql`
    SELECT org_id, org_role FROM users WHERE id = ${userId} LIMIT 1
  `;
  if (userRows.length === 0) {
    return fail('NOT_FOUND', 'User not found');
  }

  const orgId = userRows[0].org_id;
  if (!orgId) {
    // No legacy org_id — nothing to backfill
    return ok(null);
  }

  // Check if a membership already exists
  const existing = await getMembership(String(orgId), userId);
  if (existing) {
    // Already has a membership — nothing to do
    return ok(existing);
  }

  // Determine role from legacy org_role (default to 'member' for unexpected values)
  const legacyRole = userRows[0].org_role;
  const role: OrgRole = legacyRole === 'owner' ? 'owner' : 'member';

  // Create the membership
  const now = new Date().toISOString();
  const rows = await sql`
    INSERT INTO organization_members
      (organization_id, user_id, role, status, accepted_at, joined_at, created_at, updated_at)
    VALUES
      (${orgId}, ${userId}, ${role}, 'active', ${now}, ${now}, ${now}, ${now})
    ON CONFLICT (organization_id, user_id) DO NOTHING
    RETURNING *
  `;

  return ok(rows.length > 0 ? mapMembership(rows[0]) : null);
}

// ============================================================================
// Organization Lifecycle Helpers
// ============================================================================

/**
 * Create an organization and add the creator as the first owner.
 *
 * This is the canonical org creation path when the authority model is
 * enabled. It creates the org row AND the owner membership in a single
 * logical operation (though Neon doesn't support multi-statement
 * transactions via the HTTP driver, the operations are ordered so
 * that the membership is only created if the org succeeds).
 *
 * Also sets users.org_id for backward compatibility.
 */
export async function createOrganizationWithOwner(
  name: string,
  ownerId: string,
  plan: string = 'contractor'
): Promise<MembershipResult<{ organization: { id: string; name: string }; membership: OrganizationMembership }>> {
  const guard = assertMembershipWritesEnabled();
  if (guard) return guard;

  if (!name?.trim()) {
    return fail('NOT_FOUND', 'Organization name is required');
  }
  if (!isValidUUID(ownerId)) {
    return fail('NOT_FOUND', 'Invalid owner ID');
  }

  const sql = await getDbReady();

  // Create the org
  const orgRows = await sql`
    INSERT INTO organizations (name, owner_id, plan)
    VALUES (${name.trim()}, ${ownerId}, ${plan})
    RETURNING id, name
  `;
  const org = orgRows[0];

  // Add the owner membership
  const now = new Date().toISOString();
  const memberRows = await sql`
    INSERT INTO organization_members
      (organization_id, user_id, role, status, accepted_at, joined_at, created_at, updated_at)
    VALUES
      (${org.id}, ${ownerId}, 'owner', 'active', ${now}, ${now}, ${now}, ${now})
    RETURNING *
  `;

  // Sync legacy pointer
  await sql`
    UPDATE users SET org_id = ${org.id}, org_role = 'owner'
    WHERE id = ${ownerId}
  `;

  return ok({
    organization: { id: String(org.id), name: String(org.name) },
    membership: mapMembership(memberRows[0]),
  });
}
