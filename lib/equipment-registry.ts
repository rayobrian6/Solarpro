// ============================================================
// Equipment Intelligence Registry V4
// Brand-agnostic, topology-driven equipment rule system
// Adding a new manufacturer = add JSON entry only. No code changes.
// ============================================================

// ─── Topology Types (expanded) ────────────────────────────────────────────────

export type TopologyType =
  // ── Canonical V4 types ──────────────────────────────────────────────────
  | 'STRING_INVERTER'          // String inverter, no optimizers, no battery
  | 'STRING_WITH_OPTIMIZER'    // String inverter + per-module DC optimizers
  | 'MICROINVERTER'            // AC module topology, one inverter per module
  | 'AC_MODULE'                // Integrated AC module (inverter built into panel)
  | 'HYBRID_INVERTER'          // String inverter with integrated battery port
  | 'DC_COUPLED_BATTERY'       // Battery on DC bus (pre-inverter)
  | 'AC_COUPLED_BATTERY'       // Battery on AC bus (post-inverter)
  | 'GROUND_MOUNT_FIXED_TILT'  // Ground mount, fixed tilt racking
  | 'GROUND_MOUNT_DRIVEN_PILE' // Ground mount, driven pile foundation
  | 'ROOF_RAIL_BASED'          // Roof mount with rails (IronRidge, Unirac, etc.)
  | 'ROOF_RAIL_LESS'           // Rail-less roof mount (Ecofasten, S-5, etc.)
  // ── Legacy aliases (V3 backward compatibility) ──────────────────────────
  | 'STRING'                   // → STRING_INVERTER
  | 'STRING_OPTIMIZER'         // → STRING_WITH_OPTIMIZER
  | 'MICRO'                    // → MICROINVERTER
  | 'HYBRID';                  // → HYBRID_INVERTER

// ─── Accessory Rule ───────────────────────────────────────────────────────────

export type AccessoryQuantityRule =
  | 'perModule'      // 1 per PV module
  | 'perString'      // 1 per DC string
  | 'perInverter'    // 1 per inverter unit
  | 'perSystem'      // 1 per entire system
  | 'perBranch'      // 1 per AC branch circuit (microinverter topology)
  | 'perRailSection' // 1 per rail section (structural)
  | 'perAttachment'  // 1 per roof attachment point
  | 'perKw'          // 1 per kW of system capacity
  | 'formula';       // custom formula string (evaluated at runtime)

export interface AccessoryRule {
  category: string;           // 'optimizer' | 'gateway' | 'trunk_cable' | etc.
  description: string;        // human-readable description
  required: boolean;          // hard requirement vs optional
  conditional?: string;       // condition expression (e.g. 'strings > 1')
  quantityRule: AccessoryQuantityRule;
  quantityFormula?: string;   // for 'formula' type: e.g. 'ceil(modules / 16)'
  quantityMultiplier?: number;// for simple multipliers (e.g. 2 terminators per branch)
  defaultModel?: string;      // suggested model if not specified
  defaultManufacturer?: string;
  defaultPartNumber?: string;
  necReference?: string;
  notes?: string;
}

// ─── Compatibility Rule ───────────────────────────────────────────────────────

export interface CompatibilityRule {
  type: 'requires' | 'excludes' | 'recommends';
  targetCategory: string;     // category of equipment this rule applies to
  targetIds?: string[];       // specific equipment IDs (empty = any in category)
  reason: string;
}

// ─── Wire Sizing Constraint ───────────────────────────────────────────────────

export interface WireSizingConstraint {
  minGauge: string;           // e.g. '#10 AWG'
  maxGauge: string;
  wireType: string;           // 'USE-2' | 'THWN-2' | 'PV Wire'
  conduitRequired: boolean;
  necReference: string;
}

// ─── Equipment Registry Entry ─────────────────────────────────────────────────

export interface EquipmentRegistryEntry {
  id: string;
  manufacturer: string;
  model: string;
  category: 'string_inverter' | 'microinverter' | 'optimizer' | 'solar_panel'
          | 'racking' | 'battery' | 'gateway' | 'combiner' | 'disconnect'
          | 'trunk_cable' | 'terminator' | 'rapid_shutdown' | 'ac_module';

