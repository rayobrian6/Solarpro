'use client';
import React, { useState, useEffect, useRef } from 'react';
import AppShell from '@/components/ui/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Settings, Upload, Save, CheckCircle, AlertCircle,
  Building2, Phone, Mail, Globe, Palette, Image,
  User, Lock, Bell, CreditCard, Trash2, Eye, EyeOff,
  Sun, RefreshCw, X, Users
} from 'lucide-react';
import { useUser, isAdminRole } from '@/contexts/UserContext';
import { hasPlatformAccess } from '@/lib/permissions';
import OrganizationPanel from '@/components/settings/OrganizationPanel';
import CrewMembersPanel from '@/components/settings/CrewMembersPanel';
import { useTheme, THEME_CONFIG, type Theme } from '@/contexts/ThemeContext';

type Tab = 'profile' | 'branding' | 'subscription' | 'organization' | 'teams' | 'notifications';

interface BrandingSettings {
  companyName: string;
  companyLogoUrl: string;
  companyWebsite: string;
  companyAddress: string;
  companyPhone: string;
  brandPrimaryColor: string;
  brandSecondaryColor: string;
  proposalFooterText: string;
}

interface ProfileSettings {
  name: string;
  email: string;
  company: string;
  phone: string;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ✅ Fix: only populate form fields ONCE on first load.
  // UserContext refreshes on window focus/visibilitychange — without this ref,
  // every background refresh would reset the form mid-edit (causing focus/cursor jump).
  const formInitializedRef = useRef(false);

  const [profile, setProfile] = useState<ProfileSettings>({
    name: '',
    email: '',
    company: '',
    phone: '',
  });

  const [branding, setBranding] = useState<BrandingSettings>({
    companyName: '',
    companyLogoUrl: '',
    companyWebsite: '',
    companyAddress: '',
    companyPhone: '',
    brandPrimaryColor: '#f59e0b',
    brandSecondaryColor: '#0f172a',
    proposalFooterText: '',
  });

  // ✅ v40.8: Read from global UserContext — no independent /api/auth/me fetch
  const { user, loading: userLoading } = useUser();
  const { theme, setTheme } = useTheme();

  // Derived values from UserContext — always in sync with DB
  const currentPlan = user?.plan || 'starter';
  const subscriptionStatus = user?.subscriptionStatus || 'active';
  // isFreePass MUST come from DB boolean only — never inferred from status string
  const isFreePass = user?.isFreePass === true;
  const isAdmin = isAdminRole(user?.role);

