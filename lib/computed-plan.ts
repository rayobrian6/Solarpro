// ============================================================
// ComputedPlan — Single Canonical Source of Truth
// SolarPro v3.1 — All tabs read from this model exclusively
// ============================================================
//
// computePlan() is the ONLY function that derives:
//   - compliance issues (errors/warnings/auto-fixed)
//   - electrical sizing decisions (OCPD, disconnect, fuses, conductor, conduit)
//   - BOM line items (derived ONLY from sizing decisions)
//   - equipment schedule data
//   - SLD model inputs
//
// NO other module may independently compute these values.
// ============================================================

import {
  runElectricalCalc,
  ElectricalCalcInput,
  ElectricalCalcResult,
  DisconnectType,
  EngineeringModel,
  validateEngineeringModel,
} from './electrical-calc';
import { getJurisdictionInfo, parseStateFromAddress, JurisdictionInfo } from './jurisdiction';
import { getUtilityRules, getUtilitiesByState, UtilityRuleEntry } from './utility-rules';
import { getRecommendedInterconnection } from './utility-rules';

// ─── Dev-only logging ─────────────────────────────────────────────────────────
const DEV = process.env.NODE_ENV !== 'production';
function devLog(section: string, source: string, value?: any) {
  if (!DEV) return;
  console.log(`[ComputedPlan] ${section} ← ${source}`, value !== undefined ? value : '');
}

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface ProjectInputs {
  // Identity
  projectName: string;
  clientName: string;
  address: string;
  state: string;           // explicit state code e.g. 'CA', 'TX', 'IL'
  utilityId: string;       // e.g. 'ameren', 'comed', 'pge' — '' = auto/unknown
  ahjId: string;           // e.g. 'local-building-dept', 'manual' — '' = auto
  // Service
  mainPanelAmps: number;
  panelBusRating: number;
  interconnectionMethod: 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | 'MAIN_BREAKER_DERATE' | 'PANEL_UPGRADE';
  systemVoltage: number;
  // Wiring
  wireGauge: string;
  wireLength: number;
  conduitType: string;
  // Safety
  rapidShutdown: boolean;
  acDisconnect: boolean;
  dcDisconnect: boolean;
  productionMeter: boolean;
  // Electrical calc input (full)
  electricalCalcInput: ElectricalCalcInput;
}

export interface ExternalData {
  // Jurisdiction (from jurisdiction.ts)
  jurisdiction: JurisdictionInfo | null;
  // Utility rules (from utility-rules.ts)
  utility: UtilityRuleEntry | null;
  // AHJ info (from jurisdiction.ts or manual)
  ahjName: string;
  ahjNotes: string;
}

// ─── Output Types ─────────────────────────────────────────────────────────────

export type ComplianceIssueSeverity = 'error' | 'warning' | 'info' | 'pass';

export interface ComplianceIssue {
  id: string;
  category: 'electrical' | 'structural' | 'jurisdiction' | 'utility' | 'bom';
  severity: ComplianceIssueSeverity;
  title: string;
  message: string;
  necReference?: string;
  autoFixed: boolean;
  autoFixDescription?: string;
  overridable: boolean;
}

export interface ElectricalSizing {
  // Step 1
  acCurrentAmps: number;
  // Step 2
  continuousCurrentAmps: number;
  // Step 3
  ocpdAmps: number;
  ocpdLabel: string;
  // Step 4
  disconnectAmps: number;
  disconnectType: DisconnectType;
  disconnectLabel: string;
  // Step 5
  fuseAmps: number | null;
  fuseCount: number;
  fuseLabel: string;
  // Step 6
  conductorGauge: string;
  conductorType: string;
  conductorAmpacity: number;
  conductorLabel: string;
  // Step 7
  conduitSize: string;
  conduitType: string;
  conduitFillPct: number;
  conduitLabel: string;
  // Grounding
  groundingConductor: string;
  // Canonical model
  engineeringModel: EngineeringModel;
  // NEC refs
  necRefs: string[];
  // Source tag (for dev logging)
  _source: 'computePlan';
}

