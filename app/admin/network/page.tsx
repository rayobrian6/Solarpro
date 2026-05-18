'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight,
  BarChart3, CheckCircle2, ChevronDown, ChevronUp,
  Clock, Filter, Globe, Network, RefreshCw,
  Search, Shield, Sparkles, TrendingUp, Users, Zap,
  XCircle, Play, Eye, Star, Target, Layers,
} from 'lucide-react';

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

interface Opportunity {
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

  useEffect(() => {
    fetch('/api/admin/network/screening?limit=15')
      .then(r => r.json())
      .then(d => { setQueue(d.queue ?? []); setStats(d.stats ?? {}); })
      .finally(() => setLoading(false));
  }, []);

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
    } catch (e) {
      setTriggerResult({ error: String(e) });
    } finally {
      setTriggering(false);
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
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Duration</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-400 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8 text-zinc-500">Loading…</td></tr>
            ) : queue.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-zinc-500">Queue is empty</td></tr>
            ) : queue.map((row, i) => (
              <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors">
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
                <td className="px-4 py-3 text-zinc-500 text-xs">
                  {row.duration_ms ? `${Math.round((row.duration_ms as number) / 1000)}s` : '—'}
                </td>
                <td className="px-4 py-3 text-zinc-500 text-xs">
                  {new Date(row.created_at as string).toLocaleDateString()}
                </td>
              </tr>
            ))}
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
  { id: 'live',       label: 'Live Feed',       icon: Zap },
  { id: 'screening',  label: 'Screening Queue', icon: Shield },
  { id: 'analytics',  label: 'Campaign Intel',  icon: BarChart3 },
  { id: 'matching',   label: 'Contractor Match',icon: Users },
  { id: 'health',     label: 'Marketplace Health', icon: Activity },
] as const;

type TabId = typeof TABS[number]['id'];

export default function NetworkControlCenter() {
  const [activeTab, setActiveTab] = useState<TabId>('live');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pipelineStats, setPipelineStats] = useState<Record<string, unknown>>({});

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
    loadOpportunities();
    loadAnalytics();
    loadHealth();
  }, [loadOpportunities, loadAnalytics, loadHealth]);

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
