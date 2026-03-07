'use client';
import React, { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import type { SolarPanel, Inverter, MountingSystem, PricingConfig } from '@/types';
import { Cpu, Plus, Edit, Trash2, Save, X, Zap, Settings, DollarSign, Sun } from 'lucide-react';

function PanelForm({ panel, onSave, onCancel }: {
  panel?: Partial<SolarPanel>; onSave: (p: any) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({
    manufacturer: panel?.manufacturer || '',
    model: panel?.model || '',
    wattage: panel?.wattage || 400,
    width: panel?.width || 1.046,
    height: panel?.height || 1.812,
    efficiency: panel?.efficiency || 21.0,
    bifacial: panel?.bifacial || false,
    bifacialFactor: panel?.bifacialFactor || 1.0,
    temperatureCoeff: panel?.temperatureCoeff || -0.30,
    pricePerWatt: panel?.pricePerWatt || 0.35,
  });
  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="card p-5 border-amber-500/30 animate-fade-in">
      <h3 className="font-semibold text-white mb-4">{panel?.id ? 'Edit Panel' : 'Add New Panel'}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="input-label">Manufacturer</label><input className="input" value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} /></div>
        <div><label className="input-label">Model</label><input className="input" value={form.model} onChange={e => set('model', e.target.value)} /></div>
        <div><label className="input-label">Wattage (W)</label><input className="input" type="number" value={form.wattage} onChange={e => set('wattage', +e.target.value)} /></div>
        <div><label className="input-label">Efficiency (%)</label><input className="input" type="number" step="0.1" value={form.efficiency} onChange={e => set('efficiency', +e.target.value)} /></div>
        <div><label className="input-label">Width (m)</label><input className="input" type="number" step="0.001" value={form.width} onChange={e => set('width', +e.target.value)} /></div>
        <div><label className="input-label">Height (m)</label><input className="input" type="number" step="0.001" value={form.height} onChange={e => set('height', +e.target.value)} /></div>
        <div><label className="input-label">Price/Watt ($)</label><input className="input" type="number" step="0.01" value={form.pricePerWatt} onChange={e => set('pricePerWatt', +e.target.value)} /></div>
        <div><label className="input-label">Temp Coeff (%/°C)</label><input className="input" type="number" step="0.01" value={form.temperatureCoeff} onChange={e => set('temperatureCoeff', +e.target.value)} /></div>
        <div className="flex items-center gap-3 col-span-2">
          <label className="input-label mb-0">Bifacial Panel</label>
          <button onClick={() => set('bifacial', !form.bifacial)} className={`w-10 h-5 rounded-full transition-colors relative ${form.bifacial ? 'bg-amber-500' : 'bg-slate-600'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.bifacial ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          {form.bifacial && (
            <div className="flex items-center gap-2">
              <label className="input-label mb-0">Bifacial Factor</label>
              <input className="input w-24" type="number" step="0.01" min="1.0" max="1.5" value={form.bifacialFactor} onChange={e => set('bifacialFactor', +e.target.value)} />
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => onSave(form)} className="btn-primary btn-sm"><Save size={13} /> Save Panel</button>
        <button onClick={onCancel} className="btn-secondary btn-sm"><X size={13} /> Cancel</button>
      </div>
    </div>
  );
}

export default function HardwarePage() {
  const [panels, setPanels] = useState<SolarPanel[]>([]);
  const [inverters, setInverters] = useState<Inverter[]>([]);
  const [mountings, setMountings] = useState<MountingSystem[]>([]);
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPanelForm, setShowPanelForm] = useState(false);
  const [editingPanel, setEditingPanel] = useState<SolarPanel | null>(null);
  const [activeTab, setActiveTab] = useState<'panels' | 'inverters' | 'mounting' | 'pricing'>('panels');
  const [pricingDraft, setPricingDraft] = useState<PricingConfig | null>(null);
  const [savingPricing, setSavingPricing] = useState(false);

  useEffect(() => {
    fetch('/api/hardware').then(r => r.json()).then(d => {
      if (d.success) {
        setPanels(d.data.panels);
        setInverters(d.data.inverters);
        setMountings(d.data.mountings);
        setPricing(d.data.pricing);
        setPricingDraft(d.data.pricing);
      }
      setLoading(false);
    });
  }, []);

  const handleSavePanel = async (form: any) => {
    const res = await fetch('/api/hardware', {
      method: editingPanel ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingPanel ? { type: 'panel', id: editingPanel.id, data: form } : { type: 'panel', data: form }),
    });
    const data = await res.json();
    if (data.success) {
      if (editingPanel) {
        setPanels(prev => prev.map(p => p.id === editingPanel.id ? data.data : p));
      } else {
        setPanels(prev => [...prev, data.data]);
      }
      setShowPanelForm(false);
      setEditingPanel(null);
    }
  };

  const handleSavePricing = async () => {
    if (!pricingDraft) return;
    setSavingPricing(true);
    const res = await fetch('/api/hardware', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pricing', data: pricingDraft }),
    });
    const data = await res.json();
    if (data.success) setPricing(data.data);
    setSavingPricing(false);
  };

  const tabs = [
    { id: 'panels', label: 'Solar Panels', icon: <Sun size={14} /> },
    { id: 'inverters', label: 'Inverters', icon: <Zap size={14} /> },
    { id: 'mounting', label: 'Mounting', icon: <Settings size={14} /> },
    { id: 'pricing', label: 'Pricing', icon: <DollarSign size={14} /> },
  ];

  return (
    <AppShell>
      <div className="p-6 space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Cpu size={18} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Hardware Configuration</h1>
            <p className="text-slate-400 text-sm">Manage panels, inverters, mounting systems, and pricing</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Panels Tab */}
        {activeTab === 'panels' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-white">Solar Panels ({panels.length})</h2>
              <button onClick={() => { setShowPanelForm(true); setEditingPanel(null); }} className="btn-primary btn-sm">
                <Plus size={14} /> Add Panel
              </button>
            </div>
            {(showPanelForm && !editingPanel) && (
              <PanelForm onSave={handleSavePanel} onCancel={() => setShowPanelForm(false)} />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {panels.map(panel => (
                <div key={panel.id} className="card p-4 group">
                  {editingPanel?.id === panel.id ? (
                    <PanelForm panel={panel} onSave={handleSavePanel} onCancel={() => setEditingPanel(null)} />
                  ) : (
                    <>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="font-semibold text-white text-sm">{panel.manufacturer}</div>
                          <div className="text-xs text-slate-400">{panel.model}</div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditingPanel(panel)} className="btn-ghost p-1.5 rounded-lg"><Edit size={12} /></button>
                          <button onClick={() => setPanels(prev => prev.filter(p => p.id !== panel.id))} className="btn-ghost p-1.5 rounded-lg hover:text-red-400"><Trash2 size={12} /></button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {[
                          { label: 'Wattage', value: `${panel.wattage}W` },
                          { label: 'Efficiency', value: `${panel.efficiency}%` },
                          { label: 'Size', value: `${panel.width}×${panel.height}m` },
                          { label: 'Price/W', value: `$${panel.pricePerWatt}` },
                        ].map(item => (
                          <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                            <div className="text-slate-500">{item.label}</div>
                            <div className="font-semibold text-white">{item.value}</div>
                          </div>
                        ))}
                      </div>
                      {panel.bifacial && (
                        <div className="mt-2 text-xs bg-purple-500/10 border border-purple-500/20 rounded-lg px-2 py-1 text-purple-300">
                          ⚡ Bifacial ×{panel.bifacialFactor}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inverters Tab */}
        {activeTab === 'inverters' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-white">Inverters ({inverters.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {inverters.map(inv => (
                <div key={inv.id} className="card p-4">
                  <div className="font-semibold text-white text-sm">{inv.manufacturer}</div>
                  <div className="text-xs text-slate-400 mb-3">{inv.model}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      { label: 'Capacity', value: `${inv.capacity} kW` },
                      { label: 'Efficiency', value: `${inv.efficiency}%` },
                      { label: 'Type', value: inv.type },
                      { label: 'Price', value: `$${inv.pricePerUnit.toLocaleString()}` },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                        <div className="text-slate-500">{item.label}</div>
                        <div className="font-semibold text-white capitalize">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mounting Tab */}
        {activeTab === 'mounting' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-white">Mounting Systems ({mountings.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {mountings.map(m => (
                <div key={m.id} className={`card p-4 border-l-4 ${
                  m.type === 'roof' ? 'border-l-amber-500' :
                  m.type === 'ground' ? 'border-l-teal-500' : 'border-l-purple-500'
                }`}>
                  <div className="font-semibold text-white text-sm mb-1">{m.name}</div>
                  <div className="text-xs text-slate-400 mb-3">{m.description}</div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={`badge ${m.type === 'roof' ? 'badge-roof' : m.type === 'ground' ? 'badge-ground' : 'badge-fence'}`}>{m.type}</span>
                    <span className="font-semibold text-white">${m.pricePerWatt}/W</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pricing Tab */}
        {activeTab === 'pricing' && pricingDraft && (
          <div className="space-y-4 max-w-2xl">
            <h2 className="font-semibold text-white">Pricing Configuration</h2>
            <div className="card p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'pricePerWatt', label: 'Price Per Watt ($)', step: 0.01 },
                  { key: 'laborCostPerWatt', label: 'Labor Cost Per Watt ($)', step: 0.01 },
                  { key: 'equipmentCostPerWatt', label: 'Equipment Cost Per Watt ($)', step: 0.01 },
                  { key: 'fixedCosts', label: 'Fixed Costs ($)', step: 100 },
                  { key: 'profitMargin', label: 'Profit Margin (%)', step: 1 },
                  { key: 'taxCreditRate', label: 'Tax Credit Rate (%)', step: 1 },
                  { key: 'utilityEscalationRate', label: 'Utility Escalation Rate (%/yr)', step: 0.1 },
                  { key: 'systemLifeYears', label: 'System Life (years)', step: 1 },
                ].map(({ key, label, step }) => (
                  <div key={key}>
                    <label className="input-label">{label}</label>
                    <input
                      className="input"
                      type="number"
                      step={step}
                      value={(pricingDraft as any)[key]}
                      onChange={e => setPricingDraft(prev => prev ? { ...prev, [key]: parseFloat(e.target.value) } : prev)}
                    />
                  </div>
                ))}
              </div>
              <button onClick={handleSavePricing} disabled={savingPricing} className="btn-primary">
                {savingPricing ? <><span className="spinner w-4 h-4" /> Saving...</> : <><Save size={14} /> Save Pricing Config</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}