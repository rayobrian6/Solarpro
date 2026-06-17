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
import { nextStandardOCPD } from './manufacturer-specs';
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
  electricalCalcInput?: ElectricalCalcInput;
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

// ─── NEC standard OCPD lookup (local helper) ─────────────────────────────────
const STANDARD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400];
function _nextStdOCPD(amps: number): number {
  return STANDARD_OCPD.find(s => s >= amps) ?? Math.ceil(amps / 10) * 10;
}

// ─── GEC sizing per NEC 250.66 (based on OCPD amps) ──────────────────────────
function gecSizeForOcpd(ocpdAmps: number): string {
  if (ocpdAmps <= 60)  return '#8 AWG';
  if (ocpdAmps <= 100) return '#6 AWG';
  if (ocpdAmps <= 200) return '#4 AWG';
  return '#2 AWG';
}

// ─── Conduit fitting quantity helpers ────────────────────────────────────────
function conduitConnectorQty(conduitFt: number): number {
  // Estimate: 2 per inverter (in + out) + 2 at panel end — minimum 4
  return Math.max(4, Math.ceil(conduitFt / 20) + 2);
}
function conduitCouplingQty(conduitFt: number): number {
  // 1 coupling per 10 ft section minus 1
  return Math.max(0, Math.ceil(conduitFt / 10) - 1);
}
function conduitStrapQty(conduitFt: number): number {
  // NEC 358.30: EMT must be supported every 10 ft and within 3 ft of boxes
  // Use 5 ft spacing for solar roof runs
  return Math.ceil(conduitFt / 5);
}

