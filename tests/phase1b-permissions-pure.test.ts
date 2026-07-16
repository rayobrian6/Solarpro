/**
 * tests/phase1b-permissions-pure.test.ts
 *
 * Phase 1B — Organization Authority Foundation
 * Commit 8: Adversarial Tests and Integration Validation
 *
 * Pure unit tests for the permission matrix and role hierarchy helpers.
 * These tests require NO database — they exercise the deterministic,
 * side-effect-free functions in lib/organizations/permissions.ts and
 * lib/organizations/types.ts.
 *
 * Coverage areas:
 *   1. Permission matrix correctness — every (role, action) pair matches
 *      the documented required-role mapping.
 *   2. Default-deny — unknown actions return false / null.
 *   3. Role hierarchy — canManageRole, getRoleLevel, canAssignRole,
 *      getAssignableRoles behave per the documented hierarchy.
 *   4. Feature flag fail-closed — all four flags default false when
 *      the env var is unset or set to a non-'true' value.
 *   5. Action enumeration — ORG_ACTIONS contains exactly 18 actions.
 *   6. Role enumeration — ORG_ROLES contains exactly 4 roles in order.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ORG_ACTIONS,
  PERMISSION_MATRIX,
  roleCanPerform,
  getRequiredRole,
  isKnownAction,
  getActionsForRole,
  getRoleLevel,
  canAssignRole,
  getAssignableRoles,
  type OrgAction,
} from '@/lib/organizations/permissions';
import {
  ORG_ROLES,
  canManageRole,
  isOrgFeatureEnabled,
  isOrgAuthorityEnabled,
  isValidOrgRole,
  type OrgRole,
  type OrgFeatureFlag,
} from '@/lib/organizations/types';

// ============================================================================
// Helpers
// ============================================================================

const ALL_ROLES: OrgRole[] = ['owner', 'admin', 'member', 'viewer'];

/** Roles at or above a given privilege level (inclusive). */
function rolesAtOrAbove(role: OrgRole): OrgRole[] {
  const threshold = getRoleLevel(role);
  return ALL_ROLES.filter((r) => getRoleLevel(r) <= threshold);
}

/** Roles strictly below a given privilege level. */
function rolesBelow(role: OrgRole): OrgRole[] {
  const threshold = getRoleLevel(role);
  return ALL_ROLES.filter((r) => getRoleLevel(r) > threshold);
}

// ============================================================================
// Role Enumeration
// ============================================================================

describe('ORG_ROLES enumeration', () => {
  it('contains exactly 4 roles in privilege order', () => {
    expect(ORG_ROLES).toEqual(['owner', 'admin', 'member', 'viewer']);
  });
});

describe('getRoleLevel', () => {
  it('returns 0 for owner (highest privilege)', () => {
    expect(getRoleLevel('owner')).toBe(0);
  });

  it('returns 1 for admin', () => {
    expect(getRoleLevel('admin')).toBe(1);
  });

  it('returns 2 for member', () => {
    expect(getRoleLevel('member')).toBe(2);
  });

  it('returns 3 for viewer (lowest privilege)', () => {
    expect(getRoleLevel('viewer')).toBe(3);
  });
});

// ============================================================================
// Role Hierarchy: canManageRole
// ============================================================================

describe('canManageRole', () => {
  it('owner can manage all roles', () => {
    for (const target of ALL_ROLES) {
      expect(canManageRole('owner', target)).toBe(true);
    }
  });

  it('admin can manage member and viewer but not owner or admin', () => {
    expect(canManageRole('admin', 'owner')).toBe(false);
    expect(canManageRole('admin', 'admin')).toBe(false);
    expect(canManageRole('admin', 'member')).toBe(true);
    expect(canManageRole('admin', 'viewer')).toBe(true);
  });

  it('member cannot manage any role', () => {
    for (const target of ALL_ROLES) {
      expect(canManageRole('member', target)).toBe(false);
    }
  });

  it('viewer cannot manage any role', () => {
    for (const target of ALL_ROLES) {
      expect(canManageRole('viewer', target)).toBe(false);
    }
  });
});

// ============================================================================
// Role Assignment Helpers
// ============================================================================

describe('canAssignRole', () => {
  it('owner can assign any role including owner', () => {
    for (const target of ALL_ROLES) {
      expect(canAssignRole('owner', target)).toBe(true);
    }
  });

  it('admin can assign only member and viewer', () => {
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'member')).toBe(true);
    expect(canAssignRole('admin', 'viewer')).toBe(true);
  });

  it('member and viewer cannot assign any role', () => {
    for (const target of ALL_ROLES) {
      expect(canAssignRole('member', target)).toBe(false);
      expect(canAssignRole('viewer', target)).toBe(false);
    }
  });
});

describe('getAssignableRoles', () => {
  it('owner can assign all 4 roles', () => {
    expect(getAssignableRoles('owner')).toEqual(['owner', 'admin', 'member', 'viewer']);
  });

  it('admin can assign member and viewer only', () => {
    expect(getAssignableRoles('admin')).toEqual(['member', 'viewer']);
  });

  it('member and viewer can assign nothing', () => {
    expect(getAssignableRoles('member')).toEqual([]);
    expect(getAssignableRoles('viewer')).toEqual([]);
  });
});

