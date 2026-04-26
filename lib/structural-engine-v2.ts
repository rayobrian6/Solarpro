// ============================================================
// Structural Calculation Engine V2 — ASCE 7-22 / NDS 2018 / BCSI
// Realistic residential rooftop solar structural analysis
// ============================================================
//
// KEY IMPROVEMENTS OVER V1:
//   1. TRUSS vs RAFTER distinction — trusses use engineered capacity tables
//   2. MOUNT SPACING is CALCULATED (not user-specified)
//   3. RT-MINI mounting system with ICC-ES ESR-3575 capacities
//   4. RAIL SYSTEM with span/cantilever calculations
//   5. ASCE 7-22 ROOF ZONES (corner, edge, interior)
//   6. RACKING BOM generation (rails, mounts, clamps, etc.)
//
// ============================================================

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export type WindExposureCategory = 'B' | 'C' | 'D';
export type RoofType = 'shingle' | 'tile' | 'metal_standing_seam' | 'metal_corrugated' | 'flat_tpo' | 'flat_epdm' | 'flat_gravel';
export type FramingType = 'truss' | 'rafter' | 'unknown';
export type RafterSpecies = 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir';
export type RoofZone = 'interior' | 'edge' | 'corner';
export type PanelOrientation = 'portrait' | 'landscape';

export interface StructuralInputV2 {
  // Site
  windSpeed: number;           // mph (ASCE 7 ultimate design wind speed)
  windExposure: WindExposureCategory;
  groundSnowLoad: number;      // psf
  meanRoofHeight?: number;     // ft (default: 15)

  // Roof Framing
  framingType: FramingType;    // truss, rafter, or unknown
  rafterSize: string;          // e.g. "2x6", "2x8"
  rafterSpacing: number;       // inches on center
  rafterSpan: number;          // feet (clear span)
  rafterSpecies: RafterSpecies;
  sheathingType?: 'OSB' | 'plywood' | 'plank';
  sheathingThickness?: number; // inches
  roofPitch: number;           // degrees
  roofType: RoofType;

  // PV Array
  panelCount: number;
  panelLength: number;         // inches
  panelWidth: number;          // inches
  panelWeight: number;         // lbs per panel
  panelOrientation: PanelOrientation;
  rowCount: number;            // number of rail rows

  // Mounting System
  mountingSystem: 'rt-mini' | 'rail-based' | 'rail-less';
  rackingWeight?: number;      // lbs per panel (default: 4.0)

  // Optional: Override mount spacing (if user specifies)
  maxMountSpacing?: number;    // inches (if not provided, calculated)
}

export interface MountLayout {
  mountCount: number;
  mountSpacing: number;        // inches (calculated)
  mountsPerRow: number;
  tributaryAreaPerMount: number; // ft²
  upliftPerMount: number;      // lbs
  shearPerMount: number;       // lbs
  downwardPerMount: number;    // lbs
  positions: { row: number; x: number; y: number }[];
}

export interface RailSystem {
  railLength: number;          // inches per row
  railSpan: number;            // inches between mounts
  cantilever: number;          // inches (max cantilever)
  railCount: number;           // number of rails (2 per row typically)
  spliceCount: number;         // splices needed
  midClampCount: number;       // mid clamps
  endClampCount: number;       // end clamps
  lFootCount: number;          // L-feet (if rail-based)
}

export interface RackingBOM {
  rails: { qty: number; unit: string; description: string };
  railSplices: { qty: number; unit: string; description: string };
  mounts: { qty: number; unit: string; description: string };
  lFeet: { qty: number; unit: string; description: string };
  midClamps: { qty: number; unit: string; description: string };
  endClamps: { qty: number; unit: string; description: string };
  groundLugs: { qty: number; unit: string; description: string };
}

export interface StructuralResultV2 {
  status: 'PASS' | 'WARNING' | 'FAIL';
  
  // Framing Analysis
  framing: {
    type: FramingType;
    description: string;
    capacityPsf: number;       // design capacity (psf)
    actualLoadPsf: number;     // actual total load (psf)
    utilization: number;       // ratio
    passes: boolean;
    notes: string[];
  };
  
  // Mount Layout
  mountLayout: MountLayout;
  
  // Rail System (if applicable)
  railSystem: RailSystem | null;
  
  // Racking BOM
  rackingBOM: RackingBOM;
  
  // Wind Analysis
  wind: {
    velocityPressure: number;  // psf
    netUpliftPressure: number; // psf
    roofZone: RoofZone;
    gcP: number;               // pressure coefficient used
  };
  
