'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight,
  BarChart3, CheckCircle2, ChevronDown, ChevronUp,
  Clock, Filter, Globe, Network, RefreshCw,
  Search, Shield, Sparkles, TrendingUp, Users, Zap,
  XCircle, Play, Eye, Star, Target, Layers,
  Inbox, Cpu, Webhook, RotateCcw, StopCircle,
  CheckCheck, Loader2, Ban, FlaskConical,
  Megaphone, DollarSign, TrendingDown, PlusCircle, Pencil, Trash2, ExternalLink, ClipboardList, Copy,
} from 'lucide-react';
import {
  buildEnrichmentChips,
  buildEnrichmentDetailGroups,
  deriveEnrichmentState,
  enrichmentWarnings,
  fieldValue,
  formatConfidence,
  formatDisplayValue,
  getEnrichmentPayload,
  getEnrichedField,
  percentFromCompleteness,
  stateTone,
  topEnrichmentFactors,
  type EnrichmentCarrier,
  type EnrichmentChip,
  type EnrichmentState,
} from '@/lib/network/opportunityEnrichmentDisplay';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface HealthData {
  health: { score: number; status: string; issues: string[]; warnings: string[] };
  pipeline: Record<string, unknown>;
  contractors: Record<string, unknown>;
  screening: Record<string, unknown>;
  claims: Record<string, unknown>;
  events: Record<string, unknown>;
  recent_events: Array<Record<string, unknown>>;
}

interface Opportunity extends EnrichmentCarrier {
  id: string;
  status: string;
  source_type: string;
  homeowner_first_name?: string;
  homeowner_last_name?: string;
  homeowner_phone?: string;
  address?: string;
  city?: string;
  state?: string;
  monthly_bill?: number;
  opportunity_score?: number;
  opportunity_grade?: string;
  overall_grade?: string;
  overall_score?: number;
  pipeline_status?: string;
  auto_decision?: string;
  platform?: string;
  cost_per_lead?: number;
  created_at: string;
  executive_summary?: string;
  risk_flags?: string[];
  opportunity_highlights?: string[];
}

interface AnalyticsData {
  funnel?: Record<string, unknown>;
  sources?: Array<Record<string, unknown>>;
  geography?: Array<Record<string, unknown>>;
  quality?: Record<string, unknown>;
  trend?: Array<Record<string, unknown>>;
}

interface MarketplaceOpportunity extends EnrichmentCarrier {
  id: string;
  homeowner_name?: string | null;
  homeowner_first_name?: string | null;
  homeowner_last_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  location_zip?: string | null;
  source_type?: string | null;
  status: string;
  screening_status?: string | null;
  live_at?: string | null;
  created_at: string;
  estimated_project_value?: number | null;
  asking_price?: number | null;
  listing_price?: number | null;
  opportunity_score?: number | null;
  opportunity_grade?: string | null;
  overall_score?: number | null;
  overall_grade?: string | null;
  market_price?: number | null;
  executive_summary?: string | null;
  risk_flags?: string[] | null;
  opportunity_highlights?: string[] | null;
  total_eligible_contractors?: number | null;
  top_match_score?: number | null;
  auto_decision?: string | null;
  auto_decision_reason?: string | null;
  override_decision?: string | null;
  override_reason?: string | null;
  confidence_score?: number | null;
  step10_fail_reasons?: string[] | null;
  assignment_count?: number | null;
  active_offer_count?: number | null;
  claimed_or_active_count?: number | null;
  current_assignment_status?: string | null;
  last_offered_at?: string | null;
}


