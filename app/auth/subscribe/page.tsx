'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sun, CheckCircle, ArrowRight, Zap, Shield,
  Star, Users, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  PRICING_PLANS,
  PLAN_FEATURES,
  PLAN_DISPLAY,
  formatSeatLimit,
  formatExtraSeatMsg,
} from '@/lib/pricing.config';
import { useToast } from "@/components/ui/Toast";

// ─── Plans derived from the single source of truth ──────────────────────────

type AuthPlan = {
  id: string;
  name: string;
  price: number;
  description: string;
  seatLabel: string;
  extraSeatMsg: string | null;
  features: { text: string; included: boolean }[];
  cta: string;
  highlight: boolean;
  badge: string | null;
  color: string;
  headerColor: string;
};

const PLANS: AuthPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: PRICING_PLANS.starter.price!,
    description: 'For solo installers getting started.',
    seatLabel: formatSeatLimit('starter'),
    extraSeatMsg: formatExtraSeatMsg('starter'),
    features: [
      ...PLAN_FEATURES.starter.included.map(t => ({ text: t, included: true })),
      ...PLAN_FEATURES.starter.notIncluded.map(t => ({ text: t, included: false })),
    ],
    cta: 'Start 3-Day Free Trial',
    highlight: false,
    badge: '3-Day Free Trial',
    color: 'border-slate-600',
    headerColor: 'bg-slate-800',
  },
  {
    id: 'professional',
    name: 'Professional',
    price: PRICING_PLANS.professional.price!,
    description: 'For growing installers running real volume.',
    seatLabel: formatSeatLimit('professional'),
    extraSeatMsg: formatExtraSeatMsg('professional'),
    features: PLAN_FEATURES.professional.included.map(t => ({ text: t, included: true })),
    cta: 'Get Professional',
    highlight: false,
    badge: null,
    color: 'border-slate-500/60',
    headerColor: 'bg-slate-800',
  },
  {
    id: 'contractor',
    name: 'Contractor',
    price: PRICING_PLANS.contractor.price!,
    description: 'Full platform for serious solar companies.',
    seatLabel: formatSeatLimit('contractor'),
    extraSeatMsg: formatExtraSeatMsg('contractor'),
    features: PLAN_FEATURES.contractor.included.map(t => ({ text: t, included: true })),
    cta: 'Get Contractor — Most Popular',
    highlight: true,
    badge: 'Most Popular',
    color: 'border-amber-500',
    headerColor: 'bg-gradient-to-br from-amber-500/20 to-orange-500/10',
  },
];

const FAQS = [
  { q: 'Can I cancel anytime?', a: 'Yes. Cancel anytime from your account settings. No cancellation fees.' },
  { q: 'What is proposal e-signing?', a: 'Professional and Contractor plans include a unique shareable link for each proposal. Clients can review and digitally sign online — no DocuSign needed.' },
  { q: 'Is there a free trial?', a: 'Yes — the Starter plan includes a 3-day free trial. No credit card required to start.' },
  { q: 'How do additional users work?', a: 'Professional and Contractor plans include 2 users. You can add more team members for $29/month each as your team grows.' },
  { q: 'Do you offer annual billing?', a: 'Yes — pay annually and save 20%. Contact us for annual pricing.' },
  { q: 'What is Sol Fence design?', a: 'Sol Fence is a vertical bifacial solar fence system. SolarPro is the only platform that supports fence-mounted solar design with specialized layout algorithms.' },
];

