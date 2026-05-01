// ============================================================
// Equipment Spec Sheet Database
// Maps equipment model IDs → spec sheet PDF URLs
// Used by permit generator to append manufacturer data sheets
// ============================================================

export interface SpecSheetEntry {
  manufacturer: string;
  model: string;
  type: 'module' | 'inverter' | 'battery' | 'racking' | 'optimizer';
  specSheetUrl: string;       // Public PDF URL
  dataSheetHtml?: string;     // Embedded HTML spec data (fallback)
  ulListing?: string;
  certifications?: string[];
}

// ─── Module Spec Sheets ────────────────────────────────────────────────────
const MODULE_SPECS: SpecSheetEntry[] = [
  {
    manufacturer: 'Q CELLS', model: 'Q.PEAK DUO BLK ML-G10+ 400',
    type: 'module',
    specSheetUrl: 'https://www.q-cells.com/content/dam/q-cells/us/downloads/datasheets/en/Q.PEAK_DUO_BLK_ML-G10+_400-405W_datasheet_E.pdf',
    ulListing: 'UL 61730', certifications: ['CEC Listed', 'UL 61730', 'IEC 61215'],
  },
  {
    manufacturer: 'Q CELLS', model: 'Q.PEAK DUO BLK ML-G10+ 405',
    type: 'module',
    specSheetUrl: 'https://www.q-cells.com/content/dam/q-cells/us/downloads/datasheets/en/Q.PEAK_DUO_BLK_ML-G10+_400-405W_datasheet_E.pdf',
    ulListing: 'UL 61730', certifications: ['CEC Listed', 'UL 61730', 'IEC 61215'],
  },
  {
    manufacturer: 'REC', model: 'REC Alpha Pure-R 410AA',
    type: 'module',
    specSheetUrl: 'https://www.recgroup.com/sites/default/files/documents/ds_rec_alpha_pure_r_en.pdf',
    ulListing: 'UL 61730', certifications: ['CEC Listed', 'UL 61730', 'IEC 61215'],
  },
  {
    manufacturer: 'SunPower', model: 'MAXEON 3 400W',
    type: 'module',
    specSheetUrl: 'https://us.sunpower.com/sites/default/files/sunpower-maxeon-3-400-solar-panel-datasheet.pdf',
    ulListing: 'UL 61730', certifications: ['CEC Listed', 'UL 61730', 'IEC 61215'],
  },
  {
    manufacturer: 'Canadian Solar', model: 'HiKu6 Mono PERC CS6R-400MS',
    type: 'module',
    specSheetUrl: 'https://www.canadiansolar.com/wp-content/uploads/2022/06/CS6R-MS_datasheet_en.pdf',
    ulListing: 'UL 61730', certifications: ['CEC Listed', 'UL 61730', 'IEC 61215'],
  },
  {
    manufacturer: 'Hanwha', model: 'Q.PEAK DUO L-G8.3 400',
    type: 'module',
    specSheetUrl: 'https://www.q-cells.com/content/dam/q-cells/us/downloads/datasheets/en/Q.PEAK_DUO_L-G8.3_datasheet_E.pdf',
    ulListing: 'UL 61730', certifications: ['CEC Listed', 'UL 61730'],
  },
];

// ─── Inverter Spec Sheets ──────────────────────────────────────────────────
const INVERTER_SPECS: SpecSheetEntry[] = [
  {
    manufacturer: 'SolarEdge', model: 'SE3000H-US',
    type: 'inverter',
    specSheetUrl: 'https://www.solaredge.com/sites/default/files/solaredge-HD-wave-single-phase-inverter-datasheet-usa.pdf',
    ulListing: 'UL 1741', certifications: ['UL 1741', 'IEEE 1547', 'CEC Listed'],
  },
  {
    manufacturer: 'SolarEdge', model: 'SE7600H-US',
    type: 'inverter',
    specSheetUrl: 'https://www.solaredge.com/sites/default/files/solaredge-HD-wave-single-phase-inverter-datasheet-usa.pdf',
    ulListing: 'UL 1741', certifications: ['UL 1741', 'IEEE 1547', 'CEC Listed'],
  },
  {
    manufacturer: 'Enphase', model: 'IQ8A-72-2-US',
    type: 'inverter',
    specSheetUrl: 'https://enphase.com/download/iq8-series-microinverter-datasheet',
    ulListing: 'UL 1741', certifications: ['UL 1741 SA', 'IEEE 1547', 'CEC Listed'],
  },
  {
    manufacturer: 'Enphase', model: 'IQ8M-72-2-US',
    type: 'inverter',
    specSheetUrl: 'https://enphase.com/download/iq8-series-microinverter-datasheet',
    ulListing: 'UL 1741', certifications: ['UL 1741 SA', 'IEEE 1547', 'CEC Listed'],
  },
  {
    manufacturer: 'SMA', model: 'Sunny Boy 7.7-US',
    type: 'inverter',
    specSheetUrl: 'https://www.sma.de/fileadmin/content/us/Products/Solar-Inverters/Sunny-Boy/SB-US/Datasheets/DS_SunnyBoy-77-US-en-21.pdf',
    ulListing: 'UL 1741', certifications: ['UL 1741', 'IEEE 1547', 'CEC Listed'],
  },
  {
    manufacturer: 'Fronius', model: 'Primo 7.6-1',
    type: 'inverter',
    specSheetUrl: 'https://www.fronius.com/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Primo_EN_US.pdf',
    ulListing: 'UL 1741', certifications: ['UL 1741', 'IEEE 1547', 'CEC Listed'],
  },
];

