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
      .then(user => {
        if (user?.id) {
          setData({
            plan: (user.plan || 'starter') as PlanId,
            status: user.subscriptionStatus || 'trialing',
            isFreePass: user.isFreePass || false,
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

  const isTrialing = data.status === 'trialing' && trialDaysRemaining > 0;
  const isExpired = data.status === 'trial_expired' ||
    (data.status === 'trialing' && trialDaysRemaining === 0 && !data.isFreePass);
  const isActive = data.status === 'active' || data.isFreePass || data.status === 'free_pass';
  const isPastDue = data.status === 'past_due';
  const isCanceled = data.status === 'canceled';

  return {
    loading,
    plan: data.plan,
    status: data.status,
    isFreePass: data.isFreePass,
    hasAccess: access.allowed,
    trialDaysRemaining,
    isTrialing,
    isActive,
    isExpired,
    isPastDue,
    isCanceled,
    planLabel: PLAN_LABELS[data.plan] || 'Starter',
    planPrice: PLAN_PRICES[data.plan] || '$79/mo',
    planColor: PLAN_COLORS[data.plan] || 'text-slate-300',
    can: (feature: FeatureKey) => {
      if (data.isFreePass || data.status === 'free_pass') return true;
      if (!access.allowed) return false;
      return canAccess(data.plan, feature);
    },
  };
}