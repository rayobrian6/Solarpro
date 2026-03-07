'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Check, X, Star, Zap, Building2, ArrowRight,
  Shield, Clock, ChevronDown, ChevronUp
} from 'lucide-react';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 79,
    priceLabel: '$79',
    period: '/month',
    badge: null,
    badgeColor: '',
    trialLabel: '3-day free trial',
    description: 'Perfect for solo solar installers getting started.',
    checkoutType: 'trial',
    ctaLabel: 'Start Free Trial',
    ctaNote: 'No credit card required',
    borderColor: 'border-slate-600',
    ctaClass: 'bg-slate-700 hover:bg-slate-600 text-white',
    features: [
      'Basic 3D Solar Design Studio',
      'Up to 2 active projects',
      'Up to 5 clients',
      'Preview proposals only',
      'Production analysis (NREL PVWatts)',
      'Google Solar API integration',
      'Utility rate calculators',
      'Email support',
    ],
    notIncluded: [
      'Engineering calculations (SLD)',
      'Permit packet generation',
      'Structural calculations',
      'BOM generation',
      'Proposal e-signing',
      'White-label branding',
      'Sol Fence design',
      'API access',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 149,
    priceLabel: '$149',
    period: '/month',
    badge: 'Most Popular',
    badgeColor: 'bg-amber-500 text-black',
    trialLabel: null,
    description: 'For growing solar install teams that need full engineering.',
    checkoutType: 'stripe',
    ctaLabel: 'Subscribe',
    ctaNote: null,
    borderColor: 'border-amber-500',
    ctaClass: 'bg-amber-500 hover:bg-amber-400 text-black font-bold',
    features: [
      'Everything in Starter',
      'Unlimited projects & clients',
      'Full engineering calculations (SLD)',
      'Permit packet generation',
      'Structural calculations',
      'BOM generation',
      'Proposal e-signing',
      'White-label branding',
      'Battery system design',
      'Priority support',
    ],
    notIncluded: [],
  },
  {
    id: 'contractor',
    name: 'Contractor',
    price: 250,
    priceLabel: '$250',
    period: '/month',
    badge: 'Best Value',
    badgeColor: 'bg-blue-500 text-white',
    trialLabel: null,
    description: 'For large contracting firms with teams and high volume.',
    checkoutType: 'stripe',
    ctaLabel: 'Subscribe',
    ctaNote: null,
    borderColor: 'border-blue-500',
    ctaClass: 'bg-blue-500 hover:bg-blue-400 text-white font-bold',
    features: [
      'Everything in Professional',
      'Unlimited team members',
      'Bulk proposal generation',
      'Advanced automation tools',
      'Custom proposal templates',
      'Sol Fence design',
      'API access',
      'Dedicated onboarding',
      'SLA support',
    ],
    notIncluded: [],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    priceLabel: 'Custom',
    period: ' pricing',
    badge: 'Custom',
    badgeColor: 'bg-purple-600 text-white',
    trialLabel: null,
    description: 'For multi-company operations needing custom solutions.',
    checkoutType: 'contact',
    ctaLabel: 'Contact Sales',
    ctaNote: null,
    borderColor: 'border-purple-600',
    ctaClass: 'bg-purple-600 hover:bg-purple-500 text-white font-bold',
    features: [
      'Everything in Contractor',
      'Multi-company accounts',
      'Custom integrations',
      'Private API access',
      'Enterprise security controls',
      'Dedicated account manager',
      'Custom SLA',
      'On-premise deployment option',
      'Volume discounts',
      'White-glove onboarding',
    ],
    notIncluded: [],
  },
];

const COMPARISON_FEATURES = [
  { label: 'Active Projects',         starter: '2',    pro: 'Unlimited', contractor: 'Unlimited', enterprise: 'Unlimited' },
  { label: 'Clients',                 starter: '5',    pro: 'Unlimited', contractor: 'Unlimited', enterprise: 'Unlimited' },
  { label: '3D Solar Design',         starter: true,   pro: true,        contractor: true,         enterprise: true },
  { label: 'Proposals',               starter: 'Preview only', pro: true, contractor: true,        enterprise: true },
  { label: 'Engineering (SLD)',        starter: false,  pro: true,        contractor: true,         enterprise: true },
  { label: 'Permit Packets',          starter: false,  pro: true,        contractor: true,         enterprise: true },
  { label: 'Structural Calculations', starter: false,  pro: true,        contractor: true,         enterprise: true },
  { label: 'BOM Generation',          starter: false,  pro: true,        contractor: true,         enterprise: true },
  { label: 'Proposal E-Signing',      starter: false,  pro: true,        contractor: true,         enterprise: true },
  { label: 'White-Label Branding',    starter: false,  pro: true,        contractor: true,         enterprise: true },
  { label: 'Battery System Design',   starter: false,  pro: true,        contractor: true,         enterprise: true },
  { label: 'Sol Fence Design',        starter: false,  pro: false,       contractor: true,         enterprise: true },
  { label: 'Bulk Proposals',          starter: false,  pro: false,       contractor: true,         enterprise: true },
  { label: 'API Access',              starter: false,  pro: false,       contractor: true,         enterprise: true },
  { label: 'Team Members',            starter: '1',    pro: 'Up to 3',   contractor: 'Unlimited',  enterprise: 'Unlimited' },
  { label: 'Multi-Company',           starter: false,  pro: false,       contractor: false,        enterprise: true },
  { label: 'Dedicated Onboarding',    starter: false,  pro: false,       contractor: true,         enterprise: true },
  { label: 'SLA Support',             starter: false,  pro: false,       contractor: true,         enterprise: true },
  { label: 'Support',                 starter: 'Email', pro: 'Priority', contractor: 'Dedicated',  enterprise: 'White-glove' },
];

