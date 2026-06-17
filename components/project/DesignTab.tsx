'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { Map, Zap, Sun, BarChart2, ArrowRight, CheckCircle, AlertTriangle, Package, Save, RefreshCw } from 'lucide-react';
import type { Project, SolarPanel, Inverter } from '@/types';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { ConfidenceBadge } from '@/components/recommend/ConfidenceBadge';
import { recommendDefaultPanel, getPanelLabel } from '@/lib/survey/defaultPanelSelection';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface DesignTabProps {
  project: Project;
  /** Called after user saves equipment selection — parent should merge updates into project state */
  onEquipmentUpdate?: (updates: Partial<Project>) => void;
}

export default function DesignTab({ project, onEquipmentUpdate }: DesignTabProps) {
  // ── Inline equipment picker state ─────────────────────────────────────────
  const [panels, setPanels] = useState<SolarPanel[]>([]);
  const [inverters, setInverters] = useState<Inverter[]>([]);
  const [hwLoading, setHwLoading] = useState(false);
  const [hwLoaded, setHwLoaded] = useState(false);
  const [selectedPanelId, setSelectedPanelId] = useState<string>(
    (project.selectedPanel as any)?.id ?? ''
  );
  const [selectedInverterId, setSelectedInverterId] = useState<string>(
    (project.selectedInverter as any)?.id ?? ''
  );
  const [eqSaving, setEqSaving] = useState(false);
  const [eqSaveMsg, setEqSaveMsg] = useState<string | null>(null);
  const [eqSaveError, setEqSaveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // H1: Default panel recommendation from ecosystem catalog
  const panelRecommendation = useMemo(() => {
    if (project.selectedPanel) return null; // already selected
    return recommendDefaultPanel(project.systemType);
  }, [project.selectedPanel, project.systemType]);

  const loadHardware = async () => {
    if (hwLoaded) return;
    setHwLoading(true);
    try {
      const res = await fetch('/api/hardware');
      const data = await res.json();
      if (data.success) {
        setPanels(data.data.panels || []);
        setInverters(data.data.inverters || []);
        setHwLoaded(true);
      }
    } catch { /* ignore */ }
    finally { setHwLoading(false); }
  };

  const openPicker = () => {
    setEqSaveMsg(null);
    setEqSaveError(null);
    setPickerOpen(true);
    loadHardware();
  };

  const savePicker = async () => {
    setEqSaving(true);
    setEqSaveMsg(null);
    setEqSaveError(null);
    try {
      const panel    = panels.find(p => p.id === selectedPanelId) ?? null;
      const inverter = inverters.find(i => i.id === selectedInverterId) ?? null;
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedPanel:    panel    ?? undefined,
          selectedInverter: inverter ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setEqSaveError(data.error || 'Failed to save equipment.');
        return;
      }
      setEqSaveMsg('Equipment saved!');
      onEquipmentUpdate?.({
        selectedPanel:    panel    ?? undefined,
        selectedInverter: inverter ?? undefined,
      });
      setTimeout(() => setPickerOpen(false), 1000);
    } catch {
      setEqSaveError('Network error. Please try again.');
    } finally {
      setEqSaving(false);
    }
  };
  const layout = project.layout;
  const production = project.production;
  const hasDesign = !!layout;

  const productionChartData = production
    ? MONTHS.map((month, i) => ({
        month,
        production: production.monthlyProductionKwh[i],
        usage: Math.round((project.client?.annualKwh || project.billAnalysis?.annualKwh || 0) / 12),
      }))
    : [];

  const typeIcon = { roof: '🏠', ground: '🌱', fence: '🔲' }[project.systemType];
  const typeLabel = { roof: 'Roof Mount', ground: 'Ground Mount', fence: 'Sol Fence' }[project.systemType];

  if (!hasDesign) {
    return (
      <div className="space-y-4">
        <div className="card p-10 text-center border-2 border-dashed border-slate-700 hover:border-amber-500/40 transition-colors">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <Map size={28} className="text-amber-400" />
          </div>
          <h3 className="text-white font-semibold text-lg mb-2">No Design Created Yet</h3>
          <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
            Open Design Studio to place panels on the roof map, configure tilt and azimuth, and calculate production.
          </p>
          <Link href={`/design?projectId=${project.id}`} className="btn-primary inline-flex items-center gap-2">
            <Map size={15} /> Open Design Studio <ArrowRight size={14} />
          </Link>
          {!project.billAnalysis && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-left">
              <div className="flex items-start gap-2">
                <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">Upload a utility bill first to pre-populate the recommended system size in Design Studio.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
        <span className="text-sm text-emerald-300 font-medium">Design complete — {layout.totalPanels} panels, {layout.systemSizeKw.toFixed(2)} kW</span>
        <Link href={`/design?projectId=${project.id}`} className="ml-auto text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
          <Map size={11} /> Edit Design
        </Link>
      </div>

      {/* System config + production side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* System Configuration */}
        <div className="card p-5 space-y-4">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="text-xl">{typeIcon}</span> System Configuration
          </h4>
          <div className="space-y-2 text-sm">
            {/* System Type row with change link */}
            <div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
              <span className="text-slate-400">System Type</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{typeLabel}</span>
                <Link
                  href={`/projects/${project.id}?changeType=1`}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors underline underline-offset-2"
                >
                  Change
                </Link>
              </div>
            </div>
            {[
              { label: 'System Size', value: `${layout.systemSizeKw.toFixed(2)} kW` },
              { label: 'Panel Count', value: `${layout.totalPanels} panels` },
              ...(project.systemType === 'fence' ? [
                { label: 'Tilt', value: '90° (Vertical)' },
                { label: 'Bifacial', value: layout.bifacialOptimized ? 'Yes (+20%)' : 'Yes (+10%)' },
              ] : [
                { label: 'Tilt', value: `${layout.groundTilt || 20}°` },
                { label: 'Azimuth', value: `${layout.groundAzimuth || 180}°` },
              ]),
              ...(project.selectedPanel ? [
                { label: 'Panel', value: `${project.selectedPanel.manufacturer} ${project.selectedPanel.model}` },
                { label: 'Panel Wattage', value: `${project.selectedPanel.wattage}W` },
              ] : []),
              ...(project.selectedInverter ? [
                { label: 'Inverter', value: `${project.selectedInverter.manufacturer} ${project.selectedInverter.model}` },
              ] : []),
            ].map(item => (
              <div key={item.label} className="flex justify-between border-b border-slate-700/50 pb-2">
                <span className="text-slate-400">{item.label}</span>
                <span className="font-medium text-white text-right">{item.value}</span>
              </div>
            ))}
          </div>
          <Link href={`/design?projectId=${project.id}`} className="btn-secondary btn-sm w-full flex items-center justify-center gap-1.5 mt-2">
            <Map size={13} /> Edit in Design Studio
          </Link>
        </div>

        {/* Production Summary */}
        {production ? (
          <div className="card p-5 space-y-4">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Zap size={14} className="text-amber-400" /> Production Summary
            </h4>
            <div className="text-center py-2">
              <div className="text-4xl font-black text-amber-400">{production.annualProductionKwh.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">kWh per year</div>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill bg-gradient-to-r from-amber-500 to-emerald-500"
                style={{ width: `${Math.min(100, production.offsetPercentage)}%` }}
              />
            </div>
            <div className="text-center text-sm font-semibold text-emerald-400">{production.offsetPercentage}% energy offset</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Specific Yield', value: `${production.specificYield} kWh/kWp` },
                { label: 'CO₂ Offset', value: `${production.co2OffsetTons} tons/yr` },
                { label: 'Trees Equiv.', value: `${production.treesEquivalent}` },
                { label: 'Perf. Ratio', value: `${(production.performanceRatio * 100).toFixed(0)}%` },
              ].map(item => (
                <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-slate-500">{item.label}</div>
                  <div className="font-semibold text-white">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card p-5 flex flex-col items-center justify-center text-center">
            <Sun size={28} className="text-slate-600 mb-3" />
            <p className="text-slate-500 text-sm">Production not yet calculated</p>
            <p className="text-slate-600 text-xs mt-1">Save design to calculate production</p>
          </div>
        )}
      </div>

      {/* Monthly production chart */}
      {production && productionChartData.length > 0 && (
        <div className="card p-5">
          <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart2 size={14} className="text-amber-400" /> Monthly Production vs Usage
          </h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={productionChartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
              />
              <Bar dataKey="production" fill="#f59e0b" radius={[2, 2, 0, 0]} name="Production (kWh)" />
              <Bar dataKey="usage" fill="#3b82f6" radius={[2, 2, 0, 0]} name="Usage (kWh)" opacity={0.6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Equipment section ── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Package size={14} className="text-blue-400" /> Equipment
          </h4>
          <button
            onClick={pickerOpen ? () => setPickerOpen(false) : openPicker}
            className="btn-secondary btn-sm flex items-center gap-1.5 text-xs"
          >
            {pickerOpen ? 'Close' : (project.selectedPanel || project.selectedInverter ? 'Change' : 'Select Equipment')}
          </button>
        </div>

        {/* Current selections */}
        {!pickerOpen && (
          <div className="space-y-2">
            {project.selectedPanel ? (
              <div className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl">
                <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-400">Panel</div>
                  <div className="text-sm font-medium text-white truncate">
                    {project.selectedPanel.manufacturer} {project.selectedPanel.model}
                  </div>
                  <div className="text-xs text-slate-500">{project.selectedPanel.wattage}W · {project.selectedPanel.efficiency}% efficiency</div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                  <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-amber-300 font-medium">No panel selected</div>
                    <div className="text-xs text-slate-500">Required for accurate production estimates</div>
                  </div>
                </div>
                {/* H1: Default panel recommendation from ecosystem catalog */}
                {panelRecommendation && (
                  <div className="flex items-center gap-2 p-2.5 bg-blue-500/5 border border-blue-500/15 rounded-lg">
                    <Zap size={12} className="text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-blue-300">Suggested:</span>
                        <span className="text-xs font-semibold text-white">{getPanelLabel(panelRecommendation.panel)}</span>
                        <ConfidenceBadge
                          confidence={panelRecommendation.confidence}
                          source={panelRecommendation.source}
                          size="xs"
                        />
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{panelRecommendation.reason}</div>
                    </div>
                    <button
                      onClick={() => {
                        openPicker();
                        // Pre-select the recommended panel in the picker
                        setTimeout(() => setSelectedPanelId(panelRecommendation.panelId), 100);
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap transition-colors"
                    >
                      Use This
                    </button>
                  </div>
                )}
              </div>
            )}
            {project.selectedInverter ? (
              <div className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl">
                <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-400">Inverter</div>
                  <div className="text-sm font-medium text-white truncate">
                    {project.selectedInverter.manufacturer} {project.selectedInverter.model}
                  </div>
                  <div className="text-xs text-slate-500">
                    {(project.selectedInverter as any).ratedOutputW
                      ? `${((project.selectedInverter as any).ratedOutputW / 1000).toFixed(1)} kW rated`
                      : 'Inverter'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
                <div>
                  <div className="text-xs text-amber-300 font-medium">No inverter selected</div>
                  <div className="text-xs text-slate-500">Required for engineering report</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Inline picker */}
        {pickerOpen && (
          <div className="space-y-4">
            {hwLoading && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <RefreshCw size={14} className="animate-spin" /> Loading equipment library…
              </div>
            )}
            {!hwLoading && hwLoaded && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Solar Panel Model</label>
                  <select
                    value={selectedPanelId}
                    onChange={e => setSelectedPanelId(e.target.value)}
                    className="input w-full text-sm"
                  >
                    <option value="">— No panel selected —</option>
                    {panels.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.manufacturer} {p.model} — {p.wattage}W ({p.efficiency}% eff)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Inverter Model</label>
                  <select
                    value={selectedInverterId}
                    onChange={e => setSelectedInverterId(e.target.value)}
                    className="input w-full text-sm"
                  >
                    <option value="">— No inverter selected —</option>
                    {inverters.map(inv => (
                      <option key={inv.id} value={inv.id}>
                        {inv.manufacturer} {inv.model}
                        {(inv as any).ratedOutputW ? ` — ${((inv as any).ratedOutputW / 1000).toFixed(1)}kW` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {eqSaveError && (
                  <div className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertTriangle size={12} /> {eqSaveError}
                  </div>
                )}
                {eqSaveMsg && (
                  <div className="text-xs text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle size={12} /> {eqSaveMsg}
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button onClick={() => setPickerOpen(false)} className="btn-secondary btn-sm">
                    Cancel
                  </button>
                  <button onClick={savePicker} disabled={eqSaving} className="btn-primary btn-sm flex items-center gap-1.5">
                    {eqSaving ? <><RefreshCw size={12} className="animate-spin" /> Saving…</> : <><Save size={12} /> Save Equipment</>}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}