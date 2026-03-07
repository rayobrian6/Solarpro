'use client';
import React, { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useAppStore } from '@/store/appStore';
import {
  Sun, Zap, Users, FolderOpen, FileText, TrendingUp,
  ArrowUpRight, ArrowRight, Plus, Leaf,
  DollarSign, BarChart2, ChevronRight, Activity,
  Home, Sprout, Fence, Clock, CheckCircle, AlertCircle
} from 'lucide-react';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import type { Project, Client } from '@/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_COLORS: Record<string, string> = {
  lead: 'badge-lead', design: 'badge-design', proposal: 'badge-proposal',
  approved: 'badge-approved', installed: 'badge-installed',
};
const TYPE_COLORS: Record<string, string> = {
  roof: 'badge-roof', ground: 'badge-ground', fence: 'badge-fence',
};
const TYPE_ICONS: Record<string, React.ReactNode> = {
  roof: <Home size={15} className="text-amber-400" />,
  ground: <Sprout size={15} className="text-teal-400" />,
  fence: <Fence size={15} className="text-purple-400" />,
};

function StatCard({ icon, label, value, sub, color, trend, href }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  color: string; trend?: string; href?: string;
}) {
  const content = (
    <div className={`card p-5 flex flex-col gap-3 hover:border-slate-600/60 transition-all duration-200 ${href ? 'cursor-pointer hover:scale-[1.01]' : ''}`}>
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          {icon}
        </div>
        {trend && (
          <div className="flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2 py-1 rounded-full">
            <ArrowUpRight size={11} />
            {trend}
          </div>
        )}
      </div>
      <div>
        <div className="text-2xl font-black text-white">{value}</div>
        <div className="text-xs text-slate-400 mt-0.5 font-medium">{label}</div>
        {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-0.5 h-8">
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm opacity-80"
          style={{ height: `${(v / max) * 100}%`, background: color }}
        />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);

  // ✅ Phase 6: Read from global store — single source of truth
  const projects = useAppStore(s => s.projects);
  const clients = useAppStore(s => s.clients);
  const projectsState = useAppStore(s => s.projectsState);
  const clientsState = useAppStore(s => s.clientsState);
  const loadProjects = useAppStore(s => s.loadProjects);
  const loadClients = useAppStore(s => s.loadClients);

  const loading = (projectsState === 'loading' || clientsState === 'loading') &&
    (projects.length === 0 && clients.length === 0);

  useEffect(() => {
    setMounted(true);
    // ✅ Phase 6: Force-refresh both from server on every dashboard visit
    loadProjects(true);
    loadClients(true);
  }, [loadProjects, loadClients]);

  // Derived stats
  const totalKw = projects.reduce((sum, p) => sum + (p.layout?.systemSizeKw || 0), 0);
  const totalRevenue = projects.reduce((sum, p) => sum + (p.costEstimate?.netCost || 0), 0);
  const recentProjects = [...projects].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  // System type breakdown
  const typeBreakdown = [
    { name: 'Roof Mount', value: projects.filter(p => p.systemType === 'roof').length, color: '#f59e0b' },
    { name: 'Ground Mount', value: projects.filter(p => p.systemType === 'ground').length, color: '#14b8a6' },
    { name: 'Sol Fence', value: projects.filter(p => p.systemType === 'fence').length, color: '#a855f7' },
  ].filter(t => t.value > 0);

  // Status pipeline
  const statusPipeline = ['lead', 'design', 'proposal', 'approved', 'installed'].map(s => ({
    status: s,
    count: projects.filter(p => p.status === s).length,
  }));

  // Monthly production data from real projects
  const monthlyProduction = MONTHS.map((month, i) => {
    const roofKwh = projects.filter(p => p.systemType === 'roof' && p.production)
      .reduce((sum, p) => sum + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    const groundKwh = projects.filter(p => p.systemType === 'ground' && p.production)
      .reduce((sum, p) => sum + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    const fenceKwh = projects.filter(p => p.systemType === 'fence' && p.production)
      .reduce((sum, p) => sum + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    return { month, roof: Math.round(roofKwh), ground: Math.round(groundKwh), fence: Math.round(fenceKwh) };
  });

  const hasProductionData = monthlyProduction.some(m => m.roof + m.ground + m.fence > 0);

  // Environmental impact
  const totalAnnualKwh = projects.reduce((sum, p) => sum + (p.production?.annualProductionKwh || 0), 0);
  const co2Tons = (totalAnnualKwh * 0.000386).toFixed(1);
  const treesEq = Math.round(totalAnnualKwh * 0.000386 * 16.5);
  const homesPowered = Math.round(totalAnnualKwh / 10500);

  // Top clients by project count
  const clientProjectCounts = clients.map(c => ({
    ...c,
    projectCount: projects.filter(p => p.clientId === c.id).length,
    totalKw: projects.filter(p => p.clientId === c.id).reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0),
  })).filter(c => c.projectCount > 0).sort((a, b) => b.totalKw - a.totalKw).slice(0, 4);

  return (
    <AppShell>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">Dashboard</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {loading ? 'Loading...' : `${projects.length} projects · ${clients.length} clients`}
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/clients/new" className="btn-secondary btn-sm">
              <Plus size={14} /> New Client
            </Link>
            <Link href="/projects/new" className="btn-primary btn-sm">
              <Plus size={14} /> New Project
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<FolderOpen size={18} className="text-amber-400" />}
            label="Total Projects"
            value={loading ? '—' : projects.length.toString()}
            sub={`${projects.filter(p => p.status === 'design' || p.status === 'proposal').length} active`}
            color="bg-amber-500/10"
            href="/projects"
          />
          <StatCard
            icon={<Users size={18} className="text-blue-400" />}
            label="Total Clients"
            value={loading ? '—' : clients.length.toString()}
            sub={`${clients.filter(c => projects.some(p => p.clientId === c.id)).length} with projects`}
            color="bg-blue-500/10"
            href="/clients"
          />
          <StatCard
            icon={<Zap size={18} className="text-emerald-400" />}
            label="Total Capacity"
            value={loading ? '—' : totalKw >= 1000 ? `${(totalKw / 1000).toFixed(1)} MW` : `${totalKw.toFixed(1)} kW`}
            sub="Designed capacity"
            color="bg-emerald-500/10"
          />
          <StatCard
            icon={<DollarSign size={18} className="text-purple-400" />}
            label="Pipeline Value"
            value={loading ? '—' : `$${(totalRevenue / 1000).toFixed(0)}k`}
            sub="Net after tax credit"
            color="bg-purple-500/10"
          />
        </div>

        {/* Pipeline Status Bar */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Project Pipeline</h3>
            <Link href="/projects" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
              View all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {statusPipeline.map(({ status, count }) => (
              <Link key={status} href={`/projects?status=${status}`} className="text-center group">
                <div className="text-2xl font-black text-white group-hover:text-amber-400 transition-colors">{count}</div>
                <div className={`text-xs mt-1 ${STATUS_COLORS[status]}`}>{status}</div>
              </Link>
            ))}
          </div>
          {/* Progress bar */}
          {projects.length > 0 && (
            <div className="flex gap-0.5 mt-3 h-1.5 rounded-full overflow-hidden">
              {statusPipeline.map(({ status, count }) => {
                const pct = (count / projects.length) * 100;
                const colors: Record<string, string> = {
                  lead: 'bg-slate-500', design: 'bg-blue-500', proposal: 'bg-amber-500',
                  approved: 'bg-emerald-500', installed: 'bg-green-400'
                };
                return pct > 0 ? (
                  <div key={status} className={`${colors[status]} rounded-full`} style={{ width: `${pct}%` }} />
                ) : null;
              })}
            </div>
          )}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Production Chart */}
          <div className="lg:col-span-2 card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white text-sm">Monthly Production by System Type</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {hasProductionData ? 'kWh across all designed systems' : 'Design systems to see production data'}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />Roof</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-500 inline-block" />Ground</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" />Fence</span>
              </div>
            </div>
            {mounted && (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={monthlyProduction} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="roofGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="groundGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="fenceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(v: number) => [`${v.toLocaleString()} kWh`, '']}
                  />
                  <Area type="monotone" dataKey="roof" stroke="#f59e0b" fill="url(#roofGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="ground" stroke="#14b8a6" fill="url(#groundGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="fence" stroke="#a855f7" fill="url(#fenceGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* System Type Pie */}
          <div className="card p-5">
            <div className="mb-4">
              <h3 className="font-semibold text-white text-sm">Projects by System Type</h3>
              <p className="text-xs text-slate-400 mt-0.5">Distribution across all projects</p>
            </div>
            {mounted && typeBreakdown.length > 0 ? (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={typeBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {typeBreakdown.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 w-full mt-2">
                  {typeBreakdown.map((item) => (
                    <div key={item.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                        <span className="text-slate-400">{item.name}</span>
                      </div>
                      <span className="font-semibold text-white">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-slate-500 text-xs text-center">
                <BarChart2 size={32} className="mb-2 opacity-30" />
                Create projects to see breakdown
              </div>
            )}
          </div>
        </div>

        {/* Recent Projects + Top Clients */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Recent Projects */}
          <div className="lg:col-span-2 card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm">Recent Projects</h3>
              <Link href="/projects" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
                View all <ChevronRight size={12} />
              </Link>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="shimmer h-14 rounded-lg" />)}
              </div>
            ) : recentProjects.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                <FolderOpen size={32} className="mx-auto mb-2 opacity-30" />
                No projects yet. <Link href="/projects/new" className="text-amber-400 hover:underline">Create one</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentProjects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-700/40 transition-colors group"
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      project.systemType === 'roof' ? 'bg-amber-500/15' :
                      project.systemType === 'ground' ? 'bg-teal-500/15' : 'bg-purple-500/15'
                    }`}>
                      {TYPE_ICONS[project.systemType]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate group-hover:text-amber-300 transition-colors">
                        {project.name}
                      </div>
                      <div className="text-xs text-slate-400 truncate">{project.client?.name}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={TYPE_COLORS[project.systemType]}>{project.systemType}</span>
                      <span className={STATUS_COLORS[project.status]}>{project.status}</span>
                    </div>
                    {project.layout && (
                      <div className="text-right flex-shrink-0 hidden sm:block">
                        <div className="text-sm font-semibold text-white">{project.layout.systemSizeKw.toFixed(1)} kW</div>
                        <div className="text-xs text-slate-500">{new Date(project.createdAt).toLocaleDateString()}</div>
                      </div>
                    )}
                    <ArrowRight size={13} className="text-slate-600 group-hover:text-amber-400 transition-colors flex-shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Top Clients */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm">Top Clients</h3>
              <Link href="/clients" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
                All <ChevronRight size={12} />
              </Link>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="shimmer h-12 rounded-lg" />)}
              </div>
            ) : clientProjectCounts.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                <Users size={32} className="mx-auto mb-2 opacity-30" />
                No clients with projects yet
              </div>
            ) : (
              <div className="space-y-3">
                {clientProjectCounts.map((client) => (
                  <Link key={client.id} href={`/clients/${client.id}`} className="flex items-center gap-3 group hover:bg-slate-700/30 rounded-lg p-2 -mx-2 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-xs flex-shrink-0">
                      {client.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate group-hover:text-amber-300 transition-colors">{client.name}</div>
                      <div className="text-xs text-slate-500">{client.projectCount} project{client.projectCount !== 1 ? 's' : ''}</div>
                    </div>
                    <div className="text-xs font-semibold text-amber-400">{client.totalKw.toFixed(1)} kW</div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Environmental Impact */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Leaf size={16} className="text-emerald-400" />
            <h3 className="font-semibold text-white text-sm">Environmental Impact — All Designed Systems</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Annual Production', value: totalAnnualKwh >= 1000 ? `${(totalAnnualKwh/1000).toFixed(1)} MWh` : `${Math.round(totalAnnualKwh)} kWh`, sub: 'Per year', color: 'text-amber-400' },
              { label: 'CO₂ Offset', value: `${co2Tons} tons`, sub: 'Per year', color: 'text-emerald-400' },
              { label: 'Trees Equivalent', value: treesEq.toLocaleString(), sub: 'Trees planted', color: 'text-green-400' },
              { label: 'Homes Powered', value: homesPowered.toLocaleString(), sub: 'Average US homes', color: 'text-blue-400' },
            ].map((item) => (
              <div key={item.label} className="bg-slate-800/40 rounded-xl p-4 text-center border border-slate-700/30">
                <div className={`text-xl font-black ${item.color}`}>{item.value}</div>
                <div className="text-xs font-medium text-white mt-1">{item.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{item.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'New Client', href: '/clients/new', icon: <Users size={16} />, color: 'bg-blue-500/10 border-blue-500/20 hover:border-blue-500/40 text-blue-400' },
            { label: 'New Project', href: '/projects/new', icon: <FolderOpen size={16} />, color: 'bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40 text-amber-400' },
            { label: 'Design Studio', href: '/design', icon: <Activity size={16} />, color: 'bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400' },
            { label: 'View Proposals', href: '/proposals', icon: <FileText size={16} />, color: 'bg-purple-500/10 border-purple-500/20 hover:border-purple-500/40 text-purple-400' },
          ].map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className={`flex items-center gap-3 p-4 rounded-xl border transition-all hover:scale-[1.02] ${action.color}`}
            >
              {action.icon}
              <span className="text-sm font-medium text-white">{action.label}</span>
              <ArrowRight size={13} className="ml-auto opacity-50" />
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}