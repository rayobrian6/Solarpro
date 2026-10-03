'use client';
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE ENGINEERING PAGE'S THREE READERS OF AN APPLIED 120% REMEDY, OUTSIDE THE 19k-LINE PAGE.
//
// The remedy's one record is `PanelBoard.remedy` on the service graph, written only by [Apply] on the
// Existing Electrical Service card. These render what the Compliance tab and the Equipment Schedule
// tab say about it, and are small enough to be tested on their own:
//   · `RemedyApplyPointer` — the compliance alternative's pointer to [Apply], shown ONLY when the
//     Service card actually offers one (a PV-only load-side job has no per-panel 120% check, so no
//     failure block and no [Apply]: promising one there sent the installer to an empty card);
//   · `ComplianceProposedWorkRow` — the compliance result's proposed-work line;
//   · `ScheduleRemedyRows` — the Equipment Schedule's (N) rows, one per panel with applied work.
// Pure renderers: they write nothing.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useMemo } from 'react';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import { evaluateServiceTopology } from '@/lib/electrical/serviceTopology';
import { appliedPanelRemedies } from '@/lib/electrical/systemConfigLegacyInterconnection';
import { panelsOfferingBusbarRemedy } from '@/lib/electrical/systemConfigServiceCard';

export function RemedyApplyPointer({ topology, onOpen }: {
  topology: ServiceTopology | null; onOpen: () => void;
}) {
  const panels = useMemo(
    () => (topology ? panelsOfferingBusbarRemedy(topology, evaluateServiceTopology(topology).checks) : []),
    [topology]);
  if (panels.length === 0) {
    return (
      <div data-testid="electrical-apply-remedy-unavailable" className="mt-1.5 text-[10px] text-slate-500">
        No [Apply] for this configuration yet — the service graph reached no per-panel 120% failure to attach
        the work to. Use a supply-side connection, or record the panel as installed once the work is done.
      </div>
    );
  }
  return (
    // A suggestion here; applied only by its own [Apply] on the panel it changes.
    <button
      type="button"
      data-testid="electrical-apply-remedy"
      onClick={onOpen}
      className="mt-1.5 text-[10px] px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition-colors font-semibold"
    >
      Apply a remedy on Existing Electrical Service →
    </button>
  );
}

export function ComplianceProposedWorkRow({ proposedWork }: {
  proposedWork: { panelLabel: string; label: string; replaces: string } | null | undefined;
}) {
  if (!proposedWork) return null;
  return (
    <div data-testid="compliance-proposed-work" className="flex justify-between gap-2">
      <span className="text-slate-500">Proposed work (120% remedy)</span>
      <span className="text-right font-bold text-amber-300">
        {proposedWork.panelLabel}: {proposedWork.label} — {proposedWork.replaces}
      </span>
    </div>
  );
}

/** Table rows for the Equipment Schedule's "Electrical Equipment" table. */
export function ScheduleRemedyRows({ topology }: { topology: ServiceTopology | null }) {
  return (
    <>
      {appliedPanelRemedies(topology).map(r => (
        <tr key={`remedy-${r.panel.id}`} data-testid={`schedule-remedy-${r.panel.id}`} className="bg-amber-50">
          <td className="border border-slate-200 px-3 py-2 font-semibold">(N) {r.panel.label} — proposed work</td>
          <td className="border border-slate-200 px-3 py-2">{r.label} — {r.replaces}</td>
          <td className="border border-slate-200 px-3 py-2 font-bold text-amber-700">
            {r.remedy.kind === 'replace-panelboard' ? `${r.remedy.busbarRatingA}A bus / ` : ''}{r.remedy.mainBreakerA}A main
          </td>
          <td className="border border-slate-200 px-3 py-2 text-slate-500">NEC 705.12(B)</td>
        </tr>
      ))}
    </>
  );
}
