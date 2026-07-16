/**
 * lib/organizations/context.ts
 *
 * Phase 1B — Organization Authority Foundation
 * Commit 4: Active Organization Context
 *
 * Server-authoritative active organization context resolution.
 *
 * DESIGN:
 *   When a user belongs to multiple organizations, exactly one is "active"
 *   at any given time. The active org determines which org's resources the
 *   user is currently operating on.
 *
 *   The active org is NEVER stored in the JWT (which contains only identity:
 *   id, name, email, company). Instead, the server resolves the active org
 *   from the active_organization_context table on each request that needs
 *   org context.
 *
 * RESOLUTION ORDER:
 *   1. If ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED is true:
 *      a. Check active_organization_context for an explicit row.
 *      b. If found and the org is active and the user is still an active
 *         member, use it.
 *      c. If not found (or invalid), fall back to the user's primary
 *         membership (highest-role, earliest-created active membership).
 *      d. If no memberships at all, return null.
 *
 *   2. If ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED is false (legacy):
 *      a. Use users.org_id (the 1:1 legacy model).
 *      b. If null, return null.
 *
 * This ensures the active org is always server-resolved, never trusted
 * from client input alone. Client requests may SUGGEST an org switch,
 * but the server validates membership before accepting it.
 */

import { getDbReady } from '@/lib/db-neon';
import { isValidUUID } from '@/lib/db-neon';
import {
  type OrgRole,
  type ActiveOrgSetBy,
  type ActiveOrgContext,
  isOrgFeatureEnabled,
  isOrgAuthorityEnabled,
} from './types';
import { getMembership, getMembershipsWithOrgByUser } from './memberships';

// ============================================================================
// Types
// ============================================================================

/**
 * The resolved active org context for a user.
 * This is the result of the full resolution algorithm.
 */
export interface ResolvedActiveOrg {
  /** The active organization ID (null if the user has no orgs). */
  organizationId: string | null;
  /** The user's role in the active org (null if no org). */
  role: OrgRole | null;
  /** How the active org was determined. */
  source: 'explicit' | 'primary' | 'legacy' | 'none';
  /** The organization name (for convenience, null if no org). */
  orgName: string | null;
}

// ============================================================================
// Row Mapper
// ============================================================================

function mapActiveOrgContext(row: Record<string, unknown>): ActiveOrgContext {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    organizationId: String(row.organization_id),
    setAt: String(row.set_at),
    setBy: row.set_by as ActiveOrgSetBy,
  };
}

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get the user's explicit active org context row (if any).
 * This reads directly from active_organization_context.
 * Returns null if no row exists.
 */
export async function getActiveOrgContextRow(
  userId: string
): Promise<ActiveOrgContext | null> {
  if (!isValidUUID(userId)) return null;

  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM active_organization_context
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return rows.length > 0 ? mapActiveOrgContext(rows[0]) : null;
}

// ============================================================================
// Write Operations (feature-flagged)
// ============================================================================

/**
 * Set the active organization for a user.
 *
 * This is the canonical way to switch orgs. The server validates that:
 *   1. The user is an active member of the target org.
 *   2. The target org is in 'active' status (not suspended/archived/deleted).
 *
 * If the user already has an active org context row, it is updated (UPSERT).
 * If not, a new row is inserted.
 *
 * When ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED is false, this is a no-op
 * (the legacy model uses users.org_id, which is managed by the
 * membership compatibility layer).
 *
 * @param userId         The user whose active org to set.
 * @param organizationId The org to set as active.
 * @param setBy          Who initiated the switch (default 'user').
 * @returns              Success or error result.
 */
export async function setActiveOrg(
  userId: string,
  organizationId: string,
  setBy: ActiveOrgSetBy = 'user'
): Promise<
  | { ok: true; context: ActiveOrgContext }
  | { ok: false; error: 'NOT_A_MEMBER' | 'ORG_NOT_ACTIVE' | 'INVALID_ID' | 'FEATURE_DISABLED' }
