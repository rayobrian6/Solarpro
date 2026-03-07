// ============================================================
// Topology Manager V4
// Rules-driven accessory class resolution from topologyType.
// NO brand-specific conditionals. NO hardcoded equipment names.
// Adding a new topology = add one entry to TOPOLOGY_RULES map.
// ============================================================

import {
  TopologyType,
  normalizeTopologyV4,
  TOPOLOGY_LABELS_V4,
  getRegistryEntryV4,
  getRequiredAccessoriesV4,
  evaluateQuantityFormulaV4,
  EquipmentRegistryEntry,
  AccessoryRule,
} from './equipment-registry-v4';

// ─── Accessory Class Definition ──────────────────────────────────────────────

export interface AccessoryClass {
  category: string;
  label: string;
  required: boolean;
  necReference?: string;
  notes?: string;
}

// ─── Topology Rule Set ────────────────────────────────────────────────────────
// Each topology maps to a set of required and optional accessory classes.
// This is the ONLY place topology-to-accessory logic lives.

export interface TopologyRuleSet {
  label: string;
  description: string;
  requiredAccessoryClasses: AccessoryClass[];
  optionalAccessoryClasses: AccessoryClass[];
  sldStages: SLDStageDefinition[];
  bomStages: BOMStageDefinition[];
  complianceChecks: ComplianceCheckDefinition[];
}

export interface SLDStageDefinition {
  id: string;
  label: string;
  order: number;
  color: string;
  components: string[];  // component type IDs
}

export interface BOMStageDefinition {
  id: string;
  label: string;
  order: number;
  categories: string[];  // equipment categories included in this stage
}

export interface ComplianceCheckDefinition {
  ruleId: string;
  necReference: string;
  description: string;
  autoSatisfiedBy?: string[];  // topology types that auto-satisfy this rule
}

// ─── Topology Rules Map ───────────────────────────────────────────────────────