  // Topology this equipment drives when selected as primary
  topologyType: TopologyType;

  // Mount topology (set on racking entries)
  mountTopology?: TopologyType;

  // Electrical specs (normalized)
  electricalSpecs: {
    acOutputKw?: number;
    dcInputKwMax?: number;
    maxDcVoltage?: number;
    acOutputVoltage?: number;
    acOutputCurrentMax?: number;
    maxInputCurrent?: number;
    efficiency?: number;
    mpptChannels?: number;
    rapidShutdownCompliant?: boolean;
    arcFaultProtection?: boolean;
  };

  // Structural specs (for racking)
  structuralSpecs?: {
    maxWindSpeed?: number;
    maxSnowLoad?: number;
    railSpanMax?: number;
    attachmentSpacingMax?: number;
    requiresRail?: boolean;
    foundationType?: 'lag_bolt' | 'driven_pile' | 'ballast' | 'clamp';
    // PHASE 4: Discrete load model fields (Roof Tech Mini and similar)
    loadModel?: 'distributed' | 'discrete';   // 'distributed' = IronRidge default; 'discrete' = per-attachment
    fastenersPerAttachment?: number;           // lag bolts per attachment point (discrete model)
    upliftCapacity?: number;                   // lbf per fastener (from ICC-ES report)
    tributaryArea?: number;                    // ft² per attachment point
  };

  // Required accessories — drives propagation engine
  requiredAccessories: AccessoryRule[];

  // Compatibility rules
  compatibilityRules: CompatibilityRule[];

  // Wire sizing constraints
  wireSizingConstraints?: WireSizingConstraint;

  // OCPD defaults
  defaultOCPDRanges?: {
    dcStringOCPD?: { min: number; max: number };
    acOutputOCPD?: { min: number; max: number };
  };

  // Mounting compatibility
  mountingCompatibility?: string[];  // racking IDs this inverter works with

  // Notes templates for permit package
  notesTemplates?: string[];

  // Metadata
  datasheetUrl?: string;
  ulListing?: string;
  warranty?: string;
}

// ─── Equipment Registry ───────────────────────────────────────────────────────

