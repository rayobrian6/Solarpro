// ============================================================
// Deterministic OCPD / Fuse Auto-Resolution Engine
// NEC 690.8(A)(B) — No silent failure, no demo fallback
// ============================================================
//
// Algorithm (per NEC 690.8):
//   Step 1: iscCorrected = Isc × (1 + tempCoeffIsc/100 × (Thot - 25))
//   Step 2: maxCurrentNEC = iscCorrected × 1.25          [NEC 690.8(A)]
//   Step 3: requiredOCPD  = maxCurrentNEC × 1.25         [NEC 690.8(B)] = Isc × 1.5625
//   Step 4: ocpdRating    = nextStandardOCPD(requiredOCPD)
//   Step 5: IF ocpdRating > module.maxSeriesFuseRating:
//             ocpdRating = module.maxSeriesFuseRating     [hard cap]
//             re-check: is maxSeriesFuseRating >= maxCurrentNEC?
//               YES → PASS with cap note
//               NO  → FAIL — flag user to reduce string count or change module
//   Step 6: IF ocpdRating > inverter.maxInputCurrentPerMppt × 1.25 → WARNING
//
// ============================================================

import { nextStandardOCPD } from './manufacturer-specs';

export type OCPDResolutionStatus =
  | 'PASS'                    // compliant, no adjustment needed
  | 'PASS_CAPPED'             // capped at maxSeriesFuse, still compliant
  | 'FAIL_REDUCE_STRING'      // even at maxSeriesFuse, wire/fuse can't handle current
  | 'FAIL_CHANGE_MODULE';     // module maxSeriesFuse too low for this Isc

export interface OCPDResolutionInput {
  stringId: string;           // e.g. "1-1"
  panelIsc: number;           // A at STC
  tempCoeffIsc: number;       // %/°C (positive, e.g. 0.05)
  maxSeriesFuseRating: number; // A — hard cap from module datasheet
  designTempMaxC: number;     // °C hottest ambient
  rooftopTempAdderC: number;  // °C added for rooftop (NEC 690.31 — typically 35°C)
  inverterMaxInputCurrentPerMppt: number; // A
  correctionFactor?: number;  // optional additional correction (default 1.0)
  // MANUAL mode override
  manualOCPDOverride?: number;    // user-specified OCPD in MANUAL mode (A)
  engineeringMode?: 'AUTO' | 'MANUAL'; // default AUTO
}

export interface OCPDResolutionResult {
  stringId: string;
  iscSTC: number;
  iscCorrected: number;
  maxCurrentNEC: number;       // Isc_corrected × 1.25 (NEC 690.8(A))
  requiredOCPD: number;        // maxCurrentNEC × 1.25 (NEC 690.8(B)) — pre-standard
  ocpdRating: number;          // final selected standard OCPD size
  wasCapped: boolean;          // true if capped at maxSeriesFuseRating
  capValue: number;            // maxSeriesFuseRating (for reference)
  status: OCPDResolutionStatus;
  necReference: string;
  autoAdjustmentLog: AutoAdjustmentEntry[];
  failureReason?: string;      // populated only on FAIL statuses
  // MANUAL mode override fields
  isManualOverride: boolean;   // true if user overrode the auto-calculated value
  overrideValue?: number;      // the user-specified value
  overrideRisk: 'none' | 'info' | 'warning' | 'error'; // risk level of override
  overrideWarning?: string;    // human-readable warning for override
}

export interface AutoAdjustmentEntry {
  step: string;
  action: string;
  fromValue: number | string;
  toValue: number | string;
  necReference: string;
  reason: string;
}

// ─── Main Resolution Function ─────────────────────────────────────────────────

