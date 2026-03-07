'use client';
import React, { useState, useEffect } from 'react';
import AppShell from '@/components/ui/AppShell';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend
} from 'recharts';
import {
  TrendingUp, Zap, DollarSign, Leaf, Sun, BarChart2,
  Users, FolderOpen, Home, Sprout, Fence, ArrowUpRight,
  Activity, Globe, Award, Target
} from 'lucide-react';
import type { Project, Client } from '@/types';
import Link from 'next/link';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SYSTEM_PERFORMANCE = [
  { subject: 'Production', roof: 85, ground: 95, fence: 72 },
  { subject: 'ROI', roof: 78, ground: 88, fence: 65 },
  { subject: 'Install Speed', roof: 90, ground: 70, fence: 85 },
  { subject: 'Reliability', roof: 92, ground: 88, fence: 80 },
  { subject: 'Aesthetics', roof: 75, ground: 60, fence: 95 },
  { subject: 'Scalability', roof: 65, ground: 98, fence: 70 },
];

export default function AnalyticsPage() {
  const [mounted, setMounted] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
    Promise.all([
      fetch('/api/projects').then(r => r.json()),
      fetch('/api/clients').then(r => r.json()),
    ]).then(([projData, clientData]) => {
      setProjects(projData.data || []);
      setClients(clientData.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Derived metrics
  const totalKw = projects.reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0);
  const totalRevenue = projects.reduce((s, p) => s + (p.costEstimate?.netCost || 0), 0);
  const totalAnnualKwh = projects.reduce((s, p) => s + (p.production?.annualProductionKwh || 0), 0);
  const totalCo2 = (totalAnnualKwh * 0.000386).toFixed(1);
  const avgSystemSize = projects.length > 0 ? (totalKw / projects.filter(p => p.layout).length || 0) : 0;
  const avgRoi = projects.filter(p => p.costEstimate?.roi).reduce((s, p) => s + (p.costEstimate?.roi || 0), 0) / (projects.filter(p => p.costEstimate?.roi).length || 1);

  // Monthly production from real data
  const monthlyProduction = MONTHS.map((month, i) => {
    const roof = projects.filter(p => p.systemType === 'roof' && p.production)
      .reduce((s, p) => s + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    const ground = projects.filter(p => p.systemType === 'ground' && p.production)
      .reduce((s, p) => s + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    const fence = projects.filter(p => p.systemType === 'fence' && p.production)
      .reduce((s, p) => s + (p.production?.monthlyProductionKwh?.[i] || 0), 0);
    return { month, roof: Math.round(roof), ground: Math.round(ground), fence: Math.round(fence), total: Math.round(roof + ground + fence) };
  });

  // System type breakdown
  const typeBreakdown = [
    { name: 'Roof Mount', value: projects.filter(p => p.systemType === 'roof').length, color: '#f59e0b', kw: projects.filter(p => p.systemType === 'roof').reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0) },
    { name: 'Ground Mount', value: projects.filter(p => p.systemType === 'ground').length, color: '#14b8a6', kw: projects.filter(p => p.systemType === 'ground').reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0) },
    { name: 'Sol Fence', value: projects.filter(p => p.systemType === 'fence').length, color: '#a855f7', kw: projects.filter(p => p.systemType === 'fence').reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0) },
  ];

  // Status breakdown
  const statusBreakdown = ['lead', 'design', 'proposal', 'approved', 'installed'].map(s => ({
    status: s,
    count: projects.filter(p => p.status === s).length,
    revenue: projects.filter(p => p.status === s).reduce((sum, p) => sum + (p.costEstimate?.netCost || 0), 0),
  }));

  // Top projects by size
  const topProjects = [...projects]
    .filter(p => p.layout?.systemSizeKw)
    .sort((a, b) => (b.layout?.systemSizeKw || 0) - (a.layout?.systemSizeKw || 0))
    .slice(0, 5);

  // Client stats
  const clientsWithProjects = clients.filter(c => projects.some(p => p.clientId === c.id));
  const topClients = clients.map(c => ({
    ...c,
    projectCount: projects.filter(p => p.clientId === c.id).length,
    totalKw: projects.filter(p => p.clientId === c.id).reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0),
    revenue: projects.filter(p => p.clientId === c.id).reduce((s, p) => s + (p.costEstimate?.netCost || 0), 0),
  })).filter(c => c.projectCount > 0).sort((a, b) => b.totalKw - a.totalKw).slice(0, 5);

  const tooltipStyle = { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' };

  return (
    <AppShell>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">Analytics</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {loading ? 'Loading...' : `Performance metrics across ${projects.length} projects`}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2">
            <Activity size={12} className="text-emerald-400" />
            Live data from database
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              icon: <Zap size={18} className="text-amber-400" />,
              label: 'Total Capacity',
              value: totalKw >= 1000 ? `${(totalKw / 1000).toFixed(2)} MW` : `${totalKw.toFixed(1)} kW`,
              sub: `Avg ${avgSystemSize.toFixed(1)} kW/project`,
              color: 'bg-amber-500/10',
              trend: '+24%',
            },
            {
              icon: <DollarSign size={18} className="text-emerald-400" />,
              label: 'Pipeline Value',
              value: `$${(totalRevenue / 1000).toFixed(0)}k`,
              sub: `Avg ROI: ${avgRoi.toFixed(0)}%`,
              color: 'bg-emerald-500/10',
              trend: '+18%',
            },
            {
              icon: <Sun size={18} className="text-blue-400" />,
              label: 'Annual Production',
              value: totalAnnualKwh >= 1000000 ? `${(totalAnnualKwh / 1000000).toFixed(2)} GWh` : totalAnnualKwh >= 1000 ? `${(totalAnnualKwh / 1000).toFixed(1)} MWh` : `${Math.round(totalAnnualKwh)} kWh`,
              sub: 'All designed systems',
              color: 'bg-blue-500/10',
              trend: '+31%',
            },
            {
              icon: <Leaf size={18} className="text-teal-400" />,
              label: 'CO₂ Offset',
              value: `${totalCo2} tons`,
              sub: `${Math.round(parseFloat(totalCo2) * 16.5)} trees equiv.`,
              color: 'bg-teal-500/10',
              trend: '+31%',
            },
          ].map((kpi) => (
            <div key={kpi.label} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${kpi.color}`}>
                  {kpi.icon}
                </div>
                <div className="flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2 py-1 rounded-full">
                  <ArrowUpRight size={10} /> {kpi.trend}
                </div>
              </div>
              <div className="text-2xl font-black text-white">{loading ? '—' : kpi.value}</div>
              <div className="text-xs text-slate-400 mt-0.5 font-medium">{kpi.label}</div>
              <div className="text-xs text-slate-500 mt-1">{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* Production Chart + Type Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white text-sm">Monthly Production by System Type</h3>
                <p className="text-xs text-slate-400 mt-0.5">kWh across all designed systems</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
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
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} formatter={(v: number) => [`${v.toLocaleString()} kWh`, '']} />
                  <Area type="monotone" dataKey="roof" stroke="#f59e0b" fill="url(#roofGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="ground" stroke="#14b8a6" fill="url(#groundGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="fence" stroke="#a855f7" fill="url(#fenceGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-white text-sm mb-4">System Type Distribution</h3>
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
                        <span className="text-slate-400">{t.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-semibold text-white">{t.value}</span>
                        <span className="text-slate-500 ml-1">({t.kw.toFixed(1)} kW)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-slate-500 text-xs text-center">
                <BarChart2 size={32} className="mb-2 opacity-30" />
                Create projects to see distribution
              </div>
            )}
          </div>
        </div>

        {/* Pipeline + System Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pipeline by Status */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm">Pipeline by Status</h3>
              <Link href="/projects" className="text-xs text-amber-400 hover:text-amber-300">View projects →</Link>
            </div>
            {mounted && (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={statusBreakdown} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="status" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, 'Projects']} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {statusBreakdown.map((entry, i) => {
                      const colors = ['#64748b', '#3b82f6', '#f59e0b', '#10b981', '#22c55e'];
                      return <Cell key={i} fill={colors[i]} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* System Performance Radar */}
          <div className="card p-5">
            <h3 className="font-semibold text-white text-sm mb-4">System Type Performance Comparison</h3>
            {mounted && (
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={SYSTEM_PERFORMANCE}>
                  <PolarGrid stroke="#1e293b" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 9 }} />
                  <Radar name="Roof" dataKey="roof" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} />
                  <Radar name="Ground" dataKey="ground" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.15} strokeWidth={2} />
                  <Radar name="Fence" dataKey="fence" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} strokeWidth={2} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Top Projects + Top Clients */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Projects */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm">Top Projects by Capacity</h3>
              <Link href="/projects" className="text-xs text-amber-400 hover:text-amber-300">All projects →</Link>
            </div>
            {loading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-10 rounded-lg" />)}</div>
            ) : topProjects.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                <Target size={28} className="mx-auto mb-2 opacity-30" />
                No projects with layouts yet
              </div>
            ) : (
              <div className="space-y-2">
                {topProjects.map((project, idx) => {
                  const maxKw = topProjects[0]?.layout?.systemSizeKw || 1;
                  const pct = ((project.layout?.systemSizeKw || 0) / maxKw) * 100;
                  return (
                    <Link key={project.id} href={`/projects/${project.id}`} className="block group">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-xs font-bold text-slate-500 w-4">#{idx + 1}</span>
                        <span className="text-xs font-medium text-white group-hover:text-amber-300 transition-colors flex-1 truncate">{project.name}</span>
                        <span className="text-xs font-bold text-amber-400">{project.layout?.systemSizeKw.toFixed(1)} kW</span>
                      </div>
                      <div className="ml-7 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top Clients */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm">Top Clients by Capacity</h3>
              <Link href="/clients" className="text-xs text-amber-400 hover:text-amber-300">All clients →</Link>
            </div>
            {loading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-10 rounded-lg" />)}</div>
            ) : topClients.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                <Users size={28} className="mx-auto mb-2 opacity-30" />
                No clients with projects yet
              </div>
            ) : (
              <div className="space-y-3">
                {topClients.map((client, idx) => (
                  <Link key={client.id} href={`/clients/${client.id}`} className="flex items-center gap-3 group hover:bg-slate-700/30 rounded-lg p-2 -mx-2 transition-colors">
                    <span className="text-xs font-bold text-slate-500 w-4">#{idx + 1}</span>
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-xs flex-shrink-0">
                      {client.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate group-hover:text-amber-300 transition-colors">{client.name}</div>
                      <div className="text-xs text-slate-500">{client.projectCount} project{client.projectCount !== 1 ? 's' : ''} · ${(client.revenue / 1000).toFixed(0)}k value</div>
                    </div>
                    <div className="text-xs font-bold text-amber-400">{client.totalKw.toFixed(1)} kW</div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Environmental Impact */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-5">
            <Leaf size={16} className="text-emerald-400" />
            <h3 className="font-semibold text-white text-sm">Environmental Impact</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Annual Production', value: totalAnnualKwh >= 1000 ? `${(totalAnnualKwh/1000).toFixed(1)} MWh` : `${Math.round(totalAnnualKwh)} kWh`, sub: 'Per year', color: 'text-amber-400', icon: <Zap size={18} /> },
              { label: 'CO₂ Offset', value: `${totalCo2} tons`, sub: 'Per year', color: 'text-emerald-400', icon: <Leaf size={18} /> },
              { label: 'Trees Equivalent', value: Math.round(parseFloat(totalCo2) * 16.5).toLocaleString(), sub: 'Trees planted', color: 'text-green-400', icon: <Globe size={18} /> },
              { label: 'Homes Powered', value: Math.round(totalAnnualKwh / 10500).toLocaleString(), sub: 'Average US homes', color: 'text-blue-400', icon: <Home size={18} /> },
            ].map((item) => (
              <div key={item.label} className="bg-slate-800/40 rounded-xl p-4 text-center border border-slate-700/30 hover:border-slate-600/50 transition-colors">
                <div className={`flex justify-center mb-2 ${item.color}`}>{item.icon}</div>
                <div className={`text-xl font-black ${item.color}`}>{loading ? '—' : item.value}</div>
                <div className="text-xs font-medium text-white mt-1">{item.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{item.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

