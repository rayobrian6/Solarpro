// ============================================================
// Equipment Intelligence Database
// Normalized equipment data for permit-grade engineering
// ============================================================

export interface SolarPanel {
  id: string;
  manufacturer: string;
  model: string;
  category: 'solar_panel';
  watts: number;
  efficiency: number; // %
  voc: number; // Open circuit voltage (V)
  vmp: number; // Max power voltage (V)
  isc: number; // Short circuit current (A)
  imp: number; // Max power current (A)
  tempCoeffVoc: number; // %/°C (negative) — NEC 690.7 cold-temp Voc correction
  tempCoeffIsc: number; // %/°C (positive) — NEC 690.8 hot-temp Isc correction
  tempCoeffPmax: number; // %/°C (negative)
  maxSystemVoltage: number; // V
  maxSeriesFuseRating: number; // A — hard cap for OCPD per NEC 690.8(B)
  nominalOperatingTemp: number; // °C — NOCT, typically 43-47°C
  parallelStringLimit: number; // max strings in parallel before combiner required
  weight: number; // lbs
  length: number; // inches
  width: number; // inches
  thickness: number; // inches
  warranty: string;
  ulListing: string;
  datasheetUrl: string;
  bifacial: boolean;
  cellType: 'mono-PERC' | 'N-type TOPCon' | 'HJT' | 'poly';
}

export interface StringInverter {
  id: string;
  manufacturer: string;
  model: string;
  category: 'string_inverter';
  acOutputKw: number;
  dcInputKwMax: number;
  maxDcVoltage: number; // V
  mpptVoltageMin: number; // V
  mpptVoltageMax: number; // V
  maxInputCurrentPerMppt: number; // A per MPPT channel
  maxShortCircuitCurrent: number; // A — max DC short circuit current input
  mpptChannels: number;
  numberOfMPPT: number; // same as mpptChannels, explicit alias
  recommendedStringRange: { min: number; max: number }; // panels per string
  acOutputVoltage: number; // V
  acOutputCurrentMax: number; // A — used for AC wire sizing (125% rule)
  efficiency: number; // %
  cec_efficiency: number; // %
  weight: number; // lbs
  dimensions: string; // WxHxD inches
  warranty: string;
  ulListing: string;
  rapidShutdownCompliant: boolean;
  arcFaultProtection: boolean;
  groundFaultProtection: boolean;
  datasheetUrl: string;
  isNew?: boolean; // UI badge flag — true for recently added models
}

export interface Microinverter {
  id: string;
  manufacturer: string;
  model: string;
  category: 'microinverter';
  acOutputW: number;
  dcInputWMax: number;
  maxDcVoltage: number; // V
  mpptVoltageMin: number; // V
  mpptVoltageMax: number; // V
  maxInputCurrent: number; // A
  acOutputVoltage: number; // V
  acOutputCurrentMax: number; // A — nominal AC output current per device
  efficiency: number; // %
  cec_efficiency: number; // %
  weight: number; // lbs
  warranty: string;
  ulListing: string;
  rapidShutdownCompliant: boolean;
  datasheetUrl: string;
  // modulesPerDevice — how many PV modules this device serves
  // 1 = standard 1:1 (IQ8+, IQ8M, IQ8H), 2 = dual-module (DS3, DS3-S, DS3-L, HM-800)
  // deviceCount = ceil(panelCount / modulesPerDevice)
  modulesPerDevice: number;
  // Manufacturer-specified max devices per branch circuit (from datasheet)
  // Used instead of NEC 125% calculation when manufacturer specifies it explicitly
  maxPerBranch20A?: number; // max devices on a 20A branch per manufacturer datasheet
  maxPerBranch30A?: number; // max devices on a 30A branch per manufacturer datasheet
  isNew?: boolean; // UI badge flag
}

export interface Optimizer {
  id: string;
  manufacturer: string;
  model: string;
  category: 'optimizer';
  dcInputWMax: number;
  maxDcVoltage: number; // V
  mpptVoltageMin: number; // V
  mpptVoltageMax: number; // V
  maxInputCurrent: number; // A
  maxOutputCurrent: number; // A
  efficiency: number; // %
  weight: number; // lbs
  warranty: string;
  ulListing: string;
  compatibleInverters: string[];
  datasheetUrl: string;
  isNew?: boolean; // UI badge flag
}

export interface RackingSystem {
  id: string;
  manufacturer: string;
  model: string;
  category: 'racking';
  systemType: 'roof' | 'ground' | 'flat_roof' | 'fence' | 'carport';
  roofTypes: string[];
  maxWindSpeed: number; // mph
  maxSnowLoad: number; // psf
  railSpanMax: number; // inches
  attachmentSpacingMax: number; // inches
  weight: number; // lbs per linear foot
  material: string;
  warranty: string;
  ulListing: string;
  attachmentMethod: string;
  hardware: string;
  installNotes: string;
  datasheetUrl: string;
  // Structural load model fields (optional — for discrete attachment systems)
  loadModel?: 'distributed' | 'discrete';
  fastenersPerAttachment?: number;  // lag bolts per attachment point
  upliftCapacity?: number;          // lbf per fastener (ICC-ES rated)
  tributaryArea?: number;           // ft² per attachment point
}

export interface Conductor {
  id: string;
  gauge: string; // AWG
  type: string; // THWN-2, USE-2, PV Wire
  ampacity_60c: number; // A
  ampacity_75c: number; // A
  ampacity_90c: number; // A
  dcResistance: number; // ohms/1000ft
  acResistance: number; // ohms/1000ft
  outerDiameter: number; // inches
}

export interface Conduit {
  id: string;
  type: string; // EMT, PVC Sch 40, etc.
  tradeSize: string; // 1/2", 3/4", 1", etc.
  innerDiameter: number; // inches
  area: number; // sq inches
  maxFillArea_1wire: number; // sq in (53%)
  maxFillArea_2wire: number; // sq in (31%)
  maxFillArea_3plus: number; // sq in (40%)
}

// ============================================================
// SEEDED DATA
// ============================================================

export const SOLAR_PANELS: SolarPanel[] = [
  // SunPower
  {
    id: 'sp-maxeon7-440',
    manufacturer: 'SunPower',
    model: 'Maxeon 7 440W',
    category: 'solar_panel',
    watts: 440, efficiency: 22.8,
    voc: 51.6, vmp: 43.4, isc: 10.89, imp: 10.14,
    tempCoeffVoc: -0.27, tempCoeffIsc: 0.05, tempCoeffPmax: -0.27,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 45, parallelStringLimit: 3,
    weight: 41.9, length: 73.0, width: 41.2, thickness: 1.57,
    warranty: '40yr product / 40yr power', ulListing: 'UL 61730',
    bifacial: false, cellType: 'N-type TOPCon',
    datasheetUrl: 'https://us.sunpower.com/sites/default/files/maxeon-7-datasheet.pdf',
  },
  {
    id: 'sp-maxeon6-400',
    manufacturer: 'SunPower',
    model: 'Maxeon 6 400W',
    category: 'solar_panel',
    watts: 400, efficiency: 22.7,
    voc: 47.1, vmp: 39.5, isc: 10.89, imp: 10.14,
    tempCoeffVoc: -0.27, tempCoeffIsc: 0.05, tempCoeffPmax: -0.27,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 45, parallelStringLimit: 3,
    weight: 38.6, length: 66.9, width: 41.2, thickness: 1.57,
    warranty: '40yr product / 40yr power', ulListing: 'UL 61730',
    bifacial: false, cellType: 'N-type TOPCon',
    datasheetUrl: 'https://us.sunpower.com/sites/default/files/maxeon-6-datasheet.pdf',
  },
  // REC Group
  {
    id: 'rec-alpha-pure-430',
    manufacturer: 'REC Group',
    model: 'Alpha Pure-R 430W',
    category: 'solar_panel',
    watts: 430, efficiency: 23.2,
    voc: 48.9, vmp: 41.4, isc: 11.14, imp: 10.39,
    tempCoeffVoc: -0.24, tempCoeffIsc: 0.04, tempCoeffPmax: -0.26,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 44, parallelStringLimit: 3,
    weight: 44.1, length: 70.9, width: 41.7, thickness: 1.57,
    warranty: '25yr product / 25yr power', ulListing: 'UL 61730',
    bifacial: false, cellType: 'HJT',
    datasheetUrl: 'https://www.recgroup.com/sites/default/files/documents/ds_rec_alpha_pure-r_us.pdf',
  },
  // Panasonic
  {
    id: 'pan-evervolt-410',
    manufacturer: 'Panasonic',
    model: 'EverVolt HK Black 410W',
    category: 'solar_panel',
    watts: 410, efficiency: 22.2,
    voc: 51.9, vmp: 43.7, isc: 10.06, imp: 9.39,
    tempCoeffVoc: -0.25, tempCoeffIsc: 0.04, tempCoeffPmax: -0.26,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 44, parallelStringLimit: 3,
    weight: 44.1, length: 70.9, width: 41.7, thickness: 1.57,
    warranty: '25yr product / 25yr power', ulListing: 'UL 61730',
    bifacial: false, cellType: 'HJT',
    datasheetUrl: 'https://na.panasonic.com/us/energy-products-solutions/solar/evervolt-solar-panels',
  },
  // Jinko Solar
  {
    id: 'jinko-tiger-neo-580',
    manufacturer: 'Jinko Solar',
    model: 'Tiger Neo N-type 580W',
    category: 'solar_panel',
    watts: 580, efficiency: 22.4,
    voc: 49.52, vmp: 41.74, isc: 14.96, imp: 13.90,
    tempCoeffVoc: -0.24, tempCoeffIsc: 0.05, tempCoeffPmax: -0.29,
    maxSystemVoltage: 1500, maxSeriesFuseRating: 25,
    nominalOperatingTemp: 43, parallelStringLimit: 4,
    weight: 57.3, length: 87.6, width: 44.5, thickness: 1.38,
    warranty: '30yr product / 30yr power', ulListing: 'UL 61730',
    bifacial: true, cellType: 'N-type TOPCon',
    datasheetUrl: 'https://www.jinkosolar.com/en/site/getFile?fileId=1',
  },
  // Canadian Solar
  {
    id: 'cs-hiku7-600',
    manufacturer: 'Canadian Solar',
    model: 'HiKu7 Bifacial 600W',
    category: 'solar_panel',
    watts: 600, efficiency: 21.9,
    voc: 49.80, vmp: 41.80, isc: 15.40, imp: 14.36,
    tempCoeffVoc: -0.25, tempCoeffIsc: 0.05, tempCoeffPmax: -0.34,
    maxSystemVoltage: 1500, maxSeriesFuseRating: 25,
    nominalOperatingTemp: 43, parallelStringLimit: 4,
    weight: 61.7, length: 90.6, width: 45.1, thickness: 1.38,
    warranty: '25yr product / 25yr power', ulListing: 'UL 61730',
    bifacial: true, cellType: 'mono-PERC',
    datasheetUrl: 'https://www.canadiansolar.com/hiku7/',
  },
  // LONGi Solar
  {
    id: 'longi-himo6-580',
    manufacturer: 'LONGi Solar',
    model: 'Hi-MO 6 580W',
    category: 'solar_panel',
    watts: 580, efficiency: 22.4,
    voc: 49.65, vmp: 41.95, isc: 14.90, imp: 13.83,
    tempCoeffVoc: -0.24, tempCoeffIsc: 0.05, tempCoeffPmax: -0.29,
    maxSystemVoltage: 1500, maxSeriesFuseRating: 25,
    nominalOperatingTemp: 43, parallelStringLimit: 4,
    weight: 57.3, length: 87.6, width: 44.5, thickness: 1.38,
    warranty: '30yr product / 30yr power', ulListing: 'UL 61730',
    bifacial: true, cellType: 'N-type TOPCon',
    datasheetUrl: 'https://www.longi.com/en/products/modules/hi-mo-6/',
  },
  // Trina Solar
  {
    id: 'trina-vertex-s-435',
    manufacturer: 'Trina Solar',
    model: 'Vertex S+ 435W',
    category: 'solar_panel',
    watts: 435, efficiency: 22.6,
    voc: 37.80, vmp: 31.60, isc: 14.72, imp: 13.77,
    tempCoeffVoc: -0.24, tempCoeffIsc: 0.05, tempCoeffPmax: -0.29,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 43, parallelStringLimit: 3,
    weight: 44.1, length: 70.9, width: 41.7, thickness: 1.38,
    warranty: '25yr product / 25yr power', ulListing: 'UL 61730',
    bifacial: false, cellType: 'N-type TOPCon',
    datasheetUrl: 'https://www.trinasolar.com/en-glb/product/vertex-s-plus',
  },
  // Q CELLS
  {
    id: 'qcells-peak-duo-400',
    manufacturer: 'Q CELLS',
    model: 'Q.PEAK DUO BLK ML-G10+ 400W',
    category: 'solar_panel',
    watts: 400, efficiency: 22.4,
    voc: 41.60, vmp: 34.50, isc: 12.26, imp: 11.59,
    tempCoeffVoc: -0.26, tempCoeffIsc: 0.05, tempCoeffPmax: -0.35,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 45, parallelStringLimit: 3,
    weight: 44.1, length: 70.9, width: 41.7, thickness: 1.38,
    warranty: '25yr product / 25yr power', ulListing: 'UL 61730',
    bifacial: false, cellType: 'mono-PERC',
    datasheetUrl: 'https://www.q-cells.us/products/q-peak-duo-blk-ml-g10-plus.html',
  },
  // Silfab
  {
    id: 'silfab-sil430',
    manufacturer: 'Silfab Solar',
    model: 'SIL-430 BG',
    category: 'solar_panel',
    watts: 430, efficiency: 21.8,
    voc: 41.20, vmp: 34.40, isc: 13.30, imp: 12.50,
    tempCoeffVoc: -0.26, tempCoeffIsc: 0.05, tempCoeffPmax: -0.35,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 45, parallelStringLimit: 3,
    weight: 44.1, length: 70.9, width: 41.7, thickness: 1.38,
    warranty: '30yr product / 30yr power', ulListing: 'UL 61730',
    bifacial: true, cellType: 'mono-PERC',
    datasheetUrl: 'https://silfabsolar.com/sil-430-bg/',
  },
];

