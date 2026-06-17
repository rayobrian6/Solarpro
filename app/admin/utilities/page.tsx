'use client';
import { useEffect, useState, useMemo } from 'react';
import { Plus, Trash2, Edit2, RefreshCw, CheckCircle, AlertCircle,
         Save, X, ChevronDown, ChevronRight, Search, Zap } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// ─── utility type classifier ─────────────────────────────────────────────────
function classifyUtility(name: string, notes?: string | null): 'IOU' | 'Co-op' | 'Muni' | 'PUD' {
  const n = (name ?? '').toLowerCase();
  const no = (notes ?? '').toLowerCase();
  if (n.includes('coop') || n.includes('co-op') || n.includes(' emc') ||
      n.includes('cooperative') || no.includes('co-op') ||
      (no.includes('rural') && no.includes('co-op')))
    return 'Co-op';
  if (n.includes('pud') || n.includes('public utility district') || n.includes('snohomish pud'))
    return 'PUD';
  if (n.includes('municipal') || n.includes('city of') || n.includes('light gas & water') ||
      n.includes('dwp') || n.includes('water and power') || n.includes('electric system') ||
      n.includes('public power') || n.includes('oppd') || n.includes('smud') ||
      (n.includes('utilities') && no.includes('municipal')))
    return 'Muni';
  return 'IOU';
}

const TYPE_COLOR: Record<string, string> = {
  IOU:    'bg-blue-500/20 text-blue-300',
  'Co-op':'bg-green-500/20 text-green-300',
  Muni:   'bg-amber-500/20 text-amber-300',
  PUD:    'bg-purple-500/20 text-purple-300',
};

const RATE_COLOR: Record<string, string> = {
  TOU:           'bg-violet-500/20 text-violet-300',
  Tiered:        'bg-sky-500/20 text-sky-300',
  Flat:          'bg-slate-500/20 text-slate-400',
  'TOU-Tiered':  'bg-fuchsia-500/20 text-fuchsia-300',
};

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

