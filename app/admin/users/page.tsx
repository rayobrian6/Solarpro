'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Search, RefreshCw, Shield, Zap, Ban, RotateCcw,
  ChevronLeft, ChevronRight, Edit2, Trash2, CheckCircle,
  AlertCircle, User, Crown,
} from 'lucide-react';
import { useUser } from '@/contexts/UserContext';

const PLAN_COLORS: Record<string, string> = {
  contractor: 'bg-amber-500/20 text-amber-400',
  starter:    'bg-slate-500/20 text-slate-400',
  pro:        'bg-blue-500/20 text-blue-400',
  enterprise: 'bg-purple-500/20 text-purple-400',
};
const STATUS_COLORS: Record<string, string> = {
  active:     'bg-green-500/20 text-green-400',
  trialing:   'bg-blue-500/20 text-blue-400',
  free_pass:  'bg-amber-500/20 text-amber-400',
  suspended:  'bg-red-500/20 text-red-400',
  cancelled:  'bg-slate-500/20 text-slate-400',
};
const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-amber-500/20 text-amber-400',
  admin:       'bg-blue-500/20 text-blue-400',
  user:        'bg-slate-500/20 text-slate-400',
};

export default function AdminUsers() {
  const { refreshUser } = useUser(); // refresh logged-in user's own state after admin actions
  const [users, setUsers]     = useState<any[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState<string | null>(null);
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);
  const [editUser, setEditUser] = useState<any | null>(null);
  const LIMIT = 50;

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(search)}&page=${page}&limit=${LIMIT}`);
      const d = await res.json();
      if (d.success) { setUsers(d.users); setTotal(d.total); }
    } finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const action = async (userId: string, actionName: string, extra: any = {}) => {
    setActing(userId + actionName);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // API expects 'id' not 'userId'
        body: JSON.stringify({ id: userId, action: actionName, ...extra }),
      });
      const d = await res.json();
      if (d.success) {
        showToast(`✓ ${actionName.replace(/_/g, ' ')} applied`);
        // Refresh the users list
        load();
        // Refresh the logged-in admin's own user state in case they changed their own record
        // Use a small delay to avoid the fetchingRef guard dropping rapid sequential calls
        setTimeout(() => refreshUser(), 100);
      } else {
        showToast(d.error || 'Failed', false);
      }
    } finally { setActing(null); }
  };

  const deleteUser = async (userId: string, email: string) => {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/users?id=${userId}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.success) { showToast('User deleted'); load(); }
    else showToast(d.error || 'Failed', false);
  };

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">User Management</h1>
          <p className="text-sm text-slate-400 mt-1">{total.toLocaleString()} total users</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name, email, or company..."
          className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/2">
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">User</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Company</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Plan</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Role</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Trial Ends</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">
                  <RefreshCw size={16} className="animate-spin inline mr-2" />Loading...
                </td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">No users found</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xs font-bold flex-shrink-0">
                        {u.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <div className="font-medium text-white text-xs">{u.name}</div>
                        <div className="text-slate-500 text-[11px]">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{u.company || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PLAN_COLORS[u.plan] || 'bg-slate-500/20 text-slate-400'}`}>
                      {u.plan || 'unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[u.subscription_status] || 'bg-slate-500/20 text-slate-400'}`}>
                      {u.subscription_status || 'unknown'}
                    </span>
                    {u.is_free_pass && <span className="ml-1 text-[10px] text-amber-400">⚡</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role] || 'bg-slate-500/20 text-slate-400'}`}>
                      {u.role || 'user'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {u.trial_ends_at ? new Date(u.trial_ends_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {/* Grant Free Pass */}
                      <button
                        onClick={() => action(u.id, 'grant_free_pass')}
                        disabled={!!acting}
                        title="Grant Free Pass"
                        className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                      >
                        <Zap size={13} />
                      </button>
                      {/* Suspend / Unsuspend */}
                      {u.subscription_status === 'suspended' ? (
                        <button onClick={() => action(u.id, 'unsuspend')} disabled={!!acting} title="Unsuspend" className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-40">
                          <CheckCircle size={13} />
                        </button>
                      ) : (
                        <button onClick={() => action(u.id, 'suspend')} disabled={!!acting} title="Suspend" className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                          <Ban size={13} />
                        </button>
                      )}
                      {/* Reset Trial */}
                      <button onClick={() => action(u.id, 'reset_trial')} disabled={!!acting} title="Reset Trial" className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-40">
                        <RotateCcw size={13} />
                      </button>
                      {/* Set Admin */}
                      <button
                        onClick={() => action(u.id, 'set_role', { role: u.role === 'admin' ? 'user' : 'admin' })}
                        disabled={!!acting}
                        title={u.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                        className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${u.role === 'admin' || u.role === 'super_admin' ? 'text-amber-400 hover:bg-amber-500/10' : 'text-slate-500 hover:bg-white/5'}`}
                      >
                        <Crown size={13} />
                      </button>
                      {/* Edit */}
                      <button onClick={() => setEditUser(u)} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:bg-white/5 transition-colors">
                        <Edit2 size={13} />
                      </button>
                      {/* Delete */}
                      <button onClick={() => deleteUser(u.id, u.email)} title="Delete" className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
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
          <span>Page {page} of {pages} · {total} users</span>
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

      {/* Edit Modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0d1424] border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold text-white">Edit User</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Name</label>
                <input value={editUser.name || ''} onChange={e => setEditUser({ ...editUser, name: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Company</label>
                <input value={editUser.company || ''} onChange={e => setEditUser({ ...editUser, company: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Role</label>
                <select value={editUser.role || 'user'} onChange={e => setEditUser({ ...editUser, role: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50">
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                  <option value="super_admin">super_admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Plan</label>
                <select value={editUser.plan || 'starter'} onChange={e => setEditUser({ ...editUser, plan: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50">
                  <option value="starter">starter</option>
                  <option value="contractor">contractor</option>
                  <option value="pro">pro</option>
                  <option value="enterprise">enterprise</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditUser(null)} className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button
                onClick={async () => {
                  // Run all three updates sequentially, then refresh once at the end
                  // (action() calls refreshUser() internally, but we also do a final
                  //  explicit refresh after all three complete to ensure consistency)
                  await action(editUser.id, 'update', { name: editUser.name, company: editUser.company });
                  await action(editUser.id, 'set_role', { role: editUser.role });
                  await action(editUser.id, 'set_plan', { plan: editUser.plan });
                  setEditUser(null);
                  // Final authoritative refresh after all actions complete
                  setTimeout(() => refreshUser(), 300);
                }}
                className="flex-1 py-2 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 transition-colors"
              >
                Save Changes
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