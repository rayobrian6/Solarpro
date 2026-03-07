// ============================================================
// SolarPro Structural Engine V4
// Deterministic ASCE 7-22 + NDS 2018 + Commercial + Ground Mount
// Supports: Residential Roof | Commercial Flat | Ground Mount | Tracker
// ============================================================

import { computeArrayGeometry, autoLayout, type ArrayGeometry, type ArrayLayoutInput } from './array-geometry';
import { getMountingSystemById, resolveMountingSystemId, type MountingSystemSpec } from './mounting-hardware-db';

// ─────────────────────────────────────────────────────────────────────────────
// INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type InstallationType = 'roof_residential' | 'roof_commercial' | 'commercial_ballasted' | 'ground_mount' | 'tracker' | 'carport';
export type FramingType = 'truss' | 'rafter' | 'unknown';
export type WoodSpecies = 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir';
export type WindExposure = 'B' | 'C' | 'D';
export type RoofZone = 'interior' | 'edge' | 'corner';

export interface StructuralInputV4 {
  // Installation type
  installationType: InstallationType;

  // Site conditions
  windSpeed: number;           // mph (ASCE 7-22 design wind speed)
  windExposure: WindExposure;
  groundSnowLoad: number;      // psf
  meanRoofHeight: number;      // ft
  roofPitch: number;           // degrees

  // Framing (residential roof)
  framingType: FramingType;
  rafterSize: string;          // '2x4', '2x6', '2x8', '2x10', '2x12'
  rafterSpacingIn: number;     // inches O.C.
  rafterSpanFt: number;        // clear span, feet
  woodSpecies?: WoodSpecies;

  // Array
  panelCount: number;
  panelLengthIn: number;
  panelWidthIn: number;
  panelWeightLbs: number;
  panelOrientation: 'portrait' | 'landscape';
  rowCount?: number;
  colCount?: number;
  moduleGapIn?: number;
  rowGapIn?: number;

  // Mounting system
  mountingSystemId: string;
  rackingWeightPerPanelLbs?: number;

  // Commercial flat roof
  roofMembrane?: 'tpo' | 'epdm' | 'pvc' | 'gravel' | 'concrete';
  roofDeadLoadPsf?: number;    // existing roof dead load

  // Ground mount
  soilType?: 'clay' | 'sand' | 'loam' | 'rock' | 'unknown';
  frostDepthIn?: number;       // frost depth for pile embedment
  groundElevationFt?: number;

  // Tracker
  trackerRowSpacingFt?: number;
  gcoverageRatio?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface WindAnalysis {
  velocityPressurePsf: number;
  netUpliftPressurePsf: number;
  netDownwardPressurePsf: number;
  roofZone: RoofZone;
  gcpUplift: number;
  gcpDownward: number;
  exposureCoeff: number;
  designWindSpeedMph: number;
}

export interface SnowAnalysis {
  groundSnowLoadPsf: number;
  roofSnowLoadPsf: number;
  slopeFactor: number;
  thermalFactor: number;
  importanceFactor: number;
}

export interface MountLayoutResult {
  mountSpacingIn: number;
  mountCount: number;
  mountsPerRail: number;
  safetyFactor: number;
  upliftPerMountLbs: number;
  downwardPerMountLbs: number;
  mountCapacityLbs: number;
  tributaryAreaPerMountFt2: number;
  spacingWasReduced: boolean;
  maxAllowedSpacingIn: number;
}

export interface RailAnalysisResult {
  passes: boolean;
  railSpanIn: number;
  maxAllowedSpanIn: number;
  cantileverIn: number;
  maxAllowedCantileverIn: number;
  momentDemandInLbs: number;
  momentCapacityInLbs: number;
  utilizationRatio: number;
  railSystem: string;
}

export interface RafterAnalysis {
  framingType: FramingType;
  size: string;
  spacingIn: number;
  spanFt: number;
  species: string;
  totalLoadPsf: number;
  pvDeadLoadPsf: number;
  roofDeadLoadPsf: number;
  snowLoadPsf: number;
  bendingMomentDemandFtLbs: number;
  bendingMomentCapacityFtLbs: number;
  bendingUtilization: number;
  shearDemandLbs: number;
  shearCapacityLbs: number;
  shearUtilization: number;
  deflectionIn: number;
  allowableDeflectionIn: number;
  deflectionUtilization: number;
  overallUtilization: number;
  passes: boolean;
  notes: string[];
}

export interface BallastAnalysis {
  totalBallastBlocks: number;
  ballastWeightLbs: number;
  blocksPerModule: number;
  ballastWeightPerModuleLbs: number;
  roofLoadPsf: number;
  roofCapacityPsf: number;
  passes: boolean;
  notes: string[];
}

export interface GroundMountAnalysis {
  pileCount: number;
  pileSpacingFt: number;
  pileEmbedmentFt: number;
  upliftPerPileLbs: number;
  downwardPerPileLbs: number;
  lateralPerPileLbs: number;
  pileCapacityUpliftLbs: number;
  pileCapacityDownwardLbs: number;
  safetyFactorUplift: number;
  safetyFactorDownward: number;
  passes: boolean;
  notes: string[];
}

export interface TrackerAnalysis {
  rowCount: number;
  rowSpacingFt: number;
  modulesPerRow: number;
  totalTrackerLength: number;
  gcoverageRatio: number;
  windLoadPsf: number;
  stowAngleDeg: number;
  passes: boolean;
  notes: string[];
}

export interface RackingBOM {
  rails: { qty: number; lengthFt: number; unit: string; description: string; partNumber: string };
  railSplices: { qty: number; unit: string; description: string; partNumber: string };
  mounts: { qty: number; unit: string; description: string; partNumber: string };
  lFeet: { qty: number; unit: string; description: string; partNumber: string };
  midClamps: { qty: number; unit: string; description: string; partNumber: string };
  endClamps: { qty: number; unit: string; description: string; partNumber: string };
  groundLugs: { qty: number; unit: string; description: string; partNumber: string };
  lagBolts: { qty: number; unit: string; description: string; partNumber: string };
  flashingKits: { qty: number; unit: string; description: string; partNumber: string };
  bondingClips: { qty: number; unit: string; description: string; partNumber: string };
  ballastBlocks?: { qty: number; weightLbs: number; unit: string; description: string };
  piles?: { qty: number; unit: string; description: string; embedmentFt: number };
}

export interface StructuralIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  suggestion: string;
  reference?: string;
}