  // Populate form fields when UserContext loads — ONCE only.
  // ⚠️  DO NOT change dependency to [user] — that causes the form to reset on every
  // background user refresh (window focus / visibilitychange), which makes the cursor
  // jump back to the first field while the user is typing. We use a ref guard so the
  // form is seeded exactly once when user first becomes available, then left alone.
  useEffect(() => {
    if (!user || formInitializedRef.current) return;
    formInitializedRef.current = true;
    setProfile({
      name: user.name || '',
      email: user.email || '',
      company: user.company || '',
      phone: user.phone || '',
    });
    setBranding(prev => ({
      ...prev,
      companyName: user.company || '',
      companyLogoUrl: user.companyLogoUrl || '',
      companyWebsite: (user as any).companyWebsite || '',
      companyAddress: (user as any).companyAddress || '',
      companyPhone: (user as any).companyPhone || user.phone || '',
      brandPrimaryColor: user.brandPrimaryColor || '#f59e0b',
      brandSecondaryColor: user.brandSecondaryColor || '#0f172a',
      proposalFooterText: (user as any).proposalFooterText || '',
    }));
    if (user.companyLogoUrl) setLogoPreview(user.companyLogoUrl);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  // ↑ The [user] dep is intentional — we need to re-check when user first loads from null.
  //   The formInitializedRef.current guard ensures we only seed the form ONCE.

  const showSaveStatus = (status: 'success' | 'error', message: string) => {
    setSaveStatus(status);
    setSaveMessage(message);
    setTimeout(() => setSaveStatus('idle'), 3500);
  };

  const handleManageBilling = async () => {
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
      });
      const data = await res.json();

      if (data.success && data.url) {
        window.location.href = data.url;
      } else {
        // No Stripe customer yet — redirect to subscribe page
        window.location.href = '/auth/subscribe';
      }
    } catch (err) {
      console.error('Portal error:', err);
      window.location.href = '/auth/subscribe';
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (data.success) {
        showSaveStatus('success', 'Profile saved successfully.');
      } else {
        showSaveStatus('error', data.error || 'Failed to save profile.');
      }
    } catch {
      showSaveStatus('error', 'Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBranding = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(branding),
      });
      const data = await res.json();
      if (data.success) {
        showSaveStatus('success', 'Branding saved. Your proposals will now use your company logo and colors.');
      } else {
        showSaveStatus('error', data.error || 'Failed to save branding.');
      }
    } catch {
      showSaveStatus('error', 'Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      showSaveStatus('error', 'Please upload an image file (PNG, JPG, SVG, WebP).');
      return;
    }
    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      showSaveStatus('error', 'Logo must be under 2MB.');
      return;
    }

    setUploading(true);
    try {
      // Show local preview immediately
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setLogoPreview(dataUrl);
        setBranding(prev => ({ ...prev, companyLogoUrl: dataUrl }));
      };
      reader.readAsDataURL(file);

      // Upload to server
      const formData = new FormData();
      formData.append('logo', file);
      const res = await fetch('/api/settings/logo', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.url) {
        setLogoPreview(data.url);
        setBranding(prev => ({ ...prev, companyLogoUrl: data.url }));
        showSaveStatus('success', 'Logo uploaded successfully.');
      } else {
        // Keep local preview even if upload fails (data URL still works for proposals)
        showSaveStatus('success', 'Logo loaded. Save branding to apply it to proposals.');
      }
    } catch {
      showSaveStatus('error', 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = () => {
    setLogoPreview(null);
    setBranding(prev => ({ ...prev, companyLogoUrl: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const PLAN_LABELS: Record<string, { label: string; color: string; price: string }> = {
    starter:      { label: 'Starter',      color: 'text-slate-300 bg-slate-700',          price: '$79/mo' },
    professional: { label: 'Professional', color: 'text-amber-300 bg-amber-500/20',        price: '$149/mo' },
    contractor:   { label: 'Contractor',   color: 'text-blue-300 bg-blue-500/20',          price: '$249/mo' },
    free_pass:    { label: 'Free Pass',    color: 'text-emerald-300 bg-emerald-500/20',    price: 'Free' },
  };

  const planInfo = PLAN_LABELS[currentPlan] || PLAN_LABELS['professional'];

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile',       label: 'Profile',        icon: <User size={16} /> },
    { id: 'branding',      label: 'Branding',       icon: <Palette size={16} /> },
    { id: 'subscription',  label: 'Subscription',   icon: <CreditCard size={16} /> },
    { id: 'organization',  label: 'Organization',   icon: <Building2 size={16} /> },
    { id: 'teams',         label: 'Teams',          icon: <Users size={16} /> },
    { id: 'notifications', label: 'Notifications',  icon: <Bell size={16} /> },
  ];

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto space-y-6 animate-fade-in">

        {/* ══════════ SETTINGS COMMAND HEADER ══════════ */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
            <div className="absolute -top-10 -right-10 w-48 h-48 bg-slate-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-500/20 to-transparent" />
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-700/60 border border-slate-600/40 flex items-center justify-center flex-shrink-0">
                <Settings size={18} className="text-slate-300" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight">Settings</h1>
                <p className="text-sm text-slate-400 mt-0.5">Account, branding, and subscription preferences</p>
              </div>
            </div>
          </div>

        {/* Save status toast */}
        {saveStatus !== 'idle' && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
            saveStatus === 'success'
              ? 'banner-success'
              : 'banner-error'
          }`}>
            {saveStatus === 'success'
              ? <CheckCircle size={16} className="flex-shrink-0" />
              : <AlertCircle size={16} className="flex-shrink-0" />
            }
            {saveMessage}
          </div>
        )}

        {/* Tabs */}
        <div className="tab-bar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-item font-semibold ${activeTab === tab.id ? 'active !bg-amber-500 !text-slate-900' : ''}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── PROFILE TAB ── */}
        {activeTab === 'profile' && (
          <div className="space-y-4">
            <div className="card p-6 space-y-5">
              <h2 className="text-lg font-bold text-white">Profile Information</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                    className="input w-full"
                    placeholder="Your full name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email Address</label>
                  <input
                    type="email"
                    value={profile.email}
                    onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                    className="input w-full"
                    placeholder="you@company.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Company Name</label>
                  <input
                    type="text"
                    value={profile.company}
                    onChange={e => setProfile(p => ({ ...p, company: e.target.value }))}
                    className="input w-full"
                    placeholder="Your company name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Phone Number</label>
                  <input
                    type="tel"
                    value={profile.phone}
                    onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
                    className="input w-full"
                    placeholder="(555) 000-0000"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="btn-primary flex items-center gap-2"
                >
                  {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                  Save Profile
                </button>
              </div>
            </div>

            {/* Theme / Appearance */}
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Sun size={16} className="text-amber-400" />
                <h2 className="text-base font-bold text-white">Appearance</h2>
              </div>
              <p className="text-xs text-slate-500 mb-4">Choose how SolarPro looks on your device. Stored locally in your browser.</p>
              <div className="grid grid-cols-3 gap-3">
                {(Object.entries(THEME_CONFIG) as [Theme, typeof THEME_CONFIG[Theme]][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => setTheme(key)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                      theme === key
                        ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                        : 'border-white/10 bg-white/3 text-slate-400 hover:border-white/20 hover:text-white'
                    }`}
                  >
                    <span className="text-2xl leading-none">{cfg.icon}</span>
                    <span className="text-xs font-semibold">{cfg.label}</span>
                    <span className="text-[10px] text-slate-500 text-center leading-tight">{cfg.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── BRANDING TAB ── */}
        {activeTab === 'branding' && (
          <div className="space-y-5">

            {/* Plan gate notice — hidden for admin/free_pass users */}
            {currentPlan === 'starter' && !isFreePass && !isAdmin && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <div>
                  White-label branding is available on <strong>Professional</strong> and <strong>Contractor</strong> plans.{' '}
                  <a href="/auth/subscribe" className="underline hover:text-amber-200">Upgrade your plan →</a>
                </div>
              </div>
            )}

            {/* Logo Upload */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-white mb-1">Company Logo</h2>
                <p className="text-slate-400 text-sm">Your logo will appear on all proposals and client-facing documents instead of the SolarPro logo.</p>
              </div>

              {/* Logo preview */}
              {logoPreview ? (
                <div className="flex items-center gap-4">
                  <div className="w-32 h-20 rounded-xl bg-white border border-slate-600 flex items-center justify-center overflow-hidden p-2">
                    <img src={logoPreview} alt="Company logo" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle size={14} /> Logo loaded
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                      >
                        <Upload size={12} /> Replace
                      </button>
                      <button
                        onClick={removeLogo}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
                      >
                        <X size={12} /> Remove
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-600 hover:border-amber-500/50 rounded-xl p-8 text-center cursor-pointer transition-colors group"
                >
                  <div className="w-12 h-12 rounded-xl bg-slate-700/60 flex items-center justify-center mx-auto mb-3 group-hover:bg-amber-500/10 transition-colors">
                    {uploading
                      ? <RefreshCw size={20} className="text-amber-400 animate-spin" />
                      : <Upload size={20} className="text-slate-400 group-hover:text-amber-400 transition-colors" />
                    }
                  </div>
                  <p className="text-white font-semibold text-sm mb-1">
                    {uploading ? 'Uploading...' : 'Click to upload your logo'}
                  </p>
                  <p className="text-slate-500 text-xs">PNG, JPG, SVG, or WebP · Max 2MB · Recommended: 400×120px</p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
            </div>

            {/* Company Info */}
            <div className="card p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">Company Information</h2>
              <p className="text-slate-400 text-sm -mt-2">This information appears on proposals and permit packages.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Company Name</label>
                  <input
                    type="text"
                    value={branding.companyName}
                    onChange={e => setBranding(p => ({ ...p, companyName: e.target.value }))}
                    className="input w-full"
                    placeholder="Your Solar Company LLC"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Company Phone</label>
                  <input
                    type="tel"
                    value={branding.companyPhone}
                    onChange={e => setBranding(p => ({ ...p, companyPhone: e.target.value }))}
                    className="input w-full"
                    placeholder="(555) 000-0000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Website</label>
                  <input
                    type="url"
                    value={branding.companyWebsite}
                    onChange={e => setBranding(p => ({ ...p, companyWebsite: e.target.value }))}
                    className="input w-full"
                    placeholder="https://yourcompany.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Company Address</label>
                  <input
                    type="text"
                    value={branding.companyAddress}
                    onChange={e => setBranding(p => ({ ...p, companyAddress: e.target.value }))}
                    className="input w-full"
                    placeholder="123 Main St, City, ST 00000"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Proposal Footer Text</label>
                <textarea
                  value={branding.proposalFooterText}
                  onChange={e => setBranding(p => ({ ...p, proposalFooterText: e.target.value }))}
                  className="input w-full h-20 resize-none"
                  placeholder="e.g. Licensed & Insured · ROC #123456 · yourcompany.com"
                />
                <p className="text-xs text-slate-500 mt-1">Appears at the bottom of every proposal PDF.</p>
              </div>
            </div>

            {/* Brand Colors */}
            <div className="card p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">Brand Colors</h2>
              <p className="text-slate-400 text-sm -mt-2">Customize the accent colors used in your proposals.</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Primary Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={branding.brandPrimaryColor}
                      onChange={e => setBranding(p => ({ ...p, brandPrimaryColor: e.target.value }))}
                      className="w-10 h-10 rounded-lg border border-slate-600 cursor-pointer bg-transparent"
                    />
                    <input
                      type="text"
                      value={branding.brandPrimaryColor}
                      onChange={e => setBranding(p => ({ ...p, brandPrimaryColor: e.target.value }))}
                      className="input flex-1 font-mono text-sm"
                      placeholder="#f59e0b"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Secondary Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={branding.brandSecondaryColor}
                      onChange={e => setBranding(p => ({ ...p, brandSecondaryColor: e.target.value }))}
                      className="w-10 h-10 rounded-lg border border-slate-600 cursor-pointer bg-transparent"
                    />
                    <input
                      type="text"
                      value={branding.brandSecondaryColor}
                      onChange={e => setBranding(p => ({ ...p, brandSecondaryColor: e.target.value }))}
                      className="input flex-1 font-mono text-sm"
                      placeholder="#0f172a"
                    />
                  </div>
                </div>
              </div>

              {/* Color preview */}
              <div className="rounded-xl overflow-hidden border border-slate-700/50">
                <div className="p-4 text-white text-sm font-bold" style={{ backgroundColor: branding.brandPrimaryColor }}>
                  Primary — Proposal header, accents
                </div>
                <div className="p-4 text-white text-sm font-bold" style={{ backgroundColor: branding.brandSecondaryColor }}>
                  Secondary — Proposal background, text
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSaveBranding}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                Save Branding
              </button>
            </div>
          </div>
        )}

        {/* ── SUBSCRIPTION TAB ── */}
        {activeTab === 'subscription' && (
          <div className="space-y-5">
            {/* Current plan */}
            <div className="card p-6">
              <h2 className="text-lg font-bold text-white mb-4">Current Plan</h2>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                    <Sun size={22} className="text-amber-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-black text-lg">{planInfo.label}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${planInfo.color}`}>
                        {isFreePass ? 'Free Pass' : isAdmin ? 'Admin' : subscriptionStatus}
                      </span>
                    </div>
                    <div className="text-slate-400 text-sm">
                      {isFreePass
                        ? 'Complimentary access — no billing'
                        : isAdmin
                        ? 'Admin access — full platform access'
                        : planInfo.price}
                    </div>
                  </div>
                </div>
                {/* Hide upgrade button for admin/free_pass users */}
                {!isFreePass && !isAdmin && (
                  <a href="/auth/subscribe" className="btn-primary text-sm">
                    Upgrade Plan
                  </a>
                )}
              </div>
            </div>

            {/* Plan comparison */}
            <div className="card p-6">
              <h2 className="text-lg font-bold text-white mb-4">Plan Comparison</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left text-slate-400 font-semibold pb-3 pr-4">Feature</th>
                      <th className="text-center text-slate-400 font-semibold pb-3 px-3">Starter<br/><span className="text-xs font-normal">$79/mo</span></th>
                      <th className="text-center text-amber-400 font-semibold pb-3 px-3">Professional<br/><span className="text-xs font-normal">$149/mo</span></th>
                      <th className="text-center text-blue-400 font-semibold pb-3 px-3">Contractor<br/><span className="text-xs font-normal">$249/mo</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {[
                      ['3D Design Studio',             true,      true,          true       ],
                      ['Projects',                     '10',      'Unlimited',   'Unlimited'],
                      ['Clients',                      '25',      'Unlimited',   'Unlimited'],
                      ['Electrical Engineering (SLD)', false,     true,          true       ],
                      ['Sol Fence Design',             false,     true,          true       ],
                      ['BOM + Structural Calcs',       false,     true,          true       ],
                      ['Permit Packages',              false,     true,          true       ],
                      ['Proposal E-Signing',           false,     true,          true       ],
                      ['White-Label Branding',         false,     true,          true       ],
                      ['Team Members', false, 'Up to 2', '2 + add-ons'],
                      ['Priority Support',             false,     true,          true       ],
                      ['Dedicated Onboarding',         false,     false,         true       ],
                      ['SLA Support',                  false,     false,         true       ],
                    ].map(([feature, starter, pro, contractor], i) => (
                      <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 pr-4 text-slate-300">{feature as string}</td>
                        {[starter, pro, contractor].map((val, j) => (
                          <td key={j} className="py-2.5 px-3 text-center">
                            {val === true
                              ? <CheckCircle size={15} className="text-emerald-400 mx-auto" />
                              : val === false
                              ? <span className="text-slate-700">—</span>
                              : <span className="text-slate-300 text-xs font-medium">{val as string}</span>
                            }
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Billing section — hidden for admin/free_pass users */}
            {!isFreePass && !isAdmin && (
              <div className="card p-6">
                <h2 className="text-lg font-bold text-white mb-2">Billing</h2>
                <p className="text-slate-400 text-sm mb-4">Manage your subscription and billing through our secure payment portal.</p>
                <div className="flex gap-3">
                  <button
                    onClick={handleManageBilling}
                    className="btn-primary text-sm flex items-center gap-2"
                  >
                    <CreditCard size={14} /> Manage Billing
                  </button>
                  <a href="/auth/subscribe" className="btn-secondary text-sm flex items-center gap-2">
                    Change Plan
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* —— SolarDog Tutorial —— visible to all users */}
        <div className="card p-6">
          <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
            🐾 SolarDog Tutorial
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            Replay the guided onboarding tour at any time. SolarDog will walk you through the key features.
          </p>
          <button
            onClick={() => window.dispatchEvent(new Event('solardog:start-tour'))}
            className="btn-primary flex items-center gap-2"
          >
            <span>▶ Restart Tutorial</span>
          </button>
        </div>

        {/* ── Admin Tools ── only visible to admin users */}
        {isAdmin && (
          <div className="card p-6 border border-amber-500/20">
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              🔧 Admin Tools
            </h2>
            <p className="text-slate-400 text-sm mb-4">Database maintenance and migrations. Safe to run multiple times.</p>
            <MigrateButton />
          </div>
        )}

      </div>

        {/* ── ORGANIZATION TAB ── */}
        {activeTab === 'organization' && user && (
          <OrganizationPanel userId={user.id} />
        )}

        {/* ── TEAMS TAB ── */}
        {activeTab === 'teams' && (
          <CrewMembersPanel />
        )}

        {/* ── NOTIFICATIONS TAB ── */}
        {activeTab === 'notifications' && (
          <NotificationsPanel />
        )}

    </AppShell>
  );
}

// ── Notification Preferences Panel ──────────────────────────────────────────

interface NotifPrefs {
  email_proposal_signed:  boolean;
  email_proposal_expiry:  boolean;
  email_stage_change:     boolean;
  email_new_lead:         boolean;
  email_survey_completed: boolean;
  email_weekly_summary:   boolean;
  email_billing_alerts:   boolean;
  inapp_proposal_signed:  boolean;
  inapp_stage_change:     boolean;
  inapp_new_lead:         boolean;
  inapp_survey_completed: boolean;
  inapp_system_alerts:    boolean;
}

const DEFAULT_PREFS: NotifPrefs = {
  email_proposal_signed:  true,
  email_proposal_expiry:  true,
  email_stage_change:     true,
  email_new_lead:         true,
  email_survey_completed: true,
  email_weekly_summary:   false,
  email_billing_alerts:   true,
  inapp_proposal_signed:  true,
  inapp_stage_change:     true,
  inapp_new_lead:         true,
  inapp_survey_completed: true,
  inapp_system_alerts:    true,
};

function NotifToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-700/40 last:border-0">
      <div className="flex-1 pr-4">
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
          checked ? 'bg-amber-500' : 'bg-slate-700'
        }`}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function NotificationsPanel() {
  const [prefs, setPrefs] = React.useState<NotifPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving]   = React.useState(false);
  const [status, setStatus]   = React.useState<'idle' | 'saved' | 'error'>('idle');

  React.useEffect(() => {
    fetch('/api/settings/notifications')
      .then(r => r.json())
      .then(d => {
        if (d.success) setPrefs({ ...DEFAULT_PREFS, ...d.prefs });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (updated: NotifPrefs) => {
    setSaving(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/settings/notifications', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(updated),
      });
      const d = await res.json();
      if (d.success) {
        setPrefs({ ...DEFAULT_PREFS, ...d.prefs });
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2500);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof NotifPrefs) => {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    save(updated);
  };

  if (loading) {
    return (
      <div className="card p-6 text-center text-slate-500 text-sm">
        <RefreshCw size={16} className="animate-spin inline mr-2" />Loading preferences…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Email notifications */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Mail size={16} className="text-amber-400" />
          <h3 className="font-semibold text-white text-sm">Email Notifications</h3>
        </div>
        <NotifToggle
          label="Proposal Signed"
          description="Email when a client signs a proposal"
          checked={prefs.email_proposal_signed}
          onChange={() => toggle('email_proposal_signed')}
        />
        <NotifToggle
          label="Proposal Expiry Reminder"
          description="Email 3 days before a proposal expires"
          checked={prefs.email_proposal_expiry}
          onChange={() => toggle('email_proposal_expiry')}
        />
        <NotifToggle
          label="Project Stage Change"
          description="Email when a project advances to a new stage"
          checked={prefs.email_stage_change}
          onChange={() => toggle('email_stage_change')}
        />
        <NotifToggle
          label="New Lead Added"
          description="Email when a new lead is created in your account"
          checked={prefs.email_new_lead}
          onChange={() => toggle('email_new_lead')}
        />
        <NotifToggle
          label="Site Survey Completed"
          description="Email when a site survey is submitted from the app"
          checked={prefs.email_survey_completed}
          onChange={() => toggle('email_survey_completed')}
        />
        <NotifToggle
          label="Weekly Activity Digest"
          description="Summary of proposals, leads, and projects sent every Monday"
          checked={prefs.email_weekly_summary}
          onChange={() => toggle('email_weekly_summary')}
        />
        <NotifToggle
          label="Billing & Subscription Alerts"
          description="Payment failures, plan changes, and renewal reminders"
          checked={prefs.email_billing_alerts}
          onChange={() => toggle('email_billing_alerts')}
        />
      </div>

      {/* In-app notifications */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={16} className="text-amber-400" />
          <h3 className="font-semibold text-white text-sm">In-App Notifications</h3>
          <span className="text-xs text-slate-500">(Bell icon in navbar)</span>
        </div>
        <NotifToggle
          label="Proposal Signed"
          description="Show notification when a client signs a proposal"
          checked={prefs.inapp_proposal_signed}
          onChange={() => toggle('inapp_proposal_signed')}
        />
        <NotifToggle
          label="Project Stage Change"
          description="Show notification when a project stage changes"
          checked={prefs.inapp_stage_change}
          onChange={() => toggle('inapp_stage_change')}
        />
        <NotifToggle
          label="New Lead Added"
          description="Show notification for new leads"
          checked={prefs.inapp_new_lead}
          onChange={() => toggle('inapp_new_lead')}
        />
        <NotifToggle
          label="Site Survey Completed"
          description="Show notification when a survey is submitted"
          checked={prefs.inapp_survey_completed}
          onChange={() => toggle('inapp_survey_completed')}
        />
        <NotifToggle
          label="System Alerts"
          description="Maintenance windows, feature announcements, and errors"
          checked={prefs.inapp_system_alerts}
          onChange={() => toggle('inapp_system_alerts')}
        />
      </div>

      {/* Status indicator */}
      {(saving || status !== 'idle') && (
        <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg ${
          saving       ? 'bg-slate-700/40 text-slate-400' :
          status === 'saved' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
          'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {saving ? (
            <><RefreshCw size={13} className="animate-spin" /> Saving…</>
          ) : status === 'saved' ? (
            <><CheckCircle size={13} /> Preferences saved</>
          ) : (
            <><AlertCircle size={13} /> Failed to save — try again</>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function MigrateButton() {
  const [status, setStatus] = React.useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [results, setResults] = React.useState<string[]>([]);

  async function runMigration() {
    setStatus('running');
    setResults([]);
    try {
      const res = await fetch('/api/migrate', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setStatus('done');
        setResults(json.results || ['Migration complete']);
      } else {
        setStatus('error');
        setResults([json.error || 'Migration failed']);
      }
    } catch (e: unknown) {
      setStatus('error');
      setResults([(e as Error).message || 'Network error']);
    }
  }

  return (
    <div>
      <button
        onClick={runMigration}
        disabled={status === 'running'}
        className={`btn-sm flex items-center gap-2 ${status === 'running' ? 'opacity-60 cursor-not-allowed btn-secondary' : status === 'done' ? 'btn-secondary' : 'btn-primary'}`}
      >
        {status === 'running' ? '⏳ Running…' : status === 'done' ? '✅ Done' : '🚀 Run Database Migration'}
      </button>
      {results.length > 0 && (
        <div className="mt-3 bg-slate-900 rounded-xl p-3 max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <div key={i} className="text-xs font-mono text-slate-300 py-0.5">{r}</div>
          ))}
        </div>
      )}
    </div>
  );
}