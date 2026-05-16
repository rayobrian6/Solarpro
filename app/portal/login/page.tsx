'use client';

/**
 * Portal Login — Two-step OTP flow
 *
 * Step 1: Enter email → POST /api/portal/login  → OTP emailed
 * Step 2: Enter 6-digit code → POST /api/portal/verify-otp → JWT cookie issued
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sun, Mail, ArrowRight, AlertCircle, KeyRound,
  Loader2, Shield, Zap, TrendingUp, Leaf, CheckCircle2,
  RefreshCw,
} from 'lucide-react';

type Step = 'email' | 'otp';

export default function PortalLogin() {
  const router = useRouter();

  const [step,    setStep]    = useState<Step>('email');
  const [email,   setEmail]   = useState('');
  const [otp,     setOtp]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [resent,  setResent]  = useState(false);
  const [mounted, setMounted] = useState(false);

  // Six individual digit boxes for the OTP
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Already logged in? Skip to dashboard
    fetch('/api/portal/dashboard')
      .then(r => r.json())
      .then(d => { if (d.success) router.replace('/portal/dashboard'); })
      .catch(() => {});
    setTimeout(() => setMounted(true), 80);
  }, [router]);

  // ─── Step 1: Request OTP ──────────────────────────────────────────────────
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/portal/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: trimmed }),
      });
      if (res.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
        return;
      }
      // Always move to OTP step regardless of whether the email exists
      // (prevents enumeration — user sees same UX either way)
      setStep('otp');
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => digitRefs.current[0]?.focus(), 150);
    } catch {
      setError('Connection error. Please check your internet and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 2: Submit OTP ───────────────────────────────────────────────────
  const submitOtp = async (code: string) => {
    if (code.length !== 6) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/portal/verify-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase(), code }),
      });
      const d = await res.json();
      if (res.status === 429) {
        setError('Too many attempts. Please wait 15 minutes.');
        return;
      }
      if (!d.success) {
        setError(d.error || 'Invalid or expired code. Please try again.');
        setDigits(['', '', '', '', '', '']);
        setTimeout(() => digitRefs.current[0]?.focus(), 100);
        return;
      }
      router.replace('/portal/dashboard');
    } catch {
      setError('Connection error. Please check your internet and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── OTP digit box handlers ───────────────────────────────────────────────
  const handleDigitChange = (index: number, value: string) => {
    // Allow paste of full 6-digit code
    if (value.length > 1) {
      const clean = value.replace(/\D/g, '').slice(0, 6);
      if (clean.length === 6) {
        const arr = clean.split('');
        setDigits(arr);
        digitRefs.current[5]?.focus();
        void submitOtp(clean);
        return;
      }
    }
    const char = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < 5) {
      digitRefs.current[index + 1]?.focus();
    }
    const code = next.join('');
    if (code.length === 6 && !next.includes('')) {
      void submitOtp(code);
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index] === '' && index > 0) {
        digitRefs.current[index - 1]?.focus();
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
      } else {
        const next = [...digits];
        next[index] = '';
        setDigits(next);
      }
    }
  };

  // ─── Resend OTP ───────────────────────────────────────────────────────────
  const handleResend = async () => {
    if (resent || loading) return;
    setError('');
    setLoading(true);
    try {
      await fetch('/api/portal/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setResent(true);
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => { setResent(false); }, 30_000); // re-enable after 30s
      setTimeout(() => digitRefs.current[0]?.focus(), 100);
    } catch {
      setError('Could not resend. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Feature list ─────────────────────────────────────────────────────────
  const features = [
    { icon: Zap,        label: 'Track your project in real time' },
    { icon: TrendingUp, label: 'View estimated savings & impact' },
    { icon: Shield,     label: 'Secure, private homeowner portal' },
    { icon: Leaf,       label: 'Monitor your clean energy progress' },
  ];

  return (
    <div className="min-h-screen flex bg-[#07070e] overflow-hidden">

      {/* ── LEFT PANEL (desktop only) ── */}
      <div className="hidden lg:flex lg:w-[52%] relative flex-col justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-900/20 via-[#07070e] to-[#07070e]" />
        <div className="absolute inset-0">
          <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] rounded-full bg-amber-500/[0.06] blur-[130px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] rounded-full bg-orange-600/[0.04] blur-[100px]" />
        </div>
        <div className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400/30 to-amber-600/10 border border-amber-500/25 flex items-center justify-center">
            <Sun size={20} className="text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">Under the Sun Solar</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Homeowner Portal</p>
          </div>
        </div>

        {/* Hero copy */}
        <div className="relative z-10 -mt-20">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-500/60 mb-4">✦ Your Solar Journey</p>
          <h1 className="text-5xl font-black text-white leading-[1.05] tracking-tight mb-5">
            Welcome to<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400">
              Clean Energy.
            </span>
          </h1>
          <p className="text-slate-400 text-base leading-relaxed max-w-sm mb-8">
            Track your solar installation, view your projected savings, and stay updated every step of the way — all in one place.
          </p>
          <div className="space-y-3">
            {features.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 transition-all duration-500"
                style={{
                  opacity:    mounted ? 1 : 0,
                  transform:  mounted ? 'translateX(0)' : 'translateX(-16px)',
                  transitionDelay: `${i * 80 + 200}ms`,
                }}
              >
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center flex-shrink-0">
                  <f.icon size={14} className="text-amber-400" />
                </div>
                <span className="text-sm text-slate-300">{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trust bar */}
        <div className="relative z-10 flex items-center gap-4 pt-6 border-t border-white/[0.06]">
          {[
            { val: '500+', label: 'Homeowners' },
            { val: '4.9★', label: 'Avg Rating' },
            { val: '25yr', label: 'Warranty' },
          ].map((item, i) => (
            <div key={i} className="flex-1 text-center">
              <p className="text-lg font-black text-amber-400">{item.val}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="hidden lg:block w-px bg-gradient-to-b from-transparent via-white/[0.07] to-transparent" />

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 sm:px-10 py-16 relative">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-amber-500/[0.025] blur-[100px]" />
        </div>

        <div
          className="w-full max-w-sm relative z-10 transition-all duration-500"
          style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(24px)' }}
        >
          {/* Mobile logo */}
          <div className="flex flex-col items-center mb-10 lg:hidden">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/25 to-amber-600/10 border border-amber-500/25 flex items-center justify-center">
                <Sun size={28} className="text-amber-400" />
              </div>
              <div className="absolute inset-0 rounded-2xl bg-amber-500/10 animate-pulse" />
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">Under the Sun Solar</h2>
            <p className="text-sm text-slate-400 mt-1 text-center">Homeowner Portal</p>
          </div>

          {/* ─── STEP 1: Email ─── */}
          {step === 'email' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-black text-white tracking-tight">Sign In</h2>
                <p className="text-sm text-slate-400 mt-1.5">
                  Enter your email and we'll send you a one-time login code.
                </p>
              </div>

              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError(''); }}
                      placeholder="you@example.com"
                      disabled={loading}
                      className="w-full bg-white/[0.04] border border-white/[0.09] rounded-xl pl-10 pr-4 py-3.5 text-sm text-white placeholder-slate-600
                                 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20
                                 hover:border-white/[0.14] hover:bg-white/[0.05]
                                 disabled:opacity-50 transition-all duration-200"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 text-sm text-red-400 bg-red-500/[0.08] border border-red-500/[0.18] rounded-xl px-4 py-3">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full flex items-center justify-center gap-2
                             bg-gradient-to-r from-amber-500 to-amber-400
                             hover:from-amber-400 hover:to-amber-300
                             text-black font-black py-3.5 rounded-xl transition-all duration-200
                             shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 hover:shadow-xl
                             disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                             active:scale-[0.98]"
                >
                  {loading
                    ? <><Loader2 size={16} className="animate-spin" /> Sending code…</>
                    : <>Send Login Code <ArrowRight size={16} /></>
                  }
                </button>
              </form>

              {/* Trust row */}
              <div className="mt-8 space-y-3">
                <div className="h-px bg-white/[0.05]" />
                <div className="flex items-center justify-center gap-5 pt-1">
                  {[
                    { icon: Shield,       label: 'Secure login' },
                    { icon: CheckCircle2, label: 'No password needed' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <item.icon size={12} />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ─── STEP 2: OTP ─── */}
          {step === 'otp' && (
            <>
              <div className="mb-8">
                {/* Icon */}
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5">
                  <KeyRound size={22} className="text-amber-400" />
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight">Check your email</h2>
                <p className="text-sm text-slate-400 mt-1.5">
                  We sent a 6-digit code to{' '}
                  <span className="text-amber-400 font-semibold">{email}</span>.
                  Enter it below — it expires in 10 minutes.
                </p>
              </div>

              {/* 6-box OTP input */}
              <div className="flex gap-2.5 justify-center mb-6">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={el => { digitRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={6}           // allow paste
                    value={d}
                    onChange={e => handleDigitChange(i, e.target.value)}
                    onKeyDown={e => handleDigitKeyDown(i, e)}
                    onFocus={e => e.target.select()}
                    disabled={loading}
                    className={`
                      w-12 h-14 text-center text-xl font-black rounded-xl
                      bg-white/[0.04] border transition-all duration-150
                      text-white caret-amber-400
                      focus:outline-none focus:ring-1 focus:ring-amber-500/40
                      disabled:opacity-40
                      ${d
                        ? 'border-amber-500/50 bg-amber-500/[0.06]'
                        : 'border-white/[0.09] hover:border-white/[0.18]'
                      }
                    `}
                  />
                ))}
              </div>

              {error && (
                <div className="flex items-start gap-2.5 text-sm text-red-400 bg-red-500/[0.08] border border-red-500/[0.18] rounded-xl px-4 py-3 mb-4">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {loading && (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-400 mb-4">
                  <Loader2 size={14} className="animate-spin" />
                  Verifying…
                </div>
              )}

              {/* Resend + back */}
              <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                <button
                  type="button"
                  onClick={() => { setStep('email'); setError(''); setDigits(['', '', '', '', '', '']); }}
                  className="hover:text-slate-300 transition-colors"
                >
                  ← Change email
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resent || loading}
                  className="flex items-center gap-1.5 hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw size={11} />
                  {resent ? 'Code sent!' : 'Resend code'}
                </button>
              </div>

              {/* Trust row */}
              <div className="mt-8 space-y-3">
                <div className="h-px bg-white/[0.05]" />
                <div className="flex items-center justify-center gap-5 pt-1">
                  {[
                    { icon: Shield,       label: 'Expires in 10 min' },
                    { icon: CheckCircle2, label: 'Single use only' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <item.icon size={12} />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <p className="text-center text-xs text-slate-600 mt-6">
            Don't have a project yet?{' '}
            <a href="/" className="text-slate-500 hover:text-amber-400 transition-colors font-medium">
              Get a free quote →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
