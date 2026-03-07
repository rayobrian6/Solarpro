/**
 * hooks/useSubscription.ts
 * React hook for subscription state and feature gating.
 * Use this in any client component to check plan permissions.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { PlanId, getPlanPermissions } from '@/lib/stripe';
import { checkAccess, canAccess, getUpgradeMessage, UserSubscription } from '@/lib/permissions';

interface UseSubscriptionReturn {
  // State
  loading: boolean;
  plan: PlanId;
  status: string;
  isFreePass: boolean;
  hasAccess: boolean;
  trialDaysRemaining: number | null;
  isTrialing: boolean;
  isActive: boolean;
  isExpired: boolean;
  isPastDue: boolean;

  // Feature checks
  can: (feature: keyof ReturnType<typeof getPlanPermissions>) => boolean;
  upgradeMessage: (feature: keyof ReturnType<typeof getPlanPermissions>) => {
    title: string; description: string; requiredPlan: string;
  };

  // Plan info
  planLabel: string;
  planColor: string;

  // Refresh
  refresh: () => void;
}

export function useSubscription(): UseSubscriptionReturn {
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<UserSubscription>({
    plan: 'starter',
    subscriptionStatus: 'trialing',
    trialEndsAt: null,
    isFreePass: false,
    hasAccess: true,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success && data.data) {
        const u = data.data;
        setSub({
          plan: u.plan || 'starter',
          subscriptionStatus: u.subscriptionStatus || 'trialing',
          trialEndsAt: u.trialEndsAt || null,
          isFreePass: u.isFreePass || false,
          hasAccess: u.hasAccess ?? true,
        });
      }
    } catch (e) {
      console.error('useSubscription error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const access = checkAccess(sub);

  const planLabels: Record<PlanId, string> = {
    starter: 'Starter',
    professional: 'Professional',
    contractor: 'Contractor',
    enterprise: 'Enterprise',
    free_pass: 'Free Pass',
  };

  const planColors: Record<PlanId, string> = {
    starter: 'text-slate-400',
    professional: 'text-amber-400',
    contractor: 'text-blue-400',
    enterprise: 'text-purple-400',
    free_pass: 'text-emerald-400',
  };

  return {
    loading,
    plan: sub.plan,
    status: sub.subscriptionStatus,
    isFreePass: sub.isFreePass,
    hasAccess: access.hasAccess,
    trialDaysRemaining: access.reason === 'trialing' ? (access.daysRemaining ?? null) : null,
    isTrialing: access.reason === 'trialing',
    isActive: access.reason === 'active' || access.reason === 'free_pass',
    isExpired: access.reason === 'trial_expired' || access.reason === 'canceled',
    isPastDue: access.reason === 'past_due',
    can: (feature) => sub.isFreePass ? true : canAccess(sub.plan, feature),
    upgradeMessage: getUpgradeMessage,
    planLabel: planLabels[sub.plan] || 'Starter',
    planColor: planColors[sub.plan] || 'text-slate-400',
    refresh: load,
  };
}