export const TOPOLOGY_RULES: Record<string, TopologyRuleSet> = {

  STRING_INVERTER: {
    label: 'String Inverter',
    description: 'DC strings → string inverter → AC output. Requires DC disconnect and rapid shutdown.',
    requiredAccessoryClasses: [
      { category: 'dc_disconnect',  label: 'DC Disconnect Switch',    required: true,  necReference: 'NEC 690.15' },
      { category: 'rapid_shutdown', label: 'Rapid Shutdown Device',   required: true,  necReference: 'NEC 690.12' },
      { category: 'ac_disconnect',  label: 'AC Disconnect Switch',    required: true,  necReference: 'NEC 690.14' },
      { category: 'grounding',      label: 'System Grounding',        required: true,  necReference: 'NEC 690.43' },
      { category: 'arc_fault',      label: 'Arc Fault Protection',    required: true,  necReference: 'NEC 690.11' },
    ],
    optionalAccessoryClasses: [
      { category: 'optimizer',      label: 'DC Power Optimizer',      required: false, notes: 'Optional — upgrades to STRING_WITH_OPTIMIZER topology' },
      { category: 'combiner',       label: 'DC Combiner Box',         required: false, notes: 'Required if >2 strings in parallel' },
      { category: 'monitoring',     label: 'System Monitoring',       required: false, notes: 'Recommended for production tracking' },
    ],
    sldStages: [
      { id: 'array',    label: 'Stage 1 — PV Array',        order: 1, color: '#B87000', components: ['pv_module', 'string_wiring'] },
      { id: 'dc',       label: 'Stage 2 — DC Conductors',   order: 2, color: '#CC2200', components: ['dc_disconnect', 'rapid_shutdown', 'dc_ocpd'] },
      { id: 'inverter', label: 'Stage 3 — Inverter',        order: 3, color: '#003399', components: ['string_inverter'] },
      { id: 'ac',       label: 'Stage 4 — AC Conductors',   order: 4, color: '#0055AA', components: ['ac_disconnect', 'ac_ocpd', 'ac_wiring'] },
      { id: 'utility',  label: 'Stage 5 — Utility',         order: 5, color: '#5500BB', components: ['main_panel', 'utility_meter'] },
    ],
    bomStages: [
      { id: 'array',      label: 'Stage 1 — Array',      order: 1, categories: ['solar_panel'] },
      { id: 'dc',         label: 'Stage 2 — DC',         order: 2, categories: ['dc_disconnect', 'rapid_shutdown', 'wire', 'conduit'] },
      { id: 'inverter',   label: 'Stage 3 — Inverter',   order: 3, categories: ['string_inverter', 'optimizer'] },
      { id: 'ac',         label: 'Stage 4 — AC',         order: 4, categories: ['ac_disconnect', 'meter'] },
      { id: 'structural', label: 'Stage 5 — Structural', order: 5, categories: ['racking', 'attachment', 'flashing', 'lag_bolt'] },
      { id: 'monitoring', label: 'Stage 6 — Monitoring', order: 6, categories: ['gateway', 'monitoring'] },
      { id: 'labels',     label: 'Stage 7 — Labels',     order: 7, categories: ['label'] },
    ],
    complianceChecks: [
      { ruleId: 'NEC_690_12_RSD',     necReference: 'NEC 690.12',  description: 'Rapid shutdown required for rooftop PV' },
      { ruleId: 'NEC_690_15_DC_DISC', necReference: 'NEC 690.15',  description: 'DC disconnect required' },
      { ruleId: 'NEC_690_14_AC_DISC', necReference: 'NEC 690.14',  description: 'AC disconnect required' },
      { ruleId: 'NEC_690_11_AFCI',    necReference: 'NEC 690.11',  description: 'Arc fault circuit interrupter required' },
    ],
  },

  STRING_WITH_OPTIMIZER: {
    label: 'String + Optimizer',
    description: 'DC optimizers on each module → string inverter → AC output. RSD integrated in optimizers.',
    requiredAccessoryClasses: [
      { category: 'optimizer',      label: 'DC Power Optimizer (per module)', required: true,  necReference: 'NEC 690.8' },
      { category: 'gateway',        label: 'Optimizer Gateway/Monitor',       required: true,  necReference: 'NEC 690.4' },
      { category: 'dc_disconnect',  label: 'DC Disconnect Switch',            required: true,  necReference: 'NEC 690.15' },
      { category: 'ac_disconnect',  label: 'AC Disconnect Switch',            required: true,  necReference: 'NEC 690.14' },
      { category: 'grounding',      label: 'System Grounding',                required: true,  necReference: 'NEC 690.43' },
    ],
    optionalAccessoryClasses: [
      { category: 'combiner',       label: 'DC Combiner Box',                 required: false, notes: 'Required if >2 strings in parallel' },
      { category: 'monitoring',     label: 'Extended Monitoring',             required: false },
    ],
    sldStages: [
      { id: 'array',    label: 'Stage 1 — PV Array + Optimizers', order: 1, color: '#B87000', components: ['pv_module', 'optimizer', 'string_wiring'] },
      { id: 'dc',       label: 'Stage 2 — DC Conductors',         order: 2, color: '#CC2200', components: ['dc_disconnect', 'dc_ocpd'] },
      { id: 'inverter', label: 'Stage 3 — Inverter',              order: 3, color: '#003399', components: ['string_inverter'] },
      { id: 'ac',       label: 'Stage 4 — AC Conductors',         order: 4, color: '#0055AA', components: ['ac_disconnect', 'ac_ocpd', 'ac_wiring'] },
      { id: 'utility',  label: 'Stage 5 — Utility',               order: 5, color: '#5500BB', components: ['main_panel', 'utility_meter'] },
    ],
    bomStages: [
      { id: 'array',      label: 'Stage 1 — Array',      order: 1, categories: ['solar_panel', 'optimizer'] },
      { id: 'dc',         label: 'Stage 2 — DC',         order: 2, categories: ['dc_disconnect', 'wire', 'conduit'] },
      { id: 'inverter',   label: 'Stage 3 — Inverter',   order: 3, categories: ['string_inverter'] },
      { id: 'ac',         label: 'Stage 4 — AC',         order: 4, categories: ['ac_disconnect', 'meter'] },
      { id: 'structural', label: 'Stage 5 — Structural', order: 5, categories: ['racking', 'attachment', 'flashing', 'lag_bolt'] },
      { id: 'monitoring', label: 'Stage 6 — Monitoring', order: 6, categories: ['gateway', 'monitoring'] },
      { id: 'labels',     label: 'Stage 7 — Labels',     order: 7, categories: ['label'] },
    ],
    complianceChecks: [
      { ruleId: 'NEC_690_12_RSD',     necReference: 'NEC 690.12',  description: 'RSD integrated in optimizers', autoSatisfiedBy: ['STRING_WITH_OPTIMIZER'] },
      { ruleId: 'NEC_690_15_DC_DISC', necReference: 'NEC 690.15',  description: 'DC disconnect required' },
      { ruleId: 'NEC_690_14_AC_DISC', necReference: 'NEC 690.14',  description: 'AC disconnect required' },
    ],
  },

  MICROINVERTER: {
    label: 'Microinverter',
    description: 'One microinverter per module → AC trunk cable → combiner → AC output. No DC string.',
    requiredAccessoryClasses: [
      { category: 'trunk_cable',    label: 'AC Trunk Cable',                  required: true,  necReference: 'NEC 690.31', notes: '1 section per 16 modules' },
      { category: 'terminator',     label: 'Trunk Cable Terminator',          required: true,  necReference: 'NEC 690.31', notes: '2 per trunk section' },
      { category: 'gateway',        label: 'Communication Gateway',           required: true,  necReference: 'NEC 690.4' },
      { category: 'combiner',       label: 'AC Branch Combiner',              required: true,  necReference: 'NEC 690.4' },
      { category: 'ac_disconnect',  label: 'AC Disconnect Switch',            required: true,  necReference: 'NEC 690.14' },
      { category: 'grounding',      label: 'System Grounding',                required: true,  necReference: 'NEC 690.43' },
    ],
    optionalAccessoryClasses: [
      { category: 'battery',        label: 'AC-Coupled Battery',              required: false, notes: 'Upgrades to AC_COUPLED_BATTERY topology' },
      { category: 'monitoring',     label: 'Extended Monitoring',             required: false },
    ],
    sldStages: [
      { id: 'array',    label: 'Stage 1 — PV Array + Microinverters', order: 1, color: '#B87000', components: ['pv_module', 'microinverter'] },
      { id: 'ac_branch',label: 'Stage 2 — AC Branch Circuits',        order: 2, color: '#CC2200', components: ['trunk_cable', 'terminator', 'ac_branch_ocpd'] },
      { id: 'combiner', label: 'Stage 3 — AC Combiner',               order: 3, color: '#003399', components: ['combiner', 'gateway'] },
      { id: 'ac',       label: 'Stage 4 — AC Conductors',             order: 4, color: '#0055AA', components: ['ac_disconnect', 'ac_ocpd', 'ac_wiring'] },
      { id: 'utility',  label: 'Stage 5 — Utility',                   order: 5, color: '#5500BB', components: ['main_panel', 'utility_meter'] },
    ],
    bomStages: [
      { id: 'array',      label: 'Stage 1 — Array',      order: 1, categories: ['solar_panel', 'microinverter'] },
      { id: 'dc',         label: 'Stage 2 — AC Branch',  order: 2, categories: ['trunk_cable', 'terminator'] },
      { id: 'inverter',   label: 'Stage 3 — Combiner',   order: 3, categories: ['combiner', 'gateway'] },
      { id: 'ac',         label: 'Stage 4 — AC',         order: 4, categories: ['ac_disconnect', 'meter', 'wire', 'conduit'] },
      { id: 'structural', label: 'Stage 5 — Structural', order: 5, categories: ['racking', 'attachment', 'flashing', 'lag_bolt'] },
      { id: 'monitoring', label: 'Stage 6 — Monitoring', order: 6, categories: ['monitoring'] },
      { id: 'labels',     label: 'Stage 7 — Labels',     order: 7, categories: ['label'] },
    ],
    complianceChecks: [
      { ruleId: 'NEC_690_12_RSD',     necReference: 'NEC 690.12',  description: 'RSD integrated in microinverters', autoSatisfiedBy: ['MICROINVERTER'] },
      { ruleId: 'NEC_690_14_AC_DISC', necReference: 'NEC 690.14',  description: 'AC disconnect required' },
      { ruleId: 'NEC_690_4_LISTING',  necReference: 'NEC 690.4',   description: 'All equipment must be listed for PV use' },
    ],
  },

  HYBRID_INVERTER: {
    label: 'Hybrid Inverter',
    description: 'String inverter with integrated battery port. DC strings + optional battery → AC output.',
    requiredAccessoryClasses: [
      { category: 'optimizer',      label: 'DC Power Optimizer (per module)', required: true,  necReference: 'NEC 690.8' },
      { category: 'gateway',        label: 'Optimizer/Battery Gateway',       required: true,  necReference: 'NEC 690.4' },
      { category: 'dc_disconnect',  label: 'DC Disconnect Switch',            required: true,  necReference: 'NEC 690.15' },
      { category: 'ac_disconnect',  label: 'AC Disconnect Switch',            required: true,  necReference: 'NEC 690.14' },
      { category: 'grounding',      label: 'System Grounding',                required: true,  necReference: 'NEC 690.43' },
    ],
    optionalAccessoryClasses: [
      { category: 'battery',        label: 'DC-Coupled Battery',              required: false, notes: 'Upgrades to DC_COUPLED_BATTERY topology' },
    ],
    sldStages: [
      { id: 'array',    label: 'Stage 1 — PV Array + Optimizers', order: 1, color: '#B87000', components: ['pv_module', 'optimizer'] },
      { id: 'dc',       label: 'Stage 2 — DC Conductors',         order: 2, color: '#CC2200', components: ['dc_disconnect', 'dc_ocpd'] },
      { id: 'inverter', label: 'Stage 3 — Hybrid Inverter',       order: 3, color: '#003399', components: ['hybrid_inverter', 'battery'] },
      { id: 'ac',       label: 'Stage 4 — AC Conductors',         order: 4, color: '#0055AA', components: ['ac_disconnect', 'ac_ocpd', 'ac_wiring'] },
      { id: 'utility',  label: 'Stage 5 — Utility',               order: 5, color: '#5500BB', components: ['main_panel', 'utility_meter'] },
    ],
    bomStages: [
      { id: 'array',      label: 'Stage 1 — Array',      order: 1, categories: ['solar_panel', 'optimizer'] },
      { id: 'dc',         label: 'Stage 2 — DC',         order: 2, categories: ['dc_disconnect', 'wire', 'conduit'] },
      { id: 'inverter',   label: 'Stage 3 — Inverter',   order: 3, categories: ['string_inverter', 'battery'] },
      { id: 'ac',         label: 'Stage 4 — AC',         order: 4, categories: ['ac_disconnect', 'meter'] },
      { id: 'structural', label: 'Stage 5 — Structural', order: 5, categories: ['racking', 'attachment', 'flashing', 'lag_bolt'] },
      { id: 'monitoring', label: 'Stage 6 — Monitoring', order: 6, categories: ['gateway', 'monitoring'] },
      { id: 'labels',     label: 'Stage 7 — Labels',     order: 7, categories: ['label'] },
    ],
    complianceChecks: [
      { ruleId: 'NEC_690_12_RSD',     necReference: 'NEC 690.12',  description: 'RSD integrated in optimizers', autoSatisfiedBy: ['HYBRID_INVERTER'] },
      { ruleId: 'NEC_690_15_DC_DISC', necReference: 'NEC 690.15',  description: 'DC disconnect required' },
      { ruleId: 'NEC_690_14_AC_DISC', necReference: 'NEC 690.14',  description: 'AC disconnect required' },
      { ruleId: 'NEC_706_BATTERY',    necReference: 'NEC 706',     description: 'Battery system requirements' },
    ],
  },

  DC_COUPLED_BATTERY: {
    label: 'DC-Coupled Battery',
    description: 'Battery on DC bus (pre-inverter). Hybrid inverter manages PV + battery simultaneously.',
    requiredAccessoryClasses: [
      { category: 'optimizer',      label: 'DC Power Optimizer (per module)', required: true,  necReference: 'NEC 690.8' },
      { category: 'battery',        label: 'DC-Coupled Battery',              required: true,  necReference: 'NEC 706' },
      { category: 'gateway',        label: 'Battery Management Gateway',      required: true,  necReference: 'NEC 690.4' },
      { category: 'dc_disconnect',  label: 'DC Disconnect Switch',            required: true,  necReference: 'NEC 690.15' },
      { category: 'ac_disconnect',  label: 'AC Disconnect Switch',            required: true,  necReference: 'NEC 690.14' },
      { category: 'grounding',      label: 'System Grounding',                required: true,  necReference: 'NEC 690.43' },
    ],
    optionalAccessoryClasses: [],
    sldStages: [
      { id: 'array',    label: 'Stage 1 — PV Array + Optimizers', order: 1, color: '#B87000', components: ['pv_module', 'optimizer'] },
      { id: 'dc',       label: 'Stage 2 — DC Bus + Battery',      order: 2, color: '#CC2200', components: ['dc_disconnect', 'battery', 'dc_ocpd'] },
      { id: 'inverter', label: 'Stage 3 — Hybrid Inverter',       order: 3, color: '#003399', components: ['hybrid_inverter'] },
      { id: 'ac',       label: 'Stage 4 — AC Conductors',         order: 4, color: '#0055AA', components: ['ac_disconnect', 'ac_ocpd', 'ac_wiring'] },
      { id: 'utility',  label: 'Stage 5 — Utility',               order: 5, color: '#5500BB', components: ['main_panel', 'utility_meter'] },
    ],
    bomStages: [
      { id: 'array',      label: 'Stage 1 — Array',      order: 1, categories: ['solar_panel', 'optimizer'] },
      { id: 'dc',         label: 'Stage 2 — DC',         order: 2, categories: ['dc_disconnect', 'wire', 'conduit'] },
      { id: 'inverter',   label: 'Stage 3 — Inverter',   order: 3, categories: ['string_inverter', 'battery'] },
      { id: 'ac',         label: 'Stage 4 — AC',         order: 4, categories: ['ac_disconnect', 'meter'] },
      { id: 'structural', label: 'Stage 5 — Structural', order: 5, categories: ['racking', 'attachment', 'flashing', 'lag_bolt'] },
      { id: 'monitoring', label: 'Stage 6 — Monitoring', order: 6, categories: ['gateway', 'monitoring'] },
      { id: 'labels',     label: 'Stage 7 — Labels',     order: 7, categories: ['label'] },
    ],
    complianceChecks: [
      { ruleId: 'NEC_690_12_RSD',     necReference: 'NEC 690.12',  description: 'RSD integrated in optimizers', autoSatisfiedBy: ['DC_COUPLED_BATTERY'] },
      { ruleId: 'NEC_706_BATTERY',    necReference: 'NEC 706',     description: 'Battery system requirements' },
      { ruleId: 'NEC_690_15_DC_DISC', necReference: 'NEC 690.15',  description: 'DC disconnect required' },
    ],
  },

  AC_COUPLED_BATTERY: {
    label: 'AC-Coupled Battery',
    description: 'Battery on AC bus (post-inverter). Separate battery inverter. Works with any PV topology.',
    requiredAccessoryClasses: [
      { category: 'battery',        label: 'AC-Coupled Battery System',       required: true,  necReference: 'NEC 706' },
      { category: 'gateway',        label: 'Battery Management Gateway',      required: true,  necReference: 'NEC 690.4' },
      { category: 'ac_disconnect',  label: 'AC Disconnect Switch',            required: true,  necReference: 'NEC 690.14' },
      { category: 'grounding',      label: 'System Grounding',                required: true,  necReference: 'NEC 690.43' },
    ],
    optionalAccessoryClasses: [],
    sldStages: [
      { id: 'array',    label: 'Stage 1 — PV Array',        order: 1, color: '#B87000', components: ['pv_module', 'microinverter'] },
      { id: 'ac_branch',label: 'Stage 2 — AC Branch',       order: 2, color: '#CC2200', components: ['trunk_cable', 'combiner'] },
      { id: 'battery',  label: 'Stage 3 — AC Battery',      order: 3, color: '#003399', components: ['battery', 'gateway'] },
      { id: 'ac',       label: 'Stage 4 — AC Conductors',   order: 4, color: '#0055AA', components: ['ac_disconnect', 'ac_wiring'] },
      { id: 'utility',  label: 'Stage 5 — Utility',         order: 5, color: '#5500BB', components: ['main_panel', 'utility_meter'] },
    ],
    bomStages: [
      { id: 'array',      label: 'Stage 1 — Array',      order: 1, categories: ['solar_panel', 'microinverter'] },
      { id: 'dc',         label: 'Stage 2 — AC Branch',  order: 2, categories: ['trunk_cable', 'terminator', 'combiner'] },
      { id: 'inverter',   label: 'Stage 3 — Battery',    order: 3, categories: ['battery'] },
      { id: 'ac',         label: 'Stage 4 — AC',         order: 4, categories: ['ac_disconnect', 'meter', 'wire', 'conduit'] },
      { id: 'structural', label: 'Stage 5 — Structural', order: 5, categories: ['racking', 'attachment', 'flashing', 'lag_bolt'] },
      { id: 'monitoring', label: 'Stage 6 — Monitoring', order: 6, categories: ['gateway', 'monitoring'] },
      { id: 'labels',     label: 'Stage 7 — Labels',     order: 7, categories: ['label'] },
    ],
    complianceChecks: [
      { ruleId: 'NEC_706_BATTERY',    necReference: 'NEC 706',     description: 'Battery system requirements' },
      { ruleId: 'NEC_690_14_AC_DISC', necReference: 'NEC 690.14',  description: 'AC disconnect required' },
    ],
  },

  GROUND_MOUNT_FIXED_TILT: {
    label: 'Ground Mount (Fixed Tilt)',
    description: 'Ground-mounted fixed tilt array. Driven pile or concrete foundation.',
    requiredAccessoryClasses: [
      { category: 'driven_pile',    label: 'Foundation Piles/Posts',          required: true,  necReference: 'ASCE 7-22' },
      { category: 'rail',           label: 'Horizontal Rail System',          required: true,  necReference: 'IBC 2021' },
      { category: 'grounding',      label: 'Grounding Electrode System',      required: true,  necReference: 'NEC 250.52' },
      { category: 'conduit',        label: 'Underground Conduit (DC home run)',required: true,  necReference: 'NEC 300.5' },
      { category: 'dc_disconnect',  label: 'DC Disconnect Switch',            required: true,  necReference: 'NEC 690.15' },
      { category: 'ac_disconnect',  label: 'AC Disconnect Switch',            required: true,  necReference: 'NEC 690.14' },
    ],
    optionalAccessoryClasses: [
      { category: 'rapid_shutdown', label: 'Rapid Shutdown Device',           required: false, notes: 'Not required for ground mount per NEC 690.12(B)(2)' },
    ],
    sldStages: [
      { id: 'array',    label: 'Stage 1 — Ground Array',     order: 1, color: '#B87000', components: ['pv_module', 'string_wiring'] },
      { id: 'dc',       label: 'Stage 2 — DC Conductors',   order: 2, color: '#CC2200', components: ['dc_disconnect', 'dc_ocpd', 'underground_conduit'] },
      { id: 'inverter', label: 'Stage 3 — Inverter',        order: 3, color: '#003399', components: ['string_inverter'] },
      { id: 'ac',       label: 'Stage 4 — AC Conductors',   order: 4, color: '#0055AA', components: ['ac_disconnect', 'ac_ocpd', 'ac_wiring'] },
      { id: 'utility',  label: 'Stage 5 — Utility',         order: 5, color: '#5500BB', components: ['main_panel', 'utility_meter'] },
    ],
    bomStages: [
      { id: 'array',      label: 'Stage 1 — Array',      order: 1, categories: ['solar_panel'] },
      { id: 'dc',         label: 'Stage 2 — DC',         order: 2, categories: ['dc_disconnect', 'wire', 'conduit'] },
      { id: 'inverter',   label: 'Stage 3 — Inverter',   order: 3, categories: ['string_inverter', 'optimizer'] },
      { id: 'ac',         label: 'Stage 4 — AC',         order: 4, categories: ['ac_disconnect', 'meter'] },
      { id: 'structural', label: 'Stage 5 — Structural', order: 5, categories: ['racking', 'driven_pile', 'rail', 'mid_clamp', 'end_clamp', 'grounding'] },
      { id: 'monitoring', label: 'Stage 6 — Monitoring', order: 6, categories: ['gateway', 'monitoring'] },
      { id: 'labels',     label: 'Stage 7 — Labels',     order: 7, categories: ['label'] },
    ],
    complianceChecks: [
      { ruleId: 'NEC_690_15_DC_DISC', necReference: 'NEC 690.15',  description: 'DC disconnect required' },
      { ruleId: 'NEC_300_5_BURIAL',   necReference: 'NEC 300.5',   description: 'Underground conduit burial depth' },
      { ruleId: 'NEC_250_52_GES',     necReference: 'NEC 250.52',  description: 'Grounding electrode system required' },
    ],
  },

  GROUND_MOUNT_DRIVEN_PILE: {
    label: 'Ground Mount (Driven Pile)',
    description: 'Ground-mounted array on hydraulically driven steel piles. No concrete required.',
    requiredAccessoryClasses: [
      { category: 'driven_pile',    label: 'Driven Steel Piles',              required: true,  necReference: 'ASCE 7-22', notes: '2 piles per row (front + back)' },
      { category: 'rail',           label: 'Horizontal Rail System',          required: true,  necReference: 'IBC 2021' },
      { category: 'grounding',      label: 'Grounding Electrode System',      required: true,  necReference: 'NEC 250.52' },
      { category: 'conduit',        label: 'Underground Conduit (DC home run)',required: true,  necReference: 'NEC 300.5' },
      { category: 'dc_disconnect',  label: 'DC Disconnect Switch',            required: true,  necReference: 'NEC 690.15' },
      { category: 'ac_disconnect',  label: 'AC Disconnect Switch',            required: true,  necReference: 'NEC 690.14' },
    ],
    optionalAccessoryClasses: [
      { category: 'rapid_shutdown', label: 'Rapid Shutdown Device',           required: false, notes: 'Not required for ground mount per NEC 690.12(B)(2)' },
    ],
    sldStages: [
      { id: 'array',    label: 'Stage 1 — Ground Array',     order: 1, color: '#B87000', components: ['pv_module', 'string_wiring'] },
      { id: 'dc',       label: 'Stage 2 — DC Conductors',   order: 2, color: '#CC2200', components: ['dc_disconnect', 'dc_ocpd', 'underground_conduit'] },
      { id: 'inverter', label: 'Stage 3 — Inverter',        order: 3, color: '#003399', components: ['string_inverter'] },
      { id: 'ac',       label: 'Stage 4 — AC Conductors',   order: 4, color: '#0055AA', components: ['ac_disconnect', 'ac_ocpd', 'ac_wiring'] },
      { id: 'utility',  label: 'Stage 5 — Utility',         order: 5, color: '#5500BB', components: ['main_panel', 'utility_meter'] },
    ],
    bomStages: [
      { id: 'array',      label: 'Stage 1 — Array',      order: 1, categories: ['solar_panel'] },
      { id: 'dc',         label: 'Stage 2 — DC',         order: 2, categories: ['dc_disconnect', 'wire', 'conduit'] },
      { id: 'inverter',   label: 'Stage 3 — Inverter',   order: 3, categories: ['string_inverter', 'optimizer'] },
      { id: 'ac',         label: 'Stage 4 — AC',         order: 4, categories: ['ac_disconnect', 'meter'] },
      { id: 'structural', label: 'Stage 5 — Structural', order: 5, categories: ['racking', 'driven_pile', 'rail', 'mid_clamp', 'end_clamp', 'grounding'] },
      { id: 'monitoring', label: 'Stage 6 — Monitoring', order: 6, categories: ['gateway', 'monitoring'] },
      { id: 'labels',     label: 'Stage 7 — Labels',     order: 7, categories: ['label'] },
    ],
    complianceChecks: [
      { ruleId: 'NEC_690_15_DC_DISC', necReference: 'NEC 690.15',  description: 'DC disconnect required' },
      { ruleId: 'NEC_300_5_BURIAL',   necReference: 'NEC 300.5',   description: 'Underground conduit burial depth' },
      { ruleId: 'NEC_250_52_GES',     necReference: 'NEC 250.52',  description: 'Grounding electrode system required' },
    ],
  },
};

