/**
 * lib/organizations/index.ts
 *
 * Barrel file for the organization authority module.
 * Import from '@/lib/organizations' to access all organization services.
 */

// Types and feature flags
export {
  type OrgRole,
  type MembershipStatus,
  type OrgStatus,
  type ActiveOrgSetBy,
  type OrganizationMembership,
  type Organization,
  type ActiveOrgContext,
  type MembershipWithUser,
  type MembershipWithOrg,
  type MembershipResult,
  type MembershipError,
  type OrgFeatureFlag,
  ORG_ROLES,
  MEMBERSHIP_STATUSES,
  ORG_STATUSES,
  isOrgFeatureEnabled,
  isOrgAuthorityEnabled,
  isValidOrgRole,
  isValidMembershipStatus,
  compareRoles,
  roleAtLeast,
  canManageRole,
} from './types';

// Membership data access
export {
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

// Permission matrix
export {
  type OrgAction,
  ORG_ACTIONS,
  PERMISSION_MATRIX,
  roleCanPerform,
  getRequiredRole,
  isKnownAction,
  getActionsForRole,
  getRoleLevel,
  canAssignRole,
  getAssignableRoles,
} from './permissions';

// Authorization engine
export {
  type AuthzResult,
  type AuthzDenyReason,
  type DeniedAuthzResult,
  type AllowedAuthzResult,
  AuthzError,
  authorize,
  checkOwnerProtection,
  authorizeMemberAction,
  authorizeRoleChange,
  isEnforcementEnabled,
  logAuthzDecision,
  enforceAuthz,
  enforceMemberAction,
  authzReasonToStatusCode,
  quickCheckRole,
  isPlatformAdminUser,
  isSupportElevationActive,
  isOrgAuthzActive,
} from './authorization';

// Active organization context
export {
  type ResolvedActiveOrg,
  getActiveOrgContextRow,
  setActiveOrg,
  clearActiveOrg,
  setDefaultActiveOrg,
  resolveActiveOrg,
  resolveActiveOrgWithRole,
  resolveActiveOrgCanonical,
} from './context';

// High-level service
export {
  getOrganization,
  getOrganizationsForUser,
  getOrganizationWithMembers,
  checkMemberPermission,
  canInviteMembers,
  canManageOrgSettings,
  resolveUserOrgs,
  resolvePrimaryOrg,
  getOrgMemberCount,
  suspendOrganization,
  archiveOrganization,
  reactivateOrganization,
} from './service';
