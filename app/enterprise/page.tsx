'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sun, Building2, Users, ArrowRight, CheckCircle,
  Mail, Phone, MessageSquare, Briefcase, AlertCircle, X
} from 'lucide-react';

export default function EnterprisePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    companyName: '',
    contactEmail: '',
    contactPhone: '',
    numberOfInstallers: '',
    monthlyInstalls: '',
    message: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/enterprise/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (data.success) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Failed to send. Please try again.');
      }
    } catch (err) {
      setError('Something went wrong. Please email us directly at sales@underthesun.solutions');
    } finally {
      setLoading(false);
    }
  };

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
          <Link href="/subscribe" className="text-slate-400 hover:text-white text-sm transition-colors flex items-center gap-1">
            ← View all plans
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">

          {/* Left — Info */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium mb-6">
              <Building2 size={12} /> Enterprise Plan
            </div>
            <h1 className="text-4xl font-black text-white mb-4">
              Built for large solar operations
            </h1>
            <p className="text-slate-400 text-lg mb-8 leading-relaxed">
              Multi-company accounts, custom integrations, dedicated support, and volume pricing — designed for contracting firms managing dozens of installers.
            </p>

            <div className="space-y-4 mb-10">
              {[
                { icon: <Building2 size={18} />, title: 'Multi-Company Accounts', desc: 'Manage multiple brands and companies from a single dashboard.' },
                { icon: <Users size={18} />, title: 'Unlimited Team Members', desc: 'Add your entire team with role-based access controls.' },
                { icon: <Briefcase size={18} />, title: 'Dedicated Account Manager', desc: 'A real person who knows your business and helps you succeed.' },
                { icon: <MessageSquare size={18} />, title: 'Custom Integrations', desc: 'Connect SolarPro to your existing CRM, ERP, or workflow tools.' },
                { icon: <CheckCircle size={18} />, title: 'Custom SLA', desc: 'Guaranteed uptime and response times tailored to your needs.' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-4 p-4 bg-slate-800/40 border border-slate-700/50 rounded-xl">
                  <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 flex-shrink-0">
                    {item.icon}
                  </div>
                  <div>
                    <div className="text-white font-semibold text-sm mb-0.5">{item.title}</div>
                    <div className="text-slate-400 text-xs">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 bg-slate-800/40 border border-slate-700/50 rounded-xl">
              <p className="text-slate-400 text-sm">
                Prefer to talk directly?{' '}
                <a href="mailto:sales@underthesun.solutions" className="text-amber-400 hover:text-amber-300 font-medium">
                  sales@underthesun.solutions
                </a>
              </p>
            </div>
          </div>

          {/* Right — Form */}
          <div>
            {submitted ? (
              <div className="bg-slate-800/60 border border-emerald-500/30 rounded-2xl p-10 text-center">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-5">
                  <CheckCircle size={28} className="text-emerald-400" />
                </div>
                <h2 className="text-2xl font-black text-white mb-3">Message Sent!</h2>
                <p className="text-slate-400 mb-6">
                  Thanks for reaching out. Our team at{' '}
                  <strong className="text-white">Under The Sun Solutions</strong>{' '}
                  will get back to you within 1 business day.
                </p>
                <Link
                  href="/subscribe"
                  className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-6 py-3 rounded-xl transition-all"
                >
                  View All Plans <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8">
                <h2 className="text-xl font-black text-white mb-1">Contact Sales</h2>
                <p className="text-slate-400 text-sm mb-6">Tell us about your operation and we'll get back to you within 1 business day.</p>

                {error && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm mb-5">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-slate-300 text-xs font-semibold mb-1.5">Company Name *</label>
                    <div className="relative">
                      <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        required
                        value={form.companyName}
                        onChange={e => setForm(p => ({ ...p, companyName: e.target.value }))}
                        placeholder="Your company name"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 text-xs font-semibold mb-1.5">Contact Email *</label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="email"
                        required
                        value={form.contactEmail}
                        onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))}
                        placeholder="you@company.com"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 text-xs font-semibold mb-1.5">Phone Number</label>
                    <div className="relative">
                      <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="tel"
                        value={form.contactPhone}
                        onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))}
                        placeholder="+1 (555) 000-0000"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-slate-300 text-xs font-semibold mb-1.5">Number of Installers</label>
                      <input
                        type="number"
                        min="1"
                        value={form.numberOfInstallers}
                        onChange={e => setForm(p => ({ ...p, numberOfInstallers: e.target.value }))}
                        placeholder="e.g. 25"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 text-xs font-semibold mb-1.5">Monthly Installs</label>
                      <input
                        type="number"
                        min="1"
                        value={form.monthlyInstalls}
                        onChange={e => setForm(p => ({ ...p, monthlyInstalls: e.target.value }))}
                        placeholder="e.g. 50"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 text-xs font-semibold mb-1.5">Message</label>
                    <textarea
                      rows={4}
                      value={form.message}
                      onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                      placeholder="Tell us about your operation, current tools, and what you need from SolarPro..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {loading ? (
                      <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Sending...</>
                    ) : (
                      <>Send to Sales Team <ArrowRight size={14} /></>
                    )}
                  </button>

                  <p className="text-center text-xs text-slate-600">
                    We'll respond within 1 business day · sales@underthesun.solutions
                  </p>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
