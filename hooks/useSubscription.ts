'use client';

import { useState, useEffect } from 'react';
import { canAccess, checkAccess, FeatureKey } from '@/lib/permissions';
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

function isAdminRole(role: string) {
  return role === 'admin' || role === 'super_admin';
}

export function useSubscription(): SubscriptionState {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    plan: PlanId;
    status: string;
    role: string;
    isFreePass: boolean;
    trialEndsAt: string | null;
    hasAccess: boolean;
  }>({
    plan: 'starter',
    status: 'trialing',
    role: 'user',
    isFreePass: false,
    trialEndsAt: null,
    hasAccess: true,
  });

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.json())
      .then(json => {
        // API returns { success: true, data: { id, plan, role, ... } }
        const user = json?.data || json;
        if (user?.id) {
          // isFreePass comes from DB boolean — never infer from subscriptionStatus string
          const isFP = user.isFreePass === true;
          const role = user.role || 'user';
          setData({
            plan: (user.plan || 'starter') as PlanId,
            status: user.subscriptionStatus || 'trialing',
            role,
            isFreePass: isFP,
            trialEndsAt: user.trialEndsAt || null,
            hasAccess: user.hasAccess !== false,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isAdmin = isAdminRole(data.role);

  // Admin/super_admin bypass all subscription checks
  const access = isAdmin
    ? { allowed: true, reason: 'active' as const, daysRemaining: undefined }
    : checkAccess(data.status, data.trialEndsAt, data.isFreePass, data.role);

  const trialDaysRemaining = access.daysRemaining ?? 0;

  // Free pass users and admins are always active — never expired
  const isFreePassUser = data.isFreePass;
  const isEffectivelyActive = isAdmin || isFreePassUser;

  const isTrialing = !isEffectivelyActive && data.status === 'trialing' && trialDaysRemaining > 0;
  const isExpired  = !isEffectivelyActive && (
    data.status === 'trial_expired' ||
    (data.status === 'trialing' && trialDaysRemaining === 0)
  );
  const isActive   = data.status === 'active' || isEffectivelyActive;
  const isPastDue  = !isAdmin && data.status === 'past_due';
  const isCanceled = !isAdmin && data.status === 'canceled';

  return {
    loading,
    plan: data.plan,
    status: data.status,
    role: data.role,
    isFreePass: isFreePassUser,
    hasAccess: access.allowed,
    trialDaysRemaining,
    isTrialing,
    isActive,
    isExpired,
    isPastDue,
    isCanceled,
    planLabel: PLAN_LABELS[data.plan] || PLAN_LABELS[data.status] || 'Free Pass',
    planPrice: PLAN_PRICES[data.plan] || PLAN_PRICES[data.status] || 'Free',
    planColor: PLAN_COLORS[data.plan] || PLAN_COLORS[data.status] || 'text-green-400',
    can: (feature: FeatureKey) => {
      // Admin/super_admin bypass ALL feature gates — full access
      if (isAdmin) return true;
      // Free pass users bypass ALL feature gates — full access
      if (isFreePassUser) return true;
      if (!access.allowed) return false;
      return canAccess(data.plan, feature);
    },
  };
}