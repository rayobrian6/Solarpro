// ============================================================
// SystemState — Master Engineering State Object
// All UI components derive from this. No isolated calculations.
// ============================================================

import { SolarPanel, StringInverter, Microinverter, Optimizer, RackingSystem } from './equipment-db';
import { TopologyType } from './equipment-registry';
export type { TopologyType };

// TopologyType — imported from equipment-registry.ts


export type InverterBrand = 'SolarEdge' | 'Enphase' | 'Fronius' | 'SMA' | 'Sungrow' | 'APsystems' | 'Hoymiles' | 'Other';

// ─── Module Instance ──────────────────────────────────────────────────────────

export interface ModuleInstance {
  id: string;               // unique instance id
  panelId: string;          // ref to equipment-db panel
  stringId: string;         // which string this belongs to
  inverterId: string;       // which inverter this belongs to
  optimizerId?: string;     // optimizer instance id (if applicable)
  position: number;         // position in string (1-based)
}

// ─── Optimizer Instance ───────────────────────────────────────────────────────

export interface OptimizerInstance {
  id: string;               // unique instance id
  optimizerModelId: string; // ref to equipment-db optimizer
  moduleInstanceId: string; // bound to exactly one module
  panelId: string;          // panel model this is paired with
}

// ─── String Configuration ─────────────────────────────────────────────────────

export interface StringConfig {
  id: string;
  label: string;
  panelCount: number;
  panelId: string;
  tilt: number;
  azimuth: number;
  roofType: string;
  mountingSystem: string;
  wireGauge: string;
  wireLength: number;
  // MANUAL mode breaker override
  ocpdOverride?: number;    // user-specified OCPD in MANUAL mode
  ocpdOverrideAcknowledged?: boolean;
}

// ─── Inverter Configuration ───────────────────────────────────────────────────

export interface InverterConfig {
  id: string;
  inverterId: string;
  type: 'string' | 'micro' | 'optimizer';
  strings: StringConfig[];
}

// ─── Ecosystem Components ─────────────────────────────────────────────────────

export interface EcosystemComponent {
  id: string;
  category: 'optimizer' | 'gateway' | 'dc_disconnect' | 'rapid_shutdown' | 'combiner' | 'trunk_cable' | 'terminator' | 'ac_disconnect' | 'monitoring';
  manufacturer: string;
  model: string;
  partNumber: string;
  quantity: number;
  autoAdded: boolean;       // true = system added, false = user added
  reason: string;           // why it was added
  requiredBy: string;       // inverter/topology that requires it
}

// ─── BOM Line Item ────────────────────────────────────────────────────────────

export interface BOMLineItem {
  id: string;
  category: BOMCategory;
  manufacturer: string;
  model: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: string;             // 'ea', 'ft', 'lf', 'set'
  derivedFrom: string;      // what drove this item (e.g. 'roofType:shingle', 'inverter:SolarEdge')
  necReference?: string;
}

export type BOMCategory =
  | 'panels'
  | 'inverters'
  | 'optimizers'
  | 'racking_rail'
  | 'racking_hardware'
  | 'flashing'
  | 'conduit'
  | 'wire'
  | 'disconnects'
  | 'combiners'
  | 'monitoring'
  | 'grounding'
  | 'labels'
  | 'misc';

// ─── Conductor Sizing ─────────────────────────────────────────────────────────

export interface ConductorSizing {
  acWireGauge: string;
  acConductorCallout: string;
  acWireAmpacity: number;
  acVoltageDrop: number;
  groundingConductor: string;
  conduitSize: string;
  conduitType: string;
  autoSized: boolean;
}

// ─── Structural Data ──────────────────────────────────────────────────────────

export interface StructuralData {
  roofType: string;
  roofPitch: number;
  rafterSpacing: number;
  rafterSpan: number;
  rafterSize: string;
  rafterSpecies: string;
  attachmentSpacing: number;
  windSpeed: number;
  windExposure: 'B' | 'C' | 'D';
  groundSnowLoad: number;
  // Auto-resolution
  resolvedAttachmentSpacing?: number;
  resolvedRafterSize?: string;
  structuralResolutionLog?: StructuralResolutionEntry[];
}

export interface StructuralResolutionEntry {
  step: number;
  action: string;
  fromValue: string | number;
  toValue: string | number;
  reason: string;
  reference: string;
}

// ─── Override Log ─────────────────────────────────────────────────────────────

export interface OverrideEntry {
  id: string;
  timestamp: string;
  field: string;
  originalValue: string | number;
  overrideValue: string | number;
  mode: 'MANUAL';
  acknowledged: boolean;
  riskLevel: 'info' | 'warning' | 'error';
  necReference: string;
  reason: string;
}

// ─── Topology Change Log ──────────────────────────────────────────────────────

export interface TopologyChangeEntry {
  timestamp: string;
  fromTopology: TopologyType;
  toTopology: TopologyType;
  trigger: string;          // what caused the change
  resetFields: string[];    // fields that were reset
}

// ─── Master SystemState ───────────────────────────────────────────────────────

export interface SystemState {
  // Identity
  projectName: string;
  clientName: string;
  address: string;
  designer: string;
  date: string;

  // Topology
  topologyType: TopologyType;
  inverterBrand: InverterBrand;

  // Equipment
  inverters: InverterConfig[];
  modules: ModuleInstance[];       // all module instances (derived from strings)
  optimizers: OptimizerInstance[]; // per-module optimizer bindings
  ecosystemComponents: EcosystemComponent[];