export const EQUIPMENT_REGISTRY: EquipmentRegistryEntry[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // STRING INVERTERS — no optimizer
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'fronius-primo-8.2',
    manufacturer: 'Fronius',
    model: 'Primo 8.2-1',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 8.2, dcInputKwMax: 12.3, maxDcVoltage: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 34.2,
      efficiency: 97.6, mpptChannels: 2,
      rapidShutdownCompliant: false, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'dc_disconnect',
        description: 'DC disconnect switch per NEC 690.15',
        required: true,
        quantityRule: 'perInverter',
        defaultManufacturer: 'Square D',
        defaultModel: '30A DC Disconnect',
        defaultPartNumber: 'DU30RB',
        necReference: 'NEC 690.15',
      },
      {
        category: 'rapid_shutdown',
        description: 'Rapid shutdown device per NEC 690.12',
        required: true,
        quantityRule: 'perModule',
        defaultManufacturer: 'Tigo',
        defaultModel: 'TS4-A-F Rapid Shutdown',
        defaultPartNumber: 'TS4-A-F',
        necReference: 'NEC 690.12',
      },
      {
        category: 'monitoring',
        description: 'System monitoring (optional but recommended)',
        required: false,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Fronius',
        defaultModel: 'Datamanager 2.0',
        defaultPartNumber: '4,240,004',
        notes: 'Included in inverter for Fronius Primo',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'String inverter topology — optimizers not required' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 40, max: 50 } },
    notesTemplates: ['Fronius Primo 8.2-1 — 2 MPPT, 600V max DC, 240V AC output'],
  },

  {
    id: 'sma-sunny-boy-7.7',
    manufacturer: 'SMA',
    model: 'Sunny Boy 7.7-US',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 7.7, dcInputKwMax: 11.55, maxDcVoltage: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 32.1,
      efficiency: 97.0, mpptChannels: 2,
      rapidShutdownCompliant: false, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'dc_disconnect',
        description: 'DC disconnect switch per NEC 690.15',
        required: true,
        quantityRule: 'perInverter',
        defaultManufacturer: 'Square D',
        defaultModel: '30A DC Disconnect',
        defaultPartNumber: 'DU30RB',
        necReference: 'NEC 690.15',
      },
      {
        category: 'rapid_shutdown',
        description: 'Rapid shutdown device per NEC 690.12',
        required: true,
        quantityRule: 'perModule',
        defaultManufacturer: 'Tigo',
        defaultModel: 'TS4-A-F Rapid Shutdown',
        defaultPartNumber: 'TS4-A-F',
        necReference: 'NEC 690.12',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'String inverter topology' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 40, max: 50 } },
    notesTemplates: ['SMA Sunny Boy 7.7-US — 2 MPPT, 600V max DC, SMA ShadeFix included'],
  },

  {
    id: 'sungrow-sg8k-d',
    manufacturer: 'Sungrow',
    model: 'SG8K-D',
    category: 'string_inverter',
    topologyType: 'STRING_INVERTER',
    electricalSpecs: {
      acOutputKw: 8.0, dcInputKwMax: 12.0, maxDcVoltage: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 33.3,
      efficiency: 97.5, mpptChannels: 2,
      rapidShutdownCompliant: false, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'dc_disconnect',
        description: 'DC disconnect switch per NEC 690.15',
        required: true,
        quantityRule: 'perInverter',
        defaultManufacturer: 'Square D',
        defaultModel: '30A DC Disconnect',
        defaultPartNumber: 'DU30RB',
        necReference: 'NEC 690.15',
      },
      {
        category: 'rapid_shutdown',
        description: 'Rapid shutdown device per NEC 690.12',
        required: true,
        quantityRule: 'perModule',
        defaultManufacturer: 'Tigo',
        defaultModel: 'TS4-A-F Rapid Shutdown',
        defaultPartNumber: 'TS4-A-F',
        necReference: 'NEC 690.12',
      },
    ],
    compatibilityRules: [],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 40, max: 50 } },
    notesTemplates: ['Sungrow SG8K-D — 2 MPPT, 600V max DC, built-in DC switch'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // STRING INVERTERS WITH OPTIMIZER (SolarEdge-style topology)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'se-7600h',
    manufacturer: 'SolarEdge',
    model: 'SE7600H-US',
    category: 'string_inverter',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      acOutputKw: 7.6, dcInputKwMax: 11.4, maxDcVoltage: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 32.0,
      efficiency: 99.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'optimizer',
        description: 'DC power optimizer — 1 per module (SolarEdge topology requirement)',
        required: true,
        quantityRule: 'perModule',
        defaultManufacturer: 'SolarEdge',
        defaultModel: 'P401 Power Optimizer',
        defaultPartNumber: 'P401-5R2MRM',
        necReference: 'NEC 690.8',
        notes: 'SolarEdge inverters require optimizers on every module',
      },
      {
        category: 'gateway',
        description: 'Monitoring gateway for optimizer communication',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge',
        defaultModel: 'Energy Hub Gateway',
        defaultPartNumber: 'SEG-HUB-1',
        necReference: 'NEC 690.4',
      },
      {
        category: 'dc_disconnect',
        description: 'DC safety switch per NEC 690.15',
        required: true,
        quantityRule: 'perInverter',
        defaultManufacturer: 'SolarEdge',
        defaultModel: 'DC Safety Switch',
        defaultPartNumber: 'SE-DCSS-1',
        necReference: 'NEC 690.15',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'optimizer', targetIds: ['se-p401', 'se-p505', 'se-p730', 'se-p850'],
        reason: 'SolarEdge inverters require SolarEdge optimizers for HD-Wave topology' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 40, max: 50 } },
    notesTemplates: ['SolarEdge SE7600H-US — HD-Wave, 1 MPPT, 480V max DC, optimizer required per module'],
  },

  {
    id: 'se-10000h',
    manufacturer: 'SolarEdge',
    model: 'SE10000H-US',
    category: 'string_inverter',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 15.0, maxDcVoltage: 480,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 99.0, mpptChannels: 1,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'optimizer',
        description: 'DC power optimizer — 1 per module',
        required: true,
        quantityRule: 'perModule',
        defaultManufacturer: 'SolarEdge',
        defaultModel: 'P401 Power Optimizer',
        defaultPartNumber: 'P401-5R2MRM',
        necReference: 'NEC 690.8',
      },
      {
        category: 'gateway',
        description: 'Monitoring gateway',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge',
        defaultModel: 'Energy Hub Gateway',
        defaultPartNumber: 'SEG-HUB-1',
        necReference: 'NEC 690.4',
      },
      {
        category: 'dc_disconnect',
        description: 'DC safety switch per NEC 690.15',
        required: true,
        quantityRule: 'perInverter',
        defaultManufacturer: 'SolarEdge',
        defaultModel: 'DC Safety Switch',
        defaultPartNumber: 'SE-DCSS-1',
        necReference: 'NEC 690.15',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'optimizer',
        reason: 'SolarEdge inverters require SolarEdge optimizers' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['SolarEdge SE10000H-US — HD-Wave, 1 MPPT, 480V max DC'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MICROINVERTERS
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'enphase-iq8plus',
    manufacturer: 'Enphase',
    model: 'IQ8+ Microinverter',
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
        description: 'Q-Cable trunk cable — connects microinverters on AC branch',
        required: true,
        quantityRule: 'formula',
        quantityFormula: 'ceil(modules / 16)',
        defaultManufacturer: 'Enphase',
        defaultModel: 'Q Cable 240V',
        defaultPartNumber: 'Q-12-10-240',
        necReference: 'NEC 690.31',
        notes: '1 trunk cable section per 16 modules',
      },
      {
        category: 'terminator',
        description: 'Q-Cable terminator — 2 per trunk cable (start and end)',
        required: true,
        quantityRule: 'formula',
        quantityFormula: 'ceil(modules / 16) * 2',
        defaultManufacturer: 'Enphase',
        defaultModel: 'Q Cable Terminator',
        defaultPartNumber: 'Q-TERM-10-240',
        necReference: 'NEC 690.31',
      },
      {
        category: 'gateway',
        description: 'IQ Gateway — system monitoring and communication hub',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase',
        defaultModel: 'IQ Gateway Standard',
        defaultPartNumber: 'ENV-IQ-AM1-240',
        necReference: 'NEC 690.4',
      },
      {
        category: 'combiner',
        description: 'IQ Combiner — aggregates AC branch circuits',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase',
        defaultModel: 'IQ Combiner 4C',
        defaultPartNumber: 'ENV-IQ-C4C-240',
        necReference: 'NEC 690.4',
      },
      {
        category: 'ac_disconnect',
        description: 'AC disconnect sized for total AC output per NEC 690.14',
        required: true,
        quantityRule: 'perSystem',
        quantityFormula: 'ceil(modules * 1.21 * 1.25 / 10) * 10',
        defaultManufacturer: 'Square D',
        defaultModel: 'AC Disconnect Switch',
        defaultPartNumber: 'DU30RB',
        necReference: 'NEC 690.14',
        notes: 'Size = modules × 1.21A × 125%, rounded to next 10A',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology — no DC optimizers needed' },
      { type: 'excludes', targetCategory: 'dc_disconnect', reason: 'Microinverter topology — no DC string disconnect' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 30 } },
    notesTemplates: [
      'Enphase IQ8+ — AC branch topology, 1 microinverter per module',
      'Rapid shutdown integrated per NEC 690.12',
    ],
  },

  {
    id: 'enphase-iq8m',
    manufacturer: 'Enphase',
    model: 'IQ8M Microinverter',
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
        required: true,
        quantityRule: 'formula',
        quantityFormula: 'ceil(modules / 16)',
        defaultManufacturer: 'Enphase',
        defaultModel: 'Q Cable 240V',
        defaultPartNumber: 'Q-12-10-240',
        necReference: 'NEC 690.31',
      },
      {
        category: 'terminator',
        description: 'Q-Cable terminator — 2 per trunk section',
        required: true,
        quantityRule: 'formula',
        quantityFormula: 'ceil(modules / 16) * 2',
        defaultManufacturer: 'Enphase',
        defaultModel: 'Q Cable Terminator',
        defaultPartNumber: 'Q-TERM-10-240',
        necReference: 'NEC 690.31',
      },
      {
        category: 'gateway',
        description: 'IQ Gateway Standard',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase',
        defaultModel: 'IQ Gateway Standard',
        defaultPartNumber: 'ENV-IQ-AM1-240',
        necReference: 'NEC 690.4',
      },
      {
        category: 'combiner',
        description: 'IQ Combiner 4C',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase',
        defaultModel: 'IQ Combiner 4C',
        defaultPartNumber: 'ENV-IQ-C4C-240',
        necReference: 'NEC 690.4',
      },
      {
        category: 'ac_disconnect',
        description: 'AC disconnect sized for total AC output',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Square D',
        defaultModel: 'AC Disconnect Switch',
        defaultPartNumber: 'DU30RB',
        necReference: 'NEC 690.14',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 30 } },
    notesTemplates: ['Enphase IQ8M — high-power microinverter, AC branch topology'],
  },

  {
    id: 'apsystems-qs1',
    manufacturer: 'APsystems',
    model: 'QS1 Microinverter',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.320, dcInputKwMax: 0.480, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 1.33,
      efficiency: 96.5, mpptChannels: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'ECU-R communication gateway',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'APsystems',
        defaultModel: 'ECU-R Gateway',
        defaultPartNumber: 'ECU-R',
        necReference: 'NEC 690.4',
      },
      {
        category: 'ac_disconnect',
        description: 'AC disconnect per NEC 690.14',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Square D',
        defaultModel: 'AC Disconnect Switch',
        defaultPartNumber: 'DU30RB',
        necReference: 'NEC 690.14',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 30 } },
    notesTemplates: ['APsystems QS1 — quad-module microinverter, ECU-R gateway required'],
  },

  {
    id: 'hoymiles-hm-600',
    manufacturer: 'Hoymiles',
    model: 'HM-600 Microinverter',
    category: 'microinverter',
    topologyType: 'MICROINVERTER',
    electricalSpecs: {
      acOutputKw: 0.600, dcInputKwMax: 0.800, maxDcVoltage: 60,
      acOutputVoltage: 240, acOutputCurrentMax: 2.5,
      efficiency: 96.7, mpptChannels: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'DTU-Pro communication gateway',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Hoymiles',
        defaultModel: 'DTU-Pro Gateway',
        defaultPartNumber: 'DTU-PRO',
        necReference: 'NEC 690.4',
      },
      {
        category: 'ac_disconnect',
        description: 'AC disconnect per NEC 690.14',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Square D',
        defaultModel: 'AC Disconnect Switch',
        defaultPartNumber: 'DU30RB',
        necReference: 'NEC 690.14',
      },
    ],
    compatibilityRules: [
      { type: 'excludes', targetCategory: 'optimizer', reason: 'Microinverter topology' },
    ],
    defaultOCPDRanges: { acOutputOCPD: { min: 20, max: 30 } },
    notesTemplates: ['Hoymiles HM-600 — dual-module microinverter, DTU-Pro gateway required'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HYBRID INVERTERS
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'solaredge-hub-10kw',
    manufacturer: 'SolarEdge',
    model: 'Energy Hub 10kW',
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
        required: true,
        quantityRule: 'perModule',
        defaultManufacturer: 'SolarEdge',
        defaultModel: 'P401 Power Optimizer',
        defaultPartNumber: 'P401-5R2MRM',
        necReference: 'NEC 690.8',
      },
      {
        category: 'battery',
        description: 'DC-coupled battery storage',
        required: false,
        quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge',
        defaultModel: 'Home Battery 10kWh',
        defaultPartNumber: 'SEHB-10K',
        notes: 'Optional battery — enables DC_COUPLED_BATTERY topology',
      },
      {
        category: 'gateway',
        description: 'Energy Hub monitoring gateway',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'SolarEdge',
        defaultModel: 'Energy Hub Gateway',
        defaultPartNumber: 'SEG-HUB-1',
        necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'optimizer', reason: 'SolarEdge topology requires optimizers' },
    ],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['SolarEdge Energy Hub 10kW — hybrid inverter with battery port'],
  },

  {
    id: 'enphase-iq8-battery',
    manufacturer: 'Enphase',
    model: 'IQ Battery 5P',
    category: 'battery',
    topologyType: 'AC_COUPLED_BATTERY',
    electricalSpecs: {
      acOutputKw: 3.84, acOutputVoltage: 240, acOutputCurrentMax: 16.0,
      efficiency: 89.0,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'IQ Gateway required for battery management',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Enphase',
        defaultModel: 'IQ Gateway Standard',
        defaultPartNumber: 'ENV-IQ-AM1-240',
        necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'requires', targetCategory: 'gateway', reason: 'IQ Gateway required for Enphase battery' },
    ],
    notesTemplates: ['Enphase IQ Battery 5P — AC-coupled, 5kWh usable, IQ Gateway required'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // OPTIMIZERS
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'se-p401',
    manufacturer: 'SolarEdge',
    model: 'P401 Power Optimizer',
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
    notesTemplates: ['SolarEdge P401 — 400W optimizer, compatible with SE HD-Wave inverters'],
  },

  {
    id: 'se-p505',
    manufacturer: 'SolarEdge',
    model: 'P505 Power Optimizer',
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
    category: 'optimizer',
    topologyType: 'STRING_WITH_OPTIMIZER',
    electricalSpecs: {
      dcInputKwMax: 0.700, maxDcVoltage: 80, maxInputCurrent: 15.0, efficiency: 99.5,
    },
    requiredAccessories: [
      {
        category: 'gateway',
        description: 'Tigo Cloud Connect Advanced gateway',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Tigo',
        defaultModel: 'Cloud Connect Advanced',
        defaultPartNumber: 'TAP-CCAGW-01',
        necReference: 'NEC 690.4',
      },
    ],
    compatibilityRules: [
      { type: 'recommends', targetCategory: 'string_inverter',
        reason: 'Tigo optimizers are brand-agnostic — work with any string inverter' },
    ],
    notesTemplates: ['Tigo TS4-A-O — brand-agnostic optimizer, works with any string inverter'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RACKING SYSTEMS
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'ironridge-xr100',
    manufacturer: 'IronRidge',
    model: 'XR100 Rail System',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 160, maxSnowLoad: 50,
      railSpanMax: 72, attachmentSpacingMax: 72,
      requiresRail: true, foundationType: 'lag_bolt',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'L-foot with lag bolt — 1 per attachment point',
        required: true,
        quantityRule: 'perAttachment',
        defaultManufacturer: 'IronRidge',
        defaultModel: 'L-Foot with Lag Bolt',
        defaultPartNumber: 'LFT-001-B',
        necReference: 'ASCE 7-22',
      },
      {
        category: 'flashing',
        description: 'Roof flashing — 1 per attachment (shingle/tile roofs)',
        required: true,
        conditional: 'roofType === shingle || roofType === tile',
        quantityRule: 'perAttachment',
        defaultManufacturer: 'QuickMount PV',
        defaultModel: 'Classic Mount Flashing',
        defaultPartNumber: 'QM-CLASSIC-1',
        necReference: 'IBC 2021',
      },
      {
        category: 'mid_clamp',
        description: 'Mid clamp — 2 per interior module',
        required: true,
        quantityRule: 'formula',
        quantityFormula: '(modules - strings) * 2',
        defaultManufacturer: 'IronRidge',
        defaultModel: 'UFO Mid Clamp',
        defaultPartNumber: 'UFO-MID-01',
        necReference: 'IBC 2021',
      },
      {
        category: 'end_clamp',
        description: 'End clamp — 4 per string (2 rails × 2 ends)',
        required: true,
        quantityRule: 'formula',
        quantityFormula: 'strings * 4',
        defaultManufacturer: 'IronRidge',
        defaultModel: 'UFO End Clamp',
        defaultPartNumber: 'UFO-END-01',
        necReference: 'IBC 2021',
      },
    ],
    compatibilityRules: [],
    notesTemplates: ['IronRidge XR100 — rail-based roof mount, max 72" attachment spacing'],
  },

  {
    id: 'unirac-sunframe',
    manufacturer: 'Unirac',
    model: 'SunFrame Rail System',
    category: 'racking',
    topologyType: 'ROOF_RAIL_BASED',
    mountTopology: 'ROOF_RAIL_BASED',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 150, maxSnowLoad: 45,
      railSpanMax: 72, attachmentSpacingMax: 72,
      requiresRail: true, foundationType: 'lag_bolt',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'Roof hook / L-foot — 1 per attachment point',
        required: true,
        quantityRule: 'perAttachment',
        defaultManufacturer: 'Unirac',
        defaultModel: 'Roof Hook Assembly',
        defaultPartNumber: 'UR-HOOK-01',
        necReference: 'ASCE 7-22',
      },
      {
        category: 'flashing',
        description: 'Roof flashing — 1 per attachment',
        required: true,
        conditional: 'roofType === shingle || roofType === tile',
        quantityRule: 'perAttachment',
        defaultManufacturer: 'QuickMount PV',
        defaultModel: 'Classic Mount Flashing',
        defaultPartNumber: 'QM-CLASSIC-1',
        necReference: 'IBC 2021',
      },
    ],
    compatibilityRules: [],
    notesTemplates: ['Unirac SunFrame — rail-based roof mount system'],
  },

  {
    id: 'ecofasten-rock-it',
    manufacturer: 'EcoFasten',
    model: 'Rock-It Rail-Less',
    category: 'racking',
    topologyType: 'ROOF_RAIL_LESS',
    mountTopology: 'ROOF_RAIL_LESS',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 140, maxSnowLoad: 40,
      railSpanMax: 0, attachmentSpacingMax: 48,
      requiresRail: false, foundationType: 'lag_bolt',
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'Rock-It mount — 4 per module (direct attachment)',
        required: true,
        quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'EcoFasten',
        defaultModel: 'Rock-It Mount',
        defaultPartNumber: 'EF-ROCKIT-01',
        necReference: 'ASCE 7-22',
      },
      {
        category: 'flashing',
        description: 'Integrated flashing — included with Rock-It mount',
        required: true,
        conditional: 'roofType === shingle',
        quantityRule: 'formula',
        quantityFormula: 'modules * 4',
        defaultManufacturer: 'EcoFasten',
        defaultModel: 'Rock-It Flashing',
        defaultPartNumber: 'EF-FLASH-01',
        necReference: 'IBC 2021',
      },
    ],
    compatibilityRules: [],
    notesTemplates: ['EcoFasten Rock-It — rail-less direct attachment, 4 mounts per module'],
  },

  {
    id: 'ironridge-gft',
    manufacturer: 'IronRidge',
    model: 'GFT Ground Mount',
    category: 'racking',
    topologyType: 'GROUND_MOUNT_FIXED_TILT',
    mountTopology: 'GROUND_MOUNT_FIXED_TILT',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 160, maxSnowLoad: 50,
      railSpanMax: 96, attachmentSpacingMax: 96,
      requiresRail: true, foundationType: 'driven_pile',
    },
    requiredAccessories: [
      {
        category: 'driven_pile',
        description: 'Driven pile foundation — 1 per post location',
        required: true,
        quantityRule: 'formula',
        quantityFormula: 'ceil(strings * 2)',
        defaultManufacturer: 'IronRidge',
        defaultModel: '2-3/8" OD Driven Pile',
        defaultPartNumber: 'GFT-PILE-01',
        necReference: 'ASCE 7-22',
        notes: '2 piles per string row (front and back)',
      },
      {
        category: 'grounding',
        description: 'Ground mount grounding electrode',
        required: true,
        quantityRule: 'perSystem',
        defaultManufacturer: 'Erico',
        defaultModel: '5/8" × 8ft Ground Rod',
        defaultPartNumber: 'ERITECH-615800',
        necReference: 'NEC 250.52',
      },
    ],
    compatibilityRules: [],
    notesTemplates: ['IronRidge GFT — ground mount fixed tilt, driven pile foundation'],
  },

  {
    id: 'terrasmart-glide',
    manufacturer: 'TerraSmart',
    model: 'GLIDE Ground Mount',
    category: 'racking',
    topologyType: 'GROUND_MOUNT_DRIVEN_PILE',
    mountTopology: 'GROUND_MOUNT_DRIVEN_PILE',
    electricalSpecs: {},
    structuralSpecs: {
      maxWindSpeed: 170, maxSnowLoad: 60,
      railSpanMax: 120, attachmentSpacingMax: 120,
      requiresRail: true, foundationType: 'driven_pile',
    },
    requiredAccessories: [
      {
        category: 'driven_pile',
        description: 'Helical pile — 1 per post location',
        required: true,
        quantityRule: 'formula',
        quantityFormula: 'ceil(strings * 2)',
        defaultManufacturer: 'TerraSmart',
        defaultModel: 'Helical Pile Assembly',
        defaultPartNumber: 'TS-PILE-01',
        necReference: 'ASCE 7-22',
      },
    ],
    compatibilityRules: [],
    notesTemplates: ['TerraSmart GLIDE — driven pile ground mount, helical pile foundation'],
  },

  // ── PHASE 4: Roof Tech Mini ──────────────────────────────────────────────────
  {
    id: 'rooftech-mini',
    manufacturer: 'Roof Tech',
    model: 'RT-MINI Rail-Less Mount',
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
      // Discrete load model: each attachment point is independently evaluated
      loadModel: 'discrete',
      fastenersPerAttachment: 2,    // 2 lag bolts per RT-MINI foot
      upliftCapacity: 450,          // lbf per lag bolt (ICC-ES ESR-3575)
      tributaryArea: 8.5,           // ft² per attachment point
    },
    requiredAccessories: [
      {
        category: 'attachment',
        description: 'RT-MINI mount — 2 per module (direct attachment, no rail)',
        required: true,
        quantityRule: 'formula',
        quantityFormula: 'modules * 2',
        defaultManufacturer: 'Roof Tech',
        defaultModel: 'RT-MINI Mount',
        defaultPartNumber: 'RT-MINI-01',
        necReference: 'ASCE 7-22 / ICC-ES ESR-3575',
      },
      {
        category: 'flashing',
        description: 'Integrated EPDM flashing — included with RT-MINI (shingle roofs)',
        required: true,
        conditional: 'roofType === shingle',
        quantityRule: 'formula',
        quantityFormula: 'modules * 2',
        defaultManufacturer: 'Roof Tech',
        defaultModel: 'RT-MINI Flashing Kit',
        defaultPartNumber: 'RT-MINI-FLASH-01',
        necReference: 'IBC 2021',
      },
    ],
    compatibilityRules: [],
    notesTemplates: [
      'Roof Tech RT-MINI — rail-less direct attachment, 2 mounts per module',
      'Discrete load model: uplift evaluated per attachment point (2 lag bolts × 450 lbf each)',
      'ICC-ES ESR-3575 — 150 mph wind, 45 psf snow',
    ],
  },
];