  // Snow Analysis
  snow: {
    groundSnowLoad: number;    // psf
    roofSnowLoad: number;      // psf
    slopeFactor: number;       // Cs
  };
  
  // Summary
  totalSystemWeight: number;   // lbs
  addedDeadLoadPsf: number;    // psf added by PV
  
  // Issues and recommendations
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

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

// Truss design capacity by size and span (BCSI / TPI typical values)
// Units: psf total load capacity
const TRUSS_CAPACITY_TABLE: Record<string, Record<number, number>> = {
  '2x4': {
    12: 50, 14: 45, 16: 40, 18: 35, 20: 30, 24: 25
  },
  '2x6': {
    12: 65, 14: 60, 16: 55, 18: 50, 20: 45, 24: 40, 28: 35
  },
  '2x8': {
    12: 80, 14: 75, 16: 70, 18: 65, 20: 60, 24: 55, 28: 50, 32: 45
  },
  '2x10': {
    14: 90, 16: 85, 18: 80, 20: 75, 24: 70, 28: 65, 32: 60
  },
  '2x12': {
    14: 100, 16: 95, 18: 90, 20: 85, 24: 80, 28: 75, 32: 70
  }
};

// Rafter NDS Fb values (psi) - NDS 2018 Supplement Table 4A
const ALLOWABLE_Fb: Record<RafterSpecies, number> = {
  'Douglas Fir-Larch': 900,
  'Southern Pine': 1500,
  'Hem-Fir': 850,
  'Spruce-Pine-Fir': 875,
};

// Modulus of elasticity E (psi)
const MODULUS_E: Record<RafterSpecies, number> = {
  'Douglas Fir-Larch': 1_600_000,
  'Southern Pine': 1_600_000,
  'Hem-Fir': 1_300_000,
  'Spruce-Pine-Fir': 1_400_000,
};

// Rafter section properties (actual dimensions)
const RAFTER_PROPERTIES: Record<string, { b: number; d: number }> = {
  '2x4':  { b: 1.5, d: 3.5 },
  '2x6':  { b: 1.5, d: 5.5 },
  '2x8':  { b: 1.5, d: 7.25 },
  '2x10': { b: 1.5, d: 9.25 },
  '2x12': { b: 1.5, d: 11.25 },
};

// Roof dead loads by type (psf)
const ROOF_DEAD_LOADS: Record<RoofType, number> = {
  shingle: 10,
  tile: 25,
  metal_standing_seam: 5,
  metal_corrugated: 5,
  flat_tpo: 12,
  flat_epdm: 12,
  flat_gravel: 20,
};

// ASCE 7-22 Kz values (velocity pressure exposure coefficient)
const KZ_TABLE: Record<WindExposureCategory, number> = {
  B: 0.70,
  C: 0.85,
  D: 1.03,
};

// ASCE 7-22 Figure 29.4-7 GCp values for rooftop solar
const GCP_BY_ZONE: Record<RoofZone, { uplift: number; downward: number }> = {
  interior: { uplift: -1.5, downward: 0.5 },
  edge: { uplift: -2.0, downward: 0.8 },
  corner: { uplift: -2.5, downward: 1.2 },
};

// RT-MINI mounting system specs (ICC-ES ESR-3575)
const RT_MINI_SPECS = {
  pullOutCapacityPerLag: 450,    // lbs per 5/16" lag bolt (DFir)
  shearCapacityPerLag: 350,      // lbs per lag bolt
  upliftCapacityPerLag: 450,     // lbs per lag bolt (2.5" embedment)
  fastenersPerMount: 2,          // 2 lag bolts per RT-MINI
  maxMountSpacing: 48,           // inches (rail-less)
  minEdgeDistance: 6,            // inches
};

// Typical rail system specs (IronRidge XR100 / Unirac SolarMount)
const RAIL_SPECS = {
  maxSpan: 72,                   // inches between mounts
  maxCantilever: 12,             // inches (or L/6)
  spliceInterval: 240,           // inches (20 ft)
};

// ─────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

function getTrussCapacity(size: string, span: number): number {
  const table = TRUSS_CAPACITY_TABLE[size];
  if (!table) return 40; // default conservative
  
  // Find closest span
  const spans = Object.keys(table).map(Number).sort((a, b) => a - b);
  const closestSpan = spans.reduce((prev, curr) => 
    Math.abs(curr - span) < Math.abs(prev - span) ? curr : prev
  );
  
  return table[closestSpan] || 40;
}

function calculateRafterCapacity(
  size: string,
  spacing: number,
  span: number,
  species: RafterSpecies
): { capacityPsf: number; utilization: number } {
  const props = RAFTER_PROPERTIES[size] || RAFTER_PROPERTIES['2x6'];
  const Fb_base = ALLOWABLE_Fb[species];
  const E = MODULUS_E[species];
  
  // Adjustment factors
  const Cd = 1.15; // snow load duration
  const Cr = spacing <= 24 ? 1.15 : 1.0; // repetitive member
  const Fb_prime = Fb_base * Cd * Cr;
  
  // Section properties
  const S = (props.b * props.d ** 2) / 6; // in³
  const I = (props.b * props.d ** 3) / 12; // in⁴
  
  // Allowable moment
  const M_allow = (Fb_prime * S) / 12; // ft-lbs
  
  // Tributary width
  const tribWidth = spacing / 12; // ft
  
  // Back-calculate capacity in psf
  // M = wL²/8, where w = load_psf × trib_width
  // load_psf = M_allow × 8 / (L² × trib_width)
  const capacityPsf = (M_allow * 8) / (span ** 2 * tribWidth);
  
  return { capacityPsf, utilization: 0 };
}

function determineFramingType(input: StructuralInputV2): FramingType {
  // If explicitly specified, use it
  if (input.framingType !== 'unknown') {
    return input.framingType;
  }
  
  // Heuristic: 24" OC spacing typically indicates truss
  // 16" OC spacing typically indicates rafter
  // This is a simplification - in practice, ask the user or inspector
  
  if (input.rafterSpacing >= 24) {
    return 'truss'; // Modern construction typically uses trusses at 24" OC
  } else if (input.rafterSpacing <= 16) {
    return 'rafter'; // Older construction typically uses rafters at 16" OC
  }
  
  // Default to truss for modern construction
  return 'truss';
}

function calculateWindLoads(
  windSpeed: number,
  exposure: WindExposureCategory,
  roofZone: RoofZone
): { velocityPressure: number; netUpliftPressure: number; gcP: number } {
  const Kz = KZ_TABLE[exposure];
  const Kzt = 1.0; // flat terrain
  const Kd = 0.85; // directionality
  
  // Velocity pressure qz = 0.00256 × Kz × Kzt × Kd × V²
  const velocityPressure = 0.00256 * Kz * Kzt * Kd * windSpeed ** 2;
  
  // GCp for rooftop PV
  const gcP_values = GCP_BY_ZONE[roofZone];
  const GCpi = 0.18; // internal pressure (enclosed building)
  
  // Net uplift pressure = qz × (|GCp| + GCpi)
  const netUpliftPressure = velocityPressure * (Math.abs(gcP_values.uplift) + GCpi);
  
  return { velocityPressure, netUpliftPressure, gcP: gcP_values.uplift };
}

function calculateSnowLoad(
  groundSnowLoad: number,
  roofPitch: number
): { roofSnowLoad: number; slopeFactor: number } {
  // ASCE 7-22 slope factor Cs
  let Cs = 1.0;
  if (roofPitch > 30) {
    Cs = Math.max(0, 1 - (roofPitch - 30) / 40);
  }
  
  // Roof snow load = Cs × Ce × Ct × Is × Pg
  // Assuming Ce=1.0, Ct=1.0, Is=1.0 for residential
  const roofSnowLoad = Cs * groundSnowLoad;
  
  return { roofSnowLoad, slopeFactor: Cs };
}

function calculateMountSpacing(
  netUpliftPressure: number,
  railSpan: number,
  mountCapacity: number,
  targetSafetyFactor: number = 2.0
): number {
  // Calculate maximum mount spacing based on uplift
  // Uplift per mount = netUpliftPressure x tributaryArea
  // tributaryArea = mountSpacing x railSpan / 144
  // 
  // For target SF: mountSpacing = (mountCapacity / (netUpliftPressure x SF)) x 144 / railSpan
  
  const maxSpacingInches = (mountCapacity / (netUpliftPressure * targetSafetyFactor)) * 144 / railSpan;
  
  // Round down to nearest 6" increment
  // Minimum 24" spacing, maximum 72"
  const roundedSpacing = Math.floor(maxSpacingInches / 6) * 6;
  return Math.max(24, Math.min(72, roundedSpacing));
}

function calculateMountLayout(
  panelCount: number,
  panelWidth: number,
  panelLength: number,
  orientation: PanelOrientation,
  rowCount: number,
  mountSpacing: number,
  railSpan: number,
  netUpliftPressure: number
): MountLayout {
  // Effective panel dimension along rail
  const panelDimension = orientation === 'landscape' ? panelLength : panelWidth;
  
  // Panels per row
  const panelsPerRow = Math.ceil(panelCount / rowCount);
  
  // Rail length = panels + small overhang
  const railLength = panelsPerRow * panelDimension + 12; // 6" overhang each end
  
  // Mounts per row
  // Start with mounts at each end, then space intermediate mounts
  const mountsPerRow = Math.ceil(railLength / mountSpacing) + 1;
  const actualSpacing = railLength / (mountsPerRow - 1);
  
  // Total mounts
  const mountCount = mountsPerRow * rowCount;
  
  // Tributary area per mount
  const tributaryArea = (actualSpacing * railSpan) / 144; // ft²
  
  // Forces per mount
  const upliftPerMount = netUpliftPressure * tributaryArea;
  const shearPerMount = 0; // Simplified - would need wind shear calc
  const downwardPerMount = 0; // Simplified - would need dead load calc
  
  // Generate positions (simplified for now)
  const positions: { row: number; x: number; y: number }[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let m = 0; m < mountsPerRow; m++) {
      positions.push({
        row: row + 1,
        x: m * actualSpacing,
        y: row * railSpan
      });
    }
  }
  
