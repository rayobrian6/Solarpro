/**
 * lib/organizations/types.ts
 *
 * Phase 1B — Organization Authority Foundation
 *
 * Canonical type definitions for the organization authority model.
 * These types are the SINGLE SOURCE OF TRUTH for all organization-related
 * data structures in the application.
 *
 * Key design decisions:
 *   - Organization roles (owner/admin/member/viewer) are SEPARATE from
 *     platform roles (admin/super_admin). A user's platform role grants
 *     cross-tenant administrative access; an org role grants scoped
 *     access within a single organization.
 *   - Memberships are many-to-many: a user may belong to multiple orgs,
 *     each with its own role.
 *   - The active org context is server-authoritative — never stored in
 *     the JWT. The server resolves the active org from the
 *     active_organization_context table on each request.
 */

// ============================================================================
// Organization Roles
// ============================================================================

/**
 * The four organization-level roles, ordered by privilege (highest first).
 *
 *   owner   — full control, including deletion and role assignment. There
 *             must always be at least one active owner per org (last-owner
 *             protection). The org creator is automatically the first owner.
 *
 *   admin   — manage members (invite, remove, change roles except owner),
 *             manage org settings, view all org resources. Cannot delete
 *             the org or assign/remove owners.
 *
 *   member  — standard access: create and manage own resources within the
 *             org, view shared org resources.
 *
 *   viewer  — read-only access to org resources. Cannot create or modify
 *             anything.
 *
 * These roles are enforced by a CHECK constraint in migration 105.
 */
export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

/**
 * All valid organization roles, in privilege order (highest first).
 * Used for role comparison and validation.
 */
export const ORG_ROLES: readonly OrgRole[] = ['owner', 'admin', 'member', 'viewer'] as const;

/**
 * Membership status lifecycle:
 *
 *   active    — full membership, the role applies.
 *   invited   — pending acceptance (the user has been invited but has not
 *               yet joined). Replaces some org_invites use cases.
 *   suspended — temporarily disabled by an admin. The row is retained for
 *               audit; the user cannot access the org while suspended.
 */
export type MembershipStatus = 'active' | 'invited' | 'suspended';

export const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = ['active', 'invited', 'suspended'] as const;

/**
 * Organization lifecycle status:
 *
 *   active    — normal operating state.
 *   suspended — billing or admin action has paused the org. Members are
 *               effectively read-only while suspended.
 *   deleted   — soft-delete marker. The row is retained for audit trail
 *               integrity; the org is not visible or usable.
 */
export type OrgStatus = 'active' | 'suspended' | 'deleted';

export const ORG_STATUSES: readonly OrgStatus[] = ['active', 'suspended', 'deleted'] as const;

/**
 * Who set the active organization context:
 *
 *   user    — the user explicitly switched their active org.
 *   system  — an administrative or system process set it.
 *   default — the system defaulted the active org (e.g. the user's only
 *             org, or their primary membership).
 */
export type ActiveOrgSetBy = 'user' | 'system' | 'default';

// ============================================================================
// Domain Entities
// ============================================================================

/**
 * A membership row in the organization_members table.
 * Represents a user's relationship with a single organization.
 */
export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  status: MembershipStatus;
  invitedBy: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
  suspendedAt: string | null;
  suspendedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * An organization with its lifecycle columns.
 */
export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  plan: string;
  status: OrgStatus;
  suspendedAt: string | null;
  deletedAt: string | null;
  slug: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * The server-authoritative active org context for a user.
 * At most one row per user (enforced by UNIQUE constraint).
 */
export interface ActiveOrgContext {
  id: string;
  userId: string;
  organizationId: string;
  setAt: string;
  setBy: ActiveOrgSetBy;
}

/**
 * A membership enriched with user details for display purposes.
 */
export interface MembershipWithUser extends OrganizationMembership {
  userName: string;
  userEmail: string;
}

/**
 * A membership enriched with organization details.
 */
export interface MembershipWithOrg extends OrganizationMembership {
  orgName: string;
  orgStatus: OrgStatus;
}

// ============================================================================
// Service Result Types
// ============================================================================

/**
 * Generic result wrapper for membership operations.
 * Uses a discriminated union so callers can safely narrow the outcome.
 */
export type MembershipResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: MembershipError };

/**
 * Error categories for membership operations.
 * Each category maps to a specific HTTP status in the API layer.
 */