// ─── Add/Edit form ────────────────────────────────────────────────────────────
function UtilityForm({ initial, onSave, onCancel }: {
  initial?: any; onSave: (d: any) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(initial || {
    utility_name: '', state: '', country: 'US', net_metering: true,
    interconnection_limit_kw: '', buyback_rate: '', rate_structure: '', notes: '',
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 space-y-4 mb-4">
      <div className="text-sm font-semibold text-blue-400">{initial ? 'Edit Utility' : 'Add Utility'}</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-slate-400 mb-1 block">Utility Name</label>
          <input value={form.utility_name} onChange={e => set('utility_name', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">State</label>
          <input value={form.state} onChange={e => set('state', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Country</label>
          <input value={form.country} onChange={e => set('country', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Interconnect Limit (kW)</label>
          <input type="number" value={form.interconnection_limit_kw} onChange={e => set('interconnection_limit_kw', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Buyback Rate ($/kWh)</label>
          <input type="number" step="0.001" value={form.buyback_rate} onChange={e => set('buyback_rate', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Rate Structure</label>
          <select value={form.rate_structure} onChange={e => set('rate_structure', e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50">
            <option value="">— select —</option>
            {['Flat','TOU','Tiered','TOU-Tiered','Flat/TOU opt-in'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="nm" checked={form.net_metering}
            onChange={e => set('net_metering', e.target.checked)} className="accent-blue-500 w-4 h-4" />
          <label htmlFor="nm" className="text-xs text-slate-300">Net Metering</label>
        </div>
        <div className="col-span-2 lg:col-span-4">
          <label className="text-xs text-slate-400 mb-1 block">Notes</label>
          <input value={form.notes} onChange={e => set('notes', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-slate-400 hover:text-white transition-colors">
          <X size={12} />Cancel
        </button>
        <button onClick={() => onSave(form)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-400 transition-colors">
          <Save size={12} />Save
        </button>
      </div>
    </div>
  );
}

// ─── State section ────────────────────────────────────────────────────────────
function StateSection({ state, utilities, defaultOpen, onEdit, onDelete }: {
  state: string; utilities: any[]; defaultOpen: boolean;
  onEdit: (u: any) => void; onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const stateName = STATE_NAMES[state] || state;

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const u of utilities) {
      const t = classifyUtility(u.utility_name, u.notes);
      tally[t] = (tally[t] || 0) + 1;
    }
    return tally;
  }, [utilities]);

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden mb-2">
      {/* ── State header row ── */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left">
        <span className="w-7 h-7 rounded-md bg-slate-700/80 flex items-center justify-center text-[10px] font-black text-slate-200 shrink-0 tracking-tight">
          {state}
        </span>
        <span className="font-semibold text-white text-sm flex-1">{stateName}</span>
        <span className="text-[10px] text-slate-500 mr-1">{utilities.length} {utilities.length === 1 ? 'utility' : 'utilities'}</span>
        <div className="flex gap-1 mr-2">
          {Object.entries(counts).map(([type, n]) => (
            <span key={type} className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${TYPE_COLOR[type]}`}>
              {n} {type}
            </span>
          ))}
        </div>
        {open ? <ChevronDown size={13} className="text-slate-500 shrink-0" />
               : <ChevronRight size={13} className="text-slate-500 shrink-0" />}
      </button>

      {/* ── Table ── */}
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-t border-white/5 bg-white/[0.02]">
                <th className="text-left px-4 py-2 text-[10px] text-slate-500 font-medium w-[40%]">Utility</th>
                <th className="text-left px-3 py-2 text-[10px] text-slate-500 font-medium w-[8%]">Type</th>
                <th className="text-center px-3 py-2 text-[10px] text-slate-500 font-medium w-[10%]">NEM</th>
                <th className="text-right px-3 py-2 text-[10px] text-slate-500 font-medium w-[12%]">Interconnect</th>
                <th className="text-right px-3 py-2 text-[10px] text-slate-500 font-medium w-[12%]">Buyback</th>
                <th className="text-left px-3 py-2 text-[10px] text-slate-500 font-medium w-[12%]">Rate</th>
                <th className="w-[6%]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {utilities.map(item => {
                const type = classifyUtility(item.utility_name, item.notes);
                return (
                  <tr key={item.id} className="hover:bg-white/[0.03] transition-colors group">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-white text-xs leading-tight">{item.utility_name}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${TYPE_COLOR[type]}`}>{type}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.net_metering
                        ? <span className="text-green-400 text-[11px] font-bold">✓</span>
                        : <span className="text-red-400/60 text-[11px]">✗</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {item.interconnection_limit_kw
                        ? <span className="text-slate-300 font-mono">{Number(item.interconnection_limit_kw).toLocaleString()} kW</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {item.buyback_rate
                        ? <span className="text-emerald-400 font-mono">${Number(item.buyback_rate).toFixed(3)}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {item.rate_structure
                        ? <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${RATE_COLOR[item.rate_structure] ?? 'bg-teal-500/20 text-teal-300'}`}>
                            {item.rate_structure}
                          </span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => onEdit(item)}
                          className="p-1 rounded text-blue-400 hover:bg-blue-500/15 transition-colors">
                          <Edit2 size={11} />
                        </button>
                        <button onClick={() => onDelete(item.id)}
                          className="p-1 rounded text-red-400 hover:bg-red-500/15 transition-colors">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdminUtilities() {
  const [items, setItems]       = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [adding, setAdding]     = useState(false);
  const [editing, setEditing]   = useState<any | null>(null);
  const toast = useToast();
  const [confirmDialog, setConfirmDialog] = useState<null | { message: string; onConfirm: () => void }>(null);
  const [search, setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState<'all'|'IOU'|'Co-op'|'Muni'|'PUD'>('all');
  const [nemFilter, setNemFilter]   = useState<'all'|'yes'|'no'>('all');
  const [stateFilter, setStateFilter] = useState('');
  const [expandAll, setExpandAll]   = useState(false); // collapsed by default — less scroll



  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/utilities');
      const d = await r.json();
      if (d.success) setItems(d.utilities);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async (form: any) => {
    const method = editing ? 'PATCH' : 'POST';
    const body   = editing ? { ...form, id: editing.id } : form;
    const r = await fetch('/api/admin/utilities', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.success) { toast.success('Saved'); setAdding(false); setEditing(null); load(); }
    else toast.error(d.error || 'Failed');
  };

  const del = (id: string) => {
    setConfirmDialog({
      message: 'Delete this utility?',
      onConfirm: async () => {
        const r = await fetch('/api/admin/utilities', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
        const d = await r.json();
        if (d.success) { toast.success('Deleted'); load(); }
        else toast.error(d.error || 'Failed');
      },
    });
  };

  // ── filter ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => items.filter(item => {
    const type = classifyUtility(item.utility_name, item.notes);
    if (typeFilter !== 'all' && type !== typeFilter) return false;
    if (nemFilter === 'yes' && !item.net_metering) return false;
    if (nemFilter === 'no'  &&  item.net_metering) return false;
    if (stateFilter && item.state !== stateFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (item.utility_name ?? '').toLowerCase().includes(q) ||
             (item.state ?? '').toLowerCase().includes(q) ||
             (STATE_NAMES[item.state] ?? '').toLowerCase().includes(q) ||
             (item.rate_structure ?? '').toLowerCase().includes(q);
    }
    return true;
  }), [items, search, typeFilter, nemFilter, stateFilter]);

  // ── group by state ────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const u of filtered) {
      if (!map[u.state]) map[u.state] = [];
      map[u.state].push(u);
    }
    const typeOrder: Record<string,number> = { IOU:0, 'Co-op':1, Muni:2, PUD:3 };
    for (const st of Object.keys(map)) {
      map[st].sort((a, b) => {
        const ta = typeOrder[classifyUtility(a.utility_name, a.notes)] ?? 9;
        const tb = typeOrder[classifyUtility(b.utility_name, b.notes)] ?? 9;
        return ta !== tb ? ta - tb : a.utility_name.localeCompare(b.utility_name);
      });
    }
    return Object.keys(map)
      .sort((a, b) => (STATE_NAMES[a]||a).localeCompare(STATE_NAMES[b]||b))
      .map(state => ({ state, utilities: map[state] }));
  }, [filtered]);

  // stats
  const states   = useMemo(() => [...new Set(items.map(u => u.state))].sort(), [items]);
  const iouCount = useMemo(() => items.filter(u => classifyUtility(u.utility_name, u.notes) === 'IOU').length, [items]);
  const coopCount= useMemo(() => items.filter(u => classifyUtility(u.utility_name, u.notes) === 'Co-op').length, [items]);
  const muniCount= useMemo(() => items.filter(u => ['Muni','PUD'].includes(classifyUtility(u.utility_name, u.notes))).length, [items]);

  const hasFilter = search || typeFilter !== 'all' || nemFilter !== 'all' || stateFilter;

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Utility Intelligence Database</h1>
          {!loading && items.length > 0 && (
            <div className="flex gap-3 mt-1 text-[11px]">
              <span className="text-slate-500">{items.length} utilities · {states.length} states</span>
              <span className="text-blue-400">{iouCount} IOU</span>
              <span className="text-green-400">{coopCount} Co-op</span>
              <span className="text-amber-400">{muniCount} Muni/PUD</span>
            </div>
          )}
        </div>
        <button onClick={() => { setAdding(true); setEditing(null); }}
          className="flex items-center gap-1.5 text-xs bg-blue-500 text-white font-semibold rounded-lg px-3 py-2 hover:bg-blue-400 transition-all shrink-0">
          <Plus size={12} /> Add Utility
        </button>
      </div>

      {/* ── Add/Edit form ── */}
      {(adding && !editing) && <UtilityForm onSave={save} onCancel={() => setAdding(false)} />}
      {editing && <UtilityForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2 items-center p-3 rounded-xl bg-white/[0.03] border border-white/5">
        {/* Search */}
        <div className="relative min-w-40 flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input type="text" placeholder="Search utility…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-7 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/40" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={10} /></button>}
        </div>

        {/* State dropdown */}
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500/40 min-w-[110px]">
          <option value="">All States</option>
          {states.map(s => <option key={s} value={s}>{STATE_NAMES[s] || s}</option>)}
        </select>

        {/* Type pills */}
        <div className="flex gap-1">
          {(['all','IOU','Co-op','Muni'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors border ${
                typeFilter === t
                  ? t === 'IOU'    ? 'bg-blue-500/25 text-blue-200 border-blue-500/40'
                  : t === 'Co-op' ? 'bg-green-500/25 text-green-200 border-green-500/40'
                  : t === 'Muni'  ? 'bg-amber-500/25 text-amber-200 border-amber-500/40'
                  : 'bg-white/10 text-white border-white/20'
                  : 'bg-transparent text-slate-500 border-white/5 hover:text-white hover:border-white/15'
              }`}>{t === 'all' ? 'All Types' : t}</button>
          ))}
        </div>

        {/* NEM pills */}
        <div className="flex gap-1">
          {(['all','yes','no'] as const).map(n => (
            <button key={n} onClick={() => setNemFilter(n)}
              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors border ${
                nemFilter === n
                  ? n === 'yes' ? 'bg-green-500/20 text-green-200 border-green-500/35'
                  : n === 'no'  ? 'bg-red-500/20 text-red-200 border-red-500/35'
                  : 'bg-white/10 text-white border-white/20'
                  : 'bg-transparent text-slate-500 border-white/5 hover:text-white hover:border-white/15'
              }`}>{n === 'all' ? 'All NEM' : n === 'yes' ? '✓ NEM' : '✗ No NEM'}</button>
          ))}
        </div>

        <div className="flex gap-1 ml-auto">
          {hasFilter && (
            <button onClick={() => { setSearch(''); setTypeFilter('all'); setNemFilter('all'); setStateFilter(''); }}
              className="px-2 py-1 rounded-md text-[10px] text-slate-400 border border-white/5 hover:text-white transition-colors">
              Clear
            </button>
          )}
          <button onClick={() => setExpandAll(v => !v)}
            className="px-2 py-1 rounded-md text-[10px] text-slate-400 border border-white/5 hover:text-white transition-colors flex items-center gap-1">
            {expandAll ? <><ChevronDown size={10}/>Collapse All</> : <><ChevronRight size={10}/>Expand All</>}
          </button>
          <button onClick={load}
            className="p-1.5 rounded-md border border-white/5 text-slate-500 hover:text-white transition-colors">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Results summary ── */}
      {hasFilter && !loading && (
        <p className="text-[11px] text-slate-500 -mt-1">
          Showing {filtered.length} of {items.length} utilities across {grouped.length} states
        </p>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
          <RefreshCw size={14} className="animate-spin" />Loading utilities…
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          {items.length === 0
            ? <><Zap size={20} className="mx-auto mb-2 text-slate-600" />No utilities yet. Run "Seed Utility Database" in System Tools.</>
            : 'No utilities match your filters.'}
        </div>
      ) : (
        <div>
          {grouped.map(({ state, utilities }) => (
            <StateSection
              key={`${state}-${expandAll}`}
              state={state}
              utilities={utilities}
              defaultOpen={expandAll || !!stateFilter || !!search}
              onEdit={u => { setEditing(u); setAdding(false); }}
              onDelete={del}
            />
          ))}
        </div>
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
    </div>
  );
}