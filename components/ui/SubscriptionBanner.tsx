'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Clock, ArrowRight, X, CheckCircle, CreditCard } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';

export default function SubscriptionBanner() {
  const router = useRouter();
  const { loading, isTrialing, isExpired, isPastDue, isFreePass, isActive, trialDaysRemaining, planLabel, role } = useSubscription();
  const [dismissed, setDismissed] = React.useState(false);

  // Admins, super_admins, and free pass users never see subscription banners
  const isAdmin = role === 'admin' || role === 'super_admin';
  if (loading || isFreePass || isAdmin || dismissed) return null;

  // Active subscription — no banner needed
  if (isActive && !isTrialing) return null;

  // Trial active
  if (isTrialing && trialDaysRemaining !== null && trialDaysRemaining > 0) {
    return (
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-sm">
            <Clock size={14} className="text-amber-400 flex-shrink-0" />
            <span className="text-amber-300 font-medium">
              {planLabel} Trial —{' '}
              <strong>{trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} remaining</strong>
            </span>
            <span className="text-amber-400/60 hidden sm:inline">·</span>
            <span className="text-amber-400/80 text-xs hidden sm:inline">Upgrade to keep full access after your trial ends</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => router.push('/subscribe')}
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
            >
              Upgrade Now <ArrowRight size={11} />
            </button>
            <button onClick={() => setDismissed(true)} className="text-amber-400/60 hover:text-amber-400 transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Trial expired
  if (isExpired) {
    return (
      <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-sm">
            <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
            <span className="text-red-300 font-medium">
              Your trial has expired.{' '}
              <span className="text-red-400/80 font-normal">Upgrade to continue using SolarPro.</span>
            </span>
          </div>
          <button
            onClick={() => router.push('/subscribe')}
            className="bg-red-500 hover:bg-red-400 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 flex-shrink-0"
          >
            Upgrade to Continue <ArrowRight size={11} />
          </button>
        </div>
      </div>
    );
  }

  // Past due
  if (isPastDue) {
    return (
      <div className="bg-orange-500/10 border-b border-orange-500/20 px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-sm">
            <CreditCard size={14} className="text-orange-400 flex-shrink-0" />
            <span className="text-orange-300 font-medium">
              Payment failed.{' '}
              <span className="text-orange-400/80 font-normal">Please update your payment method to keep access.</span>
            </span>
          </div>
          <button
            onClick={() => router.push('/account/billing')}
            className="bg-orange-500 hover:bg-orange-400 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 flex-shrink-0"
          >
            Update Payment <ArrowRight size={11} />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