export interface BomItem {
  id: string;
  stage: string;
  stageLabel: string;
  category: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  quantity: number;
  unit: string;
  necReference: string;
  derivedFrom: string;   // which field in ElectricalSizing drove this item
  _source: 'computePlan';
}

export interface EquipmentScheduleData {
  dcSystemKw: number;
  acCapacityKw: number;
  totalPanels: number;
  panelManufacturer: string;
  panelModel: string;
  panelWatts: number;
  inverterType: string;
  inverterManufacturer: string;
  inverterModel: string;
  inverterCount: number;
  // Electrical equipment section
  ocpdLabel: string;
  disconnectLabel: string;
  fuseLabel: string;
  conductorLabel: string;
  conduitLabel: string;
  groundingLabel: string;
  interconnectionMethod: string;
  interconnectionMethodLabel: string;
  // Source tag
  _source: 'computePlan';
}

export interface SldModelInputs {
  systemVoltage: number;
  acCurrentAmps: number;
  ocpdAmps: number;
  disconnectAmps: number;
  disconnectType: DisconnectType;
  fuseAmps: number | null;
  fuseCount: number;
  conductorGauge: string;
  conduitSize: string;
  conduitType: string;
  groundingConductor: string;
  interconnectionMethod: string;
  utilityName: string;
  _source: 'computePlan';
}

export interface InterconnectionSummary {
  method: string;
  methodLabel: string;
  busRating: number;
  mainBreaker: number;
  solarBreakerRequired: number;
  maxAllowedSolarBreaker: number;
  passes: boolean;
  necReference: string;
  message: string;
  utilityName: string;
  utilityPreference: string;
  utilityAllowsLoadSide: boolean;
  utilityAllowsLineSideTap: boolean;
  requiresVisibleDisconnect: boolean;
  requiresProductionMeter: boolean;
  requiresSmartInverter: boolean;
  netMeteringProgram: string;
  netMeteringAvailable: boolean;
  studyRequired: boolean;
  applicationUrl: string;
  warnings: string[];
  disconnectNotes: string;
  labelingRequirements: string[];
}

export interface ComputedPlan {
  // Meta
  computedAt: string;
  projectName: string;
  state: string;
  utilityId: string;
  ahjId: string;
  ahjName: string;

  // External data
  jurisdiction: JurisdictionInfo | null;
  utility: UtilityRuleEntry | null;

  // Core outputs
  electricalSizing: ElectricalSizing;
  interconnection: InterconnectionSummary;
  bomItems: BomItem[];
  equipmentSchedule: EquipmentScheduleData;
  sldInputs: SldModelInputs;

  // Compliance
  complianceIssues: ComplianceIssue[];
  overallStatus: 'PASS' | 'WARNING' | 'FAIL';
  errorCount: number;
  warningCount: number;
  autoFixCount: number;

  // Raw calc result (for tabs that need full detail)
  rawElectricalResult: ElectricalCalcResult;

  // Validation
  isValid: boolean;
  validationErrors: string[];
}

// ─── AHJ Registry ─────────────────────────────────────────────────────────────

export interface AhjEntry {
  id: string;
  name: string;
  state: string;
  notes: string;
  specialRequirements: string[];
}

