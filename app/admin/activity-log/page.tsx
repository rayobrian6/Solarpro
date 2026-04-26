'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Activity, RefreshCw, Search, ChevronLeft, ChevronRight,
  Shield, Zap, Ban, Key, Eye, Trash2, Crown, UserCheck,
  AlertCircle, CheckCircle, Building2, RotateCcw, Database,
} from 'lucide-react';

const ACTION_ICONS: Record<string, any> = {
  grant_free_pass:          { icon: Zap,       color: 'text-amber-400',  bg: 'bg-amber-500/10' },
  revoke_free_pass:         { icon: Zap,       color: 'text-red-400',    bg: 'bg-red-500/10' },
  suspend_user:             { icon: Ban,       color: 'text-red-400',    bg: 'bg-red-500/10' },
  unsuspend_user:           { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10' },
  reset_trial:              { icon: RotateCcw, color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  reset_password:           { icon: Key,       color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  set_role:                 { icon: Crown,     color: 'text-amber-400',  bg: 'bg-amber-500/10' },
  set_plan:                 { icon: Shield,    color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  update_user:              { icon: UserCheck, color: 'text-slate-400',  bg: 'bg-slate-500/10' },
  delete_user:              { icon: Trash2,    color: 'text-red-400',    bg: 'bg-red-500/10' },
  impersonate_user:         { icon: Eye,       color: 'text-purple-400', bg: 'bg-purple-500/10' },
  company_grant_free_pass:  { icon: Building2, color: 'text-amber-400',  bg: 'bg-amber-500/10' },
  company_revoke_free_pass: { icon: Building2, color: 'text-red-400',    bg: 'bg-red-500/10' },
  company_change_plan:      { icon: Building2, color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  company_disabled:         { icon: Building2, color: 'text-red-400',    bg: 'bg-red-500/10' },
  company_enabled:          { icon: Building2, color: 'text-green-400',  bg: 'bg-green-500/10' },
  company_add_admin:        { icon: Building2, color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  company_transfer_ownership: { icon: Building2, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  run_migration:            { icon: Database,  color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  clear_expired_tokens:     { icon: Trash2,    color: 'text-orange-400', bg: 'bg-orange-500/10' },
  recalculate_trial_status: { icon: RotateCcw, color: 'text-amber-400',  bg: 'bg-amber-500/10' },
  rebuild_search_index:     { icon: Search,    color: 'text-purple-400', bg: 'bg-purple-500/10' },
  clear_old_activity_logs:  { icon: Trash2,    color: 'text-red-400',    bg: 'bg-red-500/10' },
};

const ACTION_LABELS: Record<string, string> = {
  grant_free_pass:          'Granted Free Pass',
  revoke_free_pass:         'Revoked Free Pass',
  suspend_user:             'Suspended User',
  unsuspend_user:           'Unsuspended User',
  reset_trial:              'Reset Trial',
  reset_password:           'Reset Password',
  set_role:                 'Changed Role',
  set_plan:                 'Changed Plan',
  update_user:              'Updated User',
  delete_user:              'Deleted User',
  impersonate_user:         'Impersonated User',
  company_grant_free_pass:  'Company: Granted Free Pass',
  company_revoke_free_pass: 'Company: Revoked Free Pass',
  company_change_plan:      'Company: Changed Plan',
  company_disabled:         'Company: Disabled',
  company_enabled:          'Company: Enabled',
  company_add_admin:        'Company: Added Admin',
  company_transfer_ownership: 'Company: Transferred Ownership',
  run_migration:            'Ran DB Migration',
  clear_expired_tokens:     'Cleared Expired Tokens',
  recalculate_trial_status: 'Recalculated Trial Status',
  rebuild_search_index:     'Rebuilt Search Index',
  clear_old_activity_logs:  'Cleared Old Activity Logs',
};

export default function ActivityLogPage() {
  const [logs, setLogs]         = useState<any[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/activity-log?page=${page}&limit=${LIMIT}&action=${encodeURIComponent(search)}`);
      const d = await res.json();
      if (d.success) {
        setLogs(d.logs || []);
        setTotal(d.total || 0);
        setMigrationRequired(!!d.migrationRequired);
      }
    } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.ceil(total / LIMIT);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getActionDisplay = (action: string) => {
    return ACTION_ICONS[action] || { icon: Activity, color: 'text-slate-400', bg: 'bg-slate-500/10' };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Activity Log</h1>
          <p className="text-sm text-slate-400 mt-1">
            {migrationRequired ? 'Migration required to enable logging' : `${total.toLocaleString()} logged actions`}
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Migration Required Banner */}
      {migrationRequired && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-4">
          <AlertCircle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-300">Migration Required</p>
            <p className="text-xs text-amber-400/80 mt-1">
              The <code className="bg-black/20 px-1 rounded">admin_activity_log</code> table doesn't exist yet.
              Go to <strong>System Tools</strong> → Run Migration → select <code className="bg-black/20 px-1 rounded">008_admin_activity_log.sql</code> to enable activity logging.
            </p>
          </div>
        </div>
      )}

      {/* Search / Filter */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Filter by action (e.g. grant_free_pass, impersonate_user)..."
          className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
        />
      </div>

      {/* Log Table */}
      <div className="rounded-xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/2">
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Action</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Admin</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Target</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Details</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-12 text-slate-500">
                  <RefreshCw size={16} className="animate-spin inline mr-2" />Loading...
                </td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-slate-500">
                  {migrationRequired ? 'Run migration to enable activity logging' : 'No activity logs found'}
                </td></tr>
              ) : logs.map((log: any) => {
                const { icon: Icon, color, bg } = getActionDisplay(log.action);
                const label = ACTION_LABELS[log.action] || log.action.replace(/_/g, ' ');
                const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata || '{}') : (log.metadata || {});
                return (
                  <tr key={log.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
                          <Icon size={12} className={color} />
                        </div>
                        <span className="text-xs font-medium text-white">{label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-white">{log.admin_name || '—'}</div>
                      <div className="text-[10px] text-slate-500">{log.admin_email || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      {log.target_name ? (
                        <>
                          <div className="text-xs text-white">{log.target_name}</div>
                          <div className="text-[10px] text-slate-500">{log.target_email || ''}</div>
                        </>
                      ) : log.target_company ? (
                        <div className="flex items-center gap-1 text-xs text-slate-300">
                          <Building2 size={10} className="text-slate-500" />
                          {log.target_company}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[10px] text-slate-500 space-y-0.5">
                        {meta.newRole && <div>Role → <span className="text-slate-300">{meta.newRole}</span></div>}
                        {meta.newPlan && <div>Plan → <span className="text-slate-300">{meta.newPlan}</span></div>}
                        {meta.note && <div>Note: <span className="text-slate-300">{meta.note}</span></div>}
                        {meta.file && <div>File: <span className="text-slate-300 font-mono">{meta.file}</span></div>}
                        {meta.expiredCount !== undefined && <div>Updated: <span className="text-slate-300">{meta.expiredCount}</span></div>}
                        {meta.deleted !== undefined && <div>Deleted: <span className="text-slate-300">{meta.deleted}</span></div>}
                        {log.target_company && !meta.newRole && !meta.newPlan && !meta.note && !meta.file && (
                          <div className="flex items-center gap-1"><Building2 size={9} />{log.target_company}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-slate-500 whitespace-nowrap">
                      {formatTime(log.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Page {page} of {pages} · {total} entries</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-40 transition-all">
              <ChevronLeft size={12} />
            </button>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="p-2 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-40 transition-all">
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}