export const STRING_INVERTERS: StringInverter[] = [
  {
    id: 'se-7600h',
    manufacturer: 'SolarEdge',
    model: 'SE7600H-US',
    category: 'string_inverter',
    acOutputKw: 7.6, dcInputKwMax: 11.4,
    maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 8, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-hd-wave-single-phase-inverter-datasheet-na.pdf',
  },
  {
    id: 'se-10000h',
    manufacturer: 'SolarEdge',
    model: 'SE10000H-US',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 8, max: 15 },
    acOutputVoltage: 240, acOutputCurrentMax: 42,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-hd-wave-single-phase-inverter-datasheet-na.pdf',
  },
  {
    id: 'fronius-primo-7.6',
    manufacturer: 'Fronius',
    model: 'Primo 7.6-1',
    category: 'string_inverter',
    acOutputKw: 7.6, dcInputKwMax: 11.4,
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 18.0, maxShortCircuitCurrent: 22.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 6, max: 14 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 34.2, dimensions: '22.2 x 17.7 x 6.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    datasheetUrl: 'https://www.fronius.com/en-us/usa/photovoltaics/products/all-products/inverters/fronius-primo/fronius-primo-7-6-1',
  },
  {
    id: 'sma-sb-7.7',
    manufacturer: 'SMA',
    model: 'Sunny Boy 7.7-US',
    category: 'string_inverter',
    acOutputKw: 7.7, dcInputKwMax: 11.55,
    maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 15.0, maxShortCircuitCurrent: 18.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 6, max: 14 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 48.5, dimensions: '24.0 x 18.0 x 8.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    datasheetUrl: 'https://www.sma-america.com/products/solarinverters/sunny-boy-us.html',
  },
  {
    id: 'sungrow-sg10rs',
    manufacturer: 'Sungrow',
    model: 'SG10RS',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 600, mpptVoltageMin: 40, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 14.0, maxShortCircuitCurrent: 17.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 8, max: 15 },
    acOutputVoltage: 240, acOutputCurrentMax: 42,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 26.5, dimensions: '17.3 x 14.2 x 6.9',
    warranty: '10yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.sungrowpower.com/products/inverter/sg10rs',
  },
  // ── SolarEdge HD-Wave expanded lineup ─────────────────────────────────────
  {
    id: 'se-3800h',
    manufacturer: 'SolarEdge',
    model: 'SE3800H-US',
    category: 'string_inverter',
    acOutputKw: 3.8, dcInputKwMax: 5.7,
    maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.0, mpptChannels: 1, numberOfMPPT: 1,
    recommendedStringRange: { min: 6, max: 10 },
    acOutputVoltage: 240, acOutputCurrentMax: 16,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-hd-wave-single-phase-inverter-datasheet-na.pdf',
    isNew: true,
  },
  {
    id: 'se-6000h',
    manufacturer: 'SolarEdge',
    model: 'SE6000H-US',
    category: 'string_inverter',
    acOutputKw: 6.0, dcInputKwMax: 9.0,
    maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 6, max: 12 },
    acOutputVoltage: 240, acOutputCurrentMax: 25,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-hd-wave-single-phase-inverter-datasheet-na.pdf',
    isNew: true,
  },
  {
    id: 'se-11400h',
    manufacturer: 'SolarEdge',
    model: 'SE11400H-US',
    category: 'string_inverter',
    acOutputKw: 11.4, dcInputKwMax: 17.1,
    maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 10, max: 18 },
    acOutputVoltage: 240, acOutputCurrentMax: 47.5,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-hd-wave-single-phase-inverter-datasheet-na.pdf',
    isNew: true,
  },
  // ── SMA Sunny Boy expanded lineup ─────────────────────────────────────────
  {
    id: 'sma-sb-5.0',
    manufacturer: 'SMA',
    model: 'Sunny Boy 5.0-US',
    category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 7.5,
    maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 15.0, maxShortCircuitCurrent: 18.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 5, max: 11 },
    acOutputVoltage: 240, acOutputCurrentMax: 21,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 48.5, dimensions: '24.0 x 18.0 x 8.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    datasheetUrl: 'https://www.sma-america.com/products/solarinverters/sunny-boy-us.html',
    isNew: true,
  },
  {
    id: 'sma-sb-10.0',
    manufacturer: 'SMA',
    model: 'Sunny Boy 10.0-US',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 15.0, maxShortCircuitCurrent: 18.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 8, max: 16 },
    acOutputVoltage: 240, acOutputCurrentMax: 42,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 48.5, dimensions: '24.0 x 18.0 x 8.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    datasheetUrl: 'https://www.sma-america.com/products/solarinverters/sunny-boy-us.html',
    isNew: true,
  },
  // ── Fronius Primo expanded lineup ──────────────────────────────────────────
  {
    id: 'fronius-primo-5.0',
    manufacturer: 'Fronius',
    model: 'Primo 5.0-1',
    category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 7.5,
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 18.0, maxShortCircuitCurrent: 22.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 5, max: 11 },
    acOutputVoltage: 240, acOutputCurrentMax: 21,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 34.2, dimensions: '22.2 x 17.7 x 6.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    datasheetUrl: 'https://www.fronius.com/en-us/usa/photovoltaics/products/all-products/inverters/fronius-primo',
    isNew: true,
  },
  {
    id: 'fronius-primo-10.0',
    manufacturer: 'Fronius',
    model: 'Primo 10.0-1',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 18.0, maxShortCircuitCurrent: 22.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 8, max: 16 },
    acOutputVoltage: 240, acOutputCurrentMax: 42,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 34.2, dimensions: '22.2 x 17.7 x 6.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    datasheetUrl: 'https://www.fronius.com/en-us/usa/photovoltaics/products/all-products/inverters/fronius-primo',
    isNew: true,
  },
  // ── Sungrow expanded lineup ────────────────────────────────────────────────
  {
    id: 'sungrow-sg5rs',
    manufacturer: 'Sungrow',
    model: 'SG5RS',
    category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 7.5,
    maxDcVoltage: 600, mpptVoltageMin: 40, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 14.0, maxShortCircuitCurrent: 17.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 5, max: 11 },
    acOutputVoltage: 240, acOutputCurrentMax: 21,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 24.0, dimensions: '16.5 x 13.8 x 6.5',
    warranty: '10yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.sungrowpower.com/products/inverter/sg5rs',
    isNew: true,
  },
  {
    id: 'sungrow-sg7.6rs',
    manufacturer: 'Sungrow',
    model: 'SG7.6RS',
    category: 'string_inverter',
    acOutputKw: 7.6, dcInputKwMax: 11.4,
    maxDcVoltage: 600, mpptVoltageMin: 40, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 14.0, maxShortCircuitCurrent: 17.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 6, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 24.0, dimensions: '16.5 x 13.8 x 6.5',
    warranty: '10yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.sungrowpower.com/products/inverter/sg7.6rs',
    isNew: true,
  },
  {
    id: 'sungrow-sg15rs',
    manufacturer: 'Sungrow',
    model: 'SG15RS',
    category: 'string_inverter',
    acOutputKw: 15.0, dcInputKwMax: 22.5,
    maxDcVoltage: 600, mpptVoltageMin: 40, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 14.0, maxShortCircuitCurrent: 17.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 10, max: 20 },
    acOutputVoltage: 240, acOutputCurrentMax: 62.5,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 28.0, dimensions: '17.3 x 14.2 x 6.9',
    warranty: '10yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.sungrowpower.com/products/inverter/sg15rs',
    isNew: true,
  },
  // ── GoodWe lineup ─────────────────────────────────────────────────────────
  {
    id: 'goodwe-gw5000-ns',
    manufacturer: 'GoodWe',
    model: 'GW5000-NS',
    category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 7.5,
    maxDcVoltage: 600, mpptVoltageMin: 90, mpptVoltageMax: 550,
    maxInputCurrentPerMppt: 12.5, maxShortCircuitCurrent: 15.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 5, max: 11 },
    acOutputVoltage: 240, acOutputCurrentMax: 21,
    efficiency: 97.8, cec_efficiency: 97.5,
    weight: 22.0, dimensions: '15.7 x 13.4 x 6.3',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.goodwe.com/products/inverter/gw5000-ns',
    isNew: true,
  },
  {
    id: 'goodwe-gw10k-ms',
    manufacturer: 'GoodWe',
    model: 'GW10K-MS',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 600, mpptVoltageMin: 90, mpptVoltageMax: 550,
    maxInputCurrentPerMppt: 12.5, maxShortCircuitCurrent: 15.0, mpptChannels: 2, numberOfMPPT: 2,
    recommendedStringRange: { min: 8, max: 16 },
    acOutputVoltage: 240, acOutputCurrentMax: 42,
    efficiency: 97.8, cec_efficiency: 97.5,
    weight: 26.0, dimensions: '16.5 x 14.0 x 6.5',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    datasheetUrl: 'https://www.goodwe.com/products/inverter/gw10k-ms',
    isNew: true,
  },
];