// ─── Topology Manager Context ─────────────────────────────────────────────────

export interface TopologyManagerContext {
  inverterId: string;
  optimizerId?: string;
  rackingId?: string;
  batteryId?: string;
  moduleCount: number;
  stringCount: number;
  inverterCount: number;
  roofType?: string;
  systemType?: 'roof' | 'ground' | 'flat_roof';
}

// ─── Resolved Accessory ───────────────────────────────────────────────────────

export interface ResolvedAccessory {
  category: string;
  label: string;
  required: boolean;
  quantity: number;
  manufacturer: string;
  model: string;
  partNumber: string;
  necReference?: string;
  notes?: string;
  derivedFrom: string;
  formula?: string;
}

// ─── Topology Resolution Result ───────────────────────────────────────────────

export interface TopologyResolutionResult {
  topology: TopologyType;
  mountTopology: TopologyType | null;
  label: string;
  confidence: 'definitive' | 'inferred';
  reason: string;
  ruleSet: TopologyRuleSet;
  resolvedAccessories: ResolvedAccessory[];
  missingRequiredCategories: string[];
  complianceFlags: ComplianceFlag[];
  sldStages: SLDStageDefinition[];
  bomStages: BOMStageDefinition[];
}

export interface ComplianceFlag {
  ruleId: string;
  necReference: string;
  description: string;
  status: 'satisfied' | 'unsatisfied' | 'auto_satisfied';
  satisfiedBy?: string;
}