// Minimal AHJ list — extend as needed
const AHJ_REGISTRY: AhjEntry[] = [
  { id: 'manual', name: 'Manual / Unknown', state: '', notes: 'Verify requirements with local building department.', specialRequirements: [] },
  { id: 'local-building-dept', name: 'Local Building Department', state: '', notes: 'Standard local building department jurisdiction.', specialRequirements: [] },
  // State-specific
  { id: 'ca-cpuc', name: 'California CPUC', state: 'CA', notes: 'California Public Utilities Commission — Rule 21 applies.', specialRequirements: ['Rule 21 smart inverter compliance required', 'Title 24 Part 3 compliance required'] },
  { id: 'ca-ladbs', name: 'Los Angeles LADBS', state: 'CA', notes: 'LA Dept of Building and Safety.', specialRequirements: ['Rule 21 smart inverter compliance required', 'Title 24 Part 3 compliance required', 'LADBS permit required'] },
  { id: 'fl-bca', name: 'Florida Building Commission', state: 'FL', notes: 'Florida Building Code 7th Edition applies.', specialRequirements: ['Florida Building Code 7th Edition structural requirements', 'High wind zone — verify ASCE 7-22 wind speed'] },
  { id: 'tx-local', name: 'Texas Local Jurisdiction', state: 'TX', notes: 'Texas has no statewide building code — local jurisdictions govern.', specialRequirements: ['Verify local jurisdiction requirements', 'ERCOT interconnection rules may apply'] },
  { id: 'ny-dob', name: 'NYC Department of Buildings', state: 'NY', notes: 'NYC DOB — 18" setback from roof edges required.', specialRequirements: ['NYC Fire Code Chapter 38', '18" setback from roof edges and ridges required'] },
  { id: 'nj-dca', name: 'NJ Division of Consumer Affairs', state: 'NJ', notes: 'NJ Uniform Construction Code applies.', specialRequirements: ['NJ SREC-II registration required for incentives', 'Licensed electrician required'] },
  { id: 'il-icc', name: 'Illinois Commerce Commission', state: 'IL', notes: 'ICC Docket 19-0368 interconnection rules apply.', specialRequirements: ['ICC interconnection standards required', 'Net metering enrollment required'] },
  { id: 'ma-bsee', name: 'MA Board of State Examiners', state: 'MA', notes: '527 CMR 12.00 Massachusetts Electrical Code applies.', specialRequirements: ['527 CMR 12.00 compliance required', 'Licensed electrician required'] },
];

export function getAhjsByState(stateCode: string): AhjEntry[] {
  const stateAhjs = AHJ_REGISTRY.filter(a => a.state === stateCode || a.state === '');
  return stateAhjs;
}

export function getAhjById(id: string): AhjEntry {
  return AHJ_REGISTRY.find(a => a.id === id) ?? AHJ_REGISTRY[0];
}

// ─── BOM Derivation (deterministic from ElectricalSizing) ─────────────────────

let _bomIdCounter = 1;
function bomId(): string { return `cp-bom-${(_bomIdCounter++).toString().padStart(4, '0')}`; }

