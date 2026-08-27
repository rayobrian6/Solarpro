// ============================================================
// Equipment Registry V4 — Full Brand-Agnostic Intelligence
// RoofTech RT-MINI, PLP POWER PEAK, IronRidge, SnapNrack,
// Unirac, QuickMount PV, EcoFasten, S-5!, + all inverters
//
// HOW TO ADD A NEW BRAND:
//   1. Add a new EquipmentRegistryEntry object to EQUIPMENT_REGISTRY_V4
//   2. Set manufacturer, model, category, topologyType
//   3. Fill electricalSpecs or structuralSpecs as appropriate
//   4. Add requiredAccessories (drives BOM + SLD automatically)
//   5. Add compatibilityRules if needed
//   6. NO code changes required anywhere else
// ============================================================

export type TopologyType =
  | 'STRING_INVERTER'
  | 'STRING_WITH_OPTIMIZER'
  | 'MICROINVERTER'
  | 'AC_MODULE'
  | 'HYBRID_INVERTER'
  | 'DC_COUPLED_BATTERY'
  | 'AC_COUPLED_BATTERY'
  | 'GROUND_MOUNT_FIXED_TILT'
  | 'GROUND_MOUNT_DRIVEN_PILE'
  | 'ROOF_RAIL_BASED'
  | 'ROOF_RAIL_LESS'
  | 'ROOF_STANDING_SEAM'
  | 'STRING'
  | 'STRING_OPTIMIZER'
  | 'MICRO'
  | 'HYBRID';

export type EquipmentCategory =
  | 'string_inverter'
  | 'microinverter'
  | 'optimizer'
  | 'solar_panel'
  | 'racking'
  | 'battery'
  | 'gateway'
  | 'combiner'
  | 'disconnect'
  | 'trunk_cable'
  | 'terminator'
  | 'rapid_shutdown'
  | 'ac_module'
  | 'flashing'
  | 'attachment'
  | 'conduit'
  | 'wire'
  | 'meter'
  | 'label';

export type AccessoryQuantityRule =
  | 'perModule'
  | 'perString'
  | 'perInverter'
  | 'perSystem'
  | 'perBranch'
  | 'perRailSection'
  | 'perAttachment'
  | 'perKw'
  | 'formula';

export interface AccessoryRule {
  category: string;
  description: string;
  required: boolean;
  conditional?: string;
  quantityRule: AccessoryQuantityRule;
  quantityFormula?: string;
  quantityMultiplier?: number;
  defaultModel?: string;
  defaultManufacturer?: string;
  defaultPartNumber?: string;
  necReference?: string;
  notes?: string;
}

export interface CompatibilityRule {
  type: 'requires' | 'excludes' | 'recommends';
  targetCategory: string;
  targetIds?: string[];
  reason: string;
}

export interface WireSizingConstraint {
  minGauge: string;
  maxGauge: string;
  wireType: string;
  conduitRequired: boolean;
  necReference: string;
}

export interface StructuralSpecs {
  maxWindSpeed?: number;          // mph
  maxSnowLoad?: number;           // psf
  railSpanMax?: number;           // inches
  attachmentSpacingMax?: number;  // inches
  requiresRail?: boolean;
  foundationType?: 'lag_bolt' | 'driven_pile' | 'ballast' | 'clamp' | 'adhesive';
  minEmbedmentDepth?: number;     // inches (lag bolt into rafter)
  upliftCapacityLbs?: number;     // lbs per attachment
  shearCapacityLbs?: number;      // lbs per attachment
  modulesPerAttachment?: number;  // for rail-less systems
  clampType?: string;             // for standing seam
  seamProfiles?: string[];        // compatible seam profiles
  ballastWeightLbs?: number;      // per mount (flat roof)
  iccEsReport?: string;           // ICC-ES evaluation report number
  asceEdition?: string;           // ASCE 7 edition tested to
   loadModel?: 'discrete' | 'distributed' | 'continuous'; // load distribution model
   fastenersPerAttachment?: number;  // fasteners per attachment point
   upliftCapacity?: number;           // lbf per fastener
   tributaryArea?: number;            // ft2 per attachment point
}

export interface ElectricalSpecs {
  acOutputKw?: number;
  dcInputKwMax?: number;
  maxDcVoltage?: number;
  acOutputVoltage?: number;
  acOutputCurrentMax?: number;
  maxInputCurrent?: number;
  maxInputCurrentPerMppt?: number;
  maxParallelStringsPerMppt?: number;
  mpptChannels?: number;
  mpptCount?: number;
  modulesPerDevice?: number;
  mpptVoltageMin?: number;
  mpptVoltageMax?: number;
  minMpptVoltage?: number;
  maxMpptVoltage?: number;
  efficiency?: number;
  rapidShutdownCompliant?: boolean;
  arcFaultProtection?: boolean;
  groundFaultProtection?: boolean;
  maxSeriesFuseRating?: number;
  voc?: number;
  vmp?: number;
  isc?: number;
  imp?: number;
  watts?: number;
  tempCoeffVoc?: number;
  tempCoeffIsc?: number;
}

