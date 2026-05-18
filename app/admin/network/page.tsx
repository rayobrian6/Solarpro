'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight,
  BarChart3, CheckCircle2, ChevronDown, ChevronUp,
  Clock, Filter, Globe, Network, RefreshCw,
  Search, Shield, Sparkles, TrendingUp, Users, Zap,
  XCircle, Play, Eye, Star, Target, Layers,
  Inbox, Cpu, Webhook, RotateCcw, StopCircle,
  CheckCheck, Loader2, Ban, FlaskConical,
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
  { id: 'live',        label: 'Live Feed',          icon: Zap },
  { id: 'screening',   label: 'Screening Queue',    icon: Shield },
  { id: 'analytics',   label: 'Campaign Intel',     icon: BarChart3 },
  { id: 'matching',    label: 'Contractor Match',   icon: Users },
  { id: 'health',      label: 'Marketplace Health', icon: Activity },
  { id: 'intake',      label: 'Intake Feed',        icon: Inbox },
  { id: 'enrichment',  label: 'Enrichment Queue',   icon: Cpu },
  { id: 'webhooks',    label: 'Webhook Log',        icon: Webhook },
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
        {activeTab === 'intake' && <IntakeFeedSection />}
        {activeTab === 'enrichment' && <EnrichmentQueueSection />}
        {activeTab === 'webhooks' && <WebhookLogSection />}
      </div>
    </div>
  );
}


// ── Intake Feed Section ──────────────────────────────────────────────────────

interface IntakeLead {
  id: string;
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
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (search) params.set('search', search);
      if (sourceFilter) params.set('source_system', sourceFilter);
      if (channelFilter) params.set('source_channel', channelFilter);
      const res = await fetch(`/api/admin/network/intake?${params}`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.opportunities ?? []);
        setStats(data.stats ?? {});
        setTotal(data.total ?? 0);
      }
    } catch (e) { console.error(e); }
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

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Today's Intake" value={stats.today_count ?? 0} color="text-orange-400" icon={Inbox} />
        <StatCard label="Total Leads" value={stats.total ?? total} color="text-white" icon={Users} />
        <StatCard label="Conversion Rate" value={`${((stats.conversion_rate ?? 0) * 100).toFixed(1)}%`} color="text-green-400" icon={TrendingUp} />
        <StatCard label="Validation Failures" value={`${((stats.validation_failure_rate ?? 0) * 100).toFixed(1)}%`} color={((stats.validation_failure_rate ?? 0) > 0.2) ? 'text-red-400' : 'text-zinc-300'} icon={AlertCircle} />
      </div>
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
              {!loading && leads.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500"><Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No intake leads. Run <code className="text-orange-400 text-xs">POST /api/migrate</code> first.</p></td></tr>}
              {!loading && leads.map(lead => (
                <tr key={lead.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{[lead.first_name, lead.last_name].filter(Boolean).join(' ') || <span className="text-zinc-600 italic">Anonymous</span>}</div>
                    {lead.is_duplicate && <span className="text-xs text-amber-400">⚠ dup {lead.duplicate_score ? `(${(lead.duplicate_score * 100).toFixed(0)}%)` : ''}</span>}
                  </td>
                  <td className="px-4 py-3"><div className="text-zinc-300 text-xs">{lead.email ?? '—'}</div><div className="text-zinc-500 text-xs">{lead.phone ?? ''}</div></td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{[lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || lead.address_line1 || '—'}</td>
                  <td className="px-4 py-3"><div className="text-zinc-300 text-xs">{lead.source_system ?? '—'}</div><div className={`text-xs ${sourceChannelColor(lead.source_channel)}`}>{lead.source_channel ?? ''}</div></td>
                  <td className="px-4 py-3 text-zinc-300 text-xs">{lead.monthly_bill_amount ? `$${lead.monthly_bill_amount}/mo` : '—'}</td>
                  <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${enrichBadge(lead.enrichment_status)}`}>{lead.enrichment_status ?? 'pending'}</span></td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(lead.created_at).toLocaleString()}</td>
                </tr>
              ))}
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