  return {
    mountCount,
    mountSpacing: actualSpacing,
    mountsPerRow,
    tributaryAreaPerMount: tributaryArea,
    upliftPerMount,
    shearPerMount,
    downwardPerMount,
    positions
  };
}

function calculateRailSystem(
  panelCount: number,
  panelDimension: number,
  rowCount: number,
  mountLayout: MountLayout
): RailSystem {
  const panelsPerRow = Math.ceil(panelCount / rowCount);
  const railLength = panelsPerRow * panelDimension + 12;
  
  // 2 rails per row (standard)
  const railCount = rowCount * 2;
  
  // Splices needed (every 20 ft)
  const railLengthFt = railLength / 12;
  const spliceCount = Math.ceil(railLengthFt / 20) * rowCount * 2;
  
  // Mid clamps: between each panel pair
  const midClampCount = (panelsPerRow - 1) * rowCount * 2;
  
  // End clamps: 2 per row (one at each end)
  const endClampCount = rowCount * 4;
  
  return {
    railLength,
    railSpan: mountLayout.mountSpacing,
    cantilever: Math.min(mountLayout.mountSpacing / 6, 12),
    railCount,
    spliceCount,
    midClampCount,
    endClampCount,
    lFootCount: mountLayout.mountCount // One L-foot per mount
  };
}

