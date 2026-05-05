'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Search, RefreshCw, Plus, UserPlus, Phone, Mail,
  MapPin, CheckCircle, Clock, AlertCircle, XCircle, Star,
} from 'lucide-react';

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
  owner_name: string | null;
  owner_email: string | null;
  project_name: string | null;
};

const STATUS_CONFIG = {
  new:       { label: 'New',       color: 'bg-blue-500/20 text-blue-400',   icon: Star },
  contacted: { label: 'Contacted', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  qualified: { label: 'Qualified', color: 'bg-purple-500/20 text-purple-400', icon: AlertCircle },
  converted: { label: 'Converted', color: 'bg-green-500/20 text-green-400',  icon: CheckCircle },
  closed:    { label: 'Closed',    color: 'bg-slate-500/20 text-slate-400',   icon: XCircle },
};

const STATUSES = ['all', 'new', 'contacted', 'qualified', 'converted', 'closed'] as const;

export default function AdminLeads() {
  const [leads, setLeads]       = useState<Lead[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState<typeof STATUSES[number]>('all');
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);
  const LIMIT = 50;

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
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
        <button
          onClick={load}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
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
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Owner</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <RefreshCw size={16} className="animate-spin inline mr-2" /> Loading…
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
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
                      {lead.notes && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[180px]">{lead.notes}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {lead.email && (
                        <div className="flex items-center gap-1 text-xs">
                          <Mail size={11} className="text-slate-500" />
                          {lead.email}
                        </div>
                      )}
                      {lead.phone && (
                        <div className="flex items-center gap-1 text-xs mt-0.5">
                          <Phone size={11} className="text-slate-500" />
                          {lead.phone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.address ? (
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <MapPin size={11} className="text-slate-500 shrink-0" />
                          <span className="truncate max-w-[180px]">{lead.address}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                        <Icon size={10} />
                        {cfg.label}
                      </span>
                      {lead.status === 'converted' && lead.project_name && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          → {lead.project_name}
                        </p>
                      )}
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
      {totalPages > 1 && (
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
      )}

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