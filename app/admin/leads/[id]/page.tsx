'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Save, UserPlus, Phone, Mail, MapPin,
  CheckCircle, Clock, AlertCircle, XCircle, Star,
  ExternalLink, RefreshCw,
} from 'lucide-react';

type User = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  role: string;
};

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'closed';
  converted_project_id: string | null;
  converted_client_id: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  owner_email: string | null;
  project_name: string | null;
  client_name: string | null;
  user_id: string | null;
};

const STATUS_CONFIG = {
  new:       { label: 'New',       color: 'bg-blue-500/20 text-blue-400',    icon: Star },
  contacted: { label: 'Contacted', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  qualified: { label: 'Qualified', color: 'bg-purple-500/20 text-purple-400', icon: AlertCircle },
  converted: { label: 'Converted', color: 'bg-green-500/20 text-green-400',   icon: CheckCircle },
  closed:    { label: 'Closed',    color: 'bg-slate-500/20 text-slate-400',   icon: XCircle },
};

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'closed'] as const;

export default function AdminLeadDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [lead, setLead]           = useState<Lead | null>(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [converting, setConverting] = useState(false);
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null);
  const [users, setUsers]         = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  // Editable fields
  const [editName, setEditName]     = useState('');
  const [editPhone, setEditPhone]   = useState('');
  const [editEmail, setEditEmail]   = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNotes, setEditNotes]   = useState('');
  const [editStatus, setEditStatus] = useState<typeof VALID_STATUSES[number]>('new');

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/leads/${id}`);
      const d = await res.json();
      if (d.success) {
        setLead(d.lead);
        setEditName(d.lead.name || '');
        setEditPhone(d.lead.phone || '');
        setEditEmail(d.lead.email || '');
        setEditAddress(d.lead.address || '');
        setEditNotes(d.lead.notes || '');
        setEditStatus(d.lead.status);
      } else {
        showToast(d.error || 'Failed to load lead', false);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch(`/api/admin/staff`);
      const d = await res.json();
      if (d.success) {
        setUsers(d.staff || []);
      } else {
        console.error('Failed to load staff:', d.error);
      }
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          phone: editPhone || null,
          email: editEmail || null,
          address: editAddress || null,
          notes: editNotes || null,
          status: editStatus,
        }),
      });
      const d = await res.json();
      if (d.success) {
        setLead(d.lead);
        showToast('Saved');
      } else {
        showToast(d.error || 'Save failed', false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConvert = async () => {
    if (!confirm('Convert this lead to a client and project?')) return;
    setConverting(true);
    try {
      const res = await fetch(`/api/admin/leads/${id}/convert`, { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        showToast('Converted — client and project created');
        await load();
      } else {
        showToast(d.error || 'Conversion failed', false);
      }
    } finally {
      setConverting(false);
    }
  };

  const handleAssignUser = async () => {
    if (!selectedUserId) return;
    setAssigning(true);
    try {
      const res = await fetch(`/api/admin/leads/${id}/assign-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId }),
      });
      const d = await res.json();
      if (d.success) {
        showToast('Owner assigned successfully');
        setSelectedUserId('');
        await load();
      } else {
        showToast(d.error || 'Failed to assign owner', false);
      }
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="text-center py-24 text-slate-500">
        Lead not found.{' '}
        <Link href="/admin/leads" className="text-blue-400 hover:underline">Back to leads</Link>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[lead.status];
  const Icon = cfg.icon;
  const isConverted = lead.status === 'converted';

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/admin/leads" className="text-slate-400 hover:text-white transition-colors flex items-center gap-1">
          <ArrowLeft size={14} /> Leads
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-white">{lead.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">{lead.name}</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
              <Icon size={10} />
              {cfg.label}
            </span>
            <span className="text-xs text-slate-500">
              Created {new Date(lead.created_at).toLocaleDateString()}
            </span>
            {lead.owner_name && (
              <span className="text-xs text-slate-500">· Owner: {lead.owner_name}</span>
            )}
          </div>
        </div>

        {/* Convert button */}
        {!isConverted && (
          <button
            onClick={handleConvert}
            disabled={converting}
            className="flex items-center gap-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
          >
            {converting ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <UserPlus size={14} />
            )}
            Convert to Project
          </button>
        )}

        {isConverted && lead.converted_project_id && (
          <Link
            href={`/projects/${lead.converted_project_id}`}
            className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:bg-green-500/20"
          >
            <ExternalLink size={14} />
            View Project
          </Link>
        )}
      </div>
      {/* Assign Owner Section */}
      {!lead.user_id && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm">
          <p className="text-amber-400 font-medium flex items-center gap-2 mb-2">
            <AlertCircle size={14} />
            Owner Not Assigned
          </p>
          <p className="text-slate-400 text-xs mb-3">
            Assign a staff member as owner before converting this lead to a project.
          </p>
          <div className="flex items-center gap-2">
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              disabled={assigning || usersLoading}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 disabled:opacity-50"
            >
              <option value="" className="bg-slate-900">
                {usersLoading ? 'Loading staff...' : users.length === 0 ? 'No staff available' : '— Select staff member —'}
              </option>
              {users.map((u) => (
                <option key={u.id} value={u.id} className="bg-slate-900">
                  {u.name} ({u.role === 'super_admin' ? 'Super Admin' : 'Admin'})
                </option>
              ))}
            </select>
            <button
              onClick={handleAssignUser}
              disabled={!selectedUserId || assigning}
              className="flex items-center gap-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
            >
              {assigning ? <RefreshCw size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Assign
            </button>
          </div>
        </div>
      )}
      {/* Converted notice */}
      {isConverted && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-sm">
          <p className="text-green-400 font-medium flex items-center gap-2">
            <CheckCircle size={14} /> Converted on {lead.converted_at ? new Date(lead.converted_at).toLocaleDateString() : '—'}
          </p>
          {lead.project_name && (
            <p className="text-slate-400 mt-1">Project: <span className="text-white">{lead.project_name}</span></p>
          )}
          {lead.client_name && (
            <p className="text-slate-400 mt-0.5">Client: <span className="text-white">{lead.client_name}</span></p>
          )}
        </div>
      )}

      {/* Edit form */}
      <div className="bg-white/3 border border-white/8 rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-white">Lead Details</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Name *</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Status</label>
            <select
              value={editStatus}
              onChange={e => setEditStatus(e.target.value as typeof VALID_STATUSES[number])}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            >
              {VALID_STATUSES.map(s => (
                <option key={s} value={s} className="bg-slate-900 capitalize">{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              <Mail size={11} className="inline mr-1" />Email
            </label>
            <input
              type="email"
              value={editEmail}
              onChange={e => setEditEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              <Phone size={11} className="inline mr-1" />Phone
            </label>
            <input
              type="tel"
              value={editPhone}
              onChange={e => setEditPhone(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            <MapPin size={11} className="inline mr-1" />Address
          </label>
          <input
            type="text"
            value={editAddress}
            onChange={e => setEditAddress(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Notes</label>
          <textarea
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            rows={4}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 resize-none"
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || !editName.trim()}
            className="flex items-center gap-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-400 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Save Changes
          </button>
        </div>
      </div>

      {/* Portal Access */}
      <div className="bg-white/3 border border-white/8 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-bold text-white">Portal Access</h2>

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs text-slate-400">
              Email on file:{' '}
              <span className="text-white font-medium">{lead.email || '—'}</span>
            </p>
            {lead.converted_project_id && (
              <p className="text-xs text-slate-400">
                Project ID:{' '}
                <span className="text-white font-mono text-[10px]">
                  {lead.converted_project_id}
                </span>
              </p>
            )}
          </div>

          {isConverted && lead.converted_project_id ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              Portal Active
            </span>
          ) : (
            <span className="text-xs text-slate-600 italic">Not yet converted</span>
          )}
        </div>

        {isConverted && lead.email && (
          <p className="text-xs text-slate-500">
            Homeowner can log in at{' '}
            <span className="font-mono text-slate-400">/portal/login</span>{' '}
            using <span className="text-slate-300">{lead.email}</span>.
          </p>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl text-sm font-medium shadow-lg z-50 ${
          toast.ok ? 'bg-green-500/90 text-white' : 'bg-red-500/90 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}