'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Search, RefreshCw, Plus, UserPlus, Phone, Mail,
  MapPin, CheckCircle, Clock, AlertCircle, XCircle, Star,
  Globe, Users, DoorOpen, PhoneCall, Share2, Megaphone,
  Handshake, Calendar, HelpCircle,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'closed';
  lead_source: string | null;
  converted_project_id: string | null;
  converted_client_id: string | null;
  converted_at: string | null;
  created_at: string;
  owner_name: string | null;
  owner_email: string | null;
  project_name: string | null;
};

const STATUS_CONFIG = {
  new:       { label: 'New',       color: 'bg-blue-500/20 text-blue-400',    icon: Star },
  contacted: { label: 'Contacted', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  qualified: { label: 'Qualified', color: 'bg-purple-500/20 text-purple-400', icon: AlertCircle },
  converted: { label: 'Converted', color: 'bg-green-500/20 text-green-400',   icon: CheckCircle },
  closed:    { label: 'Closed',    color: 'bg-slate-500/20 text-slate-400',   icon: XCircle },
};

const LEAD_SOURCE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  referral:    { label: 'Referral',    icon: Users,      color: 'text-emerald-400' },
  website:     { label: 'Website',     icon: Globe,      color: 'text-blue-400' },
  door_knock:  { label: 'Door Knock',  icon: DoorOpen,   color: 'text-amber-400' },
  phone:       { label: 'Phone',       icon: PhoneCall,  color: 'text-cyan-400' },
  social_media:{ label: 'Social',      icon: Share2,     color: 'text-pink-400' },
  paid_ad:     { label: 'Paid Ad',     icon: Megaphone,  color: 'text-violet-400' },
  trade_show:  { label: 'Trade Show',  icon: Calendar,   color: 'text-orange-400' },
  partner:     { label: 'Partner',     icon: Handshake,  color: 'text-teal-400' },
  other:       { label: 'Other',       icon: HelpCircle, color: 'text-slate-400' },
};

const VALID_SOURCES = [
  'referral', 'website', 'door_knock', 'phone',
  'social_media', 'paid_ad', 'trade_show', 'partner', 'other',
] as const;

const STATUSES = ['all', 'new', 'contacted', 'qualified', 'converted', 'closed'] as const;

