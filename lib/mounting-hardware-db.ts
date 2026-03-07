// ============================================================
// SolarPro Global Mounting Hardware Database
// Covers: Residential, Commercial, Ground Mount, Tracker, Fence
// Sources: Manufacturer ICC-ES ESR reports, engineering data sheets
// ============================================================

export type SystemCategory =
  | 'roof_residential'
  | 'roof_commercial'
  | 'ground_mount'
  | 'tracker'
  | 'solar_fence'
  | 'carport';

export type RoofType =
  | 'asphalt_shingle'
  | 'tile_concrete'
  | 'tile_clay'
  | 'metal_standing_seam'
  | 'metal_corrugated'
  | 'flat_tpo'
  | 'flat_epdm'
  | 'flat_pvc'
  | 'flat_gravel'
  | 'wood_shake'
  | 'slate'
  | 'any';

export type AttachmentMethod =
  | 'l_foot_lag'           // L-foot + lag bolt into rafter
  | 'tile_hook'            // Tile replacement hook
  | 'tile_replacement'     // Full tile replacement mount
  | 'standing_seam_clamp'  // S-5! style clamp, no penetration
  | 'corrugated_clamp'     // Corrugated metal clamp
  | 'ballasted'            // Ballast blocks, no penetration
  | 'mechanically_attached'// Screwed to roof deck
  | 'driven_pile'          // Steel pile driven into ground
  | 'helical_pile'         // Helical screw pile
  | 'concrete_pier'        // Concrete footing
  | 'direct_attach'        // Direct to structure
  | 'rail_less_lag';       // Rail-less direct lag

export type SystemType =
  | 'rail_based'
  | 'rail_less'
  | 'ballasted_flat'
  | 'mechanically_attached_flat'
  | 'tilt_leg'
  | 'ground_single_post'
  | 'ground_dual_post'
  | 'ground_driven_pile'
  | 'ground_helical'
  | 'ground_concrete'
  | 'tracker_single_axis'
  | 'tracker_dual_axis'
  | 'standing_seam'
  | 'solar_fence';

export interface RailSpec {
  model: string;
  materialAlloy: string;           // e.g. '6005-T5 aluminum'
  heightIn: number;                // rail height (inches)
  widthIn: number;                 // rail width (inches)
  wallThicknessIn: number;
  momentCapacityInLbs: number;     // in·lbs (bending moment capacity)
  shearCapacityLbs: number;        // lbs
  maxSpanIn: number;               // max span between supports (inches)
  maxCantileverIn: number;         // max cantilever overhang (inches)
  spliceIntervalIn: number;        // standard rail section length (inches)
  weightLbsPerFt: number;
  ul2703Listed: boolean;
  iccEsReport?: string;
}

export interface MountSpec {
  model: string;
  attachmentMethod: AttachmentMethod;
  upliftCapacityLbs: number;       // lbs per mount (ICC-ES rated)
  downwardCapacityLbs: number;     // lbs per mount
  shearCapacityLbs: number;        // lbs per mount
  fastenersPerMount: number;       // lag bolts / screws per mount
  fastenerDiameterIn: number;      // inches
  fastenerEmbedmentIn: number;     // minimum embedment depth (inches)
  fastenerPulloutLbs: number;      // lbs per fastener (NDS withdrawal)
  maxSpacingIn: number;            // max mount spacing (inches)
  minRafterDepthIn: number;        // minimum rafter depth for fastener
  iccEsReport?: string;
  ul2703Listed: boolean;
  compatibleRoofTypes: RoofType[];
}

export interface BallastSpec {
  blockWeightLbs: number;          // lbs per block
  blockDimensionsIn: [number, number, number]; // L×W×H
  minBlocksPerModule: number;
  maxBlocksPerModule: number;
  windUpliftResistanceLbs: number; // lbs per block
  maxWindSpeedMph: number;
  exposureCategories: string[];    // 'B', 'C', 'D'
  tiltAngleDeg: number;            // array tilt angle
  rowSpacingFt: number;            // row-to-row spacing
}

export interface GroundMountSpec {
  pileType: 'driven' | 'helical' | 'concrete' | 'ballasted';
  pileSpacingFt: number;           // ft between piles
  maxPileSpanFt: number;           // max span between piles
  pileEmbedmentFt: number;         // ft below grade
  pileCapacityUpliftLbs: number;   // lbs per pile
  pileCapacityDownwardLbs: number; // lbs per pile
  pileCapacityLateralLbs: number;  // lbs per pile
  frameSpanFt: number;             // horizontal frame span
  maxArrayWidthFt: number;
  maxArrayHeightFt: number;
  tiltAngleDeg: number;
  groundClearanceIn: number;       // min ground clearance (inches)
}

