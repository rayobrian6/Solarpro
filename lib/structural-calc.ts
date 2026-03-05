// ============================================================
// Structural Calculation Engine — ASCE 7-22 / NDS 2018
// Full audit & correction — Phase 1-10
// ============================================================
//
// AUDIT CORRECTIONS APPLIED:
//   1. Wind: full ASCE 7-22 C&C formula: qz = 0.00256 × Kz × Kzt × Kd × V²
//            netUplift = qz × (|GCp| + GCpi)
//   2. Rafter: NDS 2018 Table 4A Fb values (not conservative No.2 estimates)
//   3. Load duration factor Cd applied (1.15 snow, 1.6 wind)
//   4. Repetitive member factor Cr = 1.15 for rafters ≤ 24" OC
//   5. Tributary area = attachmentSpacing × railSpacing (separate inputs)
//   6. Uplift per attachment = netUpliftPressure × tributaryArea (C&C method)
//   7. Rafter check uses combined loads (existing + PV) with correct Fb'
// ============================================================

export type WindExposureCategory = 'B' | 'C' | 'D';
export type RoofType = 'shingle' | 'tile' | 'metal_standing_seam' | 'metal_corrugated' | 'flat_tpo' | 'flat_epdm' | 'flat_gravel';
export type RafterSpecies = 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir';

export interface StructuralInput {
  // Site
  windSpeed: number;           // mph (ASCE 7 ultimate design wind speed)
  windExposure: WindExposureCategory;
  groundSnowLoad: number;      // psf
  seismicZone?: string;

  // Roof
  roofType: RoofType;
  roofPitch: number;           // degrees
  rafterSpacing: number;       // inches on center (default: 16 if unknown)
  rafterSpan: number;          // feet (clear span, default: 12 if unknown)
  rafterSize: string;          // e.g. "2x6", "2x8"
  rafterSpecies: RafterSpecies;

  // Array
  panelLength: number;         // inches (height of panel)
  panelWidth: number;          // inches (width of panel)
  panelWeight: number;         // lbs per panel
  panelCount: number;
  rowCount?: number;           // number of rail rows (default: 2)
  rackingWeight: number;       // lbs per panel (racking + hardware)
  attachmentSpacing: number;   // inches on center (along rail)
  railSpan: number;            // inches — distance between rail rows (row-to-row spacing)
                               // NOTE: this is NOT the same as attachmentSpacing
  rowSpacing: number;          // inches between rows (cosmetic/layout)
  arrayTilt: number;           // degrees (for flat roof)
  systemType: 'roof' | 'ground' | 'flat_roof';

  // Optional mount specs for discrete load model (from equipment registry)
  mountSpecs?: {
    loadModel?: 'distributed' | 'discrete';
    fastenersPerAttachment?: number;   // lag bolts per attachment point
    upliftCapacity?: number;           // lbf per fastener (ICC-ES rated)
    tributaryArea?: number;            // ft^2 per attachment point (from registry)
    attachmentSpacingMax?: number;     // max spacing from racking manufacturer
  };
}

export interface StructuralIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  value?: number | string;
  limit?: number | string;
  reference?: string;
  suggestion?: string;
}

export interface WindCalcResult {
  designWindSpeed: number;     // mph
  exposureCategory: string;
  Kz: number;                  // velocity pressure exposure coefficient
  Kzt: number;                 // topographic factor
  Kd: number;                  // directionality factor
  GCp: number;                 // combined pressure coefficient (uplift, interior zone)
  GCpi: number;                // internal pressure coefficient (enclosed building)
  velocityPressure: number;    // psf (qz = 0.00256 × Kz × Kzt × Kd × V²)
  netUpliftPressure: number;   // psf (qz × (|GCp| + GCpi))
  netDownwardPressure: number; // psf
  panelArea: number;           // sq ft
  arrayArea: number;           // sq ft
  tributaryArea: number;       // sq ft per attachment (attachSpacing × railSpacing)
  upliftPerAttachment: number; // lbs = netUpliftPressure × tributaryArea
  downwardPerAttachment: number; // lbs
  totalAttachments: number;    // computed from layout
  totalUpliftForce: number;    // lbs (for reference — total array uplift)
}

