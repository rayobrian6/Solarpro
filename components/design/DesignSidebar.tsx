'use client';
import React, { useEffect, useState } from 'react';
import type { SystemType, SolarPanel, PlacedPanel, Project } from '@/types';
import {
  Settings, Zap, DollarSign, Sun, ChevronDown, ChevronUp,
  Play, Loader, TrendingUp, Leaf, BarChart2, ArrowRight
} from 'lucide-react';
import Link from 'next/link';

interface Props {
  systemType: SystemType;
  tilt: number; setTilt: (v: number) => void;
  azimuth: number; setAzimuth: (v: number) => void;
  rowSpacing: number; setRowSpacing: (v: number) => void;
  panelSpacing: number; setPanelSpacing: (v: number) => void;
  setback: number; setSetback: (v: number) => void;
  fenceHeight: number; setFenceHeight: (v: number) => void;
  groundHeight: number; setGroundHeight: (v: number) => void;
  panelsPerRow: number; setPanelsPerRow: (v: number) => void;
  bifacialOptimized: boolean; setBifacialOptimized: (v: boolean) => void;
  selectedPanel: SolarPanel; setSelectedPanel: (p: SolarPanel) => void;
  panels: PlacedPanel[];
  systemSizeKw: number;
  production: any;
  costEstimate: any;
  calculating: boolean;
  onCalculate: () => void;
  project: Project;
}

function SliderRow({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-xs text-slate-400">{label}</label>
        <span className="text-xs font-semibold text-white">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
      />
    </div>
  );
}

