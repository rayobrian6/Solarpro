'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sun, Eye, EyeOff, CheckCircle, ArrowRight, Zap, Shield, FileText, User, Mail, Lock, Building2, Phone } from 'lucide-react';

const BENEFITS = [
  { icon: <Zap size={16} />, text: '3D Solar Design Studio with Google Maps' },
  { icon: <FileText size={16} />, text: 'Professional PDF proposals in seconds' },
  { icon: <Shield size={16} />, text: 'Incentive calculator + SREC income estimates' },
  { icon: <CheckCircle size={16} />, text: 'Unlimited clients & projects' },
];

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'form' | 'success'>('form');

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    company: '',
    phone: '',
    agreeTerms: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) return setError('Full name is required.');
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError('Valid email is required.');
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    if (form.password !== form.confirmPassword) return setError('Passwords do not match.');
    if (!form.agreeTerms) return setError('You must agree to the Terms of Service.');

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          company: form.company,
          phone: form.phone,
          tosAccepted: form.agreeTerms,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to create account. Please try again.');
        setLoading(false);
        return;
      }

      setStep('success');
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
      setLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={40} className="text-emerald-400" />
          </div>
          <h1 className="text-3xl font-black text-white mb-3">Account Created!</h1>
          <p className="text-slate-400 mb-8">
            Welcome to SolarPro, <span className="text-white font-semibold">{form.name}</span>.
            Your account is ready — start designing solar systems now.
          </p>
          <Link href="/dashboard" className="btn-primary w-full justify-center text-base py-3 mb-4 block">
            Go to Dashboard <ArrowRight size={16} />
          </Link>
          <Link href="/auth/subscribe" className="text-slate-400 hover:text-amber-400 text-sm transition-colors">
            Upgrade your plan for proposals & signing →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Left panel — benefits */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] flex-shrink-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-r border-slate-700/50 p-10">
        <div>
          {/* Logo */}
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-xl solar-gradient flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Sun size={20} className="text-slate-900" />
            </div>
            <div>
              <div className="font-black text-white text-lg leading-tight">SolarPro</div>
              <div className="text-amber-400 text-xs font-medium">Design Platform</div>
            </div>
          </div>

          <h2 className="text-2xl font-black text-white mb-3">
            Design solar systems<br />
            <span className="text-amber-400">in minutes, not hours</span>
          </h2>
          <p className="text-slate-400 text-sm mb-8">
            Join solar professionals using SolarPro to design, calculate, and close deals faster.
          </p>

          <div className="space-y-4">
            {BENEFITS.map((b, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 flex-shrink-0">
                  {b.icon}
                </div>
                <span className="text-slate-300 text-sm">{b.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-slate-600">
          © 2024 SolarPro. All rights reserved.
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl solar-gradient flex items-center justify-center">
              <Sun size={20} className="text-slate-900" />
            </div>
            <div className="font-black text-white text-lg">SolarPro</div>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-black text-white mb-2">Create your account</h1>
            <p className="text-slate-400 text-sm">
              Already have an account?{' '}
              <Link href="/auth/login" className="text-amber-400 hover:text-amber-300 font-medium transition-colors">
                Sign in
              </Link>
            </p>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8 backdrop-blur-sm">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Full Name *</label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    name="name" type="text" value={form.name} onChange={handleChange}
                    placeholder="Jane Smith"
                    autoComplete="name"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Email Address *</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    name="email" type="email" value={form.email} onChange={handleChange}
                    placeholder="you@company.com"
                    autoComplete="email"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                  />
                </div>
              </div>

              {/* Company (optional) */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Company <span className="text-slate-600">(optional)</span></label>
                <div className="relative">
                  <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    name="company" type="text" value={form.company} onChange={handleChange}
                    placeholder="Solar Solutions LLC"
                    autoComplete="organization"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Password *</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    name="password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={handleChange}
                    placeholder="Min. 8 characters"
                    autoComplete="new-password"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-10 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Confirm Password *</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    name="confirmPassword" type={showPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={handleChange}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
                  />
                </div>
              </div>

              {/* Terms */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                  form.agreeTerms ? 'bg-amber-500 border-amber-500' : 'border-slate-600 group-hover:border-slate-500'
                }`}>
                  {form.agreeTerms && <CheckCircle size={12} className="text-slate-900" />}
                </div>
                <input name="agreeTerms" type="checkbox" checked={form.agreeTerms} onChange={handleChange} className="sr-only" />
                <span className="text-sm text-slate-400">
                  I have read and agree to the{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300 underline underline-offset-2">Terms of Service &amp; Confidentiality Agreement</a>
                  {' '}of SolarPro, operated by Under The Sun Solar
                </span>
              </label>

              {/* Error */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-3 text-base font-bold justify-center mt-2"
              >
                {loading ? (
                  <><span className="spinner w-4 h-4" /> Creating account...</>
                ) : (
                  <>Create Account <ArrowRight size={16} /></>
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-slate-600 mt-6">
            🔒 Secured with 256-bit encryption. We never share your data.
          </p>
        </div>
      </div>
    </div>
  );
}