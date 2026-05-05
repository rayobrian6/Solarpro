'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sun, Mail, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';

export default function PortalLogin() {
  const router = useRouter();
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');

  // If already authed, skip to dashboard
  useEffect(() => {
    fetch('/api/portal/dashboard')
      .then(r => r.json())
      .then(d => { if (d.success) router.replace('/portal/dashboard'); })
      .catch(() => {});
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
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
      const d = await res.json();

      if (res.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
        return;
      }
      if (!d.success) {
        setError(d.error || 'Something went wrong. Please try again.');
        return;
      }

      // Login sets the cookie — redirect to dashboard
      // We use replace so back-button doesn't return to login
      router.replace('/portal/dashboard');
    } catch {
      setError('Connection error. Please check your internet and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-[#0a0a0f]">

      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-amber-500/5 blur-[120px]" />
      </div>

      <div className="w-full max-w-sm relative z-10">

        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
            <Sun size={28} className="text-amber-400" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Your Solar Project</h1>
          <p className="text-sm text-slate-400 mt-1.5 text-center">
            Enter your email to see your project status.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-slate-400 mb-1.5">
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
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600
                           focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30
                           disabled:opacity-50 transition-all"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400
                       text-black font-bold py-3 rounded-xl transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><Loader2 size={16} className="animate-spin" /> Signing in…</>
            ) : (
              <>View My Project <ArrowRight size={16} /></>
            )}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600 mt-8">
          Don't have a project yet?{' '}
          <a href="/" className="text-slate-500 hover:text-white transition-colors">
            Contact us
          </a>
        </p>
      </div>
    </div>
  );
}