interface SimulatedOpportunity {
  id: string;
  status: string;
  source_type?: string | null;
  source_channel?: string | null;
  city?: string | null;
  state?: string | null;
  homeowner_name?: string | null;
  homeowner_first_name?: string | null;
  homeowner_last_name?: string | null;
  created_at: string;
  live_at?: string | null;
  screening_status?: string | null;
  raw_payload?: Record<string, unknown> | null;
  intake_metadata?: Record<string, unknown> | null;
  overall_score?: number | null;
  overall_grade?: string | null;
  executive_summary?: string | null;
  auto_decision?: string | null;
  auto_decision_reason?: string | null;
  override_decision?: string | null;
  override_reason?: string | null;
  confidence_score?: number | null;
  step10_fail_reasons?: string[] | null;
  assignment_count?: number | null;
  event_count?: number | null;
  last_event_at?: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

function GradeBadge({ grade }: { grade?: string }) {
  if (!grade) return null;
  const colors: Record<string, string> = {
    'A+': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    'A':  'bg-green-500/20 text-green-400 border-green-500/30',
    'B':  'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'C':  'bg-amber-500/20 text-amber-400 border-amber-500/30',
    'D':  'bg-orange-500/20 text-orange-400 border-orange-500/30',
    'F':  'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-bold ${colors[grade] ?? 'bg-zinc-700 text-zinc-400 border-zinc-600'}`}>
      {grade}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    intake:     'bg-zinc-700 text-zinc-300',
    screening:  'bg-blue-500/20 text-blue-300',
    scored:     'bg-violet-500/20 text-violet-300',
    live:       'bg-emerald-500/20 text-emerald-300',
    claimed:    'bg-green-500/20 text-green-300',
    rejected:   'bg-red-500/20 text-red-300',
    closed_won: 'bg-emerald-600/30 text-emerald-300',
    closed_lost:'bg-red-600/30 text-red-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? 'bg-zinc-700 text-zinc-400'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function toneClasses(tone: EnrichmentChip['tone'] | ReturnType<typeof stateTone>) {
  const tones: Record<string, string> = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    orange: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
    slate: 'border-zinc-700 bg-zinc-800/70 text-zinc-400',
  };
  return tones[tone] ?? tones.slate;
}

function EnrichmentStateBadge({ state }: { state: EnrichmentState }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClasses(stateTone(state))}`}>{state}</span>;
}

function EnrichmentChipList({ chips }: { chips: EnrichmentChip[] }) {
  if (!chips.length) return <span className="text-[11px] text-zinc-600">No operational chips yet</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(chip => <span key={chip.label} className={`rounded border px-2 py-0.5 text-[11px] font-medium ${toneClasses(chip.tone)}`}>{chip.label}</span>)}
    </div>
  );
}

function EnrichmentCompleteness({ percent }: { percent: number }) {
  const color = percent >= 70 ? 'bg-emerald-500' : percent >= 45 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="min-w-[120px]">
      <div className="mb-1 flex items-center justify-between text-[11px]"><span className="text-zinc-500">Completeness</span><span className="font-semibold text-zinc-300">{percent}%</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full ${color}`} style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function EnrichmentDetailGroups({ row }: { row: EnrichmentCarrier }) {
  const groups = buildEnrichmentDetailGroups(row);
  const warnings = enrichmentWarnings(row).slice(0, 4);
  const factors = topEnrichmentFactors(row, 5);
  if (!groups.length && !warnings.length && !factors.length) return <p>No enrichment projection available yet.</p>;
  return (
    <div className="space-y-3">
      {groups.map(group => (
        <div key={group.title}>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{group.title}</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {group.items.map(item => (
              <div key={`${group.title}-${item.label}`} className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
                <div className="flex items-center justify-between gap-2"><span className="text-zinc-500">{item.label}</span><span className="font-semibold text-zinc-200">{item.value}</span></div>
                <div className="mt-1 text-[10px] text-zinc-600">Confidence {formatConfidence(item.confidence)}</div>
                {item.factors.length ? <div className="mt-1 text-[10px] text-blue-300">Factors: {item.factors.join(', ')}</div> : null}
                {item.warnings.length ? <div className="mt-1 text-[10px] text-amber-300">Warnings: {item.warnings.join(', ')}</div> : null}
                {item.missing.length ? <div className="mt-1 text-[10px] text-rose-300">Missing: {item.missing.join(', ')}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ))}
      {warnings.length ? <div className="rounded border border-amber-500/20 bg-amber-500/10 p-2 text-[11px] text-amber-200">Warnings: {warnings.join(', ')}</div> : null}
      {factors.length ? <div className="text-[11px] text-zinc-500">Top operational factors: {factors.join(', ')}</div> : null}
    </div>
  );
}

function HealthMeter({ score, status }: { score: number; status: string }) {
  const color = status === 'excellent' ? '#10b981' :
                status === 'good' ? '#3b82f6' :
                status === 'degraded' ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#27272a" strokeWidth="6" />
          <circle
            cx="32" cy="32" r="26" fill="none"
            stroke={color} strokeWidth="6"
            strokeDasharray={`${(score / 100) * 163.4} 163.4`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-white">{score}</span>
        </div>
      </div>
      <div>
        <div className="text-sm font-semibold text-white capitalize">{status}</div>
        <div className="text-xs text-zinc-400">Health Score</div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, color = 'text-white',
  icon: Icon,
}: {
  label: string; value: string | number; sub?: string;
  color?: string; icon?: React.ElementType;
}) {
  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-zinc-400 mb-1">{label}</div>
          <div className={`text-2xl font-bold ${color}`}>{value}</div>
          {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
        </div>
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-zinc-700/50 flex items-center justify-center">
            <Icon className="w-4 h-4 text-zinc-400" />
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Section Components
// ──────────────────────────────────────────────────────────────────────────────

function LiveFeedSection({ opportunities, onRefresh, loading }: {
  opportunities: Opportunity[];
  onRefresh: () => void;
  loading: boolean;
}) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = opportunities.filter(o => {
    if (filter !== 'all' && o.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        `${o.homeowner_first_name} ${o.homeowner_last_name}`.toLowerCase().includes(q) ||
        (o.homeowner_phone ?? '').includes(q) ||
        (o.address ?? '').toLowerCase().includes(q) ||
        (o.state ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by name, phone, address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500"
          />
        </div>
        <div className="flex gap-1">
          {['all','intake','screening','scored','live','claimed','rejected'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === s
                  ? 'bg-orange-500 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700'
              }`}
            >
              {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-700/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800/80 border-b border-zinc-700/50">
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Homeowner</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Location</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Source</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Score</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Status</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Pipeline</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Received</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-zinc-500">
                  {loading ? 'Loading…' : 'No opportunities found'}
                </td>
              </tr>
            ) : filtered.map(opp => (
              <tr key={opp.id} className="border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-white">
                    {opp.homeowner_first_name} {opp.homeowner_last_name}
                  </div>
                  <div className="text-xs text-zinc-500">{opp.homeowner_phone}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-zinc-200">{opp.city}, {opp.state}</div>
                  {opp.monthly_bill && (
                    <div className="text-xs text-zinc-500">${opp.monthly_bill}/mo bill</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="text-zinc-300 text-xs">{opp.source_type?.replace(/_/g, ' ')}</div>
                  {opp.platform && <div className="text-xs text-zinc-500">{opp.platform}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <GradeBadge grade={opp.overall_grade ?? opp.opportunity_grade} />
                    {(opp.overall_score ?? opp.opportunity_score) && (
                      <span className="text-xs text-zinc-400">
                        {Math.round((opp.overall_score ?? opp.opportunity_score) as number)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={opp.status} />
                </td>
                <td className="px-4 py-3">
                  {opp.pipeline_status ? (
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        opp.pipeline_status === 'completed' ? 'bg-green-500' :
                        opp.pipeline_status === 'running' ? 'bg-blue-500 animate-pulse' :
                        opp.pipeline_status === 'failed' ? 'bg-red-500' : 'bg-zinc-600'
                      }`} />
                      <span className="text-xs text-zinc-400">
                        {opp.pipeline_status}
                        {opp.auto_decision && ` · ${opp.auto_decision}`}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">
                  {new Date(opp.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button className="text-zinc-600 hover:text-orange-400 transition-colors">
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScreeningSection() {
  const [queue, setQueue] = useState<Array<Record<string, unknown>>>([]);
  const [stats, setStats] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [triggerOppId, setTriggerOppId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<Record<string, unknown> | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/network/screening?limit=15');
      const data = await res.json();
      setQueue(data.queue ?? []);
      setStats(data.stats ?? {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  async function triggerScreening() {
    if (!triggerOppId.trim()) return;
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch('/api/admin/network/screening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity_id: triggerOppId }),
      });
      const data = await res.json();
      setTriggerResult(data);
      if (data.success) await loadQueue();
    } catch (e) {
      setTriggerResult({ error: String(e) });
    } finally {
      setTriggering(false);
    }
  }

  async function runScreeningAction(opportunityId: string, action: 'approve' | 'reject' | 'request_more_info' | 'release_to_marketplace') {
    if (action === 'release_to_marketplace' && !confirm('Release this approved opportunity to the contractor marketplace?')) return;
    if (action === 'reject' && !confirm('Reject this opportunity from the marketplace pipeline?')) return;

    setActionBusy(`${opportunityId}:${action}`);
    setTriggerResult(null);
    try {
      const res = await fetch('/api/admin/network/screening', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity_id: opportunityId, action }),
      });
      const data = await res.json();
      setTriggerResult(data);
      await loadQueue();
    } catch (e) {
      setTriggerResult({ error: String(e) });
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {[
          { label: 'Pending', value: stats.pending_screening ?? 0, color: 'text-zinc-300' },
          { label: 'Running', value: stats.running_screening ?? 0, color: 'text-blue-400' },
          { label: 'Auto Passed', value: stats.auto_passed ?? 0, color: 'text-emerald-400' },
          { label: 'Auto Failed', value: stats.auto_failed ?? 0, color: 'text-red-400' },
          { label: 'Needs Review', value: stats.needs_review ?? 0, color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
            <div className="text-xs text-zinc-400 mb-1">{s.label}</div>
            <div className={`text-2xl font-bold ${s.color}`}>{String(s.value)}</div>
          </div>
        ))}
      </div>

      {/* Trigger Screening */}
      <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
        <div className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Play className="w-4 h-4 text-orange-500" />
          Trigger Screening Pipeline
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Opportunity UUID…"
            value={triggerOppId}
            onChange={e => setTriggerOppId(e.target.value)}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500"
          />
          <button
            onClick={triggerScreening}
            disabled={triggering || !triggerOppId.trim()}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {triggering ? 'Running…' : 'Screen Now'}
          </button>
        </div>
        {triggerResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm font-mono ${
            triggerResult.error ? 'bg-red-900/20 text-red-400' : 'bg-zinc-900 text-zinc-300'
          }`}>
            {JSON.stringify(triggerResult, null, 2)}
          </div>
        )}
      </div>

      {/* Queue Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-700/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800/80 border-b border-zinc-700/50">
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Homeowner</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">State</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Pipeline</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Decision</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Confidence</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Intelligence</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Duration</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Date</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-8 text-zinc-500">Loading…</td></tr>
            ) : queue.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-zinc-500">Queue is empty</td></tr>
            ) : queue.map((row, i) => {
              const carrier = row as EnrichmentCarrier;
              const payload = getEnrichmentPayload(carrier);
              const state = deriveEnrichmentState(carrier);
              const completeness = percentFromCompleteness(carrier.enrichment_completeness);
              const chips = buildEnrichmentChips(carrier, 'admin').slice(0, 4);
              const warnings = enrichmentWarnings(carrier).slice(0, 2);
              const homeownerIntent = getEnrichedField<number>(payload, 'homeowner_sales', 'homeowner_intent_score');
              const utilityScore = getEnrichedField<number>(payload, 'territory_utility', 'utility_score');
              const permitComplexity = getEnrichedField<string>(payload, 'territory_utility', 'permit_complexity');
              const batteryReadiness = getEnrichedField<string>(payload, 'roof_install', 'battery_readiness');
              const contractorFit = getEnrichedField<number>(payload, 'marketplace', 'contractor_fit_score');
              const fraudRisk = getEnrichedField<number>(payload, 'risk', 'fraud_risk');
              return (
              <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-white">
                    {row.homeowner_first_name as string} {row.homeowner_last_name as string}
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-300">{row.state as string}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      row.pipeline_status === 'completed' ? 'bg-green-500' :
                      row.pipeline_status === 'running' ? 'bg-blue-500 animate-pulse' :
                      row.pipeline_status === 'failed' ? 'bg-red-500' : 'bg-zinc-600'
                    }`} />
                    <span className="text-xs text-zinc-300">{row.pipeline_status as string}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {row.auto_decision && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      row.auto_decision === 'pass' ? 'bg-emerald-500/20 text-emerald-400' :
                      row.auto_decision === 'fail' ? 'bg-red-500/20 text-red-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {row.auto_decision as string}
                    </span>
                  )}
                  {row.override_decision && (
                    <span className="ml-1 text-xs text-violet-400">→ {row.override_decision as string}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-300 text-xs">
                  {row.confidence_score ? `${Math.round(row.confidence_score as number)}%` : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="min-w-[260px] space-y-2">
                    <div className="flex flex-wrap items-center gap-2"><EnrichmentStateBadge state={state} /><EnrichmentCompleteness percent={completeness} /></div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                      <span>Intent <b className="text-zinc-300">{formatDisplayValue(homeownerIntent?.value)}</b></span>
                      <span>Utility <b className="text-zinc-300">{formatDisplayValue(utilityScore?.value)}</b></span>
                      <span>Permit <b className="text-zinc-300 capitalize">{formatDisplayValue(permitComplexity?.value)}</b></span>
                      <span>Battery <b className="text-zinc-300 capitalize">{formatDisplayValue(batteryReadiness?.value)}</b></span>
                      <span>Fit <b className="text-zinc-300">{formatDisplayValue(contractorFit?.value)}</b></span>
                      <span>Fraud <b className="text-zinc-300">{formatDisplayValue(fraudRisk?.value)}</b></span>
                    </div>
                    <EnrichmentChipList chips={chips} />
                    {warnings.length ? <div className="text-[11px] text-amber-300">Warnings: {warnings.join(', ')}</div> : null}
                    {row.low_quality_reason ? <div className="text-[11px] text-rose-300">Low quality: {row.low_quality_reason as string}</div> : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-500 text-xs">
                  {row.duration_ms ? `${Math.round((row.duration_ms as number) / 1000)}s` : '—'}
                </td>
                <td className="px-4 py-3 text-zinc-500 text-xs">
                  {new Date(row.created_at as string).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      ['approve', 'Approve', 'text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10'],
                      ['reject', 'Reject', 'text-red-300 border-red-500/30 hover:bg-red-500/10'],
                      ['request_more_info', 'More Info', 'text-amber-300 border-amber-500/30 hover:bg-amber-500/10'],
                      ['release_to_marketplace', 'Release', 'text-blue-300 border-blue-500/30 hover:bg-blue-500/10'],
                    ] as const).map(([action, label, className]) => {
                      const id = row.opportunity_id as string;
                      const busy = actionBusy === `${id}:${action}`;
                      return (
                        <button
                          key={action}
                          onClick={() => runScreeningAction(id, action)}
                          disabled={!!actionBusy}
                          className={`rounded border px-2 py-1 text-[10px] font-semibold transition disabled:opacity-40 ${className}`}
                        >
                          {busy ? '…' : label}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalyticsSection({ data }: { data: AnalyticsData | null }) {
  if (!data) return <div className="text-center py-12 text-zinc-500">Loading analytics…</div>;

  const funnel = data.funnel as Record<string, unknown> ?? {};
  const sources = data.sources ?? [];
  const geo = data.geography ?? [];

  const funnelSteps = [
    { label: 'Total Leads', value: funnel.total_leads, color: 'bg-zinc-600' },
    { label: 'Screened', value: funnel.screened, color: 'bg-blue-600' },
    { label: 'Qualified', value: funnel.qualified, color: 'bg-violet-600' },
    { label: 'Published', value: funnel.published, color: 'bg-orange-500' },
    { label: 'Claimed', value: funnel.claimed, color: 'bg-amber-500' },
    { label: 'Won', value: funnel.won, color: 'bg-emerald-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Funnel */}
      <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-5">
        <div className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Target className="w-4 h-4 text-orange-500" />
          Conversion Funnel
        </div>
        <div className="flex items-end gap-2 h-24">
          {funnelSteps.map((step, i) => {
            const max = parseInt(funnelSteps[0].value as string) || 1;
            const val = parseInt(step.value as string) || 0;
            const pct = Math.max(8, (val / max) * 100);
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-xs text-zinc-400">{val}</div>
                <div
                  className={`w-full rounded-t-lg ${step.color} transition-all`}
                  style={{ height: `${pct}%` }}
                />
                <div className="text-xs text-zinc-500 text-center leading-tight">{step.label}</div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-zinc-700">
          <div className="text-center">
            <div className="text-xs text-zinc-400">Screen Rate</div>
            <div className="text-sm font-semibold text-blue-400">
              {Math.round(parseFloat(funnel.screen_rate as string ?? '0') * 100)}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-zinc-400">Claim Rate</div>
            <div className="text-sm font-semibold text-amber-400">
              {Math.round(parseFloat(funnel.claim_rate as string ?? '0') * 100)}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-zinc-400">Win Rate</div>
            <div className="text-sm font-semibold text-emerald-400">
              {Math.round(parseFloat(funnel.win_rate as string ?? '0') * 100)}%
            </div>
          </div>
        </div>
      </div>

      {/* Sources + Geo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Source Performance */}
        <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-5">
          <div className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-orange-500" />
            Source Performance
          </div>
          <div className="space-y-2">
            {sources.map((src, i) => {
              const total = parseInt(src.total as string) || 0;
              const max = parseInt(sources[0]?.total as string) || 1;
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-28 text-xs text-zinc-400 truncate">
                    {(src.source_type as string)?.replace(/_/g, ' ')}
                  </div>
                  <div className="flex-1 bg-zinc-700 rounded-full h-1.5">
                    <div
                      className="bg-orange-500 h-1.5 rounded-full"
                      style={{ width: `${(total / max) * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-zinc-300 w-8 text-right">{total}</div>
                  {src.avg_cpl && (
                    <div className="text-xs text-zinc-500 w-16 text-right">
                      ${parseFloat(src.avg_cpl as string).toFixed(0)} CPL
                    </div>
                  )}
                </div>
              );
            })}
            {sources.length === 0 && <div className="text-center py-4 text-zinc-500 text-sm">No source data</div>}
          </div>
        </div>

        {/* Geography */}
        <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-5">
          <div className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Globe className="w-4 h-4 text-orange-500" />
            Top States
          </div>
          <div className="space-y-2">
            {geo.slice(0, 8).map((g, i) => {
              const total = parseInt(g.total as string) || 0;
              const max = parseInt(geo[0]?.total as string) || 1;
              const avgScore = parseFloat(g.avg_score as string);
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 text-xs font-semibold text-zinc-300">{g.state as string}</div>
                  <div className="flex-1 bg-zinc-700 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full"
                      style={{ width: `${(total / max) * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-zinc-300 w-6 text-right">{total}</div>
                  {!isNaN(avgScore) && (
                    <div className="text-xs text-zinc-500 w-16 text-right">
                      avg {avgScore.toFixed(0)}/100
                    </div>
                  )}
                </div>
              );
            })}
            {geo.length === 0 && <div className="text-center py-4 text-zinc-500 text-sm">No geographic data</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthSection({ health }: { health: HealthData | null }) {
  if (!health) return <div className="text-center py-12 text-zinc-500">Loading health data…</div>;

  const { pipeline, contractors, screening, claims, events, recent_events } = health;

  return (
    <div className="space-y-6">
      {/* Health Overview */}
      <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold text-white">System Health</div>
          <HealthMeter score={health.health.score} status={health.health.status} />
        </div>
        {health.health.issues.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {health.health.issues.map((issue, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-red-400">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {issue}
              </div>
            ))}
          </div>
        )}
        {health.health.warnings.length > 0 && (
          <div className="space-y-1.5">
            {health.health.warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {w}
              </div>
            ))}
          </div>
        )}
        {health.health.issues.length === 0 && health.health.warnings.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> All systems operating normally
          </div>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Live Opportunities" value={String(pipeline.live_count ?? 0)} icon={Zap} color="text-emerald-400" />
        <StatCard label="Active Contractors" value={String(contractors.active_contractors ?? 0)} icon={Users} color="text-blue-400" />
        <StatCard label="Pending Review" value={String(screening.pending_review ?? 0)} icon={Eye} color="text-amber-400" />
        <StatCard label="Open Disputes" value={String(claims.open_disputes ?? 0)} icon={AlertCircle} color="text-red-400" />
        <StatCard label="Claims (7d)" value={String(claims.claims_last_7d ?? 0)} icon={Star} color="text-green-400" />
        <StatCard label="Screening Pass Rate" value={`${screening.pass_rate_pct ?? 0}%`} icon={Shield} color="text-violet-400" />
        <StatCard label="Errors (24h)" value={String(events.errors_last_24h ?? 0)} icon={AlertCircle} color="text-red-400" />
        <StatCard label="Avg Score (Live)" value={pipeline.avg_live_score ? `${Math.round(parseFloat(String(pipeline.avg_live_score)))}` : '—'} icon={TrendingUp} color="text-orange-400" />
      </div>

      {/* Recent Events */}
      <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2">
          <Activity className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-semibold text-white">Recent Events</span>
        </div>
        <div className="divide-y divide-zinc-800">
          {(recent_events ?? []).slice(0, 10).map((evt, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-zinc-800/40">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                evt.is_error ? 'bg-red-500' :
                (evt.event_type as string)?.includes('claimed') ? 'bg-emerald-500' :
                (evt.event_type as string)?.includes('screening') ? 'bg-blue-500' : 'bg-zinc-600'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-300 truncate">{evt.event_type as string}</div>
                {(evt.homeowner_first_name || evt.state) && (
                  <div className="text-xs text-zinc-500">
                    {evt.homeowner_first_name as string} · {evt.state as string}
                    {evt.opportunity_grade && ` · Grade ${evt.opportunity_grade as string}`}
                  </div>
                )}
              </div>
              <div className="text-xs text-zinc-600 flex-shrink-0">
                {new Date(evt.occurred_at as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
          {(!recent_events || recent_events.length === 0) && (
            <div className="text-center py-8 text-zinc-500 text-sm">No recent events</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Control Center
// ──────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'live',        label: 'Live Feed',          icon: Zap },
  { id: 'marketplace', label: 'Marketplace Workbench', icon: ClipboardList },
  { id: 'simulator',   label: 'Seed / Simulate Intake', icon: FlaskConical },
  { id: 'screening',   label: 'Screening Queue',    icon: Shield },
  { id: 'analytics',   label: 'Campaign Intel',     icon: BarChart3 },
  { id: 'matching',    label: 'Contractor Match',   icon: Users },
  { id: 'health',      label: 'Marketplace Health', icon: Activity },
  { id: 'intake',      label: 'Intake Feed',        icon: Inbox },
  { id: 'enrichment',  label: 'Enrichment Queue',   icon: Cpu },
  { id: 'webhooks',    label: 'Webhook Log',        icon: Webhook },
  { id: 'funnels',     label: 'Intake Funnels',     icon: Globe },
  { id: 'campaigns',   label: 'Campaigns',          icon: Megaphone },
] as const;

type TabId = typeof TABS[number]['id'];

export default function NetworkControlCenter() {
  const [activeTab, setActiveTab] = useState<TabId>('live');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pipelineStats, setPipelineStats] = useState<Record<string, unknown>>({});
  const [adminRole, setAdminRole] = useState<string | null>(null);

  const loadAdminRole = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = await res.json();
      setAdminRole(data?.data?.role ?? null);
    } catch {
      setAdminRole(null);
    }
  }, []);

  const loadOpportunities = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/network/opportunities?limit=50&sort=created_at&dir=desc');
      const data = await res.json();
      if (data.success) {
        setOpportunities(data.opportunities ?? []);
        setPipelineStats(data.stats ?? {});
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/network/analytics?days=30');
      const data = await res.json();
      if (data.success) setAnalytics(data);
    } catch (e) { console.error(e); }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/network/health');
      const data = await res.json();
      if (data.success) setHealthData(data);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    loadAdminRole();
    loadOpportunities();
    loadAnalytics();
    loadHealth();
  }, [loadAdminRole, loadOpportunities, loadAnalytics, loadHealth]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="bg-zinc-900/80 border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center">
              <Network className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white">Network Intelligence OS</h1>
              <p className="text-xs text-zinc-400">Marketplace Control Center</p>
            </div>
          </div>

          {/* Quick Pipeline Stats */}
          <div className="hidden md:flex items-center gap-4">
            {[
              { label: 'Live', value: pipelineStats.live_count, color: 'text-emerald-400' },
              { label: 'Screening', value: pipelineStats.screening_count, color: 'text-blue-400' },
              { label: 'Scored', value: pipelineStats.scored_count, color: 'text-violet-400' },
              { label: '24h New', value: pipelineStats.last_24h, color: 'text-orange-400' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className={`text-lg font-bold ${s.color}`}>{String(s.value ?? '—')}</div>
                <div className="text-xs text-zinc-500">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {adminRole === 'super_admin' && (
              <Link
                href="/admin/network/intelligence"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-blue-500/40 hover:text-blue-300"
              >
                <ExternalLink className="h-3 w-3" />
                Intelligence Runner
              </Link>
            )}

          {healthData && (
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                healthData.health.status === 'excellent' ? 'bg-emerald-500' :
                healthData.health.status === 'good' ? 'bg-blue-500' :
                healthData.health.status === 'degraded' ? 'bg-amber-500' : 'bg-red-500 animate-pulse'
              }`} />
              <span className="text-xs text-zinc-400 capitalize">{healthData.health.status}</span>
              <span className="text-xs text-zinc-600">· Score {healthData.health.score}</span>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-zinc-900/50 border-b border-zinc-800 px-6">
        <div className="flex gap-0 -mb-px overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-orange-500 text-orange-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-6 max-w-screen-2xl mx-auto">
        {activeTab === 'live' && (
          <LiveFeedSection
            opportunities={opportunities}
            onRefresh={loadOpportunities}
            loading={loading}
          />
        )}
        {activeTab === 'marketplace' && <MarketplaceWorkbenchSection />}
        {activeTab === 'simulator' && <SimulatorSection />}
        {activeTab === 'screening' && <ScreeningSection />}
        {activeTab === 'analytics' && <AnalyticsSection data={analytics} />}
        {activeTab === 'matching' && (
          <div className="space-y-4">
            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-orange-500" />
                <h2 className="text-sm font-semibold text-white">Contractor Matching Engine</h2>
              </div>
              <ContractorMatchPanel />
            </div>
          </div>
        )}
        {activeTab === 'health' && <HealthSection health={healthData} />}
        {activeTab === 'intake' && <IntakeFeedSection />}
        {activeTab === 'enrichment' && <EnrichmentQueueSection />}
        {activeTab === 'webhooks' && <WebhookLogSection />}
        {activeTab === 'funnels' && <IntakeFunnelsSection />}
        {activeTab === 'campaigns' && <CampaignsSection />}
      </div>
    </div>
  );
}


// ── Intake Feed Section ──────────────────────────────────────────────────────

interface IntakeLead {
  id: string;
  intake_record_type?: string | null;
  opportunity_id?: string | null;
  event_id?: string | null;
  event_type?: string | null;
  review_status?: string | null;
  received_at?: string | null;
  source_funnel?: string | null;
  ready_for_review?: boolean | null;
  needs_missing_data?: string[] | null;
  qualification_skipped?: boolean | null;
  bill_attachment_metadata_only?: boolean | null;
  validation_warning?: string[] | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  source_system?: string | null;
  source_channel?: string | null;
  monthly_bill_amount?: number | null;
  status?: string | null;
  enrichment_status?: string | null;
  is_duplicate?: boolean | null;
  duplicate_score?: number | null;
  qualification_payload?: Record<string, unknown> | null;
  qualification_intelligence?: Record<string, unknown> | null;
  qualification_event_id?: string | null;
  qualification_status?: string | null;
  lead_grade?: string | null;
  finance_readiness?: boolean | null;
  battery_readiness?: boolean | null;
  estimated_income_band?: string | null;
  estimated_credit_band?: string | null;
  sunlight_confidence?: string | null;
  property_type?: string | null;
  utility_provider?: string | null;
  battery_interest?: string | null;
  homeowner_status?: string | null;
  preferred_contact_method?: string | null;
  timeline?: string | null;
  roof_age?: string | null;
  intake_metadata?: Record<string, unknown> | null;
  bill_metadata?: Record<string, unknown> | null;
  created_at: string;
}

interface IntakeStats {
  today_count?: number;
  conversion_rate?: number;
  validation_failure_rate?: number;
  top_sources?: Array<{ source: string; count: number }>;
  total?: number;
}

function IntakeFeedSection() {
  const [leads, setLeads] = useState<IntakeLead[]>([]);
  const [stats, setStats] = useState<IntakeStats>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (search) params.set('search', search);
      if (sourceFilter) params.set('source_system', sourceFilter);
      if (channelFilter) params.set('source_channel', channelFilter);
      const res = await fetch(`/api/admin/network/intake?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const stage = data.stage ? ` stage=${data.stage}` : '';
        const code = data.code ? ` code=${data.code}` : '';
        const message = data.message || data.error || `HTTP ${res.status}`;
        throw new Error(`Intake Feed load failed${stage}${code}: ${message}`);
      }
      setLeads(data.opportunities ?? []);
      setStats(data.stats ?? {});
      setTotal(data.total ?? 0);
    } catch (e) {
      console.error(e);
      setLeads([]);
      setStats({});
      setTotal(0);
      setError(e instanceof Error ? e.message : 'Intake Feed load failed');
    }
    finally { setLoading(false); }
  }, [page, search, sourceFilter, channelFilter]);

  useEffect(() => { load(); }, [load]);

  const sourceChannelColor = (ch?: string | null) => {
    const map: Record<string, string> = {
      paid_search: 'text-blue-400',
      paid_social: 'text-violet-400',
      organic: 'text-green-400',
      referral: 'text-amber-400',
      direct: 'text-zinc-300',
      web: 'text-sky-400',
    };
    return map[ch ?? ''] ?? 'text-zinc-500';
  };

  const enrichBadge = (status?: string | null) => {
    const map: Record<string, string> = {
      completed: 'bg-green-500/20 text-green-400 border-green-500/30',
      processing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      pending: 'bg-zinc-700 text-zinc-400 border-zinc-600',
      failed: 'bg-red-500/20 text-red-400 border-red-500/30',
      partial: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    };
    return map[status ?? ''] ?? 'bg-zinc-700 text-zinc-400 border-zinc-600';
  };

  const totalPages = Math.ceil(total / 25);

  const metadataText = (lead: IntakeLead, key: string) => {
    const value = lead.intake_metadata?.[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };

  const metadataNumber = (lead: IntakeLead, key: string) => {
    const value = lead.intake_metadata?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const payloadDisplay = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
    return JSON.stringify(value);
  };

  const billMetadataFor = (lead: IntakeLead) => {
    const metadata = lead.bill_metadata ?? (typeof lead.intake_metadata?.bill_metadata === 'object' && lead.intake_metadata.bill_metadata !== null ? lead.intake_metadata.bill_metadata as Record<string, unknown> : null);
    const filename = metadata?.filename ?? metadataText(lead, 'uploaded_bill_filename');
    return {
      filename,
      sizeBytes: metadata?.size_bytes ?? metadataNumber(lead, 'uploaded_bill_size_bytes'),
      contentType: metadata?.content_type ?? metadataText(lead, 'uploaded_bill_content_type'),
      storageStatus: metadata?.storage_status ?? (filename ? 'metadata_only_not_uploaded' : 'not_provided'),
    };
  };

  const reviewSignalsFor = (lead: IntakeLead): Array<[string, unknown]> => {
    const warnings = lead.validation_warning ?? (Array.isArray(lead.intake_metadata?.validation_warning) ? lead.intake_metadata.validation_warning as string[] : []);
    return [
      ['Ready for Review', lead.ready_for_review],
      ['Needs Missing Data', lead.needs_missing_data ?? []],
      ['Qualification Skipped', lead.qualification_skipped],
      ['Bill Attachment Metadata Only', lead.bill_attachment_metadata_only],
      ['Validation Warning', warnings],
    ];
  };

  const eventDetailsFor = (lead: IntakeLead): Array<[string, unknown]> => [
    ['Intake Event ID', lead.event_id ?? lead.id],
    ['Event Type', lead.event_type ?? (lead.intake_record_type === 'intake_event' ? 'homeowner_intake' : 'converted_opportunity')],
    ['Review Status', lead.review_status ?? lead.status ?? 'pending_review'],
    ['Opportunity ID', lead.opportunity_id ?? 'Not converted'],
    ['Received At', lead.received_at ?? lead.created_at],
    ['Source / Funnel', lead.source_funnel ?? lead.intake_metadata?.funnel_slug ?? lead.source_system],
  ];

  const formDetailsFor = (lead: IntakeLead): Array<[string, unknown]> => {
    const billFile = billMetadataFor(lead);
    const details: Array<[string, unknown]> = [
      ['Utility Provider', lead.utility_provider ?? metadataText(lead, 'utility_provider')],
      ['Average Monthly Bill', lead.monthly_bill_amount],
      ['Battery Interest', lead.battery_interest ?? metadataText(lead, 'battery_interest')],
      ['Homeowner Status', lead.homeowner_status ?? metadataText(lead, 'homeowner_status') ?? metadataText(lead, 'home_ownership')],
      ['Preferred Contact', lead.preferred_contact_method ?? metadataText(lead, 'preferred_contact_method')],
      ['Timeline', lead.timeline ?? metadataText(lead, 'timeline')],
      ['Roof Age Years', lead.roof_age ?? metadataText(lead, 'roof_age') ?? metadataText(lead, 'roof_age_years')],
      ['Property Address', [lead.address_line1, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')],
      ['Utility Bill Evidence', billFile.filename ? 'Metadata only — file was not uploaded/stored' : 'Not provided'],
      ['Utility Bill Filename', billFile.filename],
      ['Utility Bill File Size Bytes', billFile.sizeBytes],
      ['Utility Bill MIME Type', billFile.contentType],
      ['Consent', lead.intake_metadata?.consent_given],
    ];
    return details.filter(([, value]) => value !== null && value !== undefined && value !== '');
  };

  const notesFor = (lead: IntakeLead) => metadataText(lead, 'notes') ?? metadataText(lead, 'optional_notes');

  const qualificationDetailsFor = (lead: IntakeLead): Array<[string, unknown]> => {
    const intelligence = lead.qualification_intelligence ?? {};
    const normalized = typeof intelligence.normalized === 'object' && intelligence.normalized !== null
      ? intelligence.normalized as Record<string, unknown>
      : {};
    const details: Array<[string, unknown]> = [
      ['Qualification Status', lead.qualification_status ?? intelligence.qualification_status],
      ['Lead Grade', lead.lead_grade ?? intelligence.lead_grade],
      ['Finance Ready', lead.finance_readiness ?? intelligence.finance_readiness],
      ['Battery Ready', lead.battery_readiness ?? intelligence.battery_readiness],
      ['Income Band', lead.estimated_income_band ?? normalized.estimated_income_band],
      ['Estimated Credit', lead.estimated_credit_band ?? normalized.estimated_credit_band],
      ['Sunlight', lead.sunlight_confidence ?? normalized.sunlight_confidence],
      ['Property Type', lead.property_type ?? normalized.property_type],
      ['Purchase Intent', lead.qualification_payload?.qualification && typeof lead.qualification_payload.qualification === 'object' ? (lead.qualification_payload.qualification as Record<string, unknown>).purchase_intent : normalized.purchase_intent],
      ['Electrical Panel', lead.qualification_payload?.qualification && typeof lead.qualification_payload.qualification === 'object' ? (lead.qualification_payload.qualification as Record<string, unknown>).electrical_panel_size : normalized.electrical_panel_size],
      ['Prior Quotes', lead.qualification_payload?.qualification && typeof lead.qualification_payload.qualification === 'object' ? (lead.qualification_payload.qualification as Record<string, unknown>).prior_quotes : normalized.prior_quotes],
    ];
    return details.filter(([, value]) => value !== null && value !== undefined && value !== '');
  };

  const contractorSummaryFor = (lead: IntakeLead) => {
    const value = lead.qualification_intelligence?.contractor_summary;
    return typeof value === 'string' && value.trim() ? value : null;
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Today's Intake" value={stats.today_count ?? 0} color="text-orange-400" icon={Inbox} />
        <StatCard label="Total Leads" value={stats.total ?? total} color="text-white" icon={Users} />
        <StatCard label="Conversion Rate" value={`${((stats.conversion_rate ?? 0) * 100).toFixed(1)}%`} color="text-green-400" icon={TrendingUp} />
        <StatCard label="Validation Failures" value={`${((stats.validation_failure_rate ?? 0) * 100).toFixed(1)}%`} color={((stats.validation_failure_rate ?? 0) > 0.2) ? 'text-red-400' : 'text-zinc-300'} icon={AlertCircle} />
      </div>
      {error && (
        <div className="rounded-xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200">
          <div className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" /> Intake Feed API error</div>
          <p className="mt-1 font-mono text-xs text-red-300">{error}</p>
          <p className="mt-2 text-xs text-red-200/70">The public form may still be saving into intake_events; this panel is showing the admin read-path failure instead of silently rendering zero leads.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input type="text" placeholder="Search name, email, phone, address…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500" />
        </div>
        <input type="text" placeholder="Source system…" value={sourceFilter}
          onChange={e => { setSourceFilter(e.target.value); setPage(1); }}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500 w-40" />
        <select value={channelFilter} onChange={e => { setChannelFilter(e.target.value); setPage(1); }}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-orange-500">
          <option value="">All channels</option>
          <option value="paid_search">Paid Search</option>
          <option value="paid_social">Paid Social</option>
          <option value="organic">Organic</option>
          <option value="referral">Referral</option>
          <option value="direct">Direct</option>
          <option value="web">Web Form</option>
          <option value="webhook">Webhook</option>
          <option value="api">API</option>
        </select>
        <button onClick={() => { setPage(1); load(); }} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:text-white transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Lead</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Contact</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Location</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Source</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Bill</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Enrichment</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Received</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/50">
              {loading && <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</td></tr>}
              {!loading && !error && leads.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500"><Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No intake leads found for the current filters. Public homeowner submissions save as pending-review intake events and should appear here after a successful form submit.</p></td></tr>}
              {!loading && error && <tr><td colSpan={7} className="px-4 py-12 text-center text-red-300"><AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-60" /><p>Unable to load Intake Feed. See the API error above.</p></td></tr>}
              {!loading && leads.map(lead => {
                const details = formDetailsFor(lead);
                const qualificationDetails = qualificationDetailsFor(lead);
                const contractorSummary = contractorSummaryFor(lead);
                const notes = notesFor(lead);
                const eventDetails = eventDetailsFor(lead);
                const reviewSignals = reviewSignalsFor(lead);
                return (
                  <Fragment key={lead.id}>
                    <tr className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{[lead.first_name, lead.last_name].filter(Boolean).join(' ') || <span className="text-zinc-600 italic">Anonymous</span>}</div>
                        <div className="mt-1 text-[11px] text-zinc-500">{lead.review_status ?? lead.status ?? 'pending_review'} · {lead.event_type ?? lead.intake_record_type ?? 'intake'}</div>
                        {lead.is_duplicate && <span className="text-xs text-amber-400">⚠ dup {lead.duplicate_score ? `(${(lead.duplicate_score * 100).toFixed(0)}%)` : ''}</span>}
                      </td>
                      <td className="px-4 py-3"><div className="text-zinc-300 text-xs">{lead.email ?? '—'}</div><div className="text-zinc-500 text-xs">{lead.phone ?? ''}</div></td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">{[lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || lead.address_line1 || '—'}</td>
                      <td className="px-4 py-3"><div className="text-zinc-300 text-xs">{lead.source_system ?? '—'}</div><div className={`text-xs ${sourceChannelColor(lead.source_channel)}`}>{lead.source_channel ?? ''}</div></td>
                      <td className="px-4 py-3 text-zinc-300 text-xs">{lead.monthly_bill_amount ? `$${lead.monthly_bill_amount}/mo` : '—'}</td>
                      <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${enrichBadge(lead.enrichment_status)}`}>{lead.enrichment_status ?? 'pending'}</span></td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(lead.created_at).toLocaleString()}</td>
                    </tr>
                    <tr className="bg-zinc-950/30">
                      <td colSpan={7} className="px-4 pb-4 pt-0">
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-orange-300">Submitted form payload</div>
                            <div className="text-[10px] font-mono text-zinc-600">Intake Event ID: {lead.event_id ?? lead.id}</div>
                          </div>
                          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {eventDetails.map(([label, value]) => (
                              <div key={label} className="rounded-md border border-zinc-800/80 bg-zinc-900/60 px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
                                <div className="mt-1 break-words text-xs text-zinc-200">{payloadDisplay(value)}</div>
                              </div>
                            ))}
                          </div>
                          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                            {reviewSignals.map(([label, value]) => (
                              <div key={label} className="rounded-md border border-blue-900/40 bg-blue-950/20 px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wider text-blue-400">{label}</div>
                                <div className="mt-1 break-words text-xs text-blue-100">{payloadDisplay(value)}</div>
                              </div>
                            ))}
                          </div>
                          {details.length > 0 ? (
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                              {details.map(([label, value]) => (
                                <div key={label} className="rounded-md border border-zinc-800/80 bg-zinc-900/60 px-3 py-2">
                                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
                                  <div className="mt-1 break-words text-xs text-zinc-200">{payloadDisplay(value)}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-zinc-500">No payload details were returned for this intake row.</div>
                          )}
                          {qualificationDetails.length > 0 && (
                            <div className="mt-3 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3">
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Qualification intelligence</div>
                                {lead.qualification_event_id ? <div className="text-[10px] font-mono text-emerald-700">Qualification Event ID: {lead.qualification_event_id}</div> : <div className="text-[10px] text-emerald-700">Qualification skipped / not submitted</div>}
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                {qualificationDetails.map(([label, value]) => (
                                  <div key={label} className="rounded-md border border-emerald-900/40 bg-zinc-900/70 px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
                                    <div className="mt-1 break-words text-xs text-emerald-100">{payloadDisplay(value)}</div>
                                  </div>
                                ))}
                              </div>
                              {contractorSummary && (
                                <div className="mt-3 rounded-md border border-emerald-900/40 bg-zinc-950/70 px-3 py-2">
                                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Contractor Summary</div>
                                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-emerald-100">{contractorSummary}</p>
                                </div>
                              )}
                            </div>
                          )}
                          {notes && (
                            <div className="mt-3 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Operational Notes</div>
                              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{notes}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
            <span className="text-xs text-zinc-500">Page {page} of {totalPages} · {total} total</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-40">← Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 rounded text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}
      </div>
      {(stats.top_sources ?? []).length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Top Sources</div>
          <div className="flex flex-wrap gap-2">
            {(stats.top_sources ?? []).map((s, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 rounded-lg border border-zinc-700">
                <span className="text-sm font-bold text-orange-400">{s.count}</span>
                <span className="text-xs text-zinc-300">{s.source}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Enrichment Queue Section ─────────────────────────────────────────────────

interface EnrichmentJob {
  id: string;
  opportunity_id: string;
  status: string;
  priority: number;
  attempt_count: number;
  providers_requested?: string[];
  providers_completed?: string[];
  providers_failed?: string[];
  property_status?: string;
  solar_status?: string;
  utility_status?: string;
  triggered_by?: string;
  started_at?: string | null;
  completed_at?: string | null;
  failed_at?: string | null;
  next_retry_at?: string | null;
  last_error?: string | null;
  duration_ms?: number | null;
  created_at: string;
  homeowner_name?: string | null;
}

interface EnrichmentStats {
  pending?: number;
  processing?: number;
  completed?: number;
  failed?: number;
  retry?: number;
  avg_duration_ms?: number;
  failure_rate?: number;
}

function ProviderPip({ status }: { status?: string }) {
  const map: Record<string, string> = {
    completed: 'bg-green-500',
    pending: 'bg-zinc-600',
    processing: 'bg-blue-500 animate-pulse',
    failed: 'bg-red-500',
    skipped: 'bg-zinc-700',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[status ?? 'pending'] ?? 'bg-zinc-600'}`} />;
}

function EnrichmentQueueSection() {
  const [jobs, setJobs] = useState<EnrichmentJob[]>([]);
  const [stats, setStats] = useState<EnrichmentStats>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [triggerMode, setTriggerMode] = useState<'single' | 'batch' | 'all_pending'>('single');
  const [triggerInput, setTriggerInput] = useState('');
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [forceRefresh, setForceRefresh] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/network/enrichment');
      const data = await res.json();
      if (data.success) {
        setJobs(data.jobs ?? []);
        setStats(data.stats ?? {});
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerEnrichment = async () => {
    setActionLoading('trigger');
    setTriggerResult(null);
    try {
      const body: Record<string, unknown> = { force_refresh: forceRefresh };
      if (triggerMode === 'single') body.opportunity_id = triggerInput.trim();
      else if (triggerMode === 'batch') body.ids = triggerInput.split(',').map((s: string) => s.trim()).filter(Boolean);
      else body.all_pending = true;
      const res = await fetch('/api/admin/network/enrichment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      setTriggerResult(data.success ? `✅ ${data.message ?? 'Triggered'}` : `❌ ${data.error ?? 'Failed'}`);
      await load();
    } catch { setTriggerResult('❌ Network error'); }
    finally { setActionLoading(null); }
  };

  const patchJob = async (opportunityId: string, action: 'cancel' | 'retry' | 'reset') => {
    setActionLoading(`${action}-${opportunityId}`);
    try {
      const res = await fetch('/api/admin/network/enrichment', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity_id: opportunityId, action }),
      });
      const data = await res.json();
      if (data.success) await load();
    } catch (e) { console.error(e); }
    finally { setActionLoading(null); }
  };

  const statusColor = (s: string) => ({
    pending: 'bg-zinc-700 text-zinc-300', processing: 'bg-blue-500/20 text-blue-300',
    completed: 'bg-green-500/20 text-green-300', failed: 'bg-red-500/20 text-red-300',
    retry: 'bg-amber-500/20 text-amber-300', cancelled: 'bg-zinc-700 text-zinc-500',
  } as Record<string, string>)[s] ?? 'bg-zinc-700 text-zinc-400';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Pending"    value={stats.pending    ?? 0} color="text-zinc-300"  icon={Clock} />
        <StatCard label="Processing" value={stats.processing ?? 0} color="text-blue-400"  icon={Loader2} />
        <StatCard label="Completed"  value={stats.completed  ?? 0} color="text-green-400" icon={CheckCheck} />
        <StatCard label="Failed"     value={stats.failed     ?? 0} color="text-red-400"   icon={XCircle} />
        <StatCard label="Avg Duration" value={stats.avg_duration_ms ? `${(stats.avg_duration_ms / 1000).toFixed(1)}s` : '—'} color="text-zinc-300" icon={Zap} />
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <FlaskConical className="w-4 h-4 text-orange-500" />
          <h3 className="text-sm font-semibold text-white">Trigger Enrichment</h3>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Mode</label>
            <select value={triggerMode} onChange={e => setTriggerMode(e.target.value as 'single' | 'batch' | 'all_pending')}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-orange-500">
              <option value="single">Single opportunity</option>
              <option value="batch">Batch (comma-sep IDs)</option>
              <option value="all_pending">All pending</option>
            </select>
          </div>
          {triggerMode !== 'all_pending' && (
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs text-zinc-500 mb-1 block">{triggerMode === 'single' ? 'Opportunity ID' : 'IDs (comma-separated)'}</label>
              <input type="text" value={triggerInput} onChange={e => setTriggerInput(e.target.value)}
                placeholder={triggerMode === 'single' ? 'uuid...' : 'uuid1, uuid2...'}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500" />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={forceRefresh} onChange={e => setForceRefresh(e.target.checked)} className="accent-orange-500" />
            Force refresh
          </label>
          <button onClick={triggerEnrichment}
            disabled={!!actionLoading || (triggerMode !== 'all_pending' && !triggerInput.trim())}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {actionLoading === 'trigger' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Enrichment
          </button>
        </div>
        {triggerResult && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${triggerResult.startsWith('✅') ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'}`}>{triggerResult}</div>
        )}
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-white">Recent Jobs</h3>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Lead</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Providers</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Attempts</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Duration</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Error</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/50">
              {loading && <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading queue…</td></tr>}
              {!loading && jobs.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500"><Cpu className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No enrichment jobs. Run migrations then trigger enrichment above.</p></td></tr>}
              {!loading && jobs.map(job => (
                <tr key={job.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-white text-xs font-medium">{job.homeowner_name ?? 'Lead'}</div>
                    <div className="text-zinc-600 text-xs font-mono">{job.opportunity_id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(job.status)}`}>{job.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <ProviderPip status={job.property_status} /> prop
                      <ProviderPip status={job.solar_status} /> solar
                      <ProviderPip status={job.utility_status} /> util
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{job.attempt_count} / 3</td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{job.duration_ms ? `${(job.duration_ms / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="px-4 py-3 text-red-400 text-xs max-w-[160px] truncate" title={job.last_error ?? undefined}>{job.last_error ? job.last_error.slice(0, 60) : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {['pending', 'failed', 'retry'].includes(job.status) && (
                        <button onClick={() => patchJob(job.opportunity_id, 'retry')} disabled={!!actionLoading}
                          className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-blue-400 transition-colors disabled:opacity-40" title="Retry">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {job.status === 'processing' && (
                        <button onClick={() => patchJob(job.opportunity_id, 'cancel')} disabled={!!actionLoading}
                          className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400 transition-colors disabled:opacity-40" title="Cancel">
                          <StopCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => patchJob(job.opportunity_id, 'reset')} disabled={!!actionLoading}
                        className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-amber-400 transition-colors disabled:opacity-40" title="Reset to pending">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Webhook Log Section ──────────────────────────────────────────────────────

interface WebhookLogEntry {
  id: string;
  idempotency_key: string;
  platform: string;
  partner_id?: string | null;
  opportunity_id?: string | null;
  signature_verified: boolean;
  status: string;
  action?: string | null;
  processing_error?: string | null;
  leads_received?: number;
  leads_created?: number;
  leads_duplicate?: number;
  leads_errored?: number;
  is_replay?: boolean;
  retry_count?: number;
  processing_duration_ms?: number | null;
  received_at: string;
  processed_at?: string | null;
}

function WebhookLogSection() {
  const [logs, setLogs] = useState<WebhookLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [replayId, setReplayId] = useState('');
  const [replayResult, setReplayResult] = useState<string | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (platformFilter) params.set('platform', platformFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/admin/network/webhooks?${params}`);
      const data = await res.json();
      if (data.success) setLogs(data.logs ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [platformFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const replayWebhook = async () => {
    if (!replayId.trim()) return;
    setReplayLoading(true);
    setReplayResult(null);
    try {
      const res = await fetch('/api/admin/network/webhooks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: replayId.trim() }),
      });
      const data = await res.json();
      setReplayResult(data.success ? `✅ Replayed — action: ${data.action ?? 'processed'}` : `❌ ${data.error ?? 'Failed'}`);
      await load();
    } catch { setReplayResult('❌ Network error'); }
    finally { setReplayLoading(false); }
  };

  const platformColor = (p: string) => ({
    meta: 'text-blue-400', google: 'text-yellow-400', tiktok: 'text-pink-400', generic: 'text-zinc-300',
  } as Record<string, string>)[p] ?? 'text-zinc-400';

  const statusDot = (s: string) => ({
    received: 'bg-zinc-500', processing: 'bg-blue-500 animate-pulse', processed: 'bg-green-500',
    failed: 'bg-red-500', skipped: 'bg-zinc-600', replayed: 'bg-violet-500',
  } as Record<string, string>)[s] ?? 'bg-zinc-600';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-orange-500">
          <option value="">All platforms</option>
          <option value="meta">Meta</option>
          <option value="google">Google</option>
          <option value="tiktok">TikTok</option>
          <option value="generic">Generic</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-orange-500">
          <option value="">All statuses</option>
          <option value="received">Received</option>
          <option value="processed">Processed</option>
          <option value="failed">Failed</option>
          <option value="replayed">Replayed</option>
        </select>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:text-white transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <RotateCcw className="w-4 h-4 text-orange-500" />
          <h3 className="text-sm font-semibold text-white">Replay Webhook</h3>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-zinc-500 mb-1 block">Log ID (UUID)</label>
            <input type="text" value={replayId} onChange={e => setReplayId(e.target.value)}
              placeholder="webhook_ingestion_log.id uuid..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500" />
          </div>
          <button onClick={replayWebhook} disabled={replayLoading || !replayId.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {replayLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Replay
          </button>
        </div>
        {replayResult && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${replayResult.startsWith('✅') ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'}`}>{replayResult}</div>
        )}
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Platform</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Sig</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Leads</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Action</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Duration</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Error</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Received</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Replay</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/50">
              {loading && <tr><td colSpan={9} className="px-4 py-12 text-center text-zinc-500"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</td></tr>}
              {!loading && logs.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-zinc-500"><Webhook className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No webhook events. Run migrations and send a test webhook.</p></td></tr>}
              {!loading && logs.map(log => (
                <tr key={log.id} className={`hover:bg-zinc-800/30 transition-colors ${log.is_replay ? 'opacity-75' : ''}`}>
                  <td className="px-4 py-3">
                    <span className={`font-semibold text-sm ${platformColor(log.platform)}`}>{log.platform}</span>
                    {log.partner_id && <div className="text-zinc-600 text-xs">{log.partner_id}</div>}
                    {log.is_replay && <div className="text-violet-400 text-xs">↩ replay</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${statusDot(log.status)}`} />
                      <span className="text-zinc-300 text-xs">{log.status}</span>
                    </div>
                    {!!log.retry_count && <div className="text-zinc-600 text-xs">{log.retry_count}x retry</div>}
                  </td>
                  <td className="px-4 py-3">{log.signature_verified ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-zinc-600" />}</td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-zinc-300">{log.leads_received ?? 0} rcvd</div>
                    <div className="text-green-400">{log.leads_created ?? 0} new</div>
                    {(log.leads_duplicate ?? 0) > 0 && <div className="text-amber-400">{log.leads_duplicate} dup</div>}
                    {(log.leads_errored ?? 0) > 0 && <div className="text-red-400">{log.leads_errored} err</div>}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{log.action ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{log.processing_duration_ms ? `${log.processing_duration_ms}ms` : '—'}</td>
                  <td className="px-4 py-3 text-red-400 text-xs max-w-[140px] truncate" title={log.processing_error ?? undefined}>{log.processing_error ? log.processing_error.slice(0, 50) : '—'}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(log.received_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setReplayId(log.id)}
                      className="p-1.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-orange-400 transition-colors" title="Copy ID to replay">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


function formatCurrency(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

async function parseAdminJsonResponse(res: Response, fallbackError: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    data = { success: false, error: 'Admin API returned non-JSON response', stage: 'response_parse', message: text.slice(0, 500) };
  }

  if (!res.ok || data.success === false) {
    return {
      ...data,
      success: false,
      error: String(data.error ?? fallbackError),
      http_status: res.status,
      http_status_text: res.statusText,
    };
  }

  return data;
}

function marketplaceReadySummary(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const ready = value as Record<string, unknown>;
  const gate = ready.marketplace_ready === true ? 'ready for Marketplace Workbench' : 'NOT ready for Marketplace Workbench';
  const location = [ready.city, ready.state].filter(Boolean).join(', ') || 'unknown location';
  const score = ready.overall_score != null ? `score=${Math.round(Number(ready.overall_score))}` : 'score=—';
  const grade = ready.overall_grade ? `grade=${String(ready.overall_grade)}` : 'grade=—';
  return `${gate} · status=${String(ready.status ?? '—')} · screening=${String(ready.screening_status ?? '—')} · ${location} · ${score} · ${grade}`;
}

function workbenchResultSummary(result: Record<string, unknown>) {
  const action = String(result.action ?? 'action');
  if (result.error || result.success === false) {
    const parts = [
      action,
      String(result.error ?? 'failed'),
      result.http_status ? `http=${String(result.http_status)}` : null,
      result.stage ? `stage=${String(result.stage)}` : null,
      result.message ? `message=${String(result.message)}` : null,
    ].filter(Boolean);
    if (result.details && typeof result.details === 'object') {
      const details = result.details as Record<string, unknown>;
      if (Array.isArray(details.existing_assignments)) parts.push(`existing_assignments=${details.existing_assignments.length}`);
      if (details.matches_returned != null) parts.push(`matches_returned=${String(details.matches_returned)}`);
      if (details.assignments_created != null) parts.push(`assignments_created=${String(details.assignments_created)}`);
    }
    return parts.join(' · ');
  }

  const eligible = result.total_eligible ?? '—';
  const created = Number(result.assignments_created ?? 0);
  const returned = Array.isArray(result.matches) ? result.matches.length : null;
  if (action === 'match_contractors') return `match_contractors · eligible ${String(eligible)} · returned ${returned ?? '—'}${result.already_assigned ? ' · already has active assignment offers' : ''}`;
  if (action === 'create_assignments') {
    if (created > 0) return `create_assignments · created ${created} assignment offer${created === 1 ? '' : 's'} · eligible ${String(eligible)} · returned ${returned ?? '—'}`;
    return `create_assignments · no offers created · eligible ${String(eligible)} · returned ${returned ?? '—'}`;
  }
  return `${action} · eligible ${String(eligible)} · assignments ${String(result.assignments_created ?? '—')}`;
}


function SimulatorSection() {
  const [items, setItems] = useState<SimulatedOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    opportunity_type: 'solar', lead_kind: 'homeowner', lead_quality: 'medium', urgency: '30_days',
    state: 'TX', city: 'Austin', source_type: 'homeowner_direct', estimated_value: '',
    run_screening: true, run_scoring: true, release_to_marketplace: false, generate_matches: false,
  });

  const loadSimulated = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/network/simulator', { cache: 'no-store' });
      const data = await parseAdminJsonResponse(res, 'Failed to load simulated opportunities');
      if (data.success === false) {
        setResult(data);
        return;
      }
      setItems((data.opportunities as SimulatedOpportunity[] | undefined) ?? []);
    } catch (e) { setResult({ error: String(e) }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSimulated(); }, [loadSimulated]);

  async function simulatorAction(action: string, opportunity_id?: string) {
    if (action === 'archive' && !confirm('Archive this simulated opportunity? This hides it from the simulator list but keeps the record withdrawn.')) return;
    if (action === 'delete' && !confirm('Permanently delete this simulated opportunity and its simulator pipeline records? This only works for simulator-created rows.')) return;
    setBusy(opportunity_id ? `${opportunity_id}:${action}` : action);
    setResult(null);
    try {
      const payload = action === 'create'
        ? { action, ...form, estimated_value: form.estimated_value ? Number(form.estimated_value) : undefined }
        : { action, opportunity_id };
      const res = await fetch('/api/admin/network/simulator', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await parseAdminJsonResponse(res, 'Simulator action failed');
      setResult(data);
      if (data.success !== false) {
        if (Array.isArray(data.opportunities)) setItems(data.opportunities as SimulatedOpportunity[]);
        await loadSimulated();
      }
    } catch (e) { setResult({ error: String(e) }); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Seed / Simulate Intake</h2>
          <p className="mt-1 text-xs text-zinc-500">Super-admin operational simulator. Seeds canonical network opportunities with simulator metadata and runs real screening/scoring/release/matching actions.</p>
        </div>
        <a
          href="/free-solar-estimate"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-200 hover:bg-orange-500/20"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Real intake test form
        </a>
      </div>

      <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/40 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select value={form.opportunity_type} onChange={e => setForm(f => ({ ...f, opportunity_type: e.target.value }))} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"><option value="solar">Solar</option><option value="roofing">Roofing</option><option value="battery">Battery</option><option value="service_call">Service Call</option></select>
          <select value={form.lead_kind} onChange={e => setForm(f => ({ ...f, lead_kind: e.target.value }))} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"><option value="homeowner">Homeowner</option><option value="commercial">Commercial</option></select>
          <select value={form.lead_quality} onChange={e => setForm(f => ({ ...f, lead_quality: e.target.value }))} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"><option value="high">High Quality</option><option value="medium">Medium Quality</option><option value="low">Low Quality</option><option value="bad">Bad / Low Quality</option></select>
          <select value={form.urgency} onChange={e => setForm(f => ({ ...f, urgency: e.target.value }))} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"><option value="asap">ASAP</option><option value="30_days">30 Days</option><option value="90_days">90 Days</option><option value="researching">Researching</option></select>
          <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="City" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
          <input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase().slice(0, 2) }))} placeholder="State" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
          <select value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"><option value="homeowner_direct">Homeowner Direct</option><option value="google_ads">Google Ads</option><option value="facebook_ads">Meta Ads</option><option value="seo">SEO</option><option value="partner">Partner</option><option value="referral">Referral</option></select>
          <input value={form.estimated_value} onChange={e => setForm(f => ({ ...f, estimated_value: e.target.value }))} placeholder="Estimated value optional" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-zinc-400">
          {(['run_screening','run_scoring','release_to_marketplace','generate_matches'] as const).map(key => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form[key])} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} className="accent-orange-500" />{key.replace(/_/g, ' ')}</label>)}
          <button onClick={() => simulatorAction('create')} disabled={!!busy} className="ml-auto rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{busy === 'create' ? 'Creating…' : 'Create Simulated Opportunity'}</button>
        </div>
      </div>

      {result && (
        <div className={`rounded-xl border p-3 text-xs ${result.error || result.success === false ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
          <div className="font-semibold">{result.error ? String(result.error) : `Action ${String(result.action ?? 'complete')} · opportunity ${String(result.opportunity_id ?? '')}`}</div>
          {marketplaceReadySummary(result.marketplace_ready) && (
            <div className="mt-1 font-mono text-[11px] text-zinc-200">marketplace_ready={marketplaceReadySummary(result.marketplace_ready)}</div>
          )}
          {(result.stage || result.code || result.message || result.http_status) && (
            <div className="mt-1 font-mono text-[11px] text-zinc-300">
              {result.http_status ? `http=${String(result.http_status)} ` : ''}{result.stage ? `stage=${String(result.stage)} ` : ''}{result.code ? `code=${String(result.code)} ` : ''}{result.message ? `message=${String(result.message)}` : ''}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-700/50">
        <table className="w-full text-sm"><thead><tr className="bg-zinc-800/80 border-b border-zinc-700/50"><th className="px-4 py-3 text-left text-xs text-zinc-400">Opportunity</th><th className="px-4 py-3 text-left text-xs text-zinc-400">Status</th><th className="px-4 py-3 text-left text-xs text-zinc-400">Screening</th><th className="px-4 py-3 text-left text-xs text-zinc-400">Score</th><th className="px-4 py-3 text-left text-xs text-zinc-400">Assignments / Events</th><th className="px-4 py-3 text-left text-xs text-zinc-400">Actions</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={6} className="py-10 text-center text-zinc-500">Loading simulated opportunities…</td></tr> : items.length === 0 ? <tr><td colSpan={6} className="py-10 text-center text-zinc-500">No simulated opportunities yet.</td></tr> : items.map(opp => {
          const marker = (opp.raw_payload ?? opp.intake_metadata ?? {}) as Record<string, unknown>;
          const failReasons = Array.isArray(opp.step10_fail_reasons) ? opp.step10_fail_reasons.filter(Boolean) : [];
          const decisionReason = opp.override_reason ?? opp.auto_decision_reason ?? (failReasons.length ? `Failed: ${failReasons.join(', ')}` : null);
          const displayName = opp.homeowner_name || `${opp.homeowner_first_name ?? 'Sim'} ${opp.homeowner_last_name ?? ''}`.trim() || 'Sim';
          return <tr key={opp.id} className="border-b border-zinc-800 align-top hover:bg-zinc-800/40"><td className="px-4 py-3"><div className="font-medium text-white">{displayName}</div><div className="text-xs text-zinc-500">{String(marker.opportunity_type ?? 'simulated')} · {opp.city}, {opp.state}</div></td><td className="px-4 py-3"><StatusPill status={opp.status} /><div className="mt-1 text-xs text-zinc-500">{new Date(opp.created_at).toLocaleDateString()}</div></td><td className="px-4 py-3 text-xs text-zinc-300"><div>{opp.screening_status ?? opp.override_decision ?? opp.auto_decision ?? '—'}</div><div className="text-zinc-500">Confidence {opp.confidence_score ? `${Math.round(Number(opp.confidence_score))}%` : '—'}</div>{decisionReason && <div className="mt-1 max-w-xs text-[11px] leading-snug text-amber-300">{decisionReason}</div>}</td><td className="px-4 py-3"><div className="flex items-center gap-2"><GradeBadge grade={opp.overall_grade ?? undefined} /><span className="text-xs text-zinc-400">{opp.overall_score != null ? Math.round(Number(opp.overall_score)) : 'No score'}</span></div><div className="mt-1 max-w-xs truncate text-xs text-zinc-500">{opp.executive_summary ?? 'No explainability summary yet'}</div></td><td className="px-4 py-3 text-xs text-zinc-300">Assignments {opp.assignment_count ?? 0}<div className="text-zinc-500">Events {opp.event_count ?? 0}</div></td><td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">{(['screen','score','release','match','archive','delete'] as const).map(action => <button key={action} onClick={() => simulatorAction(action, opp.id)} disabled={!!busy} className={`rounded border px-2 py-1 text-[10px] font-semibold disabled:opacity-40 ${action === 'delete' ? 'border-red-500/40 text-red-300 hover:bg-red-500/10' : 'border-zinc-700 text-zinc-300 hover:border-orange-500/40 hover:text-orange-300'}`}>{busy === `${opp.id}:${action}` ? '…' : action}</button>)}</div></td></tr>;
        })}</tbody></table>
      </div>
    </div>
  );
}

function MarketplaceWorkbenchSection() {
  const [items, setItems] = useState<MarketplaceOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadMarketplace = useCallback(async (options?: { preserveResult?: boolean }) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/network/marketplace?limit=50', { cache: 'no-store' });
      const data = await parseAdminJsonResponse(res, 'Failed to load Marketplace Workbench');
      if (data.success === false) {
        setResult({ ...data, action: 'load_marketplace' });
        return;
      }
      if (!options?.preserveResult) setResult(null);
      setItems((data.opportunities as MarketplaceOpportunity[] | undefined) ?? []);
    } catch (e) {
      setResult({ error: String(e), action: 'load_marketplace' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMarketplace(); }, [loadMarketplace]);

  async function runWorkbenchAction(opportunityId: string, action: 'match_contractors' | 'create_assignments' | 'pause') {
    if (action === 'pause' && !confirm('Pause/remove this opportunity from the live marketplace?')) return;
    if (action === 'create_assignments' && !confirm('Create assignment offers for the top matched contractors?')) return;
    setBusy(`${opportunityId}:${action}`);
    setResult(null);
    try {
      const res = await fetch('/api/admin/network/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity_id: opportunityId, action, limit: 10, min_score: 30 }),
      });
      const data = await parseAdminJsonResponse(res, 'Workbench action failed');
      setResult(data);
      if (data.success !== false) await loadMarketplace({ preserveResult: true });
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Marketplace Workbench</h2>
          <p className="mt-1 text-xs text-zinc-500">Live, screening-approved network opportunities only. Assignment actions use the canonical contractor matcher.</p>
        </div>
        <button onClick={() => loadMarketplace()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:text-white disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {result && (
        <div className={`rounded-xl border p-3 text-xs ${result.error || result.success === false ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
          <div className="font-semibold">{result.error || result.success === false ? 'Marketplace Workbench failed' : 'Workbench action complete'}</div>
          <div className="mt-1 font-mono text-[11px] text-zinc-300">
            {workbenchResultSummary(result)}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-700/50">
        <table className="w-full text-sm">
          <thead><tr className="bg-zinc-800/80 border-b border-zinc-700/50">
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Opportunity</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Location</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Score / Price</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Screening</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Assignment</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Live</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Actions</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-12 text-center text-zinc-500">Loading marketplace workbench…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-zinc-500">No live screening-approved marketplace opportunities.</td></tr>
            ) : items.map(opp => {
              const name = opp.homeowner_name || `${opp.homeowner_first_name ?? ''} ${opp.homeowner_last_name ?? ''}`.trim() || `Opportunity ${opp.id.slice(0, 8)}`;
              const city = opp.city || opp.location_city || 'Unknown city';
              const state = opp.state || opp.location_state || '—';
              const score = opp.overall_score ?? opp.opportunity_score;
              const grade = opp.overall_grade ?? opp.opportunity_grade;
              const price = opp.market_price ?? opp.asking_price ?? opp.listing_price;
              const activeOffers = Number(opp.active_offer_count ?? 0);
              const claimedOrActive = Number(opp.claimed_or_active_count ?? 0);
              const assigned = activeOffers > 0 || claimedOrActive > 0;
              const assignmentLabel = claimedOrActive > 0 ? (opp.current_assignment_status ?? 'claimed/active') : activeOffers > 0 ? 'Offers pending' : 'Unassigned';
              const payload = getEnrichmentPayload(opp);
              const readiness = deriveEnrichmentState(opp);
              const completeness = percentFromCompleteness(opp.enrichment_completeness);
              const chips = buildEnrichmentChips(opp, 'admin');
              const warnings = enrichmentWarnings(opp).slice(0, 3);
              const marketplacePriority = fieldValue<string>(payload, 'marketplace', 'marketplace_priority');
              const assignmentPriority = fieldValue<string>(payload, 'marketplace', 'assignment_priority');
              return (
                <tr key={opp.id} className="border-b border-zinc-800 align-top hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{opp.source_type?.replace(/_/g, ' ') ?? 'unknown source'}</div>
                    <button onClick={() => setExpanded(expanded === opp.id ? null : opp.id)} className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200">
                      <Eye className="h-3 w-3" /> {expanded === opp.id ? 'Hide details' : 'View details'}
                    </button>
                    {expanded === opp.id && (
                      <div className="mt-3 max-w-2xl rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                        {opp.executive_summary ? <p>{opp.executive_summary}</p> : <p>No explainability summary available yet.</p>}
                        {opp.opportunity_highlights?.length ? <div className="mt-2 text-emerald-300">Highlights: {opp.opportunity_highlights.join(', ')}</div> : null}
                        {opp.risk_flags?.length ? <div className="mt-1 text-amber-300">Risks: {opp.risk_flags.join(', ')}</div> : null}
                        <div className="mt-3 border-t border-zinc-800 pt-3">
                          <EnrichmentDetailGroups row={opp} />
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-300"><div>{city}, {state}</div><div className="mt-1 text-xs text-zinc-500">{opp.address ? 'Address on file' : 'No address shown'}</div></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2"><GradeBadge grade={grade ?? undefined} /><span className="text-xs text-zinc-400">{score != null ? Math.round(Number(score)) : 'No score'}</span></div>
                    <div className="mt-1 text-xs text-zinc-500">Value {formatCurrency(opp.estimated_project_value)} · Price {formatCurrency(price)}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">Marketplace {formatDisplayValue(marketplacePriority)} · Assignment {formatDisplayValue(assignmentPriority)}</div>
                    {score == null && <div className="mt-1 text-[11px] text-amber-300">No score available</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">{opp.screening_status ?? opp.auto_decision ?? 'approved'}</span><EnrichmentStateBadge state={readiness} /></div>
                    <div className="mt-2"><EnrichmentCompleteness percent={completeness} /></div>
                    <div className="mt-2"><EnrichmentChipList chips={chips.slice(0, 5)} /></div>
                    {warnings.length ? <div className="mt-1 text-[11px] text-amber-300">Warnings: {warnings.join(', ')}</div> : null}
                    <div className="mt-1 text-xs text-zinc-500">Confidence {opp.confidence_score ? `${Math.round(Number(opp.confidence_score))}%` : '—'}</div>
                  </td>
                  <td className="px-4 py-3"><div className={`text-xs ${assigned ? 'text-emerald-300' : 'text-zinc-400'}`}>{assignmentLabel}</div><div className="mt-1 text-xs text-zinc-500">Offers {activeOffers} · Total {opp.assignment_count ?? 0}</div>{assigned && <div className="mt-1 text-[11px] text-amber-300">Assignment offers already exist</div>}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{opp.live_at ? new Date(opp.live_at).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3"><div className="flex flex-col gap-1.5"><button onClick={() => runWorkbenchAction(opp.id, 'match_contractors')} disabled={!!busy} className="rounded border border-blue-500/30 px-2 py-1 text-[11px] font-semibold text-blue-300 hover:bg-blue-500/10 disabled:opacity-40">{busy === `${opp.id}:match_contractors` ? '…' : 'Match contractors'}</button><button onClick={() => runWorkbenchAction(opp.id, 'create_assignments')} disabled={!!busy || assigned} className="rounded border border-emerald-500/30 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40">{busy === `${opp.id}:create_assignments` ? '…' : 'Assign top matches'}</button><button onClick={() => runWorkbenchAction(opp.id, 'pause')} disabled={!!busy} className="rounded border border-amber-500/30 px-2 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-40">{busy === `${opp.id}:pause` ? '…' : 'Pause live'}</button></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Contractor Match Panel ─────────────────────────────────────────────────────
function ContractorMatchPanel() {
  const [oppId, setOppId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [createAssignments, setCreateAssignments] = useState(false);

  async function runMatch() {
    if (!oppId.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/network/contractor-match/${oppId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10, min_score: 30, create_assignments: createAssignments }),
      });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  const matches = result?.matches as Array<Record<string, unknown>> ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs text-zinc-400 mb-1.5">Opportunity UUID</label>
          <input
            type="text"
            placeholder="Enter opportunity ID…"
            value={oppId}
            onChange={e => setOppId(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={createAssignments}
            onChange={e => setCreateAssignments(e.target.checked)}
            className="w-3.5 h-3.5 accent-orange-500"
          />
          Create Assignments
        </label>
        <button
          onClick={runMatch}
          disabled={loading || !oppId.trim()}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? 'Matching…' : 'Run Match'}
        </button>
      </div>

      {result && !result.error && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-400">Total Eligible:</span>
            <span className="font-semibold text-white">{String(result.total_eligible ?? 0)}</span>
            {result.assignments_created && parseInt(String(result.assignments_created)) > 0 && (
              <span className="text-emerald-400">{String(result.assignments_created)} assignments created</span>
            )}
          </div>

          {matches.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-zinc-700/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-800/80 border-b border-zinc-700">
                    <th className="text-left px-4 py-2.5 text-xs text-zinc-400">#</th>
                    <th className="text-left px-4 py-2.5 text-xs text-zinc-400">Contractor</th>
                    <th className="text-left px-4 py-2.5 text-xs text-zinc-400">Score</th>
                    <th className="text-left px-4 py-2.5 text-xs text-zinc-400">Geo</th>
                    <th className="text-left px-4 py-2.5 text-xs text-zinc-400">Size Fit</th>
                    <th className="text-left px-4 py-2.5 text-xs text-zinc-400">Performance</th>
                    <th className="text-left px-4 py-2.5 text-xs text-zinc-400">Capacity</th>
                    <th className="text-left px-4 py-2.5 text-xs text-zinc-400">Rec.</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => (
                    <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/40">
                      <td className="px-4 py-2.5 text-zinc-500 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-zinc-200 font-medium text-xs">{m.company_name as string}</div>
                        <div className="text-zinc-500 text-xs font-mono">{(m.contractor_id as string)?.slice(0, 8)}…</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`font-bold text-sm ${
                          (m.overall_score as number) >= 80 ? 'text-emerald-400' :
                          (m.overall_score as number) >= 60 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {Math.round(m.overall_score as number)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-300 text-xs">{Math.round(m.geo_score as number)}</td>
                      <td className="px-4 py-2.5 text-zinc-300 text-xs">{Math.round(m.size_fit_score as number)}</td>
                      <td className="px-4 py-2.5 text-zinc-300 text-xs">{Math.round(m.performance_score as number)}</td>
                      <td className="px-4 py-2.5 text-zinc-300 text-xs">{Math.round(m.capacity_score as number)}</td>
                      <td className="px-4 py-2.5">
                        {m.recommended
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          : <span className="text-zinc-600 text-xs">—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {result?.error && (
        <div className="p-3 bg-red-900/20 border border-red-800/30 rounded-lg text-sm text-red-400">
          {String(result.error)}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────────
// IntakeFunnelsSection
// ────────────────────────────────────────────────────────────────────────────────

interface IntakeFunnel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  funnel_type: string;
  source_channel: string;
  status: 'active' | 'inactive' | string;
  is_active: boolean;
  canonical_path?: string | null;
  canonicalPath?: string | null;
  canonical_url?: string | null;
  canonicalUrl?: string | null;
  embed_url?: string | null;
  embedUrl?: string | null;
  utm_ready_url?: string | null;
  utmReadyUrl?: string | null;
  require_phone: boolean;
  require_address: boolean;
  require_monthly_bill: boolean;
  require_roof_type: boolean;
  campaign_id: string | null;
  campaign_count: number;
  active_campaign_count: number;
  campaign_names: string[];
  default_utm: {
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
  };
  source_campaign_support: boolean;
  recent_intake_count: number;
  rate_limit_per_hour: number | null;
  thank_you_url: string | null;
  webhook_notify_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function appendClientUtm(url: string, utm: { source: string; medium: string; campaign: string }): string {
  const params = new URLSearchParams();
  if (utm.source.trim()) params.set('utm_source', utm.source.trim());
  if (utm.medium.trim()) params.set('utm_medium', utm.medium.trim());
  if (utm.campaign.trim()) params.set('utm_campaign', utm.campaign.trim());
  const query = params.toString();
  if (!query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

function funnelDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function FunnelStatusPill({ status }: { status: string }) {
  const active = status === 'active';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
      active
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-zinc-700 bg-zinc-800 text-zinc-400'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
      {status}
    </span>
  );
}

function FunnelInfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-xs text-zinc-300">{value}</div>
    </div>
  );
}

function FunnelRequirementChip({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
      enabled
        ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
        : 'border-zinc-800 bg-zinc-900 text-zinc-500'
    }`}>
      {label}
    </span>
  );
}

function IntakeFunnelsSection() {
  const [funnels, setFunnels] = useState<IntakeFunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [utm, setUtm] = useState({ source: 'facebook', medium: 'cpc', campaign: 'austin_solar_q3' });

  const loadFunnels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/network/funnels?include_inactive=true', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load intake funnels');
      setFunnels(data.funnels ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFunnels();
  }, [loadFunnels]);

  const copyValue = async (label: string, value?: string | null) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(current => (current === label ? null : current)), 1600);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-500/30 bg-orange-500/10">
              <Globe className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">Operational Funnel Infrastructure</div>
              <h2 className="mt-1 text-lg font-semibold text-white">Intake Funnels</h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                Canonical public and campaign-linked intake entry points backed by intake_funnels, acquisition_campaigns,
                intake_events, and the existing attribution fields. This section surfaces infrastructure only; it does not
                create duplicate intake flows or analytics dashboards.
              </p>
            </div>
          </div>
          <button
            onClick={() => void loadFunnels()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-orange-500/40 hover:text-orange-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">UTM-ready URL builder</h3>
          <span className="text-xs text-zinc-500">Uses canonical utm_source, utm_medium, and utm_campaign attribution fields.</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-zinc-400">
            utm_source
            <input
              value={utm.source}
              onChange={e => setUtm(prev => ({ ...prev, source: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
              placeholder="facebook"
            />
          </label>
          <label className="text-xs text-zinc-400">
            utm_medium
            <input
              value={utm.medium}
              onChange={e => setUtm(prev => ({ ...prev, medium: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
              placeholder="cpc"
            />
          </label>
          <label className="text-xs text-zinc-400">
            utm_campaign
            <input
              value={utm.campaign}
              onChange={e => setUtm(prev => ({ ...prev, campaign: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
              placeholder="austin_solar_q3"
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-800/40 bg-red-950/30 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading && !funnels.length ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center text-sm text-zinc-400">
          Loading canonical intake funnels…
        </div>
      ) : funnels.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center text-sm text-zinc-400">
          No intake funnels were returned by the canonical intake_funnels table.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {funnels.map(funnel => {
            const canonicalUrl = funnel.canonicalUrl || funnel.canonical_url || null;
            const embedUrl = funnel.embedUrl || funnel.embed_url || null;
            const serverUtmReadyUrl = funnel.utmReadyUrl || funnel.utm_ready_url || null;
            const generatedUtmUrl = canonicalUrl ? appendClientUtm(canonicalUrl, utm) : null;
            const hasPublicUrl = Boolean(canonicalUrl);
            return (
              <div key={funnel.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-lg shadow-black/10">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-white">{funnel.name}</h3>
                      <FunnelStatusPill status={funnel.status} />
                      <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                        {funnel.funnel_type}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">/{funnel.slug}</p>
                    {funnel.description && <p className="mt-2 text-sm text-zinc-400">{funnel.description}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={canonicalUrl || '#'}
                      target="_blank"
                      rel="noreferrer"
                      aria-disabled={!hasPublicUrl}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${
                        hasPublicUrl
                          ? 'border border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20'
                          : 'pointer-events-none border border-zinc-800 bg-zinc-900 text-zinc-600'
                      }`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Funnel
                    </a>
                    <button
                      onClick={() => void copyValue(`${funnel.slug} link`, canonicalUrl)}
                      disabled={!canonicalUrl}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-blue-500/40 hover:text-blue-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy Link
                    </button>
                    <button
                      onClick={() => void copyValue(`${funnel.slug} embed URL`, embedUrl)}
                      disabled={!embedUrl}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-violet-500/40 hover:text-violet-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy Embed URL
                    </button>
                    <button
                      onClick={() => void copyValue(`${funnel.slug} UTM URL`, generatedUtmUrl || serverUtmReadyUrl)}
                      disabled={!canonicalUrl}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy UTM-ready URL
                    </button>
                  </div>
                </div>

                {copied?.startsWith(funnel.slug) && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Copied {copied.replace(`${funnel.slug} `, '')}
                  </div>
                )}

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <FunnelInfoRow label="Canonical URL" value={canonicalUrl ? <span className="break-all font-mono text-[11px] text-zinc-300">{canonicalUrl}</span> : <span className="text-zinc-500">No public page mapped</span>} />
                  <FunnelInfoRow label="Source Channel" value={funnel.source_channel || '—'} />
                  <FunnelInfoRow label="Recent Intake Events" value={`${funnel.recent_intake_count} in 30 days`} />
                  <FunnelInfoRow label="Created" value={funnelDate(funnel.created_at)} />
                  <FunnelInfoRow label="Updated" value={funnelDate(funnel.updated_at)} />
                  <FunnelInfoRow label="Rate Limit" value={funnel.rate_limit_per_hour ? `${funnel.rate_limit_per_hour}/hr` : '—'} />
                </div>

                <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-orange-300" />
                    <div className="text-sm font-medium text-white">Campaign metadata</div>
                    <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
                      {funnel.active_campaign_count} active / {funnel.campaign_count} linked
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FunnelInfoRow label="Default utm_source" value={funnel.default_utm?.utm_source || '—'} />
                    <FunnelInfoRow label="Default utm_medium" value={funnel.default_utm?.utm_medium || '—'} />
                    <FunnelInfoRow label="Default utm_campaign" value={funnel.default_utm?.utm_campaign || '—'} />
                  </div>
                  {funnel.campaign_names?.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {funnel.campaign_names.slice(0, 6).map(name => (
                        <span key={name} className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">No acquisition campaigns are linked yet.</p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <FunnelRequirementChip enabled={funnel.require_phone} label="Phone required" />
                  <FunnelRequirementChip enabled={funnel.require_address} label="Address required" />
                  <FunnelRequirementChip enabled={funnel.require_monthly_bill} label="Monthly bill required" />
                  <FunnelRequirementChip enabled={funnel.require_roof_type} label="Roof type required" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// CampaignsSection
// ─────────────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  campaign_type: string;
  status: string;
  platform: string | null;
  funnel_name: string | null;
  funnel_slug: string | null;
  daily_budget_cents: number | null;
  monthly_budget_cents: number | null;
  total_budget_cents: number | null;
  cost_per_lead_target_cents: number | null;
  leads_target: number | null;
  leads_received: number;
  leads_qualified: number;
  leads_converted: number;
  total_spend_cents: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  actual_cpl_cents: number | null;
  conversion_rate_pct: number;
  qualification_rate_pct: number;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}

interface CampaignSummary {
  active_count: number;
  active_daily_budget_cents: number;
  total_leads: number;
  total_conversions: number;
  total_spend_cents: number;
}

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  draft:     'bg-zinc-700 text-zinc-300',
  active:    'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  paused:    'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  completed: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  archived:  'bg-zinc-800 text-zinc-500',
};

const PLATFORM_COLORS: Record<string, string> = {
  google_ads: 'text-blue-400',
  meta:       'text-indigo-400',
  tiktok:     'text-pink-400',
  organic:    'text-emerald-400',
  email:      'text-amber-400',
};

const PLATFORM_ICONS: Record<string, string> = {
  google_ads: '🔵',
  meta:       '📘',
  tiktok:     '🎵',
  organic:    '🌿',
  email:      '📧',
};

function fmtCents(cents: number | null): string {
  if (!cents && cents !== 0) return '—';
  if (cents >= 100000) return `$${(cents / 100000).toFixed(1)}k`;
  return `$${(cents / 100).toFixed(0)}`;
}

function CampaignsSection() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState<CampaignSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: '', description: '', campaign_type: 'paid_search', status: 'draft',
    platform: '', funnel_id: '', daily_budget_cents: '', monthly_budget_cents: '',
    cost_per_lead_target_cents: '', leads_target: '',
    utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
    start_date: '', end_date: '', notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter)   params.set('status', statusFilter);
      if (platformFilter) params.set('platform', platformFilter);
      const res = await fetch(`/api/admin/network/campaigns?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load campaigns');
      setCampaigns(data.campaigns || []);
      setSummary(data.summary || null);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, platformFilter]);

  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setForm({ name: '', description: '', campaign_type: 'paid_search', status: 'draft',
      platform: '', funnel_id: '', daily_budget_cents: '', monthly_budget_cents: '',
      cost_per_lead_target_cents: '', leads_target: '',
      utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
      start_date: '', end_date: '', notes: '' });
  }

  function openCreate() { resetForm(); setEditCampaign(null); setShowCreate(true); setSaveError(null); }
  function openEdit(c: Campaign) {
    setForm({
      name: c.name || '', description: c.description || '',
      campaign_type: c.campaign_type || 'paid_search', status: c.status || 'draft',
      platform: c.platform || '', funnel_id: '',
      daily_budget_cents: c.daily_budget_cents ? String(c.daily_budget_cents) : '',
      monthly_budget_cents: c.monthly_budget_cents ? String(c.monthly_budget_cents) : '',
      cost_per_lead_target_cents: c.cost_per_lead_target_cents ? String(c.cost_per_lead_target_cents) : '',
      leads_target: c.leads_target ? String(c.leads_target) : '',
      utm_source: c.utm_source || '', utm_medium: c.utm_medium || '',
      utm_campaign: c.utm_campaign || '', utm_content: '', utm_term: '',
      start_date: c.start_date ? c.start_date.slice(0,10) : '',
      end_date: c.end_date ? c.end_date.slice(0,10) : '',
      notes: c.notes || '',
    });
    setEditCampaign(c); setShowCreate(true); setSaveError(null);
  }

  async function handleSave() {
    setSaving(true); setSaveError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name, description: form.description || null,
        campaign_type: form.campaign_type, status: form.status,
        platform: form.platform || null,
        daily_budget_cents:         form.daily_budget_cents ? parseInt(form.daily_budget_cents) : null,
        monthly_budget_cents:       form.monthly_budget_cents ? parseInt(form.monthly_budget_cents) : null,
        cost_per_lead_target_cents: form.cost_per_lead_target_cents ? parseInt(form.cost_per_lead_target_cents) : null,
        leads_target:               form.leads_target ? parseInt(form.leads_target) : null,
        utm_source: form.utm_source || null, utm_medium: form.utm_medium || null,
        utm_campaign: form.utm_campaign || null, utm_content: form.utm_content || null,
        utm_term: form.utm_term || null,
        start_date: form.start_date || null, end_date: form.end_date || null,
        notes: form.notes || null,
      };
      if (editCampaign) payload.id = editCampaign.id;
      const res = await fetch('/api/admin/network/campaigns', {
        method: editCampaign ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setShowCreate(false); resetForm(); void load();
    } catch (e: unknown) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, newStatus: string) {
    try {
      await fetch('/api/admin/network/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });
      void load();
    } catch { /* ignore */ }
  }

  async function handleArchive(id: string) {
    if (!confirm('Archive this campaign? It will be hidden from the active list.')) return;
    await fetch('/api/admin/network/campaigns', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    void load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-violet-400" />
            Acquisition Campaigns
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Track ad campaigns across Google, Meta, TikTok and organic. Every campaign links to an intake funnel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs text-white font-medium transition-colors">
            <PlusCircle className="w-3.5 h-3.5" /> New Campaign
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Active Campaigns', value: String(summary.active_count), icon: Zap, color: 'text-emerald-400' },
            { label: 'Daily Budget', value: fmtCents(summary.active_daily_budget_cents), icon: DollarSign, color: 'text-blue-400' },
            { label: 'Total Leads', value: summary.total_leads.toLocaleString(), icon: Users, color: 'text-violet-400' },
            { label: 'Conversions', value: summary.total_conversions.toLocaleString(), icon: CheckCheck, color: 'text-emerald-400' },
            { label: 'Total Spend', value: fmtCents(summary.total_spend_cents), icon: TrendingDown, color: 'text-amber-400' },
          ].map(card => (
            <div key={card.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <card.icon className={`w-4 h-4 ${card.color}`} />
                <span className="text-xs text-zinc-500">{card.label}</span>
              </div>
              <div className="text-xl font-bold text-white">{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-violet-500">
          <option value="">All Statuses</option>
          {['draft','active','paused','completed','archived'].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-violet-500">
          <option value="">All Platforms</option>
          {['google_ads','meta','tiktok','organic','email'].map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-900/20 border border-red-800/30 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Campaigns Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading campaigns…
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-zinc-500 gap-2">
          <Megaphone className="w-8 h-8 opacity-30" />
          <p className="text-sm">No campaigns yet. Create one to start tracking ad performance.</p>
          <button onClick={openCreate}
            className="mt-2 px-4 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs text-white font-medium transition-colors">
            Create First Campaign
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50">
                {['Campaign','Platform','Status','Funnel','Budget/mo','Leads','CPL (actual vs target)','Conv %','Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {campaigns.map(c => (
                <tr key={c.id} className="hover:bg-zinc-900/40 transition-colors group">
                  {/* Campaign name */}
                  <td className="px-4 py-3 max-w-[180px]">
                    <div className="font-medium text-white text-xs truncate">{c.name}</div>
                    {c.utm_campaign && (
                      <div className="text-zinc-600 text-[10px] truncate mt-0.5">utm: {c.utm_campaign}</div>
                    )}
                  </td>
                  {/* Platform */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-xs font-medium ${PLATFORM_COLORS[c.platform ?? ''] ?? 'text-zinc-400'}`}>
                      {PLATFORM_ICONS[c.platform ?? ''] ?? '⚪'} {c.platform ?? '—'}
                    </span>
                  </td>
                  {/* Status */}
                  <td className="px-4 py-3">
                    <select
                      value={c.status}
                      onChange={e => handleStatusChange(c.id, e.target.value)}
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full cursor-pointer border-0 outline-none ${CAMPAIGN_STATUS_COLORS[c.status] ?? 'bg-zinc-700 text-zinc-300'} bg-transparent`}
                    >
                      {['draft','active','paused','completed','archived'].map(s => (
                        <option key={s} value={s} className="bg-zinc-900 text-zinc-200">{s}</option>
                      ))}
                    </select>
                  </td>
                  {/* Funnel */}
                  <td className="px-4 py-3">
                    <span className="text-xs text-zinc-400">{c.funnel_name ?? '—'}</span>
                  </td>
                  {/* Budget */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-zinc-300">{fmtCents(c.monthly_budget_cents)}</span>
                    {c.daily_budget_cents != null && (
                      <div className="text-[10px] text-zinc-600">{fmtCents(c.daily_budget_cents)}/day</div>
                    )}
                  </td>
                  {/* Leads */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-xs text-zinc-300">
                      <span className="text-white font-medium">{c.leads_received}</span>
                      {c.leads_target != null && (
                        <span className="text-zinc-600"> / {c.leads_target}</span>
                      )}
                    </div>
                    {c.leads_target != null && c.leads_target > 0 && (
                      <div className="mt-1 w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full"
                          style={{ width: `${Math.min(100, Math.round((c.leads_received / c.leads_target) * 100))}%` }}
                        />
                      </div>
                    )}
                  </td>
                  {/* CPL */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-xs">
                      <span className="text-white font-medium">{fmtCents(c.actual_cpl_cents)}</span>
                      {c.cost_per_lead_target_cents != null && (
                        <span className="text-zinc-600"> / {fmtCents(c.cost_per_lead_target_cents)}</span>
                      )}
                    </div>
                    {c.actual_cpl_cents != null && c.cost_per_lead_target_cents != null && (
                      <div className={`text-[10px] mt-0.5 ${c.actual_cpl_cents <= c.cost_per_lead_target_cents ? 'text-emerald-400' : 'text-red-400'}`}>
                        {c.actual_cpl_cents <= c.cost_per_lead_target_cents ? '↓ under target' : '↑ over target'}
                      </div>
                    )}
                  </td>
                  {/* Conv % */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-zinc-300">{c.conversion_rate_pct}%</span>
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(c)}
                        className="p-1 text-zinc-400 hover:text-white transition-colors" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleArchive(c.id)}
                        className="p-1 text-zinc-400 hover:text-red-400 transition-colors" title="Archive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* UTM Builder helper */}
      {campaigns.some(c => c.utm_campaign) && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-zinc-400 mb-2 flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> UTM Tracking Active
          </h3>
          <p className="text-xs text-zinc-500">
            Campaigns with UTM parameters will automatically tag incoming leads when they arrive via webhook.
            Match <code className="bg-zinc-800 px-1 rounded text-zinc-300">utm_campaign</code> in your intake payloads
            to link leads to the correct campaign and track CPL in real time.
          </p>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-zinc-800">
              <h3 className="text-base font-semibold text-white">
                {editCampaign ? 'Edit Campaign' : 'New Campaign'}
              </h3>
              <button onClick={() => setShowCreate(false)} className="text-zinc-500 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Campaign Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Google — Solar Savings Q1 2025"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
              {/* Type + Platform row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Type</label>
                  <select value={form.campaign_type} onChange={e => setForm(f => ({ ...f, campaign_type: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500">
                    {['paid_search','paid_social','seo','email','referral','partner','content'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Platform</label>
                  <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500">
                    <option value="">— select —</option>
                    {['google_ads','meta','tiktok','organic','email','linkedin','youtube'].map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Status */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500">
                  {['draft','active','paused','completed'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {/* Budgets row */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Daily Budget (cents)</label>
                  <input type="number" value={form.daily_budget_cents} onChange={e => setForm(f => ({ ...f, daily_budget_cents: e.target.value }))}
                    placeholder="5000 = $50"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Monthly Budget (cents)</label>
                  <input type="number" value={form.monthly_budget_cents} onChange={e => setForm(f => ({ ...f, monthly_budget_cents: e.target.value }))}
                    placeholder="150000 = $1500"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">CPL Target (cents)</label>
                  <input type="number" value={form.cost_per_lead_target_cents} onChange={e => setForm(f => ({ ...f, cost_per_lead_target_cents: e.target.value }))}
                    placeholder="2500 = $25"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
                </div>
              </div>
              {/* UTMs */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">UTM Parameters</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['utm_source','utm_medium','utm_campaign'] as const).map(field => (
                    <input key={field} value={form[field] as string}
                      onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                      placeholder={field.replace('utm_', '')}
                      className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
                  ))}
                </div>
              </div>
              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Start Date</label>
                  <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">End Date</label>
                  <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500" />
                </div>
              </div>
              {/* Notes */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Notes / Strategy</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} placeholder="Campaign strategy, creative notes, targeting details…"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none" />
              </div>
              {saveError && (
                <div className="p-2 bg-red-900/20 border border-red-800/30 rounded-lg text-xs text-red-400">
                  {saveError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 p-6 border-t border-zinc-800">
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors">
                Cancel
              </button>
              <button onClick={() => void handleSave()} disabled={saving || !form.name}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium transition-colors flex items-center gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                {editCampaign ? 'Save Changes' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
