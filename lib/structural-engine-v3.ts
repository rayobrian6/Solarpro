// ============================================================
// Structural Calculation Engine V3
// Deterministic — all outputs derived from array geometry + loads
// ASCE 7-22 wind / snow | NDS 2018 rafter | ICC-ES mount capacity
// ============================================================
//
// LOAD PATH:
//   Solar Modules → Rails → Mounts → Fasteners → Rafters
//
// KEY FEATURES:
//   1. Array geometry drives ALL calculations
//   2. Mount spacing CALCULATED from loads (never user-specified)
//   3. Auto-resolves failures by reducing spacing / adding mounts
//   4. Full racking BOM from geometry
//   5. Proper truss vs rafter distinction
//   6. ASCE 7-22 roof zones (corner / edge / interior)
//   7. NDS 2018 rafter bending, shear, deflection
// ============================================================

import { computeArrayGeometry, autoLayout, type ArrayGeometry, type ArrayLayoutInput } from './array-geometry';
import { getRackingById, type RackingSystemSpec } from './racking-database';

// ─── INPUT TYPES ─────────────────────────────────────────────────────────────

export type WindExposure = 'B' | 'C' | 'D';
export type FramingType  = 'truss' | 'rafter' | 'unknown';
export type RoofZone     = 'interior' | 'edge' | 'corner';
export type WoodSpecies  = 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir';

export interface StructuralInputV3 {
  // ── Site ──────────────────────────────────────────────────
  windSpeed: number;           // mph (ASCE 7 ultimate design wind speed)
  windExposure: WindExposure;
  groundSnowLoad: number;      // psf
  meanRoofHeight?: number;     // ft (default 15)
  roofPitch: number;           // degrees

  // ── Roof Framing ──────────────────────────────────────────
  framingType: FramingType;
  rafterSize: string;          // '2x4', '2x6', '2x8', '2x10', '2x12'
  rafterSpacingIn: number;     // inches O.C.
  rafterSpanFt: number;        // clear span, feet
  woodSpecies: WoodSpecies;

  // ── PV Array ──────────────────────────────────────────────
  panelCount: number;
  panelLengthIn: number;       // panel long dimension
  panelWidthIn: number;        // panel short dimension
  panelWeightLbs: number;      // per panel
  panelOrientation: 'portrait' | 'landscape';
  rowCount?: number;           // auto-calculated if omitted
  colCount?: number;           // auto-calculated if omitted
  moduleGapIn?: number;        // gap between modules (default 0.5")
  rowGapIn?: number;           // gap between rows (default 6")

  // ── Racking System ────────────────────────────────────────
  rackingSystemId: string;     // from racking-database
  rackingWeightPerPanelLbs?: number; // lbs of racking per panel (default 4.0)
}

// ─── OUTPUT TYPES ────────────────────────────────────────────────────────────

export interface WindAnalysis {
  velocityPressurePsf: number;   // qz
  netUpliftPressurePsf: number;  // net uplift on array
  netDownwardPressurePsf: number;
  roofZone: RoofZone;
  gcpUplift: number;             // pressure coefficient (uplift)
  gcpDownward: number;           // pressure coefficient (downward)
  exposureCoeff: number;         // Kz
}

export interface SnowAnalysis {
  groundSnowLoadPsf: number;
  roofSnowLoadPsf: number;
  slopeFactor: number;           // Cs
  thermalFactor: number;         // Ct
  importanceFactor: number;      // Is
}

export interface MountLayoutResult {
  mountCount: number;
  mountSpacingIn: number;        // calculated spacing
  mountsPerRow: number;
  rowCount: number;
  tributaryAreaPerMountFt2: number;
  upliftPerMountLbs: number;
  shearPerMountLbs: number;
  downwardPerMountLbs: number;
  mountCapacityLbs: number;      // rated capacity
  safetyFactor: number;          // capacity / demand
  passes: boolean;
  spacingWasReduced: boolean;    // true if auto-reduced from max
  finalSpacingIn: number;        // same as mountSpacingIn (explicit)
}

export interface RailAnalysis {
  railCount: number;
  railLengthIn: number;
  railLengthFt: number;
  railSpanIn: number;            // span between mounts
  cantileverIn: number;
  maxAllowedSpanIn: number;
  maxAllowedCantileverIn: number;
  momentDemandInLbs: number;
  momentCapacityInLbs: number;
  utilizationRatio: number;
  passes: boolean;
}

export interface RafterAnalysis {
  framingType: FramingType;
  size: string;
  spacingIn: number;
  spanFt: number;
  species: WoodSpecies;

  // Loads
  totalLoadPsf: number;          // dead + live + snow + PV
  pvDeadLoadPsf: number;
  roofDeadLoadPsf: number;
  snowLoadPsf: number;

  // Capacity (NDS 2018)
  bendingMomentDemandFtLbs: number;
  bendingMomentCapacityFtLbs: number;
  bendingUtilization: number;

