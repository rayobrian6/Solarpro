'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Search, RefreshCw, Shield, Zap, Ban, RotateCcw,
  ChevronLeft, ChevronRight, Edit2, Trash2, CheckCircle,
  AlertCircle, Crown, UserX, Key, Eye, ChevronDown,
  UserCheck, Star, XCircle,
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

type ToastState = { msg: string; ok: boolean } | null;

export default function AdminUsers() {
  const { refreshUser, user: currentAdmin } = useUser();
  const isSuperAdmin = currentAdmin?.role === 'super_admin';

  const [users, setUsers]         = useState<any[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(true);
  const [acting, setActing]       = useState<string | null>(null);
  const [toast, setToast]         = useState<ToastState>(null);
  const [editUser, setEditUser]   = useState<any | null>(null);
  const [openMenu, setOpenMenu]   = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ userId: string; action: string; label: string; extra?: any } | null>(null);
  const [tempPasswordModal, setTempPasswordModal] = useState<{ password: string; email: string } | null>(null);
  const LIMIT = 50;

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = () => setOpenMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const action = async (userId: string, actionName: string, extra: any = {}) => {
    setActing(userId + actionName);
    setOpenMenu(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, action: actionName, ...extra }),
      });
      const d = await res.json();
      if (d.success) {
        if (actionName === 'reset_password' && d.tempPassword) {
          const u = users.find(u => u.id === userId);
          setTempPasswordModal({ password: d.tempPassword, email: u?.email || '' });
        } else if (actionName === 'impersonate' && d.token) {
          // Open impersonation in new tab
          window.open(`/api/admin/impersonate?token=${d.token}`, '_blank');
          showToast(`✓ Impersonating ${d.targetUser?.name || 'user'} — check new tab`);
        } else {
          showToast(`✓ ${actionName.replace(/_/g, ' ')} applied`);
        }
        load();
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

  const handleConfirm = () => {
    if (!confirmModal) return;
    action(confirmModal.userId, confirmModal.action, confirmModal.extra || {});
    setConfirmModal(null);
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
                      {/* Quick actions */}
                      <button
                        onClick={() => action(u.id, u.is_free_pass ? 'revoke_free_pass' : 'grant_free_pass')}
                        disabled={!!acting}
                        title={u.is_free_pass ? 'Revoke Free Pass' : 'Grant Free Pass'}
                        className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${u.is_free_pass ? 'text-amber-400 hover:bg-amber-500/10' : 'text-slate-500 hover:bg-white/5'}`}
                      >
                        <Zap size={13} />
                      </button>

                      {u.subscription_status === 'suspended' ? (
                        <button onClick={() => action(u.id, 'unsuspend')} disabled={!!acting} title="Unsuspend" className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-40">
                          <CheckCircle size={13} />
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmModal({ userId: u.id, action: 'suspend', label: `Suspend ${u.name}?` })}
                          disabled={!!acting} title="Suspend User"
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                        >
                          <Ban size={13} />
                        </button>
                      )}

                      {/* Edit */}
                      <button onClick={() => setEditUser(u)} title="Edit User" className="p-1.5 rounded-lg text-slate-400 hover:bg-white/5 transition-colors">
                        <Edit2 size={13} />
                      </button>

                      {/* More actions dropdown */}
                      <div className="relative" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setOpenMenu(openMenu === u.id ? null : u.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-white/5 transition-colors flex items-center gap-0.5"
                          title="More actions"
                        >
                          <ChevronDown size={13} />
                        </button>

                        {openMenu === u.id && (
                          <div className="absolute right-0 top-8 z-50 w-52 bg-[#0d1424] border border-white/10 rounded-xl shadow-2xl py-1 overflow-hidden">
                            <div className="px-3 py-1.5 text-[10px] text-slate-500 font-semibold uppercase tracking-wider border-b border-white/5">
                              Role
                            </div>
                            {isSuperAdmin && (
                              <>
                                <button
                                  onClick={() => { action(u.id, 'set_role', { role: 'user' }); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                                >
                                  <UserCheck size={12} className="text-slate-400" /> Set as User
                                </button>
                                <button
                                  onClick={() => { action(u.id, 'set_role', { role: 'admin' }); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                                >
                                  <Shield size={12} className="text-blue-400" /> Promote to Admin
                                </button>
                                <button
                                  onClick={() => setConfirmModal({ userId: u.id, action: 'set_role', label: `Promote ${u.name} to Super Admin?`, extra: { role: 'super_admin' } })}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                                >
                                  <Star size={12} className="text-amber-400" /> Promote to Super Admin
                                </button>
                              </>
                            )}

                            <div className="px-3 py-1.5 text-[10px] text-slate-500 font-semibold uppercase tracking-wider border-b border-white/5 border-t border-white/5 mt-1">
                              Access
                            </div>
                            <button
                              onClick={() => { action(u.id, 'grant_free_pass'); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                            >
                              <Zap size={12} className="text-amber-400" /> Grant Free Pass
                            </button>
                            <button
                              onClick={() => { action(u.id, 'revoke_free_pass'); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                            >
                              <XCircle size={12} className="text-red-400" /> Revoke Free Pass
                            </button>
                            <button
                              onClick={() => { action(u.id, 'reset_trial'); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                            >
                              <RotateCcw size={12} className="text-blue-400" /> Reset Trial (14 days)
                            </button>

                            <div className="px-3 py-1.5 text-[10px] text-slate-500 font-semibold uppercase tracking-wider border-b border-white/5 border-t border-white/5 mt-1">
                              Admin Tools
                            </div>
                            <button
                              onClick={() => setConfirmModal({ userId: u.id, action: 'reset_password', label: `Reset password for ${u.email}? A temporary password will be generated.` })}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                            >
                              <Key size={12} className="text-yellow-400" /> Reset Password
                            </button>
                            {isSuperAdmin && (
                              <button
                                onClick={() => setConfirmModal({ userId: u.id, action: 'impersonate', label: `Impersonate ${u.name} (${u.email})? You will be logged in as this user in a new tab.` })}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                              >
                                <Eye size={12} className="text-purple-400" /> Impersonate User
                              </button>
                            )}
                            <button
                              onClick={() => deleteUser(u.id, u.email)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 size={12} /> Delete User
                            </button>
                          </div>
                        )}
                      </div>
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
                  disabled={!isSuperAdmin}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 disabled:opacity-50">
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                  <option value="super_admin">super_admin</option>
                </select>
                {!isSuperAdmin && <p className="text-[10px] text-slate-500 mt-1">Only super_admin can change roles</p>}
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
                  await action(editUser.id, 'update', { name: editUser.name, company: editUser.company });
                  if (isSuperAdmin) await action(editUser.id, 'set_role', { role: editUser.role });
                  await action(editUser.id, 'set_plan', { plan: editUser.plan });
                  setEditUser(null);
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

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0d1424] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle size={18} className="text-red-400" />
              </div>
              <h2 className="text-base font-bold text-white">Confirm Action</h2>
            </div>
            <p className="text-sm text-slate-300">{confirmModal.label}</p>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setConfirmModal(null)} className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleConfirm} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-400 transition-colors">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Temp Password Modal */}
      {tempPasswordModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0d1424] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <Key size={18} className="text-yellow-400" />
              </div>
              <h2 className="text-base font-bold text-white">Password Reset</h2>
            </div>
            <p className="text-sm text-slate-400">Temporary password for <span className="text-white font-medium">{tempPasswordModal.email}</span>:</p>
            <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 font-mono text-amber-400 text-sm select-all">
              {tempPasswordModal.password}
            </div>
            <p className="text-xs text-slate-500">Share this with the user. They should change it immediately after logging in.</p>
            <button
              onClick={() => { navigator.clipboard.writeText(tempPasswordModal.password); showToast('Copied to clipboard'); setTempPasswordModal(null); }}
              className="w-full py-2 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 transition-colors"
            >
              Copy & Close
            </button>
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