// ─── Main Topology Resolution Function ───────────────────────────────────────

export function resolveTopology(ctx: TopologyManagerContext): TopologyResolutionResult {
  const inverterEntry = getRegistryEntryV4(ctx.inverterId);
  const optimizerEntry = ctx.optimizerId ? getRegistryEntryV4(ctx.optimizerId) : undefined;
  const rackingEntry = ctx.rackingId ? getRegistryEntryV4(ctx.rackingId) : undefined;
  const batteryEntry = ctx.batteryId ? getRegistryEntryV4(ctx.batteryId) : undefined;

  // 1. Determine primary topology from inverter registry entry
  let topology: TopologyType = inverterEntry
    ? normalizeTopologyV4(inverterEntry.topologyType)
    : 'STRING_INVERTER';

  // 2. Override: optimizer selected + string inverter → STRING_WITH_OPTIMIZER
  if (optimizerEntry && topology === 'STRING_INVERTER') {
    topology = 'STRING_WITH_OPTIMIZER';
  }

  // 3. Override: battery + hybrid inverter → DC_COUPLED_BATTERY
  if (batteryEntry && topology === 'HYBRID_INVERTER') {
    topology = 'DC_COUPLED_BATTERY';
  }

  // 4. Override: battery + microinverter → AC_COUPLED_BATTERY
  if (batteryEntry && topology === 'MICROINVERTER') {
    topology = 'AC_COUPLED_BATTERY';
  }

  // 5. Mount topology from racking entry
  const mountTopology: TopologyType | null = rackingEntry?.mountTopology
    ? normalizeTopologyV4(rackingEntry.mountTopology as TopologyType)
    : null;

  // 6. Get rule set for this topology
  const ruleSet = TOPOLOGY_RULES[topology] ?? TOPOLOGY_RULES['STRING_INVERTER'];

  // 7. Resolve accessories from all selected equipment entries
  const formulaContext = {
    modules: ctx.moduleCount,
    strings: ctx.stringCount,
    inverters: ctx.inverterCount,
    branches: ctx.stringCount,
    systemKw: 0,
  };

  const resolvedAccessories = resolveAccessoriesFromEntries(
    [inverterEntry, optimizerEntry, rackingEntry, batteryEntry].filter(Boolean) as EquipmentRegistryEntry[],
    formulaContext,
    ctx.roofType
  );

  // 8. Check for missing required categories
  const resolvedCategories = new Set(resolvedAccessories.map(a => a.category));
  const missingRequiredCategories = ruleSet.requiredAccessoryClasses
    .filter(ac => ac.required && !resolvedCategories.has(ac.category))
    .map(ac => ac.category);

  // 9. Build compliance flags
  const complianceFlags = buildComplianceFlags(topology, ruleSet, inverterEntry);

  // 10. Build reason string
  const reason = buildReasonString(topology, inverterEntry, optimizerEntry, rackingEntry, batteryEntry);

  return {
    topology,
    mountTopology,
    label: TOPOLOGY_LABELS_V4[topology] ?? topology,
    confidence: inverterEntry ? 'definitive' : 'inferred',
    reason,
    ruleSet,
    resolvedAccessories,
    missingRequiredCategories,
    complianceFlags,
    sldStages: ruleSet.sldStages,
    bomStages: ruleSet.bomStages,
  };
}

