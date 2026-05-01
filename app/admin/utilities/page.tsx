'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Plus, Trash2, Edit2, RefreshCw, CheckCircle, AlertCircle,
  Save, X, Search, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';

// ─── classifier ───────────────────────────────────────────────────────────────
function classifyUtility(name: string, notes?: string | null): 'IOU' | 'Co-op' | 'Muni' | 'PUD' {
  const n  = (name  ?? '').toLowerCase();
  const no = (notes ?? '').toLowerCase();
  if (n.includes('coop') || n.includes('co-op') || n.includes(' emc') ||
      n.includes('cooperative') || no.includes('co-op') ||
      (no.includes('rural') && no.includes('co-op'))) return 'Co-op';
  if (n.includes('pud') || n.includes('public utility district') || n.includes('snohomish pud')) return 'PUD';
  if (n.includes('municipal') || n.includes('city of') || n.includes('light gas & water') ||
      n.includes('dwp') || n.includes('water and power') || n.includes('electric system') ||
      n.includes('public power') || n.includes('oppd') || n.includes('smud') ||
      (n.includes('utilities') && no.includes('municipal'))) return 'Muni';
  return 'IOU';
}

const TYPE_COLOR: Record<string, string> = {
  IOU:     'bg-blue-500/20 text-blue-300',
  'Co-op': 'bg-green-500/20 text-green-300',
  Muni:    'bg-amber-500/20 text-amber-300',
  PUD:     'bg-purple-500/20 text-purple-300',
};

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DC:'Washington D.C.',DE:'Delaware',
  FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',
  IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',
  ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',
  MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',
  NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',
  NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