// ─── Battery Spec Sheets ───────────────────────────────────────────────────
const BATTERY_SPECS: SpecSheetEntry[] = [
  {
    manufacturer: 'Tesla', model: 'Powerwall 2',
    type: 'battery',
    specSheetUrl: 'https://www.tesla.com/sites/default/files/pdfs/powerwall/Powerwall%202_AC_Datasheet_en_northamerica.pdf',
    ulListing: 'UL 9540', certifications: ['UL 9540', 'NFPA 855'],
  },
  {
    manufacturer: 'Tesla', model: 'Powerwall 3',
    type: 'battery',
    specSheetUrl: 'https://www.tesla.com/sites/default/files/pdfs/powerwall/Powerwall_3_Datasheet_en_northamerica.pdf',
    ulListing: 'UL 9540', certifications: ['UL 9540', 'NFPA 855'],
  },
  {
    manufacturer: 'Enphase', model: 'IQ Battery 5P',
    type: 'battery',
    specSheetUrl: 'https://enphase.com/download/iq-battery-5p-datasheet',
    ulListing: 'UL 9540', certifications: ['UL 9540', 'NFPA 855'],
  },
  {
    manufacturer: 'LG', model: 'RESU10H Prime',
    type: 'battery',
    specSheetUrl: 'https://www.lges.com/en/download/RESU10H-Prime-Datasheet',
    ulListing: 'UL 9540', certifications: ['UL 9540', 'NFPA 855'],
  },
  {
    manufacturer: 'Franklin', model: 'aPower 2',
    type: 'battery',
    specSheetUrl: 'https://franklinwh.com/wp-content/uploads/2023/09/aPower-2-Spec-Sheet.pdf',
    ulListing: 'UL 9540', certifications: ['UL 9540', 'NFPA 855'],
  },
];

// ─── Racking Spec Sheets ───────────────────────────────────────────────────
const RACKING_SPECS: SpecSheetEntry[] = [
  {
    manufacturer: 'IronRidge', model: 'XR100',
    type: 'racking',
    specSheetUrl: 'https://ironridge.com/content/uploads/2023/04/XR100-Design-Guide.pdf',
    ulListing: 'UL 2703', certifications: ['UL 2703', 'ICC-ES AC428'],
  },
  {
    manufacturer: 'IronRidge', model: 'XR1000',
    type: 'racking',
    specSheetUrl: 'https://ironridge.com/content/uploads/2023/04/XR1000-Design-Guide.pdf',
    ulListing: 'UL 2703', certifications: ['UL 2703', 'ICC-ES AC428'],
  },
  {
    manufacturer: 'Unirac', model: 'SolarMount Evolution',
    type: 'racking',
    specSheetUrl: 'https://unirac.com/wp-content/uploads/SME-Install-Guide.pdf',
    ulListing: 'UL 2703', certifications: ['UL 2703', 'ICC-ES AC428'],
  },
  {
    manufacturer: 'SnapNrack', model: 'Series 100 Rail System',
    type: 'racking',
    specSheetUrl: 'https://snapnrack.com/wp-content/uploads/SnapNrack-Series-100-UM.pdf',
    ulListing: 'UL 2703', certifications: ['UL 2703', 'ICC-ES AC428'],
  },
  {
    manufacturer: 'Roof Tech', model: 'RT-MINI',
    type: 'racking',
    specSheetUrl: 'https://roof-tech.jp/en/download/RT-MINI-technical-manual.pdf',
    ulListing: 'ICC-ES', certifications: ['ICC-ES AC428'],
  },
];

// ─── Lookup Functions ──────────────────────────────────────────────────────

/**
 * Find spec sheet for a module by manufacturer + model string (fuzzy match)
 */
export function findModuleSpec(manufacturer: string, model: string): SpecSheetEntry | null {
  const mfr = (manufacturer || '').toLowerCase();
  const mdl = (model || '').toLowerCase();
  return MODULE_SPECS.find(s =>
    s.manufacturer.toLowerCase().includes(mfr) ||
    mfr.includes(s.manufacturer.toLowerCase()) ||
    s.model.toLowerCase().includes(mdl) ||
    mdl.includes(s.model.toLowerCase())
  ) || null;
}

