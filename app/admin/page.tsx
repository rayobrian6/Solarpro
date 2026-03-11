'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users, FolderOpen, FileText, Cpu, HardDrive,
  TrendingUp, AlertCircle, CheckCircle, Clock,
  Zap, Database, RefreshCw, Shield,
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
      <div className="text-3xl font-black">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="text-xs mt-1 opacity-60">{sub}</div>}
    </div>
  );
}

function MiniBar({ data, color = '#f59e0b' }: { data: { day: string; count: number }[]; color?: string }) {
  if (!data?.length) return <div className="text-xs text-slate-500 py-4 text-center">No data</div>;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-0.5 h-16">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
          <div
            className="w-full rounded-sm transition-all"
            style={{ height: `${Math.max(4, (d.count / max) * 56)}px`, background: color, opacity: 0.7 }}
          />
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black text-white text-[9px] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
            {String(d.day)?.slice(5)}: {d.count}
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
    setError(null);
    try {
      const res = await fetch('/api/admin/stats');
      const d = await res.json();
      if (d.success) setStats(d.stats);  // API returns d.stats
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

  const u  = stats?.users     || {};
  const p  = stats?.projects  || {};
  const pr = stats?.proposals || {};
  const l  = stats?.layouts   || {};
  const f  = stats?.files     || {};

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">System Overview</h1>
          <p className="text-sm text-slate-400 mt-1">Real-time platform health and activity</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="flex items-center gap-2 text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-lg px-3 py-2 transition-all hover:bg-amber-500/25"
          >
            <Shield size={12} />
            Admin Portal
          </Link>
          <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all hover:border-white/20">
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Users"       value={u.total ?? 0}    sub={`${u.last30 ?? 0} in last 30 days`}   icon={Users}       color="amber" />
        <StatCard label="Total Projects"    value={p.total ?? 0}    sub={`${p.last30 ?? 0} in last 30 days`}   icon={FolderOpen}  color="blue" />
        <StatCard label="Proposals"         value={pr.total ?? 0}   sub={`${pr.last30 ?? 0} in last 30 days`}  icon={FileText}    color="purple" />
        <StatCard label="Engineering Runs"  value={l.total ?? 0}    sub="Total layouts generated"              icon={Cpu}         color="amber" />
        <StatCard label="Files Stored"      value={f.total ?? 0}    sub={`${((f.totalBytes ?? 0) / 1024 / 1024).toFixed(1)} MB`} icon={HardDrive} color="slate" />
        <StatCard label="Plans (last 30d)"  value={pr.last30 ?? 0}  sub="Proposals generated"                  icon={TrendingUp}  color="green" />
        <StatCard label="Layouts Total"     value={l.total ?? 0}    sub="All time"                             icon={CheckCircle} color="green" />
        <StatCard label="Storage Used"      value={`${((f.totalBytes ?? 0) / 1024 / 1024).toFixed(1)} MB`} sub={`${f.total ?? 0} files`} icon={Database} color="red" />
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
          <MiniBar data={stats?.projectTrend || []} color="#f59e0b" />
        </div>

        <div className="rounded-xl border border-white/5 bg-white/2 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-white">New Users</div>
              <div className="text-xs text-slate-500">Last 30 days</div>
            </div>
            <Users size={14} className="text-blue-400" />
          </div>
          <MiniBar data={stats?.userTrend || []} color="#3b82f6" />
        </div>
      </div>

      {/* Plan Breakdown */}
      <div className="rounded-xl border border-white/5 bg-white/2 p-6">
        <div className="text-sm font-semibold text-white mb-4">Plan Distribution</div>
        <div className="flex flex-wrap gap-3">
          {(stats?.plans || []).map((p: any) => (
            <div key={p.plan} className="flex items-center gap-2 bg-white/5 rounded-lg px-4 py-2">
              <div className="text-sm font-bold text-white">{p.count}</div>
              <div className="text-xs text-slate-400 capitalize">{p.plan || 'unknown'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { href: '/admin/users',    label: 'Manage Users',   icon: Users,       color: 'text-amber-400' },
          { href: '/admin/projects', label: 'View Projects',  icon: FolderOpen,  color: 'text-blue-400' },
          { href: '/admin/database', label: 'Run Migrations', icon: Database,    color: 'text-green-400' },
          { href: '/admin/health',   label: 'System Health',  icon: CheckCircle, color: 'text-purple-400' },
        ].map(({ href, label, icon: Icon, color }) => (
          <Link key={href} href={href} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/2 hover:bg-white/5 p-4 transition-all group">
            <Icon size={16} className={`${color} group-hover:scale-110 transition-transform`} />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}