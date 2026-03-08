// ============================================================
// EQUIPMENT EXTRAS — Rapid Shutdown, Combiners, Disconnects,
// Service Panels, and additional BOS components
// ============================================================

export interface RapidShutdownDevice {
  id: string;
  manufacturer: string;
  model: string;
  type: 'module_level' | 'array_level' | 'transmitter_receiver';
  necCompliance: '2017' | '2020' | '2023';
  inputVoltageMax: number;
  inputCurrentMax: number;
  outputVoltageOff: number;   // Voltage when shutdown (≤30V per NEC 2017)
  communicationType: 'plc' | 'wireless' | 'hardwired';
  compatibleInverters: string[];
  priceEach: number;
  datasheetUrl?: string;
  isNew?: boolean;
}

export interface CombinerBox {
  id: string;
  manufacturer: string;
  model: string;
  inputStrings: number;       // Number of string inputs
  inputVoltageMax: number;    // Max DC input voltage
  inputCurrentPerString: number;
  outputCurrentMax: number;
  fuseRating: number;         // Per-string fuse (A)
  hasMonitoring: boolean;
  hasDisconnect: boolean;
  nemaRating: string;         // NEMA 3R, 4X, etc.
  priceEach: number;
  isNew?: boolean;
}

export interface ACDisconnect {
  id: string;
  manufacturer: string;
  model: string;
  voltageRating: number;      // VAC
  currentRating: number;      // Amps
  poles: 2 | 3;
  nemaRating: string;
  fusible: boolean;
  lockable: boolean;
  utilityGradeVisible: boolean; // NEC 690.13 visible disconnect
  priceEach: number;
  isNew?: boolean;
}

export interface DCDisconnect {
  id: string;
  manufacturer: string;
  model: string;
  voltageRating: number;      // VDC
  currentRating: number;      // Amps
  poles: 2 | 4;
  nemaRating: string;
  fusible: boolean;
  lockable: boolean;
  priceEach: number;
  isNew?: boolean;
}

export interface ServicePanel {
  id: string;
  manufacturer: string;
  model: string;
  mainBreakerAmps: number;
  busRatingAmps: number;
  spaces: number;             // Number of circuit spaces
  voltage: '120/240V' | '120/208V' | '277/480V';
  phases: 1 | 3;
  nemaRating: string;
  hasMainBreaker: boolean;
  isLoadCenter: boolean;
  priceEach: number;
  isNew?: boolean;
}

// ── Rapid Shutdown Devices ────────────────────────────────────
export const RAPID_SHUTDOWN_DEVICES: RapidShutdownDevice[] = [
  {
    id: 'rsd-solaredge-mlpe',
    manufacturer: 'SolarEdge',
    model: 'P-Series Optimizer (RSD Built-in)',
    type: 'module_level',
    necCompliance: '2020',
    inputVoltageMax: 83,
    inputCurrentMax: 15,
    outputVoltageOff: 1,
    communicationType: 'plc',
    compatibleInverters: ['se-hd-wave-3800', 'se-hd-wave-7600', 'se-hd-wave-11400'],
    priceEach: 85,
    isNew: false,
  },
  {
    id: 'rsd-tigo-cca',
    manufacturer: 'Tigo',
    model: 'CCA (Cloud Connect Advanced)',
    type: 'transmitter_receiver',
    necCompliance: '2020',
    inputVoltageMax: 600,
    inputCurrentMax: 20,
    outputVoltageOff: 30,
    communicationType: 'wireless',
    compatibleInverters: [],
    priceEach: 295,
    isNew: false,
  },
  {
    id: 'rsd-fronius-rsd',
    manufacturer: 'Fronius',
    model: 'Rapid Shutdown Box',
    type: 'array_level',
    necCompliance: '2017',
    inputVoltageMax: 1000,
    inputCurrentMax: 25,
    outputVoltageOff: 30,
    communicationType: 'hardwired',
    compatibleInverters: ['fronius-primo-6', 'fronius-primo-10', 'fronius-symo-10'],
    priceEach: 185,
    isNew: false,
  },
  {
    id: 'rsd-midnite-birdhouse',
    manufacturer: 'MidNite Solar',
    model: 'MNBIRDHOUSEX2',
    type: 'array_level',
    necCompliance: '2020',
    inputVoltageMax: 600,
    inputCurrentMax: 30,
    outputVoltageOff: 30,
    communicationType: 'hardwired',
    compatibleInverters: [],
    priceEach: 145,
    isNew: false,
  },
  {
    id: 'rsd-enphase-iq8',
    manufacturer: 'Enphase',
    model: 'IQ8 Series (RSD Built-in)',
    type: 'module_level',
    necCompliance: '2023',
    inputVoltageMax: 60,
    inputCurrentMax: 14,
    outputVoltageOff: 1,
    communicationType: 'plc',
    compatibleInverters: ['enphase-iq8plus', 'enphase-iq8m', 'enphase-iq8h'],
    priceEach: 0, // Built into microinverter
    isNew: true,
  },
];

