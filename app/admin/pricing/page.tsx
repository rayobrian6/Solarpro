'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/ui/AppShell';
import {
  DollarSign, Save, CheckCircle, Home, Layers, Fence,
  RefreshCw, Zap, Package, Building2, User, ChevronDown, ChevronUp,
} from 'lucide-react';

type PricingMode = 'per_panel' | 'per_watt' | 'cost_plus';

interface PricingFormState {
  // ── Mode ──
  pricingMode: PricingMode;
  // ── Per-panel pricing ──
  roofPricePerPanel:    number;
  groundPricePerPanel:  number;
  fencePricePerPanel:   number;
  defaultPanelWattage:  number;
  // ── Per-watt pricing ──
  roofPricePerWatt:     number;
  groundPricePerWatt:   number;
  fencePricePerWatt:    number;
  carportPricePerWatt:  number;
  // ── Cost-plus pricing ──
  materialCostPerPanel: number;
  laborCostPerPanel:    number;
  overheadPercent:      number;
  marginPercent:        number;
  // ── Financial settings ──
  fixedCost:            number;
  utilityEscalation:    number;
  systemLife:           number;
  // ── ITC ──
  isCommercial:         boolean;
  itcRateCommercial:    number;
  itcRateResidential:   number;
}

const DEFAULTS: PricingFormState = {
  pricingMode:          'per_panel',
  roofPricePerPanel:    1364,
  groundPricePerPanel:  1034,
  fencePricePerPanel:   1870,
  defaultPanelWattage:  440,
  roofPricePerWatt:     3.10,
  groundPricePerWatt:   2.35,
  fencePricePerWatt:    4.25,
  carportPricePerWatt:  3.75,
  materialCostPerPanel: 350,
  laborCostPerPanel:    200,
  overheadPercent:      15,
  marginPercent:        25,
  fixedCost:            2000,
  utilityEscalation:    3,
  systemLife:           25,
  isCommercial:         false,
  itcRateCommercial:    30,
  itcRateResidential:   0,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n: number) {
  return '$' + fmt(Math.round(n));
}

