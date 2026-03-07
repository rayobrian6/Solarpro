'use client';
import React, { useEffect, useState, useCallback } from 'react';
import AppShell from '@/components/ui/AppShell';
import type { SolarPanel, Inverter, MountingSystem, Battery } from '@/types';
import { Cpu, Plus, Edit, Trash2, Save, X, Zap, Settings, Sun, Battery as BatteryIcon, Copy, FileText, ToggleLeft, ToggleRight, Database, User } from 'lucide-react';

// Debounce utility for autosave
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeoutId: NodeJS.Timeout;
  return ((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

// Panel Form Component
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
    datasheetUrl: panel?.datasheetUrl || '',
    warranty: panel?.warranty || 25,
    cellType: panel?.cellType || '',
    weight: panel?.weight || 0,
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
        <div><label className="input-label">Warranty (yrs)</label><input className="input" type="number" value={form.warranty} onChange={e => set('warranty', +e.target.value)} /></div>
        <div><label className="input-label">Weight (kg)</label><input className="input" type="number" step="0.1" value={form.weight} onChange={e => set('weight', +e.target.value)} /></div>
        <div className="col-span-2"><label className="input-label">Datasheet URL</label><input className="input" type="url" placeholder="https://..." value={form.datasheetUrl} onChange={e => set('datasheetUrl', e.target.value)} /></div>
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

// Inverter Form Component
function InverterForm({ inverter, onSave, onCancel }: {
  inverter?: Partial<Inverter>; onSave: (i: any) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({
    manufacturer: inverter?.manufacturer || '',
    model: inverter?.model || '',
    type: inverter?.type || 'string',
    capacity: inverter?.capacity || 10,
    efficiency: inverter?.efficiency || 97.0,
    pricePerUnit: inverter?.pricePerUnit || 0,
    warranty: inverter?.warranty || 10,
    datasheetUrl: inverter?.datasheetUrl || '',
  });
  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="card p-5 border-amber-500/30 animate-fade-in">
      <h3 className="font-semibold text-white mb-4">{inverter?.id ? 'Edit Inverter' : 'Add New Inverter'}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="input-label">Manufacturer</label><input className="input" value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} /></div>
        <div><label className="input-label">Model</label><input className="input" value={form.model} onChange={e => set('model', e.target.value)} /></div>
        <div>
          <label className="input-label">Type</label>
          <select className="input" value={form.type} onChange={e => set('type', e.target.value)}>
            <option value="string">String Inverter</option>
            <option value="micro">Microinverter</option>
            <option value="hybrid">Hybrid Inverter</option>
            <option value="optimizer">Power Optimizer</option>
          </select>
        </div>
        <div><label className="input-label">Capacity (kW)</label><input className="input" type="number" step="0.1" value={form.capacity} onChange={e => set('capacity', +e.target.value)} /></div>
        <div><label className="input-label">Efficiency (%)</label><input className="input" type="number" step="0.1" value={form.efficiency} onChange={e => set('efficiency', +e.target.value)} /></div>
        <div><label className="input-label">Price ($)</label><input className="input" type="number" step="1" value={form.pricePerUnit} onChange={e => set('pricePerUnit', +e.target.value)} /></div>
        <div><label className="input-label">Warranty (yrs)</label><input className="input" type="number" value={form.warranty} onChange={e => set('warranty', +e.target.value)} /></div>
        <div className="col-span-2"><label className="input-label">Datasheet URL</label><input className="input" type="url" placeholder="https://..." value={form.datasheetUrl} onChange={e => set('datasheetUrl', e.target.value)} /></div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => onSave(form)} className="btn-primary btn-sm"><Save size={13} /> Save Inverter</button>
        <button onClick={onCancel} className="btn-secondary btn-sm"><X size={13} /> Cancel</button>
      </div>
    </div>
  );
}

