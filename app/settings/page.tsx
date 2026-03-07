'use client';
import React, { useState, useEffect, useRef } from 'react';
import AppShell from '@/components/ui/AppShell';
import {
  Settings, Upload, Save, CheckCircle, AlertCircle,
  Building2, Phone, Mail, Globe, Palette, Image,
  User, Lock, Bell, CreditCard, Trash2, Eye, EyeOff,
  Sun, RefreshCw, X
} from 'lucide-react';

type Tab = 'profile' | 'branding' | 'subscription';

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

  const [currentPlan, setCurrentPlan] = useState<string>('professional');
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>('active');
  const [isFreePass, setIsFreePass] = useState(false);

  // Load user data on mount
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.success && data.data) {
          const u = data.data;
          setProfile({
            name: u.name || '',
            email: u.email || '',
            company: u.company || '',
            phone: u.phone || '',
          });
          setBranding(prev => ({
            ...prev,
            companyName: u.company || '',
            companyLogoUrl: u.companyLogoUrl || '',
            companyWebsite: u.companyWebsite || '',
            companyAddress: u.companyAddress || '',
            companyPhone: u.companyPhone || u.phone || '',
            brandPrimaryColor: u.brandPrimaryColor || '#f59e0b',
            brandSecondaryColor: u.brandSecondaryColor || '#0f172a',
            proposalFooterText: u.proposalFooterText || '',
          }));
          if (u.companyLogoUrl) setLogoPreview(u.companyLogoUrl);
          setCurrentPlan(u.plan || 'professional');
          setSubscriptionStatus(u.subscriptionStatus || 'active');
          setIsFreePass(u.isFreePass || false);
        }
      } catch (e) {
        console.error('Failed to load user settings', e);
      }
    };
    load();
  }, []);

  const showSaveStatus = (status: 'success' | 'error', message: string) => {
    setSaveStatus(status);
    setSaveMessage(message);
    setTimeout(() => setSaveStatus('idle'), 3500);
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
    { id: 'profile',      label: 'Profile',      icon: <User size={16} /> },
    { id: 'branding',     label: 'Branding',     icon: <Palette size={16} /> },
    { id: 'subscription', label: 'Subscription', icon: <CreditCard size={16} /> },
  ];

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto space-y-6 animate-fade-in">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-700/60 border border-slate-600/50 flex items-center justify-center">
            <Settings size={20} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">Settings</h1>
            <p className="text-slate-400 text-sm">Manage your account, branding, and subscription</p>
          </div>
        </div>

        {/* Save status toast */}
        {saveStatus !== 'idle' && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
            saveStatus === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {saveStatus === 'success'
              ? <CheckCircle size={16} className="flex-shrink-0" />
              : <AlertCircle size={16} className="flex-shrink-0" />
            }
            {saveMessage}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-800/60 border border-slate-700/50 rounded-xl p-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? 'bg-amber-500 text-slate-900'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── PROFILE TAB ── */}
        {activeTab === 'profile' && (
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
        )}

        {/* ── BRANDING TAB ── */}
        {activeTab === 'branding' && (
          <div className="space-y-5">

            {/* Plan gate notice */}
            {currentPlan === 'starter' && !isFreePass && (
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
                        {isFreePass ? 'Free Pass' : subscriptionStatus}
                      </span>
                    </div>
                    <div className="text-slate-400 text-sm">{isFreePass ? 'Complimentary access — no billing' : planInfo.price}</div>
                  </div>
                </div>
                {!isFreePass && (
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
                      ['3D Design Studio', true, true, true],
                      ['Projects', '10', 'Unlimited', 'Unlimited'],
                      ['Clients', '25', 'Unlimited', 'Unlimited'],
                      ['Electrical Engineering (SLD)', false, true, true],
                      ['Sol Fence Design', false, true, true],
                      ['BOM + Structural Calcs', false, true, true],
                      ['Permit Packages', false, true, true],
                      ['Proposal E-Signing', false, true, true],
                      ['White-Label Branding', false, true, true],
                      ['Team Members', false, 'Up to 3', 'Unlimited'],
                      ['Priority Support', false, true, true],
                      ['Dedicated Onboarding', false, false, true],
                      ['SLA Support', false, false, true],
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

            {!isFreePass && (
              <div className="card p-6">
                <h2 className="text-lg font-bold text-white mb-2">Billing</h2>
                <p className="text-slate-400 text-sm mb-4">Manage your subscription and billing through our secure payment portal.</p>
                <div className="flex gap-3">
                  <a href="/auth/subscribe" className="btn-primary text-sm flex items-center gap-2">
                    <CreditCard size={14} /> Manage Billing
                  </a>
                  <button className="btn-secondary text-sm text-red-400 border-red-500/20 hover:bg-red-500/10">
                    Cancel Subscription
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </AppShell>
  );
}