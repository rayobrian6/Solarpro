'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { Building2, Plus, Trash2, UserMinus, Mail, RefreshCw, Crown, Users, X } from 'lucide-react';

interface OrgMember { id: string; name: string; email: string; org_role: string; }
interface PendingInvite { id: string; invited_email: string; created_at: string; expires_at: string; }
interface Org {
  id: string; name: string; plan: string; created_at: string;
  org_role: string; member_count: number;
  members: OrgMember[] | null;
  pending_invites: PendingInvite[] | null;
}

export default function OrganizationPanel({ userId }: { userId: string }) {
  const [org, setOrg]           = useState<Org | null>(null);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/organizations');
      const d = await res.json();
      if (d.success) setOrg(d.org);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createOrg = async () => {
    if (!newOrgName.trim()) return;
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOrgName.trim() }),
      });
      const d = await res.json();
      if (d.success) { showToast('Organization created!'); setCreating(false); setNewOrgName(''); load(); }
      else showToast(d.error || 'Failed', false);
    } catch { showToast('Network error', false); }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch('/api/organizations/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const d = await res.json();
      if (d.success) {
        showToast(d.autoAccepted ? `${inviteEmail} added immediately (existing user)` : `Invite sent to ${inviteEmail}`);
        setInviteEmail('');
        load();
      } else showToast(d.error || 'Failed', false);
    } catch { showToast('Network error', false); }
    finally { setInviting(false); }
  };

  const revokeInvite = async (inviteId: string) => {
    try {
      const res = await fetch('/api/organizations/invite', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      const d = await res.json();
      if (d.success) { showToast('Invite revoked'); load(); }
      else showToast(d.error || 'Failed', false);
    } catch { showToast('Network error', false); }
  };

  const removeMember = async (memberId: string, memberName: string) => {
    if (!confirm(`Remove ${memberName} from the organization?`)) return;
    try {
      const res = await fetch('/api/organizations/member', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      });
      const d = await res.json();
      if (d.success) { showToast(`${memberName} removed`); load(); }
      else showToast(d.error || 'Failed', false);
    } catch { showToast('Network error', false); }
  };

  const deleteOrg = async () => {
    try {
      const res = await fetch('/api/organizations', { method: 'DELETE' });
      const d = await res.json();
      if (d.success) { showToast('Organization deleted'); setConfirmDelete(false); load(); }
      else showToast(d.error || 'Failed', false);
    } catch { showToast('Network error', false); }
  };

  if (loading) return (
    <div className="card p-6 flex items-center gap-3 text-slate-400">
      <RefreshCw size={14} className="animate-spin" /> Loading organization…
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all ${toast.ok ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'bg-red-500/20 border border-red-500/40 text-red-300'}`}>
          {toast.msg}
        </div>
      )}

      {!org ? (
        /* ── No org yet ── */
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Building2 size={18} className="text-purple-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold">Company Organization</h3>
              <p className="text-xs text-slate-400">Group multiple accounts under one company</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-5">
            Create an organization to invite teammates, share a subscription plan, and manage your company's SolarPro seats from one place.
          </p>
          {creating ? (
            <div className="flex items-center gap-3">
              <input
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                placeholder="Company name…"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                onKeyDown={e => { if (e.key === 'Enter') createOrg(); if (e.key === 'Escape') setCreating(false); }}
                autoFocus
              />
              <button onClick={createOrg} className="btn-primary btn-sm">Create</button>
              <button onClick={() => setCreating(false)} className="btn-secondary btn-sm"><X size={13} /></button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} className="btn-primary flex items-center gap-2">
              <Plus size={14} /> Create Organization
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ── Org header ── */}
          <div className="card p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                  <Building2 size={18} className="text-purple-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">{org.name}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-400">{org.member_count} seat{Number(org.member_count) !== 1 ? 's' : ''}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium capitalize">{org.plan}</span>
                    {org.org_role === 'owner' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-medium flex items-center gap-1">
                        <Crown size={9} /> Owner
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {org.org_role === 'owner' && (
                <button onClick={() => setConfirmDelete(true)}
                  className="text-xs text-red-500/60 hover:text-red-400 transition-colors">
                  Delete org
                </button>
              )}
            </div>
          </div>

          {/* ── Members ── */}
          <div className="card p-5">
            <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Users size={14} className="text-slate-400" /> Members
            </h4>
            <div className="space-y-2">
              {(org.members ?? []).map(m => (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {m.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{m.name}</div>
                    <div className="text-xs text-slate-500 truncate">{m.email}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${m.org_role === 'owner' ? 'bg-purple-500/15 text-purple-400' : 'bg-slate-500/15 text-slate-400'}`}>
                    {m.org_role}
                  </span>
                  {org.org_role === 'owner' && m.id !== userId && (
                    <button onClick={() => removeMember(m.id, m.name)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 transition-colors">
                      <UserMinus size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Invite form — owners only */}
            {org.org_role === 'owner' && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <div className="text-xs text-slate-400 mb-2 font-medium">Invite by email</div>
                <div className="flex items-center gap-2">
                  <input
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    type="email"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                    onKeyDown={e => { if (e.key === 'Enter') sendInvite(); }}
                  />
                  <button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}
                    className="btn-primary btn-sm flex items-center gap-1.5 disabled:opacity-50">
                    {inviting ? <RefreshCw size={12} className="animate-spin" /> : <Mail size={12} />}
                    Invite
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Pending invites ── */}
          {org.org_role === 'owner' && (org.pending_invites ?? []).length > 0 && (
            <div className="card p-5">
              <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Mail size={14} className="text-slate-400" /> Pending Invites
              </h4>
              <div className="space-y-2">
                {(org.pending_invites ?? []).map(inv => (
                  <div key={inv.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                    <Mail size={13} className="text-slate-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{inv.invited_email}</div>
                      <div className="text-xs text-slate-500">Expires {new Date(inv.expires_at).toLocaleDateString()}</div>
                    </div>
                    <button onClick={() => revokeInvite(inv.id)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 transition-colors" title="Revoke invite">
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-white font-bold mb-2">Delete Organization?</h3>
            <p className="text-sm text-slate-400 mb-5">All members will be removed from the org. Their accounts and projects will remain intact. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={deleteOrg} className="flex-1 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 text-sm font-semibold hover:bg-red-500/30 transition-colors">Delete</button>
              <button onClick={() => setConfirmDelete(false)} className="flex-1 btn-secondary btn-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