  // System config
  systemType: 'roof' | 'ground' | 'fence';
  mainPanelAmps: number;
  mainPanelBrand: string;
  utilityMeter: string;
  acDisconnect: boolean;
  dcDisconnect: boolean;
  productionMeter: boolean;
  rapidShutdown: boolean;
  batteryBrand: string;
  batteryModel: string;
  batteryCount: number;
  batteryKwh: number;

  // Conductor sizing (auto-resolved)
  conductorSizing: ConductorSizing;

  // Structural
  structuralData: StructuralData;
  mountingId: string;

  // Compliance status (last calculated)
  complianceStatus: {
    overallStatus: 'PASS' | 'WARNING' | 'FAIL' | null;
    electrical: any;
    structural: any;
    jurisdiction: any;
    autoDetected: any;
    lastCalculatedAt: string | null;
  };

  // BOM
  bom: BOMLineItem[];
  bomGeneratedAt: string | null;

  // Engineering mode
  engineeringMode: 'AUTO' | 'MANUAL';

  // Audit trails
  overrides: OverrideEntry[];
  topologyChangeLog: TopologyChangeEntry[];
  autoResolutions: any[];

  // Notes
  notes: string;
}

// ─── Default SystemState ──────────────────────────────────────────────────────

export function createDefaultSystemState(): SystemState {
  const defaultStringId = `str-${Date.now()}-0`;
  const defaultInverterId = `inv-${Date.now()}`;

  return {
    projectName: 'Solar Installation',
    clientName: '',
    address: '',
    designer: '',
    date: new Date().toISOString().split('T')[0],

    topologyType: 'STRING',
    inverterBrand: 'SolarEdge',

    inverters: [{
      id: defaultInverterId,
      inverterId: 'se-7600h',
      type: 'string',
      strings: [{
        id: defaultStringId,
        label: 'String 1',
        panelCount: 10,
        panelId: 'qcells-peak-duo-400',
        tilt: 20,
        azimuth: 180,
        roofType: 'shingle',
        mountingSystem: 'ironridge-xr100',
        wireGauge: '#10 AWG',
        wireLength: 50,
      }],
    }],
    modules: [],
    optimizers: [],
    ecosystemComponents: [],

    systemType: 'roof',
    mainPanelAmps: 200,
    mainPanelBrand: 'Square D',
    utilityMeter: 'Bidirectional Net Meter',
    acDisconnect: true,
    dcDisconnect: true,
    productionMeter: true,
    rapidShutdown: true,
    batteryBrand: '',
    batteryModel: '',
    batteryCount: 0,
    batteryKwh: 0,

    conductorSizing: {
      acWireGauge: '#10 AWG',
      acConductorCallout: '',
      acWireAmpacity: 0,
      acVoltageDrop: 0,
      groundingConductor: '#12 AWG',
      conduitSize: '3/4"',
      conduitType: 'EMT',
      autoSized: false,
    },

    structuralData: {
      roofType: 'shingle',
      roofPitch: 20,
      rafterSpacing: 24,
      rafterSpan: 16,
      rafterSize: '2x6',
      rafterSpecies: 'Douglas Fir-Larch',
      attachmentSpacing: 48,
      windSpeed: 115,
      windExposure: 'C',
      groundSnowLoad: 20,
    },
    mountingId: 'ironridge-xr100',

    complianceStatus: {
      overallStatus: null,
      electrical: null,
      structural: null,
      jurisdiction: null,
      autoDetected: null,
      lastCalculatedAt: null,
    },

    bom: [],
    bomGeneratedAt: null,

    engineeringMode: 'AUTO',
    overrides: [],
    topologyChangeLog: [],
    autoResolutions: [],
    notes: '',
  };
}

// ─── Topology Detection ───────────────────────────────────────────────────────

export function detectTopology(state: SystemState): TopologyType {
  const firstInv = state.inverters[0];
  if (!firstInv) return 'STRING';
  if (firstInv.type === 'micro') return 'MICRO';
  if (firstInv.type === 'optimizer' || state.optimizers.length > 0) return 'STRING_OPTIMIZER';
  return 'STRING';
}

// ─── Module Instance Builder ──────────────────────────────────────────────────

export function buildModuleInstances(inverters: InverterConfig[]): ModuleInstance[] {
  const modules: ModuleInstance[] = [];
  for (const inv of inverters) {
    for (const str of inv.strings) {
      for (let i = 0; i < str.panelCount; i++) {
        modules.push({
          id: `mod-${inv.id}-${str.id}-${i}`,
          panelId: str.panelId,
          stringId: str.id,
          inverterId: inv.id,
          position: i + 1,
        });
      }
    }
  }
  return modules;
}

// ─── Total Counts ─────────────────────────────────────────────────────────────

export function getTotalPanels(state: SystemState): number {
  return state.inverters.reduce((sum, inv) =>
    sum + inv.strings.reduce((s, str) => s + str.panelCount, 0), 0);
}

export function getTotalDCkW(state: SystemState, panelWatts: number): number {
  return (getTotalPanels(state) * panelWatts) / 1000;
}

export function getTotalACkW(state: SystemState, inverterSpecs: Map<string, any>): number {
  return state.inverters.reduce((sum, inv) => {
    const spec = inverterSpecs.get(inv.inverterId);
    if (!spec) return sum;
    const kw = spec.acOutputKw ?? (spec.acOutputW != null ? spec.acOutputW / 1000 : 0);
    return sum + kw;
  }, 0);
}