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
import { toSubSystemKey, type SubSystemKey } from '@/lib/system/subSystemEquipment';

/**
 * Wave 2a (contract §3, 2a Compute): per-subsystem scoping for the permit-path
 * wire-sizing pass. Legacy callers (no opts) are byte-identical to pre-Wave-2a
 * — including the historical rooftop 33 °C adder — so N=1 goldens hold (I-1).
 */
export interface ComputedRunsOpts {
  /** Explicit subsystem scope for geometry derivation — beats cad.systemType
   *  (a hybrid CAD carries roof+ground+fence geometry simultaneously). */
  systemType?: string | null;
  /** Stamped onto every emitted RunSegment.subSystem (contract §1.3). */
  subSystemKey?: SubSystemKey;
  /** Panel SUBSET count for this subsystem (never the whole-project count). */
  totalPanels?: number;
  /** The subsystem's own string count (never the whole-project sum). */
  stringCount?: number;
  /**
   * SubSystemEquipment.env.rooftopTempAdderC — roof runs get the rooftop
   * adder, ground/fence runs get 0. When absent it is derived from the
   * effective systemType (roof → legacy 33 °C, ground/fence → 0); when no
   * scope is given at all, the legacy whole-project 33 °C is preserved.
   */
  rooftopTempAdderC?: number;
  /** FALSE on computeMultiSystem per-sub calls — the shared service tail
   *  (disco→MSP→utility) is emitted once by the aggregate. Default TRUE. */
  emitSharedServiceRuns?: boolean;
}

export function buildComputedRunsForPermit(
  input: PermitInput,
  cad: CADModel,
  opts?: ComputedRunsOpts,
): RunSegment[] | null {
  try {
    const eq = getEquipmentContext(input, cad);
    const topo = String(topologyToLegacy(getInverterTopology(input))).toLowerCase() as 'micro' | 'optimizer' | 'string';
    // Panel subset: an explicit per-subsystem count beats the project total.
    const hasSubset = typeof opts?.totalPanels === 'number' && opts.totalPanels > 0;
    const totalPanels = hasSubset
      ? opts!.totalPanels!
      : (input.system?.totalPanels || cad.totalPanels || 0);
    if (!totalPanels) return null;

    const firstInv = input.system?.inverters?.[0];
    const firstStr = firstInv?.strings?.[0];
    const stringCount = opts?.stringCount && opts.stringCount > 0
      ? opts.stringCount
      : topo === 'micro'
        ? 1
        : Math.max(1, input.system?.inverters?.reduce((s, inv) => s + (inv.strings?.length || 0), 0) || 1);

    // Real geometry-derived segment lengths. Only segments the CAD could
    // actually derive are present; computeSystem's defaults cover the rest.
    // Explicit systemType scopes derivation to ONE subsystem's geometry.
    const { runLengths } = deriveRunLengths(cad, { systemType: opts?.systemType });

    // Rooftop temp adder is a per-subsystem env fact, not a project-wide
    // constant: roof conductors bake at roof-surface temps; ground/fence runs
    // never do. Legacy (unscoped) callers keep the historical 33 °C.
    const rooftopTempAdderC =
      typeof opts?.rooftopTempAdderC === 'number'
        ? opts.rooftopTempAdderC
        : (opts?.systemType != null && opts.systemType !== ''
            ? (toSubSystemKey(opts.systemType) === 'roof' ? 33 : 0)
            : 33);

    // System AC kW — prefer the system total (SKIPPED when a panel subset is
    // given: input.system.totalAcKw is the whole-project figure and would
    // leak cross-subsystem kW into this sub's sizing). For micro, only
    // multiply the per-DEVICE rating by panel count when it plausibly IS a
    // micro rating (≤ 2 kW); a string-inverter kW leaking in here × 52 panels
    // produced a 91 kW phantom (and a 4/0 AWG feeder) on a 15 kW job.
    const _dcKw = (hasSubset ? undefined : input.system?.totalDcKw) ?? (totalPanels * (eq.panelWatts || 400)) / 1000;
    const acKw = (hasSubset ? undefined : input.system?.totalAcKw)
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
      rooftopTempAdderC, // per-subsystem env (roof adder / 0 for ground+fence); legacy unscoped = 33
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
      // Wave 2a pass-through (both undefined on the legacy path — I-1):
      ...(opts?.subSystemKey ? { subSystemKey: opts.subSystemKey } : {}),
      ...(opts?.emitSharedServiceRuns === false ? { emitSharedServiceRuns: false } : {}),
    };

    const cs = computeSystem(csInput);
    return cs.runs && cs.runs.length > 0 ? cs.runs : null;
  } catch (err) {
    console.warn('[computedRuns] computeSystem failed (BOM falls back to flat lengths):', (err as Error)?.message ?? err);
    return null;
  }
}
