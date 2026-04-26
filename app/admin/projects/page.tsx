'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, RefreshCw, Trash2, RotateCcw, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  lead:      'bg-blue-500/20 text-blue-400',
  active:    'bg-green-500/20 text-green-400',
  completed: 'bg-purple-500/20 text-purple-400',
  cancelled: 'bg-slate-500/20 text-slate-400',
};

export default function AdminProjects() {
  const [projects, setProjects] = useState<any[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);
  const LIMIT = 50;

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects?search=${encodeURIComponent(search)}&page=${page}&limit=${LIMIT}`);
      const d = await res.json();
      if (d.success) { setProjects(d.projects); setTotal(d.total); }
    } finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const act = async (projectId: string, action: string) => {
    const res = await fetch('/api/admin/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, action }),
    });
    const d = await res.json();
    if (d.success) { showToast(`✓ ${action}`); load(); }
    else showToast(d.error || 'Failed', false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Project Management</h1>
          <p className="text-sm text-slate-400 mt-1">{total.toLocaleString()} total projects</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by project name, address, owner, or client..."
          className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50" />
      </div>

      <div className="rounded-xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/2">
                {['Project', 'Client', 'Owner', 'Address', 'System', 'Status', 'Created', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading...</td></tr>
              ) : projects.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500">No projects found</td></tr>
              ) : projects.map(p => (
                <tr key={p.id} className={`border-b border-white/5 hover:bg-white/2 transition-colors ${p.deleted_at ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white text-xs">{p.name}</div>
                    <div className="text-slate-500 text-[10px] font-mono">{p.id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.client_name || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-white">{p.owner_name}</div>
                    <div className="text-[10px] text-slate-500">{p.owner_email}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 max-w-[160px] truncate">{p.address || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.system_size_kw ? `${p.system_size_kw} kW` : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[p.status] || 'bg-slate-500/20 text-slate-400'}`}>
                      {p.deleted_at ? 'deleted' : p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <a href={`/engineering?projectId=${p.id}`} target="_blank" title="Open in Engineering" className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-colors">
                        <ExternalLink size={13} />
                      </a>
                      {p.deleted_at ? (
                        <button onClick={() => act(p.id, 'restore')} title="Restore" className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors">
                          <RotateCcw size={13} />
                        </button>
                      ) : (
                        <button onClick={() => { if (confirm('Soft-delete this project?')) act(p.id, 'delete'); }} title="Delete" className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {Math.ceil(total / LIMIT) > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Page {page} of {Math.ceil(total / LIMIT)}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-40">Prev</button>
            <button onClick={() => setPage(p => Math.min(Math.ceil(total / LIMIT), p + 1))} disabled={page === Math.ceil(total / LIMIT)} className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-xl ${toast.ok ? 'bg-green-500/20 border border-green-500/30 text-green-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}