// ─── Helper: Resolve Accessories from Registry Entries ───────────────────────

function resolveAccessoriesFromEntries(
  entries: EquipmentRegistryEntry[],
  formulaContext: Parameters<typeof evaluateQuantityFormulaV4>[1],
  roofType?: string
): ResolvedAccessory[] {
  const seen = new Map<string, ResolvedAccessory>();

  for (const entry of entries) {
    for (const acc of entry.requiredAccessories) {
      // Check conditional
      if (acc.conditional && roofType) {
        const conditionMet = evaluateCondition(acc.conditional, roofType);
        if (!conditionMet) continue;
      }

      // Calculate quantity
      let quantity = 1;
      if (acc.quantityRule === 'formula' && acc.quantityFormula) {
        quantity = evaluateQuantityFormulaV4(acc.quantityFormula, formulaContext);
      } else if (acc.quantityRule === 'perModule') {
        quantity = formulaContext.modules;
      } else if (acc.quantityRule === 'perString') {
        quantity = formulaContext.strings;
      } else if (acc.quantityRule === 'perInverter') {
        quantity = formulaContext.inverters;
      } else if (acc.quantityRule === 'perSystem') {
        quantity = 1;
      } else if (acc.quantityRule === 'perBranch') {
        quantity = formulaContext.branches ?? formulaContext.strings;
      }

      if (acc.quantityMultiplier) quantity *= acc.quantityMultiplier;

      // Deduplicate by category — keep first occurrence (primary equipment takes precedence)
      if (!seen.has(acc.category)) {
        seen.set(acc.category, {
          category: acc.category,
          label: acc.description,
          required: acc.required,
          quantity: Math.ceil(quantity),
          manufacturer: acc.defaultManufacturer ?? 'TBD',
          model: acc.defaultModel ?? 'TBD',
          partNumber: acc.defaultPartNumber ?? 'TBD',
          necReference: acc.necReference,
          notes: acc.notes,
          derivedFrom: `${entry.manufacturer} ${entry.model}`,
          formula: acc.quantityFormula,
        });
      }
    }
  }

  return Array.from(seen.values());
}