function deriveBomItems(sizing: ElectricalSizing, inputs: ProjectInputs): BomItem[] {
  _bomIdCounter = 1;
  const items: BomItem[] = [];

  // AC Disconnect Switch — always present
  const discFusibleLabel = sizing.disconnectType === 'fused' ? 'Fusible' : 'Non-Fusible';
  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'disconnects',
    manufacturer: 'Square D',
    model: `${sizing.disconnectAmps}A ${discFusibleLabel} AC Disconnect Switch`,
    partNumber: `DU${sizing.disconnectAmps}${sizing.disconnectType === 'fused' ? 'FB' : 'RB'}`,
    quantity: 1,
    unit: 'ea',
    necReference: 'NEC 690.14',
    derivedFrom: 'electricalSizing.disconnectAmps + disconnectType',
    _source: 'computePlan',
  });

  // Fuses — ONLY if disconnectType === 'fused'
  // Rule: non-fused → NO fuse items; fused → exactly fuseCount items
  if (sizing.disconnectType === 'fused' && sizing.fuseAmps !== null && sizing.fuseCount > 0) {
    devLog('BOM:fuses', 'electricalSizing.disconnectType=fused', { fuseAmps: sizing.fuseAmps, fuseCount: sizing.fuseCount });
    items.push({
      id: bomId(),
      stage: 'stage4_ac_wiring',
      stageLabel: 'Stage 4 — AC Wiring',
      category: 'disconnects',
      manufacturer: 'Littelfuse',
      model: `${sizing.fuseAmps}A, 250V, Class R Fuse`,
      partNumber: `LLNRK${sizing.fuseAmps}SP`,
      quantity: sizing.fuseCount,
      unit: 'ea',
      necReference: 'NEC 690.9',
      derivedFrom: 'electricalSizing.fuseAmps × fuseCount',
      _source: 'computePlan',
    });
  } else {
    devLog('BOM:fuses', 'electricalSizing.disconnectType=non-fused → NO fuse items added');
  }

  // AC Conductor
  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'wire',
    manufacturer: 'Southwire',
    model: `${sizing.conductorGauge} THWN-2 Copper, 600V`,
    partNumber: `SW-${sizing.conductorGauge.replace(/[^0-9/]/g, '')}-THWN2`,
    quantity: 3,
    unit: 'cond.',
    necReference: 'NEC 310.16',
    derivedFrom: 'electricalSizing.conductorGauge',
    _source: 'computePlan',
  });

  // Conduit
  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'conduit',
    manufacturer: 'Allied Tube',
    model: `${sizing.conduitSize}" ${sizing.conduitType} Conduit`,
    partNumber: `${sizing.conduitType}-${sizing.conduitSize.replace('"', '')}`,
    quantity: Math.ceil(inputs.wireLength * 1.15),
    unit: 'ft',
    necReference: 'NEC Chapter 9',
    derivedFrom: 'electricalSizing.conduitSize + conduitType',
    _source: 'computePlan',
  });

  // Grounding conductor
  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'wire',
    manufacturer: 'Southwire',
    model: `${sizing.groundingConductor} Bare Copper EGC`,
    partNumber: `SW-${sizing.groundingConductor.replace(/[^0-9/]/g, '')}-BARE`,
    quantity: 1,
    unit: 'per plan',
    necReference: 'NEC 250.66',
    derivedFrom: 'electricalSizing.groundingConductor',
    _source: 'computePlan',
  });

  devLog('BOM:total', 'deriveBomItems', `${items.length} items (fuses: ${sizing.disconnectType === 'fused' ? sizing.fuseCount : 0})`);
  return items;
}

// ─── Compliance Issue Derivation ──────────────────────────────────────────────