export interface TrackerSpec {
  trackerType: 'single_axis' | 'dual_axis';
  rowSpacingFt: number;            // ft between tracker rows
  moduleRowsPerTracker: number;    // modules per row
  maxModulesPerTracker: number;
  rotationRangeDeg: number;        // ±degrees from horizontal
  actuatorType: 'linear' | 'slew_drive' | 'hydraulic';
  foundationType: 'driven_pile' | 'helical' | 'concrete';
  pileSpacingFt: number;
  gcoverageRatio: number;          // ground coverage ratio
  windSpeedMaxMph: number;
  stowAngleDeg: number;            // stow angle in high wind
}

export interface HardwareKit {
  midClamp: string;
  endClamp: string;
  railSplice: string;
  groundLug: string;
  lagBolt: string;
  flashingKit?: string;
  tileHook?: string;
  bondingHardware: string;
  spliceConnector?: string;
}

export interface MountingSystemSpec {
  id: string;
  manufacturer: string;
  productLine: string;
  model: string;
  category: SystemCategory;
  systemType: SystemType;
  compatibleRoofTypes: RoofType[];
  description: string;

  // Engineering specs
  rail?: RailSpec;
  mount: MountSpec;
  ballast?: BallastSpec;
  groundMount?: GroundMountSpec;
  tracker?: TrackerSpec;
  hardware: HardwareKit;

  // Limits
  maxWindSpeedMph: number;
  maxSnowLoadPsf: number;
  maxRoofPitchDeg: number;
  minRoofPitchDeg: number;

  // Certifications
  ul2703Listed: boolean;
  iccEsReport?: string;
  fm4478Approved?: boolean;        // Factory Mutual for commercial
  ul1703Listed?: boolean;