export interface StructuralResultV4 {
  status: 'PASS' | 'WARNING' | 'FAIL';
  installationType: InstallationType;
  arrayGeometry: ArrayGeometry;
  wind: WindAnalysis;
  snow: SnowAnalysis;
  mountLayout: MountLayoutResult;
  railAnalysis?: RailAnalysisResult;
  rafterAnalysis: RafterAnalysis;
  ballastAnalysis?: BallastAnalysis;
  groundMountAnalysis?: GroundMountAnalysis;
  trackerAnalysis?: TrackerAnalysis;
  rackingBOM: RackingBOM;
  totalSystemWeightLbs: number;
  addedDeadLoadPsf: number;
  mountingSystem: MountingSystemSpec;
  errors: StructuralIssue[];
  warnings: StructuralIssue[];
  recommendations: string[];
  debugInfo: {
    framingTypeResolved: FramingType;
    autoDetectedFraming: boolean;
    mountSpacingIterations: number;
    pvDeadLoadPsf: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NDS 2018 REFERENCE VALUES
// ─────────────────────────────────────────────────────────────────────────────

const NDS_FB: Record<string, Record<string, number>> = {
  'Douglas Fir-Larch': { '2x4': 900, '2x6': 1150, '2x8': 1000, '2x10': 900, '2x12': 825 },
  'Southern Pine':     { '2x4': 1500, '2x6': 1250, '2x8': 1050, '2x10': 1050, '2x12': 975 },
  'Hem-Fir':           { '2x4': 850, '2x6': 850, '2x8': 850, '2x10': 800, '2x12': 775 },
  'Spruce-Pine-Fir':   { '2x4': 875, '2x6': 875, '2x8': 875, '2x10': 800, '2x12': 725 },
};

const NDS_FV: Record<string, number> = {
  'Douglas Fir-Larch': 180,
  'Southern Pine':     175,
  'Hem-Fir':           150,
  'Spruce-Pine-Fir':   135,
};

const NDS_E: Record<string, number> = {
  'Douglas Fir-Larch': 1_600_000,
  'Southern Pine':     1_600_000,
  'Hem-Fir':           1_500_000,
  'Spruce-Pine-Fir':   1_400_000,
};

const LUMBER_DIMS: Record<string, { b: number; d: number }> = {
  '2x4':  { b: 1.5, d: 3.5 },
  '2x6':  { b: 1.5, d: 5.5 },
  '2x8':  { b: 1.5, d: 7.25 },
  '2x10': { b: 1.5, d: 9.25 },
  '2x12': { b: 1.5, d: 11.25 },
};

// BCSI truss capacity table (psf) — pre-engineered trusses at 24" O.C.
const TRUSS_CAPACITY_PSF: Record<string, number> = {
  '16': 55,
  '20': 50,
  '24': 45,
  '28': 40,
  '32': 35,
  '36': 30,
};

// ─────────────────────────────────────────────────────────────────────────────
// ASCE 7-22 WIND CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────

function getKz(heightFt: number, exposure: WindExposure): number {
  // ASCE 7-22 Table 26.10-1 — Velocity Pressure Exposure Coefficient
  if (exposure === 'B') {
    if (heightFt <= 15) return 0.57;
    if (heightFt <= 20) return 0.62;
    if (heightFt <= 25) return 0.66;
    if (heightFt <= 30) return 0.70;
    return 0.76;
  } else if (exposure === 'C') {
    if (heightFt <= 15) return 0.85;
    if (heightFt <= 20) return 0.90;
    if (heightFt <= 25) return 0.94;
    if (heightFt <= 30) return 0.98;
    return 1.04;
  } else { // D
    if (heightFt <= 15) return 1.03;
    if (heightFt <= 20) return 1.08;
    if (heightFt <= 25) return 1.12;
    if (heightFt <= 30) return 1.16;
    return 1.22;
  }
}

function calcVelocityPressure(windSpeedMph: number, exposure: WindExposure, heightFt: number): number {
  const Kz = getKz(heightFt, exposure);
  const Kzt = 1.0;   // topographic factor (flat terrain)
  const Kd = 0.85;   // directionality factor (ASCE 7-22 Table 26.6-1)
  return 0.00256 * Kz * Kzt * Kd * windSpeedMph * windSpeedMph;
}

function getGCp(zone: RoofZone, pitchDeg: number): { uplift: number; downward: number } {
  // ASCE 7-22 Figure 29.4-7 — Roof-Mounted Solar Panels
  // Net pressure coefficients for solar panels on roofs
  if (zone === 'interior') {
    return { uplift: -1.5, downward: 1.5 };
  } else if (zone === 'edge') {
    return { uplift: -2.0, downward: 2.0 };
  } else { // corner
    return { uplift: -2.5, downward: 2.5 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ASCE 7-22 SNOW CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────

function calcRoofSnowLoad(groundSnow: number, pitchDeg: number): {
  roofSnow: number; Cs: number; Ct: number; Is: number;
} {
  const Ce = 1.0;   // exposure factor (fully exposed)
  const Ct = 1.0;   // thermal factor (heated building)
  const Is = 1.0;   // importance factor (residential)

  // Slope factor Cs (ASCE 7-22 Section 7.4)
  const Cs = pitchDeg <= 5 ? 1.0 : Math.max(0, Math.cos(pitchDeg * Math.PI / 180));

  const pf = 0.7 * Ce * Ct * Is * groundSnow;  // flat roof snow
  const roofSnow = Cs * pf;

  return { roofSnow, Cs, Ct, Is };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAFTER ANALYSIS (NDS 2018)
// ─────────────────────────────────────────────────────────────────────────────

function analyzeRafter(
  input: StructuralInputV4,
  pvDeadLoadPsf: number,
  snowLoadPsf: number,
): RafterAnalysis {
  const { rafterSize, rafterSpacingIn, rafterSpanFt } = input;
  const woodSpecies = input.woodSpecies ?? 'Douglas Fir-Larch';
  const notes: string[] = [];

  // Auto-detect framing type from spacing
  let framingType = input.framingType;
  let autoDetected = false;
  if (framingType === 'unknown') {
    framingType = rafterSpacingIn >= 24 ? 'truss' : 'rafter';
    autoDetected = true;
    notes.push(`Framing auto-detected as ${framingType.toUpperCase()} (${rafterSpacingIn}" O.C.)`);
  }

  const roofDeadLoad = input.roofDeadLoadPsf ?? 15.0;

  // ── TRUSS: BCSI capacity table ──────────────────────────────────────────
  if (framingType === 'truss') {
    const spanKey = String(Math.round(rafterSpanFt / 4) * 4);
    const trussCapacity = TRUSS_CAPACITY_PSF[spanKey] ?? 45;
    const totalLoad = roofDeadLoad + pvDeadLoadPsf + snowLoadPsf;
    const utilization = totalLoad / trussCapacity;

    return {
      framingType: 'truss',
      size: rafterSize,
      spacingIn: rafterSpacingIn,
      spanFt: rafterSpanFt,
      species: woodSpecies,
      totalLoadPsf: totalLoad,
      pvDeadLoadPsf,
      roofDeadLoadPsf: roofDeadLoad,
      snowLoadPsf,
      bendingMomentDemandFtLbs: 0,
      bendingMomentCapacityFtLbs: trussCapacity,
      bendingUtilization: utilization,
      shearDemandLbs: 0,
      shearCapacityLbs: 0,
      shearUtilization: 0,
      deflectionIn: 0,
      allowableDeflectionIn: 0,
      deflectionUtilization: 0,
      overallUtilization: utilization,
      passes: utilization <= 1.0,
      notes: [
        ...notes,
        `BCSI truss capacity = ${trussCapacity} psf (${spanKey} ft span)`,
        `Total load = ${totalLoad.toFixed(1)} psf (DL ${roofDeadLoad} + PV ${pvDeadLoadPsf.toFixed(1)} + Snow ${snowLoadPsf.toFixed(1)})`,
        `Utilization = ${(utilization * 100).toFixed(0)}%`,
      ],
    };
  }

  // ── STICK-BUILT RAFTER: NDS 2018 ────────────────────────────────────────
  const dims = LUMBER_DIMS[rafterSize] ?? LUMBER_DIMS['2x6'];
  const { b, d } = dims;

  const S = (b * d * d) / 6;          // section modulus, in³
  const I = (b * d * d * d) / 12;     // moment of inertia, in⁴

  const Fb_ref = NDS_FB[woodSpecies]?.[rafterSize] ?? 1000;
  const Fv_ref = NDS_FV[woodSpecies] ?? 180;
  const E_ref  = NDS_E[woodSpecies]  ?? 1_600_000;

  // Adjustment factors (NDS 2018 Table 4A)
  const CD = 1.15;  // load duration (snow governs)
  const CM = 1.0;   // wet service (dry conditions)
  const Ct = 1.0;   // temperature
  const CF_b = rafterSize === '2x4' ? 1.5 : rafterSize === '2x6' ? 1.3 :
               rafterSize === '2x8' ? 1.2 : rafterSize === '2x10' ? 1.1 : 1.0;
  const Cr = 1.15;  // repetitive member factor (≤24" O.C.)

  const Fb_prime = Fb_ref * CD * CM * Ct * CF_b * Cr;
  const Fv_prime = Fv_ref * CD * CM * Ct;
  const E_prime  = E_ref  * CM * Ct;

  const tributaryWidthFt = rafterSpacingIn / 12;
  const totalLoadPsf = roofDeadLoad + pvDeadLoadPsf + snowLoadPsf;
  const w = totalLoadPsf * tributaryWidthFt;  // lbs/ft
  const L = rafterSpanFt;

  // Bending
  const M_demand_ftLbs = w * L * L / 8;
  const M_demand_inLbs = M_demand_ftLbs * 12;
  const M_capacity_inLbs = Fb_prime * S;
  const M_capacity_ftLbs = M_capacity_inLbs / 12;
  const bendingUtil = M_demand_inLbs / M_capacity_inLbs;

  // Shear
  const V_demand = w * L / 2;
  const fv_actual = 1.5 * V_demand / (b * d);
  const shearUtil = fv_actual / Fv_prime;

  // Deflection (L/240 for total load)
  const w_inPerIn = w / 12;
  const L_in = L * 12;
  const delta = 5 * w_inPerIn * Math.pow(L_in, 4) / (384 * E_prime * I);
  const delta_allow = L_in / 240;
  const deflUtil = delta / delta_allow;

  const overallUtil = Math.max(bendingUtil, shearUtil, deflUtil);

  return {
    framingType: 'rafter',
    size: rafterSize,
    spacingIn: rafterSpacingIn,
    spanFt: rafterSpanFt,
    species: woodSpecies,
    totalLoadPsf,
    pvDeadLoadPsf,
    roofDeadLoadPsf: roofDeadLoad,
    snowLoadPsf,
    bendingMomentDemandFtLbs: M_demand_ftLbs,
    bendingMomentCapacityFtLbs: M_capacity_ftLbs,
    bendingUtilization: bendingUtil,
    shearDemandLbs: V_demand,
    shearCapacityLbs: Fv_prime * b * d / 1.5,
    shearUtilization: shearUtil,
    deflectionIn: delta,
    allowableDeflectionIn: delta_allow,
    deflectionUtilization: deflUtil,
    overallUtilization: overallUtil,
    passes: overallUtil <= 1.0,
    notes: [
      ...notes,
      `Fb' = ${Fb_prime.toFixed(0)} psi (Fb=${Fb_ref} × CD=${CD} × CF=${CF_b} × Cr=${Cr})`,
      `Bending: ${(bendingUtil * 100).toFixed(0)}%, Shear: ${(shearUtil * 100).toFixed(0)}%, Deflection: ${(deflUtil * 100).toFixed(0)}%`,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOUNT LAYOUT CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

function calcMountLayout(
  geometry: ArrayGeometry,
  system: MountingSystemSpec,
  netUpliftPsf: number,
): MountLayoutResult {
  const mount = system.mount;
  const maxSpacingIn = mount.maxSpacingIn;
  const mountCapacityLbs = mount.upliftCapacityLbs;

  // Rail span = distance between the 2 rails per row (across slope)
  const railSpanIn = geometry.railSpacingIn;

  let spacingIn = maxSpacingIn;
  let iterations = 0;
  let spacingWasReduced = false;

  // Iterative: reduce spacing until SF ≥ 1.5
  while (spacingIn >= 12) {
    iterations++;
    const tribAreaFt2 = (spacingIn * railSpanIn) / 144;
    const upliftPerMount = netUpliftPsf * tribAreaFt2;
    const sf = mountCapacityLbs / upliftPerMount;
    if (sf >= 1.5) break;
    spacingIn -= 6;
    spacingWasReduced = true;
  }
  spacingIn = Math.max(12, spacingIn);

  const tribAreaFt2 = (spacingIn * railSpanIn) / 144;
  const upliftPerMount = netUpliftPsf * tribAreaFt2;
  const safetyFactor = mountCapacityLbs / upliftPerMount;

  // Downward load per mount
  const downwardPerMount = 0; // calculated separately if needed

  // Mount count per rail
  const mountsPerRail = Math.ceil(geometry.railLengthIn / spacingIn) + 1;
  const mountCount = mountsPerRail * geometry.railCount;

  return {
    mountSpacingIn: spacingIn,
    mountCount,
    mountsPerRail,
    safetyFactor,
    upliftPerMountLbs: upliftPerMount,
    downwardPerMountLbs: downwardPerMount,
    mountCapacityLbs,
    tributaryAreaPerMountFt2: tribAreaFt2,
    spacingWasReduced,
    maxAllowedSpacingIn: maxSpacingIn,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAIL ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

function analyzeRail(
  geometry: ArrayGeometry,
  system: MountingSystemSpec,
  mountLayout: MountLayoutResult,
  totalLoadPsf: number,
): RailAnalysisResult | undefined {
  if (!system.rail) return undefined;

  const rail = system.rail;
  const spanIn = mountLayout.mountSpacingIn;
  const cantileverIn = Math.min(spanIn / 3, rail.maxCantileverIn);

  // Tributary width per rail (half the panel height across slope)
  const tribWidthIn = geometry.railSpacingIn;
  const tribWidthFt = tribWidthIn / 12;

  // Distributed load on rail
  const w = totalLoadPsf * tribWidthFt;  // lbs/ft
  const spanFt = spanIn / 12;
  const M_demand_inLbs = (w * spanFt * spanFt / 8) * 12;

  const utilizationRatio = M_demand_inLbs / rail.momentCapacityInLbs;

  return {
    passes: utilizationRatio <= 1.0 && spanIn <= rail.maxSpanIn,
    railSpanIn: spanIn,
    maxAllowedSpanIn: rail.maxSpanIn,
    cantileverIn,
    maxAllowedCantileverIn: rail.maxCantileverIn,
    momentDemandInLbs: M_demand_inLbs,
    momentCapacityInLbs: rail.momentCapacityInLbs,
    utilizationRatio,
    railSystem: `${system.manufacturer} ${system.rail.model}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BALLAST ANALYSIS (Commercial Flat Roof)
// ─────────────────────────────────────────────────────────────────────────────

function analyzeBallast(
  input: StructuralInputV4,
  system: MountingSystemSpec,
  geometry: ArrayGeometry,
  netUpliftPsf: number,
): BallastAnalysis {
  const ballast = system.ballast;
  if (!ballast) {
    return {
      totalBallastBlocks: 0,
      ballastWeightLbs: 0,
      blocksPerModule: 0,
      ballastWeightPerModuleLbs: 0,
      roofLoadPsf: 0,
      roofCapacityPsf: 0,
      passes: false,
      notes: ['No ballast specification found for this system'],
    };
  }

  // Calculate required ballast per module
  // Uplift force per module = netUpliftPsf × module area
  const moduleAreaFt2 = (input.panelLengthIn * input.panelWidthIn) / 144;
  const upliftPerModuleLbs = netUpliftPsf * moduleAreaFt2;

  // Required ballast weight = uplift / friction coefficient (0.5 for TPO/EPDM)
  const frictionCoeff = 0.5;
  const requiredBallastLbs = upliftPerModuleLbs / frictionCoeff;
  const blocksRequired = Math.ceil(requiredBallastLbs / ballast.blockWeightLbs);
  const blocksPerModule = Math.max(ballast.minBlocksPerModule,
    Math.min(ballast.maxBlocksPerModule, blocksRequired));

  const totalBlocks = blocksPerModule * input.panelCount;
  const totalBallastWeight = totalBlocks * ballast.blockWeightLbs;

  // Roof load check
  const arrayAreaFt2 = (geometry.arrayWidthIn / 12) * (geometry.arrayHeightIn / 12);
  const panelWeightPsf = (input.panelCount * input.panelWeightLbs) / arrayAreaFt2;
  const ballastWeightPsf = totalBallastWeight / arrayAreaFt2;
  const roofLoadPsf = panelWeightPsf + ballastWeightPsf + (input.roofDeadLoadPsf ?? 15);

  // Typical flat roof capacity: 30-50 psf (conservative 30 psf)
  const roofCapacityPsf = 30;
  const passes = roofLoadPsf <= roofCapacityPsf && blocksPerModule <= ballast.maxBlocksPerModule;

  return {
    totalBallastBlocks: totalBlocks,
    ballastWeightLbs: totalBallastWeight,
    blocksPerModule,
    ballastWeightPerModuleLbs: blocksPerModule * ballast.blockWeightLbs,
    roofLoadPsf,
    roofCapacityPsf,
    passes,
    notes: [
      `Uplift per module: ${upliftPerModuleLbs.toFixed(0)} lbs`,
      `Required ballast: ${requiredBallastLbs.toFixed(0)} lbs/module`,
      `Blocks per module: ${blocksPerModule} × ${ballast.blockWeightLbs} lbs = ${blocksPerModule * ballast.blockWeightLbs} lbs`,
      `Total ballast: ${totalBlocks} blocks × ${ballast.blockWeightLbs} lbs = ${totalBallastWeight.toFixed(0)} lbs`,
      `Roof load: ${roofLoadPsf.toFixed(1)} psf (capacity: ${roofCapacityPsf} psf)`,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUND MOUNT ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

function analyzeGroundMount(
  input: StructuralInputV4,
  system: MountingSystemSpec,
  geometry: ArrayGeometry,
  netUpliftPsf: number,
  netDownwardPsf: number,
): GroundMountAnalysis {
  const gm = system.groundMount;
  if (!gm) {
    return {
      pileCount: 0,
      pileSpacingFt: 0,
      pileEmbedmentFt: 0,
      upliftPerPileLbs: 0,
      downwardPerPileLbs: 0,
      lateralPerPileLbs: 0,
      pileCapacityUpliftLbs: 0,
      pileCapacityDownwardLbs: 0,
      safetyFactorUplift: 0,
      safetyFactorDownward: 0,
      passes: false,
      notes: ['No ground mount specification found for this system'],
    };
  }

  // Array dimensions
  const arrayWidthFt = geometry.arrayWidthIn / 12;
  const arrayHeightFt = geometry.arrayHeightIn / 12;
  const arrayAreaFt2 = arrayWidthFt * arrayHeightFt;

  // Pile layout: piles along the width at specified spacing
  const pilesPerRow = Math.ceil(arrayWidthFt / gm.pileSpacingFt) + 1;
  const pileRows = 2;  // front and back posts for dual-post
  const totalPiles = pilesPerRow * pileRows;

  // Tributary area per pile
  const tribAreaPerPileFt2 = arrayAreaFt2 / totalPiles;

  // Loads per pile
  const upliftPerPile = netUpliftPsf * tribAreaPerPileFt2;
  const downwardPerPile = netDownwardPsf * tribAreaPerPileFt2 +
    (input.panelCount * input.panelWeightLbs) / totalPiles;
  const lateralPerPile = upliftPerPile * 0.3;  // approximate lateral = 30% of uplift

  // Safety factors
  const sfUplift = gm.pileCapacityUpliftLbs / upliftPerPile;
  const sfDownward = gm.pileCapacityDownwardLbs / downwardPerPile;

  // Frost depth check
  const requiredEmbedment = Math.max(gm.pileEmbedmentFt, (input.frostDepthIn ?? 36) / 12 + 1);

  const passes = sfUplift >= 1.5 && sfDownward >= 1.5;

  return {
    pileCount: totalPiles,
    pileSpacingFt: gm.pileSpacingFt,
    pileEmbedmentFt: requiredEmbedment,
    upliftPerPileLbs: upliftPerPile,
    downwardPerPileLbs: downwardPerPile,
    lateralPerPileLbs: lateralPerPile,
    pileCapacityUpliftLbs: gm.pileCapacityUpliftLbs,
    pileCapacityDownwardLbs: gm.pileCapacityDownwardLbs,
    safetyFactorUplift: sfUplift,
    safetyFactorDownward: sfDownward,
    passes,
    notes: [
      `Array: ${arrayWidthFt.toFixed(1)}' × ${arrayHeightFt.toFixed(1)}' = ${arrayAreaFt2.toFixed(0)} ft²`,
      `Piles: ${pilesPerRow} per row × ${pileRows} rows = ${totalPiles} total`,
      `Pile spacing: ${gm.pileSpacingFt} ft`,
      `Uplift per pile: ${upliftPerPile.toFixed(0)} lbs (SF = ${sfUplift.toFixed(2)})`,
      `Downward per pile: ${downwardPerPile.toFixed(0)} lbs (SF = ${sfDownward.toFixed(2)})`,
      `Required embedment: ${requiredEmbedment.toFixed(1)} ft (frost depth: ${(input.frostDepthIn ?? 36)}")`,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACKER ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

function analyzeTracker(
  input: StructuralInputV4,
  system: MountingSystemSpec,
  geometry: ArrayGeometry,
  netUpliftPsf: number,
): TrackerAnalysis {
  const tracker = system.tracker;
  if (!tracker) {
    return {
      rowCount: 0,
      rowSpacingFt: 0,
      modulesPerRow: 0,
      totalTrackerLength: 0,
      gcoverageRatio: 0,
      windLoadPsf: netUpliftPsf,
      stowAngleDeg: 0,
      passes: false,
      notes: ['No tracker specification found for this system'],
    };
  }

  const rowSpacingFt = input.trackerRowSpacingFt ?? tracker.rowSpacingFt;
  const modulesPerRow = tracker.moduleRowsPerTracker;
  const rowCount = Math.ceil(input.panelCount / (modulesPerRow * tracker.maxModulesPerTracker));
  const totalTrackerLength = geometry.arrayWidthIn / 12;
  const gcoverageRatio = input.gcoverageRatio ?? tracker.gcoverageRatio;

  const passes = input.windSpeed <= tracker.windSpeedMaxMph;

  return {
    rowCount,
    rowSpacingFt,
    modulesPerRow,
    totalTrackerLength,
    gcoverageRatio,
    windLoadPsf: netUpliftPsf,
    stowAngleDeg: tracker.stowAngleDeg,
    passes,
    notes: [
      `Tracker rows: ${rowCount}`,
      `Row spacing: ${rowSpacingFt} ft`,
      `GCR: ${(gcoverageRatio * 100).toFixed(0)}%`,
      `Stow angle: ${tracker.stowAngleDeg}° (wind > ${tracker.windSpeedMaxMph * 0.7} mph)`,
      `Max wind: ${tracker.windSpeedMaxMph} mph (design: ${input.windSpeed} mph)`,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RACKING BOM CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

function calcRackingBOM(
  geometry: ArrayGeometry,
  system: MountingSystemSpec,
  mountLayout: MountLayoutResult,
  ballastAnalysis?: BallastAnalysis,
  groundMountAnalysis?: GroundMountAnalysis,
): RackingBOM {
  const hw = system.hardware;
  const isRailBased = system.systemType === 'rail_based' || system.systemType === 'standing_seam';
  const isBallasted = system.systemType === 'ballasted_flat';
  const isGroundMount = ['ground_single_post', 'ground_dual_post', 'ground_driven_pile',
    'ground_helical', 'ground_concrete'].includes(system.systemType);

  // ── Rails ──────────────────────────────────────────────────────────────
  const railSectionLenFt = system.rail ? system.rail.spliceIntervalIn / 12 : 14;
  const railLengthFt = geometry.railLengthIn / 12;
  const railsPerRun = isRailBased ? Math.ceil(railLengthFt / railSectionLenFt) : 0;
  const railQty = railsPerRun * geometry.railCount;

  // ── Rail Splices ───────────────────────────────────────────────────────
  const splicesPerRail = isRailBased ? Math.max(0, railsPerRun - 1) : 0;
  const totalSplices = splicesPerRail * geometry.railCount;

  // ── Mounts / L-Feet ───────────────────────────────────────────────────
  const mountQty = mountLayout.mountCount;

  // ── Clamps ────────────────────────────────────────────────────────────
  const midClampQty = geometry.totalMidClamps;
  const endClampQty = geometry.totalEndClamps;

  // ── Ground Lugs (NEC 690.47) ──────────────────────────────────────────
  const groundLugQty = Math.ceil(geometry.totalPanels / 2);

  // ── Lag Bolts ─────────────────────────────────────────────────────────
  const lagBoltsPerMount = system.mount.fastenersPerMount;
  const lagBoltQty = mountQty * lagBoltsPerMount;

  // ── Flashing Kits ─────────────────────────────────────────────────────
  const needsFlashing = ['l_foot_lag', 'standoff_lag', 'direct_attach',
    'tile_hook', 'tile_replacement', 'rail_less_lag'].includes(system.mount.attachmentMethod);
  const flashingQty = needsFlashing ? mountQty : 0;

  // ── Bonding Clips (UL 2703) ───────────────────────────────────────────
  const bondingClipQty = geometry.totalPanels;

  const bom: RackingBOM = {
    rails: {
      qty: railQty,
      lengthFt: railLengthFt,
      unit: 'ea',
      description: isRailBased
        ? `${system.manufacturer} ${system.rail?.model} Rail — ${railLengthFt.toFixed(1)} ft each`
        : 'N/A — Rail-less or ballasted system',
      partNumber: system.rail?.model ?? 'N/A',
    },
    railSplices: {
      qty: totalSplices,
      unit: 'ea',
      description: isRailBased ? `${system.manufacturer} Rail Splice` : 'N/A',
      partNumber: hw.railSplice,
    },
    mounts: {
      qty: mountQty,
      unit: 'ea',
      description: `${system.manufacturer} ${system.mount.model} (${mountLayout.mountSpacingIn}" spacing)`,
      partNumber: system.mount.model,
    },
    lFeet: {
      qty: mountQty,
      unit: 'ea',
      description: `${system.manufacturer} L-Foot / Mount Base`,
      partNumber: system.mount.model,
    },
    midClamps: {
      qty: midClampQty,
      unit: 'ea',
      description: `${system.manufacturer} ${hw.midClamp}`,
      partNumber: hw.midClamp,
    },
    endClamps: {
      qty: endClampQty,
      unit: 'ea',
      description: `${system.manufacturer} ${hw.endClamp}`,
      partNumber: hw.endClamp,
    },
    groundLugs: {
      qty: groundLugQty,
      unit: 'ea',
      description: `${system.manufacturer} ${hw.groundLug} (1 per 2 panels, NEC 690.47)`,
      partNumber: hw.groundLug,
    },
    lagBolts: {
      qty: lagBoltQty,
      unit: 'ea',
      description: lagBoltQty > 0
        ? `${hw.lagBolt} (${lagBoltsPerMount} per mount × ${mountQty} mounts)`
        : 'N/A — No penetrations',
      partNumber: hw.lagBolt,
    },
    flashingKits: {
      qty: flashingQty,
      unit: 'ea',
      description: needsFlashing ? (hw.flashingKit ?? `${system.manufacturer} Flashing Kit`) : 'N/A',
      partNumber: hw.flashingKit ?? 'N/A',
    },
    bondingClips: {
      qty: bondingClipQty,
      unit: 'ea',
      description: `${system.manufacturer} ${hw.bondingHardware} (1 per panel, UL 2703)`,
      partNumber: hw.bondingHardware,
    },
  };

  // ── Ballast Blocks (commercial) ────────────────────────────────────────
  if (isBallasted && ballastAnalysis) {
    bom.ballastBlocks = {
      qty: ballastAnalysis.totalBallastBlocks,
      weightLbs: ballastAnalysis.ballastWeightLbs,
      unit: 'ea',
      description: `${system.manufacturer} Ballast Block — ${system.ballast?.blockWeightLbs} lbs each`,
    };
  }

  // ── Piles (ground mount) ───────────────────────────────────────────────
  if (isGroundMount && groundMountAnalysis) {
    bom.piles = {
      qty: groundMountAnalysis.pileCount,
      unit: 'ea',
      description: `${system.manufacturer} ${system.mount.attachmentMethod.replace('_', ' ')} pile`,
      embedmentFt: groundMountAnalysis.pileEmbedmentFt,
    };
  }

  return bom;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE V4
// ─────────────────────────────────────────────────────────────────────────────

export function runStructuralCalcV4(input: StructuralInputV4): StructuralResultV4 {
  const errors: StructuralIssue[] = [];
  const warnings: StructuralIssue[] = [];
  const recommendations: string[] = [];

  // ── 1. Resolve mounting system ──────────────────────────────────────────
  const resolvedId = resolveMountingSystemId(input.mountingSystemId);
  let system = getMountingSystemById(resolvedId);
  if (!system) {
    system = getMountingSystemById('ironridge-xr100')!;
    warnings.push({
      code: 'UNKNOWN_MOUNTING_SYSTEM',
      message: `Mounting system '${input.mountingSystemId}' not found. Using IronRidge XR100.`,
      severity: 'warning',
      suggestion: 'Select a valid mounting system from the database',
    });
  }

  // ── 2. Array geometry ───────────────────────────────────────────────────
  const { rowCount: autoRows, colCount: autoCols } = autoLayout(input.panelCount);
  const rowCount = input.rowCount ?? autoRows;
  const colCount = input.colCount ?? autoCols;

  const geometryInput: ArrayLayoutInput = {
    panelCount: input.panelCount,
    panel: {
      lengthIn: input.panelLengthIn,
      widthIn: input.panelWidthIn,
      weightLbs: input.panelWeightLbs,
    },
    orientation: input.panelOrientation,
    rowCount,
    colCount,
    moduleGapIn: input.moduleGapIn ?? 0.5,
    rowGapIn: input.rowGapIn ?? 6,
    railOverhangIn: 6,
    railsPerRow: 2,
  };
  const geometry = computeArrayGeometry(geometryInput);

  // ── 3. Wind analysis (ASCE 7-22) ────────────────────────────────────────
  const heightFt = input.meanRoofHeight ?? 15;
  const qz = calcVelocityPressure(input.windSpeed, input.windExposure, heightFt);
  const roofZone: RoofZone = 'interior';
  const gcp = getGCp(roofZone, input.roofPitch);
  const netUpliftPsf = Math.abs(qz * gcp.uplift);
  const netDownwardPsf = qz * gcp.downward;

  const windAnalysis: WindAnalysis = {
    velocityPressurePsf: qz,
    netUpliftPressurePsf: netUpliftPsf,
    netDownwardPressurePsf: netDownwardPsf,
    roofZone,
    gcpUplift: gcp.uplift,
    gcpDownward: gcp.downward,
    exposureCoeff: getKz(heightFt, input.windExposure),
    designWindSpeedMph: input.windSpeed,
  };

  // ── 4. Snow analysis (ASCE 7-22) ────────────────────────────────────────
  const { roofSnow, Cs, Ct, Is } = calcRoofSnowLoad(input.groundSnowLoad, input.roofPitch);
  const snowAnalysis: SnowAnalysis = {
    groundSnowLoadPsf: input.groundSnowLoad,
    roofSnowLoadPsf: roofSnow,
    slopeFactor: Cs,
    thermalFactor: Ct,
    importanceFactor: Is,
  };

  // ── 5. PV dead load ─────────────────────────────────────────────────────
  const rackingWeightPerPanel = input.rackingWeightPerPanelLbs ?? 4.0;
  const totalSystemWeightLbs = geometry.totalPanelWeightLbs + input.panelCount * rackingWeightPerPanel;
  const arrayAreaFt2 = (geometry.arrayWidthIn / 12) * (geometry.arrayHeightIn / 12);
  const pvDeadLoadPsf = arrayAreaFt2 > 0 ? totalSystemWeightLbs / arrayAreaFt2 : 4.0;

  // ── 6. Mount layout ─────────────────────────────────────────────────────
  const mountLayout = calcMountLayout(geometry, system, netUpliftPsf);

  // Skip mount capacity check for ballasted/ground-mount systems — they use ballast or piles, not traditional mounts
  const skipMountCheck = input.installationType === 'commercial_ballasted' || 
                         input.installationType === 'ground_mount' || 
                         input.installationType === 'tracker' ||
                         system.systemType === 'ballasted_flat' ||
                         system.systemType === 'ground_single_post' ||
                         system.systemType === 'ground_dual_post' ||
                         system.systemType === 'ground_driven_pile' ||
                         system.systemType === 'ground_helical' ||
                         system.systemType === 'ground_concrete' ||
                         system.systemType === 'tracker_single_axis' ||
                         system.systemType === 'tracker_dual_axis';
  if (!skipMountCheck && mountLayout.safetyFactor < 1.5) {
    errors.push({
      code: 'MOUNT_INSUFFICIENT_CAPACITY',
      message: `Mount safety factor ${mountLayout.safetyFactor.toFixed(2)} < 1.5 required`,
      severity: 'error',
      suggestion: 'Upgrade to higher-capacity mount or reduce mount spacing',
      reference: 'ASCE 7-22 §26.10',
    });
  }

  // ── 7. Rail analysis ────────────────────────────────────────────────────
  const totalLoadPsf = (input.roofDeadLoadPsf ?? 15) + pvDeadLoadPsf + roofSnow;
  const railAnalysis = analyzeRail(geometry, system, mountLayout, totalLoadPsf);

  if (railAnalysis && !railAnalysis.passes) {
    if (railAnalysis.utilizationRatio > 1.0) {
      errors.push({
        code: 'RAIL_OVERSTRESSED',
        message: `Rail bending utilization ${(railAnalysis.utilizationRatio * 100).toFixed(0)}% exceeds 100%`,
        severity: 'error',
        suggestion: 'Reduce mount spacing or upgrade to heavier rail profile',
        reference: 'ASCE 7-22 / Manufacturer Engineering Data',
      });
    }
    if (mountLayout.mountSpacingIn > (system.rail?.maxSpanIn ?? 72)) {
      errors.push({
        code: 'RAIL_SPAN_EXCEEDED',
        message: `Mount spacing ${mountLayout.mountSpacingIn}" exceeds max rail span ${system.rail?.maxSpanIn}"`,
        severity: 'error',
        suggestion: 'Reduce mount spacing to within manufacturer limits',
        reference: system.iccEsReport ?? 'Manufacturer Engineering Data',
      });
    }
  }

  // ── 8. Rafter analysis (NDS 2018) ───────────────────────────────────────
  const rafterAnalysis = analyzeRafter(input, pvDeadLoadPsf, roofSnow);

  if (!rafterAnalysis.passes) {
    if (rafterAnalysis.framingType === 'truss') {
      warnings.push({
        code: 'TRUSS_OVERSTRESSED',
        message: `Truss utilization ${(rafterAnalysis.overallUtilization * 100).toFixed(0)}% exceeds 100%`,
        severity: 'warning',
        suggestion: 'Consult truss manufacturer for actual capacity',
        reference: 'BCSI / Truss Manufacturer Engineering Data',
      });
    } else {
      errors.push({
        code: 'RAFTER_OVERSTRESSED',
        message: `Rafter utilization ${(rafterAnalysis.overallUtilization * 100).toFixed(0)}% exceeds 100%`,
        severity: 'error',
        suggestion: 'Upgrade rafter size, reduce span, or reduce attachment spacing',
        reference: 'NDS 2018 / ASCE 7-22',
      });
    }
  }

  // ── 9. Commercial ballast analysis ──────────────────────────────────────
  let ballastAnalysis: BallastAnalysis | undefined;
  if (system.systemType === 'ballasted_flat') {
    ballastAnalysis = analyzeBallast(input, system, geometry, netUpliftPsf);
    if (!ballastAnalysis.passes) {
      errors.push({
        code: 'BALLAST_INSUFFICIENT',
        message: `Ballast insufficient: ${ballastAnalysis.blocksPerModule} blocks/module required`,
        severity: 'error',
        suggestion: 'Add more ballast blocks or use mechanically attached system',
        reference: 'ASCE 7-22 / Manufacturer Engineering Data',
      });
    }
  }

  // ── 10. Ground mount analysis ───────────────────────────────────────────
  let groundMountAnalysis: GroundMountAnalysis | undefined;
  if (['ground_single_post', 'ground_dual_post', 'ground_driven_pile',
       'ground_helical', 'ground_concrete'].includes(system.systemType)) {
    groundMountAnalysis = analyzeGroundMount(input, system, geometry, netUpliftPsf, netDownwardPsf);
    if (!groundMountAnalysis.passes) {
      errors.push({
        code: 'PILE_INSUFFICIENT_CAPACITY',
        message: `Pile safety factor insufficient (uplift SF=${groundMountAnalysis.safetyFactorUplift.toFixed(2)})`,
        severity: 'error',
        suggestion: 'Increase pile embedment depth or reduce pile spacing',
        reference: 'ASCE 7-22 / Geotechnical Engineering',
      });
    }
  }

  // ── 11. Tracker analysis ────────────────────────────────────────────────
  let trackerAnalysis: TrackerAnalysis | undefined;
  if (['tracker_single_axis', 'tracker_dual_axis'].includes(system.systemType)) {
    trackerAnalysis = analyzeTracker(input, system, geometry, netUpliftPsf);
    if (!trackerAnalysis.passes) {
      errors.push({
        code: 'TRACKER_WIND_EXCEEDED',
        message: `Design wind speed ${input.windSpeed} mph exceeds tracker max ${system.tracker?.windSpeedMaxMph} mph`,
        severity: 'error',
        suggestion: 'Use stow mode or select tracker rated for higher wind speed',
        reference: 'Manufacturer Engineering Data',
      });
    }
  }

  // ── 12. BOM ─────────────────────────────────────────────────────────────
  const rackingBOM = calcRackingBOM(geometry, system, mountLayout, ballastAnalysis, groundMountAnalysis);

  // ── 13. Recommendations ─────────────────────────────────────────────────
  if (input.windSpeed >= 130) {
    recommendations.push('High wind zone: verify all fastener embedment depths and use stainless steel hardware');
  }
  if (input.groundSnowLoad >= 40) {
    recommendations.push('High snow load: verify roof structure capacity with structural engineer');
  }
  if (mountLayout.spacingWasReduced) {
    recommendations.push(`Mount spacing auto-reduced to ${mountLayout.mountSpacingIn}" to achieve SF ≥ 1.5`);
  }
  if (input.framingType === 'unknown') {
    const detected = rafterAnalysis.framingType;
    recommendations.push(`Framing auto-detected as ${detected.toUpperCase()} (${input.rafterSpacingIn}" O.C.). Field-verify before installation.`);
  }
  if (system.iccEsReport) {
    recommendations.push(`Mounting system certified per ${system.iccEsReport}`);
  }

  // ── 14. Overall status ──────────────────────────────────────────────────
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const status = hasErrors ? 'FAIL' : hasWarnings ? 'WARNING' : 'PASS';

  return {
    status,
    installationType: input.installationType,
    arrayGeometry: geometry,
    wind: windAnalysis,
    snow: snowAnalysis,
    mountLayout,
    railAnalysis,
    rafterAnalysis,
    ballastAnalysis,
    groundMountAnalysis,
    trackerAnalysis,
    rackingBOM,
    totalSystemWeightLbs,
    addedDeadLoadPsf: pvDeadLoadPsf,
    mountingSystem: system,
    errors,
    warnings,
    recommendations,
    debugInfo: {
      framingTypeResolved: rafterAnalysis.framingType,
      autoDetectedFraming: input.framingType === 'unknown',
      mountSpacingIterations: 0,
      pvDeadLoadPsf,
    },
  };
}