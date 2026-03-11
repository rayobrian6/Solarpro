/**
 * lib/permissions.ts
 * Plan-based feature gating for SolarPro.
 *
 * SINGLE SOURCE OF TRUTH for all permission checks.
 * All access decisions must flow through hasPlatformAccess().
 */

import { PlanId, getPlanPermissions } from './stripe';

export type FeatureKey =
  | 'engineering'
  | 'permitPackets'
  | 'structuralCalcs'
  | 'solFence'
  | 'bom'
  | 'whiteLabelBranding'
  | 'proposalEsigning'
  | 'batteryDesign'
  | 'bulkProposals'
  | 'apiAccess'
  | 'multiCompany';

export interface AccessResult {
  allowed: boolean;
  reason: 'active' | 'trialing' | 'trial_expired' | 'no_subscription' | 'free_pass' | 'canceled' | 'past_due';
  daysRemaining?: number;
}

/**
 * hasPlatformAccess — UNIFIED permission helper.
 *
 * This is the single function that determines whether a user has access
 * to the platform. All feature gates, resource limits, and UI checks
 * must use this function.
 *
 * Priority: super_admin > admin > is_free_pass > active > trialing > false
 *
 * Admin actions (free pass, role upgrades, subscription changes) propagate
 * immediately because this reads directly from the user object returned by
 * /api/auth/me (which always reads from DB).
 */
export function hasPlatformAccess(user: {
  role?: string;
  is_free_pass?: boolean;
  isFreePass?: boolean;
  subscription_status?: string;
  subscriptionStatus?: string;
  trial_ends_at?: string | null;
  trialEndsAt?: string | null;
} | null | undefined): boolean {
  if (!user) return false;

  const role = (user.role || '').toLowerCase();

  // Admin roles always have full access — bypass all subscription checks
  if (role === 'super_admin') return true;
  if (role === 'admin') return true;

  // Free pass — always has full access, no expiry
  // Support both snake_case (DB) and camelCase (frontend) field names
  if (user.is_free_pass === true) return true;
  if (user.isFreePass === true) return true;

  // Subscription status checks
  // Support both snake_case (DB) and camelCase (frontend) field names
  const status = (user.subscription_status || user.subscriptionStatus || '').toLowerCase();

  if (status === 'active') return true;

  // free_pass status string — set by admin grant_free_pass action alongside is_free_pass boolean
  if (status === 'free_pass') return true;

  // Active trial
  if (status === 'trialing') {
    const trialEnd = user.trial_ends_at || user.trialEndsAt;
    if (!trialEnd) return true; // no end date set — allow
    return new Date(trialEnd) > new Date();
  }

  return false;
}

/**
 * Check if a user has active access to the platform at all.
 * Admin and super_admin roles always have full access regardless of subscription state.
 *
 * @deprecated Use hasPlatformAccess() instead for new code.
 */
export function checkAccess(
  subscriptionStatus: string,
  trialEndsAt: string | null,
  isFreePass: boolean,
  role?: string
): AccessResult {
  // Admin/super_admin — always allowed, bypass all subscription checks
  if (role === 'admin' || role === 'super_admin') return { allowed: true, reason: 'active' };

  // Free pass — always allowed, no expiry, no feature gates
  if (isFreePass) return { allowed: true, reason: 'free_pass' };

  if (subscriptionStatus === 'active') return { allowed: true, reason: 'active' };

  if (subscriptionStatus === 'trialing') {
    if (!trialEndsAt) return { allowed: true, reason: 'trialing', daysRemaining: 3 };
    const now = new Date();
    const end = new Date(trialEndsAt);
    const msLeft = end.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    if (daysRemaining > 0) return { allowed: true, reason: 'trialing', daysRemaining };
    return { allowed: false, reason: 'trial_expired', daysRemaining: 0 };
  }

  if (subscriptionStatus === 'past_due') return { allowed: true, reason: 'past_due' };
  if (subscriptionStatus === 'canceled') return { allowed: false, reason: 'canceled' };

  // Default: allow with no_subscription (new accounts)
  return { allowed: true, reason: 'no_subscription' };
}

/**
 * Check if a plan can access a specific feature.
 */
export function canAccess(plan: PlanId, feature: FeatureKey): boolean {
  const perms = getPlanPermissions(plan);
  switch (feature) {
    case 'engineering':        return perms.engineering;
    case 'permitPackets':      return perms.permitPackets;
    case 'structuralCalcs':    return perms.structuralCalcs;
    case 'solFence':           return perms.solFence;
    case 'bom':                return perms.bom;
    case 'whiteLabelBranding': return perms.whiteLabelBranding;
    case 'proposalEsigning':   return perms.proposalEsigning;
    case 'batteryDesign':      return perms.batteryDesign;
    case 'bulkProposals':      return perms.bulkProposals;
    case 'apiAccess':          return perms.apiAccess;
    case 'multiCompany':       return perms.multiCompany;
    default:                   return false;
  }
}

/**
 * Get upgrade message for a locked feature.
 */
export function getUpgradeMessage(feature: FeatureKey): {
  title: string;
  description: string;
  requiredPlan: string;
} {
  const messages: Record<FeatureKey, { title: string; description: string; requiredPlan: string }> = {
    engineering: {
      title: 'Engineering Tools Required',
      description: 'Full engineering calculations including Single Line Diagrams (SLD) are available on Professional and above.',
      requiredPlan: 'Professional',
    },
    permitPackets: {
      title: 'Permit Packets Locked',
      description: 'Generate complete permit-ready packages with stamped drawings on Professional and above.',
      requiredPlan: 'Professional',
    },
    structuralCalcs: {
      title: 'Structural Calculations Locked',
      description: 'Roof load analysis and structural engineering calculations are available on Professional and above.',
      requiredPlan: 'Professional',
    },
    solFence: {
      title: 'Sol Fence Design Locked',
      description: 'Sol Fence solar carport and fence design tools are available on Contractor and above.',
      requiredPlan: 'Contractor',
    },
    bom: {
      title: 'BOM Generation Locked',
      description: 'Automated Bill of Materials generation is available on Professional and above.',
      requiredPlan: 'Professional',
    },
    whiteLabelBranding: {
      title: 'White-Label Branding Locked',
      description: 'Custom logos, colors, and branded proposals are available on Professional and above.',
      requiredPlan: 'Professional',
    },
    proposalEsigning: {
      title: 'Proposal E-Signing Locked',
      description: 'Digital proposal signing and client approval workflows are available on Professional and above.',
      requiredPlan: 'Professional',
    },
    batteryDesign: {
      title: 'Battery System Design Locked',
      description: 'Battery storage system design and sizing tools are available on Professional and above.',
      requiredPlan: 'Professional',
    },
    bulkProposals: {
      title: 'Bulk Proposals Locked',
      description: 'Generate multiple proposals at once with advanced automation on Contractor and above.',
      requiredPlan: 'Contractor',
    },
    apiAccess: {
      title: 'API Access Locked',
      description: 'Programmatic API access for integrations and automation is available on Contractor and above.',
      requiredPlan: 'Contractor',
    },
    multiCompany: {
      title: 'Multi-Company Accounts Locked',
      description: 'Manage multiple company accounts from a single dashboard. Available on Enterprise.',
      requiredPlan: 'Enterprise',
    },
  };

  return messages[feature] || {
    title: 'Feature Locked',
    description: 'This feature requires a higher plan.',
    requiredPlan: 'Professional',
  };
}