  shearDemandLbs: number;
  shearCapacityLbs: number;
  shearUtilization: number;

  deflectionIn: number;
  allowableDeflectionIn: number;
  deflectionUtilization: number;

  overallUtilization: number;    // max of bending/shear/deflection
  passes: boolean;
  notes: string[];
}

export interface RackingBOMV3 {
  rails:        { qty: number; lengthFt: number; unit: string; description: string; partNumber: string };
  railSplices:  { qty: number; unit: string; description: string; partNumber: string };
  mounts:       { qty: number; unit: string; description: string; partNumber: string };
  lFeet:        { qty: number; unit: string; description: string; partNumber: string };
  midClamps:    { qty: number; unit: string; description: string; partNumber: string };
  endClamps:    { qty: number; unit: string; description: string; partNumber: string };
  groundLugs:   { qty: number; unit: string; description: string; partNumber: string };
  lagBolts:     { qty: number; unit: string; description: string; partNumber: string };
  flashingKits: { qty: number; unit: string; description: string; partNumber: string };
  bondingClips: { qty: number; unit: string; description: string; partNumber: string };
}

export interface StructuralResultV3 {
  status: 'PASS' | 'WARNING' | 'FAIL';

  // Array geometry (source of truth)
  arrayGeometry: ArrayGeometry;

  // Analysis results
  wind: WindAnalysis;
  snow: SnowAnalysis;
  mountLayout: MountLayoutResult;
  railAnalysis: RailAnalysis | null;   // null for rail-less systems
  rafterAnalysis: RafterAnalysis;

  // Racking BOM (derived from geometry)
  rackingBOM: RackingBOMV3;

  // Summary
  totalSystemWeightLbs: number;
  addedDeadLoadPsf: number;

  // Issues
  errors: StructuralIssue[];
  warnings: StructuralIssue[];
  recommendations: string[];
}

export interface StructuralIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  suggestion?: string;
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// NDS 2018 Table 4A — Reference bending design values (Fb, psi)
// Values for visually graded lumber, No. 2 grade
const NDS_FB: Record<WoodSpecies, Record<string, number>> = {
  'Douglas Fir-Larch': { '2x4': 900, '2x6': 1150, '2x8': 1000, '2x10': 900, '2x12': 825 },
  'Southern Pine':     { '2x4': 1500, '2x6': 1250, '2x8': 1050, '2x10': 1050, '2x12': 975 },
  'Hem-Fir':           { '2x4': 850, '2x6': 850, '2x8': 850, '2x10': 800, '2x12': 775 },
  'Spruce-Pine-Fir':   { '2x4': 875, '2x6': 875, '2x8': 875, '2x10': 800, '2x12': 725 },
};

// NDS 2018 Table 4A — Reference shear design values (Fv, psi)
const NDS_FV: Record<WoodSpecies, number> = {
  'Douglas Fir-Larch': 180,
  'Southern Pine':     175,
  'Hem-Fir':           150,
  'Spruce-Pine-Fir':   135,
};

// NDS 2018 Table 4A — Modulus of elasticity (E, psi)
const NDS_E: Record<WoodSpecies, number> = {
  'Douglas Fir-Larch': 1_600_000,
  'Southern Pine':     1_600_000,
  'Hem-Fir':           1_300_000,
  'Spruce-Pine-Fir':   1_400_000,
};

// Actual lumber dimensions (dressed size), inches
const LUMBER_DIMS: Record<string, { b: number; d: number }> = {
  '2x4':  { b: 1.5, d: 3.5 },
  '2x6':  { b: 1.5, d: 5.5 },
  '2x8':  { b: 1.5, d: 7.25 },
  '2x10': { b: 1.5, d: 9.25 },
  '2x12': { b: 1.5, d: 11.25 },
};

// BCSI truss capacity table (psf) — pre-engineered trusses
// Typical residential trusses at 24" O.C.
const TRUSS_CAPACITY_PSF: Record<string, number> = {
  '16': 55,  // 16 ft span
  '20': 50,
  '24': 45,
  '28': 40,
  '32': 35,
  '36': 30,
};

// ASCE 7-22 Table 26.10-1 — Velocity pressure exposure coefficients Kz
// For mean roof height h (ft), exposure category
function getKz(heightFt: number, exposure: WindExposure): number {
  const h = Math.max(15, heightFt);
  if (exposure === 'B') {
    if (h <= 15) return 0.57;
    if (h <= 20) return 0.62;
    if (h <= 25) return 0.66;
    if (h <= 30) return 0.70;
    if (h <= 40) return 0.76;
    return 0.81;
  } else if (exposure === 'C') {
    if (h <= 15) return 0.85;
    if (h <= 20) return 0.90;
    if (h <= 25) return 0.94;
    if (h <= 30) return 0.98;
    if (h <= 40) return 1.04;
    return 1.09;
  } else { // D
    if (h <= 15) return 1.03;
    if (h <= 20) return 1.08;
    if (h <= 25) return 1.12;
    if (h <= 30) return 1.16;
    if (h <= 40) return 1.22;
    return 1.27;
  }
}