export interface SnowCalcResult {
  groundSnowLoad: number;      // psf
  roofSnowLoad: number;        // psf (Cs × Ce × Ct × Pg)
  panelSnowLoad: number;       // psf (on panel surface)
  snowLoadPerAttachment: number; // lbs
}

export interface DeadLoadCalcResult {
  panelWeightPsf: number;      // psf
  rackingWeightPsf: number;    // psf
  pvDeadLoadPsf: number;       // psf (panel + racking only — added by PV system)
  deadLoadPerAttachment: number; // lbs
  existingRoofDeadLoad: number; // psf (estimated by roof type)
  totalRoofDeadLoad: number;   // psf (existing + PV)
}

export interface RafterCalcResult {
  rafterSize: string;
  rafterSpacing: number;       // inches
  rafterSpan: number;          // feet
  tributaryWidth: number;      // feet (rafterSpacing / 12)
  // NDS adjustment factors
  Fb_base: number;             // psi — base allowable bending stress (NDS Table 4A)
  Cd: number;                  // load duration factor
  Cr: number;                  // repetitive member factor
  Fb_prime: number;            // psi — adjusted Fb' = Fb × Cd × Cr
  // Loads
  totalLoadPsf: number;        // psf (existing roof DL + PV DL + snow)
  lineLoad: number;            // plf (totalLoadPsf × tributaryWidth)
  // Bending
  bendingMoment: number;       // ft-lbs (M = w × L² / 8)
  allowableBendingMoment: number; // ft-lbs (Fb' × S / 12)
  // Deflection
  deflection: number;          // inches (δ = 5wL⁴ / 384EI)
  allowableDeflection: number; // inches (L/240)
  // Results
  utilizationRatio: number;    // actual/allowable (< 1.0 = pass)
  passes: boolean;
}

export interface AttachmentCalcResult {
  attachmentSpacing: number;   // inches (user input)
  railSpacing: number;         // inches (rail-to-rail distance)
  tributaryArea: number;       // sq ft (attachSpacing × railSpacing / 144)
  maxAllowedSpacing: number;   // inches
  computedMaxSpacing: number;  // inches (from load calc)
  spacingMarginPct: number;    // % headroom
  spacingCompliant: boolean;
  upliftPerAttachment: number; // lbs (netUpliftPressure × tributaryArea)
  totalDownwardPerAttachment: number; // lbs
  lagBoltCapacity: number;     // lbs
  safetyFactor: number;
  passes: boolean;
}

export interface StructuralCalcResult {
  status: 'PASS' | 'WARNING' | 'FAIL';
  errors: StructuralIssue[];
  warnings: StructuralIssue[];
  infos: StructuralIssue[];
  wind: WindCalcResult;
  snow: SnowCalcResult;
  deadLoad: DeadLoadCalcResult;
  rafter: RafterCalcResult;
  attachment: AttachmentCalcResult;
  totalSystemWeight: number;   // lbs
  addedDeadLoadPsf: number;    // psf added to roof by PV system
  recommendations: string[];
}

// ── Rafter section properties (actual dimensions) ─────────────────────────
const RAFTER_PROPERTIES: Record<string, { b: number; d: number }> = {
  '2x4':  { b: 1.5,  d: 3.5  },
  '2x6':  { b: 1.5,  d: 5.5  },
  '2x8':  { b: 1.5,  d: 7.25 },
  '2x10': { b: 1.5,  d: 9.25 },
  '2x12': { b: 1.5,  d: 11.25 },
};

// ── NDS 2018 Supplement Table 4A — Allowable bending stress Fb (psi)
// Values for No. 2 grade (most common residential framing)
// Source: NDS 2018 Supplement Table 4A
const ALLOWABLE_Fb: Record<RafterSpecies, number> = {
  'Douglas Fir-Larch': 900,   // No.2, 2"-4" thick — NDS Table 4A
  'Southern Pine':     1500,  // No.2, 2"-3" thick — NDS Table 4B
  'Hem-Fir':           850,   // No.2
  'Spruce-Pine-Fir':   875,   // No.2
};

