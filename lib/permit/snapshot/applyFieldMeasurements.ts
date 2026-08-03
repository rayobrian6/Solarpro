// lib/permit/snapshot/applyFieldMeasurements.ts
// WS-5 §12/§13 — THE MEASURED LENGTH REPLACES THE ESTIMATE AT THE ENGINE, NOT
// ONLY AT THE SNAPSHOT.
//
// THE DEFECT THIS EXISTS TO CLOSE was found by looking at SCHED, not by a unit
// test. Patching the length only on the snapshot's RouteSegmentRecord made
// PV-4B correct and left the BOM wrong: the conduit rows derive their footage
// from `RunSegment.onewayLengthFt` on the ENGINE's run model
// (lib/bom-engine-v4.derivePhysicalRacewaysFromRuns), which the snapshot
// projection never touches. A verified 89-ft run therefore printed 89 ft on the
// conductor schedule and ordered 23 ft of conduit — a package that contradicts
// itself about the same run.
//
// So the substitution happens ONCE, HERE, on the canonical run model, before
// the BOM and before the snapshot build. Everything downstream — BOM footage,
// fittings, conduit, the snapshot segments, every sheet — then derives from one
// number, which is the property that made D1 and WS-3 worth doing.
//
// WHAT THIS DOES NOT DO: it does not decide anything. Which measurement is
// active, whether it is verified, and whether it may close a requirement are all
// settled upstream (lib/fieldMeasurement/resolver). This function applies a
// decision that has already been made, and refuses to apply it to a run the
// project does not own.

import { recalculateRouteVoltageDrop } from './routeVoltageDropRecalc';
import type { FieldRouteMeasurementAuthority } from '@/lib/fieldMeasurement/resolver';

export interface FieldMeasurementApplication {
  segmentId: string;
  previousLengthFt: number | null;
  measuredLengthFt: number;
  previousVoltageDropPct: number | null;
  recalculatedVoltageDropPct: number | null;
  verified: boolean;
  measurementId: string;
  derivation: string;
}

/**
 * Substitute the ACTIVE field measurement for the engine's estimated one-way
 * length on every applicable run, and recompute that run's voltage drop from
 * the new length. Mutates `cs.runs` in place (the engine result is the caller's
 * own working object) and returns what it changed, for the evidence trail.
 *
 * REFUSALS, both fail-closed:
 *   • a run the engine marks `isUtilityOwned` is never touched — the installer
 *     does not own it, so no project measurement may move its length;
 *   • a run the authority does not name is left exactly as the engine left it.
 */
export function applyFieldMeasurementsToRuns(
  cs: { runs?: Array<Record<string, unknown>> } | null | undefined,
  authority: FieldRouteMeasurementAuthority | null | undefined,
): FieldMeasurementApplication[] {
  const applied: FieldMeasurementApplication[] = [];
  const runs = cs?.runs;
  if (!runs || !authority || Object.keys(authority.bySegmentId).length === 0) return applied;

  for (const run of runs) {
    const id = String(run.id ?? '');
    const a = authority.bySegmentId[id];
    if (!a) continue;
    // D1 — utility-owned service equipment is not the installer's to measure.
    // The API refuses to create such a measurement; this refuses to apply a
    // stale one that names it anyway.
    if (run.isUtilityOwned === true) continue;

    const previousLengthFt = typeof run.onewayLengthFt === 'number' && Number.isFinite(run.onewayLengthFt)
      ? run.onewayLengthFt : null;
    const previousVoltageDropPct = typeof run.voltageDropPct === 'number' && Number.isFinite(run.voltageDropPct)
      ? run.voltageDropPct : null;

    run.onewayLengthFt = a.calculationLengthFt;

    // §12 — the percentage is RECOMPUTED from the new length, with the conductor
    // resistance re-read from the gauge. Retaining the prior percentage beside a
    // changed length is the failure this whole workstream is about.
    const vd = recalculateRouteVoltageDrop({
      lengthFt: a.calculationLengthFt,
      continuousCurrentA: (run.continuousCurrent ?? run.continuousCurrentA) as number | null,
      operatingCurrentA: (run.operatingCurrentA ?? run.currentA) as number | null,
      conductorGauge: (run.wireGauge ?? run.gauge) as string | null,
      systemVoltage: run.systemVoltage as number | null,
    });
    if (vd.voltageDropPct != null) {
      run.voltageDropPct = vd.voltageDropPct;
      const volts = typeof run.systemVoltage === 'number' ? run.systemVoltage : null;
      if (volts != null) run.voltageDropVolts = Math.round((vd.voltageDropPct / 100) * volts * 100) / 100;
    } else {
      // An un-recomputable voltage drop is INDETERMINATE. Leaving the stale
      // number beside the new length would be worse than carrying nothing.
      run.voltageDropPct = null;
      run.voltageDropVolts = null;
    }

    applied.push({
      segmentId: id,
      previousLengthFt,
      measuredLengthFt: a.calculationLengthFt,
      previousVoltageDropPct,
      recalculatedVoltageDropPct: vd.voltageDropPct,
      verified: a.closesFieldVerification,
      measurementId: a.measurementId,
      derivation: vd.derivation,
    });
  }
  return applied;
}
