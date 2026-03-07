'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, ArrowRight, Zap, X } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import type { FeatureKey } from '@/lib/permissions';
import { getUpgradeMessage } from '@/lib/permissions';

interface PlanGateProps {
  feature: FeatureKey;
  children: React.ReactNode;
  /** If true, renders children but overlays a lock banner instead of blocking */
  overlay?: boolean;
  /** Custom fallback UI instead of the default lock screen */
  fallback?: React.ReactNode;
}

/**
 * PlanGate — wraps content that requires a specific plan.
 * If the user's plan doesn't have access, shows a lock screen or overlay.
 */
export default function PlanGate({ feature, children, overlay = false, fallback }: PlanGateProps) {
  const { loading, can, planLabel } = useSubscription();
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasAccess = can(feature);
  const msg = getUpgradeMessage(feature);

  if (hasAccess) return <>{children}</>;

  // Custom fallback
  if (fallback) return <>{fallback}</>;

  // Overlay mode — show children blurred with a lock banner on top
  if (overlay && !dismissed) {
    return (
      <div className="relative">
        <div className="pointer-events-none select-none blur-sm opacity-40">
          {children}
        </div>
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="bg-slate-900/95 border border-amber-500/30 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl shadow-black/60 text-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
              <Lock size={24} className="text-amber-400" />
            </div>
            <h3 className="text-lg font-black text-white mb-2">{msg.title}</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-5">{msg.description}</p>
            <div className="flex items-center justify-center gap-2 mb-5 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
              <Zap size={13} className="text-amber-400 flex-shrink-0" />
              <span className="text-amber-300 text-sm font-medium">
                Requires <strong>{msg.requiredPlan}</strong> plan
              </span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/subscribe')}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-2.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2"
              >
                Upgrade Now <ArrowRight size={14} />
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-400 font-medium py-2.5 rounded-xl text-sm transition-all border border-slate-700"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Full lock screen (default)
  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-10 max-w-lg w-full text-center shadow-2xl shadow-black/40">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-6">
          <Lock size={28} className="text-amber-400" />
        </div>

        {/* Content */}
        <h2 className="text-2xl font-black text-white mb-3">{msg.title}</h2>
        <p className="text-slate-400 text-sm leading-relaxed mb-6">{msg.description}</p>

        {/* Current plan */}
        <div className="flex items-center justify-center gap-2 mb-3 text-sm text-slate-500">
          Your current plan: <span className="text-slate-300 font-semibold">{planLabel}</span>
        </div>

        {/* Required plan badge */}
        <div className="flex items-center justify-center gap-2 mb-8 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
          <Zap size={14} className="text-amber-400 flex-shrink-0" />
          <span className="text-amber-300 text-sm font-medium">
            Available on <strong>{msg.requiredPlan}</strong> plan and above
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3 max-w-sm mx-auto">
          <button
            onClick={() => router.push('/subscribe')}
            className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2"
          >
            Upgrade Plan <ArrowRight size={14} />
          </button>
          <button
            onClick={() => router.push('/subscribe')}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-3 rounded-xl text-sm transition-all border border-slate-700"
          >
            Compare Plans
          </button>
        </div>
      </div>
    </div>
  );
}