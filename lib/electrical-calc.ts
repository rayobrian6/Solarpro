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
import { DC_AC_TARGET, DC_AC_CLIPPING_BANDS, getDcAcClippingSeverity } from './system/dcAcConstants';
import { calcDcAcRatio } from './system/calcDcAcRatio';
import type { SubSystemKey } from './system/subSystemEquipment';
import { nextStandardOcpd, nextEnclosure, prevStandardOcpd } from './electrical/stdSizes';

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
  /**
   * v47.417 — Factory-integrated DC disconnect switch.
   * When every non-micro inverter in the system has `integratedDcDisconnect: true`,
   * lib/electrical-calc.ts suppresses E-DC-DISCONNECT because NEC 690.15 is
   * already satisfied by the factory switch. Battery DC disconnects (NEC 706)
   * are handled separately and are still required. Mirrors the
   * StringInverter.integratedDcDisconnect field on the equipment-db side.
   */
  integratedDcDisconnect?: boolean;
  /**
   * Wave 2b (per-subsystem equipment contract §1.7 / permit carriage) —
   * which sub-system this physical inverter belongs to. ABSENT on legacy
   * inputs: an untagged inverter gets today's roof-equivalent legacy
   * treatment (rooftop adder from input.rooftopTempAdder, RSD asserted) —
   * callers own §1.5 tag inheritance (config.systemType), not this engine.
   * All deliberate NEC scoping changes gate strictly on >1 DISTINCT keys
   * being present (Invariant I-10) — never on tag presence alone.
   */
  subSystemKey?: SubSystemKey;
  /**
   * Wave 2b — per-inverter environment overrides (contract §1.2 env block).
   * When set, these take precedence over the input-level scalars for THIS
   * inverter only. Legacy callers never set them → zero behavior change.
   */
  env?: {
    rooftopTempAdderC?: number; // overrides the roof/non-roof adder rule
    conduitType?: string;       // overrides input.conduitType for the AC run
    wireLengthFt?: number;      // overrides input.wireLength for the AC run
  };
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
  // Multi-inverter support
  inverterCount: number;           // number of inverters in system (for disconnect sizing)
  totalAcKw: number;               // total combined AC output kW
  /**
   * Wave 2b HONESTY FIX (contract §3 2b): before Wave 2b these two scalars
   * were FABRICATED as totalAcKw / inverterCount (a fleet average that
   * matches no physical inverter in a heterogeneous system). They are now
   * honest mirrors of `perInverter[]`: the LARGEST entry's values (conservative
   * for the separate-disconnect approach; identical to the old average for
   * N=1 and for homogeneous fleets — the Wave-0 golden numbers are unchanged).
   * Heterogeneous consumers must read `perInverter[]`, not these scalars.
   */
  perInverterAcKw: number;         // per-inverter AC output kW (for separate disconnect sizing)
  perInverterDisconnectAmps: number; // per-inverter disconnect rating (for separate approach)
  /** Wave 2b — honest per-physical-inverter AC sizing (one entry per InverterInput). */
  perInverter?: PerInverterAcSizing[];
  // Validation
  isValid: boolean;
  validationErrors: string[];
}

// ─── Wave 2b — per-subsystem AC sizing (contract §1.7 downstream) ─────────────

/**
 * Pure Step 1–3 AC math for ONE AC circuit (inverter output / branch /
 * aggregate POI view). This is THE single source for output-amps →
 * continuous (×1.25, NEC 705.60) → OCPD rounding (NEC 240.6) everywhere in
 * this engine — per inverter, per sub-system, and at the POI aggregate.
 */
export interface AcBranchSizing {
  acKw: number;
  acOutputAmps: number;   // Step 1 — acKw × 1000 / systemVoltage
  continuousAmps: number; // Step 2 — × 1.25 (NEC 705.60)
  ocpdAmps: number;       // Step 3 — nextStandardOCPD(continuousAmps) (NEC 240.6)
}

export function sizeAcBranch(acKw: number, systemVoltage: number): AcBranchSizing {
  const acOutputAmps = (acKw * 1000) / systemVoltage;
  const continuousAmps = acOutputAmps * 1.25;
  return { acKw, acOutputAmps, continuousAmps, ocpdAmps: nextStandardOCPD(continuousAmps) };
}

/**
 * Entry-level AC kW for one InverterInput: micro entries carry per-DEVICE
 * acOutputKw and represent a fleet of deviceCount devices behind one AC
 * circuit; string/optimizer entries are already the full inverter output.
 */
export function inverterEntryAcKw(inv: InverterInput): number {
  return inv.type === 'micro' ? inv.acOutputKw * (inv.deviceCount || 1) : inv.acOutputKw;
}

