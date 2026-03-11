'use client';
import React from 'react';
import { Map, Zap, Sun, BarChart2, ArrowRight, CheckCircle, AlertTriangle } from 'lucide-react';
import type { Project } from '@/types';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface DesignTabProps {
  project: Project;
}

export default function DesignTab({ project }: DesignTabProps) {
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
            {[
              { label: 'System Size', value: `${layout.systemSizeKw.toFixed(2)} kW` },
              { label: 'Panel Count', value: `${layout.totalPanels} panels` },
              { label: 'System Type', value: typeLabel },
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

      {/* Equipment warnings */}
      {(!project.selectedPanel || !project.selectedInverter) && (
        <div className="card p-4 border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-amber-300 mb-1">Equipment Not Selected</div>
              <div className="text-xs text-slate-400 space-y-0.5">
                {!project.selectedPanel && <div>• No panel selected — open Design Studio to choose a panel model</div>}
                {!project.selectedInverter && <div>• No inverter selected — required for engineering report</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}