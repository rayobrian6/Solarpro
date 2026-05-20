'use client';
import React, { useEffect, useState, useCallback } from 'react';
import AppShell from '@/components/ui/AppShell';
import {
  Network, Zap, Battery, Home, AlertTriangle,
  MapPin, DollarSign, TrendingUp, Clock, CheckCircle,
  ArrowRight, Loader2, RefreshCw, X,
  Settings2, Shield, Star, Sparkles,
} from 'lucide-react';
import {
  buildEnrichmentChips,
  buildEnrichmentDetailGroups,
  fieldValue,
  formatConfidence,
  formatDisplayValue,
  getEnrichmentPayload,
  stateTone,
  type EnrichmentCarrier,
  type EnrichmentChip,
} from '@/lib/network/opportunityEnrichmentDisplay';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Opportunity extends EnrichmentCarrier {
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
  marketplace_status?: string;
  claim_mode?: 'exclusive' | 'shared' | string;
  claim_count?: number;
  max_claims?: number;
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

// ─── Constants ──────────────────────────────────────────────────────────────

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
const ECOSYSTEMS = ['enphase','solaredge','tesla','franklin','sungrow','goodwe','generac','sol-ark','ecoflow','other'];
const ECOSYSTEM_LABELS: Record<string, string> = {
  enphase: 'Enphase', solaredge: 'SolarEdge', tesla: 'Tesla / Powerwall',
  franklin: 'Franklin WH', sungrow: 'Sungrow', goodwe: 'GoodWe',
  generac: 'Generac PWRcell', 'sol-ark': 'Sol-Ark', ecoflow: 'EcoFlow', other: 'Other',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

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
function contractorToneClasses(tone: EnrichmentChip['tone'] | ReturnType<typeof stateTone>) {
  const tones: Record<string, string> = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    orange: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
    slate: 'border-slate-700 bg-slate-800/70 text-slate-400',
  };
  return tones[tone] ?? tones.slate;
}
function ContractorEnrichmentChips({ chips }: { chips: EnrichmentChip[] }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {chips.map(chip => (
        <span key={chip.label} className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide ${contractorToneClasses(chip.tone)}`}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}
function ContractorEnrichmentDetails({ opp }: { opp: Opportunity }) {
  const groups = buildEnrichmentDetailGroups(opp);
  if (!groups.length) return null;
  return (
    <section className="mb-5">
      <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-3">Enriched Opportunity Factors</p>
      <div className="space-y-3">
        {groups.map(group => (
          <div key={group.title} className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{group.title}</p>
            <div className="grid grid-cols-2 gap-2">
              {group.items.slice(0, 4).map(item => (
                <div key={`${group.title}-${item.label}`} className="rounded-lg bg-slate-800/50 p-2">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{item.label}</div>
                  <div className="font-semibold text-sm text-white">{item.value}</div>
                  <div className="mt-1 text-[10px] text-slate-500">Confidence {formatConfidence(item.confidence)}</div>
                  {item.warnings.length ? <div className="mt-1 text-[10px] text-amber-300">{item.warnings.join(', ')}</div> : null}
                  {item.missing.length ? <div className="mt-1 text-[10px] text-rose-300">Missing: {item.missing.join(', ')}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Opportunity Card ────────────────────────────────────────────────────────

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
  const expiry = daysLeft(opp.expires_at);
  const isUrgent = expiry.includes('day') && parseInt(expiry) <= 3;
  const pitchNum = opp.roof_pitch ? parseInt(opp.roof_pitch) : 0;
  const isSteep = !isNaN(pitchNum) && pitchNum >= 6;
  const payload = getEnrichmentPayload(opp);
  const chips = buildEnrichmentChips(opp, 'contractor');
  const enrichedSystemSize = fieldValue<number>(payload, 'core', 'estimated_system_size_kw') ?? opp.system_size_kw;
  const enrichedProjectValue = fieldValue<number>(payload, 'core', 'estimated_project_value') ?? opp.estimated_system_cost;
  const roofComplexity = fieldValue<string>(payload, 'roof_install', 'install_difficulty');
  const ahjComplexity = fieldValue<string>(payload, 'territory_utility', 'ahj_complexity');

  return (
    <div className="group relative flex flex-col bg-[#0f1623] border border-slate-700/50 rounded-2xl overflow-hidden hover:border-slate-500/70 hover:shadow-lg hover:shadow-black/40 transition-all duration-200 cursor-pointer" onClick={() => onViewDetail(opp)}>

      {/* Accent bar at top based on battery/urgency */}
      <div className={`h-1 w-full ${opp.battery_candidate ? 'bg-gradient-to-r from-amber-500 to-amber-400' : 'bg-gradient-to-r from-emerald-600 to-emerald-500'}`} />

      <div className="flex-1 p-5">
        {/* Header row */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            {/* Location — the hero */}
            <div className="flex items-center gap-2 mb-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <h3 className="text-white font-bold text-lg leading-tight truncate">
                {opp.city && opp.state_code
                  ? `${opp.city}, ${opp.state_code}`
                  : opp.state_code || 'Location Pending'}
              </h3>
            </div>
            <p className="text-slate-500 text-xs pl-3.5">
              Shared by {opp.creator_company || 'SolarPro contractor'}
            </p>
          </div>

          {/* Tags cluster */}
          <div className="flex flex-col gap-1 ml-3 flex-shrink-0">
            {opp.battery_candidate && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/15 border border-amber-500/40 rounded-md text-amber-400 text-[10px] font-bold uppercase tracking-wide">
                <Battery size={8} /> Battery
              </span>
            )}
            {isSteep && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-rose-500/15 border border-rose-500/30 rounded-md text-rose-400 text-[10px] font-bold uppercase tracking-wide">
                ▲ Steep
              </span>
            )}
            {opp.complex_ahj && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-orange-500/15 border border-orange-500/30 rounded-md text-orange-400 text-[10px] font-bold uppercase tracking-wide">
                <AlertTriangle size={8} /> AHJ
              </span>
            )}
          </div>
        </div>

        <ContractorEnrichmentChips chips={chips} />

        {/* System intel — 3 columns */}
        <div className="grid grid-cols-3 gap-px bg-slate-700/30 rounded-xl overflow-hidden mb-4">
          <div className="bg-[#0f1623] px-3 py-2.5 text-center">
            <div className="text-amber-400 font-bold text-xl tabular-nums">{fmtKw(enrichedSystemSize)}</div>
            <div className="text-slate-500 text-[10px] uppercase tracking-widest mt-0.5">System</div>
          </div>
          <div className="bg-[#0f1623] px-3 py-2.5 text-center">
            <div className="text-white font-bold text-xl tabular-nums">
              {opp.annual_kwh ? `${(opp.annual_kwh / 1000).toFixed(1)}k` : '—'}
            </div>
            <div className="text-slate-500 text-[10px] uppercase tracking-widest mt-0.5">kWh/yr</div>
          </div>
          <div className="bg-[#0f1623] px-3 py-2.5 text-center">
            <div className="text-emerald-400 font-bold text-xl tabular-nums">{fmtRate(opp.utility_rate_per_kwh)}</div>
            <div className="text-slate-500 text-[10px] uppercase tracking-widest mt-0.5">Rate</div>
          </div>
        </div>

        {/* Roof + utility details */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {enrichedProjectValue && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/30">
              <DollarSign size={9} />Value {fmtCurrency(enrichedProjectValue)}
            </span>
          )}
          {roofComplexity && (
            <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800/70 px-2 py-0.5 rounded-md border border-slate-700/50">
              <Home size={9} />Roof {formatDisplayValue(roofComplexity)}
            </span>
          )}
          {ahjComplexity && (
            <span className="flex items-center gap-1 text-xs text-orange-300 bg-orange-500/10 px-2 py-0.5 rounded-md border border-orange-500/30">
              <AlertTriangle size={9} />AHJ {formatDisplayValue(ahjComplexity)}
            </span>
          )}
          {opp.utility_name && (
            <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800/70 px-2 py-0.5 rounded-md border border-slate-700/50">
              <Zap size={9} className="text-slate-500" />{opp.utility_name}
            </span>
          )}
          {opp.roof_material && (
            <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800/70 px-2 py-0.5 rounded-md border border-slate-700/50">
              <Home size={9} className="text-slate-500" />{opp.roof_material}
            </span>
          )}
          {opp.roof_pitch && (
            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border ${
              isSteep
                ? 'text-rose-400 bg-rose-500/10 border-rose-500/30'
                : 'text-slate-400 bg-slate-800/70 border-slate-700/50'
            }`}>
              <TrendingUp size={9} />{opp.roof_pitch} pitch
            </span>
          )}
          {opp.equipment_ecosystem && (
            <span className="flex items-center gap-1 text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/30">
              <Zap size={9} />{ECOSYSTEM_LABELS[opp.equipment_ecosystem] || opp.equipment_ecosystem}
            </span>
          )}
        </div>

        {/* Notes if any */}
        {opp.listing_notes && (
          <p className="text-slate-500 text-xs mb-4 italic line-clamp-1">
            "{opp.listing_notes}"
          </p>
        )}
      </div>

      {/* Footer — always pinned to bottom */}
      <div className="px-5 pb-4 pt-0">
        <div className="flex items-center justify-between pt-3 border-t border-slate-800">
          <div className="flex items-center gap-3">
            {opp.asking_price ? (
              <span className="text-emerald-400 font-bold">{fmtCurrency(opp.asking_price)}</span>
            ) : (
              <span className="text-slate-600 text-xs font-medium">Price on claim</span>
            )}
            <span className={`text-xs flex items-center gap-1 ${isUrgent ? 'text-rose-400' : 'text-slate-600'}`}>
              <Clock size={10} />{expiry}
            </span>
          </div>

          <div className="flex gap-2" onClick={e => e.stopPropagation()}>
            {!claimed ? (
              <button
                onClick={() => onClaim(opp.id)}
                className="px-4 py-1.5 text-xs font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
              >
                Claim <ArrowRight size={11} />
              </button>
            ) : (
              <span className="px-3 py-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-1.5">
                <CheckCircle size={11} /> Claimed
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Claim Modal ─────────────────────────────────────────────────────────────

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f1623] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-bold text-lg">Claim This Opportunity</h2>
            <button onClick={onCancel} className="text-slate-500 hover:text-white transition-colors"><X size={18} /></button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              { label: 'Location', value: opp.city && opp.state_code ? `${opp.city}, ${opp.state_code}` : opp.state_code || '—' },
              { label: 'System Size', value: fmtKw(opp.system_size_kw), highlight: true },
              { label: 'Annual Usage', value: opp.annual_kwh ? `${Math.round(opp.annual_kwh).toLocaleString()} kWh` : '—' },
              { label: 'Utility Rate', value: fmtRate(opp.utility_rate_per_kwh) },
            ].map(item => (
              <div key={item.label} className="bg-slate-800/60 rounded-xl p-3">
                <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{item.label}</div>
                <div className={`font-semibold text-sm ${item.highlight ? 'text-amber-400' : 'text-white'}`}>{item.value}</div>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2.5 bg-emerald-500/8 border border-emerald-500/25 rounded-xl p-3.5 mb-5">
            <Shield size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <p className="text-emerald-300 text-xs leading-relaxed">
              <strong>{opp.claim_mode === 'shared' ? 'Shared claim.' : 'Exclusive claim.'}</strong> {opp.claim_mode === 'shared'
                ? 'Once claimed, this opportunity moves to My Claims for you while remaining available until shared capacity is full.'
                : "Once claimed, this opportunity is removed from the discovery feed. Only you will see the homeowner's full address and contact details."}
            </p>
          </div>

          {opp.asking_price && (
            <div className="flex items-center justify-between mb-5 px-1">
              <span className="text-slate-400 text-sm">Opportunity price</span>
              <span className="text-emerald-400 font-bold text-xl">{fmtCurrency(opp.asking_price)}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onCancel} className="flex-1 py-2.5 text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="flex-1 py-2.5 text-sm font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f1623] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-white font-bold text-lg">Opportunity Intelligence</h2>
              <p className="text-slate-500 text-xs mt-0.5">
                {opp.city && opp.state_code ? `${opp.city}, ${opp.state_code}` : 'Full address revealed after claim'}
              </p>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
          </div>

          <section className="mb-5">
            <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-3">System</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'System Size', value: fmtKw(opp.system_size_kw), accent: 'text-amber-400' },
                { label: 'Annual kWh', value: opp.annual_kwh ? `${Math.round(opp.annual_kwh).toLocaleString()}` : '—' },
                { label: 'Monthly Avg', value: opp.monthly_kwh_avg ? `${Math.round(opp.monthly_kwh_avg)} kWh` : '—' },
                { label: 'Utility', value: opp.utility_name || '—' },
                { label: 'Rate', value: fmtRate(opp.utility_rate_per_kwh), accent: 'text-emerald-400' },
                { label: 'Est. Cost', value: fmtCurrency(opp.estimated_system_cost) },
              ].map(item => (
                <div key={item.label} className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{item.label}</div>
                  <div className={`font-semibold text-sm ${item.accent ?? 'text-white'}`}>{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-5">
            <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-3">Roof</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Material', value: opp.roof_material || '—' },
                { label: 'Pitch', value: opp.roof_pitch || '—', flag: opp.steep_roof },
                { label: 'Condition', value: opp.roof_condition || '—' },
                { label: 'Age', value: opp.roof_age_years ? `${opp.roof_age_years} yrs` : '—' },
                { label: 'Structure', value: opp.structure_type || '—' },
                { label: 'Usable %', value: opp.usable_roof_pct ? `${opp.usable_roof_pct}%` : '—' },
              ].map(item => (
                <div key={item.label} className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{item.label}</div>
                  <div className={`font-semibold text-sm ${item.flag ? 'text-rose-400' : 'text-white'}`}>{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-5">
            <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-3">Fit Flags</p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Battery Candidate', active: opp.battery_candidate, color: 'amber', icon: <Battery size={11} /> },
                { label: 'Steep Roof', active: opp.steep_roof, color: 'rose', icon: <TrendingUp size={11} /> },
                { label: `Complex AHJ${opp.ahj_name ? `: ${opp.ahj_name}` : ''}`, active: opp.complex_ahj, color: 'orange', icon: <AlertTriangle size={11} /> },
              ].map(f => (
                <span key={f.label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  f.active
                    ? f.color === 'amber' ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                    : f.color === 'rose' ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                    : 'bg-orange-500/15 border-orange-500/30 text-orange-400'
                    : 'bg-slate-800/50 border-slate-700 text-slate-600'
                }`}>{f.icon}{f.label}</span>
              ))}
              {opp.equipment_ecosystem && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/15 border border-blue-500/30 text-blue-400">
                  <Zap size={11} />{ECOSYSTEM_LABELS[opp.equipment_ecosystem] || opp.equipment_ecosystem}
                </span>
              )}
            </div>
          </section>

          <ContractorEnrichmentDetails opp={opp} />

          {opp.address && (
            <section className="mb-5">
              <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-2">Full Address</p>
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 font-medium text-sm">
                <MapPin size={13} />{opp.address}
              </div>
            </section>
          )}

          {opp.listing_notes && (
            <section className="mb-5">
              <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-2">Notes</p>
              <p className="text-slate-300 text-sm italic bg-slate-800/50 rounded-lg p-3">"{opp.listing_notes}"</p>
            </section>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors">Close</button>
            {!isClaimed ? (
              <button
                onClick={() => { onClose(); onClaim(opp.id); }}
                className="flex-1 py-2.5 text-sm font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle size={15} /> {opp.claim_mode === 'shared' ? 'Claim Shared Lead' : 'Claim Exclusively'}
              </button>
            ) : (
              <span className="flex-1 py-2.5 text-sm font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center gap-2">
                <CheckCircle size={15} /> {opp.claim_mode === 'shared' ? 'Claimed by You' : 'You Own This'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────

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
      <section>
        <h3 className="text-white font-semibold mb-1">Capabilities</h3>
        <p className="text-slate-500 text-sm mb-4">Tell the network what types of projects you handle. This determines which opportunities surface for you.</p>
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
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-white'
                  : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:border-slate-600'
              }`}
            >
              <div className={`w-4 h-4 mt-0.5 rounded border flex-shrink-0 flex items-center justify-center text-xs ${
                form[key] ? 'bg-emerald-500 border-emerald-500 text-slate-900' : 'border-slate-600'
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

      <section>
        <h3 className="text-white font-semibold mb-1">Service States</h3>
        <p className="text-slate-500 text-sm mb-4">Opportunities outside your selected states won't appear in your feed.</p>
        <div className="flex flex-wrap gap-1.5">
          {US_STATES.map(s => (
            <button
              key={s}
              onClick={() => toggleState(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                form.service_states.includes(s)
                  ? 'bg-amber-500 text-slate-900'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">Equipment Ecosystems</h3>
        <p className="text-slate-500 text-sm mb-4">Opportunities matched to your preferred brands will be highlighted.</p>
        <div className="flex flex-wrap gap-2">
          {ECOSYSTEMS.map(e => (
            <button
              key={e}
              onClick={() => toggleEco(e)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                form.equipment_ecosystems.includes(e)
                  ? 'bg-blue-500/15 border-blue-500/40 text-blue-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
              }`}
            >
              {ECOSYSTEM_LABELS[e]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">Project Size Preference</h3>
        <p className="text-slate-500 text-sm mb-4">Leave blank to see all sizes.</p>
        <div className="flex gap-4">
          {[
            { label: 'Min kW', key: 'min_project_kw' as keyof ContractorProfile, ph: 'e.g. 5' },
            { label: 'Max kW', key: 'max_project_kw' as keyof ContractorProfile, ph: 'e.g. 50' },
            { label: 'Travel Radius (mi)', key: 'travel_radius_miles' as keyof ContractorProfile, ph: '50' },
          ].map(field => (
            <div key={field.key} className="flex-1">
              <label className="block text-xs text-slate-500 mb-1.5">{field.label}</label>
              <input
                type="number"
                value={(form[field.key] as number | null) ?? ''}
                onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value ? parseFloat(e.target.value) : null }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500 transition-colors"
                placeholder={field.ph}
              />
            </div>
          ))}
        </div>
      </section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
      >
        {saving && <Loader2 size={15} className="animate-spin" />}
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
    if (res.ok) { const d = await res.json(); setProfile(d.profile); }
  }, []);

  const loadDiscover = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterState) params.set('state', filterState);
    if (filterBattery) params.set('battery', '1');
    const res = await fetch(`/api/network/opportunities?${params}`);
    if (res.ok) { const d = await res.json(); setOpportunities(d.opportunities || []); setTotal(d.total || 0); }
  }, [filterState, filterBattery]);

  const loadMyShared = useCallback(async () => {
    const res = await fetch('/api/network/my-opportunities');
    if (res.ok) { const d = await res.json(); setMyShared(d.opportunities || []); }
  }, []);

  const loadMyClaims = useCallback(async () => {
    const res = await fetch('/api/network/my-claims');
    if (res.ok) {
      const d = await res.json();
      setMyClaims(d.claims || []);
      setClaimedIds(new Set((d.claims || []).map((c: Opportunity) => c.id)));
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadProfile(), loadDiscover(), loadMyShared(), loadMyClaims()]);
      setLoading(false);
    })();
  }, [loadProfile, loadDiscover, loadMyShared, loadMyClaims]);

  useEffect(() => { if (!loading) loadDiscover(); }, [filterState, filterBattery]); // eslint-disable-line

  const confirmClaim = async () => {
    if (!claimTarget) return;
    setClaimLoading(true);
    try {
      const res = await fetch(`/api/network/opportunities/${claimTarget}/claim`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setClaimedIds(prev => new Set([...prev, claimTarget]));
        setOpportunities(prev => prev.filter(o => o.id !== claimTarget));
        setTotal(prev => Math.max(0, prev - 1));
        if (data.opportunity) setMyClaims(prev => [data.opportunity, ...prev.filter(o => o.id !== claimTarget)]);
        await Promise.all([loadDiscover(), loadMyClaims()]);
        showToast('Opportunity claimed! Full address is now visible in My Claims.');
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
    if (res.ok) { const d = await res.json(); setProfile(d.profile); }
  };

  const claimOppForModal = claimTarget ? opportunities.find(o => o.id === claimTarget) : null;

  const TABS: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'discover', label: 'Discover', icon: <Sparkles size={14} />, count: total || undefined },
    { id: 'my-shared', label: 'My Shared', icon: <ArrowRight size={14} />, count: myShared.length || undefined },
    { id: 'my-claims', label: 'My Claims', icon: <CheckCircle size={14} />, count: myClaims.length || undefined },
    { id: 'profile', label: 'My Profile', icon: <Settings2 size={14} /> },
  ];

  return (
    <AppShell>
      <div className="min-h-screen" style={{ background: 'var(--bg-base, #0b1120)' }}>

        {/* ── Hero Header ─────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden border-b border-slate-800">
          {/* Subtle gradient glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/40 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-1/4 w-96 h-32 bg-emerald-500/5 blur-3xl pointer-events-none" />

          <div className="relative max-w-6xl mx-auto px-6 py-8">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
              {/* Title block */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400 text-xs font-semibold uppercase tracking-widest">Live Marketplace</span>
                </div>
                <h1 className="text-white font-bold text-3xl lg:text-4xl mb-2 tracking-tight">
                  SolarPro Network
                </h1>
                <p className="text-slate-400 text-sm max-w-lg leading-relaxed">
                  Exclusive, pre-analyzed solar opportunities — matched to your capabilities, your territory, your equipment.
                </p>
              </div>

              {/* Stats cards */}
              {!loading && (
                <div className="flex gap-3 flex-shrink-0">
                  {[
                    { label: 'Available Now', value: total, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: <Sparkles size={14} /> },
                    { label: 'My Shared', value: myShared.length, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: <ArrowRight size={14} /> },
                    { label: 'My Claims', value: myClaims.length, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', icon: <CheckCircle size={14} /> },
                  ].map(s => (
                    <div key={s.label} className={`flex flex-col items-center justify-center px-5 py-3 rounded-xl border ${s.bg} min-w-[90px]`}>
                      <div className={`${s.color} mb-0.5`}>{s.icon}</div>
                      <div className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
                      <div className="text-slate-500 text-[10px] font-medium uppercase tracking-wide mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
        <div className="border-b border-slate-800 bg-[#0d1525]/80">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex gap-0">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-5 py-4 text-sm font-medium border-b-2 transition-all relative ${
                    tab === t.id
                      ? 'border-emerald-400 text-white'
                      : 'border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {t.count !== undefined && t.count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      tab === t.id ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'
                    }`}>
                      {t.count > 99 ? '99+' : t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div className="max-w-6xl mx-auto px-6 py-6">

          {loading ? (
            <div className="flex items-center justify-center py-32">
              <div className="text-center">
                <Loader2 size={32} className="animate-spin text-emerald-500 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">Loading opportunities…</p>
              </div>
            </div>
          ) : (
            <>
              {/* DISCOVER */}
              {tab === 'discover' && (
                <div>
                  {/* Filter bar */}
                  <div className="flex items-center gap-3 mb-6 flex-wrap">
                    <select
                      value={filterState}
                      onChange={e => setFilterState(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500 transition-colors"
                    >
                      <option value="">All States</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button
                      onClick={() => setFilterBattery(f => !f)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                        filterBattery
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
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
                    {total > 0 && (
                      <span className="text-slate-500 text-sm ml-auto">
                        {total} {total === 1 ? 'opportunity' : 'opportunities'}
                      </span>
                    )}
                  </div>

                  {opportunities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-28 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-5">
                        <Network size={28} className="text-slate-600" />
                      </div>
                      <h3 className="text-white font-semibold text-lg mb-2">No opportunities right now</h3>
                      <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
                        {profile?.service_states?.length === 0
                          ? 'Set up your service states in My Profile to see relevant opportunities in your territory.'
                          : 'New opportunities appear here when contractors share projects they can\'t service. Check back soon.'}
                      </p>
                      {profile?.service_states?.length === 0 && (
                        <button
                          onClick={() => setTab('profile')}
                          className="mt-4 px-4 py-2 text-sm font-medium text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-xl hover:bg-emerald-500/15 transition-colors"
                        >
                          Set Up My Profile →
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {opportunities.map(opp => (
                        <OpportunityCard
                          key={opp.id}
                          opp={opp}
                          onClaim={setClaimTarget}
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
                    <div className="flex flex-col items-center justify-center py-28 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-5">
                        <ArrowRight size={28} className="text-slate-600" />
                      </div>
                      <h3 className="text-white font-semibold text-lg mb-2">Nothing shared yet</h3>
                      <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
                        Have a project outside your territory or capacity? Share it to the network from the project detail page and let another contractor handle it.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myShared.map(opp => (
                        <div key={opp.id} className="bg-[#0f1623] border border-slate-700/60 rounded-xl p-4 flex items-center justify-between hover:border-slate-600 transition-colors">
                          <div>
                            <div className="text-white font-medium text-sm">{opp.site_name || `${opp.city}, ${opp.state_code}`}</div>
                            <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-slate-500 text-xs">{fmtKw(opp.system_size_kw)}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                opp.status === 'open' ? 'bg-emerald-500/15 text-emerald-400' :
                                opp.status === 'claimed' ? 'bg-amber-500/15 text-amber-400' :
                                'bg-slate-700/60 text-slate-400'
                              }`}>
                                {opp.status}
                              </span>
                              {(opp as unknown as Record<string, unknown>).claimer_company && (
                                <span className="text-slate-500 text-xs flex items-center gap-1">
                                  <ArrowRight size={10} />{(opp as unknown as Record<string, unknown>).claimer_company as string}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-slate-600 text-xs">{daysLeft(opp.expires_at)}</div>
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
                    <div className="flex flex-col items-center justify-center py-28 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-5">
                        <CheckCircle size={28} className="text-slate-600" />
                      </div>
                      <h3 className="text-white font-semibold text-lg mb-2">No claimed opportunities yet</h3>
                      <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
                        Browse the Discover tab to find eligible marketplace opportunities in your territory.
                      </p>
                      <button
                        onClick={() => setTab('discover')}
                        className="mt-4 px-4 py-2 text-sm font-medium text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-xl hover:bg-emerald-500/15 transition-colors"
                      >
                        Browse Discover →
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myClaims.map(opp => (
                        <div key={opp.id} className="bg-[#0f1623] border border-slate-700/60 rounded-xl p-4 hover:border-slate-600 transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="text-white font-medium text-sm">{opp.site_name || 'Unnamed Project'}</div>
                              {opp.address && (
                                <div className="flex items-center gap-1.5 mt-1 text-emerald-400 text-xs">
                                  <MapPin size={11} />{opp.address}
                                </div>
                              )}
                              <div className="flex items-center gap-3 mt-2">
                                <span className="text-slate-500 text-xs">{fmtKw(opp.system_size_kw)}</span>
                                {opp.utility_name && <span className="text-slate-500 text-xs">{opp.utility_name}</span>}
                                {opp.battery_candidate && (
                                  <span className="text-amber-400 text-xs flex items-center gap-1"><Battery size={10} /> Battery</span>
                                )}
                              </div>
                            </div>
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-400 ml-3 flex-shrink-0">
                              {((opp as unknown as Record<string, unknown>).claim_status as string) || 'active'}
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

        {/* ── Toast ────────────────────────────────────────────────────────── */}
        {toast && (
          <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium border ${
            toast.type === 'success'
              ? 'bg-slate-900 border-emerald-500/40 text-emerald-400'
              : 'bg-slate-900 border-rose-500/40 text-rose-400'
          }`}>
            {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            {toast.msg}
          </div>
        )}

        {/* ── Modals ───────────────────────────────────────────────────────── */}
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
            onClaim={setClaimTarget}
            onClose={() => setDetailOpp(null)}
            isClaimed={claimedIds.has(detailOpp.id)}
          />
        )}
      </div>
    </AppShell>
  );
}
