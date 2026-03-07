// ============================================================
// NEC 2020/2023 Electrical Calculation Engine — V3
// Deterministic auto-resolution via OCPD resolver + wire auto-sizer
// Permit-grade solar PV calculations
// ============================================================

import { getConductorByGauge } from './equipment-db';
import { resolveOCPD, OCPDResolutionResult } from './ocpd-resolver';
import { autoSizeACWire, autoSizeDCWire, WireAutoSizerResult, DCWireAutoSizerResult } from './wire-autosizer';
import {
  nextStandardOCPD,
  getTempDeratingFactor,
  getConduitFillDeratingFactor,
  getEGCSize,
  getSmallestConduit,
  getConductorArea,
  getConductorByMinAmpacity,
} from './manufacturer-specs';

// ─── Input Types ──────────────────────────────────────────────────────────────


// ─── Interconnection Method Types ──────────────────────────────────────────────

export type InterconnectionMethod =
  | 'LOAD_SIDE'           // NEC 705.12(B) — load-side breaker, 120% rule applies
  | 'SUPPLY_SIDE_TAP'     // NEC 705.11  — line-side tap, 120% rule NOT applicable
  | 'MAIN_BREAKER_DERATE' // NEC 705.12(B) — derate main breaker to allow solar breaker
  | 'PANEL_UPGRADE';      // Upgrade bus rating to satisfy 120% rule

export interface InterconnectionInput {
  method: InterconnectionMethod;
  busRating: number;       // Panel bus bar rating (A) — e.g. 200
  mainBreaker: number;     // Main breaker size (A)    — e.g. 200
  solarBreaker?: number;   // Solar backfeed breaker (A) — computed if omitted
}

export interface InterconnectionResult {
  method: InterconnectionMethod;
  methodLabel: string;
  busRating: number;
  mainBreaker: number;
  solarBreakerRequired: number;
  maxAllowedSolarBreaker: number;
  passes: boolean;
  necReference: string;
  message: string;
  // MAIN_BREAKER_DERATE specific
  maxMainBreakerAllowed?: number;
  recommendedMainBreaker?: number;
  // Alternatives when LOAD_SIDE fails
  alternatives?: InterconnectionAlternative[];
  issues: CalcIssue[];
}

export interface InterconnectionAlternative {
  method: InterconnectionMethod;
  label: string;
  description: string;
  passes: boolean;
}

export interface StringInput {
  panelCount: number;
  panelVoc: number;
  panelIsc: number;
  panelImp: number;
  panelVmp: number;
  panelWatts: number;
  tempCoeffVoc: number;      // %/°C (negative)
  tempCoeffIsc: number;      // %/°C (positive) — NEW
  maxSeriesFuseRating: number;
  wireGauge: string;
  wireLength: number;        // feet one-way
  conduitType: string;
}

export interface InverterInput {
  type: 'string' | 'micro' | 'optimizer';
  acOutputKw: number;
  maxDcVoltage: number;
  mpptVoltageMin: number;
  mpptVoltageMax: number;
  maxInputCurrentPerMppt: number;
  maxShortCircuitCurrent?: number;
  acOutputCurrentMax: number;
  strings: StringInput[];
  // For microinverters: topology-aware fields
  modulesPerDevice?: number;  // Modules connected per microinverter (default 1)
  deviceCount?: number;       // Number of microinverter devices
}

export interface ElectricalCalcInput {
  inverters: InverterInput[];
  mainPanelAmps: number;
  systemVoltage: number;
  designTempMin: number;
  designTempMax: number;
  rooftopTempAdder: number;
  wireGauge: string;
  wireLength: number;
  conduitType: string;
  rapidShutdown: boolean;
  acDisconnect: boolean;
  dcDisconnect: boolean;
  necVersion: '2017' | '2020' | '2023';
  engineeringMode?: 'AUTO' | 'MANUAL';
  interconnection?: InterconnectionInput;  // Interconnection method — defaults to LOAD_SIDE

  // Battery storage — NEC 705.12(B): AC-coupled battery backfeed adds to bus loading
  batteryBackfeedA?: number;        // A — battery backfeed breaker amps (from equipment-db)
  batteryCount?: number;            // qty of battery units
  batteryContinuousOutputA?: number; // A — battery continuous output current
  batteryModel?: string;            // for display in NEC calc steps
  batteryManufacturer?: string;     // for display in NEC calc steps

  // Generator — NEC 702 Optional Standby Systems
  generatorKw?: number;             // kW — generator rated output
  generatorOutputBreakerA?: number; // A — generator output breaker
  generatorModel?: string;          // for display
  generatorManufacturer?: string;   // for display

  // ATS — NEC 702.5 Transfer Equipment
  atsAmpRating?: number;            // A — ATS amp rating
  atsModel?: string;                // for display

  // Backup Interface Unit — NEC 706 / NEC 230.82
  backupInterfaceMaxA?: number;     // A — BUI max continuous output
  backupInterfaceModel?: string;    // for display
  hasEnphaseIQSC3?: boolean;        // true = IQ SC3 is the ATS
}

// ─── Issue / Result Types ─────────────────────────────────────────────────────

export interface CalcIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  value?: number | string;
  limit?: number | string;
  necReference?: string;
  suggestion?: string;
  autoResolved?: boolean;
  resolvedValue?: string | number;
}

export interface StringCalcResult {
  stringId: number;
  panelCount: number;
  vocSTC: number;
  vocCorrected: number;
  vocWorstCase: number;
  iscSTC: number;
  iscCorrected: number;
  maxCurrentNEC: number;
  ocpdRating: number;
  ocpdResolution: OCPDResolutionResult;
  wireGauge: string;
  wireAutoSized: boolean;
  dcWireResult: DCWireAutoSizerResult;
  wireAmpacity: number;
  wireAmpacityDerated: number;
  voltageDrop: number;
  issues: CalcIssue[];
}

export interface InverterCalcResult {
  inverterId: number;
  type: string;
  acOutputKw: number;
  acOutputCurrentMax: number;
  strings: StringCalcResult[];
  dcVoltageOk: boolean;
  mpptRangeOk: boolean;
  acWireResult: WireAutoSizerResult;
  issues: CalcIssue[];
}

export interface BusbarCalcResult {
  mainPanelAmps: number;
  totalAcOutputAmps: number;
  backfeedBreakerRequired: number;
  busbarRule: '120%' | 'supply-side';
  maxAllowedBackfeed: number;
  passes: boolean;
  issues: CalcIssue[];
}

