'use client';
import { useEffect, useState } from 'react';
import {
  Database, RefreshCw, Zap, Search, Trash2, Activity,
  CheckCircle, AlertCircle, Play, ChevronRight, Server,
  Clock, Users, FolderOpen, FileText, Shield,
} from 'lucide-react';

type ToastState = { msg: string; ok: boolean } | null;
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
];

export default function SystemToolsPage() {
  const [running, setRunning]         = useState<string | null>(null);
  const [toast, setToast]             = useState<ToastState>(null);
  const [lastResult, setLastResult]   = useState<ToolResult>(null);
  const [migrations, setMigrations]   = useState<string[]>([]);
  const [selectedMig, setSelectedMig] = useState('');
  const [confirmTool, setConfirmTool] = useState<string | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  };

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
        showToast(`✓ ${d.message || toolId + ' completed'}`);
        setLastResult({ tool: toolId, result: d, ok: true, ts: new Date().toLocaleTimeString() });
        if (toolId === 'list_migrations' && d.migrations) {
          setMigrations(d.migrations);
        }
      } else {
        showToast(d.error || 'Tool failed', false);
        setLastResult({ tool: toolId, result: d, ok: false, ts: new Date().toLocaleTimeString() });
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', false);
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
                  {tool.dangerous && (
                    <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider">Destructive</span>
                  )}
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

      {/* Run Migration Section */}
      <div className="rounded-xl border border-white/10 bg-white/2 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <Database size={18} className="text-blue-400" />
          </div>
          <div>
            <div className="font-semibold text-white text-sm">Run Database Migration</div>
            <div className="text-xs text-slate-400">Execute a SQL migration file against the production database</div>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            {migrations.length > 0 ? (
              <select
                value={selectedMig}
                onChange={e => setSelectedMig(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
              >
                <option value="">Select migration file...</option>
                {migrations.map(m => (
                  <option key={m} value={m}>{m}</option>
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
      {lastResult && (
        <div className={`rounded-xl border p-4 ${lastResult.ok ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
          <div className="flex items-center gap-2 mb-3">
            {lastResult.ok ? <CheckCircle size={14} className="text-green-400" /> : <AlertCircle size={14} className="text-red-400" />}
            <span className="text-xs font-semibold text-white">{lastResult.tool} — {lastResult.ts}</span>
          </div>
          <pre className="text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap font-mono bg-black/20 rounded-lg p-3">
            {JSON.stringify(lastResult.result, null, 2)}
          </pre>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmTool && (
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
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-xl ${
          toast.ok ? 'bg-green-500/20 border border-green-500/30 text-green-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'
        }`}>
          {toast.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}