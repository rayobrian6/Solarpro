'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Sun, Lock, Eye, EyeOff, ArrowRight, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

// ── Password strength helper ──────────────────────────────────────────────────
function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (pw.length === 0) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' };
  if (score <= 2) return { score, label: 'Fair', color: 'bg-amber-500' };
  if (score <= 3) return { score, label: 'Good', color: 'bg-yellow-400' };
  return { score, label: 'Strong', color: 'bg-green-500' };
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const token        = searchParams.get('token') || '';

  const [form, setForm]           = useState({ password: '', confirm: '' });
  const [showPw, setShowPw]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);

  // Token validation state
  const [tokenState, setTokenState] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [tokenError, setTokenError] = useState('');

  const strength = getPasswordStrength(form.password);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setTokenState('invalid');
      setTokenError('No reset token found. Please request a new password reset link.');
      return;
    }

    async function checkToken() {
      try {
        const res = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (data.valid) {
          setTokenState('valid');
        } else {
          setTokenState('invalid');
          setTokenError(data.error || 'This reset link is invalid or has expired.');
        }
      } catch {
        setTokenState('invalid');
        setTokenError('Unable to validate reset link. Please try again.');
      }
    }

    checkToken();
  }, [token]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.password) return setError('Please enter a new password.');
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    if (form.password !== form.confirm) return setError('Passwords do not match.');

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password: form.password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to reset password. Please try again.');
        setLoading(false);
        return;
      }

      setSuccess(true);
      // Auto-redirect to login after 3 seconds
      setTimeout(() => router.push('/auth/login'), 3000);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setLoading(false);
    }
  };

  // ── Wrapper layout ─────────────────────────────────────────────────────────
  const PageShell = ({ children }: { children: React.ReactNode }) => (
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
        {children}
      </div>
    </div>
  );

  // ── Checking token ─────────────────────────────────────────────────────────
  if (tokenState === 'checking') {
    return (
      <PageShell>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8 backdrop-blur-sm text-center">
          <RefreshCw size={32} className="text-amber-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Validating reset link…</p>
        </div>
      </PageShell>
    );
  }

  // ── Invalid token ──────────────────────────────────────────────────────────
  if (tokenState === 'invalid') {
    return (
      <PageShell>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8 backdrop-blur-sm text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 mb-6">
            <XCircle size={32} className="text-red-400" />
          </div>
          <h1 className="text-2xl font-black text-white mb-3">Link Expired or Invalid</h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-8">
            {tokenError}
          </p>
          <Link
            href="/auth/forgot-password"
            className="flex items-center justify-center gap-2 w-full btn-primary py-3 font-bold"
          >
            Request a New Reset Link <ArrowRight size={16} />
          </Link>
          <div className="mt-4">
            <Link href="/auth/login" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
              Back to Sign In
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <PageShell>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8 backdrop-blur-sm text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 mb-6">
            <CheckCircle size={32} className="text-green-400" />
          </div>
          <h1 className="text-2xl font-black text-white mb-3">Password Reset!</h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-2">
            Your password has been successfully updated.
          </p>
          <p className="text-slate-500 text-xs mb-8">
            Redirecting you to sign in…
          </p>
          <Link
            href="/auth/login"
            className="flex items-center justify-center gap-2 w-full btn-primary py-3 font-bold"
          >
            Sign In Now <ArrowRight size={16} />
          </Link>
        </div>
      </PageShell>
    );
  }

  // ── Reset form ─────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <div className="text-center mb-6">
        <h1 className="text-3xl font-black text-white mb-2">Create New Password</h1>
        <p className="text-slate-400 text-sm">
          Choose a strong password for your account.
        </p>
      </div>

      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8 backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* New Password */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">
              New Password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                name="password"
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                autoFocus
                className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-10 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {/* Password strength bar */}
            {form.password.length > 0 && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">
                  {[1,2,3,4,5].map(i => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-all ${
                        i <= strength.score ? strength.color : 'bg-slate-700'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Strength: <span className={`font-medium ${
                    strength.score <= 1 ? 'text-red-400' :
                    strength.score <= 2 ? 'text-amber-400' :
                    strength.score <= 3 ? 'text-yellow-400' : 'text-green-400'
                  }`}>{strength.label}</span>
                </p>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">
              Confirm New Password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                name="confirm"
                type={showConfirm ? 'text' : 'password'}
                value={form.confirm}
                onChange={handleChange}
                placeholder="Repeat your new password"
                autoComplete="new-password"
                className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-10 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {/* Match indicator */}
            {form.confirm.length > 0 && (
              <p className={`text-xs mt-1.5 ${form.password === form.confirm ? 'text-green-400' : 'text-red-400'}`}>
                {form.password === form.confirm ? '✓ Passwords match' : '✗ Passwords do not match'}
              </p>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary py-3 text-base font-bold justify-center mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><span className="spinner w-4 h-4" /> Updating Password…</>
            ) : (
              <>Set New Password <ArrowRight size={16} /></>
            )}
          </button>
        </form>
      </div>

      <div className="text-center mt-6">
        <Link href="/auth/login" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
          Back to Sign In
        </Link>
      </div>
    </PageShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}