'use client';
import React, { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/ui/Toast';
import Link from 'next/link';
import {
  Users, Plus, Search, Phone, Mail, MapPin,
  Zap, DollarSign, ChevronRight, Edit, Trash2,
  Building2, RefreshCw, AlertCircle, Lock
} from 'lucide-react';
import type { Client } from '@/types';
import { useSubscription } from '@/hooks/useSubscription';
import UpgradeModal from '@/components/ui/UpgradeModal';

export default function ClientsPage() {
  const clients = useAppStore(s => s.clients);
  const clientsState = useAppStore(s => s.clientsState);
  const clientsError = useAppStore(s => s.clientsError);
  const loadClients = useAppStore(s => s.loadClients);
  const removeClient = useAppStore(s => s.removeClient);
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'annualKwh' | 'annualBill'>('name');
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Plan gating — Starter: max 5 clients
  const { plan } = useSubscription();
  const maxClients = plan === 'starter' ? 5 : null;
  const atClientLimit = maxClients !== null && clients.length >= maxClients;

  // Always reload from server on page visit
  useEffect(() => {
    loadClients(true);
  }, [loadClients]);

  const loading = clientsState === 'loading' || clientsState === 'idle';

  const filtered = clients
    .filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()) ||
      (c.address || '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'annualKwh') return b.annualKwh - a.annualKwh;
      return b.annualBill - a.annualBill;
    });

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete client "${name}"? This cannot be undone.`)) return;
    try {
      await removeClient(id);
      toast.success('Client deleted', `"${name}" has been removed`);
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : 'Please try again');
    }
  };

  return (
    <AppShell>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Clients</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {loading ? 'Loading...' : `${clients.length} total clients`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadClients(true)}
              className="btn-ghost p-2 rounded-lg"
              title="Refresh clients"
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            {atClientLimit ? (
              <button onClick={() => setUpgradeOpen(true)} className="btn-secondary flex items-center gap-2 opacity-70">
                <Lock size={14} /> Add Client
                <span className="text-xs text-amber-400 font-normal">({clients.length}/{maxClients})</span>
              </button>
            ) : (
              <Link href="/clients/new" className="btn-primary">
                <Plus size={16} /> Add Client
              </Link>
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

        {/* Starter limit banner */}
        {atClientLimit && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3">
            <Lock size={16} className="text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-amber-300 font-semibold text-sm">Client limit reached ({clients.length}/{maxClients})</p>
              <p className="text-amber-400/70 text-xs mt-0.5">Starter plan allows up to {maxClients} clients. Upgrade to Professional for unlimited clients.</p>
            </div>
            <button onClick={() => setUpgradeOpen(true)} className="btn-primary btn-sm flex-shrink-0">Upgrade</button>
          </div>
        )}

        {/* Error banner */}
        {clientsError && clients.length === 0 && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            <AlertCircle size={16} className="flex-shrink-0" />
            <span>Could not load clients from server. Showing cached data.</span>
            <button onClick={() => loadClients(true)} className="ml-auto btn-ghost text-xs px-2 py-1">
              Retry
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search clients..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="select w-auto"
          >
            <option value="name">Sort by Name</option>
            <option value="annualKwh">Sort by Usage</option>
            <option value="annualBill">Sort by Bill</option>
          </select>
        </div>

        {/* Client Grid */}
        {loading && clients.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="card p-5 space-y-3">
                <div className="shimmer h-5 w-2/3 rounded" />
                <div className="shimmer h-4 w-full rounded" />
                <div className="shimmer h-4 w-3/4 rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <Users size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">
              {search ? 'No clients match your search' : 'No clients yet'}
            </p>
            {!search && (
              <>
                <p className="text-slate-500 text-sm mt-1">Add your first client to get started</p>
                <Link href="/clients/new" className="btn-primary mt-4 inline-flex">
                  <Plus size={16} /> Add Client
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(client => (
              <ClientCard
                key={client.id}
                client={client}
                onDelete={() => handleDelete(client.id, client.name)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ClientCard({ client, onDelete }: { client: Client; onDelete: () => void }) {
  return (
    <div className="card-hover p-5 group">
      {/* Client Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm flex-shrink-0">
            {client.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm leading-tight">{client.name}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{client.city}, {client.state}</p>
          </div>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link href={`/clients/${client.id}/edit`} className="btn-ghost p-1.5 rounded-lg">
            <Edit size={13} />
          </Link>
          <button onClick={onDelete} className="btn-ghost p-1.5 rounded-lg hover:text-red-400">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Contact Info */}
      <div className="space-y-1.5 mb-4">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Mail size={11} className="text-slate-500 flex-shrink-0" />
          <span className="truncate">{client.email}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Phone size={11} className="text-slate-500 flex-shrink-0" />
          <span>{client.phone}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <MapPin size={11} className="text-slate-500 flex-shrink-0" />
          <span className="truncate">{client.address}</span>
        </div>
        {client.utilityProvider && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Building2 size={11} className="text-slate-500 flex-shrink-0" />
            <span className="truncate">{client.utilityProvider}</span>
          </div>
        )}
      </div>

      {/* Usage Stats */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-slate-800/60 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap size={11} className="text-amber-400" />
            <span className="text-xs text-slate-400">Annual Usage</span>
          </div>
          <div className="text-sm font-bold text-white">
            {client.annualKwh.toLocaleString()} <span className="text-xs font-normal text-slate-400">kWh</span>
          </div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign size={11} className="text-emerald-400" />
            <span className="text-xs text-slate-400">Annual Bill</span>
          </div>
          <div className="text-sm font-bold text-white">
            ${client.annualBill.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Monthly Usage Mini Chart */}
      {client.monthlyKwh?.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-slate-500 mb-1.5">Monthly Usage (kWh)</div>
          <div className="flex items-end gap-0.5 h-8">
            {client.monthlyKwh.map((kwh, i) => {
              const max = Math.max(...client.monthlyKwh, 1);
              const pct = (kwh / max) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 bg-amber-500/60 rounded-sm transition-all hover:bg-amber-400"
                  style={{ height: `${pct}%` }}
                  title={`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]}: ${kwh} kWh`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-slate-700/50">
        <Link
          href={`/projects/new?clientId=${client.id}`}
          className="btn-primary btn-sm flex-1 justify-center"
        >
          <Plus size={12} /> New Project
        </Link>
        <Link
          href={`/clients/${client.id}`}
          className="btn-secondary btn-sm"
        >
          <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  );
}