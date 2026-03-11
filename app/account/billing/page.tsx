'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import { useUser } from '@/contexts/UserContext';
import {
  CreditCard, CheckCircle, ArrowRight, AlertTriangle,
  Clock, Zap, ExternalLink, RefreshCw, Building2,
  Star, Shield, X, Check
} from 'lucide-react';

const PLAN_INFO: Record<string, { label: string; price: string; color: string; bgColor: string; borderColor: string }> = {
  starter:      { label: 'Starter',      price: '$79/mo',   color: 'text-slate-300',  bgColor: 'bg-slate-700',    borderColor: 'border-slate-600' },
  professional: { label: 'Professional', price: '$149/mo',  color: 'text-amber-400',  bgColor: 'bg-amber-500/20', borderColor: 'border-amber-500' },
  contractor:   { label: 'Contractor',   price: '$250/mo',  color: 'text-blue-400',   bgColor: 'bg-blue-500/20',  borderColor: 'border-blue-500' },
  enterprise:   { label: 'Enterprise',   price: 'Custom',   color: 'text-purple-400', bgColor: 'bg-purple-500/20', borderColor: 'border-purple-500' },
  free_pass:    { label: 'Free Pass',    price: 'Free',     color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', borderColor: 'border-emerald-500' },
};

const ROLE_INFO: Record<string, { label: string; color: string; bgColor: string; borderColor: string; description: string }> = {
  super_admin: { label: 'Super Admin', color: 'text-purple-400', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/30', description: 'Full platform authority — owner-level access' },
  admin:       { label: 'Admin',       color: 'text-amber-400',  bgColor: 'bg-amber-500/10',  borderColor: 'border-amber-500/30',  description: 'Administrative access to all platform features' },
  user:        { label: 'User',        color: 'text-slate-400',  bgColor: 'bg-slate-700/50',  borderColor: 'border-slate-600',     description: 'Standard user account' },
};

const STATUS_INFO: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  active:           { label: 'Active',           color: 'text-emerald-400', icon: <CheckCircle className="w-4 h-4" /> },
  trialing:         { label: 'Free Trial',        color: 'text-amber-400',  icon: <Clock className="w-4 h-4" /> },
  trial_expired:    { label: 'Trial Expired',     color: 'text-red-400',    icon: <AlertTriangle className="w-4 h-4" /> },
  past_due:         { label: 'Payment Past Due',  color: 'text-orange-400', icon: <AlertTriangle className="w-4 h-4" /> },
  canceled:         { label: 'Canceled',          color: 'text-red-400',    icon: <X className="w-4 h-4" /> },
  free_pass:        { label: 'Free Pass',         color: 'text-emerald-400', icon: <Star className="w-4 h-4" /> },
  requires_payment: { label: 'Payment Required',  color: 'text-orange-400', icon: <AlertTriangle className="w-4 h-4" /> },
};

function getTrialDaysRemaining(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  const now = new Date();
  const end = new Date(trialEndsAt);
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

function isAdminRole(role: string) {
  return role === 'admin' || role === 'super_admin';
}

export default function BillingPage() {
  const router = useRouter();
  // Use global UserContext — single source of truth, no duplicate fetch
  const { user, loading } = useUser();
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManageBilling = async () => {
    setPortalLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Could not open billing portal.');
      }
    } catch {
      setError('Failed to connect to billing portal.');
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const isAdmin = isAdminRole(user.role);
  const planInfo = PLAN_INFO[user.plan] || PLAN_INFO.starter;
  const roleInfo = ROLE_INFO[user.role] || ROLE_INFO.user;
  const statusInfo = STATUS_INFO[user.subscriptionStatus] || STATUS_INFO.trialing;
  const trialDays = getTrialDaysRemaining(user.trialEndsAt);
  const isTrialing = user.subscriptionStatus === 'trialing';
  const isExpired = user.subscriptionStatus === 'trial_expired' || (isTrialing && trialDays === 0);
  const isPastDue = user.subscriptionStatus === 'past_due';
  const isActive = user.subscriptionStatus === 'active';
  // isFreePass is a DB boolean — never inferred from subscriptionStatus
  const isFreePass = user.isFreePass;
  // stripeCustomerId not in UserContext — only used for Stripe portal button visibility
  const hasStripe = false; // Will be fetched separately if needed

  // Admin/super_admin users bypass all subscription restrictions
  const hasFullAccess = isAdmin || isFreePass;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Billing & Subscription</h1>
          <p className="text-slate-400">Manage your plan, payment method, and billing history.</p>
        </div>

        {/* Alert Banners — never shown to admins or free pass users */}
        {!hasFullAccess && isExpired && (
          <div className="mb-6 bg-red-900/30 border border-red-500 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-300 font-semibold">Your free trial has expired</p>
              <p className="text-red-400 text-sm mt-1">Subscribe to continue using SolarPro and keep access to your projects.</p>
            </div>
            <Link href="/subscribe" className="bg-red-500 hover:bg-red-400 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap">
              Subscribe Now
            </Link>
          </div>
        )}

        {!hasFullAccess && isPastDue && (
          <div className="mb-6 bg-orange-900/30 border border-orange-500 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-orange-300 font-semibold">Payment past due</p>
              <p className="text-orange-400 text-sm mt-1">Please update your payment method to avoid service interruption.</p>
            </div>
            <button onClick={handleManageBilling} className="bg-orange-500 hover:bg-orange-400 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap">
              Update Payment
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-900/30 border border-red-500 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-red-300 text-sm">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Account Overview Card — shows Role AND Plan separately */}
        <div className={`bg-slate-900 border-2 ${isAdmin ? roleInfo.borderColor : planInfo.borderColor} rounded-2xl p-6 mb-6`}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <p className="text-slate-400 text-sm mb-3">Account Overview</p>

              {/* Role row — always shown */}
              <div className="flex items-center gap-3 mb-2">
                <span className="text-slate-500 text-sm w-12">Role</span>
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold ${roleInfo.bgColor} ${roleInfo.color} border ${roleInfo.borderColor}`}>
                  {isAdmin && <Shield className="w-3.5 h-3.5" />}
                  {roleInfo.label}
                </div>
              </div>

              {/* Plan row — always shown */}
              <div className="flex items-center gap-3">
                <span className="text-slate-500 text-sm w-12">Plan</span>
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold ${planInfo.bgColor} ${planInfo.color} border ${planInfo.borderColor}`}>
                    {isFreePass && <Star className="w-3.5 h-3.5" />}
                    {isFreePass ? 'Free Pass' : planInfo.label}
                  </div>
                  {!isFreePass && (
                    <span className={`text-xs font-medium ${planInfo.color} opacity-70`}>{planInfo.price}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Status badge — top right */}
            {!hasFullAccess && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${statusInfo.color} bg-slate-800`}>
                {statusInfo.icon}
                {statusInfo.label}
              </div>
            )}
          </div>

          {/* Admin full access notice */}
          {isAdmin && (
            <div className={`${roleInfo.bgColor} border ${roleInfo.borderColor} rounded-xl p-4 mb-4`}>
              <div className={`flex items-center gap-2 ${roleInfo.color}`}>
                <Shield className="w-5 h-5" />
                <span className="font-semibold">
                  {user.role === 'super_admin' ? 'Super Admin — Full Platform Access' : 'Admin — Full Platform Access'}
                </span>
              </div>
              <p className="text-slate-400 text-sm mt-1">
                {roleInfo.description}. Subscription billing does not apply to admin accounts.
              </p>
            </div>
          )}

          {/* Free pass notice — shown for non-admin free pass users */}
          {isFreePass && !isAdmin && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <Star className="w-5 h-5" />
                <span className="font-semibold">You have a complimentary free pass</span>
              </div>
              <p className="text-emerald-300/70 text-sm mt-1">
                Full access to all Contractor-level features at no charge.
              </p>
            </div>
          )}

          {/* Trial countdown — only for regular users */}
          {!hasFullAccess && isTrialing && !isExpired && trialDays > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 text-amber-400">
                <Clock className="w-5 h-5" />
                <span className="font-semibold">
                  {trialDays} day{trialDays !== 1 ? 's' : ''} remaining in your free trial
                </span>
              </div>
              <p className="text-amber-300/70 text-sm mt-1">
                Subscribe before your trial ends to keep access to all features.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            {/* Admin: no billing actions needed */}
            {isAdmin && (
              <div className={`flex items-center gap-2 text-sm ${roleInfo.color}`}>
                <Shield className="w-4 h-4" />
                <span>No billing required — admin account</span>
              </div>
            )}

            {/* Free pass non-admin: no billing actions */}
            {isFreePass && !isAdmin && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm">
                <Star className="w-4 h-4" />
                <span>No billing required — free pass active</span>
              </div>
            )}

            {/* Regular users: show billing actions */}
            {!hasFullAccess && (
              <>
                {hasStripe ? (
                  <button
                    onClick={handleManageBilling}
                    disabled={portalLoading}
                    className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    {portalLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <ExternalLink className="w-4 h-4" />
                    )}
                    Manage Billing
                  </button>
                ) : null}

                <Link
                  href="/subscribe"
                  className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-colors"
                >
                  <Zap className="w-4 h-4" />
                  {isActive ? 'Change Plan' : 'Subscribe Now'}
                  <ArrowRight className="w-4 h-4" />
                </Link>

                {hasStripe && isActive && (
                  <button
                    onClick={handleManageBilling}
                    className="flex items-center gap-2 text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/50 px-4 py-2.5 rounded-xl text-sm transition-colors"
                  >
                    Cancel Subscription
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Plan Comparison Mini Grid — hidden for admins (not relevant) */}
        {!isAdmin && (
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Plan Comparison</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { id: 'starter',      label: 'Starter',      price: '$79/mo',  features: ['2 projects', '5 clients', 'Basic design'] },
                { id: 'professional', label: 'Professional', price: '$149/mo', features: ['Unlimited projects', 'Engineering (SLD)', 'Permit packets'] },
                { id: 'contractor',   label: 'Contractor',   price: '$250/mo', features: ['Team members', 'Sol Fence', 'API access'] },
                { id: 'enterprise',   label: 'Enterprise',   price: 'Custom',  features: ['Multi-company', 'Custom SLA', 'White-glove'] },
              ].map((p) => {
                const info = PLAN_INFO[p.id];
                const isCurrent = user.plan === p.id || (isFreePass && p.id === 'contractor');
                return (
                  <div key={p.id} className={`rounded-xl p-4 border ${isCurrent ? `${info.borderColor} ${info.bgColor}` : 'border-slate-700 bg-slate-800/50'}`}>
                    <div className={`font-semibold text-sm mb-1 ${isCurrent ? info.color : 'text-slate-300'}`}>
                      {p.label}
                      {isCurrent && <span className="ml-2 text-xs opacity-70">(current)</span>}
                    </div>
                    <div className={`text-xs font-bold mb-2 ${isCurrent ? info.color : 'text-slate-400'}`}>{p.price}</div>
                    <ul className="space-y-1">
                      {p.features.map(f => (
                        <li key={f} className="flex items-center gap-1 text-xs text-slate-400">
                          <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {!isCurrent && p.id !== 'enterprise' && (
                      <Link href="/subscribe" className={`mt-3 block text-center text-xs py-1.5 rounded-lg font-semibold transition-colors ${info.bgColor} ${info.color} hover:opacity-80`}>
                        Upgrade →
                      </Link>
                    )}
                    {!isCurrent && p.id === 'enterprise' && (
                      <Link href="/enterprise" className="mt-3 block text-center text-xs py-1.5 rounded-lg font-semibold bg-purple-500/20 text-purple-400 hover:opacity-80 transition-colors">
                        Contact Sales →
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Admin: show admin portal link instead of plan comparison */}
        {isAdmin && (
          <div className={`bg-slate-900 border ${roleInfo.borderColor} rounded-2xl p-6`}>
            <h3 className="text-lg font-semibold text-white mb-2">Admin Access</h3>
            <p className="text-slate-400 text-sm mb-4">
              As a {roleInfo.label}, you have full access to all platform features and the admin portal.
            </p>
            <Link
              href="/admin"
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${roleInfo.bgColor} ${roleInfo.color} border ${roleInfo.borderColor} hover:opacity-80`}
            >
              <Shield className="w-4 h-4" />
              Go to Admin Portal
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}