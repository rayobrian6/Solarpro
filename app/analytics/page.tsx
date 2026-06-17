'use client';
import React, { useState, useEffect, useMemo } from 'react';
import AppShell from '@/components/ui/AppShell';
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, Zap, DollarSign, Leaf, Sun, BarChart2, BarChart3,
  Users, Home, Sprout, Fence, ArrowUpRight,
  ArrowDownRight, Target, Clock,
  ChevronRight, RefreshCcw, AlertTriangle,
} from 'lucide-react';
import type { Project, Client } from '@/types';
import Link from 'next/link';

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS_ORDER: string[] = ['lead', 'design', 'proposal', 'approved', 'installed'];
const STATUS_LABELS: Record<string, string> = { lead: 'Lead', design: 'Design', proposal: 'Proposal', approved: 'Approved', installed: 'Installed' };
const STATUS_COLORS: Record<string, string> = { lead: '#64748b', design: '#3b82f6', proposal: '#f59e0b', approved: '#10b981', installed: '#22c55e' };
const FUNNEL_COLORS: string[] = ['#64748b', '#3b82f6', '#f59e0b', '#10b981', '#22c55e'];

type TimeRange = '1m' | '3m' | '1y' | 'all';
const TIME_LABELS: Record<TimeRange, string> = { '1m': 'This Month', '3m': '3 Months', '1y': 'This Year', all: 'All Time' };

function daysBetween(a: string | Date, b: string | Date): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

function fmtK(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function filterByRange(projects: Project[], range: TimeRange): Project[] {
  if (range === 'all') return projects;
  const now = new Date();
  let cutoff: Date;
  if (range === '1m') cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (range === '3m') cutoff = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  else cutoff = new Date(now.getFullYear(), 0, 1);
  return projects.filter(p => new Date(p.createdAt) >= cutoff);
}

function getPreviousPeriod(projects: Project[], range: TimeRange): Project[] {
  if (range === 'all') return [];
  const now = new Date();
  let start: Date, end: Date;
  if (range === '1m') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  } else if (range === '3m') {
    start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    end = new Date(now.getFullYear(), now.getMonth() - 2, 0, 23, 59, 59);
  } else {
    start = new Date(now.getFullYear() - 1, 0, 1);
    end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
  }
  return projects.filter(p => { const d = new Date(p.createdAt); return d >= start && d <= end; });
}

function trendPct(current: number, previous: number): { label: string; positive: boolean; neutral: boolean } {
  if (previous === 0 && current === 0) return { label: 'No data', positive: false, neutral: true };
  if (previous === 0 && current > 0) return { label: 'New', positive: true, neutral: false };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { label: 'Flat', positive: false, neutral: true };
  return { label: `${pct > 0 ? '+' : ''}${pct}%`, positive: pct > 0, neutral: false };
}

// ════════════════════════════════════════════════════════════════
// TOOLTIP STYLE
// ════════════════════════════════════════════════════════════════
const tooltipStyle = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', fontSize: '11px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' };

// ════════════════════════════════════════════════════════════════
// COMPONENT: KPI Card
// ════════════════════════════════════════════════════════════════
function KpiCard({ icon, label, value, sub, trend, color, loading }: {
  icon: React.ReactNode; label: string; value: string; sub: string;
  trend?: { label: string; positive: boolean; neutral: boolean };
  color: string; loading: boolean;
}) {
  return (
    <div className="rounded-2xl p-5 transition-all hover:scale-[1.01]"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center`}
          style={{ background: `${color}15` }}>
          {icon}
        </div>
        {trend && !loading && (
          <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${
            trend.neutral ? 'text-slate-400 bg-slate-700/40'
              : trend.positive ? 'text-emerald-400 bg-emerald-500/10'
                : 'text-red-400 bg-red-500/10'
          }`}>
            {!trend.neutral && (trend.positive
              ? <ArrowUpRight size={9} />
              : <ArrowDownRight size={9} />
            )}
            {trend.label}
          </div>
        )}
      </div>
      <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
        {loading ? '—' : value}
      </div>
      <div className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════