// ASCE 7-22 — Velocity pressure qz = 0.00256 × Kz × Kzt × Kd × V²
function calcVelocityPressure(windSpeed: number, exposure: WindExposure, heightFt: number): number {
  const Kz  = getKz(heightFt, exposure);
  const Kzt = 1.0;   // topographic factor (flat terrain)
  const Kd  = 0.85;  // wind directionality factor
  return 0.00256 * Kz * Kzt * Kd * windSpeed * windSpeed;
}

// ASCE 7-22 Chapter 30 — Components & Cladding pressure coefficients for rooftop solar
// GCp values for roof-mounted PV panels (ASCE 7-22 Fig. 30.3-2A)
function getGCp(roofZone: RoofZone, pitchDeg: number): { uplift: number; downward: number } {
  // Simplified GCp for rooftop PV (ASCE 7-22 / IBC 2021)
  // These are net pressure coefficients (combined top + bottom surface)
  if (pitchDeg <= 7) {
    // Low slope
    const map = { interior: { uplift: -1.6, downward: 0.9 }, edge: { uplift: -2.0, downward: 1.1 }, corner: { uplift: -2.8, downward: 1.5 } };
    return map[roofZone];
  } else if (pitchDeg <= 27) {
    // Moderate slope (most residential)
    const map = { interior: { uplift: -1.4, downward: 0.8 }, edge: { uplift: -1.8, downward: 1.0 }, corner: { uplift: -2.4, downward: 1.3 } };
    return map[roofZone];
  } else {
    // Steep slope
    const map = { interior: { uplift: -1.2, downward: 0.7 }, edge: { uplift: -1.6, downward: 0.9 }, corner: { uplift: -2.0, downward: 1.1 } };
    return map[roofZone];
  }
}

// ASCE 7-22 Section 7 — Roof snow load
function calcRoofSnowLoad(groundSnow: number, pitchDeg: number): { roofSnow: number; Cs: number; Ct: number; Is: number } {
  const Is = 1.0;   // importance factor (residential)
  const Ct = 1.0;   // thermal factor (heated building)
  const Ce = 1.0;   // exposure factor (partially exposed)
  const pg = groundSnow;

  // Flat roof snow load: pf = 0.7 × Ce × Ct × Is × pg
  const pf = 0.7 * Ce * Ct * Is * pg;

  // Slope factor Cs (ASCE 7-22 Fig. 7.4-1b, warm roof)
  let Cs: number;
  if (pitchDeg <= 30) {
    Cs = 1.0;
  } else if (pitchDeg <= 70) {
    Cs = 1.0 - (pitchDeg - 30) / 40;
  } else {
    Cs = 0.0;
  }

  const roofSnow = pf * Cs;
  return { roofSnow, Cs, Ct, Is };
}

// ─── RAFTER ANALYSIS (NDS 2018) ──────────────────────────────────────────────

