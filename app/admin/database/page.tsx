'use client';
import { useEffect, useState } from 'react';
import { Database, RefreshCw, Play, CheckCircle, AlertCircle, Clock } from 'lucide-react';

export default function AdminDatabase() {
  const [health, setHealth]     = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [migrateLog, setMigrateLog] = useState<string[]>([]);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4000); };

  const loadHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/health');
      const d = await res.json();
      if (d.success) setHealth(d);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadHealth(); }, []);

  const runMigration = async () => {
    const secret = prompt('Enter MIGRATE_SECRET to run migrations:');
    if (!secret) return;
    setMigrating(true);
    setMigrateLog(['⏳ Running migrations...']);
    try {
      const res = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      const d = await res.json();
      if (d.success) {
        setMigrateLog([
          '✅ Migration completed successfully',
          `Columns added: ${d.columnsAdded?.join(', ') || 'none'}`,
          `Free passes applied: ${d.freePassesApplied ?? 0}`,
          `Timestamp: ${new Date().toISOString()}`,
        ]);
        showToast('✓ Migration successful');
        loadHealth();
      } else {
        setMigrateLog([`❌ Migration failed: ${d.error || 'Unknown error'}`]);
        showToast(d.error || 'Migration failed', false);
      }
    } catch (e: any) {
      setMigrateLog([`❌ Error: ${e.message}`]);
      showToast(e.message, false);
    } finally {
      setMigrating(false);
    }
  };

  const rc = health?.checks?.rowCounts || {};
  const tables = health?.checks?.tables || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Database Maintenance</h1>
          <p className="text-sm text-slate-400 mt-1">Migrations, table stats, and database health</p>
        </div>
        <button onClick={loadHealth} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* DB Status */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`rounded-xl border p-5 ${health?.checks?.database?.status === 'ok' ? 'border-green-500/20 bg-green-500/10' : 'border-red-500/20 bg-red-500/10'}`}>
          <div className="text-xs font-medium opacity-70 uppercase tracking-wider mb-2">Database</div>
          <div className={`text-lg font-black ${health?.checks?.database?.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
            {health?.checks?.database?.status === 'ok' ? '● Online' : '● Error'}
          </div>
          <div className="text-xs mt-1 opacity-60">{health?.checks?.database?.latencyMs ?? '—'}ms latency</div>
        </div>
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-5">
          <div className="text-xs font-medium text-blue-400 opacity-70 uppercase tracking-wider mb-2">DB Size</div>
          <div className="text-lg font-black text-blue-400">{health?.checks?.dbSize || '—'}</div>
          <div className="text-xs mt-1 opacity-60">Total database size</div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-5">
          <div className="text-xs font-medium text-amber-400 opacity-70 uppercase tracking-wider mb-2">Tables</div>
          <div className="text-lg font-black text-amber-400">{tables.length || '—'}</div>
          <div className="text-xs mt-1 opacity-60">Public schema tables</div>
        </div>
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-5">
          <div className="text-xs font-medium text-purple-400 opacity-70 uppercase tracking-wider mb-2">Last Check</div>
          <div className="text-sm font-bold text-purple-400">{health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : '—'}</div>
          <div className="text-xs mt-1 opacity-60">{health?.timestamp ? new Date(health.timestamp).toLocaleDateString() : ''}</div>
        </div>
      </div>

      {/* Row Counts */}
      <div className="rounded-xl border border-white/5 bg-white/2 p-6">
        <div className="text-sm font-semibold text-white mb-4">Row Counts</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(rc).map(([table, count]: [string, any]) => (
            <div key={table} className="bg-white/5 rounded-lg p-3 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-mono">{table}</span>
              <span className="text-sm font-bold text-white">{count?.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Table Sizes */}
      {tables.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-white/2 p-6">
          <div className="text-sm font-semibold text-white mb-4">Table Sizes</div>
          <div className="space-y-2">
            {tables.slice(0, 15).map((t: any) => (
              <div key={t.tablename} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                <span className="text-xs font-mono text-slate-300">{t.tablename}</span>
                <span className="text-xs text-slate-500">{t.size}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run Migration */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Database size={18} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-400 mb-1">Run Database Migration</div>
            <div className="text-xs text-slate-400 mb-4">
              Applies all pending schema changes: new columns, new tables, free pass upserts, and constraint additions.
              Requires your MIGRATE_SECRET environment variable.
            </div>
            <button
              onClick={runMigration}
              disabled={migrating}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors disabled:opacity-50"
            >
              {migrating ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
              {migrating ? 'Running...' : 'Run Migration'}
            </button>
          </div>
        </div>

        {migrateLog.length > 0 && (
          <div className="bg-black/40 rounded-lg p-4 font-mono text-xs space-y-1">
            {migrateLog.map((line, i) => (
              <div key={i} className={line.startsWith('✅') ? 'text-green-400' : line.startsWith('❌') ? 'text-red-400' : line.startsWith('⏳') ? 'text-amber-400' : 'text-slate-400'}>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-xl ${toast.ok ? 'bg-green-500/20 border border-green-500/30 text-green-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}