export function resolveOCPD(input: OCPDResolutionInput): OCPDResolutionResult {
  const log: AutoAdjustmentEntry[] = [];
  const corrFactor = input.correctionFactor ?? 1.0;
  const mode = input.engineeringMode ?? 'AUTO';

  // ── MANUAL MODE: User override path ──────────────────────────────────────
  // In MANUAL mode, if user has specified an OCPD override, use it.
  // DO NOT block the selection. Flag as FAIL if it exceeds maxSeriesFuseRating.
  // Log the override in the audit trail.
  if (mode === 'MANUAL' && input.manualOCPDOverride !== undefined) {
    const hotTemp = input.designTempMaxC + input.rooftopTempAdderC;
    const iscCorrected = input.panelIsc * (1 + (input.tempCoeffIsc / 100) * (hotTemp - 25)) * corrFactor;
    const maxCurrentNEC = iscCorrected * 1.25;
    const autoCalcRequired = maxCurrentNEC * 1.25;
    const overrideValue = input.manualOCPDOverride;

    let overrideRisk: 'none' | 'info' | 'warning' | 'error' = 'none';
    let overrideWarning: string | undefined;
    let status: OCPDResolutionStatus = 'PASS';

    if (overrideValue > input.maxSeriesFuseRating) {
      overrideRisk = 'error';
      overrideWarning = `Breaker (${overrideValue}A) exceeds module maxSeriesFuseRating (${input.maxSeriesFuseRating}A). NEC 690.8(B). This is a code violation — installation at user's risk.`;
      status = 'FAIL_CHANGE_MODULE'; // flag as FAIL but do NOT block
    } else if (overrideValue < maxCurrentNEC) {
      overrideRisk = 'error';
      overrideWarning = `Breaker (${overrideValue}A) is below required minimum (${maxCurrentNEC.toFixed(1)}A per NEC 690.8(A)). Undersized OCPD — fire hazard.`;
      status = 'FAIL_CHANGE_MODULE';
    } else if (overrideValue > autoCalcRequired * 1.1) {
      overrideRisk = 'warning';
      overrideWarning = `Breaker (${overrideValue}A) is larger than auto-calculated (${Math.ceil(autoCalcRequired)}A). Verify module maxSeriesFuseRating allows this.`;
      status = 'PASS_CAPPED';
    }

    log.push({
      step: 'MANUAL_OVERRIDE',
      action: 'Manual OCPD override applied',
      fromValue: Math.ceil(autoCalcRequired),
      toValue: overrideValue,
      necReference: 'NEC 690.8(B) — MANUAL OVERRIDE',
      reason: `User override in MANUAL mode. Auto-calculated: ${Math.ceil(autoCalcRequired)}A. Override: ${overrideValue}A.${overrideWarning ? ' WARNING: ' + overrideWarning : ''}`,
    });

    return {
      stringId: input.stringId,
      iscSTC: input.panelIsc,
      iscCorrected,
      maxCurrentNEC,
      requiredOCPD: autoCalcRequired,
      ocpdRating: overrideValue,
      wasCapped: false,
      capValue: input.maxSeriesFuseRating,
      status,
      necReference: 'NEC 690.8(B) — MANUAL OVERRIDE',
      autoAdjustmentLog: log,
      failureReason: overrideRisk === 'error' ? overrideWarning : undefined,
      isManualOverride: true,
      overrideValue,
      overrideRisk,
      overrideWarning,
    };
  }
  // ── END MANUAL MODE ───────────────────────────────────────────────────────

  // Step 1: Temperature-corrected Isc (NEC 690.8(A))
  // At maximum operating temperature, Isc increases slightly
  const hotTemp = input.designTempMaxC + input.rooftopTempAdderC;
  const iscCorrected = input.panelIsc * (1 + (input.tempCoeffIsc / 100) * (hotTemp - 25)) * corrFactor;

  log.push({
    step: '1',
    action: 'Temperature-correct Isc',
    fromValue: input.panelIsc,
    toValue: parseFloat(iscCorrected.toFixed(3)),
    necReference: 'NEC 690.8(A)',
    reason: `Isc at ${hotTemp}°C (${input.designTempMaxC}°C ambient + ${input.rooftopTempAdderC}°C rooftop adder): ${input.panelIsc}A × (1 + ${input.tempCoeffIsc}%/°C × ${hotTemp - 25}°C) = ${iscCorrected.toFixed(3)}A`,
  });

  // Step 2: NEC 690.8(A) — 125% continuous duty factor
  const maxCurrentNEC = iscCorrected * 1.25;

  log.push({
    step: '2',
    action: 'Apply 125% continuous duty factor',
    fromValue: parseFloat(iscCorrected.toFixed(3)),
    toValue: parseFloat(maxCurrentNEC.toFixed(3)),
    necReference: 'NEC 690.8(A)',
    reason: `Maximum circuit current = Isc_corrected × 1.25 = ${iscCorrected.toFixed(3)}A × 1.25 = ${maxCurrentNEC.toFixed(3)}A`,
  });

  // Step 3: NEC 690.8(B) — OCPD must be ≥ 125% of maxCurrentNEC
  const requiredOCPD = maxCurrentNEC * 1.25; // = Isc × 1.5625
  const rawOCPD = nextStandardOCPD(requiredOCPD);

  log.push({
    step: '3',
    action: 'Calculate minimum OCPD',
    fromValue: parseFloat(requiredOCPD.toFixed(3)),
    toValue: rawOCPD,
    necReference: 'NEC 690.8(B)',
    reason: `Required OCPD = maxCurrentNEC × 1.25 = ${maxCurrentNEC.toFixed(3)}A × 1.25 = ${requiredOCPD.toFixed(3)}A → next standard size: ${rawOCPD}A`,
  });

  // Step 4: Check against module maxSeriesFuseRating (hard cap)
  let ocpdRating = rawOCPD;
  let wasCapped = false;

  if (rawOCPD > input.maxSeriesFuseRating) {
    // Must cap at module's max series fuse rating
    ocpdRating = input.maxSeriesFuseRating;
    wasCapped = true;

    log.push({
      step: '4',
      action: 'Cap OCPD at module maxSeriesFuseRating',
      fromValue: rawOCPD,
      toValue: ocpdRating,
      necReference: 'NEC 690.8(B) / Module Datasheet',
      reason: `Calculated OCPD (${rawOCPD}A) exceeds module max series fuse rating (${input.maxSeriesFuseRating}A). Capping at ${input.maxSeriesFuseRating}A per manufacturer specification.`,
    });

    // Step 5: Re-evaluate compliance with capped value
    // The capped OCPD must still be ≥ maxCurrentNEC (NEC 690.8(A) requirement)
    if (ocpdRating < maxCurrentNEC) {
      // FAIL — even the max fuse can't protect this circuit
      log.push({
        step: '5',
        action: 'Re-evaluate compliance after cap',
        fromValue: ocpdRating,
        toValue: 'FAIL',
        necReference: 'NEC 690.8(A)(B)',
        reason: `Capped OCPD (${ocpdRating}A) < required maxCurrentNEC (${maxCurrentNEC.toFixed(2)}A). Module maxSeriesFuseRating is insufficient for this Isc. System cannot be made compliant with this module at this string configuration.`,
      });

      // Determine specific failure mode
      const status: OCPDResolutionStatus =
        input.maxSeriesFuseRating < 20
          ? 'FAIL_CHANGE_MODULE'
          : 'FAIL_REDUCE_STRING';

      return {
        stringId: input.stringId,
        iscSTC: input.panelIsc,
        iscCorrected,
        maxCurrentNEC,
        requiredOCPD,
        ocpdRating,
        wasCapped,
        capValue: input.maxSeriesFuseRating,
        status,
        necReference: 'NEC 690.8(A)(B)',
        autoAdjustmentLog: log,
        failureReason: status === 'FAIL_CHANGE_MODULE'
          ? `Module maxSeriesFuseRating (${input.maxSeriesFuseRating}A) is too low for the corrected Isc (${iscCorrected.toFixed(2)}A). Select a module with maxSeriesFuseRating ≥ ${Math.ceil(maxCurrentNEC)}A.`
          : `Even at maxSeriesFuseRating (${input.maxSeriesFuseRating}A), the OCPD cannot protect the circuit. Reduce string count to lower Isc, or select a module with higher maxSeriesFuseRating.`,
        isManualOverride: false,
        overrideRisk: 'none' as const,
      };
    }

    // Capped but still compliant (ocpdRating >= maxCurrentNEC)
    log.push({
      step: '5',
      action: 'Re-evaluate compliance after cap',
      fromValue: ocpdRating,
      toValue: 'PASS_CAPPED',
      necReference: 'NEC 690.8(A)(B)',
      reason: `Capped OCPD (${ocpdRating}A) ≥ maxCurrentNEC (${maxCurrentNEC.toFixed(2)}A). Compliant with cap. Note: OCPD is set to module maxSeriesFuseRating, not calculated minimum.`,
    });

    return {
      stringId: input.stringId,
      iscSTC: input.panelIsc,
      iscCorrected,
      maxCurrentNEC,
      requiredOCPD,
      ocpdRating,
      wasCapped,
      capValue: input.maxSeriesFuseRating,
      status: 'PASS_CAPPED',
      necReference: 'NEC 690.8(A)(B)',
      autoAdjustmentLog: log,
      isManualOverride: false,
      overrideRisk: 'none' as const,
    };
  }

  // Step 6: Check against inverter MPPT input current (warning only)
  if (ocpdRating > input.inverterMaxInputCurrentPerMppt * 1.25) {
    log.push({
      step: '6',
      action: 'Check inverter MPPT current compatibility',
      fromValue: ocpdRating,
      toValue: 'WARNING',
      necReference: 'NEC 690.8 / Inverter Datasheet',
      reason: `OCPD (${ocpdRating}A) exceeds 125% of inverter maxInputCurrentPerMppt (${input.inverterMaxInputCurrentPerMppt}A × 1.25 = ${(input.inverterMaxInputCurrentPerMppt * 1.25).toFixed(1)}A). Verify inverter datasheet.`,
    });
  }

  log.push({
    step: '6',
    action: 'Final OCPD selection',
    fromValue: requiredOCPD,
    toValue: ocpdRating,
    necReference: 'NEC 690.8(B) / NEC 240.6(A)',
    reason: `Final OCPD: ${ocpdRating}A standard size. No cap required. Compliant.`,
  });

  return {
    stringId: input.stringId,
    iscSTC: input.panelIsc,
    iscCorrected,
    maxCurrentNEC,
    requiredOCPD,
    ocpdRating,
    wasCapped: false,
    capValue: input.maxSeriesFuseRating,
    status: 'PASS',
    necReference: 'NEC 690.8(A)(B)',
    autoAdjustmentLog: log,
    isManualOverride: false,
    overrideRisk: 'none' as const,
  };
}

// ─── Batch Resolution ─────────────────────────────────────────────────────────

export interface BatchOCPDResult {
  strings: OCPDResolutionResult[];
  allPass: boolean;
  anyFail: boolean;
  anyCapped: boolean;
  totalAutoAdjustments: number;
}

export function resolveOCPDBatch(inputs: OCPDResolutionInput[]): BatchOCPDResult {
  const strings = inputs.map(resolveOCPD);
  return {
    strings,
    allPass: strings.every(s => s.status === 'PASS' || s.status === 'PASS_CAPPED'),
    anyFail: strings.some(s => s.status.startsWith('FAIL')),
    anyCapped: strings.some(s => s.wasCapped),
    totalAutoAdjustments: strings.reduce((sum, s) => sum + s.autoAdjustmentLog.length, 0),
  };
}