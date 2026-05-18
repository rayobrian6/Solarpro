'use client';
import React, { useEffect, useState, useCallback } from 'react';
import AppShell from '@/components/ui/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Network, Zap, Sun, Battery, Home, AlertTriangle,
  MapPin, DollarSign, TrendingUp, Clock, CheckCircle,
  ChevronRight, Star, Shield, Filter, Search,
  Plus, ArrowRight, Loader2, RefreshCw, X,
  Bolt, Waves, Wind, Settings2, Eye, EyeOff,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Opportunity {
  id: string;
  source: 'contractor_shared' | 'solarpro_generated';
  status: string;
  site_name: string | null;
  city: string | null;
  state_code: string | null;
  zip: string | null;
  system_size_kw: number | null;
  annual_kwh: number | null;
  monthly_kwh_avg: number | null;
  utility_name: string | null;
  utility_rate_per_kwh: number | null;
  estimated_system_cost: number | null;
  estimated_payback_yrs: number | null;
  roof_material: string | null;
  roof_pitch: string | null;
  roof_condition: string | null;
  roof_age_years: number | null;
  stories: string | null;
  structure_type: string | null;
  usable_roof_pct: number | null;
  battery_candidate: boolean;
  steep_roof: boolean;
  complex_ahj: boolean;
  ahj_name: string | null;
  equipment_ecosystem: string | null;
  asking_price: number | null;
  listing_notes: string | null;
  expires_at: string;
  created_at: string;
  creator_company: string | null;
  // after claim:
  address?: string;
  claim_id?: string;
  claim_status?: string;
  claimed_by_user_id?: string;
}

interface ContractorProfile {
  battery_certified: boolean;
  commercial_capable: boolean;
  roofing_capable: boolean;
  steep_roof_capable: boolean;
  ev_charger_capable: boolean;
  generator_capable: boolean;
  service_states: string[];
  service_zips: string[];
  travel_radius_miles: number;
  equipment_ecosystems: string[];
  min_project_kw: number | null;
  max_project_kw: number | null;
  network_active: boolean;
  profile_complete: boolean;
}

type Tab = 'discover' | 'my-shared' | 'my-claims' | 'profile';