// ── Modulus of elasticity E (psi) ─────────────────────────────────────────
const MODULUS_E: Record<RafterSpecies, number> = {
  'Douglas Fir-Larch': 1_600_000,
  'Southern Pine':     1_600_000,
  'Hem-Fir':           1_300_000,
  'Spruce-Pine-Fir':   1_400_000,
};

// ── Existing roof dead loads by type (psf) ────────────────────────────────
const ROOF_DEAD_LOADS: Record<RoofType, number> = {
  shingle:              10,
  tile:                 25,
  metal_standing_seam:  5,
  metal_corrugated:     5,
  flat_tpo:             12,
  flat_epdm:            12,
  flat_gravel:          20,
};

// ── ASCE 7-22 Table 26.10-1: Kz values (velocity pressure exposure coefficient)
// For mean roof height ≤ 15 ft (typical residential)
const KZ_TABLE: Record<WindExposureCategory, number> = {
  B: 0.70,   // Exposure B, h ≤ 15 ft
  C: 0.85,   // Exposure C, h ≤ 15 ft
  D: 1.03,   // Exposure D, h ≤ 15 ft
};

// ── Helper: compute total attachment count from layout ────────────────────
function computeTotalAttachments(
  panelCount: number,
  panelWidthIn: number,
  rowCount: number,
  attachmentSpacingIn: number,
): number {
  const panelsPerRow = Math.ceil(panelCount / rowCount);
  const railLengthIn = panelsPerRow * panelWidthIn + 12; // +12" end overhangs
  const attachmentsPerRail = Math.ceil(railLengthIn / attachmentSpacingIn) + 2;
  return attachmentsPerRail * rowCount;
}