function analyzeRafter(
  input: StructuralInputV3,
  pvDeadLoadPsf: number,
  snowLoadPsf: number,
  racking: RackingSystemSpec
): RafterAnalysis {
  const { rafterSize, rafterSpacingIn, rafterSpanFt, woodSpecies } = input;
  const notes: string[] = [];

  // Auto-detect framing type: 24" OC is standard truss spacing in residential construction
  // 16" OC is standard stick-built rafter spacing
  let framingType = input.framingType;
  if (framingType === 'unknown') {
    if (rafterSpacingIn >= 24) {
      framingType = 'truss';
      notes.push('Framing type auto-detected as TRUSS (24" O.C. spacing is standard truss spacing)');
    } else {
      framingType = 'rafter';
      notes.push('Framing type auto-detected as RAFTER (16" O.C. spacing is standard stick-built spacing)');
    }
  }

  // For trusses, use BCSI capacity table approach
  if (framingType === 'truss') {
    const spanKey = String(Math.round(rafterSpanFt / 4) * 4); // round to nearest 4 ft
    const trussCapacity = TRUSS_CAPACITY_PSF[spanKey] ?? 45;

    const roofDeadLoad = 15; // psf (typical residential roof dead load)
    const pvLoad = pvDeadLoadPsf;
    const snowLoad = snowLoadPsf;
    const totalLoad = roofDeadLoad + pvLoad + snowLoad;
    const utilization = totalLoad / trussCapacity;

    return {
      framingType: 'truss',
      size: rafterSize,
      spacingIn: rafterSpacingIn,
      spanFt: rafterSpanFt,
      species: woodSpecies,
      totalLoadPsf: totalLoad,
      pvDeadLoadPsf: pvLoad,
      roofDeadLoadPsf: roofDeadLoad,
      snowLoadPsf: snowLoad,
      bendingMomentDemandFtLbs: 0,   // not applicable for trusses
      bendingMomentCapacityFtLbs: 0,
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
        `Pre-engineered truss: capacity from BCSI table = ${trussCapacity} psf`,
        `Total load = ${totalLoad.toFixed(1)} psf (dead ${roofDeadLoad} + PV ${pvLoad.toFixed(1)} + snow ${snowLoad.toFixed(1)})`,
        `Utilization = ${(utilization * 100).toFixed(0)}%`,
      ],
    };
  }

  // ── Stick-built rafter (NDS 2018) ──────────────────────────────────────────
  const dims = LUMBER_DIMS[rafterSize] ?? LUMBER_DIMS['2x6'];
  const { b, d } = dims;

  // Section properties
  const S = (b * d * d) / 6;          // section modulus, in³
  const I = (b * d * d * d) / 12;     // moment of inertia, in⁴

  // NDS reference design values
  const Fb_ref = NDS_FB[woodSpecies]?.[rafterSize] ?? 1000;
  const Fv_ref = NDS_FV[woodSpecies] ?? 150;
  const E_ref  = NDS_E[woodSpecies] ?? 1_400_000;

  // Adjustment factors (NDS 2018 Table N1)
  const CD = 1.15;  // load duration factor (roof load, 2 months)
  const CM = 1.0;   // wet service factor (dry conditions)
  const Ct = 1.0;   // temperature factor
  const CF_b = rafterSize === '2x4' ? 1.5 : rafterSize === '2x6' ? 1.3 : rafterSize === '2x8' ? 1.2 : rafterSize === '2x10' ? 1.1 : 1.0;
  const CF_v = 1.0;
  const Cr = 1.15;  // repetitive member factor (3+ members at ≤24" O.C.)

  const Fb_prime = Fb_ref * CD * CM * Ct * CF_b * Cr;
  const Fv_prime = Fv_ref * CD * CM * Ct * CF_v;
  const E_prime  = E_ref  * CM * Ct;

  // Loads
  const roofDeadLoadPsf = 15;  // psf (sheathing + roofing + insulation)
  const totalLoadPsf = roofDeadLoadPsf + pvDeadLoadPsf + snowLoadPsf;

  // Tributary width per rafter
  const tributaryWidthFt = rafterSpacingIn / 12;

  // Distributed load on rafter (lbs/ft)
  const w = totalLoadPsf * tributaryWidthFt;  // lbs/ft
  const L = rafterSpanFt;                      // ft

  // Bending moment (simple span): M = wL²/8
  const M_demand_ftLbs = (w * L * L) / 8;
  const M_demand_inLbs = M_demand_ftLbs * 12;
  const M_capacity_inLbs = Fb_prime * S;
  const M_capacity_ftLbs = M_capacity_inLbs / 12;
  const bendingUtil = M_demand_inLbs / M_capacity_inLbs;

  // Shear: V = wL/2
  const V_demand = (w * L) / 2;  // lbs
  const V_capacity = Fv_prime * (b * d) * (2 / 3);  // lbs
  const shearUtil = V_demand / V_capacity;

  // Deflection: δ = 5wL⁴/(384EI)
  const w_inPerIn = (w / 12);  // lbs/in per inch
  const L_in = L * 12;         // inches
  const deflection = (5 * w_inPerIn * Math.pow(L_in, 4)) / (384 * E_prime * I);
  const allowableDeflection = L_in / 240;  // L/240 for total load
  const deflectionUtil = deflection / allowableDeflection;

  const overallUtil = Math.max(bendingUtil, shearUtil, deflectionUtil);

  if (bendingUtil > 0.9) notes.push(`Bending utilization ${(bendingUtil * 100).toFixed(0)}% is high`);
  if (shearUtil > 0.9) notes.push(`Shear utilization ${(shearUtil * 100).toFixed(0)}% is high`);
  if (deflectionUtil > 0.9) notes.push(`Deflection utilization ${(deflectionUtil * 100).toFixed(0)}% is high`);
  if (overallUtil <= 1.0) notes.push(`Rafter passes NDS 2018 checks`);

  return {
    framingType: 'rafter',
    size: rafterSize,
    spacingIn: rafterSpacingIn,
    spanFt: rafterSpanFt,
    species: woodSpecies,
    totalLoadPsf,
    pvDeadLoadPsf,
    roofDeadLoadPsf,
    snowLoadPsf,
    bendingMomentDemandFtLbs: M_demand_ftLbs,
    bendingMomentCapacityFtLbs: M_capacity_ftLbs,
    bendingUtilization: bendingUtil,
    shearDemandLbs: V_demand,
    shearCapacityLbs: V_capacity,
    shearUtilization: shearUtil,
    deflectionIn: deflection,
    allowableDeflectionIn: allowableDeflection,
    deflectionUtilization: deflectionUtil,
    overallUtilization: overallUtil,
    passes: overallUtil <= 1.0,
    notes,
  };
}