// ─── edit form (slide-in panel) ───────────────────────────────────────────────
function UtilityForm({ initial, onSave, onCancel }: {
  initial?: any; onSave: (d: any) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(initial || {
    utility_name: '', state: '', country: 'US', net_metering: true,
    interconnection_limit_kw: '', buyback_rate: '', rate_structure: '', notes: '',
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="rounded-xl border border-blue-500/20 bg-[#0d1420] p-5 space-y-4 mb-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-blue-400">{initial ? 'Edit Utility' : 'Add Utility'}</span>
        <button onClick={onCancel} className="text-slate-500 hover:text-white transition-colors"><X size={14}/></button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-slate-400 mb-1 block">Utility Name</label>
          <input value={form.utility_name} onChange={e => set('utility_name', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">State</label>
          <input value={form.state} onChange={e => set('state', e.target.value.toUpperCase().slice(0,2))}
            placeholder="e.g. CA" maxLength={2}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Country</label>
          <input value={form.country} onChange={e => set('country', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Interconnect Limit (kW)</label>
          <input type="number" value={form.interconnection_limit_kw} onChange={e => set('interconnection_limit_kw', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Buyback Rate ($/kWh)</label>
          <input type="number" step="0.001" value={form.buyback_rate} onChange={e => set('buyback_rate', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"/>
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
            onChange={e => set('net_metering', e.target.checked)} className="accent-blue-500 w-4 h-4"/>
          <label htmlFor="nm" className="text-xs text-slate-300">Net Metering</label>
        </div>
        <div className="col-span-2 lg:col-span-4">
          <label className="text-xs text-slate-400 mb-1 block">Notes</label>
          <input value={form.notes} onChange={e => set('notes', e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"/>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-slate-400 hover:text-white transition-colors">
          <X size={12}/>Cancel
        </button>
        <button onClick={() => onSave(form)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-400 transition-colors">
          <Save size={12}/>Save
        </button>
      </div>
    </div>
  );
}

// ─── state card (grid dropdown) ───────────────────────────────────────────────
function StateCard({ stateCode, utilities, onEdit, onDelete }: {
  stateCode: string;
  utilities: any[];
  onEdit: (u: any) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const stateName = STATE_NAMES[stateCode] || stateCode;

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    utilities.forEach(u => {
      const t = classifyUtility(u.utility_name, u.notes);
      c[t] = (c[t] || 0) + 1;
    });
    return c;
  }, [utilities]);

  const nemCount = utilities.filter(u => u.net_metering).length;

  return (
    <div className={`rounded-xl border transition-all duration-200 overflow-hidden ${
      open ? 'border-blue-500/30 bg-[#0d1623]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
    }`}>
      {/* ── card header / trigger ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* State badge */}
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-black tracking-tight shrink-0 transition-colors ${
          open ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-slate-300'
        }`}>
          {stateCode}
        </div>

        {/* State name + pill summary */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white leading-tight">{stateName}</div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-slate-500">{utilities.length} {utilities.length === 1 ? 'utility' : 'utilities'}</span>
            {Object.entries(typeCounts).map(([t, n]) => (
              <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${TYPE_COLOR[t]}`}>
                {n} {t}
              </span>
            ))}
            {nemCount > 0 && (
              <span className="text-[9px] text-emerald-400">✓ {nemCount} NEM</span>
            )}
          </div>
        </div>

        {open
          ? <ChevronUp size={14} className="text-blue-400 shrink-0"/>
          : <ChevronDown size={14} className="text-slate-600 shrink-0"/>
        }
      </button>

      {/* ── expanded table ── */}
      {open && (
        <div className="border-t border-white/[0.06]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-white/[0.025]">
                <th className="text-left px-4 py-2 text-[10px] text-slate-500 font-medium">Utility</th>
                <th className="text-left px-3 py-2 text-[10px] text-slate-500 font-medium w-16">Type</th>
                <th className="text-center px-3 py-2 text-[10px] text-slate-500 font-medium w-12">NEM</th>
                <th className="text-right px-3 py-2 text-[10px] text-slate-500 font-medium w-24">Interconnect</th>
                <th className="text-right px-3 py-2 text-[10px] text-slate-500 font-medium w-22">
                  <span className="text-blue-400/70">Retail</span>
                </th>
                <th className="text-right px-3 py-2 text-[10px] text-slate-500 font-medium w-22">
                  <span className="text-violet-400/70">Supply</span>
                </th>
                <th className="text-right px-3 py-2 text-[10px] text-slate-500 font-medium w-20">Buyback</th>
                <th className="text-left px-3 py-2 text-[10px] text-slate-500 font-medium w-20">Rate</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {utilities.map(item => {
                const type = classifyUtility(item.utility_name, item.notes);
                return (
                  <tr key={item.id} className="hover:bg-white/[0.03] transition-colors group">
                    <td className="px-4 py-2">
                      <span className="font-medium text-white">{item.utility_name}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${TYPE_COLOR[type]}`}>{type}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {item.net_metering
                        ? <span className="text-green-400 font-bold">✓</span>
                        : <span className="text-slate-700">✗</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {item.interconnection_limit_kw
                        ? <span className="text-slate-200 font-mono">{Number(item.interconnection_limit_kw).toLocaleString()}<span className="text-slate-500 ml-0.5 text-[9px]">kW</span></span>
                        : <span className="text-slate-700">—</span>}
                    </td>
                    {/* Retail rate */}
                    <td className="px-3 py-2 text-right">
                      {item.retail_rate
                        ? <span className="text-blue-300 font-mono">${Number(item.retail_rate).toFixed(3)}</span>
                        : <span className="text-slate-700">—</span>}
                    </td>
                    {/* Supply rate */}
                    <td className="px-3 py-2 text-right">
                      {item.supply_rate
                        ? <span className="text-violet-300 font-mono">${Number(item.supply_rate).toFixed(3)}</span>
                        : <span className="text-slate-700">—</span>}
                    </td>
                    {/* Buyback */}
                    <td className="px-3 py-2 text-right">
                      {item.buyback_rate
                        ? <span className="text-emerald-400 font-mono">${Number(item.buyback_rate).toFixed(3)}</span>
                        : <span className="text-slate-700">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {item.rate_structure
                        ? <span className="text-slate-300">{item.rate_structure}</span>
                        : <span className="text-slate-700">—</span>}
                    </td>
                    <td className="pr-2 py-2">
                      <div className="flex gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => onEdit(item)}
                          className="p-1.5 rounded text-blue-400 hover:bg-blue-500/15 transition-colors">
                          <Edit2 size={11}/>
                        </button>
                        <button onClick={() => onDelete(item.id)}
                          className="p-1.5 rounded text-red-400 hover:bg-red-500/15 transition-colors">
                          <Trash2 size={11}/>
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

// ─── main page ────────────────────────────────────────────────────────────────
export default function AdminUtilities() {
  const [items, setItems]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);

  const [search, setSearch]           = useState('');
  const [typeFilter, setTypeFilter]   = useState('all');
  const [nemFilter, setNemFilter]     = useState('all');
  const [regionFilter, setRegionFilter] = useState('all'); // all | west | south | northeast | midwest

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/utilities');
      const d = await r.json();
      if (d.success) setItems(d.utilities);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (form: any) => {
    const method = editing ? 'PATCH' : 'POST';
    const body   = editing ? { ...form, id: editing.id } : form;
    const r = await fetch('/api/admin/utilities', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.success) { showToast('✓ Saved'); setAdding(false); setEditing(null); load(); }
    else showToast(d.error || 'Failed', false);
  };

  const del = async (id: string) => {
    if (!confirm('Delete this utility?')) return;
    const r = await fetch('/api/admin/utilities', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const d = await r.json();
    if (d.success) { showToast('✓ Deleted'); load(); }
    else showToast(d.error || 'Failed', false);
  };

  // US census regions
  const REGIONS: Record<string, string[]> = {
    west:      ['AK','AZ','CA','CO','HI','ID','MT','NV','NM','OR','UT','WA','WY'],
    south:     ['AL','AR','DC','DE','FL','GA','KY','LA','MD','MS','NC','OK','SC','TN','TX','VA','WV'],
    northeast: ['CT','MA','ME','NH','NJ','NY','PA','RI','VT'],
    midwest:   ['IA','IL','IN','KS','MI','MN','MO','ND','NE','OH','SD','WI'],
  };

  // filter items
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(item => {
      const type = classifyUtility(item.utility_name, item.notes);
      if (typeFilter !== 'all' && type !== typeFilter) return false;
      if (nemFilter === 'yes' && !item.net_metering) return false;
      if (nemFilter === 'no'  &&  item.net_metering) return false;
      if (regionFilter !== 'all' && !REGIONS[regionFilter]?.includes(item.state)) return false;
      if (q) {
        return (item.utility_name ?? '').toLowerCase().includes(q)
            || (item.state ?? '').toLowerCase().includes(q)
            || (STATE_NAMES[item.state] ?? '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [items, search, typeFilter, nemFilter, regionFilter]);

  // group by state, sort states alphabetically
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    filtered.forEach(u => {
      if (!map[u.state]) map[u.state] = [];
      map[u.state].push(u);
    });
    // sort utilities within each state: IOU first, then alpha
    const typeOrder: Record<string,number> = { IOU:0, 'Co-op':1, Muni:2, PUD:3 };
    Object.keys(map).forEach(st => {
      map[st].sort((a, b) => {
        const ta = typeOrder[classifyUtility(a.utility_name, a.notes)] ?? 9;
        const tb = typeOrder[classifyUtility(b.utility_name, b.notes)] ?? 9;
        return ta !== tb ? ta - tb : a.utility_name.localeCompare(b.utility_name);
      });
    });
    return Object.keys(map)
      .sort((a, b) => (STATE_NAMES[a]||a).localeCompare(STATE_NAMES[b]||b))
      .map(state => ({ state, utilities: map[state] }));
  }, [filtered]);

  // stats
  const allStates = useMemo(() => [...new Set(items.map(u => u.state))].sort(), [items]);
  const iouCount  = useMemo(() => items.filter(u => classifyUtility(u.utility_name, u.notes) === 'IOU').length, [items]);
  const coopCount = useMemo(() => items.filter(u => classifyUtility(u.utility_name, u.notes) === 'Co-op').length, [items]);
  const muniCount = useMemo(() => items.filter(u => ['Muni','PUD'].includes(classifyUtility(u.utility_name, u.notes))).length, [items]);

  const hasFilter = !!(search || typeFilter !== 'all' || nemFilter !== 'all' || regionFilter !== 'all');

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Utility Intelligence Database</h1>
          {!loading && items.length > 0 && (
            <div className="flex gap-4 mt-1.5 text-[11px]">
              <span className="text-slate-500">{items.length} utilities · {allStates.length} states</span>
              <span className="text-blue-400">{iouCount} IOU</span>
              <span className="text-green-400">{coopCount} Co-op</span>
              <span className="text-amber-400">{muniCount} Muni/PUD</span>
            </div>
          )}
        </div>
        <button onClick={() => { setAdding(true); setEditing(null); }}
          className="flex items-center gap-1.5 text-xs bg-blue-500 text-white font-semibold rounded-lg px-3 py-2 hover:bg-blue-400 transition-all shrink-0">
          <Plus size={12}/> Add Utility
        </button>
      </div>

      {/* ── Add/Edit form ── */}
      {(adding && !editing) && <UtilityForm onSave={save} onCancel={() => setAdding(false)}/>}
      {editing && <UtilityForm initial={editing} onSave={save} onCancel={() => setEditing(null)}/>}

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2 items-center px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/5">
        {/* search */}
        <div className="relative min-w-36 flex-1 max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"/>
          <input type="text" placeholder="Search utility…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-6 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/40"/>
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={10}/></button>}
        </div>

        {/* Region quick-filter */}
        <div className="flex gap-1">
          {(['all','west','south','northeast','midwest'] as const).map(r => (
            <button key={r} onClick={() => setRegionFilter(r)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors border capitalize ${
                regionFilter === r
                  ? 'bg-indigo-500/25 text-indigo-200 border-indigo-500/40'
                  : 'bg-transparent text-slate-500 border-white/5 hover:text-slate-300 hover:border-white/15'
              }`}>{r === 'all' ? 'All Regions' : r.charAt(0).toUpperCase() + r.slice(1)}</button>
          ))}
        </div>

        {/* type pills */}
        <div className="flex gap-1">
          {(['all','IOU','Co-op','Muni','PUD'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors border ${
                typeFilter === t
                  ? t === 'IOU'    ? 'bg-blue-500/25 text-blue-200 border-blue-500/40'
                  : t === 'Co-op' ? 'bg-green-500/25 text-green-200 border-green-500/40'
                  : t === 'Muni'  ? 'bg-amber-500/25 text-amber-200 border-amber-500/40'
                  : t === 'PUD'   ? 'bg-purple-500/25 text-purple-200 border-purple-500/40'
                  : 'bg-white/10 text-white border-white/20'
                  : 'bg-transparent text-slate-500 border-white/5 hover:text-slate-300 hover:border-white/15'
              }`}>{t === 'all' ? 'All Types' : t}</button>
          ))}
        </div>

        {/* NEM */}
        <div className="flex gap-1">
          {(['all','yes','no'] as const).map(n => (
            <button key={n} onClick={() => setNemFilter(n)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors border ${
                nemFilter === n
                  ? n === 'yes' ? 'bg-green-500/20 text-green-200 border-green-500/35'
                  : n === 'no'  ? 'bg-red-500/20 text-red-200 border-red-500/35'
                  : 'bg-white/10 text-white border-white/20'
                  : 'bg-transparent text-slate-500 border-white/5 hover:text-slate-300 hover:border-white/15'
              }`}>{n === 'all' ? 'NEM: All' : n === 'yes' ? '✓ NEM' : '✗ No NEM'}</button>
          ))}
        </div>

        <div className="flex gap-1 ml-auto">
          {hasFilter && (
            <button onClick={() => { setSearch(''); setTypeFilter('all'); setNemFilter('all'); setRegionFilter('all'); }}
              className="px-2 py-1 rounded-md text-[10px] text-slate-400 border border-white/5 hover:text-white transition-colors">
              Clear
            </button>
          )}
          <button onClick={load}
            className="p-1.5 rounded-md border border-white/5 text-slate-500 hover:text-white transition-colors">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/>
          </button>
        </div>
      </div>

      {/* ── Count line ── */}
      {!loading && grouped.length > 0 && (
        <p className="text-[11px] text-slate-500 -mt-1">
          {hasFilter
            ? `${filtered.length} of ${items.length} utilities across ${grouped.length} state${grouped.length !== 1 ? 's' : ''}`
            : `${grouped.length} state${grouped.length !== 1 ? 's' : ''} — click a state to expand`}
        </p>
      )}

      {/* ── Grid of state cards ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <RefreshCw size={14} className="animate-spin"/> Loading utilities…
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-20 text-slate-500 text-sm">
          {items.length === 0
            ? <><Zap size={20} className="mx-auto mb-2 text-slate-600"/>No utilities yet. Run "Seed Utility Database" in System Tools.</>
            : 'No utilities match your filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {grouped.map(({ state, utilities }) => (
            <StateCard
              key={state}
              stateCode={state}
              utilities={utilities}
              onEdit={u => { setEditing(u); setAdding(false); }}
              onDelete={del}
            />
          ))}
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium shadow-xl ${
          toast.ok ? 'bg-green-500/20 border border-green-500/30 text-green-400'
                   : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle size={13}/> : <AlertCircle size={13}/>}
          {toast.msg}
        </div>
      )}
    </div>
  );
}