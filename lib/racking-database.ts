// ============================================================
// Racking System Database
// Comprehensive manufacturer data for structural calculations
// Sources: ICC-ES ESR reports, manufacturer datasheets, UL 2703
// ============================================================

export type RoofTypeId =
  | 'shingle'
  | 'tile_concrete'
  | 'tile_clay'
  | 'metal_standing_seam'
  | 'metal_corrugated'
  | 'metal_r_panel'
  | 'flat_tpo'
  | 'flat_epdm'
  | 'flat_gravel';

export type AttachmentMethod =
  | 'l_foot_lag'          // L-foot + lag bolt into rafter
  | 'standoff_lag'        // Standoff + lag bolt
  | 'tile_hook'           // Tile hook under tile
  | 'tile_replacement'    // Tile replacement mount
  | 'seam_clamp'          // Standing seam clamp (no penetration)
  | 'corrugated_screw'    // Self-tapping screw into purlin
  | 'ballasted'           // Ballasted (no penetration)
  | 'adhesive_pad'        // Adhesive bonded pad
  | 'direct_attach'       // Rail-less direct attachment
  | 'trapezoidal_clamp';  // Trapezoidal seam clamp

export type LoadModel = 'distributed' | 'discrete';

export interface RailSpec {
  model: string;
  material: string;
  heightIn: number;
  widthIn: number;
  weightPerFtLbs: number;
  maxSpanIn: number;           // max span between mounts
  maxCantileverIn: number;     // max cantilever past outer mount
  spliceIntervalIn: number;    // standard rail length (splice needed beyond this)
  momentCapacityInLbs: number; // bending moment capacity (in·lbs)
  ulListing: string;
}

export interface MountSpec {
  model: string;
  attachmentMethod: AttachmentMethod;
  fastenersPerMount: number;    // lag bolts or screws per mount
  upliftCapacityLbs: number;    // total uplift per mount (all fasteners combined)
  upliftPerFastenerLbs: number; // uplift per individual fastener
  shearCapacityLbs: number;     // lateral/shear capacity per mount
  downwardCapacityLbs: number;  // downward load capacity per mount
  maxSpacingIn: number;         // max center-to-center mount spacing
  minEmbedmentIn: number;       // min fastener embedment into framing
  fastenerDiameterIn: number;   // fastener diameter
  iccEsReport?: string;         // ICC-ES ESR number
  ulListing?: string;
  notes: string;
}

export interface HardwareKit {
  midClamp: string;
  endClamp: string;
  lFoot?: string;
  tileHook?: string;
  seamClamp?: string;
  railSplice?: string;
  groundLug: string;
  bondingHardware: string;
  flashingKit?: string;
  lagBolt: string;
}

export interface RackingSystemSpec {
  id: string;
  manufacturer: string;
  model: string;
  systemType: 'rail_based' | 'rail_less' | 'ballasted' | 'clamp_only';
  compatibleRoofTypes: RoofTypeId[];
  loadModel: LoadModel;

  // Rail (null for rail-less systems)
  rail: RailSpec | null;

  // Mount
  mount: MountSpec;

  // Hardware
  hardware: HardwareKit;

  // Certifications
  iccEsReport?: string;
  ulListing: string;
  fmApproval?: string;
  warranty: string;

  // Reference
  datasheetUrl: string;
  notes: string;
}

// ─── RACKING DATABASE ─────────────────────────────────────────────────────────

