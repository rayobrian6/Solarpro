'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Search, RefreshCw, Mail, Phone, Globe, MapPin, Star,
  Building2, ChevronRight, Check, X, Users, Mailbox, Map as MapIcon,
  Sparkles, BadgeCheck, ArrowRight, Factory, List as ListIcon,
} from 'lucide-react';
import AcquisitionFloor from './AcquisitionFloor';

type Stage =
  | 'discovered' | 'enriched' | 'qualified' | 'contacted' | 'signed_up' | 'rejected';

type Prospect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  service_states: string[];
  license_number: string | null;
  license_status: string | null;
  rating: number | null;
  review_count: number | null;
  employee_estimate: string | null;
  source: string;
  source_url: string | null;
  stage: Stage;
  quality_score: number | null;
  notes: string | null;
  metadata?: { dossier?: { whyCall?: string; opener?: string; facts?: string[] } } | null;
};

function tierOf(score: number | null): { word: string; label: string; cls: string } {
  const s = score ?? 0;
  if (s >= 70) return { word: 'Hot', label: '🔥 Hot', cls: 'text-rose-300 bg-rose-500/15 border-rose-500/30' };
  if (s >= 40) return { word: 'Warm', label: 'Warm', cls: 'text-amber-300 bg-amber-500/15 border-amber-500/30' };
  return { word: 'Cold', label: 'Cold', cls: 'text-sky-300 bg-sky-500/15 border-sky-500/30' };
}

type Stats = {
  total: number;
  withEmail: number;
  withPhone: number;
  statesCovered: number;
  byStage: Record<string, number>;
  topStates: { state: string; count: number }[];
};

const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: 'discovered', label: 'Discovered', color: 'text-slate-300 bg-slate-500/15 border-slate-500/30' },
  { key: 'enriched',   label: 'Enriched',   color: 'text-sky-300 bg-sky-500/15 border-sky-500/30' },
  { key: 'qualified',  label: 'Qualified',  color: 'text-violet-300 bg-violet-500/15 border-violet-500/30' },
  { key: 'contacted',  label: 'Contacted',  color: 'text-amber-300 bg-amber-500/15 border-amber-500/30' },
  { key: 'signed_up',  label: 'Signed up',  color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' },
  { key: 'rejected',   label: 'Rejected',   color: 'text-rose-300 bg-rose-500/15 border-rose-500/30' },
];

const STAGE_META = Object.fromEntries(STAGES.map((s) => [s.key, s]));
// Linear advance path (rejected is a side action, not part of the line)
const NEXT_STAGE: Partial<Record<Stage, Stage>> = {
  discovered: 'enriched',
  enriched: 'qualified',
  qualified: 'contacted',
  contacted: 'signed_up',
};

function scoreColor(s: number | null): string {
  if (s == null) return '#64748b';
  if (s >= 75) return '#34d399';
  if (s >= 50) return '#fbbf24';
  if (s >= 25) return '#fb923c';
  return '#94a3b8';
}

function ScoreRing({ score }: { score: number | null }) {
  const s = score ?? 0;
  const r = 16;
  const c = 2 * Math.PI * r;
  const off = c - (s / 100) * c;
  const col = scoreColor(score);
  return (
    <div className="relative w-11 h-11 flex-shrink-0">
      <svg viewBox="0 0 40 40" className="w-11 h-11 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="#1e293b" strokeWidth="4" />
        <circle
          cx="20" cy="20" r={r} fill="none" stroke={col} strokeWidth="4"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[11px] font-bold"
        style={{ color: col }}
      >
        {score ?? '—'}
      </span>
    </div>
  );
}

function Kpi({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: string | number; accent: string;
}) {
  return (
    <div className="rounded-xl bg-[#0d1424] border border-white/5 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent}`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold text-white leading-none">{value}</div>
        <div className="text-[11px] text-slate-500 mt-1 uppercase tracking-wide">{label}</div>
      </div>
    </div>
  );
}