/** One entry per physical InverterInput — the honest per-inverter AC record. */
export interface PerInverterAcSizing {
  inverterIndex: number;                       // index into input.inverters / result.inverters
  type: 'string' | 'micro' | 'optimizer';
  subSystemKey: SubSystemKey;                  // EFFECTIVE key (untagged legacy → 'roof', see InverterInput.subSystemKey)
  acKw: number;                                // entry AC kW (micro: per-device × deviceCount)
  acOutputAmps: number;
  continuousAmps: number;
  /** This entry's physical backfeed breaker — nextStandardOCPD(continuousAmps).
   *  705.12(B) total backfeed = Σ of THESE (round per inverter FIRST, then sum). */
  ocpdAmps: number;
  disconnectAmps: number;                      // per-inverter disconnect basis (= ocpdAmps)
  deviceCount?: number;                        // micro fleets only
}

/**
 * Wave 2b — `result.subSystems[]` entry (consumed by 2d conductorAuthority
 * and Waves 3/5). One per DISTINCT effective SubSystemKey, in fixed
 * roof > ground > fence order. The legacy aggregate result shape is
 * unchanged; these summaries sit alongside it.
 */
export interface SubSystemElectricalSummary {
  key: SubSystemKey;
  topology: 'string' | 'micro' | 'optimizer' | 'mixed';
  inverterIndexes: number[];      // indexes into input.inverters / result.inverters
  inverterCount: number;          // InverterInput entries in this sub
  deviceCount: number;            // physical devices (micro fleets expanded; string/optimizer = 1 each)
  panelCount: number;
  stringCount: number;
  dcKw: number;
  acKw: number;
  acOutputAmps: number;           // Σ entry output amps
  continuousAmps: number;         // × 1.25 (NEC 705.60)
  /** Sub's 705.12(B) backfeed contribution = Σ per-inverter-rounded OCPDs.
   *  NOT re-rounded at the sub level — feeds the single POI 120% check. */
  ocpdAmps: number;
  acWireGauge: string;            // governing gauge among the sub's inverter AC runs
  acConductorCallout: string;
  /** NEC 690.12 scopes to buildings → true iff key === 'roof'. */
  rsdRequired: boolean;
  /** Adder applied to this sub's DC conductors (roof: input adder; ground/fence at N>1: 0). */
  rooftopTempAdderC: number;
  branch?: { deviceCount: number; modulesPerDevice: number }; // micro branch info
  perInverter: PerInverterAcSizing[];
}

