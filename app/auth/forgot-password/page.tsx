'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Sun, Mail, ArrowRight, ArrowLeft, CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [sent, setSent]       = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return setError('Please enter your email address.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return setError('Please enter a valid email address.');
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'Something went wrong. Please try again.');
        setLoading(false);
        return;
      }

      // Always show success — regardless of whether email exists (security)
      setSent(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (sent) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl solar-gradient flex items-center justify-center shadow-lg shadow-amber-500/30">
                <Sun size={24} className="text-slate-900" />
              </div>
              <div className="text-left">
                <div className="font-black text-white text-xl leading-tight">SolarPro</div>
                <div className="text-amber-400 text-xs font-medium">Design Platform</div>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8 backdrop-blur-sm text-center">
            {/* Success icon */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 mb-6">
              <CheckCircle size={32} className="text-green-400" />
            </div>

            <h1 className="text-2xl font-black text-white mb-3">Check Your Email</h1>
            <p className="text-slate-400 text-sm leading-relaxed mb-2">
              If an account exists for <span className="text-amber-400 font-medium">{email}</span>,
              we&apos;ve sent a password reset link.
            </p>
            <p className="text-slate-500 text-xs leading-relaxed mb-8">
              The link will expire in 1 hour. Check your spam folder if you don&apos;t see it.
            </p>

            <div className="space-y-3">
              <Link
                href="/auth/login"
                className="flex items-center justify-center gap-2 w-full btn-primary py-3 font-bold"
              >
                <ArrowLeft size={16} />
                Back to Sign In
              </Link>
              <button
                type="button"
                onClick={() => { setSent(false); setEmail(''); }}
                className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors py-2"
              >
                Try a different email
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Form state ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl solar-gradient flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Sun size={24} className="text-slate-900" />
            </div>
            <div className="text-left">
              <div className="font-black text-white text-xl leading-tight">SolarPro</div>
              <div className="text-amber-400 text-xs font-medium">Design Platform</div>
            </div>
          </div>
          <h1 className="text-3xl font-black text-white mb-2">Forgot Password?</h1>
          <p className="text-slate-400 text-sm">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email field */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">
                Email Address
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(''); }}
                  placeholder="you@company.com"
                  autoComplete="email"
                  autoFocus
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                />
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-3 text-base font-bold justify-center mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><span className="spinner w-4 h-4" /> Sending Reset Link…</>
              ) : (
                <>Send Reset Link <ArrowRight size={16} /></>
              )}
            </button>
          </form>
        </div>

        {/* Back to login */}
        <div className="text-center mt-6">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ArrowLeft size={14} />
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}