export interface ConduitFillResult {
  conduitType: string;
  conduitSize: string;
  wireCount: number;
  totalFillArea: number;
  maxAllowedArea: number;
  fillPercent: number;
  passes: boolean;
  issues: CalcIssue[];
}

export interface AutoResolutionLog {
  field: string;
  type: string;
  originalValue: string | number;
  resolvedValue: string | number;
  necReference: string;
  reason: string;
}

// ─── Engineering Model — Single Source of Truth ───────────────────────────────
// ALL downstream modules (BOM, SLD, Equipment Schedule, Compliance) must read
// ONLY from this model. No module may independently calculate these values.

export type DisconnectType = 'non-fused' | 'fused';

export interface EngineeringModel {
  // Core sizing
  ocpd: number;                    // e.g. 60 (A)
  disconnectRating: number;        // e.g. 60 (A)
  disconnectType: DisconnectType;  // 'non-fused' | 'fused'
  fuseSize: number | null;         // null if non-fused; = ocpd if fused
  fuseCount: number;               // 0 if non-fused; 2 if fused (240V)
  conductor: string;               // e.g. "#6 THWN-2"
  conductorAmpacity: number;       // e.g. 65
  conduit: string;                 // e.g. "3/4&quot; EMT"
  conduitFillPct: number;          // e.g. 33.1
  grounding: string;               // e.g. "#10 CU"
  systemVoltage: number;           // e.g. 240
  // Validation
  isValid: boolean;
  validationErrors: string[];
}

// Validation function — throws if configuration is electrically impossible
export function validateEngineeringModel(model: EngineeringModel): void {
  const errors: string[] = [];

  if (model.disconnectType === 'non-fused') {
    if (model.fuseSize !== null) {
      errors.push(`Inconsistent electrical configuration detected: non-fused disconnect cannot have fuseSize=${model.fuseSize}. Set fuseSize=null for non-fused disconnect.`);
    }
    if (model.fuseCount > 0) {
      errors.push(`Inconsistent electrical configuration detected: non-fused disconnect cannot have fuseCount=${model.fuseCount}. Set fuseCount=0 for non-fused disconnect.`);
    }
  }

  if (model.disconnectType === 'fused') {
    if (model.fuseSize === null) {
      errors.push(`Inconsistent electrical configuration detected: fused disconnect requires fuseSize. Set fuseSize=ocpd for fused disconnect.`);
    }
    if (model.fuseCount < 2) {
      errors.push(`Inconsistent electrical configuration detected: fused disconnect requires fuseCount≥2 for 240V. Set fuseCount=2.`);
    }
  }

  if (model.disconnectRating < model.ocpd) {
    errors.push(`Inconsistent electrical configuration detected: disconnectRating (${model.disconnectRating}A) must be ≥ ocpd (${model.ocpd}A).`);
  }

  if (errors.length > 0) {
    throw new Error(errors.join(' | '));
  }
}

// ─── AC Disconnect & Conductor Sizing Result (NEC 705.60 / 240.6 / 310.16) ───

export interface ACSizingResult {
  // Step 1 — Inverter Output Current
  acCurrentAmps: number;           // systemAC_kW × 1000 / systemVoltage
  // Step 2 — Continuous Load (NEC 705.60)
  continuousCurrentAmps: number;   // acCurrentAmps × 1.25
  // Step 3 — OCPD (NEC 240.6)
  ocpdAmps: number;                // next standard breaker ≥ continuousCurrentAmps
  ocpdLabel: string;               // e.g. "60A Circuit Breaker"
  // Step 4 — Disconnect (NEC 690.14)
  disconnectAmps: number;          // ≥ OCPD
  disconnectType: DisconnectType;  // 'non-fused' | 'fused'
  disconnectLabel: string;         // e.g. "60A Non-Fused AC Disconnect"
  // Step 5 — Fuse Size (only if disconnectType === 'fused')
  fuseAmps: number | null;         // null if non-fused
  fuseCount: number;               // 0 if non-fused; 2 if fused
  fuseLabel: string;               // e.g. "None (Non-Fused Disconnect)" or "40A Fuse × 2"
  // Step 6 — Conductor (NEC 310.16 / 75°C column)
  conductorGauge: string;          // e.g. "#6 AWG"
  conductorType: string;           // e.g. "THWN-2 Copper"
  conductorAmpacity: number;       // 75°C ampacity
  conductorLabel: string;          // e.g. "#6 THWN-2 Copper (65A)"
  // Step 7 — Conduit Fill (NEC Chapter 9)
  conduitSize: string;             // e.g. '3/4"'
  conduitType: string;             // e.g. "EMT"
  conduitFillPct: number;          // e.g. 33.1
  conduitLabel: string;            // e.g. '3/4" EMT (33.1% fill)'
  // Grounding (NEC 250.66)
  groundingConductor: string;      // e.g. "#10 Copper"
  // Canonical engineeringModel — single source of truth for all downstream modules
  engineeringModel: EngineeringModel;
  // NEC references
  necRefs: string[];
}

export interface ElectricalCalcResult {
  status: 'PASS' | 'WARNING' | 'FAIL';
  necVersion: string;
  engineeringMode: 'AUTO' | 'MANUAL';
  errors: CalcIssue[];
  warnings: CalcIssue[];
  infos: CalcIssue[];
  recommendations: string[];
  inverters: InverterCalcResult[];
  busbar: BusbarCalcResult;
  conduitFill: ConduitFillResult;
  groundingConductor: string;
  acWireGauge: string;
  acWireAmpacity: number;
  acVoltageDrop: number;
  acConductorCallout: string;
  rapidShutdownCompliant: boolean;
  autoResolutions: AutoResolutionLog[];
  interconnection: InterconnectionResult;
  // NEW: AC Disconnect & Conductor Sizing (Steps 1–7)
  acSizing: ACSizingResult;
  summary: {
    totalDcKw: number;
    totalAcKw: number;
    dcAcRatio: number;
    totalPanels: number;
    systemVoltage: number;
  };
}

// ─── Main Calculation Function ────────────────────────────────────────────────