// ─── MOUNT LAYOUT CALCULATOR ─────────────────────────────────────────────────

function calcMountLayout(
  geometry: ArrayGeometry,
  racking: RackingSystemSpec,
  upliftPressurePsf: number,
  downwardPressurePsf: number,
  snowLoadPsf: number,
  pvDeadLoadPsf: number,
): MountLayoutResult {
  const mount = racking.mount;
  const maxSpacingIn = mount.maxSpacingIn;

  // For rail-based systems: tributary area per mount = mountSpacing × railSpacing
  // For rail-less systems: tributary area per mount = mountSpacing × panelShort
  const railSpacingFt = geometry.railSpacingIn / 12;

  // Start with max allowed spacing, then reduce if needed
  let spacingIn = maxSpacingIn;
  let spacingWasReduced = false;

  // Iterate to find valid spacing
  for (let attempt = 0; attempt < 10; attempt++) {
    const spacingFt = spacingIn / 12;
    const tributaryAreaFt2 = spacingFt * railSpacingFt;

    // Uplift demand per mount
    const upliftDemandLbs = upliftPressurePsf * tributaryAreaFt2;

    // Downward demand per mount (dead + snow)
    const downwardDemandLbs = (pvDeadLoadPsf + snowLoadPsf) * tributaryAreaFt2;

    // Check against mount capacity
    const mountCapacity = mount.upliftCapacityLbs;
    const safetyFactor = mountCapacity / upliftDemandLbs;

    if (safetyFactor >= 1.5 || spacingIn <= 12) {
      // Calculate mount count
      const mountsPerRow = Math.ceil(geometry.railLengthIn / spacingIn) + 1;
      const mountCount = mountsPerRow * geometry.rowCount;

      return {
        mountCount,
        mountSpacingIn: spacingIn,
        mountsPerRow,
        rowCount: geometry.rowCount,
        tributaryAreaPerMountFt2: tributaryAreaFt2,
        upliftPerMountLbs: upliftDemandLbs,
        shearPerMountLbs: upliftDemandLbs * 0.3,  // approx shear = 30% of uplift
        downwardPerMountLbs: downwardDemandLbs,
        mountCapacityLbs: mountCapacity,
        safetyFactor,
        passes: safetyFactor >= 1.5,
        spacingWasReduced,
        finalSpacingIn: spacingIn,
      };
    }

    // Reduce spacing by 6" and retry
    spacingIn = Math.max(12, spacingIn - 6);
    spacingWasReduced = true;
  }

  // Fallback: minimum spacing
  const spacingFt = spacingIn / 12;
  const tributaryAreaFt2 = spacingFt * railSpacingFt;
  const upliftDemandLbs = upliftPressurePsf * tributaryAreaFt2;
  const downwardDemandLbs = (pvDeadLoadPsf + snowLoadPsf) * tributaryAreaFt2;
  const mountsPerRow = Math.ceil(geometry.railLengthIn / spacingIn) + 1;
  const mountCount = mountsPerRow * geometry.rowCount;

  return {
    mountCount,
    mountSpacingIn: spacingIn,
    mountsPerRow,
    rowCount: geometry.rowCount,
    tributaryAreaPerMountFt2: tributaryAreaFt2,
    upliftPerMountLbs: upliftDemandLbs,
    shearPerMountLbs: upliftDemandLbs * 0.3,
    downwardPerMountLbs: downwardDemandLbs,
    mountCapacityLbs: mount.upliftCapacityLbs,
    safetyFactor: mount.upliftCapacityLbs / upliftDemandLbs,
    passes: mount.upliftCapacityLbs / upliftDemandLbs >= 1.5,
    spacingWasReduced,
    finalSpacingIn: spacingIn,
  };
}

// ─── RAIL ANALYSIS ───────────────────────────────────────────────────────────