// ── Combiner Boxes ────────────────────────────────────────────
export const COMBINER_BOXES: CombinerBox[] = [
  {
    id: 'cb-midnite-mnpv6',
    manufacturer: 'MidNite Solar',
    model: 'MNPV6',
    inputStrings: 6,
    inputVoltageMax: 600,
    inputCurrentPerString: 15,
    outputCurrentMax: 90,
    fuseRating: 15,
    hasMonitoring: false,
    hasDisconnect: true,
    nemaRating: 'NEMA 3R',
    priceEach: 185,
  },
  {
    id: 'cb-midnite-mnpv12',
    manufacturer: 'MidNite Solar',
    model: 'MNPV12',
    inputStrings: 12,
    inputVoltageMax: 600,
    inputCurrentPerString: 15,
    outputCurrentMax: 180,
    fuseRating: 15,
    hasMonitoring: false,
    hasDisconnect: true,
    nemaRating: 'NEMA 3R',
    priceEach: 285,
  },
  {
    id: 'cb-solaredge-cbi',
    manufacturer: 'SolarEdge',
    model: 'Combiner Box (4-input)',
    inputStrings: 4,
    inputVoltageMax: 1000,
    inputCurrentPerString: 20,
    outputCurrentMax: 80,
    fuseRating: 20,
    hasMonitoring: true,
    hasDisconnect: true,
    nemaRating: 'NEMA 4X',
    priceEach: 395,
    isNew: true,
  },
  {
    id: 'cb-sma-combiner',
    manufacturer: 'SMA',
    model: 'Sunny Central Combiner Box',
    inputStrings: 8,
    inputVoltageMax: 1000,
    inputCurrentPerString: 15,
    outputCurrentMax: 120,
    fuseRating: 15,
    hasMonitoring: true,
    hasDisconnect: true,
    nemaRating: 'NEMA 4X',
    priceEach: 485,
  },
];

// ── AC Disconnects ────────────────────────────────────────────
export const AC_DISCONNECTS: ACDisconnect[] = [
  {
    id: 'acd-square-d-60a',
    manufacturer: 'Square D',
    model: 'QO260L200PG (60A)',
    voltageRating: 240,
    currentRating: 60,
    poles: 2,
    nemaRating: 'NEMA 3R',
    fusible: false,
    lockable: true,
    utilityGradeVisible: true,
    priceEach: 85,
  },
  {
    id: 'acd-square-d-100a',
    manufacturer: 'Square D',
    model: 'QO2100L200PG (100A)',
    voltageRating: 240,
    currentRating: 100,
    poles: 2,
    nemaRating: 'NEMA 3R',
    fusible: false,
    lockable: true,
    utilityGradeVisible: true,
    priceEach: 125,
  },
  {
    id: 'acd-siemens-60a',
    manufacturer: 'Siemens',
    model: 'W0202L1125S (60A)',
    voltageRating: 240,
    currentRating: 60,
    poles: 2,
    nemaRating: 'NEMA 3R',
    fusible: false,
    lockable: true,
    utilityGradeVisible: true,
    priceEach: 78,
  },
  {
    id: 'acd-eaton-60a-fusible',
    manufacturer: 'Eaton',
    model: 'DPF222RP (60A Fusible)',
    voltageRating: 240,
    currentRating: 60,
    poles: 2,
    nemaRating: 'NEMA 3R',
    fusible: true,
    lockable: true,
    utilityGradeVisible: true,
    priceEach: 95,
  },
  {
    id: 'acd-eaton-200a-3ph',
    manufacturer: 'Eaton',
    model: 'DH365FGK (200A 3-Phase)',
    voltageRating: 480,
    currentRating: 200,
    poles: 3,
    nemaRating: 'NEMA 3R',
    fusible: true,
    lockable: true,
    utilityGradeVisible: true,
    priceEach: 385,
  },
];