function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-700/50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-wide">
          {icon}{title}
        </div>
        {open ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

const AZIMUTH_LABELS: Record<number, string> = {
  0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW', 360: 'N'
};
function azimuthLabel(az: number) {
  const nearest = Object.keys(AZIMUTH_LABELS).map(Number).reduce((a, b) => Math.abs(b - az) < Math.abs(a - az) ? b : a);
  return AZIMUTH_LABELS[nearest];
}

export default function DesignSidebar({
  systemType, tilt, setTilt, azimuth, setAzimuth,
  rowSpacing, setRowSpacing, panelSpacing, setPanelSpacing,
  setback, setSetback, fenceHeight, setFenceHeight,
  groundHeight, setGroundHeight, panelsPerRow, setPanelsPerRow,
  bifacialOptimized, setBifacialOptimized,
  selectedPanel, setSelectedPanel,
  panels, systemSizeKw, production, costEstimate,
  calculating, onCalculate, project
}: Props) {
  const [availablePanels, setAvailablePanels] = useState<SolarPanel[]>([]);

  useEffect(() => {
    fetch('/api/hardware').then(r => r.json()).then(d => {
      if (d.success) setAvailablePanels(d.data.panels);
    });
  }, []);

  const MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D'];

  return (
    <div className="w-72 bg-slate-900 border-l border-slate-700/50 flex flex-col overflow-hidden flex-shrink-0">
      <div className="flex-1 overflow-y-auto">

        {/* Panel Selection */}
        <Section title="Panel" icon={<Sun size={12} />}>
          <select
            className="select text-xs"
            value={selectedPanel.id}
            onChange={e => {
              const p = availablePanels.find(p => p.id === e.target.value);
              if (p) setSelectedPanel(p);
            }}
          >
            {availablePanels.map(p => (
              <option key={p.id} value={p.id}>{p.manufacturer} {p.model}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-slate-400">Wattage</div>
              <div className="font-semibold text-white">{selectedPanel.wattage}W</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-slate-400">Efficiency</div>
              <div className="font-semibold text-white">{selectedPanel.efficiency}%</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-slate-400">Size</div>
              <div className="font-semibold text-white">{selectedPanel.width}×{selectedPanel.height}m</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-slate-400">Bifacial</div>
              <div className={`font-semibold ${selectedPanel.bifacial ? 'text-emerald-400' : 'text-slate-400'}`}>
                {selectedPanel.bifacial ? `Yes (×${selectedPanel.bifacialFactor})` : 'No'}
              </div>
            </div>
          </div>
        </Section>

        {/* System Configuration */}
        <Section title="Configuration" icon={<Settings size={12} />}>
          {systemType !== 'fence' && (
            <SliderRow label="Tilt Angle" value={tilt} min={0} max={45} step={1} unit="°" onChange={setTilt} />
          )}
          {systemType === 'fence' && (
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2 text-xs text-purple-300">
              ⚡ Vertical mount (90°) — Bifacial optimized
            </div>
          )}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs text-slate-400">Azimuth</label>
              <span className="text-xs font-semibold text-white">{azimuth}° ({azimuthLabel(azimuth)})</span>
            </div>
            <input
              type="range" min={0} max={360} step={5} value={azimuth}
              onChange={e => setAzimuth(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
            />
            {/* Azimuth compass mini */}
            <div className="flex justify-between text-xs text-slate-600 mt-0.5">
              <span>N</span><span>E</span><span>S</span><span>W</span><span>N</span>
            </div>
          </div>

          {systemType === 'roof' && (
            <SliderRow label="Setback" value={setback} min={0.3} max={2.0} step={0.1} unit="m" onChange={setSetback} />
          )}
          {(systemType === 'roof' || systemType === 'ground') && (
            <SliderRow label="Row Spacing" value={rowSpacing} min={0.5} max={5.0} step={0.1} unit="m" onChange={setRowSpacing} />
          )}
          <SliderRow label="Panel Spacing" value={panelSpacing} min={0.01} max={0.1} step={0.01} unit="m" onChange={setPanelSpacing} />

          {systemType === 'ground' && (
            <>
              <SliderRow label="Ground Height" value={groundHeight} min={0.3} max={2.0} step={0.1} unit="m" onChange={setGroundHeight} />
              <SliderRow label="Panels Per Row" value={panelsPerRow} min={2} max={30} step={1} unit="" onChange={setPanelsPerRow} />
            </>
          )}

          {systemType === 'fence' && (
            <>
              <SliderRow label="Fence Height" value={fenceHeight} min={1.0} max={4.0} step={0.1} unit="m" onChange={setFenceHeight} />
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">Bifacial E-W Optimization</label>
                <button
                  onClick={() => setBifacialOptimized(!bifacialOptimized)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${bifacialOptimized ? 'bg-amber-500' : 'bg-slate-600'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${bifacialOptimized ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              {bifacialOptimized && (
                <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg p-2">
                  +20% bifacial gain applied for E-W facing panels
                </div>
              )}
            </>
          )}
        </Section>

        {/* System Summary */}
        {panels.length > 0 && (
          <Section title="System Summary" icon={<Zap size={12} />}>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Panels', value: panels.length.toString(), color: 'text-white' },
                { label: 'System Size', value: `${systemSizeKw.toFixed(2)} kW`, color: 'text-amber-400' },
                { label: 'Panel Wattage', value: `${selectedPanel.wattage}W`, color: 'text-white' },
                { label: 'Array Area', value: `${(panels.length * selectedPanel.width * selectedPanel.height).toFixed(0)} m²`, color: 'text-white' },
              ].map(item => (
                <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-slate-400">{item.label}</div>
                  <div className={`font-semibold ${item.color}`}>{item.value}</div>
                </div>
              ))}
            </div>

            <button
              onClick={onCalculate}
              disabled={calculating || panels.length === 0}
              className="btn-primary w-full mt-1"
            >
              {calculating ? <><Loader size={14} className="animate-spin" /> Calculating...</> : <><Play size={14} /> Calculate Production</>}
            </button>
          </Section>
        )}

        {/* Production Results */}
        {production && (
          <Section title="Production Results" icon={<BarChart2 size={12} />}>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Annual Production', value: `${production.annualProductionKwh.toLocaleString()} kWh`, color: 'text-amber-400' },
                { label: 'Offset', value: `${production.offsetPercentage}%`, color: production.offsetPercentage >= 100 ? 'text-emerald-400' : 'text-blue-400' },
                { label: 'Specific Yield', value: `${production.specificYield} kWh/kWp`, color: 'text-white' },
                { label: 'CO₂ Offset', value: `${production.co2OffsetTons} tons/yr`, color: 'text-emerald-400' },
              ].map(item => (
                <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-slate-400 text-xs">{item.label}</div>
                  <div className={`font-semibold text-xs ${item.color}`}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Monthly production mini chart */}
            <div>
              <div className="text-xs text-slate-500 mb-1.5">Monthly Production (kWh)</div>
              <div className="flex items-end gap-0.5 h-10">
                {production.monthlyProductionKwh.map((kwh: number, i: number) => {
                  const max = Math.max(...production.monthlyProductionKwh);
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        className="w-full bg-amber-500/70 rounded-sm hover:bg-amber-400 transition-colors"
                        style={{ height: `${(kwh / max) * 36}px` }}
                        title={`${MONTHS[i]}: ${kwh.toLocaleString()} kWh`}
                      />
                      <span className="text-slate-600" style={{ fontSize: '7px' }}>{MONTHS[i]}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Offset progress bar */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Energy Offset</span>
                <span className="font-semibold text-white">{production.offsetPercentage}%</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill bg-gradient-to-r from-amber-500 to-emerald-500"
                  style={{ width: `${Math.min(100, production.offsetPercentage)}%` }}
                />
              </div>
            </div>
          </Section>
        )}

        {/* Cost Estimate */}
        {costEstimate && (
          <Section title="Cost Estimate" icon={<DollarSign size={12} />}>
            <div className="space-y-2 text-xs">
              {[
                { label: 'Gross System Cost', value: `$${costEstimate.grossCost.toLocaleString()}` },
                { label: 'Est. Incentives / ITC*', value: costEstimate.taxCredit > 0 ? `-$${costEstimate.taxCredit.toLocaleString()}` : 'See proposal', color: 'text-emerald-400' },
              ].map(item => (
                <div key={item.label} className="flex justify-between">
                  <span className="text-slate-400">{item.label}</span>
                  <span className={`font-semibold ${(item as any).color || 'text-white'}`}>{item.value}</span>
                </div>
              ))}
              <div className="border-t border-slate-700 pt-2 flex justify-between">
                <span className="text-slate-300 font-semibold">Net Cost</span>
                <span className="font-bold text-amber-400">${costEstimate.netCost.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Annual Savings</span>
                <span className="font-semibold text-emerald-400">${costEstimate.annualSavings.toLocaleString()}/yr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payback Period</span>
                <span className="font-semibold text-white">{costEstimate.paybackYears} years</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">25-Year Savings</span>
                <span className="font-semibold text-emerald-400">${costEstimate.lifetimeSavings.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">ROI</span>
                <span className="font-semibold text-emerald-400">{costEstimate.roi}%</span>
              </div>
            </div>

            <Link
              href={`/proposals?projectId=${project.id}`}
              className="btn-primary w-full mt-2 text-xs"
            >
              Generate Proposal <ArrowRight size={12} />
            </Link>
          </Section>
        )}
      </div>
    </div>
  );
}