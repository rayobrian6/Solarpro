'use client';

/**
 * /onboarding — Self-serve company setup wizard
 *
 * 4-step flow for new users (or anyone who hasn't completed setup):
 *   Step 1: Welcome — tells them what SolarPro does
 *   Step 2: Company Info — name, phone, address, website
 *   Step 3: Branding — logo URL, primary/secondary brand colours, footer text
 *   Step 4: Done — CTA to dashboard (and optionally upgrade plan)
 *
 * All data is saved via existing API endpoints:
 *   PUT /api/settings/branding — company name, logo, colors, footer
 *   PUT /api/settings/profile  — name, phone
 *
 * Accessible at /onboarding any time. Register page redirects here after
 * successful account creation (instead of the old "success" step).
 *
 * Guard: if user is not authenticated, redirects to /auth/login.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sun, ArrowRight, ArrowLeft, CheckCircle, Building2,
  Phone, Globe, MapPin, Palette, Image, FileText,
  Zap, BarChart3, FileSignature, Sparkles,
} from 'lucide-react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;

interface CompanyForm {
  companyName: string;
  companyPhone: string;
  companyAddress: string;
  companyWebsite: string;
}

interface BrandingForm {
  companyLogoUrl: string;
  brandPrimaryColor: string;
  brandSecondaryColor: string;
  proposalFooterText: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 3; // steps 1-3 are "real" steps; step 4 is done screen

function ProgressBar({ step }: { step: Step }) {
  if (step === 4) return null;
  const pct = ((step - 1) / (TOTAL_STEPS - 1)) * 100;
  return (
    <div className="w-full bg-slate-800 rounded-full h-1.5 mb-8">
      <div
        className="bg-amber-400 h-1.5 rounded-full transition-all duration-500"
        style={{ width: `${Math.max(pct, 8)}%` }}
      />
    </div>
  );
}

function StepLabel({ step }: { step: Step }) {
  if (step === 4) return null;
  const labels: Record<Step, string> = {
    1: 'Welcome',
    2: 'Company info',
    3: 'Branding',
    4: '',
  };
  return (
    <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">
      Step {step} of {TOTAL_STEPS} — {labels[step]}
    </p>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userName, setUserName] = useState('');

  const [company, setCompany] = useState<CompanyForm>({
    companyName:    '',
    companyPhone:   '',
    companyAddress: '',
    companyWebsite: '',
  });

  const [branding, setBranding] = useState<BrandingForm>({
    companyLogoUrl:      '',
    brandPrimaryColor:   '#f59e0b',
    brandSecondaryColor: '#0f172a',
    proposalFooterText:  '',
  });

  // Load current user to pre-fill fields and check auth
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.success) {
        router.replace('/auth/login');
        return;
      }
      const u = d.data;
      setUserName(u.name || '');
      setCompany({
        companyName:    u.company      || u.name || '',
        companyPhone:   u.companyPhone || '',
        companyAddress: u.companyAddress || '',
        companyWebsite: u.companyWebsite || '',
      });
      setBranding({
        companyLogoUrl:      u.companyLogoUrl      || '',
        brandPrimaryColor:   u.brandPrimaryColor   || '#f59e0b',
        brandSecondaryColor: u.brandSecondaryColor || '#0f172a',
        proposalFooterText:  u.proposalFooterText  || '',
      });
    }).catch(() => router.replace('/auth/login'));
  }, [router]);

  // ── Step 2: Save company info ──────────────────────────────────────────
  const saveCompanyInfo = async (): Promise<boolean> => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName:    company.companyName.trim(),
          companyPhone:   company.companyPhone.trim(),
          companyAddress: company.companyAddress.trim(),
          companyWebsite: company.companyWebsite.trim(),
          // keep existing branding fields unchanged
          brandPrimaryColor:   branding.brandPrimaryColor,
          brandSecondaryColor: branding.brandSecondaryColor,
          proposalFooterText:  branding.proposalFooterText,
          companyLogoUrl:      branding.companyLogoUrl,
        }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.error || 'Failed to save.'); return false; }
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: Save branding ──────────────────────────────────────────────
  const saveBranding = async (): Promise<boolean> => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName:         company.companyName.trim(),
          companyPhone:        company.companyPhone.trim(),
          companyAddress:      company.companyAddress.trim(),
          companyWebsite:      company.companyWebsite.trim(),
          companyLogoUrl:      branding.companyLogoUrl.trim(),
          brandPrimaryColor:   branding.brandPrimaryColor,
          brandSecondaryColor: branding.brandSecondaryColor,
          proposalFooterText:  branding.proposalFooterText.trim(),
        }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.error || 'Failed to save branding.'); return false; }
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  // ── Navigation ─────────────────────────────────────────────────────────
  const next = async () => {
    setError('');
    if (step === 2) {
      if (!company.companyName.trim()) { setError('Company name is required.'); return; }
      const ok = await saveCompanyInfo();
      if (!ok) return;
    }
    if (step === 3) {
      const ok = await saveBranding();
      if (!ok) return;
    }
    setStep(s => Math.min(s + 1, 4) as Step);
  };

  const back = () => {
    setError('');
    setStep(s => Math.max(s - 1, 1) as Step);
  };

  const skip = () => {
    setError('');
    setStep(s => Math.min(s + 1, 4) as Step);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="w-10 h-10 rounded-xl solar-gradient flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Sun size={20} className="text-slate-900" />
          </div>
          <div>
            <div className="font-black text-white text-lg leading-tight">SolarPro</div>
            <div className="text-amber-400 text-xs font-medium">Design Platform</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-700/50 rounded-2xl p-5 sm:p-8 shadow-2xl">
          <StepLabel step={step} />
          <ProgressBar step={step} />

          {/* ── Step 1: Welcome ── */}
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-black text-white mb-2">
                Welcome{userName ? `, ${userName.split(' ')[0]}` : ''}! 👋
              </h1>
              <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                Let&apos;s get your SolarPro account set up in under 2 minutes.
                We&apos;ll help you configure your company branding so your proposals look professional from day one.
              </p>

              <div className="space-y-3 mb-6">
                {[
                  { icon: <Building2 size={16} />, label: 'Add your company name & contact info' },
                  { icon: <Palette size={16} />,   label: 'Set your brand colours and logo' },
                  { icon: <FileText size={16} />,  label: 'Customise proposal footer text' },
                  { icon: <Sparkles size={16} />,  label: 'Start designing your first system' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-slate-300">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 flex-shrink-0">
                      {item.icon}
                    </div>
                    {item.label}
                  </div>
                ))}
              </div>

              {/* ── Workflow explainer ── */}
              <div className="mb-8">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Your SolarPro Workflow</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {[
                    { step: '1', label: 'Bill',       color: 'text-sky-400 bg-sky-500/10 border-sky-500/20' },
                    { step: '2', label: 'System',     color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' },
                    { step: '3', label: 'Design',     color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
                    { step: '4', label: 'Engineering',color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
                    { step: '5', label: 'Proposal',   color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
                    { step: '6', label: 'Install',    color: 'text-green-400 bg-green-500/10 border-green-500/20' },
                  ].map((w, i, arr) => (
                    <React.Fragment key={w.step}>
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${w.color}`}>
                        <span className="opacity-60">{w.step}</span>
                        {w.label}
                      </div>
                      {i < arr.length - 1 && (
                        <svg className="text-slate-600 flex-shrink-0" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                          <path d="M4.5 2L9 6l-4.5 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </React.Fragment>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">Upload a utility bill → auto-size the system → draw the design → generate engineering docs → send a signed proposal → track the install.</p>
              </div>

              <button
                onClick={next}
                className="w-full btn-primary justify-center py-3 text-base"
              >
                Get Started <ArrowRight size={16} />
              </button>

              <p className="text-center mt-4">
                <button onClick={() => router.push('/dashboard')} className="text-xs text-slate-500 hover:text-slate-400 transition-colors">
                  Skip setup, go to dashboard →
                </button>
              </p>
            </div>
          )}

          {/* ── Step 2: Company Info ── */}
          {step === 2 && (
            <div>
              <h1 className="text-xl font-black text-white mb-1">Company info</h1>
              <p className="text-slate-400 text-sm mb-6">
                This appears on all your proposals and client communications.
              </p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Company name <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={company.companyName}
                      onChange={e => setCompany(p => ({ ...p, companyName: e.target.value }))}
                      placeholder="Sunshine Solar Co."
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Phone number
                  </label>
                  <div className="relative">
                    <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="tel"
                      value={company.companyPhone}
                      onChange={e => setCompany(p => ({ ...p, companyPhone: e.target.value }))}
                      placeholder="(555) 123-4567"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Website
                  </label>
                  <div className="relative">
                    <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="url"
                      value={company.companyWebsite}
                      onChange={e => setCompany(p => ({ ...p, companyWebsite: e.target.value }))}
                      placeholder="https://yourcompany.com"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Business address
                  </label>
                  <div className="relative">
                    <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={company.companyAddress}
                      onChange={e => setCompany(p => ({ ...p, companyAddress: e.target.value }))}
                      placeholder="123 Main St, Phoenix, AZ 85001"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-xs mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="flex gap-3">
                <button onClick={back} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg transition-colors">
                  <ArrowLeft size={14} /> Back
                </button>
                <button onClick={next} disabled={loading} className="flex-1 btn-primary justify-center py-2.5 text-sm">
                  {loading ? 'Saving…' : <>Continue <ArrowRight size={14} /></>}
                </button>
              </div>
              <p className="text-center mt-3">
                <button onClick={skip} className="text-xs text-slate-500 hover:text-slate-400 transition-colors">
                  Skip for now →
                </button>
              </p>
            </div>
          )}

          {/* ── Step 3: Branding ── */}
          {step === 3 && (
            <div>
              <h1 className="text-xl font-black text-white mb-1">Brand your proposals</h1>
              <p className="text-slate-400 text-sm mb-6">
                Your logo and colours appear on every proposal you send to clients.
              </p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Company logo URL
                  </label>
                  <div className="relative">
                    <Image size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="url"
                      value={branding.companyLogoUrl}
                      onChange={e => setBranding(p => ({ ...p, companyLogoUrl: e.target.value }))}
                      placeholder="https://yourcompany.com/logo.png"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Link to your logo image. You can also upload it later in Settings → Branding.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Primary colour
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={branding.brandPrimaryColor}
                        onChange={e => setBranding(p => ({ ...p, brandPrimaryColor: e.target.value }))}
                        className="w-10 h-10 rounded-lg border border-slate-600 bg-slate-800 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={branding.brandPrimaryColor}
                        onChange={e => setBranding(p => ({ ...p, brandPrimaryColor: e.target.value }))}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                        maxLength={7}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Secondary colour
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={branding.brandSecondaryColor}
                        onChange={e => setBranding(p => ({ ...p, brandSecondaryColor: e.target.value }))}
                        className="w-10 h-10 rounded-lg border border-slate-600 bg-slate-800 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={branding.brandSecondaryColor}
                        onChange={e => setBranding(p => ({ ...p, brandSecondaryColor: e.target.value }))}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                        maxLength={7}
                      />
                    </div>
                  </div>
                </div>

                {/* Live preview swatch */}
                <div
                  className="rounded-lg p-4 text-sm font-semibold transition-all duration-200"
                  style={{ background: branding.brandSecondaryColor, color: branding.brandPrimaryColor }}
                >
                  <div className="flex items-center justify-between">
                    <span>{company.companyName || 'Your Company'}</span>
                    <span style={{ opacity: 0.7 }}>Solar Proposal</span>
                  </div>
                  <p className="text-xs mt-1 font-normal" style={{ color: branding.brandPrimaryColor, opacity: 0.7 }}>
                    Proposal preview — live colour swatch
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Proposal footer text
                  </label>
                  <div className="relative">
                    <FileText size={14} className="absolute left-3 top-3 text-slate-500" />
                    <textarea
                      value={branding.proposalFooterText}
                      onChange={e => setBranding(p => ({ ...p, proposalFooterText: e.target.value }))}
                      placeholder="Licensed contractor in AZ (#ROC123456). All estimates based on current utility rates."
                      rows={2}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 resize-none"
                      maxLength={500}
                    />
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-xs mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="flex gap-3">
                <button onClick={back} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg transition-colors">
                  <ArrowLeft size={14} /> Back
                </button>
                <button onClick={next} disabled={loading} className="flex-1 btn-primary justify-center py-2.5 text-sm">
                  {loading ? 'Saving…' : <>Save & Continue <ArrowRight size={14} /></>}
                </button>
              </div>
              <p className="text-center mt-3">
                <button onClick={skip} className="text-xs text-slate-500 hover:text-slate-400 transition-colors">
                  Skip for now →
                </button>
              </p>
            </div>
          )}

          {/* ── Step 4: Done ── */}
          {step === 4 && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto mb-6">
                <CheckCircle size={40} className="text-emerald-400" />
              </div>
              <h1 className="text-2xl font-black text-white mb-3">You&apos;re all set! 🎉</h1>
              <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                Your company profile is ready. SolarPro will use your branding on all proposals you generate.
                You can update everything at any time in{' '}
                <Link href="/settings" className="text-amber-400 hover:underline">Settings</Link>.
              </p>

              <div className="grid grid-cols-1 gap-3 mb-6">
                {[
                  { icon: <Zap size={16} />,             label: '3D design your first system',  href: '/design', primary: true },
                  { icon: <BarChart3 size={16} />,        label: 'View your dashboard',           href: '/dashboard', primary: false },
                  { icon: <FileSignature size={16} />,   label: 'Upgrade for digital signatures', href: '/auth/subscribe', primary: false },
                ].map((item, i) => (
                  <Link
                    key={i}
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                      item.primary
                        ? 'btn-primary justify-center'
                        : 'border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                    }`}
                  >
                    <span className={item.primary ? 'text-slate-900' : 'text-amber-400'}>{item.icon}</span>
                    {item.label}
                    {item.primary && <ArrowRight size={14} />}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