function deriveComplianceIssues(
  rawResult: ElectricalCalcResult,
  sizing: ElectricalSizing,
  inputs: ProjectInputs,
  utility: UtilityRuleEntry | null,
  jurisdiction: JurisdictionInfo | null,
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];

  // From raw electrical calc errors
  (rawResult.errors ?? []).forEach((e, i) => {
    issues.push({
      id: `elec-err-${i}`,
      category: 'electrical',
      severity: 'error',
      title: e.message,
      message: e.message,
      necReference: e.necReference,
      autoFixed: false,
      autoFixDescription: e.suggestion,
      overridable: false,
    });
  });

  // From raw electrical calc warnings
  (rawResult.warnings ?? []).forEach((w, i) => {
    issues.push({
      id: `elec-warn-${i}`,
      category: 'electrical',
      severity: 'warning',
      title: w.message,
      message: w.message,
      necReference: w.necReference,
      autoFixed: false,
      autoFixDescription: w.suggestion,
      overridable: true,
    });
  });

  // Auto-resolutions
  (rawResult.autoResolutions ?? []).forEach((ar, i) => {
    issues.push({
      id: `elec-auto-${i}`,
      category: 'electrical',
      severity: 'info',
      title: `Auto-resolved: ${ar.field}`,
      message: ar.reason,
      necReference: ar.necReference,
      autoFixed: true,
      autoFixDescription: `${ar.originalValue} → ${ar.resolvedValue}`,
      overridable: true,
    });
  });

  // Engineering model validation
  if (!sizing.engineeringModel.isValid) {
    sizing.engineeringModel.validationErrors.forEach((ve, i) => {
      issues.push({
        id: `model-invalid-${i}`,
        category: 'electrical',
        severity: 'error',
        title: 'Engineering Model Validation Failed',
        message: ve,
        necReference: 'NEC 690.9 / 690.14',
        autoFixed: false,
        overridable: false,
      });
    });
  }

  // Interconnection method check
  const interconnection = rawResult.interconnection;
  if (interconnection && !interconnection.passes) {
    issues.push({
      id: 'interconnection-fail',
      category: 'electrical',
      severity: 'error',
      title: 'Interconnection Method Violation',
      message: interconnection.message,
      necReference: interconnection.necReference,
      autoFixed: false,
      overridable: true,
    });
  }

  // Utility-specific warnings
  if (utility) {
    if (utility.requiresSmartInverter) {
      issues.push({
        id: 'utility-smart-inverter',
        category: 'utility',
        severity: 'warning',
        title: `${utility.name} Requires Smart Inverter`,
        message: `${utility.name} requires Rule 21 smart inverter compliance — verify inverter certification`,
        autoFixed: false,
        overridable: true,
      });
    }
    if (!utility.netMeteringAvailable) {
      issues.push({
        id: 'utility-no-net-metering',
        category: 'utility',
        severity: 'warning',
        title: `${utility.name} — No Net Metering`,
        message: `${utility.name} does not offer net metering — verify compensation structure`,
        autoFixed: false,
        overridable: true,
      });
    }
  }

  // Jurisdiction special requirements
  if (jurisdiction?.specialRequirements?.length) {
    jurisdiction.specialRequirements.forEach((req, i) => {
      issues.push({
        id: `jurisdiction-req-${i}`,
        category: 'jurisdiction',
        severity: 'info',
        title: 'Jurisdiction Requirement',
        message: req,
        autoFixed: false,
        overridable: false,
      });
    });
  }

  devLog('Compliance:issues', 'deriveComplianceIssues', `${issues.length} total (${issues.filter(i=>i.severity==='error').length} errors, ${issues.filter(i=>i.severity==='warning').length} warnings, ${issues.filter(i=>i.autoFixed).length} auto-fixed)`);
  return issues;
}

// ─── Interconnection Summary ──────────────────────────────────────────────────

const INTERCONNECTION_METHOD_LABELS: Record<string, string> = {
  LOAD_SIDE: 'Load-Side Breaker (120% Rule)',
  SUPPLY_SIDE_TAP: 'Supply-Side Tap (Line-Side Connection)',
  MAIN_BREAKER_DERATE: 'Main Breaker Derate',
  PANEL_UPGRADE: 'Panel Upgrade',
};

