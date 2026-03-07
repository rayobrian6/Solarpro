'use client';
import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Sun, CheckCircle, ArrowRight, X, Star, Zap, Shield,
  FileText, BarChart3, Users, Lock, CreditCard, Phone,
  AlertCircle, Building2
} from 'lucide-react';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 79,
    priceLabel: '$79',
    period: '/month',
    description: 'Perfect for solo solar installers getting started.',
    color: 'border-slate-600/60',
    headerBg: 'bg-slate-800/60',
    badge: null,
    badgeColor: '',
    trialLabel: '3-day free trial',
    features: [
      { text: '3D Solar Design Studio', included: true },
      { text: 'Up to 3 active projects', included: true },
      { text: 'Up to 10 clients', included: true },
      { text: 'PDF proposal generation', included: true },
      { text: 'Production analysis (NREL PVWatts)', included: true },
      { text: 'Google Solar API integration', included: true },
      { text: '19 utility rate calculators', included: true },
      { text: 'Engineering tools (SLD)', included: false },
      { text: 'Permit packet generation', included: false },
      { text: 'White-label branding', included: false },
    ],
    cta: 'Start Free Trial',
    ctaClass: 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600',
    checkoutType: 'trial',
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 199,
    priceLabel: '$199',
    period: '/month',
    description: 'For growing solar install teams that need full engineering.',
    color: 'border-amber-500/60',
    headerBg: 'bg-gradient-to-br from-amber-500/20 to-orange-500/10',
    badge: 'Most Popular',
    badgeColor: 'bg-amber-500 text-slate-900',
    trialLabel: null,
    features: [
      { text: 'Everything in Starter', included: true },
      { text: 'Unlimited projects & clients', included: true },
      { text: 'Full engineering calculations (SLD)', included: true },
      { text: 'Permit packet generation', included: true },
      { text: 'Structural calculations', included: true },
      { text: 'Sol Fence design', included: true },
      { text: 'BOM generation', included: true },
      { text: 'Proposal e-signing', included: true },
      { text: 'White-label branding', included: true },
      { text: 'Priority support', included: true },
    ],
    cta: 'Subscribe',
    ctaClass: 'bg-amber-500 hover:bg-amber-400 text-slate-900',
    checkoutType: 'stripe',
  },
  {
    id: 'contractor',
    name: 'Contractor',
    price: 399,
    priceLabel: '$399',
    period: '/month',
    description: 'For large contracting firms with teams and high volume.',
    color: 'border-blue-500/40',
    headerBg: 'bg-gradient-to-br from-blue-500/20 to-indigo-500/10',
    badge: 'Best Value',
    badgeColor: 'bg-blue-500 text-white',
    trialLabel: null,
    features: [
      { text: 'Everything in Professional', included: true },
      { text: 'Unlimited team members', included: true },
      { text: 'Bulk proposal generation', included: true },
      { text: 'Advanced automation tools', included: true },
      { text: 'Custom proposal templates', included: true },
      { text: 'API access', included: true },
      { text: 'Dedicated onboarding', included: true },
      { text: 'SLA support', included: true },
    ],
    cta: 'Subscribe',
    ctaClass: 'bg-blue-500 hover:bg-blue-400 text-white',
    checkoutType: 'stripe',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    priceLabel: 'Custom',
    period: ' pricing',
    description: 'For multi-company operations needing custom solutions.',
    color: 'border-purple-500/40',
    headerBg: 'bg-gradient-to-br from-purple-500/20 to-violet-500/10',
    badge: 'Custom',
    badgeColor: 'bg-purple-500 text-white',
    trialLabel: null,
    features: [
      { text: 'Everything in Contractor', included: true },
      { text: 'Multi-company accounts', included: true },
      { text: 'Custom integrations', included: true },
      { text: 'Dedicated account manager', included: true },
      { text: 'Custom SLA', included: true },
      { text: 'On-premise deployment option', included: true },
      { text: 'Volume discounts', included: true },
      { text: 'White-glove onboarding', included: true },
    ],
    cta: 'Contact Sales',
    ctaClass: 'bg-purple-600 hover:bg-purple-500 text-white',
    checkoutType: 'contact',
  },
];

function SubscribePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('canceled') === 'true') {
      setError('Checkout was canceled. You can try again anytime.');
    }
    if (searchParams.get('subscription') === 'success') {
      setSuccessMsg('🎉 Subscription activated! Welcome to SolarPro.');
    }
  }, [searchParams]);

  const handlePlanClick = async (planId: string, checkoutType: string) => {
    setError(null);
    setLoading(planId);

    if (checkoutType === 'contact') {
      router.push('/enterprise');
      return;
    }

    if (checkoutType === 'trial') {
      // Start free trial — just redirect to register/dashboard
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.success) {
          // Already logged in — activate trial
          router.push('/dashboard?trial=started');
        } else {
          // Not logged in — go to register
          router.push('/auth/register?plan=starter&trial=true');
        }
      } catch {
        router.push('/auth/register?plan=starter&trial=true');
      }
      setLoading(null);
      return;
    }

    if (checkoutType === 'stripe') {
      try {
        const res = await fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        });
        const data = await res.json();
        setLoading(null);

        if (data.success && data.url) {
          window.location.href = data.url;
        } else if (res.status === 401) {
          router.push(`/auth/register?plan=${planId}`);
        } else {
          setError(data.error || 'Failed to start checkout. Please try again.');
        }
      } catch (err) {
        setLoading(null);
        setError('Something went wrong. Please try again.');
      }
      return;
    }

    setLoading(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl solar-gradient flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Sun size={18} className="text-slate-900" />
            </div>
            <div>
              <div className="font-black text-white text-sm leading-tight">SolarPro</div>
              <div className="text-amber-400 text-xs font-medium">Design Platform</div>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-slate-400 hover:text-white text-sm transition-colors">
              Dashboard
            </Link>
            <Link href="/account/billing" className="text-slate-400 hover:text-white text-sm transition-colors flex items-center gap-1">
              <CreditCard size={14} /> Billing
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-16">
        {/* Alerts */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8 flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm">
            <AlertCircle size={16} className="flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X size={14} /></button>
          </div>
        )}
        {successMsg && (
          <div className="max-w-2xl mx-auto mb-8 flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-sm">
            <CheckCircle size={16} className="flex-shrink-0" />
            {successMsg}
          </div>
        )}

        {/* Hero */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-4">
            <Star size={12} /> Starter plan includes a 3-day free trial
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">
            Choose Your Plan
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            From solo installers to large contracting firms — SolarPro scales with your business.
          </p>
        </div>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-16">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border-2 overflow-hidden flex flex-col transition-all duration-200 ${plan.color} hover:scale-[1.01]`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className="absolute top-4 right-4">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${plan.badgeColor}`}>
                    <Star size={9} /> {plan.badge}
                  </span>
                </div>
              )}

              {/* Header */}
              <div className={`p-6 ${plan.headerBg}`}>
                <h3 className="text-xl font-black text-white mb-1">{plan.name}</h3>
                <p className="text-slate-400 text-xs mb-4 leading-relaxed">{plan.description}</p>
                <div className="flex items-end gap-0.5">
                  <span className="text-3xl font-black text-white">{plan.priceLabel}</span>
                  <span className="text-slate-400 text-sm mb-1">{plan.period}</span>
                </div>
                {plan.trialLabel && (
                  <div className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
                    <CheckCircle size={10} /> {plan.trialLabel}
                  </div>
                )}
              </div>

              {/* Features */}
              <div className="p-6 bg-slate-900/40 flex-1 flex flex-col">
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className={`flex items-start gap-2 text-xs ${f.included ? 'text-slate-200' : 'text-slate-600'}`}>
                      {f.included
                        ? <CheckCircle size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                        : <X size={13} className="text-slate-700 flex-shrink-0 mt-0.5" />
                      }
                      {f.text}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePlanClick(plan.id, plan.checkoutType)}
                  disabled={loading === plan.id}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${plan.ctaClass} disabled:opacity-60`}
                >
                  {loading === plan.id ? (
                    <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Processing...</>
                  ) : (
                    <>{plan.cta} <ArrowRight size={13} /></>
                  )}
                </button>

                {plan.trialLabel && (
                  <p className="text-center text-xs text-slate-600 mt-2">No credit card required</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Feature comparison table */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-8 mb-16 overflow-x-auto">
          <h2 className="text-xl font-black text-white text-center mb-8">Full Feature Comparison</h2>
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left text-slate-400 font-semibold pb-4 pr-4">Feature</th>
                <th className="text-center text-slate-400 font-semibold pb-4 px-3">Starter<br/><span className="text-xs font-normal text-slate-500">$79/mo</span></th>
                <th className="text-center text-amber-400 font-semibold pb-4 px-3">Professional<br/><span className="text-xs font-normal text-amber-400/60">$199/mo</span></th>
                <th className="text-center text-blue-400 font-semibold pb-4 px-3">Contractor<br/><span className="text-xs font-normal text-blue-400/60">$399/mo</span></th>
                <th className="text-center text-purple-400 font-semibold pb-4 px-3">Enterprise<br/><span className="text-xs font-normal text-purple-400/60">Custom</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {[
                ['3D Design Studio', true, true, true, true],
                ['Projects', '3', 'Unlimited', 'Unlimited', 'Unlimited'],
                ['Clients', '10', 'Unlimited', 'Unlimited', 'Unlimited'],
                ['Engineering (SLD)', false, true, true, true],
                ['Permit Packets', false, true, true, true],
                ['Structural Calcs', false, true, true, true],
                ['Sol Fence Design', false, true, true, true],
                ['BOM Generation', false, true, true, true],
                ['Proposal E-Signing', false, true, true, true],
                ['White-Label Branding', false, true, true, true],
                ['Team Members', '1', 'Up to 3', 'Unlimited', 'Unlimited'],
                ['Bulk Proposals', false, false, true, true],
                ['API Access', false, false, true, true],
                ['Multi-Company', false, false, false, true],
                ['Dedicated Support', false, false, true, true],
                ['Free Trial', '3 days', false, false, false],
              ].map(([feature, starter, pro, contractor, enterprise], i) => (
                <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 pr-4 text-slate-300 text-sm">{feature as string}</td>
                  {[starter, pro, contractor, enterprise].map((val, j) => (
                    <td key={j} className="py-3 px-3 text-center">
                      {val === true
                        ? <CheckCircle size={15} className="text-emerald-400 mx-auto" />
                        : val === false
                        ? <span className="text-slate-700">—</span>
                        : <span className="text-slate-300 text-xs font-medium">{val as string}</span>
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Included in all plans */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-8 mb-16">
          <h2 className="text-xl font-black text-white text-center mb-8">Included in every plan</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: <Zap size={20} />, title: '3D Design Studio', desc: 'Google Maps + satellite imagery', color: 'text-amber-400' },
              { icon: <FileText size={20} />, title: 'PDF Proposals', desc: 'Professional branded proposals', color: 'text-blue-400' },
              { icon: <BarChart3 size={20} />, title: 'Production Analytics', desc: 'NREL PVWatts calculations', color: 'text-emerald-400' },
              { icon: <Shield size={20} />, title: 'Incentive Info', desc: 'State & commercial incentives', color: 'text-purple-400' },
              { icon: <Users size={20} />, title: 'Client Management', desc: 'Full CRM for solar clients', color: 'text-teal-400' },
              { icon: <Sun size={20} />, title: 'Google Solar API', desc: 'AI roof segment detection', color: 'text-orange-400' },
              { icon: <Lock size={20} />, title: 'Secure & Private', desc: 'Your data stays yours', color: 'text-rose-400' },
              { icon: <CreditCard size={20} />, title: 'Cancel Anytime', desc: 'No long-term contracts', color: 'text-indigo-400' },
            ].map(item => (
              <div key={item.title} className="text-center">
                <div className={`flex justify-center mb-2 ${item.color}`}>{item.icon}</div>
                <div className="text-sm font-bold text-white mb-1">{item.title}</div>
                <div className="text-xs text-slate-500">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Enterprise CTA */}
        <div className="bg-gradient-to-br from-purple-500/10 to-violet-500/5 border border-purple-500/20 rounded-2xl p-8 text-center mb-12">
          <Building2 size={32} className="text-purple-400 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-white mb-2">Need a custom solution?</h2>
          <p className="text-slate-400 mb-6 max-w-lg mx-auto">
            Multi-company accounts, custom integrations, dedicated support, and volume pricing — built for large contracting operations.
          </p>
          <Link
            href="/enterprise"
            className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold px-6 py-3 rounded-xl transition-all"
          >
            Talk to Sales <ArrowRight size={14} />
          </Link>
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-slate-500 text-sm mb-2">
            Questions? Email us at{' '}
            <a href="mailto:sales@underthesun.solutions" className="text-amber-400 hover:text-amber-300">
              sales@underthesun.solutions
            </a>
          </p>
          <Link href="/dashboard" className="text-slate-600 hover:text-slate-400 text-sm transition-colors">
            Continue without a subscription →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <SubscribePageInner />
    </Suspense>
  );
}