export const MICROINVERTERS: Microinverter[] = [
  {
    id: 'enphase-iq8plus',
    manufacturer: 'Enphase',
    model: 'IQ8+',
    category: 'microinverter',
    acOutputW: 295, dcInputWMax: 440,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 14.0,
    acOutputVoltage: 240, acOutputCurrentMax: 1.21,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 2.2,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://enphase.com/store/microinverters/iq8-series',
    modulesPerDevice: 1,
  },
  {
    id: 'enphase-iq8m',
    manufacturer: 'Enphase',
    model: 'IQ8M',
    category: 'microinverter',
    acOutputW: 330, dcInputWMax: 460,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 14.0,
    acOutputVoltage: 240, acOutputCurrentMax: 1.39,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 2.2,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://enphase.com/store/microinverters/iq8-series',
    modulesPerDevice: 1,
  },
  {
    id: 'enphase-iq8h',
    manufacturer: 'Enphase',
    model: 'IQ8H',
    category: 'microinverter',
    acOutputW: 380, dcInputWMax: 600,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 15.0,
    acOutputVoltage: 240, acOutputCurrentMax: 1.59,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 2.2,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://enphase.com/store/microinverters/iq8-series',
    modulesPerDevice: 1,
  },
  // ── APsystems DS3 Series ─────────────────────────────────────────────────
  // Dual-module microinverter: 1 device connects to 2 PV modules (modulesPerDevice: 2)
  // Source: APsystems DS3 Series North America Datasheet Rev1.1 (usa.APsystems.com)
  // All three models: 240V nominal, 60Hz, UL 1741-SA, NEC 2020 690.12 RSD compliant
  {
    id: 'apsystems-ds3s',
    manufacturer: 'APsystems',
    model: 'DS3-S',
    category: 'microinverter',
    // AC Output: 640VA nominal, 2.7A nominal output current at 240V
    acOutputW: 640, dcInputWMax: 960,
    maxDcVoltage: 60, mpptVoltageMin: 22, mpptVoltageMax: 48,
    maxInputCurrent: 16.0,  // 16A × 2 MPPT channels
    acOutputVoltage: 240, acOutputCurrentMax: 2.7,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 5.7,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547 / CA Rule 21',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://usa.apsystems.com/products/ds3/',
    modulesPerDevice: 2,
    maxPerBranch20A: 6,  // per datasheet: max 6 units on 20A branch
    maxPerBranch30A: 8,  // per datasheet: max 8 units on 30A branch
  },
  {
    id: 'apsystems-ds3l',
    manufacturer: 'APsystems',
    model: 'DS3-L',
    category: 'microinverter',
    // AC Output: 768VA nominal, 3.20A nominal output current at 240V
    acOutputW: 768, dcInputWMax: 1140,
    maxDcVoltage: 60, mpptVoltageMin: 25, mpptVoltageMax: 55,
    maxInputCurrent: 18.0,  // 18A × 2 MPPT channels
    acOutputVoltage: 240, acOutputCurrentMax: 3.20,
    efficiency: 96.5, cec_efficiency: 96.0,
    weight: 5.7,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547 / CA Rule 21',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://usa.apsystems.com/products/ds3/',
    modulesPerDevice: 2,
    maxPerBranch20A: 5,  // per datasheet: max 5 units on 20A branch
    maxPerBranch30A: 7,  // per datasheet: max 7 units on 30A branch
  },
  {
    id: 'apsystems-ds3',
    manufacturer: 'APsystems',
    model: 'DS3',
    category: 'microinverter',
    // AC Output: 880VA nominal, 3.7A nominal output current at 240V
    acOutputW: 880, dcInputWMax: 1320,
    maxDcVoltage: 60, mpptVoltageMin: 32, mpptVoltageMax: 55,
    maxInputCurrent: 20.0,  // 20A × 2 MPPT channels
    acOutputVoltage: 240, acOutputCurrentMax: 3.7,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 5.7,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547 / CA Rule 21',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://usa.apsystems.com/products/ds3/',
    modulesPerDevice: 2,
    maxPerBranch20A: 4,  // per datasheet: max 4 units on 20A branch
    maxPerBranch30A: 6,  // per datasheet: max 6 units on 30A branch
  },
  {
    id: 'hoymiles-hm800',
    manufacturer: 'Hoymiles',
    model: 'HM-800',
    category: 'microinverter',
    acOutputW: 800, dcInputWMax: 960,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 14.0,
    acOutputVoltage: 240, acOutputCurrentMax: 3.33,
    efficiency: 96.7, cec_efficiency: 96.2,
    weight: 3.3,
    warranty: '25yr', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://www.hoymiles.com/products/microinverter/hm-series/',
    modulesPerDevice: 2,
  },
  // ── Enphase IQ8 expanded lineup ────────────────────────────────────────────
  {
    id: 'enphase-iq8a',
    manufacturer: 'Enphase',
    model: 'IQ8A',
    category: 'microinverter',
    // IQ8A: 349W AC output, 1.46A nominal — designed for high-power modules up to 460W DC
    acOutputW: 349, dcInputWMax: 460,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 15.0,
    acOutputVoltage: 240, acOutputCurrentMax: 1.46,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 2.2,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://enphase.com/store/microinverters/iq8-series',
    modulesPerDevice: 1,
    isNew: true,
  },
  {
    id: 'enphase-iq8ac',
    manufacturer: 'Enphase',
    model: 'IQ8AC',
    category: 'microinverter',
    // IQ8AC: 384W AC output, 1.60A nominal — highest output single-module IQ8 for 500W+ modules
    acOutputW: 384, dcInputWMax: 530,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 15.0,
    acOutputVoltage: 240, acOutputCurrentMax: 1.60,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 2.2,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://enphase.com/store/microinverters/iq8-series',
    modulesPerDevice: 1,
    isNew: true,
  },
  // ── APsystems EZ1-M ────────────────────────────────────────────────────────
  {
    id: 'apsystems-ez1-m',
    manufacturer: 'APsystems',
    model: 'EZ1-M',
    category: 'microinverter',
    // EZ1-M: 800W AC output, single-phase, plug-and-play balcony/small system microinverter
    acOutputW: 800, dcInputWMax: 960,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 14.0,
    acOutputVoltage: 240, acOutputCurrentMax: 3.33,
    efficiency: 96.7, cec_efficiency: 96.2,
    weight: 3.5,
    warranty: '10yr', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://usa.apsystems.com/products/ez1/',
    modulesPerDevice: 2,
    isNew: true,
  },
  // ── Hoymiles HMS-800W-2T ───────────────────────────────────────────────────
  {
    id: 'hoymiles-hms-800w-2t',
    manufacturer: 'Hoymiles',
    model: 'HMS-800W-2T',
    category: 'microinverter',
    // HMS-800W-2T: 800W AC, dual-module, MLPE with integrated rapid shutdown
    acOutputW: 800, dcInputWMax: 960,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 14.0,
    acOutputVoltage: 240, acOutputCurrentMax: 3.33,
    efficiency: 96.7, cec_efficiency: 96.2,
    weight: 3.3,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://www.hoymiles.com/products/microinverter/hms-series/',
    modulesPerDevice: 2,
    isNew: true,
  },
];

