'use client';
import React, { useEffect, useState, useCallback } from 'react';
import {
  DollarSign, Plus, Trash2, Save, X, RefreshCw, Search,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle,
  Database, Package, Tag, TrendingUp, ToggleLeft, ToggleRight,
  Info, Zap, Download
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceEntry {
  id?: string;
  partNumber: string;
  category: string;
  unitCost: number;
  source: string;
  asOf: string;
  listPrice?: number;
  netPrice?: number;
  isOverride?: boolean;
  isActive?: boolean;
  scope?: 'global' | 'company';
}

interface ApiResponse {
  overrides: PriceEntry[];
  catalog: PriceEntry[];
  fallbacks: { category: string; unitCost: number }[];
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    CED:      'bg-blue-500/15 text-blue-400 border-blue-500/30',
    Soligent: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    KWh:      'bg-purple-500/15 text-purple-400 border-purple-500/30',
    Internal: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    DB:       'bg-rose-500/15 text-rose-400 border-rose-500/30',
    Override: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  };
  const cls = colors[source] || 'bg-slate-700/60 text-slate-400 border-slate-600/50';
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>
      {source}
    </span>
  );
}

// ─── Add/Edit Override Modal ──────────────────────────────────────────────────

function OverrideModal({
  entry,
  onSave,
  onClose,
}: {
  entry?: Partial<PriceEntry>;
  onSave: (data: Partial<PriceEntry>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<PriceEntry>>({
    partNumber: entry?.partNumber || '',
    category:   entry?.category   || '',
    unitCost:   entry?.unitCost   || 0,
    source:     entry?.source     || 'Internal',
  });
  const set = (k: keyof PriceEntry, v: any) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50 bg-slate-800/60">
          <div className="flex items-center gap-2">
            <DollarSign size={15} className="text-amber-400" />
            <span className="text-sm font-bold text-white">
              {entry?.id ? 'Edit Price Override' : 'New Price Override'}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-medium">Part Number</label>
            <input
              type="text"
              value={form.partNumber}
              onChange={e => set('partNumber', e.target.value)}
              placeholder="e.g. REC400AA or * (wildcard)"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
            <p className="text-[10px] text-slate-500 mt-1">Use <code className="text-amber-400">*</code> as a wildcard to override all parts in a category.</p>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-medium">Category</label>
            <input
              type="text"
              value={form.category}
              onChange={e => set('category', e.target.value)}
              placeholder="e.g. panel, inverter, racking"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-medium">Unit Cost ($/unit)</label>
            <div className="relative">
              <DollarSign size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.unitCost}
                onChange={e => set('unitCost', parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-medium">Source</label>
            <select
              value={form.source}
              onChange={e => set('source', e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
            >
              <option value="Internal">Internal</option>
              <option value="CED">CED Greentech</option>
              <option value="Soligent">Soligent</option>
              <option value="KWh">KWh Analytics</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-700/50 bg-slate-800/40">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.partNumber || !form.category || (form.unitCost ?? 0) <= 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-white hover:bg-amber-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20"
          >
            <Save size={12} /> Save Override
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DistributorPricesPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState<'overrides' | 'catalog' | 'fallbacks'>('overrides');
  const [showModal, setShowModal] = useState(false);
  const [editEntry, setEditEntry] = useState<PriceEntry | undefined>();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<null | { message: string; onConfirm: () => void }>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/distributor-prices');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    if (type === 'success') { setSuccess(msg); setTimeout(() => setSuccess(null), 3000); }
    else { setError(msg); setTimeout(() => setError(null), 5000); }
  };

  const handleSave = async (form: Partial<PriceEntry>) => {
    setSaving(true);
    try {
      const body = {
        partNumber: form.partNumber,
        category:   form.category,
        unitCost:   form.unitCost,
        source:     form.source || 'Internal',
        ...(editEntry?.id ? { id: editEntry.id } : {}),
      };
      const res = await fetch('/api/admin/distributor-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      flash(`Override saved for ${form.partNumber}`);
      setShowModal(false);
      setEditEntry(undefined);
      await load();
    } catch (e: any) {
      flash(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string, partNumber: string) => {
    setConfirmDialog({
      message: `Delete override for ${partNumber}?`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/distributor-prices?id=${id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          flash(`Override deleted`);
          await load();
        } catch (e: any) {
          flash(e.message, 'error');
        }
      },
    });
  };

  const handleExportCsv = () => {
    const rows = [
      ['Part Number', 'Category', 'Unit Cost', 'Source', 'Type'],
      ...(data?.overrides || []).map(r => [r.partNumber, r.category, r.unitCost, r.source, 'Override']),
      ...(data?.catalog   || []).map(r => [r.partNumber, r.category, r.unitCost, r.source, 'Catalog']),
      ...(data?.fallbacks || []).map(r => [r.category, r.category, r.unitCost, 'Fallback', 'Fallback']),
    ];
    const csv = rows.map(r => r.map(String).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'distributor-prices.csv'; a.click();
  };

  // ── Filter helper ────────────────────────────────────────────────────────────
  const q = search.toLowerCase();
  const filterFn = (e: PriceEntry) =>
    !q || e.partNumber.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || (e.source || '').toLowerCase().includes(q);

  // ── Stats ────────────────────────────────────────────────────────────────────
  const stats = data ? {
    overrides:  data.overrides.length,
    catalog:    data.catalog.length,
    fallbacks:  data.fallbacks.length,
    avgCost:    data.catalog.length ? (data.catalog.reduce((s, e) => s + e.unitCost, 0) / data.catalog.length) : 0,
  } : null;

  // ── Group catalog by category ────────────────────────────────────────────────
  const catalogByCategory = data?.catalog.reduce<Record<string, PriceEntry[]>>((acc, e) => {
    (acc[e.category] = acc[e.category] || []).push(e);
    return acc;
  }, {}) || {};

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <DollarSign size={20} className="text-amber-400" />
            Distributor Pricing
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage live pricing overrides · Static catalog · Category fallbacks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-400 hover:text-white hover:border-slate-600 transition-all"
          >
            <Download size={12} /> Export CSV
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-400 hover:text-white transition-all"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => { setEditEntry(undefined); setShowModal(true); }}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-400 transition-all shadow-lg shadow-amber-500/20"
          >
            <Plus size={12} /> Add Override
          </button>
        </div>
      </div>

      {/* ── Flash banners ── */}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-sm">
          <CheckCircle size={14} /> {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* ── Stats cards ── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-rose-500/20 bg-slate-800/60 px-4 py-3">
            <div className="text-2xl font-black text-rose-400 tabular-nums">{stats.overrides}</div>
            <div className="text-xs text-slate-500 mt-0.5">DB Overrides</div>
          </div>
          <div className="rounded-xl border border-blue-500/20 bg-slate-800/60 px-4 py-3">
            <div className="text-2xl font-black text-blue-400 tabular-nums">{stats.catalog}</div>
            <div className="text-xs text-slate-500 mt-0.5">Catalog Entries</div>
          </div>
          <div className="rounded-xl border border-purple-500/20 bg-slate-800/60 px-4 py-3">
            <div className="text-2xl font-black text-purple-400 tabular-nums">{stats.fallbacks}</div>
            <div className="text-xs text-slate-500 mt-0.5">Category Fallbacks</div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-slate-800/60 px-4 py-3">
            <div className="text-2xl font-black text-amber-400 tabular-nums">
              ${stats.avgCost.toFixed(2)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Avg Catalog Cost</div>
          </div>
        </div>
      )}

      {/* ── Pricing resolution explanation ── */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-slate-400 leading-relaxed">
            <span className="text-white font-semibold">3-tier pricing resolution:</span>{' '}
            <span className="text-rose-400 font-semibold">DB Overrides</span> (highest priority — per-company or global) →{' '}
            <span className="text-blue-400 font-semibold">Static Catalog</span> (CED/Soligent/KWh Q1 2025) →{' '}
            <span className="text-purple-400 font-semibold">Category Fallbacks</span> (lowest — catches unknown SKUs).
            Wildcard overrides (<code className="text-amber-400">*</code> part number) apply to all SKUs in a category.
          </div>
        </div>
      </div>

      {/* ── Search bar ── */}
      <div className="relative">
        <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by part number, category, or source…"
          className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
            <X size={13} />
          </button>
        )}
      </div>

      {/* ── Section tabs ── */}
      <div className="flex gap-1 border-b border-slate-700/50">
        {([
          { id: 'overrides', label: 'DB Overrides', icon: <Database size={12} />, count: stats?.overrides },
          { id: 'catalog',   label: 'Static Catalog', icon: <Package size={12} />, count: stats?.catalog },
          { id: 'fallbacks', label: 'Category Fallbacks', icon: <Tag size={12} />, count: stats?.fallbacks },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSection(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-all border-b-2 -mb-px ${
              activeSection === tab.id
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeSection === tab.id ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-500'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Loading / empty states ── */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <RefreshCw size={18} className="animate-spin mr-2" /> Loading pricing data…
        </div>
      )}

      {!loading && data && (
        <>
          {/* ══════════ DB OVERRIDES ══════════ */}
          {activeSection === 'overrides' && (
            <div className="space-y-2">
              {data.overrides.filter(filterFn).length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <DollarSign size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No overrides yet.</p>
                  <p className="text-xs mt-1">Add an override to beat catalog pricing for your account.</p>
                  <button
                    onClick={() => setShowModal(true)}
                    className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-400 transition-all mx-auto"
                  >
                    <Plus size={12} /> Add First Override
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-700/50 overflow-hidden">
                  <div className="bg-slate-800/60 px-4 py-2 grid grid-cols-12 gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-700/50">
                    <div className="col-span-3">Part Number</div>
                    <div className="col-span-2">Category</div>
                    <div className="col-span-2 text-right">Unit Cost</div>
                    <div className="col-span-2">Source</div>
                    <div className="col-span-2">Scope</div>
                    <div className="col-span-1" />
                  </div>
                  {data.overrides.filter(filterFn).map((entry, i) => (
                    <div
                      key={entry.id || i}
                      className="px-4 py-3 grid grid-cols-12 gap-2 items-center border-b border-slate-700/30 last:border-0 hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="col-span-3 font-mono text-xs text-white truncate" title={entry.partNumber}>
                        {entry.partNumber === '*' ? (
                          <span className="text-amber-400 font-bold">* (wildcard)</span>
                        ) : entry.partNumber}
                      </div>
                      <div className="col-span-2 text-xs text-slate-400 capitalize">{entry.category}</div>
                      <div className="col-span-2 text-right font-mono text-sm font-bold text-emerald-400">
                        ${Number(entry.unitCost).toFixed(2)}
                      </div>
                      <div className="col-span-2"><SourceBadge source={entry.source || 'Internal'} /></div>
                      <div className="col-span-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
                          entry.scope === 'global'
                            ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                            : 'bg-slate-700/60 text-slate-400 border-slate-600/50'
                        }`}>
                          {entry.scope || 'company'}
                        </span>
                      </div>
                      <div className="col-span-1 flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setEditEntry(entry); setShowModal(true); }}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 transition-all"
                          title="Edit"
                        >
                          <TrendingUp size={12} />
                        </button>
                        <button
                          onClick={() => entry.id && handleDelete(entry.id, entry.partNumber)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══════════ STATIC CATALOG ══════════ */}
          {activeSection === 'catalog' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                <Info size={11} />
                Read-only static catalog (CED/Soligent/KWh Q1 2025). Add a DB override to beat any entry.
              </div>
              {Object.entries(catalogByCategory)
                .filter(([cat, entries]) =>
                  !q || cat.toLowerCase().includes(q) || entries.some(filterFn)
                )
                .map(([category, entries]) => {
                  const isOpen = expandedCategories.has(category);
                  const filtered = entries.filter(filterFn);
                  if (filtered.length === 0 && q) return null;
                  return (
                    <div key={category} className="rounded-xl border border-slate-700/50 overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/60 hover:bg-slate-800/80 transition-colors"
                        onClick={() => {
                          const next = new Set(expandedCategories);
                          if (isOpen) next.delete(category); else next.add(category);
                          setExpandedCategories(next);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {isOpen ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
                          <span className="text-xs font-semibold text-white capitalize">{category}</span>
                          <span className="text-[10px] text-slate-500">({filtered.length} items)</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          avg ${(filtered.reduce((s, e) => s + e.unitCost, 0) / filtered.length).toFixed(2)}
                        </div>
                      </button>

                      {isOpen && (
                        <div>
                          <div className="bg-slate-800/40 px-4 py-1.5 grid grid-cols-12 gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-700/40">
                            <div className="col-span-4">Part Number</div>
                            <div className="col-span-2 text-right">List</div>
                            <div className="col-span-2 text-right">Net</div>
                            <div className="col-span-2 text-right">Unit Cost</div>
                            <div className="col-span-2">Source</div>
                          </div>
                          {filtered.map((entry, i) => (
                            <div
                              key={i}
                              className="px-4 py-2.5 grid grid-cols-12 gap-2 items-center border-b border-slate-700/20 last:border-0 hover:bg-slate-800/30 transition-colors"
                            >
                              <div className="col-span-4 font-mono text-xs text-slate-300 truncate" title={entry.partNumber}>
                                {entry.partNumber}
                              </div>
                              <div className="col-span-2 text-right font-mono text-xs text-slate-500">
                                {entry.listPrice != null ? `$${entry.listPrice.toFixed(2)}` : '—'}
                              </div>
                              <div className="col-span-2 text-right font-mono text-xs text-slate-400">
                                {entry.netPrice != null ? `$${entry.netPrice.toFixed(2)}` : '—'}
                              </div>
                              <div className="col-span-2 text-right font-mono text-xs font-bold text-emerald-400">
                                ${Number(entry.unitCost).toFixed(2)}
                              </div>
                              <div className="col-span-2"><SourceBadge source={entry.source} /></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* ══════════ FALLBACKS ══════════ */}
          {activeSection === 'fallbacks' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                <Info size={11} />
                Category fallback prices — applied when a SKU has no catalog match. Lowest priority.
              </div>
              <div className="rounded-xl border border-slate-700/50 overflow-hidden">
                <div className="bg-slate-800/60 px-4 py-2 grid grid-cols-3 gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-700/50">
                  <div>Category</div>
                  <div className="text-right">Fallback Unit Cost</div>
                  <div />
                </div>
                {(data.fallbacks || [])
                  .filter(f => !q || f.category.toLowerCase().includes(q))
                  .map((f, i) => (
                    <div
                      key={i}
                      className="px-4 py-3 grid grid-cols-3 gap-2 items-center border-b border-slate-700/30 last:border-0 hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="text-xs font-semibold text-slate-300 capitalize">{f.category}</div>
                      <div className="text-right font-mono text-sm font-bold text-purple-400">
                        ${Number(f.unitCost).toFixed(2)}
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 border border-slate-700 px-1.5 py-0.5 rounded">fallback</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Confirm Dialog ── */}
      {confirmDialog ? (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
          variant="danger"
        />
      ) : null}

      {/* ── Modal ── */}
      {showModal && (
        <OverrideModal
          entry={editEntry}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditEntry(undefined); }}
        />
      )}
    </div>
  );
}