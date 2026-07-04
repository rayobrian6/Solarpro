'use client';
/**
 * MFA Challenge Page — /auth/mfa
 *
 * After successful password authentication, MFA-enrolled users are redirected
 * here to complete TOTP or recovery code verification. The login route issues
 * a short-lived MFA pending cookie (5-min TTL) that this page uses to verify.
 *
 * SECURITY:
 *   - The MFA pending cookie does NOT grant application access
 *   - Only after TOTP/recovery verification is a full session issued
 *   - No lockout scenario — rate limiting (10/5min) protects against brute force
 *   - Recovery codes are never logged or stored
 */

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Sun, Shield, Key, ArrowRight, AlertTriangle,
  RefreshCw, Loader2, HelpCircle,
} from 'lucide-react';

function MFAChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [mfaMethod, setMfaMethod] = useState<string>('totp');

  const codeInputRef = useRef<HTMLInputElement>(null);

  // MFA method from URL param (set by login redirect)
  useEffect(() => {
    const method = searchParams.get('method') || 'totp';
    setMfaMethod(method);
    // Auto-focus the code input
    setTimeout(() => codeInputRef.current?.focus(), 100);
  }, [searchParams]);

  // ─── Verify TOTP code ──────────────────────────────────────────────
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid verification code. Please try again.');
        setCode('');
        codeInputRef.current?.focus();
        return;
      }

      // MFA verification successful — redirect to intended page
      const redirect = searchParams.get('redirect') || '/dashboard';
      window.location.href = redirect;
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Verify recovery code ───────────────────────────────────────────
  const handleVerifyRecovery = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!recoveryCode || recoveryCode.length < 6) {
      setError('Please enter a recovery code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recovery_code: recoveryCode.toUpperCase() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid recovery code. Please try again.');
        setRecoveryCode('');
        return;
      }

      // Recovery code accepted — user should re-enroll
      if (data.should_reenroll) {
        // Redirect to settings security tab to re-enroll
        window.location.href = '/settings?tab=security';
      } else {
        const redirect = searchParams.get('redirect') || '/dashboard';
        window.location.href = redirect;
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Back to login ──────────────────────────────────────────────────
  const handleBackToLogin = () => {
    // Clear the MFA pending cookie by navigating away
    router.push('/auth/login');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Header */}
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
          <h1 className="text-3xl font-black text-white mb-2">Two-Factor Authentication</h1>
          <p className="text-slate-400 text-sm">
            Enter the code from your authenticator app to continue
          </p>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 sm:p-8 backdrop-blur-sm">
          {/* Shield icon */}
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <Shield size={28} className="text-blue-400" />
            </div>
          </div>

          {/* TOTP Code Form */}
          {!showRecovery ? (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium text-center">
                  Verification Code
                </label>
                <input
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCode(val);
                    if (error) setError('');
                  }}
                  placeholder="000000"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-4 text-center text-2xl tracking-[0.4em] font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                  disabled={loading}
                  autoFocus
                />
              </div>

              {/* Error banner */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={code.length !== 6 || loading}
                className="w-full btn-primary py-3 text-base font-bold justify-center mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading
                  ? (<><span className="spinner w-4 h-4" /> Verifying…</>)
                  : (<>Verify <ArrowRight size={16} /></>)
                }
              </button>

              {/* Switch to recovery code */}
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => { setShowRecovery(true); setError(''); }}
                  className="text-xs text-slate-400 hover:text-slate-300 transition-colors underline underline-offset-2"
                >
                  <HelpCircle size={12} className="inline mr-1" />
                  Use a recovery code instead
                </button>
              </div>
            </form>
          ) : (
            /* Recovery Code Form */
            <form onSubmit={handleVerifyRecovery} className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 mb-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-400 text-sm font-medium">Recovery mode</p>
                    <p className="text-amber-400/70 text-xs mt-0.5">
                      Each recovery code can only be used once. After using a code, you should
                      re-enroll your authenticator device.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">
                  Recovery Code
                </label>
                <input
                  type="text"
                  value={recoveryCode}
                  onChange={(e) => {
                    setRecoveryCode(e.target.value.toUpperCase());
                    if (error) setError('');
                  }}
                  placeholder="Enter recovery code"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 text-center text-lg tracking-[0.2em] font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                  disabled={loading}
                  autoFocus
                />
              </div>

              {/* Error banner */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={!recoveryCode || loading}
                className="w-full btn-primary py-3 text-base font-bold justify-center mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading
                  ? (<><span className="spinner w-4 h-4" /> Verifying…</>)
                  : (<>Verify Recovery Code <Key size={16} /></>)
                }
              </button>

              {/* Back to TOTP */}
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => { setShowRecovery(false); setError(''); }}
                  className="text-xs text-slate-400 hover:text-slate-300 transition-colors underline underline-offset-2"
                >
                  Use authenticator code instead
                </button>
              </div>
            </form>
          )}

          {/* Back to login */}
          <div className="text-center pt-4 mt-4 border-t border-slate-700/50">
            <button
              onClick={handleBackToLogin}
              className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
            >
              ← Back to login
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          <Shield size={12} className="inline mr-1" />Secured with 256-bit encryption. We never share your data.
        </p>
      </div>
    </div>
  );
}

export default function MFAChallengePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Loading...
        </div>
      </div>
    }>
      <MFAChallengeForm />
    </Suspense>
  );
}
