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
}

export interface ElectricalSpecs {
  acOutputKw?: number;
  dcInputKwMax?: number;
  maxDcVoltage?: number;
  acOutputVoltage?: number;
  acOutputCurrentMax?: number;
  maxInputCurrent?: number;
  mpptVoltageMin?: number;
  mpptVoltageMax?: number;
  mpptChannels?: number;
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
      watts: 400, voc: 49.6, vmp: 41.8, isc: 10.18, imp: 9.57,
      maxDcVoltage: 1000, maxSeriesFuseRating: 20,
      tempCoeffVoc: -0.27, tempCoeffIsc: 0.04, efficiency: 20.6,
    },
    requiredAccessories: [],
    compatibilityRules: [],
    notesTemplates: ['Q CELLS Q.PEAK DUO BLK ML-G10+ 400W — mono-PERC, 1000V max, 20A fuse'],
    ulListing: 'UL 61730',
    warranty: '25-year product, 25-year performance',
    weight: 44.1,
    dimensions: '70.9 × 41.7 × 1.38 in',
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
        defaultPartNumber: 'TS4-A-F', necReference: 'NEC 690.12',
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
        defaultPartNumber: 'TS4-A-F', necReference: 'NEC 690.12',
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
        defaultPartNumber: 'TS4-A-F', necReference: 'NEC 690.12',
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
  // RACKING — ROOFTECH RT-MINI (Rail-Less)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'rooftech-rt-mini',
    manufacturer: 'RoofTech',
    model: 'RT-MINI Rail-Less Mount',
    partNumber: 'RT-MINI-01',
    category: 'racking',
    topologyType: 'ROOF_RAIL_LESS',
    mountTopology: 'ROOF_RAIL_LESS',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 150,
      maxSnowLoad: 45,
      railSpanMax: 0,
      attachmentSpacingMax: 48,
      requiresRail: false,
      foundationType: 'lag_bolt',
      minEmbedmentDepth: 2.5,
      upliftCapacityLbs: 800,
      shearCapacityLbs: 600,
      modulesPerAttachment: 0.5,  // 2 mounts per module
      iccEsReport: 'ESR-4575',
      asceEdition: 'ASCE 7-22',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'RT-MINI mount — 4 per module (2 per short side)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'RoofTech', defaultModel: 'RT-MINI Mount Assembly',
        defaultPartNumber: 'RT-MINI-ASSY', necReference: 'ASCE 7-22',
        notes: '4 mounts per module — 2 on each short side',
      },
      {
        category: 'flashing',
        description: 'RT-MINI integrated flashing — 1 per mount (shingle roofs)',
        required: true,
        conditional: 'roofType === shingle',
        quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'RoofTech', defaultModel: 'RT-MINI Flashing Kit',
        defaultPartNumber: 'RT-MINI-FLASH', necReference: 'IBC 2021',
        notes: 'Integrated flashing included with RT-MINI for shingle roofs',
      },
      {
        category: 'lag_bolt',
        description: '5/16" × 3" lag bolt — 1 per mount into rafter',
        required: true, quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'Generic', defaultModel: '5/16" × 3" Lag Bolt SS',
        defaultPartNumber: 'LAG-516-3-SS', necReference: 'ASCE 7-22',
        notes: 'Stainless steel lag bolt, min 2.5" embedment into rafter',
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
      'RoofTech RT-MINI — rail-less direct attachment, 4 mounts per module',
      'ICC-ES ESR-4575, ASCE 7-22 compliant, max 48" attachment spacing',
      'No rail required — direct module-to-roof attachment',
    ],
    iccEsReport: 'ESR-4575',
    warranty: '20-year product',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING — PLP POWER PEAK DRIVEN PILES (Ground Mount)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'plp-power-peak-driven-pile',
    manufacturer: 'PLP (Preformed Line Products)',
    model: 'POWER PEAK Driven Pile System',
    partNumber: 'PP-DRIVEN-PILE-01',
    category: 'racking',
    topologyType: 'GROUND_MOUNT_DRIVEN_PILE',
    mountTopology: 'GROUND_MOUNT_DRIVEN_PILE',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 170,
      maxSnowLoad: 60,
      railSpanMax: 120,
      attachmentSpacingMax: 120,
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
        description: 'POWER PEAK driven pile — 2 per row (front + back post)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'ceil(strings * 2)',
        defaultManufacturer: 'PLP', defaultModel: 'POWER PEAK 2-7/8" OD Pile',
        defaultPartNumber: 'PP-PILE-278-01', necReference: 'ASCE 7-22',
        notes: '2 piles per string row — front and back post. Driven with hydraulic hammer.',
      },
      {
        category: 'rail',
        description: 'POWER PEAK horizontal rail — spans between piles',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'PLP', defaultModel: 'POWER PEAK Rail 20ft',
        defaultPartNumber: 'PP-RAIL-20FT', necReference: 'ASCE 7-22',
        notes: '2 rails per string row (top and bottom chord)',
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
        description: 'Module mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'PLP', defaultModel: 'POWER PEAK Mid Clamp',
        defaultPartNumber: 'PP-MID-CLAMP-01', necReference: 'IBC 2021',
      },
      {
        category: 'end_clamp',
        description: 'Module end clamp — 4 per string (2 rails × 2 ends)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'PLP', defaultModel: 'POWER PEAK End Clamp',
        defaultPartNumber: 'PP-END-CLAMP-01', necReference: 'IBC 2021',
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
      'PLP POWER PEAK — driven pile ground mount, hydraulic installation',
      'ICC-ES ESR-3895, ASCE 7-22 compliant, max 120" pile spacing',
      'No concrete required — driven pile foundation',
      'Underground conduit required for DC home run per NEC 300.5',
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
        defaultPartNumber: 'QM-CLASSIC-1', necReference: 'IBC 2021',
      },
      {
        category: 'rail',
        description: 'XR100 rail — 2 rails per row of modules',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'XR100 Rail 168"',
        defaultPartNumber: 'XR-100-168B', necReference: 'IBC 2021',
        notes: '2 rails per string row, 168" (14ft) standard length',
      },
      {
        category: 'mid_clamp',
        description: 'UFO mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO Mid Clamp',
        defaultPartNumber: 'UFO-MID-01', necReference: 'IBC 2021',
      },
      {
        category: 'end_clamp',
        description: 'UFO end clamp — 4 per string (2 rails × 2 ends)',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO End Clamp',
        defaultPartNumber: 'UFO-END-01', necReference: 'IBC 2021',
      },
      {
        category: 'splice',
        description: 'Rail splice — 1 per rail joint',
        required: false, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'XR100 Splice',
        defaultPartNumber: 'XR-100-SPLICE', necReference: 'IBC 2021',
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
        defaultPartNumber: 'QM-CLASSIC-1', necReference: 'IBC 2021',
      },
      {
        category: 'rail',
        description: 'XR1000 rail — 2 rails per row',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'XR1000 Rail 168"',
        defaultPartNumber: 'XR-1000-168B', necReference: 'IBC 2021',
      },
      {
        category: 'mid_clamp',
        description: 'UFO mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO Mid Clamp',
        defaultPartNumber: 'UFO-MID-01', necReference: 'IBC 2021',
      },
      {
        category: 'end_clamp',
        description: 'UFO end clamp — 4 per string',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO End Clamp',
        defaultPartNumber: 'UFO-END-01', necReference: 'IBC 2021',
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
        defaultPartNumber: 'UFO-MID-01', necReference: 'IBC 2021',
      },
      {
        category: 'end_clamp',
        description: 'Module end clamp — 4 per string',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'IronRidge', defaultModel: 'UFO End Clamp',
        defaultPartNumber: 'UFO-END-01', necReference: 'IBC 2021',
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
    id: 'snapnrack-series-100',
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
        defaultPartNumber: 'QM-CLASSIC-1', necReference: 'IBC 2021',
      },
      {
        category: 'rail',
        description: 'Series 100 rail — 2 rails per row',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'SnapNrack', defaultModel: 'Series 100 Rail 168"',
        defaultPartNumber: 'SNR-100-168', necReference: 'IBC 2021',
      },
      {
        category: 'mid_clamp',
        description: 'Mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'SnapNrack', defaultModel: 'Series 100 Mid Clamp',
        defaultPartNumber: 'SNR-MID-01', necReference: 'IBC 2021',
      },
      {
        category: 'end_clamp',
        description: 'End clamp — 4 per string',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'SnapNrack', defaultModel: 'Series 100 End Clamp',
        defaultPartNumber: 'SNR-END-01', necReference: 'IBC 2021',
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
    id: 'snapnrack-ul-series',
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
        defaultPartNumber: 'SNR-UL-FLASH', necReference: 'IBC 2021',
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
    id: 'unirac-sunframe',
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
        defaultPartNumber: 'QM-CLASSIC-1', necReference: 'IBC 2021',
      },
      {
        category: 'rail',
        description: 'SunFrame rail — 2 rails per row',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 2',
        defaultManufacturer: 'Unirac', defaultModel: 'SunFrame Rail 168"',
        defaultPartNumber: 'UR-SF-168', necReference: 'IBC 2021',
      },
      {
        category: 'mid_clamp',
        description: 'Mid clamp — 2 per interior module',
        required: true, quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'Unirac', defaultModel: 'SunFrame Mid Clamp',
        defaultPartNumber: 'UR-MID-01', necReference: 'IBC 2021',
      },
      {
        category: 'end_clamp',
        description: 'End clamp — 4 per string',
        required: true, quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'Unirac', defaultModel: 'SunFrame End Clamp',
        defaultPartNumber: 'UR-END-01', necReference: 'IBC 2021',
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
    id: 'unirac-rm-ballast',
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
        targetIds: ['ironridge-xr100', 'ironridge-xr1000', 'unirac-sunframe', 'snapnrack-series-100'],
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
    id: 'quickmount-tile-hook',
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
    id: 'ecofasten-rock-it',
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
        defaultPartNumber: 'EF-ROCKIT-FLASH', necReference: 'IBC 2021',
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
    id: 's5-pvkit-2',
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
        defaultPartNumber: 'BUTYL-TAPE-01', necReference: 'IBC 2021',
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
];

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY LOOKUP FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export function getRegistryEntryV4(id: string): EquipmentRegistryEntry | undefined {
  return EQUIPMENT_REGISTRY_V4.find(e => e.id === id);
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