'use client';
import { useEffect, useState } from 'react';
import {
  Database, RefreshCw, Zap, Search, Trash2, Activity,
  CheckCircle, AlertCircle, Play, ChevronRight, Server,
  Clock, Users, FolderOpen, FileText, Shield, Power, ToggleLeft,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

type ToolResult = { tool: string; result: any; ok: boolean; ts: string } | null;

const TOOLS = [
  {
    id: 'platform_health',
    label: 'Platform Health Check',
    description: 'Check database connectivity, latency, and user statistics',
    icon: Activity,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    dangerous: false,
  },
  {
    id: 'db_stats',
    label: 'Database Statistics',
    description: 'Count users, projects, proposals, and clients in the database',
    icon: Database,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    dangerous: false,
  },
  {
    id: 'list_migrations',
    label: 'List Migrations',
    description: 'Show all available SQL migration files',
    icon: FileText,
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/20',
    dangerous: false,
  },
  {
    id: 'rebuild_search_index',
    label: 'Rebuild Search Index',
    description: 'Run ANALYZE on main tables to refresh query planner statistics',
    icon: Search,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
    dangerous: false,
  },
  {
    id: 'recalculate_trial_status',
    label: 'Recalculate Trial Status',
    description: 'Find expired trial accounts and mark them as cancelled',
    icon: Clock,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    dangerous: false,
  },
  {
    id: 'clear_expired_tokens',
    label: 'Clear Expired Tokens',
    description: 'Remove used and expired impersonation tokens from the database',
    icon: Trash2,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    dangerous: false,
  },
  {
    id: 'clear_activity_log',
    label: 'Clear Old Activity Logs',
    description: 'Delete activity log entries older than 90 days',
    icon: Trash2,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    dangerous: true,
  },
  {
    id: 'seed_utility_policies',
    label: 'Seed Utility Database',
    description: 'Upsert ~120 major US utilities with real interconnection limits, buyback rates, and rate structures (NEM/TOU/Flat). Safe to re-run.',
    icon: Zap,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
    dangerous: false,
  },
];

export default function SystemToolsPage() {
  const [running, setRunning]         = useState<string | null>(null);
  const toast = useToast();
  const [lastResult, setLastResult]   = useState<ToolResult>(null);
  const [migrations, setMigrations]   = useState<string[]>([]);
  const [selectedMig, setSelectedMig] = useState('');
  const [confirmTool, setConfirmTool] = useState<string | null>(null);

  // ── Feature Flags (runtime toggles) ──────────────────────────────────────
  const [flags, setFlags]                     = useState<Array<{ flagKey: string; description: string; enabled: boolean; updatedAt: string; updatedByUserId: string | null }>>([]);
  const [flagsLoading, setFlagsLoading]       = useState(true);
  const [flagsError, setFlagsError]           = useState<string | null>(null);
  const [pendingFlag, setPendingFlag]         = useState<string | null>(null);

  const loadFlags = async () => {
    setFlagsLoading(true);
    setFlagsError(null);
    try {
      const res = await fetch('/api/admin/feature-flags', { method: 'GET', credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setFlags(data.flags ?? []);
      } else {
        setFlagsError(data.error ?? 'Failed to load feature flags');
      }
    } catch (e) {
      setFlagsError((e as Error).message ?? 'Network error');
    } finally {
      setFlagsLoading(false);
    }
  };

  const toggleFlag = async (flagKey: string, currentEnabled: boolean) => {
    setPendingFlag(flagKey);
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key: flagKey, enabled: !currentEnabled }),
      });
      const data = await res.json();
      if (data.success) {
        setFlags(prev => prev.map(f => f.flagKey === flagKey ? { ...f, enabled: data.flag.enabled, updatedAt: data.flag.updatedAt } : f));
        toast.success(`'${flagKey}' set to ${!currentEnabled ? 'ON' : 'OFF'}`);
      } else {
        toast.error(data.error ?? 'Failed to toggle flag');
      }
    } catch (e) {
      toast.error((e as Error).message ?? 'Network error');
    } finally {
      setPendingFlag(null);
    }
  };

  useEffect(() => { loadFlags(); }, []);

  

  const runTool = async (toolId: string, params: any = {}) => {
    setRunning(toolId);
    setConfirmTool(null);
    try {
      const res = await fetch('/api/admin/system-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolId, params }),
      });
      const d = await res.json();
      if (d.success) {
        toast.success(`${d.message || toolId + ' completed'}`);
        setLastResult({ tool: toolId, result: d, ok: true, ts: new Date().toLocaleTimeString() });
        if (toolId === 'list_migrations' && d.migrations) {
          setMigrations(d.migrations);
        }
      } else {
        toast.error(d.error || 'Tool failed');
        setLastResult({ tool: toolId, result: d, ok: false, ts: new Date().toLocaleTimeString() });
      }
    } catch (e: unknown) {
      toast.error((e as Error).message || 'Network error');
    } finally {
      setRunning(null);
    }
  };

  const handleRun = (toolId: string, dangerous: boolean) => {
    if (dangerous) {
      setConfirmTool(toolId);
    } else {
      runTool(toolId);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-white">System Tools</h1>
        <p className="text-sm text-slate-400 mt-1">Platform maintenance and operational controls — super_admin only</p>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
        <Shield size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-300">
          These tools perform direct database operations. All actions are logged to the admin activity log.
          Use with caution in production.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {TOOLS.map(tool => {
          const Icon = tool.icon;
          const isRunning = running === tool.id;
          return (
            <div
              key={tool.id}
              className={`rounded-xl border ${tool.border} ${tool.bg} p-5 flex items-start gap-4`}
            >
              <div className={`w-10 h-10 rounded-xl bg-black/20 flex items-center justify-center flex-shrink-0`}>
                <Icon size={18} className={tool.color} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-white text-sm">{tool.label}</span>
                  {tool.dangerous ? (
                    <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider">Destructive</span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-400 mb-3">{tool.description}</p>
                <button
                  onClick={() => handleRun(tool.id, tool.dangerous)}
                  disabled={!!running}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${
                    tool.dangerous
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-white/10 text-white hover:bg-white/15'
                  }`}
                >
                  {isRunning ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} />}
                  {isRunning ? 'Running...' : 'Run'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature Flags (runtime toggles) */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Power size={18} className="text-amber-400" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-white text-sm">Feature Flags</div>
            <div className="text-xs text-amber-200/80">Runtime toggles — DB row overrides the deploy-time env var. Every flip is audit-logged.</div>
          </div>
          <button
            onClick={loadFlags}
            disabled={flagsLoading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={flagsLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {flagsError ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold mb-0.5">Could not load feature flags</div>
              <div className="opacity-80">{flagsError}</div>
              {flagsError.includes('migration 121') ? (
                <div className="mt-1 opacity-90">Run <code className="font-mono text-[10px] bg-black/30 px-1 py-0.5 rounded">121_app_feature_flags.sql</code> via the Migration Operator Console, then refresh.</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {flagsLoading && flags.length === 0 ? (
          <div className="text-xs text-slate-400 py-2">Loading…</div>
        ) : null}

        {!flagsLoading && !flagsError && flags.length === 0 ? (
          <div className="text-xs text-slate-400 py-2">No feature flags have been overridden. Default behavior is in effect (env-var → off).</div>
        ) : null}

        <div className="space-y-2">
          {flags.map(flag => {
            const isPending = pendingFlag === flag.flagKey;
            return (
              <div
                key={flag.flagKey}
                className="flex items-center gap-4 rounded-lg border border-white/10 bg-black/20 p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <code className="font-mono text-xs text-white">{flag.flagKey}</code>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                      flag.enabled ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'
                    }`}>
                      {flag.enabled ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  {flag.description ? <div className="text-[11px] text-slate-400">{flag.description}</div> : null}
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Last updated: {new Date(flag.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={() => toggleFlag(flag.flagKey, flag.enabled)}
                  disabled={isPending}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                    flag.enabled ? 'bg-green-500/80' : 'bg-slate-600/80'
                  } ${isPending ? 'opacity-50' : 'hover:opacity-90'}`}
                  title={`Toggle ${flag.flagKey}`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      flag.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Canonical migration console pointer — the legacy runner below is
          permanently locked (MIGRATION-GOV-13). All migration execution now
          happens in the governed operator console. */}
      <a href="/admin/system-tools/migrations"
         className="block rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 hover:bg-emerald-500/15 transition-colors">
        <div className="flex items-center gap-3">
          <Shield size={18} className="text-emerald-400" />
          <div>
            <div className="font-semibold text-white text-sm">Migration Operator Console →</div>
            <div className="text-xs text-emerald-200/80">Run migrations through the governed workflow (bootstrap, baseline, bounded activation, reviewed execution). The legacy runner below is permanently locked.</div>
          </div>
        </div>
      </a>

      {/* Run Migration Section (LEGACY — permanently 423-locked) */}
      <div className="rounded-xl border border-white/10 bg-white/2 p-5 space-y-4 opacity-70">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <Database size={18} className="text-blue-400" />
          </div>
          <div>
            <div className="font-semibold text-white text-sm">Run Database Migration <span className="text-[10px] text-red-300 border border-red-500/40 rounded px-1 py-0.5 ml-1">LEGACY · LOCKED</span></div>
            <div className="text-xs text-slate-400">Permanently disabled (MIGRATION-GOV-13). Use the Migration Operator Console above.</div>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            {migrations.length > 0 ? (
              <select
                value={selectedMig}
                onChange={e => setSelectedMig(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                style={{ backgroundColor: '#1e293b', color: '#f1f5f9' }}
              >
                <option value="" style={{ backgroundColor: '#1e293b', color: '#94a3b8' }}>Select migration file...</option>
                {migrations.map(m => (
                  <option key={m} value={m} style={{ backgroundColor: '#1e293b', color: '#f1f5f9' }}>{m}</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => runTool('list_migrations')}
                disabled={!!running}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/8 transition-colors text-left disabled:opacity-50"
              >
                Click to load migration files...
              </button>
            )}
          </div>
          <button
            onClick={() => selectedMig && setConfirmTool('run_migration_' + selectedMig)}
            disabled={!selectedMig || !!running}
            className="px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {running?.startsWith('run_migration') ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
            Execute
          </button>
        </div>
      </div>

      {/* Last Result */}
      {lastResult ? (
        <div className={`rounded-xl border p-4 ${lastResult.ok ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
          <div className="flex items-center gap-2 mb-3">
            {lastResult.ok ? <CheckCircle size={14} className="text-green-400" /> : <AlertCircle size={14} className="text-red-400" />}
            <span className="text-xs font-semibold text-white">{lastResult.tool} — {lastResult.ts}</span>
          </div>
          <pre className="text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap font-mono bg-black/20 rounded-lg p-3">
            {JSON.stringify(lastResult.result, null, 2)}
          </pre>
        </div>
      ) : null}

      {/* Confirm Modal */}
      {confirmTool ? (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0d1424] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle size={18} className="text-red-400" />
              </div>
              <h2 className="text-base font-bold text-white">Confirm Tool Execution</h2>
            </div>
            <p className="text-sm text-slate-300">
              {confirmTool.startsWith('run_migration_')
                ? `Execute migration: ${confirmTool.replace('run_migration_', '')}? This will modify the production database.`
                : `Run "${TOOLS.find(t => t.id === confirmTool)?.label}"? This action cannot be undone.`
              }
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmTool(null)} className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button
                onClick={() => {
                  if (confirmTool.startsWith('run_migration_')) {
                    runTool('run_migration', { file: confirmTool.replace('run_migration_', '') });
                  } else {
                    runTool(confirmTool);
                  }
                }}
                className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-400 transition-colors"
              >
                Execute
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}