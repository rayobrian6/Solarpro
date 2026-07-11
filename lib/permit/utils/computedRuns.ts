// ═══════════════════════════════════════════════════════════════
// Computed Runs — run the EXISTING wire-sizing engine (computeSystem)
// in the permit path with REAL geometry-derived run lengths, and hand
// its sized RunSegment[] to the BOM.
//
// The gap it closes: computeSystem (which sizes every conductor,
// conduit and voltage drop per segment) only ran on paths with NO CAD
// geometry — the plan-set route fed it flat constants (20/15/10 ft)
// and the engineering page per-panel estimates — while the permit
// path, which HAS the CAD and deriveRunLengths(cad), never ran the
// engine at all. So the BOM priced wire from one flat length
// (PV-4B printed "60 ft" for every circuit). Here the two finally
// meet: deriveRunLengths(cad) → computeSystem → runs[] with real
// onewayLengthFt + per-segment gauge/EGC/conduit/conductorCount.
//
// Pure + guarded: same inputs → same runs; any failure returns null
// and the BOM falls back to its previous flat path (never blocks a
// permit).
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { computeSystem, type ComputedSystemInput, type RunSegment } from '@/lib/computed-system';
import { deriveRunLengths } from '@/lib/bom/deriveRunLengths';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';

export function buildComputedRunsForPermit(
  input: PermitInput,
  cad: CADModel,
): RunSegment[] | null {
  try {
    const eq = getEquipmentContext(input, cad);
    const topo = String(topologyToLegacy(getInverterTopology(input))).toLowerCase() as 'micro' | 'optimizer' | 'string';
    const totalPanels = input.system?.totalPanels || cad.totalPanels || 0;
    if (!totalPanels) return null;

    const firstInv = input.system?.inverters?.[0];
    const firstStr = firstInv?.strings?.[0];
    const stringCount = topo === 'micro'
      ? 1
      : Math.max(1, input.system?.inverters?.reduce((s, inv) => s + (inv.strings?.length || 0), 0) || 1);

    // Real geometry-derived segment lengths. Only segments the CAD could
    // actually derive are present; computeSystem's defaults cover the rest.
    const { runLengths } = deriveRunLengths(cad);

    // System AC kW — prefer the system total. For micro, only multiply the
    // per-DEVICE rating by panel count when it plausibly IS a micro rating
    // (≤ 2 kW); a string-inverter kW leaking in here × 52 panels produced a
    // 91 kW phantom (and a 4/0 AWG feeder) on a 15 kW job.
    const _dcKw = input.system?.totalDcKw ?? (totalPanels * (eq.panelWatts || 400)) / 1000;
    const acKw = input.system?.totalAcKw
      || (topo === 'micro'
        ? (eq.inverterAcOutputKw > 0 && eq.inverterAcOutputKw <= 2
            ? eq.inverterAcOutputKw * totalPanels
            : _dcKw * 0.77)
        : (eq.inverterAcOutputKw || _dcKw * 0.8));

    const csInput: ComputedSystemInput = {
      topology: (topo === 'micro' ? 'micro' : topo === 'optimizer' ? 'optimizer' : 'string'),
      totalPanels,
      panelWatts: eq.panelWatts || 400,
      panelVoc: eq.panelVoc || 41.6,
      panelVmp: (eq.panelVoc || 41.6) * 0.83,
      panelIsc: eq.panelIsc || 9.0,
      panelImp: (eq.panelIsc || 9.0) * 0.94,
      panelTempCoeffVoc: -0.29,
      panelTempCoeffIsc: 0.05,
      panelMaxSeriesFuse: 20,
      panelModel: eq.panelModel || 'Solar Panel',
      panelManufacturer: eq.panelManufacturer || 'See Cut Sheet',
      inverterManufacturer: eq.inverterManufacturer || 'Inverter Mfr',
      inverterModel: eq.inverterModel || 'Inverter',
      // Engine contract: PER-DEVICE kW for micro (perMicroCurrentA = inverterAcKw
      // × 1000/240, then × device count); whole-inverter kW for string.
      inverterAcKw: topo === 'micro' ? acKw / Math.max(1, totalPanels) : acKw,
      inverterMaxDcV: topo === 'micro' ? 60 : 600,
      inverterMpptVmin: 100,
      inverterMpptVmax: topo === 'micro' ? 60 : 600,
      inverterMaxInputCurrentPerMppt: 15,
      inverterMpptChannels: stringCount,
      // PER-DEVICE max AC amps — the engine multiplies this by device count for
      // micro (passing system amps here made 12 devices × 20.8 A = 250 A → a
      // phantom 4/0 feeder). IQ8+ ≈ 1.21 A/device; string = whole-inverter amps.
      inverterAcCurrentMax: topo === 'micro'
        ? (acKw * 1000) / 240 / Math.max(1, totalPanels)
        : (acKw * 1000) / 240,
      inverterModulesPerDevice: 1,
      inverterBranchLimit: 13, // IQ8/IQ8+ @ 20 A — sourced (trunk-cable research)
      ambientTempC: 40,
      designTempMin: -10,
      rooftopTempAdderC: 33,
      // REAL lengths where geometry allowed; engine defaults elsewhere.
      runLengths: {
        ...runLengths,
        ...(firstStr?.wireLength ? { DC_STRING_RUN: firstStr.wireLength } : {}),
      },
      panelBusRating: input.project.panelBusRating || input.project.mainPanelAmps || 200,
      mainPanelAmps: input.project.mainPanelAmps || 200,
      mainPanelBrand: input.project.mainPanelBrand || 'Square D',
      conduitType: `${input.project.conduitSize || '3/4'}" ${(input.project.conduitType || 'EMT').toUpperCase()}`,
      maxACVoltageDropPct: 2,
      maxDCVoltageDropPct: 3,
      interconnectionMethod: (input.project.interconnectionMethod === 'SUPPLY_SIDE_TAP' ? 'SUPPLY_SIDE_TAP' : 'LOAD_SIDE'),
      batteryBackfeedA: 0,
      batteryCount: 0,
    };

    const cs = computeSystem(csInput);
    return cs.runs && cs.runs.length > 0 ? cs.runs : null;
  } catch (err) {
    console.warn('[computedRuns] computeSystem failed (BOM falls back to flat lengths):', (err as Error)?.message ?? err);
    return null;
  }
}
