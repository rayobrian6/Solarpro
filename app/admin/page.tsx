'use client';
import { useEffect, useState } from 'react';
import {
  Users, FolderOpen, FileText, Cpu, HardDrive,
  TrendingUp, AlertCircle, CheckCircle, Clock,
  Zap, Database, RefreshCw,
} from 'lucide-react';

function StatCard({
  label, value, sub, icon: Icon, color = 'amber',
}: {
  label: string; value: string | number; sub?: string;
  icon: any; color?: string;
}) {
  const colors: Record<string, string> = {
    amber:  'bg-amber-500/10  text-amber-400  border-amber-500/20',
    blue:   'bg-blue-500/10   text-blue-400   border-blue-500/20',
    green:  'bg-green-500/10  text-green-400  border-green-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    red:    'bg-red-500/10    text-red-400    border-red-500/20',
    slate:  'bg-slate-500/10  text-slate-400  border-slate-500/20',
  };
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="text-xs font-medium opacity-70 uppercase tracking-wider">{label}</div>
        <Icon size={16} className="opacity-60" />
      </div>
      <div className="text-3xl font-black">{value?.toLocaleString?.() ?? value}</div>
      {sub && <div className="text-xs mt-1 opacity-60">{sub}</div>}
    </div>
  );
}

function MiniBar({ data, color = '#f59e0b' }: { data: { day: string; cnt: number }[]; color?: string }) {
  if (!data?.length) return <div className="text-xs text-slate-500 py-4 text-center">No data</div>;
  const max = Math.max(...data.map(d => d.cnt), 1);
  return (
    <div className="flex items-end gap-0.5 h-16">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
          <div
            className="w-full rounded-sm transition-all"
            style={{ height: `${Math.max(4, (d.cnt / max) * 56)}px`, background: color, opacity: 0.7 }}
          />
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black text-white text-[9px] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
            {d.day?.slice(5)}: {d.cnt}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/stats');
      const d = await res.json();
      if (d.success) setStats(d.data);
      else setError(d.error);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex items-center gap-3 text-slate-400">
        <RefreshCw size={18} className="animate-spin" />
        <span>Loading dashboard...</span>
      </div>
    </div>
  );

  if (error) return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-red-400">
      <AlertCircle size={18} className="inline mr-2" />
      {error}
    </div>
  );

  const u = stats?.users || {};
  const p = stats?.projects || {};
  const pr = stats?.proposals || {};
  const l = stats?.layouts || {};
  const f = stats?.files || {};

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">System Overview</h1>
          <p className="text-sm text-slate-400 mt-1">Real-time platform health and activity</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all hover:border-white/20">
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Users"       value={u.total ?? 0}    sub={`${u.today ?? 0} joined today`}     icon={Users}     color="amber" />
        <StatCard label="Active Installers" value={u.active ?? 0}   sub={`${u.paid ?? 0} paid · ${u.trialing ?? 0} trialing`} icon={CheckCircle} color="green" />
        <StatCard label="Total Projects"    value={p.total ?? 0}    sub={`${p.today ?? 0} created today`}    icon={FolderOpen} color="blue" />
        <StatCard label="Proposals"         value={pr.total ?? 0}   sub={`${pr.today ?? 0} today`}           icon={FileText}  color="purple" />
        <StatCard label="Engineering Runs"  value={l.total ?? 0}    sub={`${l.today ?? 0} today`}            icon={Cpu}       color="amber" />
        <StatCard label="Files Stored"      value={f.total_files ?? 0} sub={`${((f.total_bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`} icon={HardDrive} color="slate" />
        <StatCard label="Free Pass Users"   value={u.free_pass ?? 0} sub="Lifetime access"                  icon={Zap}       color="green" />
        <StatCard label="Admin Users"       value={u.admins ?? 0}   sub="admin + super_admin"               icon={Database}  color="red" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-white/5 bg-white/2 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-white">Projects Created</div>
              <div className="text-xs text-slate-500">Last 30 days</div>
            </div>
            <TrendingUp size={14} className="text-amber-400" />
          </div>
          <MiniBar data={stats?.trends?.projects || []} color="#f59e0b" />
        </div>

        <div className="rounded-xl border border-white/5 bg-white/2 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-white">Proposals Generated</div>
              <div className="text-xs text-slate-500">Last 30 days</div>
            </div>
            <FileText size={14} className="text-purple-400" />
          </div>
          <MiniBar data={stats?.trends?.proposals || []} color="#a855f7" />
        </div>
      </div>

      {/* Plan Breakdown */}
      <div className="rounded-xl border border-white/5 bg-white/2 p-6">
        <div className="text-sm font-semibold text-white mb-4">Plan Distribution</div>
        <div className="flex flex-wrap gap-3">
          {(stats?.planBreakdown || []).map((p: any) => (
            <div key={p.plan} className="flex items-center gap-2 bg-white/5 rounded-lg px-4 py-2">
              <div className="text-sm font-bold text-white">{p.cnt}</div>
              <div className="text-xs text-slate-400 capitalize">{p.plan || 'unknown'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { href: '/admin/users',       label: 'Manage Users',     icon: Users,     color: 'text-amber-400' },
          { href: '/admin/projects',    label: 'View Projects',    icon: FolderOpen, color: 'text-blue-400' },
          { href: '/admin/database',    label: 'Run Migrations',   icon: Database,  color: 'text-green-400' },
          { href: '/admin/health',      label: 'System Health',    icon: CheckCircle, color: 'text-purple-400' },
        ].map(({ href, label, icon: Icon, color }) => (
          <a key={href} href={href} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/2 hover:bg-white/5 p-4 transition-all group">
            <Icon size={16} className={`${color} group-hover:scale-110 transition-transform`} />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}