export const RACKING_DATABASE: RackingSystemSpec[] = [

  // ── IronRidge XR100 ──────────────────────────────────────────────────────────
  {
    id: 'ironridge-xr100',
    manufacturer: 'IronRidge',
    model: 'XR100 Rail System',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay', 'metal_corrugated', 'metal_r_panel'],
    loadModel: 'distributed',
    rail: {
      model: 'XR100',
      material: '6005-T5 Aluminum',
      heightIn: 1.81,
      widthIn: 1.97,
      weightPerFtLbs: 0.62,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168, // 14 ft standard length
      momentCapacityInLbs: 4800,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'IronRidge L-Foot',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 500,
      upliftPerFastenerLbs: 500,
      shearCapacityLbs: 400,
      downwardCapacityLbs: 800,
      maxSpacingIn: 72,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125, // 5/16"
      ulListing: 'UL 2703',
      notes: 'Lag bolt into rafter. Min 2.5" embedment. EPDM flashing required.',
    },
    hardware: {
      midClamp: 'IronRidge UFO Mid Clamp',
      endClamp: 'IronRidge UFO End Clamp',
      lFoot: 'IronRidge L-Foot (adjustable height)',
      railSplice: 'IronRidge XR Splice Bar',
      groundLug: 'IronRidge Ground Lug',
      bondingHardware: 'IronRidge Bonding Jumper',
      flashingKit: 'IronRidge EPDM Flashing Kit',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://ironridge.com/roof-mount/xr-rail/',
    notes: 'Most common residential rail system. Excellent load tables available.',
  },

  // ── IronRidge XR1000 ─────────────────────────────────────────────────────────
  {
    id: 'ironridge-xr1000',
    manufacturer: 'IronRidge',
    model: 'XR1000 Rail System',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay', 'metal_corrugated'],
    loadModel: 'distributed',
    rail: {
      model: 'XR1000',
      material: '6005-T5 Aluminum',
      heightIn: 2.25,
      widthIn: 2.00,
      weightPerFtLbs: 0.82,
      maxSpanIn: 84,
      maxCantileverIn: 21,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 7200,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'IronRidge L-Foot Heavy Duty',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 600,
      upliftPerFastenerLbs: 600,
      shearCapacityLbs: 500,
      downwardCapacityLbs: 1000,
      maxSpacingIn: 84,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'Heavy-duty rail for high wind/snow zones.',
    },
    hardware: {
      midClamp: 'IronRidge UFO Mid Clamp',
      endClamp: 'IronRidge UFO End Clamp',
      lFoot: 'IronRidge L-Foot HD',
      railSplice: 'IronRidge XR1000 Splice Bar',
      groundLug: 'IronRidge Ground Lug',
      bondingHardware: 'IronRidge Bonding Jumper',
      flashingKit: 'IronRidge EPDM Flashing Kit',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://ironridge.com/roof-mount/xr-rail/',
    notes: 'Higher moment capacity for longer spans.',
  },

  // ── Unirac SolarMount ────────────────────────────────────────────────────────
  {
    id: 'unirac-solarmount',
    manufacturer: 'Unirac',
    model: 'SolarMount',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay', 'metal_corrugated', 'metal_standing_seam'],
    loadModel: 'distributed',
    rail: {
      model: 'SolarMount Rail',
      material: '6005-T5 Aluminum',
      heightIn: 1.75,
      widthIn: 1.75,
      weightPerFtLbs: 0.58,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 4500,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'Unirac L-Foot',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 500,
      upliftPerFastenerLbs: 500,
      shearCapacityLbs: 380,
      downwardCapacityLbs: 750,
      maxSpacingIn: 72,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'Standard L-foot. Use appropriate height for roof type.',
    },
    hardware: {
      midClamp: 'Unirac Mid Clamp',
      endClamp: 'Unirac End Clamp',
      lFoot: 'Unirac L-Foot (multiple heights)',
      railSplice: 'Unirac Splice Kit',
      groundLug: 'Unirac Ground Lug',
      bondingHardware: 'Unirac Bonding Clip',
      flashingKit: 'Unirac Flashing Kit',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://unirac.com/products/solarmount/',
    notes: 'Widely used. Good documentation for AHJ submittals.',
  },

  // ── Unirac SOLARMOUNT EVOLUTION ──────────────────────────────────────────────
  {
    id: 'unirac-sme',
    manufacturer: 'Unirac',
    model: 'SolarMount Evolution (SME)',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay', 'metal_corrugated'],
    loadModel: 'distributed',
    rail: {
      model: 'SME Rail',
      material: '6005-T5 Aluminum',
      heightIn: 2.00,
      widthIn: 1.75,
      weightPerFtLbs: 0.65,
      maxSpanIn: 78,
      maxCantileverIn: 20,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 5800,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'Unirac SME L-Foot',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 550,
      upliftPerFastenerLbs: 550,
      shearCapacityLbs: 420,
      downwardCapacityLbs: 850,
      maxSpacingIn: 78,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'Next-gen SolarMount with improved moment capacity.',
    },
    hardware: {
      midClamp: 'Unirac SME Mid Clamp',
      endClamp: 'Unirac SME End Clamp',
      lFoot: 'Unirac SME L-Foot',
      railSplice: 'Unirac SME Splice',
      groundLug: 'Unirac Ground Lug',
      bondingHardware: 'Unirac Bonding Clip',
      flashingKit: 'Unirac Flashing Kit',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://unirac.com/products/sme/',
    notes: 'Improved version of SolarMount.',
  },

  // ── Roof Tech RT-MINI (Rail-Less) ────────────────────────────────────────────
  {
    id: 'rooftech-mini',
    manufacturer: 'Roof Tech',
    model: 'RT-MINI Rail-Less',
    systemType: 'rail_less',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay'],
    loadModel: 'discrete',
    rail: null, // rail-less system
    mount: {
      model: 'RT-MINI',
      attachmentMethod: 'direct_attach',
      fastenersPerMount: 2,          // 2 lag bolts per RT-MINI foot
      upliftCapacityLbs: 900,        // 2 × 450 lbf/lag (ICC-ES ESR-3575)
      upliftPerFastenerLbs: 450,     // per lag bolt
      shearCapacityLbs: 600,
      downwardCapacityLbs: 1200,
      maxSpacingIn: 48,              // max 48" O.C.
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,   // 5/16"
      iccEsReport: 'ICC-ES ESR-3575',
      ulListing: 'UL 2703',
      notes: 'Rail-less direct attachment. 2 lag bolts per mount. Integrated EPDM flashing.',
    },
    hardware: {
      midClamp: 'RT-MINI Integrated Mid Clamp',
      endClamp: 'RT-MINI Integrated End Clamp',
      groundLug: 'RT-MINI Ground Lug',
      bondingHardware: 'RT-MINI Bonding Clip',
      flashingKit: 'RT-MINI Integrated EPDM Flashing',
      lagBolt: '5/16" × 3" Lag Bolt (SS) ×2 per mount',
    },
    iccEsReport: 'ICC-ES ESR-3575',
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://www.roof-tech.com/rt-mini',
    notes: 'Rail-less system. Mount spacing is critical — must be calculated from loads.',
  },

  // ── SnapNrack Series 100 ─────────────────────────────────────────────────────
  {
    id: 'snapnrack-100',
    manufacturer: 'SnapNrack',
    model: 'Series 100',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay'],
    loadModel: 'distributed',
    rail: {
      model: 'Series 100 Rail',
      material: '6005-T5 Aluminum',
      heightIn: 1.75,
      widthIn: 1.75,
      weightPerFtLbs: 0.55,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 4200,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'SnapNrack L-Foot',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 480,
      upliftPerFastenerLbs: 480,
      shearCapacityLbs: 360,
      downwardCapacityLbs: 720,
      maxSpacingIn: 72,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'Snap-in L-foot for fast installation.',
    },
    hardware: {
      midClamp: 'SnapNrack Mid Clamp',
      endClamp: 'SnapNrack End Clamp',
      lFoot: 'SnapNrack Snap-In L-Foot',
      railSplice: 'SnapNrack Splice Kit',
      groundLug: 'SnapNrack Ground Lug',
      bondingHardware: 'SnapNrack Bonding Clip',
      flashingKit: 'SnapNrack Flashing Kit',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://snapnrack.com/products/series-100/',
    notes: 'Fast snap-in installation. Popular for residential.',
  },

  // ── QuickMount PV Classic ────────────────────────────────────────────────────
  {
    id: 'quickmount-classic',
    manufacturer: 'QuickMount PV',
    model: 'Classic Mount',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay'],
    loadModel: 'distributed',
    rail: {
      model: 'QuickMount Rail',
      material: '6005-T5 Aluminum',
      heightIn: 1.75,
      widthIn: 1.75,
      weightPerFtLbs: 0.55,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 4200,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'QuickMount Classic',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 500,
      upliftPerFastenerLbs: 500,
      shearCapacityLbs: 380,
      downwardCapacityLbs: 750,
      maxSpacingIn: 72,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'Waterproof flashing system. Best for shingle and tile.',
    },
    hardware: {
      midClamp: 'QuickMount Mid Clamp',
      endClamp: 'QuickMount End Clamp',
      lFoot: 'QuickMount Classic Foot',
      railSplice: 'QuickMount Splice Kit',
      groundLug: 'QuickMount Ground Lug',
      bondingHardware: 'QuickMount Bonding Clip',
      flashingKit: 'QuickMount Integrated Flashing',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '10 years',
    datasheetUrl: 'https://quickmountpv.com/products/classic-mount/',
    notes: 'Integrated waterproof flashing. Good for tile roofs.',
  },

  // ── QuickMount PV Tile Replacement ──────────────────────────────────────────
  {
    id: 'quickmount-tile',
    manufacturer: 'QuickMount PV',
    model: 'Tile Replacement Mount',
    systemType: 'rail_based',
    compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    loadModel: 'distributed',
    rail: {
      model: 'QuickMount Rail',
      material: '6005-T5 Aluminum',
      heightIn: 1.75,
      widthIn: 1.75,
      weightPerFtLbs: 0.55,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 4200,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'QuickMount Tile Replacement',
      attachmentMethod: 'tile_replacement',
      fastenersPerMount: 1,
      upliftCapacityLbs: 500,
      upliftPerFastenerLbs: 500,
      shearCapacityLbs: 380,
      downwardCapacityLbs: 750,
      maxSpacingIn: 72,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'Replaces tile. No tile cracking. Waterproof.',
    },
    hardware: {
      midClamp: 'QuickMount Mid Clamp',
      endClamp: 'QuickMount End Clamp',
      lFoot: 'QuickMount Tile Replacement Foot',
      railSplice: 'QuickMount Splice Kit',
      groundLug: 'QuickMount Ground Lug',
      bondingHardware: 'QuickMount Bonding Clip',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '10 years',
    datasheetUrl: 'https://quickmountpv.com/products/tile-replacement/',
    notes: 'Tile replacement — no tile cracking. Preferred for concrete/clay tile.',
  },

  // ── S-5! PVKIT 2.0 (Standing Seam) ──────────────────────────────────────────
  {
    id: 's5-pvkit',
    manufacturer: 'S-5!',
    model: 'PVKIT 2.0',
    systemType: 'clamp_only',
    compatibleRoofTypes: ['metal_standing_seam'],
    loadModel: 'discrete',
    rail: {
      model: 'S-5! Rail',
      material: '6061-T6 Aluminum',
      heightIn: 1.50,
      widthIn: 1.50,
      weightPerFtLbs: 0.45,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 3800,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'S-5! U-Clamp / Mini Clamp',
      attachmentMethod: 'seam_clamp',
      fastenersPerMount: 2,          // 2 set screws per clamp
      upliftCapacityLbs: 800,        // per clamp (seam-dependent)
      upliftPerFastenerLbs: 400,
      shearCapacityLbs: 600,
      downwardCapacityLbs: 1200,
      maxSpacingIn: 72,
      minEmbedmentIn: 0,             // no penetration
      fastenerDiameterIn: 0.25,      // set screw
      ulListing: 'UL 2703',
      notes: 'No roof penetrations. Clamp directly to seam. Verify seam profile.',
    },
    hardware: {
      midClamp: 'S-5! Mid Clamp',
      endClamp: 'S-5! End Clamp',
      seamClamp: 'S-5! U-Clamp or Mini Clamp',
      railSplice: 'S-5! Splice Kit',
      groundLug: 'S-5! Ground Lug',
      bondingHardware: 'S-5! Bonding Clip',
      lagBolt: 'N/A — no penetrations',
    },
    ulListing: 'UL 2703',
    warranty: '25 years',
    datasheetUrl: 'https://www.s-5.com/products/pvkit/',
    notes: 'No penetrations. Best for standing seam metal roofs.',
  },

  // ── K2 Systems CrossRail ─────────────────────────────────────────────────────
  {
    id: 'k2-crossrail',
    manufacturer: 'K2 Systems',
    model: 'CrossRail',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay', 'metal_corrugated'],
    loadModel: 'distributed',
    rail: {
      model: 'CrossRail',
      material: '6005-T5 Aluminum',
      heightIn: 1.85,
      widthIn: 1.85,
      weightPerFtLbs: 0.60,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 4600,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'K2 Roof Hook',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 500,
      upliftPerFastenerLbs: 500,
      shearCapacityLbs: 380,
      downwardCapacityLbs: 760,
      maxSpacingIn: 72,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'European-style roof hook. Good for tile and shingle.',
    },
    hardware: {
      midClamp: 'K2 Mid Clamp',
      endClamp: 'K2 End Clamp',
      lFoot: 'K2 Roof Hook',
      railSplice: 'K2 Splice Kit',
      groundLug: 'K2 Ground Lug',
      bondingHardware: 'K2 Bonding Clip',
      flashingKit: 'K2 Flashing Kit',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://www.k2-systems.com/products/crossrail/',
    notes: 'European manufacturer. Good for complex roof geometries.',
  },

  // ── EcoFasten Rock-It ────────────────────────────────────────────────────────
  {
    id: 'ecofasten-rockit',
    manufacturer: 'EcoFasten',
    model: 'Rock-It',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete'],
    loadModel: 'distributed',
    rail: {
      model: 'EcoFasten Rail',
      material: '6005-T5 Aluminum',
      heightIn: 1.75,
      widthIn: 1.75,
      weightPerFtLbs: 0.55,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 4200,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'EcoFasten Rock-It Mount',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 490,
      upliftPerFastenerLbs: 490,
      shearCapacityLbs: 370,
      downwardCapacityLbs: 740,
      maxSpacingIn: 72,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'Integrated flashing. Good for shingle roofs.',
    },
    hardware: {
      midClamp: 'EcoFasten Mid Clamp',
      endClamp: 'EcoFasten End Clamp',
      lFoot: 'EcoFasten Rock-It Foot',
      railSplice: 'EcoFasten Splice Kit',
      groundLug: 'EcoFasten Ground Lug',
      bondingHardware: 'EcoFasten Bonding Clip',
      flashingKit: 'EcoFasten Integrated Flashing',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://ecofastensolar.com/products/rock-it/',
    notes: 'Integrated waterproof flashing. Good for shingle.',
  },

  // ── DPW Solar Power Rail ─────────────────────────────────────────────────────
  {
    id: 'dpw-powerrail',
    manufacturer: 'DPW Solar',
    model: 'Power Rail',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay', 'metal_corrugated'],
    loadModel: 'distributed',
    rail: {
      model: 'Power Rail',
      material: '6005-T5 Aluminum',
      heightIn: 1.80,
      widthIn: 1.80,
      weightPerFtLbs: 0.58,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 4400,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'DPW L-Foot',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 500,
      upliftPerFastenerLbs: 500,
      shearCapacityLbs: 380,
      downwardCapacityLbs: 750,
      maxSpacingIn: 72,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'Standard L-foot. Good documentation.',
    },
    hardware: {
      midClamp: 'DPW Mid Clamp',
      endClamp: 'DPW End Clamp',
      lFoot: 'DPW L-Foot',
      railSplice: 'DPW Splice Kit',
      groundLug: 'DPW Ground Lug',
      bondingHardware: 'DPW Bonding Clip',
      flashingKit: 'DPW Flashing Kit',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://dpwsolar.com/products/power-rail/',
    notes: 'Reliable residential rail system.',
  },

  // ── Schletter Classic ────────────────────────────────────────────────────────
  {
    id: 'schletter-classic',
    manufacturer: 'Schletter',
    model: 'Classic Roof Mount',
    systemType: 'rail_based',
    compatibleRoofTypes: ['shingle', 'tile_concrete', 'tile_clay', 'metal_corrugated', 'metal_standing_seam'],
    loadModel: 'distributed',
    rail: {
      model: 'Schletter FS Rail',
      material: '6005-T5 Aluminum',
      heightIn: 2.00,
      widthIn: 1.75,
      weightPerFtLbs: 0.65,
      maxSpanIn: 78,
      maxCantileverIn: 20,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 5500,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'Schletter Roof Hook',
      attachmentMethod: 'l_foot_lag',
      fastenersPerMount: 1,
      upliftCapacityLbs: 550,
      upliftPerFastenerLbs: 550,
      shearCapacityLbs: 420,
      downwardCapacityLbs: 850,
      maxSpacingIn: 78,
      minEmbedmentIn: 2.5,
      fastenerDiameterIn: 0.3125,
      ulListing: 'UL 2703',
      notes: 'German engineering. Good for high-load applications.',
    },
    hardware: {
      midClamp: 'Schletter Mid Clamp',
      endClamp: 'Schletter End Clamp',
      lFoot: 'Schletter Roof Hook',
      railSplice: 'Schletter Splice Kit',
      groundLug: 'Schletter Ground Lug',
      bondingHardware: 'Schletter Bonding Clip',
      flashingKit: 'Schletter Flashing Kit',
      lagBolt: '5/16" × 3" Lag Bolt (SS)',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://www.schletter-group.com/products/',
    notes: 'German manufacturer. High quality. Good for commercial and residential.',
  },

  // ── Esdec FlatFix (Flat Roof Ballasted) ─────────────────────────────────────
  {
    id: 'esdec-flatfix',
    manufacturer: 'Esdec',
    model: 'FlatFix Fusion',
    systemType: 'ballasted',
    compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_gravel'],
    loadModel: 'distributed',
    rail: {
      model: 'FlatFix Rail',
      material: 'Aluminum',
      heightIn: 1.50,
      widthIn: 1.50,
      weightPerFtLbs: 0.45,
      maxSpanIn: 84,
      maxCantileverIn: 21,
      spliceIntervalIn: 168,
      momentCapacityInLbs: 3600,
      ulListing: 'UL 2703',
    },
    mount: {
      model: 'FlatFix Base',
      attachmentMethod: 'ballasted',
      fastenersPerMount: 0,
      upliftCapacityLbs: 0,          // ballast-dependent
      upliftPerFastenerLbs: 0,
      shearCapacityLbs: 0,
      downwardCapacityLbs: 500,
      maxSpacingIn: 84,
      minEmbedmentIn: 0,
      fastenerDiameterIn: 0,
      ulListing: 'UL 2703',
      notes: 'No penetrations. Ballast weight resists uplift. Verify roof load capacity.',
    },
    hardware: {
      midClamp: 'FlatFix Mid Clamp',
      endClamp: 'FlatFix End Clamp',
      railSplice: 'FlatFix Splice',
      groundLug: 'FlatFix Ground Lug',
      bondingHardware: 'FlatFix Bonding Clip',
      lagBolt: 'N/A — ballasted system',
    },
    ulListing: 'UL 2703',
    warranty: '20 years',
    datasheetUrl: 'https://esdec.com/products/flatfix-fusion/',
    notes: 'No penetrations. Ballasted. Verify roof structural capacity for ballast weight.',
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export function getRackingById(id: string): RackingSystemSpec | undefined {
  return RACKING_DATABASE.find(r => r.id === id);
}

export function getRackingByManufacturer(manufacturer: string): RackingSystemSpec[] {
  return RACKING_DATABASE.filter(r => r.manufacturer === manufacturer);
}

export function getRackingForRoofType(roofType: RoofTypeId): RackingSystemSpec[] {
  return RACKING_DATABASE.filter(r => r.compatibleRoofTypes.includes(roofType));
}

export function getManufacturers(): string[] {
  return [...new Set(RACKING_DATABASE.map(r => r.manufacturer))];
}

// Map legacy equipment-db IDs to racking-database IDs
export const LEGACY_ID_MAP: Record<string, string> = {
  'ironridge-xr100':    'ironridge-xr100',
  'ironridge-xr1000':   'ironridge-xr1000',
  'unirac-solarmount':  'unirac-solarmount',
  'snapnrack-100':      'snapnrack-100',
  'quickmount-classic': 'quickmount-classic',
  'esdec-flatfix':      'esdec-flatfix',
  's5-pvkit':           's5-pvkit',
  'rooftech-mini':      'rooftech-mini',
};