function LeadSourceBadge({ source }: { source: string | null }) {
  if (!source) return <span className="text-xs text-slate-600">—</span>;
  const cfg = LEAD_SOURCE_CONFIG[source];
  if (!cfg) return <span className="text-xs text-slate-400 capitalize">{source.replace(/_/g, ' ')}</span>;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

export default function AdminLeads() {
  const [leads, setLeads]       = useState<Lead[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState<typeof STATUSES[number]>('all');
  const [loading, setLoading]   = useState(true);
  const toast = useToast();

  // Modal state
  const [showModal, setShowModal]         = useState(false);
  const [saving, setSaving]               = useState(false);
  const [formName, setFormName]           = useState('');
  const [formEmail, setFormEmail]         = useState('');
  const [formPhone, setFormPhone]         = useState('');
  const [formAddress, setFormAddress]     = useState('');
  const [formNotes, setFormNotes]         = useState('');
  const [formSource, setFormSource]       = useState<string>('');
  const LIMIT = 50;

  

  const resetForm = () => {
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormAddress('');
    setFormNotes('');
    setFormSource('');
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formEmail.trim()) {
      toast.error('Name and email are required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/leads', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:        formName.trim(),
          email:       formEmail.trim(),
          phone:       formPhone.trim() || null,
          address:     formAddress.trim() || null,
          notes:       formNotes.trim() || null,
          lead_source: formSource || null,
        }),
      });
      const d = await res.json();
      if (d.success) {
        setShowModal(false);
        resetForm();
        toast.error('✓ Lead created');
        load();
      } else {
        toast.success(d.error || 'Failed to create lead');
      }
    } catch {
      toast.error('Connection error');
    } finally {
      setSaving(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/leads?search=${encodeURIComponent(search)}&status=${status}&page=${page}&limit=${LIMIT}`
      );
      const d = await res.json();
      if (d.success) {
        setLeads(d.leads);
        setTotal(d.total);
      }
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Leads</h1>
          <p className="text-sm text-slate-400 mt-1">{total.toLocaleString()} total leads</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/30 rounded-lg px-3 py-2 transition-all"
          >
            <Plus size={12} /> Add Lead
          </button>
          <button
            onClick={load}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Search + status filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, address, phone…"
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all ${
                status === s
                  ? 'bg-blue-500/30 text-blue-300 border border-blue-500/40'
                  : 'bg-white/5 text-slate-400 border border-white/10 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white/3 border border-white/8 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-xs text-slate-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Lead</th>
                <th className="text-left px-4 py-3 font-medium">Contact</th>
                <th className="text-left px-4 py-3 font-medium">Address</th>
                <th className="text-left px-4 py-3 font-medium">Source</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Owner</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    <RefreshCw size={16} className="animate-spin inline mr-2" /> Loading…
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    No leads found.
                  </td>
                </tr>
              ) : leads.map(lead => {
                const cfg = STATUS_CONFIG[lead.status];
                const Icon = cfg.icon;
                return (
                  <tr key={lead.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin/leads/${lead.id}`} className="font-medium text-white hover:text-blue-400 transition-colors">
                        {lead.name}
                      </Link>
                      {lead.notes ? (
                        <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[180px]">{lead.notes}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {lead.email ? (
                        <div className="flex items-center gap-1 text-xs">
                          <Mail size={11} className="text-slate-500" />
                          {lead.email}
                        </div>
                      ) : null}
                      {lead.phone ? (
                        <div className="flex items-center gap-1 text-xs mt-0.5">
                          <Phone size={11} className="text-slate-500" />
                          {lead.phone}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {lead.address ? (
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <MapPin size={11} className="text-slate-500 shrink-0" />
                          <span className="truncate max-w-[160px]">{lead.address}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <LeadSourceBadge source={lead.lead_source} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                        <Icon size={10} />
                        {cfg.label}
                      </span>
                      {lead.status === 'converted' && lead.project_name ? (
                        <p className="text-xs text-slate-500 mt-0.5">
                          → {lead.project_name}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {lead.owner_name || lead.owner_email || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/leads/${lead.id}`}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-white/10 rounded-lg disabled:opacity-40 hover:text-white transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border border-white/10 rounded-lg disabled:opacity-40 hover:text-white transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {/* Create Lead Modal */}
      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          {/* Backdrop */}
          <div
            onClick={() => setShowModal(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-md bg-[#0f1015] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-base font-bold text-white">New Lead</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <XCircle size={16} />
              </button>
            </div>

            {/* Form */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Name *
                </label>
                <div className="relative">
                  <UserPlus size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                  <input
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Email *
                </label>
                <div className="relative">
                  <Mail size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                  <input
                    type="email"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                    placeholder="jane@example.com"
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Phone
                </label>
                <div className="relative">
                  <Phone size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={e => setFormPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Address
                </label>
                <div className="relative">
                  <MapPin size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                  <input
                    type="text"
                    value={formAddress}
                    onChange={e => setFormAddress(e.target.value)}
                    placeholder="123 Solar Street, San Francisco, CA"
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              {/* Lead Source dropdown */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Lead Source
                </label>
                <select
                  value={formSource}
                  onChange={e => setFormSource(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50 appearance-none"
                >
                  <option value="">— Unknown / Not set —</option>
                  {VALID_SOURCES.map(s => (
                    <option key={s} value={s} className="bg-[#0f1015]">
                      {LEAD_SOURCE_CONFIG[s]?.label ?? s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Notes
                </label>
                <textarea
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="Optional notes..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50 resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-white/2">
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="text-xs font-medium text-slate-400 hover:text-white transition-colors px-4 py-2"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !formName.trim() || !formEmail.trim()}
                className="flex items-center gap-2 text-xs font-semibold text-black bg-amber-500 hover:bg-amber-400 rounded-lg px-4 py-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                {saving ? 'Creating...' : 'Create Lead'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
