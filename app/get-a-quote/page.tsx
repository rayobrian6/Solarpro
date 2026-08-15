'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  Sun, ArrowRight, CheckCircle2, AlertCircle,
  Phone, Mail, MapPin, MessageSquare, User,
  Zap, TrendingUp, Shield, Leaf,
  Loader2,
} from 'lucide-react';

// ─── Value props shown alongside the form ────────────────────────────────────

const VALUE_PROPS = [
  { icon: Zap,         label: 'Custom system design for your home' },
  { icon: TrendingUp,  label: 'Estimated savings before you commit' },
  { icon: Shield,      label: 'No pressure — just a free consultation' },
  { icon: Leaf,        label: 'Local solar experts, fast turnaround' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GetAQuotePage() {
  const [mounted,   setMounted]   = useState(false);
  const [name,      setName]      = useState('');
  const [email,     setEmail]     = useState('');
  const [phone,     setPhone]     = useState('');
  const [address,   setAddress]   = useState('');
  const [message,   setMessage]   = useState('');
  const [loading,   setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => { setTimeout(() => setMounted(true), 60); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimName  = name.trim();
    const trimEmail = email.trim().toLowerCase();
    const trimPhone = phone.trim();

    if (!trimName || trimName.length < 2) {
      setError('Please enter your full name.'); return;
    }
    if (!trimEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) {
      setError('Please enter a valid email address.'); return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/leads/public', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:    trimName,
          email:   trimEmail,
          phone:   trimPhone || undefined,
          address: address.trim() || undefined,
          message: message.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (res.status === 429) {
        setError('Too many submissions. Please wait a few minutes and try again.');
        return;
      }
      if (!d.success) {
        setError(d.error || 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Connection error. Please check your internet and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Success State ────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#07070e] flex items-center justify-center px-4">
        <div className={`text-center max-w-md transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          {/* Glow ring */}
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-emerald-500/10 animate-ping scale-[1.4]" />
            <div className="relative w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
          </div>

          <h1 className="text-2xl font-black text-white mb-2">Request received!</h1>
          <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
            Thanks — someone from our team will reach out within 1 business day to discuss your solar options.
          </p>

          <div className="mt-8 p-4 rounded-2xl border border-white/[0.05] bg-white/[0.02]">
            <p className="text-xs text-slate-600">
              Already have an account?{' '}
              <a href="/portal/login" className="text-amber-400 hover:text-amber-300 transition-colors font-medium">
                Log in to track your project →
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#07070e] text-white overflow-x-hidden">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-amber-500/[0.025] blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[350px] h-[350px] rounded-full bg-blue-600/[0.015] blur-[100px]" />
      </div>

      {/* NAV */}
      <header className="sticky top-0 z-30 border-b border-white/[0.05] bg-[#07070e]/95 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center group-hover:bg-amber-500/15 transition-colors">
              <Sun size={14} className="text-amber-400" />
            </div>
            <span className="text-sm font-bold text-white">SolarPro</span>
          </Link>
          <a
            href="/portal/login"
            className="text-xs text-slate-500 hover:text-slate-300 border border-white/[0.06] hover:border-white/[0.15] rounded-lg px-3 py-1.5 transition-all"
          >
            Track my project
          </a>
        </div>
      </header>

      <main className={`max-w-5xl mx-auto px-5 sm:px-8 py-14 relative z-10 transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">

          {/* ── Left: headline + value props ── */}
          <div className="lg:pt-4">
            <p className="text-xs font-black uppercase tracking-widest text-amber-500/60 mb-4">
              Free Solar Consultation
            </p>
            <h1 className="text-4xl sm:text-5xl font-black text-white leading-tight mb-5">
              Find out what solar{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-500">
                can do for you
              </span>
            </h1>
            <p className="text-base text-slate-400 leading-relaxed mb-10">
              Tell us a little about your home and we'll put together a custom solar estimate —
              no commitment required.
            </p>

            {/* Value props */}
            <ul className="space-y-4">
              {VALUE_PROPS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/8 border border-amber-500/12 flex items-center justify-center flex-shrink-0">
                    <Icon size={14} className="text-amber-400" />
                  </div>
                  <span className="text-sm text-slate-300">{label}</span>
                </li>
              ))}
            </ul>

            {/* Social proof badge */}
            <div className="mt-10 inline-flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="flex -space-x-1.5">
                {['bg-amber-500', 'bg-emerald-500', 'bg-blue-500'].map((c, i) => (
                  <div key={i} className={`w-6 h-6 rounded-full ${c} border-2 border-[#07070e]`} />
                ))}
              </div>
              <p className="text-xs text-slate-400">
                <span className="text-white font-semibold">Hundreds of homeowners</span> have gone solar with us
              </p>
            </div>
          </div>

          {/* ── Right: form ── */}
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-7 sm:p-9">
            <h2 className="text-lg font-black text-white mb-1">Get your free estimate</h2>
            <p className="text-xs text-slate-600 mb-7">We'll respond within 1 business day.</p>

            {error ? (
              <div className="flex items-start gap-2.5 rounded-xl bg-red-500/[0.08] border border-red-500/[0.15] px-4 py-3 mb-5">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Name */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input
                    type="text"
                    required
                    placeholder="Jane Smith"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.09] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 focus:bg-white/[0.06] transition-all"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.09] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 focus:bg-white/[0.06] transition-all"
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  Phone Number <span className="text-slate-700 normal-case tracking-normal font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Phone size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input
                    type="tel"
                    placeholder="(555) 000-0000"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.09] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 focus:bg-white/[0.06] transition-all"
                  />
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  Property Address <span className="text-slate-700 normal-case tracking-normal font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <MapPin size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="123 Main St, City, State"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.09] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 focus:bg-white/[0.06] transition-all"
                  />
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  Anything else? <span className="text-slate-700 normal-case tracking-normal font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <MessageSquare size={13} className="absolute left-3.5 top-3.5 text-slate-600 pointer-events-none" />
                  <textarea
                    rows={3}
                    placeholder="Tell us about your home, energy goals, or questions..."
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.09] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 focus:bg-white/[0.06] transition-all resize-none"
                  />
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className={`w-full flex items-center justify-center gap-2.5 rounded-xl py-3.5 font-bold text-sm transition-all ${
                  loading
                    ? 'bg-amber-500/20 border border-amber-500/20 text-amber-500/40 cursor-not-allowed'
                    : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30'
                }`}
              >
                {loading ? (
                  <><Loader2 size={14} className="animate-spin" /> Submitting…</>
                ) : (
                  <>Get My Free Estimate <ArrowRight size={14} /></>
                )}
              </button>

              <p className="text-[10px] text-slate-700 text-center leading-relaxed">
                By submitting, you agree to be contacted about your solar inquiry.
                We never share your information.
              </p>
            </form>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] mt-8">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6 flex items-center justify-center gap-3">
          <div className="h-px flex-1 bg-white/[0.03]" />
          <span className="text-[10px] text-white/10 flex items-center gap-1.5">
            <Sun size={9} className="text-amber-500/20" /> Powered by SolarPro
          </span>
          <div className="h-px flex-1 bg-white/[0.03]" />
        </div>
      </footer>

    </div>
  );
}