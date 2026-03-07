'use client';
import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sun, Eye, EyeOff, ArrowRight, Mail, Lock, CheckCircle } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', password: '', remember: false });

  const redirect = searchParams.get('redirect') || '/dashboard';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) return setError('Email and password are required.');
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, password: form.password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Login failed. Please try again.');
        setLoading(false);
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
      setLoading(false);
    }
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

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
            )}

            <button type="submit" disabled={loading} className="w-full btn-primary py-3 text-base font-bold justify-center mt-2">
              {loading ? (<><span className="spinner w-4 h-4" /> Signing in...</>) : (<>Sign In <ArrowRight size={16} /></>)}
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