// ─── Helper: Evaluate Conditional Expression ─────────────────────────────────

function evaluateCondition(condition: string, roofType: string): boolean {
  // Simple condition evaluator for roofType checks
  // e.g. "roofType === shingle || roofType === tile"
  const parts = condition.split('||').map(p => p.trim());
  return parts.some(part => {
    const match = part.match(/roofType\s*===\s*(\w+)/);
    if (match) return roofType === match[1];
    return false;
  });
}

// ─── Helper: Build Compliance Flags ──────────────────────────────────────────

function buildComplianceFlags(
  topology: TopologyType,
  ruleSet: TopologyRuleSet,
  inverter?: EquipmentRegistryEntry
): ComplianceFlag[] {
  return ruleSet.complianceChecks.map(check => {
    const autoSatisfied = check.autoSatisfiedBy?.includes(topology) ?? false;
    const rsdIntegrated = inverter?.electricalSpecs?.rapidShutdownCompliant ?? false;

    let status: ComplianceFlag['status'] = 'unsatisfied';
    let satisfiedBy: string | undefined;

    if (autoSatisfied) {
      status = 'auto_satisfied';
      satisfiedBy = `Auto-satisfied by ${TOPOLOGY_LABELS_V4[topology]} topology`;
    } else if (check.ruleId === 'NEC_690_12_RSD' && rsdIntegrated) {
      status = 'auto_satisfied';
      satisfiedBy = `${inverter?.manufacturer} ${inverter?.model} — RSD compliant`;
    } else if (check.ruleId === 'NEC_690_14_AC_DISC') {
      status = 'unsatisfied'; // always needs explicit sizing
    } else {
      status = 'satisfied'; // assume satisfied unless explicitly checked
    }

    return {
      ruleId: check.ruleId,
      necReference: check.necReference,
      description: check.description,
      status,
      satisfiedBy,
    };
  });
}

