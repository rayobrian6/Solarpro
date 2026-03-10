'use client';
import { useEffect, useState } from 'react';
import { Activity, Plus, Trash2, Edit2, RefreshCw, CheckCircle, AlertCircle, Save, X } from 'lucide-react';

function UtilityForm({ initial, onSave, onCancel }: { initial?: any; onSave: (d: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial || { utility_name:'', state:'', country:'US', net_metering:true, interconnection_limit_kw:'', buyback_rate:'', rate_structure:'', notes:'' });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 space-y-4">
      <div className="text-sm font-semibold text-blue-400">{initial ? 'Edit Utility Policy' : 'Add Utility Policy'}</div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { k:'utility_name',             label:'Utility Name',              type:'text',   full:true },
          { k:'state',                    label:'State Code',                type:'text' },
          { k:'country',                  label:'Country',                   type:'text' },
          { k:'interconnection_limit_kw', label:'Interconnection Limit (kW)',type:'number' },
          { k:'buyback_rate',             label:'Buyback Rate ($/kWh)',      type:'number' },
          { k:'rate_structure',           label:'Rate Structure',            type:'text' },
          { k:'notes',                    label:'Notes',                     type:'text',   full:true },
        ].map(f => (
          <div key={f.k} className={f.full ? 'col-span-2 lg:col-span-3' : ''}>
            <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
            <input type={f.type} value={form[f.k] || ''} onChange={e => set(f.k, e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50" />
          </div>
        ))}
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="nm" checked={form.net_metering} onChange={e => set('net_metering', e.target.checked)} className="accent-blue-500" />
          <label htmlFor="nm" className="text-xs text-slate-400">Net Metering Available</label>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors"><X size={13} />Cancel</button>
        <button onClick={() => onSave(form)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-400 transition-colors"><Save size={13} />Save</button>
      </div>
    </div>
  );
}

export default function AdminUtilities() {
  const [items, setItems]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/utilities');
      const d = await res.json();
      if (d.success) setItems(d.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const save = async (form: any) => {
    const method = editing ? 'PATCH' : 'POST';
    const body   = editing ? { ...form, id: editing.id } : form;
    const res = await fetch('/api/admin/utilities', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (d.success) { showToast('✓ Saved'); setAdding(false); setEditing(null); load(); }
    else showToast(d.error || 'Failed', false);
  };

  const del = async (id: string) => {
    if (!confirm('Delete this utility policy?')) return;
    const res = await fetch(`/api/admin/utilities?id=${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.success) { showToast('✓ Deleted'); load(); }
    else showToast(d.error || 'Failed', false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Utility Intelligence Database</h1>
          <p className="text-sm text-slate-400 mt-1">Net metering, interconnection limits, buyback rates — used by proposal engine</p>
        </div>
        <button onClick={() => { setAdding(true); setEditing(null); }} className="flex items-center gap-2 text-xs bg-blue-500 text-white font-semibold rounded-lg px-3 py-2 hover:bg-blue-400 transition-all">
          <Plus size={12} /> Add Utility
        </button>
      </div>

      {(adding && !editing) && <UtilityForm onSave={save} onCancel={() => setAdding(false)} />}
      {editing && <UtilityForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}

      <div className="rounded-xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/2">
                {['Utility','State','Net Metering','Interconnect Limit','Buyback Rate','Rate Structure','Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">No utility policies yet. Add utilities to override proposal engine defaults.</td></tr>
              ) : items.map(item => (
                <tr key={item.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white text-xs">{item.utility_name}</div>
                    <div className="text-[10px] text-slate-500">{item.country}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{item.state}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${item.net_metering ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {item.net_metering ? '✓ Yes' : '✗ No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{item.interconnection_limit_kw ? `${item.interconnection_limit_kw} kW` : '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{item.buyback_rate ? `$${item.buyback_rate}/kWh` : '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{item.rate_structure || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => { setEditing(item); setAdding(false); }} className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-colors"><Edit2 size={13} /></button>
                      <button onClick={() => del(item.id)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-xl ${toast.ok ? 'bg-green-500/20 border border-green-500/30 text-green-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}