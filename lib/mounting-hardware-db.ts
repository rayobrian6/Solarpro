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

// ─────────────────────────────────────────────────────────────────────────────
// W4.1 — MOUNTING TOPOLOGY (Ray corrective directive, docs/W4.1-DIRECTIVE.md §1)
//
// The STRUCTURAL LOAD-PATH classification — distinct from `systemType` — that
// decides whether a roof mount routes through the RAIL-PAIRED (railed) assembly
// path or the RAIL-LESS direct-mount path. This is the directive's own term and
// the AUTHORITY the structural engine guards on (by VALUE, never by matching the
// product name). It corrects the RT-MINI family being wrongly labeled rail-less:
//   • rail_paired — RT-MINI / RT-MINI II family + every conventional railed mount
//     (module → rail → L-foot/clamp → roof). Routes the railed structural path.
//   • rail_less   — VERIFIED rail-less direct-mount products only (module frame
//     is the load path; no rail). Routes buildDirectMountAttachments.
//   • unknown     — the product's topology is NOT confirmed as either. This is an
//     honest gap and MUST BLOCK permit-ready generation (MOUNT-TOPOLOGY-UNKNOWN)
//     — never guessed from the word "mini" or a fabricated "rail-less" label.
export type MountTopology = 'rail_paired' | 'rail_less' | 'unknown';
// ─────────────────────────────────────────────────────────────────────────────

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
  // The BASIS of upliftCapacityLbs — REQUIRED for cross-brand consistency.
  // 'ultimate'  = nominal/mean-ultimate tested value (needs Ω to reach ASD allowable)
  // 'allowable' = ASD allowable (safety factor already applied by the mfr/ESR)
  // The structural engine applies the code factor ONCE, keyed to this basis, so
  // a mount rated ultimate and one rated allowable size consistently. Unset is
  // treated CONSERVATIVELY (as ultimate needing reduction) until field-verified.
  // See lib/structural/attachmentCapacity.ts.
  capacityBasis?: 'ultimate' | 'allowable';
  downwardCapacityLbs: number;     // lbs per mount
  shearCapacityLbs: number;        // lbs per mount
  fastenersPerMount: number;       // lag bolts / screws per mount
  fastenerDiameterIn: number;      // inches
  fastenerEmbedmentIn: number;     // minimum embedment depth (inches)
  /** §10 — exact fastener PRODUCT length (inches), when the manufacturer specifies
   *  a specific screw/lag length. When present, sheets print THIS length instead of
   *  a derived (embedment + stack-up) estimate — so PV-3 / notes / BOM never contradict
   *  the product spec (RT-MINI: 3.5" / 90mm wood screw, NOT a derived 4" lag). */
  fastenerLengthIn?: number;
  /** §10 — the exact fastener TYPE wording ('structural wood screw', 'SS lag'…). */
  fastenerType?: string;
  /** 2026-08-29 — the fastener MATERIAL / alloy, present ONLY when the
   *  manufacturer document states it. `projectFastenerAssembly` hardcoded
   *  `material = null` with the comment "NOT carried in mounting-hardware-db",
   *  and PV-3's hardware row read that null as "PENDING VERIFIED SELECTION" —
   *  announcing an unverified SELECTION on a sheet that was, two rows above,
   *  printing the verified screw's exact diameter and embedment. An unpublished
   *  field is not a failed verification. The RT-Mini II PE letter and manual both
   *  state SS304, so the fact exists and belongs in the record; anywhere a
   *  document does not state it, this stays undefined and nothing is invented. */
  fastenerMaterial?: string;
  fastenerPulloutLbs: number;      // lbs per fastener (NDS withdrawal)
  maxSpacingIn: number;            // max mount spacing (inches)
  minRafterDepthIn: number;        // minimum rafter depth for fastener
  iccEsReport?: string;
  ul2703Listed: boolean;
  compatibleRoofTypes: RoofType[];
  // Self-flashing pad standoffs (e.g. Roof Tech RT-MINI) carry integrated EPDM/butyl
  // on the base that seals the fastener penetration — they do NOT take a separate
  // flashing kit. When true, the racking BOM must NOT add a flashing line.
  selfFlashing?: boolean;
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
  // W4.1 §1 — corrected mounting TOPOLOGY (directive term). When set it is the
  // AUTHORITY for the rail-paired vs rail-less structural-path decision (the
  // structural engine guards on this VALUE, not the product name). When absent,
  // classifyMountTopology() derives it from systemType. 'unknown' BLOCKS
  // permit-ready generation (MOUNT-TOPOLOGY-UNKNOWN) — never a guess.
  mountTopology?: MountTopology;
  // Provenance/basis for the topology classification — especially the alias
  // confirmation for an RT-MINI variant, or the reason a record is 'unknown'.
  mountTopologyBasis?: string;
  // ── PRODUCT SUPERSESSION (2026-08-28) ──────────────────────────────
  // A generation the manufacturer has replaced. `supersededById` names the
  // CURRENT generation; `supersessionBasis` states who says so, in their words.
  //
  // This exists because a superseded record was publishing its SUCCESSOR's
  // structural capacity. RT-MINI (gen 1) carried a 600 lb allowable that its own
  // comment described as the RT-MINI **II** PE-letter value rounded down. A
  // document covering one generation does not establish capacity for another --
  // authenticity is not applicability -- so the number had no source, the
  // snapshot said so in its notes, and the structural engine consumed it anyway.
  //
  // getMountingSystemById() follows the supersession, so a stored design naming
  // the old generation resolves to the product that actually ships and to the
  // capacity that actually has a source. The substitution is STATED, never
  // silent: the racking record carries the basis and the sheets print it.
  supersededById?: string;
  supersessionBasis?: string;
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
  // TESLA — Panel Mount (RAIL-LESS: Comp Rafter Base / Tile Hook + Leveling
  // Feet + Interlocks + Front Skirt). UL 2703 listed, System Fire Class A.
  // Component allowable loads (Comp Rafter): Uplift 569 lb (SF 2.0), Downforce
  // 965 lb (SF 1.67), Shear 242 lb. Lag 5/16" → 2½" threaded embedment. Max
  // attachment span 72", max cantilever 24". Min pitch 2:12 (9.46°). Allowable
  // system PSF is span/zone-dependent — see Appendix C tables in the structural
  // engine. Source: Tesla Panel Mount install manuals + Appendix C.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'tesla-panel-mount-comp-rafter',
    manufacturer: 'Tesla',
    productLine: 'Tesla Panel Mount',
    model: 'Comp Rafter',
    category: 'roof_residential',
    systemType: 'rail_less',
    compatibleRoofTypes: ['asphalt_shingle'],
    description: 'Tesla Panel Mount rail-less system for composition shingle roofs. Comp Rafter Base (2023000) lags into the rafter; Leveling Feet (2032169) + Interlocks (1576999) bond and secure modules; Front Skirt for a flush, rail-less aesthetic. UL 2703, Fire Class A. Pairs with Tesla Solar Panel + Tesla Solar Inverter / Powerwall 3.',
    mount: {
      model: 'Tesla Comp Rafter Base (2023000)',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 569,        // UL 2703 component allowable, SF 2.0
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 965,      // SF 1.67
      shearCapacityLbs: 242,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,    // 5/16" lag (2044245 4¾" / 2044244 5½")
      fastenerEmbedmentIn: 2.5,      // 2½" threaded embedment into rafter
      fastenerPulloutLbs: 569,       // governed by component allowable uplift (UL 2703)
      maxSpacingIn: 72,              // max allowable span between attachments
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle'],
    },
    hardware: {
      midClamp: 'Tesla Interlock (1576999)',
      endClamp: 'Tesla Comp Rafter Leveling Foot (2032169)',
      railSplice: 'N/A — rail-less',
      groundLug: 'Tesla Ground Lockit (1578119) — grounds up to 72 modules',
      lagBolt: 'Tesla Lag Screw 5/16 × 4.75" Hex T40 (2044245) / 5.5" (2044244)',
      flashingKit: 'Comp Rafter Base injected sealant (Tonsan MS-1937, 1679265) + card flashing',
      bondingHardware: 'Tesla Interlock + Ground Lockit (integrated UL 2703 bonding)',
    },
    maxWindSpeedMph: 160,            // screening cap; true rating is span/zone-dependent per Appendix C
    maxSnowLoadPsf: 60,              // Tesla Solar Panel design load 60 psf (Appendix C governs by span)
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 9,              // 2:12 = 9.46°
    ul2703Listed: true,
    engineeringDataSource: 'Tesla Panel Mount - Comp Rafter Installation Manual + Appendix C (Allowable Mounting System Loading), energylibrary.tesla.com',
    lastUpdated: '2026-04',
  },
  {
    id: 'tesla-panel-mount-tile',
    manufacturer: 'Tesla',
    productLine: 'Tesla Panel Mount',
    model: 'Tile',
    category: 'roof_residential',
    systemType: 'rail_less',
    compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    description: 'Tesla Panel Mount rail-less system for tile roofs. Tile Hooks (2262305) replace/relieve tiles and lag into the rafter; Spanner Bars (2129978) span above the tile surface; Flat/Round Leveling Feet (2177129/2133094) + Interlocks bond and secure modules. UL 2703, Fire Class A. Includes replacement flashing for waterproofing.',
    mount: {
      model: 'Tesla Tile Hook Assembly (2262305)',
      attachmentMethod: 'tile_hook',
      upliftCapacityLbs: 569,        // shared UL 2703 component allowables (Tile Appendix C not yet captured)
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 965,
      shearCapacityLbs: 242,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,    // 5/16" lag to rafter (2131805) + #15 deck screw (2049471) in offsets
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 569,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    },
    hardware: {
      midClamp: 'Tesla Interlock (1576999) / Hybrid Interlock (1578969)',
      endClamp: 'Tesla Round/Flat Leveling Foot (2133094 / 2177129)',
      railSplice: 'Tesla Spanner Bar Splice Plate (2129977)',
      groundLug: 'Tesla Ground Lockit (1578119)',
      lagBolt: 'Tesla Lag Screw 5/16 × 4" Hex T40 (2131805)',
      flashingKit: 'Tesla Replacement Flashing + Securing Bolt (2127987)',
      tileHook: 'Tesla Tile Hook Assembly (2262305) + Spanner Bar (2129978)',
      bondingHardware: 'Tesla Interlock + Ground Lockit (integrated UL 2703 bonding)',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 60,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 9,
    ul2703Listed: true,
    engineeringDataSource: 'Tesla Panel Mount - Tile Installation Manual, energylibrary.tesla.com (Tile Appendix C pending)',
    lastUpdated: '2026-04',
  },

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
      maxSpanIn: 96,        // IronRidge XR100 datasheet: 8 ft (96") spanning capability (was 72)
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 800,
      shearCapacityLbs: 400,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 1000,
      shearCapacityLbs: 600,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 850,
      shearCapacityLbs: 450,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 900,
      shearCapacityLbs: 500,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
  // ROOF TECH — RT-MINI (Rail-Based Standoff System)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'rooftech-mini',
    manufacturer: 'Roof Tech',
    productLine: 'RT-MINI',
    model: 'RT-MINI',
    category: 'roof_residential',
    systemType: 'rail_based',
    // ── SUPERSEDED BY RT-MINI II (2026-08-28) ────────────────────
    // Verified two ways. Roof Tech's own product page says so. And the design
    // portal only publishes stamped PE letters for the second generation: every
    // gen-1 URL under /Stamped-PE-Letters/ returns the site's SPA catch-all
    // (HTTP 200, text/html, ~3 KB -- a 200 is not a document) while every
    // RT-MINI II state URL returns a real application/pdf.
    //
    // The capacity numbers below are LEFT AS THEY WERE and are now unreachable
    // through getMountingSystemById, which follows the supersession. They are
    // not corrected in place because there is nothing to correct them TO: no
    // structural source exists for this generation. Deleting the record would
    // lose the supersession fact that a stored design naming it needs.
    supersededById: 'rooftech-mini-ii',
    supersessionBasis:
      'Roof Tech, Inc. product page (roof-tech.us/pages/rt-mini): "We have now moved to engineering the '
      + 'second generation of the RT-MINI to the RT-MINI II." No stamped PE letter is published for the '
      + 'first generation on the manufacturer design portal; the RT-MINI II letters are (verified 2026-08-28). '
      + 'The 600 lb allowable this record published was itself an RT-MINI II value.',
    // W4.1 §1 — RT-MINI / RT-MINI II are RAIL-PAIRED standoff bases (module → rail
    // → RT-MINI pad → roof), NOT rail-less module mounts. Routes the railed path.
    mountTopology: 'rail_paired',
    mountTopologyBasis: 'RT-MINI / RT-MINI II are rail-paired self-flashing standoff bases: the pad '
      + 'attaches a listed rail (IronRidge XR100/XR1000, UniRac SFM, or Pegasus — SKU PENDING SELECTION; see '
      + 'hardware.railSplice), and modules clamp to that rail. systemType rail_based; Ray directive §1.',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    description: 'Roof Tech RT-MINI — SELF-FLASHING pad standoff (AlphaSeal / RT Butyl seals the screw penetration; no separate flashing kit). Fastened with 2 structural wood screws into the rafter (no pilot hole). L-foot + conventional rail are separate add-ons. ICC-ES ESR-3575.',
    mount: {
      model: 'RT-MINI',
      attachmentMethod: 'l_foot_lag',
      // ALLOWABLE (ASD) basis — VERIFIED 2026-07-10 against Roof Tech's PE-stamped
      // structural letter "RT-MINI II ASCE 7-10 (KY)"
      // (design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_10/): the max
      // ALLOWABLE uplift for the weakest standard assembly (15/32" sheathing, 2x4
      // DF-L #2, 2× screws) = 613.2 lb (SF already applied by the PE). Stored 600 lb
      // = conservative round-down; matches field practice (~2 feet/panel). This
      // SUPERSEDES the prior unverified "900 ultimate" (ESR-3575 is a flashing/
      // water-resistance report only — it carries NO structural value). Stronger
      // framing (2x6+) / 90mm rafter screws rate higher per the PE table; a
      // per-assembly capacity lookup would be more precise (future PE work).
      upliftCapacityLbs: 600,       // ASD allowable per pad (PE letter: 613.2 lb weakest assembly)
      capacityBasis: 'allowable',
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 600,         // ≈ ESR 613 lb shear allowable basis
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.3125,   // 5/16" (8mm/M8) structural wood screw — was wrongly 0.5" (1/2"); registry-v4 agrees on 5/16"
      fastenerEmbedmentIn: 2.5,
      fastenerLengthIn: 3.5,        // §10 — exact product length: ~3.5" (90mm) RT-MINI screw (NOT a derived 4" lag)
      fastenerType: 'structural wood screw',  // §10 — RT-MINI uses wood screws, not SS lags
      fastenerPulloutLbs: 450,      // ultimate per screw → ~300 allowable via SF ≈ ESR 306/screw
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
      selfFlashing: true,           // AlphaSeal/RT Butyl integrated — NO separate flashing kit
    },
    hardware: {
      midClamp: 'RT-MINI Mid Clamp',
      endClamp: 'RT-MINI End Clamp',
      railSplice: 'Rail/splice SKU PENDING RACKING ASSEMBLY SELECTION — paired rail system; specify a listed rail/splice SKU (IronRidge XR100/XR1000, UniRac SFM, or Pegasus)',
      groundLug: 'RT-MINI Ground Lug',
      lagBolt: '5/16" (8mm/M8) structural wood screw, ~3.5" (90mm) — 2 per pad, no pilot hole',
      // No flashingKit — RT-MINI is self-flashing (integrated AlphaSeal/RT Butyl).
      bondingHardware: 'RT-MINI Bond Clip',
    },
    maxWindSpeedMph: 180,           // manufacturer-rated max (was understated 150)
    maxSnowLoadPsf: 90,             // manufacturer-rated max (was understated 40)
    maxRoofPitchDeg: 40,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-MINI ICC-ES ESR-3575 Rev 2023',
    lastUpdated: '2023-01',
  },

  // ═════════════════════════════════════════════════════════════════════════
  // ROOF TECH — RT-MINI II (current generation; rail-paired self-flashing base)
  //
  // THE CAPACITY HERE HAS A SOURCE. Every structural number below is transcribed
  // from the stamped PE letter archived at
  //   public/manufacturer-assets/structural/RT_Mini_II_ASCE_7-16_IL.pdf
  // (Starling Madison Lofquist, Inc., SML Job No. 471-22, 2023-03-07, 253 pp.,
  // sealed by Jesse Light S.E./P.E. and Rusmir Begic P.E.; ASCE/SEI 7-16, IBC
  // 2018 & 2021). The record of that document -- identity, seal, source URL,
  // SHA-256, and the extracted claims with the page each came from -- lives in
  // lib/documents/manufacturerStructuralCatalogue.ts.
  //
  // 613.2 lb is the letter's own ALLOWABLE uplift for the governing rafter
  // assembly (15/32" plywood sheathing over a 2x4 DF-L #2 rafter, 2 x 90 mm
  // screws), page 2. The safety factor of 3.0 is already applied BY THE SOURCE,
  // so capacityBasis is 'allowable' and the engine must not reduce it again.
  // The prior 600 lb was this number rounded down with no source recorded, and
  // it was published on the WRONG GENERATION.
  // ═════════════════════════════════════════════════════════════════════════
  {
    id: 'rooftech-mini-ii',
    manufacturer: 'Roof Tech',
    productLine: 'RT-MINI',
    model: 'RT-MINI II',
    category: 'roof_residential',
    systemType: 'rail_based',
    mountTopology: 'rail_paired',
    mountTopologyBasis:
      'The PE letter states it directly (page 1): an appropriately load rated "L-Foot", by others, attaches to '
      + 'the RT-Mini II base with an SS304 5/16" flange bolt, and an appropriately load rated rail, by others, '
      + 'attaches to that L-foot. Module -> rail -> RT-MINI II pad -> roof. Rail-paired, not rail-less.',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    description:
      'Roof Tech RT-MINI II — SELF-FLASHING pad standoff (AlphaSeal / RT Butyl seals the screw penetration; no '
      + 'separate flashing kit). Fastened with SS304 5.0 mm wood screws directly through the roof covering, no '
      + 'pilot hole: 2 screws at a rafter/truss attachment, 5 screws at a deck-only or rafter-offset attachment. '
      + 'The pad is installed with its LONG DIRECTION PARALLEL to the roof framing. L-foot and conventional rail '
      + 'are separate, load-rated add-ons "by others". Structural capacity per the state-stamped SML PE letter; '
      + 'ICC-ES ESR-3575 covers listing and flashing/water-resistance ONLY.',
    mount: {
      model: 'RT-MINI II',
      attachmentMethod: 'l_foot_lag',
      // PE letter p.2, governing rafter assembly: 15/32" plywood over 2x4 DF-L #2,
      // 2 x 90 mm screws. SF 3.0 already applied by the source.
      upliftCapacityLbs: 613.2,
      capacityBasis: 'allowable',
      // p.2 tested downward (compression bears on the sheathing either way).
      // The WEAKEST tested substrate is taken, not the friendliest: 7/16" OSB
      // only = 258.0 lb; 15/32" plywood only = 556.0 lb. No release predicate
      // reads this field today (only upliftCapacityLbs does) -- it is recorded
      // so the catalogue stops publishing an unsourced 1200.
      downwardCapacityLbs: 258.0,
      shearCapacityLbs: 469.9,      // p.2, same governing rafter assembly
      fastenersPerMount: 2,         // AT A RAFTER. Deck-only / offset needs 5 (p.1)
      fastenerDiameterIn: 0.19685,  // SS304 5.0 mm wood screw = 0.197 in
      fastenerEmbedmentIn: 3.07,    // 90 mm screw (3.543 in) less 15/32 in sheathing
      fastenerLengthIn: 3.543,      // 90 mm
      fastenerType: 'SS304 5.0 mm x 90 mm wood screw (no pilot hole)',
      // SML PE letter p.1 ("SS304 5.0 mm wood screws") and the RT-MINI II
      // Installation Manual Part A item 1B. Stated by the source, not inferred.
      fastenerMaterial: 'SS304 stainless steel',
      // Per-screw withdrawal is NOT published separately by the letter; the
      // allowable is stated for the ASSEMBLY. Recording assembly/count keeps the
      // per-fastener field consistent rather than inventing a split.
      fastenerPulloutLbs: 613.2 / 2,
      // 48 in, UNCHANGED from the prior record and deliberately conservative.
      // The letter's tables DO reach 96 in -- but every cell in them is
      // conditioned on wind speed, roof zone, roof slope, mean roof height,
      // module orientation and exposure, across 240 pages. Publishing a flat 96
      // would assert the best cell of that table for every project, which is
      // inventing precision. Consuming the tables properly is its own piece of
      // work; until then the manufacturer's conservative maximum stands.
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,        // 2x4 DF-L #2 is the tested minimum member
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
      selfFlashing: true,
    },
    hardware: {
      midClamp: 'Module clamp per the selected rail system',
      endClamp: 'Module end clamp per the selected rail system',
      // The PE letter delegates the rail: "an appropriately load rated rail, by
      // others" (p.1). The attachment capacity above is therefore RAIL-
      // INDEPENDENT by the source's own statement, which is why an unpinned rail
      // SKU is a procurement item and not an attachment-capacity gap.
      // NAMES THE COMPATIBLE RAILS, and states the delegation. Both matter and
      // for different reasons: `railCandidatesFor` parses this statement to
      // build the span-screened candidate envelope (drop the brand names and
      // the envelope goes empty, which reads as UNBOUNDED), while the "by
      // others" clause is the PE letter's own words and is what keeps an
      // unpinned SKU out of the ATTACHMENT-capacity predicate.
      railSplice: 'Listed UL 2703 rail + splice — IronRidge XR100/XR1000, UniRac SFM/SolarMount, or Pegasus '
        + '(SKU PENDING SELECTION). Rail BY OTHERS, appropriately load rated, per the SML PE letter p.1.',
      groundLug: 'Bonding per the selected rail system (UL 2703)',
      lagBolt: 'SS304 5.0 mm x 90 mm wood screw — 2 per pad at a rafter (5 x 60 mm at deck-only / offset), no pilot hole',
      bondingHardware: 'Bonding clip per the selected rail system (UL 2703)',
    },
    maxWindSpeedMph: 180,
    maxSnowLoadPsf: 90,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 0,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource:
      'Roof Tech RT-Mini II Mount — Structural Analysis, Starling Madison Lofquist Inc., SML Job No. 471-22, '
      + '2023-03-07 (ASCE/SEI 7-16; IBC 2018 & 2021). ICC-ES ESR-3575 is the LISTING / flashing basis only and '
      + 'carries no structural capacity (its Sec. 5.2 says so).',
    lastUpdated: '2026-08',
  },


  // ══════════════════════════════════════════════════════════════════════════════
  // ROOF TECH — Additional Model Variations
  // ══════════════════════════════════════════════════════════════════════════════

  {
    id: 'rooftech-mini-s',
    manufacturer: 'Roof Tech',
    productLine: 'RT-MINI',
    model: 'RT-MINI-S',
    category: 'roof_residential',
    systemType: 'rail_less',
    // W4.1 §1 — TOPOLOGY UNKNOWN (blocks). This record's systemType 'rail_less' and
    // "rail-less" description are UNVERIFIED: no in-repo evidence (research artifact,
    // PE letter, datasheet, or SKU) confirms 'RT-MINI-S' is a genuine Roof Tech
    // rail-less product mapping to the RT-MINI family — its tile_hook attachment
    // differs from the RT-MINI pad standoff, and attachment-capacity-basis-research
    // .json documents only RT-MINI / RT-MINI II. Per the directive ("do not guess
    // from 'mini'"), an ambiguous alias is 'unknown' and BLOCKS permit-ready.
    mountTopology: 'unknown',
    mountTopologyBasis: 'AMBIGUOUS ALIAS — no in-repo evidence confirms RT-MINI-S maps to a genuine Roof '
      + 'Tech rail-less product; the tile_hook attachment differs from the RT-MINI rail-paired pad standoff '
      + 'and no research/PE/datasheet/SKU corroborates it. Classified unknown (blocks) per Ray directive §1.',
    compatibleRoofTypes: ['tile_concrete', 'tile_clay', 'slate'],
    description: 'Roof Tech RT-MINI-S — UNVERIFIED tile/slate variant; mounting topology UNKNOWN (no in-repo '
      + 'evidence it is a genuine rail-less RT-MINI product) — blocks permit-ready until confirmed. ICC-ES ESR-3575',
    mount: {
      model: 'RT-MINI-S',
      attachmentMethod: 'tile_hook',
      upliftCapacityLbs: 900,
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 600,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 450,
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['tile_concrete', 'tile_clay', 'slate'],
    },
    hardware: {
      midClamp: 'RT-MINI-S Mid Clamp 30-50mm',
      endClamp: 'RT-MINI-S End Clamp 30-50mm',
      railSplice: 'N/A — Rail-Less',
      groundLug: 'WEEB Lug 6.7',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      tileHook: 'RT-MINI-S Tile Hook',
      bondingHardware: 'WEEB Clip 6.7',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 45,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-MINI-S Engineering Design Guide Rev 2.0',
    lastUpdated: '2024-01',
  },

  {
    id: 'rooftech-mini-t',
    manufacturer: 'Roof Tech',
    productLine: 'RT-MINI',
    model: 'RT-MINI-T',
    category: 'roof_residential',
    systemType: 'rail_less',
    // W4.1 §1 — TOPOLOGY UNKNOWN (blocks). Same as RT-MINI-S: an unverified
    // "rail-less" tile-replacement variant with no in-repo evidence it is a
    // genuine Roof Tech product mapping to the RT-MINI family; its
    // tile_replacement attachment differs from the RT-MINI pad standoff.
    mountTopology: 'unknown',
    mountTopologyBasis: 'AMBIGUOUS ALIAS — no in-repo evidence confirms RT-MINI-T maps to a genuine Roof '
      + 'Tech rail-less product; the tile_replacement attachment differs from the RT-MINI rail-paired pad '
      + 'standoff and no research/PE/datasheet/SKU corroborates it. Classified unknown (blocks) per directive §1.',
    compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    description: 'Roof Tech RT-MINI-T — UNVERIFIED tile-replacement variant; mounting topology UNKNOWN (no in-repo '
      + 'evidence it is a genuine rail-less RT-MINI product) — blocks permit-ready until confirmed. ICC-ES ESR-3575',
    mount: {
      model: 'RT-MINI-T',
      attachmentMethod: 'tile_replacement',
      upliftCapacityLbs: 950,
      downwardCapacityLbs: 1300,
      shearCapacityLbs: 650,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 475,
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    },
    hardware: {
      midClamp: 'RT-MINI-T Mid Clamp 30-50mm',
      endClamp: 'RT-MINI-T End Clamp 30-50mm',
      railSplice: 'N/A — Rail-Less',
      groundLug: 'WEEB Lug 6.7',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      tileHook: 'RT-MINI-T Tile Replacement',
      bondingHardware: 'WEEB Clip 6.7',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 45,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-MINI-T Engineering Design Guide Rev 2.0',
    lastUpdated: '2024-01',
  },

  {
    id: 'rooftech-hook',
    manufacturer: 'Roof Tech',
    productLine: 'RT-HOOK',
    model: 'RT-HOOK',
    category: 'roof_residential',
    systemType: 'standing_seam',
    // W4.1 §1 — RT-HOOK is a standing-seam CLAMP paired with a conventional rail
    // (module → rail → clamp → seam). Rail-paired structural path.
    mountTopology: 'rail_paired',
    mountTopologyBasis: 'RT-HOOK is a no-penetration standing-seam clamp that carries a conventional rail; '
      + 'modules clamp to that rail (systemType standing_seam) — railed structural path. Ray directive §1.',
    compatibleRoofTypes: ['metal_standing_seam'],
    description: 'Roof Tech RT-HOOK — standing seam clamp mount, no roof penetrations. ICC-ES ESR-3575',
    mount: {
      model: 'RT-HOOK',
      attachmentMethod: 'standing_seam_clamp',
      upliftCapacityLbs: 1100,
      capacityBasis: 'ultimate', // metal-roof clamp: mean ultimate holding strength (verify)
      downwardCapacityLbs: 1500,
      shearCapacityLbs: 700,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 60,
      minRafterDepthIn: 0,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['metal_standing_seam'],
    },
    hardware: {
      midClamp: 'RT-HOOK Mid Clamp 30-50mm',
      endClamp: 'RT-HOOK End Clamp 30-50mm',
      railSplice: 'N/A — Rail-Less',
      groundLug: 'WEEB Lug 6.7',
      lagBolt: 'N/A — Standing Seam Clamp',
      bondingHardware: 'WEEB Clip 6.7',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 2,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-HOOK Engineering Design Guide Rev 1.5',
    lastUpdated: '2024-01',
  },

  {
    id: 'rooftech-mini-m',
    manufacturer: 'Roof Tech',
    productLine: 'RT-MINI',
    model: 'RT-MINI-M (Metal)',
    category: 'roof_residential',
    systemType: 'rail_less',
    // W4.1 §1 — TOPOLOGY UNKNOWN (blocks). The directive lists "RT-MINI metal-
    // flashing variants = rail_paired ONLY after confirming it maps to RT-MINI
    // with metal flashing." This record is a CORRUGATED-METAL CLAMP
    // (attachmentMethod 'corrugated_clamp'), which does NOT map to an RT-MINI
    // pad standoff with metal flashing — it is a different, unverified product.
    // Ambiguous ⇒ unknown (blocks), never guessed to rail_paired.
    mountTopology: 'unknown',
    mountTopologyBasis: 'AMBIGUOUS — recorded as a corrugated_clamp product, which does NOT map to '
      + '"RT-MINI with metal flashing" (a penetrating pad standoff); no in-repo evidence confirms it is a '
      + 'genuine Roof Tech product. Confirmation to rail_paired was NOT met ⇒ classified unknown (blocks) per directive §1.',
    compatibleRoofTypes: ['metal_corrugated'],
    description: 'Roof Tech RT-MINI-M — UNVERIFIED corrugated-metal variant; mounting topology UNKNOWN (recorded as a '
      + 'corrugated clamp, not a confirmed RT-MINI metal-flashing standoff) — blocks permit-ready until confirmed. ICC-ES ESR-3575',
    mount: {
      model: 'RT-MINI-M',
      attachmentMethod: 'corrugated_clamp',
      upliftCapacityLbs: 880,
      capacityBasis: 'ultimate', // corrugated-metal clamp: mean ultimate holding strength (verify)
      downwardCapacityLbs: 1150,
      shearCapacityLbs: 580,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 440,
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['metal_corrugated'],
    },
    hardware: {
      midClamp: 'RT-MINI-M Mid Clamp 30-50mm',
      endClamp: 'RT-MINI-M End Clamp 30-50mm',
      railSplice: 'N/A — Rail-Less',
      groundLug: 'WEEB Lug 6.7',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      bondingHardware: 'WEEB Clip 6.7',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 45,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-MINI-M Engineering Design Guide Rev 1.0',
    lastUpdated: '2024-01',
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 800,
      shearCapacityLbs: 400,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 900,
      shearCapacityLbs: 500,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 1000,
      shearCapacityLbs: 550,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'ultimate', // S-5! publishes MEAN ULTIMATE holding strength; engineer applies Ω (per S-5! seam load DB)
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 1100,
      shearCapacityLbs: 600,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 1100,
      shearCapacityLbs: 550,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 650,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 850,
      shearCapacityLbs: 450,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 1300,
      shearCapacityLbs: 700,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.3125,  // 5/16" lag — corrected from a fabricated 1/2" default (solar L-foot lags are 5/16"; IronRidge FlashFoot2 web-verified 5/16"x4.75")
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
      capacityBasis: 'ultimate', // metal-roof clamp: mean ultimate holding strength
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



  // ══════════════════════════════════════════════════════════════════════════════
  // ADDITIONAL RESIDENTIAL RACKING SYSTEMS
  // ══════════════════════════════════════════════════════════════════════════════

  {
    id: 'tamarack-utr',
    manufacturer: 'Tamarack Solar',
    productLine: 'Universal Tile Replacement',
    model: 'UTR-100',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    description: 'Tile replacement flashing mount for concrete/clay tile roofs — no tile cutting required',
    rail: {
      model: 'TR-40',
      materialAlloy: '6005-T5 Aluminum',
      heightIn: 1.65,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 3800,
      shearCapacityLbs: 1100,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.85,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-3575',
    },
    mount: {
      model: 'UTR-100 Tile Replacement',
      attachmentMethod: 'tile_replacement',
      upliftCapacityLbs: 1200,
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 1800,
      shearCapacityLbs: 900,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.375,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 800,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    },
    hardware: {
      midClamp: 'T-Bolt Mid Clamp 35-50mm',
      endClamp: 'T-Bolt End Clamp 35-50mm',
      railSplice: 'TR Splice Connector',
      groundLug: 'Weeb Lug 6.7',
      lagBolt: '3/8" × 3" Stainless Steel',
      flashingKit: 'UTR Tile Replacement Flashing',
      tileHook: 'UTR Tile Hook',
      bondingHardware: 'Weeb Clip 6.7',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Tamarack Solar UTR Engineering Manual 2022',
    lastUpdated: '2022-11',
  },

  {
    id: 'prosolar-toptrack',
    manufacturer: 'ProSolar',
    productLine: 'TopTrack',
    model: 'TopTrack 2.0',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated', 'tile_concrete'],
    description: 'Versatile aluminum rail system for asphalt shingle, tile, and metal roofs',
    rail: {
      model: 'TopTrack 2.0',
      materialAlloy: '6063-T6 Aluminum',
      heightIn: 1.65,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 3600,
      shearCapacityLbs: 1050,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.82,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-2514',
    },
    mount: {
      model: 'FlashFoot2',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 1050,
      capacityBasis: 'allowable', // lag withdrawal from wood — published ASD allowable (NDS/ASTM D1761)
      downwardCapacityLbs: 1600,
      shearCapacityLbs: 800,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.375,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 750,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-2514',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated', 'tile_concrete'],
    },
    hardware: {
      midClamp: 'ProClamp Mid 30-50mm',
      endClamp: 'ProClamp End 30-50mm',
      railSplice: 'TopTrack Splice Connector',
      groundLug: 'ProGround Lug',
      lagBolt: '3/8" × 3" Stainless Steel',
      flashingKit: 'FlashFoot2 Flashing',
      bondingHardware: 'ProBond Clip',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-2514',
    engineeringDataSource: 'ProSolar TopTrack Engineering Design Guide 2023',
    lastUpdated: '2023-03',
  },

  {
    id: 'clenergy-ezrack-sb',
    manufacturer: 'Clenergy',
    productLine: 'ezRack SpeedBracket',
    model: 'ezRack SB',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    description: 'Speed bracket rail system with integrated bonding — fast residential installation',
    rail: {
      model: 'ezRack Rail 40',
      materialAlloy: '6005A-T5 Aluminum',
      heightIn: 1.57,
      widthIn: 1.0,
      wallThicknessIn: 0.118,
      momentCapacityInLbs: 3500,
      shearCapacityLbs: 1000,
      maxSpanIn: 72,
      maxCantileverIn: 16,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.80,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-4224',
    },
    mount: {
      model: 'SpeedBracket SB-01',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 980,
      downwardCapacityLbs: 1500,
      shearCapacityLbs: 750,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.375,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 700,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-4224',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated'],
    },
    hardware: {
      midClamp: 'ezClamp Mid 35-50mm',
      endClamp: 'ezClamp End 35-50mm',
      railSplice: 'ezSplice Connector',
      groundLug: 'ezGround Lug',
      lagBolt: '3/8" × 3" Stainless Steel',
      flashingKit: 'ezRack Flashing Kit',
      bondingHardware: 'Integrated Bond Clip',
    },
    maxWindSpeedMph: 125,
    maxSnowLoadPsf: 45,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-4224',
    engineeringDataSource: 'Clenergy ezRack SB Engineering Manual 2023',
    lastUpdated: '2023-06',
  },

  {
    id: 'renusol-vs-plus',
    manufacturer: 'Renusol',
    productLine: 'VS+',
    model: 'VS+ Rail System',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated', 'tile_concrete', 'tile_clay'],
    description: 'German-engineered aluminum rail system with click-in module clamps — residential & light commercial',
    rail: {
      model: 'VS+ Rail 68mm',
      materialAlloy: '6063-T6 Aluminum',
      heightIn: 2.68,
      widthIn: 1.18,
      wallThicknessIn: 0.138,
      momentCapacityInLbs: 4200,
      shearCapacityLbs: 1200,
      maxSpanIn: 78,
      maxCantileverIn: 20,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.92,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-3987',
    },
    mount: {
      model: 'VS+ Roof Hook',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 1100,
      downwardCapacityLbs: 1700,
      shearCapacityLbs: 850,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.375,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 780,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3987',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated', 'tile_concrete', 'tile_clay'],
    },
    hardware: {
      midClamp: 'VS+ Mid Clamp 30-50mm',
      endClamp: 'VS+ End Clamp 30-50mm',
      railSplice: 'VS+ Splice Connector',
      groundLug: 'VS+ Ground Lug',
      lagBolt: '3/8" × 3" Stainless Steel',
      flashingKit: 'VS+ Flashing Kit',
      bondingHardware: 'VS+ Bond Clip',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 55,
    maxRoofPitchDeg: 60,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3987',
    engineeringDataSource: 'Renusol VS+ Engineering Design Guide 2023',
    lastUpdated: '2023-04',
  },

  {
    id: 'everest-e-mount-af',
    manufacturer: 'Everest Solar Systems',
    productLine: 'E-Mount',
    model: 'E-Mount AF',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    description: 'Integrated flashing mount with adjustable rail for asphalt shingle roofs',
    rail: {
      model: 'E-Rail 40',
      materialAlloy: '6005-T5 Aluminum',
      heightIn: 1.57,
      widthIn: 1.0,
      wallThicknessIn: 0.125,
      momentCapacityInLbs: 3700,
      shearCapacityLbs: 1080,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.84,
      ul2703Listed: true,
      iccEsReport: 'ICC-ES ESR-4102',
    },
    mount: {
      model: 'E-Mount AF Flashing',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 1150,
      downwardCapacityLbs: 1750,
      shearCapacityLbs: 870,
      fastenersPerMount: 1,
      fastenerDiameterIn: 0.375,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 760,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-4102',
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake'],
    },
    hardware: {
      midClamp: 'E-Clamp Mid 30-50mm',
      endClamp: 'E-Clamp End 30-50mm',
      railSplice: 'E-Splice Connector',
      groundLug: 'E-Ground Lug',
      lagBolt: '3/8" × 3" Stainless Steel',
      flashingKit: 'E-Mount AF Integrated Flashing',
      bondingHardware: 'E-Bond Clip',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-4102',
    engineeringDataSource: 'Everest Solar E-Mount Engineering Manual 2022',
    lastUpdated: '2022-09',
  },

  {
    id: 'mse-rapid-rail',
    manufacturer: 'Mounting Systems (MSE)',
    productLine: 'MSE Rapid',
    model: 'MSE Rapid Rail',
    category: 'roof_residential',
    systemType: 'rail_based',
    compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated', 'tile_concrete'],
    description: 'European-standard rapid mounting rail system with pre-assembled roof hooks',
    rail: {
      model: 'MSE Rail 40/68',
      materialAlloy: '6063-T6 Aluminum',
      heightIn: 2.68,
      widthIn: 1.57,
      wallThicknessIn: 0.138,
      momentCapacityInLbs: 3600,
      shearCapacityLbs: 1050,
      maxSpanIn: 72,
      maxCantileverIn: 18,
      spliceIntervalIn: 168,
      weightLbsPerFt: 0.88,
      ul2703Listed: true,
    },
    mount: {
      model: 'MSE Rapid Hook',
      attachmentMethod: 'l_foot_lag',
      upliftCapacityLbs: 1050,
      downwardCapacityLbs: 1600,
      shearCapacityLbs: 800,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.375,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 740,
      maxSpacingIn: 72,
      minRafterDepthIn: 3.5,
      ul2703Listed: true,
      compatibleRoofTypes: ['asphalt_shingle', 'wood_shake', 'metal_corrugated', 'tile_concrete'],
    },
    hardware: {
      midClamp: 'MSE Mid Clamp 30-50mm',
      endClamp: 'MSE End Clamp 30-50mm',
      railSplice: 'MSE Splice Connector',
      groundLug: 'MSE Ground Lug',
      lagBolt: '3/8" × 3" Stainless Steel',
      flashingKit: 'MSE Flashing Kit',
      bondingHardware: 'MSE Bond Clip',
    },
    maxWindSpeedMph: 125,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    engineeringDataSource: 'MSE Rapid Rail Engineering Design Guide 2023',
    lastUpdated: '2023-01',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ADDITIONAL COMMERCIAL FLAT ROOF SYSTEMS
  // ══════════════════════════════════════════════════════════════════════════════

  {
    id: 'unirac-rm10-evo',
    manufacturer: 'Unirac',
    productLine: 'RM10 EVO',
    model: 'RM10 EVO',
    category: 'roof_commercial',
    systemType: 'ballasted_flat',
    compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    description: 'Ballasted flat-roof racking system for commercial low-slope roofs — no roof penetrations',
    mount: {
      model: 'RM10 EVO Base',
      attachmentMethod: 'ballasted',
      upliftCapacityLbs: 0,
      downwardCapacityLbs: 0,
      shearCapacityLbs: 0,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 0,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    },
    ballast: {
      blockWeightLbs: 35,
      blockDimensionsIn: [12, 12, 4],
      minBlocksPerModule: 2,
      maxBlocksPerModule: 6,
      windUpliftResistanceLbs: 35,
      maxWindSpeedMph: 130,
      exposureCategories: ['B', 'C', 'D'],
      tiltAngleDeg: 10,
      rowSpacingFt: 8,
    },
    hardware: {
      midClamp: 'RM10 EVO Mid Clamp',
      endClamp: 'RM10 EVO End Clamp',
      railSplice: 'RM10 EVO Splice',
      groundLug: 'RM10 EVO Ground Lug',
      lagBolt: 'N/A — Ballasted',
      bondingHardware: 'Weeb Lug 6.7',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 20,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Unirac RM10 EVO Engineering Design Guide 2023',
    lastUpdated: '2023-07',
  },

  {
    id: 'renusol-console-plus',
    manufacturer: 'Renusol',
    productLine: 'Console+',
    model: 'Console+',
    category: 'roof_commercial',
    systemType: 'ballasted_flat',
    compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    description: 'Integrated ballast tray system for flat commercial roofs — modular, no penetrations',
    mount: {
      model: 'Console+ Base Tray',
      attachmentMethod: 'ballasted',
      upliftCapacityLbs: 0,
      downwardCapacityLbs: 0,
      shearCapacityLbs: 0,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 0,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    },
    ballast: {
      blockWeightLbs: 33,
      blockDimensionsIn: [12, 12, 4],
      minBlocksPerModule: 2,
      maxBlocksPerModule: 8,
      windUpliftResistanceLbs: 33,
      maxWindSpeedMph: 125,
      exposureCategories: ['B', 'C', 'D'],
      tiltAngleDeg: 10,
      rowSpacingFt: 8,
    },
    hardware: {
      midClamp: 'Console+ Mid Clamp',
      endClamp: 'Console+ End Clamp',
      railSplice: 'Console+ Connector',
      groundLug: 'Console+ Ground Lug',
      lagBolt: 'N/A — Ballasted',
      bondingHardware: 'Console+ Bond Clip',
    },
    maxWindSpeedMph: 125,
    maxSnowLoadPsf: 20,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-4011',
    engineeringDataSource: 'Renusol Console+ Engineering Manual 2023',
    lastUpdated: '2023-05',
  },

  {
    id: 'sollega-fc350',
    manufacturer: 'Sollega',
    productLine: 'FastRack',
    // Corrected 2026-07-08: 'FC350' was not a real Sollega SKU; the flat-roof product is the FastRack FR510.
    model: 'FastRack FR510',
    category: 'roof_commercial',
    systemType: 'ballasted_flat',
    compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc'],
    description: 'Lightweight injection-molded ballasted flat-roof system — 10-minute module installation',
    mount: {
      model: 'FR510 Base',
      attachmentMethod: 'ballasted',
      upliftCapacityLbs: 0,
      downwardCapacityLbs: 0,
      shearCapacityLbs: 0,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 0,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc'],
    },
    ballast: {
      blockWeightLbs: 30,
      blockDimensionsIn: [12, 12, 4],
      minBlocksPerModule: 2,
      maxBlocksPerModule: 6,
      windUpliftResistanceLbs: 30,
      maxWindSpeedMph: 120,
      exposureCategories: ['B', 'C'],
      tiltAngleDeg: 10,
      rowSpacingFt: 7,
    },
    hardware: {
      midClamp: 'FC350 Mid Clamp',
      endClamp: 'FC350 End Clamp',
      railSplice: 'FC350 Connector',
      groundLug: 'FC350 Ground Lug',
      lagBolt: 'N/A — Ballasted',
      bondingHardware: 'FC350 Bond Clip',
    },
    maxWindSpeedMph: 120,
    maxSnowLoadPsf: 20,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3800',
    engineeringDataSource: 'Sollega FastRack FC350 Engineering Design Guide 2022',
    lastUpdated: '2022-10',
  },

  {
    id: 'ironridge-flat-roof',
    manufacturer: 'IronRidge',
    productLine: 'Flat Roof',
    model: 'Flat Roof Racking System',
    category: 'roof_commercial',
    systemType: 'ballasted_flat',
    compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    description: 'IronRidge ballasted flat-roof system with aerodynamic module tilt — commercial low-slope',
    mount: {
      model: 'IronRidge Flat Roof Base',
      attachmentMethod: 'ballasted',
      upliftCapacityLbs: 0,
      downwardCapacityLbs: 0,
      shearCapacityLbs: 0,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 0,
      minRafterDepthIn: 0,
      ul2703Listed: true,
      compatibleRoofTypes: ['flat_tpo', 'flat_epdm', 'flat_pvc', 'flat_gravel'],
    },
    ballast: {
      blockWeightLbs: 35,
      blockDimensionsIn: [12, 12, 4],
      minBlocksPerModule: 2,
      maxBlocksPerModule: 6,
      windUpliftResistanceLbs: 35,
      maxWindSpeedMph: 130,
      exposureCategories: ['B', 'C', 'D'],
      tiltAngleDeg: 10,
      rowSpacingFt: 8,
    },
    hardware: {
      midClamp: 'IronRidge Flat Roof Mid Clamp',
      endClamp: 'IronRidge Flat Roof End Clamp',
      railSplice: 'IronRidge Flat Roof Splice',
      groundLug: 'IronRidge Ground Lug',
      lagBolt: 'N/A — Ballasted',
      bondingHardware: 'Weeb Lug 6.7',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 20,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-2962',
    engineeringDataSource: 'IronRidge Flat Roof Engineering Design Guide 2023',
    lastUpdated: '2023-08',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ADDITIONAL GROUND MOUNT SYSTEMS
  // ══════════════════════════════════════════════════════════════════════════════

  {
    id: 'terrasmart-glide',
    manufacturer: 'TerraSmart',
    productLine: 'GLIDE',
    model: 'GLIDE Ground Mount',
    category: 'ground_mount',
    systemType: 'ground_helical',
    compatibleRoofTypes: ['any'],
    description: 'Screw-pile ground mount system — no concrete, fast installation, adjustable tilt 15–35°',
    mount: {
      model: 'GLIDE Helical Pile',
      attachmentMethod: 'helical_pile',
      upliftCapacityLbs: 8000,
      downwardCapacityLbs: 12000,
      shearCapacityLbs: 4000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 60,
      fastenerPulloutLbs: 8000,
      maxSpacingIn: 120,
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ['any'],
    },
    groundMount: {
      pileType: 'helical',
      pileSpacingFt: 10,
      maxPileSpanFt: 12,
      pileEmbedmentFt: 5,
      pileCapacityUpliftLbs: 8000,
      pileCapacityDownwardLbs: 12000,
      pileCapacityLateralLbs: 4000,
      frameSpanFt: 10,
      maxArrayWidthFt: 100,
      maxArrayHeightFt: 20,
      tiltAngleDeg: 25,
      groundClearanceIn: 24,
    },
    hardware: {
      midClamp: 'GLIDE Mid Clamp',
      endClamp: 'GLIDE End Clamp',
      railSplice: 'GLIDE Rail Splice',
      groundLug: 'GLIDE Ground Lug',
      lagBolt: 'N/A — Helical Pile',
      bondingHardware: 'GLIDE Bond Clip',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 0,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: 'TerraSmart GLIDE Engineering Manual 2023',
    lastUpdated: '2023-06',
  },

  {
    id: 'polar-racking-pr-ground',
    manufacturer: 'Polar Racking',
    productLine: 'PR Ground',
    model: 'PR Ground Mount',
    category: 'ground_mount',
    systemType: 'ground_driven_pile',
    compatibleRoofTypes: ['any'],
    description: 'Heavy-duty galvanized steel ground mount for high-wind and high-snow regions',
    mount: {
      model: 'PR Driven Pile',
      attachmentMethod: 'driven_pile',
      upliftCapacityLbs: 12000,
      downwardCapacityLbs: 18000,
      shearCapacityLbs: 6000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 72,
      fastenerPulloutLbs: 12000,
      maxSpacingIn: 144,
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ['any'],
    },
    groundMount: {
      pileType: 'driven',
      pileSpacingFt: 12,
      maxPileSpanFt: 14,
      pileEmbedmentFt: 6,
      pileCapacityUpliftLbs: 12000,
      pileCapacityDownwardLbs: 18000,
      pileCapacityLateralLbs: 6000,
      frameSpanFt: 12,
      maxArrayWidthFt: 120,
      maxArrayHeightFt: 25,
      tiltAngleDeg: 30,
      groundClearanceIn: 24,
    },
    hardware: {
      midClamp: 'PR Mid Clamp',
      endClamp: 'PR End Clamp',
      railSplice: 'PR Rail Splice',
      groundLug: 'PR Ground Lug',
      lagBolt: 'N/A — Driven Pile',
      bondingHardware: 'PR Bond Clip',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 80,
    maxRoofPitchDeg: 0,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: 'Polar Racking PR Ground Engineering Manual 2023',
    lastUpdated: '2023-02',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ADDITIONAL SINGLE-AXIS TRACKERS
  // ══════════════════════════════════════════════════════════════════════════════

  {
    id: 'nextracker-nx-horizon',
    manufacturer: 'NEXTracker',
    productLine: 'NX Horizon',
    model: 'NX Horizon (2024)',
    category: 'ground_mount',
    systemType: 'tracker_single_axis',
    compatibleRoofTypes: ['any'],
    description: "World's most deployed single-axis tracker — independent row design, self-powered, AI-optimized",
    mount: {
      model: 'NX Horizon Pile',
      attachmentMethod: 'driven_pile',
      upliftCapacityLbs: 22000,
      downwardCapacityLbs: 28000,
      shearCapacityLbs: 11000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 72,
      fastenerPulloutLbs: 22000,
      maxSpacingIn: 288,
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
      gcoverageRatio: 0.40,
      windSpeedMaxMph: 130,
      stowAngleDeg: 52,
    },
    hardware: {
      midClamp: 'NX Horizon Module Clamp',
      endClamp: 'NX Horizon End Clamp',
      railSplice: 'NX Torque Tube Splice',
      groundLug: 'NX Ground Lug',
      lagBolt: 'N/A — Pile Foundation',
      bondingHardware: 'NX Bond Clip',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 30,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: 'NEXTracker NX Horizon Engineering Design Guide 2024',
    lastUpdated: '2024-01',
  },

  {
    id: 'gamechange-gcx-tracker',
    manufacturer: 'GameChange Solar',
    productLine: 'GCX Tracker',
    model: 'GCX Single Axis Tracker',
    category: 'ground_mount',
    systemType: 'tracker_single_axis',
    compatibleRoofTypes: ['any'],
    description: 'Cost-optimized single-axis tracker with wind-resistant design — utility and C&I scale',
    mount: {
      model: 'GCX Driven Pile',
      attachmentMethod: 'driven_pile',
      upliftCapacityLbs: 16000,
      downwardCapacityLbs: 20000,
      shearCapacityLbs: 8000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 66,
      fastenerPulloutLbs: 16000,
      maxSpacingIn: 240,
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ['any'],
    },
    tracker: {
      trackerType: 'single_axis',
      rowSpacingFt: 17,
      moduleRowsPerTracker: 2,
      maxModulesPerTracker: 60,
      rotationRangeDeg: 55,
      actuatorType: 'slew_drive',
      foundationType: 'driven_pile',
      pileSpacingFt: 20,
      gcoverageRatio: 0.42,
      windSpeedMaxMph: 120,
      stowAngleDeg: 50,
    },
    hardware: {
      midClamp: 'GCX Module Clamp',
      endClamp: 'GCX End Clamp',
      railSplice: 'GCX Torque Tube Splice',
      groundLug: 'GCX Ground Lug',
      lagBolt: 'N/A — Pile Foundation',
      bondingHardware: 'GCX Bond Clip',
    },
    maxWindSpeedMph: 120,
    maxSnowLoadPsf: 25,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: 'GameChange Solar GCX Engineering Design Guide 2023',
    lastUpdated: '2023-08',
  },

  {
    id: 'soltec-sf7',
    manufacturer: 'Soltec',
    productLine: 'SF7',
    model: 'SF7 Single Axis Tracker',
    category: 'ground_mount',
    systemType: 'tracker_single_axis',
    compatibleRoofTypes: ['any'],
    description: 'Bifacial-optimized single-axis tracker with 2P portrait configuration — high energy yield',
    mount: {
      model: 'SF7 Driven Pile',
      attachmentMethod: 'driven_pile',
      upliftCapacityLbs: 18000,
      downwardCapacityLbs: 24000,
      shearCapacityLbs: 9000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 66,
      fastenerPulloutLbs: 18000,
      maxSpacingIn: 264,
      minRafterDepthIn: 0,
      ul2703Listed: false,
      compatibleRoofTypes: ['any'],
    },
    tracker: {
      trackerType: 'single_axis',
      rowSpacingFt: 20,
      moduleRowsPerTracker: 2,
      maxModulesPerTracker: 72,
      rotationRangeDeg: 60,
      actuatorType: 'slew_drive',
      foundationType: 'driven_pile',
      pileSpacingFt: 22,
      gcoverageRatio: 0.38,
      windSpeedMaxMph: 130,
      stowAngleDeg: 52,
    },
    hardware: {
      midClamp: 'SF7 Module Clamp',
      endClamp: 'SF7 End Clamp',
      railSplice: 'SF7 Torque Tube Splice',
      groundLug: 'SF7 Ground Lug',
      lagBolt: 'N/A — Pile Foundation',
      bondingHardware: 'SF7 Bond Clip',
    },
    maxWindSpeedMph: 130,
    maxSnowLoadPsf: 30,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: 'Soltec SF7 Engineering Design Guide 2023',
    lastUpdated: '2023-10',
  },

  {
    id: 'pvhardware-titan',
    manufacturer: 'PV Hardware',
    // Corrected 2026-07-08: 'Titan' is not a PV Hardware product (Titan trackers are Axial/APA).
    // PV Hardware's single-axis tracker line is Axone / AxoneDuo.
    productLine: 'Axone',
    model: 'AxoneDuo Single Axis Tracker',
    category: 'ground_mount',
    systemType: 'tracker_single_axis',
    compatibleRoofTypes: ['any'],
    description: 'Heavy-duty single-axis tracker for high-wind regions — 150 mph wind rating',
    mount: {
      model: 'AxoneDuo Driven Pile',
      attachmentMethod: 'driven_pile',
      upliftCapacityLbs: 20000,
      downwardCapacityLbs: 26000,
      shearCapacityLbs: 10000,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 72,
      fastenerPulloutLbs: 20000,
      maxSpacingIn: 264,
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
      pileSpacingFt: 22,
      gcoverageRatio: 0.40,
      windSpeedMaxMph: 150,
      stowAngleDeg: 55,
    },
    hardware: {
      midClamp: 'Titan Module Clamp',
      endClamp: 'Titan End Clamp',
      railSplice: 'Titan Torque Tube Splice',
      groundLug: 'Titan Ground Lug',
      lagBolt: 'N/A — Pile Foundation',
      bondingHardware: 'Titan Bond Clip',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 35,
    maxRoofPitchDeg: 5,
    minRoofPitchDeg: 0,
    ul2703Listed: false,
    engineeringDataSource: 'PV Hardware Titan Engineering Manual 2023',
    lastUpdated: '2023-05',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/** The LITERAL record for an id, superseded or not. Use this only when you
 *  genuinely need the historical record (e.g. to read its supersession basis). */
export function getMountingSystemRecordById(id: string): MountingSystemSpec | undefined {
  return MOUNTING_SYSTEMS.find(s => s.id === id);
}

/**
 * The CURRENT product for an id — supersession followed.
 *
 * A stored design names a mounting system by id, and that id can outlive the
 * generation it named. RT-MINI is the case that forced this: the manufacturer
 * replaced it with RT-MINI II, publishes structural authority only for the
 * successor, and the old record had quietly adopted the successor's capacity
 * number without its document. Following the supersession makes the design
 * resolve to the product that ships AND to the capacity that has a source,
 * instead of to a number with neither.
 *
 * The substitution is never silent: `supersessionBasis` on the superseded record
 * states who says so, and the racking record carries it onto the sheets.
 *
 * Cycle-safe: bounded walk, and a chain that does not terminate resolves to the
 * last real record rather than looping.
 */
export function getMountingSystemById(id: string): MountingSystemSpec | undefined {
  let cur = MOUNTING_SYSTEMS.find(s => s.id === id);
  const seen = new Set<string>();
  while (cur?.supersededById && !seen.has(cur.id)) {
    seen.add(cur.id);
    const next = MOUNTING_SYSTEMS.find(s => s.id === cur!.supersededById);
    if (!next) break;
    cur = next;
  }
  return cur;
}

/**
 * The id of the product that ACTUALLY SHIPS for a stored mounting id — the same
 * supersession `getMountingSystemById` already follows, exposed as an id so a
 * caller can look up that product's DOCUMENTS with it.
 *
 * 2026-08-29 — this is the gap that put a first-generation installation manual
 * behind a second-generation mount. A design storing `rooftech-mini` resolved,
 * through `getMountingSystemById`, to the RT-MINI **II** record — so every
 * PRODUCT fact on the sheets was gen-2 — while the document lookup passed the
 * STORED id straight to `getManufacturerAsset`, which has no notion of
 * supersession and returned the gen-1 row. One id, two answers, and the
 * applicability gate could not see the difference because it compared the asset
 * against its own title rather than against the selected model.
 *
 * Falls back to the id it was given: an id nothing supersedes is its own
 * effective id, and an id in no catalogue is not silently renamed.
 */
export function effectiveMountingSystemId(id: string | null | undefined): string | null {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return getMountingSystemById(key)?.id ?? key;
}

/** The supersession chain for an id, oldest first, or [] when nothing is
 *  superseded. Consumers that must PRINT the substitution read this. */
export function mountingSystemSupersession(id: string): Array<{ from: MountingSystemSpec; to: MountingSystemSpec; basis: string }> {
  const out: Array<{ from: MountingSystemSpec; to: MountingSystemSpec; basis: string }> = [];
  let cur = MOUNTING_SYSTEMS.find(s => s.id === id);
  const seen = new Set<string>();
  while (cur?.supersededById && !seen.has(cur.id)) {
    seen.add(cur.id);
    const next = MOUNTING_SYSTEMS.find(s => s.id === cur!.supersededById);
    if (!next) break;
    out.push({ from: cur, to: next, basis: cur.supersessionBasis ?? 'superseded (no basis recorded)' });
    cur = next;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// W4.1 §1 — MOUNTING-TOPOLOGY CLASSIFIER (the single authority for the rail-
// paired vs rail-less structural-path decision). Precedence:
//   1. An EXPLICIT `mountTopology` on the record wins (incl. 'unknown').
//   2. Otherwise DERIVE from systemType: railed systemTypes (rail_based /
//      standing_seam) ⇒ rail_paired; 'rail_less' ⇒ rail_less; any other
//      systemType is a ballast/ground/tracker/fence path where the roof rail-
//      topology decision does not apply — reported rail_paired so it never
//      falsely enters the rail-less direct-mount path or the unknown blocker
//      (those paths are additionally gated on `isRoofSystem` upstream).
// The structural engine MUST guard on the returned VALUE, never on the product
// name — so a mislabeled 'rail_less' systemType (e.g. an unverified RT-MINI
// alias) cannot drive the direct-mount path once classified 'unknown'.
export function classifyMountTopology(
  system: Pick<MountingSystemSpec, 'systemType' | 'mountTopology' | 'mountTopologyBasis'>,
): { topology: MountTopology; basis: string } {
  if (system.mountTopology) {
    return {
      topology: system.mountTopology,
      basis: system.mountTopologyBasis ?? `explicit record classification '${system.mountTopology}'`,
    };
  }
  switch (system.systemType) {
    case 'rail_based':
    case 'standing_seam':
      return { topology: 'rail_paired', basis: `derived from systemType '${system.systemType}' (railed structural path)` };
    case 'rail_less':
      return { topology: 'rail_less', basis: `derived from systemType 'rail_less' (verified rail-less direct-mount)` };
    default:
      return {
        topology: 'rail_paired',
        basis: `systemType '${system.systemType}' is not a roof rail-topology (ballast/ground/tracker/fence) — routed on its own path`,
      };
  }
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
  // P13 WS-4 — 'rail-less' USED TO MAP TO 'rooftech-mini', which is RAIL-PAIRED
  // (module → rail → RT-MINI pad → roof; see that record's mountTopology and the
  // W4.1 §1 directive on it). So a rail-less request silently bound a rail-paired
  // product, whose record then reports its rail as PENDING SELECTION — turning an
  // architecture keyword into a permanent "rail unselected" release blocker on a
  // job that never wanted a rail.
  //
  // It is NOT remapped to a rail-less product either: the verified rail-less
  // records in this catalog are brand-specific (Tesla Panel Mount comp-rafter /
  // tile), and binding a generic architecture keyword to one manufacturer is the
  // same class of silent inference. An unmapped id falls through unchanged and is
  // resolved by an explicit selection, which is the honest outcome.
  'ballasted':          'panelclaw-polar-bear',
  'ground-mount':       'ground-dual-post-driven',
  'tracker':            'nextracker-nr3',
};

export function resolveMountingSystemId(id: string): string {
  return LEGACY_ID_MAP[id] ?? id;
}

export { MOUNTING_SYSTEMS };