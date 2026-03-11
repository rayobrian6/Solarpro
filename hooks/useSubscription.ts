'use client';

/**
 * useSubscription
 *
 * Reads from the global UserContext (single source of truth).
 * No longer fetches /api/auth/me independently — avoids duplicate requests
 * and ensures all components see the same user state simultaneously.
 *
 * All access decisions flow through hasPlatformAccess() from lib/permissions.ts.
 */

import { useUser, isAdminRole } from '@/contexts/UserContext';
import { hasPlatformAccess, canAccess, checkAccess, FeatureKey } from '@/lib/permissions';
import type { PlanId } from '@/lib/stripe';

export interface SubscriptionState {
  loading: boolean;
  plan: PlanId;
  status: string;
  role: string;
  isFreePass: boolean;
  hasAccess: boolean;
  trialDaysRemaining: number;
  isTrialing: boolean;
  isActive: boolean;
  isExpired: boolean;
  isPastDue: boolean;
  isCanceled: boolean;
  planLabel: string;
  planPrice: string;
  planColor: string;
  can: (feature: FeatureKey) => boolean;
}

const PLAN_LABELS: Record<string, string> = {
  starter:      'Starter',
  professional: 'Professional',
  contractor:   'Contractor',
  enterprise:   'Enterprise',
  free_pass:    'Free Pass',
};

const PLAN_PRICES: Record<string, string> = {
  starter:      '$79/mo',
  professional: '$149/mo',
  contractor:   '$250/mo',
  enterprise:   'Custom',
  free_pass:    'Free',
};

const PLAN_COLORS: Record<string, string> = {
  starter:      'text-slate-300',
  professional: 'text-amber-400',
  contractor:   'text-blue-400',
  enterprise:   'text-purple-400',
  free_pass:    'text-green-400',
};

export function useSubscription(): SubscriptionState {
  // Read from global UserContext — no independent fetch
  const { user, loading } = useUser();

  const role = user?.role || 'user';
  const plan = (user?.plan || 'starter') as PlanId;
  const status = user?.subscriptionStatus || 'trialing';
  const isFreePassUser = user?.isFreePass === true;
  const trialEndsAt = user?.trialEndsAt || null;
  const isAdmin = isAdminRole(role);

  // Use hasPlatformAccess as the single source of truth for access decisions
  const hasAccess = hasPlatformAccess(user);

  // For trial days remaining, still use checkAccess for the daysRemaining calculation
  const accessDetail = isAdmin
    ? { allowed: true, reason: 'active' as const, daysRemaining: undefined }
    : checkAccess(status, trialEndsAt, isFreePassUser, role);

  const trialDaysRemaining = accessDetail.daysRemaining ?? 0;
  const isEffectivelyActive = isAdmin || isFreePassUser;

  const isTrialing = !isEffectivelyActive && status === 'trialing' && trialDaysRemaining > 0;
  const isExpired  = !isEffectivelyActive && (
    status === 'trial_expired' ||
    (status === 'trialing' && trialDaysRemaining === 0)
  );
  const isActive   = status === 'active' || isEffectivelyActive;
  const isPastDue  = !isAdmin && status === 'past_due';
  const isCanceled = !isAdmin && status === 'canceled';

  return {
    loading,
    plan,
    status,
    role,
    isFreePass: isFreePassUser,
    hasAccess,
    trialDaysRemaining,
    isTrialing,
    isActive,
    isExpired,
    isPastDue,
    isCanceled,
    planLabel: PLAN_LABELS[plan] || 'Starter',
    planPrice: PLAN_PRICES[plan] || '$79/mo',
    planColor: PLAN_COLORS[plan] || 'text-slate-300',
    can: (feature: FeatureKey) => {
      // hasPlatformAccess covers admin + free_pass + active subscription
      if (!hasAccess) return false;
      if (isAdmin) return true;
      if (isFreePassUser) return true;
      return canAccess(plan, feature);
    },
  };
}