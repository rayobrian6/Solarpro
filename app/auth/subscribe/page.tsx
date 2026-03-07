'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sun, CheckCircle, ArrowRight, Zap, Shield, FileText,
  Star, Users, BarChart3, Lock, CreditCard, X
} from 'lucide-react';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 79,
    period: 'month',
    description: 'Perfect for solo solar installers getting started.',
    color: 'border-slate-600',
    headerColor: 'bg-slate-800',
    badge: null,
    features: [
      { text: '3D Solar Design Studio', included: true },
      { text: 'Up to 10 active projects', included: true },
      { text: 'Up to 25 clients', included: true },
      { text: 'PDF proposal generation', included: true },
      { text: 'Production analysis (NREL PVWatts)', included: true },
      { text: 'Google Solar API integration', included: true },
      { text: 'Proposal e-signing', included: false },
      { text: 'White-label branding', included: false },
      { text: 'Team members', included: false },
      { text: 'Priority support', included: false },
    ],
    cta: 'Start with Starter',
    ctaStyle: 'btn-secondary',
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 149,
    period: 'month',
    description: 'For growing solar install teams that need more power.',
    color: 'border-amber-500/60',
    headerColor: 'bg-gradient-to-br from-amber-500/20 to-orange-500/10',
    badge: 'Most Popular',
    features: [
      { text: '3D Solar Design Studio', included: true },
      { text: 'Unlimited projects & clients', included: true },
      { text: 'Electrical engineering (SLD)', included: true },
      { text: 'Sol Fence design', included: true },
      { text: 'BOM + structural calcs', included: true },
      { text: 'PDF permit packages', included: true },
      { text: 'Proposal e-signing', included: true },
      { text: 'White-label branding', included: true },
      { text: 'Priority support', included: true },
      { text: 'Team members (up to 3)', included: false },
    ],
    cta: 'Start Professional — Most Popular',
    ctaStyle: 'btn-primary',
  },
  {
    id: 'contractor',
    name: 'Contractor',
    price: 249,
    period: 'month',
    description: 'For large contracting firms with teams and high volume.',
    color: 'border-blue-500/40',
    headerColor: 'bg-gradient-to-br from-blue-500/20 to-indigo-500/10',
    badge: 'Best Value',
    features: [
      { text: '3D Solar Design Studio', included: true },
      { text: 'Unlimited projects & clients', included: true },
      { text: 'Electrical engineering (SLD)', included: true },
      { text: 'Sol Fence design', included: true },
      { text: 'BOM + structural calcs', included: true },
      { text: 'PDF permit packages', included: true },
      { text: 'Proposal e-signing', included: true },
      { text: 'White-label branding & logo upload', included: true },
      { text: 'Unlimited team members', included: true },
      { text: 'Dedicated onboarding + SLA support', included: true },
    ],
    cta: 'Start Contractor Plan',
    ctaStyle: 'btn-secondary',
  },
];

const FAQS = [
  { q: 'Can I cancel anytime?', a: 'Yes. Cancel anytime from your account settings. No cancellation fees, no questions asked.' },
  { q: 'What is proposal e-signing?', a: 'Professional and Contractor plans include a unique shareable link for each proposal. Clients can review and digitally sign the proposal online — no DocuSign needed.' },
  { q: 'Is there a free trial?', a: 'Yes — all plans include a 3-day free trial. No credit card required to start.' },
  { q: 'What does white-label branding mean?', a: 'Replace the SolarPro logo with your company logo and colors on all proposals and client-facing documents. Upload your logo in Settings → Branding.' },
  { q: 'Do you offer annual billing?', a: 'Yes — pay annually and save 20%. Contact us for annual pricing.' },
  { q: 'What is Sol Fence design?', a: 'Sol Fence is a vertical bifacial solar fence system. SolarPro is the only platform that supports fence-mounted solar design with specialized layout algorithms.' },
];