// ─── Registry Lookup Functions ────────────────────────────────────────────────

/**
 * Get registry entry by equipment ID
 */
export function getRegistryEntry(id: string): EquipmentRegistryEntry | undefined {
  return EQUIPMENT_REGISTRY.find(e => e.id === id);
}

/**
 * Get topology type for a given equipment ID
 */
export function getTopologyForEquipment(id: string): TopologyType | undefined {
  return getRegistryEntry(id)?.topologyType;
}

/**
 * Get all required accessories for a given equipment ID
 */
export function getRequiredAccessories(id: string): AccessoryRule[] {
  return getRegistryEntry(id)?.requiredAccessories ?? [];
}

/**
 * Get all entries by category
 */
export function getEntriesByCategory(category: EquipmentRegistryEntry['category']): EquipmentRegistryEntry[] {
  return EQUIPMENT_REGISTRY.filter(e => e.category === category);
}

/**
 * Get all entries by topology type
 */
export function getEntriesByTopology(topology: TopologyType): EquipmentRegistryEntry[] {
  return EQUIPMENT_REGISTRY.filter(e => e.topologyType === topology);
}

/**
 * Check if two equipment items are compatible
 */
export function checkCompatibility(
  primaryId: string,
  secondaryId: string
): { compatible: boolean; reason?: string } {
  const primary = getRegistryEntry(primaryId);
  if (!primary) return { compatible: false, reason: `Equipment ${primaryId} not found in registry` };

  const secondary = getRegistryEntry(secondaryId);
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

/**
 * Evaluate a quantity formula given context variables
 */
export function evaluateQuantityFormula(
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
  // Safe formula evaluation — only allow math operations and context variables
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