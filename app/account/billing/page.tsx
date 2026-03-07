'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import {
  CreditCard, CheckCircle, ArrowRight, AlertTriangle,
  Clock, Zap, ExternalLink, RefreshCw, Building2,
  Star, Shield, X
} from 'lucide-react';

interface UserData {
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  isFreePass: boolean;
  hasAccess: boolean;
  stripeCustomerId?: string;
}

const PLAN_INFO: Record<string, { label: string; price: string; color: string; bgColor: string; borderColor: string }> = {
  starter:      { label: 'Starter',      price: '$79/month',   color: 'text-slate-300',  bgColor: 'bg-slate-800/60',              borderColor: 'border-slate-600' },
  professional: { label: 'Professional', price: '$199/month',  color: 'text-amber-400',  bgColor: 'bg-amber-500/10',              borderColor: 'border-amber-500/30' },
  contractor:   { label: 'Contractor',   price: '$399/month',  color: 'text-blue-400',   bgColor: 'bg-blue-500/10',               borderColor: 'border-blue-500/30' },
  enterprise:   { label: 'Enterprise',   price: 'Custom',      color: 'text-purple-400', bgColor: 'bg-purple-500/10',             borderColor: 'border-purple-500/30' },
  free_pass:    { label: 'Free Pass',    price: 'Complimentary', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10',         borderColor: 'border-emerald-500/30' },
};

const STATUS_INFO: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  active:           { label: 'Active',            color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: <CheckCircle size={12} /> },
  trialing:         { label: 'Trial',             color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',      icon: <Clock size={12} /> },
  past_due:         { label: 'Payment Failed',    color: 'text-red-400 bg-red-500/10 border-red-500/20',            icon: <AlertTriangle size={12} /> },
  canceled:         { label: 'Canceled',          color: 'text-slate-400 bg-slate-800 border-slate-700',            icon: <X size={12} /> },
  requires_payment: { label: 'Requires Payment',  color: 'text-orange-400 bg-orange-500/10 border-orange-500/20',   icon: <CreditCard size={12} /> },
  free_pass:        { label: 'Free Pass',         color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: <Star size={12} /> },
  trial_expired:    { label: 'Trial Expired',     color: 'text-red-400 bg-red-500/10 border-red-500/20',            icon: <AlertTriangle size={12} /> },
};

export default function BillingPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => {
        if (data.success) setUser(data.data);
        else router.push('/auth/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.url) {
        window.location.href = data.url;
      } else {
        router.push('/subscribe');
      }
    } catch {
      router.push('/subscribe');
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const planInfo = PLAN_INFO[user.plan] || PLAN_INFO.starter;
  const statusInfo = STATUS_INFO[user.isFreePass ? 'free_pass' : user.subscriptionStatus] || STATUS_INFO.trialing;

  const trialDaysLeft = user.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(user.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  const isTrialing = user.subscriptionStatus === 'trialing' && trialDaysLeft !== null && trialDaysLeft > 0;
  const isExpired = user.subscriptionStatus === 'trialing' && trialDaysLeft === 0;
  const isPastDue = user.subscriptionStatus === 'past_due';

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-white">Billing & Subscription</h1>
          <p className="text-slate-400 text-sm mt-1">Manage your plan, payment method, and billing history.</p>
        </div>

        {/* Alert banners */}
        {isExpired && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm">
            <AlertTriangle size={16} className="flex-shrink-0" />
            <div>
              <strong>Your trial has expired.</strong> Upgrade to continue using SolarPro.
            </div>
            <button onClick={() => router.push('/subscribe')} className="ml-auto bg-red-500 hover:bg-red-400 text-white font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 flex-shrink-0">
              Upgrade <ArrowRight size={11} />
            </button>
          </div>
        )}

        {isPastDue && (
          <div className="flex items-center gap-3 p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-300 text-sm">
            <CreditCard size={16} className="flex-shrink-0" />
            <div>
              <strong>Payment failed.</strong> Please update your payment method to restore access.
            </div>
            <button onClick={openPortal} className="ml-auto bg-orange-500 hover:bg-orange-400 text-white font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 flex-shrink-0">
              Fix Payment <ArrowRight size={11} />
            </button>
          </div>
        )}

        {/* Current Plan Card */}
        <div className={`card p-6 border ${planInfo.borderColor}`}>
          <div className="flex items-start justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-white mb-1">Current Plan</h2>
              <p className="text-slate-400 text-sm">Your active subscription details</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${statusInfo.color}`}>
              {statusInfo.icon} {statusInfo.label}
            </span>
          </div>

          <div className={`flex items-center gap-4 p-4 rounded-xl ${planInfo.bgColor} border ${planInfo.borderColor} mb-5`}>
            <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <Zap size={20} className={planInfo.color} />
            </div>
            <div className="flex-1">
              <div className={`text-xl font-black ${planInfo.color}`}>{planInfo.label}</div>
              <div className="text-slate-400 text-sm">
                {user.isFreePass ? 'Complimentary access — no billing' : planInfo.price}
              </div>
            </div>
            {isTrialing && trialDaysLeft !== null && (
              <div className="text-right">
                <div className="text-amber-400 font-black text-2xl">{trialDaysLeft}</div>
                <div className="text-slate-500 text-xs">days left</div>
              </div>
            )}
          </div>

          {/* Actions */}
          {!user.isFreePass && user.plan !== 'enterprise' && (
            <div className="flex flex-wrap gap-3">
              {(user.subscriptionStatus === 'active' || user.subscriptionStatus === 'past_due') && (
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="btn-primary text-sm flex items-center gap-2"
                >
                  {portalLoading
                    ? <><span className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" /> Opening...</>
                    : <><ExternalLink size={14} /> Manage Billing</>
                  }
                </button>
              )}
              <Link href="/subscribe" className="btn-secondary text-sm flex items-center gap-2">
                <ArrowRight size={14} /> {isTrialing || isExpired ? 'Upgrade Plan' : 'Change Plan'}
              </Link>
              {user.subscriptionStatus === 'active' && (
                <button
                  onClick={openPortal}
                  className="btn-secondary text-sm text-red-400 border-red-500/20 hover:bg-red-500/10 flex items-center gap-2"
                >
                  Cancel Subscription
                </button>
              )}
            </div>
          )}

          {user.plan === 'enterprise' && (
            <div className="flex gap-3">
              <a href="mailto:sales@underthesun.solutions" className="btn-primary text-sm flex items-center gap-2">
                <Building2 size={14} /> Contact Account Manager
              </a>
            </div>
          )}
        </div>

        {/* Plan Comparison */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-white">Available Plans</h2>
            <Link href="/subscribe" className="text-amber-400 hover:text-amber-300 text-sm font-medium flex items-center gap-1">
              View full comparison <ArrowRight size={13} />
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { id: 'starter', label: 'Starter', price: '$79/mo', color: 'border-slate-600', active: user.plan === 'starter' },
              { id: 'professional', label: 'Professional', price: '$199/mo', color: 'border-amber-500/40', active: user.plan === 'professional' },
              { id: 'contractor', label: 'Contractor', price: '$399/mo', color: 'border-blue-500/40', active: user.plan === 'contractor' },
              { id: 'enterprise', label: 'Enterprise', price: 'Custom', color: 'border-purple-500/40', active: user.plan === 'enterprise' },
            ].map(p => (
              <div
                key={p.id}
                className={`p-3 rounded-xl border-2 text-center transition-all ${p.color} ${p.active ? 'bg-slate-800/80 scale-[1.02]' : 'bg-slate-800/30 opacity-60'}`}
              >
                <div className="text-white font-bold text-sm mb-0.5">{p.label}</div>
                <div className="text-slate-400 text-xs">{p.price}</div>
                {p.active && (
                  <div className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                    <CheckCircle size={10} /> Current
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Billing Portal Info */}
        {!user.isFreePass && user.subscriptionStatus === 'active' && (
          <div className="card p-6">
            <h2 className="text-lg font-bold text-white mb-2">Payment & Invoices</h2>
            <p className="text-slate-400 text-sm mb-4">
              View invoices, update your payment method, and manage your billing details through the Stripe billing portal.
            </p>
            <button
              onClick={openPortal}
              disabled={portalLoading}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {portalLoading
                ? <><span className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" /> Opening Stripe Portal...</>
                : <><ExternalLink size={14} /> Open Billing Portal</>
              }
            </button>
            <p className="text-slate-600 text-xs mt-3 flex items-center gap-1">
              <Shield size={11} /> Secured by Stripe — we never store your card details
            </p>
          </div>
        )}

        {/* Free pass info */}
        {user.isFreePass && (
          <div className="card p-6 border border-emerald-500/20 bg-emerald-500/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Star size={18} className="text-emerald-400" />
              </div>
              <div>
                <div className="text-white font-bold">Free Pass Active</div>
                <div className="text-slate-400 text-sm">You have complimentary access to all SolarPro features. No billing required.</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