> {
  if (!isOrgFeatureEnabled('ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED')) {
    return { ok: false, error: 'FEATURE_DISABLED' };
  }

  if (!isValidUUID(userId) || !isValidUUID(organizationId)) {
    return { ok: false, error: 'INVALID_ID' };
  }

  const sql = await getDbReady();

  // Validate that the user is an active member of the target org
  const membership = await getMembership(organizationId, userId);
  if (!membership || membership.status !== 'active') {
    return { ok: false, error: 'NOT_A_MEMBER' };
  }

  // Validate that the org is active
  const orgRows = await sql`
    SELECT status FROM organizations WHERE id = ${organizationId} LIMIT 1
  `;
  if (orgRows.length === 0 || orgRows[0].status !== 'active') {
    return { ok: false, error: 'ORG_NOT_ACTIVE' };
  }

  // UPSERT the active org context
  // The UNIQUE(user_id) constraint ensures only one row per user.
  // We use INSERT ... ON CONFLICT (user_id) DO UPDATE.
  const rows = await sql`
    INSERT INTO active_organization_context (user_id, organization_id, set_at, set_by)
    VALUES (${userId}, ${organizationId}, now(), ${setBy})
    ON CONFLICT (user_id) DO UPDATE
    SET organization_id = ${organizationId},
        set_at = now(),
        set_by = ${setBy}
    RETURNING *
  `;

  return { ok: true, context: mapActiveOrgContext(rows[0]) };
}

/**
 * Clear the active org context for a user (remove the explicit row).
 *
 * After clearing, the active org will fall back to the user's primary
 * membership on next resolution.
 *
 * When ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED is false, this is a no-op.
 */
export async function clearActiveOrg(
  userId: string
): Promise<{ ok: true } | { ok: false; error: 'FEATURE_DISABLED' | 'INVALID_ID' }> {
  if (!isOrgFeatureEnabled('ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED')) {
    return { ok: false, error: 'FEATURE_DISABLED' };
  }

  if (!isValidUUID(userId)) {
    return { ok: false, error: 'INVALID_ID' };
  }

  const sql = await getDbReady();
  await sql`
    DELETE FROM active_organization_context
    WHERE user_id = ${userId}
  `;

  return { ok: true };
}

/**
 * Set the default active org for a user (set_by = 'default').
 *
 * This is called by the system when a user has no explicit active org
 * and we need to pick one for them. It uses the same validation as
 * setActiveOrg but marks the source as 'default'.
 */
export async function setDefaultActiveOrg(
  userId: string,
  organizationId: string
): Promise<
  | { ok: true; context: ActiveOrgContext }
  | { ok: false; error: 'NOT_A_MEMBER' | 'ORG_NOT_ACTIVE' | 'INVALID_ID' | 'FEATURE_DISABLED' }