function deriveInterconnectionSummary(
  rawResult: ElectricalCalcResult,
  inputs: ProjectInputs,
  utility: UtilityRuleEntry | null,
): InterconnectionSummary {
  const raw = rawResult.interconnection;
  const utilityRec = utility ? getRecommendedInterconnection(
    {
      state: inputs.state,
      utilityName: utility.name,
      ahjName: '',
      necVersion: '2020',
    },
    {
      busRating: inputs.panelBusRating,
      mainBreaker: inputs.mainPanelAmps,
      solarBreakerRequired: raw?.solarBreakerRequired ?? 0,
      systemDcKw: 0,
      systemAcKw: rawResult.summary?.totalAcKw ?? 0,
    }
  ) : null;

  devLog('Interconnection', 'deriveInterconnectionSummary', { method: inputs.interconnectionMethod, passes: raw?.passes });

  return {
    method: inputs.interconnectionMethod,
    methodLabel: INTERCONNECTION_METHOD_LABELS[inputs.interconnectionMethod] ?? inputs.interconnectionMethod,
    busRating: inputs.panelBusRating,
    mainBreaker: inputs.mainPanelAmps,
    solarBreakerRequired: raw?.solarBreakerRequired ?? 0,
    maxAllowedSolarBreaker: raw?.maxAllowedSolarBreaker ?? 0,
    passes: raw?.passes ?? true,
    necReference: raw?.necReference ?? 'NEC 705.12',
    message: raw?.message ?? '',
    utilityName: utility?.name ?? 'Unknown Utility',
    utilityPreference: utilityRec?.utilityPreference ?? 'LOAD_SIDE',
    utilityAllowsLoadSide: utilityRec?.utilityAllowsLoadSide ?? true,
    utilityAllowsLineSideTap: utilityRec?.utilityAllowsLineSideTap ?? true,
    requiresVisibleDisconnect: utility?.requiresVisibleDisconnect ?? true,
    requiresProductionMeter: utility?.requiresProductionMeter ?? false,
    requiresSmartInverter: utility?.requiresSmartInverter ?? false,
    netMeteringProgram: utility?.netMeteringProgram ?? 'Net Metering',
    netMeteringAvailable: utility?.netMeteringAvailable ?? true,
    studyRequired: utilityRec?.studyRequired ?? false,
    applicationUrl: utility?.interconnectionApplicationUrl ?? '',
    warnings: utilityRec?.warnings ?? [],
    disconnectNotes: utility?.disconnectRequirements?.notes ?? '',
    labelingRequirements: utility?.labelingRequirements ?? [],
  };
}

// ─── Equipment Schedule Derivation ────────────────────────────────────────────

function deriveEquipmentSchedule(
  sizing: ElectricalSizing,
  inputs: ProjectInputs,
  rawResult: ElectricalCalcResult,
  panelManufacturer: string,
  panelModel: string,
  panelWatts: number,
  inverterType: string,
  inverterManufacturer: string,
  inverterModel: string,
  inverterCount: number,
): EquipmentScheduleData {
  devLog('EquipmentSchedule', 'deriveEquipmentSchedule', { ocpd: sizing.ocpdAmps, disconnect: sizing.disconnectLabel });
  return {
    dcSystemKw: rawResult.summary?.totalDcKw ?? 0,
    acCapacityKw: rawResult.summary?.totalAcKw ?? 0,
    totalPanels: rawResult.summary?.totalPanels ?? 0,
    panelManufacturer,
    panelModel,
    panelWatts,
    inverterType,
    inverterManufacturer,
    inverterModel,
    inverterCount,
    // Electrical equipment — derived from sizing (single source of truth)
    ocpdLabel: sizing.ocpdLabel,
    disconnectLabel: sizing.disconnectLabel,
    fuseLabel: sizing.fuseLabel,
    conductorLabel: sizing.conductorLabel,
    conduitLabel: sizing.conduitLabel,
    groundingLabel: `${sizing.groundingConductor} Bare Copper`,
    interconnectionMethod: inputs.interconnectionMethod,
    interconnectionMethodLabel: INTERCONNECTION_METHOD_LABELS[inputs.interconnectionMethod] ?? inputs.interconnectionMethod,
    _source: 'computePlan',
  };
}

// ─── Main computePlan() ───────────────────────────────────────────────────────

export interface ComputePlanOptions {
  inputs: ProjectInputs;
  // Optional equipment info for equipment schedule
  panelManufacturer?: string;
  panelModel?: string;
  panelWatts?: number;
  inverterType?: string;
  inverterManufacturer?: string;
  inverterModel?: string;
  inverterCount?: number;
}

