'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RefreshCw, Trash2, RotateCcw, CheckCircle, AlertCircle, ExternalLink, ChevronRight, GitBranch } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const STATUS_COLORS: Record<string, string> = {
  lead:      'bg-blue-500/20 text-blue-400',
  active:    'bg-green-500/20 text-green-400',
  completed: 'bg-purple-500/20 text-purple-400',
  cancelled: 'bg-slate-500/20 text-slate-400',
};

const HOMEOWNER_STAGE_COLORS: Record<string, string> = {
  lead_submitted: 'bg-slate-500/20  text-slate-400',
  under_review:   'bg-blue-500/20   text-blue-400',
  site_survey:    'bg-cyan-500/20   text-cyan-400',
  design:         'bg-violet-500/20 text-violet-400',
  proposal:       'bg-amber-500/20  text-amber-400',
  installation:   'bg-orange-500/20 text-orange-400',
  completed:      'bg-green-500/20  text-green-400',
};

const HOMEOWNER_STAGE_LABELS: Record<string, string> = {
  lead_submitted: 'Lead Submitted',
  under_review:   'Under Review',
  site_survey:    'Site Survey',
  design:         'Design',
  proposal:       'Proposal',
  installation:   'Installation',
  completed:      'Completed',
};

export default function AdminProjects() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [originFilter, setOriginFilter] = useState<'all' | 'survey' | 'manual' | 'bill_upload'>('all');
  const [loading, setLoading]   = useState(true);
  const toast = useToast();
  const [confirmDialog, setConfirmDialog] = useState<null | { message: string; onConfirm: () => void }>(null);
  const LIMIT = 50;


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects?search=${encodeURIComponent(search)}&page=${page}&limit=${LIMIT}&origin=${originFilter}`);
      const d = await res.json();
      if (d.success) { setProjects(d.projects); setTotal(d.total); }
    } finally { setLoading(false); }
  }, [search, page, originFilter]);

  useEffect(() => { load(); }, [load]);

  const act = async (projectId: string, action: string, extra: Record<string,unknown> = {}) => {
    const res = await fetch('/api/admin/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, action, ...extra }),
    });
    const d = await res.json();
    if (d.success) { toast.success(`${action}`); load(); }
    else toast.error(d.error || 'Failed');
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

      {/* Origin filter tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'survey', 'manual', 'bill_upload'] as const).map(o => (
          <button key={o} onClick={() => { setOriginFilter(o); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              originFilter === o
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'text-slate-400 border border-white/10 hover:text-white hover:border-white/20'
            }`}>
            {o === 'all' ? 'All' : o === 'bill_upload' ? 'Bill Upload' : o.charAt(0).toUpperCase() + o.slice(1)}
          </button>
        ))}
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
                {['Project', 'Origin', 'Client', 'Owner', 'Address', 'System', 'Internal Status', 'Portal Stage', 'Created', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="text-center py-12 text-slate-500"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading...</td></tr>
              ) : projects.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-slate-500">No projects found</td></tr>
              ) : projects.map(p => (
                <tr
                  key={p.id}
                  className={`border-b border-white/5 hover:bg-white/2 transition-colors cursor-pointer ${p.deleted_at ? 'opacity-50' : ''}`}
                  onClick={() => router.push(`/admin/projects/${p.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white text-xs">{p.name}</div>
                    <div className="text-slate-500 text-[10px] font-mono">{p.id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      p.origin === 'survey'      ? 'bg-cyan-500/15 text-cyan-400' :
                      p.origin === 'bill_upload' ? 'bg-blue-500/15 text-blue-400' :
                      'bg-slate-500/15 text-slate-400'
                    }`}>{p.origin || 'manual'}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.client_name || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-white">{p.owner_name}</div>
                    <div className="text-[10px] text-slate-500">{p.owner_email}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 max-w-[140px] truncate">{p.address || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.system_size_kw ? `${p.system_size_kw} kW` : '—'}</td>
                  {/* Internal status — ops pipeline */}
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[p.status] || 'bg-slate-500/20 text-slate-400'}`}>
                      {p.deleted_at ? 'deleted' : p.status}
                    </span>
                  </td>
                  {/* Homeowner stage — portal display */}
                  <td className="px-4 py-3">
                    {p.homeowner_stage ? (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${HOMEOWNER_STAGE_COLORS[p.homeowner_stage] || 'bg-slate-500/20 text-slate-400'}`}>
                        {HOMEOWNER_STAGE_LABELS[p.homeowner_stage] || p.homeowner_stage}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-600 italic">not set</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => router.push(`/admin/projects/${p.id}`)}
                        title="View / Edit Stage"
                        className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors"
                      >
                        <ChevronRight size={13} />
                      </button>
                      <a
                        href={`/engineering?projectId=${p.id}`}
                        target="_blank"
                        title="Open in Engineering"
                        className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink size={13} />
                      </a>
                      <button
                        onClick={() => router.push(`/admin/engineering-intelligence/project/${p.id}`)}
                        title="Open Engineering Intelligence"
                        className="p-1.5 rounded-lg text-sky-400 hover:bg-sky-500/10 transition-colors"
                      >
                        <GitBranch size={13} />
                      </button>
                      {p.deleted_at ? (
                        <button onClick={() => act(p.id, 'restore')} title="Restore" className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors">
                          <RotateCcw size={13} />
                        </button>
                      ) : (
                        <button
                          onClick={() => { setConfirmDialog({ message: `Hard-delete "${p.name}"? This cannot be undone.`, onConfirm: () => act(p.id, 'delete') }); }}
                          title="Hard delete (permanent)"
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                        >
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

      {confirmDialog ? (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
          variant="danger"
        />
      ) : null}
    </div>
  );
}