// lib/permit/snapshot/routeVoltageDropRecalc.ts
// WS-5 §12 — WHEN THE LENGTH CHANGES, THE VOLTAGE DROP CHANGES.
//
// THE FAILURE THIS PREVENTS is the quiet one: a field measurement lands, the
// segment's calculation length moves from a 20 ft estimate to a 41 ft measured
// run, and the sheet keeps printing 0.369% because the percentage was computed
// once, upstream, and merely copied. The number would be arithmetically correct
// about a length nobody is using any more — the worst kind of wrong, because it
// looks derived.
//
// SO THIS IS A REAL RECALCULATION, NOT A RESCALE. `calcVoltageDrop` re-reads the
// conductor's DC resistance from its gauge and recomputes
// VD% = (2 · I · R · L) / (V · 1000) · 100 from the segment's own current,
// gauge and system voltage. A proportional shortcut (pct × Lnew/Lold) would give
// the same answer today and would silently stop being right the moment anything
// about the conductor is also re-resolved.
//
// AND IT REFUSES RATHER THAN GUESSES. Missing current, gauge or voltage yields
// null, which the grader reports as INDETERMINATE. A voltage drop that cannot be
// computed is not a passing voltage drop.

import { calcVoltageDrop } from '@/lib/manufacturer-specs';

export interface VoltageDropRecalcInput {
  /** the NEW calculation length (ft) — normally a field measurement. */
  lengthFt: number | null | undefined;
  /** the current the VD formula consumes. The engine uses the CONTINUOUS
   *  current (NEC 690.8(A)); operating is the fallback so a segment that only
   *  carries one of the two still recalculates rather than going indeterminate. */
  continuousCurrentA: number | null | undefined;
  operatingCurrentA: number | null | undefined;
  conductorGauge: string | null | undefined;
  systemVoltage: number | null | undefined;
}

export interface VoltageDropRecalcResult {
  /** null ⇒ could not be computed from the inputs given. */
  voltageDropPct: number | null;
  /** which current was used, so the sheet can state the basis. */
  currentBasis: 'continuous' | 'operating' | null;
  currentA: number | null;
  lengthFt: number | null;
  conductorGauge: string | null;
  systemVoltage: number | null;
  /** one sentence naming every input, for the evidence trail. */
  derivation: string;
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function recalculateRouteVoltageDrop(input: VoltageDropRecalcInput): VoltageDropRecalcResult {
  const lengthFt = finite(input.lengthFt);
  const cont = finite(input.continuousCurrentA);
  const oper = finite(input.operatingCurrentA);
  const gauge = typeof input.conductorGauge === 'string' && input.conductorGauge.trim()
    ? input.conductorGauge.trim() : null;
  const volts = finite(input.systemVoltage);

  const currentA = (cont != null && cont > 0) ? cont : ((oper != null && oper > 0) ? oper : null);
  const currentBasis: 'continuous' | 'operating' | null =
    (cont != null && cont > 0) ? 'continuous' : ((oper != null && oper > 0) ? 'operating' : null);

  const missing: string[] = [];
  if (lengthFt == null || lengthFt <= 0) missing.push('calculation length');
  if (currentA == null) missing.push('conductor current');
  if (!gauge) missing.push('conductor gauge');
  if (volts == null || volts <= 0) missing.push('system voltage');

  if (missing.length > 0) {
    return {
      voltageDropPct: null, currentBasis, currentA, lengthFt, conductorGauge: gauge, systemVoltage: volts,
      derivation: `voltage drop NOT recalculated — missing ${missing.join(', ')}. A voltage drop that cannot be `
        + 'computed is INDETERMINATE, never a pass.',
    };
  }

  const pct = calcVoltageDrop(currentA as number, lengthFt as number, gauge as string, volts as number);
  if (!Number.isFinite(pct) || pct <= 0) {
    // calcVoltageDrop returns 0 for an unrecognised gauge, which is a REFUSAL
    // wearing the shape of a perfect result. Treat it as indeterminate.
    return {
      voltageDropPct: null, currentBasis, currentA, lengthFt, conductorGauge: gauge, systemVoltage: volts,
      derivation: `voltage drop NOT recalculated — the conductor specification for '${gauge}' yielded no resistance, `
        + 'so no percentage can be derived. INDETERMINATE, never a pass.',
    };
  }

  const rounded = Math.round(pct * 10000) / 10000;
  return {
    voltageDropPct: rounded,
    currentBasis, currentA, lengthFt, conductorGauge: gauge, systemVoltage: volts,
    derivation:
      `VD% = (2 × ${currentA} A × R(${gauge}) × ${lengthFt} ft) / (${volts} V × 1000) × 100 = ${rounded.toFixed(3)}% `
      + `(${currentBasis} current basis; conductor resistance re-read from the gauge, not scaled from the prior result).`,
  };
}