// Equipment Card Component with Actions
function EquipmentCard({ 
  item, 
  type, 
  onEdit, 
  onDuplicate, 
  onToggleActive, 
  onDelete,
  isEditing,
  editForm 
}: { 
  item: any; 
  type: 'panel' | 'inverter' | 'mounting' | 'battery';
  onEdit: () => void;
  onDuplicate: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  isEditing: boolean;
  editForm?: React.ReactNode;
}) {
  const isActive = item.isActive !== false;
  
  return (
    <div className={`card p-4 group transition-all ${!isActive ? 'opacity-60' : ''} ${isEditing ? 'ring-2 ring-amber-500' : ''}`}>
      {isEditing && editForm ? (
        editForm
      ) : (
        <>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-semibold text-white text-sm">{item.manufacturer}</div>
              <div className="text-xs text-slate-400">{item.model}</div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={onEdit} className="btn-ghost p-1.5 rounded-lg" title="Edit"><Edit size={12} /></button>
              <button onClick={onDuplicate} className="btn-ghost p-1.5 rounded-lg" title="Duplicate"><Copy size={12} /></button>
              <button onClick={onToggleActive} className="btn-ghost p-1.5 rounded-lg" title={isActive ? 'Disable' : 'Enable'}>
                {isActive ? <ToggleRight size={12} className="text-green-400" /> : <ToggleLeft size={12} />}
              </button>
              <button onClick={onDelete} className="btn-ghost p-1.5 rounded-lg hover:text-red-400" title="Delete"><Trash2 size={12} /></button>
            </div>
          </div>
          
          {type === 'panel' && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Wattage', value: `${item.wattage}W` },
                { label: 'Efficiency', value: `${item.efficiency}%` },
                { label: 'Size', value: `${item.width}×${item.height}m` },
                { label: 'Price/W', value: `$${item.pricePerWatt}` },
              ].map(i => (
                <div key={i.label} className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-slate-500">{i.label}</div>
                  <div className="font-semibold text-white">{i.value}</div>
                </div>
              ))}
            </div>
          )}
          
          {type === 'inverter' && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Capacity', value: `${item.capacity} kW` },
                { label: 'Efficiency', value: `${item.efficiency}%` },
                { label: 'Type', value: item.type },
                { label: 'Price', value: `$${item.pricePerUnit?.toLocaleString() || 0}` },
              ].map(i => (
                <div key={i.label} className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-slate-500">{i.label}</div>
                  <div className="font-semibold text-white capitalize">{i.value}</div>
                </div>
              ))}
            </div>
          )}
          
          {type === 'mounting' && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Type', value: item.type || item.mountType || 'roof' },
                { label: 'Uplift', value: `${item.upliftCapacityLbs || 500} lbs` },
                { label: 'Fasteners', value: item.fastenersPerMount || 2 },
                { label: 'Price', value: item.pricePerWatt ? `$${item.pricePerWatt}/W` : `$${item.pricePerMount || 0}` },
              ].map(i => (
                <div key={i.label} className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-slate-500">{i.label}</div>
                  <div className="font-semibold text-white capitalize">{i.value}</div>
                </div>
              ))}
            </div>
          )}
          
          {type === 'battery' && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Capacity', value: `${item.capacityKwh || item.capacity_kwh} kWh` },
                { label: 'Power', value: `${item.powerKw || item.power_kw} kW` },
                { label: 'Chemistry', value: item.chemistry || 'LFP' },
                { label: 'Price', value: `$${item.pricePerUnit?.toLocaleString() || 0}` },
              ].map(i => (
                <div key={i.label} className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-slate-500">{i.label}</div>
                  <div className="font-semibold text-white">{i.value}</div>
                </div>
              ))}
            </div>
          )}
          
          {/* Status badges */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {item.bifacial && (
              <div className="text-xs bg-purple-500/10 border border-purple-500/20 rounded-lg px-2 py-1 text-purple-300">
                ⚡ Bifacial ×{item.bifacialFactor}
              </div>
            )}
            {item.datasheetUrl && (
              <a href={item.datasheetUrl} target="_blank" rel="noopener noreferrer" className="text-xs bg-blue-500/10 border border-blue-500/20 rounded-lg px-2 py-1 text-blue-300 hover:bg-blue-500/20 flex items-center gap-1">
                <FileText size={10} />Datasheet
              </a>
            )}
            {item.source === 'engineering' && (
              <div className="text-xs bg-teal-500/10 border border-teal-500/20 rounded-lg px-2 py-1 text-teal-300 flex items-center gap-1">
                <Database size={9} />Eng DB
              </div>
            )}
            {item.source === 'merged' && (
              <div className="text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1 text-amber-300 flex items-center gap-1">
                <Database size={9} />Merged
              </div>
            )}
            {item.isCustom && (
              <div className="text-xs bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-2 py-1 text-indigo-300 flex items-center gap-1">
                <User size={9} />Custom
              </div>
            )}
            {!isActive && (
              <div className="text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1 text-red-300">
                Disabled
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function HardwarePage() {
  const [panels, setPanels] = useState<SolarPanel[]>([]);
  const [inverters, setInverters] = useState<Inverter[]>([]);
  const [mountings, setMountings] = useState<MountingSystem[]>([]);
  const [batteries, setBatteries] = useState<Battery[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showPanelForm, setShowPanelForm] = useState(false);
  const [showInverterForm, setShowInverterForm] = useState(false);
  const [editingPanel, setEditingPanel] = useState<SolarPanel | null>(null);
  const [editingInverter, setEditingInverter] = useState<Inverter | null>(null);
  
  const [activeTab, setActiveTab] = useState<'panels' | 'inverters' | 'mounting' | 'batteries'>('panels');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/hardware').then(r => r.json()).then(d => {
      if (d.success) {
        setPanels(d.data.panels);
        setInverters(d.data.inverters);
        setMountings(d.data.mountings);
        setBatteries(d.data.batteries || []);
      }
      setLoading(false);
    });
  }, []);

  // Autosave with debounce
  const debouncedSave = useCallback(
    debounce(async (type: string, data: any) => {
      setSaving(true);
      try {
        const res = await fetch('/api/equipment/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, data }),
        });
        const result = await res.json();
        if (!result.success) {
          console.error('Failed to save equipment:', result.error);
        }
      } catch (err) {
        console.error('Save error:', err);
      }
      setSaving(false);
    }, 2000),
    []
  );

  // Panel handlers
  const handleSavePanel = async (form: any) => {
    setSaving(true);
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
    setSaving(false);
  };

  const handleDuplicatePanel = async (panel: SolarPanel) => {
    const duplicated = { ...panel, model: `${panel.model} (Copy)` };
    delete (duplicated as any).id;
    
    const res = await fetch('/api/hardware', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'panel', data: duplicated }),
    });
    const data = await res.json();
    if (data.success) {
      setPanels(prev => [...prev, data.data]);
    }
  };

  const handleTogglePanelActive = async (panel: SolarPanel) => {
    const updated = { ...panel, isActive: !panel.isActive };
    const res = await fetch('/api/hardware', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'panel', id: panel.id, data: updated }),
    });
    const data = await res.json();
    if (data.success) {
      setPanels(prev => prev.map(p => p.id === panel.id ? data.data : p));
    }
  };

  const handleDeletePanel = async (panel: SolarPanel) => {
    if (!confirm(`Delete ${panel.manufacturer} ${panel.model}?`)) return;
    const res = await fetch('/api/hardware', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'panel', id: panel.id }),
    });
    const data = await res.json();
    if (data.success) {
      setPanels(prev => prev.filter(p => p.id !== panel.id));
    }
  };

  // Inverter handlers
  const handleSaveInverter = async (form: any) => {
    setSaving(true);
    const res = await fetch('/api/hardware', {
      method: editingInverter ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingInverter ? { type: 'inverter', id: editingInverter.id, data: form } : { type: 'inverter', data: form }),
    });
    const data = await res.json();
    if (data.success) {
      if (editingInverter) {
        setInverters(prev => prev.map(i => i.id === editingInverter.id ? data.data : i));
      } else {
        setInverters(prev => [...prev, data.data]);
      }
      setShowInverterForm(false);
      setEditingInverter(null);
    }
    setSaving(false);
  };

  const handleDuplicateInverter = async (inverter: Inverter) => {
    const duplicated = { ...inverter, model: `${inverter.model} (Copy)` };
    delete (duplicated as any).id;
    
    const res = await fetch('/api/hardware', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'inverter', data: duplicated }),
    });
    const data = await res.json();
    if (data.success) {
      setInverters(prev => [...prev, data.data]);
    }
  };

  const handleToggleInverterActive = async (inverter: Inverter) => {
    const updated = { ...inverter, isActive: !inverter.isActive };
    const res = await fetch('/api/hardware', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'inverter', id: inverter.id, data: updated }),
    });
    const data = await res.json();
    if (data.success) {
      setInverters(prev => prev.map(i => i.id === inverter.id ? data.data : i));
    }
  };

  const handleDeleteInverter = async (inverter: Inverter) => {
    if (!confirm(`Delete ${inverter.manufacturer} ${inverter.model}?`)) return;
    const res = await fetch('/api/hardware', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'inverter', id: inverter.id }),
    });
    const data = await res.json();
    if (data.success) {
      setInverters(prev => prev.filter(i => i.id !== inverter.id));
    }
  };

  const tabs = [
    { id: 'panels', label: 'Solar Panels', icon: <Sun size={14} />, count: panels.length },
    { id: 'inverters', label: 'Inverters', icon: <Zap size={14} />, count: inverters.length },
    { id: 'mounting', label: 'Mounting', icon: <Settings size={14} />, count: mountings.length },
    { id: 'batteries', label: 'Batteries', icon: <BatteryIcon size={14} />, count: batteries.length },
  ];

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <div className="spinner w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Cpu size={18} className="text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Equipment Library</h1>
              <p className="text-slate-400 text-sm">Your equipment catalog — engineering DB specs merged with your custom pricing &amp; models</p>
            </div>
          </div>
          {saving && (
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <div className="spinner w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              Saving...
            </div>
          )}
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
              {tab.icon}
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-amber-600' : 'bg-slate-700'}`}>
                {tab.count}
              </span>
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
                <EquipmentCard
                  key={panel.id}
                  item={panel}
                  type="panel"
                  onEdit={() => { setEditingPanel(panel); setShowPanelForm(false); }}
                  onDuplicate={() => handleDuplicatePanel(panel)}
                  onToggleActive={() => handleTogglePanelActive(panel)}
                  onDelete={() => handleDeletePanel(panel)}
                  isEditing={editingPanel?.id === panel.id}
                  editForm={
                    <PanelForm 
                      panel={panel} 
                      onSave={handleSavePanel} 
                      onCancel={() => setEditingPanel(null)} 
                    />
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Inverters Tab */}
        {activeTab === 'inverters' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-white">Inverters ({inverters.length})</h2>
              <button onClick={() => { setShowInverterForm(true); setEditingInverter(null); }} className="btn-primary btn-sm">
                <Plus size={14} /> Add Inverter
              </button>
            </div>
            {(showInverterForm && !editingInverter) && (
              <InverterForm onSave={handleSaveInverter} onCancel={() => setShowInverterForm(false)} />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {inverters.map(inv => (
                <EquipmentCard
                  key={inv.id}
                  item={inv}
                  type="inverter"
                  onEdit={() => { setEditingInverter(inv); setShowInverterForm(false); }}
                  onDuplicate={() => handleDuplicateInverter(inv)}
                  onToggleActive={() => handleToggleInverterActive(inv)}
                  onDelete={() => handleDeleteInverter(inv)}
                  isEditing={editingInverter?.id === inv.id}
                  editForm={
                    <InverterForm 
                      inverter={inv} 
                      onSave={handleSaveInverter} 
                      onCancel={() => setEditingInverter(null)} 
                    />
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Mounting Tab */}
        {activeTab === 'mounting' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-white">Mounting Systems ({mountings.length})</h2>
              <button className="btn-primary btn-sm" disabled>
                <Plus size={14} /> Add Mounting (Coming Soon)
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {mountings.map(m => (
                <EquipmentCard
                  key={m.id}
                  item={m}
                  type="mounting"
                  onEdit={() => {}}
                  onDuplicate={() => {}}
                  onToggleActive={() => {}}
                  onDelete={() => {}}
                  isEditing={false}
                />
              ))}
            </div>
          </div>
        )}

        {/* Batteries Tab */}
        {activeTab === 'batteries' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-white">Batteries ({batteries.length})</h2>
              <button className="btn-primary btn-sm" disabled>
                <Plus size={14} /> Add Battery (Coming Soon)
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {batteries.map(b => (
                <EquipmentCard
                  key={b.id}
                  item={b}
                  type="battery"
                  onEdit={() => {}}
                  onDuplicate={() => {}}
                  onToggleActive={() => {}}
                  onDelete={() => {}}
                  isEditing={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}