export default function ProspectsPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<Stage | 'all'>('all');
  const [stateFilter, setStateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'floor' | 'list'>('floor');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (stageFilter !== 'all') params.set('stage', stageFilter);
      if (stateFilter) params.set('state', stateFilter);
      if (search.trim()) params.set('q', search.trim());
      const res = await fetch(`/api/admin/prospects?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setProspects(data.prospects);
        setStats(data.stats);
      }
    } finally {
      setLoading(false);
    }
  }, [stageFilter, stateFilter, search]);

  useEffect(() => { load(); }, [stageFilter, stateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCsv() {
    const header = ['company', 'contact', 'email', 'phone', 'website', 'city', 'state', 'rating', 'reviews', 'score', 'tier', 'stage', 'why_call', 'opener', 'source', 'notes'];
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = prospects.map((p) => {
      const d = p.metadata?.dossier;
      return [p.company_name, p.contact_name, p.email, p.phone, p.website, p.city, p.state, p.rating, p.review_count,
        p.quality_score, tierOf(p.quality_score).word, p.stage, d?.whyCall, d?.opener, p.source, p.notes].map(esc).join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `solarpro-leads-${stageFilter}-${stateFilter || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function setStage(id: string, stage: Stage) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/prospects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      const data = await res.json();
      if (data.success) {
        setProspects((prev) => prev.map((p) => (p.id === id ? data.prospect : p)));
        load();
      }
    } finally {
      setBusyId(null);
    }
  }

  const topStates = stats?.topStates ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles size={22} className="text-amber-400" />
            Contractor Acquisition
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            The supply side. Robots discover, enrich, and vet solar installers nationwide so your
            sales team gets a clean, qualified call list. No outreach is sent and no accounts are
            created — this is lead prep for a human to work the phones.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-lg bg-white/5 p-0.5">
            <button
              onClick={() => setViewMode('floor')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'floor' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Factory size={13} /> Floor
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'list' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              <ListIcon size={13} /> List
            </button>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Building2 size={18} className="text-amber-400" />} accent="bg-amber-500/15"
          label="Total prospects" value={stats?.total ?? 0} />
        <Kpi icon={<Mailbox size={18} className="text-sky-400" />} accent="bg-sky-500/15"
          label="With email" value={stats?.withEmail ?? 0} />
        <Kpi icon={<MapIcon size={18} className="text-violet-400" />} accent="bg-violet-500/15"
          label="States covered" value={stats?.statesCovered ?? 0} />
        <Kpi icon={<BadgeCheck size={18} className="text-emerald-400" />} accent="bg-emerald-500/15"
          label="Signed up" value={stats?.byStage?.signed_up ?? 0} />
      </div>

      {/* The sweatshop floor */}
      {viewMode === 'floor' && (
        <AcquisitionFloor
          byStage={stats?.byStage ?? {}}
          total={stats?.total ?? 0}
          onEnterRoom={(stage) => { setStageFilter(stage); setViewMode('list'); }}
          onDispatched={load}
        />
      )}

      {viewMode === 'list' && (
      <>
      {/* Stage pipeline tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setStageFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            stageFilter === 'all'
              ? 'bg-white/10 text-white border-white/20'
              : 'text-slate-400 border-white/5 hover:bg-white/5'
          }`}
        >
          All <span className="opacity-60">{stats?.total ?? 0}</span>
        </button>
        {STAGES.map((s) => (
          <button
            key={s.key}
            onClick={() => setStageFilter(s.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              stageFilter === s.key ? s.color : 'text-slate-400 border-white/5 hover:bg-white/5'
            }`}
          >
            {s.label} <span className="opacity-60">{stats?.byStage?.[s.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Search company, email, city…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0d1424] border border-white/5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/40"
          />
        </div>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#0d1424] border border-white/5 text-sm text-white focus:outline-none focus:border-amber-500/40"
        >
          <option value="">All states</option>
          {topStates.map((s) => (
            <option key={s.state} value={s.state}>{s.state} ({s.count})</option>
          ))}
        </select>
        <button
          onClick={exportCsv}
          disabled={prospects.length === 0}
          title="Download these leads as a CSV for the sales team"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 text-sm font-medium hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
        >
          ⬇ Export CSV ({prospects.length})
        </button>
      </div>

      {/* Prospect grid */}
      {loading ? (
        <div className="text-center text-slate-500 py-20">Loading the floor…</div>
      ) : prospects.length === 0 ? (
        <div className="text-center py-20 rounded-xl border border-dashed border-white/10">
          <Users size={32} className="mx-auto text-slate-600 mb-3" />
          <div className="text-white font-medium">No prospects yet</div>
          <div className="text-sm text-slate-500 mt-1">
            Put the robots to work — discovered installers will land here.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {prospects.map((p) => {
            const stageMeta = STAGE_META[p.stage];
            const next = NEXT_STAGE[p.stage];
            return (
              <div
                key={p.id}
                className="rounded-xl bg-[#0d1424] border border-white/5 p-4 flex flex-col gap-3 hover:border-white/15 transition-colors"
              >
                {/* Top row */}
                <div className="flex items-start gap-3">
                  <ScoreRing score={p.quality_score} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white truncate">{p.company_name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <MapPin size={11} />
                      {[p.city, p.state].filter(Boolean).join(', ') || 'Location unknown'}
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ${stageMeta?.color}`}>
                    {stageMeta?.label}
                  </span>
                </div>

                {/* Signals */}
                <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${tierOf(p.quality_score).cls}`}>{tierOf(p.quality_score).label}</span>
                  {p.rating != null && (
                    <span className="flex items-center gap-1">
                      <Star size={11} className="text-amber-400 fill-amber-400" />
                      {p.rating}{p.review_count != null && <span className="text-slate-600">({p.review_count})</span>}
                    </span>
                  )}
                  {p.license_number && (
                    <span className="flex items-center gap-1 text-emerald-400/80">
                      <BadgeCheck size={11} /> Licensed
                    </span>
                  )}
                  {p.employee_estimate && (
                    <span className="flex items-center gap-1">
                      <Users size={11} /> {p.employee_estimate}
                    </span>
                  )}
                  <span className="text-slate-600 ml-auto">{p.source}</span>
                </div>

                {/* Contact chips */}
                <div className="flex items-center gap-2 flex-wrap">
                  {p.email ? (
                    <a href={`mailto:${p.email}`} className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 truncate max-w-[180px]">
                      <Mail size={11} /> <span className="truncate">{p.email}</span>
                    </a>
                  ) : (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-white/5 text-slate-600">
                      <Mail size={11} /> no email
                    </span>
                  )}
                  {p.phone && (
                    <a href={`tel:${p.phone}`} className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-white/5 text-slate-300 hover:bg-white/10">
                      <Phone size={11} /> {p.phone}
                    </a>
                  )}
                  {p.website && (
                    <a href={p.website.startsWith('http') ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-white/5 text-slate-300 hover:bg-white/10">
                      <Globe size={11} /> site
                    </a>
                  )}
                </div>

                {p.notes && <p className="text-xs text-slate-500 line-clamp-2">{p.notes}</p>}

                {p.metadata?.dossier && (
                  <div className="rounded-md bg-violet-500/10 border border-violet-500/20 p-2 text-[11px] space-y-1">
                    {p.metadata.dossier.whyCall && <div className="text-violet-300 font-semibold">📖 {p.metadata.dossier.whyCall}</div>}
                    {p.metadata.dossier.opener && <div className="text-slate-400 italic">&ldquo;{p.metadata.dossier.opener}&rdquo;</div>}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 mt-auto pt-1">
                  {next && (
                    <button
                      disabled={busyId === p.id}
                      onClick={() => setStage(p.id, next)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 text-xs font-medium hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                    >
                      Move to {STAGE_META[next].label} <ArrowRight size={12} />
                    </button>
                  )}
                  {p.stage === 'signed_up' && (
                    <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-medium">
                      <Check size={12} /> Closed
                    </span>
                  )}
                  {p.stage !== 'rejected' && p.stage !== 'signed_up' && (
                    <button
                      disabled={busyId === p.id}
                      onClick={() => setStage(p.id, 'rejected')}
                      title="Reject"
                      className="px-2 py-1.5 rounded-lg bg-white/5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                  {p.stage === 'rejected' && (
                    <button
                      disabled={busyId === p.id}
                      onClick={() => setStage(p.id, 'discovered')}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 text-xs font-medium hover:bg-white/10 disabled:opacity-50 transition-colors"
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}