export function computePlan(opts: ComputePlanOptions): ComputedPlan {
  const { inputs } = opts;
  devLog('computePlan', 'START', { state: inputs.state, utilityId: inputs.utilityId, method: inputs.interconnectionMethod });

  // ── 1. Resolve external data ──────────────────────────────────────────────
  const addressForJurisdiction = inputs.address || (inputs.state ? `, ${inputs.state}` : '');
  const stateCode = inputs.state || parseStateFromAddress(inputs.address);
  const jurisdiction = getJurisdictionInfo(addressForJurisdiction);
  devLog('Jurisdiction', 'getJurisdictionInfo', { state: jurisdiction.state, nec: jurisdiction.necVersion });

  // Utility: use explicit utilityId if provided, else try to find by state
  let utility: UtilityRuleEntry | null = null;
  if (inputs.utilityId && inputs.utilityId !== '' && inputs.utilityId !== 'manual' && inputs.utilityId !== 'unknown') {
    utility = getUtilityRules(inputs.utilityId);
    devLog('Utility', 'getUtilityRules(explicit)', utility?.name);
  } else if (stateCode) {
    const stateUtilities = getUtilitiesByState(stateCode);
    if (stateUtilities.length > 0) {
      utility = stateUtilities[0]; // default to first utility for state
      devLog('Utility', 'getUtilitiesByState(auto)', utility?.name);
    }
  }
  if (!utility) {
    utility = getUtilityRules(''); // default utility
    devLog('Utility', 'DEFAULT_UTILITY', utility?.name);
  }

  // AHJ
  const ahjEntry = getAhjById(inputs.ahjId || 'local-building-dept');
  devLog('AHJ', 'getAhjById', ahjEntry.name);

  // ── 2. Run electrical calc ────────────────────────────────────────────────
  const rawResult = runElectricalCalc(inputs.electricalCalcInput);
  devLog('ElectricalCalc', 'runElectricalCalc', { status: rawResult.status, acKw: rawResult.summary?.totalAcKw });

  // ── 3. Extract ElectricalSizing from rawResult.acSizing ──────────────────
  const acSizing = rawResult.acSizing;
  const electricalSizing: ElectricalSizing = {
    acCurrentAmps: acSizing.acCurrentAmps,
    continuousCurrentAmps: acSizing.continuousCurrentAmps,
    ocpdAmps: acSizing.ocpdAmps,
    ocpdLabel: acSizing.ocpdLabel,
    disconnectAmps: acSizing.disconnectAmps,
    disconnectType: acSizing.disconnectType,
    disconnectLabel: acSizing.disconnectLabel,
    fuseAmps: acSizing.fuseAmps,
    fuseCount: acSizing.fuseCount,
    fuseLabel: acSizing.fuseLabel,
    conductorGauge: acSizing.conductorGauge,
    conductorType: acSizing.conductorType,
    conductorAmpacity: acSizing.conductorAmpacity,
    conductorLabel: acSizing.conductorLabel,
    conduitSize: acSizing.conduitSize,
    conduitType: acSizing.conduitType,
    conduitFillPct: acSizing.conduitFillPct,
    conduitLabel: acSizing.conduitLabel,
    groundingConductor: acSizing.groundingConductor,
    engineeringModel: acSizing.engineeringModel,
    necRefs: acSizing.necRefs,
    _source: 'computePlan',
  };
  devLog('ElectricalSizing', 'acSizing', { ocpd: electricalSizing.ocpdAmps, disconnect: electricalSizing.disconnectLabel, fuses: electricalSizing.fuseLabel });

  // ── 4. Derive BOM from electricalSizing (single source of truth) ──────────
  const bomItems = deriveBomItems(electricalSizing, inputs);

  // ── 5. Derive compliance issues ───────────────────────────────────────────
  const complianceIssues = deriveComplianceIssues(rawResult, electricalSizing, inputs, utility, jurisdiction);

  // ── 6. Derive interconnection summary ─────────────────────────────────────
  const interconnection = deriveInterconnectionSummary(rawResult, inputs, utility);

  // ── 7. Derive equipment schedule ──────────────────────────────────────────
  const equipmentSchedule = deriveEquipmentSchedule(
    electricalSizing,
    inputs,
    rawResult,
    opts.panelManufacturer ?? 'Q-CELLS',
    opts.panelModel ?? 'Q.PEAK DUO BLK-G10+ 400',
    opts.panelWatts ?? 400,
    opts.inverterType ?? 'Microinverter',
    opts.inverterManufacturer ?? 'Enphase',
    opts.inverterModel ?? 'IQ8+',
    opts.inverterCount ?? 1,
  );

  // ── 8. SLD inputs ─────────────────────────────────────────────────────────
  const sldInputs: SldModelInputs = {
    systemVoltage: inputs.systemVoltage,
    acCurrentAmps: electricalSizing.acCurrentAmps,
    ocpdAmps: electricalSizing.ocpdAmps,
    disconnectAmps: electricalSizing.disconnectAmps,
    disconnectType: electricalSizing.disconnectType,
    fuseAmps: electricalSizing.fuseAmps,
    fuseCount: electricalSizing.fuseCount,
    conductorGauge: electricalSizing.conductorGauge,
    conduitSize: electricalSizing.conduitSize,
    conduitType: electricalSizing.conduitType,
    groundingConductor: electricalSizing.groundingConductor,
    interconnectionMethod: inputs.interconnectionMethod,
    utilityName: utility?.name ?? 'Unknown',
    _source: 'computePlan',
  };

  // ── 9. Status counters ────────────────────────────────────────────────────
  const errorCount = complianceIssues.filter(i => i.severity === 'error').length;
  const warningCount = complianceIssues.filter(i => i.severity === 'warning').length;
  const autoFixCount = complianceIssues.filter(i => i.autoFixed).length;
  const overallStatus: 'PASS' | 'WARNING' | 'FAIL' = errorCount > 0 ? 'FAIL' : warningCount > 0 ? 'WARNING' : 'PASS';

  devLog('computePlan', 'DONE', { overallStatus, errors: errorCount, warnings: warningCount, autoFixed: autoFixCount, bomItems: bomItems.length });

  return {
    computedAt: new Date().toISOString(),
    projectName: inputs.projectName,
    state: stateCode,
    utilityId: inputs.utilityId,
    ahjId: inputs.ahjId,
    ahjName: ahjEntry.name,
    jurisdiction,
    utility,
    electricalSizing,
    interconnection,
    bomItems,
    equipmentSchedule,
    sldInputs,
    complianceIssues,
    overallStatus,
    errorCount,
    warningCount,
    autoFixCount,
    rawElectricalResult: rawResult,
    isValid: electricalSizing.engineeringModel.isValid,
    validationErrors: electricalSizing.engineeringModel.validationErrors,
  };
}
// ─── Test helper ─────────────────────────────────────────────────────────────
// Exported for unit tests only — derives BOM items from a partial ElectricalSizing
// without requiring full ProjectInputs
export function deriveBomItemsForTest(sizing: Partial<ElectricalSizing> & {
  disconnectType: DisconnectType;
  disconnectAmps: number;
  fuseAmps: number | null;
  fuseCount: number;
  conductorGauge: string;
  conduitSize: string;
  conduitType: string;
  groundingConductor: string;
}): BomItem[] {
  const fullSizing = sizing as ElectricalSizing;
  const minimalInputs: ProjectInputs = {
    projectName: 'test', clientName: 'test', address: '', state: '',
    utilityId: '', ahjId: '',
    mainPanelAmps: 200, panelBusRating: 200,
    interconnectionMethod: 'LOAD_SIDE',
    systemVoltage: 240,
    wireGauge: '#10 AWG THWN-2', wireLength: 50, conduitType: 'EMT',
    rapidShutdown: true, acDisconnect: true, dcDisconnect: true, productionMeter: true,
    electricalCalcInput: {} as any,
  };
  return deriveBomItems(fullSizing, minimalInputs);
}