  // Source references
  engineeringDataSource: string;
  lastUpdated: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUFACTURER DATABASE
// ─────────────────────────────────────────────────────────────────────────────

const MOUNTING_SYSTEMS: MountingSystemSpec[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // IRONRIDGE — Rail-Based Residential
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'ironridge-xr100',
    manufacturer: 'IronRidge',
    productLine: 'XR Rail',
    model: 'XR100',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    description: 'IronRidge XR100 aluminum rail system for residential asphalt shingle roofs',
    rail: {
      model: 'XR100',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 1.66,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,   // 1800 ft-lbs × 12
      shearCapacityLbs: 2200,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,        // 14 ft standard section
      weightLbsPerFt: 0.95,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-2962',
    },
    mount: {
      model: 'IronRidge L-Foot',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 500,
      downwardCapacityLbs: 800,
      shearCapacityLbs: 400,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-2962',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    },
    hardware: {
      midClamp: 'IronRidge UFO Mid Clamp',
      endClamp: 'IronRidge UFO End Clamp',
      railSplice: 'IronRidge XR100 Splice',
      groundLug: 'IronRidge Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'IronRidge Flashing Kit',
      bondingHardware: 'IronRidge Bond Washer',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-2962',
    engineeringDataSource: 'IronRidge XR100 Engineering Design Guide Rev 2.0',
    lastUpdated: '2024-01',
  },

  {
    id: 'ironridge-xr1000',
    manufacturer: 'IronRidge',
    productLine: 'XR Rail',
    model: 'XR1000',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    description: 'IronRidge XR1000 heavy-duty rail for high wind/snow zones',
    rail: {
      model: 'XR1000',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 2.0,
      widthIn: 1.0,
      wallThicknessIn: 0.156,
      momentCapacityInLbs: 36000,   // 3000 ft-lbs × 12
      shearCapacityLbs: 3200,
      maxSpanIn: 84,
      maxCantileverIn: 30,
      spliceIntervalIn: 168,
      weightLbsPerFt: 1.25,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-2962',
    },
    mount: {
      model: 'IronRidge L-Foot Heavy',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 700,
      downwardCapacityLbs: 1000,
      shearCapacityLbs: 600,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 84,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-2962',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    },
    hardware: {
      midClamp: 'IronRidge UFO Mid Clamp',
      endClamp: 'IronRidge UFO End Clamp',
      railSplice: 'IronRidge XR1000 Splice',
      groundLug: 'IronRidge Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'IronRidge Flashing Kit',
      bondingHardware: 'IronRidge Bond Washer',
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 75,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-2962',
    engineeringDataSource: 'IronRidge XR1000 Engineering Design Guide Rev 2.0',
    lastUpdated: '2024-01',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // UNIRAC — Rail-Based Residential & Commercial
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'unirac-solarmount',
    manufacturer: 'Unirac',
    productLine: 'SolarMount',
    model: 'SolarMount Classic',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    description: 'Unirac SolarMount Classic aluminum rail system',
    rail: {
      model: 'SolarMount Rail',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 1.75,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 24000,
      shearCapacityLbs: 2400,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 1.0,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-1894',
    },
    mount: {
      model: 'Unirac L-Foot',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 550,
      downwardCapacityLbs: 850,
      shearCapacityLbs: 450,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-1894',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    },
    hardware: {
      midClamp: 'Unirac Mid Clamp',
      endClamp: 'Unirac End Clamp',
      railSplice: 'Unirac Rail Splice',
      groundLug: 'Unirac Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'Unirac Flashing Kit',
      bondingHardware: 'Unirac Bond Clip',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-1894',
    engineeringDataSource: 'Unirac SolarMount Engineering Design Guide 2023',
    lastUpdated: '2023-06',
  },

  {
    id: 'unirac-sme',
    manufacturer: 'Unirac',
    productLine: 'SolarMount Evolution',
    model: 'SME',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated', 'tile_concrete'],
    description: 'Unirac SolarMount Evolution — next-gen rail system with integrated bonding',
    rail: {
      model: 'SME Rail',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 1.75,
      widthIn: 1.0,
      wallThicknessIn: 0.140,
      momentCapacityInLbs: 26400,
      shearCapacityLbs: 2600,
      maxSpanIn: 78,
      maxCantileverIn: 26,
      spliceIntervalIn: 168,
      weightLbsPerFt: 1.05,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-1894',
    },
    mount: {
      model: 'Unirac SME L-Foot',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 600,
      downwardCapacityLbs: 900,
      shearCapacityLbs: 500,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 78,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-1894',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated', 'tile_concrete'],
    },
    hardware: {
      midClamp: 'Unirac SME Mid Clamp',
      endClamp: 'Unirac SME End Clamp',
      railSplice: 'Unirac SME Splice',
      groundLug: 'Unirac Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'Unirac Flashing Kit',
      bondingHardware: 'Unirac Bond Clip',
    },
    maxWindSpeedMph: 170,
    maxSnowLoadPsf: 60,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-1894',
    engineeringDataSource: 'Unirac SME Engineering Design Guide 2023',
    lastUpdated: '2023-09',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ROOF TECH — Rail-Less (RT-MINI)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'rooftech-mini',
    manufacturer: 'Roof Tech',
    productLine: 'RT-MINI',
    model: 'RT-MINI',
    category: 'roof_residential',
    systemType: 'rail_less',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    description: 'Roof Tech RT-MINI rail-less mount — 2 lag bolts per mount, ICC-ES ESR-3575',
    mount: {
      model: 'RT-MINI',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 900,       // 2 × 450 lbs/lag (ICC-ES ESR-3575)
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 600,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 450,      // per lag bolt (ICC-ES ESR-3575)
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    },
    hardware: {
      midClamp: 'RT-MINI Mid Clamp',
      endClamp: 'RT-MINI End Clamp',
      railSplice: 'N/A — Rail-less system',
      groundLug: 'RT-MINI Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS (2 per mount)',
      flashingKit: 'RT-MINI Flashing Kit',
      bondingHardware: 'RT-MINI Bond Clip',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 40,
    maxRoofPitchDeg: 40,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-MINI ICC-ES ESR-3575 Rev 2023',
    lastUpdated: '2023-01',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SNAPNRACK — Rail-Based
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'snapnrack-100',
    manufacturer: 'SnapNrack',
    productLine: 'Series 100',
    model: 'Series 100',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    description: 'SnapNrack Series 100 aluminum rail system',
    rail: {
      model: 'Series 100 Rail',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 1.66,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 20400,
      shearCapacityLbs: 2100,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.92,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-3575',
    },
    mount: {
      model: 'SnapNrack L-Foot',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 500,
      downwardCapacityLbs: 800,
      shearCapacityLbs: 400,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    },
    hardware: {
      midClamp: 'SnapNrack Mid Clamp',
      endClamp: 'SnapNrack End Clamp',
      railSplice: 'SnapNrack Rail Splice',
      groundLug: 'SnapNrack Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'SnapNrack Flashing Kit',
      bondingHardware: 'SnapNrack Bond Clip',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: 'SnapNrack Series 100 Engineering Design Guide 2023',
    lastUpdated: '2023-03',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // QUICKMOUNT PV — Tile Hook Systems
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'quickmount-classic',
    manufacturer: 'QuickMount PV',
    productLine: 'Classic Mount',
    model: 'QM-Classic',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    description: 'QuickMount PV Classic Mount — integrated flashing, asphalt shingle',
    mount: {
      model: 'QM-Classic',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 600,
      downwardCapacityLbs: 900,
      shearCapacityLbs: 500,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-2835',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    },
    rail: {
      model: 'QM Rail',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 1.66,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,
      shearCapacityLbs: 2200,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.95,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-2835',
    },
    hardware: {
      midClamp: 'QM Mid Clamp',
      endClamp: 'QM End Clamp',
      railSplice: 'QM Rail Splice',
      groundLug: 'QM Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'QM Classic Flashing (integrated)',
      bondingHardware: 'QM Bond Clip',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-2835',
    engineeringDataSource: 'QuickMount PV Classic Mount ICC-ES ESR-2835',
    lastUpdated: '2023-06',
  },

  {
    id: 'quickmount-tile',
    manufacturer: 'QuickMount PV',
    productLine: 'Tile Replacement Mount',
    model: 'QM-Tile',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    description: 'QuickMount PV Tile Replacement Mount — concrete/clay tile roofs',
    mount: {
      model: 'QM-Tile',
      attachmentMethod: 'tile_replacement',
      upliftCapacityLbs: 700,
      downwardCapacityLbs: 1000,
      shearCapacityLbs: 550,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 60,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-2835',
      ul2703Listed: true,
      compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    },
    rail: {
      model: 'QM Rail',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 1.66,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,
      shearCapacityLbs: 2200,
      maxSpanIn: 60,
      maxCantileverIn: 20,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.95,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-2835',
    },
    hardware: {
      midClamp: 'QM Mid Clamp',
      endClamp: 'QM End Clamp',
      railSplice: 'QM Rail Splice',
      groundLug: 'QM Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      tileHook: 'QM Tile Replacement Hook',
      bondingHardware: 'QM Bond Clip',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 40,
    maxRoofPitchDeg: 40,
    minRoofPitchDeg: 10,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-2835',
    engineeringDataSource: 'QuickMount PV Tile Replacement Mount ICC-ES ESR-2835',
    lastUpdated: '2023-06',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // S-5! — Standing Seam Metal Roof
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 's5-pvkit',
    manufacturer: 'S-5!',
    productLine: 'PV Kit',
    model: 'S-5! PVKit 2.0',
    category: 'roof_residential',
    systemType: 'standing_seam',
    compatibleRoofTypes: ['metal_standing_seam'],
    description: 'S-5! PVKit 2.0 — no-penetration standing seam clamp system',
    mount: {
      model: 'S-5! PVKIT Clamp',
      attachmentMethod: 'standing_seam_clamp',
      upliftCapacityLbs: 800,       // per clamp (varies by seam profile)
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 600,
      fastenersPerMount: 0,         // no roof penetrations
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 72,
      minRafterDepthIn: 0,          // no rafter penetration
      iccEsReport: 'FM 4478 Approved',
      ul2703Listed: true,
      compatibleRoofTypes: ['metal_standing_seam'],
    },
    rail: {
      model: 'S-5! Rail',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 1.5,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 18000,
      shearCapacityLbs: 1800,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.88,
      ul2703Listed: true,
    },
    hardware: {
      midClamp: 'S-5! Mid Clamp',
      endClamp: 'S-5! End Clamp',
      railSplice: 'S-5! Rail Splice',
      groundLug: 'S-5! Ground Lug',
      lagBolt: 'N/A — No penetrations',
      bondingHardware: 'S-5! Bond Clip',
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 75,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 1,
    ul2703Listed: true,
    fm4478Approved: true,
    engineeringDataSource: 'S-5! PVKit 2.0 Engineering Design Guide 2023',
    lastUpdated: '2023-08',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // K2 SYSTEMS — Commercial Rail
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'k2-crossrail',
    manufacturer: 'K2 Systems',
    productLine: 'CrossRail',
    model: 'CrossRail Pro',
    category: 'roof_commercial',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'metal_corrugated', 'metal_standing_seam'],
    description: 'K2 Systems CrossRail Pro — commercial-grade rail system',
    rail: {
      model: 'CrossRail Pro',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 2.0,
      widthIn: 1.25,
      wallThicknessIn: 0.156,
      momentCapacityInLbs: 36000,
      shearCapacityLbs: 3600,
      maxSpanIn: 84,
      maxCantileverIn: 30,
      spliceIntervalIn: 192,        // 16 ft sections
      weightLbsPerFt: 1.3,
      ul2703Listed: true,
    },
    mount: {
      model: 'K2 L-Foot Pro',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 700,
      downwardCapacityLbs: 1100,
      shearCapacityLbs: 600,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 84,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'metal_corrugated', 'metal_standing_seam'],
    },
    hardware: {
      midClamp: 'K2 Mid Clamp',
      endClamp: 'K2 End Clamp',
      railSplice: 'K2 CrossRail Splice',
      groundLug: 'K2 Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'K2 Flashing Kit',
      bondingHardware: 'K2 Bond Clip',
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 75,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: 'K2 Systems CrossRail Pro Engineering Manual 2023',
    lastUpdated: '2023-05',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ECOFASTEN — Rail-Less
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'ecofasten-rockit',
    manufacturer: 'EcoFasten',
    productLine: 'Rock-It',
    model: 'Rock-It Gen 4',
    category: 'roof_residential',
    systemType: 'rail_less',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    description: 'EcoFasten Rock-It Gen 4 — rail-less mount with integrated flashing',
    mount: {
      model: 'Rock-It Gen 4',
      attachmentMethod: 'rail_less_lag',
      upliftCapacityLbs: 800,
      downwardCapacityLbs: 1100,
      shearCapacityLbs: 550,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 450,
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    },
    hardware: {
      midClamp: 'EcoFasten Mid Clamp',
      endClamp: 'EcoFasten End Clamp',
      railSplice: 'N/A — Rail-less',
      groundLug: 'EcoFasten Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS (2 per mount)',
      flashingKit: 'EcoFasten Integrated Flashing',
      bondingHardware: 'EcoFasten Bond Clip',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 40,
    maxRoofPitchDeg: 40,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'EcoFasten Rock-It Gen 4 Engineering Guide 2023',
    lastUpdated: '2023-04',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SCHLETTER — Commercial Rail
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'schletter-classic',
    manufacturer: 'Schletter',
    productLine: 'Classic',
    model: 'Schletter Classic Rail',
    category: 'roof_commercial',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'metal_corrugated', 'metal_standing_seam', 'flat_tpo'],
    description: 'Schletter Classic commercial rail system — high-load capacity',
    rail: {
      model: 'Schletter Classic Rail',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 2.0,
      widthIn: 1.25,
      wallThicknessIn: 0.156,
      momentCapacityInLbs: 38400,
      shearCapacityLbs: 3800,
      maxSpanIn: 90,
      maxCantileverIn: 32,
      spliceIntervalIn: 192,
      weightLbsPerFt: 1.35,
      ul2703Listed: true,
    },
    mount: {
      model: 'Schletter L-Foot',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 750,
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 650,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 90,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'metal_corrugated', 'metal_standing_seam'],
    },
    hardware: {
      midClamp: 'Schletter Mid Clamp',
      endClamp: 'Schletter End Clamp',
      railSplice: 'Schletter Rail Splice',
      groundLug: 'Schletter Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'Schletter Flashing Kit',
      bondingHardware: 'Schletter Bond Clip',
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 80,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: 'Schletter Classic Rail Engineering Manual 2023',
    lastUpdated: '2023-07',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SUNMODO — Rail-Based
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'sunmodo-ez',
    manufacturer: 'SunModo',
    productLine: 'EZ Mount',
    model: 'SunModo EZ',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    description: 'SunModo EZ Mount — quick-install rail system',
    mount: {
      model: 'SunModo EZ L-Foot',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 550,
      downwardCapacityLbs: 850,
      shearCapacityLbs: 450,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    },
    rail: {
      model: 'SunModo Rail',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 1.66,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,
      shearCapacityLbs: 2200,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.95,
      ul2703Listed: true,
    },
    hardware: {
      midClamp: 'SunModo Mid Clamp',
      endClamp: 'SunModo End Clamp',
      railSplice: 'SunModo Rail Splice',
      groundLug: 'SunModo Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'SunModo Flashing Kit',
      bondingHardware: 'SunModo Bond Clip',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: 'SunModo EZ Mount Engineering Guide 2023',
    lastUpdated: '2023-02',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DPW SOLAR — Commercial Rail
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'dpw-powerrail',
    manufacturer: 'DPW Solar',
    productLine: 'Power Rail',
    model: 'Power Rail D-Series',
    category: 'roof_commercial',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'metal_corrugated', 'flat_tpo', 'flat_epdm'],
    description: 'DPW Solar Power Rail D-Series — commercial heavy-duty rail',
    rail: {
      model: 'Power Rail D-Series',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 2.25,
      widthIn: 1.25,
      wallThicknessIn: 0.156,
      momentCapacityInLbs: 42000,
      shearCapacityLbs: 4200,
      maxSpanIn: 96,
      maxCantileverIn: 36,
      spliceIntervalIn: 192,
      weightLbsPerFt: 1.45,
      ul2703Listed: true,
    },
    mount: {
      model: 'DPW L-Foot',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 800,
      downwardCapacityLbs: 1300,
      shearCapacityLbs: 700,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 500,
      maxSpacingIn: 96,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'metal_corrugated'],
    },
    hardware: {
      midClamp: 'DPW Mid Clamp',
      endClamp: 'DPW End Clamp',
      railSplice: 'DPW Rail Splice',
      groundLug: 'DPW Ground Lug',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      flashingKit: 'DPW Flashing Kit',
      bondingHardware: 'DPW Bond Clip',
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 80,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: 'DPW Solar Power Rail D-Series Engineering Manual 2023',
    lastUpdated: '2023-06',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PANELCLAW — Commercial Ballasted Flat Roof
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'panelclaw-polar-bear',
    manufacturer: 'PanelClaw',
    productLine: 'Polar Bear',
    model: 'Polar Bear 3',
    category: 'roof_commercial',
    systemType: 'ballasted_flat',
    compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    description: 'PanelClaw Polar Bear 3 — ballasted flat roof system, no penetrations',
    mount: {
      model: 'Polar Bear 3 Base',
      attachmentMethod: 'ballasted',
      upliftCapacityLbs: 0,         // ballast-only, no mechanical attachment
      downwardCapacityLbs: 0,
      shearCapacityLbs: 0,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 72,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    },
    ballast: {
      blockWeightLbs: 40,
      blockDimensionsIn: [16, 8, 4],
      minBlocksPerModule: 2,
      maxBlocksPerModule: 8,
      windUpliftResistanceLbs: 40,
      maxWindSpeedMph: 130,
      exposureCategories: ['B', 'C'],
      tiltAngleDeg: 10,
      rowSpacingFt: 8,
    },
    hardware: {
      midClamp: 'PanelClaw Mid Clamp',
      endClamp: 'PanelClaw End Clamp',
      railSplice: 'N/A',
      groundLug: 'PanelClaw Ground Lug',
      lagBolt: 'N/A — Ballasted',
      bondingHardware: 'PanelClaw Bond Clip',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 30,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: true,
    fm4478Approved: true,
    engineeringDataSource: 'PanelClaw Polar Bear 3 Engineering Design Guide 2023',
    lastUpdated: '2023-09',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GAMECHANGE SOLAR — Commercial Ballasted + Ground Mount
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'gamechange-genius',
    manufacturer: 'GameChange Solar',
    productLine: 'Genius Tracker',
    model: 'Genius Tracker',
    category: 'ground_mount',
    systemType: 'tracker_single_axis',
    compatibleRoofTypes: ['any'],
    description: 'GameChange Solar Genius Tracker — single-axis tracker for utility-scale',
    mount: {
      model: 'Genius Tracker Pile',
      attachmentMethod: 'driven_pile',
      upliftCapacityLbs: 15000,
      downwardCapacityLbs: 20000,
      shearCapacityLbs: 8000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 240,            // 20 ft pile spacing
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ['any'],
    },
    tracker: {
      trackerType: 'single_axis',
      rowSpacingFt: 18,
      moduleRowsPerTracker: 2,
      maxModulesPerTracker: 60,
      rotationRangeDeg: 60,
      actuatorType: 'slew_drive',
      foundationType: 'driven_pile',
      pileSpacingFt: 20,
      gcoverageRatio: 0.4,
      windSpeedMaxMph: 130,
      stowAngleDeg: 52,
    },
    hardware: {
      midClamp: 'GameChange Mid Clamp',
      endClamp: 'GameChange End Clamp',
      railSplice: 'GameChange Torque Tube Splice',
      groundLug: 'GameChange Ground Lug',
      lagBolt: 'N/A — Pile Foundation',
      bondingHardware: 'GameChange Bond Clip',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 25,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: 'GameChange Solar Genius Tracker Engineering Manual 2023',
    lastUpdated: '2023-10',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // NEXTRACKER — Single-Axis Tracker
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'nextracker-nr3',
    manufacturer: 'NEXTracker',
    productLine: 'NX Horizon',
    model: 'NX Horizon',
    category: 'ground_mount',
    systemType: 'tracker_single_axis',
    compatibleRoofTypes: ['any'],
    description: 'NEXTracker NX Horizon — self-powered single-axis tracker',
    mount: {
      model: 'NX Horizon Pile',
      attachmentMethod: 'driven_pile',
      upliftCapacityLbs: 20000,
      downwardCapacityLbs: 25000,
      shearCapacityLbs: 10000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 288,            // 24 ft pile spacing
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ['any'],
    },
    tracker: {
      trackerType: 'single_axis',
      rowSpacingFt: 20,
      moduleRowsPerTracker: 2,
      maxModulesPerTracker: 90,
      rotationRangeDeg: 60,
      actuatorType: 'slew_drive',
      foundationType: 'driven_pile',
      pileSpacingFt: 24,
      gcoverageRatio: 0.42,
      windSpeedMaxMph: 140,
      stowAngleDeg: 52,
    },
    hardware: {
      midClamp: 'NEXTracker Mid Clamp',
      endClamp: 'NEXTracker End Clamp',
      railSplice: 'NEXTracker Torque Tube Splice',
      groundLug: 'NEXTracker Ground Lug',
      lagBolt: 'N/A — Pile Foundation',
      bondingHardware: 'NEXTracker Bond Clip',
    },
    maxWindSpeedMph: 140,
    maxSnowLoadPsf: 30,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: 'NEXTracker NX Horizon Engineering Manual 2023',
    lastUpdated: '2023-11',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ARRAY TECHNOLOGIES — Single-Axis Tracker
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'array-tech-duratrack',
    manufacturer: 'Array Technologies',
    productLine: 'DuraTrack',
    model: 'DuraTrack HZ v3',
    category: 'ground_mount',
    systemType: 'tracker_single_axis',
    compatibleRoofTypes: ['any'],
    description: 'Array Technologies DuraTrack HZ v3 — horizontal single-axis tracker',
    mount: {
      model: 'DuraTrack Pile',
      attachmentMethod: 'driven_pile',
      upliftCapacityLbs: 18000,
      downwardCapacityLbs: 22000,
      shearCapacityLbs: 9000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 264,            // 22 ft pile spacing
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ['any'],
    },
    tracker: {
      trackerType: 'single_axis',
      rowSpacingFt: 19,
      moduleRowsPerTracker: 2,
      maxModulesPerTracker: 72,
      rotationRangeDeg: 60,
      actuatorType: 'slew_drive',
      foundationType: 'driven_pile',
      pileSpacingFt: 22,
      gcoverageRatio: 0.41,
      windSpeedMaxMph: 135,
      stowAngleDeg: 52,
    },
    hardware: {
      midClamp: 'Array Tech Mid Clamp',
      endClamp: 'Array Tech End Clamp',
      railSplice: 'Array Tech Torque Tube Splice',
      groundLug: 'Array Tech Ground Lug',
      lagBolt: 'N/A — Pile Foundation',
      bondingHardware: 'Array Tech Bond Clip',
    },
    maxWindSpeedMph: 135,
    maxSnowLoadPsf: 25,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: 'Array Technologies DuraTrack HZ v3 Engineering Manual 2023',
    lastUpdated: '2023-09',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ACECLAMP — Corrugated Metal Roof
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'aceclamp-corrugated',
    manufacturer: 'AceClamp',
    productLine: 'Metal Roof',
    model: 'AceClamp Corrugated',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['metal_corrugated'],
    description: 'AceClamp corrugated metal roof mount — no penetrations',
    mount: {
      model: 'AceClamp Corrugated',
      attachmentMethod: 'corrugated_clamp',
      upliftCapacityLbs: 600,
      downwardCapacityLbs: 900,
      shearCapacityLbs: 500,
      fastenersPerMount: 0,         // clamp only, no penetrations
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 72,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ['metal_corrugated'],
    },
    rail: {
      model: 'AceClamp Rail',
      materialAlloy: '6005-T5 aluminum',
      heightIn: 1.66,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 21600,
      shearCapacityLbs: 2200,
      maxSpanIn: 72,
      maxCantileverIn: 24,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.95,
      ul2703Listed: true,
    },
    hardware: {
      midClamp: 'AceClamp Mid Clamp',
      endClamp: 'AceClamp End Clamp',
      railSplice: 'AceClamp Rail Splice',
      groundLug: 'AceClamp Ground Lug',
      lagBolt: 'N/A — Clamp system',
      bondingHardware: 'AceClamp Bond Clip',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 1,
    ul2703Listed: true,
    engineeringDataSource: 'AceClamp Corrugated Metal Roof Engineering Guide 2023',
    lastUpdated: '2023-05',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GROUND MOUNT — Dual Post (Generic)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'ground-dual-post-driven',
    manufacturer: 'Generic',
    productLine: 'Ground Mount',
    model: 'Dual-Post Driven Pile',
    category: 'ground_mount',
    systemType: 'ground_dual_post',
    compatibleRoofTypes: ['any'],
    description: 'Standard dual-post driven pile ground mount system',
    mount: {
      model: 'Dual-Post Driven Pile',
      attachmentMethod: 'driven_pile',
      upliftCapacityLbs: 8000,
      downwardCapacityLbs: 12000,
      shearCapacityLbs: 5000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 144,            // 12 ft pile spacing
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ['any'],
    },
    groundMount: {
      pileType: 'driven',
      pileSpacingFt: 10,
      maxPileSpanFt: 12,
      pileEmbedmentFt: 4,
      pileCapacityUpliftLbs: 8000,
      pileCapacityDownwardLbs: 12000,
      pileCapacityLateralLbs: 5000,
      frameSpanFt: 10,
      maxArrayWidthFt: 100,
      maxArrayHeightFt: 20,
      tiltAngleDeg: 20,
      groundClearanceIn: 24,
    },
    hardware: {
      midClamp: 'Ground Mount Mid Clamp',
      endClamp: 'Ground Mount End Clamp',
      railSplice: 'Ground Mount Rail Splice',
      groundLug: 'Ground Mount Ground Lug',
      lagBolt: 'N/A — Pile Foundation',
      bondingHardware: 'Ground Mount Bond Clip',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: false,
    engineeringDataSource: 'ASCE 7-22 Ground Mount Design Standards',
    lastUpdated: '2024-01',
  },

  {
    id: 'ground-single-post-helical',
    manufacturer: 'Generic',
    productLine: 'Ground Mount',
    model: 'Single-Post Helical Pile',
    category: 'ground_mount',
    systemType: 'ground_helical',
    compatibleRoofTypes: ['any'],
    description: 'Single-post helical pile ground mount — ideal for rocky/sandy soil',
    mount: {
      model: 'Single-Post Helical Pile',
      attachmentMethod: 'helical_pile',
      upliftCapacityLbs: 10000,
      downwardCapacityLbs: 15000,
      shearCapacityLbs: 6000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 120,
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ['any'],
    },
    groundMount: {
      pileType: 'helical',
      pileSpacingFt: 8,
      maxPileSpanFt: 10,
      pileEmbedmentFt: 6,
      pileCapacityUpliftLbs: 10000,
      pileCapacityDownwardLbs: 15000,
      pileCapacityLateralLbs: 6000,
      frameSpanFt: 8,
      maxArrayWidthFt: 80,
      maxArrayHeightFt: 15,
      tiltAngleDeg: 20,
      groundClearanceIn: 24,
    },
    hardware: {
      midClamp: 'Ground Mount Mid Clamp',
      endClamp: 'Ground Mount End Clamp',
      railSplice: 'Ground Mount Rail Splice',
      groundLug: 'Ground Mount Ground Lug',
      lagBolt: 'N/A — Helical Pile',
      bondingHardware: 'Ground Mount Bond Clip',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 60,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: false,
    engineeringDataSource: 'ASCE 7-22 Helical Pile Design Standards',
    lastUpdated: '2024-01',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ESDEC — Flat Roof Ballasted
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'esdec-flatfix',
    manufacturer: 'Esdec',
    productLine: 'FlatFix',
    model: 'FlatFix Fusion',
    category: 'roof_commercial',
    systemType: 'ballasted_flat',
    compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    description: 'Esdec FlatFix Fusion — ballasted flat roof system with aerodynamic design',
    mount: {
      model: 'FlatFix Fusion Base',
      attachmentMethod: 'ballasted',
      upliftCapacityLbs: 0,
      downwardCapacityLbs: 0,
      shearCapacityLbs: 0,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 72,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    },
    ballast: {
      blockWeightLbs: 33,
      blockDimensionsIn: [14, 7, 4],
      minBlocksPerModule: 2,
      maxBlocksPerModule: 6,
      windUpliftResistanceLbs: 33,
      maxWindSpeedMph: 120,
      exposureCategories: ['B', 'C'],
      tiltAngleDeg: 10,
      rowSpacingFt: 7,
    },
    hardware: {
      midClamp: 'Esdec Mid Clamp',
      endClamp: 'Esdec End Clamp',
      railSplice: 'N/A',
      groundLug: 'Esdec Ground Lug',
      lagBolt: 'N/A — Ballasted',
      bondingHardware: 'Esdec Bond Clip',
    },
    maxWindSpeedMph: 120,
    maxSnowLoadPsf: 25,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: true,
    engineeringDataSource: 'Esdec FlatFix Fusion Engineering Design Guide 2023',
    lastUpdated: '2023-08',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export function getMountingSystemById(id: string): MountingSystemSpec | undefined {
  return MOUNTING_SYSTEMS.find(s => s.id === id);
}

export function getMountingSystemsByCategory(category: SystemCategory): MountingSystemSpec[] {
  return MOUNTING_SYSTEMS.filter(s => s.category === category);
}

export function getMountingSystemsByType(systemType: SystemType): MountingSystemSpec[] {
  return MOUNTING_SYSTEMS.filter(s => s.systemType === systemType);
}

export function getMountingSystemsByRoofType(roofType: RoofType): MountingSystemSpec[] {
  return MOUNTING_SYSTEMS.filter(s =>
    s.compatibleRoofTypes.includes(roofType) || s.compatibleRoofTypes.includes('any')
  );
}

export function getAllMountingSystems(): MountingSystemSpec[] {
  return [...MOUNTING_SYSTEMS];
}

export function getMountingSystemsByManufacturer(manufacturer: string): MountingSystemSpec[] {
  return MOUNTING_SYSTEMS.filter(s =>
    s.manufacturer.toLowerCase().includes(manufacturer.toLowerCase())
  );
}

// Legacy compatibility — map old racking-database IDs to new IDs
const LEGACY_ID_MAP: Record<string, string> = {
  'ironridge-xr100':    'ironridge-xr100',
  'ironridge-xr1000':   'ironridge-xr1000',
  'unirac-solarmount':  'unirac-solarmount',
  'unirac-sme':         'unirac-sme',
  'rooftech-mini':      'rooftech-mini',
  'rt-mini':            'rooftech-mini',
  'snapnrack-100':      'snapnrack-100',
  'quickmount-classic': 'quickmount-classic',
  'quickmount-tile':    'quickmount-tile',
  's5-pvkit':           's5-pvkit',
  'k2-crossrail':       'k2-crossrail',
  'ecofasten-rockit':   'ecofasten-rockit',
  'dpw-powerrail':      'dpw-powerrail',
  'schletter-classic':  'schletter-classic',
  'esdec-flatfix':      'esdec-flatfix',
  'rail-based':         'ironridge-xr100',
  'rail-less':          'rooftech-mini',
  'ballasted':          'panelclaw-polar-bear',
  'ground-mount':       'ground-dual-post-driven',
  'tracker':            'nextracker-nr3',
};

export function resolveMountingSystemId(id: string): string {
  return LEGACY_ID_MAP[id] ?? id;
}

export { MOUNTING_SYSTEMS };