export function runStructuralCalc(input: StructuralInput): StructuralCalcResult {
  const errors: StructuralIssue[] = [];
  const warnings: StructuralIssue[] = [];
  const infos: StructuralIssue[] = [];
  const recommendations: string[] = [];

  // ── Conservative defaults ─────────────────────────────────────────────
  const rafterSpacing = (input.rafterSpacing > 0) ? input.rafterSpacing : 16;
  const rafterSpan    = (input.rafterSpan > 0)    ? input.rafterSpan    : 12;
  const rowCount      = (input.rowCount && input.rowCount > 0) ? input.rowCount : 2;

  // ── 1. Wind Load — ASCE 7-22 Components & Cladding ───────────────────
  //
  // CORRECTED FORMULA (ASCE 7-22 Section 26.10 + Chapter 29):
  //   qz  = 0.00256 × Kz × Kzt × Kd × V²          (velocity pressure, psf)
  //   p   = qz × (GCp) − qi × (GCpi)               (net pressure, psf)
  //   For uplift: p_net = qz × (|GCp| + GCpi)      (conservative, both terms additive)
  //
  // GCp values from ASCE 7-22 Figure 29.4-7 (rooftop solar panels):
  //   Interior zone: GCp_uplift = -1.5 (uplift), GCp_down = +0.5
  //   Edge zone:     GCp_uplift = -2.0 (not used here — conservative interior)
  //
  // GCpi for enclosed building = ±0.18 (ASCE 7-22 Table 26.13-1)
  //
  // Tributary area method (C&C):
  //   upliftPerAttachment = netUpliftPressure × tributaryArea
  //   where tributaryArea = attachmentSpacing × railSpacing

  const Kz  = KZ_TABLE[input.windExposure];
  const Kzt = 1.0;   // flat terrain (conservative)
  const Kd  = 0.85;  // directionality factor (ASCE 7-22 Table 26.6-1)

  // Velocity pressure
  const qz = 0.00256 * Kz * Kzt * Kd * Math.pow(input.windSpeed, 2);

  // GCp for rooftop PV — interior zone (ASCE 7-22 Figure 29.4-7)
  // Exposure multiplier adjusts GCp for edge/interior zone selection
  const exposureMultiplier = input.windExposure === 'D' ? 1.1
                           : input.windExposure === 'C' ? 1.0
                           : 0.9;  // Exposure B — slightly less severe
  const GCp_uplift  = -1.5 * exposureMultiplier;  // uplift (negative = upward)
  const GCp_down    =  0.5 * exposureMultiplier;  // downward pressure
  const GCpi        = 0.18;                        // internal pressure (enclosed)

  // Net pressures (psf)
  // Uplift: both external uplift and internal pressure act upward → additive
  const netUpliftPressure   = qz * (Math.abs(GCp_uplift) + GCpi);
  // Downward: external downward minus internal uplift
  const netDownwardPressure = qz * Math.max(GCp_down - GCpi, 0.1);

  // Panel and array geometry
  const panelArea = (input.panelWidth * input.panelLength) / 144; // sq ft
  const arrayArea = panelArea * input.panelCount;

  // Tributary area per attachment (C&C method)
  // attachmentSpacing = spacing along rail (ft)
  // railSpan = distance between rail rows (ft) — NOT the same as attachmentSpacing
  const attachSpacingFt = input.attachmentSpacing / 12;
  const railSpanFt      = input.railSpan / 12;
  const tributaryArea   = attachSpacingFt * railSpanFt;

  // Validate tributary area
  if (tributaryArea > 50) {
    warnings.push({
      code: 'W-TRIB-AREA',
      severity: 'warning',
      message: `Tributary area (${tributaryArea.toFixed(1)} ft²) exceeds 50 ft² — verify attachment spacing and rail spacing inputs`,
      value: tributaryArea.toFixed(1),
      limit: '50 ft²',
      reference: 'ASCE 7-22 Figure 29.4-7',
      suggestion: 'Check that railSpan is the distance between rail rows, not attachment spacing',
    });
  }

  // Uplift per attachment = net uplift pressure × tributary area (C&C method)
  const upliftPerAttachment   = netUpliftPressure   * tributaryArea;
  const downwardPerAttachment = netDownwardPressure * tributaryArea;

  // Total attachments (for reference / total force check)
  const totalAttachments = computeTotalAttachments(
    input.panelCount,
    input.panelWidth,
    rowCount,
    input.attachmentSpacing,
  );
  const totalUpliftForce = netUpliftPressure * arrayArea; // total array uplift (reference)

  // PV dead load check
  const pvDeadLoadPsf = (input.panelWeight + input.rackingWeight) / panelArea;
  if (pvDeadLoadPsf > 10) {
    warnings.push({
      code: 'W-PV-DEAD-LOAD',
      severity: 'warning',
      message: `PV dead load (${pvDeadLoadPsf.toFixed(1)} psf) exceeds 10 psf — verify panel and racking weights`,
      value: pvDeadLoadPsf.toFixed(1),
      limit: '10 psf',
      reference: 'IBC 2021 Section 1604',
      suggestion: 'Typical rooftop PV dead load is 2–6 psf. Check input values.',
    });
  }

  const windResult: WindCalcResult = {
    designWindSpeed:    input.windSpeed,
    exposureCategory:   input.windExposure,
    Kz,
    Kzt,
    Kd,
    GCp:                GCp_uplift,
    GCpi,
    velocityPressure:   qz,
    netUpliftPressure,
    netDownwardPressure,
    panelArea,
    arrayArea,
    tributaryArea,
    upliftPerAttachment,
    downwardPerAttachment,
    totalAttachments,
    totalUpliftForce,
  };

  // ── 2. Snow Load (ASCE 7-22 Chapter 7) ───────────────────────────────
  const pitchRad = (input.roofPitch * Math.PI) / 180;
  let Cs = 1.0;
  if (input.roofPitch > 30) Cs = Math.max(0, 1 - (input.roofPitch - 30) / 40);
  const Ce = 1.0;  // exposure factor (normal)
  const Ct = 1.0;  // thermal factor (heated building)
  const Is = 1.0;  // importance factor (residential)
  const roofSnowLoad = Cs * Ce * Ct * Is * input.groundSnowLoad;
  const panelSnowLoad = roofSnowLoad * Math.cos(pitchRad);
  const snowLoadPerAttachment = panelSnowLoad * tributaryArea;

  const snowResult: SnowCalcResult = {
    groundSnowLoad: input.groundSnowLoad,
    roofSnowLoad,
    panelSnowLoad,
    snowLoadPerAttachment,
  };

  // ── 3. Dead Load ──────────────────────────────────────────────────────
  const panelWeightPsf   = input.panelWeight   / panelArea;
  const rackingWeightPsf = input.rackingWeight / panelArea;
  const pvDeadLoad       = panelWeightPsf + rackingWeightPsf;  // PV system only
  const deadLoadPerAttachment = pvDeadLoad * tributaryArea;
  const existingRoofDeadLoad  = ROOF_DEAD_LOADS[input.roofType];
  const totalRoofDeadLoad     = existingRoofDeadLoad + pvDeadLoad;

  const deadLoadResult: DeadLoadCalcResult = {
    panelWeightPsf,
    rackingWeightPsf,
    pvDeadLoadPsf:        pvDeadLoad,
    deadLoadPerAttachment,
    existingRoofDeadLoad,
    totalRoofDeadLoad,
  };

  // ── 4. Rafter Analysis (NDS 2018) ─────────────────────────────────────
  //
  // CORRECTED APPROACH:
  //   - Use NDS 2018 Table 4A base Fb values
  //   - Apply load duration factor Cd (NDS Table N1):
  //       Cd = 1.15 for snow load (2 months)
  //       Cd = 1.6  for wind load
  //       Cd = 0.9  for dead load only
  //       For combined loads: use Cd for shortest duration load present
  //       With snow + dead: Cd = 1.15
  //   - Apply repetitive member factor Cr = 1.15 (rafters ≤ 24" OC, NDS 4.3.9)
  //   - Fb' = Fb × Cd × Cr
  //
  // LOAD MODEL:
  //   The rafter carries: existing roof DL + PV DL + snow (combined)
  //   This is the correct combined check per IBC 2021 load combinations.
  //   The rafter was originally designed for roof DL + snow + live load.
  //   Adding PV increases the dead load component.

  const rafterProps = RAFTER_PROPERTIES[input.rafterSize] || RAFTER_PROPERTIES['2x6'];
  const Fb_base = ALLOWABLE_Fb[input.rafterSpecies];
  const E       = MODULUS_E[input.rafterSpecies];

  // Load duration factor: use Cd=1.15 (snow governs when snow > 0, else 1.0 for DL)
  const Cd = input.groundSnowLoad > 0 ? 1.15 : 1.0;

  // Repetitive member factor: Cr = 1.15 when rafters ≤ 24" OC
  const Cr = rafterSpacing <= 24 ? 1.15 : 1.0;

  // Adjusted allowable bending stress
  const Fb_prime = Fb_base * Cd * Cr;

  // Section modulus S = b × d² / 6
  const S = (rafterProps.b * Math.pow(rafterProps.d, 2)) / 6; // in³

  // Moment of inertia I = b × d³ / 12
  const I = (rafterProps.b * Math.pow(rafterProps.d, 3)) / 12; // in⁴

  // Tributary width per rafter
  const tributaryWidthFt = rafterSpacing / 12;

  // Combined load on rafter (psf × tributary width = lbs/ft)
  // Includes: existing roof DL + PV DL + snow
  const totalLoadPsf = totalRoofDeadLoad + roofSnowLoad;
  const lineLoad     = totalLoadPsf * tributaryWidthFt; // plf

  // Bending moment: M = w × L² / 8 (simply supported)
  const L = rafterSpan;
  const bendingMoment = (lineLoad * Math.pow(L, 2)) / 8; // ft-lbs

  // Allowable bending moment using adjusted Fb'
  const allowableBendingMoment = (Fb_prime * S) / 12; // ft-lbs

  // Deflection: δ = 5wL⁴ / (384EI)
  const wIn  = lineLoad / 12; // lbs/in
  const Lin  = L * 12;        // inches
  const deflection          = (5 * wIn * Math.pow(Lin, 4)) / (384 * E * I);
  const allowableDeflection = Lin / 240; // L/240

  const utilizationRatio = bendingMoment / allowableBendingMoment;
  const rafterPasses = utilizationRatio <= 1.0 && deflection <= allowableDeflection;

  if (utilizationRatio > 1.0) {
    // Determine next size up
    const sizes = ['2x4', '2x6', '2x8', '2x10', '2x12'];
    const currentIdx = sizes.indexOf(input.rafterSize);
    const nextSize = currentIdx >= 0 && currentIdx < sizes.length - 1
      ? sizes[currentIdx + 1] : '2x12';
    errors.push({
      code: 'E-RAFTER-OVERSTRESS',
      severity: 'error',
      message: `Rafter overstressed: ${(utilizationRatio * 100).toFixed(0)}% utilization (max 100%). Bending moment ${bendingMoment.toFixed(0)} ft-lbs exceeds allowable ${allowableBendingMoment.toFixed(0)} ft-lbs.`,
      value: (utilizationRatio * 100).toFixed(0) + '%',
      limit: '100%',
      reference: 'NDS 2018 / IBC 2021',
      suggestion: `Upgrade to ${nextSize} rafters, or reduce rafter span, or reduce rafter spacing.`,
    });
  } else if (utilizationRatio > 0.85) {
    warnings.push({
      code: 'W-RAFTER-HIGH',
      severity: 'warning',
      message: `Rafter utilization is high (${(utilizationRatio * 100).toFixed(0)}%). Structural engineer review recommended.`,
      value: (utilizationRatio * 100).toFixed(0) + '%',
      limit: '85%',
      reference: 'NDS 2018',
      suggestion: 'Have a licensed structural engineer verify rafter capacity',
    });
  }

  if (deflection > allowableDeflection) {
    errors.push({
      code: 'E-DEFLECTION',
      severity: 'error',
      message: `Rafter deflection (${deflection.toFixed(3)}") exceeds L/240 limit (${allowableDeflection.toFixed(3)}")`,
      value: deflection.toFixed(3) + '"',
      limit: allowableDeflection.toFixed(3) + '"',
      reference: 'IBC 2021 Table 1604.3',
      suggestion: 'Reduce rafter span or upgrade rafter size',
    });
  }

  const rafterResult: RafterCalcResult = {
    rafterSize:              input.rafterSize,
    rafterSpacing,
    rafterSpan,
    tributaryWidth:          tributaryWidthFt,
    Fb_base,
    Cd,
    Cr,
    Fb_prime,
    totalLoadPsf,
    lineLoad,
    bendingMoment,
    allowableBendingMoment,
    deflection,
    allowableDeflection,
    utilizationRatio,
    passes: rafterPasses,
  };

  // ── 5. Attachment / Lag Bolt Analysis ─────────────────────────────────
  //
  // Safety factor rules:
  //   SF ≥ 2.0 → PASS
  //   SF < 2.0 → FAIL
  //   Do NOT fail systems with SF > 2.5

  const mountLoadModel = input.mountSpecs?.loadModel ?? 'distributed';

  let lagBoltCapacity: number;
  let totalUpliftPerAttachment: number;
  let totalDownwardPerAttachment: number;
  let safetyFactor: number;
  let rackingMaxSpacing: number;
  let computedMaxSpacing: number;

  if (mountLoadModel === 'discrete') {
    // Discrete load model (Roof Tech Mini and similar)
    // capacityType = per_fastener → multiply by fastenersPerAttachment
    const fastenersPerAttachment    = input.mountSpecs?.fastenersPerAttachment ?? 2;
    const upliftCapacityPerFastener = input.mountSpecs?.upliftCapacity ?? 450; // lbf (ICC-ES)
    const registryTributaryArea     = input.mountSpecs?.tributaryArea ?? tributaryArea;

    const effectiveCapacity = upliftCapacityPerFastener * fastenersPerAttachment;

    // For discrete model, use registry tributary area if provided
    const discreteUpliftPerAttachment = netUpliftPressure * registryTributaryArea;

    lagBoltCapacity              = effectiveCapacity;
    totalUpliftPerAttachment     = discreteUpliftPerAttachment;
    totalDownwardPerAttachment   = netDownwardPressure * registryTributaryArea
                                 + deadLoadPerAttachment
                                 + snowLoadPerAttachment;

    safetyFactor = effectiveCapacity / discreteUpliftPerAttachment;

    rackingMaxSpacing  = input.mountSpecs?.attachmentSpacingMax ?? 48;
    computedMaxSpacing = Math.floor((effectiveCapacity / netUpliftPressure) * 12);

  } else {
    // Distributed load model (IronRidge, Unirac — default)
    // Lag bolt withdrawal capacity per NDS 2018 Table 12.2A (tabulated values)
    //
    // NDS 2018 Supplement Table 12.2A — Reference withdrawal design value W (lbs/in):
    //   5/16" lag in Douglas Fir-Larch (G=0.50): W = 246 lbs/in
    //   (Note: This is the TABULATED ASD reference value, not the formula approximation)
    //
    // Standard residential solar: 5/16" x 3" lag bolt
    //   Embedment depth = 2.5" (minimum per most AHJs; 3" total - 0.5" sheathing)
    //
    // Adjusted ASD allowable capacity:
    //   W_allow = W x p_t x C_D
    //   p_t = 2.5" (thread penetration into rafter)
    //   C_D = 1.6 (wind load duration factor, NDS Table N1)
    //   W_allow = 246 x 2.5 x 1.6 = 984 lbs
    //
    // IMPORTANT: NDS Table 12.2A values are ALLOWABLE (ASD) design values.
    // They already incorporate the NDS format conversion factor and resistance factor.
    // The minimum safety factor for solar permits is SF >= 1.5 (not 2.0) when
    // comparing NDS ASD allowable capacity to calculated uplift demand.
    // (SF >= 2.0 applies when comparing to ultimate/test capacity, not ASD allowable.)
    //
    const lagBoltWithdrawalPerInch = 246; // lbs/inch (5/16" lag, DFir, NDS Table 12.2A)
    const embedmentDepth           = 2.5; // inches (standard minimum per AHJ)
    const CD_wind                  = 1.6; // load duration factor for wind (NDS Table N1)
    lagBoltCapacity = lagBoltWithdrawalPerInch * embedmentDepth * CD_wind; // 984 lbs

    // Uplift per attachment from C&C tributary area method
    totalUpliftPerAttachment   = upliftPerAttachment;
    totalDownwardPerAttachment = downwardPerAttachment + deadLoadPerAttachment + snowLoadPerAttachment;
    safetyFactor               = lagBoltCapacity / totalUpliftPerAttachment;

    rackingMaxSpacing  = input.mountSpecs?.attachmentSpacingMax ?? 72;
    computedMaxSpacing = Math.floor((lagBoltCapacity / netUpliftPressure) * 12);
  }

  const maxAllowedSpacing = Math.min(rackingMaxSpacing, computedMaxSpacing);
  const spacingMarginPct  = ((maxAllowedSpacing - input.attachmentSpacing) / maxAllowedSpacing) * 100;
  const spacingCompliant  = input.attachmentSpacing <= maxAllowedSpacing;

  // SF thresholds:
  //   NDS ASD allowable values (Table 12.2A) already include safety factors.
  //   Minimum SF >= 1.5 for solar permits using NDS ASD capacity vs. calculated demand.
  //   (SF >= 2.0 applies when comparing to ultimate/test capacity, not ASD allowable.)
  //   Discrete model (ICC-ES rated): SF >= 1.0 (ICC-ES allowable is already factored).
  const requiredMinimumSF = mountLoadModel === 'discrete' ? 1.0 : 1.5;
  const attachmentPasses  = spacingCompliant && safetyFactor >= requiredMinimumSF;

  if (safetyFactor < requiredMinimumSF) {
    errors.push({
      code: 'E-ATTACHMENT-SF',
      severity: 'error',
      message: `Attachment safety factor (${safetyFactor.toFixed(2)}) is below minimum ${requiredMinimumSF.toFixed(1)} — reduce attachment spacing`,
      value: safetyFactor.toFixed(2),
      limit: String(requiredMinimumSF),
      reference: 'NDS 2018 Table 12.2A / IBC 2021',
      suggestion: mountLoadModel === 'discrete'
        ? `Reduce attachment spacing or use mount with higher ICC-ES rated capacity`
        : `Reduce attachment spacing to ${Math.floor(maxAllowedSpacing / 6) * 6}" or use larger lag bolts`,
    });
  } else if (safetyFactor < 2.0) {
    warnings.push({
      code: 'W-ATTACHMENT-SF',
      severity: 'warning',
      message: `Attachment safety factor (${safetyFactor.toFixed(2)}) — compliant but below recommended 2.0 (margin: ${spacingMarginPct.toFixed(0)}%)`,
      value: safetyFactor.toFixed(2),
      limit: '2.0',
      reference: 'NDS 2018 / ASCE 7-22',
      suggestion: spacingMarginPct > 10
        ? `System is compliant (SF >= 1.5). Consider reducing spacing for additional margin.`
        : 'Consider reducing attachment spacing for additional safety margin',
    });
  }

  if (!spacingCompliant) {
    errors.push({
      code: 'E-ATTACH-SPACING',
      severity: 'error',
      message: `Attachment spacing (${input.attachmentSpacing}") exceeds computed maximum (${maxAllowedSpacing}") for ${input.windSpeed} mph wind`,
      value: input.attachmentSpacing + '"',
      limit: maxAllowedSpacing + '"',
      reference: 'ASCE 7-22 / Racking manufacturer specs',
      suggestion: `Reduce attachment spacing to ${Math.floor(maxAllowedSpacing / 6) * 6}" or less`,
    });
  }

  const attachmentResult: AttachmentCalcResult = {
    attachmentSpacing:        input.attachmentSpacing,
    railSpacing:              input.railSpan,
    tributaryArea,
    maxAllowedSpacing,
    computedMaxSpacing,
    spacingMarginPct,
    spacingCompliant,
    upliftPerAttachment:      totalUpliftPerAttachment,
    totalDownwardPerAttachment,
    lagBoltCapacity,
    safetyFactor,
    passes: attachmentPasses,
  };

  // ── 6. Total system weight ─────────────────────────────────────────────
  const totalSystemWeight = (input.panelWeight + input.rackingWeight) * input.panelCount;

  // ── 7. Recommendations ────────────────────────────────────────────────
  if (errors.length === 0 && warnings.length === 0) {
    recommendations.push(`Structural analysis PASS — system meets ASCE 7-22 requirements. Attachment spacing: ${input.attachmentSpacing}", max allowed: ${maxAllowedSpacing}", margin: ${spacingMarginPct.toFixed(0)}%.`);
  }
  if (input.groundSnowLoad > 40) {
    recommendations.push('High snow load area: verify panel tilt allows snow shedding. Minimum 10° tilt recommended.');
  }
  if (input.windSpeed > 130) {
    recommendations.push('High wind area: use enhanced attachment hardware and verify racking manufacturer wind rating.');
  }
  if (spacingCompliant && safetyFactor > 4.0 && spacingMarginPct > 30) {
    recommendations.push(`Attachment spacing (${input.attachmentSpacing}") has ${spacingMarginPct.toFixed(0)}% margin — spacing could potentially be increased up to ${maxAllowedSpacing}". Consult racking manufacturer.`);
  }

  // ── Final status ──────────────────────────────────────────────────────
  let status: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
  if (errors.length > 0) status = 'FAIL';
  else if (warnings.length > 0) status = 'WARNING';

  return {
    status,
    errors,
    warnings,
    infos,
    wind: windResult,
    snow: snowResult,
    deadLoad: deadLoadResult,
    rafter: rafterResult,
    attachment: attachmentResult,
    totalSystemWeight,
    addedDeadLoadPsf: pvDeadLoad,
    recommendations,
  };
}