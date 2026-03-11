// ============================================================
// lib/plan-set/permit-system-model.ts
// PermitSystemModel — single source of truth bridge
//
// This type extracts only the fields needed by permit sheet
// renderers from ComputedSystem. It is populated ONCE (either
// from the client-side cs sent via csData, or by calling
// computeSystem() at the route entry point) and passed to ALL
// sheet builders. No individual sheet ever re-derives NEC values.
//
// Architecture:
//   Design Studio → computeSystem() → ComputedSystem
//   → buildPermitSystemModel() → PermitSystemModel
//   → All sheet renderers (E-1, S-1, C-1, etc.)
// ============================================================

import {
  type ComputedSystem,
  type ComputedSystemInput,
  computeSystem,
} from '@/lib/computed-system';

// ─── PermitSystemModel ────────────────────────────────────────────────────────
// Flat, permit-renderers-only view of ComputedSystem.
// All NEC calculations are pre-resolved. Sheet builders receive
// final values and render them — they never re-compute.

export interface PermitSystemModel {
  // ── Topology ──────────────────────────────────────────────
  topology: 'string_inverter' | 'microinverter' | 'optimizer';
  isMicro: boolean;
  isString: boolean;

  // ── Array Summary ─────────────────────────────────────────
  totalPanels: number;
  totalDcKw: number;
  totalAcKw: number;
  dcAcRatio: number;
  stringCount: number;
  panelsPerString: number;

  // ── NEC 690.7 — Temp-Corrected Voc (pre-computed) ─────────
  designTempMin: number;          // °C — minimum ambient design temp
  vocSTC: number;                 // V — module Voc at STC
  vocCorrected: number;           // V — module Voc × temp correction factor
  tempCorrectionFactor: number;   // dimensionless
  stringVoc: number;              // V — string open-circuit voltage (corrected)
  stringVmp: number;              // V — string max power voltage
  inverterMaxDcV: number;         // V — inverter max DC input voltage
  voltagePass: boolean;           // stringVoc ≤ inverterMaxDcV

  // ── NEC 690.8 — String OCPD & Conductor (pre-computed) ────
  stringIsc: number;              // A — string short-circuit current
  stringOcpdAmps: number;         // A — NEC 690.8: Isc × 1.25 → next standard

  // ── DC Wiring (from ComputedSystem runs) ─────────────────
  dcWireGauge: string;            // e.g. '#10 AWG' — from DC_STRING_RUN
  dcConduitType: string;          // e.g. '3/4" EMT'
  dcOcpdAmps: number;             // A — from DC_STRING_RUN
  dcAmpacity: number;             // A — derated ampacity (from engine)
  dcAmpacityPass: boolean;

  // ── AC Wiring (from ComputedSystem runs) ─────────────────
  acWireGauge: string;            // e.g. '#8 AWG' — from DISCO_TO_METER_RUN
  acConduitType: string;
  acOcpdAmps: number;             // A — NEC 690.8 AC OCPD
  acOutputCurrentA: number;       // A — total AC output
  systemVoltageAC: number;        // V — 240

  // ── NEC 705.12 — 120% Rule (pre-computed) ─────────────────
  backfeedBreakerAmps: number;    // A — backfeed breaker size
  mainPanelBusAmps: number;       // A — MSP bus rating
  mainPanelBreakerAmps: number;   // A — MSP main breaker
  interconnectionPass: boolean;   // NEC 705.12(B) 120% rule result
  interconnectionMethod: string;  // 'supply-side' | 'load-side'
  maxAllowedBackfeed: number;     // A — (busAmps × 1.2) − mainBreaker

  // ── Ground ────────────────────────────────────────────────
  egcGauge: string;               // Equipment Grounding Conductor gauge

  // ── Environmental (from computeSystem input) ──────────────
  ambientTempC: number;           // °C — max ambient
  rooftopTempAdderC: number;      // °C — NEC 310.15(B)(2)(a) adder

  // ── Per-String details ────────────────────────────────────
  strings: Array<{
    stringIndex: number;
    panelCount: number;
    stringVoc: number;
    stringVmp: number;
    stringIsc: number;
    ocpdAmps: number;
    wireGauge: string;
    conduitType: string;
    wireLength: number;
    voltagePass: boolean;
  }>;