/** Fixed contract ordering (§1.4) for subSystems[] output. */
const SUB_SYSTEM_ORDER: readonly SubSystemKey[] = ['roof', 'ground', 'fence'] as const;

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
  // Step 4 — Disconnect (NEC 690.13)
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
  /**
   * Wave 2b — per-sub electrical summaries (one per distinct effective
   * SubSystemKey, fixed roof > ground > fence order). Always present; a
   * legacy untagged single-system input yields exactly one 'roof' entry.
   */
  subSystems: SubSystemElectricalSummary[];
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

  // ── Wave 2b — sub-system partition (contract §1.7, Invariant I-10) ────────
  // Effective key per entry: untagged legacy inputs get today's roof-
  // equivalent treatment (§1.5 tag inheritance is the CALLER's job — 2d's
  // generatePermit fallback tags InverterInputs from config.systemType).
  // NEC scoping changes below gate STRICTLY on >1 distinct keys (multiSub);
  // tag presence alone never changes a single-system project's numbers.
  const effKeys: SubSystemKey[] = input.inverters.map(inv => inv.subSystemKey ?? 'roof');
  const distinctSubKeys: SubSystemKey[] = SUB_SYSTEM_ORDER.filter(k => effKeys.includes(k));
  const multiSub = distinctSubKeys.length > 1;
  const hasRoofSub = distinctSubKeys.includes('roof');

  // Honest per-physical-inverter AC sizing (Steps 1–3 via sizeAcBranch) plus
  // per-entry DC tallies — feeds backfeed Σ, engineeringModel.perInverter,
  // and result.subSystems[].
  const entrySizings: PerInverterAcSizing[] = [];
  const entryDcTallies: Array<{ panelCount: number; dcKw: number; stringCount: number }> = [];

  // ── Per-inverter calculations ─────────────────────────────────────────────
  input.inverters.forEach((inv, invIdx) => {
    const invIssues: CalcIssue[] = [];
    const stringResults: StringCalcResult[] = [];
    const invKey = effKeys[invIdx];
    // Per-inverter rooftop temperature adder (NEC 310.15(B)(2)(c) scoping):
    // explicit env override wins; at N>1 subs the adder applies to ROOF-tagged
    // conductors only (ground/fence conductors never carry roof derates,
    // Invariant I-7); single-sub/legacy keeps input.rooftopTempAdder as-is.
    const invRooftopAdder = inv.env?.rooftopTempAdderC
      ?? (multiSub ? (invKey === 'roof' ? input.rooftopTempAdder : 0) : input.rooftopTempAdder);
    let entryPanels = 0;
    let entryDcKw = 0;

    // Topology-aware AC capacity accumulation (single-source helper)
    // MICRO: acOutputKw is per-device; multiply by deviceCount for total AC
    // STRING: acOutputKw is already the full inverter AC output
    const invAcKw = inverterEntryAcKw(inv);
    totalAcKw += invAcKw;
    totalAcOutputAmps += (invAcKw * 1000) / input.systemVoltage;

    // ─── Topology-aware DC size calculation ────────────────────────────
    if (inv.type === 'micro') {
      // MICRO: DC size derived from deviceCount and modulesPerDevice
      const moduleCount = (inv.deviceCount || 0) * (inv.modulesPerDevice || 1);
      const moduleWattage = inv.strings[0]?.panelWatts || 400; // Use panel wattage from config or default
      totalDcKw += (moduleCount * moduleWattage) / 1000;
      totalPanels += moduleCount;
      entryPanels += moduleCount;
      entryDcKw += (moduleCount * moduleWattage) / 1000;
    } else {
      // STRING/OPTIMIZER: DC size derived from string arrays

    // ── Per-string calculations ──────────────────────────────────────────────
    inv.strings.forEach((str, strIdx) => {
      const strIssues: CalcIssue[] = [];
      totalPanels += str.panelCount;
      totalDcKw += (str.panelCount * str.panelWatts) / 1000;
      entryPanels += str.panelCount;
      entryDcKw += (str.panelCount * str.panelWatts) / 1000;
      const stringLabel = `${invIdx + 1}-${strIdx + 1}`;

      // 1. String Voc temperature correction (NEC 690.7)
      const tempDelta = input.designTempMin - 25;
      const vocCorrectionFactor = 1 + (str.tempCoeffVoc / 100) * tempDelta;
      const vocSTC = str.panelVoc * str.panelCount;
      const vocCorrected = vocSTC * vocCorrectionFactor;

      // v47.412 — Topology-aware string-voltage validation.
      // Panel-Voc × N and panel-Vmp × N are inapplicable to optimizer
      // systems: each DC-DC optimizer regulates its module's contribution
      // independently and the inverter actively holds the DC bus inside
      // its MPPT window (~380–400 V for SolarEdge HD-Wave) regardless of
      // panel count. The authoritative ceiling is the brand-spec
      // maxPanelsPerString (25 for SolarEdge), enforced downstream.
      //
      // Before v47.412 this function raised E-VOC-EXCEED / W-MPPT-HIGH on
      // every 11+-panel SolarEdge string, falsely flagging physically
      // valid layouts (e.g. 2 × 18 at 820 V panel Voc × cold-corrected) —
      // which is exactly what appeared in the compliance tab after v47.411
      // sized the system correctly.
      const isOptimizerTopo = inv.type === 'optimizer';

      if (!isOptimizerTopo && vocCorrected > inv.maxDcVoltage) {
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
      if (!isOptimizerTopo && vmpString > inv.mpptVoltageMax) {
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

      if (!isOptimizerTopo && vocCorrected < inv.mpptVoltageMin) {
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
        rooftopTempAdderC: invRooftopAdder, // Wave 2b: roof-scoped (I-7)
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
        rooftopTempAdderC: invRooftopAdder, // Wave 2b: roof-scoped (I-7)
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
      const rooftopTemp = input.designTempMax + invRooftopAdder; // Wave 2b: roof-scoped (I-7)
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
    // FIX v57.1: For micro topology, inv.acOutputCurrentMax is per-device (e.g. IQ8+ = 1.21A).
    // The AC branch wire carries the COMBINED output of ALL devices on the branch circuit.
    // Use invAcKw (already scaled by deviceCount) to derive the correct system branch current.
    // For string/optimizer, inv.acOutputCurrentMax is the full inverter output — keep as-is.
    // FIX v57.1: Guard against wireLength=0/NaN — prevents VDrop=NaN causing #2/0 AWG fallback.
    const acBranchCurrentA = inv.type === 'micro'
      ? (invAcKw * 1000) / (input.systemVoltage || 240)
      : inv.acOutputCurrentMax;
    const acBranchKw = inv.type === 'micro' ? invAcKw : inv.acOutputKw;
    // Wave 2b: per-inverter env override wins over the input-level scalar.
    const acWireLenBasis = (Number.isFinite(inv.env?.wireLengthFt) && (inv.env?.wireLengthFt ?? 0) > 0)
      ? (inv.env!.wireLengthFt as number)
      : input.wireLength;
    const acWireLengthFt = (Number.isFinite(acWireLenBasis) && acWireLenBasis > 0)
      ? acWireLenBasis
      : 50; // default 50ft if missing/zero
    const acConduitType = inv.env?.conduitType ?? input.conduitType;

    const acWireResult = autoSizeACWire({
      inverterMaxACOutputCurrent: acBranchCurrentA,
      inverterACOutputKw: acBranchKw,
      systemVoltage: input.systemVoltage,
      ambientTempC: input.designTempMax,
      rooftopTempAdderC: 0,
      onewayLengthFt: acWireLengthFt,
      currentCarryingConductors: 3,
      conduitType: acConduitType,
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

    // Wave 2b — honest per-physical-inverter AC sizing (single-source helper).
    const entryAc = sizeAcBranch(invAcKw, input.systemVoltage);
    entrySizings.push({
      inverterIndex: invIdx,
      type: inv.type,
      subSystemKey: invKey,
      acKw: entryAc.acKw,
      acOutputAmps: entryAc.acOutputAmps,
      continuousAmps: entryAc.continuousAmps,
      ocpdAmps: entryAc.ocpdAmps,
      disconnectAmps: entryAc.ocpdAmps,
      ...(inv.type === 'micro' ? { deviceCount: inv.deviceCount || 1 } : {}),
    });
    entryDcTallies.push({
      panelCount: entryPanels,
      dcKw: entryDcKw,
      stringCount: inv.type === 'micro' ? 0 : inv.strings.length,
    });
  });

  // ─── Interconnection Method Engine (NEC 705.11 / 705.12) ─────────────────────
  // Supports: LOAD_SIDE, SUPPLY_SIDE_TAP, MAIN_BREAKER_DERATE, PANEL_UPGRADE
  const isMicroSystem = input.inverters.every(inv => inv.type === 'micro');
  // Wave 2b (contract §1.7 + Addendum B ruling 2) — 705.12(B) total backfeed
  // = Σ over each PHYSICAL inverter of nextStandardOCPD(inverterAmps × 1.25):
  // round PER INVERTER FIRST, then sum, so the check matches the actual
  // breaker schedule an AHJ reviews. This DELETES the old :671–674 fork,
  // which fabricated a single average-per-inverter breaker
  // (nextStandardOCPD((totalAmps / N) × 1.25)) as the whole system's
  // backfeed — an undercount for every N>1 system. N=1 is numerically
  // identical to the old path (both micro and string/optimizer branches).
  // Always recomputed — no legacy freeze flag (Ray ruling 2026-07-12).
  const solarBreakerRequired = entrySizings.reduce((sum, e) => sum + e.ocpdAmps, 0);

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

  // Helper: nearest standard breaker at or below a value — single-sourced
  // from lib/electrical/stdSizes.ts (P0-5c).
  const prevStandardOCPD = (amps: number): number => prevStandardOcpd(amps);

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
      interconnectionMessage = `120% Rule: PASS — Total backfeed (${icSolarBreaker}A) ≤ max allowed (${maxAllowedSolarBreaker}A). Formula: (${icBusRating}A bus × 120%) − ${icMainBreaker}A main = ${maxAllowedSolarBreaker}A max`;
      allInfos.push({
        code: 'I-BUSBAR-OK',
        severity: 'info',
        message: interconnectionMessage,
        necReference: interconnectionNecRef,
      });
    } else {
      interconnectionMessage = `120% Busbar Rule Violation. Total backfeed (${icSolarBreaker}A) exceeds max allowed (${maxAllowedSolarBreaker}A). Formula: (${icBusRating}A bus × 120%) − ${icMainBreaker}A main = ${maxAllowedSolarBreaker}A max. Options: supply-side connection (insulated tap or utility-approved meter-socket lug adapter, NEC 705.11), derate main breaker, or upgrade panel bus.`;
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
  // Wave 2b scoping (Invariant I-7): NEC 690.12 applies to PV systems ON
  // BUILDINGS — at N>1 subs the assertion fires only when a ROOF-tagged
  // inverter exists. Ground/fence-only hybrids are exempt (info emitted).
  // Single-sub/legacy keeps today's behavior (I-10 gate: strictly N>1).
  const rsdApplies = multiSub ? hasRoofSub : true;
  if (!input.rapidShutdown && rsdApplies && ['2017', '2020', '2023'].includes(input.necVersion)) {
    allErrors.push({
      code: 'E-RAPID-SHUTDOWN',
      severity: 'error',
      message: multiSub
        ? 'Rapid Shutdown required for the roof sub-system (rooftop PV under NEC 2017+)'
        : 'Rapid Shutdown required for rooftop PV under NEC 2017+',
      necReference: 'NEC 690.12',
      suggestion: 'Install module-level rapid shutdown (Enphase IQ8, SolarEdge optimizers)',
    });
  } else if (!input.rapidShutdown && !rsdApplies) {
    allInfos.push({
      code: 'I-RSD-NOT-REQUIRED',
      severity: 'info',
      message: `Rapid shutdown not required — no roof sub-system present (${distinctSubKeys.join(' + ')}); NEC 690.12 scopes to PV systems on buildings`,
      necReference: 'NEC 690.12',
    });
  }
  const rapidShutdownCompliant = input.rapidShutdown || !rsdApplies;

  // ── NEC 2023-specific checks ──────────────────────────────────────────────
  if (input.necVersion === '2023') {
    // 690.11 — Arc-Fault Circuit Interrupter (AFCI) for DC circuits
    // Required for all DC PV circuits in dwelling units under NEC 2023
    if (!isMicroSystem) {
      allInfos.push({
        code: 'I-AFCI-690-11',
        severity: 'info',
        message: 'NEC 2023 §690.11: DC arc-fault circuit interrupter (AFCI) protection required for all DC PV circuits in or on dwelling units',
        necReference: 'NEC 690.11',
        suggestion: 'Verify inverter or combiner has listed AFCI function (e.g., SolarEdge HD-Wave, Fronius SnapINverter with AFCI option)',
      });
    }

    // 705.13 — Power Control Systems (PCS)
    // NEC 2023 §705.13 introduces PCS as a new interconnection method that
    // dynamically limits export to prevent overloading the service conductors.
    allInfos.push({
      code: 'I-PCS-705-13',
      severity: 'info',
      message: 'NEC 2023 §705.13: Power Control System (PCS) permitted as alternative interconnection method — may eliminate 120% busbar rule if PCS is AHJ-approved',
      necReference: 'NEC 705.13',
      suggestion: 'Confirm with AHJ whether PCS interconnection method is accepted as alternative to NEC 705.12(B)(2) 120% rule',
    });

    // 690.31(B)(2) — DC circuit polarity identification
    // NEC 2023 requires distinct marking for ungrounded DC conductors
    allInfos.push({
      code: 'I-DC-POLARITY-690-31',
      severity: 'info',
      message: 'NEC 2023 §690.31(B)(2): Ungrounded DC conductors must have distinct polarity identification — positive conductors marked RED or tagged +, negative conductors marked BLACK or tagged −',
      necReference: 'NEC 690.31(B)(2)',
      suggestion: 'Ensure DC wiring uses red/black color coding or polarity labels at all accessible points per NEC 690.31(B)(2)',
    });
  }

  if (!input.acDisconnect) {
    allErrors.push({
      code: 'E-AC-DISCONNECT',
      severity: 'error',
      message: 'AC disconnect required at utility interconnection',
      necReference: 'NEC 690.13',
      suggestion: 'Install utility-accessible AC disconnect switch',
    });
  }
  // FIX NEC 690.15: DC disconnect NOT required for microinverter systems
  // Microinverters have no accessible DC circuit > 30V (module-level conversion)
  //
  // v47.417 — Also NOT required when every non-micro inverter ships with a
  // factory-integrated DC safety switch (true for all SolarEdge HD-Wave,
  // Fronius Primo UL, SMA Sunny Boy US, GoodWe NS/MS, EcoFlow PowerOcean,
  // Sol-Ark hybrid, Sungrow SG-RS). Per NEC 690.15, the factory switch
  // satisfies the DC disconnecting means requirement — a separate field-
  // installed DC disconnect at the inverter is NOT required. Battery DC
  // disconnects (NEC 706) and inter-battery disconnects remain separate.
  const allNonMicroHaveIntegratedDisconnect = input.inverters
    .filter(inv => inv.type !== 'micro')
    .every(inv => inv.integratedDcDisconnect === true);
  const hasNonMicroInverter = input.inverters.some(inv => inv.type !== 'micro');
  const integratedSwitchSatisfiesNEC690_15 = hasNonMicroInverter && allNonMicroHaveIntegratedDisconnect;

  if (!multiSub) {
    // ── Single-sub / legacy path — byte-identical to pre-Wave-2b behavior ──
    if (!input.dcDisconnect && !isMicroSystem && !integratedSwitchSatisfiesNEC690_15) {
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
    } else if (!input.dcDisconnect && integratedSwitchSatisfiesNEC690_15) {
      // v47.417 — Integrated factory switch satisfies NEC 690.15 for all
      // non-micro inverters in the system.
      allInfos.push({
        code: 'I-DC-DISCONNECT-INTEGRATED',
        severity: 'info',
        message: 'DC disconnect requirement satisfied by factory-integrated switch on each inverter (NEC 690.15)',
        necReference: 'NEC 690.15',
      });
    }
  } else if (!input.dcDisconnect) {
    // ── Wave 2b: N>1 subs — NEC 690.15 evaluated PER SUB-SYSTEM (I-7).
    // A micro roof must not exempt a string ground from its DC disconnect,
    // and a string ground must not force a phantom disconnect onto a micro
    // roof. Fixed roof > ground > fence emission order (deterministic).
    for (const key of distinctSubKeys) {
      const subInvs = input.inverters.filter((_, i) => effKeys[i] === key);
      const subAllMicro = subInvs.every(inv => inv.type === 'micro');
      const subNonMicro = subInvs.filter(inv => inv.type !== 'micro');
      if (subAllMicro) {
        allInfos.push({
          code: 'I-DC-DISCONNECT-MICRO',
          severity: 'info',
          message: `DC disconnect not required for microinverter ${key} sub-system (NEC 690.15 — no accessible DC circuit)`,
          necReference: 'NEC 690.15',
        });
      } else if (subNonMicro.every(inv => inv.integratedDcDisconnect === true)) {
        allInfos.push({
          code: 'I-DC-DISCONNECT-INTEGRATED',
          severity: 'info',
          message: `DC disconnect requirement for the ${key} sub-system satisfied by factory-integrated switch on each inverter (NEC 690.15)`,
          necReference: 'NEC 690.15',
        });
      } else {
        allErrors.push({
          code: 'E-DC-DISCONNECT',
          severity: 'error',
          message: `DC disconnect required for each string/central inverter in the ${key} sub-system`,
          necReference: 'NEC 690.15',
          suggestion: `Install DC disconnect switch at each ${key} sub-system inverter`,
        });
      }
    }
  }

  // ── DC/AC Ratio ───────────────────────────────────────────────────────────
  const dcAcRatio = calcDcAcRatio(totalDcKw, totalAcKw);
  // v61.9: Use clipping severity bands for graded warnings.
  // Recommendation priority: inverter upsizing ALWAYS before panel reduction.
  const _clippingSeverity = getDcAcClippingSeverity(dcAcRatio);
  if (_clippingSeverity === 'critical') {
    allWarnings.push({
      code: 'W-DCAC-RATIO',
      severity: 'warning',
      message: `DC/AC ratio (${dcAcRatio.toFixed(2)}) is critically high — severe production clipping expected.`,
      value: dcAcRatio.toFixed(2),
      limit: String(DC_AC_CLIPPING_BANDS.CRITICAL_THRESHOLD),
      suggestion: `Upsize inverter to increase AC capacity. ` +
        `Reducing panel count is a last resort only if no larger inverter is available.`,
    });
  } else if (_clippingSeverity === 'severe') {
    allWarnings.push({
      code: 'W-DCAC-RATIO',
      severity: 'warning',
      message: `DC/AC ratio (${dcAcRatio.toFixed(2)}) is high — significant clipping expected. ` +
        `System is electrically valid but economically suboptimal.`,
      value: dcAcRatio.toFixed(2),
      limit: String(DC_AC_CLIPPING_BANDS.SEVERE_MAX),
      suggestion: `Consider a larger inverter (e.g. next tier up) to bring DC/AC ratio to 1.20–1.50.`,
    });
  } else if (_clippingSeverity === 'warning') {
    allWarnings.push({
      code: 'W-DCAC-RATIO',
      severity: 'warning',
      message: `DC/AC ratio (${dcAcRatio.toFixed(2)}) is moderately high — some clipping expected.`,
      value: dcAcRatio.toFixed(2),
      limit: String(DC_AC_CLIPPING_BANDS.WARNING_MAX),
      suggestion: `System is electrically feasible. Consider inverter upsizing if clipping is a concern.`,
    });
  } else if (_clippingSeverity === 'mild') {
    allWarnings.push({
      code: 'W-DCAC-RATIO',
      severity: 'info',
      message: `DC/AC ratio (${dcAcRatio.toFixed(2)}) — mild oversize, normal for optimized systems.`,
      value: dcAcRatio.toFixed(2),
      limit: String(DC_AC_CLIPPING_BANDS.MILD_MAX),
      suggestion: `No action required. Mild oversize maximizes production at lower irradiance.`,
    });
  }

  const groundingConductor = getEGCSize(maxOcpd);

  if (allErrors.length === 0 && allWarnings.length === 0) {
    recommendations.push('System design meets all NEC requirements. Ready for permit submission.');
  }
  if (dcAcRatio < DC_AC_TARGET.min) {
    recommendations.push(`Consider increasing DC array size (target DC/AC ratio ${DC_AC_TARGET.min}–${DC_AC_TARGET.max} for optimal production).`);
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

  // Steps 1–3 (aggregate POI view) — same pure helper as the per-inverter
  // and per-sub paths (Wave 2b single-source AC math):
  //   Step 1: Inverter Output Current = totalAcKw × 1000 / systemVoltage
  //   Step 2: Continuous Load Rule (NEC 705.60) = × 1.25
  //   Step 3: OCPD = next standard breaker ≥ continuous (NEC 240.6)
  const acSizingAggregate = sizeAcBranch(totalAcKw, input.systemVoltage);
  const acSizingCurrentAmps = acSizingAggregate.acOutputAmps;
  const acSizingContinuousAmps = acSizingAggregate.continuousAmps;
  const acSizingOcpdAmps = acSizingAggregate.ocpdAmps;

  // Step 4: Disconnect — enclosure must be rated ≥ OCPD (NEC 690.13)
  // Placeholder: final enclosure size is computed in Step 5 after fuse sizing.
  // We pre-set to OCPD here; Step 5 will override with proper enclosure size.
  const acSizingDisconnectAmps_preliminary = acSizingOcpdAmps;

  // Step 5: Conductor — NEC 310.16 75°C column, ampacity ≥ continuous current
  // FIX NEC 310.16: conductor ampacity must be >= OCPD rating (not just >= continuous current)
  // Using acSizingOcpdAmps ensures conductor can handle the full OCPD trip current
  const acSizingConductor = getConductorByMinAmpacity(acSizingOcpdAmps, '75c');
  const acSizingConductorGauge = acSizingConductor?.gauge ?? acWireGauge;
  const acSizingConductorAmpacity = acSizingConductor?.ampacity_75c ?? 0;

  // ── Step 5: Disconnect Type Engine (NEC 690.13 / 690.15 / 705.11) ─────────
  //
  // FUSED disconnect:
  //   Use when interconnection = SUPPLY_SIDE_TAP (NEC 705.11).
  //   No backfed breaker at panel → the fused disconnect IS the OCPD.
  //   Fuse sized = next standard size ≥ continuous AC current (NEC 705.60).
  //   Enclosure sized = next standard enclosure ≥ fuse rating.
  //
  // NON-FUSED disconnect:
  //   Use for LOAD_SIDE / MAIN_BREAKER_DERATE / PANEL_UPGRADE (NEC 705.12).
  //   The backfed breaker at the panel IS the OCPD.
  //   Disconnect only needs to interrupt — no fuse required.
  //   Enclosure = next standard size ≥ continuous current (NEC 690.13).
  //
  // Standard disconnect enclosure sizes (residential/light-commercial catalog):
  //   30A, 60A, 100A, 200A, 400A, 600A
  //
  // Fuse + enclosure ladders — single-sourced from lib/electrical/stdSizes.ts
  // (P0-5c; the old local fuse copy stopped at 200 A with a fictional
  // next-10A fallback above it).
  function nextFuseSize(amps: number): number {
    return nextStandardOcpd(amps);
  }
  function nextEnclosureSize(amps: number): number {
    return nextEnclosure(amps);
  }

  // Determine fused vs non-fused from interconnection method
  const acSizingDisconnectType: DisconnectType =
    icMethod === 'SUPPLY_SIDE_TAP' ? 'fused' : 'non-fused';

  // Fuse: sized at next standard ≥ continuous current (NEC 705.60)
  // This is the same as the OCPD — the fuse IS the overcurrent protection for supply-side
  const acSizingFuseAmps: number | null = acSizingDisconnectType === 'fused'
    ? nextFuseSize(acSizingContinuousAmps)
    : null;
  const acSizingFuseCount = acSizingDisconnectType === 'fused' ? 2 : 0; // 2-pole for 240V

  // Disconnect enclosure rating:
  //   Fused: enclosure ≥ fuse rating → next standard enclosure size above fuse
  //   Non-fused: enclosure ≥ OCPD (continuous current) → next standard enclosure size
  const acSizingEnclosureRequirement = acSizingDisconnectType === 'fused'
    ? (acSizingFuseAmps ?? acSizingOcpdAmps)
    : acSizingContinuousAmps;
  // Override disconnectAmps with proper enclosure size (not just OCPD)
  // e.g. 79A continuous → 80A fuse → 100A enclosure (DU100RB or DPF222RP)
  const acSizingDisconnectAmps = nextEnclosureSize(acSizingEnclosureRequirement);

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
  // Wave 2b HONESTY FIX: the old code fabricated per-inverter values as the
  // fleet AVERAGE (totalAcKw / invCount → nextStandardOCPD(avg × 1.25)) —
  // matching no physical inverter in a heterogeneous system. The honest
  // per-inverter data now lives in entrySizings (one record per physical
  // InverterInput, via sizeAcBranch); the legacy scalar mirrors are the
  // LARGEST entry's values — identical to the old average for N=1 and for
  // homogeneous fleets (so the Wave-0 golden numbers are unchanged), and
  // conservative for the separate-disconnect approach when entries differ.
  const invCount = input.inverters.length;
  const largestEntry = entrySizings.reduce<PerInverterAcSizing | null>(
    (best, e) => (best === null || e.acKw > best.acKw ? e : best), null);
  const perInvAcKw = largestEntry ? largestEntry.acKw : totalAcKw;
  const perInvDisconnectAmps = largestEntry
    ? entrySizings.reduce((max, e) => Math.max(max, e.disconnectAmps), 0)
    : sizeAcBranch(totalAcKw, input.systemVoltage).ocpdAmps;

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
    // Multi-inverter fields
    inverterCount: invCount,
    totalAcKw,
    perInverterAcKw: perInvAcKw,
    perInverterDisconnectAmps: perInvDisconnectAmps,
    perInverter: entrySizings, // Wave 2b — honest per-physical-inverter data
    isValid: true,
    validationErrors: [],
  };

  // Validate the model — catch any impossible configurations
  try {
    validateEngineeringModel(engineeringModelData);
  } catch (e: unknown) {
    engineeringModelData.isValid = false;
    engineeringModelData.validationErrors = [(e as Error).message];
    allErrors.push({
      code: 'E-ENGINEERING-MODEL-INVALID',
      severity: 'error',
      message: (e as Error).message,
      necReference: 'NEC 690.9 / 690.13',
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
      'NEC 690.8(B) — Continuous Load (125%)',
      'NEC 240.6 — Standard OCPD Sizes',
      'NEC 690.13 — AC Disconnect',
      acSizingDisconnectType === 'fused' ? 'NEC 690.9 — Fuse Sizing' : 'NEC 690.13 — Non-Fused Disconnect',
      'NEC 310.16 — Conductor Ampacity (75°C)',
      'NEC Chapter 9 — Conduit Fill',
      'NEC 250.66 — Grounding Conductor',
    ],
  };

  // ── Wave 2b — per-sub electrical summaries (result.subSystems[]) ──────────
  // One entry per distinct effective SubSystemKey, fixed roof > ground >
  // fence order. Sub-level ocpdAmps = Σ per-inverter-rounded OCPDs (never
  // re-rounded at the sub level) — the sub's 705.12(B) backfeed
  // contribution feeding the SINGLE 120% check at the POI above.
  const subSystemSummaries: SubSystemElectricalSummary[] = distinctSubKeys.map(key => {
    const idxs = effKeys.map((k, i) => (k === key ? i : -1)).filter(i => i >= 0);
    const subEntries = idxs.map(i => entrySizings[i]);
    const subTallies = idxs.map(i => entryDcTallies[i]);
    const types = [...new Set(idxs.map(i => input.inverters[i].type))];
    const microIdxs = idxs.filter(i => input.inverters[i].type === 'micro');

    // Governing AC run for the sub = the inverter AC run with the highest
    // derated ampacity (its gauge bounds every run in the sub).
    const governing = idxs.reduce<InverterCalcResult | null>((best, i) => {
      const r = inverterResults[i];
      return best === null || (r.acWireResult?.effectiveAmpacity ?? 0) > (best.acWireResult?.effectiveAmpacity ?? 0)
        ? r : best;
    }, null);

    return {
      key,
      topology: types.length === 1 ? types[0] : 'mixed',
      inverterIndexes: idxs,
      inverterCount: idxs.length,
      deviceCount: idxs.reduce((n, i) => n + (input.inverters[i].type === 'micro'
        ? (input.inverters[i].deviceCount || 1) : 1), 0),
      panelCount: subTallies.reduce((n, t) => n + t.panelCount, 0),
      stringCount: subTallies.reduce((n, t) => n + t.stringCount, 0),
      dcKw: subTallies.reduce((n, t) => n + t.dcKw, 0),
      acKw: subEntries.reduce((n, e) => n + e.acKw, 0),
      acOutputAmps: subEntries.reduce((n, e) => n + e.acOutputAmps, 0),
      continuousAmps: subEntries.reduce((n, e) => n + e.continuousAmps, 0),
      ocpdAmps: subEntries.reduce((n, e) => n + e.ocpdAmps, 0),
      acWireGauge: governing?.acWireResult?.selectedGauge ?? acWireGauge,
      acConductorCallout: governing?.acWireResult?.conductorCallout ?? acConductorCallout,
      rsdRequired: key === 'roof', // NEC 690.12 scopes to buildings
      rooftopTempAdderC: multiSub
        ? (key === 'roof' ? input.rooftopTempAdder : 0)
        : input.rooftopTempAdder,
      ...(microIdxs.length > 0 ? {
        branch: {
          deviceCount: microIdxs.reduce((n, i) => n + (input.inverters[i].deviceCount || 1), 0),
          modulesPerDevice: input.inverters[microIdxs[0]].modulesPerDevice || 1,
        },
      } : {}),
      perInverter: subEntries,
    };
  });

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
    rapidShutdownCompliant,
    autoResolutions,
    interconnection: interconnectionResult,
    acSizing: acSizingResult,
    subSystems: subSystemSummaries,
    summary: {
      totalDcKw,
      totalAcKw,
      dcAcRatio,
      totalPanels,
      systemVoltage: input.systemVoltage,
    },
  };
}