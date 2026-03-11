'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Building2, RefreshCw, Users, FolderOpen, Zap, XCircle,
  Shield, Crown, Ban, CheckCircle, AlertCircle, ChevronRight,
  X, ArrowLeftRight, UserPlus, CreditCard, Settings,
} from 'lucide-react';
import { useUser } from '@/contexts/UserContext';

const PLAN_COLORS: Record<string, string> = {
  contractor: 'bg-amber-500/20 text-amber-400',
  starter:    'bg-slate-500/20 text-slate-400',
  pro:        'bg-blue-500/20 text-blue-400',
  enterprise: 'bg-purple-500/20 text-purple-400',
};
const STATUS_COLORS: Record<string, string> = {
  active:    'bg-green-500/20 text-green-400',
  trialing:  'bg-blue-500/20 text-blue-400',
  free_pass: 'bg-amber-500/20 text-amber-400',
  suspended: 'bg-red-500/20 text-red-400',
  cancelled: 'bg-slate-500/20 text-slate-400',
};

type ToastState = { msg: string; ok: boolean } | null;

export default function AdminCompanies() {
  const { user: currentAdmin } = useUser();
  const isSuperAdmin = currentAdmin?.role === 'super_admin';

  const [companies, setCompanies]       = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selectedCompany, setSelected]  = useState<any | null>(null);
  const [companyDetail, setDetail]      = useState<any | null>(null);
  const [detailLoading, setDetailLoad]  = useState(false);
  const [acting, setActing]             = useState(false);
  const [toast, setToast]               = useState<ToastState>(null);
  const [planModal, setPlanModal]       = useState(false);
  const [newPlan, setNewPlan]           = useState('contractor');
  const [transferModal, setTransferModal] = useState(false);
  const [newOwnerId, setNewOwnerId]     = useState('');
  const [confirmModal, setConfirmModal] = useState<{ action: string; label: string; extra?: any } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/companies');
      const d = await res.json();
      if (d.success) setCompanies(d.companies || []);
      else {
        // Fallback: derive from users
        const ur = await fetch('/api/admin/users?limit=500');
        const ud = await ur.json();
        if (ud.success) {
          const map: Record<string, any> = {};
          for (const u of ud.users) {
            const co = u.company || 'Unknown';
            if (!map[co]) map[co] = { company: co, user_count: 0, has_free_pass: false, plans: new Set() };
            map[co].user_count++;
            if (u.is_free_pass) map[co].has_free_pass = true;
            map[co].plans.add(u.plan);
          }
          setCompanies(Object.values(map).map((c: any) => ({ ...c, plans: [...c.plans] })).sort((a: any, b: any) => b.user_count - a.user_count));
        }
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (companyName: string) => {
    setDetailLoad(true);
    try {
      const res = await fetch(`/api/admin/companies?company=${encodeURIComponent(companyName)}`);
      const d = await res.json();
      if (d.success) setDetail(d.company);
    } finally { setDetailLoad(false); }
  };

  const selectCompany = (co: any) => {
    setSelected(co);
    setDetail(null);
    loadDetail(co.company || co.name);
  };

  const companyAction = async (action: string, extra: any = {}) => {
    if (!selectedCompany) return;
    setActing(true);
    try {
      const res = await fetch('/api/admin/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: selectedCompany.company || selectedCompany.name, action, ...extra }),
      });
      const d = await res.json();
      if (d.success) {
        showToast(`✓ ${d.message || action + ' applied'}`);
        load();
        loadDetail(selectedCompany.company || selectedCompany.name);
      } else {
        showToast(d.error || 'Failed', false);
      }
    } finally { setActing(false); setConfirmModal(null); }
  };

  const isSuspended = companyDetail?.users?.every((u: any) => u.subscription_status === 'suspended');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Company Management</h1>
          <p className="text-sm text-slate-400 mt-1">{companies.length} companies on platform</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex gap-6">
        {/* Company List */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="text-center py-16 text-slate-500"><RefreshCw size={18} className="animate-spin inline mr-2" />Loading...</div>
          ) : (
            <div className="space-y-2">
              {companies.map((co: any) => {
                const name = co.company || co.name;
                const isSelected = (selectedCompany?.company || selectedCompany?.name) === name;
                const plans = Array.isArray(co.plans) ? co.plans.join(', ') : (co.plans || '');
                return (
                  <button
                    key={name}
                    onClick={() => selectCompany(co)}
                    className={`w-full text-left rounded-xl border p-4 transition-all ${
                      isSelected
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 flex-shrink-0">
                        <Building2 size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-white text-sm truncate">{name}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-3 mt-0.5">
                          <span className="flex items-center gap-1"><Users size={10} /> {co.user_count || co.users?.length || 0} users</span>
                          {plans && <span className="capitalize">{plans}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {co.has_free_pass && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">⚡ Free Pass</span>}
                        <ChevronRight size={14} className={`text-slate-600 transition-transform ${isSelected ? 'rotate-90 text-amber-400' : ''}`} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Company Detail Panel */}
        {selectedCompany && (
          <div className="w-96 flex-shrink-0">
            <div className="bg-[#0d1424] border border-white/10 rounded-2xl overflow-hidden sticky top-4">
              {/* Panel Header */}
              <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400">
                    <Building2 size={16} />
                  </div>
                  <div>
                    <div className="font-bold text-white text-sm">{selectedCompany.company || selectedCompany.name}</div>
                    <div className="text-[10px] text-slate-500">Company Management</div>
                  </div>
                </div>
                <button onClick={() => { setSelected(null); setDetail(null); }} className="text-slate-500 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>

              {detailLoading ? (
                <div className="p-8 text-center text-slate-500"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading...</div>
              ) : companyDetail ? (
                <div className="p-5 space-y-5">
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white/5 rounded-xl p-3 text-center">
                      <div className="text-xl font-black text-white">{companyDetail.userCount}</div>
                      <div className="text-[10px] text-slate-500 flex items-center justify-center gap-1 mt-0.5"><Users size={9} /> Users</div>
                    </div>
                    <div className="bg-white/5 rounded-xl p-3 text-center">
                      <div className="text-xl font-black text-white">{companyDetail.projectCount}</div>
                      <div className="text-[10px] text-slate-500 flex items-center justify-center gap-1 mt-0.5"><FolderOpen size={9} /> Projects</div>
                    </div>
                    <div className="bg-white/5 rounded-xl p-3 text-center">
                      <div className="text-[11px] font-bold text-white capitalize">{companyDetail.plans?.[0] || '—'}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Plan</div>
                    </div>
                  </div>

                  {/* Owner */}
                  {companyDetail.owner && (
                    <div className="bg-white/5 rounded-xl p-3">
                      <div className="text-[10px] text-slate-500 mb-2 font-semibold uppercase tracking-wider">Owner / Admin</div>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xs font-bold">
                          {companyDetail.owner.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <div className="text-xs font-medium text-white">{companyDetail.owner.name}</div>
                          <div className="text-[10px] text-slate-500">{companyDetail.owner.email}</div>
                        </div>
                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${companyDetail.owner.role === 'super_admin' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>
                          {companyDetail.owner.role}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Users list */}
                  <div>
                    <div className="text-[10px] text-slate-500 mb-2 font-semibold uppercase tracking-wider">Users ({companyDetail.userCount})</div>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {companyDetail.users?.map((u: any) => (
                        <div key={u.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-white/5">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-slate-400 text-[9px] font-bold flex-shrink-0">
                              {u.name?.charAt(0)?.toUpperCase()}
                            </div>
                            <span className="text-slate-300 truncate">{u.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_COLORS[u.subscription_status] || 'bg-slate-500/20 text-slate-400'}`}>
                              {u.subscription_status}
                            </span>
                            {isSuperAdmin && u.role !== 'super_admin' && (
                              <button
                                onClick={() => companyAction('add_company_admin', { userId: u.id })}
                                title="Make Company Admin"
                                className="text-slate-600 hover:text-blue-400 transition-colors"
                              >
                                <Shield size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-2">
                    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Company Actions</div>

                    {/* Change Plan */}
                    <button
                      onClick={() => setPlanModal(true)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/8 text-sm text-slate-300 hover:text-white transition-colors text-left"
                    >
                      <CreditCard size={14} className="text-blue-400" />
                      Change Plan
                    </button>

                    {/* Grant / Revoke Free Pass */}
                    {companyDetail.hasFreePass ? (
                      <button
                        onClick={() => setConfirmModal({ action: 'revoke_free_pass', label: `Revoke free pass for all users in ${companyDetail.name}?` })}
                        disabled={acting}
                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/8 text-sm text-slate-300 hover:text-white transition-colors text-left disabled:opacity-50"
                      >
                        <XCircle size={14} className="text-red-400" />
                        Revoke Free Pass
                      </button>
                    ) : (
                      <button
                        onClick={() => companyAction('grant_free_pass')}
                        disabled={acting}
                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/8 text-sm text-slate-300 hover:text-white transition-colors text-left disabled:opacity-50"
                      >
                        <Zap size={14} className="text-amber-400" />
                        Grant Free Pass (All Users)
                      </button>
                    )}

                    {/* Disable / Enable Company */}
                    {isSuperAdmin && (
                      isSuspended ? (
                        <button
                          onClick={() => companyAction('enable_company')}
                          disabled={acting}
                          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-green-500/10 hover:bg-green-500/15 text-sm text-green-400 transition-colors text-left disabled:opacity-50"
                        >
                          <CheckCircle size={14} />
                          Enable Company
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmModal({ action: 'disable_company', label: `Suspend ALL users in ${companyDetail.name}? This will block their access.` })}
                          disabled={acting}
                          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/15 text-sm text-red-400 transition-colors text-left disabled:opacity-50"
                        >
                          <Ban size={14} />
                          Disable Company
                        </button>
                      )
                    )}

                    {/* Transfer Ownership */}
                    {isSuperAdmin && companyDetail.userCount > 1 && (
                      <button
                        onClick={() => setTransferModal(true)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/8 text-sm text-slate-300 hover:text-white transition-colors text-left"
                      >
                        <ArrowLeftRight size={14} className="text-purple-400" />
                        Transfer Ownership
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Change Plan Modal */}
      {planModal && selectedCompany && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0d1424] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-base font-bold text-white">Change Plan — {selectedCompany.company || selectedCompany.name}</h2>
            <div>
              <label className="text-xs text-slate-400 mb-2 block">New Plan (applies to all users)</label>
              <select value={newPlan} onChange={e => setNewPlan(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50">
                <option value="starter">Starter</option>
                <option value="contractor">Contractor</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPlanModal(false)} className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button
                onClick={() => { companyAction('change_plan', { plan: newPlan }); setPlanModal(false); }}
                className="flex-1 py-2 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 transition-colors"
              >
                Apply Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Ownership Modal */}
      {transferModal && companyDetail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0d1424] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-base font-bold text-white">Transfer Ownership</h2>
            <p className="text-xs text-slate-400">Select the new owner for {companyDetail.name}. The current owner will be demoted to admin.</p>
            <div>
              <label className="text-xs text-slate-400 mb-2 block">New Owner</label>
              <select value={newOwnerId} onChange={e => setNewOwnerId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50">
                <option value="">Select user...</option>
                {companyDetail.users?.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setTransferModal(false)} className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button
                disabled={!newOwnerId}
                onClick={() => { companyAction('transfer_ownership', { newOwnerId }); setTransferModal(false); }}
                className="flex-1 py-2 rounded-lg bg-purple-500 text-white text-sm font-semibold hover:bg-purple-400 transition-colors disabled:opacity-50"
              >
                Transfer
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
            <div className="flex gap-3">
              <button onClick={() => setConfirmModal(null)} className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={() => companyAction(confirmModal.action, confirmModal.extra)} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-400 transition-colors">Confirm</button>
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