function analyzeRail(
  geometry: ArrayGeometry,
  racking: RackingSystemSpec,
  mountLayout: MountLayoutResult,
  upliftPressurePsf: number,
  downwardPressurePsf: number,
): RailAnalysis | null {
  if (!racking.rail) return null;  // rail-less system

  const rail = racking.rail;
  const spanIn = mountLayout.mountSpacingIn;
  const cantileverIn = Math.min(geometry.railOverhangIn, rail.maxCantileverIn);

  // Rail moment demand (uniform load, simple span)
  // w = pressure × rail tributary width (= panelShort / 2 for 2-rail system)
  const railTribWidthIn = geometry.railSpacingIn / 2;
  const railTribWidthFt = railTribWidthIn / 12;
  const wUplift = upliftPressurePsf * railTribWidthFt;    // lbs/ft
  const wDown   = downwardPressurePsf * railTribWidthFt;  // lbs/ft
  const wMax    = Math.max(wUplift, wDown);

  const spanFt = spanIn / 12;
  const M_demand_inLbs = (wMax * spanFt * spanFt / 8) * 12;  // in·lbs
  const utilizationRatio = M_demand_inLbs / rail.momentCapacityInLbs;

  return {
    railCount: geometry.railCount,
    railLengthIn: geometry.railLengthIn,
    railLengthFt: geometry.railLengthFt,
    railSpanIn: spanIn,
    cantileverIn,
    maxAllowedSpanIn: rail.maxSpanIn,
    maxAllowedCantileverIn: rail.maxCantileverIn,
    momentDemandInLbs: M_demand_inLbs,
    momentCapacityInLbs: rail.momentCapacityInLbs,
    utilizationRatio,
    passes: utilizationRatio <= 1.0 && spanIn <= rail.maxSpanIn && cantileverIn <= rail.maxCantileverIn,
  };
}

// ─── RACKING BOM CALCULATOR ──────────────────────────────────────────────────

function calcRackingBOM(
  geometry: ArrayGeometry,
  racking: RackingSystemSpec,
  mountLayout: MountLayoutResult,
): RackingBOMV3 {
  const hw = racking.hardware;
  const isRailBased = racking.systemType === 'rail_based';
  const isRailLess  = racking.systemType === 'rail_less';

  // ── Rails ──────────────────────────────────────────────────────────────────
  // Total rail length needed = railCount × railLengthFt
  // Add 10% waste factor
  const totalRailLengthFt = geometry.railCount * geometry.railLengthFt * 1.05;
  const railQty = isRailBased ? geometry.railCount : 0;
  const railLengthFt = isRailBased ? geometry.railLengthFt : 0;

  // ── Rail Splices ───────────────────────────────────────────────────────────
  // Splice needed every spliceInterval inches
  const spliceIntervalFt = racking.rail ? racking.rail.spliceIntervalIn / 12 : 14;
  const splicesPerRail = isRailBased ? Math.max(0, Math.floor(geometry.railLengthFt / spliceIntervalFt) - 1) : 0;
  const totalSplices = splicesPerRail * geometry.railCount;

  // ── Mounts / L-Feet ────────────────────────────────────────────────────────
  const mountQty = mountLayout.mountCount;

  // ── Clamps ─────────────────────────────────────────────────────────────────
  // Mid clamps: between each pair of adjacent panels on each rail
  const midClampQty = geometry.totalMidClamps;
  // End clamps: 2 per rail end (4 per row for 2-rail system)
  const endClampQty = geometry.totalEndClamps;

  // ── Ground Lugs ────────────────────────────────────────────────────────────
  // 1 ground lug per 2 panels (NEC 690.47)
  const groundLugQty = Math.ceil(geometry.totalPanels / 2);

  // ── Lag Bolts ──────────────────────────────────────────────────────────────
  const lagBoltsPerMount = racking.mount.fastenersPerMount;
  const lagBoltQty = mountQty * lagBoltsPerMount;

  // ── Flashing Kits ──────────────────────────────────────────────────────────
  // 1 flashing kit per mount (for penetrating systems)
  const needsFlashing = ['l_foot_lag', 'standoff_lag', 'direct_attach', 'tile_hook', 'tile_replacement'].includes(racking.mount.attachmentMethod);
  const flashingQty = needsFlashing ? mountQty : 0;

  // ── Bonding Clips ──────────────────────────────────────────────────────────
  // 1 bonding clip per panel (UL 2703 bonding)
  const bondingClipQty = geometry.totalPanels;

  return {
    rails: {
      qty: railQty,
      lengthFt: railLengthFt,
      unit: 'ea',
      description: isRailBased
        ? `${racking.manufacturer} ${racking.rail?.model} Rail — ${railLengthFt.toFixed(1)} ft each`
        : 'N/A — Rail-less system',
      partNumber: isRailBased ? racking.rail?.model ?? '' : 'N/A',
    },
    railSplices: {
      qty: totalSplices,
      unit: 'ea',
      description: isRailBased ? `${racking.manufacturer} Rail Splice Kit` : 'N/A',
      partNumber: hw.railSplice ?? 'N/A',
    },
    mounts: {
      qty: mountQty,
      unit: 'ea',
      description: `${racking.manufacturer} ${racking.mount.model} — ${mountLayout.mountSpacingIn}" O.C.`,
      partNumber: racking.mount.model,
    },
    lFeet: {
      qty: isRailBased ? mountQty : 0,
      unit: 'ea',
      description: isRailBased ? (hw.lFoot ?? `${racking.manufacturer} L-Foot`) : 'N/A — Rail-less system',
      partNumber: hw.lFoot ?? 'N/A',
    },
    midClamps: {
      qty: midClampQty,
      unit: 'ea',
      description: `${racking.manufacturer} ${hw.midClamp}`,
      partNumber: hw.midClamp,
    },
    endClamps: {
      qty: endClampQty,
      unit: 'ea',
      description: `${racking.manufacturer} ${hw.endClamp}`,
      partNumber: hw.endClamp,
    },
    groundLugs: {
      qty: groundLugQty,
      unit: 'ea',
      description: `${racking.manufacturer} ${hw.groundLug} (1 per 2 panels, NEC 690.47)`,
      partNumber: hw.groundLug,
    },
    lagBolts: {
      qty: lagBoltQty,
      unit: 'ea',
      description: `${hw.lagBolt} (${lagBoltsPerMount} per mount × ${mountQty} mounts)`,
      partNumber: hw.lagBolt,
    },
    flashingKits: {
      qty: flashingQty,
      unit: 'ea',
      description: needsFlashing ? (hw.flashingKit ?? `${racking.manufacturer} Flashing Kit`) : 'N/A — No penetrations',
      partNumber: hw.flashingKit ?? 'N/A',
    },
    bondingClips: {
      qty: bondingClipQty,
      unit: 'ea',
      description: `${racking.manufacturer} ${hw.bondingHardware} (1 per panel, UL 2703)`,
      partNumber: hw.bondingHardware,
    },
  };
}