// ============================================================================
// Action Enumeration
// ============================================================================

describe('ORG_ACTIONS enumeration', () => {
  it('contains exactly 18 actions', () => {
    expect(ORG_ACTIONS).toHaveLength(18);
  });

  it('contains all expected action strings', () => {
    const expected: OrgAction[] = [
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
    ];
    expect([...ORG_ACTIONS]).toEqual(expected);
  });
});

// ============================================================================
// Permission Matrix
// ============================================================================

describe('PERMISSION_MATRIX', () => {
  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(PERMISSION_MATRIX)).toBe(true);
  });

  it('maps every action to a required role', () => {
    for (const action of ORG_ACTIONS) {
      const required = PERMISSION_MATRIX[action];
      expect(required).toBeDefined();
      expect(ALL_ROLES).toContain(required);
    }
  });

  it('owner-only actions: edit_settings, delete, view_billing', () => {
    expect(PERMISSION_MATRIX['org:edit_settings']).toBe('owner');
    expect(PERMISSION_MATRIX['org:delete']).toBe('owner');
    expect(PERMISSION_MATRIX['org:view_billing']).toBe('owner');
  });

  it('admin-required actions: invite, remove, change_role, suspend, reactivate, share, set_default', () => {
    expect(PERMISSION_MATRIX['member:invite']).toBe('admin');
    expect(PERMISSION_MATRIX['member:remove']).toBe('admin');
    expect(PERMISSION_MATRIX['member:change_role']).toBe('admin');
    expect(PERMISSION_MATRIX['member:suspend']).toBe('admin');
    expect(PERMISSION_MATRIX['member:reactivate']).toBe('admin');
    expect(PERMISSION_MATRIX['resource:share']).toBe('admin');
    expect(PERMISSION_MATRIX['context:set_default']).toBe('admin');
  });

  it('member-required actions: view_members, member:view, resource:create/update/delete', () => {
    expect(PERMISSION_MATRIX['org:view_members']).toBe('member');
    expect(PERMISSION_MATRIX['member:view']).toBe('member');
    expect(PERMISSION_MATRIX['resource:create']).toBe('member');
    expect(PERMISSION_MATRIX['resource:update']).toBe('member');
    expect(PERMISSION_MATRIX['resource:delete']).toBe('member');
  });

  it('viewer-required actions: org:view, resource:read, context:switch', () => {
    expect(PERMISSION_MATRIX['org:view']).toBe('viewer');
    expect(PERMISSION_MATRIX['resource:read']).toBe('viewer');
    expect(PERMISSION_MATRIX['context:switch']).toBe('viewer');
  });
});

// ============================================================================
// roleCanPerform (Static Permission Check)
// ============================================================================

describe('roleCanPerform', () => {
  it('owner can perform ALL 18 actions', () => {
    for (const action of ORG_ACTIONS) {
      expect(roleCanPerform('owner', action)).toBe(true);
    }
  });

  it('admin can perform all actions except owner-only ones', () => {
    const ownerOnlyActions: OrgAction[] = ['org:edit_settings', 'org:delete', 'org:view_billing'];
    for (const action of ORG_ACTIONS) {
      if (ownerOnlyActions.includes(action)) {
        expect(roleCanPerform('admin', action)).toBe(false);
      } else {
        expect(roleCanPerform('admin', action)).toBe(true);
      }
    }
  });

  it('member can perform viewer-level and member-level actions only', () => {
    const allowedForMember: OrgAction[] = [
      'org:view',
      'org:view_members',
      'member:view',
      'resource:create',
      'resource:read',
      'resource:update',
      'resource:delete',
      'context:switch',
    ];
    for (const action of ORG_ACTIONS) {
      if (allowedForMember.includes(action)) {
        expect(roleCanPerform('member', action)).toBe(true);
      } else {
        expect(roleCanPerform('member', action)).toBe(false);
      }
    }
  });

  it('viewer can only perform viewer-level actions (read-only)', () => {
    const allowedForViewer: OrgAction[] = ['org:view', 'resource:read', 'context:switch'];
    for (const action of ORG_ACTIONS) {
      if (allowedForViewer.includes(action)) {
        expect(roleCanPerform('viewer', action)).toBe(true);
      } else {
        expect(roleCanPerform('viewer', action)).toBe(false);
      }
    }
  });

  it('default-deny: unknown action returns false for all roles', () => {
    const unknownAction = 'org:nuke_everything' as OrgAction;
    for (const role of ALL_ROLES) {
      expect(roleCanPerform(role, unknownAction)).toBe(false);
    }
  });
});

// ============================================================================
// getRequiredRole
// ============================================================================

describe('getRequiredRole', () => {
  it('returns the required role for each known action', () => {
    for (const action of ORG_ACTIONS) {
      const required = getRequiredRole(action);
      expect(required).toBe(PERMISSION_MATRIX[action]);
    }
  });

  it('returns null for unknown actions (default-deny)', () => {
    expect(getRequiredRole('org:nuke_everything' as OrgAction)).toBeNull();
  });
});