export const OPTIMIZERS: Optimizer[] = [
  {
    id: 'se-p401',
    manufacturer: 'SolarEdge',
    model: 'P401',
    category: 'optimizer',
    dcInputWMax: 400, maxDcVoltage: 80,
    mpptVoltageMin: 8, mpptVoltageMax: 80,
    maxInputCurrent: 15.0, maxOutputCurrent: 15.0,
    efficiency: 99.5, weight: 0.77,
    warranty: '25yr', ulListing: 'UL 1741',
    compatibleInverters: ['SolarEdge SE series'],
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-p-series-add-on-power-optimizer-datasheet.pdf',
  },
  {
    id: 'se-p505',
    manufacturer: 'SolarEdge',
    model: 'P505',
    category: 'optimizer',
    dcInputWMax: 505, maxDcVoltage: 80,
    mpptVoltageMin: 8, mpptVoltageMax: 80,
    maxInputCurrent: 15.0, maxOutputCurrent: 15.0,
    efficiency: 99.5, weight: 0.77,
    warranty: '25yr', ulListing: 'UL 1741',
    compatibleInverters: ['SolarEdge SE series'],
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-p-series-add-on-power-optimizer-datasheet.pdf',
  },
  {
    id: 'tigo-ts4-a-o',
    manufacturer: 'Tigo',
    model: 'TS4-A-O',
    category: 'optimizer',
    dcInputWMax: 700, maxDcVoltage: 80,
    mpptVoltageMin: 16, mpptVoltageMax: 80,
    maxInputCurrent: 15.0, maxOutputCurrent: 15.0,
    efficiency: 99.6, weight: 0.55,
    warranty: '25yr', ulListing: 'UL 1741',
    compatibleInverters: ['SMA', 'Fronius', 'SolarEdge', 'Sungrow'],
    datasheetUrl: 'https://www.tigoenergy.com/ts4',
  },
  // ── SolarEdge P-Series expanded ────────────────────────────────────────────
  {
    id: 'se-p320',
    manufacturer: 'SolarEdge',
    model: 'P320',
    category: 'optimizer',
    // P320: for modules up to 320W — standard residential optimizer
    dcInputWMax: 320, maxDcVoltage: 80,
    mpptVoltageMin: 8, mpptVoltageMax: 80,
    maxInputCurrent: 15.0, maxOutputCurrent: 15.0,
    efficiency: 99.5, weight: 0.77,
    warranty: '25yr', ulListing: 'UL 1741',
    compatibleInverters: ['SolarEdge SE series'],
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-p-series-add-on-power-optimizer-datasheet.pdf',
    isNew: true,
  },
  {
    id: 'se-p730',
    manufacturer: 'SolarEdge',
    model: 'P730',
    category: 'optimizer',
    // P730: for modules up to 730W — high-power module optimizer
    dcInputWMax: 730, maxDcVoltage: 80,
    mpptVoltageMin: 8, mpptVoltageMax: 80,
    maxInputCurrent: 15.0, maxOutputCurrent: 15.0,
    efficiency: 99.5, weight: 0.77,
    warranty: '25yr', ulListing: 'UL 1741',
    compatibleInverters: ['SolarEdge SE series'],
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-p-series-add-on-power-optimizer-datasheet.pdf',
    isNew: true,
  },
  {
    id: 'se-p850',
    manufacturer: 'SolarEdge',
    model: 'P850',
    category: 'optimizer',
    // P850: for modules up to 850W — commercial/high-power residential optimizer
    dcInputWMax: 850, maxDcVoltage: 80,
    mpptVoltageMin: 8, mpptVoltageMax: 80,
    maxInputCurrent: 15.0, maxOutputCurrent: 15.0,
    efficiency: 99.5, weight: 0.77,
    warranty: '25yr', ulListing: 'UL 1741',
    compatibleInverters: ['SolarEdge SE series'],
    datasheetUrl: 'https://www.solaredge.com/sites/default/files/se-p-series-add-on-power-optimizer-datasheet.pdf',
    isNew: true,
  },
  // ── Tigo TS4-A-2O (dual-module optimizer) ─────────────────────────────────
  {
    id: 'tigo-ts4-a-2o',
    manufacturer: 'Tigo',
    model: 'TS4-A-2O',
    category: 'optimizer',
    // TS4-A-2O: dual-module optimizer — one unit handles 2 modules (up to 700W each)
    dcInputWMax: 1400, maxDcVoltage: 80,
    mpptVoltageMin: 16, mpptVoltageMax: 80,
    maxInputCurrent: 30.0, maxOutputCurrent: 30.0,
    efficiency: 99.6, weight: 0.77,
    warranty: '25yr', ulListing: 'UL 1741',
    compatibleInverters: ['SMA', 'Fronius', 'SolarEdge', 'Sungrow', 'GoodWe'],
    datasheetUrl: 'https://www.tigoenergy.com/ts4',
    isNew: true,
  },
];

export const RACKING_SYSTEMS: RackingSystem[] = [
  {
    id: 'ironridge-xr100',
    manufacturer: 'IronRidge',
    model: 'XR100 Rail System',
    category: 'racking',
    systemType: 'roof',
    roofTypes: ['shingle', 'tile', 'metal_corrugated'],
    maxWindSpeed: 160, maxSnowLoad: 50,
    railSpanMax: 72, attachmentSpacingMax: 72,
    weight: 1.2, material: '6005-T5 Aluminum',
    warranty: '20yr', ulListing: 'UL 2703',
    attachmentMethod: 'L-foot with lag bolt into rafter',
    hardware: 'XR100 rail, L-feet, 5/16" × 3" lag bolts, EPDM flashing',
    installNotes: 'Locate rafters with stud finder. Min 2.5" embedment. Flash all penetrations.',
    datasheetUrl: 'https://ironridge.com/roof-mount/xr-rail/',
  },
  {
    id: 'unirac-solarmount',
    manufacturer: 'Unirac',
    model: 'SolarMount',
    category: 'racking',
    systemType: 'roof',
    roofTypes: ['shingle', 'tile', 'metal_corrugated', 'metal_standing_seam'],
    maxWindSpeed: 150, maxSnowLoad: 50,
    railSpanMax: 72, attachmentSpacingMax: 72,
    weight: 1.1, material: '6005-T5 Aluminum',
    warranty: '20yr', ulListing: 'UL 2703',
    attachmentMethod: 'L-foot or standoff with lag bolt',
    hardware: 'SolarMount rail, L-feet or standoffs, 5/16" lag bolts, flashing',
    installNotes: 'Verify rafter spacing. Use appropriate L-foot height for roof type.',
    datasheetUrl: 'https://unirac.com/products/solarmount/',
  },
  {
    id: 'snapnrack-100',
    manufacturer: 'SnapNrack',
    model: 'Series 100',
    category: 'racking',
    systemType: 'roof',
    roofTypes: ['shingle', 'tile'],
    maxWindSpeed: 150, maxSnowLoad: 50,
    railSpanMax: 72, attachmentSpacingMax: 72,
    weight: 1.0, material: '6005-T5 Aluminum',
    warranty: '20yr', ulListing: 'UL 2703',
    attachmentMethod: 'Snap-in L-foot with lag bolt',
    hardware: 'Series 100 rail, snap-in L-feet, 5/16" lag bolts, flashing',
    installNotes: 'Fast snap-in installation. Verify rafter locations.',
    datasheetUrl: 'https://snapnrack.com/products/series-100/',
  },
  {
    id: 'quickmount-classic',
    manufacturer: 'QuickMount PV',
    model: 'Classic Mount',
    category: 'racking',
    systemType: 'roof',
    roofTypes: ['shingle', 'tile'],
    maxWindSpeed: 150, maxSnowLoad: 50,
    railSpanMax: 72, attachmentSpacingMax: 72,
    weight: 0.9, material: 'Aluminum / Stainless',
    warranty: '10yr', ulListing: 'UL 2703',
    attachmentMethod: 'Flashed mount with lag bolt',
    hardware: 'QMount, flashing, 5/16" lag bolts',
    installNotes: 'Waterproof flashing system. Best for shingle and tile.',
    datasheetUrl: 'https://quickmountpv.com/products/classic-mount/',
  },
  {
    id: 'esdec-flatfix',
    manufacturer: 'Esdec',
    model: 'FlatFix Fusion',
    category: 'racking',
    systemType: 'flat_roof',
    roofTypes: ['flat_tpo', 'flat_epdm', 'flat_gravel'],
    maxWindSpeed: 130, maxSnowLoad: 30,
    railSpanMax: 84, attachmentSpacingMax: 84,
    weight: 2.5, material: 'Aluminum / HDPE',
    warranty: '20yr', ulListing: 'UL 2703',
    attachmentMethod: 'Ballasted tray (no penetrations)',
    hardware: 'FlatFix base, ballast blocks, connecting rails',
    installNotes: 'No roof penetrations. Verify roof load capacity. Clear gravel from footprint.',
    datasheetUrl: 'https://esdec.com/products/flatfix-fusion/',
  },
  {
    id: 's5-pvkit',
    manufacturer: 'S-5!',
    model: 'PVKIT 2.0',
    category: 'racking',
    systemType: 'roof',
    roofTypes: ['metal_standing_seam'],
    maxWindSpeed: 160, maxSnowLoad: 50,
    railSpanMax: 72, attachmentSpacingMax: 72,
    weight: 0.5, material: 'Stainless Steel / Aluminum',
    warranty: '25yr', ulListing: 'UL 2703',
    attachmentMethod: 'S-5! clamp on standing seam (no penetrations)',
    hardware: 'S-5! clamps, PVKIT rails, mid/end clamps',
    installNotes: 'No roof penetrations. Clamp directly to seam. Verify seam profile.',
    datasheetUrl: 'https://www.s-5.com/products/pvkit/',
  },
  // FIX: Roof Tech Mini — discrete load model (dual-lag per attachment)
  {
    id: 'rooftech-mini',
    manufacturer: 'Roof Tech',
    model: 'RT-MINI Rail-Less',
    category: 'racking',
    systemType: 'roof',
    roofTypes: ['shingle', 'tile'],
    maxWindSpeed: 150, maxSnowLoad: 45,
    railSpanMax: 0, attachmentSpacingMax: 48,
    weight: 0.6, material: 'Aluminum / EPDM',
    warranty: '20yr', ulListing: 'ICC-ES ESR-3575 / UL 2703',
    attachmentMethod: 'Direct attachment — 2 lag bolts per RT-MINI foot (no rail)',
    hardware: 'RT-MINI mount, integrated EPDM flashing, 5/16" × 3" lag bolts (×2 per mount)',
    installNotes: 'Rail-less direct attachment. 2 lag bolts per mount. ICC-ES ESR-3575 rated.',
    datasheetUrl: 'https://www.roof-tech.com/rt-mini',
    // Discrete load model: uplift evaluated per attachment point
    loadModel: 'discrete',
    fastenersPerAttachment: 2,   // 2 lag bolts per RT-MINI foot
    upliftCapacity: 450,         // lbf per lag bolt (ICC-ES ESR-3575)
    tributaryArea: 8.5,          // ft² per attachment point
  },
];

