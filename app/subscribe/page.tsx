'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Check, X, Star, Zap, Building2, ArrowRight,
  Shield, Clock, Users, ChevronDown, ChevronUp,
  AlertCircle, Minus,
} from 'lucide-react';
import {
  PRICING_PLANS,
  PLAN_DISPLAY,
  PLAN_FEATURES,
  COMPARISON_TABLE,
  formatSeatLimit,
  formatExtraSeatMsg,
  type PlanId,
} from '@/lib/pricing.config';

// ─── Derived plan list for rendering ────────────────────────────────────────

const PLANS = PLAN_DISPLAY.map((meta) => {
  const cfg = PRICING_PLANS[meta.id as keyof typeof PRICING_PLANS];
  const features = PLAN_FEATURES[meta.id as keyof typeof PLAN_FEATURES];
  return {
    ...meta,
    price: cfg.price,
    priceLabel: cfg.price ? `$${cfg.price}` : 'Custom',
    period: cfg.price ? '/month' : ' pricing',
    usersIncluded: cfg.usersIncluded,
    extraSeatPrice: cfg.extraSeatPrice,
    seatLabel: formatSeatLimit(meta.id as keyof typeof PRICING_PLANS),
    extraSeatMsg: formatExtraSeatMsg(meta.id as keyof typeof PRICING_PLANS),
    features: features.included,
    notIncluded: features.notIncluded,
  };
});

// ─── Card border / accent styles ────────────────────────────────────────────

const CARD_STYLES: Record<string, { border: string; cta: string; badge: string }> = {
  starter: {
    border: 'border-slate-600/60',
    cta: 'bg-slate-700 hover:bg-slate-600 text-white',
    badge: '',
  },
  professional: {
    border: 'border-slate-500/60',
    cta: 'bg-slate-700 hover:bg-slate-600 text-white',
    badge: '',
  },
  contractor: {
    border: 'border-amber-500',
    cta: 'bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold shadow-lg shadow-amber-500/25',
    badge: 'bg-amber-500 text-slate-900',
  },
  enterprise: {
    border: 'border-purple-600/60',
    cta: 'bg-purple-700 hover:bg-purple-600 text-white',
    badge: 'bg-purple-700 text-white',
  },
};

// ─── Feature comparison cell ─────────────────────────────────────────────────

function CompCell({ value }: { value: string }) {
  if (value === 'yes')     return <Check className="w-5 h-5 text-green-400 mx-auto" />;
  if (value === 'no')      return <X className="w-4 h-4 text-slate-600 mx-auto" />;
  if (value === 'partial') return <AlertCircle className="w-4 h-4 text-amber-400 mx-auto" />;
  return <span className="text-sm text-slate-300 text-center block">{value}</span>;
}

// ─── Main inner component ────────────────────────────────────────────────────

function SubscribePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canceled = searchParams.get('canceled');
  const expired  = searchParams.get('expired');

  const [loading, setLoading]             = useState<string | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const handlePlanClick = async (plan: typeof PLANS[0]) => {
    setError(null);

    if (plan.checkoutType === 'contact') {
      router.push('/enterprise');
      return;
    }

    if (plan.checkoutType === 'trial') {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          router.push('/auth/register?plan=starter&trial=true');
          return;
        }
        router.push('/dashboard');
      } catch {
        router.push('/auth/register?plan=starter&trial=true');
      }
      return;
    }

    if (plan.checkoutType === 'stripe') {
      setLoading(plan.id);
      try {
        const meRes = await fetch('/api/auth/me');
        if (!meRes.ok) {
          router.push(`/auth/register?plan=${plan.id}`);
          return;
        }
        const res = await fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: plan.id }),
        });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          setError(data.error || 'Failed to create checkout session.');
        }
      } catch (e: unknown) {
        setError((e as Error).message || 'Something went wrong.');
      } finally {
        setLoading(null);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">

      {/* ── Nav bar ──────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
            <Zap className="w-5 h-5 text-black" />
          </div>
          <span className="font-bold text-lg">SolarPro</span>
        </Link>
        <Link href="/dashboard" className="text-slate-400 hover:text-white text-sm transition-colors">
          ← Back to Dashboard
        </Link>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-16">

        {/* ── Status banners ───────────────────────────────────────────────── */}
        {expired ? (
          <div className="mb-8 bg-red-900/30 border border-red-500/50 rounded-xl p-5 text-center">
            <p className="text-red-300 font-semibold text-lg mb-1">⏰ Your free trial has expired</p>
            <p className="text-red-400/80 text-sm">Choose a plan below to keep all your projects and data.</p>
          </div>
        ) : null}
        {canceled ? (
          <div className="mb-8 bg-slate-800 border border-slate-600 rounded-xl p-4 text-center text-slate-300">
            Checkout was canceled. No charges were made. Choose a plan below to continue.
          </div>
        ) : null}
        {error ? (
          <div className="mb-8 bg-red-900/40 border border-red-500 rounded-xl p-4 text-center text-red-300 flex items-center justify-center gap-2">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-white">✕</button>
          </div>
        ) : null}

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-1.5 text-amber-400 text-sm mb-6">
            <Star className="w-4 h-4" />
            Starter plan includes a 3-day free trial
          </div>
          <h1 className="text-5xl font-bold mb-4">Choose Your Plan</h1>
          <p className="text-slate-400 text-xl max-w-2xl mx-auto">
            From solo installers to large contracting firms — SolarPro scales with your business.
          </p>
          <p className="text-slate-500 text-sm mt-3">
            Additional users can be added as your team grows
          </p>
        </div>

        {/* ── Plan Cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
          {PLANS.map((plan) => {
            const styles = CARD_STYLES[plan.id] ?? CARD_STYLES.starter;
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border-2 ${styles.border} ${
                  plan.highlight
                    ? 'bg-slate-900/90 shadow-xl shadow-amber-500/10'
                    : 'bg-slate-900/60'
                } backdrop-blur p-6 flex flex-col`}
              >
                {/* Badge */}
                {plan.badge ? (
                  <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${styles.badge}`}>
                    ✦ {plan.badge}
                  </div>
                ) : null}
                {plan.id === 'starter' ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30 whitespace-nowrap">
                    3-Day Free Trial
                  </div>
                ) : null}

                {/* Plan name & description */}
                <div className="mb-4 mt-2">
                  <h2 className="text-xl font-bold mb-1">{plan.name}</h2>
                  <p className="text-slate-400 text-sm leading-snug">{plan.tagline}</p>
                </div>

                {/* Price */}
                <div className="mb-3">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{plan.priceLabel}</span>
                    <span className="text-slate-400 text-sm">{plan.period}</span>
                  </div>
                </div>

                {/* Seat info */}
                <div className="mb-4 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-sm">
                    <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-slate-300">{plan.seatLabel}</span>
                  </div>
                  {plan.extraSeatMsg ? (
                    <div className="text-xs text-slate-500 pl-5">{plan.extraSeatMsg}</div>
                  ) : null}
                  {plan.id === 'enterprise' ? (
                    <div className="flex items-center gap-1.5 text-sm">
                      <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-300">Unlimited users</span>
                    </div>
                  ) : null}
                </div>

                {/* CTA */}
                <button
                  onClick={() => handlePlanClick(plan)}
                  disabled={loading === plan.id}
                  className={`w-full py-3 px-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 mb-5 ${styles.cta} disabled:opacity-60`}
                >
                  {loading === plan.id ? (
                    <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  ) : (
                    <>
                      {plan.ctaLabel}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Contractor replacement message */}
                {plan.id === 'contractor' ? (
                  <p className="text-xs text-amber-400/80 text-center -mt-2 mb-4 leading-snug">
                    Replace $300–$1,000/month in solar software tools with one platform
                  </p>
                ) : null}

                {/* Features */}
                <div className="flex-1 space-y-2 border-t border-slate-700/50 pt-4">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                      <span className="text-slate-300">{f}</span>
                    </div>
                  ))}
                  {plan.notIncluded && plan.notIncluded.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-sm">
                      <X className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                      <span className="text-slate-600">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Seat scaling note ────────────────────────────────────────────── */}
        <p className="text-center text-slate-500 text-sm mb-16">
          Additional users can be added to any paid plan as your team grows
        </p>

        {/* ── Feature Comparison Toggle ────────────────────────────────────── */}
        <div className="text-center mb-6">
          <button
            onClick={() => setShowComparison(!showComparison)}
            className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm border border-slate-700 rounded-lg px-4 py-2"
          >
            {showComparison ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showComparison ? 'Hide' : 'Show'} Full Feature Comparison
          </button>
        </div>

        {/* ── Feature Comparison Table ─────────────────────────────────────── */}
        {showComparison ? (
          <div className="bg-slate-900/60 border border-slate-700 rounded-2xl overflow-hidden mb-16">
            <div className="p-6 border-b border-slate-700">
              <h2 className="text-2xl font-bold text-center">Feature Comparison</h2>
              <p className="text-slate-400 text-sm text-center mt-1">
                ✅ Full access &nbsp;&nbsp; ⚠️ Partial access &nbsp;&nbsp; ✗ Not included
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left p-4 text-slate-400 font-medium w-2/5">Feature</th>
                    <th className="text-center p-4 text-slate-300 font-medium">
                      <div>Starter</div>
                      <div className="text-slate-400 text-sm font-normal">$79/mo · 1 user</div>
                    </th>
                    <th className="text-center p-4 text-slate-300 font-medium">
                      <div>Professional</div>
                      <div className="text-slate-400 text-sm font-normal">$149/mo · 2 users</div>
                    </th>
                    <th className="text-center p-4 text-amber-400 font-medium">
                      <div>Contractor</div>
                      <div className="text-amber-400/70 text-sm font-normal">$249/mo · 2 users</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_TABLE.map((row, i) => (
                    <tr key={row.label} className={`border-b border-slate-800 ${i % 2 === 0 ? 'bg-slate-900/30' : ''}`}>
                      <td className="p-4 text-slate-300 text-sm">{row.label}</td>
                      <td className="p-4 text-center"><CompCell value={row.starter} /></td>
                      <td className="p-4 text-center"><CompCell value={row.professional} /></td>
                      <td className="p-4 text-center"><CompCell value={row.contractor} /></td>
                    </tr>
                  ))}
                  {/* Seat row */}
                  <tr className="border-b border-slate-800 bg-slate-900/30">
                    <td className="p-4 text-slate-300 text-sm font-medium">Team Members</td>
                    <td className="p-4 text-center text-sm text-slate-300">1 user</td>
                    <td className="p-4 text-center text-sm text-slate-300">Up to 2<br /><span className="text-xs text-slate-500">+$29/mo each</span></td>
                    <td className="p-4 text-center text-sm text-amber-300">2 included<br /><span className="text-xs text-slate-400">+$29/mo each</span></td>
                  </tr>
                  {/* Enterprise row */}
                  <tr className="bg-purple-900/10">
                    <td className="p-4 text-slate-300 text-sm font-semibold">Enterprise</td>
                    <td colSpan={3} className="p-4 text-center text-slate-400 text-sm">
                      Unlimited users · Multi-company · Custom integrations · API access ·{' '}
                      <Link href="/enterprise" className="text-purple-400 hover:underline">Contact Sales →</Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* ── Trust badges ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
          <div className="bg-slate-900/40 border border-slate-700 rounded-xl p-6">
            <Shield className="w-8 h-8 text-green-400 mx-auto mb-3" />
            <h3 className="font-semibold mb-1">Secure Payments</h3>
            <p className="text-slate-400 text-sm">Powered by Stripe. Your payment info is never stored on our servers.</p>
          </div>
          <div className="bg-slate-900/40 border border-slate-700 rounded-xl p-6">
            <Clock className="w-8 h-8 text-amber-400 mx-auto mb-3" />
            <h3 className="font-semibold mb-1">Cancel Anytime</h3>
            <p className="text-slate-400 text-sm">No long-term contracts. Cancel your subscription at any time.</p>
          </div>
          <div className="bg-slate-900/40 border border-slate-700 rounded-xl p-6">
            <Building2 className="w-8 h-8 text-blue-400 mx-auto mb-3" />
            <h3 className="font-semibold mb-1">Built for Solar Pros</h3>
            <p className="text-slate-400 text-sm">Designed specifically for solar installers and contracting firms.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
      </div>
    }>
      <SubscribePageInner />
    </Suspense>
  );
}
