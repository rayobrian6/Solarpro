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
  acOutputCurrentMax: number; // A
  efficiency: number; // %
  cec_efficiency: number; // %
  weight: number; // lbs
  warranty: string;
  ulListing: string;
  rapidShutdownCompliant: boolean;
  datasheetUrl: string;
  // FIX: modulesPerDevice — how many PV modules this device serves
  // 1 = standard 1:1 (IQ8+, IQ8M, IQ8H), 2 = dual-module (DS3, HM-800)
  // deviceCount = ceil(panelCount / modulesPerDevice)
  modulesPerDevice: number;
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
  {
    id: 'apsystems-ds3',
    manufacturer: 'APsystems',
    model: 'DS3',
    category: 'microinverter',
    acOutputW: 730, dcInputWMax: 960,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 16.0,
    acOutputVoltage: 240, acOutputCurrentMax: 3.04,
    efficiency: 96.5, cec_efficiency: 96.0,
    weight: 4.4,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://apsystems.com/products/ds3/',
    modulesPerDevice: 2,
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