function generateRackingBOM(
  mountingSystem: 'rt-mini' | 'rail-based' | 'rail-less',
  railSystem: RailSystem | null,
  mountLayout: MountLayout
): RackingBOM {
  if (mountingSystem === 'rt-mini') {
    // RT-MINI is rail-less
    return {
      rails: { qty: 0, unit: 'EA', description: 'N/A (rail-less system)' },
      railSplices: { qty: 0, unit: 'EA', description: 'N/A' },
      mounts: { 
        qty: mountLayout.mountCount, 
        unit: 'EA', 
        description: 'Roof Tech RT-MINI mount with integrated flashing' 
      },
      lFeet: { qty: 0, unit: 'EA', description: 'N/A (direct attach)' },
      midClamps: { 
        qty: Math.ceil(mountLayout.mountCount / 4), 
        unit: 'EA', 
        description: 'RT-MINI mid clamp' 
      },
      endClamps: { 
        qty: Math.ceil(mountLayout.mountCount / 8), 
        unit: 'EA', 
        description: 'RT-MINI end clamp' 
      },
      groundLugs: { qty: 1, unit: 'EA', description: 'Grounding lug' }
    };
  }
  
  // Rail-based system
  if (!railSystem) {
    return {
      rails: { qty: 0, unit: 'EA', description: 'Error: rail system not calculated' },
      railSplices: { qty: 0, unit: 'EA', description: '' },
      mounts: { qty: 0, unit: 'EA', description: '' },
      lFeet: { qty: 0, unit: 'EA', description: '' },
      midClamps: { qty: 0, unit: 'EA', description: '' },
      endClamps: { qty: 0, unit: 'EA', description: '' },
      groundLugs: { qty: 0, unit: 'EA', description: '' }
    };
  }
  
  const railLengthFt = Math.ceil(railSystem.railLength / 12);
  
  return {
    rails: { 
      qty: railSystem.railCount, 
      unit: 'EA', 
      description: `${railLengthFt}' rail (${railSystem.railCount / 2} rows × 2 rails)` 
    },
    railSplices: { 
      qty: railSystem.spliceCount, 
      unit: 'EA', 
      description: 'Rail splice kit' 
    },
    mounts: { 
      qty: mountLayout.mountCount, 
      unit: 'EA', 
      description: 'Roof mount with flashing' 
    },
    lFeet: { 
      qty: railSystem.lFootCount, 
      unit: 'EA', 
      description: 'L-foot bracket' 
    },
    midClamps: { 
      qty: railSystem.midClampCount, 
      unit: 'EA', 
      description: 'Mid clamp' 
    },
    endClamps: { 
      qty: railSystem.endClampCount, 
      unit: 'EA', 
      description: 'End clamp' 
    },
    groundLugs: { qty: 1, unit: 'EA', description: 'Grounding lug' }
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────

export function runStructuralCalcV2(input: StructuralInputV2): StructuralResultV2 {
  const errors: StructuralIssue[] = [];
  const warnings: StructuralIssue[] = [];
  const recommendations: string[] = [];
  
  // ─── Determine framing type ───
  const framingType = determineFramingType(input);
  
  // ─── Calculate loads ───
  const existingDeadLoad = ROOF_DEAD_LOADS[input.roofType];
  const pvDeadLoad = (input.rackingWeight ?? 4.0) + (input.panelWeight / ((input.panelLength * input.panelWidth) / 144));
  const totalDeadLoad = existingDeadLoad + pvDeadLoad;
  
  const { roofSnowLoad, slopeFactor } = calculateSnowLoad(input.groundSnowLoad, input.roofPitch);
  
  // Total load on roof
  const totalLoadPsf = totalDeadLoad + roofSnowLoad;
  
  // ─── Wind analysis (assuming interior zone for initial calculation) ───
  const roofZone: RoofZone = 'interior'; // TODO: Calculate based on array position
  const { velocityPressure, netUpliftPressure, gcP } = calculateWindLoads(
    input.windSpeed,
    input.windExposure,
    roofZone
  );
  
  // ─── Framing capacity check ───
  let framingCapacityPsf: number;
  let framingNotes: string[] = [];
  
  if (framingType === 'truss') {
    // Use truss capacity table
    framingCapacityPsf = getTrussCapacity(input.rafterSize, input.rafterSpan);
    framingNotes.push(`Pre-engineered ${input.rafterSize} truss at ${input.rafterSpacing}" OC`);
    framingNotes.push(`Design capacity: ${framingCapacityPsf} psf (BCSI typical)`);
    framingNotes.push(`Truss span: ${input.rafterSpan}'`);
  } else {
    // Use NDS rafter calculation
    const rafterResult = calculateRafterCapacity(
      input.rafterSize,
      input.rafterSpacing,
      input.rafterSpan,
      input.rafterSpecies
    );
    framingCapacityPsf = rafterResult.capacityPsf;
    framingNotes.push(`Stick-built ${input.rafterSize} rafter at ${input.rafterSpacing}" OC`);
    framingNotes.push(`NDS 2018 bending capacity: ${framingCapacityPsf.toFixed(1)} psf`);
  }
  
  const framingUtilization = totalLoadPsf / framingCapacityPsf;
  const framingPasses = framingUtilization <= 1.0;
  
  if (!framingPasses) {
    errors.push({
      code: 'E-FRAMING-CAPACITY',
      message: `${framingType === 'truss' ? 'Truss' : 'Rafter'} utilization ${(framingUtilization * 100).toFixed(0)}% exceeds 100%`,
      severity: 'error',
      suggestion: framingType === 'truss' 
        ? 'Consult truss engineer for capacity verification' 
        : 'Consider upgrading rafter size or reducing span'
    });
  }
  
  // ─── Mount spacing calculation ───
  // Effective rail span (distance between rail rows)
  const railSpan = input.panelOrientation === 'portrait' ? input.panelWidth : input.panelLength;
  
  // Mount capacity (RT-MINI: 2 lags × 450 lbs each)
  const mountCapacity = RT_MINI_SPECS.fastenersPerMount * RT_MINI_SPECS.upliftCapacityPerLag;
  
  // Calculate max mount spacing for target SF = 2.0
  // This ensures mount spacing is DERIVED from loads, not user-specified
  let calculatedMountSpacing = calculateMountSpacing(
    netUpliftPressure,
    railSpan,
    mountCapacity,
    2.0  // target safety factor
  );
  
  // Cap at maximum allowed by mounting system
  const maxAllowed = input.mountingSystem === 'rt-mini' 
    ? RT_MINI_SPECS.maxMountSpacing 
    : RAIL_SPECS.maxSpan;
  
  calculatedMountSpacing = Math.min(calculatedMountSpacing, maxAllowed);
  
  // User can specify tighter spacing, but not looser than calculated
  const mountSpacing = input.maxMountSpacing 
    ? Math.min(input.maxMountSpacing, calculatedMountSpacing)
    : calculatedMountSpacing;
  
  // ─── Mount layout ───
  const panelDimension = input.panelOrientation === 'landscape' 
    ? input.panelLength 
    : input.panelWidth;
  
  const mountLayout = calculateMountLayout(
    input.panelCount,
    input.panelWidth,
    input.panelLength,
    input.panelOrientation,
    input.rowCount,
    mountSpacing,
    railSpan,
    netUpliftPressure
  );
  
  // ─── Safety factor check ───
  const safetyFactor = mountCapacity / mountLayout.upliftPerMount;
  
  if (safetyFactor < 1.5) {
    errors.push({
      code: 'E-MOUNT-SF',
      message: `Mount safety factor ${safetyFactor.toFixed(2)} is below minimum 1.5`,
      severity: 'error',
      suggestion: `Reduce mount spacing to ${Math.floor(mountSpacing * 0.8)}" or less`
    });
  } else if (safetyFactor < 2.0) {
    warnings.push({
      code: 'W-MOUNT-SF',
      message: `Mount safety factor ${safetyFactor.toFixed(2)} is marginal (minimum 1.5, recommended 2.0)`,
      severity: 'warning'
    });
  }
  
  // ─── Rail system (if applicable) ───
  let railSystem: RailSystem | null = null;
  
  if (input.mountingSystem === 'rail-based') {
    railSystem = calculateRailSystem(
      input.panelCount,
      panelDimension,
      input.rowCount,
      mountLayout
    );
  }
  
  // ─── Racking BOM ───
  const rackingBOM = generateRackingBOM(input.mountingSystem, railSystem, mountLayout);
  
  // ─── Total system weight ───
  const panelArea = (input.panelLength * input.panelWidth) / 144; // ft²
  const totalSystemWeight = (input.panelWeight + (input.rackingWeight ?? 4.0)) * input.panelCount;
  const addedDeadLoadPsf = (input.panelWeight + (input.rackingWeight ?? 4.0)) / panelArea;
  
  // ─── Status determination ───
  let status: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
  if (errors.length > 0) status = 'FAIL';
  else if (warnings.length > 0) status = 'WARNING';
  
  // ─── Recommendations ───
  if (status === 'PASS') {
    recommendations.push(
      `Structural analysis PASS — ${framingType} at ${(framingUtilization * 100).toFixed(0)}% utilization`
    );
    recommendations.push(
      `Mount spacing: ${mountSpacing}" (${mountLayout.mountCount} mounts total)`
    );
    recommendations.push(
      `Safety factor: ${safetyFactor.toFixed(2)} (min 1.5)`
    );
  }
  
  if (input.windSpeed > 140) {
    recommendations.push('High wind area: verify mounting system wind rating');
  }
  if (input.groundSnowLoad > 50) {
    recommendations.push('High snow load area: verify panel tilt allows snow shedding');
  }
  
  return {
    status,
    framing: {
      type: framingType,
      description: `${input.rafterSize} ${framingType} at ${input.rafterSpacing}" OC, ${input.rafterSpan}' span`,
      capacityPsf: framingCapacityPsf,
      actualLoadPsf: totalLoadPsf,
      utilization: framingUtilization,
      passes: framingPasses,
      notes: framingNotes
    },
    mountLayout,
    railSystem,
    rackingBOM,
    wind: {
      velocityPressure,
      netUpliftPressure,
      roofZone,
      gcP
    },
    snow: {
      groundSnowLoad: input.groundSnowLoad,
      roofSnowLoad,
      slopeFactor
    },
    totalSystemWeight,
    addedDeadLoadPsf,
    errors,
    warnings,
    recommendations
  };
}

// Export helper for getting RT-MINI specs
export function getRTMiniSpecs() {
  return RT_MINI_SPECS;
}

// Export helper for getting rail specs
export function getRailSpecs() {
  return RAIL_SPECS;
}