// NEC Table 310.15(B)(16) Ampacity values for common conductors
export const CONDUCTORS: Conductor[] = [
  { id: 'awg14-thwn2', gauge: '#14 AWG', type: 'THWN-2', ampacity_60c: 15, ampacity_75c: 20, ampacity_90c: 25, dcResistance: 3.14, acResistance: 3.14, outerDiameter: 0.171 },
  { id: 'awg12-thwn2', gauge: '#12 AWG', type: 'THWN-2', ampacity_60c: 20, ampacity_75c: 25, ampacity_90c: 30, dcResistance: 1.98, acResistance: 1.98, outerDiameter: 0.191 },
  { id: 'awg10-thwn2', gauge: '#10 AWG', type: 'THWN-2', ampacity_60c: 30, ampacity_75c: 35, ampacity_90c: 40, dcResistance: 1.24, acResistance: 1.24, outerDiameter: 0.216 },
  { id: 'awg8-thwn2',  gauge: '#8 AWG',  type: 'THWN-2', ampacity_60c: 40, ampacity_75c: 50, ampacity_90c: 55, dcResistance: 0.778, acResistance: 0.778, outerDiameter: 0.271 },
  { id: 'awg6-thwn2',  gauge: '#6 AWG',  type: 'THWN-2', ampacity_60c: 55, ampacity_75c: 65, ampacity_90c: 75, dcResistance: 0.491, acResistance: 0.491, outerDiameter: 0.322 },
  { id: 'awg4-thwn2',  gauge: '#4 AWG',  type: 'THWN-2', ampacity_60c: 70, ampacity_75c: 85, ampacity_90c: 95, dcResistance: 0.308, acResistance: 0.308, outerDiameter: 0.384 },
  { id: 'awg2-thwn2',  gauge: '#2 AWG',  type: 'THWN-2', ampacity_60c: 95, ampacity_75c: 115, ampacity_90c: 130, dcResistance: 0.194, acResistance: 0.194, outerDiameter: 0.450 },
  { id: 'awg1-thwn2',  gauge: '#1 AWG',  type: 'THWN-2', ampacity_60c: 110, ampacity_75c: 130, ampacity_90c: 150, dcResistance: 0.154, acResistance: 0.154, outerDiameter: 0.495 },
  { id: 'awg1_0-thwn2', gauge: '#1/0 AWG', type: 'THWN-2', ampacity_60c: 125, ampacity_75c: 150, ampacity_90c: 170, dcResistance: 0.122, acResistance: 0.122, outerDiameter: 0.554 },
  { id: 'awg2_0-thwn2', gauge: '#2/0 AWG', type: 'THWN-2', ampacity_60c: 145, ampacity_75c: 175, ampacity_90c: 195, dcResistance: 0.0967, acResistance: 0.0967, outerDiameter: 0.618 },
];

// EMT conduit inner diameters and fill areas (NEC Table 4)
export const CONDUITS: Conduit[] = [
  { id: 'emt-1/2', type: 'EMT', tradeSize: '1/2"', innerDiameter: 0.622, area: 0.304, maxFillArea_1wire: 0.161, maxFillArea_2wire: 0.094, maxFillArea_3plus: 0.122 },
  { id: 'emt-3/4', type: 'EMT', tradeSize: '3/4"', innerDiameter: 0.824, area: 0.533, maxFillArea_1wire: 0.283, maxFillArea_2wire: 0.165, maxFillArea_3plus: 0.213 },
  { id: 'emt-1',   type: 'EMT', tradeSize: '1"',   innerDiameter: 1.049, area: 0.864, maxFillArea_1wire: 0.458, maxFillArea_2wire: 0.268, maxFillArea_3plus: 0.346 },
  { id: 'emt-1.25', type: 'EMT', tradeSize: '1-1/4"', innerDiameter: 1.380, area: 1.496, maxFillArea_1wire: 0.793, maxFillArea_2wire: 0.464, maxFillArea_3plus: 0.598 },
  { id: 'emt-1.5', type: 'EMT', tradeSize: '1-1/2"', innerDiameter: 1.610, area: 2.036, maxFillArea_1wire: 1.079, maxFillArea_2wire: 0.631, maxFillArea_3plus: 0.814 },
  { id: 'emt-2',   type: 'EMT', tradeSize: '2"',   innerDiameter: 2.067, area: 3.356, maxFillArea_1wire: 1.778, maxFillArea_2wire: 1.040, maxFillArea_3plus: 1.342 },
  { id: 'pvc40-1/2', type: 'PVC Sch 40', tradeSize: '1/2"', innerDiameter: 0.602, area: 0.285, maxFillArea_1wire: 0.151, maxFillArea_2wire: 0.088, maxFillArea_3plus: 0.114 },
  { id: 'pvc40-3/4', type: 'PVC Sch 40', tradeSize: '3/4"', innerDiameter: 0.804, area: 0.508, maxFillArea_1wire: 0.269, maxFillArea_2wire: 0.157, maxFillArea_3plus: 0.203 },
  { id: 'pvc40-1',   type: 'PVC Sch 40', tradeSize: '1"',   innerDiameter: 1.029, area: 0.832, maxFillArea_1wire: 0.441, maxFillArea_2wire: 0.258, maxFillArea_3plus: 0.333 },
  { id: 'pvc40-1.25', type: 'PVC Sch 40', tradeSize: '1-1/4"', innerDiameter: 1.360, area: 1.453, maxFillArea_1wire: 0.770, maxFillArea_2wire: 0.450, maxFillArea_3plus: 0.581 },
];

// Helper functions
export function getPanelById(id: string): SolarPanel | undefined {
  return SOLAR_PANELS.find(p => p.id === id);
}

export function getInverterById(id: string): StringInverter | undefined {
  return STRING_INVERTERS.find(i => i.id === id);
}

export function getMicroinverterById(id: string): Microinverter | undefined {
  return MICROINVERTERS.find(m => m.id === id);
}

export function getRackingById(id: string): RackingSystem | undefined {
  return RACKING_SYSTEMS.find(r => r.id === id);
}

export function getConductorByGauge(gauge: string): Conductor | undefined {
  return CONDUCTORS.find(c => c.gauge === gauge);
}

export function getConduitByTypeAndSize(type: string, size: string): Conduit | undefined {
  return CONDUITS.find(c => c.type === type && c.tradeSize === size);
}
// ============================================================
// Battery Storage Systems
// ============================================================

export interface BatterySystem {
  id: string;
  manufacturer: string;
  model: string;
  category: 'battery';
  subcategory: 'ac_coupled' | 'dc_coupled';
  usableCapacityKwh: number;
  peakPowerKw: number;
  continuousPowerKw: number;
  roundTripEfficiencyPct: number;
  chemistry: 'LFP' | 'NMC' | 'NCA';
  voltageNominalV: number;
  // AC interconnection (ac_coupled)
  acOutputVoltageV?: number;
  maxContinuousOutputA?: number;
  backfeedBreakerA?: number;       // ← NEC 705.12(B): adds to bus loading
  minDedicatedBreakerA?: number;
  // Physical
  weightLbs: number;
  outdoorRated: boolean;
  ipRating: string;
  // Capabilities
  gridFormingCapable: boolean;
  backupCapable: boolean;
  wholeHomeBackup: boolean;
  requiresGateway: boolean;
  gatewayModel?: string;
  // Warranty
  warrantyYears: number;
  cycleGuarantee: string;
  capacityRetentionPct: number;
  // Pricing
  msrpUsd: number;
  // NEC references
  necRefs: string[];
  ulListing: string;
  certifications: string[];
  isNew?: boolean; // UI badge flag
}