// ─── Helper: Build Reason String ─────────────────────────────────────────────

function buildReasonString(
  topology: TopologyType,
  inverter?: EquipmentRegistryEntry,
  optimizer?: EquipmentRegistryEntry,
  racking?: EquipmentRegistryEntry,
  battery?: EquipmentRegistryEntry
): string {
  const parts: string[] = [];

  if (inverter) {
    parts.push(`${inverter.manufacturer} ${inverter.model} → ${TOPOLOGY_LABELS_V4[topology]}`);
  } else {
    parts.push(`No inverter in registry → defaulting to ${TOPOLOGY_LABELS_V4[topology]}`);
  }

  if (optimizer) parts.push(`+ ${optimizer.manufacturer} ${optimizer.model}`);
  if (battery) parts.push(`+ ${battery.manufacturer} ${battery.model}`);
  if (racking) parts.push(`+ ${racking.manufacturer} ${racking.model} (${TOPOLOGY_LABELS_V4[racking.mountTopology ?? racking.topologyType] ?? 'mount'})`);

  return parts.join(', ');
}

// ─── Topology Transition Validator ───────────────────────────────────────────

export interface TopologyTransition {
  from: TopologyType;
  to: TopologyType;
  fieldsToReset: string[];
  fieldsToAdd: string[];
  warnings: string[];
}

