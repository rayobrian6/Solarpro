'use client';
import React, { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useParams } from 'next/navigation';
import type { Project } from '@/types';
import { useAppStore } from '@/store/appStore';
import {
  ArrowLeft, Map, FileText, Zap, DollarSign, Sun,
  User, Calendar, Settings, TrendingUp, Leaf, Edit
} from 'lucide-react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line
} from 'recharts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const statusColors: Record<string, string> = {
  lead: 'badge-lead', design: 'badge-design', proposal: 'badge-proposal',
  approved: 'badge-approved', installed: 'badge-installed',
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  // ✅ Phase 5/6: Use global store — loadActiveProject has 3-tier fallback
  const loadActiveProject = useAppStore(s => s.loadActiveProject);
  const projects = useAppStore(s => s.projects);

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check store first (instant)
    const existing = projects.find(p => p.id === id);
    if (existing) {
      setProject(existing);
      setLoading(false);
      return;
    }
    // Otherwise use loadActiveProject (server → localStorage fallback)
    loadActiveProject(id)
      .then(p => { setProject(p); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id, projects, loadActiveProject]);

  if (loading) return <AppShell><div className="p-6 flex items-center justify-center h-64"><div className="spinner w-8 h-8" /></div></AppShell>;
  if (!project) return (
    <AppShell>
      <div className="p-6 text-center">
        <p className="text-slate-400 mb-4">Project not found</p>
        <Link href="/projects" className="btn-primary">Back to Projects</Link>
      </div>
    </AppShell>
  );

  const production = project.production;
  const cost = project.costEstimate;
  const layout = project.layout;

  const productionChartData = production
    ? MONTHS.map((month, i) => ({
        month,
        production: production.monthlyProductionKwh[i],
        usage: Math.round((project.client?.annualKwh || 0) / 12),
      }))
    : [];

  const savingsData = cost
    ? Array.from({ length: 25 }, (_, i) => ({
        year: `Y${i + 1}`,
        cumulative: Math.round(cost.annualSavings * (i + 1) * Math.pow(1.035, i)),
        netCost: i === 0 ? cost.netCost : 0,
      }))
    : [];

  const typeIcon = { roof: '🏠', ground: '🌱', fence: '🔲' }[project.systemType];
  const typeLabel = { roof: 'Roof Mount', ground: 'Ground Mount', fence: 'Sol Fence' }[project.systemType];

  return (
    <AppShell>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/projects" className="btn-ghost p-2 rounded-lg"><ArrowLeft size={18} /></Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-white">{project.name}</h1>
              <span className={`badge ${statusColors[project.status]}`}>{project.status}</span>
              <span className={`badge ${project.systemType === 'roof' ? 'badge-roof' : project.systemType === 'ground' ? 'badge-ground' : 'badge-fence'}`}>{typeLabel}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
              <span className="flex items-center gap-1"><User size={10} />{project.client?.name}</span>
              <span className="flex items-center gap-1"><Calendar size={10} />{new Date(project.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href={`/design?projectId=${id}`} className="btn-secondary btn-sm"><Map size={14} /> Design Studio</Link>
            <Link href={`/proposals?projectId=${id}`} className="btn-primary btn-sm"><FileText size={14} /> Generate Proposal</Link>
          </div>
        </div>

        {/* Status Pipeline */}
        <div className="card p-4">
          <div className="flex items-center gap-2">
            {['lead', 'design', 'proposal', 'approved', 'installed'].map((status, i, arr) => (
              <React.Fragment key={status}>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  project.status === status ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  arr.indexOf(project.status) > i ? 'text-emerald-400' : 'text-slate-500'
                }`}>
                  {arr.indexOf(project.status) > i && <span>✓</span>}
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </div>
                {i < arr.length - 1 && <div className={`flex-1 h-px ${arr.indexOf(project.status) > i ? 'bg-emerald-500/40' : 'bg-slate-700'}`} />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* System Info */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-white text-sm flex items-center gap-2">
              <span className="text-xl">{typeIcon}</span> System Configuration
            </h3>
            {layout ? (
              <div className="space-y-2 text-sm">
                {[
                  { label: 'System Size', value: `${layout.systemSizeKw.toFixed(2)} kW` },
                  { label: 'Panel Count', value: `${layout.totalPanels} panels` },
                  { label: 'System Type', value: typeLabel },
                  ...(project.systemType === 'fence' ? [
                    { label: 'Tilt', value: '90° (Vertical)' },
                    { label: 'Bifacial', value: layout.bifacialOptimized ? 'Yes (+20%)' : 'Yes (+10%)' },
                  ] : [
                    { label: 'Tilt', value: `${layout.groundTilt || 20}°` },
                    { label: 'Azimuth', value: `${layout.groundAzimuth || 180}°` },
                  ]),
                ].map(item => (
                  <div key={item.label} className="flex justify-between border-b border-slate-700/50 pb-2">
                    <span className="text-slate-400">{item.label}</span>
                    <span className="font-medium text-white">{item.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-slate-500 text-sm">No design yet</p>
                <Link href={`/design?projectId=${id}`} className="btn-primary btn-sm mt-3 inline-flex">Open Design Studio</Link>
              </div>
            )}
          </div>

          {/* Production Summary */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-white text-sm flex items-center gap-2"><Zap size={14} className="text-amber-400" /> Production</h3>
            {production ? (
              <div className="space-y-3">
                <div className="text-center py-2">
                  <div className="text-3xl font-bold text-amber-400">{production.annualProductionKwh.toLocaleString()}</div>
                  <div className="text-xs text-slate-400">kWh per year</div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill bg-gradient-to-r from-amber-500 to-emerald-500" style={{ width: `${Math.min(100, production.offsetPercentage)}%` }} />
                </div>
                <div className="text-center text-sm font-semibold text-emerald-400">{production.offsetPercentage}% energy offset</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: 'Specific Yield', value: `${production.specificYield} kWh/kWp` },
                    { label: 'CO₂ Offset', value: `${production.co2OffsetTons} tons/yr` },
                    { label: 'Trees Equiv.', value: `${production.treesEquivalent}` },
                    { label: 'Perf. Ratio', value: `${(production.performanceRatio * 100).toFixed(0)}%` },
                  ].map(item => (
                    <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                      <div className="text-slate-500">{item.label}</div>
                      <div className="font-semibold text-white">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-slate-500 text-sm">No production data</p>
                <p className="text-slate-600 text-xs mt-1">Complete design to calculate</p>
              </div>
            )}
          </div>

          {/* Financial Summary */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-white text-sm flex items-center gap-2"><DollarSign size={14} className="text-emerald-400" /> Financials</h3>
            {cost ? (
              <div className="space-y-2 text-sm">
                {[
                  { label: 'Gross Cost', value: `$${cost.grossCost.toLocaleString()}` },
                  { label: 'Tax Credit', value: `-$${cost.taxCredit.toLocaleString()}`, color: 'text-emerald-400' },
                  { label: 'Net Cost', value: `$${cost.netCost.toLocaleString()}`, bold: true, color: 'text-amber-400' },
                  { label: 'Annual Savings', value: `$${cost.annualSavings.toLocaleString()}/yr`, color: 'text-emerald-400' },
                  { label: 'Payback', value: `${cost.paybackYears} years` },
                  { label: '25-yr Savings', value: `$${cost.lifetimeSavings.toLocaleString()}`, color: 'text-emerald-400' },
                  { label: 'ROI', value: `${cost.roi}%`, color: 'text-emerald-400' },
                ].map(item => (
                  <div key={item.label} className={`flex justify-between border-b border-slate-700/50 pb-1.5 ${(item as any).bold ? 'font-bold text-base' : ''}`}>
                    <span className="text-slate-400">{item.label}</span>
                    <span className={(item as any).color || 'text-white'}>{item.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-slate-500 text-sm">No cost estimate</p>
              </div>
            )}
          </div>
        </div>

        {/* Charts */}
        {production && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-5">
              <h3 className="font-semibold text-white mb-4 text-sm">Monthly Production vs Usage</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={productionChartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }} />
                  <Bar dataKey="production" fill="#f59e0b" radius={[2, 2, 0, 0]} name="Production (kWh)" />
                  <Bar dataKey="usage" fill="#3b82f6" radius={[2, 2, 0, 0]} name="Usage (kWh)" opacity={0.6} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {cost && (
              <div className="card p-5">
                <h3 className="font-semibold text-white mb-4 text-sm">25-Year Cumulative Savings</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={savingsData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} interval={4} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }} formatter={(v: number) => [`$${v.toLocaleString()}`, 'Savings']} />
                    <Line type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {project.notes && (
          <div className="card p-5">
            <h3 className="font-semibold text-white mb-2 text-sm">Notes</h3>
            <p className="text-slate-400 text-sm">{project.notes}</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}