/**
 * lib/permissions.ts
 * Plan-based feature gating for SolarPro.
 * Use this on both server (API routes) and client (React hooks).
 */

import { PlanId, getPlanPermissions } from './stripe';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'requires_payment'
  | 'free_pass'
  | 'trial_expired';

export interface UserSubscription {
  plan: PlanId;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  isFreePass: boolean;
  hasAccess: boolean;
}

/**
 * Determine if a user has active access to the platform.
 */
export function checkAccess(sub: UserSubscription): {
  hasAccess: boolean;
  reason: 'active' | 'trialing' | 'free_pass' | 'trial_expired' | 'canceled' | 'past_due' | 'requires_payment';
  daysRemaining?: number;
} {
  if (sub.isFreePass) return { hasAccess: true, reason: 'free_pass' };
  if (sub.subscriptionStatus === 'active') return { hasAccess: true, reason: 'active' };

  if (sub.subscriptionStatus === 'trialing' && sub.trialEndsAt) {
    const now = new Date();
    const end = new Date(sub.trialEndsAt);
    const msLeft = end.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    if (msLeft > 0) return { hasAccess: true, reason: 'trialing', daysRemaining };
    return { hasAccess: false, reason: 'trial_expired', daysRemaining: 0 };
  }

  if (sub.subscriptionStatus === 'past_due') return { hasAccess: false, reason: 'past_due' };
  if (sub.subscriptionStatus === 'requires_payment') return { hasAccess: false, reason: 'requires_payment' };
  return { hasAccess: false, reason: 'canceled' };
}

/**
 * Check if a user's plan allows a specific feature.
 */
export function canAccess(plan: PlanId, feature: keyof ReturnType<typeof getPlanPermissions>): boolean {
  const perms = getPlanPermissions(plan);
  const val = perms[feature];
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val > 0;
  return val !== null; // null = unlimited = allowed
}

/**
 * Get upgrade message for a locked feature.
 */
export function getUpgradeMessage(feature: keyof ReturnType<typeof getPlanPermissions>): {
  title: string;
  description: string;
  requiredPlan: string;
} {
  const messages: Record<string, { title: string; description: string; requiredPlan: string }> = {
    engineering: {
      title: 'Engineering Tools — Professional Plan Required',
      description: 'Single-line diagrams, NEC-compliant calculations, and full electrical engineering are available on the Professional plan and above.',
      requiredPlan: 'Professional',
    },
    permitPackets: {
      title: 'Permit Packets — Professional Plan Required',
      description: 'Generate complete permit-ready packages with stamped drawings and calculations on the Professional plan.',
      requiredPlan: 'Professional',
    },
    structuralCalcs: {
      title: 'Structural Calculations — Professional Plan Required',
      description: 'Wind, snow, and seismic load calculations for permit submissions are available on the Professional plan.',
      requiredPlan: 'Professional',
    },
    solFence: {
      title: 'Sol Fence Design — Professional Plan Required',
      description: 'Vertical bifacial solar fence design tools are available on the Professional plan and above.',
      requiredPlan: 'Professional',
    },
    bom: {
      title: 'Bill of Materials — Professional Plan Required',
      description: 'Automated BOM generation with pricing is available on the Professional plan.',
      requiredPlan: 'Professional',
    },
    whiteLabelBranding: {
      title: 'White-Label Branding — Professional Plan Required',
      description: 'Upload your logo and customize proposal branding on the Professional plan.',
      requiredPlan: 'Professional',
    },
    bulkProposals: {
      title: 'Bulk Proposals — Contractor Plan Required',
      description: 'Generate proposals in bulk for multiple clients at once on the Contractor plan.',
      requiredPlan: 'Contractor',
    },
    apiAccess: {
      title: 'API Access — Contractor Plan Required',
      description: 'Programmatic access to SolarPro via REST API is available on the Contractor plan.',
      requiredPlan: 'Contractor',
    },
    multiCompany: {
      title: 'Multi-Company — Enterprise Plan Required',
      description: 'Manage multiple companies and brands from a single account on the Enterprise plan.',
      requiredPlan: 'Enterprise',
    },
  };

  return messages[feature] || {
    title: 'Feature Not Available',
    description: 'This feature requires a higher plan.',
    requiredPlan: 'Professional',
  };
}