export const BATTERIES: BatterySystem[] = [
  {
    id: 'tesla-powerwall-3',
    manufacturer: 'Tesla', model: 'Powerwall 3',
    category: 'battery', subcategory: 'ac_coupled',
    usableCapacityKwh: 13.5, peakPowerKw: 11.5, continuousPowerKw: 11.5,
    roundTripEfficiencyPct: 97.5, chemistry: 'LFP', voltageNominalV: 50,
    acOutputVoltageV: 240, maxContinuousOutputA: 48,
    backfeedBreakerA: 50,        // NEC 705.12(B): 50A breaker adds to bus loading
    minDedicatedBreakerA: 60,
    weightLbs: 287, outdoorRated: true, ipRating: 'IP67',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: true, gatewayModel: 'Tesla Backup Gateway 2',
    warrantyYears: 10, cycleGuarantee: 'Unlimited cycles', capacityRetentionPct: 70,
    msrpUsd: 9300,
    necRefs: ['NEC 705.12(B) — 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 — Energy Storage Systems', 'NEC 705.11 — supply-side connection option'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
  },
  {
    id: 'enphase-iq-battery-5p',
    manufacturer: 'Enphase', model: 'IQ Battery 5P',
    category: 'battery', subcategory: 'ac_coupled',
    usableCapacityKwh: 5.0, peakPowerKw: 3.84, continuousPowerKw: 3.84,
    roundTripEfficiencyPct: 96.0, chemistry: 'LFP', voltageNominalV: 48,
    acOutputVoltageV: 240, maxContinuousOutputA: 16,
    backfeedBreakerA: 20,        // NEC 705.12(B): 20A breaker adds to bus loading
    minDedicatedBreakerA: 20,
    weightLbs: 114, outdoorRated: true, ipRating: 'IP55',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: true, gatewayModel: 'Enphase IQ System Controller 3',
    warrantyYears: 15, cycleGuarantee: '4000 cycles', capacityRetentionPct: 70,
    msrpUsd: 4000,
    necRefs: ['NEC 705.12(B) — 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
  },
  {
    id: 'enphase-iq-battery-10t',
    manufacturer: 'Enphase', model: 'IQ Battery 10T',
    category: 'battery', subcategory: 'ac_coupled',
    usableCapacityKwh: 10.08, peakPowerKw: 7.68, continuousPowerKw: 7.68,
    roundTripEfficiencyPct: 96.0, chemistry: 'LFP', voltageNominalV: 48,
    acOutputVoltageV: 240, maxContinuousOutputA: 32,
    backfeedBreakerA: 40,        // NEC 705.12(B): 40A breaker adds to bus loading
    minDedicatedBreakerA: 40,
    weightLbs: 225, outdoorRated: true, ipRating: 'IP55',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: true, gatewayModel: 'Enphase IQ System Controller 3',
    warrantyYears: 15, cycleGuarantee: '4000 cycles', capacityRetentionPct: 70,
    msrpUsd: 7500,
    necRefs: ['NEC 705.12(B) — 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
  },
  {
    id: 'generac-pwrcell-9',
    manufacturer: 'Generac', model: 'PWRcell 9 kWh',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 9.0, peakPowerKw: 4.5, continuousPowerKw: 4.5,
    roundTripEfficiencyPct: 96.5, chemistry: 'NMC', voltageNominalV: 48,
    // DC coupled — no direct AC backfeed breaker; inverter handles AC output
    backfeedBreakerA: undefined, minDedicatedBreakerA: undefined,
    weightLbs: 195, outdoorRated: true, ipRating: 'IP65',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: true, gatewayModel: 'Generac PWRmanager',
    warrantyYears: 10, cycleGuarantee: '3650 cycles', capacityRetentionPct: 70,
    msrpUsd: 8000,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 705.12(B) — inverter backfeed breaker covers combined solar+battery output'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547'],
  },
  {
    id: 'franklin-apower-15',
    manufacturer: 'Franklin Electric', model: 'aPower 15.0',
    category: 'battery', subcategory: 'ac_coupled',
    usableCapacityKwh: 15.0, peakPowerKw: 10.0, continuousPowerKw: 10.0,
    roundTripEfficiencyPct: 97.0, chemistry: 'LFP', voltageNominalV: 51.2,
    acOutputVoltageV: 240, maxContinuousOutputA: 42,
    backfeedBreakerA: 50,        // NEC 705.12(B): 50A breaker adds to bus loading
    minDedicatedBreakerA: 60,
    weightLbs: 330, outdoorRated: true, ipRating: 'IP65',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: false,
    warrantyYears: 12, cycleGuarantee: '6000 cycles', capacityRetentionPct: 70,
    msrpUsd: 10500,
    necRefs: ['NEC 705.12(B) — 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
  },
  {
    id: 'solaredge-home-battery-10',
    manufacturer: 'SolarEdge', model: 'Home Battery 10 kWh',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 9.7, peakPowerKw: 5.0, continuousPowerKw: 5.0,
    roundTripEfficiencyPct: 94.5, chemistry: 'LFP', voltageNominalV: 48,
    backfeedBreakerA: undefined, minDedicatedBreakerA: undefined,
    weightLbs: 264, outdoorRated: true, ipRating: 'IP55',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: false, gatewayModel: 'SolarEdge Home Hub Inverter',
    warrantyYears: 10, cycleGuarantee: '6000 cycles', capacityRetentionPct: 70,
    msrpUsd: 7000,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 705.12(B) — inverter backfeed breaker covers combined solar+battery output'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
  },
  // ── Enphase IQ Battery 3T ──────────────────────────────────────────────────
  {
    id: 'enphase-iq-battery-3t',
    manufacturer: 'Enphase', model: 'IQ Battery 3T',
    category: 'battery', subcategory: 'ac_coupled',
    usableCapacityKwh: 3.36, peakPowerKw: 1.28, continuousPowerKw: 1.28,
    roundTripEfficiencyPct: 96.0, chemistry: 'LFP', voltageNominalV: 48,
    acOutputVoltageV: 240, maxContinuousOutputA: 5.3,
    backfeedBreakerA: 15,        // NEC 705.12(B): 15A breaker adds to bus loading
    minDedicatedBreakerA: 15,
    weightLbs: 75, outdoorRated: true, ipRating: 'IP55',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: true, gatewayModel: 'Enphase IQ System Controller 3',
    warrantyYears: 15, cycleGuarantee: '4000 cycles', capacityRetentionPct: 70,
    msrpUsd: 2800,
    necRefs: ['NEC 705.12(B) — 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
    isNew: true,
  },
  // ── Tesla Powerwall 2 ──────────────────────────────────────────────────────
  {
    id: 'tesla-powerwall-2',
    manufacturer: 'Tesla', model: 'Powerwall 2',
    category: 'battery', subcategory: 'ac_coupled',
    usableCapacityKwh: 13.5, peakPowerKw: 7.0, continuousPowerKw: 5.0,
    roundTripEfficiencyPct: 90.0, chemistry: 'NMC', voltageNominalV: 50,
    acOutputVoltageV: 240, maxContinuousOutputA: 21,
    backfeedBreakerA: 30,        // NEC 705.12(B): 30A breaker adds to bus loading
    minDedicatedBreakerA: 30,
    weightLbs: 251, outdoorRated: true, ipRating: 'IP67',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: true, gatewayModel: 'Tesla Backup Gateway 2',
    warrantyYears: 10, cycleGuarantee: 'Unlimited cycles', capacityRetentionPct: 70,
    msrpUsd: 8500,
    necRefs: ['NEC 705.12(B) — 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
    isNew: true,
  },
  // ── Generac PWRcell 17 kWh ─────────────────────────────────────────────────
  {
    id: 'generac-pwrcell-17',
    manufacturer: 'Generac', model: 'PWRcell 17 kWh',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 17.1, peakPowerKw: 9.0, continuousPowerKw: 9.0,
    roundTripEfficiencyPct: 96.5, chemistry: 'NMC', voltageNominalV: 48,
    backfeedBreakerA: undefined, minDedicatedBreakerA: undefined,
    weightLbs: 360, outdoorRated: true, ipRating: 'IP65',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: true, gatewayModel: 'Generac PWRmanager',
    warrantyYears: 10, cycleGuarantee: '3650 cycles', capacityRetentionPct: 70,
    msrpUsd: 14000,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 705.12(B) — inverter backfeed breaker covers combined solar+battery output'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547'],
    isNew: true,
  },
  // ── Panasonic EverVolt 11.4 kWh ────────────────────────────────────────────
  {
    id: 'panasonic-evervolt-11',
    manufacturer: 'Panasonic', model: 'EverVolt 11.4 kWh',
    category: 'battery', subcategory: 'ac_coupled',
    usableCapacityKwh: 11.4, peakPowerKw: 5.5, continuousPowerKw: 5.5,
    roundTripEfficiencyPct: 94.0, chemistry: 'NMC', voltageNominalV: 48,
    acOutputVoltageV: 240, maxContinuousOutputA: 23,
    backfeedBreakerA: 30,        // NEC 705.12(B): 30A breaker adds to bus loading
    minDedicatedBreakerA: 30,
    weightLbs: 220, outdoorRated: true, ipRating: 'IP55',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: false,
    warrantyYears: 10, cycleGuarantee: '6000 cycles', capacityRetentionPct: 60,
    msrpUsd: 9000,
    necRefs: ['NEC 705.12(B) — 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
    isNew: true,
  },
  // ── Sonnen Eco 10 ─────────────────────────────────────────────────────────
  {
    id: 'sonnen-eco-10',
    manufacturer: 'Sonnen', model: 'Eco 10',
    category: 'battery', subcategory: 'ac_coupled',
    usableCapacityKwh: 10.0, peakPowerKw: 3.3, continuousPowerKw: 3.3,
    roundTripEfficiencyPct: 90.0, chemistry: 'LFP', voltageNominalV: 48,
    acOutputVoltageV: 240, maxContinuousOutputA: 14,
    backfeedBreakerA: 20,        // NEC 705.12(B): 20A breaker adds to bus loading
    minDedicatedBreakerA: 20,
    weightLbs: 286, outdoorRated: false, ipRating: 'IP21',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: false,
    warrantyYears: 10, cycleGuarantee: '10000 cycles', capacityRetentionPct: 70,
    msrpUsd: 11000,
    necRefs: ['NEC 705.12(B) — 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
    isNew: true,
  },
];

// ============================================================
// Generator Systems
// ============================================================

export interface GeneratorSystem {
  id: string;
  manufacturer: string;
  model: string;
  category: 'generator';
  subcategory: 'standby_natural_gas' | 'standby_propane' | 'portable';
  ratedOutputKw: number;
  voltageOutputV: number;
  phaseType: 'split_phase' | 'three_phase';
  fuelType: 'natural_gas' | 'propane' | 'gasoline' | 'diesel';
  outputBreakerA: number;
  outputWireGaugeMin: string;
  neutralBonded: boolean;           // NEC 250.30 — floating neutral required when ATS switches neutral
  autoStart: boolean;
  remoteMonitoring: boolean;
  weightLbs: number;
  warrantyYears: number;
  msrpUsd: number;
  necRefs: string[];
  ulListing: string;
  isNew?: boolean; // UI badge flag
}

export const GENERATORS: GeneratorSystem[] = [
  {
    id: 'generac-guardian-22kw',
    manufacturer: 'Generac', model: 'Guardian 22kW',
    category: 'generator', subcategory: 'standby_natural_gas',
    ratedOutputKw: 22, voltageOutputV: 240, phaseType: 'split_phase',
    fuelType: 'natural_gas', outputBreakerA: 100, outputWireGaugeMin: '4 AWG',
    neutralBonded: true, autoStart: true, remoteMonitoring: true,
    weightLbs: 497, warrantyYears: 5, msrpUsd: 5499,
    necRefs: ['NEC 702 — Optional Standby Systems', 'NEC 250.30 — neutral bonding at generator', 'NEC 702.5 — transfer equipment required'],
    ulListing: 'UL 2200',
  },
  {
    id: 'generac-guardian-24kw',
    manufacturer: 'Generac', model: 'Guardian 24kW',
    category: 'generator', subcategory: 'standby_natural_gas',
    ratedOutputKw: 24, voltageOutputV: 240, phaseType: 'split_phase',
    fuelType: 'natural_gas', outputBreakerA: 100, outputWireGaugeMin: '4 AWG',
    neutralBonded: true, autoStart: true, remoteMonitoring: true,
    weightLbs: 530, warrantyYears: 5, msrpUsd: 6499,
    necRefs: ['NEC 702 — Optional Standby Systems', 'NEC 250.30 — neutral bonding at generator', 'NEC 702.5 — transfer equipment required'],
    ulListing: 'UL 2200',
  },
  {
    id: 'kohler-20rcal',
    manufacturer: 'Kohler', model: '20RCAL',
    category: 'generator', subcategory: 'standby_natural_gas',
    ratedOutputKw: 20, voltageOutputV: 240, phaseType: 'split_phase',
    fuelType: 'natural_gas', outputBreakerA: 100, outputWireGaugeMin: '4 AWG',
    neutralBonded: true, autoStart: true, remoteMonitoring: true,
    weightLbs: 410, warrantyYears: 5, msrpUsd: 5200,
    necRefs: ['NEC 702 — Optional Standby Systems', 'NEC 250.30 — neutral bonding at generator', 'NEC 702.5 — transfer equipment required'],
    ulListing: 'UL 2200',
  },
  {
    id: 'briggs-stratton-20kw',
    manufacturer: 'Briggs & Stratton', model: '20kW Home Standby',
    category: 'generator', subcategory: 'standby_natural_gas',
    ratedOutputKw: 20, voltageOutputV: 240, phaseType: 'split_phase',
    fuelType: 'natural_gas', outputBreakerA: 100, outputWireGaugeMin: '4 AWG',
    neutralBonded: true, autoStart: true, remoteMonitoring: true,
    weightLbs: 450, warrantyYears: 3, msrpUsd: 4800,
    necRefs: ['NEC 702 — Optional Standby Systems', 'NEC 250.30 — neutral bonding at generator', 'NEC 702.5 — transfer equipment required'],
    ulListing: 'UL 2200',
  },
  // ── Generac expanded lineup ────────────────────────────────────────────────
  {
    id: 'generac-guardian-18kw',
    manufacturer: 'Generac', model: 'Guardian 18kW',
    category: 'generator', subcategory: 'standby_natural_gas',
    ratedOutputKw: 18, voltageOutputV: 240, phaseType: 'split_phase',
    fuelType: 'natural_gas', outputBreakerA: 100, outputWireGaugeMin: '4 AWG',
    neutralBonded: true, autoStart: true, remoteMonitoring: true,
    weightLbs: 463, warrantyYears: 5, msrpUsd: 4999,
    necRefs: ['NEC 702 — Optional Standby Systems', 'NEC 250.30 — neutral bonding at generator', 'NEC 702.5 — transfer equipment required'],
    ulListing: 'UL 2200',
    isNew: true,
  },
  {
    id: 'generac-guardian-26kw',
    manufacturer: 'Generac', model: 'Guardian 26kW',
    category: 'generator', subcategory: 'standby_natural_gas',
    ratedOutputKw: 26, voltageOutputV: 240, phaseType: 'split_phase',
    fuelType: 'natural_gas', outputBreakerA: 125, outputWireGaugeMin: '2 AWG',
    neutralBonded: true, autoStart: true, remoteMonitoring: true,
    weightLbs: 560, warrantyYears: 5, msrpUsd: 7499,
    necRefs: ['NEC 702 — Optional Standby Systems', 'NEC 250.30 — neutral bonding at generator', 'NEC 702.5 — transfer equipment required'],
    ulListing: 'UL 2200',
    isNew: true,
  },
  // ── Kohler expanded lineup ─────────────────────────────────────────────────
  {
    id: 'kohler-14resal',
    manufacturer: 'Kohler', model: '14RESAL',
    category: 'generator', subcategory: 'standby_natural_gas',
    ratedOutputKw: 14, voltageOutputV: 240, phaseType: 'split_phase',
    fuelType: 'natural_gas', outputBreakerA: 70, outputWireGaugeMin: '6 AWG',
    neutralBonded: true, autoStart: true, remoteMonitoring: true,
    weightLbs: 360, warrantyYears: 5, msrpUsd: 4200,
    necRefs: ['NEC 702 — Optional Standby Systems', 'NEC 250.30 — neutral bonding at generator', 'NEC 702.5 — transfer equipment required'],
    ulListing: 'UL 2200',
    isNew: true,
  },
  // ── Cummins RS20A ──────────────────────────────────────────────────────────
  {
    id: 'cummins-rs20a',
    manufacturer: 'Cummins', model: 'RS20A',
    category: 'generator', subcategory: 'standby_natural_gas',
    ratedOutputKw: 20, voltageOutputV: 240, phaseType: 'split_phase',
    fuelType: 'natural_gas', outputBreakerA: 100, outputWireGaugeMin: '4 AWG',
    neutralBonded: true, autoStart: true, remoteMonitoring: true,
    weightLbs: 430, warrantyYears: 5, msrpUsd: 5200,
    necRefs: ['NEC 702 — Optional Standby Systems', 'NEC 250.30 — neutral bonding at generator', 'NEC 702.5 — transfer equipment required'],
    ulListing: 'UL 2200',
    isNew: true,
  },
];

// ============================================================
// Automatic Transfer Switches (ATS)
// ============================================================

export interface ATSUnit {
  id: string;
  manufacturer: string;
  model: string;
  category: 'ats';
  subcategory: 'whole_home_ats' | 'manual_transfer_switch' | 'critical_load_panel';
  ampRating: number;
  voltageV: number;
  serviceEntranceRated: boolean;
  mainBreakerA?: number;
  transferType: 'automatic' | 'manual';
  neutralSwitched: boolean;         // NEC 250.30 — must switch neutral when generator has bonded neutral
  outdoorRated: boolean;
  enclosureType: string;
  weightLbs: number;
  warrantyYears: number;
  msrpUsd: number;
  necRefs: string[];
  ulListing: string;
  isNew?: boolean; // UI badge flag
}

export const ATS_UNITS: ATSUnit[] = [
  {
    id: 'generac-rxsw200a3',
    manufacturer: 'Generac', model: 'RXSW200A3',
    category: 'ats', subcategory: 'whole_home_ats',
    ampRating: 200, voltageV: 240,
    serviceEntranceRated: true, mainBreakerA: 200,
    transferType: 'automatic', neutralSwitched: true,
    outdoorRated: true, enclosureType: 'NEMA 3R',
    weightLbs: 45, warrantyYears: 5, msrpUsd: 1200,
    necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral switching required (generator has bonded neutral)', 'NEC 230.82 — service entrance rated'],
    ulListing: 'UL 1008',
  },
  {
    id: 'generac-rtsw200a3',
    manufacturer: 'Generac', model: 'RTSW200A3',
    category: 'ats', subcategory: 'whole_home_ats',
    ampRating: 200, voltageV: 240,
    serviceEntranceRated: false,
    transferType: 'automatic', neutralSwitched: true,
    outdoorRated: true, enclosureType: 'NEMA 3R',
    weightLbs: 38, warrantyYears: 5, msrpUsd: 950,
    necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral switching required'],
    ulListing: 'UL 1008',
  },
  {
    id: 'kohler-rdt-200',
    manufacturer: 'Kohler', model: 'RDT-CFNC-0200B',
    category: 'ats', subcategory: 'whole_home_ats',
    ampRating: 200, voltageV: 240,
    serviceEntranceRated: true, mainBreakerA: 200,
    transferType: 'automatic', neutralSwitched: true,
    outdoorRated: true, enclosureType: 'NEMA 3R',
    weightLbs: 50, warrantyYears: 5, msrpUsd: 1350,
    necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral switching required', 'NEC 230.82 — service entrance rated'],
    ulListing: 'UL 1008',
  },
  {
    id: 'siemens-tf222r',
    manufacturer: 'Siemens', model: 'TF222R',
    category: 'ats', subcategory: 'manual_transfer_switch',
    ampRating: 200, voltageV: 240,
    serviceEntranceRated: false,
    transferType: 'manual', neutralSwitched: true,
    outdoorRated: false, enclosureType: 'NEMA 1',
    weightLbs: 22, warrantyYears: 1, msrpUsd: 350,
    necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral switching required'],
    ulListing: 'UL 1008',
  },
  // ── Enphase IQ System Controller 3 (ATS mode) ─────────────────────────────
  // The IQ SC3 is a service-entrance-rated gateway that also functions as an ATS
  // for Enphase battery systems — it switches the home off-grid during outages.
  // Listed here as an ATS entry so Enphase ecosystem is complete.
  {
    id: 'enphase-iq-sc3-ats',
    manufacturer: 'Enphase', model: 'IQ System Controller 3 (ATS)',
    category: 'ats', subcategory: 'whole_home_ats',
    ampRating: 200, voltageV: 240,
    serviceEntranceRated: true, mainBreakerA: 200,
    transferType: 'automatic', neutralSwitched: true,
    // NEC 250.30: IQ SC3 switches neutral — prevents parallel neutral path with grid
    outdoorRated: true, enclosureType: 'NEMA 3R',
    weightLbs: 22, warrantyYears: 5, msrpUsd: 1800,
    necRefs: [
      'NEC 702.5 — transfer equipment (battery-based islanding)',
      'NEC 250.30 — neutral switching: IQ SC3 opens neutral during island mode',
      'NEC 230.82 — service entrance rated',
      'NEC 706 — Energy Storage Systems: automatic transfer to battery backup',
    ],
    ulListing: 'UL 1741 / UL 1741-SA / UL 1008',
    isNew: true,
  },
  // ── Generac RXSW100A3 (100A service entrance) ──────────────────────────────
  {
    id: 'generac-rxsw100a3',
    manufacturer: 'Generac', model: 'RXSW100A3',
    category: 'ats', subcategory: 'whole_home_ats',
    ampRating: 100, voltageV: 240,
    serviceEntranceRated: true, mainBreakerA: 100,
    transferType: 'automatic', neutralSwitched: true,
    outdoorRated: true, enclosureType: 'NEMA 3R',
    weightLbs: 32, warrantyYears: 5, msrpUsd: 900,
    necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral switching required', 'NEC 230.82 — service entrance rated'],
    ulListing: 'UL 1008',
    isNew: true,
  },
  // ── Kohler RXT-100 ─────────────────────────────────────────────────────────
  {
    id: 'kohler-rxt-100',
    manufacturer: 'Kohler', model: 'RXT-JFNC-0100B',
    category: 'ats', subcategory: 'whole_home_ats',
    ampRating: 100, voltageV: 240,
    serviceEntranceRated: true, mainBreakerA: 100,
    transferType: 'automatic', neutralSwitched: true,
    outdoorRated: true, enclosureType: 'NEMA 3R',
    weightLbs: 38, warrantyYears: 5, msrpUsd: 1050,
    necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral switching required', 'NEC 230.82 — service entrance rated'],
    ulListing: 'UL 1008',
    isNew: true,
  },
  // ── Briggs & Stratton 200A ATS ─────────────────────────────────────────────
  {
    id: 'briggs-stratton-ats-200',
    manufacturer: 'Briggs & Stratton', model: '200A Automatic Transfer Switch',
    category: 'ats', subcategory: 'whole_home_ats',
    ampRating: 200, voltageV: 240,
    serviceEntranceRated: true, mainBreakerA: 200,
    transferType: 'automatic', neutralSwitched: true,
    outdoorRated: true, enclosureType: 'NEMA 3R',
    weightLbs: 42, warrantyYears: 3, msrpUsd: 1100,
    necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral switching required', 'NEC 230.82 — service entrance rated'],
    ulListing: 'UL 1008',
    isNew: true,
  },
  // ── Eaton CHT200 ───────────────────────────────────────────────────────────
  {
    id: 'eaton-cht200',
    manufacturer: 'Eaton', model: 'CHT200',
    category: 'ats', subcategory: 'whole_home_ats',
    ampRating: 200, voltageV: 240,
    serviceEntranceRated: true, mainBreakerA: 200,
    transferType: 'automatic', neutralSwitched: true,
    outdoorRated: true, enclosureType: 'NEMA 3R',
    weightLbs: 48, warrantyYears: 5, msrpUsd: 1250,
    necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral switching required', 'NEC 230.82 — service entrance rated'],
    ulListing: 'UL 1008',
    isNew: true,
  },
];

// ============================================================
// Backup Interface / Gateway Controllers
// ============================================================

export interface BackupInterface {
  id: string;
  manufacturer: string;
  model: string;
  category: 'backup_interface';
  subcategory: 'gateway_controller' | 'hybrid_inverter_gateway' | 'hybrid_inverter_charger' | 'energy_management_controller';
  maxBackupOutputKw: number;
  maxContinuousOutputA: number;
  serviceEntranceRated: boolean;
  mainBreakerA?: number;
  gridFormingCapable: boolean;
  islandingCapable: boolean;
  loadSheddingCapable: boolean;
  loadSheddingCircuits?: number;
  generatorCompatible: boolean;
  outdoorRated: boolean;
  weightLbs: number;
  warrantyYears: number;
  msrpUsd: number;
  necRefs: string[];
  ulListing: string;
  compatibleBatteries: string[];   // battery IDs
  isNew?: boolean; // UI badge flag
}

export const BACKUP_INTERFACES: BackupInterface[] = [
  {
    id: 'enphase-iq-system-controller-3',
    manufacturer: 'Enphase', model: 'IQ System Controller 3',
    category: 'backup_interface', subcategory: 'gateway_controller',
    maxBackupOutputKw: 15.36, maxContinuousOutputA: 64,
    serviceEntranceRated: true, mainBreakerA: 200,
    gridFormingCapable: true, islandingCapable: true,
    loadSheddingCapable: true, loadSheddingCircuits: 2,
    generatorCompatible: true,
    outdoorRated: true, weightLbs: 22, warrantyYears: 5, msrpUsd: 1800,
    necRefs: ['NEC 705.12(B) — load-side interconnection', 'NEC 706 — Energy Storage Systems', 'NEC 230.82 — service entrance rated'],
    ulListing: 'UL 1741 / UL 1741-SA',
    compatibleBatteries: ['enphase-iq-battery-5p', 'enphase-iq-battery-10t'],
  },
  {
    id: 'tesla-backup-gateway-2',
    manufacturer: 'Tesla', model: 'Backup Gateway 2',
    category: 'backup_interface', subcategory: 'gateway_controller',
    maxBackupOutputKw: 46, maxContinuousOutputA: 200,
    serviceEntranceRated: true, mainBreakerA: 200,
    gridFormingCapable: true, islandingCapable: true,
    loadSheddingCapable: false,
    generatorCompatible: false,
    outdoorRated: true, weightLbs: 11, warrantyYears: 10, msrpUsd: 1000,
    necRefs: ['NEC 705.12(B) — load-side interconnection', 'NEC 706 — Energy Storage Systems', 'NEC 230.82 — service entrance rated'],
    ulListing: 'UL 1741 / UL 1741-SA',
    compatibleBatteries: ['tesla-powerwall-3'],
  },
  {
    id: 'generac-pwrmanager',
    manufacturer: 'Generac', model: 'PWRmanager',
    category: 'backup_interface', subcategory: 'energy_management_controller',
    maxBackupOutputKw: 0, maxContinuousOutputA: 0,
    serviceEntranceRated: false,
    gridFormingCapable: false, islandingCapable: false,
    loadSheddingCapable: true, loadSheddingCircuits: 8,
    generatorCompatible: true,
    outdoorRated: false, weightLbs: 5, warrantyYears: 5, msrpUsd: 800,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 702 — Optional Standby Systems'],
    ulListing: 'UL 916',
    compatibleBatteries: ['generac-pwrcell-9'],
  },
  {
    id: 'solaredge-home-hub-7600',
    manufacturer: 'SolarEdge', model: 'Home Hub SE7600H-US',
    category: 'backup_interface', subcategory: 'hybrid_inverter_gateway',
    maxBackupOutputKw: 7.6, maxContinuousOutputA: 32,
    serviceEntranceRated: false,
    gridFormingCapable: true, islandingCapable: true,
    loadSheddingCapable: true, loadSheddingCircuits: 2,
    generatorCompatible: false,
    outdoorRated: true, weightLbs: 25.4, warrantyYears: 12, msrpUsd: 2200,
    necRefs: ['NEC 705.12(B) — load-side backfed breaker (40A)', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 1741 / UL 1741-SA',
    compatibleBatteries: ['solaredge-home-battery-10'],
  },
  // ── SolarEdge Home Hub SE10000H ────────────────────────────────────────────
  {
    id: 'solaredge-home-hub-10000',
    manufacturer: 'SolarEdge', model: 'Home Hub SE10000H-US',
    category: 'backup_interface', subcategory: 'hybrid_inverter_gateway',
    maxBackupOutputKw: 10.0, maxContinuousOutputA: 42,
    serviceEntranceRated: false,
    gridFormingCapable: true, islandingCapable: true,
    loadSheddingCapable: true, loadSheddingCircuits: 2,
    generatorCompatible: false,
    outdoorRated: true, weightLbs: 25.4, warrantyYears: 12, msrpUsd: 2500,
    necRefs: ['NEC 705.12(B) — load-side backfed breaker (50A)', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 1741 / UL 1741-SA',
    compatibleBatteries: ['solaredge-home-battery-10'],
    isNew: true,
  },
  // ── Generac PWRcell Inverter 7.6kW ────────────────────────────────────────
  {
    id: 'generac-pwrcell-inverter-7600',
    manufacturer: 'Generac', model: 'PWRcell Inverter 7.6kW',
    category: 'backup_interface', subcategory: 'hybrid_inverter_charger',
    maxBackupOutputKw: 7.6, maxContinuousOutputA: 32,
    serviceEntranceRated: false,
    gridFormingCapable: true, islandingCapable: true,
    loadSheddingCapable: true, loadSheddingCircuits: 4,
    generatorCompatible: true,
    outdoorRated: true, weightLbs: 95, warrantyYears: 10, msrpUsd: 3500,
    necRefs: ['NEC 705.12(B) — load-side backfed breaker (40A)', 'NEC 706 — Energy Storage Systems', 'NEC 702 — Optional Standby Systems (generator integration)'],
    ulListing: 'UL 1741 / UL 1741-SA',
    compatibleBatteries: ['generac-pwrcell-9', 'generac-pwrcell-17'],
    isNew: true,
  },
  // ── Enphase IQ Combiner 5 (load center / backup interface) ────────────────
  {
    id: 'enphase-iq-combiner-5',
    manufacturer: 'Enphase', model: 'IQ Combiner 5',
    category: 'backup_interface', subcategory: 'energy_management_controller',
    maxBackupOutputKw: 15.36, maxContinuousOutputA: 64,
    serviceEntranceRated: false,
    gridFormingCapable: false, islandingCapable: false,
    loadSheddingCapable: true, loadSheddingCircuits: 4,
    generatorCompatible: false,
    outdoorRated: true, weightLbs: 18, warrantyYears: 5, msrpUsd: 1200,
    necRefs: ['NEC 705.12(B) — load-side interconnection', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 67 / UL 869A',
    compatibleBatteries: ['enphase-iq-battery-3t', 'enphase-iq-battery-5p', 'enphase-iq-battery-10t'],
    isNew: true,
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function getBatteryById(id: string): BatterySystem | undefined {
  return BATTERIES.find(b => b.id === id);
}

export function getGeneratorById(id: string): GeneratorSystem | undefined {
  return GENERATORS.find(g => g.id === id);
}

export function getATSById(id: string): ATSUnit | undefined {
  return ATS_UNITS.find(a => a.id === id);
}

export function getBackupInterfaceById(id: string): BackupInterface | undefined {
  return BACKUP_INTERFACES.find(b => b.id === id);
}

// ── Additional lookup helpers ─────────────────────────────────────────────────

export function getOptimizerById(id: string): Optimizer | undefined {
  return OPTIMIZERS.find(o => o.id === id);
}

export function getMicroinvertersByManufacturer(manufacturer: string): Microinverter[] {
  return MICROINVERTERS.filter(m => m.manufacturer.toLowerCase() === manufacturer.toLowerCase());
}

export function getStringInvertersByManufacturer(manufacturer: string): StringInverter[] {
  return STRING_INVERTERS.filter(i => i.manufacturer.toLowerCase() === manufacturer.toLowerCase());
}

export function getBatteriesByManufacturer(manufacturer: string): BatterySystem[] {
  return BATTERIES.filter(b => b.manufacturer.toLowerCase() === manufacturer.toLowerCase());
}

export function getCompatibleBackupInterfaces(batteryId: string): BackupInterface[] {
  return BACKUP_INTERFACES.filter(bi => bi.compatibleBatteries.includes(batteryId));
}

export function getCompatibleATS(manufacturer: string): ATSUnit[] {
  return ATS_UNITS.filter(a => a.manufacturer.toLowerCase() === manufacturer.toLowerCase());
}

/** Returns all equipment marked isNew: true across all categories */
export function getAllNewEquipment(): {
  stringInverters: StringInverter[];
  microinverters: Microinverter[];
  optimizers: Optimizer[];
  batteries: BatterySystem[];
  generators: GeneratorSystem[];
  atsUnits: ATSUnit[];
  backupInterfaces: BackupInterface[];
} {
  return {
    stringInverters: STRING_INVERTERS.filter(e => e.isNew),
    microinverters: MICROINVERTERS.filter(e => e.isNew),
    optimizers: OPTIMIZERS.filter(e => e.isNew),
    batteries: BATTERIES.filter(e => e.isNew),
    generators: GENERATORS.filter(e => e.isNew),
    atsUnits: ATS_UNITS.filter(e => e.isNew),
    backupInterfaces: BACKUP_INTERFACES.filter(e => e.isNew),
  };
}

/**
 * computeBatteryBusImpact — NEC 705.12(B) 120% rule
 * Returns the additional bus loading from an AC-coupled battery's backfeed breaker.
 * DC-coupled batteries don't add a separate breaker — the inverter backfeed covers both.
 */
export function computeBatteryBusImpact(batteryId: string): number {
  const battery = getBatteryById(batteryId);
  if (!battery) return 0;
  if (battery.subcategory === 'dc_coupled') return 0; // inverter backfeed already counted
  return battery.backfeedBreakerA ?? 0;
}

/**
 * computeTotalBusLoading — NEC 705.12(B)
 * Total bus loading = solar backfeed breaker + battery backfeed breaker(s)
 * Must be ≤ 120% of bus rating
 */
export function computeTotalBusLoading(
  solarBackfeedBreakerA: number,
  batteryIds: string[],
  mainBreakerA: number,
  busRatingA: number,
): { totalBackfeedA: number; maxAllowedA: number; passes: boolean; batteryImpactA: number } {
  const batteryImpactA = batteryIds.reduce((sum, id) => sum + computeBatteryBusImpact(id), 0);
  const totalBackfeedA = solarBackfeedBreakerA + batteryImpactA;
  const maxAllowedA = busRatingA * 1.2;
  const passes = (totalBackfeedA + mainBreakerA) <= maxAllowedA;
  return { totalBackfeedA, maxAllowedA, passes, batteryImpactA };
}
