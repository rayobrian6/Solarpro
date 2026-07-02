'use client';
/**
 * components/settings/CrewMembersPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full crew + employee management UI for the Settings → Teams tab.
 *
 * Features:
 *   - List all crews for the current user
 *   - Create / delete crews (with colour picker)
 *   - Expand a crew to view its members
 *   - Add a member: name, role (dropdown), phone, email, certifications
 *     (multi-select from KNOWN_CERTIFICATIONS), is_lead toggle, notes
 *   - Delete a member
 *   - PATCH inline to toggle is_lead
 *
 * API surface used:
 *   GET    /api/crews                              → list crews
 *   POST   /api/crews                              → create crew
 *   DELETE /api/crews?id=<crewId>                  → delete crew
 *   GET    /api/crews/[id]/members                 → list members
 *   POST   /api/crews/[id]/members                 → add member
 *   DELETE /api/crews/[id]/members/[memberId]      → remove member
 *   PATCH  /api/crews/[id]/members/[memberId]      → update member (is_lead)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  Users, Plus, Trash2, ChevronDown, ChevronRight,
  Star, Phone, Mail, Award, FileText, RefreshCw,
  X, UserPlus, Shield, HardHat,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface Crew {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

interface CrewMember {
  id: string;
  crew_id: string;
  name: string;
  role: string;
  member_type?: string;     // 'employee' | 'subcontractor'
  company?: string | null;
  trade?: string | null;
  phone: string | null;
  email: string | null;
  certifications: string[] | null;
  is_lead: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberCert {
  id: string;
  name: string;
  issuer: string | null;
  issued_on: string | null;
  expires_on: string | null;
  file_url: string | null;
  notes: string | null;
}

const SUBCONTRACTOR_TRADES = [
  'electrical', 'roofing', 'structural', 'hvac', 'general', 'crane', 'other',
];

// Expiry status for a cert (client-side; pure). Mirrors lib/crews certExpiryStatus.
function certStatus(expiresOn: string | null): 'valid' | 'expiring_soon' | 'expired' | 'no_expiry' {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return 'no_expiry';
  const exp = Date.parse(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(exp)) return 'no_expiry';
  const days = (exp - Date.now()) / 86_400_000;
  if (days < 0) return 'expired';
  if (days <= 60) return 'expiring_soon';
  return 'valid';
}

// ── Constants ──────────────────────────────────────────────────────────────

const CREW_MEMBER_ROLES = [
  { value: 'lead_installer',  label: 'Lead Installer'   },
  { value: 'installer',       label: 'Installer'        },
  { value: 'apprentice',      label: 'Apprentice'       },
  { value: 'electrician',     label: 'Electrician'      },
  { value: 'project_manager', label: 'Project Manager'  },
  { value: 'inspector',       label: 'Inspector'        },
  { value: 'laborer',         label: 'Laborer'          },
  { value: 'other',           label: 'Other'            },
];

const KNOWN_CERTIFICATIONS = [
  'NABCEP PV Installation Professional',
  'NABCEP PV Technical Sales',
  'NABCEP PV Associate',
  'OSHA 10',
  'OSHA 30',
  'OSHA 10 Construction',
  'OSHA 30 Construction',
  'Journeyman Electrician',
  'Master Electrician',
  'Electrician Apprentice',
  'First Aid/CPR',
  'Fall Protection',
  'Aerial Work Platform',
  'Forklift',
  'Confined Space Entry',
  'Arc Flash Safety',
  'EV Charging Installation',
  'Battery Storage Systems',
];

const CREW_COLORS = [
  '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRole(role: string): string {
  const found = CREW_MEMBER_ROLES.find(r => r.value === role);
  return found ? found.label : role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function initials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg
        ${ok ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
             : 'bg-red-500/20 border border-red-500/40 text-red-300'}`}
    >
      {msg}
    </div>
  );
}

// ── Add Member Form ────────────────────────────────────────────────────────

interface AddMemberFormProps {
  crewId: string;
  onAdded: () => void;
  onCancel: () => void;
  showToast: (msg: string, ok?: boolean) => void;
}

function AddMemberForm({ crewId, onAdded, onCancel, showToast }: AddMemberFormProps) {
  const [saving, setSaving] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const certRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    name: '',
    role: 'installer',
    member_type: 'employee',
    company: '',
    trade: 'electrical',
    phone: '',
    email: '',
    notes: '',
    is_lead: false,
    certifications: [] as string[],
    customCert: '',
  });
  const isSub = form.member_type === 'subcontractor';

  const set = (key: string, val: unknown) => setForm(f => ({ ...f, [key]: val }));

  const toggleCert = (cert: string) => {
    setForm(f => ({
      ...f,
      certifications: f.certifications.includes(cert)
        ? f.certifications.filter(c => c !== cert)
        : [...f.certifications, cert],
    }));
  };

  const addCustomCert = () => {
    const t = form.customCert.trim();
    if (t && !form.certifications.includes(t)) {
      setForm(f => ({ ...f, certifications: [...f.certifications, t], customCert: '' }));
    }
  };

  // Close cert dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (certRef.current && !certRef.current.contains(e.target as Node)) {
        setCertOpen(false);
      }
    }
    if (certOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [certOpen]);

  const submit = async () => {
    if (!form.name.trim()) { showToast('Name is required', false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/crews/${crewId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          role: form.role,
          member_type: form.member_type,
          company: isSub ? (form.company.trim() || null) : null,
          trade: isSub ? (form.trade.trim() || null) : null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          certifications: form.certifications.length > 0 ? form.certifications : null,
          is_lead: form.is_lead,
          notes: form.notes.trim() || null,
        }),
      });
      const d = await res.json();
      if (d.member) { showToast(isSub ? 'Subcontractor added' : 'Employee added'); onAdded(); }
      else showToast(d.error || 'Failed to add', false);
    } catch {
      showToast('Network error', false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 p-4 rounded-xl bg-white/3 border border-white/8 space-y-3">
      <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
        <UserPlus size={12} className="text-amber-400" /> Add {isSub ? 'Subcontractor' : 'Employee'}
      </div>

      {/* Type toggle: employee vs subcontractor */}
      <div className="flex items-center gap-0.5 bg-slate-800 border border-white/10 rounded-lg overflow-hidden w-fit">
        {(['employee', 'subcontractor'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => set('member_type', t)}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              form.member_type === t ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t === 'employee' ? 'Employee' : 'Subcontractor'}
          </button>
        ))}
      </div>

      {/* Subcontractor fields */}
      {isSub ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-slate-500 font-medium mb-1 block">Company</label>
            <input
              value={form.company}
              onChange={e => set('company', e.target.value)}
              placeholder="e.g. Bolt Electric LLC"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-medium mb-1 block">Trade</label>
            <select
              value={form.trade}
              onChange={e => set('trade', e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
            >
              {SUBCONTRACTOR_TRADES.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {/* Name + Role row */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 font-medium mb-1 block">Full Name *</label>
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Alex Johnson"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 font-medium mb-1 block">Role</label>
          <select
            value={form.role}
            onChange={e => set('role', e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
          >
            {CREW_MEMBER_ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Phone + Email row */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 font-medium mb-1 block">Phone</label>
          <input
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="(555) 000-0000"
            type="tel"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 font-medium mb-1 block">Email</label>
          <input
            value={form.email}
            onChange={e => set('email', e.target.value)}
            placeholder="employee@company.com"
            type="email"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>
      </div>

      {/* Certifications dropdown */}
      <div ref={certRef} className="relative">
        <label className="text-[10px] text-slate-500 font-medium mb-1 block">
          Certifications
          {form.certifications.length > 0 ? (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[9px]">
              {form.certifications.length} selected
            </span>
          ) : null}
        </label>
        <button
          type="button"
          onClick={() => setCertOpen(o => !o)}
          className="w-full flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-400 focus:outline-none hover:border-white/20 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Award size={12} className="text-amber-400/70" />
            {form.certifications.length === 0
              ? 'Select certifications…'
              : form.certifications.slice(0, 2).join(', ') + (form.certifications.length > 2 ? ` +${form.certifications.length - 2}` : '')}
          </span>
          <ChevronDown size={12} className={`transition-transform ${certOpen ? 'rotate-180' : ''}`} />
        </button>

        {certOpen ? (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-slate-900 border border-white/15 rounded-xl shadow-2xl overflow-hidden">
            <div className="max-h-52 overflow-y-auto p-1">
              {KNOWN_CERTIFICATIONS.map(cert => (
                <button
                  key={cert}
                  type="button"
                  onClick={() => toggleCert(cert)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2
                    ${form.certifications.includes(cert)
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'text-slate-300 hover:bg-white/5'}`}
                >
                  <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center
                    ${form.certifications.includes(cert)
                      ? 'bg-amber-500 border-amber-500'
                      : 'border-slate-600'}`}>
                    {form.certifications.includes(cert) ? (
                      <svg className="w-2.5 h-2.5 text-slate-900" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M8.5 2.5L4 7.5 1.5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </div>
                  {cert}
                </button>
              ))}
            </div>
            {/* Custom cert input */}
            <div className="border-t border-white/8 p-2 flex gap-2">
              <input
                value={form.customCert}
                onChange={e => set('customCert', e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomCert(); } }}
                placeholder="Add custom certification…"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
              />
              <button
                type="button"
                onClick={addCustomCert}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 text-xs hover:bg-amber-500/30 transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        ) : null}

        {/* Selected cert tags */}
        {form.certifications.length > 0 ? (
          <div className="flex flex-wrap gap-1 mt-2">
            {form.certifications.map(cert => (
              <span key={cert}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px]"
              >
                {cert}
                <button onClick={() => toggleCert(cert)} className="hover:text-red-400 transition-colors">
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Notes */}
      <div>
        <label className="text-[10px] text-slate-500 font-medium mb-1 block">Notes</label>
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="Any notes about this employee (experience, specialties, etc.)"
          rows={2}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50 resize-none"
        />
      </div>

      {/* Is Lead toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <div
          onClick={() => set('is_lead', !form.is_lead)}
          className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0
            ${form.is_lead ? 'bg-amber-500' : 'bg-slate-700'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all
            ${form.is_lead ? 'left-[18px]' : 'left-0.5'}`} />
        </div>
        <span className="text-sm text-slate-300">
          Crew Lead <span className="text-slate-500 text-xs">(shown as team lead in scheduling)</span>
        </span>
      </label>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          disabled={saving || !form.name.trim()}
          className="btn-primary btn-sm flex items-center gap-1.5 disabled:opacity-50"
        >
          {saving ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
          Add {isSub ? 'Subcontractor' : 'Employee'}
        </button>
        <button onClick={onCancel} className="btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Certification Vault (per member) ────────────────────────────────────────

function MemberCerts({ memberId, showToast }: { memberId: string; showToast: (m: string, ok?: boolean) => void }) {
  const [certs, setCerts] = useState<MemberCert[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ name: '', issuer: '', expires_on: '' });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crew-members/${memberId}/certifications`);
      const d = await res.json();
      setCerts(d.certifications || []);
    } catch { setCerts([]); }
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  const addCert = async () => {
    if (!f.name.trim()) { showToast('Certification name required', false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/crew-members/${memberId}/certifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name.trim(), issuer: f.issuer.trim() || null, expires_on: f.expires_on || null }),
      });
      const d = await res.json();
      if (d.certification) { showToast('Certification added'); setF({ name: '', issuer: '', expires_on: '' }); setAdding(false); load(); }
      else showToast(d.error || 'Failed to add', false);
    } catch { showToast('Network error', false); }
    finally { setSaving(false); }
  };

  const delCert = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}"?`)) return;
    try {
      const res = await fetch(`/api/crew-members/${memberId}/certifications/${id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.deleted) setCerts(c => (c || []).filter(x => x.id !== id));
      else showToast(d.error || 'Failed', false);
    } catch { showToast('Network error', false); }
  };

  const STATUS: Record<string, { cls: string; label: (e: string | null) => string }> = {
    expired:       { cls: 'bg-red-500/15 border-red-500/30 text-red-400',         label: e => `Expired ${e}` },
    expiring_soon: { cls: 'bg-amber-500/15 border-amber-500/30 text-amber-400',   label: e => `Expires ${e}` },
    valid:         { cls: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400', label: e => `Valid to ${e}` },
    no_expiry:     { cls: 'bg-slate-600/20 border-slate-600/30 text-slate-400',    label: () => 'No expiry' },
  };

  if (certs === null) return null;

  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1 flex items-center gap-1">
        <Award size={9} className="text-amber-400/70" /> Certification Vault
      </div>
      {certs.length === 0 && !adding ? (
        <div className="text-[11px] text-slate-600 mb-1">No certifications on file.</div>
      ) : null}
      <div className="space-y-1">
        {certs.map(c => {
          const s = STATUS[certStatus(c.expires_on)];
          return (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <span className="text-slate-300">{c.name}</span>
              {c.issuer ? <span className="text-slate-600 text-[11px]">· {c.issuer}</span> : null}
              <span className={`px-1.5 py-0.5 rounded-full border text-[9px] font-semibold ${s.cls}`}>
                {s.label(c.expires_on)}
              </span>
              <button onClick={() => delCert(c.id, c.name)} className="text-slate-600 hover:text-red-400 ml-auto" title="Remove">
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
      {adding ? (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <input value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Cert / license" className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50" />
          <input value={f.issuer} onChange={e => setF(p => ({ ...p, issuer: e.target.value }))} placeholder="Issuer (optional)" className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50" />
          <input value={f.expires_on} onChange={e => setF(p => ({ ...p, expires_on: e.target.value }))} type="date" title="Expiry date" className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50" />
          <div className="col-span-3 flex gap-2">
            <button onClick={addCert} disabled={saving || !f.name.trim()} className="text-[11px] px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save certification'}
            </button>
            <button onClick={() => setAdding(false)} className="text-[11px] px-2 py-1 rounded text-slate-500 hover:text-white">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-1 text-[11px] text-amber-400/80 hover:text-amber-300 flex items-center gap-1">
          <Plus size={10} /> Add certification
        </button>
      )}
    </div>
  );
}

// ── Crew Row ───────────────────────────────────────────────────────────────

interface CrewRowProps {
  crew: Crew;
  onDeleted: () => void;
  showToast: (msg: string, ok?: boolean) => void;
}

function CrewRow({ crew, onDeleted, showToast }: CrewRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmDeleteCrew, setConfirmDeleteCrew] = useState(false);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crews/${crew.id}/members`);
      const d = await res.json();
      if (d.members) setMembers(d.members);
    } finally {
      setLoading(false);
    }
  }, [crew.id]);

  useEffect(() => {
    if (expanded) loadMembers();
  }, [expanded, loadMembers]);

  const deleteMember = async (memberId: string, memberName: string) => {
    if (!confirm(`Remove ${memberName} from this crew?`)) return;
    try {
      const res = await fetch(`/api/crews/${crew.id}/members/${memberId}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.deleted) {
        showToast(`${memberName} removed`);
        setMembers(m => m.filter(mb => mb.id !== memberId));
      } else {
        showToast(d.error || 'Failed to remove', false);
      }
    } catch {
      showToast('Network error', false);
    }
  };

  const toggleLead = async (member: CrewMember) => {
    try {
      const res = await fetch(`/api/crews/${crew.id}/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_lead: !member.is_lead }),
      });
      const d = await res.json();
      if (d.member) {
        setMembers(ms => ms.map(m => m.id === member.id ? d.member : m));
        showToast(d.member.is_lead ? `${member.name} set as lead` : `${member.name} removed as lead`);
      } else {
        showToast(d.error || 'Failed', false);
      }
    } catch {
      showToast('Network error', false);
    }
  };

  const deleteCrew = async () => {
    try {
      const res = await fetch(`/api/crews?id=${crew.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.deleted) { showToast('Crew deleted'); onDeleted(); }
      else showToast(d.error || 'Failed', false);
    } catch {
      showToast('Network error', false);
    }
  };

  const crewColor = crew.color || '#f59e0b';

  return (
    <div className="card overflow-hidden">
      {/* Crew header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/2 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Color swatch */}
        <div
          className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center"
          style={{ background: `${crewColor}22`, border: `1.5px solid ${crewColor}55` }}
        >
          <HardHat size={14} style={{ color: crewColor }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm">{crew.name}</div>
          <div className="text-xs text-slate-500">
            {expanded
              ? loading ? 'Loading…' : `${members.length} member${members.length !== 1 ? 's' : ''}`
              : 'Click to view members'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Delete crew */}
          <button
            onClick={e => { e.stopPropagation(); setConfirmDeleteCrew(true); }}
            className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 transition-colors"
            title="Delete crew"
          >
            <Trash2 size={13} />
          </button>

          {expanded ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
        </div>
      </div>

      {/* Expanded members list */}
      {expanded ? (
        <div className="border-t border-white/5 px-4 pb-4">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-3">
              <RefreshCw size={13} className="animate-spin" /> Loading members…
            </div>
          ) : members.length === 0 ? (
            <div className="text-slate-500 text-sm py-3 text-center">
              No employees yet. Add your first team member below.
            </div>
          ) : (
            <div className="space-y-2 mt-3">
              {members.map(member => (
                <div
                  key={member.id}
                  className="flex items-start gap-3 p-3 rounded-xl bg-white/3 border border-white/5"
                >
                  {/* Avatar */}
                  <div
                    className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                    style={{ background: `${crewColor}22`, color: crewColor }}
                  >
                    {initials(member.name)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-white">{member.name}</span>
                      {member.is_lead ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center gap-0.5">
                          <Star size={8} fill="currentColor" /> LEAD
                        </span>
                      ) : null}
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700/60 text-slate-400">
                        {formatRole(member.role)}
                      </span>
                      {member.member_type === 'subcontractor' ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 font-bold">
                          SUB{member.trade ? ` · ${member.trade}` : ''}
                        </span>
                      ) : null}
                    </div>

                    {/* Contact */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {member.company ? (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Shield size={9} /> {member.company}
                        </span>
                      ) : null}
                      {member.phone ? (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Phone size={9} /> {member.phone}
                        </span>
                      ) : null}
                      {member.email ? (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Mail size={9} /> {member.email}
                        </span>
                      ) : null}
                    </div>

                    {/* Certifications */}
                    {member.certifications && member.certifications.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {member.certifications.map(cert => (
                          <span
                            key={cert}
                            className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center gap-0.5"
                          >
                            <Award size={7} /> {cert}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {/* Certification vault (structured, with expiry) */}
                    <MemberCerts memberId={member.id} showToast={showToast} />

                    {/* Notes */}
                    {member.notes ? (
                      <p className="text-xs text-slate-600 mt-1 flex items-start gap-1">
                        <FileText size={9} className="mt-0.5 flex-shrink-0" /> {member.notes}
                      </p>
                    ) : null}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleLead(member)}
                      title={member.is_lead ? 'Remove as lead' : 'Set as lead'}
                      className={`p-1.5 rounded-lg transition-colors ${member.is_lead ? 'text-amber-400 bg-amber-500/10' : 'text-slate-600 hover:text-amber-400'}`}
                    >
                      <Star size={13} fill={member.is_lead ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={() => deleteMember(member.id, member.name)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 transition-colors"
                      title="Remove employee"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add member */}
          {adding ? (
            <AddMemberForm
              crewId={crew.id}
              onAdded={() => { setAdding(false); loadMembers(); }}
              onCancel={() => setAdding(false)}
              showToast={showToast}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="mt-3 flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors font-medium"
            >
              <Plus size={12} /> Add Employee
            </button>
          )}
        </div>
      ) : null}

      {/* Delete crew confirm */}
      {confirmDeleteCrew ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-white font-bold mb-2">Delete "{crew.name}"?</h3>
            <p className="text-sm text-slate-400 mb-5">
              All {members.length > 0 ? `${members.length} member${members.length !== 1 ? 's' : ''} and the ` : ''}crew data will be permanently removed. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={deleteCrew}
                className="flex-1 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 text-sm font-semibold hover:bg-red-500/30 transition-colors"
              >
                Delete Crew
              </button>
              <button
                onClick={() => setConfirmDeleteCrew(false)}
                className="flex-1 btn-secondary btn-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────

export default function CrewMembersPanel() {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(CREW_COLORS[0]);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadCrews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/crews');
      const d = await res.json();
      if (d.crews) setCrews(d.crews);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCrews(); }, [loadCrews]);

  const createCrew = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/crews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      const d = await res.json();
      if (d.crew) {
        showToast('Crew created!');
        setCreating(false);
        setNewName('');
        setNewColor(CREW_COLORS[0]);
        loadCrews();
      } else {
        showToast(d.error || 'Failed to create', false);
      }
    } catch {
      showToast('Network error', false);
    }
  };

  return (
    <div className="space-y-5">
      {toast ? <Toast msg={toast.msg} ok={toast.ok} /> : null}

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Users size={18} className="text-amber-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold">Installation Teams</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Manage your crews, employees, certifications and contact details
              </p>
            </div>
          </div>
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="btn-primary btn-sm flex items-center gap-1.5 flex-shrink-0"
            >
              <Plus size={13} /> New Crew
            </button>
          ) : null}
        </div>

        {/* Create crew form */}
        {creating ? (
          <div className="mt-5 pt-5 border-t border-white/8 space-y-3">
            <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
              <Shield size={11} className="text-amber-400" /> Create New Crew
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-medium mb-1 block">Crew Name</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Team Alpha, North Crew, Electric Squad…"
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                onKeyDown={e => {
                  if (e.key === 'Enter') createCrew();
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-medium mb-1.5 block">Team Colour</label>
              <div className="flex gap-2 flex-wrap">
                {CREW_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`w-7 h-7 rounded-full transition-all flex-shrink-0 ${newColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : 'opacity-70 hover:opacity-100'}`}
                    style={{ background: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={createCrew}
                disabled={!newName.trim()}
                className="btn-primary btn-sm disabled:opacity-50"
              >
                Create Crew
              </button>
              <button onClick={() => { setCreating(false); setNewName(''); }} className="btn-secondary btn-sm">
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Crews list */}
      {loading ? (
        <div className="card p-6 flex items-center gap-3 text-slate-400 text-sm">
          <RefreshCw size={14} className="animate-spin" /> Loading crews…
        </div>
      ) : crews.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
            <HardHat size={24} className="text-amber-400/60" />
          </div>
          <h4 className="text-white font-semibold mb-1">No crews yet</h4>
          <p className="text-sm text-slate-500 max-w-xs mx-auto">
            Create your first crew to start adding employees with their roles, certifications, and contact details.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="mt-5 btn-primary inline-flex items-center gap-2"
          >
            <Plus size={14} /> Create Your First Crew
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {crews.map(crew => (
            <CrewRow
              key={crew.id}
              crew={crew}
              onDeleted={loadCrews}
              showToast={showToast}
            />
          ))}
        </div>
      )}

      {/* Info card */}
      <div className="card p-4 border-blue-500/15 bg-blue-500/3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Shield size={14} className="text-blue-400" />
          </div>
          <div>
            <div className="text-xs font-semibold text-blue-300 mb-1">How crew management works</div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Crews you create here appear in the <strong className="text-slate-400">Operations dashboard</strong> for scheduling.
              Each employee can hold multiple certifications (NABCEP, OSHA, Electrician licence, etc.) which are
              visible when assigning jobs. The crew lead is highlighted in the calendar view.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