export interface EquipmentRegistryEntry {
  id: string;
  manufacturer: string;
  model: string;
  partNumber?: string;
  category: EquipmentCategory;
  topologyType: TopologyType;
  mountTopology?: TopologyType;
  electricalSpecs: ElectricalSpecs;
  structuralSpecs?: StructuralSpecs;
  requiredAccessories: AccessoryRule[];
  compatibilityRules: CompatibilityRule[];
  wireSizingConstraints?: WireSizingConstraint;
  defaultOCPDRanges?: {
    dcStringOCPD?: { min: number; max: number };
    acOutputOCPD?: { min: number; max: number };
  };
  mountingCompatibility?: string[];
  notesTemplates?: string[];
  datasheetUrl?: string;
  ulListing?: string;
  iccEsReport?: string;
  warranty?: string;
  weight?: number;
  dimensions?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPMENT REGISTRY V4
// ─────────────────────────────────────────────────────────────────────────────

export const EQUIPMENT_REGISTRY_V4: EquipmentRegistryEntry[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // SOLAR PANELS
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'qcells-q-peak-duo-400',
    manufacturer: 'Q CELLS',
    model: 'Q.PEAK DUO BLK ML-G10+ 400W',
    partNumber: 'Q.PEAK DUO BLK ML-G10+400',
    category: 'solar_panel',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      // BRAIDON PDF AUDIT 2026-08-27 (N1) — second copy of this module, and its electrical
      // specs disagreed with BOTH the equipment-db record AND the datasheet (Voc 49.6 / Isc
      // 10.18 belong to no ML-G10+ power class). Transcribed from the archived sheet:
      // Q.PEAK DUO BLK ML-G10+ 395-415 Wp Rev06 (ZZ304800120_DS) p.2, POWER CLASS 400.
      watts: 400, voc: 45.24, vmp: 37.95, isc: 11.05, imp: 10.54,
      maxDcVoltage: 1000, maxSeriesFuseRating: 20,
      tempCoeffVoc: -0.27, tempCoeffIsc: 0.04, efficiency: 20.4,
    },
    requiredAccessories: [],
    compatibilityRules: [],
    notesTemplates: ['Q CELLS Q.PEAK DUO BLK ML-G10+ 400W — mono-PERC, 1000V max, 20A fuse'],
    ulListing: 'UL 61730',
    warranty: '25-year product, 25-year performance',
    weight: 48.5,                              // 22.0 kg
    dimensions: '74.0 × 41.1 × 1.26 in',       // 1879 × 1045 × 32 mm
  },

  {
    id: 'rec-alpha-pure-r-405',
    manufacturer: 'REC Group',
    model: 'REC405AA Pure-R',
    partNumber: 'REC405AA-PURE-R',
    category: 'solar_panel',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      watts: 405, voc: 50.0, vmp: 42.4, isc: 10.20, imp: 9.55,
      maxDcVoltage: 1000, maxSeriesFuseRating: 20,
      tempCoeffVoc: -0.24, tempCoeffIsc: 0.04, efficiency: 21.7,
    },
    requiredAccessories: [],
    compatibilityRules: [],
    notesTemplates: ['REC Alpha Pure-R 405W — N-type HJT, 1000V max, 21.7% efficiency'],
    ulListing: 'UL 61730',
    warranty: '25-year product, 25-year performance',
    weight: 43.0,
    dimensions: '69.9 × 41.8 × 1.57 in',
  },

  {
    id: 'silfab-sil-380-bk',
    manufacturer: 'Silfab Solar',
    model: 'SIL-380 BK',
    partNumber: 'SIL-380-BK',
    category: 'solar_panel',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      watts: 380, voc: 48.2, vmp: 40.1, isc: 9.98, imp: 9.48,
      maxDcVoltage: 1000, maxSeriesFuseRating: 20,
      tempCoeffVoc: -0.29, tempCoeffIsc: 0.05, efficiency: 19.9,
    },
    requiredAccessories: [],
    compatibilityRules: [],
    notesTemplates: ['Silfab SIL-380 BK — mono-PERC all-black, 1000V max'],
    ulListing: 'UL 61730',
    warranty: '25-year product, 30-year performance',
    weight: 41.9,
    dimensions: '68.9 × 41.3 × 1.38 in',
  },

  // ── Philadelphia Solar Nexus — Sol Fence default panel ─────────────────────
  // Source: systemEquipmentResolver.ts resolveDefaultFencePanelSpec()
  // defaultPanelId: 'panel-fence-ps1' in SOL_FENCE equipment spec
  {
    id: 'panel-fence-ps1',
    manufacturer: 'Philadelphia Solar',
    model: 'Nexus PS-MNB108(HCBF)-440W',
    partNumber: 'PS-MNB108-HCBF-440W',
    category: 'solar_panel',
    topologyType: 'MICROINVERTER',  // SOL_FENCE: "Microinverter Ready — Enphase IQ8"
    electricalSpecs: {
      watts: 440, voc: 51.2, vmp: 42.8, isc: 10.92, imp: 10.28,
      maxDcVoltage: 1000, maxSeriesFuseRating: 20,
      tempCoeffVoc: -0.30, tempCoeffIsc: 0.04, efficiency: 22.57,
    },
    requiredAccessories: [],
    compatibilityRules: [],
    notesTemplates: ['Philadelphia Solar Nexus 440W — N-Type Mono 16BB Half-Cell, bifacial (1.20 factor), vertical fence optimized'],
    ulListing: 'UL 61730, IEC 61215',
    warranty: '30-year product, 30-year performance',
    weight: 46.0,
    dimensions: '67.8 × 44.6 × 1.38 in',  // 1721mm × 1133mm from resolveDefaultFencePanelSpec()
  },

  // ══════════════════════════════════════════════════════════════════════════
  // STRING INVERTERS
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'fronius-primo-8.2',
    manufacturer: 'Fronius',
    model: 'Primo 8.2-1',
    partNumber: 'PRIMO-8.2-1-240',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 8.2, dcInputKwMax: 12.3, maxDcVoltage: 600,
      mpptVoltageMin: 200, mpptVoltageMax: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 34.2,
      efficiency: 97.6, mpptChannels: 2,
      rapidShutdownCompliant: false, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'dc_disconnect',
        description: 'DC disconnect switch per NEC 690.15',
        required: true, quantityRule: 'perInverter',
        defaultManufacturer: 'Square D', defaultModel: '30A DC Disconnect',
        defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
      },
      {
        category: 'rapid_shutdown',
        description: 'Rapid shutdown device per NEC 690.12',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F',
        defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'String inverter — optimizers optional only' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 40, max: 50 } },
    notesTemplates: ['Fronius Primo 8.2-1 — 2 MPPT, 600V max DC, 240V AC, Datamanager 2.0 included'],
    ulListing: 'UL 1741',
    warranty: '10-year standard, extendable to 20',
  },

  {
    id: 'sma-sunny-boy-7.7',
    manufacturer: 'SMA',
    model: 'Sunny Boy 7.7-US',
    partNumber: 'SB7.7-1SP-US-40',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.7, dcInputKwMax: 11.55, maxDcVoltage: 600,
      mpptVoltageMin: 100, mpptVoltageMax: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 32.1,
      efficiency: 97.0, mpptChannels: 2,
      rapidShutdownCompliant: false, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'dc_disconnect',
        description: 'DC disconnect switch per NEC 690.15',
        required: true, quantityRule: 'perInverter',
        defaultManufacturer: 'Square D', defaultModel: '30A DC Disconnect',
        defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
      },
      {
        category: 'rapid_shutdown',
        description: 'Rapid shutdown device per NEC 690.12',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F',
        defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
      },
    ],
    compatibilityRules: [],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 40, max: 50 } },
    notesTemplates: ['SMA Sunny Boy 7.7-US — 2 MPPT, 600V max DC, SMA ShadeFix integrated'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'sungrow-sg8k-d',
    manufacturer: 'Sungrow',
    model: 'SG8K-D',
    partNumber: 'SG8K-D-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 8.0, dcInputKwMax: 12.0, maxDcVoltage: 600,
      mpptVoltageMin: 90, mpptVoltageMax: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 33.3,
      efficiency: 97.5, mpptChannels: 2,
      rapidShutdownCompliant: false, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'dc_disconnect',
        description: 'DC disconnect switch per NEC 690.15',
        required: true, quantityRule: 'perInverter',
        defaultManufacturer: 'Square D', defaultModel: '30A DC Disconnect',
        defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
      },
      {
        category: 'rapid_shutdown',
        description: 'Rapid shutdown device per NEC 690.12',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F',
        defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
      },
    ],
    compatibilityRules: [],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 40, max: 50 } },
    notesTemplates: ['Sungrow SG8K-D — 2 MPPT, 600V max DC, built-in DC switch'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // STRING INVERTERS WITH OPTIMIZER
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'se-7600h',
    manufacturer: 'SolarEdge',
    model: 'SE7600H-US',
    partNumber: 'SE7600H-US000BNU4',
    category: 'string_inverter',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      acOutputKw: 7.6, dcInputKwMax: 11.4, maxDcVoltage: 480,
      mpptVoltageMin: 100, mpptVoltageMax: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 32.0,
      efficiency: 99.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'optimizer',
        description: 'DC power optimizer — 1 per module (SolarEdge topology)',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'SolarEdge', defaultModel: 'P401 Power Optimizer',
        defaultPartNumber: 'P401-5R2MRM', necReference: 'NEC 690.8',
        notes: 'SolarEdge inverters require optimizers on every module',
      },
      {
        category: 'gateway',
        description: 'Monitoring gateway for optimizer communication',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge', defaultModel: 'Energy Hub Gateway',
        defaultPartNumber: 'SEG-HUB-1', necReference: 'NEC 690.4',
      },
      {
        category: 'dc_disconnect',
        description: 'DC safety switch per NEC 690.15',
        required: true, quantityRule: 'perInverter',
        defaultManufacturer: 'SolarEdge', defaultModel: 'DC Safety Switch',
        defaultPartNumber: 'SE-DCSS-1', necReference: 'NEC 690.15',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'optimizer',
        targetIds: ['se-p401', 'se-p505', 'se-p730', 'se-p850'],
        reason: 'SolarEdge HD-Wave requires SolarEdge optimizers' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 40, max: 50 } },
    notesTemplates: ['SolarEdge SE7600H-US — HD-Wave, 1 MPPT, 480V max DC, optimizer required per module'],
    ulListing: 'UL 1741 SA',
    warranty: '12-year standard, extendable to 25',
  },

  {
    id: 'se-10000h',
    manufacturer: 'SolarEdge',
    model: 'SE10000H-US',
    partNumber: 'SE10000H-US000BNU4',
    category: 'string_inverter',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 15.0, maxDcVoltage: 480,
      mpptVoltageMin: 100, mpptVoltageMax: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 99.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'optimizer',
        description: 'DC power optimizer — 1 per module',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'SolarEdge', defaultModel: 'P401 Power Optimizer',
        defaultPartNumber: 'P401-5R2MRM', necReference: 'NEC 690.8',
      },
      {
        category: 'gateway',
        description: 'Monitoring gateway',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge', defaultModel: 'Energy Hub Gateway',
        defaultPartNumber: 'SEG-HUB-1', necReference: 'NEC 690.4',
      },
      {
        category: 'dc_disconnect',
        description: 'DC safety switch per NEC 690.15',
        required: true, quantityRule: 'perInverter',
        defaultManufacturer: 'SolarEdge', defaultModel: 'DC Safety Switch',
        defaultPartNumber: 'SE-DCSS-1', necReference: 'NEC 690.15',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'optimizer', reason: 'SolarEdge inverters require SolarEdge optimizers' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['SolarEdge SE10000H-US — HD-Wave, 1 MPPT, 480V max DC'],
    ulListing: 'UL 1741 SA',
    warranty: '12-year standard, extendable to 25',
  },

  // FIX: Added missing SolarEdge HD-Wave models
  {
    id: 'se-11400h',
    manufacturer: 'SolarEdge',
    model: 'SE11400H-US',
    partNumber: 'SE11400H-US000BNU4',
    category: 'string_inverter',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      acOutputKw: 11.4, dcInputKwMax: 17.1, maxDcVoltage: 480,
      mpptVoltageMin: 200, mpptVoltageMax: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 47.5,
      efficiency: 99.2, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'optimizer',
        description: 'DC power optimizer — 1 per module (SolarEdge topology)',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'SolarEdge', defaultModel: 'P505 Power Optimizer',
        defaultPartNumber: 'P505-5R3RHM', necReference: 'NEC 690.8',
        notes: 'SolarEdge inverters require optimizers on every module',
      },
      {
        category: 'gateway',
        description: 'Monitoring gateway for optimizer communication',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge', defaultModel: 'Energy Hub Gateway',
        defaultPartNumber: 'SEG-HUB-1', necReference: 'NEC 690.4',
      },
      {
        category: 'dc_disconnect',
        description: 'DC safety switch per NEC 690.15',
        required: true, quantityRule: 'perInverter',
        defaultManufacturer: 'SolarEdge', defaultModel: 'DC Safety Switch',
        defaultPartNumber: 'SE-DCSS-1', necReference: 'NEC 690.15',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'optimizer',
        targetIds: ['se-p401', 'se-p505', 'se-p730', 'se-p850'],
        reason: 'SolarEdge HD-Wave requires SolarEdge optimizers' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['SolarEdge SE11400H-US — HD-Wave, 1 MPPT, 480V max DC, 47.5A AC output'],
    ulListing: 'UL 1741 SA',
    warranty: '12-year standard, extendable to 25',
  },

  {
    id: 'se-6000h',
    manufacturer: 'SolarEdge',
    model: 'SE6000H-US',
    partNumber: 'SE6000H-US000BNU4',
    category: 'string_inverter',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      acOutputKw: 6.0, dcInputKwMax: 9.0, maxDcVoltage: 480,
      mpptVoltageMin: 100, mpptVoltageMax: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 25.0,
      efficiency: 99.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'optimizer',
        description: 'DC power optimizer — 1 per module',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'SolarEdge', defaultModel: 'P401 Power Optimizer',
        defaultPartNumber: 'P401-5R2MRM', necReference: 'NEC 690.8',
      },
      {
        category: 'gateway',
        description: 'Monitoring gateway',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge', defaultModel: 'Energy Hub Gateway',
        defaultPartNumber: 'SEG-HUB-1', necReference: 'NEC 690.4',
      },
      {
        category: 'dc_disconnect',
        description: 'DC safety switch per NEC 690.15',
        required: true, quantityRule: 'perInverter',
        defaultManufacturer: 'SolarEdge', defaultModel: 'DC Safety Switch',
        defaultPartNumber: 'SE-DCSS-1', necReference: 'NEC 690.15',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'optimizer', reason: 'SolarEdge inverters require SolarEdge optimizers' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 30, max: 40 } },
    notesTemplates: ['SolarEdge SE6000H-US — HD-Wave, 1 MPPT, 480V max DC'],
    ulListing: 'UL 1741 SA',
    warranty: '12-year standard, extendable to 25',
  },

  {
    id: 'se-3800h',
    manufacturer: 'SolarEdge',
    model: 'SE3800H-US',
    partNumber: 'SE3800H-US000BNU4',
    category: 'string_inverter',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      acOutputKw: 3.8, dcInputKwMax: 5.7, maxDcVoltage: 480,
      mpptVoltageMin: 100, mpptVoltageMax: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 16.0,
      efficiency: 99.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'optimizer',
        description: 'DC power optimizer — 1 per module',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'SolarEdge', defaultModel: 'P401 Power Optimizer',
        defaultPartNumber: 'P401-5R2MRM', necReference: 'NEC 690.8',
      },
      {
        category: 'gateway',
        description: 'Monitoring gateway',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge', defaultModel: 'Energy Hub Gateway',
        defaultPartNumber: 'SEG-HUB-1', necReference: 'NEC 690.4',
      },
      {
        category: 'dc_disconnect',
        description: 'DC safety switch per NEC 690.15',
        required: true, quantityRule: 'perInverter',
        defaultManufacturer: 'SolarEdge', defaultModel: 'DC Safety Switch',
        defaultPartNumber: 'SE-DCSS-1', necReference: 'NEC 690.15',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'optimizer', reason: 'SolarEdge inverters require SolarEdge optimizers' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 20, max: 25 } },
    notesTemplates: ['SolarEdge SE3800H-US — HD-Wave, 1 MPPT, 480V max DC'],
    ulListing: 'UL 1741 SA',
    warranty: '12-year standard, extendable to 25',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MICROINVERTERS
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'enphase-iq8plus',
    manufacturer: 'Enphase',
    model: 'IQ8+ Microinverter',
    partNumber: 'IQ8PLUS-72-2-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.295, dcInputKwMax: 0.440, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 1.21,
      efficiency: 97.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'trunk_cable',
        description: 'Q-Cable trunk cable — 1 section per 16 modules',
        required: true, quantityRule: 'formula',
        quantityFormula: 'ceil(modules / 16)',
        defaultManufacturer: 'Enphase', defaultModel: 'Q Cable 240V',
        defaultPartNumber: 'Q-12-10-240', necReference: 'NEC 690.31',
        notes: '1 trunk cable section per 16 modules',
      },
      {
        category: 'terminator',
        description: 'Q-Cable terminator — 2 per trunk section',
        required: true, quantityRule: 'formula',
        quantityFormula: 'ceil(modules / 16) * 2',
        defaultManufacturer: 'Enphase', defaultModel: 'Q Cable Terminator',
        defaultPartNumber: 'Q-TERM-10-240', necReference: 'NEC 690.31',
      },
      {
        category: 'gateway',
        description: 'IQ Gateway Standard — system monitoring hub',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase', defaultModel: 'IQ Gateway Standard',
        defaultPartNumber: 'ENV-IQ-AM1-240', necReference: 'NEC 690.4',
      },
      {
        category: 'combiner',
        description: 'IQ Combiner 4C — aggregates AC branch circuits',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase', defaultModel: 'IQ Combiner 4C',
        defaultPartNumber: 'ENV-IQ-C4C-240', necReference: 'NEC 690.4',
      },
      {
        category: 'ac_disconnect',
        description: 'AC disconnect sized for total AC output per NEC 690.14',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Square D', defaultModel: 'AC Disconnect Switch',
        defaultPartNumber: 'DU30RB', necReference: 'NEC 690.14',
        notes: 'Size = modules × 1.21A × 125%, rounded to next standard breaker',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology — no DC optimizers' },
      { type: 'excludes', targetCategory: 'dc_disconnect', reason: 'Microinverter topology — no DC string disconnect' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 30 } },
    notesTemplates: [
      'Enphase IQ8+ — AC branch topology, 1 microinverter per module',
      'Rapid shutdown integrated per NEC 690.12',
    ],
    ulListing: 'UL 1741 SA',
    warranty: '25-year standard',
  },

  {
    id: 'enphase-iq8m',
    manufacturer: 'Enphase',
    model: 'IQ8M Microinverter',
    partNumber: 'IQ8M-72-2-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.330, dcInputKwMax: 0.460, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 1.39,
      efficiency: 97.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'trunk_cable',
        description: 'Q-Cable trunk cable — 1 section per 16 modules',
        required: true, quantityRule: 'formula',
        quantityFormula: 'ceil(modules / 16)',
        defaultManufacturer: 'Enphase', defaultModel: 'Q Cable 240V',
        defaultPartNumber: 'Q-12-10-240', necReference: 'NEC 690.31',
      },
      {
        category: 'terminator',
        description: 'Q-Cable terminator — 2 per trunk section',
        required: true, quantityRule: 'formula',
        quantityFormula: 'ceil(modules / 16) * 2',
        defaultManufacturer: 'Enphase', defaultModel: 'Q Cable Terminator',
        defaultPartNumber: 'Q-TERM-10-240', necReference: 'NEC 690.31',
      },
      {
        category: 'gateway',
        description: 'IQ Gateway Standard',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase', defaultModel: 'IQ Gateway Standard',
        defaultPartNumber: 'ENV-IQ-AM1-240', necReference: 'NEC 690.4',
      },
      {
        category: 'combiner',
        description: 'IQ Combiner 4C',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase', defaultModel: 'IQ Combiner 4C',
        defaultPartNumber: 'ENV-IQ-C4C-240', necReference: 'NEC 690.4',
      },
      {
        category: 'ac_disconnect',
        description: 'AC disconnect sized for total AC output',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Square D', defaultModel: 'AC Disconnect Switch',
        defaultPartNumber: 'DU30RB', necReference: 'NEC 690.14',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 30 } },
    notesTemplates: ['Enphase IQ8M — high-power microinverter, AC branch topology'],
    ulListing: 'UL 1741 SA',
    warranty: '25-year standard',
  },


  // ══════════════════════════════════════════════════════════════════════════
  // ENPHASE IQ8 SERIES — additional models (iq8h, iq8a, iq8ac)
  // Added v58.8 to close registry gap found in brand audit
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'enphase-iq8h',
    manufacturer: 'Enphase',
    model: 'IQ8H Microinverter',
    partNumber: 'IQ8H-72-M-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.380, dcInputKwMax: 0.540, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 1.58,
      efficiency: 97.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'trunk_cable',
          description: 'Q-Cable trunk cable — 1 section per 16 modules',
          required: true, quantityRule: 'formula',
          quantityFormula: 'ceil(modules / 16)',
          defaultManufacturer: 'Enphase', defaultModel: 'Q Cable 240V',
          defaultPartNumber: 'Q-12-10-240', necReference: 'NEC 690.31',
        },
        {
          category: 'terminator',
          description: 'Q-Cable terminator — 2 per trunk section',
          required: true, quantityRule: 'formula',
          quantityFormula: 'ceil(modules / 16) * 2',
          defaultManufacturer: 'Enphase', defaultModel: 'Q Cable Terminator',
          defaultPartNumber: 'Q-TERM-10-240', necReference: 'NEC 690.31',
        },
        {
          category: 'gateway',
          description: 'IQ Gateway Standard',
          required: true, quantityRule: 'perSystem',
          defaultManufacturer: 'Enphase', defaultModel: 'IQ Gateway Standard',
          defaultPartNumber: 'ENV-IQ-AM1-240', necReference: 'NEC 690.4',
        },
      ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 30 } },
    notesTemplates: ['Enphase IQ8H — high-power microinverter for high-wattage modules'],
    ulListing: 'UL 1741 SA',
    warranty: '25-year standard',
  },

  {
    id: 'enphase-iq8a',
    manufacturer: 'Enphase',
    model: 'IQ8A Microinverter',
    // §12 (2026-07-22) — single canonical Enphase SKU. Was 'IQ8A-72-M-US', the
    // lone outlier: the verified manufacturer-assets-db datasheet entry
    // (microinverter_spec:enphase-iq8a, verified:true, pageRef "column
    // IQ8A-72-2-US"), lib/equipment/specSheets.ts and system/inverterCapabilities
    // all carry IQ8A-72-2-US. Reconciled to that exact SKU (basis: in-repo
    // verified datasheet evidence) so the package can never print two SKUs.
    partNumber: 'IQ8A-72-2-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      // BRAIDON PDF AUDIT 2026-08-27 (N8) — equipment-db's IQ8A was reconciled to the verified
      // datasheet on 2026-07-22; THIS copy never was, so the two stores disagreed:
      //   acOutputKw 0.366 = the PEAK VA, not the max continuous 349 VA the system total uses.
      //     The BOM row printed "Microinverter — 0.366kW AC output" while E-1 printed 349 W and
      //     SCHED printed 0.35 kW — three numbers for one rating on one set.
      //   acOutputCurrentMax 1.53 A contradicted the datasheet's 1.45 A, and it is not cosmetic:
      //     11 units × 1.53 A × 1.25 = 21.0 A, which EXCEEDS the 20 A branch OCPD the package
      //     passes B1 on. Whichever store a sizing path happened to read decided pass vs fail.
      //   efficiency 97.0 matched neither the 97.6 peak nor the 97.5 CEC figure.
      // All values below: IQ8 Series Microinverters Data Sheet (NA) p.2, column IQ8A-72-2-US
      // (the same archived document as manufacturer-assets 'microinverter_spec:enphase-iq8a').
      acOutputKw: 0.349,                 // max CONTINUOUS output 349 VA (peak is 366 VA)
      dcInputKwMax: 0.500,               // module pairing top of range, 295–500 W
      maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 1.45,   // A, max continuous @ 240 V
      efficiency: 97.6, mpptChannels: 1,                // peak efficiency (CEC-weighted 97.5)
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'trunk_cable',
          description: 'Q-Cable trunk cable — 1 section per 16 modules',
          required: true, quantityRule: 'formula',
          quantityFormula: 'ceil(modules / 16)',
          defaultManufacturer: 'Enphase', defaultModel: 'Q Cable 240V',
          defaultPartNumber: 'Q-12-10-240', necReference: 'NEC 690.31',
        },
        {
          category: 'terminator',
          description: 'Q-Cable terminator — 2 per trunk section',
          required: true, quantityRule: 'formula',
          quantityFormula: 'ceil(modules / 16) * 2',
          defaultManufacturer: 'Enphase', defaultModel: 'Q Cable Terminator',
          defaultPartNumber: 'Q-TERM-10-240', necReference: 'NEC 690.31',
        },
        {
          category: 'gateway',
          description: 'IQ Gateway Standard',
          required: true, quantityRule: 'perSystem',
          defaultManufacturer: 'Enphase', defaultModel: 'IQ Gateway Standard',
          defaultPartNumber: 'ENV-IQ-AM1-240', necReference: 'NEC 690.4',
        },
      ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 30 } },
    notesTemplates: ['Enphase IQ8A — standard microinverter for 60-cell modules'],
    ulListing: 'UL 1741 SA',
    warranty: '25-year standard',
  },

  {
    id: 'enphase-iq8ac',
    manufacturer: 'Enphase',
    model: 'IQ8AC Microinverter',
    partNumber: 'IQ8AC-72-M-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.384, dcInputKwMax: 0.530, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 1.60,
      efficiency: 97.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'trunk_cable',
          description: 'Q-Cable trunk cable — 1 section per 16 modules',
          required: true, quantityRule: 'formula',
          quantityFormula: 'ceil(modules / 16)',
          defaultManufacturer: 'Enphase', defaultModel: 'Q Cable 240V',
          defaultPartNumber: 'Q-12-10-240', necReference: 'NEC 690.31',
        },
        {
          category: 'terminator',
          description: 'Q-Cable terminator — 2 per trunk section',
          required: true, quantityRule: 'formula',
          quantityFormula: 'ceil(modules / 16) * 2',
          defaultManufacturer: 'Enphase', defaultModel: 'Q Cable Terminator',
          defaultPartNumber: 'Q-TERM-10-240', necReference: 'NEC 690.31',
        },
        {
          category: 'gateway',
          description: 'IQ Gateway Standard',
          required: true, quantityRule: 'perSystem',
          defaultManufacturer: 'Enphase', defaultModel: 'IQ Gateway Standard',
          defaultPartNumber: 'ENV-IQ-AM1-240', necReference: 'NEC 690.4',
        },
      ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 30 } },
    notesTemplates: ['Enphase IQ8AC — high-efficiency microinverter, 384W AC output'],
    ulListing: 'UL 1741 SA',
    warranty: '25-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SMA SUNNY BOY — full model lineup (sb-5.0, sb-6.0, sb-7.7, sb-10.0)
  // Added v58.8 — existing registry only had sma-sunny-boy-7.7 (different id)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'sma-sb-5.0',
    manufacturer: 'SMA',
    model: 'Sunny Boy SB5.0-US',
    partNumber: 'SB5.0-1SP-US-40',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 7.5, maxDcVoltage: 600,
      mpptVoltageMin: 100, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 97.0, mpptChannels: 2,
      maxInputCurrentPerMppt: 15.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 25, max: 30 } },
    notesTemplates: ['SMA Sunny Boy SB5.0-US — 2 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'sma-sb-6.0',
    manufacturer: 'SMA',
    model: 'Sunny Boy SB6.0-US',
    partNumber: 'SB6.0-1SP-US-40',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 6.0, dcInputKwMax: 9.0, maxDcVoltage: 600,
      mpptVoltageMin: 100, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 25.0,
      efficiency: 97.0, mpptChannels: 2,
      maxInputCurrentPerMppt: 15.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 30, max: 35 } },
    notesTemplates: ['SMA Sunny Boy SB6.0-US — 2 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'sma-sb-7.7',
    manufacturer: 'SMA',
    model: 'Sunny Boy SB7.7-US',
    partNumber: 'SB7.7-1SP-US-40',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.7, dcInputKwMax: 11.55, maxDcVoltage: 600,
      mpptVoltageMin: 100, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 32.0,
      efficiency: 97.5, mpptChannels: 3,
      maxInputCurrentPerMppt: 15.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 40, max: 45 } },
    notesTemplates: ['SMA Sunny Boy SB7.7-US — 3 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'sma-sb-10.0',
    manufacturer: 'SMA',
    model: 'Sunny Boy SB10000TL-US',
    partNumber: 'SB10000TL-US-10',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 15.0, maxDcVoltage: 600,
      mpptVoltageMin: 150, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 98.0, mpptChannels: 2,
      maxInputCurrentPerMppt: 15.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['SMA Sunny Boy SB10000TL-US — legacy 2 MPPT, 600V max DC (discontinued)'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FRONIUS PRIMO — full lineup (5.0, 7.6, 10.0 — 8.2 already exists)
  // Added v58.8
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'fronius-primo-5.0',
    manufacturer: 'Fronius',
    model: 'Primo 5.0-1',
    partNumber: 'P5.0-1-240-2',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 7.5, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 97.7, mpptChannels: 2,
      maxInputCurrentPerMppt: 18.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 25, max: 30 } },
    notesTemplates: ['Fronius Primo 5.0-1 — 2 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'fronius-primo-7.6',
    manufacturer: 'Fronius',
    model: 'Primo 7.6-1',
    partNumber: 'P7.6-1-240-2',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.6, dcInputKwMax: 11.4, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 31.7,
      efficiency: 97.7, mpptChannels: 2,
      maxInputCurrentPerMppt: 18.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 40, max: 45 } },
    notesTemplates: ['Fronius Primo 7.6-1 — 2 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'fronius-primo-10.0',
    manufacturer: 'Fronius',
    model: 'Primo 10.0-1',
    partNumber: 'P10.0-1-240-2',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 15.0, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 97.7, mpptChannels: 2,
      maxInputCurrentPerMppt: 18.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['Fronius Primo 10.0-1 — 2 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GOODWE NS/MS SERIES — full lineup
  // Added v58.8
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'goodwe-gw5000-ns',
    manufacturer: 'GoodWe',
    model: 'GW5000-NS',
    partNumber: 'GW5000D-NS',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 7.5, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 97.5, mpptChannels: 2,
      maxInputCurrentPerMppt: 11.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 25, max: 30 } },
    notesTemplates: ['GoodWe GW5000-NS — 2 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'goodwe-gw7700-ms',
    manufacturer: 'GoodWe',
    model: 'GW7700-MS-US',
    partNumber: 'GW7700D-MS-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.7, dcInputKwMax: 11.55, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 32.1,
      efficiency: 98.0, mpptChannels: 3,
      maxInputCurrentPerMppt: 16.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 40, max: 45 } },
    notesTemplates: ['GoodWe GW7700-MS-US — 3 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'goodwe-gw10k-ms',
    manufacturer: 'GoodWe',
    model: 'GW9600-MS-US',
    partNumber: 'GW9600D-MS-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 9.6, dcInputKwMax: 14.4, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 40.0,
      efficiency: 98.0, mpptChannels: 3,
      maxInputCurrentPerMppt: 16.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 50, max: 55 } },
    notesTemplates: ['GoodWe GW9600-MS-US — 3 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'goodwe-gw11400-ms',
    manufacturer: 'GoodWe',
    model: 'GW11400-MS-US',
    partNumber: 'GW11400D-MS-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 11.4, dcInputKwMax: 17.1, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 47.5,
      efficiency: 98.0, mpptChannels: 3,
      maxInputCurrentPerMppt: 16.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 60, max: 60 } },
    notesTemplates: ['GoodWe GW11400-MS-US — 3 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SUNGROW RS SERIES — full lineup
  // Added v58.8
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'sungrow-sg5rs',
    manufacturer: 'Sungrow',
    model: 'SG5RS',
    partNumber: 'SG5RS-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 7.5, maxDcVoltage: 600,
      mpptVoltageMin: 40, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 97.5, mpptChannels: 2,
      maxInputCurrentPerMppt: 14.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 25, max: 30 } },
    notesTemplates: ['Sungrow SG5RS — 2 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'sungrow-sg7.6rs',
    manufacturer: 'Sungrow',
    model: 'SG7.6RS',
    partNumber: 'SG7.6RS-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.6, dcInputKwMax: 11.4, maxDcVoltage: 600,
      mpptVoltageMin: 40, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 31.7,
      efficiency: 97.5, mpptChannels: 2,
      maxInputCurrentPerMppt: 14.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 40, max: 45 } },
    notesTemplates: ['Sungrow SG7.6RS — 2 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'sungrow-sg10rs',
    manufacturer: 'Sungrow',
    model: 'SG10RS',
    partNumber: 'SG10RS-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 15.0, maxDcVoltage: 600,
      mpptVoltageMin: 40, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 97.5, mpptChannels: 2,
      maxInputCurrentPerMppt: 14.0,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['Sungrow SG10RS — 2 MPPT, 600V max DC, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  {
    id: 'sungrow-sg15rs',
    manufacturer: 'Sungrow',
    model: 'SG15RS',
    partNumber: 'SG15RS-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 15.0, dcInputKwMax: 22.5, maxDcVoltage: 600,
      mpptVoltageMin: 40, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 62.5,
      efficiency: 97.5, mpptChannels: 2,
      maxInputCurrentPerMppt: 14.0, maxParallelStringsPerMppt: 2,
      rapidShutdownCompliant: false, arcFaultProtection: false,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 70, max: 80 } },
    notesTemplates: ['Sungrow SG15RS — 2 MPPT, 600V max DC, 2 strings/MPPT, transformerless'],
    ulListing: 'UL 1741',
    warranty: '10-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GROWATT MIN TL-XH-US HYBRID SERIES — full lineup
  // Added v58.8
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'growatt-min-5000tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 5000TL-XH-US',
    partNumber: 'MIN-5000TL-XH-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 10.0, maxDcVoltage: 600,
      mpptVoltageMin: 70, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 97.5, mpptChannels: 2, maxParallelStringsPerMppt: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 25, max: 30 } },
    notesTemplates: ['Growatt MIN 5000TL-XH-US — 2 MPPT, hybrid, 240V split-phase'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'growatt-min-6000tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 6000TL-XH-US',
    partNumber: 'MIN-6000TL-XH-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 6.0, dcInputKwMax: 12.0, maxDcVoltage: 600,
      mpptVoltageMin: 70, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 25.0,
      efficiency: 97.5, mpptChannels: 3, maxParallelStringsPerMppt: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 30, max: 35 } },
    notesTemplates: ['Growatt MIN 6000TL-XH-US — 3 MPPT, hybrid, 240V split-phase'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'growatt-min-7600tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 7600TL-XH-US',
    partNumber: 'MIN-7600TL-XH-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.6, dcInputKwMax: 15.2, maxDcVoltage: 600,
      mpptVoltageMin: 70, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 31.7,
      efficiency: 97.5, mpptChannels: 3, maxParallelStringsPerMppt: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 40, max: 45 } },
    notesTemplates: ['Growatt MIN 7600TL-XH-US — 3 MPPT, hybrid, 240V split-phase'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'growatt-min-10000tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 10000TL-XH-US',
    partNumber: 'MIN-10000TL-XH-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 20.0, maxDcVoltage: 600,
      mpptVoltageMin: 70, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 97.5, mpptChannels: 3, maxParallelStringsPerMppt: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['Growatt MIN 10000TL-XH-US — 3 MPPT, hybrid, 240V split-phase'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'growatt-min-11400tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 11400TL-XH-US',
    partNumber: 'MIN-11400TL-XH-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 11.4, dcInputKwMax: 22.8, maxDcVoltage: 600,
      mpptVoltageMin: 70, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 47.5,
      efficiency: 97.5, mpptChannels: 3, maxParallelStringsPerMppt: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 60, max: 60 } },
    notesTemplates: ['Growatt MIN 11400TL-XH-US — 3 MPPT, hybrid, 240V split-phase'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SOLIS S6-EH1P US HYBRID SERIES — full lineup
  // Added v58.8
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'solis-s6-eh1p-3p8k-us',
    manufacturer: 'Solis',
    model: 'S6-EH1P3.8K-US',
    partNumber: 'S6-EH1P3800-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 3.8, dcInputKwMax: 5.7, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 520,
      acOutputVoltage: 240, acOutputCurrentMax: 15.8,
      efficiency: 97.7, mpptChannels: 2,
      maxInputCurrentPerMppt: 16.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 25 } },
    notesTemplates: ['Solis S6-EH1P3.8K-US — 2 MPPT, 600V DC, hybrid, UL1741SB'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'solis-s6-eh1p-5k-us',
    manufacturer: 'Solis',
    model: 'S6-EH1P5K-US',
    partNumber: 'S6-EH1P5000-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 7.5, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 520,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 97.7, mpptChannels: 2,
      maxInputCurrentPerMppt: 16.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 25, max: 30 } },
    notesTemplates: ['Solis S6-EH1P5K-US — 2 MPPT, 600V DC, hybrid, UL1741SB'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'solis-s6-eh1p-7p6k-us',
    manufacturer: 'Solis',
    model: 'S6-EH1P7.6K-US',
    partNumber: 'S6-EH1P7600-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.6, dcInputKwMax: 11.4, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 520,
      acOutputVoltage: 240, acOutputCurrentMax: 31.7,
      efficiency: 97.7, mpptChannels: 3,
      maxInputCurrentPerMppt: 16.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 40, max: 45 } },
    notesTemplates: ['Solis S6-EH1P7.6K-US — 3 MPPT, 600V DC, hybrid, UL1741SB'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'solis-s6-eh1p-9p9k-us',
    manufacturer: 'Solis',
    model: 'S6-EH1P9.9K-US',
    partNumber: 'S6-EH1P9900-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 9.9, dcInputKwMax: 14.85, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 520,
      acOutputVoltage: 240, acOutputCurrentMax: 41.25,
      efficiency: 97.7, mpptChannels: 4,
      maxInputCurrentPerMppt: 16.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 50, max: 55 } },
    notesTemplates: ['Solis S6-EH1P9.9K-US — 4 MPPT, 600V DC, hybrid, UL1741SB'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'solis-s6-eh1p-10k-us',
    manufacturer: 'Solis',
    model: 'S6-EH1P10K-US',
    partNumber: 'S6-EH1P10000-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 15.0, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 520,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 97.7, mpptChannels: 4,
      maxInputCurrentPerMppt: 16.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['Solis S6-EH1P10K-US — 4 MPPT, 600V DC, hybrid, UL1741SB'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'solis-s6-eh1p-11p4k-us',
    manufacturer: 'Solis',
    model: 'S6-EH1P11.4K-US',
    partNumber: 'S6-EH1P11400-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 11.4, dcInputKwMax: 17.1, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 520,
      acOutputVoltage: 240, acOutputCurrentMax: 47.5,
      efficiency: 97.7, mpptChannels: 4,
      maxInputCurrentPerMppt: 16.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 60, max: 60 } },
    notesTemplates: ['Solis S6-EH1P11.4K-US — 4 MPPT, 600V DC, hybrid, UL1741SB'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TESLA SOLAR INVERTER — full lineup
  // Added v58.8
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'tesla-solar-inverter-3p8k',
    manufacturer: 'Tesla',
    model: 'Solar Inverter 3.8kW',
    partNumber: 'TSI-3800-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 3.8, dcInputKwMax: 5.7, maxDcVoltage: 600,
      mpptVoltageMin: 60, mpptVoltageMax: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 15.8,
      efficiency: 98.0, mpptChannels: 2,
      maxInputCurrentPerMppt: 13.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 25 } },
    notesTemplates: ['Tesla Solar Inverter 3.8kW — 2 MPPT, UL1741SB, AFCI integrated'],
    ulListing: 'UL 1741 SB',
    warranty: '12.5-year standard',
  },

  {
    id: 'tesla-solar-inverter-5k',
    manufacturer: 'Tesla',
    model: 'Solar Inverter 5kW',
    partNumber: 'TSI-5000-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 7.5, maxDcVoltage: 600,
      mpptVoltageMin: 60, mpptVoltageMax: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 98.0, mpptChannels: 2,
      maxInputCurrentPerMppt: 13.0, maxParallelStringsPerMppt: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 25, max: 30 } },
    notesTemplates: ['Tesla Solar Inverter 5kW — 2 MPPT, UL1741SB, AFCI integrated'],
    ulListing: 'UL 1741 SB',
    warranty: '12.5-year standard',
  },

  {
    id: 'tesla-solar-inverter-5p7k',
    manufacturer: 'Tesla',
    model: 'Solar Inverter 5.7kW',
    partNumber: 'TSI-5700-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.7, dcInputKwMax: 8.55, maxDcVoltage: 600,
      mpptVoltageMin: 60, mpptVoltageMax: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 23.75,
      efficiency: 98.0, mpptChannels: 2,
      maxInputCurrentPerMppt: 13.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 30, max: 35 } },
    notesTemplates: ['Tesla Solar Inverter 5.7kW — 2 MPPT, UL1741SB, AFCI integrated'],
    ulListing: 'UL 1741 SB',
    warranty: '12.5-year standard',
  },

  {
    id: 'tesla-solar-inverter-7p6k',
    manufacturer: 'Tesla',
    model: 'Solar Inverter 7.6kW',
    partNumber: 'TSI-7600-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.6, dcInputKwMax: 11.4, maxDcVoltage: 600,
      mpptVoltageMin: 60, mpptVoltageMax: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 31.7,
      efficiency: 98.0, mpptChannels: 2,
      maxInputCurrentPerMppt: 13.0, maxParallelStringsPerMppt: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 40, max: 45 } },
    notesTemplates: ['Tesla Solar Inverter 7.6kW — 2 MPPT, UL1741SB, AFCI integrated'],
    ulListing: 'UL 1741 SB',
    warranty: '12.5-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TIGO TSi INVERTER — full lineup (hybrid with Tigo optimizer support)
  // Added v58.8
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'tigo-tsi-3p8k-us',
    manufacturer: 'Tigo',
    model: 'TSi-3.8K-US',
    partNumber: 'TSI-3800-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 3.8, dcInputKwMax: 5.7, maxDcVoltage: 600,
      mpptVoltageMin: 60, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 15.8,
      efficiency: 97.5, mpptChannels: 2,
      maxInputCurrentPerMppt: 15.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 25 } },
    notesTemplates: ['Tigo TSi-3.8K-US — 2 MPPT, hybrid, UL1741SB'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'tigo-tsi-7p6k-us',
    manufacturer: 'Tigo',
    model: 'TSi-7.6K-US',
    partNumber: 'TSI-7600-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.6, dcInputKwMax: 11.4, maxDcVoltage: 600,
      mpptVoltageMin: 60, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 31.7,
      efficiency: 97.5, mpptChannels: 2,
      maxInputCurrentPerMppt: 15.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 40, max: 45 } },
    notesTemplates: ['Tigo TSi-7.6K-US — 2 MPPT, hybrid, UL1741SB'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'tigo-tsi-11p4k-us',
    manufacturer: 'Tigo',
    model: 'TSi-11.4K-US',
    partNumber: 'TSI-11400-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 11.4, dcInputKwMax: 17.1, maxDcVoltage: 600,
      mpptVoltageMin: 60, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 47.5,
      efficiency: 97.5, mpptChannels: 4,
      maxInputCurrentPerMppt: 15.0,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
        {
          category: 'dc_disconnect',
          description: 'DC safety switch per NEC 690.15',
          required: true, quantityRule: 'perInverter',
          defaultManufacturer: 'Square D', defaultModel: 'DC Disconnect Switch',
          defaultPartNumber: 'DU30RB', necReference: 'NEC 690.15',
        },
        {
          category: 'rapid_shutdown',
          description: 'Per-module RSD device for NEC 690.12',
          required: true, quantityRule: 'perModule',
          defaultManufacturer: 'Tigo', defaultModel: 'TS4-A-F Rapid Shutdown',
          defaultPartNumber: '481-00252-32', necReference: 'NEC 690.12',
        },
      ],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 60, max: 60 } },
    notesTemplates: ['Tigo TSi-11.4K-US — 4 MPPT, hybrid, UL1741SB'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // APSYSTEMS DS3 SERIES — microinverters
  // Added v58.8
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'apsystems-ds3s',
    manufacturer: 'APsystems',
    model: 'DS3S Microinverter',
    partNumber: 'DS3S-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.640, dcInputKwMax: 0.960, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 2.67,
      efficiency: 96.5, mpptChannels: 2, modulesPerDevice: 2,
      rapidShutdownCompliant: true, arcFaultProtection: false,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'APsystems ECU-R gateway for monitoring',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'APsystems', defaultModel: 'ECU-R',
        defaultPartNumber: 'ECU-R-US', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 20 } },
    notesTemplates: ['APsystems DS3S — dual-module microinverter, 640W AC, 960W DC'],
    ulListing: 'UL 1741',
    warranty: '25-year standard',
  },

  {
    id: 'apsystems-ds3l',
    manufacturer: 'APsystems',
    model: 'DS3L Microinverter',
    partNumber: 'DS3L-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.730, dcInputKwMax: 1.100, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 3.04,
      efficiency: 96.5, mpptChannels: 2, modulesPerDevice: 2,
      rapidShutdownCompliant: true, arcFaultProtection: false,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'APsystems ECU-R gateway for monitoring',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'APsystems', defaultModel: 'ECU-R',
        defaultPartNumber: 'ECU-R-US', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 20 } },
    notesTemplates: ['APsystems DS3L — dual-module microinverter, 730W AC, 1100W DC'],
    ulListing: 'UL 1741',
    warranty: '25-year standard',
  },

  {
    id: 'apsystems-ds3',
    manufacturer: 'APsystems',
    model: 'DS3 Microinverter',
    partNumber: 'DS3-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.880, dcInputKwMax: 1.320, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 3.67,
      efficiency: 96.5, mpptChannels: 2, modulesPerDevice: 2,
      rapidShutdownCompliant: true, arcFaultProtection: false,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'APsystems ECU-R gateway for monitoring',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'APsystems', defaultModel: 'ECU-R',
        defaultPartNumber: 'ECU-R-US', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 20 } },
    notesTemplates: ['APsystems DS3 — dual-module microinverter, 880W AC, 1320W DC'],
    ulListing: 'UL 1741',
    warranty: '25-year standard',
  },

  {
    id: 'apsystems-ez1-m',
    manufacturer: 'APsystems',
    model: 'EZ1-M Microinverter',
    partNumber: 'EZ1-M-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.800, dcInputKwMax: 1.200, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 3.33,
      efficiency: 96.7, mpptChannels: 2, modulesPerDevice: 2,
      rapidShutdownCompliant: true, arcFaultProtection: false,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'APsystems ECU-R gateway for monitoring',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'APsystems', defaultModel: 'ECU-R',
        defaultPartNumber: 'ECU-R-US', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 20 } },
    notesTemplates: ['APsystems EZ1-M — dual-module microinverter, 800W AC'],
    ulListing: 'UL 1741',
    warranty: '25-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HOYMILES HMS SERIES — microinverters
  // Added v58.8
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'hoymiles-hm800',
    manufacturer: 'Hoymiles',
    model: 'HM-800 Microinverter',
    partNumber: 'HM-800-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.800, dcInputKwMax: 1.000, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 3.33,
      efficiency: 96.5, mpptChannels: 2, modulesPerDevice: 2,
      rapidShutdownCompliant: true, arcFaultProtection: false,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'Hoymiles DTU-Pro monitoring gateway',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Hoymiles', defaultModel: 'DTU-Pro',
        defaultPartNumber: 'DTU-PRO-US', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 20 } },
    notesTemplates: ['Hoymiles HM-800 — dual-module microinverter, 800W AC'],
    ulListing: 'UL 1741',
    warranty: '25-year standard',
  },

  {
    id: 'hoymiles-hms-800w-2t',
    manufacturer: 'Hoymiles',
    model: 'HMS-800W-2T Microinverter',
    partNumber: 'HMS-800W-2T-US',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.800, dcInputKwMax: 1.000, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 3.33,
      efficiency: 96.7, mpptChannels: 2, modulesPerDevice: 2,
      rapidShutdownCompliant: true, arcFaultProtection: false,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'Hoymiles DTU-Pro monitoring gateway',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Hoymiles', defaultModel: 'DTU-Pro',
        defaultPartNumber: 'DTU-PRO-US', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 20 } },
    notesTemplates: ['Hoymiles HMS-800W-2T — dual-module microinverter, 800W AC, 2T connector'],
    ulListing: 'UL 1741',
    warranty: '25-year standard',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // SOL-ARK HYBRID INVERTERS
  // ══════════════════════════════════════════════════════════════════════════════

  {
    id: 'solark-8k-2p',
    manufacturer: 'Sol-Ark',
    model: 'Sol-Ark 8K-2P',
    partNumber: 'SA-8K-2P',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 8.0, dcInputKwMax: 10.5, mpptCount: 2,
      maxParallelStringsPerMppt: 2, maxInputCurrentPerMppt: 13.0,
      maxDcVoltage: 600, minMpptVoltage: 100, maxMpptVoltage: 550,
      acOutputCurrentMax: 33.3, acOutputVoltage: 240, efficiency: 97.5,
    },
    requiredAccessories: [],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 50, max: 50 } },
    notesTemplates: ['Sol-Ark 8K-2P — 8 kW AC hybrid split-phase, 2 MPPT, battery-ready'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'solark-12k-2p',
    manufacturer: 'Sol-Ark',
    model: 'Sol-Ark 12K-2P',
    partNumber: 'SA-12K-2P',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 12.0, dcInputKwMax: 19.5, mpptCount: 2,
      maxParallelStringsPerMppt: 2, maxInputCurrentPerMppt: 16.0,
      maxDcVoltage: 600, minMpptVoltage: 100, maxMpptVoltage: 550,
      acOutputCurrentMax: 50.0, acOutputVoltage: 240, efficiency: 97.5,
    },
    requiredAccessories: [],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 70, max: 70 } },
    notesTemplates: ['Sol-Ark 12K-2P — 12 kW AC hybrid split-phase, 2 MPPT, battery-ready'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'solark-15k-2p',
    manufacturer: 'Sol-Ark',
    model: 'Sol-Ark 15K-2P',
    partNumber: 'SA-15K-2P',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 15.0, dcInputKwMax: 19.5, mpptCount: 3,
      maxParallelStringsPerMppt: 2, maxInputCurrentPerMppt: 16.0,
      maxDcVoltage: 600, minMpptVoltage: 100, maxMpptVoltage: 550,
      acOutputCurrentMax: 62.5, acOutputVoltage: 240, efficiency: 97.5,
    },
    requiredAccessories: [],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 80, max: 80 } },
    notesTemplates: ['Sol-Ark 15K-2P — 15 kW AC hybrid split-phase, 3 MPPT, battery-ready'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },

  {
    id: 'solark-30k-3p-208v',
    manufacturer: 'Sol-Ark',
    model: 'Sol-Ark 30K-3P-208V',
    partNumber: 'SA-30K-3P-208V',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 30.0, dcInputKwMax: 45.0, mpptCount: 4,
      maxParallelStringsPerMppt: 2, maxInputCurrentPerMppt: 18.0,
      maxDcVoltage: 1000, minMpptVoltage: 200, maxMpptVoltage: 900,
      acOutputCurrentMax: 83.3, acOutputVoltage: 208, efficiency: 97.5,
    },
    requiredAccessories: [],
    compatibilityRules: [],
    defaultOCPDRanges: { acOutputOCPD: { min: 110, max: 110 } },
    notesTemplates: ['Sol-Ark 30K-3P-208V — 30 kW AC commercial 3-phase hybrid, 4 MPPT, battery-ready'],
    ulListing: 'UL 1741 SB',
    warranty: '10-year standard',
  },


  // ══════════════════════════════════════════════════════════════════════════
  // OPTIMIZERS
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'se-p401',
    manufacturer: 'SolarEdge',
    model: 'P401 Power Optimizer',
    partNumber: 'P401-5R2MRM',
    category: 'optimizer',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      dcInputKwMax: 0.400, maxDcVoltage: 80, maxInputCurrent: 15.0, efficiency: 99.5,
    },
    requiredAccessories: [],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'string_inverter',
        targetIds: ['se-7600h', 'se-10000h', 'solaredge-hub-10kw'],
        reason: 'SolarEdge optimizers require SolarEdge inverters' },
    ],
    notesTemplates: ['SolarEdge P401 — 400W optimizer, SE HD-Wave compatible'],
  },

  {
    id: 'se-p505',
    manufacturer: 'SolarEdge',
    model: 'P505 Power Optimizer',
    partNumber: 'P505-5R2MRM',
    category: 'optimizer',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      dcInputKwMax: 0.505, maxDcVoltage: 80, maxInputCurrent: 15.0, efficiency: 99.5,
    },
    requiredAccessories: [],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'string_inverter',
        targetIds: ['se-7600h', 'se-10000h', 'solaredge-hub-10kw'],
        reason: 'SolarEdge optimizers require SolarEdge inverters' },
    ],
    notesTemplates: ['SolarEdge P505 — 505W optimizer for high-power modules'],
  },

  {
    id: 'tigo-ts4-a-o',
    manufacturer: 'Tigo',
    model: 'TS4-A-O Optimizer',
    partNumber: 'TAP-TS4-A-O',
    category: 'optimizer',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      dcInputKwMax: 0.700, maxDcVoltage: 80, maxInputCurrent: 15.0, efficiency: 99.5,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'Tigo Cloud Connect Advanced gateway',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Tigo', defaultModel: 'Cloud Connect Advanced',
        defaultPartNumber: 'TAP-CCAGW-01', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'recommends', targetCategory: 'string_inverter',
        reason: 'Tigo optimizers are brand-agnostic — work with any string inverter' },
    ],
    notesTemplates: ['Tigo TS4-A-O — brand-agnostic optimizer, works with any string inverter'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING — ROOFTECH RT-MINI (Rail-Based Standoff System)
  // Assembly: RT-MINI flashed pad (2 lag screws into rafter) → bolt through pad
  //           → L-foot → standard rail (IronRidge XR100/XR1000, Pegasus, or compatible)
  // ICC-ES ESR-3575 / UL 2703 | ASCE 7-22 | 150 mph wind | 45 psf snow
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'rooftech-mini',
    manufacturer: 'Roof Tech',
    model: 'RT-MINI Flush Mount',
    partNumber: 'RT-MINI-01',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 150,
      maxSnowLoad: 45,
      railSpanMax: 72,              // max L-foot to L-foot spacing (inches) along rail
      attachmentSpacingMax: 48,     // max pad spacing perpendicular to rail (inches)
      requiresRail: true,           // RT-MINI pad mounts L-foot → rail → clamps → modules
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 900,       // 2 lag bolts × 450 lbf/bolt (ICC-ES ESR-3575)
      shearCapacityLbs: 600,
      // Discrete load model: each RT-MINI pad is independently evaluated
      loadModel: 'discrete',
      fastenersPerAttachment: 2,    // 2 lag bolts per RT-MINI pad
      upliftCapacity: 450,          // lbf per lag bolt (ICC-ES ESR-3575)
      tributaryArea: 8.5,           // ft² per attachment point
      iccEsReport: 'ESR-3575',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'RT-MINI flashed pad — 2 per module row (1 per rafter, min 2 per module)',
        required: true, quantityRule: 'perAttachment',
        defaultManufacturer: 'Roof Tech', defaultModel: 'RT-MINI Pad Assembly',
        defaultPartNumber: 'RT-MINI-ASSY', necReference: 'ASCE 7-22 / ICC-ES ESR-3575',
        notes: 'Flashed pad with integrated EPDM butyl seal — the pad IS the flashing '
          + '(seals the lag penetration on contact). No separate flashing kit; do NOT '
          + 'add a flashing accessory for RT-MINI (it would double-bill the same EPDM seal).',
      },
      // NOTE: RT-MINI has NO separate flashing accessory. The flashed pad above is
      // self-flashing (integrated EPDM butyl on the underside seals the screw hole at
      // the rafter). A previous 'RT-MINI Flashing Kit' (RT-MINI-FLASH) line here
      // double-billed the same seal (~$7.3k on a 730-pad job). For traditional L-foot
      // systems (IronRidge/Unirac) the separate flashing accessory is correct; for a
      // self-flashing pad it is not.
      {
        category: 'lag_bolt',
        description: '5/16" × 3" lag bolt — 2 per RT-MINI pad into rafter',
        required: true, quantityRule: 'formula',
        quantityFormula: 'attachments * 2',
        defaultManufacturer: 'Generic', defaultModel: '5/16" × 3" Lag Bolt SS',
        defaultPartNumber: 'LAG-516-3-SS', necReference: 'ASCE 7-22',
        notes: 'Stainless steel lag bolt, min 2.5" embedment into rafter (ICC-ES ESR-3575)',
      },
      {
        category: 'l_foot',
        description: 'L-foot — 1 per RT-MINI pad (attaches to pad bolt, receives rail)',
        required: true, quantityRule: 'perAttachment',
        defaultManufacturer: 'IronRidge', defaultModel: 'L-Foot Universal',
        defaultPartNumber: 'LFT-001-B', necReference: 'ASCE 7-22',
        notes: 'L-foot bolts to RT-MINI pad stud. Compatible with IronRidge, Pegasus, UniRac, and most standard rails.',
      },
      {
        category: 'rail',
        description: 'Rail — 2 rails per module row (IronRidge XR100/XR1000, Pegasus)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'XR100 Rail 168"',
        defaultPartNumber: 'XR-100-168B', necReference: 'UL 2703',
        notes: '2 rails per string row (portrait). IronRidge XR100/XR1000 aluminum extruded rail; alternates Pegasus, UniRac SFM.',
      },
      {
        category: 'mid_clamp',
        description: 'Mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO Mid Clamp',
        defaultPartNumber: 'UFO-MID-01', necReference: 'UL 2703',
      },
      {
        category: 'end_clamp',
        description: 'End clamp — 4 per string (2 rails × 2 ends)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO End Clamp',
        defaultPartNumber: 'UFO-END-01', necReference: 'UL 2703',
      },
      {
        category: 'grounding',
        description: 'Grounding lug — 1 per module (bonding)',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'Wiley Electronics', defaultModel: 'WEEB Lug 6.7',
        defaultPartNumber: 'WEEB-LUG-6.7', necReference: 'NEC 690.43',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'Roof Tech RT-MINI — flashed pad standoff system, rail-based attachment',
      'Assembly: RT-MINI pad (2 lag bolts into rafter) → L-foot → standard rail → mid/end clamps',
      'Rails: IronRidge XR100/XR1000, Pegasus, UniRac SFM',
      'ICC-ES ESR-3575 / UL 2703, ASCE 7-22 compliant, 150 mph wind, 45 psf snow',
      'Max 48" pad spacing, max 72" rail span (L-foot to L-foot)',
    ],
    iccEsReport: 'ESR-3575',
    warranty: '20-year product',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING — PLP POWER PEAK DRIVEN PILES (Ground Mount)
  // ══════════════════════════════════════════════════════════════════════════

  {
    // Speck PLP POWER DRIVE™ — the I-beam pile-driven, SINGLE-ROW vertical-post
    // ground mount (one pylon per bay + tilted strongback + PX rail, single-strut
    // cantilever). This is the product the Design Studio ground reality engine
    // builds (lib/3d/ground/groundMountRealityEngine.ts, install doc SP3284 RevE).
    // Corrected 2026-07 from a mis-entered "POWER PEAK" double-post (2 piles/row,
    // 2-7/8" pipe) spec, which is a DIFFERENT PLP product and contradicted the
    // studio. Ref: plp.com/renewables/solar/ground-mounts/power-drive (UL 2703,
    // wind-tunnel tested). NOTE: PLP does not publish catalog SKUs/pricing — part
    // numbers below are internal identifiers; real pricing is per PLP quote/RFQ.
    id: 'plp-power-drive-driven-pile',
    manufacturer: 'PLP (Preformed Line Products)',
    model: 'POWER DRIVE Ground Mount System',
    partNumber: 'PD-SYSTEM-SP3284',
    category: 'racking',
    topologyType: 'GROUND_MOUNT_DRIVEN_PILE',
    mountTopology: 'GROUND_MOUNT_DRIVEN_PILE',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 170,
      maxSnowLoad: 60,
      railSpanMax: 240,             // continuous PX rail spans ~20 ft pylon-to-pylon
      attachmentSpacingMax: 240,    // one pylon per bay ≈ 20 ft O.C.
      requiresRail: true,
      foundationType: 'driven_pile',
      upliftCapacityLbs: 4000,
      shearCapacityLbs: 3000,
      iccEsReport: 'ESR-3895',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'driven_pile',
        description: 'POWER DRIVE driven I-beam pylon — single-row, one per bay',
        required: true, quantityRule: 'formula',
        quantityFormula: 'ceil(modules / 5)',
        defaultManufacturer: 'PLP', defaultModel: 'POWER DRIVE I-beam Pylon (W-section, galv. steel)',
        defaultPartNumber: 'PD-PYLON-IBEAM', necReference: 'ASCE 7-22',
        notes: 'Single-row vertical I-beam post, ONE per bay ≈ 20 ft O.C., driven with hydraulic hammer — no concrete. Exact count per PLP layout / reality engine.',
      },
      {
        category: 'rail',
        description: 'POWER DRIVE PX rail — integrated wire channel, spans pylon-to-pylon',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'PLP', defaultModel: 'POWER DRIVE PX Rail 20 ft (integrated wire channel)',
        defaultPartNumber: 'PD-PXRAIL-20FT', necReference: 'ASCE 7-22',
        notes: '2 continuous rails per table (upper + lower clamp line), spliced between sections',
      },
      {
        category: 'grounding',
        description: 'Ground mount grounding electrode — 1 per system',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Erico', defaultModel: '5/8" × 8ft Ground Rod',
        defaultPartNumber: 'ERITECH-615800', necReference: 'NEC 250.52',
      },
      {
        category: 'mid_clamp',
        description: 'Module mid clamp — 2 per interior module (pre-assembled)',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'PLP', defaultModel: 'POWER DRIVE Pre-Assembled Mid Clamp',
        defaultPartNumber: 'PD-MID-CLAMP', necReference: 'UL 2703',
      },
      {
        category: 'end_clamp',
        description: 'Module end clamp — 4 per string (2 rails × 2 ends, pre-assembled)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'PLP', defaultModel: 'POWER DRIVE Pre-Assembled End Clamp',
        defaultPartNumber: 'PD-END-CLAMP', necReference: 'UL 2703',
      },
      {
        category: 'conduit',
        description: 'Underground conduit for DC home run — 1 per system',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Generic', defaultModel: '1" Schedule 40 PVC Conduit',
        defaultPartNumber: 'PVC-SCH40-1IN', necReference: 'NEC 300.5',
        notes: 'Minimum 24" burial depth for PVC conduit per NEC 300.5',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'PLP POWER DRIVE™ — single-row driven I-beam pylon ground mount (install doc SP3284, UL 2703)',
      'Wind-tunnel tested; ICC-ES ESR-3895; ASCE 7-22 compliant',
      'ONE pylon per bay ≈ 20 ft O.C. — no concrete, driven foundation',
      'Patented pre-assembled module clamps; PX rail with integrated wire channel',
      'Underground conduit required for DC home run per NEC 300.5',
      'Pricing per PLP quote/RFQ — not publicly listed',
    ],
    iccEsReport: 'ESR-3895',
    warranty: '25-year product',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING — IRONRIDGE (Rail-Based)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'ironridge-xr100',
    manufacturer: 'IronRidge',
    model: 'XR100 Rail System',
    partNumber: 'XR-100-168B',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 160,
      maxSnowLoad: 50,
      railSpanMax: 72,
      attachmentSpacingMax: 72,
      requiresRail: true,
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 1200,
      shearCapacityLbs: 900,
      iccEsReport: 'ESR-2962',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'L-foot with lag bolt — 1 per attachment point',
        required: true, quantityRule: 'perAttachment',
        defaultManufacturer: 'IronRidge', defaultModel: 'L-Foot with Lag Bolt',
        defaultPartNumber: 'LFT-001-B', necReference: 'ASCE 7-22',
        notes: '5/16" × 3" lag bolt, min 2.5" embedment into rafter',
      },
      {
        category: 'flashing',
        description: 'Roof flashing — 1 per attachment (shingle/tile roofs)',
        required: true,
        conditional: 'roofType === shingle || roofType === tile',
        quantityRule: 'perAttachment',
        defaultManufacturer: 'QuickMount PV', defaultModel: 'Classic Mount Flashing',
        defaultPartNumber: 'QM-CLASSIC-1', necReference: 'UL 2703',
      },
      {
        category: 'rail',
        description: 'XR100 rail — 2 rails per row of modules',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'XR100 Rail 168"',
        defaultPartNumber: 'XR-100-168B', necReference: 'UL 2703',
        notes: '2 rails per string row, 168" (14ft) standard length',
      },
      {
        category: 'mid_clamp',
        description: 'UFO mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO Mid Clamp',
        defaultPartNumber: 'UFO-MID-01', necReference: 'UL 2703',
      },
      {
        category: 'end_clamp',
        description: 'UFO end clamp — 4 per string (2 rails × 2 ends)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO End Clamp',
        defaultPartNumber: 'UFO-END-01', necReference: 'UL 2703',
      },
      {
        category: 'splice',
        description: 'Rail splice — 1 per rail joint',
        required: false, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'XR100 Splice',
        defaultPartNumber: 'XR-100-SPLICE', necReference: 'UL 2703',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'IronRidge XR100 — rail-based roof mount, max 72" attachment spacing',
      'ICC-ES ESR-2962, ASCE 7-22 compliant',
      'Compatible with QuickMount PV, EcoFasten, and standard L-foot flashings',
    ],
    iccEsReport: 'ESR-2962',
    warranty: '20-year product',
  },

  {
    id: 'ironridge-xr1000',
    manufacturer: 'IronRidge',
    model: 'XR1000 Rail System',
    partNumber: 'XR-1000-168B',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 180,
      maxSnowLoad: 60,
      railSpanMax: 96,
      attachmentSpacingMax: 96,
      requiresRail: true,
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 1800,
      shearCapacityLbs: 1400,
      iccEsReport: 'ESR-2962',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'L-foot with lag bolt — 1 per attachment point',
        required: true, quantityRule: 'perAttachment',
        defaultManufacturer: 'IronRidge', defaultModel: 'L-Foot with Lag Bolt',
        defaultPartNumber: 'LFT-001-B', necReference: 'ASCE 7-22',
      },
      {
        category: 'flashing',
        description: 'Roof flashing — 1 per attachment',
        required: true,
        conditional: 'roofType === shingle || roofType === tile',
        quantityRule: 'perAttachment',
        defaultManufacturer: 'QuickMount PV', defaultModel: 'Classic Mount Flashing',
        defaultPartNumber: 'QM-CLASSIC-1', necReference: 'UL 2703',
      },
      {
        category: 'rail',
        description: 'XR1000 rail — 2 rails per row',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'XR1000 Rail 168"',
        defaultPartNumber: 'XR-1000-168B', necReference: 'UL 2703',
      },
      {
        category: 'mid_clamp',
        description: 'UFO mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO Mid Clamp',
        defaultPartNumber: 'UFO-MID-01', necReference: 'UL 2703',
      },
      {
        category: 'end_clamp',
        description: 'UFO end clamp — 4 per string',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO End Clamp',
        defaultPartNumber: 'UFO-END-01', necReference: 'UL 2703',
      },
    ],
    compatibilityRules: [],
    notesTemplates: ['IronRidge XR1000 — heavy-duty rail, max 96" attachment spacing, high wind/snow'],
    iccEsReport: 'ESR-2962',
    warranty: '20-year product',
  },

  {
    id: 'ironridge-gft',
    manufacturer: 'IronRidge',
    model: 'GFT Ground Mount',
    partNumber: 'GFT-01',
    category: 'racking',
    topologyType: 'GROUND_MOUNT_FIXED_TILT',
    mountTopology: 'GROUND_MOUNT_FIXED_TILT',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 160,
      maxSnowLoad: 50,
      railSpanMax: 96,
      attachmentSpacingMax: 96,
      requiresRail: true,
      foundationType: 'driven_pile',
      upliftCapacityLbs: 3000,
      shearCapacityLbs: 2500,
      iccEsReport: 'ESR-2962',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'driven_pile',
        description: 'Driven pile — 2 per row (front + back)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'ceil(strings * 2)',
        defaultManufacturer: 'IronRidge', defaultModel: '2-3/8" OD Driven Pile',
        defaultPartNumber: 'GFT-PILE-01', necReference: 'ASCE 7-22',
        notes: '2 piles per string row — front and back post',
      },
      {
        category: 'grounding',
        description: 'Ground mount grounding electrode',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Erico', defaultModel: '5/8" × 8ft Ground Rod',
        defaultPartNumber: 'ERITECH-615800', necReference: 'NEC 250.52',
      },
      {
        category: 'mid_clamp',
        description: 'Module mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO Mid Clamp',
        defaultPartNumber: 'UFO-MID-01', necReference: 'UL 2703',
      },
      {
        category: 'end_clamp',
        description: 'Module end clamp — 4 per string',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO End Clamp',
        defaultPartNumber: 'UFO-END-01', necReference: 'UL 2703',
      },
    ],
    compatibilityRules: [],
    notesTemplates: ['IronRidge GFT — ground mount fixed tilt, driven pile foundation'],
    iccEsReport: 'ESR-2962',
    warranty: '20-year product',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING — SNAPNRACK (Rail-Based + Rail-Less)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'snapnrack-100',
    manufacturer: 'SnapNrack',
    model: 'Series 100 Rail System',
    partNumber: 'SNR-100-RAIL',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 150,
      maxSnowLoad: 45,
      railSpanMax: 72,
      attachmentSpacingMax: 72,
      requiresRail: true,
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 1000,
      shearCapacityLbs: 800,
      iccEsReport: 'ESR-3575',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'SnapNrack L-foot — 1 per attachment point',
        required: true, quantityRule: 'perAttachment',
        defaultManufacturer: 'SnapNrack', defaultModel: 'Series 100 L-Foot',
        defaultPartNumber: 'SNR-LFOOT-01', necReference: 'ASCE 7-22',
      },
      {
        category: 'flashing',
        description: 'Roof flashing — 1 per attachment (shingle/tile)',
        required: true,
        conditional: 'roofType === shingle || roofType === tile',
        quantityRule: 'perAttachment',
        defaultManufacturer: 'QuickMount PV', defaultModel: 'Classic Mount Flashing',
        defaultPartNumber: 'QM-CLASSIC-1', necReference: 'UL 2703',
      },
      {
        category: 'rail',
        description: 'Series 100 rail — 2 rails per row',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'SnapNrack', defaultModel: 'Series 100 Rail 168"',
        defaultPartNumber: 'SNR-100-168', necReference: 'UL 2703',
      },
      {
        category: 'mid_clamp',
        description: 'Mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'SnapNrack', defaultModel: 'Series 100 Mid Clamp',
        defaultPartNumber: 'SNR-MID-01', necReference: 'UL 2703',
      },
      {
        category: 'end_clamp',
        description: 'End clamp — 4 per string',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'SnapNrack', defaultModel: 'Series 100 End Clamp',
        defaultPartNumber: 'SNR-END-01', necReference: 'UL 2703',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'SnapNrack Series 100 — rail-based roof mount, max 72" attachment spacing',
      'ICC-ES ESR-3575, ASCE 7-22 compliant',
    ],
    iccEsReport: 'ESR-3575',
    warranty: '20-year product',
  },

  {
    id: 'snapnrack-ul',
    manufacturer: 'SnapNrack',
    model: 'Ultra-Light Rail-Less',
    partNumber: 'SNR-UL-01',
    category: 'racking',
    topologyType: 'ROOF_RAIL_LESS',
    mountTopology: 'ROOF_RAIL_LESS',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 140,
      maxSnowLoad: 40,
      railSpanMax: 0,
      attachmentSpacingMax: 48,
      requiresRail: false,
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 750,
      shearCapacityLbs: 600,
      modulesPerAttachment: 0.5,
      iccEsReport: 'ESR-3575',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'Ultra-Light mount — 4 per module',
        required: true, quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'SnapNrack', defaultModel: 'Ultra-Light Mount',
        defaultPartNumber: 'SNR-UL-MOUNT', necReference: 'ASCE 7-22',
      },
      {
        category: 'flashing',
        description: 'Integrated flashing — 1 per mount (shingle)',
        required: true,
        conditional: 'roofType === shingle',
        quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'SnapNrack', defaultModel: 'Ultra-Light Flashing',
        defaultPartNumber: 'SNR-UL-FLASH', necReference: 'UL 2703',
      },
    ],
    compatibilityRules: [],
    notesTemplates: ['SnapNrack Ultra-Light — rail-less, 4 mounts per module, max 48" spacing'],
    iccEsReport: 'ESR-3575',
    warranty: '20-year product',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING — UNIRAC (Rail-Based + SolarMount)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'unirac-solarmount',
    manufacturer: 'Unirac',
    model: 'SunFrame Rail System',
    partNumber: 'UR-SF-168',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 150,
      maxSnowLoad: 45,
      railSpanMax: 72,
      attachmentSpacingMax: 72,
      requiresRail: true,
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 1100,
      shearCapacityLbs: 850,
      iccEsReport: 'ESR-2695',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'Unirac roof hook / L-foot — 1 per attachment point',
        required: true, quantityRule: 'perAttachment',
        defaultManufacturer: 'Unirac', defaultModel: 'Roof Hook Assembly',
        defaultPartNumber: 'UR-HOOK-01', necReference: 'ASCE 7-22',
      },
      {
        category: 'flashing',
        description: 'Roof flashing — 1 per attachment (shingle/tile)',
        required: true,
        conditional: 'roofType === shingle || roofType === tile',
        quantityRule: 'perAttachment',
        defaultManufacturer: 'QuickMount PV', defaultModel: 'Classic Mount Flashing',
        defaultPartNumber: 'QM-CLASSIC-1', necReference: 'UL 2703',
      },
      {
        category: 'rail',
        description: 'SunFrame rail — 2 rails per row',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'Unirac', defaultModel: 'SunFrame Rail 168"',
        defaultPartNumber: 'UR-SF-168', necReference: 'UL 2703',
      },
      {
        category: 'mid_clamp',
        description: 'Mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'Unirac', defaultModel: 'SunFrame Mid Clamp',
        defaultPartNumber: 'UR-MID-01', necReference: 'UL 2703',
      },
      {
        category: 'end_clamp',
        description: 'End clamp — 4 per string',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'Unirac', defaultModel: 'SunFrame End Clamp',
        defaultPartNumber: 'UR-END-01', necReference: 'UL 2703',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'Unirac SunFrame — rail-based roof mount, max 72" attachment spacing',
      'ICC-ES ESR-2695, ASCE 7-22 compliant',
    ],
    iccEsReport: 'ESR-2695',
    warranty: '20-year product',
  },

  {
    id: 'unirac-rm10-evo',
    manufacturer: 'Unirac',
    model: 'RM Ballasted Flat Roof',
    partNumber: 'UR-RM-BALLAST',
    category: 'racking',
    topologyType: 'ROOF_RAIL_LESS',
    mountTopology: 'ROOF_RAIL_LESS',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 130,
      maxSnowLoad: 30,
      railSpanMax: 0,
      attachmentSpacingMax: 60,
      requiresRail: false,
      foundationType: 'ballast',
      ballastWeightLbs: 40,
      iccEsReport: 'ESR-2695',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'RM ballast tray — 1 per module',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'Unirac', defaultModel: 'RM Ballast Tray',
        defaultPartNumber: 'UR-RM-TRAY', necReference: 'ASCE 7-22',
        notes: 'Ballasted — no roof penetrations. Verify roof load capacity.',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'Unirac RM Ballasted — flat roof, no penetrations, 40 lbs ballast per tray',
      'Verify roof structural capacity for added dead load',
    ],
    iccEsReport: 'ESR-2695',
    warranty: '20-year product',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING — QUICKMOUNT PV (Flashings + Mounts)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'quickmount-classic',
    manufacturer: 'QuickMount PV',
    model: 'Classic Composition Mount',
    partNumber: 'QM-CLASSIC-1',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 160,
      maxSnowLoad: 50,
      requiresRail: true,
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 1500,
      shearCapacityLbs: 1200,
      iccEsReport: 'ESR-2575',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'lag_bolt',
        description: '5/16" × 3" lag bolt — 1 per mount',
        required: true, quantityRule: 'perAttachment',
        defaultManufacturer: 'Generic', defaultModel: '5/16" × 3" Lag Bolt SS',
        defaultPartNumber: 'LAG-516-3-SS', necReference: 'ASCE 7-22',
      },
    ],
    compatibilityRules: [
      { type: 'recommends', targetCategory: 'racking',
        targetIds: ['ironridge-xr100', 'ironridge-xr1000', 'unirac-solarmount', 'snapnrack-100'],
        reason: 'QuickMount PV Classic is a flashing/mount — pairs with any rail system' },
    ],
    notesTemplates: [
      'QuickMount PV Classic — composition shingle flashing, ICC-ES ESR-2575',
      'Integrated EPDM seal, 5/16" lag bolt, 2.5" min embedment',
      'Compatible with IronRidge, Unirac, SnapNrack rail systems',
    ],
    iccEsReport: 'ESR-2575',
    warranty: '20-year product',
  },

  {
    id: 'quickmount-tile',
    manufacturer: 'QuickMount PV',
    model: 'Tile Replacement Mount',
    partNumber: 'QM-TILE-1',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 160,
      maxSnowLoad: 50,
      requiresRail: true,
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 1500,
      shearCapacityLbs: 1200,
      iccEsReport: 'ESR-2575',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'lag_bolt',
        description: '5/16" × 3" lag bolt — 1 per mount',
        required: true, quantityRule: 'perAttachment',
        defaultManufacturer: 'Generic', defaultModel: '5/16" × 3" Lag Bolt SS',
        defaultPartNumber: 'LAG-516-3-SS', necReference: 'ASCE 7-22',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'QuickMount PV Tile Replacement — concrete/clay tile, ICC-ES ESR-2575',
      'Replaces one tile per mount. No tile cutting required.',
    ],
    iccEsReport: 'ESR-2575',
    warranty: '20-year product',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING — ECOFASTEN (Rail-Less)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'ecofasten-rockit',
    manufacturer: 'EcoFasten',
    model: 'Rock-It Rail-Less System',
    partNumber: 'EF-ROCKIT-01',
    category: 'racking',
    topologyType: 'ROOF_RAIL_LESS',
    mountTopology: 'ROOF_RAIL_LESS',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 140,
      maxSnowLoad: 40,
      railSpanMax: 0,
      attachmentSpacingMax: 48,
      requiresRail: false,
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 800,
      shearCapacityLbs: 650,
      modulesPerAttachment: 0.5,
      iccEsReport: 'ESR-3575',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'Rock-It mount — 4 per module (direct attachment)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'EcoFasten', defaultModel: 'Rock-It Mount',
        defaultPartNumber: 'EF-ROCKIT-MOUNT', necReference: 'ASCE 7-22',
        notes: '4 mounts per module — 2 on each short side',
      },
      {
        category: 'flashing',
        description: 'Integrated flashing — included with Rock-It mount (shingle)',
        required: true,
        conditional: 'roofType === shingle',
        quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'EcoFasten', defaultModel: 'Rock-It Flashing',
        defaultPartNumber: 'EF-ROCKIT-FLASH', necReference: 'UL 2703',
        notes: 'Integrated EPDM flashing included with Rock-It mount',
      },
      {
        category: 'lag_bolt',
        description: '5/16" × 3" lag bolt — 1 per mount',
        required: true, quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'Generic', defaultModel: '5/16" × 3" Lag Bolt SS',
        defaultPartNumber: 'LAG-516-3-SS', necReference: 'ASCE 7-22',
      },
      {
        category: 'grounding',
        description: 'Grounding lug — 1 per module',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'Wiley Electronics', defaultModel: 'WEEB Lug 6.7',
        defaultPartNumber: 'WEEB-LUG-6.7', necReference: 'NEC 690.43',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'EcoFasten Rock-It — rail-less direct attachment, 4 mounts per module',
      'ICC-ES ESR-3575, ASCE 7-22 compliant, max 48" attachment spacing',
    ],
    iccEsReport: 'ESR-3575',
    warranty: '20-year product',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING — S-5! (Standing Seam Metal Roof — No Penetrations)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 's5-pvkit',
    manufacturer: 'S-5!',
    model: 'PVKIT 2.0 Standing Seam',
    partNumber: 'S5-PVKIT2-01',
    category: 'racking',
    topologyType: 'ROOF_STANDING_SEAM',
    mountTopology: 'ROOF_STANDING_SEAM',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 170,
      maxSnowLoad: 55,
      railSpanMax: 0,
      attachmentSpacingMax: 60,
      requiresRail: false,
      foundationType: 'clamp',
      upliftCapacityLbs: 1200,
      shearCapacityLbs: 900,
      modulesPerAttachment: 0.5,
      clampType: 'S-5! U-Clamp',
      seamProfiles: ['snap-lock', 'mechanical-lock', 'T-seam', 'batten-seam'],
      iccEsReport: 'ESR-3575',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'S-5! clamp — 4 per module (no roof penetrations)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'S-5!', defaultModel: 'S-5! U-Clamp 2',
        defaultPartNumber: 'S5-UCLAMP2-01', necReference: 'ASCE 7-22',
        notes: 'No roof penetrations — clamp directly to standing seam. Verify seam profile.',
      },
      {
        category: 'grounding',
        description: 'Grounding lug — 1 per module (metal roof bonding)',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'Wiley Electronics', defaultModel: 'WEEB Lug 6.7',
        defaultPartNumber: 'WEEB-LUG-6.7', necReference: 'NEC 690.43',
        notes: 'Metal roof provides grounding path — verify continuity',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'S-5! PVKIT 2.0 — standing seam metal roof, NO roof penetrations',
      'Clamp directly to seam — verify seam profile matches clamp model',
      'Compatible with snap-lock, mechanical-lock, T-seam, batten-seam profiles',
      'ICC-ES ESR-3575, ASCE 7-22 compliant',
    ],
    iccEsReport: 'ESR-3575',
    warranty: '25-year product',
  },

  {
    id: 's5-corrugated',
    manufacturer: 'S-5!',
    model: 'S-5! Corrugated Metal Mount',
    partNumber: 'S5-CORR-01',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 150,
      maxSnowLoad: 45,
      requiresRail: true,
      foundationType: 'clamp',
      upliftCapacityLbs: 900,
      shearCapacityLbs: 700,
      clampType: 'S-5! CorruBracket',
      seamProfiles: ['corrugated', 'R-panel', 'PBR-panel'],
      iccEsReport: 'ESR-3575',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'S-5! CorruBracket — 1 per attachment point',
        required: true, quantityRule: 'perAttachment',
        defaultManufacturer: 'S-5!', defaultModel: 'S-5! CorruBracket',
        defaultPartNumber: 'S5-CORRUBRACKET', necReference: 'ASCE 7-22',
        notes: 'Self-tapping screws with EPDM washer seal into structural purlin',
      },
      {
        category: 'sealant',
        description: 'Butyl tape sealant — 1 roll per 20 attachments',
        required: true, quantityRule: 'formula',
        quantityFormula: 'ceil(attachments / 20)',
        defaultManufacturer: 'Generic', defaultModel: 'Butyl Tape 1/8" × 1/2"',
        defaultPartNumber: 'BUTYL-TAPE-01', necReference: 'UL 2703',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'S-5! Corrugated — corrugated/R-panel metal roof mount',
      'Self-tapping screws into structural purlins only',
      'Apply butyl tape + EPDM washer at every penetration',
    ],
    iccEsReport: 'ESR-3575',
    warranty: '25-year product',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BATTERIES
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'enphase-iq-battery-5p',
    manufacturer: 'Enphase',
    model: 'IQ Battery 5P',
    partNumber: 'IQ-BAT-5P-1P-240',
    category: 'battery',
    topologyType: 'AC_COUPLED_BATTERY',
    electricalSpecs: {
      acOutputKw: 3.84, acOutputVoltage: 240, acOutputCurrentMax: 16.0, efficiency: 89.0,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'IQ Gateway required for battery management',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase', defaultModel: 'IQ Gateway Standard',
        defaultPartNumber: 'ENV-IQ-AM1-240', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'gateway', reason: 'IQ Gateway required for Enphase battery' },
    ],
    notesTemplates: ['Enphase IQ Battery 5P — AC-coupled, 5kWh usable, IQ Gateway required'],
    ulListing: 'UL 9540',
    warranty: '10-year standard',
  },

  {
    id: 'tesla-powerwall-3',
    manufacturer: 'Tesla',
    model: 'Powerwall 3',
    partNumber: 'PW3-US',
    category: 'battery',
    topologyType: 'AC_COUPLED_BATTERY',
    electricalSpecs: {
      acOutputKw: 11.5, acOutputVoltage: 240, acOutputCurrentMax: 48.0, efficiency: 90.0,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'Tesla Gateway 2 — required for Powerwall 3',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'Tesla', defaultModel: 'Gateway 2',
        defaultPartNumber: 'TESLA-GW2', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [],
    notesTemplates: ['Tesla Powerwall 3 — AC-coupled, 13.5kWh usable, integrated inverter'],
    ulListing: 'UL 9540',
    warranty: '10-year standard',
  },

  {
    id: 'solaredge-hub-10kw',
    manufacturer: 'SolarEdge',
    model: 'Energy Hub 10kW',
    partNumber: 'SE10K-RWS',
    category: 'string_inverter',
    topologyType: 'HYBRID_INVERTER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 15.0, maxDcVoltage: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 99.0, mpptChannels: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'optimizer',
        description: 'DC power optimizer — 1 per module',
        required: true, quantityRule: 'perModule',
        defaultManufacturer: 'SolarEdge', defaultModel: 'P401 Power Optimizer',
        defaultPartNumber: 'P401-5R2MRM', necReference: 'NEC 690.8',
      },
      {
        category: 'battery',
        description: 'DC-coupled battery storage (optional)',
        required: false, quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge', defaultModel: 'Home Battery 10kWh',
        defaultPartNumber: 'SEHB-10K',
        notes: 'Optional battery — enables DC_COUPLED_BATTERY topology',
      },
      {
        category: 'gateway',
        description: 'Energy Hub monitoring gateway',
        required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge', defaultModel: 'Energy Hub Gateway',
        defaultPartNumber: 'SEG-HUB-1', necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'optimizer', reason: 'SolarEdge topology requires optimizers' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['SolarEdge Energy Hub 10kW — hybrid inverter with battery port'],
    ulListing: 'UL 1741 SA',
    warranty: '12-year standard',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ECOFLOW POWEROCEAN — Hybrid inverter + LFP battery system (v47.358)
  // Source: lib/ecoflow-system.ts (single source of truth for EcoFlow catalog)
  // Default baseline for SolFence projects.
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'ecoflow-power-ocean-5kw',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean 5kW Hybrid',
    partNumber: 'EF-PO-5K-HV',
    category: 'string_inverter',
    topologyType: 'HYBRID_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 7.5, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 97.5, mpptChannels: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      { category: 'smart_meter', description: 'EcoFlow Smart Meter (CT-based)', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Smart Meter', defaultPartNumber: 'EF-SMART-METER', necReference: 'NEC 705.12' },
      { category: 'monitoring', description: 'EcoFlow Monitoring Gateway', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Monitoring Gateway', defaultPartNumber: 'EF-MON-GW' },
    ],
    compatibilityRules: [],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 25, max: 30 } },
    notesTemplates: ['EcoFlow PowerOcean 5kW — LFP-compatible hybrid, 2 MPPT, for ≤6 kW DC arrays'],
    ulListing: 'UL 1741-SA',
    warranty: '10-year standard',
  },
  {
    id: 'ecoflow-power-ocean-10kw',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean 10kW Hybrid',
    partNumber: 'EF-PO-10K-HV',
    category: 'string_inverter',
    topologyType: 'HYBRID_INVERTER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 15.0, maxDcVoltage: 600,
      mpptVoltageMin: 120, mpptVoltageMax: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 97.8, mpptChannels: 3,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      { category: 'smart_meter', description: 'EcoFlow Smart Meter (CT-based)', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Smart Meter', defaultPartNumber: 'EF-SMART-METER', necReference: 'NEC 705.12' },
      { category: 'monitoring', description: 'EcoFlow Monitoring Gateway', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Monitoring Gateway', defaultPartNumber: 'EF-MON-GW' },
    ],
    compatibilityRules: [],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['EcoFlow PowerOcean 10kW — LFP-compatible hybrid, 3 MPPT, for 6–12 kW DC arrays'],
    ulListing: 'UL 1741-SA',
    warranty: '10-year standard',
  },
  {
    id: 'ecoflow-power-ocean-20kw',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean Pro 20kW Hybrid',
    partNumber: 'EF-PO-20K-HV-PRO',
    category: 'string_inverter',
    topologyType: 'HYBRID_INVERTER',
    electricalSpecs: {
      acOutputKw: 20.0, dcInputKwMax: 30.0, maxDcVoltage: 1000,
      mpptVoltageMin: 120, mpptVoltageMax: 1000,
      acOutputVoltage: 240, acOutputCurrentMax: 83.3,
      efficiency: 98.0, mpptChannels: 4,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      { category: 'smart_meter', description: 'EcoFlow Smart Meter (CT-based)', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Smart Meter', defaultPartNumber: 'EF-SMART-METER', necReference: 'NEC 705.12' },
      { category: 'monitoring', description: 'EcoFlow Monitoring Gateway', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Monitoring Gateway', defaultPartNumber: 'EF-MON-GW' },
    ],
    compatibilityRules: [],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 100, max: 125 } },
    notesTemplates: ['EcoFlow PowerOcean Pro 20kW — LFP-compatible hybrid, 4 MPPT, for >12 kW DC arrays'],
    ulListing: 'UL 1741-SA',
    warranty: '10-year standard',
  },

  // EcoFlow LFP battery module — stackable 5 kWh
  {
    id: 'ecoflow-battery-5kwh',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean LFP Battery Module (5kWh)',
    partNumber: 'EF-BATT-5K-LFP',
    category: 'battery',
    topologyType: 'AC_COUPLED_BATTERY',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 5.0, maxDcVoltage: 51.2,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 98.0,
    },
    requiredAccessories: [
      { category: 'battery_base', description: 'PowerOcean Battery Base / Stack Frame', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Battery Base', defaultPartNumber: 'EF-BATT-BASE' },
      { category: 'battery_combiner', description: 'PowerOcean Battery Combiner Box', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Battery Combiner', defaultPartNumber: 'EF-BATT-COMB' },
    ],
    compatibilityRules: [],
    notesTemplates: ['EcoFlow PowerOcean LFP 5 kWh — stackable module, 15-yr warranty, max 9 modules (45 kWh std)'],
    ulListing: 'UL 9540A, UL 1973',
    warranty: '15-year standard',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY LOOKUP FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// ID normalization map: equipment-db IDs → registry IDs
const REGISTRY_ID_ALIASES: Record<string, string> = {
  'qcells-peak-duo-400':    'qcells-q-peak-duo-400',
  // Racking ID aliases: old equipment-registry-v4 IDs -> canonical mounting-hardware-db IDs
  'rooftech-rt-mini':       'rooftech-mini',
  'unirac-sunframe':        'unirac-solarmount',
  'unirac-rm-ballast':      'unirac-rm10-evo',
  'snapnrack-series-100':   'snapnrack-100',
  'quickmount-tile-hook':   'quickmount-tile',
  'ecofasten-rock-it':      'ecofasten-rockit',
  's5-pvkit-2':             's5-pvkit',
};

export function getRegistryEntryV4(id: string): EquipmentRegistryEntry | undefined {
  return EQUIPMENT_REGISTRY_V4.find(e => e.id === id)
    ?? EQUIPMENT_REGISTRY_V4.find(e => e.id === REGISTRY_ID_ALIASES[id]);
}

export function getTopologyForEquipmentV4(id: string): TopologyType | undefined {
  return getRegistryEntryV4(id)?.topologyType;
}

export function getRequiredAccessoriesV4(id: string): AccessoryRule[] {
  return getRegistryEntryV4(id)?.requiredAccessories ?? [];
}

export function getEntriesByCategoryV4(category: EquipmentCategory): EquipmentRegistryEntry[] {
  return EQUIPMENT_REGISTRY_V4.filter(e => e.category === category);
}

export function getEntriesByTopologyV4(topology: TopologyType): EquipmentRegistryEntry[] {
  return EQUIPMENT_REGISTRY_V4.filter(e => e.topologyType === topology);
}

export function checkCompatibilityV4(
  primaryId: string,
  secondaryId: string
): { compatible: boolean; reason?: string } {
  const primary = getRegistryEntryV4(primaryId);
  if (!primary) return { compatible: false, reason: `Equipment ${primaryId} not found in registry` };
  const secondary = getRegistryEntryV4(secondaryId);
  if (!secondary) return { compatible: false, reason: `Equipment ${secondaryId} not found in registry` };

  for (const rule of primary.compatibilityRules) {
    if (rule.type === 'excludes' && rule.targetCategory === secondary.category) {
      if (!rule.targetIds || rule.targetIds.includes(secondaryId)) {
        return { compatible: false, reason: rule.reason };
      }
    }
    if (rule.type === 'requires' && rule.targetCategory === secondary.category) {
      if (rule.targetIds && !rule.targetIds.includes(secondaryId)) {
        return { compatible: false, reason: rule.reason };
      }
    }
  }
  return { compatible: true };
}

export function evaluateQuantityFormulaV4(
  formula: string,
  context: {
    modules: number;
    strings: number;
    inverters: number;
    branches?: number;
    railSections?: number;
    attachments?: number;
    systemKw?: number;
  }
): number {
  const safeFormula = formula
    .replace(/modules/g, String(context.modules))
    .replace(/strings/g, String(context.strings))
    .replace(/inverters/g, String(context.inverters))
    .replace(/branches/g, String(context.branches ?? context.strings))
    .replace(/railSections/g, String(context.railSections ?? 0))
    .replace(/attachments/g, String(context.attachments ?? 0))
    .replace(/systemKw/g, String(context.systemKw ?? 0))
    .replace(/ceil\(/g, 'Math.ceil(')
    .replace(/floor\(/g, 'Math.floor(')
    .replace(/round\(/g, 'Math.round(')
    .replace(/max\(/g, 'Math.max(')
    .replace(/min\(/g, 'Math.min(');

  try {
    // eslint-disable-next-line no-new-func
    return Math.max(0, Number(new Function(`return ${safeFormula}`)()));
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPOLOGY NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeTopologyV4(t: TopologyType): TopologyType {
  const map: Record<string, TopologyType> = {
    'STRING':           'STRING_INVERTER',
    'STRING_OPTIMIZER': 'STRING_WITH_OPTIMIZER',
    'MICRO':            'MICROINVERTER',
    'HYBRID':           'HYBRID_INVERTER',
  };
  return (map[t] as TopologyType) ?? t;
}

export const TOPOLOGY_LABELS_V4: Record<string, string> = {
  'STRING_INVERTER':          'String Inverter',
  'STRING_WITH_OPTIMIZER':    'String + Optimizer',
  'MICROINVERTER':            'Microinverter',
  'AC_MODULE':                'AC Module',
  'HYBRID_INVERTER':          'Hybrid Inverter',
  'DC_COUPLED_BATTERY':       'DC-Coupled Battery',
  'AC_COUPLED_BATTERY':       'AC-Coupled Battery',
  'GROUND_MOUNT_FIXED_TILT':  'Ground Mount (Fixed Tilt)',
  'GROUND_MOUNT_DRIVEN_PILE': 'Ground Mount (Driven Pile)',
  'ROOF_RAIL_BASED':          'Roof Mount (Rail)',
  'ROOF_RAIL_LESS':           'Roof Mount (Rail-Less)',
  'ROOF_STANDING_SEAM':       'Roof Mount (Standing Seam)',
  'STRING':                   'String Inverter',
  'STRING_OPTIMIZER':         'String + Optimizer',
  'MICRO':                    'Microinverter',
  'HYBRID':                   'Hybrid Inverter',
};