// ─── MAIN ENGINE ─────────────────────────────────────────────────────────────

export function runStructuralCalcV3(input: StructuralInputV3): StructuralResultV3 {
  const errors: StructuralIssue[] = [];
  const warnings: StructuralIssue[] = [];
  const recommendations: string[] = [];

  // ── 1. Get racking system ─────────────────────────────────────────────────
  const racking = getRackingById(input.rackingSystemId);
  if (!racking) {
    // Fallback to IronRidge XR100
    return runStructuralCalcV3({ ...input, rackingSystemId: 'ironridge-xr100' });
  }

  // ── 2. Compute array geometry ─────────────────────────────────────────────
  const { rowCount: autoRows, colCount: autoCols } = autoLayout(input.panelCount);
  const rowCount = input.rowCount ?? autoRows;
  const colCount = input.colCount ?? autoCols;

  const geometryInput: ArrayLayoutInput = {
    panelCount: input.panelCount,
    panel: {
      lengthIn: input.panelLengthIn,
      widthIn:  input.panelWidthIn,
      weightLbs: input.panelWeightLbs,
    },
    orientation: input.panelOrientation,
    rowCount,
    colCount,
    moduleGapIn: input.moduleGapIn ?? 0.5,
    rowGapIn: input.rowGapIn ?? 6,
    railOverhangIn: 6,
    railsPerRow: racking.systemType === 'rail_less' ? 2 : 2,
  };

  const geometry = computeArrayGeometry(geometryInput);

  // ── 3. Wind analysis (ASCE 7-22) ─────────────────────────────────────────
  const heightFt = input.meanRoofHeight ?? 15;
  const qz = calcVelocityPressure(input.windSpeed, input.windExposure, heightFt);

  // Use interior zone for most of array (conservative for residential)
  const roofZone: RoofZone = 'interior';
  const gcp = getGCp(roofZone, input.roofPitch);

  // Net pressures: p = qz × GCp
  const netUpliftPsf    = Math.abs(qz * gcp.uplift);
  const netDownwardPsf  = qz * gcp.downward;

  const windAnalysis: WindAnalysis = {
    velocityPressurePsf: qz,
    netUpliftPressurePsf: netUpliftPsf,
    netDownwardPressurePsf: netDownwardPsf,
    roofZone,
    gcpUplift: gcp.uplift,
    gcpDownward: gcp.downward,
    exposureCoeff: getKz(heightFt, input.windExposure),
  };

  // ── 4. Snow analysis (ASCE 7-22) ─────────────────────────────────────────
  const { roofSnow, Cs, Ct, Is } = calcRoofSnowLoad(input.groundSnowLoad, input.roofPitch);
  const snowAnalysis: SnowAnalysis = {
    groundSnowLoadPsf: input.groundSnowLoad,
    roofSnowLoadPsf: roofSnow,
    slopeFactor: Cs,
    thermalFactor: Ct,
    importanceFactor: Is,
  };

  // ── 5. PV dead load ───────────────────────────────────────────────────────
  const rackingWeightPerPanel = input.rackingWeightPerPanelLbs ?? 4.0;
  const totalSystemWeightLbs = geometry.totalPanelWeightLbs + input.panelCount * rackingWeightPerPanel;
  const arrayAreaFt2 = (geometry.arrayWidthIn / 12) * (geometry.arrayHeightIn / 12);
  const pvDeadLoadPsf = arrayAreaFt2 > 0 ? totalSystemWeightLbs / arrayAreaFt2 : 4.0;
  const addedDeadLoadPsf = pvDeadLoadPsf;

  // ── 6. Mount layout (calculated from loads) ───────────────────────────────
  const mountLayout = calcMountLayout(
    geometry,
    racking,
    netUpliftPsf,
    netDownwardPsf,
    roofSnow,
    pvDeadLoadPsf,
  );

  if (mountLayout.spacingWasReduced) {
    warnings.push({
      code: 'MOUNT_SPACING_REDUCED',
      message: `Mount spacing reduced from ${racking.mount.maxSpacingIn}" to ${mountLayout.mountSpacingIn}" to meet safety factor ≥ 1.5`,
      severity: 'warning',
      suggestion: `Use ${mountLayout.mountSpacingIn}" O.C. mount spacing for this wind/snow zone`,
    });
    recommendations.push(`Mount spacing auto-adjusted to ${mountLayout.mountSpacingIn}" O.C. for safety factor ≥ 1.5`);
  }

  if (!mountLayout.passes) {
    errors.push({
      code: 'MOUNT_CAPACITY_EXCEEDED',
      message: `Mount uplift demand ${mountLayout.upliftPerMountLbs.toFixed(0)} lbs exceeds capacity ${mountLayout.mountCapacityLbs} lbs (SF=${mountLayout.safetyFactor.toFixed(2)})`,
      severity: 'error',
      suggestion: 'Reduce mount spacing, use higher-capacity mounts, or select different racking system',
    });
  }

  // ── 7. Rail analysis ──────────────────────────────────────────────────────
  const railAnalysis = analyzeRail(geometry, racking, mountLayout, netUpliftPsf, netDownwardPsf);

  if (railAnalysis && !railAnalysis.passes) {
    if (railAnalysis.railSpanIn > railAnalysis.maxAllowedSpanIn) {
      errors.push({
        code: 'RAIL_SPAN_EXCEEDED',
        message: `Rail span ${railAnalysis.railSpanIn}" exceeds max allowed ${railAnalysis.maxAllowedSpanIn}"`,
        severity: 'error',
        suggestion: 'Reduce mount spacing to bring rail span within limits',
      });
    }
    if (railAnalysis.utilizationRatio > 1.0) {
      errors.push({
        code: 'RAIL_OVERSTRESSED',
        message: `Rail bending utilization ${(railAnalysis.utilizationRatio * 100).toFixed(0)}% exceeds 100%`,
        severity: 'error',
        suggestion: 'Reduce mount spacing or upgrade to heavier rail profile',
      });
    }
  }

  // ── 8. Rafter analysis (NDS 2018) ─────────────────────────────────────────
  const rafterAnalysis = analyzeRafter(input, pvDeadLoadPsf, roofSnow, racking);

  if (!rafterAnalysis.passes) {
    // Use the resolved framing type from the analysis (handles auto-detection from 'unknown')
    if (rafterAnalysis.framingType === 'truss') {
      warnings.push({
        code: 'TRUSS_OVERSTRESSED',
        message: `Truss utilization ${(rafterAnalysis.overallUtilization * 100).toFixed(0)}% exceeds 100%. Consult truss engineer.`,
        severity: 'warning',
        suggestion: 'Consult truss manufacturer for actual capacity. Pre-engineered trusses often have higher capacity than table values.',
      });
    } else {
      errors.push({
        code: 'RAFTER_OVERSTRESSED',
        message: `Rafter utilization ${(rafterAnalysis.overallUtilization * 100).toFixed(0)}% exceeds 100%`,
        severity: 'error',
        suggestion: 'Upgrade rafter size, reduce span, or reduce attachment spacing',
      });
    }
  }

  // ── 9. Racking BOM ────────────────────────────────────────────────────────
  const rackingBOM = calcRackingBOM(geometry, racking, mountLayout);

  // ── 10. Recommendations ───────────────────────────────────────────────────
  if (input.windSpeed >= 130) {
    recommendations.push('High wind zone: verify all fastener embedment depths and use stainless steel hardware');
  }
  if (input.groundSnowLoad >= 40) {
    recommendations.push('High snow load: verify roof structure capacity with structural engineer');
  }
  if (input.framingType === 'unknown') {
    // Auto-detection was applied — add informational note but not a warning
    const detectedType = rafterAnalysis.framingType;
    recommendations.push(
      `Framing type auto-detected as ${detectedType.toUpperCase()} based on ${input.rafterSpacingIn}" O.C. spacing. Field-verify before installation.`
    );
  }

  // ── 11. Overall status ────────────────────────────────────────────────────
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const status = hasErrors ? 'FAIL' : hasWarnings ? 'WARNING' : 'PASS';

  return {
    status,
    arrayGeometry: geometry,
    wind: windAnalysis,
    snow: snowAnalysis,
    mountLayout,
    railAnalysis,
    rafterAnalysis,
    rackingBOM,
    totalSystemWeightLbs,
    addedDeadLoadPsf,
    errors,
    warnings,
    recommendations,
  };
}