// ============================================================================
// isKnownAction
// ============================================================================

describe('isKnownAction', () => {
  it('returns true for all 18 known actions', () => {
    for (const action of ORG_ACTIONS) {
      expect(isKnownAction(action)).toBe(true);
    }
  });

  it('returns false for unknown actions', () => {
    expect(isKnownAction('org:nuke_everything')).toBe(false);
    expect(isKnownAction('')).toBe(false);
    expect(isKnownAction('member:invite ')).toBe(false); // trailing space
    expect(isKnownAction('MEMBER:INVITE')).toBe(false); // case-sensitive
  });
});

// ============================================================================
// getActionsForRole
// ============================================================================

describe('getActionsForRole', () => {
  it('owner gets all 18 actions', () => {
    expect(getActionsForRole('owner')).toHaveLength(18);
  });

  it('admin gets 15 actions (18 minus 3 owner-only)', () => {
    expect(getActionsForRole('admin')).toHaveLength(15);
  });

  it('member gets 8 actions', () => {
    expect(getActionsForRole('member')).toHaveLength(8);
  });

  it('viewer gets 3 actions (read-only)', () => {
    expect(getActionsForRole('viewer')).toHaveLength(3);
  });

  it('viewer actions are exactly the read-only set', () => {
    expect(getActionsForRole('viewer').sort()).toEqual(
      ['context:switch', 'org:view', 'resource:read'].sort()
    );
  });

  it('higher-privileged role actions are a superset of lower-privileged ones', () => {
    const ownerActions = new Set(getActionsForRole('owner'));
    const adminActions = new Set(getActionsForRole('admin'));
    const memberActions = new Set(getActionsForRole('member'));
    const viewerActions = new Set(getActionsForRole('viewer'));

    // owner ⊇ admin ⊇ member ⊇ viewer
    for (const a of adminActions) expect(ownerActions.has(a)).toBe(true);
    for (const a of memberActions) expect(adminActions.has(a)).toBe(true);
    for (const a of viewerActions) expect(memberActions.has(a)).toBe(true);
  });
});

// ============================================================================
// isValidOrgRole
// ============================================================================

describe('isValidOrgRole', () => {
  it('returns true for the 4 known roles', () => {
    for (const role of ALL_ROLES) {
      expect(isValidOrgRole(role)).toBe(true);
    }
  });

  it('returns false for unknown roles', () => {
    expect(isValidOrgRole('superuser')).toBe(false);
    expect(isValidOrgRole('')).toBe(false);
    expect(isValidOrgRole('Owner')).toBe(false); // case-sensitive
    expect(isValidOrgRole('guest')).toBe(false);
  });
});

// ============================================================================
// Feature Flags — Fail-Closed
// ============================================================================

describe('Feature flags default to false (fail-closed)', () => {
  const flags: OrgFeatureFlag[] = [
    'ENTERPRISE_ORG_AUTHORITY_ENABLED',
    'ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED',
    'ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED',
    'ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED',
  ];

  beforeEach(() => {
    // Clear all flags before each test
    for (const flag of flags) {
      delete process.env[flag];
    }
  });

  afterEach(() => {
    // Clean up after each test
    for (const flag of flags) {
      delete process.env[flag];
    }
  });

  it('all 4 flags return false when env vars are unset', () => {
    for (const flag of flags) {
      expect(isOrgFeatureEnabled(flag)).toBe(false);
    }
  });

  it('flag returns false when set to non-"true" values', () => {
    for (const flag of flags) {
      process.env[flag] = 'false';
      expect(isOrgFeatureEnabled(flag)).toBe(false);

      process.env[flag] = '0';
      expect(isOrgFeatureEnabled(flag)).toBe(false);

      process.env[flag] = '';
      expect(isOrgFeatureEnabled(flag)).toBe(false);

      process.env[flag] = 'yes';
      expect(isOrgFeatureEnabled(flag)).toBe(false);

      process.env[flag] = '1';
      expect(isOrgFeatureEnabled(flag)).toBe(false);

      delete process.env[flag];
    }
  });

  it('flag returns true only when set to "true" (case-insensitive)', () => {
    for (const flag of flags) {
      process.env[flag] = 'true';
      expect(isOrgFeatureEnabled(flag)).toBe(true);

      process.env[flag] = 'TRUE';
      expect(isOrgFeatureEnabled(flag)).toBe(true);

      process.env[flag] = 'True';
      expect(isOrgFeatureEnabled(flag)).toBe(true);

      delete process.env[flag];
    }
  });

  it('isOrgAuthorityEnabled returns false by default', () => {
    expect(isOrgAuthorityEnabled()).toBe(false);
  });

  it('isOrgAuthorityEnabled returns true when ENTERPRISE_ORG_AUTHORITY_ENABLED=true', () => {
    process.env.ENTERPRISE_ORG_AUTHORITY_ENABLED = 'true';
    expect(isOrgAuthorityEnabled()).toBe(true);
  });
});