  // ── Microinverter specific ────────────────────────────────
  microDeviceCount: number;
  acBranchCount: number;
  acBranchOcpdAmps: number;

  // ── Validation summary ────────────────────────────────────
  isValid: boolean;
  errorCount: number;
  warningCount: number;
  issuesSummary: string[];        // human-readable for C-1 sheet
}

// ─── buildPermitSystemModel ───────────────────────────────────────────────────
// Extracts a PermitSystemModel from a ComputedSystem.
// This is the ONLY place where ComputedSystem is translated to permit values.

export function buildPermitSystemModel(
  cs: ComputedSystem,
  overrides?: {
    mainPanelBusAmps?: number;
    mainPanelBreakerAmps?: number;
    interconnectionMethod?: string;
    dcConduitType?: string;
    acConduitType?: string;
    // run lengths from page config (strings array with wireLength)
    strings?: Array<{
      id: string; label: string; panelCount: number; panelWatts: number;
      wireGauge: string; conduitType: string; wireLength: number;
      ocpdAmps: number; stringVoc: number; stringVmp: number;
      stringIsc: number; stringImp: number;
    }>;
  }
): PermitSystemModel {
  // ── Pull from RunMap ──────────────────────────────────────
  const dcRun = cs.runMap?.['DC_STRING_RUN'] ?? cs.runs?.find(r => r.id === 'DC_STRING_RUN');
  const acRun = cs.runMap?.['DISCO_TO_METER_RUN'] ?? cs.runs?.find(r => r.id === 'DISCO_TO_METER_RUN')
              ?? cs.runMap?.['INV_TO_DISCO_RUN'] ?? cs.runs?.find(r => r.id === 'INV_TO_DISCO_RUN')
              ?? cs.runMap?.['COMBINER_TO_DISCO_RUN'] ?? cs.runs?.find(r => r.id === 'COMBINER_TO_DISCO_RUN');
  const branchRun = cs.runMap?.['BRANCH_RUN'] ?? cs.runs?.find(r => r.id === 'BRANCH_RUN');

  // ── First string for single-string values ─────────────────
  const firstString = cs.strings?.[0];
  const firstOver = overrides?.strings?.[0];

  // ── DC wire gauge: ComputedSystem runs first, then override ─
  const dcWireGauge = dcRun?.wireGauge ?? firstOver?.wireGauge ?? '#10 AWG';
  const acWireGauge = acRun?.wireGauge ?? '#8 AWG';
  const egcGauge = dcRun?.egcGauge ?? '#10 AWG';

  // ── Conduit types from overrides (config) or run ──────────
  const dcConduitType = overrides?.dcConduitType ?? dcRun?.conduitSize ?? '3/4" EMT';
  const acConduitType = overrides?.acConduitType ?? acRun?.conduitSize ?? '1" EMT';

  // ── Main panel values (not in ComputedSystem — from config) ─
  const mainPanelBusAmps = overrides?.mainPanelBusAmps ?? 200;
  const mainPanelBreakerAmps = overrides?.mainPanelBreakerAmps ?? 200;

  // ── 120% rule calculation ──────────────────────────────────
  const interconRaw = overrides?.interconnectionMethod ?? 'load-side';
  const isSupplySide = interconRaw.toUpperCase().includes('SUPPLY');
  const interconnectionMethod = isSupplySide ? 'supply-side' : 'load-side';
  const maxAllowedBackfeed = mainPanelBusAmps * 1.2 - mainPanelBreakerAmps;

  // ── Vocorrected for first string ──────────────────────────
  const vocSTC = firstString?.vocSTC ?? 0;
  const vocCorrected = firstString?.vocCorrected ?? vocSTC;
  const stringVoc = firstString?.stringVoc ?? 0;
  const stringVmp = firstString?.stringVmp ?? 0;
  const stringIsc = firstString?.stringIsc ?? 0;
  const stringOcpdAmps = firstString?.ocpdAmps ?? cs.acOcpdAmps ?? 20;
  const tempCorrFactor = firstString?.tempCorrectionFactor ?? 1.0;
  const voltagePass = firstString?.voltagePass ?? true;

  // ── Per-string details ────────────────────────────────────
  const strings: PermitSystemModel['strings'] = (cs.strings ?? []).map((s, i) => {
    const ov = overrides?.strings?.[i];
    return {
      stringIndex: s.stringIndex,
      panelCount: s.panelCount,
      stringVoc: s.stringVoc,
      stringVmp: s.stringVmp,
      stringIsc: s.stringIsc,
      ocpdAmps: s.ocpdAmps,
      wireGauge: dcRun?.wireGauge ?? ov?.wireGauge ?? '#10 AWG',
      conduitType: dcConduitType,
      wireLength: ov?.wireLength ?? dcRun?.onewayLengthFt ?? 50,
      voltagePass: s.voltagePass,
    };
  });

  // If no strings from computeSystem (e.g. micro topology), build from overrides
  const finalStrings = strings.length > 0
    ? strings
    : (overrides?.strings ?? []).map((ov, i) => ({
        stringIndex: i,
        panelCount: ov.panelCount,
        stringVoc: ov.stringVoc,
        stringVmp: ov.stringVmp,
        stringIsc: ov.stringIsc,
        ocpdAmps: ov.ocpdAmps,
        wireGauge: ov.wireGauge,
        conduitType: ov.conduitType,
        wireLength: ov.wireLength,
        voltagePass: true,
      }));

  // ── Validation issues ────────────────────────────────────
  const issuesSummary = (cs.issues ?? [])
    .filter(i => i.severity !== 'info')
    .map(i => `[${i.severity.toUpperCase()}] ${i.code}: ${i.message}`);

  // ── Topology string ──────────────────────────────────────
  const topology = cs.isMicro
    ? 'microinverter'
    : cs.isOptimizer
    ? 'optimizer'
    : 'string_inverter';

  return {
    topology,
    isMicro: cs.isMicro,
    isString: cs.isString,
    totalPanels: cs.totalPanels,
    totalDcKw: cs.totalDcKw,
    totalAcKw: cs.totalAcKw,
    dcAcRatio: cs.dcAcRatio,
    stringCount: cs.stringCount ?? finalStrings.length,
    panelsPerString: cs.panelsPerString ?? finalStrings[0]?.panelCount ?? 1,
    designTempMin: cs.designTempMin ?? -10,
    vocSTC,
    vocCorrected,
    tempCorrectionFactor: tempCorrFactor,
    stringVoc,
    stringVmp,
    stringIsc,
    stringOcpdAmps,
    inverterMaxDcV: cs.inverterSpec?.dcInputs?.maxVoltage ?? 600,
    voltagePass,
    dcWireGauge,
    dcConduitType,
    dcOcpdAmps: dcRun?.ocpdAmps ?? stringOcpdAmps,
    dcAmpacity: dcRun?.effectiveAmpacity ?? 30,
    dcAmpacityPass: dcRun?.ampacityPass ?? true,
    acWireGauge,
    acConduitType,
    acOcpdAmps: cs.acOcpdAmps,
    acOutputCurrentA: cs.acOutputCurrentA,
    systemVoltageAC: cs.systemVoltageAC ?? 240,
    backfeedBreakerAmps: cs.backfeedBreakerAmps,
    mainPanelBusAmps,
    mainPanelBreakerAmps,
    interconnectionPass: isSupplySide ? true : cs.interconnectionPass,
    interconnectionMethod,
    maxAllowedBackfeed,
    egcGauge,
    ambientTempC: cs.ambientTempC ?? 40,
    rooftopTempAdderC: cs.rooftopTempAdderC ?? 33,
    strings: finalStrings,
    microDeviceCount: cs.microDeviceCount ?? 0,
    acBranchCount: cs.acBranchCount ?? 0,
    acBranchOcpdAmps: cs.acBranchOcpdAmps ?? 0,
    isValid: cs.isValid,
    errorCount: cs.errorCount,
    warningCount: cs.warningCount,
    issuesSummary,
  };
}

// ─── buildPermitSystemModelFromInput ─────────────────────────────────────────
// Convenience: call computeSystem() then buildPermitSystemModel().
// Used in the route when no pre-computed csData is provided.

export function buildPermitSystemModelFromInput(
  csInput: ComputedSystemInput,
  overrides?: Parameters<typeof buildPermitSystemModel>[1]
): PermitSystemModel {
  const cs = computeSystem(csInput);
  return buildPermitSystemModel(cs, overrides);
}