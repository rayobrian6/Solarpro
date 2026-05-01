'use client';
import { useEffect, useState, useMemo } from 'react';
import { Activity, Plus, Trash2, Edit2, RefreshCw, CheckCircle, AlertCircle,
         Save, X, ChevronDown, ChevronRight, Search, Filter } from 'lucide-react';

// ─── utility type classifier ────────────────────────────────────────────────
function classifyUtility(name: string, notes?: string | null): 'IOU' | 'Co-op' | 'Municipal' | 'PUD' {
  const n = (name ?? '').toLowerCase();
  const no = (notes ?? '').toLowerCase();
  if (n.includes('coop') || n.includes('co-op') || n.includes('emc') ||
      n.includes('electric cooperative') || n.includes('cooperative') ||
      n.includes(' coop') || no.includes('co-op') || no.includes('rural') && no.includes('coop'))
    return 'Co-op';
  if (n.includes('municipal') || n.includes('city of') || n.includes('town of') ||
      n.includes('light gas & water') || n.includes('dwp') || n.includes('water and power') ||
      n.includes('electric system') || n.includes('light system') || n.includes('public power') ||
      n.includes('oppd') || n.includes('smud') || n.includes('eles') || n.includes('utilities') && no.includes('municipal'))
    return 'Municipal';
  if (n.includes('pud') || n.includes('public utility district') || n.includes('snohomish pud'))
    return 'PUD';
  return 'IOU';
}

const TYPE_STYLES: Record<string, string> = {
  IOU:       'bg-blue-500/15 text-blue-300 border border-blue-500/25',
  'Co-op':   'bg-green-500/15 text-green-300 border border-green-500/25',
  Municipal: 'bg-amber-500/15 text-amber-300 border border-amber-500/25',
  PUD:       'bg-purple-500/15 text-purple-300 border border-purple-500/25',
};

// Full US state name map
const STATE_NAMES: Record<string, string> = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DC:'Washington D.C.', DE:'Delaware',
  FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois',
  IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana',
  ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota',
  MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada',
  NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York',
  NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma',
  OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
  VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming',
};

