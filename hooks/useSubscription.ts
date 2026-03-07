'use client';

import { useState, useEffect } from 'react';
import { canAccess, checkAccess, FeatureKey } from '@/lib/permissions';
import type { PlanId } from '@/lib/stripe';

export interface SubscriptionState {
  loading: boolean;
  plan: PlanId;
  status: string;
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
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    plan: PlanId;
    status: string;
    isFreePass: boolean;
    trialEndsAt: string | null;
    hasAccess: boolean;
  }>({
    plan: 'starter',
    status: 'trialing',
    isFreePass: false,
    trialEndsAt: null,
    hasAccess: true,
  });

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(json => {
        // API returns { success: true, data: { id, plan, ... } }
        // Support both shapes: { data: { ... } } and flat { id, plan, ... }
        const user = json?.data || json;
        if (user?.id) {
          const isFP = user.isFreePass === true || user.subscriptionStatus === 'free_pass';
          setData({
            plan: (user.plan || 'starter') as PlanId,
            status: user.subscriptionStatus || 'trialing',
            isFreePass: isFP,
            trialEndsAt: user.trialEndsAt || null,
            hasAccess: user.hasAccess !== false,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const access = checkAccess(data.status, data.trialEndsAt, data.isFreePass);
  const trialDaysRemaining = access.daysRemaining ?? 0;

  // Free pass users are always active — never expired
  const isFreePassUser = data.isFreePass || data.status === 'free_pass';

  const isTrialing = !isFreePassUser && data.status === 'trialing' && trialDaysRemaining > 0;
  const isExpired  = !isFreePassUser && (
    data.status === 'trial_expired' ||
    (data.status === 'trialing' && trialDaysRemaining === 0)
  );
  const isActive   = data.status === 'active' || isFreePassUser;
  const isPastDue  = data.status === 'past_due';
  const isCanceled = data.status === 'canceled';

  return {
    loading,
    plan: data.plan,
    status: data.status,
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
      // Free pass users bypass ALL feature gates — full access
      if (isFreePassUser) return true;
      if (!access.allowed) return false;
      return canAccess(data.plan, feature);
    },
  };
}