// ─── Constants ───────────────────────────────────────────────────────────────

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
const ECOSYSTEMS = ['enphase','solaredge','tesla','franklin','sungrow','goodwe','generac','sol-ark','ecoflow','other'];
const ECOSYSTEM_LABELS: Record<string, string> = {
  enphase: 'Enphase', solaredge: 'SolarEdge', tesla: 'Tesla / Powerwall',
  franklin: 'Franklin WH', sungrow: 'Sungrow', goodwe: 'GoodWe',
  generac: 'Generac PWRcell', 'sol-ark': 'Sol-Ark', ecoflow: 'EcoFlow', other: 'Other',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtKw(kw: number | null) {
  if (!kw) return '—';
  return kw >= 10 ? `${Math.round(kw)} kW` : `${kw.toFixed(1)} kW`;
}
function fmtCurrency(n: number | null) {
  if (!n) return '—';
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtRate(r: number | null) {
  if (!r) return '—';
  return `$${(r * 100).toFixed(1)}¢/kWh`;
}
function daysLeft(expires: string) {
  const d = Math.ceil((new Date(expires).getTime() - Date.now()) / 86400000);
  return d <= 0 ? 'Expired' : d === 1 ? '1 day left' : `${d} days left`;
}
function roofPitchLabel(pitch: string | null): { label: string; steep: boolean } {
  if (!pitch) return { label: '—', steep: false };
  const n = parseInt(pitch);
  return { label: pitch, steep: !isNaN(n) && n >= 6 };
}

// ─── Opportunity Card ─────────────────────────────────────────────────────────

function IntelBadge({ icon, label, highlight }: { icon: React.ReactNode; label: string; highlight?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
      highlight ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700/60 text-slate-300'
    }`}>
      {icon}
      {label}
    </span>
  );
}

function OpportunityCard({
  opp,
  onClaim,
  onViewDetail,
  claimed,
}: {
  opp: Opportunity;
  onClaim: (id: string) => void;
  onViewDetail: (opp: Opportunity) => void;
  claimed: boolean;
}) {
  const pitch = roofPitchLabel(opp.roof_pitch);
  const expiry = daysLeft(opp.expires_at);
  const isUrgent = expiry.includes('day') && parseInt(expiry) <= 3;

  return (
    <div className="relative bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden hover:border-slate-600 transition-all group">
      {/* Premium source tag */}
      <div className="absolute top-3 right-3 flex gap-1.5 z-10">
        {opp.battery_candidate && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/20 border border-amber-500/40 rounded text-amber-400 text-[10px] font-bold uppercase tracking-wide">
            <Battery size={9} /> Battery
          </span>
        )}
        {opp.steep_roof && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-rose-500/20 border border-rose-500/40 rounded text-rose-400 text-[10px] font-bold uppercase tracking-wide">
            ▲ Steep
          </span>
        )}
        {opp.complex_ahj && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-orange-500/20 border border-orange-500/40 rounded text-orange-400 text-[10px] font-bold uppercase tracking-wide">
            <AlertTriangle size={9} /> AHJ
          </span>
        )}
      </div>

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4 pr-24">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                {opp.source === 'contractor_shared' ? 'Contractor Shared' : 'SolarPro Generated'}
              </span>
            </div>
            <h3 className="text-white font-semibold text-base">
              {opp.city && opp.state_code
                ? `${opp.city}, ${opp.state_code}${opp.zip ? ` ${opp.zip}` : ''}`
                : opp.state_code || 'Location Pending'}
            </h3>
            <p className="text-slate-400 text-xs mt-0.5">
              via {opp.creator_company || 'SolarPro contractor'}
            </p>
          </div>
        </div>

        {/* System Intelligence — the differentiator */}
        <div className="grid grid-cols-3 gap-3 mb-4 p-3 bg-slate-900/40 rounded-lg border border-slate-700/40">
          <div className="text-center">
            <div className="text-lg font-bold text-amber-400">{fmtKw(opp.system_size_kw)}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">System</div>
          </div>
          <div className="text-center border-x border-slate-700/40">
            <div className="text-lg font-bold text-white">
              {opp.annual_kwh ? `${Math.round(opp.annual_kwh / 1000)}k` : '—'}
            </div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">kWh/yr</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-400">{fmtRate(opp.utility_rate_per_kwh)}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Rate</div>
          </div>
        </div>

        {/* Intelligence tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {opp.utility_name && (
            <IntelBadge icon={<Bolt size={10} />} label={opp.utility_name} />
          )}
          {opp.roof_material && (
            <IntelBadge icon={<Home size={10} />} label={opp.roof_material} />
          )}
          {opp.roof_pitch && (
            <IntelBadge icon={<TrendingUp size={10} />} label={`${opp.roof_pitch} pitch`} highlight={pitch.steep} />
          )}
          {opp.roof_condition && (
            <IntelBadge icon={<Shield size={10} />} label={opp.roof_condition} />
          )}
          {opp.equipment_ecosystem && (
            <IntelBadge icon={<Zap size={10} />} label={ECOSYSTEM_LABELS[opp.equipment_ecosystem] || opp.equipment_ecosystem} highlight />
          )}
          {opp.ahj_name && opp.complex_ahj && (
            <IntelBadge icon={<AlertTriangle size={10} />} label={`AHJ: ${opp.ahj_name}`} />
          )}
        </div>

        {/* Economics */}
        {(opp.estimated_system_cost || opp.estimated_payback_yrs) && (
          <div className="flex gap-4 mb-4 text-sm">
            {opp.estimated_system_cost && (
              <div>
                <span className="text-slate-500 text-xs">Est. project value</span>
                <div className="text-white font-semibold">{fmtCurrency(opp.estimated_system_cost)}</div>
              </div>
            )}
            {opp.estimated_payback_yrs && (
              <div>
                <span className="text-slate-500 text-xs">Payback</span>
                <div className="text-white font-semibold">{opp.estimated_payback_yrs.toFixed(1)} yrs</div>
              </div>
            )}
          </div>
        )}

        {/* Notes preview */}
        {opp.listing_notes && (
          <p className="text-slate-400 text-xs mb-4 line-clamp-2 italic">
            "{opp.listing_notes}"
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-700/40">
          <div className="flex items-center gap-3">
            {opp.asking_price ? (
              <span className="text-emerald-400 font-bold text-sm">{fmtCurrency(opp.asking_price)}</span>
            ) : (
              <span className="text-slate-500 text-xs">Price on claim</span>
            )}
            <span className={`text-xs ${isUrgent ? 'text-rose-400' : 'text-slate-500'}`}>
              <Clock size={10} className="inline mr-1" />{expiry}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onViewDetail(opp)}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-700/60 hover:bg-slate-700 rounded-lg transition-colors"
            >
              View Intel
            </button>
            {!claimed && (
              <button
                onClick={() => onClaim(opp.id)}
                className="px-3 py-1.5 text-xs font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors flex items-center gap-1"
              >
                Claim <ArrowRight size={12} />
              </button>
            )}
            {claimed && (
              <span className="px-3 py-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-1">
                <CheckCircle size={12} /> Claimed
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Claim Modal ──────────────────────────────────────────────────────────────

function ClaimModal({
  opp,
  onConfirm,
  onCancel,
  loading,
}: {
  opp: Opportunity;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-lg">Claim This Opportunity</h2>
            <button onClick={onCancel} className="text-slate-400 hover:text-white"><X size={20} /></button>
          </div>

          <div className="bg-slate-900/60 rounded-xl p-4 mb-5 border border-slate-700/40">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-500 text-xs mb-1">Location</div>
                <div className="text-white font-medium">
                  {opp.city && opp.state_code ? `${opp.city}, ${opp.state_code}` : opp.state_code || '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1">System Size</div>
                <div className="text-amber-400 font-bold">{fmtKw(opp.system_size_kw)}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1">Annual Usage</div>
                <div className="text-white">{opp.annual_kwh ? `${Math.round(opp.annual_kwh).toLocaleString()} kWh` : '—'}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1">Utility Rate</div>
                <div className="text-white">{fmtRate(opp.utility_rate_per_kwh)}</div>
              </div>
            </div>
            {opp.battery_candidate && (
              <div className="mt-3 pt-3 border-t border-slate-700/40 flex items-center gap-2 text-amber-400 text-xs font-medium">
                <Battery size={12} /> Battery storage candidate
              </div>
            )}
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-5 text-xs text-emerald-400">
            <Shield size={12} className="inline mr-1.5" />
            <strong>Exclusive claim.</strong> Once claimed, this opportunity is removed from the discovery feed.
            Only you will have access to the full homeowner address and contact details.
          </div>

          {opp.asking_price && (
            <div className="flex items-center justify-between mb-5">
              <span className="text-slate-400 text-sm">Opportunity price</span>
              <span className="text-emerald-400 font-bold text-lg">{fmtCurrency(opp.asking_price)}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 text-sm font-medium text-slate-300 bg-slate-700/60 hover:bg-slate-700 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="flex-1 py-2.5 text-sm font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              {loading ? 'Claiming…' : 'Confirm Claim'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ opp, onClaim, onClose, isClaimed }: {
  opp: Opportunity;
  onClaim: (id: string) => void;
  onClose: () => void;
  isClaimed: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-white font-bold text-lg">Opportunity Intelligence</h2>
              <p className="text-slate-400 text-xs mt-0.5">
                {opp.city && opp.state_code ? `${opp.city}, ${opp.state_code}` : 'Location details pending claim'}
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
          </div>

          {/* System */}
          <section className="mb-5">
            <h3 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-3">System Intelligence</h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'System Size', value: fmtKw(opp.system_size_kw), highlight: true },
                { label: 'Annual kWh', value: opp.annual_kwh ? `${Math.round(opp.annual_kwh).toLocaleString()}` : '—' },
                { label: 'Monthly Avg', value: opp.monthly_kwh_avg ? `${Math.round(opp.monthly_kwh_avg)} kWh` : '—' },
                { label: 'Utility', value: opp.utility_name || '—' },
                { label: 'Rate', value: fmtRate(opp.utility_rate_per_kwh), highlight: true },
                { label: 'Est. Cost', value: fmtCurrency(opp.estimated_system_cost) },
              ].map(item => (
                <div key={item.label} className="bg-slate-900/40 rounded-lg p-3">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{item.label}</div>
                  <div className={`font-semibold text-sm ${item.highlight ? 'text-amber-400' : 'text-white'}`}>{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Roof */}
          <section className="mb-5">
            <h3 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-3">Roof Assessment</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Material', value: opp.roof_material || '—' },
                { label: 'Pitch', value: opp.roof_pitch || '—', flag: opp.steep_roof ? 'steep' : undefined },
                { label: 'Condition', value: opp.roof_condition || '—' },
                { label: 'Age', value: opp.roof_age_years ? `${opp.roof_age_years} yrs` : '—' },
                { label: 'Structure', value: opp.structure_type || '—' },
                { label: 'Usable %', value: opp.usable_roof_pct ? `${opp.usable_roof_pct}%` : '—' },
              ].map(item => (
                <div key={item.label} className="bg-slate-900/40 rounded-lg p-3">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{item.label}</div>
                  <div className={`font-semibold text-sm ${item.flag === 'steep' ? 'text-rose-400' : 'text-white'}`}>{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Fit flags */}
          <section className="mb-5">
            <h3 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-3">Project Fit Flags</h3>
            <div className="flex flex-wrap gap-2">
              <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                opp.battery_candidate
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                  : 'bg-slate-700/40 border-slate-700 text-slate-500'
              }`}>
                <Battery size={12} /> Battery Candidate
              </span>
              <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                opp.steep_roof
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                  : 'bg-slate-700/40 border-slate-700 text-slate-500'
              }`}>
                <TrendingUp size={12} /> Steep Roof
              </span>
              <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                opp.complex_ahj
                  ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                  : 'bg-slate-700/40 border-slate-700 text-slate-500'
              }`}>
                <AlertTriangle size={12} /> Complex AHJ{opp.ahj_name ? `: ${opp.ahj_name}` : ''}
              </span>
              {opp.equipment_ecosystem && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 border border-blue-500/40 text-blue-400">
                  <Zap size={12} /> {ECOSYSTEM_LABELS[opp.equipment_ecosystem] || opp.equipment_ecosystem}
                </span>
              )}
            </div>
          </section>

          {/* Address (post-claim only) */}
          {opp.address && (
            <section className="mb-5">
              <h3 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-3">Full Address</h3>
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 font-medium flex items-center gap-2">
                <MapPin size={14} /> {opp.address}
              </div>
            </section>
          )}

          {/* Notes */}
          {opp.listing_notes && (
            <section className="mb-5">
              <h3 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-3">Contractor Notes</h3>
              <p className="text-slate-300 text-sm italic bg-slate-900/40 rounded-lg p-3">"{opp.listing_notes}"</p>
            </section>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-slate-300 bg-slate-700/60 hover:bg-slate-700 rounded-xl transition-colors">
              Close
            </button>
            {!isClaimed && (
              <button
                onClick={() => { onClose(); onClaim(opp.id); }}
                className="flex-1 py-2.5 text-sm font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle size={16} /> Claim Exclusively
              </button>
            )}
            {isClaimed && (
              <span className="flex-1 py-2.5 text-sm font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center gap-2">
                <CheckCircle size={16} /> You Own This
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({ profile, onSave }: {
  profile: ContractorProfile;
  onSave: (p: Partial<ContractorProfile>) => Promise<void>;
}) {
  const [form, setForm] = useState<ContractorProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = (key: keyof ContractorProfile) =>
    setForm(f => ({ ...f, [key]: !f[key as keyof ContractorProfile] }));

  const toggleState = (s: string) =>
    setForm(f => ({
      ...f,
      service_states: f.service_states.includes(s)
        ? f.service_states.filter(x => x !== s)
        : [...f.service_states, s],
    }));

  const toggleEco = (e: string) =>
    setForm(f => ({
      ...f,
      equipment_ecosystems: f.equipment_ecosystems.includes(e)
        ? f.equipment_ecosystems.filter(x => x !== e)
        : [...f.equipment_ecosystems, e],
    }));

  const handleSave = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="max-w-2xl space-y-8">
      {/* Capabilities */}
      <section>
        <h3 className="text-white font-semibold mb-1">Capabilities</h3>
        <p className="text-slate-400 text-sm mb-4">Tell the network what types of projects you handle. This determines which opportunities surface for you.</p>
        <div className="grid grid-cols-2 gap-3">
          {([
            ['battery_certified', '🔋 Battery Certified', 'Battery storage installs'],
            ['commercial_capable', '🏢 Commercial', 'Commercial & industrial'],
            ['roofing_capable', '🏠 Roofing', 'Full roof replacement'],
            ['steep_roof_capable', '📐 Steep Roof', '6:12 pitch and above'],
            ['ev_charger_capable', '⚡ EV Chargers', 'Level 2 / DCFC install'],
            ['generator_capable', '⚙️ Generators', 'Standby generator installs'],
          ] as [keyof ContractorProfile, string, string][]).map(([key, label, sub]) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                form[key]
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-white'
                  : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:border-slate-600'
              }`}
            >
              <div className={`w-4 h-4 mt-0.5 rounded border flex-shrink-0 flex items-center justify-center text-xs ${
                form[key] ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'
              }`}>
                {form[key] && '✓'}
              </div>
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Service States */}
      <section>
        <h3 className="text-white font-semibold mb-1">Service States</h3>
        <p className="text-slate-400 text-sm mb-4">Opportunities outside your selected states won't appear in your feed.</p>
        <div className="flex flex-wrap gap-2">
          {US_STATES.map(s => (
            <button
              key={s}
              onClick={() => toggleState(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                form.service_states.includes(s)
                  ? 'bg-amber-500 text-slate-900'
                  : 'bg-slate-700/60 text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {/* Equipment Ecosystems */}
      <section>
        <h3 className="text-white font-semibold mb-1">Equipment Ecosystems</h3>
        <p className="text-slate-400 text-sm mb-4">Opportunities matched to your preferred brands will be highlighted in your feed.</p>
        <div className="flex flex-wrap gap-2">
          {ECOSYSTEMS.map(e => (
            <button
              key={e}
              onClick={() => toggleEco(e)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                form.equipment_ecosystems.includes(e)
                  ? 'bg-blue-500/20 border border-blue-500/50 text-blue-400'
                  : 'bg-slate-700/60 border border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
              }`}
            >
              {ECOSYSTEM_LABELS[e]}
            </button>
          ))}
        </div>
      </section>

      {/* Project Size */}
      <section>
        <h3 className="text-white font-semibold mb-1">Project Size Preference</h3>
        <p className="text-slate-400 text-sm mb-4">Leave blank to see all sizes.</p>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-xs text-slate-400 mb-1.5">Minimum (kW)</label>
            <input
              type="number"
              value={form.min_project_kw ?? ''}
              onChange={e => setForm(f => ({ ...f, min_project_kw: e.target.value ? parseFloat(e.target.value) : null }))}
              className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              placeholder="e.g. 5"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-slate-400 mb-1.5">Maximum (kW)</label>
            <input
              type="number"
              value={form.max_project_kw ?? ''}
              onChange={e => setForm(f => ({ ...f, max_project_kw: e.target.value ? parseFloat(e.target.value) : null }))}
              className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              placeholder="e.g. 50"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-slate-400 mb-1.5">Travel Radius (mi)</label>
            <input
              type="number"
              value={form.travel_radius_miles}
              onChange={e => setForm(f => ({ ...f, travel_radius_miles: parseInt(e.target.value) || 50 }))}
              className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              placeholder="50"
            />
          </div>
        </div>
      </section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Profile'}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NetworkPage() {
  const [tab, setTab] = useState<Tab>('discover');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [myShared, setMyShared] = useState<Opportunity[]>([]);
  const [myClaims, setMyClaims] = useState<Opportunity[]>([]);
  const [profile, setProfile] = useState<ContractorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimTarget, setClaimTarget] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [detailOpp, setDetailOpp] = useState<Opportunity | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [filterState, setFilterState] = useState('');
  const [filterBattery, setFilterBattery] = useState(false);
  const [total, setTotal] = useState(0);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadProfile = useCallback(async () => {
    const res = await fetch('/api/network/contractor-profile');
    if (res.ok) {
      const data = await res.json();
      setProfile(data.profile);
    }
  }, []);

  const loadDiscover = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterState) params.set('state', filterState);
    if (filterBattery) params.set('battery', '1');
    const res = await fetch(`/api/network/opportunities?${params}`);
    if (res.ok) {
      const data = await res.json();
      setOpportunities(data.opportunities || []);
      setTotal(data.total || 0);
    }
  }, [filterState, filterBattery]);

  const loadMyShared = useCallback(async () => {
    const res = await fetch('/api/network/my-opportunities');
    if (res.ok) {
      const data = await res.json();
      setMyShared(data.opportunities || []);
    }
  }, []);

  const loadMyClaims = useCallback(async () => {
    const res = await fetch('/api/network/my-claims');
    if (res.ok) {
      const data = await res.json();
      setMyClaims(data.claims || []);
      setClaimedIds(new Set((data.claims || []).map((c: Opportunity) => c.id)));
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadProfile(), loadDiscover(), loadMyShared(), loadMyClaims()]);
      setLoading(false);
    })();
  }, [loadProfile, loadDiscover, loadMyShared, loadMyClaims]);

  useEffect(() => {
    if (!loading) loadDiscover();
  }, [filterState, filterBattery]); // eslint-disable-line

  const handleClaim = async (id: string) => {
    setClaimTarget(id);
  };

  const confirmClaim = async () => {
    if (!claimTarget) return;
    setClaimLoading(true);
    try {
      const res = await fetch(`/api/network/opportunities/${claimTarget}/claim`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setClaimedIds(prev => new Set([...prev, claimTarget]));
        setOpportunities(prev => prev.filter(o => o.id !== claimTarget));
        setMyClaims(prev => [data.opportunity, ...prev]);
        showToast('Opportunity claimed exclusively! Full address is now visible in My Claims.');
      } else {
        showToast(data.error || 'Failed to claim opportunity.', 'error');
      }
    } finally {
      setClaimLoading(false);
      setClaimTarget(null);
    }
  };

  const saveProfile = async (updates: Partial<ContractorProfile>) => {
    const res = await fetch('/api/network/contractor-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data = await res.json();
      setProfile(data.profile);
    }
  };

  const claimOppForModal = claimTarget ? opportunities.find(o => o.id === claimTarget) : null;

  return (
    <AppShell>
      <div className="min-h-screen bg-slate-900">
        <PageHeader
          title="SolarPro Network"
          subtitle="Verified solar opportunity intelligence — exclusive, pre-analyzed, matched to your capabilities"
        />

        {/* Toast */}
        {toast && (
          <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-emerald-500 text-white'
              : 'bg-rose-500 text-white'
          }`}>
            {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            {toast.msg}
          </div>
        )}

        {/* Modals */}
        {claimOppForModal && (
          <ClaimModal
            opp={claimOppForModal}
            onConfirm={confirmClaim}
            onCancel={() => setClaimTarget(null)}
            loading={claimLoading}
          />
        )}
        {detailOpp && (
          <DetailModal
            opp={detailOpp}
            onClaim={handleClaim}
            onClose={() => setDetailOpp(null)}
            isClaimed={claimedIds.has(detailOpp.id)}
          />
        )}

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          {/* Stats bar */}
          {!loading && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { label: 'Available Now', value: total, icon: <Network size={16} />, color: 'text-emerald-400' },
                { label: 'My Shared', value: myShared.length, icon: <ArrowRight size={16} />, color: 'text-amber-400' },
                { label: 'My Claims', value: myClaims.length, icon: <CheckCircle size={16} />, color: 'text-blue-400' },
              ].map(stat => (
                <div key={stat.label} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 flex items-center gap-3">
                  <div className={stat.color}>{stat.icon}</div>
                  <div>
                    <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
                    <div className="text-slate-400 text-xs">{stat.label}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-800/60 border border-slate-700/60 rounded-xl p-1 mb-6 w-fit">
            {([
              ['discover', 'Discover', <Network size={14} />],
              ['my-shared', 'My Shared', <ArrowRight size={14} />],
              ['my-claims', 'My Claims', <CheckCircle size={14} />],
              ['profile', 'My Profile', <Settings2 size={14} />],
            ] as [Tab, string, React.ReactNode][]).map(([id, label, icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === id
                    ? 'bg-slate-700 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {icon} {label}
                {id === 'discover' && total > 0 && (
                  <span className="bg-emerald-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {total > 9 ? '9+' : total}
                  </span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={32} className="animate-spin text-slate-500" />
            </div>
          ) : (
            <>
              {/* DISCOVER */}
              {tab === 'discover' && (
                <div>
                  {/* Filters */}
                  <div className="flex gap-3 mb-5 flex-wrap">
                    <select
                      value={filterState}
                      onChange={e => setFilterState(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500"
                    >
                      <option value="">All States</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button
                      onClick={() => setFilterBattery(f => !f)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                        filterBattery
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
                      }`}
                    >
                      <Battery size={14} /> Battery Only
                    </button>
                    <button
                      onClick={loadDiscover}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all"
                    >
                      <RefreshCw size={14} /> Refresh
                    </button>
                  </div>

                  {opportunities.length === 0 ? (
                    <div className="text-center py-20">
                      <Network size={48} className="mx-auto text-slate-600 mb-4" />
                      <h3 className="text-slate-400 font-medium mb-2">No opportunities available right now</h3>
                      <p className="text-slate-500 text-sm">
                        {profile?.service_states?.length === 0
                          ? 'Set up your service states in My Profile to see relevant opportunities.'
                          : 'Check back soon — new opportunities are added as contractors share projects.'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {opportunities.map(opp => (
                        <OpportunityCard
                          key={opp.id}
                          opp={opp}
                          onClaim={handleClaim}
                          onViewDetail={setDetailOpp}
                          claimed={claimedIds.has(opp.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* MY SHARED */}
              {tab === 'my-shared' && (
                <div>
                  {myShared.length === 0 ? (
                    <div className="text-center py-20">
                      <ArrowRight size={48} className="mx-auto text-slate-600 mb-4" />
                      <h3 className="text-slate-400 font-medium mb-2">No shared opportunities yet</h3>
                      <p className="text-slate-500 text-sm">
                        Share a project you can't service from the project detail page. Another contractor in the network will claim it.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myShared.map(opp => (
                        <div key={opp.id} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 flex items-center justify-between">
                          <div>
                            <div className="text-white font-medium text-sm">{opp.site_name || `${opp.city}, ${opp.state_code}`}</div>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-slate-400 text-xs">{fmtKw(opp.system_size_kw)}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                opp.status === 'open' ? 'bg-emerald-500/20 text-emerald-400' :
                                opp.status === 'claimed' ? 'bg-amber-500/20 text-amber-400' :
                                'bg-slate-700 text-slate-400'
                              }`}>
                                {opp.status}
                              </span>
                              {(opp as unknown as Record<string, unknown>).claimer_company && (
                                <span className="text-slate-400 text-xs">
                                  → {(opp as unknown as Record<string, unknown>).claimer_company as string}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-slate-500 text-xs">{daysLeft(opp.expires_at)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* MY CLAIMS */}
              {tab === 'my-claims' && (
                <div>
                  {myClaims.length === 0 ? (
                    <div className="text-center py-20">
                      <CheckCircle size={48} className="mx-auto text-slate-600 mb-4" />
                      <h3 className="text-slate-400 font-medium mb-2">No claimed opportunities yet</h3>
                      <p className="text-slate-500 text-sm">Browse the Discover tab to find and claim opportunities in your territory.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myClaims.map(opp => (
                        <div key={opp.id} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-white font-medium text-sm">{opp.site_name || 'Unnamed Project'}</div>
                              {opp.address && (
                                <div className="flex items-center gap-1.5 mt-1 text-emerald-400 text-xs">
                                  <MapPin size={12} /> {opp.address}
                                </div>
                              )}
                              <div className="flex items-center gap-3 mt-2">
                                <span className="text-slate-400 text-xs">{fmtKw(opp.system_size_kw)}</span>
                                <span className="text-slate-400 text-xs">{opp.utility_name || '—'}</span>
                                {opp.battery_candidate && (
                                  <span className="text-amber-400 text-xs flex items-center gap-1"><Battery size={10} /> Battery</span>
                                )}
                              </div>
                            </div>
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/20 text-amber-400">
                              {(opp as unknown as Record<string, unknown>).claim_status as string || 'pending'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* PROFILE */}
              {tab === 'profile' && profile && (
                <ProfileTab profile={profile} onSave={saveProfile} />
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