export function runElectricalCalc(input: ElectricalCalcInput): ElectricalCalcResult {
  const mode = input.engineeringMode ?? 'AUTO';
  const allErrors: CalcIssue[] = [];
  const allWarnings: CalcIssue[] = [];
  const allInfos: CalcIssue[] = [];
  const recommendations: string[] = [];
  const autoResolutions: AutoResolutionLog[] = [];

  const inverterResults: InverterCalcResult[] = [];
  let totalDcKw = 0;
  let totalAcKw = 0;
  let totalPanels = 0;
  let totalAcOutputAmps = 0;
  let maxOcpd = 0;

  // Normalize AC wire gauge input (e.g. "#10 AWG THWN-2" → "#10 AWG")
  const normalizeGauge = (g: string): string => {
    const m = g.match(/(#\d+(?:\/\d+)?\s*AWG)/);
    return m ? m[1].trim() : g;
  };
  const acStartGauge = normalizeGauge(input.wireGauge);

  // ── Per-inverter calculations ─────────────────────────────────────────────
  input.inverters.forEach((inv, invIdx) => {
    const invIssues: CalcIssue[] = [];
    const stringResults: StringCalcResult[] = [];

    // Topology-aware AC capacity accumulation
    // MICRO: acOutputKw is per-device; multiply by deviceCount for total AC
    // STRING: acOutputKw is already the full inverter AC output
    const invAcKw = inv.type === 'micro'
      ? inv.acOutputKw * (inv.deviceCount || 1)
      : inv.acOutputKw;
    totalAcKw += invAcKw;
    totalAcOutputAmps += (invAcKw * 1000) / input.systemVoltage;

    // ─── Topology-aware DC size calculation ────────────────────────────
    if (inv.type === 'micro') {
      // MICRO: DC size derived from deviceCount and modulesPerDevice
      const moduleCount = (inv.deviceCount || 0) * (inv.modulesPerDevice || 1);
      const moduleWattage = inv.strings[0]?.panelWatts || 400; // Use panel wattage from config or default
      totalDcKw += (moduleCount * moduleWattage) / 1000;
      totalPanels += moduleCount;
    } else {
      // STRING/OPTIMIZER: DC size derived from string arrays

    // ── Per-string calculations ──────────────────────────────────────────────
    inv.strings.forEach((str, strIdx) => {
      const strIssues: CalcIssue[] = [];
      totalPanels += str.panelCount;
      totalDcKw += (str.panelCount * str.panelWatts) / 1000;
      const stringLabel = `${invIdx + 1}-${strIdx + 1}`;

      // 1. String Voc temperature correction (NEC 690.7)
      const tempDelta = input.designTempMin - 25;
      const vocCorrectionFactor = 1 + (str.tempCoeffVoc / 100) * tempDelta;
      const vocSTC = str.panelVoc * str.panelCount;
      const vocCorrected = vocSTC * vocCorrectionFactor;

      if (vocCorrected > inv.maxDcVoltage) {
        strIssues.push({
          code: 'E-VOC-EXCEED',
          severity: 'error',
          message: `String ${stringLabel}: Corrected Voc (${vocCorrected.toFixed(1)}V) exceeds inverter max DC voltage (${inv.maxDcVoltage}V)`,
          value: vocCorrected.toFixed(1),
          limit: inv.maxDcVoltage,
          necReference: 'NEC 690.7',
          suggestion: `Reduce string to ${Math.floor(inv.maxDcVoltage / (str.panelVoc * vocCorrectionFactor))} panels`,
        });
      }

      const vmpString = str.panelVmp * str.panelCount;
      if (vmpString > inv.mpptVoltageMax) {
        strIssues.push({
          code: 'W-MPPT-HIGH',
          severity: 'warning',
          message: `String ${stringLabel}: Vmp (${vmpString.toFixed(1)}V) exceeds MPPT max (${inv.mpptVoltageMax}V)`,
          value: vmpString.toFixed(1),
          limit: inv.mpptVoltageMax,
          necReference: 'NEC 690.7',
          suggestion: 'Reduce string length by 1–2 panels',
        });
      }

      if (vocCorrected < inv.mpptVoltageMin) {
        strIssues.push({
          code: 'W-MPPT-LOW',
          severity: 'warning',
          message: `String ${stringLabel}: Voc (${vocCorrected.toFixed(1)}V) may fall below MPPT min (${inv.mpptVoltageMin}V)`,
          value: vocCorrected.toFixed(1),
          limit: inv.mpptVoltageMin,
          necReference: 'NEC 690.7',
          suggestion: 'Add panels to string or verify MPPT range',
        });
      }

      // 2. OCPD Deterministic Auto-Resolution (NEC 690.8)
      const tempCoeffIsc = str.tempCoeffIsc ?? 0.05;
      const ocpdResolution = resolveOCPD({
        stringId: stringLabel,
        panelIsc: str.panelIsc,
        tempCoeffIsc,
        maxSeriesFuseRating: str.maxSeriesFuseRating,
        designTempMaxC: input.designTempMax,
        rooftopTempAdderC: input.rooftopTempAdder,
        inverterMaxInputCurrentPerMppt: inv.maxInputCurrentPerMppt,
      });

      const { ocpdRating, iscCorrected, maxCurrentNEC, wasCapped, status: ocpdStatus } = ocpdResolution;
      maxOcpd = Math.max(maxOcpd, ocpdRating);

      if (wasCapped) {
        autoResolutions.push({
          field: `string-${stringLabel}.ocpd`,
          type: 'OCPD_CAPPED',
          originalValue: nextStandardOCPD(maxCurrentNEC * 1.25),
          resolvedValue: ocpdRating,
          necReference: 'NEC 690.8(B) / Module Datasheet',
          reason: `OCPD capped at module maxSeriesFuseRating (${str.maxSeriesFuseRating}A). Calculated: ${nextStandardOCPD(maxCurrentNEC * 1.25)}A.`,
        });
        strIssues.push({
          code: 'I-OCPD-CAPPED',
          severity: 'info',
          message: `String ${stringLabel}: OCPD auto-capped at ${ocpdRating}A (module maxSeriesFuseRating). Calculated would be ${nextStandardOCPD(maxCurrentNEC * 1.25)}A.`,
          necReference: 'NEC 690.8(B)',
          autoResolved: true,
          resolvedValue: ocpdRating,
        });
      }

      if (ocpdStatus === 'FAIL_REDUCE_STRING' || ocpdStatus === 'FAIL_CHANGE_MODULE') {
        strIssues.push({
          code: 'E-OCPD-FAIL',
          severity: 'error',
          message: `String ${stringLabel}: ${ocpdResolution.failureReason}`,
          value: ocpdRating,
          limit: str.maxSeriesFuseRating,
          necReference: 'NEC 690.8(A)(B)',
          suggestion: ocpdStatus === 'FAIL_CHANGE_MODULE'
            ? `Select module with maxSeriesFuseRating ≥ ${Math.ceil(maxCurrentNEC)}A`
            : `Reduce string count so Isc < ${(str.maxSeriesFuseRating / 1.5625).toFixed(1)}A`,
          autoResolved: false,
        });
      }

      // 3. DC Wire Auto-Sizing (NEC 690.8 / 310.15)
      const dcWireResult = autoSizeDCWire({
        stringId: stringLabel,
        maxCurrentNEC,
        onewayLengthFt: str.wireLength,
        systemVoltage: str.panelVmp * str.panelCount,
        ambientTempC: input.designTempMax,
        rooftopTempAdderC: input.rooftopTempAdder,
        conduitType: str.conduitType,
        maxVoltageDropPct: 3.0,
        startingGauge: normalizeGauge(str.wireGauge),
        mode,
      });

      const finalDCGauge = dcWireResult.selectedGauge;

      if (dcWireResult.wasAutoSized && mode === 'AUTO') {
        autoResolutions.push({
          field: `string-${stringLabel}.dcWireGauge`,
          type: 'DC_WIRE_BUMPED',
          originalValue: str.wireGauge,
          resolvedValue: finalDCGauge,
          necReference: 'NEC 690.8 / 310.15',
          reason: `DC wire auto-sized: ${str.wireGauge} → ${finalDCGauge}. ${dcWireResult.conductorCallout}`,
        });
        strIssues.push({
          code: 'I-DC-WIRE-AUTOSIZED',
          severity: 'info',
          message: `String ${stringLabel}: DC wire auto-sized ${str.wireGauge} → ${finalDCGauge}. ${dcWireResult.conductorCallout}`,
          necReference: 'NEC 690.8 / 310.15',
          autoResolved: true,
          resolvedValue: finalDCGauge,
        });
      }

      if (!dcWireResult.overallPass) {
        strIssues.push({
          code: 'E-DC-WIRE-FAIL',
          severity: 'error',
          message: `String ${stringLabel}: DC wire ${finalDCGauge} — ampacity ${dcWireResult.effectiveAmpacity.toFixed(1)}A required ${maxCurrentNEC.toFixed(1)}A, VDrop ${dcWireResult.voltageDrop.toFixed(2)}%`,
          necReference: 'NEC 690.8 / 310.15',
          suggestion: 'Manual engineering review required',
        });
      }

      const finalDCConductor = getConductorByGauge(finalDCGauge);
      const rooftopTemp = input.designTempMax + input.rooftopTempAdder;
      const wireAmpacity = finalDCConductor?.ampacity_90c ?? 0;
      const wireAmpacityDerated = wireAmpacity * getTempDeratingFactor(rooftopTemp) * getConduitFillDeratingFactor(2);

      stringResults.push({
        stringId: strIdx + 1,
        panelCount: str.panelCount,
        vocSTC,
        vocCorrected,
        vocWorstCase: vocCorrected,
        iscSTC: str.panelIsc,
        iscCorrected,
        maxCurrentNEC,
        ocpdRating,
        ocpdResolution,
        wireGauge: finalDCGauge,
        wireAutoSized: dcWireResult.wasAutoSized,
        dcWireResult,
        wireAmpacity,
        wireAmpacityDerated,
        voltageDrop: dcWireResult.voltageDrop,
        issues: strIssues,
      });

      strIssues.forEach(i => {
        if (i.severity === 'error') allErrors.push(i);
        else if (i.severity === 'warning') allWarnings.push(i);
        else allInfos.push(i);
      });
    }); // end string forEach
    } // end else (STRING/OPTIMIZER)

    // Inverter-level DC checks
    const dcVoltageOk = stringResults.every(s => s.vocCorrected <= inv.maxDcVoltage);
    const mpptRangeOk = stringResults.every(s => {
      const vmp = s.vocCorrected * 0.85;
      return vmp >= inv.mpptVoltageMin && vmp <= inv.mpptVoltageMax;
    });

    // AC Wire Auto-Sizing per inverter
    const acWireResult = autoSizeACWire({
      inverterMaxACOutputCurrent: inv.acOutputCurrentMax,
      inverterACOutputKw: inv.acOutputKw,
      systemVoltage: input.systemVoltage,
      ambientTempC: input.designTempMax,
      rooftopTempAdderC: 0,
      onewayLengthFt: input.wireLength,
      currentCarryingConductors: 3,
      conduitType: input.conduitType,
      maxVoltageDropPct: 2.0,
      startingGauge: acStartGauge,
      mode,
    });

    if (acWireResult.wasAutoSized && mode === 'AUTO') {
      autoResolutions.push({
        field: `inverter-${invIdx + 1}.acWireGauge`,
        type: 'AC_WIRE_BUMPED',
        originalValue: input.wireGauge,
        resolvedValue: acWireResult.selectedGauge,
        necReference: 'NEC 690.8 / 310.15',
        reason: `AC wire auto-sized: ${input.wireGauge} → ${acWireResult.selectedGauge}. ${acWireResult.conductorCallout}`,
      });
      invIssues.push({
        code: 'I-AC-WIRE-AUTOSIZED',
        severity: 'info',
        message: `Inverter ${invIdx + 1}: AC wire auto-sized ${input.wireGauge} → ${acWireResult.selectedGauge}. ${acWireResult.conductorCallout}`,
        necReference: 'NEC 690.8 / 310.15',
        autoResolved: true,
        resolvedValue: acWireResult.selectedGauge,
      });
    }

    if (!acWireResult.overallPass) {
      invIssues.push({
        code: 'E-AC-WIRE-FAIL',
        severity: 'error',
        message: `Inverter ${invIdx + 1}: AC wire ${acWireResult.selectedGauge} — ampacity ${acWireResult.effectiveAmpacity.toFixed(1)}A, VDrop ${acWireResult.voltageDrop.toFixed(2)}%`,
        necReference: 'NEC 690.8 / 310.15',
        suggestion: 'Manual engineering review required',
      });
    }

    invIssues.forEach(i => {
      if (i.severity === 'error') allErrors.push(i);
      else if (i.severity === 'warning') allWarnings.push(i);
      else allInfos.push(i);
    });

    inverterResults.push({
      inverterId: invIdx + 1,
      type: inv.type,
      acOutputKw: inv.acOutputKw,
      acOutputCurrentMax: inv.acOutputCurrentMax,
      strings: stringResults,
      dcVoltageOk,
      mpptRangeOk,
      acWireResult,
      issues: invIssues,
    });
  });

  // ─── Interconnection Method Engine (NEC 705.11 / 705.12) ─────────────────────
  // Supports: LOAD_SIDE, SUPPLY_SIDE_TAP, MAIN_BREAKER_DERATE, PANEL_UPGRADE
  const isMicroSystem = input.inverters.every(inv => inv.type === 'micro');
  const solarBreakerRequired = isMicroSystem
    ? nextStandardOCPD(totalAcOutputAmps * 1.25)
    : nextStandardOCPD((totalAcOutputAmps / Math.max(input.inverters.length, 1)) * 1.25);

  // Battery NEC 705.12(B) bus impact — AC-coupled battery backfeed breakers add to bus loading
  // NEC 705.12(B): ALL backfeed breakers (solar + battery) count toward 120% rule
  const batteryBackfeedA = input.batteryBackfeedA ?? 0;
  const totalBackfeedWithBattery = solarBreakerRequired + batteryBackfeedA;

  // Resolve interconnection config — default to LOAD_SIDE with mainPanelAmps as bus
  const icMethod: InterconnectionMethod = input.interconnection?.method ?? 'LOAD_SIDE';
  const icBusRating   = input.interconnection?.busRating   ?? input.mainPanelAmps;
  const icMainBreaker = input.interconnection?.mainBreaker ?? input.mainPanelAmps;
  // Use combined solar + battery backfeed for 120% rule check (NEC 705.12(B))
  const icSolarBreaker = input.interconnection?.solarBreaker ?? totalBackfeedWithBattery;

  // Helper: nearest standard breaker at or below a value
  const prevStandardOCPD = (amps: number): number => {
    const standards = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400];
    for (let i = standards.length - 1; i >= 0; i--) {
      if (standards[i] <= amps) return standards[i];
    }
    return 15;
  };

  const interconnectionIssues: CalcIssue[] = [];
  let interconnectionPasses = false;
  let interconnectionMessage = '';
  let interconnectionNecRef = '';
  let interconnectionLabel = '';
  let maxAllowedSolarBreaker = 0;
  let maxMainBreakerAllowed: number | undefined;
  let recommendedMainBreaker: number | undefined;

  if (icMethod === 'LOAD_SIDE') {
    // NEC 705.12(B)(2)(3)(b): maxSolarBreaker = (busRating × 1.2) − mainBreaker
    interconnectionLabel = 'Load-Side Breaker (120% Rule)';
    interconnectionNecRef = 'NEC 705.12(B)(2)';
    maxAllowedSolarBreaker = (icBusRating * 1.2) - icMainBreaker;
    interconnectionPasses = icSolarBreaker <= maxAllowedSolarBreaker;

    if (interconnectionPasses) {
      interconnectionMessage = `120% Rule: PASS — Solar breaker (${icSolarBreaker}A) ≤ max allowed (${maxAllowedSolarBreaker}A) on ${icBusRating}A bus`;
      allInfos.push({
        code: 'I-BUSBAR-OK',
        severity: 'info',
        message: interconnectionMessage,
        necReference: interconnectionNecRef,
      });
    } else {
      interconnectionMessage = `120% Busbar Rule Violation. Required backfeed (${icSolarBreaker}A) exceeds maximum allowed (${maxAllowedSolarBreaker}A) on ${icBusRating}A bus with ${icMainBreaker}A main breaker.`;
      interconnectionIssues.push({
        code: 'E-BUSBAR-120',
        severity: 'error',
        message: interconnectionMessage,
        value: icSolarBreaker,
        limit: maxAllowedSolarBreaker,
        necReference: interconnectionNecRef,
        suggestion: `Use Supply-Side Tap (NEC 705.11), derate main to ${prevStandardOCPD((icBusRating * 1.2) - icSolarBreaker)}A, or upgrade bus to ${Math.ceil(icSolarBreaker / 0.2 + icMainBreaker / 1)}A`,
      });
      allErrors.push(interconnectionIssues[0]);
    }

  } else if (icMethod === 'SUPPLY_SIDE_TAP') {
    // NEC 705.11: Line-side tap — 120% rule NOT applicable
    interconnectionLabel = 'Supply-Side Tap (Line-Side Connection)';
    interconnectionNecRef = 'NEC 705.11';
    maxAllowedSolarBreaker = 9999; // No busbar limit applies
    interconnectionPasses = true;
    interconnectionMessage = `Supply-side interconnection selected. 120% busbar rule not applicable (NEC 705.11). Requires: service conductor ampacity ≥ ${totalAcOutputAmps.toFixed(1)}A, tap conductors per NEC 240.21(B), service disconnect, and NEC 705 labeling.`;
    allInfos.push({
      code: 'I-SUPPLY-SIDE',
      severity: 'info',
      message: interconnectionMessage,
      necReference: interconnectionNecRef,
    });

  } else if (icMethod === 'MAIN_BREAKER_DERATE') {
    // NEC 705.12(B)(2)(3)(b): maxMainBreaker = (busRating × 1.2) − solarBreaker
    interconnectionLabel = 'Main Breaker Derate';
    interconnectionNecRef = 'NEC 705.12(B)(2)';
    maxAllowedSolarBreaker = icSolarBreaker; // Solar breaker stays fixed
    maxMainBreakerAllowed = (icBusRating * 1.2) - icSolarBreaker;
    recommendedMainBreaker = prevStandardOCPD(maxMainBreakerAllowed);
    interconnectionPasses = icMainBreaker <= maxMainBreakerAllowed;

    if (interconnectionPasses) {
      interconnectionMessage = `Main breaker derate: PASS — ${icMainBreaker}A main ≤ max allowed ${maxMainBreakerAllowed}A on ${icBusRating}A bus with ${icSolarBreaker}A solar breaker.`;
      allInfos.push({
        code: 'I-DERATE-OK',
        severity: 'info',
        message: interconnectionMessage,
        necReference: interconnectionNecRef,
      });
    } else {
      interconnectionMessage = `Replace ${icMainBreaker}A main breaker with ${recommendedMainBreaker}A to allow ${icSolarBreaker}A solar breaker on ${icBusRating}A bus.`;
      interconnectionIssues.push({
        code: 'W-DERATE-REQUIRED',
        severity: 'warning',
        message: interconnectionMessage,
        value: icMainBreaker,
        limit: maxMainBreakerAllowed,
        necReference: interconnectionNecRef,
        suggestion: `Install ${recommendedMainBreaker}A main breaker (max allowed: ${maxMainBreakerAllowed}A)`,
      });
      allWarnings.push(interconnectionIssues[0]);
      interconnectionPasses = true; // Method is valid — just needs action
    }

  } else if (icMethod === 'PANEL_UPGRADE') {
    // NEC 705.12(B): upgraded bus rating — recalculate 120% rule with new bus
    interconnectionLabel = 'Panel Upgrade';
    interconnectionNecRef = 'NEC 705.12(B)(2)';
    maxAllowedSolarBreaker = (icBusRating * 1.2) - icMainBreaker;
    interconnectionPasses = icSolarBreaker <= maxAllowedSolarBreaker;

    if (interconnectionPasses) {
      interconnectionMessage = `Panel upgrade to ${icBusRating}A bus allows ${icSolarBreaker}A solar breaker (max: ${maxAllowedSolarBreaker}A).`;
      allInfos.push({
        code: 'I-UPGRADE-OK',
        severity: 'info',
        message: interconnectionMessage,
        necReference: interconnectionNecRef,
      });
    } else {
      interconnectionMessage = `Even with ${icBusRating}A bus upgrade, solar breaker (${icSolarBreaker}A) exceeds max allowed (${maxAllowedSolarBreaker}A). Increase bus rating further.`;
      interconnectionIssues.push({
        code: 'E-UPGRADE-INSUFFICIENT',
        severity: 'error',
        message: interconnectionMessage,
        value: icSolarBreaker,
        limit: maxAllowedSolarBreaker,
        necReference: interconnectionNecRef,
        suggestion: `Upgrade bus to at least ${Math.ceil((icSolarBreaker + icMainBreaker) / 1.2 / 25) * 25}A`,
      });
      allErrors.push(interconnectionIssues[0]);
    }
  }

  // Build alternatives list (shown when LOAD_SIDE fails)
  const interconnectionAlternatives: InterconnectionAlternative[] = [];
  if (icMethod === 'LOAD_SIDE' && !interconnectionPasses) {
    const derateMax = (icBusRating * 1.2) - icSolarBreaker;
    const derateBreaker = prevStandardOCPD(derateMax);
    interconnectionAlternatives.push({
      method: 'SUPPLY_SIDE_TAP',
      label: 'Supply-Side Tap (NEC 705.11)',
      description: 'Connect before main breaker — no busbar limit applies',
      passes: true,
    });
    interconnectionAlternatives.push({
      method: 'MAIN_BREAKER_DERATE',
      label: `Main Breaker Derate to ${derateBreaker}A`,
      description: `Replace ${icMainBreaker}A main with ${derateBreaker}A to satisfy 120% rule`,
      passes: derateBreaker >= 100, // Practical minimum
    });
    const neededBus = Math.ceil((icSolarBreaker + icMainBreaker) / 1.2 / 25) * 25;
    interconnectionAlternatives.push({
      method: 'PANEL_UPGRADE',
      label: `Panel Upgrade to ${neededBus}A Bus`,
      description: `Upgrade bus to ${neededBus}A to allow ${icSolarBreaker}A solar breaker`,
      passes: true,
    });
  }

  const interconnectionResult: InterconnectionResult = {
    method: icMethod,
    methodLabel: interconnectionLabel,
    busRating: icBusRating,
    mainBreaker: icMainBreaker,
    solarBreakerRequired: icSolarBreaker,
    maxAllowedSolarBreaker,
    passes: interconnectionPasses,
    necReference: interconnectionNecRef,
    message: interconnectionMessage,
    maxMainBreakerAllowed,
    recommendedMainBreaker,
    alternatives: interconnectionAlternatives.length > 0 ? interconnectionAlternatives : undefined,
    issues: interconnectionIssues,
  };

  // Legacy busbar result (for backward compatibility)
  const busbarResult: BusbarCalcResult = {
    mainPanelAmps: icBusRating,
    totalAcOutputAmps,
    backfeedBreakerRequired: icSolarBreaker,
    busbarRule: icMethod === 'SUPPLY_SIDE_TAP' ? 'supply-side' : '120%',
    maxAllowedBackfeed: maxAllowedSolarBreaker === 9999 ? icBusRating * 0.2 : maxAllowedSolarBreaker,
    passes: interconnectionPasses,
    issues: interconnectionIssues,
  };

  // ── AC Conduit Fill ───────────────────────────────────────────────────────
  const primaryACWire = inverterResults[0]?.acWireResult;
  const acGaugeForConduit = primaryACWire?.selectedGauge ?? acStartGauge;
  const acWireArea = getConductorArea(acGaugeForConduit);
  const acWireCount = 3; // current-carrying conductors (L1, L2, N or L1, L2 + neutral)
  // FIX NEC Ch.9 Note 1: EGC must be counted in conduit fill calculation
  const egcGaugeForFill = getEGCSize(maxOcpd || 60);
  const egcAreaForFill = getConductorArea(egcGaugeForFill);
  const totalFillArea = (acWireArea * acWireCount) + egcAreaForFill; // EGC included per NEC Ch.9 Note 1
  const suitableConduit = getSmallestConduit(input.conduitType, totalFillArea);
  // FIX: fill% denominator must be maxFillArea_3plus (40% limit area), NOT total conduit area
  // Fill% = actual conductor area / total conduit area (for display)
  // Pass = conductor area <= 40% of total conduit area (NEC Ch.9 Table 1)
  const conduitFillPercent = suitableConduit ? (totalFillArea / suitableConduit.area) * 100 : 100;
  const conduitFillPasses = conduitFillPercent <= 40; // NEC Ch.9 Table 1: max 40% for 3+ conductors
  const conduitIssues: CalcIssue[] = [];

  if (!conduitFillPasses) {
    conduitIssues.push({
      code: 'E-CONDUIT-FILL',
      severity: 'error',
      message: `Conduit fill (${conduitFillPercent.toFixed(1)}%) exceeds 40% max for 3+ conductors`,
      value: conduitFillPercent.toFixed(1),
      limit: '40%',
      necReference: 'NEC Chapter 9, Table 1',
      suggestion: 'Upgrade to larger conduit size',
    });
    allErrors.push(conduitIssues[0]);
  }

  const conduitFillResult: ConduitFillResult = {
    conduitType: input.conduitType,
    conduitSize: suitableConduit?.tradeSize ?? 'N/A',
    wireCount: acWireCount + 1, // +1 for EGC per NEC Ch.9 Note 1
    totalFillArea,
    maxAllowedArea: suitableConduit?.maxFillArea_3plus ?? 0,
    fillPercent: conduitFillPercent,
    passes: conduitFillPasses,
    issues: conduitIssues,
  };

  // ── AC Wire summary ───────────────────────────────────────────────────────
  const acWireSummary = inverterResults[0]?.acWireResult;
  const acAmpacityDerated = acWireSummary?.effectiveAmpacity ?? 0;
  const acVdrop = acWireSummary?.voltageDrop ?? 0;
  const acWireGauge = acWireSummary?.selectedGauge ?? acStartGauge;
  const acConductorCallout = acWireSummary?.conductorCallout ?? '';

  if (acVdrop > 2 && !acWireSummary?.wasAutoSized) {
    allWarnings.push({
      code: 'W-AC-VDROP',
      severity: 'warning',
      message: `AC voltage drop (${acVdrop.toFixed(2)}%) exceeds 2% recommendation`,
      value: acVdrop.toFixed(2),
      limit: '2%',
      necReference: 'NEC 210.19 / NABCEP best practice',
      suggestion: 'Increase AC wire gauge or reduce run length',
    });
  }

  // ── Rapid Shutdown ────────────────────────────────────────────────────────
  if (!input.rapidShutdown && ['2017', '2020', '2023'].includes(input.necVersion)) {
    allErrors.push({
      code: 'E-RAPID-SHUTDOWN',
      severity: 'error',
      message: 'Rapid Shutdown required for rooftop PV under NEC 2017+',
      necReference: 'NEC 690.12',
      suggestion: 'Install module-level rapid shutdown (Enphase IQ8, SolarEdge optimizers)',
    });
  }

  if (!input.acDisconnect) {
    allErrors.push({
      code: 'E-AC-DISCONNECT',
      severity: 'error',
      message: 'AC disconnect required at utility interconnection',
      necReference: 'NEC 690.14',
      suggestion: 'Install utility-accessible AC disconnect switch',
    });
  }
  // FIX NEC 690.15: DC disconnect NOT required for microinverter systems
  // Microinverters have no accessible DC circuit > 30V (module-level conversion)
  if (!input.dcDisconnect && !isMicroSystem) {
    allErrors.push({
      code: 'E-DC-DISCONNECT',
      severity: 'error',
      message: 'DC disconnect required for each string/central inverter',
      necReference: 'NEC 690.15',
      suggestion: 'Install DC disconnect switch at each inverter',
    });
  } else if (!input.dcDisconnect && isMicroSystem) {
    // Microinverter systems: DC disconnect not required per NEC 690.15
    // Module-level power electronics eliminate accessible DC conductors
    allInfos.push({
      code: 'I-DC-DISCONNECT-MICRO',
      severity: 'info',
      message: 'DC disconnect not required for microinverter system (NEC 690.15 — no accessible DC circuit)',
      necReference: 'NEC 690.15',
    });
  }

  // ── DC/AC Ratio ───────────────────────────────────────────────────────────
  const dcAcRatio = totalAcKw > 0 ? totalDcKw / totalAcKw : 0;
  if (dcAcRatio > 1.5) {
    allWarnings.push({
      code: 'W-DCAC-RATIO',
      severity: 'warning',
      message: `DC/AC ratio (${dcAcRatio.toFixed(2)}) is high — inverter may clip production`,
      value: dcAcRatio.toFixed(2),
      limit: '1.5',
      suggestion: 'Add inverter or reduce panel count to stay below 1.5 DC/AC ratio',
    });
  }

  const groundingConductor = getEGCSize(maxOcpd);

  if (allErrors.length === 0 && allWarnings.length === 0) {
    recommendations.push('System design meets all NEC requirements. Ready for permit submission.');
  }
  if (dcAcRatio < 1.1) {
    recommendations.push('Consider increasing DC array size (target DC/AC ratio 1.1–1.3 for optimal production).');
  }
  if (autoResolutions.length > 0) {
    recommendations.push(`${autoResolutions.length} auto-resolution(s) applied in AUTO mode. Review correction log before permit submission.`);
  }

  let status: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
  if (allErrors.length > 0) status = 'FAIL';
  else if (allWarnings.length > 0) status = 'WARNING';

  // ── AC Disconnect & Conductor Sizing Engine (NEC 705.60 / 240.6 / 310.16) ──

  // NEC Chapter 9 Table 5 — Actual conductor areas (sq in) for THWN-2
  // These are the exact NEC Table 5 values, NOT calculated from outer diameter
  const NEC_TABLE5_WIRE_AREA: Record<string, number> = {
    '#14 AWG': 0.0097,
    '#12 AWG': 0.0133,
    '#10 AWG': 0.0211,
    '#8 AWG':  0.0437,
    '#6 AWG':  0.0507,
    '#4 AWG':  0.0824,
    '#3 AWG':  0.1041,
    '#2 AWG':  0.1333,
    '#1 AWG':  0.1590,
    '#1/0 AWG': 0.1901,
    '#2/0 AWG': 0.2223,
  };

  // Step 1: Inverter Output Current
  const acSizingCurrentAmps = (totalAcKw * 1000) / input.systemVoltage;

  // Step 2: Continuous Load Rule (NEC 705.60 — PV output is continuous)
  const acSizingContinuousAmps = acSizingCurrentAmps * 1.25;

  // Step 3: OCPD — next standard breaker size ≥ continuous current (NEC 240.6)
  const acSizingOcpdAmps = nextStandardOCPD(acSizingContinuousAmps);

  // Step 4: Disconnect — must be rated ≥ OCPD (NEC 690.14)
  const acSizingDisconnectAmps = acSizingOcpdAmps;

  // Step 5: Conductor — NEC 310.16 75°C column, ampacity ≥ continuous current
  // FIX NEC 310.16: conductor ampacity must be >= OCPD rating (not just >= continuous current)
  // Using acSizingOcpdAmps ensures conductor can handle the full OCPD trip current
  const acSizingConductor = getConductorByMinAmpacity(acSizingOcpdAmps, '75c');
  const acSizingConductorGauge = acSizingConductor?.gauge ?? acWireGauge;
  const acSizingConductorAmpacity = acSizingConductor?.ampacity_75c ?? 0;

  // Step 5: Disconnect Type Logic
  // Standard residential solar: non-fused disconnect + OCPD breaker at panel
  // Fused disconnect: used when no separate OCPD breaker (e.g. supply-side tap)
  // Default: non-fused (most common for load-side interconnection)
  // Default: non-fused (most common for load-side interconnection)
  // To use fused disconnect, change this value — validation will enforce consistency
  const acSizingDisconnectType = ('non-fused' as DisconnectType);

  // Step 6: Fuse — only applies if disconnectType === 'fused'
  // NEC 690.9: fuse in fused disconnect sized at 2/3 of disconnect rating
  const STANDARD_FUSE_SIZES = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
  const acSizingFuseAmps: number | null = acSizingDisconnectType === 'fused'
    ? ([...STANDARD_FUSE_SIZES].reverse().find(f => f <= acSizingDisconnectAmps * (2 / 3)) ?? 40)
    : null;
  const acSizingFuseCount = acSizingDisconnectType === 'fused' ? 2 : 0;

  // Step 7: Conduit Fill — NEC Chapter 9 Table 5 areas
  // 240V single-phase: 3 current-carrying conductors (L1, L2, N) + 1 EGC = 4 total
  // NEC Ch.9 Note 1: EGC must be included in conduit fill calculation
  const acSizingWireArea = NEC_TABLE5_WIRE_AREA[acSizingConductorGauge] ?? getConductorArea(acSizingConductorGauge);
  const acSizingEgcGauge = getEGCSize(acSizingOcpdAmps);
  const acSizingEgcArea = NEC_TABLE5_WIRE_AREA[acSizingEgcGauge] ?? getConductorArea(acSizingEgcGauge);
  const acSizingConductorCount = 3; // current-carrying: L1, L2, N (or L1, L2 for 2-wire)
  const acSizingTotalFillArea = (acSizingWireArea * acSizingConductorCount) + acSizingEgcArea; // EGC per NEC Ch.9 Note 1
  const acSizingConduit = getSmallestConduit(input.conduitType, acSizingTotalFillArea);
  const acSizingConduitSize = acSizingConduit?.tradeSize ?? conduitFillResult.conduitSize;
  const acSizingConduitFillPct = acSizingConduit
    ? (acSizingTotalFillArea / acSizingConduit.area) * 100
    : conduitFillResult.fillPercent;

  // Grounding conductor (NEC 250.66 — based on AC OCPD)
  const acSizingGrounding = getEGCSize(acSizingOcpdAmps);

  // Build canonical engineeringModel — single source of truth
  const engineeringModelData: EngineeringModel = {
    ocpd: acSizingOcpdAmps,
    disconnectRating: acSizingDisconnectAmps,
    disconnectType: acSizingDisconnectType,
    fuseSize: acSizingFuseAmps,
    fuseCount: acSizingFuseCount,
    conductor: `${acSizingConductorGauge} THWN-2`,
    conductorAmpacity: acSizingConductorAmpacity,
    conduit: `${acSizingConduitSize}" ${input.conduitType}`,
    conduitFillPct: Math.round(acSizingConduitFillPct * 10) / 10,
    grounding: acSizingGrounding,
    systemVoltage: input.systemVoltage,
    isValid: true,
    validationErrors: [],
  };

  // Validate the model — catch any impossible configurations
  try {
    validateEngineeringModel(engineeringModelData);
  } catch (e: any) {
    engineeringModelData.isValid = false;
    engineeringModelData.validationErrors = [e.message];
    allErrors.push({
      code: 'E-ENGINEERING-MODEL-INVALID',
      severity: 'error',
      message: e.message,
      necReference: 'NEC 690.9 / 690.14',
    });
  }

  const acSizingResult: ACSizingResult = {
    // Step 1
    acCurrentAmps: Math.round(acSizingCurrentAmps * 100) / 100,
    // Step 2
    continuousCurrentAmps: Math.round(acSizingContinuousAmps * 100) / 100,
    // Step 3
    ocpdAmps: acSizingOcpdAmps,
    ocpdLabel: `${acSizingOcpdAmps}A Circuit Breaker`,
    // Step 4
    disconnectAmps: acSizingDisconnectAmps,
    disconnectType: acSizingDisconnectType,
    disconnectLabel: `${acSizingDisconnectAmps}A ${acSizingDisconnectType === 'non-fused' ? 'Non-Fused' : 'Fused'} AC Disconnect`,
    // Step 5 (fuse — null if non-fused)
    fuseAmps: acSizingFuseAmps,
    fuseCount: acSizingFuseCount,
    fuseLabel: acSizingDisconnectType === 'non-fused'
      ? 'None (Non-Fused Disconnect)'
      : `${acSizingFuseAmps}A Fuse × ${acSizingFuseCount}`,
    // Step 6 (conductor)
    conductorGauge: acSizingConductorGauge,
    conductorType: 'THWN-2 Copper',
    conductorAmpacity: acSizingConductorAmpacity,
    conductorLabel: `${acSizingConductorGauge} THWN-2 Copper (${acSizingConductorAmpacity}A)`,
    // Step 7 (conduit)
    conduitSize: acSizingConduitSize,
    conduitType: input.conduitType,
    conduitFillPct: Math.round(acSizingConduitFillPct * 10) / 10,
    conduitLabel: `${acSizingConduitSize}" ${input.conduitType} (${(Math.round(acSizingConduitFillPct * 10) / 10).toFixed(1)}% fill)`,
    // Grounding
    groundingConductor: acSizingGrounding,
    // Canonical engineeringModel
    engineeringModel: engineeringModelData,
    // NEC references
    necRefs: [
      'NEC 705.60 — Continuous Load (125%)',
      'NEC 240.6 — Standard OCPD Sizes',
      'NEC 690.14 — AC Disconnect',
      acSizingDisconnectType === 'fused' ? 'NEC 690.9 — Fuse Sizing' : 'NEC 690.14 — Non-Fused Disconnect',
      'NEC 310.16 — Conductor Ampacity (75°C)',
      'NEC Chapter 9 — Conduit Fill',
      'NEC 250.66 — Grounding Conductor',
    ],
  };

  return {
    status,
    necVersion: input.necVersion,
    engineeringMode: mode,
    errors: allErrors,
    warnings: allWarnings,
    infos: allInfos,
    recommendations,
    inverters: inverterResults,
    busbar: busbarResult,
    conduitFill: conduitFillResult,
    groundingConductor,
    acWireGauge,
    acWireAmpacity: acAmpacityDerated,
    acVoltageDrop: acVdrop,
    acConductorCallout,
    rapidShutdownCompliant: input.rapidShutdown,
    autoResolutions,
    interconnection: interconnectionResult,
    acSizing: acSizingResult,
    summary: {
      totalDcKw,
      totalAcKw,
      dcAcRatio,
      totalPanels,
      systemVoltage: input.systemVoltage,
    },
  };
}