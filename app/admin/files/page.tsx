'use client';
import { useEffect, useState, useCallback } from 'react';
import { HardDrive, RefreshCw, Trash2, Download, CheckCircle, AlertCircle, Filter } from 'lucide-react';

const FILE_TYPES = ['', 'engineering', 'utility_bill', 'site_photo', 'permit', 'proposal', 'document', 'other'];
const TYPE_COLORS: Record<string, string> = {
  engineering:  'bg-blue-500/20 text-blue-400',
  utility_bill: 'bg-amber-500/20 text-amber-400',
  site_photo:   'bg-green-500/20 text-green-400',
  permit:       'bg-purple-500/20 text-purple-400',
  proposal:     'bg-pink-500/20 text-pink-400',
  document:     'bg-slate-500/20 text-slate-400',
};

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function AdminFiles() {
  const [files, setFiles]       = useState<any[]>([]);
  const [total, setTotal]       = useState(0);
  const [storage, setStorage]   = useState<any>(null);
  const [page, setPage]         = useState(1);
  const [fileType, setFileType] = useState('');
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);
  const LIMIT = 50;

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/files?page=${page}&limit=${LIMIT}&fileType=${fileType}`);
      const d = await res.json();
      if (d.success) { setFiles(d.files); setTotal(d.total); setStorage(d.storage); }
    } finally { setLoading(false); }
  }, [page, fileType]);

  useEffect(() => { load(); }, [load]);

  const del = async (id: string, name: string) => {
    if (!confirm(`Delete file "${name}"?`)) return;
    const res = await fetch(`/api/admin/files?id=${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.success) { showToast('✓ File deleted'); load(); }
    else showToast(d.error || 'Failed', false);
  };

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">File Storage Manager</h1>
          <p className="text-sm text-slate-400 mt-1">All project files stored in database</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Storage Stats */}
      {storage && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-5">
            <div className="text-xs text-blue-400 opacity-70 uppercase tracking-wider mb-2">Total Files</div>
            <div className="text-3xl font-black text-blue-400">{(storage.totalFiles ?? storage.total_files ?? 0).toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-5">
            <div className="text-xs text-amber-400 opacity-70 uppercase tracking-wider mb-2">Storage Used</div>
            <div className="text-3xl font-black text-amber-400">{fmtBytes(storage.totalBytes ?? storage.total_bytes ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-5">
            <div className="text-xs text-green-400 opacity-70 uppercase tracking-wider mb-2">Projects w/ Files</div>
            <div className="text-3xl font-black text-green-400">{(storage.projectsWithFiles ?? storage.projects_with_files ?? 0).toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Filter size={14} className="text-slate-500" />
        <div className="flex gap-2 flex-wrap">
          {FILE_TYPES.map(t => (
            <button key={t} onClick={() => { setFileType(t); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${fileType === t ? 'border-amber-500/50 bg-amber-500/10 text-amber-400' : 'border-white/10 text-slate-400 hover:text-white hover:border-white/20'}`}>
              {t || 'All Types'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/2">
                {['File Name', 'Type', 'Size', 'Project', 'Owner', 'Uploaded', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading...</td></tr>
              ) : files.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">No files found</td></tr>
              ) : files.map(f => (
                <tr key={f.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white text-xs max-w-[200px] truncate">{f.file_name}</div>
                    <div className="text-[10px] text-slate-500">{f.mime_type}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[f.file_type] || 'bg-slate-500/20 text-slate-400'}`}>
                      {f.file_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{fmtBytes(f.file_size || 0)}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-white max-w-[120px] truncate">{f.project_name || '—'}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{f.project_id?.slice(0, 8)}…</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-white">{f.owner_name || '—'}</div>
                    <div className="text-[10px] text-slate-500">{f.owner_email}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {f.upload_date ? new Date(f.upload_date).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => del(f.id, f.file_name)} title="Delete" className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Page {page} of {pages} · {total.toLocaleString()} files</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-40">Prev</button>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-40">Next</button>
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