export type MembershipError =
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'ALREADY_MEMBER'; message: string }
  | { code: 'NOT_A_MEMBER'; message: string }
  | { code: 'INVALID_ROLE'; message: string }
  | { code: 'LAST_OWNER'; message: string }
  | { code: 'CANNOT_DEMOTE_LAST_OWNER'; message: string }
  | { code: 'CANNOT_SUSPEND_LAST_OWNER'; message: string }
  | { code: 'CANNOT_REMOVE_LAST_OWNER'; message: string }
  | { code: 'INSUFFICIENT_PERMISSIONS'; message: string }
  | { code: 'ORG_NOT_ACTIVE'; message: string }
  | { code: 'ORG_SUSPENDED'; message: string }
  | { code: 'MEMBER_SUSPENDED'; message: string }
  | { code: 'SELF_TARGET'; message: string }
  | { code: 'DATABASE_ERROR'; message: string };

// ============================================================================
// Feature Flags
// ============================================================================

/**
 * Feature flags controlling the enterprise organization authority rollout.
 *
 * ALL FLAGS DEFAULT TO FALSE. This ensures that the new authority model is
 * completely inert until explicitly enabled. Legacy behavior (users.org_id
 * 1:1 model) remains the active path when flags are off.
 *
 * Flags are read from environment variables at runtime. The naming
 * convention is ENTERPRISE_*_ENABLED.
 *
 *   ENTERPRISE_ORG_AUTHORITY_ENABLED
 *     Master switch. When false, all org-authority code paths fall back
 *     to legacy behavior. When true, the canonical org model is used.
 *
 *   ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED
 *     When true, membership writes (add/remove/role changes) go through
 *     the new organization_members table. When false, writes use the
 *     legacy users.org_id path.
 *
 *   ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED
 *     When true, the server resolves the active org from
 *     active_organization_context. When false, the active org is
 *     users.org_id (legacy 1:1).
 *
 *   ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED
 *     When true, authorization checks are enforced (deny by default).
 *     When false, authorization is advisory only (logged but not enforced).
 */
export type OrgFeatureFlag =
  | 'ENTERPRISE_ORG_AUTHORITY_ENABLED'
  | 'ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED'
  | 'ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED'
  | 'ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED';

/**
 * Read a feature flag from the environment. All flags default to false
 * (fail-closed: new behavior is opt-in, not opt-out).
 *
 * The value is considered enabled if the env var is set to 'true'
 * (case-insensitive). Any other value, including unset, is false.
 */
export function isOrgFeatureEnabled(flag: OrgFeatureFlag): boolean {
  const value = process.env[flag];
  return value !== undefined && value.toLowerCase() === 'true';
}

/**
 * Convenience: the master switch. When this is false, all org-authority
 * code should fall back to legacy behavior regardless of other flags.
 */
export function isOrgAuthorityEnabled(): boolean {
  return isOrgFeatureEnabled('ENTERPRISE_ORG_AUTHORITY_ENABLED');
}

// ============================================================================
// Role Utilities
// ============================================================================

/**
 * Check if a role string is a valid OrgRole.
 */
export function isValidOrgRole(role: string): role is OrgRole {
  return ORG_ROLES.includes(role as OrgRole);
}

/**
 * Check if a status string is a valid MembershipStatus.
 */
export function isValidMembershipStatus(status: string): status is MembershipStatus {
  return MEMBERSHIP_STATUSES.includes(status as MembershipStatus);
}

/**
 * Compare two roles by privilege level.
 * Returns: positive if a > b, negative if a < b, 0 if equal.
 *
 *   owner(0) > admin(1) > member(2) > viewer(3)
 *
 * Lower index = higher privilege.
 */
export function compareRoles(a: OrgRole, b: OrgRole): number {
  const ai = ORG_ROLES.indexOf(a);
  const bi = ORG_ROLES.indexOf(b);
  return ai - bi;
}

/**
 * Check if role a has equal or higher privilege than role b.
 */
export function roleAtLeast(a: OrgRole, b: OrgRole): boolean {
  return compareRoles(a, b) <= 0;
}

/**
 * Check if a role can manage another role.
 *
 * An owner can manage all roles (including other owners, though
 * last-owner protection applies).
 * An admin can manage members and viewers, but NOT owners or other admins.
 * Members and viewers cannot manage anyone.
 */
export function canManageRole(actorRole: OrgRole, targetRole: OrgRole): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole === 'member' || targetRole === 'viewer';
  return false;
}