export default function SubscribePage() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState('professional');
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleSubscribe = async (planId: string) => {
    setSelectedPlan(planId);
    setLoading(true);
    // Call Stripe checkout API
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();

      setLoading(false);

      if (data.success && data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } else {
        // Payment not configured yet — redirect to dashboard with trial
        console.warn('Stripe checkout not configured:', data.error);
        router.push('/dashboard?subscription=trial');
      }
    } catch (err) {
      setLoading(false);
      console.error('Checkout error:', err);
      // Fallback to dashboard
      router.push('/dashboard?subscription=error');
    }
  };

  const getPrice = (basePrice: number) => {
    if (billing === 'annual') return Math.round(basePrice * 0.8);
    return basePrice;
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
          <Link href="/dashboard" className="text-slate-400 hover:text-white text-sm transition-colors flex items-center gap-1">
            Skip for now →
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-4">
            <Star size={12} /> 3-day free trial — no credit card required
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">
            Choose Your Plan
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
            Unlock professional proposals, e-signing, and white-label branding. Cancel anytime.
          </p>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-1 bg-slate-800/60 border border-slate-700 rounded-xl p-1">
            <button
              onClick={() => setBilling('monthly')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                billing === 'monthly' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                billing === 'annual' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'
              }`}
            >
              Annual
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                billing === 'annual' ? 'bg-slate-900/30 text-slate-900' : 'bg-emerald-500/20 text-emerald-400'
              }`}>Save 20%</span>
            </button>
          </div>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border-2 overflow-hidden transition-all duration-200 ${plan.color} ${
                selectedPlan === plan.id ? 'scale-[1.02] shadow-2xl shadow-amber-500/10' : 'hover:scale-[1.01]'
              }`}
            >
              {plan.badge && (
                <div className="absolute top-4 right-4">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500 text-slate-900">
                    <Star size={10} /> {plan.badge}
                  </span>
                </div>
              )}

              {/* Header */}
              <div className={`p-6 ${plan.headerColor}`}>
                <h3 className="text-xl font-black text-white mb-1">{plan.name}</h3>
                <p className="text-slate-400 text-sm mb-4">{plan.description}</p>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-black text-white">${getPrice(plan.price)}</span>
                  <span className="text-slate-400 text-sm mb-1.5">/{plan.period}</span>
                </div>
                {billing === 'annual' && (
                  <div className="text-xs text-emerald-400 font-medium mt-1">
                    Save ${(plan.price - getPrice(plan.price)) * 12}/year
                  </div>
                )}
              </div>

              {/* Features */}
              <div className="p-6 bg-slate-900/40">
                <ul className="space-y-2.5 mb-6">
                  {plan.features.map((f, i) => (
                    <li key={i} className={`flex items-center gap-2.5 text-sm ${f.included ? 'text-slate-200' : 'text-slate-600'}`}>
                      {f.included
                        ? <CheckCircle size={15} className="text-emerald-400 flex-shrink-0" />
                        : <X size={15} className="text-slate-700 flex-shrink-0" />
                      }
                      {f.text}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={loading && selectedPlan === plan.id}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                    plan.id === 'professional'
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-900'
                      : 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600'
                  }`}
                >
                  {loading && selectedPlan === plan.id ? (
                    <><span className="spinner w-4 h-4" /> Processing...</>
                  ) : (
                    <>{plan.cta} <ArrowRight size={14} /></>
                  )}
                </button>

                <p className="text-center text-xs text-slate-600 mt-3">
                  3-day free trial · No credit card required
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* What's included in all plans */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-8 mb-16">
          <h2 className="text-xl font-black text-white text-center mb-8">Everything included in every plan</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: <Zap size={20} />, title: '3D Design Studio', desc: 'Google Maps + satellite imagery', color: 'text-amber-400' },
              { icon: <FileText size={20} />, title: 'PDF Proposals', desc: 'Professional branded proposals', color: 'text-blue-400' },
              { icon: <BarChart3 size={20} />, title: 'Production Analytics', desc: 'NREL PVWatts calculations', color: 'text-emerald-400' },
              { icon: <Shield size={20} />, title: 'Incentive + SREC Info', desc: 'State & commercial incentives', color: 'text-purple-400' },
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

        {/* FAQ */}
        <div className="max-w-2xl mx-auto mb-16">
          <h2 className="text-2xl font-black text-white text-center mb-8">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-700/30 transition-colors"
                >
                  <span className="font-semibold text-white text-sm">{faq.q}</span>
                  <span className={`text-slate-400 transition-transform ${openFaq === i ? 'rotate-45' : ''}`}>+</span>
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4 text-sm text-slate-400 leading-relaxed border-t border-slate-700/50 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center">
          <p className="text-slate-500 text-sm mb-4">
            Questions? Email us at{' '}
            <a href="mailto:hello@solarpro.app" className="text-amber-400 hover:text-amber-300">hello@solarpro.app</a>
          </p>
          <Link href="/dashboard" className="text-slate-500 hover:text-slate-400 text-sm transition-colors">
            Continue without a subscription →
          </Link>
        </div>
      </div>
    </div>
  );
}