/**
 * Find spec sheet for an inverter
 */
export function findInverterSpec(manufacturer: string, model: string): SpecSheetEntry | null {
  const mfr = (manufacturer || '').toLowerCase();
  const mdl = (model || '').toLowerCase();
  return INVERTER_SPECS.find(s =>
    s.manufacturer.toLowerCase().includes(mfr) ||
    mfr.includes(s.manufacturer.toLowerCase()) ||
    s.model.toLowerCase().includes(mdl) ||
    mdl.includes(s.model.toLowerCase())
  ) || null;
}

/**
 * Find spec sheet for a battery
 */
export function findBatterySpec(manufacturer: string, model: string): SpecSheetEntry | null {
  const mfr = (manufacturer || '').toLowerCase();
  const mdl = (model || '').toLowerCase();
  return BATTERY_SPECS.find(s =>
    s.manufacturer.toLowerCase().includes(mfr) ||
    mfr.includes(s.manufacturer.toLowerCase()) ||
    s.model.toLowerCase().includes(mdl) ||
    mdl.includes(s.model.toLowerCase())
  ) || null;
}

/**
 * Find spec sheet for racking
 */
export function findRackingSpec(manufacturer: string, model: string): SpecSheetEntry | null {
  const mfr = (manufacturer || '').toLowerCase();
  const mdl = (model || '').toLowerCase();
  return RACKING_SPECS.find(s =>
    s.manufacturer.toLowerCase().includes(mfr) ||
    mfr.includes(s.manufacturer.toLowerCase()) ||
    s.model.toLowerCase().includes(mdl) ||
    mdl.includes(s.model.toLowerCase())
  ) || null;
}

/**
 * Get all relevant spec sheets for a permit package
 */
export function getPermitSpecSheets(opts: {
  moduleManufacturer?: string;
  moduleModel?: string;
  inverterManufacturer?: string;
  inverterModel?: string;
  batteryManufacturer?: string;
  batteryModel?: string;
  rackingManufacturer?: string;
  rackingModel?: string;
}): SpecSheetEntry[] {
  const sheets: SpecSheetEntry[] = [];
  
  const mod = opts.moduleManufacturer ? findModuleSpec(opts.moduleManufacturer, opts.moduleModel || '') : null;
  const inv = opts.inverterManufacturer ? findInverterSpec(opts.inverterManufacturer, opts.inverterModel || '') : null;
  const bat = opts.batteryManufacturer ? findBatterySpec(opts.batteryManufacturer, opts.batteryModel || '') : null;
  const rack = opts.rackingManufacturer ? findRackingSpec(opts.rackingManufacturer, opts.rackingModel || '') : null;

  if (mod) sheets.push(mod);
  if (inv) sheets.push(inv);
  if (bat) sheets.push(bat);
  if (rack) sheets.push(rack);

  return sheets;
}

// ─── Generic specs (used in Equipment Schedule page) ──────────────────────

export interface GenericModuleSpec {
  voc: number;        // V
  isc: number;        // A
  vmp: number;        // V
  imp: number;        // A
  pmax: number;       // W
  efficiency: number; // %
  tempCoeffPmax: number; // %/°C
  tempCoeffVoc: number;  // %/°C
  lengthMm: number;
  widthMm: number;
  weightKg: number;
  cellType: string;
  ulListing: string;
  warranty: string;
}

export function getGenericModuleSpecs(wattage: number): GenericModuleSpec {
  // Returns representative specs for common wattage ranges
  if (wattage >= 430) {
    return { voc: 42.8, isc: 13.5, vmp: 36.2, imp: 12.8, pmax: wattage, efficiency: 22.8,
      tempCoeffPmax: -0.30, tempCoeffVoc: -0.24, lengthMm: 1762, widthMm: 1134, weightKg: 22.3,
      cellType: 'Mono TOPCon', ulListing: 'UL 61730', warranty: '25-year product / 30-year power' };
  } else if (wattage >= 400) {
    return { voc: 41.6, isc: 12.26, vmp: 34.5, imp: 11.59, pmax: wattage, efficiency: 21.4,
      tempCoeffPmax: -0.35, tempCoeffVoc: -0.27, lengthMm: 1762, widthMm: 1134, weightKg: 21.1,
      cellType: 'Mono PERC', ulListing: 'UL 61730', warranty: '25-year product / 25-year power' };
  } else {
    return { voc: 39.6, isc: 11.05, vmp: 32.4, imp: 10.5, pmax: wattage, efficiency: 19.8,
      tempCoeffPmax: -0.37, tempCoeffVoc: -0.29, lengthMm: 1700, widthMm: 1016, weightKg: 19.5,
      cellType: 'Mono PERC', ulListing: 'UL 61730', warranty: '10-year product / 25-year power' };
  }
}