> {
  return setActiveOrg(userId, organizationId, 'default');
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Resolve the active organization for a user.
 *
 * This is the main entry point for any code that needs to know "which org
 * is this user currently operating in?"
 *
 * Resolution algorithm:
 *   1. If ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED:
 *      a. Check explicit active_organization_context row.
 *      b. Validate: user is still an active member, org is still active.
 *      c. If valid, return it (source: 'explicit').
 *      d. If invalid or missing, fall back to primary membership.
 *      e. If primary membership found, optionally set it as default
 *         context, and return it (source: 'primary').
 *      f. If no memberships, return null (source: 'none').
 *
 *   2. If ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED is false (legacy):
 *      a. Read users.org_id from the users table.
 *      b. Return it (source: 'legacy').
 *      c. If null, return null (source: 'none').
 *
 * @param userId  The user whose active org to resolve.
 * @returns       The resolved active org context.
 */
export async function resolveActiveOrg(
  userId: string
): Promise<ResolvedActiveOrg> {
  if (!isValidUUID(userId)) {
    return { organizationId: null, role: null, source: 'none', orgName: null };
  }

  // ── New path: active_organization_context ──
  if (isOrgFeatureEnabled('ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED')) {
    return resolveActiveOrgNew(userId);
  }

  // ── Legacy path: users.org_id ──
  return resolveActiveOrgLegacy(userId);
}

/**
 * New-path resolution: use active_organization_context with fallback.
 */
async function resolveActiveOrgNew(
  userId: string
): Promise<ResolvedActiveOrg> {
  const sql = await getDbReady();

  // Step 1: Check explicit active org context
  const contextRow = await getActiveOrgContextRow(userId);

  if (contextRow) {
    // Validate: is the user still an active member of this org?
    const membership = await getMembership(contextRow.organizationId, userId);
    if (membership && membership.status === 'active') {
      // Validate: is the org still active?
      const orgRows = await sql`
        SELECT name, status FROM organizations
        WHERE id = ${contextRow.organizationId}
        LIMIT 1
      `;
      if (orgRows.length > 0 && orgRows[0].status === 'active') {
        return {
          organizationId: contextRow.organizationId,
          role: membership.role,
          source: 'explicit',
          orgName: String(orgRows[0].name),
        };
      }
    }
    // The explicit context is stale (user left the org, or org was
    // suspended/archived/deleted). Clean it up and fall through to primary
    // membership resolution.
    await clearActiveOrg(userId).catch(() => {
      // Best-effort cleanup — don't fail resolution if this errors
    });
  }

  // Step 2: Fall back to primary membership
  const memberships = await getMembershipsWithOrgByUser(userId);
  if (memberships.length === 0) {
    return { organizationId: null, role: null, source: 'none', orgName: null };
  }

  // Sort by role priority (owner > admin > member > viewer), then by created_at
  const roleOrder: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
  memberships.sort((a, b) => {
    const roleDiff = roleOrder[a.role] - roleOrder[b.role];
    if (roleDiff !== 0) return roleDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const primary = memberships[0];

  // Optionally set this as the default context (so future resolutions
  // are faster and the source is 'explicit'). This is best-effort.
  await setDefaultActiveOrg(userId, primary.organizationId).catch(() => {
    // Best-effort — don't fail resolution if we can't set the default
  });

  return {
    organizationId: primary.organizationId,
    role: primary.role,
    source: 'primary',
    orgName: primary.orgName,
  };
}

/**
 * Legacy-path resolution: use users.org_id.
 */
async function resolveActiveOrgLegacy(
  userId: string
): Promise<ResolvedActiveOrg> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT u.org_id, u.org_role, o.name AS org_name, o.status AS org_status
    FROM users u
    LEFT JOIN organizations o ON o.id = u.org_id
    WHERE u.id = ${userId}
    LIMIT 1
  `;

  if (rows.length === 0 || !rows[0].org_id) {
    return { organizationId: null, role: null, source: 'none', orgName: null };
  }

  // In legacy mode, if the org is not active, treat as no org
  if (rows[0].org_status && rows[0].org_status !== 'active') {
    return { organizationId: null, role: null, source: 'none', orgName: null };
  }

  const role: OrgRole = (() => {
    const r = rows[0].org_role;
    if (r === 'owner' || r === 'admin' || r === 'member' || r === 'viewer') {
      return r as OrgRole;
    }
    return 'member';
  })();

  return {
    organizationId: String(rows[0].org_id),
    role,
    source: 'legacy',
    orgName: rows[0].org_name ? String(rows[0].org_name) : null,
  };
}

// ============================================================================
// Convenience: Active Org With Membership Validation
// ============================================================================

/**
 * Resolve the active org and validate that the user has at least the
 * specified minimum role.
 *
 * This is the convenience function for route handlers that need to check
 * "is the user acting in an org where they have at least X role?"
 *
 * @param userId    The user.
 * @param minRole   The minimum role required.
 * @returns         The resolved active org if the user has sufficient role,
 *                  or null if no org or insufficient role.
 */
export async function resolveActiveOrgWithRole(
  userId: string,
  minRole: OrgRole
): Promise<ResolvedActiveOrg | null> {
  const resolved = await resolveActiveOrg(userId);
  if (!resolved.organizationId || !resolved.role) return null;

  const roleOrder: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
  if (roleOrder[resolved.role] > roleOrder[minRole]) {
    return null;
  }

  return resolved;
}

/**
 * Resolve the active org for a user, using the authority-enabled path
 * regardless of the feature flag. This is for internal/admin contexts
 * that should always use the canonical model.
 *
 * Falls back to legacy if the new path returns no org.
 */
export async function resolveActiveOrgCanonical(
  userId: string
): Promise<ResolvedActiveOrg> {
  if (!isValidUUID(userId)) {
    return { organizationId: null, role: null, source: 'none', orgName: null };
  }

  // Try the new path first
  const resolved = await resolveActiveOrgNew(userId);
  if (resolved.organizationId) return resolved;

  // Fall back to legacy if the new path found nothing
  return resolveActiveOrgLegacy(userId);
}

// ============================================================================
// Re-exports
// ============================================================================

export type { ActiveOrgContext, ActiveOrgSetBy, OrgRole } from './types';