// ── DC Disconnects ────────────────────────────────────────────
export const DC_DISCONNECTS: DCDisconnect[] = [
  {
    id: 'dcd-midnite-mndc250',
    manufacturer: 'MidNite Solar',
    model: 'MNDC250 (250VDC)',
    voltageRating: 250,
    currentRating: 60,
    poles: 2,
    nemaRating: 'NEMA 3R',
    fusible: false,
    lockable: true,
    priceEach: 65,
  },
  {
    id: 'dcd-midnite-mndc600',
    manufacturer: 'MidNite Solar',
    model: 'MNDC600 (600VDC)',
    voltageRating: 600,
    currentRating: 60,
    poles: 2,
    nemaRating: 'NEMA 3R',
    fusible: false,
    lockable: true,
    priceEach: 95,
  },
  {
    id: 'dcd-square-d-1000v',
    manufacturer: 'Square D',
    model: 'HU363DS (1000VDC)',
    voltageRating: 1000,
    currentRating: 100,
    poles: 2,
    nemaRating: 'NEMA 3R',
    fusible: false,
    lockable: true,
    priceEach: 185,
  },
  {
    id: 'dcd-eaton-1000v-fusible',
    manufacturer: 'Eaton',
    model: 'DH364UGK (1000VDC Fusible)',
    voltageRating: 1000,
    currentRating: 200,
    poles: 4,
    nemaRating: 'NEMA 3R',
    fusible: true,
    lockable: true,
    priceEach: 295,
  },
];

// ── Service Panels ────────────────────────────────────────────
export const SERVICE_PANELS: ServicePanel[] = [
  {
    id: 'sp-square-d-200a',
    manufacturer: 'Square D',
    model: 'QO130L200PG (200A, 30-space)',
    mainBreakerAmps: 200,
    busRatingAmps: 200,
    spaces: 30,
    voltage: '120/240V',
    phases: 1,
    nemaRating: 'NEMA 1',
    hasMainBreaker: true,
    isLoadCenter: true,
    priceEach: 185,
  },
  {
    id: 'sp-square-d-200a-40',
    manufacturer: 'Square D',
    model: 'QO140L200PG (200A, 40-space)',
    mainBreakerAmps: 200,
    busRatingAmps: 200,
    spaces: 40,
    voltage: '120/240V',
    phases: 1,
    nemaRating: 'NEMA 1',
    hasMainBreaker: true,
    isLoadCenter: true,
    priceEach: 225,
  },
  {
    id: 'sp-siemens-200a',
    manufacturer: 'Siemens',
    model: 'P4040B1200 (200A, 40-space)',
    mainBreakerAmps: 200,
    busRatingAmps: 200,
    spaces: 40,
    voltage: '120/240V',
    phases: 1,
    nemaRating: 'NEMA 1',
    hasMainBreaker: true,
    isLoadCenter: true,
    priceEach: 195,
  },
  {
    id: 'sp-eaton-200a',
    manufacturer: 'Eaton',
    model: 'BR4040B200 (200A, 40-space)',
    mainBreakerAmps: 200,
    busRatingAmps: 200,
    spaces: 40,
    voltage: '120/240V',
    phases: 1,
    nemaRating: 'NEMA 1',
    hasMainBreaker: true,
    isLoadCenter: true,
    priceEach: 175,
  },
  {
    id: 'sp-square-d-400a',
    manufacturer: 'Square D',
    model: 'QO142L400PG (400A, 42-space)',
    mainBreakerAmps: 400,
    busRatingAmps: 400,
    spaces: 42,
    voltage: '120/240V',
    phases: 1,
    nemaRating: 'NEMA 1',
    hasMainBreaker: true,
    isLoadCenter: false,
    priceEach: 485,
    isNew: true,
  },
  {
    id: 'sp-siemens-3ph-200a',
    manufacturer: 'Siemens',
    model: 'S4242B3200 (200A, 3-Phase)',
    mainBreakerAmps: 200,
    busRatingAmps: 200,
    spaces: 42,
    voltage: '120/208V',
    phases: 3,
    nemaRating: 'NEMA 1',
    hasMainBreaker: true,
    isLoadCenter: false,
    priceEach: 385,
  },
];

// ── Lookup helpers ────────────────────────────────────────────
export function getRapidShutdownById(id: string): RapidShutdownDevice | undefined {
  return RAPID_SHUTDOWN_DEVICES.find(r => r.id === id);
}

export function getCombinerBoxById(id: string): CombinerBox | undefined {
  return COMBINER_BOXES.find(c => c.id === id);
}

export function getACDisconnectById(id: string): ACDisconnect | undefined {
  return AC_DISCONNECTS.find(d => d.id === id);
}

export function getDCDisconnectById(id: string): DCDisconnect | undefined {
  return DC_DISCONNECTS.find(d => d.id === id);
}

export function getServicePanelById(id: string): ServicePanel | undefined {
  return SERVICE_PANELS.find(p => p.id === id);
}

export function getServicePanelsByMainBreaker(amps: number): ServicePanel[] {
  return SERVICE_PANELS.filter(p => p.mainBreakerAmps >= amps);
}

export function getACDisconnectsByRating(minAmps: number): ACDisconnect[] {
  return AC_DISCONNECTS.filter(d => d.currentRating >= minAmps);
}