export function validateTopologyTransition(from: TopologyType, to: TopologyType): TopologyTransition {
  const normFrom = normalizeTopologyV4(from);
  const normTo = normalizeTopologyV4(to);
  const fieldsToReset: string[] = [];
  const fieldsToAdd: string[] = [];
  const warnings: string[] = [];

  const fromRules = TOPOLOGY_RULES[normFrom];
  const toRules = TOPOLOGY_RULES[normTo];

  if (!fromRules || !toRules) return { from, to, fieldsToReset, fieldsToAdd, warnings };

  // Find categories being removed
  const fromCategories = new Set(fromRules.requiredAccessoryClasses.map(a => a.category));
  const toCategories = new Set(toRules.requiredAccessoryClasses.map(a => a.category));

  for (const cat of fromCategories) {
    if (!toCategories.has(cat)) fieldsToReset.push(cat);
  }
  for (const cat of toCategories) {
    if (!fromCategories.has(cat)) fieldsToAdd.push(cat);
  }

  if (fieldsToReset.length > 0) {
    warnings.push(`Switching from ${TOPOLOGY_LABELS_V4[normFrom]} to ${TOPOLOGY_LABELS_V4[normTo]}: removing ${fieldsToReset.join(', ')}`);
  }
  if (fieldsToAdd.length > 0) {
    warnings.push(`Adding required components: ${fieldsToAdd.join(', ')}`);
  }

  return { from, to, fieldsToReset, fieldsToAdd, warnings };
}

// ─── Get Topology Rule Set ────────────────────────────────────────────────────

export function getTopologyRuleSet(topology: TopologyType): TopologyRuleSet {
  return TOPOLOGY_RULES[normalizeTopologyV4(topology)] ?? TOPOLOGY_RULES['STRING_INVERTER'];
}

export function getTopologyLabel(topology: TopologyType): string {
  return TOPOLOGY_LABELS_V4[topology] ?? topology;
}