function deriveBomItems(
  sizing: ElectricalSizing,
  inputs: ProjectInputs,
  opts: ComputePlanOptions,
): BomItem[] {
  _bomIdCounter = 1;
  const items: BomItem[] = [];

  const em = sizing.engineeringModel;
  const inverterCount  = em.inverterCount  ?? 1;
  const useCombined    = opts.useCombinedDisconnect !== false; // default true
  const discFusibleLabel = sizing.disconnectType === 'fused' ? 'Fusible' : 'Non-Fusible';

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 4 — AC DISCONNECT
  //   Combined approach  (default): 1 disconnect sized for total AC output
  //   Separate approach (opt-out) : 1 disconnect per inverter, individually sized
  // ═══════════════════════════════════════════════════════════════════════════
  if (useCombined || inverterCount <= 1) {
    // ── Combined / Single inverter ──────────────────────────────────────────
    const disconnectAmps = sizing.disconnectAmps; // already = nextStdOCPD(totalContinuous)
    devLog('BOM:disconnect', 'combined', { inverterCount, disconnectAmps });
    items.push({
      id: bomId(),
      stage: 'stage4_ac_wiring',
      stageLabel: 'Stage 4 — AC Wiring',
      category: 'disconnects',
      manufacturer: 'Square D',
      model: `${disconnectAmps}A ${discFusibleLabel} AC Disconnect Switch`,
      partNumber: `DU${disconnectAmps}${sizing.disconnectType === 'fused' ? 'FB' : 'RB'}`,
      quantity: 1,
      unit: 'ea',
      necReference: 'NEC 690.14',
      derivedFrom: `combined: totalAcKw=${em.totalAcKw?.toFixed(1)}kW → ${disconnectAmps}A`,
      _source: 'computePlan',
    });
  } else {
    // ── Separate per-inverter disconnects ───────────────────────────────────
    const perInvAmps = em.perInverterDisconnectAmps ?? sizing.disconnectAmps;
    devLog('BOM:disconnect', 'separate', { inverterCount, perInvAmps });
    items.push({
      id: bomId(),
      stage: 'stage4_ac_wiring',
      stageLabel: 'Stage 4 — AC Wiring',
      category: 'disconnects',
      manufacturer: 'Square D',
      model: `${perInvAmps}A ${discFusibleLabel} AC Disconnect Switch`,
      partNumber: `DU${perInvAmps}${sizing.disconnectType === 'fused' ? 'FB' : 'RB'}`,
      quantity: inverterCount,
      unit: 'ea',
      necReference: 'NEC 690.14',
      derivedFrom: `separate: ${inverterCount} inverters × ${perInvAmps}A each`,
      _source: 'computePlan',
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 4 — FUSES (only when fused disconnect type)
  // ═══════════════════════════════════════════════════════════════════════════
  if (sizing.disconnectType === 'fused' && sizing.fuseAmps !== null && sizing.fuseCount > 0) {
    devLog('BOM:fuses', 'fused disconnect', { fuseAmps: sizing.fuseAmps, fuseCount: sizing.fuseCount });
    // fuseCount per disconnect × number of disconnects
    const disconnectQty = (useCombined || inverterCount <= 1) ? 1 : inverterCount;
    items.push({
      id: bomId(),
      stage: 'stage4_ac_wiring',
      stageLabel: 'Stage 4 — AC Wiring',
      category: 'disconnects',
      manufacturer: 'Littelfuse',
      model: `${sizing.fuseAmps}A, 250V, Class R Fuse`,
      partNumber: `LLNRK${sizing.fuseAmps}SP`,
      quantity: sizing.fuseCount * disconnectQty,
      unit: 'ea',
      necReference: 'NEC 690.9',
      derivedFrom: `fuseCount=${sizing.fuseCount} × disconnects=${disconnectQty}`,
      _source: 'computePlan',
    });
  } else {
    devLog('BOM:fuses', 'non-fused → no fuse items');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 4 — AC CONDUCTOR
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 4 — EMT CONDUIT
  // ═══════════════════════════════════════════════════════════════════════════
  const conduitFt = Math.ceil(inputs.wireLength * 1.15); // 15% overage for bends/waste
  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'conduit',
    manufacturer: 'Allied Tube',
    model: `${sizing.conduitSize}" ${sizing.conduitType} Conduit`,
    partNumber: `${sizing.conduitType}-${sizing.conduitSize.replace('"', '')}`,
    quantity: conduitFt,
    unit: 'ft',
    necReference: 'NEC Chapter 9',
    derivedFrom: 'electricalSizing.conduitSize + conduitType',
    _source: 'computePlan',
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 4 — CONDUIT FITTINGS (NEC 300.15 / 358.30)
  // Previously missing — now auto-calculated from conduit length
  // ═══════════════════════════════════════════════════════════════════════════
  const connQty    = conduitConnectorQty(conduitFt);
  const couplingQt = conduitCouplingQty(conduitFt);
  const strapQt    = conduitStrapQty(conduitFt);
  const conduitSizeClean = sizing.conduitSize.replace('"', '');

  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'conduit_fittings',
    manufacturer: 'Steel City',
    model: `${sizing.conduitSize}" Set-Screw EMT Connector`,
    partNumber: `C50-${conduitSizeClean}`,
    quantity: connQty,
    unit: 'ea',
    necReference: 'NEC 300.15',
    derivedFrom: `conduitFt=${conduitFt} → ${connQty} connectors`,
    _source: 'computePlan',
  });

  if (couplingQt > 0) {
    items.push({
      id: bomId(),
      stage: 'stage4_ac_wiring',
      stageLabel: 'Stage 4 — AC Wiring',
      category: 'conduit_fittings',
      manufacturer: 'Steel City',
      model: `${sizing.conduitSize}" Set-Screw EMT Coupling`,
      partNumber: `C53-${conduitSizeClean}`,
      quantity: couplingQt,
      unit: 'ea',
      necReference: 'NEC 300.15',
      derivedFrom: `conduitFt=${conduitFt} ÷ 10ft sections`,
      _source: 'computePlan',
    });
  }

  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'conduit_fittings',
    manufacturer: 'Crouse-Hinds',
    model: `${sizing.conduitSize}" Insulated EMB Bushing`,
    partNumber: `EMB-${conduitSizeClean}`,
    quantity: connQty,
    unit: 'ea',
    necReference: 'NEC 300.18',
    derivedFrom: `1 bushing per connector (${connQty})`,
    _source: 'computePlan',
  });

  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'conduit_fittings',
    manufacturer: 'Steel City',
    model: `${sizing.conduitSize}" Rain-Tight EMT Strap`,
    partNumber: `R50-${conduitSizeClean}`,
    quantity: strapQt,
    unit: 'ea',
    necReference: 'NEC 358.30',
    derivedFrom: `conduitFt=${conduitFt} ÷ 5ft spacing`,
    _source: 'computePlan',
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 4 — EQUIPMENT GROUNDING CONDUCTOR (EGC)
  // ═══════════════════════════════════════════════════════════════════════════
  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'wire',
    manufacturer: 'Southwire',
    model: `${sizing.groundingConductor} Bare Copper EGC`,
    partNumber: `SW-${sizing.groundingConductor.replace(/[^0-9/]/g, '')}-BARE`,
    quantity: conduitFt,
    unit: 'ft',
    necReference: 'NEC 250.122',
    derivedFrom: 'electricalSizing.groundingConductor — runs full conduit length',
    _source: 'computePlan',
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 4 — GROUNDING ELECTRODE SYSTEM (NEC 250.50 / 250.52 / 250.66)
  // Ground rod + GEC — required for all PV systems
  // Previously missing — now always included unless site has existing rod
  // ═══════════════════════════════════════════════════════════════════════════
  const hasExistingRod = opts.hasExistingGroundRod === true;
  const totalAcKwForGec = em.totalAcKw ?? (sizing.acCurrentAmps * (inputs.electricalCalcInput?.systemVoltage ?? 240) / 1000);
  const gecSize = gecSizeForOcpd(sizing.ocpdAmps);
  const rodQty  = (!hasExistingRod) ? (totalAcKwForGec > 10 ? 2 : 1) : 0;

  if (!hasExistingRod) {
    items.push({
      id: bomId(),
      stage: 'stage4_ac_wiring',
      stageLabel: 'Stage 4 — AC Wiring',
      category: 'grounding',
      manufacturer: 'Erico Cadweld',
      model: '8ft × 5/8" Copper-Bonded Ground Rod',
      partNumber: 'GROD-58-8FT',
      quantity: rodQty,
      unit: 'ea',
      necReference: 'NEC 250.52(A)(5)',
      derivedFrom: `systemKw=${totalAcKwForGec.toFixed(1)} → ${rodQty} rod(s)`,
      _source: 'computePlan',
    });

    items.push({
      id: bomId(),
      stage: 'stage4_ac_wiring',
      stageLabel: 'Stage 4 — AC Wiring',
      category: 'grounding',
      manufacturer: 'Burndy',
      model: '5/8" Ground Rod Clamp',
      partNumber: 'GRC-58',
      quantity: rodQty,
      unit: 'ea',
      necReference: 'NEC 250.70',
      derivedFrom: `1 clamp per rod (${rodQty})`,
      _source: 'computePlan',
    });
  }

  // GEC — always required (runs from inverter/disconnect to grounding electrode)
  const gecLengthFt = 50; // conservative default; site-specific routing may reduce this
  items.push({
    id: bomId(),
    stage: 'stage4_ac_wiring',
    stageLabel: 'Stage 4 — AC Wiring',
    category: 'grounding',
    manufacturer: 'Southwire',
    model: `${gecSize} THWN-2 Copper GEC`,
    partNumber: `SW-${gecSize.replace(/[^0-9/]/g, '')}-THWN2-GEC`,
    quantity: gecLengthFt,
    unit: 'ft',
    necReference: 'NEC 250.66',
    derivedFrom: `ocpdAmps=${sizing.ocpdAmps} → ${gecSize} GEC`,
    _source: 'computePlan',
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 6 — MONITORING / COMMUNICATION CABLES
  // SolarEdge systems require communication cable from each inverter to gateway
  // Previously missing — now auto-added for SolarEdge inverter type
  // ═══════════════════════════════════════════════════════════════════════════
  const isSolarEdge = (
    (opts.inverterManufacturer ?? '').toLowerCase().includes('solaredge') ||
    (opts.inverterType ?? '').toLowerCase().includes('optimizer') ||
    (opts.inverterModel ?? '').toLowerCase().includes('se')
  );

  if (isSolarEdge && inverterCount > 0) {
    // Communication cable: 1 per inverter, connects to Energy Hub Gateway
    items.push({
      id: bomId(),
      stage: 'stage6_monitoring',
      stageLabel: 'Stage 6 — Monitoring',
      category: 'monitoring',
      manufacturer: 'SolarEdge',
      model: 'RS485 Communication Cable, 10m',
      partNumber: 'SE-RCBL-10M',
      quantity: inverterCount,
      unit: 'ea',
      necReference: 'SolarEdge Install Guide',
      derivedFrom: `inverterCount=${inverterCount} — 1 cable per SE inverter to gateway`,
      _source: 'computePlan',
    });

    // Optional CT kit for consumption monitoring
    if (opts.includeConsumptionMonitoring === true) {
      items.push({
        id: bomId(),
        stage: 'stage6_monitoring',
        stageLabel: 'Stage 6 — Monitoring',
        category: 'monitoring',
        manufacturer: 'SolarEdge',
        model: 'Slim CT for Energy Meters, 200A',
        partNumber: 'SE-TS-200A',
        quantity: 2,
        unit: 'ea',
        necReference: 'SolarEdge Install Guide',
        derivedFrom: 'includeConsumptionMonitoring=true — 2 CTs for 240V service',
        _source: 'computePlan',
      });
    }
  }

  devLog('BOM:total', 'deriveBomItems', `${items.length} items generated`);
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
  // Disconnect configuration
  // true (default) = one combined disconnect sized for all inverters combined
  // false = one separate disconnect per inverter
  useCombinedDisconnect?: boolean;
  // Grounding electrode options
  hasExistingGroundRod?: boolean; // true = skip ground rod in BOM (existing rod on site)
  // Monitoring options
  includeConsumptionMonitoring?: boolean; // true = add CTs for home consumption monitoring
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
  const rawResult = inputs.electricalCalcInput
    ? runElectricalCalc(inputs.electricalCalcInput)
    : null;
  if (!rawResult) {
    // Return a minimal ComputedPlan with failure status when electricalCalcInput is missing
    return {
      computedAt: new Date().toISOString(),
      projectName: inputs.projectName,
      state: inputs.state,
      utilityId: inputs.utilityId,
      ahjId: inputs.ahjId,
      ahjName: '',
      jurisdiction: null,
      utility: null,
      electricalSizing: {} as ElectricalSizing,
      interconnection: {} as InterconnectionSummary,
      bomItems: [],
      equipmentSchedule: {} as EquipmentScheduleData,
      sldInputs: {} as SldModelInputs,
      complianceIssues: [{
        id: 'missing-electrical-input',
        category: 'electrical',
        severity: 'error',
        title: 'Missing electrical input',
        message: 'Missing electricalCalcInput — cannot compute plan',
        autoFixed: false,
        overridable: false,
      }],
      overallStatus: 'FAIL',
      errorCount: 1,
      warningCount: 0,
      autoFixCount: 0,
      rawElectricalResult: {} as ElectricalCalcResult,
      isValid: false,
      validationErrors: ['Missing electricalCalcInput — cannot compute plan'],
    } as ComputedPlan;
  }
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
  const bomItems = deriveBomItems(electricalSizing, inputs, opts);

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
    electricalCalcInput: undefined,
  };
  const minimalOpts: ComputePlanOptions = { inputs: minimalInputs };
  return deriveBomItems(fullSizing, minimalInputs, minimalOpts);
}