function FeatureCell({ value }: { value: boolean | string }) {
  if (value === true) return <Check className="w-5 h-5 text-green-400 mx-auto" />;
  if (value === false) return <X className="w-4 h-4 text-slate-600 mx-auto" />;
  return <span className="text-sm text-slate-300">{value}</span>;
}

function SubscribePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canceled = searchParams.get('canceled');
  const expired = searchParams.get('expired');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const handlePlanClick = async (plan: typeof PLANS[0]) => {
    setError(null);

    if (plan.checkoutType === 'contact') {
      router.push('/enterprise');
      return;
    }

    if (plan.checkoutType === 'trial') {
      // Check if logged in
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
      } catch (e: any) {
        setError(e.message || 'Something went wrong.');
      } finally {
        setLoading(null);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      {/* Header */}
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
        {/* Trial expired banner */}
        {expired && (
          <div className="mb-8 bg-red-900/30 border border-red-500/50 rounded-xl p-5 text-center">
            <p className="text-red-300 font-semibold text-lg mb-1">⏰ Your free trial has expired</p>
            <p className="text-red-400/80 text-sm">Choose a plan below to continue using SolarPro and keep all your projects and data.</p>
          </div>
        )}

        {/* Canceled banner */}
        {canceled && (
          <div className="mb-8 bg-slate-800 border border-slate-600 rounded-xl p-4 text-center text-slate-300">
            Checkout was canceled. No charges were made. Choose a plan below to continue.
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-8 bg-red-900/40 border border-red-500 rounded-xl p-4 text-center text-red-300 flex items-center justify-center gap-2">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Hero */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-1.5 text-amber-400 text-sm mb-6">
            <Star className="w-4 h-4" />
            Starter plan includes a 3-day free trial
          </div>
          <h1 className="text-5xl font-bold mb-4">Choose Your Plan</h1>
          <p className="text-slate-400 text-xl max-w-2xl mx-auto">
            From solo installers to large contracting firms — SolarPro scales with your business.
          </p>
        </div>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-16">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border-2 ${plan.borderColor} bg-slate-900/60 backdrop-blur p-6 flex flex-col`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold ${plan.badgeColor}`}>
                  ✦ {plan.badge}
                </div>
              )}

              {/* Plan name & description */}
              <div className="mb-4">
                <h2 className="text-xl font-bold mb-1">{plan.name}</h2>
                <p className="text-slate-400 text-sm">{plan.description}</p>
              </div>

              {/* Price */}
              <div className="mb-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">{plan.priceLabel}</span>
                  <span className="text-slate-400 text-sm">{plan.period}</span>
                </div>
                {plan.trialLabel && (
                  <div className="mt-2 inline-flex items-center gap-1 bg-green-500/20 text-green-400 text-xs px-2 py-1 rounded-full">
                    <Clock className="w-3 h-3" />
                    {plan.trialLabel}
                  </div>
                )}
              </div>

              {/* CTA Button */}
              <button
                onClick={() => handlePlanClick(plan)}
                disabled={loading === plan.id}
                className={`w-full py-3 px-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 mb-6 ${plan.ctaClass} disabled:opacity-60`}
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
              {plan.ctaNote && (
                <p className="text-center text-slate-500 text-xs -mt-4 mb-4">{plan.ctaNote}</p>
              )}

              {/* Features */}
              <div className="flex-1 space-y-2">
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
          ))}
        </div>

        {/* Feature Comparison Toggle */}
        <div className="text-center mb-6">
          <button
            onClick={() => setShowComparison(!showComparison)}
            className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm border border-slate-700 rounded-lg px-4 py-2"
          >
            {showComparison ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showComparison ? 'Hide' : 'Show'} Full Feature Comparison
          </button>
        </div>

        {/* Feature Comparison Table */}
        {showComparison && (
          <div className="bg-slate-900/60 border border-slate-700 rounded-2xl overflow-hidden mb-16">
            <div className="p-6 border-b border-slate-700">
              <h2 className="text-2xl font-bold text-center">Full Feature Comparison</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left p-4 text-slate-400 font-medium w-1/3">Feature</th>
                    <th className="text-center p-4 text-slate-300 font-medium">
                      <div>Starter</div>
                      <div className="text-amber-400 text-sm font-bold">$79/mo</div>
                    </th>
                    <th className="text-center p-4 text-amber-400 font-medium">
                      <div>Professional</div>
                      <div className="text-amber-400 text-sm font-bold">$149/mo</div>
                    </th>
                    <th className="text-center p-4 text-blue-400 font-medium">
                      <div>Contractor</div>
                      <div className="text-blue-400 text-sm font-bold">$250/mo</div>
                    </th>
                    <th className="text-center p-4 text-purple-400 font-medium">
                      <div>Enterprise</div>
                      <div className="text-purple-400 text-sm font-bold">Custom</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_FEATURES.map((row, i) => (
                    <tr key={row.label} className={`border-b border-slate-800 ${i % 2 === 0 ? 'bg-slate-900/30' : ''}`}>
                      <td className="p-4 text-slate-300 text-sm">{row.label}</td>
                      <td className="p-4 text-center"><FeatureCell value={row.starter} /></td>
                      <td className="p-4 text-center"><FeatureCell value={row.pro} /></td>
                      <td className="p-4 text-center"><FeatureCell value={row.contractor} /></td>
                      <td className="p-4 text-center"><FeatureCell value={row.enterprise} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Trust badges */}
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