export default function AnalyticsPage() {
  const [mounted, setMounted] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>('all');

  useEffect(() => {
    setMounted(true);
    Promise.all([
      fetch('/api/projects').then(r => r.json()),
      fetch('/api/clients').then(r => r.json()),
    ]).then(([projData, clientData]) => {
      setAllProjects(projData.data || []);
      setClients(clientData.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // ── Filtered datasets ──
  const projects = useMemo(() => filterByRange(allProjects, range), [allProjects, range]);
  const prevProjects = useMemo(() => getPreviousPeriod(allProjects, range), [allProjects, range]);

  // ══════════════════════════════════════════════════════════════════════════════════
  // REVENUE HELPERS
  // ══════════════════════════════════════════════════════════════════════════════════

  /**
   * #9 FIX: getProjectRevenue()
   * Returns net cost for a project. We only count projects that *actually* have
   * pricing data — i.e. costEstimate?.netCost > 0 — so empty/in-progress projects
   * don't inflate the denominator and drag revenue metrics to near-zero.
   */
  function getProjectRevenue(p: Project): number {
    return (p.costEstimate?.netCost ?? 0) > 0 ? (p.costEstimate!.netCost) : 0;
  }

  /** % of projects that have real cost data */
  const pricedProjectCount = projects.filter(p => getProjectRevenue(p) > 0).length;
  const revenueDataQuality = projects.length > 0
    ? Math.round((pricedProjectCount / projects.length) * 100)
    : 100; // 100 = "no data" edge case, hide banner

  // ════════════════════════════════════════════════════════════
  // KPI CALCULATIONS
  // ════════════════════════════════════════════════════════════
  const totalRevenue = projects.reduce((s, p) => s + getProjectRevenue(p), 0);
  const prevRevenue = prevProjects.reduce((s, p) => s + getProjectRevenue(p), 0);

  const closedDeals = projects.filter(p => p.status === 'approved' || p.status === 'installed');
  const prevClosed = prevProjects.filter(p => p.status === 'approved' || p.status === 'installed');
  const closeRate = projects.length > 0 ? Math.round((closedDeals.length / projects.length) * 100) : 0;
  const prevCloseRate = prevProjects.length > 0 ? Math.round((prevClosed.length / prevProjects.length) * 100) : 0;

  const closedWithRevenue = closedDeals.filter(p => getProjectRevenue(p) > 0);
  const avgDealSize = closedWithRevenue.length > 0
    ? closedWithRevenue.reduce((s, p) => s + getProjectRevenue(p), 0) / closedWithRevenue.length : 0;
  const prevClosedWithRevenue = prevClosed.filter(p => getProjectRevenue(p) > 0);
  const prevAvgDeal = prevClosedWithRevenue.length > 0
    ? prevClosedWithRevenue.reduce((s, p) => s + getProjectRevenue(p), 0) / prevClosedWithRevenue.length : 0;

  const avgDaysToClose = closedDeals.length > 0
    ? Math.round(closedDeals.reduce((s, p) => s + daysBetween(p.createdAt, p.updatedAt), 0) / closedDeals.length) : 0;
  const prevAvgDays = prevClosed.length > 0
    ? Math.round(prevClosed.reduce((s, p) => s + daysBetween(p.createdAt, p.updatedAt), 0) / prevClosed.length) : 0;

  const totalKw = projects.reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0);
  const totalAnnualKwh = projects.reduce((s, p) => s + (p.production?.annualProductionKwh || 0), 0);
  const totalCo2 = parseFloat((totalAnnualKwh * 0.000386).toFixed(1));

  // ════════════════════════════════════════════════════════════
  // REVENUE OVER TIME (monthly bars + cumulative line)
  // ════════════════════════════════════════════════════════════
  const revenueByMonth = useMemo(() => {
    const now = new Date();
    let monthCount: number;
    if (range === '1m') monthCount = 1;
    else if (range === '3m') monthCount = 3;
    else if (range === '1y') monthCount = 12;
    else {
      // All Time: calculate months from oldest project
      const oldest = allProjects.reduce((min, p) => {
        const d = new Date(p.createdAt);
        return d < min ? d : min;
      }, now);
      monthCount = Math.max(1, Math.ceil((now.getTime() - oldest.getTime()) / (30.44 * 86400000)) + 1);
      if (monthCount > 36) monthCount = 36; // Cap at 3 years for readability
    }
    const data: { month: string; revenue: number; cumulative: number }[] = [];
    let cumulative = 0;

    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const label = `${MONTHS[d.getMonth()]}${range === 'all' || range === '1y' ? '' : ` '${String(d.getFullYear()).slice(2)}`}`;

      const monthProjects = allProjects.filter(p => {
        const cd = new Date(p.createdAt);
        return cd >= d && cd <= monthEnd;
      });
      const rev = monthProjects.reduce((s, p) => s + getProjectRevenue(p), 0);
      cumulative += rev;
      data.push({ month: label, revenue: Math.round(rev), cumulative: Math.round(cumulative) });
    }
    return data;
  }, [allProjects, range]);

  // ════════════════════════════════════════════════════════════
  // CONVERSION FUNNEL
  // ════════════════════════════════════════════════════════════
  const funnelData = useMemo(() => {
    const counts = STATUS_ORDER.map(s => projects.filter(p => {
      const idx = STATUS_ORDER.indexOf(p.status);
      const targetIdx = STATUS_ORDER.indexOf(s);
      return idx >= targetIdx; // Projects at this stage OR beyond
    }).length);

    return STATUS_ORDER.map((s, i) => ({
      stage: STATUS_LABELS[s],
      count: counts[i],
      pct: counts[0] > 0 ? Math.round((counts[i] / counts[0]) * 100) : 0,
      dropoff: i > 0 && counts[i - 1] > 0 ? Math.round(((counts[i - 1] - counts[i]) / counts[i - 1]) * 100) : 0,
      color: FUNNEL_COLORS[i],
    }));
  }, [projects]);

  // ════════════════════════════════════════════════════════════
  // SALES VELOCITY (avg days per stage)
  // ════════════════════════════════════════════════════════════
  const velocityData = useMemo(() => {
    // For projects that have passed each stage, estimate time in stage
    // We approximate using createdAt/updatedAt since we don't track per-stage timestamps
    const stageProjects: Record<string, number[]> = {};
    STATUS_ORDER.forEach(s => { stageProjects[s] = []; });

    projects.forEach(p => {
      const totalDays = daysBetween(p.createdAt, p.updatedAt) || 1;
      const stageIdx = STATUS_ORDER.indexOf(p.status);
      // Distribute total days across stages reached
      if (stageIdx >= 0) {
        const daysPerStage = totalDays / (stageIdx + 1);
        for (let i = 0; i <= stageIdx; i++) {
          stageProjects[STATUS_ORDER[i]].push(daysPerStage);
        }
      }
    });

    return STATUS_ORDER.slice(0, 4).map((s, i) => {
      const days = stageProjects[s];
      const avg = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0;
      return {
        stage: STATUS_LABELS[s],
        days: avg,
        color: STATUS_COLORS[s],
        projects: days.length,
      };
    });
  }, [projects]);

  // ════════════════════════════════════════════════════════════
  // PRODUCTION CHART (real monthly data by type)
  // ════════════════════════════════════════════════════════════
  const monthlyProduction = useMemo(() => MONTHS.map((month, i) => {
    const roof = projects.filter(p => p.systemType === 'roof' && p.production)
      .reduce((s, p) => s + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    const ground = projects.filter(p => p.systemType === 'ground' && p.production)
      .reduce((s, p) => s + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    const fence = projects.filter(p => p.systemType === 'fence' && p.production)
      .reduce((s, p) => s + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    return { month, roof: Math.round(roof), ground: Math.round(ground), fence: Math.round(fence), total: Math.round(roof + ground + fence) };
  }), [projects]);

  // ════════════════════════════════════════════════════════════
  // SYSTEM TYPE BREAKDOWN
  // ════════════════════════════════════════════════════════════
  const typeBreakdown = useMemo(() => [
    { name: 'Roof Mount', value: projects.filter(p => p.systemType === 'roof').length, color: '#f59e0b', icon: <Home size={12} />, kw: projects.filter(p => p.systemType === 'roof').reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0) },
    { name: 'Ground Mount', value: projects.filter(p => p.systemType === 'ground').length, color: '#14b8a6', icon: <Sprout size={12} />, kw: projects.filter(p => p.systemType === 'ground').reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0) },
    { name: 'Sol Fence', value: projects.filter(p => p.systemType === 'fence').length, color: '#a855f7', icon: <Fence size={12} />, kw: projects.filter(p => p.systemType === 'fence').reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0) },
  ], [projects]);

  // ════════════════════════════════════════════════════════════
  // PIPELINE BY STATUS
  // ════════════════════════════════════════════════════════════
  const statusBreakdown = useMemo(() => STATUS_ORDER.map(s => ({
    status: STATUS_LABELS[s],
    count: projects.filter(p => p.status === s).length,
    revenue: projects.filter(p => p.status === s).reduce((sum, p) => sum + getProjectRevenue(p), 0),
    color: STATUS_COLORS[s],
  })), [projects]);

  // ════════════════════════════════════════════════════════════
  // TOP PROJECTS & CLIENTS
  // ════════════════════════════════════════════════════════════
  const topProjects = useMemo(() => [...projects]
    .filter(p => p.costEstimate?.netCost)
    .sort((a, b) => getProjectRevenue(b) - getProjectRevenue(a))
    .slice(0, 5), [projects]);

  const topClients = useMemo(() => clients.map(c => ({
    ...c,
    projectCount: projects.filter(p => p.clientId === c.id).length,
    totalKw: projects.filter(p => p.clientId === c.id).reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0),
    revenue: projects.filter(p => p.clientId === c.id).reduce((s, p) => s + getProjectRevenue(p), 0),
  })).filter(c => c.projectCount > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5), [clients, projects]);

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════
  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-5 animate-fade-in" style={{ maxWidth: '1800px' }}>

        {/* ══════════ ANALYTICS COMMAND HEADER ══════════ */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 size={13} className="text-green-400" />
                  <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Performance Intelligence</span>
                  {loading && <RefreshCcw size={11} className="text-slate-500 animate-spin" />}
                </div>
                <h1 className="text-2xl font-black text-white tracking-tight">Analytics</h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  {loading ? 'Loading...' : `Performance across ${projects.length} projects${range !== 'all' ? ` · ${TIME_LABELS[range]}` : ''}`}
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-700/60 bg-slate-900/60">
                {(Object.keys(TIME_LABELS) as TimeRange[]).map(r => (
                  <button key={r} onClick={() => setRange(r)}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all"
                    style={{
                      background: range === r ? 'var(--accent-amber)' : 'transparent',
                      color: range === r ? '#0f172a' : 'var(--text-muted)',
                    }}>
                    {TIME_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ═══ KPI STRIP ═══ */}

          {/* #9 FIX: Revenue data quality banner — shown when <80% of projects have pricing */}
          {!loading && projects.length > 0 && revenueDataQuality < 80 && (
            <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-xs"
              style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}>
              <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
              <span style={{ color: '#94a3b8' }}>
                Revenue figures only include projects with completed proposals
                ({pricedProjectCount} of {projects.length} projects have pricing data).
                Complete proposals to see accurate revenue metrics.
              </span>
            </div>
          )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard icon={<DollarSign size={18} style={{ color: '#4ADE80' }} />}
            label="Total Revenue" value={fmtK(totalRevenue)}
            sub={`${closedDeals.length} deals closed`}
            trend={range !== 'all' ? trendPct(totalRevenue, prevRevenue) : undefined}
            color="#4ADE80" loading={loading} />
          <KpiCard icon={<Target size={18} style={{ color: '#F59E0B' }} />}
            label="Close Rate" value={`${closeRate}%`}
            sub={`${closedDeals.length} of ${projects.length} projects`}
            trend={range !== 'all' ? trendPct(closeRate, prevCloseRate) : undefined}
            color="#F59E0B" loading={loading} />
          <KpiCard icon={<TrendingUp size={18} style={{ color: '#3B82F6' }} />}
            label="Avg Deal Size" value={fmtK(avgDealSize)}
            sub={closedDeals.length > 0 ? `Across ${closedDeals.length} closed deals` : 'No closed deals yet'}
            trend={range !== 'all' ? trendPct(avgDealSize, prevAvgDeal) : undefined}
            color="#3B82F6" loading={loading} />
          <KpiCard icon={<Clock size={18} style={{ color: '#A855F7' }} />}
            label="Avg Days to Close" value={avgDaysToClose > 0 ? `${avgDaysToClose}d` : '—'}
            sub={avgDaysToClose > 0 ? 'From lead to approval' : 'No data yet'}
            trend={range !== 'all' ? (() => {
              const t = trendPct(avgDaysToClose, prevAvgDays);
              return { ...t, positive: !t.positive && !t.neutral }; // Lower is better
            })() : undefined}
            color="#A855F7" loading={loading} />
        </div>

        {/* ═══ REVENUE OVER TIME ═══ */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Revenue Over Time</h3>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Monthly revenue + cumulative pipeline
                {pricedProjectCount < projects.length && projects.length > 0 && (
                  <span style={{ color: 'rgba(245,158,11,0.7)', marginLeft: 6 }}>
                    · {pricedProjectCount}/{projects.length} projects priced
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />Revenue</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />Cumulative</span>
            </div>
          </div>
          {mounted && (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={revenueByMonth} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="rev" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                <YAxis yAxisId="cum" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }}
                  formatter={(v: number, name: string) => [
                    `$${v.toLocaleString()}`,
                    name === 'revenue' ? 'Monthly Revenue' : 'Cumulative'
                  ]} />
                <Bar yAxisId="rev" dataKey="revenue" fill="url(#revGrad)" stroke="#10b981" strokeWidth={1} radius={[4, 4, 0, 0]} />
                <Line yAxisId="cum" type="monotone" dataKey="cumulative" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ═══ CONVERSION FUNNEL + SALES VELOCITY ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Conversion Funnel */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Conversion Funnel</h3>
            {projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-xs" style={{ color: 'var(--text-muted)' }}>
                <BarChart2 size={28} className="mb-2 opacity-30" />
                Create projects to see funnel
              </div>
            ) : (
              <div className="space-y-3">
                {funnelData.map((f, i) => {
                  const maxCount = funnelData[0].count || 1;
                  return (
                    <div key={f.stage}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: f.color }} />
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{f.stage}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold" style={{ color: f.color }}>{f.count}</span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                            style={{ background: `${f.color}15`, color: f.color }}>
                            {f.pct}%
                          </span>
                          {i > 0 && f.dropoff > 0 && (
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">
                              −{f.dropoff}% drop
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${(f.count / maxCount) * 100}%`, background: f.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sales Velocity */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Sales Velocity</h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Avg days per pipeline stage</p>
              </div>
              {avgDaysToClose > 0 && (
                <div className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(168,85,247,0.1)', color: '#A855F7', border: '1px solid rgba(168,85,247,0.2)' }}>
                  Total: {avgDaysToClose}d avg
                </div>
              )}
            </div>
            {velocityData.every(v => v.days === 0) ? (
              <div className="flex flex-col items-center justify-center h-40 text-xs" style={{ color: 'var(--text-muted)' }}>
                <Clock size={28} className="mb-2 opacity-30" />
                Need more project history for velocity data
              </div>
            ) : (
              <div className="space-y-4">
                {velocityData.map((v, i) => {
                  const maxDays = Math.max(...velocityData.map(d => d.days), 1);
                  return (
                    <div key={v.stage}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: v.color }} />
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{v.stage}</span>
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>({v.projects} projects)</span>
                        </div>
                        <span className="text-sm font-black" style={{ color: v.color }}>{v.days}d</span>
                      </div>
                      <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                        <div className="h-full rounded-full transition-all duration-700 flex items-center justify-end pr-1"
                          style={{ width: `${Math.max((v.days / maxDays) * 100, 4)}%`, background: `${v.color}30`, borderRight: `3px solid ${v.color}` }}>
                        </div>
                      </div>
                      {i < velocityData.length - 1 && (
                        <div className="flex justify-center my-1">
                          <ChevronRight size={10} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ═══ PRODUCTION + SYSTEM TYPE ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Monthly Production by System Type</h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>kWh across all designed systems</p>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />Roof</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-teal-500 inline-block" />Ground</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-purple-500 inline-block" />Fence</span>
              </div>
            </div>
            {mounted && (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={monthlyProduction} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <defs>
                    {[['roofGrad', '#f59e0b'], ['groundGrad', '#14b8a6'], ['fenceGrad', '#a855f7']].map(([id, color]) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }}
                    formatter={(v: number) => [`${v.toLocaleString()} kWh`, '']} />
                  <Area type="monotone" dataKey="roof" stroke="#f59e0b" fill="url(#roofGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="ground" stroke="#14b8a6" fill="url(#groundGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="fence" stroke="#a855f7" fill="url(#fenceGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* System Type Distribution */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>System Type Distribution</h3>
            {mounted && typeBreakdown.some(t => t.value > 0) ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={typeBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                      {typeBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 mt-2">
                  {typeBreakdown.map(t => (
                    <div key={t.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                        <span style={{ color: 'var(--text-muted)' }}>{t.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t.value}</span>
                        <span className="ml-1" style={{ color: 'var(--text-muted)' }}>({t.kw.toFixed(1)} kW)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-xs" style={{ color: 'var(--text-muted)' }}>
                <BarChart2 size={28} className="mb-2 opacity-30" />
                Create projects to see distribution
              </div>
            )}
          </div>
        </div>

        {/* ═══ PIPELINE + TOP DEALS + TOP CLIENTS ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Pipeline by Status */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Pipeline by Status</h3>
              <Link href="/projects" className="text-[10px] font-bold hover:brightness-110 transition-all"
                style={{ color: 'var(--accent-amber)' }}>View all →</Link>
            </div>
            {mounted && (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={statusBreakdown} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="status" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle}
                    formatter={(v: number, name: string, props: any) => [
                      `${v} projects · ${fmtK(props.payload.revenue)}`,
                      props.payload.status
                    ]} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {statusBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top Deals by Value */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Top Deals by Value</h3>
              <Link href="/projects" className="text-[10px] font-bold hover:brightness-110 transition-all"
                style={{ color: 'var(--accent-amber)' }}>All projects →</Link>
            </div>
            {loading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="shimmer h-10 rounded-lg" />)}</div>
            ) : topProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-xs" style={{ color: 'var(--text-muted)' }}>
                <Target size={28} className="mb-2 opacity-30" />
                No projects with estimates yet
              </div>
            ) : (
              <div className="space-y-2">
                {topProjects.map((project, idx) => {
                  const maxVal = topProjects[0]?.costEstimate?.netCost || 1;
                  const pct = ((project.costEstimate?.netCost || 0) / maxVal) * 100;
                  return (
                    <Link key={project.id} href={`/projects/${project.id}`} className="block group">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-[10px] font-bold w-4" style={{ color: 'var(--text-muted)' }}>#{idx + 1}</span>
                        <span className="text-xs font-medium flex-1 truncate group-hover:text-amber-300 transition-colors"
                          style={{ color: 'var(--text-primary)' }}>{project.name}</span>
                        <span className="text-xs font-bold" style={{ color: '#4ADE80' }}>{fmtK(getProjectRevenue(project))}</span>
                      </div>
                      <div className="ml-7 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                        <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top Clients by Revenue */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Top Clients by Revenue</h3>
              <Link href="/clients" className="text-[10px] font-bold hover:brightness-110 transition-all"
                style={{ color: 'var(--accent-amber)' }}>All clients →</Link>
            </div>
            {loading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="shimmer h-10 rounded-lg" />)}</div>
            ) : topClients.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-xs" style={{ color: 'var(--text-muted)' }}>
                <Users size={28} className="mb-2 opacity-30" />
                No clients with projects yet
              </div>
            ) : (
              <div className="space-y-2">
                {topClients.map((client, idx) => (
                  <Link key={client.id} href={`/clients/${client.id}`}
                    className="flex items-center gap-3 group hover:brightness-95 rounded-lg p-2 -mx-2 transition-all">
                    <span className="text-[10px] font-bold w-4" style={{ color: 'var(--text-muted)' }}>#{idx + 1}</span>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#F59E0B' }}>
                      {client.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate group-hover:text-amber-300 transition-colors"
                        style={{ color: 'var(--text-primary)' }}>{client.name}</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {client.projectCount} project{client.projectCount !== 1 ? 's' : ''} · {client.totalKw.toFixed(1)} kW
                      </div>
                    </div>
                    <span className="text-xs font-bold" style={{ color: '#4ADE80' }}>{fmtK(client.revenue)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ═══ ENVIRONMENTAL IMPACT ═══ */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2 mb-5">
            <Leaf size={15} className="text-emerald-400" />
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Environmental Impact</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: 'Total Capacity',
                value: totalKw >= 1000 ? `${(totalKw / 1000).toFixed(2)} MW` : `${totalKw.toFixed(1)} kW`,
                sub: `${projects.filter(p => p.layout).length} designed systems`,
                color: '#F59E0B', icon: <Zap size={18} />
              },
              {
                label: 'Annual Production',
                value: totalAnnualKwh >= 1_000_000 ? `${(totalAnnualKwh / 1_000_000).toFixed(2)} GWh`
                  : totalAnnualKwh >= 1000 ? `${(totalAnnualKwh / 1000).toFixed(1)} MWh`
                    : `${Math.round(totalAnnualKwh)} kWh`,
                sub: 'Per year', color: '#3B82F6', icon: <Sun size={18} />
              },
              {
                label: 'CO₂ Offset',
                value: `${totalCo2} tons/yr`,
                sub: `${Math.round(totalCo2 * 16.5).toLocaleString()} trees equiv.`,
                color: '#10B981', icon: <Leaf size={18} />
              },
              {
                label: 'Homes Powered',
                value: Math.round(totalAnnualKwh / 10500).toLocaleString(),
                sub: 'Average US households',
                color: '#06B6D4', icon: <Home size={18} />
              },
            ].map((item) => (
              <div key={item.label} className="rounded-xl p-4 text-center transition-all hover:scale-[1.01]"
                style={{ background: `${item.color}08`, border: `1px solid ${item.color}20` }}>
                <div className="flex justify-center mb-2" style={{ color: item.color }}>{item.icon}</div>
                <div className="text-xl font-black" style={{ color: item.color }}>{loading ? '—' : item.value}</div>
                <div className="text-[11px] font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{item.label}</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.sub}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  );
}