function UtilityForm({ initial, onSave, onCancel }: { initial?: any; onSave: (d: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial || {
    utility_name: '', state: '', country: 'US', net_metering: true,
    interconnection_limit_kw: '', buyback_rate: '', rate_structure: '', notes: '',
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 space-y-4">
      <div className="text-sm font-semibold text-blue-400">{initial ? 'Edit Utility Policy' : 'Add Utility Policy'}</div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { k: 'utility_name',             label: 'Utility Name',               type: 'text',   full: true },
          { k: 'state',                    label: 'State Code (e.g. CA)',        type: 'text' },
          { k: 'country',                  label: 'Country',                    type: 'text' },
          { k: 'interconnection_limit_kw', label: 'Interconnection Limit (kW)', type: 'number' },
          { k: 'buyback_rate',             label: 'Buyback Rate ($/kWh)',        type: 'number' },
          { k: 'rate_structure',           label: 'Rate Structure',              type: 'text' },
          { k: 'notes',                    label: 'Notes',                       type: 'text',   full: true },
        ].map(f => (
          <div key={f.k} className={f.full ? 'col-span-2 lg:col-span-3' : ''}>
            <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
            <input type={f.type} value={form[f.k] || ''} onChange={e => set(f.k, e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50" />
          </div>
        ))}
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="nm" checked={form.net_metering}
            onChange={e => set('net_metering', e.target.checked)} className="accent-blue-500" />
          <label htmlFor="nm" className="text-xs text-slate-400">Net Metering Available</label>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={onCancel}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors">
          <X size={13} />Cancel
        </button>
        <button onClick={() => onSave(form)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-400 transition-colors">
          <Save size={13} />Save
        </button>
      </div>
    </div>
  );
}

// ─── state section (collapsible) ────────────────────────────────────────────
function StateSection({
  state, utilities, onEdit, onDelete,
}: {
  state: string;
  utilities: any[];
  onEdit: (u: any) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const stateName = STATE_NAMES[state] || state;

  const iouCount   = utilities.filter(u => classifyUtility(u.utility_name, u.notes) === 'IOU').length;
  const coopCount  = utilities.filter(u => classifyUtility(u.utility_name, u.notes) === 'Co-op').length;
  const muniCount  = utilities.filter(u => ['Municipal','PUD'].includes(classifyUtility(u.utility_name, u.notes))).length;

  return (
    <div className="rounded-xl border border-white/5 overflow-hidden mb-3">
      {/* State header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white/3 hover:bg-white/5 transition-colors text-left"
      >
        <span className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-xs font-black text-white shrink-0">
          {state}
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-white text-sm">{stateName}</span>
          <span className="ml-2 text-xs text-slate-500">{utilities.length} {utilities.length === 1 ? 'utility' : 'utilities'}</span>
        </div>
        {/* mini type pills */}
        <div className="flex gap-1.5 mr-2">
          {iouCount  > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">{iouCount} IOU</span>}
          {coopCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-300">{coopCount} Co-op</span>}
          {muniCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{muniCount} Muni</span>}
        </div>
        {open
          ? <ChevronDown size={14} className="text-slate-500 shrink-0" />
          : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
      </button>

      {/* Utility rows */}
      {open && (
        <div className="divide-y divide-white/3">
          {utilities.map(item => {
            const type = classifyUtility(item.utility_name, item.notes);
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/2 transition-colors group">
                {/* Name + type */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white text-xs truncate">{item.utility_name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider shrink-0 ${TYPE_STYLES[type]}`}>
                      {type}
                    </span>
                  </div>
                  {item.notes && (
                    <div className="text-[10px] text-slate-600 mt-0.5 truncate max-w-xs" title={item.notes}>
                      {item.notes}
                    </div>
                  )}
                </div>

                {/* Net Metering */}
                <div className="w-20 shrink-0">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${item.net_metering ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {item.net_metering ? '✓ NEM' : '✗ No NEM'}
                  </span>
                </div>

                {/* Interconnect */}
                <div className="w-24 shrink-0 text-right">
                  {item.interconnection_limit_kw
                    ? <span className="text-xs text-slate-300 font-mono">{Number(item.interconnection_limit_kw).toLocaleString()} kW</span>
                    : <span className="text-xs text-slate-600">—</span>}
                </div>

                {/* Buyback */}
                <div className="w-24 shrink-0 text-right">
                  {item.buyback_rate
                    ? <span className="text-xs text-emerald-400 font-mono">${Number(item.buyback_rate).toFixed(3)}/kWh</span>
                    : <span className="text-xs text-slate-600">—</span>}
                </div>

                {/* Rate Structure */}
                <div className="w-28 shrink-0">
                  {item.rate_structure
                    ? <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        item.rate_structure === 'TOU'            ? 'bg-violet-500/20 text-violet-300' :
                        item.rate_structure === 'Tiered'         ? 'bg-sky-500/20 text-sky-300' :
                        item.rate_structure === 'Flat'           ? 'bg-slate-500/20 text-slate-300' :
                        item.rate_structure === 'TOU-Tiered'     ? 'bg-fuchsia-500/20 text-fuchsia-300' :
                        'bg-teal-500/20 text-teal-300'
                      }`}>{item.rate_structure}</span>
                    : <span className="text-xs text-slate-600">—</span>}
                </div>

                {/* Actions */}
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onEdit(item)}
                    className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-colors">
                    <Edit2 size={12} />
                  </button>
                  <button onClick={() => onDelete(item.id)}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────
export default function AdminUtilities() {
  const [items, setItems]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);
  const [search, setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'IOU' | 'Co-op' | 'Municipal' | 'PUD'>('all');
  const [nemFilter, setNemFilter]   = useState<'all' | 'yes' | 'no'>('all');
  const [expandAll, setExpandAll]   = useState(true);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/utilities');
      const d = await res.json();
      if (d.success) setItems(d.utilities);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const save = async (form: any) => {
    const method = editing ? 'PATCH' : 'POST';
    const body   = editing ? { ...form, id: editing.id } : form;
    const res = await fetch('/api/admin/utilities', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (d.success) { showToast('✓ Saved'); setAdding(false); setEditing(null); load(); }
    else showToast(d.error || 'Failed', false);
  };

  const del = async (id: string) => {
    if (!confirm('Delete this utility policy?')) return;
    const res = await fetch('/api/admin/utilities', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const d = await res.json();
    if (d.success) { showToast('✓ Deleted'); load(); }
    else showToast(d.error || 'Failed', false);
  };

  // ─── filter + group ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return items.filter(item => {
      const type = classifyUtility(item.utility_name, item.notes);
      if (typeFilter !== 'all') {
        const matchMuni = typeFilter === 'Municipal' && ['Municipal','PUD'].includes(type);
        if (!matchMuni && type !== typeFilter) return false;
      }
      if (nemFilter === 'yes' && !item.net_metering) return false;
      if (nemFilter === 'no'  &&  item.net_metering) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          item.utility_name?.toLowerCase().includes(q) ||
          item.state?.toLowerCase().includes(q) ||
          (STATE_NAMES[item.state] || '').toLowerCase().includes(q) ||
          item.rate_structure?.toLowerCase().includes(q) ||
          item.notes?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, search, typeFilter, nemFilter]);

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const u of filtered) {
      if (!map[u.state]) map[u.state] = [];
      map[u.state].push(u);
    }
    // Sort each state's utilities: IOU first, then Co-op, then Municipal/PUD, then alpha
    const typeOrder = { IOU: 0, 'Co-op': 1, Municipal: 2, PUD: 3 };
    for (const st of Object.keys(map)) {
      map[st].sort((a, b) => {
        const ta = typeOrder[classifyUtility(a.utility_name, a.notes)] ?? 9;
        const tb = typeOrder[classifyUtility(b.utility_name, b.notes)] ?? 9;
        if (ta !== tb) return ta - tb;
        return a.utility_name.localeCompare(b.utility_name);
      });
    }
    // Sort states alphabetically by full name
    return Object.keys(map)
      .sort((a, b) => (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b))
      .map(state => ({ state, utilities: map[state] }));
  }, [filtered]);

  // stats
  const totalIOU   = items.filter(u => classifyUtility(u.utility_name, u.notes) === 'IOU').length;
  const totalCoop  = items.filter(u => classifyUtility(u.utility_name, u.notes) === 'Co-op').length;
  const totalMuni  = items.filter(u => ['Municipal','PUD'].includes(classifyUtility(u.utility_name, u.notes))).length;
  const totalStates = new Set(items.map(u => u.state)).size;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Utility Intelligence Database</h1>
          <p className="text-sm text-slate-400 mt-1">
            Net metering, interconnection limits, buyback rates — used by proposal engine
          </p>
          {/* Stats row */}
          {!loading && items.length > 0 && (
            <div className="flex gap-3 mt-2 flex-wrap">
              <span className="text-[11px] text-slate-400">{items.length} utilities · {totalStates} states</span>
              <span className="text-[11px] text-blue-400">{totalIOU} IOU</span>
              <span className="text-[11px] text-green-400">{totalCoop} Co-op</span>
              <span className="text-[11px] text-amber-400">{totalMuni} Muni/PUD</span>
            </div>
          )}
        </div>
        <button
          onClick={() => { setAdding(true); setEditing(null); }}
          className="flex items-center gap-2 text-xs bg-blue-500 text-white font-semibold rounded-lg px-3 py-2 hover:bg-blue-400 transition-all shrink-0"
        >
          <Plus size={12} /> Add Utility
        </button>
      </div>

      {/* Add/Edit form */}
      {(adding && !editing) && <UtilityForm onSave={save} onCancel={() => setAdding(false)} />}
      {editing && <UtilityForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search utility, state…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <X size={11} />
            </button>
          )}
        </div>

        {/* Type filter */}
        <div className="flex gap-1">
          {(['all', 'IOU', 'Co-op', 'Municipal'] as const).map(t => (
            <button key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                typeFilter === t
                  ? t === 'IOU'       ? 'bg-blue-500/30 text-blue-200 border border-blue-500/40'
                  : t === 'Co-op'     ? 'bg-green-500/30 text-green-200 border border-green-500/40'
                  : t === 'Municipal' ? 'bg-amber-500/30 text-amber-200 border border-amber-500/40'
                  : 'bg-white/10 text-white border border-white/20'
                  : 'bg-white/3 text-slate-400 border border-white/5 hover:bg-white/8'
              }`}>
              {t === 'all' ? 'All Types' : t}
            </button>
          ))}
        </div>

        {/* NEM filter */}
        <div className="flex gap-1">
          {(['all', 'yes', 'no'] as const).map(n => (
            <button key={n}
              onClick={() => setNemFilter(n)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                nemFilter === n
                  ? n === 'yes' ? 'bg-green-500/25 text-green-200 border border-green-500/35'
                  : n === 'no'  ? 'bg-red-500/25 text-red-200 border border-red-500/35'
                  : 'bg-white/10 text-white border border-white/20'
                  : 'bg-white/3 text-slate-400 border border-white/5 hover:bg-white/8'
              }`}>
              {n === 'all' ? 'All NEM' : n === 'yes' ? '✓ NEM' : '✗ No NEM'}
            </button>
          ))}
        </div>

        {/* Expand/Collapse all */}
        <button
          onClick={() => setExpandAll(v => !v)}
          className="px-2.5 py-1.5 rounded-lg text-[11px] text-slate-400 border border-white/5 bg-white/3 hover:bg-white/8 transition-colors flex items-center gap-1"
        >
          {expandAll ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}
          {expandAll ? 'Collapse All' : 'Expand All'}
        </button>

        {/* Refresh */}
        <button onClick={load}
          className="p-2 rounded-lg border border-white/5 bg-white/3 text-slate-400 hover:text-white hover:bg-white/8 transition-colors">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Results summary when filtered */}
      {(search || typeFilter !== 'all' || nemFilter !== 'all') && !loading && (
        <div className="text-xs text-slate-500">
          Showing {filtered.length} of {items.length} utilities across {grouped.length} states
          {(search || typeFilter !== 'all' || nemFilter !== 'all') && (
            <button
              onClick={() => { setSearch(''); setTypeFilter('all'); setNemFilter('all'); }}
              className="ml-2 text-blue-400 hover:text-blue-300 underline"
            >clear filters</button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <RefreshCw size={16} className="animate-spin mr-2" />Loading utilities…
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          {items.length === 0
            ? 'No utilities yet. Run "Seed Utility Database" from System Tools or add one manually.'
            : 'No utilities match your filters.'}
        </div>
      ) : (
        <StateSectionList
          grouped={grouped}
          expandAll={expandAll}
          onEdit={u => { setEditing(u); setAdding(false); }}
          onDelete={del}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-xl ${
          toast.ok
            ? 'bg-green-500/20 border border-green-500/30 text-green-400'
            : 'bg-red-500/20 border border-red-500/30 text-red-400'
        }`}>
          {toast.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── wrapper that controls expand/collapse via key trick ─────────────────────
function StateSectionList({
  grouped, expandAll, onEdit, onDelete,
}: {
  grouped: { state: string; utilities: any[] }[];
  expandAll: boolean;
  onEdit: (u: any) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      {grouped.map(({ state, utilities }) => (
        <StateSection
          key={`${state}-${expandAll}`}   // re-mount on toggle to reset internal open state
          state={state}
          utilities={utilities}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}