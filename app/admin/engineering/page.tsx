'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buildEngineeringIntelligenceWorkspace } from '@/lib/engineeringIntelligence';
import { Cpu, RefreshCw, LayoutGrid, FileCode, List, CheckCircle, AlertCircle, Network, GitBranch, History, Share2, ShieldCheck } from 'lucide-react';

export default function AdminEngineering() {
  const [stats, setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/stats');
      const d = await res.json();
      if (d.success) setStats(d.stats);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const l = stats?.layouts || {};
  const f = stats?.files   || {};
  const intelligence = buildEngineeringIntelligenceWorkspace();
  const health = intelligence.health;

  const intelligenceRoutes = [
    { href: '/admin/engineering-intelligence', label: 'Engineering Intelligence', icon: Network, description: 'System-level deterministic engineering-state workspace.' },
    { href: '/admin/engineering-intelligence', label: 'Project Intelligence Picker', icon: GitBranch, description: 'Select a real project UUID before opening project-scoped evidence, requirements, decisions, and stale-state view.' },
    { href: '/admin/engineering-intelligence/snapshots', label: 'Snapshot Timeline', icon: History, description: 'Persistent snapshots, hashes, diffs, and transition timeline.' },
    { href: '/admin/engineering-intelligence/graph', label: 'Dependency Graph', icon: Share2, description: 'Deterministic dependency graph across evidence, decisions, outputs, and plans.' },
  ];

  const intelligenceSummary = [
    { label: 'Stale outputs', value: health.staleOutputs, sub: 'snapshot-derived when loaded' },
    { label: 'Invalidation events', value: health.invalidatedOutputs, sub: 'transition history only' },
    { label: 'Snapshots', value: health.snapshotVersions, sub: 'durable versions loaded' },
    { label: 'Regeneration candidates', value: health.regenerationCandidates, sub: 'plan metadata only' },
    { label: 'Audit guard warnings', value: health.activeAuditGuardWarnings, sub: 'warnings/failures loaded' },
    { label: 'Graph health', value: `${health.dependencyGraphNodes}/${health.dependencyGraphEdges}`, sub: 'nodes / edges loaded' },
  ];

  const fileTypes = [
    { label: 'Engineering Reports', type: 'engineering',   icon: FileCode,    color: 'text-blue-400',   bg: 'bg-blue-500/10' },
    { label: 'Utility Bills',        type: 'utility_bill', icon: List,        color: 'text-amber-400',  bg: 'bg-amber-500/10' },
    { label: 'Site Photos',          type: 'site_photo',   icon: LayoutGrid,  color: 'text-green-400',  bg: 'bg-green-500/10' },
    { label: 'Permits',              type: 'permit',       icon: CheckCircle, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Engineering Monitor</h1>
          <p className="text-sm text-slate-400 mt-1">Legacy generation metrics plus deterministic Engineering Intelligence entry points</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-slate-950 via-slate-950 to-sky-950/30 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">
              <ShieldCheck size={12} /> Engineering Intelligence
            </div>
            <h2 className="text-xl font-black text-white">Deterministic engineering-state workspace</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Inspect canonical evidence lineage, requirement status, decision provenance, stale-state invalidation, snapshots, dependency graph metadata, regeneration planning, and audit guards. This launcher does not trigger generation, OCR, CV, CAD automation, or AI engineering decisions.
            </p>
          </div>
          <Link href="/admin/engineering-intelligence" className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm font-bold text-sky-200 transition hover:bg-sky-400/20">
            <Network size={16} /> Open Workspace
          </Link>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {intelligenceRoutes.map(route => (
            <Link key={route.href} href={route.href} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-sky-400/40 hover:bg-sky-400/10">
              <div className="flex items-center gap-2 text-sm font-bold text-white"><route.icon size={15} className="text-sky-300" />{route.label}</div>
              <p className="mt-2 text-xs leading-5 text-slate-400">{route.description}</p>
            </Link>
          ))}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {intelligenceSummary.map(item => (
            <div key={item.label} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{item.label}</div>
              <div className="mt-2 text-2xl font-black text-white">{item.value}</div>
              <div className="mt-1 text-[10px] text-slate-500">{item.sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-300">Requirement health: <span className="font-mono text-sky-300">{health.requirementSatisfaction}</span></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-300">Evidence completeness: <span className="font-mono text-sky-300">{health.evidenceCompleteness}</span></div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-500"><RefreshCw size={18} className="animate-spin inline mr-2" />Loading...</div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Layouts Generated', value: l.total ?? 0,       sub: `${l.total ?? 0} all time`,  color: 'border-blue-500/20   bg-blue-500/10   text-blue-400' },
              { label: 'Files Generated',   value: f.total ?? 0, sub: `${((f.totalBytes ?? 0)/1024/1024).toFixed(1)} MB`, color: 'border-amber-500/20  bg-amber-500/10  text-amber-400' },
              { label: 'Projects Total',    value: stats?.projects?.total ?? 0, sub: `${stats?.projects?.last30 ?? 0} last 30d`, color: 'border-green-500/20  bg-green-500/10  text-green-400' },
              { label: 'Proposals',         value: stats?.proposals?.total ?? 0, sub: `${stats?.proposals?.last30 ?? 0} last 30d`, color: 'border-purple-500/20 bg-purple-500/10 text-purple-400' },
            ].map(s => (
              <div key={s.label} className={`rounded-xl border p-5 ${s.color}`}>
                <div className="text-xs font-medium opacity-70 uppercase tracking-wider mb-2">{s.label}</div>
                <div className="text-3xl font-black">{s.value?.toLocaleString()}</div>
                <div className="text-xs mt-1 opacity-60">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* File type breakdown */}
          <div className="rounded-xl border border-white/5 bg-white/2 p-6">
            <div className="text-sm font-semibold text-white mb-4">File Type Breakdown</div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {fileTypes.map(ft => (
                <a key={ft.type} href={`/admin/files?type=${ft.type}`}
                  className={`rounded-xl border border-white/5 p-4 hover:bg-white/5 transition-colors flex items-center gap-3`}>
                  <div className={`w-9 h-9 rounded-lg ${ft.bg} flex items-center justify-center`}>
                    <ft.icon size={16} className={ft.color} />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-white">{ft.label}</div>
                    <div className="text-[10px] text-slate-500">View files →</div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* 30-day trend */}
          <div className="rounded-xl border border-white/5 bg-white/2 p-6">
            <div className="text-sm font-semibold text-white mb-2">Projects — 30 Day Trend</div>
            <div className="text-xs text-slate-500 mb-4">Each bar = 1 day of project creation activity</div>
            <div className="flex items-end gap-0.5 h-20">
              {(stats?.projectTrend || []).map((d: any, i: number) => {
                const max = Math.max(...(stats?.projectTrend || []).map((x: any) => x.count), 1);
                return (
                  <div key={i} className="flex-1 group relative">
                    <div className="w-full rounded-sm bg-blue-500/60 transition-all"
                      style={{ height: `${Math.max(4, (d.count / max) * 72)}px` }} />
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black text-white text-[9px] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                      {String(d.day)?.slice(5)}: {d.count}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Info box */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-amber-400 mb-1">Engineering Log Access</div>
                <div className="text-xs text-slate-400">
                  Detailed engineering run logs (SLD generation, BOM, compliance checks) are available in Vercel function logs.
                  Filter by <code className="bg-white/10 px-1 rounded">[Engineering]</code> or <code className="bg-white/10 px-1 rounded">[save-outputs]</code> to see per-project engineering activity.
                  Future versions will store structured logs in the database for in-portal review.
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}