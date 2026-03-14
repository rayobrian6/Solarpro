'use client';
import React, { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sun, Eye, EyeOff, ArrowRight, Mail, Lock, CheckCircle, RefreshCw } from 'lucide-react';

// ── How many times the UI will auto-retry a DB_STARTING 503 ──────────────────
const MAX_AUTO_RETRIES    = 5;
const RETRY_BASE_DELAY_MS = 3000; // 3s, 4.5s, 6s, 7.5s, 9s

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [starting,     setStarting]     = useState(false); // DB cold-start state
  const [countdown,    setCountdown]    = useState(0);     // seconds until next retry
  const [form, setForm] = useState({ email: '', password: '', remember: false });

  const retryCountRef    = useRef(0);
  const retryTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFormRef      = useRef(form);

  const redirect = searchParams.get('redirect') || '/dashboard';

  // Keep lastFormRef in sync so the retry closure sees the current values
  useEffect(() => { lastFormRef.current = form; }, [form]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current)    clearTimeout(retryTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    // Clear errors when user edits fields — but keep "starting" state intact
    if (error && !starting) setError('');
  };

  /**
   * Core submit — separated from handleSubmit so it can be called by the
   * auto-retry path with the same credentials after a DB_STARTING 503.
   */
  async function attemptLogin(email: string, password: string): Promise<'success' | 'auth_error' | 'db_starting' | 'db_config' | 'network_error'> {
    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        return 'success';
      }

      // 503 with DB_STARTING code = Neon cold start, auto-retry
      if (res.status === 503 && data.code === 'DB_STARTING') {
        return 'db_starting';
      }

      // 503 with DB_CONFIG_ERROR = genuine misconfiguration, don't retry
      if (res.status === 503 && data.code === 'DB_CONFIG_ERROR') {
        return 'db_config';
      }

      // 400/401/500 = real auth or server error
      setError(data.error || 'Login failed. Please try again.');
      return 'auth_error';

    } catch {
      return 'network_error';
    }
  }

  /**
   * Schedules an auto-retry after `delayMs` ms, updating the countdown
   * timer so the user sees "Retrying in Xs…"
   */
  function scheduleRetry(email: string, password: string, delayMs: number) {
    // Start countdown display
    let remaining = Math.ceil(delayMs / 1000);
    setCountdown(remaining);

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0 && countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }, 1000);

    // Schedule the actual retry
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(async () => {
      retryTimerRef.current = null;
      setCountdown(0);
      const result = await attemptLogin(email, password);
      handleAttemptResult(result, email, password);
    }, delayMs);
  }

  /**
   * Handles the result of an attemptLogin() call — either advances the
   * retry sequence or resolves to success/failure.
   */
  function handleAttemptResult(
    result: 'success' | 'auth_error' | 'db_starting' | 'db_config' | 'network_error',
    email: string,
    password: string
  ) {
    if (result === 'success') {
      setStarting(false);
      setLoading(false);
      // FIX: Do NOT call router.refresh() here. router.refresh() triggers
      // a new /api/auth/me fetch immediately — before the browser has
      // finished processing the Set-Cookie header from the login response.
      // The cookie isn't in the jar yet, so /api/auth/me returns 401 and
      // UserContext logs the user out. router.push() is sufficient: the
      // full page navigation to /dashboard will trigger a fresh /api/auth/me
      // call via UserContext.useEffect on mount, by which time the cookie
      // is guaranteed to be set.
      router.push(redirect);
      return;
    }

    if (result === 'db_starting') {
      retryCountRef.current += 1;

      if (retryCountRef.current <= MAX_AUTO_RETRIES) {
        // Still retrying — keep the "Starting server…" banner
        setStarting(true);
        setLoading(false);
        // Gentle exponential back-off: 3s, 4.5s, 6s, 7.5s, 9s
        const delay = RETRY_BASE_DELAY_MS * (1 + (retryCountRef.current - 1) * 0.5);
        scheduleRetry(email, password, delay);
      } else {
        // Gave up — show a manual-retry error
        setStarting(false);
        setLoading(false);
        setError('Server is taking longer than expected to start. Please try again.');
      }
      return;
    }

    if (result === 'db_config') {
      setStarting(false);
      setLoading(false);
      setError('Database not configured. Please contact your administrator.');
      return;
    }

    if (result === 'network_error') {
      setStarting(false);
      setLoading(false);
      setError('Network error. Please check your connection and try again.');
      return;
    }

    // 'auth_error' — setError already called inside attemptLogin
    setStarting(false);
    setLoading(false);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) return setError('Email and password are required.');

    // Cancel any pending retry
    if (retryTimerRef.current)    clearTimeout(retryTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    retryCountRef.current = 0;

    setLoading(true);
    setError('');
    setStarting(false);
    setCountdown(0);

    const result = await attemptLogin(form.email, form.password);
    handleAttemptResult(result, form.email, form.password);
  };

  // ── Manual "Try again" when auto-retry gave up ──────────────────────────
  const handleManualRetry = () => {
    retryCountRef.current = 0;
    setError('');
    handleSubmit({ preventDefault: () => {} } as React.FormEvent);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
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
          <h1 className="text-3xl font-black text-white mb-2">Welcome back</h1>
          <p className="text-slate-400 text-sm">
            Don&apos;t have an account?{' '}
            <Link href="/auth/register" className="text-amber-400 hover:text-amber-300 font-medium transition-colors">
              Sign up free
            </Link>
          </p>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">Email Address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  name="email" type="email" value={form.email} onChange={handleChange}
                  placeholder="you@company.com" autoComplete="email"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium mb-1.5 block">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  name="password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={handleChange}
                  placeholder="Your password" autoComplete="current-password"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-10 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${form.remember ? 'bg-amber-500 border-amber-500' : 'border-slate-600 group-hover:border-slate-500'}`}>
                {form.remember && <CheckCircle size={12} className="text-slate-900" />}
              </div>
              <input name="remember" type="checkbox" checked={form.remember} onChange={handleChange} className="sr-only" />
              <span className="text-sm text-slate-400">Remember me for 30 days</span>
            </label>

            {/* ── DB cold-start banner ──────────────────────────────────── */}
            {starting && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 text-amber-400 text-sm font-medium mb-1">
                  <RefreshCw size={14} className="animate-spin flex-shrink-0" />
                  Starting server — please wait…
                </div>
                <p className="text-amber-400/70 text-xs">
                  {countdown > 0
                    ? `Retrying in ${countdown}s (attempt ${retryCountRef.current}/${MAX_AUTO_RETRIES})…`
                    : 'Connecting to database…'}
                </p>
              </div>
            )}

            {/* ── Error banner ─────────────────────────────────────────── */}
            {error && !starting && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                <p className="text-red-400 text-sm">{error}</p>
                {error.includes('taking longer') && (
                  <button
                    type="button"
                    onClick={handleManualRetry}
                    className="mt-2 text-xs text-red-300 hover:text-red-200 underline underline-offset-2 transition-colors"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || starting}
              className="w-full btn-primary py-3 text-base font-bold justify-center mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading || starting
                ? (<><span className="spinner w-4 h-4" /> {starting ? 'Starting server…' : 'Signing in…'}</>)
                : (<>Sign In <ArrowRight size={16} /></>)
              }
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          🔒 Secured with 256-bit encryption. We never share your data.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}