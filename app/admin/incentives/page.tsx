'use client';
import { useEffect, useState } from 'react';
import { Zap, Plus, Trash2, Edit2, RefreshCw, CheckCircle, AlertCircle, Save, X } from 'lucide-react';

const TYPES = ['federal_itc','state_credit','rebate','srec','trec','net_metering','exemption','other'];
const VALUE_TYPES = ['percent','dollar','dollar_per_kwh','dollar_per_w'];

const SEED_DATA = [
  { country:'US', state:null,  utility:null, program_name:'Federal ITC (30%)',       type:'federal_itc',  value:30,    value_type:'percent',       active:true, notes:'Residential & commercial solar' },
  { country:'US', state:'IL',  utility:null, program_name:'Illinois Shines SREC',    type:'srec',         value:75,    value_type:'dollar_per_kwh', active:true, notes:'SREC II program' },
  { country:'US', state:'CA',  utility:null, program_name:'California SGIP',         type:'rebate',       value:0.25,  value_type:'dollar_per_w',   active:true, notes:'Self-Generation Incentive Program' },
  { country:'US', state:'TX',  utility:null, program_name:'Texas Net Metering',      type:'net_metering', value:100,   value_type:'percent',        active:true, notes:'Varies by utility' },
  { country:'US', state:'NJ',  utility:null, program_name:'NJ TREC',                 type:'trec',         value:91.2,  value_type:'dollar_per_kwh', active:true, notes:'Transition Renewable Energy Certificate' },
  { country:'US', state:'MA',  utility:null, program_name:'MA SMART Program',        type:'srec',         value:0.17,  value_type:'dollar_per_kwh', active:true, notes:'Solar Massachusetts Renewable Target' },
  { country:'US', state:'NY',  utility:null, program_name:'NY-Sun Incentive',        type:'rebate',       value:0.20,  value_type:'dollar_per_w',   active:true, notes:'NYSERDA NY-Sun program' },
  { country:'US', state:'AZ',  utility:null, program_name:'AZ Residential Tax Credit',type:'state_credit',value:1000,  value_type:'dollar',         active:true, notes:'25% up to $1,000' },
];

function IncentiveForm({ initial, onSave, onCancel }: { initial?: any; onSave: (d: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial || { country:'US', state:'', utility:'', program_name:'', type:'federal_itc', value:'', value_type:'percent', start_date:'', end_date:'', active:true, notes:'' });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
      <div className="text-sm font-semibold text-amber-400">{initial ? 'Edit Incentive' : 'Add Incentive'}</div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { k:'program_name', label:'Program Name', type:'text', full:true },
          { k:'country',      label:'Country',      type:'text' },
          { k:'state',        label:'State Code',   type:'text' },
          { k:'utility',      label:'Utility',      type:'text' },
          { k:'value',        label:'Value',        type:'number' },
          { k:'start_date',   label:'Start Date',   type:'date' },
          { k:'end_date',     label:'End Date',     type:'date' },
          { k:'notes',        label:'Notes',        type:'text', full:true },
        ].map(f => (
          <div key={f.k} className={f.full ? 'col-span-2 lg:col-span-3' : ''}>
            <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
            <input type={f.type} value={form[f.k] || ''} onChange={e => set(f.k, e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
          </div>
        ))}
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Type</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}
            className="w-full bg-[#0d1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50">
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Value Type</label>
          <select value={form.value_type} onChange={e => set('value_type', e.target.value)}
            className="w-full bg-[#0d1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50">
            {VALUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="active" checked={form.active} onChange={e => set('active', e.target.checked)} className="accent-amber-500" />
          <label htmlFor="active" className="text-xs text-slate-400">Active</label>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors"><X size={13} />Cancel</button>
        <button onClick={() => onSave(form)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 transition-colors"><Save size={13} />Save</button>
      </div>
    </div>
  );
}

export default function AdminIncentives() {
  const [items, setItems]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/incentives');
      const d = await res.json();
      if (d.success) setItems(d.incentives);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const save = async (form: any) => {
    const method = editing ? 'PATCH' : 'POST';
    const body   = editing ? { ...form, id: editing.id } : form;
    const res = await fetch('/api/admin/incentives', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (d.success) { showToast('✓ Saved'); setAdding(false); setEditing(null); load(); }
    else showToast(d.error || 'Failed', false);
  };

  const del = async (id: string) => {
    if (!confirm('Delete this incentive?')) return;
    const res = await fetch(`/api/admin/incentives?id=${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.success) { showToast('✓ Deleted'); load(); }
    else showToast(d.error || 'Failed', false);
  };

  const seedDefaults = async () => {
    for (const item of SEED_DATA) {
      await fetch('/api/admin/incentives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
    }
    showToast('✓ Default incentives seeded');
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Policy / Incentive Manager</h1>
          <p className="text-sm text-slate-400 mt-1">Federal, state, and utility solar incentives — editable without redeployment</p>
        </div>
        <div className="flex gap-2">
          {items.length === 0 && (
            <button onClick={seedDefaults} className="flex items-center gap-2 text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg px-3 py-2 hover:bg-blue-500/30 transition-all">
              <Zap size={12} /> Seed Defaults
            </button>
          )}
          <button onClick={() => { setAdding(true); setEditing(null); }} className="flex items-center gap-2 text-xs bg-amber-500 text-black font-semibold rounded-lg px-3 py-2 hover:bg-amber-400 transition-all">
            <Plus size={12} /> Add Incentive
          </button>
        </div>
      </div>

      {(adding && !editing) && <IncentiveForm onSave={save} onCancel={() => setAdding(false)} />}
      {editing && <IncentiveForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}

      <div className="rounded-xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/2">
                {['Program','Type','Value','State','Utility','Active','Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">No incentives yet. Click "Seed Defaults" to add common programs.</td></tr>
              ) : items.map(item => (
                <tr key={item.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white text-xs">{item.program_name}</div>
                    <div className="text-[10px] text-slate-500">{item.country}</div>
                  </td>
                  <td className="px-4 py-3"><span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">{item.type}</span></td>
                  <td className="px-4 py-3 text-xs text-white font-mono">{item.value} <span className="text-slate-500">{item.value_type}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-400">{item.state || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{item.utility || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${item.active ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}`}>
                      {item.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
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