function costPlusPerPanel(d: PricingFormState): number {
  const mat  = d.materialCostPerPanel;
  const lab  = d.laborCostPerPanel;
  const ovhd = (mat + lab) * (d.overheadPercent / 100);
  const cost = mat + lab + ovhd;
  return Math.round(cost / (1 - d.marginPercent / 100));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModeButton({ mode, current, label, icon, desc, onClick }: {
  mode: PricingMode; current: PricingMode; label: string; icon: React.ReactNode;
  desc: string; onClick: () => void;
}) {
  const active = mode === current;
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center
        ${active
          ? 'border-orange-500 bg-orange-500/10 text-orange-400'
          : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-gray-300'
        }`}
    >
      <div className={`p-2 rounded-lg ${active ? 'bg-orange-500/20' : 'bg-white/5'}`}>{icon}</div>
      <span className="font-semibold text-sm">{label}</span>
      <span className="text-xs opacity-70 leading-tight">{desc}</span>
    </button>
  );
}

function NumberInput({ label, value, onChange, prefix, suffix, step, min, helpText }: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; step?: number; min?: number; helpText?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400 font-medium">{label}</label>
      <div className="flex items-center bg-white/5 border border-white/10 rounded-lg overflow-hidden focus-within:border-orange-500/50">
        {prefix && <span className="px-3 py-2 text-gray-400 text-sm border-r border-white/10 bg-white/5">{prefix}</span>}
        <input
          type="number"
          value={value}
          step={step ?? 1}
          min={min ?? 0}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="flex-1 bg-transparent px-3 py-2 text-white text-sm outline-none"
        />
        {suffix && <span className="px-3 py-2 text-gray-400 text-sm border-l border-white/10 bg-white/5">{suffix}</span>}
      </div>
      {helpText && <p className="text-xs text-gray-500">{helpText}</p>}
    </div>
  );
}

function SectionCard({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/10 rounded-lg text-orange-400">{icon}</div>
          <span className="font-semibold text-white">{title}</span>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div className="px-6 pb-6 pt-2">{children}</div>}
    </div>
  );
}

// ── Live Preview ──────────────────────────────────────────────────────────────

function LivePreview({ draft }: { draft: PricingFormState }) {
  const [roofPanels,   setRoofPanels]   = useState(20);
  const [groundPanels, setGroundPanels] = useState(0);
  const [fencePanels,  setFencePanels]  = useState(0);

  const calcPrice = (type: 'roof' | 'ground' | 'fence', count: number): number => {
    if (count === 0) return 0;
    switch (draft.pricingMode) {
      case 'per_panel': {
        const ppp = type === 'roof' ? draft.roofPricePerPanel
                  : type === 'ground' ? draft.groundPricePerPanel
                  : draft.fencePricePerPanel;
        return count * ppp;
      }
      case 'per_watt': {
        const ppw = type === 'roof' ? draft.roofPricePerWatt
                  : type === 'ground' ? draft.groundPricePerWatt
                  : draft.fencePricePerWatt;
        return Math.round(count * draft.defaultPanelWattage * ppw);
      }
      case 'cost_plus': {
        return count * costPlusPerPanel(draft);
      }
    }
  };

  const roofTotal   = calcPrice('roof',   roofPanels);
  const groundTotal = calcPrice('ground', groundPanels);
  const fenceTotal  = calcPrice('fence',  fencePanels);
  const subtotal    = roofTotal + groundTotal + fenceTotal;
  const total       = subtotal + draft.fixedCost;
  const totalPanels = roofPanels + groundPanels + fencePanels;
  const totalWatts  = totalPanels * draft.defaultPanelWattage;
  const effectivePpw = totalWatts > 0 ? (total / totalWatts).toFixed(2) : '—';

  const itcRate   = draft.isCommercial ? draft.itcRateCommercial : draft.itcRateResidential;
  const itcAmount = Math.round(total * (itcRate / 100));
  const netCost   = total - itcAmount;

  return (
    <div className="bg-gradient-to-br from-orange-500/10 to-yellow-500/5 border border-orange-500/20 rounded-2xl p-6">
      <h3 className="font-bold text-white mb-4 flex items-center gap-2">
        <Zap size={16} className="text-orange-400" />
        Live Price Preview
      </h3>

      {/* Panel count sliders */}
      <div className="space-y-3 mb-5">
        {[
          { label: 'Roof Panels', value: roofPanels, set: setRoofPanels, color: 'orange' },
          { label: 'Ground Panels', value: groundPanels, set: setGroundPanels, color: 'blue' },
          { label: 'Fence Panels', value: fencePanels, set: setFencePanels, color: 'green' },
        ].map(({ label, value, set, color }) => (
          <div key={label} className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-28 shrink-0">{label}</span>
            <input
              type="range" min={0} max={60} value={value}
              onChange={e => set(Number(e.target.value))}
              className="flex-1 accent-orange-500"
            />
            <span className="text-xs text-white w-6 text-right">{value}</span>
          </div>
        ))}
      </div>

      {/* Price breakdown */}
      <div className="space-y-2 text-sm">
        {roofPanels > 0 && (
          <div className="flex justify-between text-gray-300">
            <span>Roof ({roofPanels} panels)</span>
            <span>{fmtCurrency(roofTotal)}</span>
          </div>
        )}
        {groundPanels > 0 && (
          <div className="flex justify-between text-gray-300">
            <span>Ground ({groundPanels} panels)</span>
            <span>{fmtCurrency(groundTotal)}</span>
          </div>
        )}
        {fencePanels > 0 && (
          <div className="flex justify-between text-gray-300">
            <span>Fence ({fencePanels} panels)</span>
            <span>{fmtCurrency(fenceTotal)}</span>
          </div>
        )}
        <div className="flex justify-between text-gray-400 text-xs">
          <span>Fixed / Permit / Misc</span>
          <span>{fmtCurrency(draft.fixedCost)}</span>
        </div>
        <div className="border-t border-white/10 pt-2 flex justify-between font-bold text-white">
          <span>Gross System Price</span>
          <span>{fmtCurrency(total)}</span>
        </div>
        {itcRate > 0 && (
          <>
            <div className="flex justify-between text-green-400 text-xs">
              <span>ITC ({itcRate}% — {draft.isCommercial ? 'Commercial' : 'Residential'})</span>
              <span>−{fmtCurrency(itcAmount)}</span>
            </div>
            <div className="flex justify-between font-semibold text-green-300">
              <span>Net After ITC</span>
              <span>{fmtCurrency(netCost)}</span>
            </div>
          </>
        )}
        {itcRate === 0 && (
          <div className="text-xs text-gray-500 italic">
            No ITC for {draft.isCommercial ? 'commercial' : 'residential'} (rate = 0%)
          </div>
        )}
        <div className="border-t border-white/10 pt-2 flex justify-between text-xs text-gray-400">
          <span>Effective $/W</span>
          <span>${effectivePpw}/W</span>
        </div>
        {draft.pricingMode === 'cost_plus' && (
          <div className="text-xs text-gray-400">
            Cost/panel: {fmtCurrency(draft.materialCostPerPanel + draft.laborCostPerPanel)} +{' '}
            {draft.overheadPercent}% overhead → sell at {fmtCurrency(costPlusPerPanel(draft))}/panel
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const router = useRouter();
  const [draft, setDraft]     = useState<PricingFormState>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Load config from DB on mount
  useEffect(() => {
    fetch('/api/pricing', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          const c = d.data;
          setDraft({
            pricingMode:          c.pricingMode          ?? DEFAULTS.pricingMode,
            roofPricePerPanel:    c.roofPricePerPanel    ?? DEFAULTS.roofPricePerPanel,
            groundPricePerPanel:  c.groundPricePerPanel  ?? DEFAULTS.groundPricePerPanel,
            fencePricePerPanel:   c.fencePricePerPanel   ?? DEFAULTS.fencePricePerPanel,
            defaultPanelWattage:  c.defaultPanelWattage  ?? DEFAULTS.defaultPanelWattage,
            roofPricePerWatt:     c.roofPricePerWatt     ?? DEFAULTS.roofPricePerWatt,
            groundPricePerWatt:   c.groundPricePerWatt   ?? DEFAULTS.groundPricePerWatt,
            fencePricePerWatt:    c.fencePricePerWatt    ?? DEFAULTS.fencePricePerWatt,
            carportPricePerWatt:  c.carportPricePerWatt  ?? DEFAULTS.carportPricePerWatt,
            materialCostPerPanel: c.materialCostPerPanel ?? DEFAULTS.materialCostPerPanel,
            laborCostPerPanel:    c.laborCostPerPanel    ?? DEFAULTS.laborCostPerPanel,
            overheadPercent:      c.overheadPercent      ?? DEFAULTS.overheadPercent,
            marginPercent:        c.marginPercent        ?? DEFAULTS.marginPercent,
            fixedCost:            c.fixedCost            ?? DEFAULTS.fixedCost,
            utilityEscalation:    c.utilityEscalation    ?? DEFAULTS.utilityEscalation,
            systemLife:           c.systemLife           ?? DEFAULTS.systemLife,
            isCommercial:         c.isCommercial         ?? DEFAULTS.isCommercial,
            itcRateCommercial:    c.itcRateCommercial    ?? DEFAULTS.itcRateCommercial,
            itcRateResidential:   c.itcRateResidential   ?? DEFAULTS.itcRateResidential,
          });
        }
      })
      .catch(err => console.error('[PricingPage] load error:', err))
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof PricingFormState>(k: K, v: PricingFormState[K]) => {
    setDraft(prev => ({ ...prev, [k]: v }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Save failed');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="animate-spin text-orange-400" size={32} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <DollarSign className="text-orange-400" size={28} />
              Pricing Configuration
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Control how system prices are calculated for proposals
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all
              ${saved
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20'
              }`}
          >
            {saved ? <CheckCircle size={18} /> : saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Configuration'}
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: settings */}
          <div className="lg:col-span-2 space-y-6">

            {/* Pricing Mode Selector */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="font-bold text-white mb-1">Pricing Method</h2>
              <p className="text-gray-400 text-xs mb-4">
                Choose how system prices are calculated. This affects all new proposals.
              </p>
              <div className="flex gap-3">
                <ModeButton
                  mode="per_panel" current={draft.pricingMode}
                  label="Per Panel" icon={<Package size={20} />}
                  desc="Fixed price per panel by type"
                  onClick={() => set('pricingMode', 'per_panel')}
                />
                <ModeButton
                  mode="per_watt" current={draft.pricingMode}
                  label="Per Watt" icon={<Zap size={20} />}
                  desc="$/W × system size by type"
                  onClick={() => set('pricingMode', 'per_watt')}
                />
                <ModeButton
                  mode="cost_plus" current={draft.pricingMode}
                  label="Cost Plus" icon={<DollarSign size={20} />}
                  desc="Materials + labor + overhead + margin"
                  onClick={() => set('pricingMode', 'cost_plus')}
                />
              </div>
            </div>

            {/* Per-Panel Pricing */}
            {draft.pricingMode === 'per_panel' && (
              <SectionCard title="Per-Panel Pricing" icon={<Package size={18} />}>
                <p className="text-gray-400 text-xs mb-4">
                  Set a fixed price per panel for each installation type.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <NumberInput
                    label="Roof (per panel)"
                    value={draft.roofPricePerPanel}
                    onChange={v => set('roofPricePerPanel', v)}
                    prefix="$"
                    helpText={`≈ $${(draft.roofPricePerPanel / draft.defaultPanelWattage).toFixed(2)}/W`}
                  />
                  <NumberInput
                    label="Ground Mount (per panel)"
                    value={draft.groundPricePerPanel}
                    onChange={v => set('groundPricePerPanel', v)}
                    prefix="$"
                    helpText={`≈ $${(draft.groundPricePerPanel / draft.defaultPanelWattage).toFixed(2)}/W`}
                  />
                  <NumberInput
                    label="Sol Fence (per panel)"
                    value={draft.fencePricePerPanel}
                    onChange={v => set('fencePricePerPanel', v)}
                    prefix="$"
                    helpText={`≈ $${(draft.fencePricePerPanel / draft.defaultPanelWattage).toFixed(2)}/W`}
                  />
                </div>
                <div className="mt-4 max-w-xs">
                  <NumberInput
                    label="Default Panel Wattage"
                    value={draft.defaultPanelWattage}
                    onChange={v => set('defaultPanelWattage', v)}
                    suffix="W"
                    helpText="Used for $/W conversion display"
                  />
                </div>
              </SectionCard>
            )}

            {/* Per-Watt Pricing */}
            {draft.pricingMode === 'per_watt' && (
              <SectionCard title="Per-Watt Pricing" icon={<Zap size={18} />}>
                <p className="text-gray-400 text-xs mb-4">
                  Set a price per watt for each installation type. Price = $/W × system size in watts.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <NumberInput
                    label="Roof ($/W)"
                    value={draft.roofPricePerWatt}
                    onChange={v => set('roofPricePerWatt', v)}
                    prefix="$"
                    suffix="/W"
                    step={0.01}
                    helpText={`${draft.defaultPanelWattage}W panel → $${(draft.roofPricePerWatt * draft.defaultPanelWattage).toFixed(0)}/panel`}
                  />
                  <NumberInput
                    label="Ground Mount ($/W)"
                    value={draft.groundPricePerWatt}
                    onChange={v => set('groundPricePerWatt', v)}
                    prefix="$"
                    suffix="/W"
                    step={0.01}
                    helpText={`${draft.defaultPanelWattage}W panel → $${(draft.groundPricePerWatt * draft.defaultPanelWattage).toFixed(0)}/panel`}
                  />
                  <NumberInput
                    label="Sol Fence ($/W)"
                    value={draft.fencePricePerWatt}
                    onChange={v => set('fencePricePerWatt', v)}
                    prefix="$"
                    suffix="/W"
                    step={0.01}
                    helpText={`${draft.defaultPanelWattage}W panel → $${(draft.fencePricePerWatt * draft.defaultPanelWattage).toFixed(0)}/panel`}
                  />
                  <NumberInput
                    label="Carport ($/W)"
                    value={draft.carportPricePerWatt}
                    onChange={v => set('carportPricePerWatt', v)}
                    prefix="$"
                    suffix="/W"
                    step={0.01}
                    helpText={`${draft.defaultPanelWattage}W panel → $${(draft.carportPricePerWatt * draft.defaultPanelWattage).toFixed(0)}/panel`}
                  />
                </div>
                <div className="mt-4 max-w-xs">
                  <NumberInput
                    label="Default Panel Wattage"
                    value={draft.defaultPanelWattage}
                    onChange={v => set('defaultPanelWattage', v)}
                    suffix="W"
                  />
                </div>
              </SectionCard>
            )}

            {/* Cost-Plus Pricing */}
            {draft.pricingMode === 'cost_plus' && (
              <SectionCard title="Cost-Plus Pricing" icon={<DollarSign size={18} />}>
                <p className="text-gray-400 text-xs mb-4">
                  Price = (material + labor) × (1 + overhead%) ÷ (1 − margin%). Applied per panel.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <NumberInput
                    label="Material Cost (per panel)"
                    value={draft.materialCostPerPanel}
                    onChange={v => set('materialCostPerPanel', v)}
                    prefix="$"
                    helpText="Equipment, racking, wiring per panel"
                  />
                  <NumberInput
                    label="Labor Cost (per panel)"
                    value={draft.laborCostPerPanel}
                    onChange={v => set('laborCostPerPanel', v)}
                    prefix="$"
                    helpText="Installation labor per panel"
                  />
                  <NumberInput
                    label="Overhead"
                    value={draft.overheadPercent}
                    onChange={v => set('overheadPercent', v)}
                    suffix="%"
                    step={0.5}
                    helpText="Applied to material + labor"
                  />
                  <NumberInput
                    label="Profit Margin"
                    value={draft.marginPercent}
                    onChange={v => set('marginPercent', v)}
                    suffix="%"
                    step={0.5}
                    helpText="Gross margin on selling price"
                  />
                </div>
                <div className="mt-4 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-sm">
                  <span className="text-gray-400">Sell price per panel: </span>
                  <span className="text-orange-300 font-bold">{fmtCurrency(costPlusPerPanel(draft))}</span>
                  <span className="text-gray-500 ml-2">
                    (cost: {fmtCurrency(draft.materialCostPerPanel + draft.laborCostPerPanel)} +{' '}
                    {draft.overheadPercent}% overhead)
                  </span>
                </div>
                <div className="mt-4 max-w-xs">
                  <NumberInput
                    label="Default Panel Wattage"
                    value={draft.defaultPanelWattage}
                    onChange={v => set('defaultPanelWattage', v)}
                    suffix="W"
                  />
                </div>
              </SectionCard>
            )}

            {/* ITC / Tax Credit */}
            <SectionCard title="Federal ITC & Tax Credits" icon={<Building2 size={18} />}>
              <p className="text-gray-400 text-xs mb-4">
                Residential ITC was eliminated. Commercial ITC (30%) still applies for qualifying projects.
              </p>

              {/* Commercial / Residential toggle */}
              <div className="flex gap-3 mb-5">
                <button
                  onClick={() => set('isCommercial', false)}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all font-medium text-sm
                    ${!draft.isCommercial
                      ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20'
                    }`}
                >
                  <User size={16} />
                  Residential
                </button>
                <button
                  onClick={() => set('isCommercial', true)}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all font-medium text-sm
                    ${draft.isCommercial
                      ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20'
                    }`}
                >
                  <Building2 size={16} />
                  Commercial
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={`rounded-xl p-4 border-2 transition-all ${!draft.isCommercial ? 'border-blue-500/40 bg-blue-500/5' : 'border-white/5 opacity-60'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <User size={14} className="text-blue-400" />
                    <span className="text-sm font-medium text-white">Residential ITC Rate</span>
                  </div>
                  <NumberInput
                    label=""
                    value={draft.itcRateResidential}
                    onChange={v => set('itcRateResidential', v)}
                    suffix="%"
                    step={1}
                    helpText="Set to 0 — no federal ITC for residential"
                  />
                </div>
                <div className={`rounded-xl p-4 border-2 transition-all ${draft.isCommercial ? 'border-purple-500/40 bg-purple-500/5' : 'border-white/5 opacity-60'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 size={14} className="text-purple-400" />
                    <span className="text-sm font-medium text-white">Commercial ITC Rate</span>
                  </div>
                  <NumberInput
                    label=""
                    value={draft.itcRateCommercial}
                    onChange={v => set('itcRateCommercial', v)}
                    suffix="%"
                    step={1}
                    helpText="IRA 2022: 30% for commercial solar"
                  />
                </div>
              </div>

              <div className="mt-3 p-3 rounded-lg bg-white/5 text-xs text-gray-400">
                Active rate for proposals:{' '}
                <span className={`font-bold ${draft.isCommercial ? 'text-purple-400' : 'text-blue-400'}`}>
                  {draft.isCommercial ? draft.itcRateCommercial : draft.itcRateResidential}%
                  {' '}({draft.isCommercial ? 'Commercial' : 'Residential'})
                </span>
              </div>
            </SectionCard>

            {/* Financial Settings */}
            <SectionCard title="Financial Settings" icon={<DollarSign size={18} />} defaultOpen={false}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <NumberInput
                  label="Fixed Cost (permits, misc)"
                  value={draft.fixedCost}
                  onChange={v => set('fixedCost', v)}
                  prefix="$"
                  helpText="Added to every system price"
                />
                <NumberInput
                  label="Utility Escalation"
                  value={draft.utilityEscalation}
                  onChange={v => set('utilityEscalation', v)}
                  suffix="% / yr"
                  step={0.1}
                  helpText="Annual utility rate increase"
                />
                <NumberInput
                  label="System Life"
                  value={draft.systemLife}
                  onChange={v => set('systemLife', v)}
                  suffix="years"
                  helpText="For lifetime savings calculation"
                />
              </div>
            </SectionCard>

          </div>

          {/* Right column: live preview */}
          <div className="space-y-4">
            <LivePreview draft={draft} />

            {/* Mode summary card */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-xs text-gray-400 space-y-2">
              <p className="font-semibold text-white text-sm">Active Configuration</p>
              <div className="flex justify-between">
                <span>Pricing Mode</span>
                <span className="text-orange-400 font-medium capitalize">{draft.pricingMode.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span>Project Type</span>
                <span className={draft.isCommercial ? 'text-purple-400' : 'text-blue-400'}>
                  {draft.isCommercial ? 'Commercial' : 'Residential'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>ITC Rate</span>
                <span className="text-green-400">
                  {draft.isCommercial ? draft.itcRateCommercial : draft.itcRateResidential}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>Fixed Cost</span>
                <span>{fmtCurrency(draft.fixedCost)}</span>
              </div>
              {draft.pricingMode === 'per_panel' && (
                <>
                  <div className="flex justify-between">
                    <span>Roof/panel</span>
                    <span>{fmtCurrency(draft.roofPricePerPanel)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ground/panel</span>
                    <span>{fmtCurrency(draft.groundPricePerPanel)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Fence/panel</span>
                    <span>{fmtCurrency(draft.fencePricePerPanel)}</span>
                  </div>
                </>
              )}
              {draft.pricingMode === 'per_watt' && (
                <>
                  <div className="flex justify-between">
                    <span>Roof $/W</span>
                    <span>${draft.roofPricePerWatt.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ground $/W</span>
                    <span>${draft.groundPricePerWatt.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Fence $/W</span>
                    <span>${draft.fencePricePerWatt.toFixed(2)}</span>
                  </div>
                </>
              )}
              {draft.pricingMode === 'cost_plus' && (
                <>
                  <div className="flex justify-between">
                    <span>Material/panel</span>
                    <span>{fmtCurrency(draft.materialCostPerPanel)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Labor/panel</span>
                    <span>{fmtCurrency(draft.laborCostPerPanel)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Overhead</span>
                    <span>{draft.overheadPercent}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Margin</span>
                    <span>{draft.marginPercent}%</span>
                  </div>
                  <div className="flex justify-between font-semibold text-orange-400">
                    <span>Sell price/panel</span>
                    <span>{fmtCurrency(costPlusPerPanel(draft))}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}