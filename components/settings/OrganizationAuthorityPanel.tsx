'use client';
/**
 * components/settings/OrganizationAuthorityPanel.tsx
 *
 * Phase 1B — Organization Authority Foundation
 * Commit 7: Feature-Flagged Organization UI
 *
 * This is the NEW organization authority UI, feature-flagged on
 * ENTERPRISE_ORG_AUTHORITY_ENABLED. When the flag is off, the settings
 * page should render the legacy OrganizationPanel instead.
 *
 * Features:
 *   - Active organization context display and switching
 *   - Member list with role badges (owner/admin/member/viewer)
 *   - Role change dropdown (admins+ can change non-owner roles)
 *   - Member removal (admins+ can remove non-owners)
 *   - Member suspension/reactivation
 *   - Member invitation by email with role selection
 *
 * All operations go through the new API routes which enforce
 * server-side authorization. The UI is a thin client — it sends
 * requests and displays results. All permission decisions are
 * made server-side.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  Crown,
  Shield,
  User,
  Eye,
  Users,
  Mail,
  RefreshCw,
  UserMinus,
  UserPlus,
  Ban,
  CheckCircle,
  X,
  ChevronDown,
  Plus,
  AlertCircle,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

interface ActiveOrg {
  organizationId: string;
  orgName: string;
  role: OrgRole;
  source: string;
}

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  status: string;
  joinedAt: string;
}

interface OrgDetail {
  id: string;
  name: string;
  plan?: string;
  status?: string;
  slug?: string;
  members: Member[];
}

interface Features {
  orgAuthority: boolean;
  membershipWrite: boolean;
  activeOrgContext: boolean;
  authzEnforcement: boolean;
}

// ============================================================================
// Role helpers (client-side display only — server is authoritative)
// ============================================================================

const ROLE_META: Record<OrgRole, { label: string; icon: React.ElementType; color: string }> = {
  owner: { label: 'Owner', icon: Crown, color: 'bg-purple-500/15 text-purple-400' },
  admin: { label: 'Admin', icon: Shield, color: 'bg-blue-500/15 text-blue-400' },
  member: { label: 'Member', icon: User, color: 'bg-slate-500/15 text-slate-400' },
  viewer: { label: 'Viewer', icon: Eye, color: 'bg-slate-600/15 text-slate-500' },
};

const ROLE_ORDER: OrgRole[] = ['owner', 'admin', 'member', 'viewer'];

function roleRank(role: OrgRole): number {
  return ROLE_ORDER.indexOf(role);
}

// ============================================================================
// Component
// ============================================================================

export default function OrganizationAuthorityPanel({ userId }: { userId: string }) {
  const [features, setFeatures] = useState<Features | null>(null);
  const [activeOrg, setActiveOrg] = useState<ActiveOrg | null>(null);
  const [orgDetail, setOrgDetail] = useState<OrgDetail | null>(null);
  const [userOrgs, setUserOrgs] = useState<ActiveOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [inviting, setInviting] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const loadFeatures = useCallback(async () => {
    try {
      const res = await fetch('/api/organizations/features');
      const d = await res.json();
      if (d.success) setFeatures(d.features);
    } catch {
      // Non-fatal — defaults to all-false
    }
  }, []);

  const loadActiveOrg = useCallback(async () => {
    try {
      const res = await fetch('/api/organizations/active');
      const d = await res.json();
      if (d.success && d.activeOrg) {
        setActiveOrg(d.activeOrg);
        return d.activeOrg.organizationId;
      }
      setActiveOrg(null);
      return null;
    } catch {
      setActiveOrg(null);
      return null;
    }
  }, []);

  const loadOrgDetail = useCallback(async (orgId: string) => {
    try {
      const res = await fetch(`/api/organizations/${orgId}`);
      const d = await res.json();
      if (d.success && d.organization) {
        setOrgDetail(d.organization);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const loadUserOrgs = useCallback(async () => {
    try {
      const res = await fetch('/api/organizations/mine');
      const d = await res.json();
      if (d.success && Array.isArray(d.organizations)) {
        setUserOrgs(
          d.organizations.map((o: { organizationId: string; orgName: string; role: OrgRole }) => ({
            organizationId: o.organizationId,
            orgName: o.orgName,
            role: o.role,
            source: 'membership',
          }))
        );
      }
    } catch {
      // Non-fatal — org switcher will show empty
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await loadFeatures();
    const orgId = await loadActiveOrg();
    if (orgId) {
      await loadOrgDetail(orgId);
    }
    await loadUserOrgs();
    setLoading(false);
  }, [loadFeatures, loadActiveOrg, loadOrgDetail, loadUserOrgs]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ============================================================================
  // Actions
  // ============================================================================

  const switchOrg = async (orgId: string) => {
    setSwitchingOrg(true);
    setShowOrgSwitcher(false);
    try {
      const res = await fetch('/api/organizations/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId }),
      });
      const d = await res.json();
      if (d.success) {
        showToast('Active organization switched');
        await loadAll();
      } else {
        showToast(d.error || 'Failed to switch organization', false);
      }
    } catch {
      showToast('Network error', false);
    } finally {
      setSwitchingOrg(false);
    }
  };

  const inviteMember = async () => {
    if (!inviteEmail.trim() || !activeOrg) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/organizations/${activeOrg.organizationId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: inviteEmail.trim(), role: inviteRole }),
      });
      const d = await res.json();
      if (d.success) {
        showToast(`Member added with role: ${inviteRole}`);
        setInviteEmail('');
        await loadOrgDetail(activeOrg.organizationId);
      } else {
        showToast(d.error || 'Failed to add member', false);
      }
    } catch {
      showToast('Network error', false);
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (memberUserId: string, newRole: OrgRole) => {
    if (!activeOrg) return;
    setActionLoading(`role-${memberUserId}`);
    try {
      const res = await fetch(
        `/api/organizations/${activeOrg.organizationId}/members/${memberUserId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        }
      );
      const d = await res.json();
      if (d.success) {
        showToast(`Role changed to ${newRole}`);
        await loadOrgDetail(activeOrg.organizationId);
      } else {
        showToast(d.error || 'Failed to change role', false);
      }
    } catch {
      showToast('Network error', false);
    } finally {
      setActionLoading(null);
    }
  };

  const removeMember = async (memberUserId: string, memberName: string) => {
    if (!activeOrg) return;
    if (!confirm(`Remove ${memberName} from the organization?`)) return;
    setActionLoading(`remove-${memberUserId}`);
    try {
      const res = await fetch(
        `/api/organizations/${activeOrg.organizationId}/members/${memberUserId}`,
        { method: 'DELETE' }
      );
      const d = await res.json();
      if (d.success) {
        showToast(`${memberName} removed`);
        await loadOrgDetail(activeOrg.organizationId);
      } else {
        showToast(d.error || 'Failed to remove member', false);
      }
    } catch {
      showToast('Network error', false);
    } finally {
      setActionLoading(null);
    }
  };

  const suspendMember = async (memberUserId: string, memberName: string) => {
    if (!activeOrg) return;
    if (!confirm(`Suspend ${memberName}? They will lose access until reactivated.`)) return;
    setActionLoading(`suspend-${memberUserId}`);
    try {
      const res = await fetch(
        `/api/organizations/${activeOrg.organizationId}/members/${memberUserId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'suspend' }),
        }
      );
      const d = await res.json();
      if (d.success) {
        showToast(`${memberName} suspended`);
        await loadOrgDetail(activeOrg.organizationId);
      } else {
        showToast(d.error || 'Failed to suspend member', false);
      }
    } catch {
      showToast('Network error', false);
    } finally {
      setActionLoading(null);
    }
  };

  const reactivateMember = async (memberUserId: string, memberName: string) => {
    if (!activeOrg) return;
    setActionLoading(`reactivate-${memberUserId}`);
    try {
      const res = await fetch(
        `/api/organizations/${activeOrg.organizationId}/members/${memberUserId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reactivate' }),
        }
      );
      const d = await res.json();
      if (d.success) {
        showToast(`${memberName} reactivated`);
        await loadOrgDetail(activeOrg.organizationId);
      } else {
        showToast(d.error || 'Failed to reactivate member', false);
      }
    } catch {
      showToast('Network error', false);
    } finally {
      setActionLoading(null);
    }
  };

  // ============================================================================
  // Permission helpers (client-side display only — server is authoritative)
  // ============================================================================

  const canManageMembers = activeOrg?.role === 'owner' || activeOrg?.role === 'admin';
  const canChangeRole = (targetRole: OrgRole): boolean => {
    if (!activeOrg) return false;
    if (activeOrg.role === 'owner') return true;
    if (activeOrg.role === 'admin') return targetRole === 'member' || targetRole === 'viewer';
    return false;
  };
  const canRemoveMember = (targetRole: OrgRole): boolean => {
    if (!activeOrg) return false;
    if (activeOrg.role === 'owner') return true;
    if (activeOrg.role === 'admin') return roleRank(targetRole) > roleRank('admin');
    return false;
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return (
      <div className="card p-6 flex items-center gap-3 text-slate-400">
        <RefreshCw size={14} className="animate-spin" /> Loading organization…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all ${
            toast.ok
              ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
              : 'bg-red-500/20 border border-red-500/40 text-red-300'
          }`}
        >
          {toast.msg}
        </div>
      ) : null}

      {/* Feature status indicator */}
      {features && !features.orgAuthority ? (
        <div className="card p-4 flex items-center gap-3 bg-amber-500/5 border-amber-500/20">
          <AlertCircle size={16} className="text-amber-400" />
          <div className="text-sm text-amber-300">
            Organization authority features are not enabled. Showing legacy organization panel.
          </div>
        </div>
      ) : null}

      {/* Active org header */}
      {activeOrg ? (
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <Building2 size={18} className="text-purple-400" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">{activeOrg.orgName}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  {(() => {
                    const meta = ROLE_META[activeOrg.role] ?? ROLE_META.member;
                    const Icon = meta.icon;
                    return (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${meta.color}`}
                      >
                        <Icon size={9} /> {meta.label}
                      </span>
                    );
                  })()}
                  <span className="text-xs text-slate-500">
                    Context: {activeOrg.source}
                  </span>
                </div>
              </div>
            </div>
            {/* Org switcher — only if active org context feature is enabled */}
            {features?.activeOrgContext ? (
              <div className="relative">
                <button
                  onClick={() => setShowOrgSwitcher(!showOrgSwitcher)}
                  disabled={switchingOrg}
                  className="btn-secondary btn-sm flex items-center gap-1.5"
                >
                  {switchingOrg ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                  Switch Org
                </button>
                {showOrgSwitcher ? (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-slate-900 border border-white/10 rounded-xl shadow-xl z-20 overflow-hidden">
                    <div className="p-2 text-xs text-slate-500 font-medium border-b border-white/5">
                      Your Organizations
                    </div>
                    {userOrgs.length > 0 ? (
                      userOrgs.map((org) => (
                        <button
                          key={org.organizationId}
                          onClick={() => switchOrg(org.organizationId)}
                          className={`w-full text-left px-3 py-2 hover:bg-white/5 transition-colors flex items-center gap-2 ${
                            org.organizationId === activeOrg.organizationId
                              ? 'bg-purple-500/10'
                              : ''
                          }`}
                        >
                          <Building2 size={14} className="text-slate-400" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-white truncate">{org.orgName}</div>
                            <div className="text-xs text-slate-500">{org.role}</div>
                          </div>
                          {org.organizationId === activeOrg.organizationId ? (
                            <CheckCircle size={14} className="text-purple-400" />
                          ) : null}
                        </button>
                      ))
                    ) : (
                      <div className="p-4 text-sm text-slate-500 text-center">
                        No other organizations available
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Building2 size={18} className="text-purple-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold">No Active Organization</h3>
              <p className="text-xs text-slate-400">
                You are not currently in an organization context
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-400">
            Create an organization to invite teammates, share a subscription plan, and manage
            your company&apos;s SolarPro seats.
          </p>
        </div>
      )}

      {/* Members list */}
      {orgDetail ? (
        <div className="card p-5">
          <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Users size={14} className="text-slate-400" /> Members ({orgDetail.members?.length ?? 0})
          </h4>
          <div className="space-y-2">
            {(orgDetail.members ?? []).map((m) => {
              const meta = ROLE_META[m.role] ?? ROLE_META.member;
              const RoleIcon = meta.icon;
              const isSelf = m.userId === userId;
              const canChange = canChangeRole(m.role) && !isSelf;
              const canRemove = canRemoveMember(m.role) && !isSelf;
              const canSuspend = canManageMembers && !isSelf && m.role !== 'owner' && m.status === 'active';
              const canReactivate = canManageMembers && !isSelf && m.status === 'suspended';

              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5"
                >
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {m.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{m.name}</span>
                      {isSelf ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-600/30 text-slate-500">
                          You
                        </span>
                      ) : null}
                      {m.status !== 'active' ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                          {m.status}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{m.email}</div>
                  </div>

                  {/* Role badge / dropdown */}
                  {canChange && features?.membershipWrite ? (
                    <div className="relative">
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.userId, e.target.value as OrgRole)}
                        disabled={actionLoading === `role-${m.userId}`}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium cursor-pointer appearance-none bg-transparent border-0 ${meta.color}`}
                        style={{ paddingRight: '16px' }}
                      >
                        {activeOrg?.role === 'owner'
                          ? ROLE_ORDER.map((r) => (
                              <option key={r} value={r} className="bg-slate-900 text-white">
                                {ROLE_META[r].label}
                              </option>
                            ))
                          : ['member', 'viewer'].map((r) => (
                              <option key={r} value={r} className="bg-slate-900 text-white">
                                {ROLE_META[r].label}
                              </option>
                            ))}
                      </select>
                      {actionLoading === `role-${m.userId}` ? (
                        <RefreshCw size={10} className="animate-spin absolute -right-3 top-1 text-slate-500" />
                      ) : null}
                    </div>
                  ) : (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${meta.color}`}
                    >
                      <RoleIcon size={9} /> {meta.label}
                    </span>
                  )}

                  {/* Action buttons */}
                  {canSuspend && features?.membershipWrite ? (
                    <button
                      onClick={() => suspendMember(m.userId, m.name)}
                      disabled={actionLoading === `suspend-${m.userId}`}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-amber-400 transition-colors"
                      title="Suspend member"
                    >
                      {actionLoading === `suspend-${m.userId}` ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Ban size={13} />
                      )}
                    </button>
                  ) : null}
                  {canReactivate && features?.membershipWrite ? (
                    <button
                      onClick={() => reactivateMember(m.userId, m.name)}
                      disabled={actionLoading === `reactivate-${m.userId}`}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-emerald-400 transition-colors"
                      title="Reactivate member"
                    >
                      {actionLoading === `reactivate-${m.userId}` ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <CheckCircle size={13} />
                      )}
                    </button>
                  ) : null}
                  {canRemove && features?.membershipWrite ? (
                    <button
                      onClick={() => removeMember(m.userId, m.name)}
                      disabled={actionLoading === `remove-${m.userId}`}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 transition-colors"
                      title="Remove member"
                    >
                      {actionLoading === `remove-${m.userId}` ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <UserMinus size={13} />
                      )}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Invite form — admins and owners */}
          {canManageMembers && features?.membershipWrite ? (
            <div className="mt-4 pt-4 border-t border-white/5">
              <div className="text-xs text-slate-400 mb-2 font-medium">Add member by user ID</div>
              <div className="flex items-center gap-2">
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="User ID (UUID)"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') inviteMember();
                  }}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
                >
                  {activeOrg?.role === 'owner'
                    ? ROLE_ORDER.map((r) => (
                        <option key={r} value={r} className="bg-slate-900">
                          {ROLE_META[r].label}
                        </option>
                      ))
                    : ['member', 'viewer'].map((r) => (
                        <option key={r} value={r} className="bg-slate-900">
                          {ROLE_META[r].label}
                        </option>
                      ))}
                </select>
                <button
                  onClick={inviteMember}
                  disabled={inviting || !inviteEmail.trim()}
                  className="btn-primary btn-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {inviting ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    <UserPlus size={12} />
                  )}
                  Add
                </button>
              </div>
              <p className="text-xs text-slate-600 mt-1.5">
                Note: In Phase 1B, members are added by user ID. Email-based invitations will be
                available in a later phase.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
