/**
 * lib/organizations/permissions.ts
 *
 * Phase 1B — Organization Authority Foundation
 * Commit 5: Permission and Authorization Foundation
 *
 * Organization permission definitions and the role-based permission matrix.
 *
 * This module defines WHAT actions exist and WHICH roles can perform them.
 * The authorization.ts module defines HOW to check and enforce them.
 *
 * DESIGN:
 *   - Default-deny: any action not explicitly granted is denied.
 *   - Role-based: permissions are granted by role, not per-user.
 *   - Org-scoped: permissions apply within a single organization context.
 *   - Platform roles (admin/super_admin) are handled separately — they
 *     grant cross-tenant administrative access and are checked in
 *     authorization.ts, not here.
 *
 * The permission matrix is a static, declarative structure. It's the
 * single source of truth for "what can each org role do?" Changing
 * a permission requires changing this matrix, not scattering checks
 * across the codebase.
 */

import { type OrgRole, ORG_ROLES, canManageRole } from './types';

// ============================================================================
// Permission Actions
// ============================================================================

/**
 * Organization-scoped actions that can be permission-checked.
 *
 * Each action is a granular operation within an organization context.
 * The permission matrix maps each action to the minimum role required.
 */
export type OrgAction =
  // Organization management
  | 'org:view'              // View the organization and its members
  | 'org:edit_settings'     // Edit org name, slug, settings
  | 'org:delete'            // Delete (soft-delete) the organization
  | 'org:view_members'      // View the member list
  | 'org:view_billing'      // View billing/subscription info

  // Member management
  | 'member:invite'         // Invite a new member
  | 'member:remove'         // Remove a member
  | 'member:change_role'    // Change a member's role
  | 'member:suspend'        // Suspend a member
  | 'member:reactivate'     // Reactivate a suspended member
  | 'member:view'           // View a specific member's details

  // Resource operations (project-level, scoped to org)
  | 'resource:create'       // Create a resource (project, proposal, etc.)
  | 'resource:read'         // Read/view resources
  | 'resource:update'       // Update resources
  | 'resource:delete'       // Delete resources
  | 'resource:share'        // Share resources within the org

  // Active org context
  | 'context:switch'        // Switch active org (if multi-org)
  | 'context:set_default';  // Set default active org for another user (admin)

/**
 * All organization actions, for iteration and validation.
 */
export const ORG_ACTIONS: readonly OrgAction[] = [
  'org:view',
  'org:edit_settings',
  'org:delete',
  'org:view_members',
  'org:view_billing',
  'member:invite',
  'member:remove',
  'member:change_role',
  'member:suspend',
  'member:reactivate',
  'member:view',
  'resource:create',
  'resource:read',
  'resource:update',
  'resource:delete',
  'resource:share',
  'context:switch',
  'context:set_default',
] as const;

// ============================================================================
// Permission Matrix
// ============================================================================

/**
 * The role-based permission matrix.
 *
 * Maps each action to the minimum role required to perform it.
 * A user with role R can perform action A if:
 *   compareRoles(R, matrix[A]) <= 0
 * i.e., R is at least as privileged as the required role.
 *
 * DEFAULT-DENY: Any action not in this matrix is denied to all org roles.
 */
export const PERMISSION_MATRIX: Readonly<Record<OrgAction, OrgRole>> = Object.freeze({
  // Organization management — owner-only for destructive ops
  'org:view':           'viewer',    // All members can see the org
  'org:edit_settings':  'owner',     // Only owners can edit settings
  'org:delete':         'owner',     // Only owners can delete
  'org:view_members':   'member',    // Members+ can see the member list
  'org:view_billing':   'owner',     // Only owners can see billing

  // Member management — admins can manage non-owners
  'member:invite':      'admin',     // Admins+ can invite
  'member:remove':      'admin',     // Admins+ can remove (non-owners)
  'member:change_role': 'admin',     // Admins+ can change roles (non-owners)
  'member:suspend':     'admin',     // Admins+ can suspend (non-owners)
  'member:reactivate':  'admin',     // Admins+ can reactivate
  'member:view':        'member',    // Members+ can view member details

  // Resource operations — members can create/manage, viewers read-only
  'resource:create':    'member',    // Members+ can create resources
  'resource:read':      'viewer',    // All members can read
  'resource:update':    'member',    // Members+ can update
  'resource:delete':    'member',    // Members+ can delete
  'resource:share':     'admin',     // Admins+ can share resources

  // Active org context — users can switch their own, admins can set defaults
  'context:switch':       'viewer',  // All members can switch their own active org
  'context:set_default':  'admin',   // Admins+ can set defaults for others
});

// ============================================================================
// Permission Check (Static, Role-Only)
// ============================================================================

/**
 * Check if a role grants permission for an action.
 *
 * This is the STATIC check — it only considers the role, not the
 * specific user or organization context. Use the authorization module
 * (authorization.ts) for full context-aware checks.
 *
 * DEFAULT-DENY: If the action is not in the permission matrix, returns false.
 *
 * @param role    The user's org role.
 * @param action  The action to check.
 * @returns       true if the role grants the action, false otherwise.
 */
export function roleCanPerform(role: OrgRole, action: OrgAction): boolean {
  const requiredRole = PERMISSION_MATRIX[action];
  if (!requiredRole) return false; // Default-deny

  // The role must be at least as privileged as the required role
  return canManageRole(role, requiredRole) || role === requiredRole;
}

/**
 * Get the minimum role required for an action.
 * Returns null if the action is not in the permission matrix (default-deny).
 */
export function getRequiredRole(action: OrgAction): OrgRole | null {
  return PERMISSION_MATRIX[action] ?? null;
}

/**
 * Check if an action exists in the permission matrix.
 */
export function isKnownAction(action: string): action is OrgAction {
  return ORG_ACTIONS.includes(action as OrgAction);
}

/**
 * Get all actions that a role can perform.
 * Useful for UI rendering (show/hide buttons based on permissions).
 */
export function getActionsForRole(role: OrgRole): OrgAction[] {
  return ORG_ACTIONS.filter((action) => roleCanPerform(role, action));
}

// ============================================================================
// Role Hierarchy Helpers
// ============================================================================

/**
 * Get the privilege level of a role (0 = highest, 3 = lowest).
 */
export function getRoleLevel(role: OrgRole): number {
  return ORG_ROLES.indexOf(role);
}

/**
 * Check if a role can be assigned to a member by an actor.
 *
 * Owners can assign any role (including owner).
 * Admins can assign member and viewer roles only.
 * Members and viewers cannot assign roles.
 */
export function canAssignRole(actorRole: OrgRole, targetRole: OrgRole): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole === 'member' || targetRole === 'viewer';
  return false;
}

/**
 * Get all roles that an actor can assign.
 */
export function getAssignableRoles(actorRole: OrgRole): OrgRole[] {
  if (actorRole === 'owner') return [...ORG_ROLES];
  if (actorRole === 'admin') return ['member', 'viewer'];
  return [];
}
