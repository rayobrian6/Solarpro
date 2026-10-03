'use client';
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE INVERTER-FLEET ROW'S SUMMARY — OR, WITH NOTHING CHOSEN, THE "CHOOSE A PV INVERTER" STATE.
//
// This is the line that read "String Inverter · 37 panels · 16.28 kW DC · 2 strings (20/17 panels)"
// on a fresh project where no inverter was chosen (closure brief §2): an entry with no PV inverter was
// rendered as a "String Inverter" with a blank model and a panels / kW / strings summary. Lifted out
// of app/engineering/page.tsx so the row the installer sees is the row the test renders (review
// finding: the card test mounted a component that never drew this line).
//
// An entry with no receiving endpoint (`fleetEntryHasEndpoint` — no catalogued PV inverter, no
// catalogued micro) states Design's modules and that stringing is pending: no type, no partition, no
// kW AC. Everything else renders exactly as the page did.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { fleetEntryHasEndpoint, STRINGING_PENDING } from '@/lib/electrical/canonicalStrings';

export interface FleetRowSummaryProps {
  inv: { inverterId?: string | null; type: string; strings: ReadonlyArray<{ panelCount: number }> };
  /** The catalogue name of the entry's inverter (blank when it has none). */
  manufacturer?: string | null;
  model?: string | null;
  /** The module count the row states (the page passes Design's count for a single-entry fleet). */
  panels: number;
  /** DC STC kW of the row's modules. */
  kwDc: number;
  /** Design's module count — what the pending row states. */
  designModuleCount: number | null;
  /** Micro rows: the engine's device and AC-branch counts. */
  micro?: { devices: number; branches: number } | null;
}

export function FleetRowSummary(p: FleetRowSummaryProps) {
  if (!fleetEntryHasEndpoint(p.inv)) {
    return (
      <div data-testid="inv-fleet-row-pending"
           className="rounded-xl border border-dashed border-slate-700/60 px-4 py-3 text-xs text-slate-400">
        <span className="font-semibold text-slate-300">PV inverter not chosen</span>
        {' · '}{p.designModuleCount ?? 0} modules{' · '}
        <span className="text-amber-200">{STRINGING_PENDING}</span>
      </div>
    );
  }
  const inv = p.inv;
  const counts = inv.strings.map(s => s.panelCount);
  return (
    <div className="flex-1" data-testid="inv-fleet-row-summary">
      <div className="text-sm font-bold text-white">{p.manufacturer} {p.model}</div>
      <div className="text-xs text-slate-400">
        {inv.type === 'micro' ? 'Microinverter' : inv.type === 'hybrid' ? 'Hybrid Inverter' : inv.type === 'optimizer' ? 'String + Optimizer' : 'String Inverter'} ·
        {p.panels} panels ·
        {p.kwDc.toFixed(2)} kW DC
        {(inv.type === 'string' || inv.type === 'hybrid' || inv.type === 'ecoflow') ? ((() => {
          const allEqual = counts.every(c => c === counts[0]);
          const pps = allEqual && counts.length > 0 ? `${counts[0]}/str` : counts.join('/') + ' panels';
          return (
            <span className="ml-1 text-amber-400 font-semibold">
              · {counts.length} string{counts.length === 1 ? '' : 's'} ({pps})
            </span>
          );
        })()) : null}
        {inv.type === 'micro' && p.micro ? (
          <span className="ml-1 text-purple-400 font-semibold">
            · {p.micro.devices} microinverters · {p.micro.branches} AC branch{p.micro.branches > 1 ? 'es' : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}