export default function SubscribePage() {
  const router = useRouter();
  const toast = useToast();
  const [selectedPlan, setSelectedPlan] = useState('contractor');
  const [loading, setLoading] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleSubscribe = async (planId: string) => {
    setSelectedPlan(planId);

    if (planId === 'starter') {
      router.push('/auth/register?plan=starter&trial=true');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok && data.success && data.url) {
        window.location.href = data.url;
        return;
      }
      // A failed checkout must NEVER grant dashboard access. If the user isn't
      // authenticated yet, send them to register with the chosen plan; otherwise
      // surface the error.
      if (res.status === 401) {
        router.push(`/auth/register?plan=${planId}`);
      } else {
        toast.error(data.error || 'Could not start checkout. Please try again.');
      }
    } catch {
      setLoading(false);
      toast.error('Could not start checkout. Please check your connection and try again.');
    }
  };

  // Annual billing is NOT supported by /api/stripe/checkout (it charges the
  // monthly price regardless), so the displayed price must always be the monthly
  // price that is actually charged — no phantom 20% discount.
  const getPrice = (base: number) => base;

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

      <div className="max-w-6xl mx-auto px-6 py-16">

        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-4">
            <Star size={12} /> Starter plan includes a 3-day free trial — no credit card required
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">Choose Your Plan</h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-2">
            Unlock professional proposals, engineering automation, and the full platform.
          </p>
          <p className="text-slate-500 text-sm">Additional users can be added as your team grows</p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border-2 overflow-hidden transition-all duration-200 ${plan.color} ${
                selectedPlan === plan.id ? 'scale-[1.02] shadow-2xl shadow-amber-500/10' : 'hover:scale-[1.01]'
              }`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className={`absolute top-0 right-0 px-3 py-1 text-xs font-bold rounded-bl-xl ${
                  plan.id === 'contractor' ? 'bg-amber-500 text-slate-900' : 'bg-green-500/20 text-green-400'
                }`}>
                  {plan.badge}
                </div>
              )}

              <div className={`p-6 ${plan.headerColor}`}>
                <h3 className="text-xl font-black text-white mb-1">{plan.name}</h3>
                <p className="text-slate-400 text-sm mb-4">{plan.description}</p>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-4xl font-black text-white">${getPrice(plan.price)}</span>
                  <span className="text-slate-400 text-sm mb-1.5">/month</span>
                </div>

                {/* Seat info */}
                <div className="flex items-center gap-1.5 mb-1">
                  <Users size={13} className="text-slate-400" />
                  <span className="text-slate-300 text-sm">{plan.seatLabel}</span>
                </div>
                {plan.extraSeatMsg && (
                  <p className="text-xs text-slate-500 pl-5 mb-1">{plan.extraSeatMsg}</p>
                )}

                {/* Contractor replacement message */}
                {plan.id === 'contractor' && (
                  <p className="text-xs text-amber-400/80 mt-2 leading-snug">
                    Replace $300–$1,000/month in solar software tools with one platform
                  </p>
                )}
              </div>

              <div className="p-6 pt-4">
                {/* Features */}
                <div className="space-y-2 mb-6">
                  {plan.features.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      {f.included
                        ? <CheckCircle size={15} className="text-green-400 mt-0.5 shrink-0" />
                        : <X size={14} className="text-slate-600 mt-0.5 shrink-0" />
                      }
                      <span className={f.included ? 'text-slate-300' : 'text-slate-600'}>{f.text}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <button
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={loading && selectedPlan === plan.id}
                  className={`w-full py-3 px-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                    plan.id === 'contractor'
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-900 shadow-lg shadow-amber-500/25'
                      : plan.id === 'starter'
                      ? 'bg-slate-700 hover:bg-slate-600 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                  } disabled:opacity-60`}
                >
                  {loading && selectedPlan === plan.id
                    ? <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                    : <>{plan.cta} <ArrowRight size={14} /></>
                  }
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Seat scaling note */}
        <p className="text-center text-slate-500 text-sm mb-16">
          Additional users can be added to any paid plan as your team grows
        </p>

        {/* What's included in all plans */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-2xl p-8 mb-16">
          <h2 className="text-xl font-black text-white text-center mb-8">Included in every paid plan</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: <Zap size={20} />, label: '3D Design Studio' },
              { icon: <Shield size={20} />, label: 'Secure Data Storage' },
              { icon: <CheckCircle size={20} />, label: 'Regular Updates' },
              { icon: <Users size={20} />, label: 'Customer Support' },
            ].map(({ icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400">
                  {icon}
                </div>
                <span className="text-slate-300 text-sm font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-black text-white text-center mb-8">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/50 transition-colors"
                >
                  <span className="font-semibold text-white text-sm">{faq.q}</span>
                  {openFaq === i
                    ? <ChevronUp size={16} className="text-slate-400 shrink-0" />
                    : <ChevronDown size={16} className="text-slate-400 shrink-0" />
                  }
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4 text-slate-400 text-sm">{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
