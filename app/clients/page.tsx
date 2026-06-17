'use client';
import React, { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/ui/Toast';
import Link from 'next/link';
import {
  Users, Plus, Search, Phone, Mail, MapPin,
  Zap, DollarSign, ChevronRight, Edit, Trash2,
  AlertTriangle,
  Building2, RefreshCw, AlertCircle, Lock,
  TrendingUp, BarChart2, ArrowRight, Sparkles,
  User2,
  Grid3x3, List, FolderOpen
} from 'lucide-react';
import type { Client } from '@/types';
import { useSubscription } from '@/hooks/useSubscription';
import { useUser } from '@/contexts/UserContext';
import { hasPlatformAccess } from '@/lib/permissions';
import UpgradeModal from '@/components/ui/UpgradeModal';

export default function ClientsPage() {
  const clients      = useAppStore(s => s.clients);
  const clientsState = useAppStore(s => s.clientsState);
  const clientsError = useAppStore(s => s.clientsError);
  const loadClients  = useAppStore(s => s.loadClients);
  const projects     = useAppStore(s => s.projects);
  const removeClient = useAppStore(s => s.removeClient);
  const toast        = useToast();

  const [search, setSearch]         = useState('');
  const [sortBy, setSortBy]         = useState<'name' | 'annualKwh' | 'annualBill'>('name');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    try {
      const saved = localStorage.getItem('solarpro:clientsViewMode');
      if (saved === 'list' || saved === 'grid') return saved;
    } catch { /* ignore */ }
    return 'grid';
  });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const { plan, loading: subLoading } = useSubscription();
  const { user }      = useUser();
  const isUnlimited   = hasPlatformAccess(user);
  const maxClients    = (!subLoading && plan === 'starter' && !isUnlimited) ? 5 : null;
  const atClientLimit = maxClients !== null && clients.length >= maxClients;

  useEffect(() => { loadClients(true); }, [loadClients]);

  const loading = clientsState === 'loading' || clientsState === 'idle';

  const filtered = clients
    .filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()) ||
      (c.address || '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'name')       return a.name.localeCompare(b.name);
      if (sortBy === 'annualKwh')  return b.annualKwh - a.annualKwh;
      return b.annualBill - a.annualBill;
    });

  const handleDelete = async (id: string, name: string) => {
    setConfirmDelete({ id, name });
  };

  const executeDelete = async () => {
    if (!confirmDelete) return;
    try {
      await removeClient(confirmDelete.id);
      toast.success('Client deleted', `"${confirmDelete.name}" has been removed`);
      setConfirmDelete(null);
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : 'Please try again');
      setConfirmDelete(null);
    }
  };

  const totalKwh = clients.reduce((s, c) => s + (c.annualKwh  || 0), 0);
  const totalBill = clients.reduce((s, c) => s + (c.annualBill || 0), 0);

  return (
    <AppShell>
      <div className="p-6 space-y-5 animate-fade-in">

        {/* ══════════ COMMAND HEADER ══════════ */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/60">

          <div className="relative p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-lg bg-teal-500/20 border border-teal-500/30 flex items-center justify-center">
                    <Users size={12} className="text-teal-400" />
                  </div>
                  <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">Client Directory</span>
                  {loading && <RefreshCw size={11} className="text-slate-500 animate-spin" />}
                </div>
                <h1 className="text-2xl font-black text-white tracking-tight">Clients</h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  {loading
                    ? 'Loading clients...'
                    : `${clients.length} clients · ${clients.filter(c => c.annualKwh > 0).length} with usage data${maxClients ? ` · ${maxClients - clients.length} slots left` : ''}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => loadClients(true)} className="btn-ghost p-2 rounded-lg" title="Refresh" disabled={loading}>
                  <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                </button>
                {atClientLimit ? (
                  <button onClick={() => setUpgradeOpen(true)} className="btn-secondary flex items-center gap-2 opacity-70">
                    <Lock size={14} /> Add Client
                    <span className="text-xs text-amber-400 font-normal">({clients.length}/{maxClients})</span>
                  </button>
                ) : (
                  <Link href="/clients/new" className="btn-primary flex items-center gap-1.5">
                    <Plus size={14} /> Add Client
                  </Link>
                )}
              </div>
            </div>

            {/* KPI strip */}
            {!loading && clients.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-slate-900/60 rounded-xl border border-slate-700/40 p-3 text-center">
                  <div className="w-7 h-7 rounded-lg bg-teal-500/15 border border-teal-500/20 flex items-center justify-center mx-auto mb-2">
                    <Users size={12} className="text-teal-400" />
                  </div>
                  <div className="text-xl font-black text-white tabular-nums">{clients.length}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mt-0.5">Total Clients</div>
                </div>
                <div className="bg-slate-900/60 rounded-xl border border-slate-700/40 p-3 text-center">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center mx-auto mb-2">
                    <Zap size={12} className="text-amber-400" />
                  </div>
                  <div className="text-xl font-black text-white tabular-nums">
                    {totalKwh > 0 ? `${(totalKwh / 1000).toFixed(0)}k` : '—'}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mt-0.5">kWh / yr</div>
                </div>
                <div className="bg-slate-900/60 rounded-xl border border-slate-700/40 p-3 text-center">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mx-auto mb-2">
                    <DollarSign size={12} className="text-emerald-400" />
                  </div>
                  <div className="text-xl font-black text-white tabular-nums">
                    ${Math.round(totalBill / Math.max(clients.length, 1)).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mt-0.5">Avg Bill / yr</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Upgrade modal */}
        <UpgradeModal
          isOpen={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          title="Client Limit Reached"
          description={`Starter plan is limited to ${maxClients} clients. Upgrade to Professional for unlimited clients.`}
          requiredPlan="Professional"
        />

        {/* Confirm Delete Modal */}
        {confirmDelete ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-red-400" />
                </div>
                <div>
                  <div className="font-black text-white text-base">Delete Client?</div>
                  <div className="text-slate-400 text-xs mt-0.5">This action cannot be undone.</div>
                </div>
              </div>
              <p className="text-sm text-slate-400 mb-5 leading-relaxed">
                Are you sure you want to delete <span className="text-white font-semibold">{confirmDelete.name}</span>? All associated data will be permanently removed.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(null)} className="flex-1 btn-secondary py-2.5 text-sm">
                  Cancel
                </button>
                <button onClick={executeDelete} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 px-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Starter limit banner */}
        {atClientLimit && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3">
            <Lock size={16} className="text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-amber-300 font-semibold text-sm">Client limit reached ({clients.length}/{maxClients})</p>
              <p className="text-amber-400/70 text-xs mt-0.5">Upgrade to Professional for unlimited clients.</p>
            </div>
            <button onClick={() => setUpgradeOpen(true)} className="btn-primary btn-sm flex-shrink-0">Upgrade</button>
          </div>
        )}

        {/* Error banner */}
        {clientsError && clients.length === 0 && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            <AlertCircle size={16} className="flex-shrink-0" />
            <span>Could not load clients from server.</span>
            <button onClick={() => loadClients(true)} className="ml-auto btn-ghost text-xs px-2 py-1">Retry</button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search clients by name, email, or address..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9 text-sm"
            />
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="select w-auto text-sm">
            <option value="name">Sort by Name</option>
            <option value="annualKwh">Sort by Usage</option>
            <option value="annualBill">Sort by Bill</option>
          </select>
          {/* View toggle — grid/list */}
          <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/60 rounded-xl p-1 flex-shrink-0">
            <button
              onClick={() => { setViewMode('grid'); try { localStorage.setItem('solarpro:clientsViewMode', 'grid'); } catch {} }}
              className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
              title="Card Grid"
            >
              <Grid3x3 size={14} />
            </button>
            <button
              onClick={() => { setViewMode('list'); try { localStorage.setItem('solarpro:clientsViewMode', 'list'); } catch {} }}
              className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
              title="List View"
            >
              <List size={14} />
            </button>
          </div>
        </div>

        {/* Client Grid */}
        {loading && clients.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-2xl border border-slate-700/40 bg-slate-800/60 p-5 space-y-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-700/60" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-700/60 rounded w-2/3" />
                    <div className="h-3 bg-slate-700/40 rounded w-1/2" />
                  </div>
                </div>
                <div className="space-y-2">
                  {[1, 2, 3].map(j => <div key={j} className="h-3 bg-slate-700/40 rounded" />)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-14 bg-slate-700/40 rounded-xl" />
                  <div className="h-14 bg-slate-700/40 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700/60 flex items-center justify-center mx-auto mb-4">
              <Users size={28} className="text-slate-600" />
            </div>
            <p className="text-slate-400 font-semibold">{search ? 'No clients match your search' : 'No clients yet'}</p>
            {!search && (
              <>
                <p className="text-slate-500 text-sm mt-1">Add your first client to get started</p>
                <Link href="/clients/new" className="btn-primary mt-4 inline-flex"><Plus size={16} /> Add Client</Link>
              </>
            )}
          </div>
        ) : (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(client => (
                <ClientCard key={client.id} client={client} onDelete={() => handleDelete(client.id, client.name)} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
              {/* List header */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-700/50 bg-slate-800/50 text-[10px] text-slate-500 uppercase tracking-wide font-semibold">
                <span className="w-9"></span>
                <span className="flex-1">Client</span>
                <span className="hidden lg:block min-w-[140px] text-right">Contact</span>
                <span className="hidden md:block text-right">Usage</span>
                <span className="hidden md:block text-right">Bill</span>
                <span>Actions</span>
              </div>
              {filtered.map(client => {
                const projectCount = projects.filter(p => p.clientId === client.id).length;
                return (
                  <ClientRow
                    key={client.id}
                    client={client}
                    projectCount={projectCount}
                    onDelete={() => handleDelete(client.id, client.name)}
                  />
                );
              })}
              <div className="px-4 py-2.5 border-t border-slate-700/40 bg-slate-800/20 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {filtered.length} client{filtered.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          )
        )}
      </div>
    </AppShell>
  );
}

// ── Client Card — premium elevation ──────────────────────────────────────────
// ── Client Row (compact list view) ──────────────────────────────────────────
function ClientRow({ client, projectCount, onDelete }: { client: Client; projectCount: number; onDelete: () => void }) {
  const hasUsage = client.annualKwh > 0;
  const initials = client.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  const hues = ['amber', 'teal', 'blue', 'purple', 'emerald', 'orange', 'rose'];
  const hue  = hues[(initials.charCodeAt(0) || 0) % hues.length];
  const hueText: Record<string, string> = {
    amber: 'text-amber-300', teal: 'text-teal-300', blue: 'text-blue-300',
    purple: 'text-purple-300', emerald: 'text-emerald-300', orange: 'text-orange-300', rose: 'text-rose-300',
  };

  return (
    <div className="
      relative flex items-center gap-3 px-4 py-3 group transition-all
      hover:bg-slate-800/60 border-b border-slate-700/30 last:border-b-0
    ">
      {/* Avatar */}
      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center font-black text-xs flex-shrink-0 bg-slate-700/40 border-slate-600/40 ${hueText[hue]}`}>
        {initials}
      </div>

      {/* Name + location */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/clients/${client.id}`}
            className="font-semibold text-white text-sm hover:text-amber-300 transition-colors truncate">
            {client.name}
          </Link>
          {projectCount > 0 ? (
            <Link href={`/projects?client=${client.id}`}
              className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-colors">
              <FolderOpen size={8} /> {projectCount} project{projectCount !== 1 ? 's' : ''}
            </Link>
          ) : (
            <span className="text-[10px] text-slate-600 px-1.5 py-0.5 rounded-full border border-slate-700/40">No projects</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
          <span className="flex items-center gap-1 truncate">
            <MapPin size={9} className="flex-shrink-0" />
            {client.city}{client.state ? `, ${client.state}` : ''}
          </span>
        </div>
      </div>

      {/* Contact info — hidden on small screens */}
      <div className="hidden lg:flex flex-col items-end gap-0.5 flex-shrink-0 min-w-[140px]">
        <a href={`mailto:${client.email}`} className="text-xs text-slate-400 hover:text-slate-200 transition-colors truncate w-full text-right">
          {client.email}
        </a>
        <a href={`tel:${client.phone}`} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
          {client.phone}
        </a>
      </div>

      {/* KPI tiles */}
      <div className="hidden md:flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <div className="text-xs font-bold text-white tabular-nums">
            {hasUsage ? `${(client.annualKwh / 1000).toFixed(0)}k` : '\u2014'}
          </div>
          <div className="text-[9px] text-slate-500 uppercase">kWh/yr</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-white tabular-nums">
            {client.annualBill ? `$${client.annualBill.toLocaleString()}` : '\u2014'}
          </div>
          <div className="text-[9px] text-slate-500 uppercase">bill/yr</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Link href={`/projects/new?clientId=${client.id}`}
          className="btn-ghost p-1.5 rounded-lg text-slate-500 hover:text-amber-400 transition-colors"
          title="New Project">
          <Plus size={13} />
        </Link>
        <Link href={`/clients/${client.id}`}
          className="btn-ghost p-1.5 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
          title="View Details">
          <ArrowRight size={13} />
        </Link>
        <div className="relative flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link href={`/clients/${client.id}/edit`}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700/60 transition-all">
            <Edit size={13} />
          </Link>
          <button onClick={onDelete}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientCard({ client, onDelete }: { client: Client; onDelete: () => void }) {
  const initials   = client.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  const hasUsage   = client.annualKwh > 0;
  const billPerMonth = client.annualBill ? Math.round(client.annualBill / 12) : 0;

  // Pick a consistent hue from initials char code
  const hues = ['amber', 'teal', 'blue', 'purple', 'emerald', 'orange', 'rose'];
  const hue  = hues[(initials.charCodeAt(0) || 0) % hues.length];

  const hueCfg: Record<string, { avatar: string; border: string; bar: string }> = {
    amber:   { avatar: 'border-amber-500/30 text-amber-300 bg-amber-500/15',   border: 'border-amber-700/30',   bar: 'bg-amber-500' },
    teal:    { avatar: 'border-teal-500/30 text-teal-300 bg-teal-500/15',       border: 'border-teal-700/30',    bar: 'bg-teal-500'  },
    blue:    { avatar: 'border-blue-500/30 text-blue-300 bg-blue-500/15',       border: 'border-blue-700/30',    bar: 'bg-blue-500'  },
    purple:  { avatar: 'border-purple-500/30 text-purple-300 bg-purple-500/15', border: 'border-purple-700/30', bar: 'bg-purple-500' },
    emerald: { avatar: 'border-emerald-500/30 text-emerald-300 bg-emerald-500/15', border: 'border-emerald-700/30', bar: 'bg-emerald-500' },
    orange:  { avatar: 'border-orange-500/30 text-orange-300 bg-orange-500/15', border: 'border-orange-700/30',  bar: 'bg-orange-500' },
    rose:    { avatar: 'border-rose-500/30 text-rose-300 bg-rose-500/15',       border: 'border-rose-700/30',    bar: 'bg-rose-500'  },
  };
  const hc = hueCfg[hue];

  return (
    <div className={`
      relative group rounded-xl border border-slate-700/60 bg-slate-800/60
      transition-all duration-200 hover:border-slate-600/80
    `}>
      {/* Top accent stripe */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${hc.bar} opacity-60`} />

      <div className="relative p-5">
        {/* Header row: avatar + name + edit/delete */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className={`w-11 h-11 rounded-xl border flex items-center justify-center font-black text-sm flex-shrink-0 ${hc.avatar}`}>
              {initials}
            </div>
            <div>
              <h3 className="font-bold text-white text-sm leading-tight">{client.name}</h3>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <MapPin size={9} className="flex-shrink-0" />
                {client.city}{client.state ? `, ${client.state}` : ''}
              </p>
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Link href={`/clients/${client.id}/edit`}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700/60 transition-all">
              <Edit size={13} />
            </Link>
            <button onClick={onDelete}
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Contact pills */}
        <div className="space-y-1.5 mb-4">
          <a href={`mailto:${client.email}`}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors group/link">
            <div className="w-5 h-5 rounded-md bg-slate-700/60 flex items-center justify-center flex-shrink-0">
              <Mail size={10} className="text-slate-500 group-hover/link:text-slate-300 transition-colors" />
            </div>
            <span className="truncate">{client.email}</span>
          </a>
          <a href={`tel:${client.phone}`}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors group/link">
            <div className="w-5 h-5 rounded-md bg-slate-700/60 flex items-center justify-center flex-shrink-0">
              <Phone size={10} className="text-slate-500 group-hover/link:text-slate-300 transition-colors" />
            </div>
            <span>{client.phone}</span>
          </a>
          {client.utilityProvider && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="w-5 h-5 rounded-md bg-slate-700/60 flex items-center justify-center flex-shrink-0">
                <Building2 size={10} className="text-slate-500" />
              </div>
              <span className="truncate">{client.utilityProvider}</span>
            </div>
          )}
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-slate-900/70 rounded-xl border border-slate-700/50 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="w-5 h-5 rounded-md bg-amber-500/15 flex items-center justify-center">
                <Zap size={10} className="text-amber-400" />
              </div>
              <span className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Annual Usage</span>
            </div>
            <div className="text-sm font-black text-white">
              {hasUsage ? (
                <>{client.annualKwh.toLocaleString()} <span className="text-xs font-normal text-slate-400">kWh</span></>
              ) : <span className="text-slate-600">—</span>}
            </div>
          </div>
          <div className="bg-slate-900/70 rounded-xl border border-slate-700/50 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="w-5 h-5 rounded-md bg-emerald-500/15 flex items-center justify-center">
                <DollarSign size={10} className="text-emerald-400" />
              </div>
              <span className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Annual Bill</span>
            </div>
            <div className="text-sm font-black text-white">
              {client.annualBill ? (
                <>${client.annualBill.toLocaleString()}</>
              ) : <span className="text-slate-600">—</span>}
            </div>
          </div>
        </div>

        {/* Monthly usage sparkline */}
        {client.monthlyKwh?.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Monthly kWh</span>
              {billPerMonth > 0 && (
                <span className="text-[10px] text-emerald-400 font-semibold">~${billPerMonth}/mo</span>
              )}
            </div>
            <div className="flex items-end gap-0.5 h-9 bg-slate-900/40 rounded-lg p-1">
              {client.monthlyKwh.map((kwh, i) => {
                const max = Math.max(...client.monthlyKwh, 1);
                const pct = (kwh / max) * 100;
                const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full">
                    <div
                      className={`w-full rounded-sm transition-all hover:opacity-100 opacity-70 ${hc.bar}`}
                      style={{ height: `${Math.max(pct, 4)}%` }}
                      title={`${months[i]}: ${kwh.toLocaleString()} kWh`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action row */}
        <div className="flex gap-2 pt-3 border-t border-slate-700/40">
          <Link href={`/projects/new?clientId=${client.id}`}
            className="btn-primary btn-sm flex-1 justify-center text-xs">
            <Plus size={11} /> New Project
          </Link>
          <Link href={`/clients/${client.id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-700/40 hover:bg-slate-700/70 border border-slate-700/60 transition-all">
            View <ArrowRight size={11} />
          </Link>
        </div>
      </div>
    </div>
  );
}