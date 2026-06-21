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
  // Ecosystem metadata (additive; optional)
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];
  active?: boolean;
  isNew?: boolean;
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
  /**
   * v47.415 — Nominal DC input voltage (V) the inverter actively holds on its
   * DC bus during operation. REQUIRED for fixed-bus optimizer inverters (e.g.
   * SolarEdge HD-Wave uses 400V) so the MPPT allocator can compute correct
   * per-string OPERATING current as `stringPowerW / nominalDcVoltage`. For
   * conventional string inverters the bus voltage is the panel-string's own
   * Vmp (varies with count/temp) and this field can be omitted — allocator
   * falls back to the panel Isc method. Optional for backwards compatibility.
   */
  nominalDcVoltage?: number; // V — fixed DC bus voltage (optimizer/hybrid inverters)
  maxInputCurrentPerMppt: number; // A per MPPT channel
  maxShortCircuitCurrent: number; // A — max DC short circuit current input
  mpptChannels: number;
  numberOfMPPT: number; // same as mpptChannels, explicit alias
  /**
   * Phase 13.4 — Max parallel strings allowed per MPPT channel.
   * Optional. When undefined, the MPPT allocator falls back to a SAFE
   * default of 1 (one string per MPPT). Brand profiles that support
   * explicit parallel combining (e.g., residential string inverters
   * with dual input connectors per MPPT) should set this to 2.
   */
  maxParallelStringsPerMppt?: number;
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
  /**
   * v47.417 — Factory-integrated DC disconnect switch.
   * Most modern UL-1741-listed residential string / optimizer / hybrid
   * inverters ship with an integrated DC safety switch as part of the unit
   * (examples: all SolarEdge HD-Wave, Fronius Primo UL, SMA Sunny Boy US,
   * GoodWe NS/MS, EcoFlow PowerOcean, Sol-Ark 8K/12K/15K/30K-3P).
   * When true, lib/electrical-calc.ts suppresses the E-DC-DISCONNECT error
   * because NEC 690.15 is already satisfied by the factory switch — a
   * separate field-installed DC disconnect is NOT required at the inverter.
   * When false or omitted, the DC disconnect check is applied per NEC 690.15
   * (user must install one externally).
   * NOTE: This flag addresses disconnects AT THE INVERTER only. Battery DC
   * disconnects (NEC 706) and DC disconnects between optimizers and inverter
   * are separate concerns handled elsewhere.
   */
  integratedDcDisconnect?: boolean;
  datasheetUrl: string;
  isNew?: boolean; // UI badge flag — true for recently added models
  // Ecosystem metadata (additive; optional)
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];
  active?: boolean;
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
  // Ecosystem metadata (additive; optional)
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];
  active?: boolean;
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
  // Ecosystem metadata (additive; optional)
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];
  active?: boolean;
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
  // Ecosystem metadata (additive; optional)
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];
  active?: boolean;
  isNew?: boolean;
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
  // Tesla — Tesla Solar Panel (TSP-415 / TSP-420)
  // Source: Tesla Solar Panel Datasheet (energylibrary.tesla.com). All-black
  // Tesla-frame module, pairs natively with Tesla Panel Mount + Tesla Solar
  // Inverter / Powerwall 3. 1000V max, 25A max series fuse, 18 power zones.
  // NOCT not published on the datasheet — 45°C assumed (industry-typical).
  // Cell chemistry not stated on the datasheet — mono-PERC assumed pending the
  // detailed cutsheet. parallelStringLimit 2: (2-1)×1.25×Isc = 16.3A < 25A fuse;
  // a 3rd parallel string would exceed the 25A series-fuse cap (needs OCPD).
  {
    id: 'tesla-tsp-420',
    manufacturer: 'Tesla',
    model: 'Solar Panel TSP-420',
    category: 'solar_panel',
    watts: 420, efficiency: 20.5,
    voc: 40.95, vmp: 34.29, isc: 13.03, imp: 12.25,
    tempCoeffVoc: -0.27, tempCoeffIsc: 0.04, tempCoeffPmax: -0.34,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 25,
    nominalOperatingTemp: 45, parallelStringLimit: 2,
    weight: 49, length: 71.1, width: 44.7, thickness: 1.57,
    warranty: '25yr product / 25yr power', ulListing: 'UL 61730',
    bifacial: false, cellType: 'mono-PERC',
    datasheetUrl: 'https://energylibrary.tesla.com/docs/Public/Solar/Retrofit/Datasheet/TeslaSolarPanel/DatasheetTeslaSolarPanel.pdf',
    ecosystemBrand: 'tesla', ecosystemFamily: 'Tesla Solar Panel',
    compatibleWith: ['tesla-solar-inverter-3p8k', 'tesla-solar-inverter-5k', 'tesla-solar-inverter-5p7k', 'tesla-solar-inverter-7p6k'],
    isNew: true,
  },
  {
    id: 'tesla-tsp-415',
    manufacturer: 'Tesla',
    model: 'Solar Panel TSP-415',
    category: 'solar_panel',
    watts: 415, efficiency: 20.3,
    voc: 40.92, vmp: 34.24, isc: 12.93, imp: 12.12,
    tempCoeffVoc: -0.27, tempCoeffIsc: 0.04, tempCoeffPmax: -0.34,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 25,
    nominalOperatingTemp: 45, parallelStringLimit: 2,
    weight: 49, length: 71.1, width: 44.7, thickness: 1.57,
    warranty: '25yr product / 25yr power', ulListing: 'UL 61730',
    bifacial: false, cellType: 'mono-PERC',
    datasheetUrl: 'https://energylibrary.tesla.com/docs/Public/Solar/Retrofit/Datasheet/TeslaSolarPanel/DatasheetTeslaSolarPanel.pdf',
    ecosystemBrand: 'tesla', ecosystemFamily: 'Tesla Solar Panel',
    compatibleWith: ['tesla-solar-inverter-3p8k', 'tesla-solar-inverter-5k', 'tesla-solar-inverter-5p7k', 'tesla-solar-inverter-7p6k'],
    isNew: true,
  },
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
    // v47.406 datasheet fix: SunPower Maxeon 7 datasheet (official PDF from SunPower website CDN)
    datasheetUrl: 'https://cdn.prod.website-files.com/6627b4a16340c535bfabf896/668bef1148a5bfbf75c79fbe_Sunpower.pdf',
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
    // v47.406 datasheet fix: SunPower A-Series (400-425W) datasheet (Energy Sage authorized distributor S3)
    datasheetUrl: 'https://es-media-prod.s3.amazonaws.com/media/components/panels/spec-sheets/SunPower_A-Series.pdf',
  },
  // v47.425 — SunPower Maxeon 3 400W (low-Isc legacy SKU)
  // Datasheet-backed real panel. Added to close the catalog gap surfaced in
  // the v47.424 audit: SolarEdge (10.5A cap), SMA (10A), GoodWe (11A) had no
  // compatible panel in the catalog. Maxeon 3's Isc of 6.23A x 1.25 = 7.79A
  // fits under every registered brand's strictest MPPT cap, so the Panel
  // Compatibility Gate now always has at least one valid suggestion.
  {
    id: 'sp-maxeon3-400',
    manufacturer: 'SunPower',
    model: 'Maxeon 3 400W',
    category: 'solar_panel',
    watts: 400, efficiency: 22.6,
    // Electrical specs from SunPower Maxeon 3 datasheet (SPR-MAX3-400).
    // Low-Isc / high-Voc monocrystalline IBC design (Maxeon Gen III cells).
    voc: 75.6, vmp: 65.8, isc: 6.58, imp: 6.08,
    tempCoeffVoc: -0.236, tempCoeffIsc: 0.048, tempCoeffPmax: -0.29,  // datasheet Voc coeff −0.236%/°C
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 44.5, parallelStringLimit: 3,
    weight: 42.0, length: 66.5, width: 41.2, thickness: 1.57,  // datasheet 1690×1046mm = 66.5×41.2in (was 61.3)
    warranty: '25yr product / 25yr power',
    ulListing: 'UL 61730',
    bifacial: false,
    cellType: 'mono-PERC',
    datasheetUrl: 'https://us.sunpower.com/sites/default/files/sp-maxeon-3-400-425-residential-solar-panels-datasheet-ds.pdf',
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
    // v47.406 datasheet fix: REC Alpha Pure 2 US datasheet (recgroup.com official, dated subfolder accessible)
    datasheetUrl: 'https://www.recgroup.com/sites/default/files/2025-01/Web_DS%20REC%20Alpha%20Pure%202%20UL_EN%20US%2012122024.pdf',
  },
  // Panasonic
  {
    id: 'pan-evervolt-410',
    manufacturer: 'Panasonic',
    model: 'EverVolt HK Black 410W',
    category: 'solar_panel',
    watts: 410, efficiency: 22.2,
    voc: 49.0, vmp: 42.7, isc: 10.35, imp: 9.61,  // datasheet EVPV410H (132 half-cell HJT): Voc 49.0 (was 51.9), Vmp 42.7, Isc 10.35, Imp 9.61
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
    // v47.406 datasheet fix: JinkoSolar US Eagle 72 570-590N datasheet (jinkosolar.us manufacturer - US SKU for Tiger Neo 580W)
    datasheetUrl: 'https://jinkosolar.us/wp-content/uploads/2023/06/30mm-EAGLE-72-G6B-JKM570-590N-72HL4-BDV-F30-F2-US-1.pdf',
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
    // v47.406 datasheet fix: Canadian Solar HiKu7 CS7L-MS 585-615W datasheet (official CSI Solar CDN)
    datasheetUrl: 'https://static.csisolar.com/wp-content/uploads/sites/9/2023/09/26110438/CS-Datasheet-HiKu7_CS7L-MS_v2.7_EN-1.pdf',
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
    watts: 435, efficiency: 21.77,  // datasheet (was copy-paste 22.6)
    voc: 37.80, vmp: 31.60, isc: 14.72, imp: 13.77,
    tempCoeffVoc: -0.24, tempCoeffIsc: 0.05, tempCoeffPmax: -0.29,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 43, parallelStringLimit: 3,
    weight: 46.5, length: 69.4, width: 44.6, thickness: 1.18,  // datasheet 1762×1134×30mm, 21.1kg (was copy-paste 44.1lb/70.9×41.7)
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
    watts: 400, efficiency: 20.6,  // datasheet: 20.4% (G10+ up to 21.1%); was a fabricated 22.4%
    voc: 41.60, vmp: 34.50, isc: 12.26, imp: 11.59,
    tempCoeffVoc: -0.26, tempCoeffIsc: 0.05, tempCoeffPmax: -0.35,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 45, parallelStringLimit: 3,
    weight: 44.1, length: 70.9, width: 41.7, thickness: 1.38,
    warranty: '25yr product / 25yr power', ulListing: 'UL 61730',
    bifacial: false, cellType: 'mono-PERC',
    // v47.406 datasheet fix: Qcells Q.Peak Duo BLK ML-G10+ 385-405 datasheet (CED Electrical Supply distributor mirror)
    datasheetUrl: 'https://cdn.myced.com/images/Products/ZZ0000/ZZ3048/00000/ZZ304800232_DS.pdf',
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
    // v47.406 datasheet fix: Silfab SIL-430-QD datasheet (Krannich Solar distributor mirror; Silfab CDN blocks crawlers)
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Modules/Silfab/Silfab-SIL-430-QD.pdf',
  },
  // Philadelphia Solar — Sol Fence default panel (v47.357)
  // CROSS-REF: lib/equipment-registry-v4.ts (BOM engine lookup)
  //            lib/systemEquipmentResolver.ts resolveDefaultFencePanelSpec() (structural)
  // MUST remain in sync with panel-fence-ps1 definition in all three files.
  {
    id: 'panel-fence-ps1',
    manufacturer: 'Philadelphia Solar',
    model: 'Nexus PS-MNB108(HCBF)-440W',
    category: 'solar_panel',
    watts: 440, efficiency: 22.57,
    voc: 51.2, vmp: 42.8, isc: 10.92, imp: 10.28,
    tempCoeffVoc: -0.30, tempCoeffIsc: 0.04, tempCoeffPmax: -0.34,
    maxSystemVoltage: 1000, maxSeriesFuseRating: 20,
    nominalOperatingTemp: 45, parallelStringLimit: 3,
    weight: 46.0, length: 67.8, width: 44.6, thickness: 1.38,
    warranty: '30yr product / 30yr power', ulListing: 'UL 61730, IEC 61215',
    bifacial: true, cellType: 'N-type TOPCon',
    datasheetUrl: 'https://ussolarsupplier.com/products/philadelphia-solar-440w-solar-panels-108-cell-bifacial-mnb108hcbf-440w',
    active: true, // REACTIVATED 2026-06-21: the v47.406 "out of business / unreachable" premise was WRONG — Philadelphia Solar (Jordan, est. 2007) is actively manufacturing and the exact Nexus MNB108(HCBF)-440W is in stock at US distributors (US Solar Supplier, A1 SolarStore, RockSolar). This is the SolFence default fence panel (SolFence distributor price $262.50).
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
    nominalDcVoltage: 400, // v47.415 — HD-Wave fixed DC bus (400V nominal)
    // HD-Wave single-phase has 1 fixed-voltage DC input; 1-3 parallel strings per input.
    // Datasheet max input current = 20A (total on the single input).
    maxInputCurrentPerMppt: 20.0, maxShortCircuitCurrent: 24.0, mpptChannels: 1, numberOfMPPT: 1,
    // v47.416 — Per official SolarEdge HD-Wave NA datasheet: SE7600H-US is "1-2 strings".
    // Was 3 (wrong) — reconciled against
    // https://media.unboundsolar.com/.../solaredge-se7600h-hd-wave-inverter-specs-20190311174102.9995976-1.pdf
    maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 8, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.405 datasheet fix: SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://nwsolar.com/wp-content/uploads/2022/02/se-hd-wave-single-phase-inverter-with-setapp-datasheet-na.pdf',
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'hdwave',
    compatibleWith: ['se-p401', 'se-p505', 'se-p730'],
    active: true,
  },
  {
    id: 'se-10000h',
    manufacturer: 'SolarEdge',
    model: 'SE10000H-US',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
    nominalDcVoltage: 380, // v47.421 — datasheet fix: SE10000H nominal DC input = 380V
    // HD-Wave single-phase has 1 fixed-voltage DC input; 1-3 parallel strings per input.
    // Datasheet: max input current = 27A (operating), max short-circuit current = 45A.
    maxInputCurrentPerMppt: 27.0, maxShortCircuitCurrent: 45.0, mpptChannels: 1, numberOfMPPT: 1,
    maxParallelStringsPerMppt: 3,
    recommendedStringRange: { min: 8, max: 15 },
    acOutputVoltage: 240, acOutputCurrentMax: 42,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.405 datasheet fix: SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://nwsolar.com/wp-content/uploads/2022/02/se-hd-wave-single-phase-inverter-with-setapp-datasheet-na.pdf',
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'hdwave',
    compatibleWith: ['se-p401', 'se-p505', 'se-p730', 'se-p850'],
    active: true,
  },
  {
    id: 'fronius-primo-7.6',
    manufacturer: 'Fronius',
    model: 'Primo 7.6-1',
    category: 'string_inverter',
    acOutputKw: 7.6, dcInputKwMax: 11.4,
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 18.0, maxShortCircuitCurrent: 27.0, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 6, max: 14 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 34.2, dimensions: '22.2 x 17.7 x 6.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    // v47.403 datasheet fix: Shared Fronius Primo UL datasheet (covers 3.8-1 through 11.4-1)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.fronius.com/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Primo_UL_EN_CA.pdf',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'fronius',
    ecosystemFamily: 'primo',
    active: true,
  },
  {
    id: 'sma-sb-7.7',
    manufacturer: 'SMA',
    model: 'Sunny Boy 7.7-US',
    category: 'string_inverter',
    acOutputKw: 7.7, dcInputKwMax: 11.55,
    maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
    // v47.417 — Datasheet reconciliation (SMA Sunny Boy US-41 official datasheet):
    //   Max operating input current per MPPT = 10 A (DB was 15 A — WRONG)
    //   Max short-circuit current per MPPT = 18 A (correct)
    //   Number of MPPT trackers = 3 for SB 6.0/7.0/7.7 (DB was 2 — WRONG)
    //   Strings per MPPT = 1
    maxInputCurrentPerMppt: 10.0, maxShortCircuitCurrent: 18.0, mpptChannels: 3, numberOfMPPT: 3,
    maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 6, max: 14 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 48.5, dimensions: '24.0 x 18.0 x 8.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    // v47.403 datasheet fix: Shared SMA Sunny Boy US-41 datasheet (covers 3.0 through 7.7 kW)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://files.sma.de/downloads/SBxx-US-DS-en-41.pdf',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'sma',
    ecosystemFamily: 'sunny-boy',
    active: true,
  },
  {
    id: 'sungrow-sg10rs',
    manufacturer: 'Sungrow',
    model: 'SG10RS',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 600, mpptVoltageMin: 40, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 14.0, maxShortCircuitCurrent: 17.0, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 8, max: 15 },
    acOutputVoltage: 240, acOutputCurrentMax: 42,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 26.5, dimensions: '17.3 x 14.2 x 6.9',
    warranty: '10yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: '',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'sungrow',
    ecosystemFamily: 'sg-rs',
    active: true, // v61.10: Sungrow RS models activated — UL 1741 listed, available via Sungrow US distributors
  },
  // ── SolarEdge HD-Wave expanded lineup ─────────────────────────────────────
  {
    id: 'se-3800h',
    manufacturer: 'SolarEdge',
    model: 'SE3800H-US',
    category: 'string_inverter',
    acOutputKw: 3.8, dcInputKwMax: 5.7,
    maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
    nominalDcVoltage: 380, // v47.421 — datasheet fix: SE3800H nominal DC input = 380V
    // HD-Wave single-phase has 1 fixed-voltage DC input; 1-2 parallel strings per input.
    // Datasheet max input current = 10.5A (total on the single input).
    maxInputCurrentPerMppt: 10.5, maxShortCircuitCurrent: 13.0, mpptChannels: 1, numberOfMPPT: 1,
    maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 6, max: 10 },
    acOutputVoltage: 240, acOutputCurrentMax: 16,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.405 datasheet fix: SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://nwsolar.com/wp-content/uploads/2022/02/se-hd-wave-single-phase-inverter-with-setapp-datasheet-na.pdf',
    isNew: true,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'hdwave',
    compatibleWith: ['se-p320', 'se-p401', 'se-p505'],
    active: true,
  },
  {
    id: 'se-6000h',
    manufacturer: 'SolarEdge',
    model: 'SE6000H-US',
    category: 'string_inverter',
    acOutputKw: 6.0, dcInputKwMax: 9.0,
    maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
    nominalDcVoltage: 380, // v47.421 — datasheet fix: SE6000H nominal DC input = 380V
    // HD-Wave single-phase has 1 fixed-voltage DC input; 1-2 parallel strings per input.
    // Datasheet max input current = 16.5A (total on the single input).
    maxInputCurrentPerMppt: 16.5, maxShortCircuitCurrent: 20.0, mpptChannels: 1, numberOfMPPT: 1,
    maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 6, max: 12 },
    acOutputVoltage: 240, acOutputCurrentMax: 25,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.405 datasheet fix: SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://nwsolar.com/wp-content/uploads/2022/02/se-hd-wave-single-phase-inverter-with-setapp-datasheet-na.pdf',
    isNew: true,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'hdwave',
    compatibleWith: ['se-p320', 'se-p401', 'se-p505'],
    active: true,
  },
  {
    id: 'se-11400h',
    manufacturer: 'SolarEdge',
    model: 'SE11400H-US',
    category: 'string_inverter',
    acOutputKw: 11.4, dcInputKwMax: 17.1,
    maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
    nominalDcVoltage: 380, // v47.421 — datasheet fix: SE11400H nominal DC input = 380V
    // (SE7600H is 400V; SE3800H–SE6000H and SE10000H–SE11400H are 380V per SolarEdge String Sizing AppNote)
    // HD-Wave single-phase has 1 fixed-voltage DC input; 1-3 parallel strings per input.
    // Datasheet: max input current = 30.5A (operating), max short-circuit current = 45A.
    maxInputCurrentPerMppt: 30.5, maxShortCircuitCurrent: 45.0, mpptChannels: 1, numberOfMPPT: 1,
    maxParallelStringsPerMppt: 3,
    recommendedStringRange: { min: 10, max: 18 },
    acOutputVoltage: 240, acOutputCurrentMax: 47.5,
    efficiency: 99.2, cec_efficiency: 99.0,
    weight: 25.4, dimensions: '17.7 x 14.6 x 7.2',
    warranty: '12yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.405 datasheet fix: SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://nwsolar.com/wp-content/uploads/2022/02/se-hd-wave-single-phase-inverter-with-setapp-datasheet-na.pdf',
    isNew: true,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'hdwave',
    compatibleWith: ['se-p505', 'se-p730', 'se-p850'],
    active: true,
  },
  // ── SMA Sunny Boy expanded lineup ─────────────────────────────────────────
  {
    id: 'sma-sb-5.0',
    manufacturer: 'SMA',
    model: 'Sunny Boy 5.0-US',
    category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 7.5,
    maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
    // v47.417 — Datasheet reconciliation (SMA Sunny Boy US-41 official datasheet):
    //   Max operating input current per MPPT = 10 A (DB was 15 A — WRONG)
    //   Max short-circuit current per MPPT = 18 A (correct)
    //   Number of MPPT trackers = 2 for SB 3.0/3.8/5.0 (correct)
    //   Strings per MPPT = 1
    maxInputCurrentPerMppt: 10.0, maxShortCircuitCurrent: 18.0, mpptChannels: 2, numberOfMPPT: 2,
    maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 5, max: 11 },
    acOutputVoltage: 240, acOutputCurrentMax: 21,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 48.5, dimensions: '24.0 x 18.0 x 8.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    // v47.403 datasheet fix: Shared SMA Sunny Boy US-41 datasheet (covers 3.0 through 7.7 kW)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://files.sma.de/downloads/SBxx-US-DS-en-41.pdf',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'sma',
    ecosystemFamily: 'sunny-boy',
    active: true,
    isNew: true,
  },
  // SMA Sunny Boy 6.0-US
  // Source: SMA Sunny Boy US-41 official datasheet (covers SB 3.0/3.8/5.0/6.0/7.7)
  // 2 MPPT trackers for 6.0 kW; 1 string per MPPT; max 10A/MPPT
  {
    id: 'sma-sb-6.0',
    manufacturer: 'SMA',
    model: 'Sunny Boy 6.0-US',
    category: 'string_inverter',
    acOutputKw: 6.0, dcInputKwMax: 9.0,
    maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
    // SMA Sunny Boy US-41 datasheet: SB 6.0 uses 2 MPPT trackers, 1 string/MPPT
    // Max operating input current per MPPT = 10 A
    // Max short-circuit current per MPPT = 18 A
    maxInputCurrentPerMppt: 10.0, maxShortCircuitCurrent: 18.0, mpptChannels: 2, numberOfMPPT: 2,
    maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 5, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 25,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 48.5, dimensions: '24.0 x 18.0 x 8.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://files.sma.de/downloads/SBxx-US-DS-en-41.pdf',
    ecosystemBrand: 'sma',
    ecosystemFamily: 'sunny-boy',
    active: true,
    isNew: false,
  },
  {
    id: 'sma-sb-10.0',
    manufacturer: 'SMA',
    model: 'Sunny Boy 10000TL-US (discontinued)',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    // v47.417 — Datasheet reconciliation (SMA Sunny Boy TL-US datasheet, discontinued product):
    //   MPPT voltage range 345–480 V (rated 379 V); NOT 100–600 V
    //   Max input current per MPPT = 33.3 A (240 V variant)
    //   2 MPPT trackers, up to 6 strings per MPPT via external Combiner Box
    //   Note: this older product is no longer shipping. SMA's current US 10 kW+ offering is
    //   the Sunny Tripower Smart Energy (3-phase) — not equivalent for single-phase residential.
    //   active: false so the UI filter hides it; kept in DB for legacy project compatibility.
    maxDcVoltage: 600, mpptVoltageMin: 345, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 33.3, maxShortCircuitCurrent: 36.7, mpptChannels: 2, numberOfMPPT: 2,
    maxParallelStringsPerMppt: 6,
    recommendedStringRange: { min: 8, max: 14 },
    acOutputVoltage: 240, acOutputCurrentMax: 42,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 48.5, dimensions: '24.0 x 18.0 x 8.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    // v47.404 datasheet fix: SMA Sunny Boy 6000-9000 TL-US distributor mirror (EcoDirect; SMA discontinued this product)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://s3.amazonaws.com/ecodirect_docs/SMA/SunnyBoy_TL-US.pdf',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'sma',
    ecosystemFamily: 'sunny-boy',
    // v47.417 — Discontinued product, deactivated per datasheet reconciliation
    active: false,
    isNew: false,
  },
  // ── Fronius Primo expanded lineup ──────────────────────────────────────────
  {
    id: 'fronius-primo-5.0',
    manufacturer: 'Fronius',
    model: 'Primo 5.0-1',
    category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 7.5,
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 18.0, maxShortCircuitCurrent: 27.0, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 5, max: 11 },
    acOutputVoltage: 240, acOutputCurrentMax: 21,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 34.2, dimensions: '22.2 x 17.7 x 6.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    // v47.403 datasheet fix: Shared Fronius Primo UL datasheet (covers 3.8-1 through 11.4-1)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.fronius.com/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Primo_UL_EN_CA.pdf',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'fronius',
    ecosystemFamily: 'primo',
    active: true,
    isNew: true,
  },
  {
    id: 'fronius-primo-8.2',
    manufacturer: 'Fronius',
    model: 'Primo 8.2-1',
    category: 'string_inverter',
    acOutputKw: 8.2, dcInputKwMax: 12.3,
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 18.0, maxShortCircuitCurrent: 27.0, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 7, max: 15 },
    acOutputVoltage: 240, acOutputCurrentMax: 34,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 34.2, dimensions: '22.2 x 17.7 x 6.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    // v47.403 datasheet fix: Shared Fronius Primo UL datasheet (covers 3.8-1 through 11.4-1)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.fronius.com/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Primo_UL_EN_CA.pdf',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'fronius',
    ecosystemFamily: 'primo',
    active: true,
    isNew: true,
  },
  {
    id: 'fronius-primo-10.0',
    manufacturer: 'Fronius',
    model: 'Primo 10.0-1',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 18.0, maxShortCircuitCurrent: 27.0, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 8, max: 16 },
    acOutputVoltage: 240, acOutputCurrentMax: 42,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 34.2, dimensions: '22.2 x 17.7 x 6.7',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: false, groundFaultProtection: true,
    // v47.403 datasheet fix: Shared Fronius Primo UL datasheet (covers 3.8-1 through 11.4-1)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.fronius.com/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Primo_UL_EN_CA.pdf',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'fronius',
    ecosystemFamily: 'primo',
    active: true,
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
    maxInputCurrentPerMppt: 14.0, maxShortCircuitCurrent: 17.0, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 5, max: 11 },
    acOutputVoltage: 240, acOutputCurrentMax: 21,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 24.0, dimensions: '16.5 x 13.8 x 6.5',
    warranty: '10yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: '',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'sungrow',
    ecosystemFamily: 'sg-rs',
    active: true, // v61.10: Sungrow RS models activated — UL 1741 listed, available via Sungrow US distributors
    isNew: true,
  },
  {
    id: 'sungrow-sg7.6rs',
    manufacturer: 'Sungrow',
    model: 'SG7.6RS',
    category: 'string_inverter',
    acOutputKw: 7.6, dcInputKwMax: 11.4,
    maxDcVoltage: 600, mpptVoltageMin: 40, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 14.0, maxShortCircuitCurrent: 17.0, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 6, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 24.0, dimensions: '16.5 x 13.8 x 6.5',
    warranty: '10yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: '',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'sungrow',
    ecosystemFamily: 'sg-rs',
    active: true, // v61.10: Sungrow RS models activated — UL 1741 listed, available via Sungrow US distributors
    isNew: true,
  },
  {
    id: 'sungrow-sg15rs',
    manufacturer: 'Sungrow',
    model: 'SG15RS',
    category: 'string_inverter',
    acOutputKw: 15.0, dcInputKwMax: 22.5,
    maxDcVoltage: 600, mpptVoltageMin: 40, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 14.0, maxShortCircuitCurrent: 17.0, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 10, max: 20 },
    acOutputVoltage: 240, acOutputCurrentMax: 62.5,
    efficiency: 97.7, cec_efficiency: 97.5,
    weight: 28.0, dimensions: '17.3 x 14.2 x 6.9',
    warranty: '10yr (extendable to 25yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: '',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'sungrow',
    ecosystemFamily: 'sg-rs',
    active: false, // v47.404: Sungrow has no US residential catalog; deactivated pending SKU confirmation
    isNew: true,
  },
  // ── GoodWe lineup ─────────────────────────────────────────────────────────
  {
    id: 'goodwe-gw5000-ns',
    manufacturer: 'GoodWe',
    model: 'GW5000-NS',
    category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 7.5,
    // v47.417 — Datasheet reconciliation (GoodWe DNS series official datasheet):
    //   MPPT voltage range 80–550 V (start-up 80 V, not 90 V)
    //   Max operating input current per MPPT = 11 A (D-series/single phase)
    //   Max short-circuit current per MPPT = 13.8 A
    //   2 MPPT trackers, 1 string per MPPT (Integrated DC disconnect)
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 550,
    maxInputCurrentPerMppt: 11.0, maxShortCircuitCurrent: 13.8, mpptChannels: 2, numberOfMPPT: 2,
    maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 5, max: 11 },
    acOutputVoltage: 240, acOutputCurrentMax: 21,
    efficiency: 97.8, cec_efficiency: 97.5,
    weight: 22.0, dimensions: '15.7 x 13.4 x 6.3',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.404 datasheet fix: GoodWe DNS series datasheet (official manufacturer PDF)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_DNS_Datasheet-EN.pdf',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'goodwe',
    ecosystemFamily: 'ns',
    active: true,
    isNew: true,
  },
  {
    id: 'goodwe-gw10k-ms',
    manufacturer: 'GoodWe',
    model: 'GW9600-MS-US',
    category: 'string_inverter',
    acOutputKw: 9.6, dcInputKwMax: 14.4,
    // v47.417 — Datasheet reconciliation (GoodWe MS-US official datasheet):
    //   The "GW10K-MS" SKU does NOT exist in the GoodWe MS-US catalog.
    //   The MS-US series is 5/6/7.7/9.6/11.4 kW. Remapped to GW9600-MS-US (closest).
    //   MPPT voltage range at 240 V = 210–500 V (not 90–550)
    //   Max operating input current per MPPT = 16 A (not 12.5 A — WRONG)
    //   Max short-circuit current per MPPT = 23.4 A (not 15.0 A — WRONG)
    //   Number of MPP trackers = 3 for 7.7/9.6/11.4 kW models (not 2 — WRONG)
    //   1 string per MPPT. Integrated AFCI, rapid shutdown, DC disconnect.
    maxDcVoltage: 600, mpptVoltageMin: 210, mpptVoltageMax: 500,
    maxInputCurrentPerMppt: 16.0, maxShortCircuitCurrent: 23.4, mpptChannels: 3, numberOfMPPT: 3,
    maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 8, max: 14 },
    acOutputVoltage: 240, acOutputCurrentMax: 40,
    efficiency: 97.8, cec_efficiency: 97.5,
    weight: 26.0, dimensions: '16.5 x 14.0 x 6.5',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.404 datasheet fix: GoodWe MS-US datasheet (explicitly US-market 5-10kW single phase)
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_MS-US_Datasheet-EN.pdf',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'goodwe',
    ecosystemFamily: 'ms',
    active: true,
    isNew: true,
  },
  // GoodWe GW7700-MS-US — 7.7 kW single-phase string inverter
  // Source: GoodWe MS-US series datasheet (official manufacturer PDF)
  // MS-US series: 3 MPPT trackers for 7.7/9.6/11.4 kW models, 1 string/MPPT
  // Max input current per MPPT: 16 A; Max Voc: 600 V; MPPT range: 210-500 V
  {
    id: 'goodwe-gw7700-ms',
    manufacturer: 'GoodWe',
    model: 'GW7700-MS-US',
    category: 'string_inverter',
    acOutputKw: 7.7, dcInputKwMax: 11.55,
    maxDcVoltage: 600, mpptVoltageMin: 210, mpptVoltageMax: 500,
    maxInputCurrentPerMppt: 16.0, maxShortCircuitCurrent: 23.4, mpptChannels: 3, numberOfMPPT: 3,
    maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 6, max: 14 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 97.8, cec_efficiency: 97.5,
    weight: 26.0, dimensions: '16.5 x 14.0 x 6.5',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_MS-US_Datasheet-EN.pdf',
    ecosystemBrand: 'goodwe',
    ecosystemFamily: 'ms',
    active: true,
    isNew: false,
  },
  // GoodWe GW11400-MS-US — 11.4 kW single-phase string inverter
  // Source: GoodWe MS-US series datasheet (official manufacturer PDF)
  // MS-US series: 3 MPPT trackers, 1 string/MPPT, max input current 16 A
  {
    id: 'goodwe-gw11400-ms',
    manufacturer: 'GoodWe',
    model: 'GW11400-MS-US',
    category: 'string_inverter',
    acOutputKw: 11.4, dcInputKwMax: 17.1,
    maxDcVoltage: 600, mpptVoltageMin: 210, mpptVoltageMax: 500,
    maxInputCurrentPerMppt: 16.0, maxShortCircuitCurrent: 23.4, mpptChannels: 3, numberOfMPPT: 3,
    maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 8, max: 16 },
    acOutputVoltage: 240, acOutputCurrentMax: 47.5,
    efficiency: 97.8, cec_efficiency: 97.5,
    weight: 28.0, dimensions: '16.5 x 14.0 x 6.5',
    warranty: '10yr (extendable to 20yr)', ulListing: 'UL 1741 / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_MS-US_Datasheet-EN.pdf',
    ecosystemBrand: 'goodwe',
    ecosystemFamily: 'ms',
    active: true,
    isNew: false,
  },
  // ═══ EcoFlow PowerOcean — Hybrid inverters, v47.358 ═══════════════════════
  // CROSS-REF: lib/ecoflow-system.ts (canonical source), lib/equipment-registry-v4.ts (BOM lookup)
  {
    id: 'ecoflow-power-ocean-5kw',
    manufacturer: 'EcoFlow', model: 'PowerOcean 5kW Hybrid', category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 7.5,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 550,
    maxInputCurrentPerMppt: 15, maxShortCircuitCurrent: 20, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 6, max: 14 },
    acOutputVoltage: 240, acOutputCurrentMax: 20.8,
    efficiency: 97.5, cec_efficiency: 97.0,
    weight: 55.1, dimensions: '22.0 x 18.0 x 8.5',
    warranty: '10yr standard', ulListing: 'UL 1741-SA',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: '',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'ecoflow',
    ecosystemFamily: 'powerocean',
    active: false, // v47.404: EcoFlow PowerOcean is AU/EU-only; deactivated pending US launch
    isNew: true,
  },
  {
    id: 'ecoflow-power-ocean-10kw',
    manufacturer: 'EcoFlow', model: 'PowerOcean 10kW Hybrid', category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 600, mpptVoltageMin: 120, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 15, maxShortCircuitCurrent: 20, mpptChannels: 3, numberOfMPPT: 3, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 6, max: 14 },
    acOutputVoltage: 240, acOutputCurrentMax: 41.7,
    efficiency: 97.8, cec_efficiency: 97.3,
    weight: 77.2, dimensions: '24.0 x 20.0 x 9.0',
    warranty: '10yr standard', ulListing: 'UL 1741-SA',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: '',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'ecoflow',
    ecosystemFamily: 'powerocean',
    active: false, // v47.404: EcoFlow PowerOcean is AU/EU-only; deactivated pending US launch
    isNew: true,
  },
  {
    id: 'ecoflow-power-ocean-20kw',
    manufacturer: 'EcoFlow', model: 'PowerOcean Pro 20kW Hybrid', category: 'string_inverter',
    acOutputKw: 20.0, dcInputKwMax: 30.0,
    maxDcVoltage: 1000, mpptVoltageMin: 120, mpptVoltageMax: 1000,
    maxInputCurrentPerMppt: 20, maxShortCircuitCurrent: 26, mpptChannels: 4, numberOfMPPT: 4, maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 8, max: 18 },
    acOutputVoltage: 240, acOutputCurrentMax: 83.3,
    efficiency: 98.0, cec_efficiency: 97.5,
    weight: 121.3, dimensions: '28.0 x 22.0 x 10.5',
    warranty: '10yr standard', ulListing: 'UL 1741-SA',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: '',
    // v47.400 — ecosystem tag (Stage 2)
    ecosystemBrand: 'ecoflow',
    ecosystemFamily: 'powerocean-pro',
    active: false, // v47.404: EcoFlow PowerOcean Pro is AU/EU-only; deactivated pending US launch
    isNew: true,
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // v58.14 — EcoFlow OCEAN Pro (US) — hybrid string inverter / PCS
  //   Model number: EF-PCS-24
  //   Source datasheet: https://enterprise-service-us-cdn.ecoflow.com/
  //                     enterprise/documentation/1760684472240/
  //                     Ocean%20Pro%20PCS%20datasheet%20v1013_View.pdf
  //
  //   Note: EF-PCS-24 is a single hardware platform sold in two configured
  //   AC output tiers — 11.5 kW and 24 kW. We model both as separate DB
  //   rows so the sizing engine can pick between them based on DC kW.
  //   Electrical specs (MPPTs, DC input, enclosure, weight) are identical
  //   across both tiers per datasheet.
  // ═══════════════════════════════════════════════════════════════════════════════════════
  {
    id: 'ecoflow-ocean-pro-11kw',
    manufacturer: 'EcoFlow', model: 'OCEAN Pro Hybrid Inverter (11.5 kW)', category: 'string_inverter',
    acOutputKw: 11.5, dcInputKwMax: 40.0,
    maxDcVoltage: 600, mpptVoltageMin: 60, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 16, maxShortCircuitCurrent: 20, mpptChannels: 8, numberOfMPPT: 8, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 4, max: 16 },
    acOutputVoltage: 240, acOutputCurrentMax: 48.0,
    efficiency: 97.5, cec_efficiency: 97.0,
    weight: 146.6, dimensions: '43.3 x 17.3 x 10.3',
    warranty: '15yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://enterprise-service-us-cdn.ecoflow.com/enterprise/documentation/1760684472240/Ocean%20Pro%20PCS%20datasheet%20v1013_View.pdf',
    ecosystemBrand: 'ecoflow',
    ecosystemFamily: 'ocean-pro',
    active: true,
    isNew: true,
  },
  {
    id: 'ecoflow-ocean-pro-24kw',
    manufacturer: 'EcoFlow', model: 'OCEAN Pro Hybrid Inverter (24 kW)', category: 'string_inverter',
    acOutputKw: 24.0, dcInputKwMax: 40.0,
    maxDcVoltage: 600, mpptVoltageMin: 60, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 16, maxShortCircuitCurrent: 20, mpptChannels: 8, numberOfMPPT: 8, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 4, max: 16 },
    acOutputVoltage: 240, acOutputCurrentMax: 100.0,
    efficiency: 97.5, cec_efficiency: 97.0,
    weight: 146.6, dimensions: '43.3 x 17.3 x 10.3',
    warranty: '15yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://enterprise-service-us-cdn.ecoflow.com/enterprise/documentation/1760684472240/Ocean%20Pro%20PCS%20datasheet%20v1013_View.pdf',
    ecosystemBrand: 'ecoflow',
    ecosystemFamily: 'ocean-pro',
    active: true,
    isNew: true,
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // v47.399 — Sol-Ark hybrid inverter family (Stage 1 of upgrade roadmap)
  // All datasheetUrl values verified HTTP 200 against sol-ark.com on 2025-01
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'solark-8k-2p',
    manufacturer: 'Sol-Ark',
    model: '8K-2P',
    category: 'string_inverter',
    acOutputKw: 8.0, dcInputKwMax: 10.5,
    // v47.418 — Datasheet reconciliation (Sol-Ark 8K-2P official datasheet):
    //   Max input voltage 500 V, rated MPPT range 175–425 V, MPPT range 150–500 V
    //   Max operating input current per MPPT = 18 A (self-limiting, per datasheet)
    //   Sol-Ark does NOT publish a separate "max short-circuit current per MPPT"
    //   value — the channel is internally self-limiting. We therefore set
    //   maxShortCircuitCurrent = maxInputCurrentPerMppt (18 A) rather than
    //   deriving a fake 1.25× number. The PV feeder conductor carries panel
    //   Isc × 1.25 (NEC 690.8(A)(1)) regardless of inverter self-limiting —
    //   that math lives in ocpd-resolver.ts and uses panelIsc, not this field.
    //   2 MPPT trackers, 2 strings per MPPT, integrated DC disconnect (NEC 240.15).
    maxDcVoltage: 500, mpptVoltageMin: 150, mpptVoltageMax: 425,
    maxInputCurrentPerMppt: 18.0, maxShortCircuitCurrent: 18.0,
    mpptChannels: 2, numberOfMPPT: 2,
    maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 6, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 33.3,
    efficiency: 97.5, cec_efficiency: 97.0,
    weight: 95.0, dimensions: '19.0 x 27.1 x 10.0',
    warranty: '10yr standard', ulListing: 'UL 1741-SB / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.sol-ark.com/wp-content/uploads/2024/06/SK150-0005-002-8K-2P-N-EN-Datasheet.pdf',
    ecosystemBrand: 'sol-ark',
    ecosystemFamily: 'hybrid-residential',
    active: true,
    isNew: true,
  },
  {
    id: 'solark-12k-2p',
    manufacturer: 'Sol-Ark',
    model: '12K-2P',
    category: 'string_inverter',
    acOutputKw: 12.0, dcInputKwMax: 19.5,
    // v47.418 — Datasheet reconciliation (Sol-Ark 12K-2P official datasheet):
    //   Max input voltage 500 V, rated MPPT range 175–425 V, MPPT range 150–500 V
    //   Max operating input current per MPPT = 20 A (self-limiting, per datasheet)
    //   Sol-Ark does NOT publish a separate "max short-circuit current per MPPT"
    //   value for this model. Setting maxShortCircuitCurrent = 20 A (matches the
    //   self-limit). PV feeder conductor sizing uses panel Isc × 1.25 via
    //   ocpd-resolver.ts regardless (NEC 690.8(A)(1)).
    //   2 MPPT trackers, 2 strings per MPPT, integrated DC disconnect (NEC 240.15).
    maxDcVoltage: 500, mpptVoltageMin: 150, mpptVoltageMax: 425,
    maxInputCurrentPerMppt: 20.0, maxShortCircuitCurrent: 20.0,
    mpptChannels: 2, numberOfMPPT: 2,
    maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 6, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 50.0,
    efficiency: 98.0, cec_efficiency: 97.5,
    weight: 116.0, dimensions: '19.0 x 27.1 x 10.0',
    warranty: '10yr standard', ulListing: 'UL 1741-SB / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.sol-ark.com/wp-content/uploads/2024/06/SK150-0003-002-12K-2P-N-EN-Datasheet.pdf',
    ecosystemBrand: 'sol-ark',
    ecosystemFamily: 'hybrid-residential',
    active: true,
    isNew: true,
  },
  {
    id: 'solark-15k-2p',
    manufacturer: 'Sol-Ark',
    model: '15K-2P',
    category: 'string_inverter',
    acOutputKw: 15.0, dcInputKwMax: 19.5,
    // v47.417 — Datasheet reconciliation (Sol-Ark 15K-2P official datasheet):
    //   Max input voltage 500 V, rated MPPT range 175–425 V, MPPT range 150–500 V
    //   Max operating input current per MPPT = 26 A (matches DB)
    //   Max short-circuit current per MPPT = 44 A (DB had 32 A — WRONG)
    //   3 MPPT trackers, 2 strings per MPPT, integrated DC disconnect (NEC 240.15)
    maxDcVoltage: 500, mpptVoltageMin: 150, mpptVoltageMax: 425,
    maxInputCurrentPerMppt: 26.0, maxShortCircuitCurrent: 44.0,
    mpptChannels: 3, numberOfMPPT: 3,
    maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 6, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 62.5,
    efficiency: 97.6, cec_efficiency: 97.0,
    weight: 125.0, dimensions: '19.0 x 27.1 x 10.0',
    warranty: '10yr standard', ulListing: 'UL 1741-SB / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.sol-ark.com/wp-content/uploads/2024/06/SK150-0001-002-15K-2P-N-EN-Datasheet.pdf',
    ecosystemBrand: 'sol-ark',
    ecosystemFamily: 'hybrid-residential',
    active: true,
    isNew: true,
  },
  {
    id: 'solark-30k-3p-208v',
    manufacturer: 'Sol-Ark',
    model: '30K-3P-208V',
    category: 'string_inverter',
    acOutputKw: 30.0, dcInputKwMax: 45.0,
    // v47.417 — Datasheet reconciliation (Sol-Ark 30K-3P-208V official datasheet):
    //   Max input voltage = 550 V (DB had 1000 V — WAY WRONG, was 2× actual)
    //   MPPT voltage range = 150–500 V (DB had 200–850 V — WRONG)
    //   Max operating input current per MPPT = 36 A (DB had 30 A — WRONG)
    //   Max short-circuit current per MPPT = 55 A (DB had 40 A — WRONG)
    //   4 MPPT trackers, 2 strings per MPPT, integrated DC disconnect (NEC 240.15)
    maxDcVoltage: 550, mpptVoltageMin: 150, mpptVoltageMax: 500,
    maxInputCurrentPerMppt: 36.0, maxShortCircuitCurrent: 55.0,
    mpptChannels: 4, numberOfMPPT: 4,
    maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 10, max: 20 },
    acOutputVoltage: 208, acOutputCurrentMax: 83.5,
    efficiency: 97.6, cec_efficiency: 97.0,
    weight: 176.0, dimensions: '28.0 x 29.5 x 11.0',
    warranty: '10yr standard', ulListing: 'UL 1741-SB / IEEE 1547',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    // v47.417 — Factory-integrated DC disconnect per datasheet
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.sol-ark.com/wp-content/uploads/2024/05/SK150-0017-004_30K-3P-208V-datasheet.pdf',
    ecosystemBrand: 'sol-ark',
    ecosystemFamily: 'hybrid-commercial',
    active: true,
    isNew: true,
  },
  // ═════════════════════════════════════════════════════════════════════════
  // v47.420 — Stage 5.1: Growatt MIN TL-XH-US hybrid inverter family
  // Residential single-phase 240V/208V split-phase battery-ready inverters.
  // Topology: hybrid (native DC-coupled battery bus at 380–550V — Growatt APX
  // HV / ARO HV / LG Prime / LG enblock compatible).
  //
  // Datasheet sources (verified HTTP 200 on 2025-01 against us.growatt.com):
  //   3–7.6 kW:  https://us.growatt.com/upload/file/MIN_3000-7600TL-XH-US_Datasheet_EN_202401.pdf
  //   8.2–11.4:  https://us.growatt.com/upload/file/MIN_8200-11400TL-XH-US_Datasheet_EN_202402.pdf
  //   Product:   https://us.growatt.com/products/min_3000-11400tl-xh-us
  //
  // Family constants (IDENTICAL across all 9 SKUs — locked by datasheet):
  //   Max DC system voltage:              600 V
  //   Startup voltage:                    80 V
  //   Nominal DC voltage:                 360 V
  //   Max input current per MPPT:         13.5 A   (every model)
  //   Max short-circuit current per MPPT: 16.9 A   (every model)
  //   PV strings per MPPT:                2
  //   Battery voltage range:              50–550 V (Growatt) / 50–450 V (LG)
  //   Integrated DC Switch:               Yes  (NEC 690.13 satisfied)
  //   Rapid shutdown / AFCI:              Yes  (UL 1699B + UL 1741-SB)
  //   Certifications: UL 1741 / 1741-SA / 1741-SB / 1699B, IEEE 1547 / 1547.1,
  //                   HECO SRD-IEEE-1547.1, CA Rule 21, CSA C22.2 107.1, UL 9540
  //
  // SKU lineup (shipping 5 of the 9 catalog models — the residential
  // workhorses most commonly deployed in the US market). 3.0, 3.8, 8.2, 9.0
  // are omitted — customers who need those can be added in a later release.
  // ═════════════════════════════════════════════════════════════════════════
  {
    id: 'growatt-min-5000tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 5000TL-XH-US',
    category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 10.0,
    // Datasheet: Full-load voltage range 200–500 V, max DC 600 V, startup 80 V.
    // 2 MPPT trackers, 2 strings per MPPT. Family-constant 13.5 A operating /
    // 16.9 A short-circuit per MPPT (self-limiting per datasheet).
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 500,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.9,
    mpptChannels: 2, numberOfMPPT: 2,
    maxParallelStringsPerMppt: 2,
    nominalDcVoltage: 360,
    recommendedStringRange: { min: 7, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 21.0,
    efficiency: 97.5, cec_efficiency: 97.0,
    weight: 32.3, dimensions: '15.75 x 22.41 x 6.98',
    warranty: '10yr standard (15/20yr extendable)', ulListing: 'UL 1741-SB / IEEE 1547 / UL 1699B / UL 9540',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://us.growatt.com/upload/file/MIN_3000-7600TL-XH-US_Datasheet_EN_202401.pdf',
    ecosystemBrand: 'growatt',
    ecosystemFamily: 'min-tl-xh',
    active: true,
    isNew: true,
  },
  {
    id: 'growatt-min-6000tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 6000TL-XH-US',
    category: 'string_inverter',
    acOutputKw: 6.0, dcInputKwMax: 12.0,
    // Datasheet: Full-load voltage range 160–500 V, max DC 600 V, startup 80 V.
    // 3 MPPT trackers, 2 strings per MPPT. Family-constant 13.5 A / 16.9 A.
    maxDcVoltage: 600, mpptVoltageMin: 160, mpptVoltageMax: 500,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.9,
    mpptChannels: 3, numberOfMPPT: 3,
    maxParallelStringsPerMppt: 2,
    nominalDcVoltage: 360,
    recommendedStringRange: { min: 6, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 25.0,
    efficiency: 98.2, cec_efficiency: 97.5,
    weight: 32.3, dimensions: '15.75 x 22.41 x 6.98',
    warranty: '10yr standard (15/20yr extendable)', ulListing: 'UL 1741-SB / IEEE 1547 / UL 1699B / UL 9540',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://us.growatt.com/upload/file/MIN_3000-7600TL-XH-US_Datasheet_EN_202401.pdf',
    ecosystemBrand: 'growatt',
    ecosystemFamily: 'min-tl-xh',
    active: true,
    isNew: true,
  },
  {
    id: 'growatt-min-7600tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 7600TL-XH-US',
    category: 'string_inverter',
    acOutputKw: 7.6, dcInputKwMax: 15.2,
    // Datasheet: Full-load voltage range 200–500 V, max DC 600 V, startup 80 V.
    // 3 MPPT trackers, 2 strings per MPPT. Family-constant 13.5 A / 16.9 A.
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 500,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.9,
    mpptChannels: 3, numberOfMPPT: 3,
    maxParallelStringsPerMppt: 2,
    nominalDcVoltage: 360,
    recommendedStringRange: { min: 7, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 32.0,
    efficiency: 98.4, cec_efficiency: 97.5,
    weight: 32.3, dimensions: '15.75 x 22.41 x 6.98',
    warranty: '10yr standard (15/20yr extendable)', ulListing: 'UL 1741-SB / IEEE 1547 / UL 1699B / UL 9540',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://us.growatt.com/upload/file/MIN_3000-7600TL-XH-US_Datasheet_EN_202401.pdf',
    ecosystemBrand: 'growatt',
    ecosystemFamily: 'min-tl-xh',
    active: true,
    isNew: true,
  },
  {
    id: 'growatt-min-10000tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 10000TL-XH-US',
    category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 20.0,
    // Datasheet (8.2–11.4 kW PDF): Full-load voltage range 200–500 V,
    // max DC 600 V, startup 80 V. 3 MPPT trackers, 2 strings per MPPT.
    // Family-constant 13.5 A operating / 16.9 A short-circuit per MPPT.
    maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 500,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.9,
    mpptChannels: 3, numberOfMPPT: 3,
    maxParallelStringsPerMppt: 2,
    nominalDcVoltage: 360,
    recommendedStringRange: { min: 7, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 42.0,
    efficiency: 98.3, cec_efficiency: 98.0,
    weight: 45.2, dimensions: '15.75 x 25.12 x 7.36',
    warranty: '10yr standard (15/20yr extendable)', ulListing: 'UL 1741-SB / IEEE 1547 / UL 1699B / UL 9540',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://us.growatt.com/upload/file/MIN_8200-11400TL-XH-US_Datasheet_EN_202402.pdf',
    ecosystemBrand: 'growatt',
    ecosystemFamily: 'min-tl-xh',
    active: true,
    isNew: true,
  },
  {
    id: 'growatt-min-11400tl-xh-us',
    manufacturer: 'Growatt',
    model: 'MIN 11400TL-XH-US',
    category: 'string_inverter',
    acOutputKw: 11.4, dcInputKwMax: 22.8,
    // Datasheet (8.2–11.4 kW PDF): Full-load voltage range 220–500 V,
    // max DC 600 V, startup 80 V. 3 MPPT trackers, 2 strings per MPPT.
    // Family-constant 13.5 A operating / 16.9 A short-circuit per MPPT.
    // Flagship of the residential family — max AC output 48 A @ 240 V.
    maxDcVoltage: 600, mpptVoltageMin: 220, mpptVoltageMax: 500,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.9,
    mpptChannels: 3, numberOfMPPT: 3,
    maxParallelStringsPerMppt: 2,
    nominalDcVoltage: 360,
    recommendedStringRange: { min: 8, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 48.0,
    efficiency: 98.5, cec_efficiency: 98.0,
    weight: 45.2, dimensions: '15.75 x 25.12 x 7.36',
    warranty: '10yr standard (15/20yr extendable)', ulListing: 'UL 1741-SB / IEEE 1547 / UL 1699B / UL 9540',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://us.growatt.com/upload/file/MIN_8200-11400TL-XH-US_Datasheet_EN_202402.pdf',
    ecosystemBrand: 'growatt',
    ecosystemFamily: 'min-tl-xh',
    active: true,
    isNew: true,
  },
  // ═══ Solis S6-EH1P US (v47.426 batch onboarding) ═══════════════════════════
  // Datasheet: Ginlong Solis S6-EH1P-3.8K-11.4K-US (Krannich Solar, Dec 2024)
  // Hybrid single-phase residential family, 240V split-phase, UL1741SB, AFCI integrated.
  // Across family: 600V DC max, 80–520V MPPT range, 16A max input per string,
  // 25.6A max Isc per string, 1 string per MPPT.
  {
    id: 'solis-s6-eh1p-3p8k-us',
    manufacturer: 'Solis', model: 'S6-EH1P3.8K-US', category: 'string_inverter',
    acOutputKw: 3.8, dcInputKwMax: 5.7,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 520,
    maxInputCurrentPerMppt: 16, maxShortCircuitCurrent: 25.6, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 5, max: 11 },
    acOutputVoltage: 240, acOutputCurrentMax: 15.8,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 44.1, dimensions: '21.3 x 15.4 x 8.3',
    warranty: '10yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/Solis/S6-EH1P-US.pdf',
    ecosystemBrand: 'solis',
    ecosystemFamily: 's6-eh1p',
    active: true,
    isNew: true,
  },
  {
    id: 'solis-s6-eh1p-5k-us',
    manufacturer: 'Solis', model: 'S6-EH1P5K-US', category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 7.5,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 520,
    maxInputCurrentPerMppt: 16, maxShortCircuitCurrent: 25.6, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 6, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 20.8,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 44.1, dimensions: '21.3 x 15.4 x 8.3',
    warranty: '10yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/Solis/S6-EH1P-US.pdf',
    ecosystemBrand: 'solis',
    ecosystemFamily: 's6-eh1p',
    active: true,
    isNew: true,
  },
  {
    id: 'solis-s6-eh1p-7p6k-us',
    manufacturer: 'Solis', model: 'S6-EH1P7.6K-US', category: 'string_inverter',
    acOutputKw: 7.6, dcInputKwMax: 11.4,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 520,
    maxInputCurrentPerMppt: 16, maxShortCircuitCurrent: 25.6, mpptChannels: 3, numberOfMPPT: 3, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 6, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 31.7,
    efficiency: 97.6, cec_efficiency: 97.0,
    weight: 48.5, dimensions: '21.3 x 15.4 x 8.3',
    warranty: '10yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/Solis/S6-EH1P-US.pdf',
    ecosystemBrand: 'solis',
    ecosystemFamily: 's6-eh1p',
    active: true,
    isNew: true,
  },
  {
    id: 'solis-s6-eh1p-9p9k-us',
    manufacturer: 'Solis', model: 'S6-EH1P9.9K-US', category: 'string_inverter',
    acOutputKw: 9.9, dcInputKwMax: 14.85,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 520,
    maxInputCurrentPerMppt: 16, maxShortCircuitCurrent: 25.6, mpptChannels: 4, numberOfMPPT: 4, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 7, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 41.3,
    efficiency: 97.6, cec_efficiency: 97.0,
    weight: 52.9, dimensions: '21.3 x 15.4 x 8.3',
    warranty: '10yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/Solis/S6-EH1P-US.pdf',
    ecosystemBrand: 'solis',
    ecosystemFamily: 's6-eh1p',
    active: true,
    isNew: true,
  },
  {
    id: 'solis-s6-eh1p-10k-us',
    manufacturer: 'Solis', model: 'S6-EH1P10K-US', category: 'string_inverter',
    acOutputKw: 10.0, dcInputKwMax: 15.0,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 520,
    maxInputCurrentPerMppt: 16, maxShortCircuitCurrent: 25.6, mpptChannels: 4, numberOfMPPT: 4, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 7, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 41.7,
    efficiency: 97.6, cec_efficiency: 97.0,
    weight: 52.9, dimensions: '21.3 x 15.4 x 8.3',
    warranty: '10yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/Solis/S6-EH1P-US.pdf',
    ecosystemBrand: 'solis',
    ecosystemFamily: 's6-eh1p',
    active: true,
    isNew: true,
  },
  {
    id: 'solis-s6-eh1p-11p4k-us',
    manufacturer: 'Solis', model: 'S6-EH1P11.4K-US', category: 'string_inverter',
    acOutputKw: 11.4, dcInputKwMax: 17.1,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 520,
    maxInputCurrentPerMppt: 16, maxShortCircuitCurrent: 25.6, mpptChannels: 4, numberOfMPPT: 4, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 7, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 47.5,
    efficiency: 97.6, cec_efficiency: 97.0,
    weight: 52.9, dimensions: '21.3 x 15.4 x 8.3',
    warranty: '10yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/Solis/S6-EH1P-US.pdf',
    ecosystemBrand: 'solis',
    ecosystemFamily: 's6-eh1p',
    active: true,
    isNew: true,
  },
  // ═══ Tesla Solar Inverter (v47.426 batch onboarding) ═══════════════════════
  // Datasheet: Tesla Solar Inverter Owner's Manual / Spec Sheet (tesla.com energy library)
  // Pure string inverter (no optimizer requirement), 240V single-phase.
  // All models: 600V DC max, 60-480V MPPT range, 13A IMP per MPPT, 17A Isc per MPPT,
  // 98.0% CEC / 98.6% peak efficiency, UL1741SB, 12.5yr warranty.
  // RSD via external Solar Shutdown Device (MCI), AFCI integrated.
  {
    id: 'tesla-solar-inverter-3p8k',
    manufacturer: 'Tesla', model: 'Solar Inverter 3.8kW', category: 'string_inverter',
    acOutputKw: 3.8, dcInputKwMax: 6.46,
    maxDcVoltage: 600, mpptVoltageMin: 60, mpptVoltageMax: 480,
    // Datasheet 1538000: 4 MPPT (input connectors 1-2-1-2), 600 VDC max,
    // allowable DC/AC 1.7. Per MPPT: 13A IMP (operating) / 17A ISC.
    // maxInputCurrentPerMppt is set to the 17A ISC rating, NOT the 13A IMP: the
    // sizing engine compares the NEC 690.8 design current (Isc×1.25) per MPPT
    // against this field, and the MPPT input tolerates Isc up to 17A — so a
    // TSP-420 string (Isc×1.25 = 16.3A) correctly fits. maxParallelStringsPerMppt
    // kept at 1 (safe residential default = 4 string inputs; the two 2-connector
    // MPPTs / jumpers allow more but the schema can't express the per-MPPT split).
    maxInputCurrentPerMppt: 17, maxShortCircuitCurrent: 17, mpptChannels: 4, numberOfMPPT: 4, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 4, max: 12 },
    acOutputVoltage: 240, acOutputCurrentMax: 16,
    efficiency: 98.6, cec_efficiency: 98.0,
    weight: 52.0, dimensions: '26.4 x 16.1 x 6.0',
    warranty: '12.5yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.tesla.com/sites/default/files/pdfs/solar-inverter-datasheet-en-us.pdf',
    ecosystemBrand: 'tesla',
    ecosystemFamily: 'solar-inverter',
    active: true,
    isNew: true,
  },
  {
    id: 'tesla-solar-inverter-5k',
    manufacturer: 'Tesla', model: 'Solar Inverter 5kW', category: 'string_inverter',
    acOutputKw: 5.0, dcInputKwMax: 8.5,
    maxDcVoltage: 600, mpptVoltageMin: 60, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 17, maxShortCircuitCurrent: 17, mpptChannels: 4, numberOfMPPT: 4, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 4, max: 12 },
    acOutputVoltage: 240, acOutputCurrentMax: 21,
    efficiency: 98.6, cec_efficiency: 98.0,
    weight: 52.0, dimensions: '26.4 x 16.1 x 6.0',
    warranty: '12.5yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.tesla.com/sites/default/files/pdfs/solar-inverter-datasheet-en-us.pdf',
    ecosystemBrand: 'tesla',
    ecosystemFamily: 'solar-inverter',
    active: true,
    isNew: true,
  },
  {
    id: 'tesla-solar-inverter-5p7k',
    manufacturer: 'Tesla', model: 'Solar Inverter 5.7kW', category: 'string_inverter',
    acOutputKw: 5.7, dcInputKwMax: 9.69,
    maxDcVoltage: 600, mpptVoltageMin: 60, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 17, maxShortCircuitCurrent: 17, mpptChannels: 4, numberOfMPPT: 4, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 4, max: 12 },
    acOutputVoltage: 240, acOutputCurrentMax: 24,
    efficiency: 98.6, cec_efficiency: 98.0,
    weight: 52.0, dimensions: '26.4 x 16.1 x 6.0',
    warranty: '12.5yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.tesla.com/sites/default/files/pdfs/solar-inverter-datasheet-en-us.pdf',
    ecosystemBrand: 'tesla',
    ecosystemFamily: 'solar-inverter',
    active: true,
    isNew: true,
  },
  {
    id: 'tesla-solar-inverter-7p6k',
    manufacturer: 'Tesla', model: 'Solar Inverter 7.6kW', category: 'string_inverter',
    acOutputKw: 7.6, dcInputKwMax: 12.92,
    maxDcVoltage: 600, mpptVoltageMin: 60, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 17, maxShortCircuitCurrent: 17, mpptChannels: 4, numberOfMPPT: 4, maxParallelStringsPerMppt: 1,
    recommendedStringRange: { min: 5, max: 12 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 98.6, cec_efficiency: 98.0,
    weight: 52.0, dimensions: '26.4 x 16.1 x 6.0',
    warranty: '12.5yr standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://www.tesla.com/sites/default/files/pdfs/solar-inverter-datasheet-en-us.pdf',
    ecosystemBrand: 'tesla',
    ecosystemFamily: 'solar-inverter',
    active: true,
    isNew: true,
  },
  // ═══ Tigo EI Inverter (v47.426 batch onboarding) ═══════════════════════════
  // Datasheet: Tigo EI Inverter TSI-3.8/7.6/11.4K-US (Krannich, Jul 2024, 002-00081-00 v4.4)
  // Hybrid single-phase residential, 240V, UL1741:2021 Ed.3 SB, AFCI integrated, PVRSS.
  // All models: 600V DC max, 80–550V MPPT range, 13.5A IMP per MPPT, 16.9A Isc per MPPT,
  // 2 strings per MPPT, 152-month warranty.
  // MLPE-enabled via TS4-A-O/M/S per-module optimizers/monitors.
  {
    id: 'tigo-tsi-3p8k-us',
    manufacturer: 'Tigo', model: 'TSI-3.8K-US EI Inverter', category: 'string_inverter',
    acOutputKw: 3.8, dcInputKwMax: 7.6,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 550,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.9, mpptChannels: 2, numberOfMPPT: 2, maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 4, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 16,
    efficiency: 98.0, cec_efficiency: 97.0,
    weight: 32.3, dimensions: '15.8 x 7.0 x 22.0',
    warranty: '152mo standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/Tigo/66ba8c6cd03eabe81e83fd4f_002-00081-00_4.4_Datasheet_EI_Inverter_20240725_-_EN.pdf',
    ecosystemBrand: 'tigo',
    ecosystemFamily: 'ei-inverter',
    active: true,
    isNew: true,
  },
  {
    id: 'tigo-tsi-7p6k-us',
    manufacturer: 'Tigo', model: 'TSI-7.6K-US EI Inverter', category: 'string_inverter',
    acOutputKw: 7.6, dcInputKwMax: 15.2,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 550,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.9, mpptChannels: 3, numberOfMPPT: 3, maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 5, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 32,
    efficiency: 98.4, cec_efficiency: 97.5,
    weight: 32.3, dimensions: '15.8 x 7.0 x 22.0',
    warranty: '152mo standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/Tigo/66ba8c6cd03eabe81e83fd4f_002-00081-00_4.4_Datasheet_EI_Inverter_20240725_-_EN.pdf',
    ecosystemBrand: 'tigo',
    ecosystemFamily: 'ei-inverter',
    active: true,
    isNew: true,
  },
  {
    id: 'tigo-tsi-11p4k-us',
    manufacturer: 'Tigo', model: 'TSI-11.4K-US EI Inverter', category: 'string_inverter',
    acOutputKw: 11.4, dcInputKwMax: 22.8,
    maxDcVoltage: 600, mpptVoltageMin: 80, mpptVoltageMax: 550,
    maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrent: 16.9, mpptChannels: 4, numberOfMPPT: 4, maxParallelStringsPerMppt: 2,
    recommendedStringRange: { min: 6, max: 13 },
    acOutputVoltage: 240, acOutputCurrentMax: 48,
    efficiency: 98.5, cec_efficiency: 98.0,
    weight: 45.2, dimensions: '15.8 x 7.4 x 25.2',
    warranty: '152mo standard', ulListing: 'UL 1741-SB',
    rapidShutdownCompliant: true, arcFaultProtection: true, groundFaultProtection: true,
    integratedDcDisconnect: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/Tigo/66ba8c6cd03eabe81e83fd4f_002-00081-00_4.4_Datasheet_EI_Inverter_20240725_-_EN.pdf',
    ecosystemBrand: 'tigo',
    ecosystemFamily: 'ei-inverter',
    active: true,
    isNew: true,
  },
];

export const MICROINVERTERS: Microinverter[] = [
  {
    id: 'enphase-iq8plus',
    manufacturer: 'Enphase',
    model: 'IQ8+',
    category: 'microinverter',
    // v58.4 datasheet fix (IQ8-Series-DS-US.pdf): acOutputW 295→290VA max continuous; maxInputCurrent 14→15A
    acOutputW: 290, dcInputWMax: 440,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 15.0,
    acOutputVoltage: 240, acOutputCurrentMax: 1.21,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 2.2,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://enphase.com/store/microinverters/iq8-series',
    modulesPerDevice: 1,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq8',
    compatibleWith: ['enphase-iq-combiner-5', 'enphase-iq-gateway', 'enphase-iq-battery-5p'],
    active: true,
  },
  {
    id: 'enphase-iq8m',
    manufacturer: 'Enphase',
    model: 'IQ8M',
    category: 'microinverter',
    // v58.4 datasheet fix (IQ8-Series-DS-US.pdf): acOutputW 330→325VA max continuous; acOutputCurrentMax 1.39→1.35A
       acOutputW: 325, dcInputWMax: 460,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 14.0,
    acOutputVoltage: 240, acOutputCurrentMax: 1.35,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 2.2,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://enphase.com/store/microinverters/iq8-series',
    modulesPerDevice: 1,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq8',
    compatibleWith: ['enphase-iq-combiner-5', 'enphase-iq-gateway', 'enphase-iq-battery-5p'],
    active: true,
  },
  {
    id: 'enphase-iq8h',
    manufacturer: 'Enphase',
    model: 'IQ8H',
    category: 'microinverter',
    // v58.4 datasheet fix (IQ8H-240 DS DSH-00241): dcInputWMax 600→540W (module range max); acOutputCurrentMax 1.59→1.58A
       acOutputW: 380, dcInputWMax: 540,
    maxDcVoltage: 60, mpptVoltageMin: 16, mpptVoltageMax: 60,
    maxInputCurrent: 15.0,
    acOutputVoltage: 240, acOutputCurrentMax: 1.58,
    efficiency: 97.0, cec_efficiency: 96.5,
    weight: 2.2,
    warranty: '25yr', ulListing: 'UL 1741-SA / IEEE 1547',
    rapidShutdownCompliant: true,
    datasheetUrl: 'https://enphase.com/store/microinverters/iq8-series',
    modulesPerDevice: 1,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq8',
    compatibleWith: ['enphase-iq-combiner-5', 'enphase-iq-gateway', 'enphase-iq-battery-5p'],
    active: true,
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'apsystems',
    ecosystemFamily: 'ds3',
    compatibleWith: ['apsystems-ecu-r'],
    active: true,
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'apsystems',
    ecosystemFamily: 'ds3',
    compatibleWith: ['apsystems-ecu-r'],
    active: true,
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'apsystems',
    ecosystemFamily: 'ds3',
    compatibleWith: ['apsystems-ecu-r'],
    active: true,
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
    datasheetUrl: '',
    modulesPerDevice: 2,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'hoymiles',
    ecosystemFamily: 'hm',
    compatibleWith: ['hoymiles-dtu-pro-s'],
    active: false, // v47.405: Hoymiles HM-series is EU balcony-power product; no US distributor datasheet available. Following same policy as Sungrow/EcoFlow in v47.404.
  },
  // ── Enphase IQ8 expanded lineup ────────────────────────────────────────────
  {
    id: 'enphase-iq8a',
    manufacturer: 'Enphase',
    model: 'IQ8A',
    category: 'microinverter',
    // IQ8A: 349W AC output, 1.46A nominal — designed for high-power modules up to 460W DC
    acOutputW: 349, dcInputWMax: 500,  // IQ8A pairs to ~500W modules (was 460, copy-pasted from IQ8M)
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq8',
    compatibleWith: ['enphase-iq-combiner-5', 'enphase-iq-gateway', 'enphase-iq-battery-5p'],
    active: true,
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq8',
    compatibleWith: ['enphase-iq-combiner-5', 'enphase-iq-gateway', 'enphase-iq-battery-5p'],
    active: true,
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'apsystems',
    ecosystemFamily: 'ez1',
    compatibleWith: ['apsystems-ecu-r'],
    active: true,
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
    // v47.405 datasheet fix: Hoymiles HMS-700/800/900/1000-2T-NA datasheet (CED distributor mirror, official PDF)
    datasheetUrl: 'https://cdn.myced.com/images/Products/ZZ0000/ZZ3066/00000/ZZ306600032_DS.pdf',
    modulesPerDevice: 2,
    isNew: true,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'hoymiles',
    ecosystemFamily: 'hms',
    compatibleWith: ['hoymiles-dtu-pro-s'],
    active: true,
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
    // v47.405 datasheet fix: SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/IND/Datasheets/SolarEdge/Datasheet_power-optimizer-1-1_se-p-series-module-add-on-row.pdf',
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'p-series',
    compatibleWith: ['se-3800h', 'se-6000h', 'se-7600h', 'se-10000h'],
    active: true,
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
    // v47.405 datasheet fix: SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/IND/Datasheets/SolarEdge/Datasheet_power-optimizer-1-1_se-p-series-module-add-on-row.pdf',
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'p-series',
    compatibleWith: ['se-3800h', 'se-6000h', 'se-7600h', 'se-10000h', 'se-11400h'],
    active: true,
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
    // v47.405 datasheet fix: SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/IND/Datasheets/SolarEdge/Datasheet_power-optimizer-1-1_se-p-series-module-add-on-row.pdf',
    isNew: true,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'p-series',
    compatibleWith: ['se-3800h', 'se-6000h'],
    active: true,
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
    // v47.405 datasheet fix: SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/IND/Datasheets/SolarEdge/Datasheet_power-optimizer-1-1_se-p-series-module-add-on-row.pdf',
    isNew: true,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'p-series',
    compatibleWith: ['se-7600h', 'se-10000h', 'se-11400h'],
    active: true,
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
    // v47.405 datasheet fix: SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/IND/Datasheets/SolarEdge/Datasheet_power-optimizer-1-1_se-p-series-module-add-on-row.pdf',
    isNew: true,
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'p-series',
    compatibleWith: ['se-10000h', 'se-11400h'],
    active: true,
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
    // v47.406 datasheet fix: Unirac SolarMount product brochure (manufacturer direct; returns application/pdf)
    datasheetUrl: 'https://www.unirac.com/document/solarmount-product-brochure/',
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
    // v47.406 datasheet fix: SnapNrack Series 100 Roof Mount System datasheet (CED distributor mirror)
    datasheetUrl: 'https://cdn.myced.com/images/Products/ZZ0000/ZZ0849/00000/ZZ084900061_DS.pdf',
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
    // v47.406 datasheet fix: QuickMount QMSC Classic Composition Mount datasheet (IronRidge, successor to QuickMount PV)
    datasheetUrl: 'https://files.ironridge.com/quickmount/QMPV-datasheet-QMSC-ClassicComp-web.pdf',
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
  // Roof Tech Mini — flashed pad standoff, L-foot, rail-based system
  // Assembly: RT-MINI flashed pad (2 lag screws into rafter) → bolt through pad → L-foot → standard rail (IronRidge / Pegasus / compatible)
  {
    id: 'rooftech-mini',
    manufacturer: 'Roof Tech',
    model: 'RT-MINI Flush Mount',
    category: 'racking',
    systemType: 'roof',
    roofTypes: ['shingle', 'tile'],
    maxWindSpeed: 150, maxSnowLoad: 45,
    railSpanMax: 72, attachmentSpacingMax: 48,
    weight: 0.6, material: 'Aluminum / EPDM',
    warranty: '20yr', ulListing: 'ICC-ES ESR-3575 / UL 2703',
    attachmentMethod: 'Flashed pad with 2 lag bolts into rafter → L-foot bolt → compatible rail (IronRidge XR100/XR1000, Pegasus, or equivalent)',
    hardware: 'RT-MINI flashed pad, integrated EPDM flashing, 5/16" × 3" lag bolts (×2 per pad), L-foot, compatible rail',
    installNotes: 'Rail-based system. 2 lag bolts per RT-MINI pad into rafter. L-foot mounts to pad bolt. Standard rail (IronRidge, Pegasus, or compatible) attaches to L-foot. ICC-ES ESR-3575 rated.',
    // v47.406 datasheet fix: Roof Tech RT Mini II brochure (design.roof-tech.us manufacturer design portal)
    datasheetUrl: 'https://design.roof-tech.us/PDF/Brochures/Mini_II_Brochure.pdf',
    // Discrete load model: uplift evaluated per attachment point (each RT-MINI pad)
    loadModel: 'discrete',
    fastenersPerAttachment: 2,   // 2 lag bolts per RT-MINI pad
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
  // v47.400 — datasheet URL (additive, optional)
  datasheetUrl?: string;
  // v47.397 — ecosystem fields
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];
  active?: boolean;
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
    // v47.397 Phase B — Tesla ecosystem (Powerwall 3 is AC-coupled w/ integrated solar inverter)
    ecosystemBrand: 'tesla',
    ecosystemFamily: 'powerwall',
    compatibleWith: ['tesla-backup-gateway-2', 'tesla-wall-connector-gen3'],
    active: true,
    datasheetUrl: 'https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/3/Datasheet/en-us/Powerwall-3-Datasheet.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq-battery',
    compatibleWith: ['enphase-iq-system-controller-3', 'enphase-iq-sc3-ats', 'enphase-iq-gateway'],
    active: true,
    datasheetUrl: 'https://assets.ctfassets.net/k6ot5nj1c6f9/2nqAdKtPMi5IirhnfQMeH3/58f82b1f4342baee1df92a71a6fe0b5b/IQ_Battery-5P-DSH-00010-2.0-EN-US-2023-07-26__1_.pdf',
  },
  {
    id: 'enphase-iq-battery-10t',
    manufacturer: 'Enphase', model: 'IQ Battery 10T',
    category: 'battery', subcategory: 'ac_coupled',
    usableCapacityKwh: 10.08, peakPowerKw: 5.76, continuousPowerKw: 3.84,  // datasheet: 3.84 kVA continuous (16A), ~5.7 kVA peak; was a fabricated 7.68
    roundTripEfficiencyPct: 96.0, chemistry: 'LFP', voltageNominalV: 48,
    acOutputVoltageV: 240, maxContinuousOutputA: 16,  // datasheet 16A continuous (was 32)
    backfeedBreakerA: 20,        // NEC 705.12(B): 16A×1.25 → 20A OCPD (was 40, based on the wrong 32A)
    minDedicatedBreakerA: 20,
    weightLbs: 225, outdoorRated: true, ipRating: 'IP55',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: true, gatewayModel: 'Enphase IQ System Controller 3',
    warrantyYears: 15, cycleGuarantee: '4000 cycles', capacityRetentionPct: 70,
    msrpUsd: 7500,
    necRefs: ['NEC 705.12(B) — 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 — Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq-battery',
    compatibleWith: ['enphase-iq-system-controller-3', 'enphase-iq-sc3-ats', 'enphase-iq-gateway'],
    active: true,
    datasheetUrl: 'https://enphase.com/sites/default/files/2021-10/IQ-Battery-10T-DS-EN-US-10-19-2021.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'pwrcell',
    compatibleWith: ['generac-pwrcell-inverter-7600', 'generac-pwrmanager'],
    active: true,
    // v47.402 datasheet: Shared PC2 battery cabinet spec guide (9 & 17 kWh)
    datasheetUrl: 'https://www.generac.com/globalassets/residential/dealers--installers/generac-installer-programs/solar--battery-installer-support/pc2batterycabinet_specguide.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'home-battery',
    compatibleWith: ['solaredge-home-hub-7600', 'solaredge-home-hub-10000'],
    active: true,
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/SolarEdge/se-solaredge-home-battery-made-in-the-usa-datasheet-nam.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq-battery',
    compatibleWith: ['enphase-iq-system-controller-3', 'enphase-iq-sc3-ats', 'enphase-iq-gateway'],
    active: true,
    datasheetUrl: 'https://enphase.com/sites/default/files/2021-10/IQ-Battery-3T-DS-EN-US-10-19-2021.pdf',
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
    ecosystemBrand: 'tesla',
    ecosystemFamily: 'powerwall',
    compatibleWith: ['tesla-backup-gateway-2', 'tesla-wall-connector-gen3'],
    active: true,
    datasheetUrl: 'https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/2/Datasheet/en-us/Powerwall-2-Datasheet.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'pwrcell',
    compatibleWith: ['generac-pwrcell-inverter-7600', 'generac-pwrmanager'],
    active: true,
    // v47.402 datasheet: Shared PC2 battery cabinet spec guide (9 & 17 kWh)
    datasheetUrl: 'https://www.generac.com/globalassets/residential/dealers--installers/generac-installer-programs/solar--battery-installer-support/pc2batterycabinet_specguide.pdf',
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
  // ═══ EcoFlow PowerOcean LFP 5 kWh — stackable battery module, v47.358 ═══
  // CROSS-REF: lib/ecoflow-system.ts (canonical), lib/equipment-registry-v4.ts (BOM lookup)
  // Sold as a module — multiple units stack (up to 9 = 45 kWh std, 16 = 80 kWh pro)
  {
    id: 'ecoflow-battery-5kwh',
    manufacturer: 'EcoFlow', model: 'PowerOcean LFP Battery Module (5kWh)',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 5.0, peakPowerKw: 5.0, continuousPowerKw: 5.0,
    roundTripEfficiencyPct: 98.0, chemistry: 'LFP', voltageNominalV: 51.2,
    acOutputVoltageV: 240, maxContinuousOutputA: 20.8,
    backfeedBreakerA: 0,
    minDedicatedBreakerA: 0,
    weightLbs: 110, outdoorRated: true, ipRating: 'IP65',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: true, gatewayModel: 'EcoFlow PowerOcean Monitoring Gateway',
    warrantyYears: 15, cycleGuarantee: '6000 cycles', capacityRetentionPct: 70,
    msrpUsd: 2800,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 690.71 — Battery installation'],
    ulListing: 'UL 9540A / UL 1973', certifications: ['UL 9540A', 'UL 1973', 'IEC 62619'],
    ecosystemBrand: 'ecoflow',
    ecosystemFamily: 'powerocean',
    // v58.14 — broadened: all 3 legacy PowerOcean inverter SKUs use this module
    compatibleWith: ['ecoflow-power-ocean-5kw', 'ecoflow-power-ocean-10kw', 'ecoflow-power-ocean-20kw'],
    active: true,
    isNew: true,
    datasheetUrl: 'https://enterprise-service-us-cdn.ecoflow.com/enterprise/documentation/1763710879602/EcoFlow%20PowerOcean%20Battery_Datasheet_EN(1).pdf',
  },
  // ═══ v58.14 — EcoFlow OCEAN Pro Battery (EF-BP-10, 10 kWh, US) ══════════════════
  // Datasheet: https://enterprise-service-us-cdn.ecoflow.com/enterprise/
  //            documentation/1760684383859/Ocean%20Pro%20BP%20datasheet%20v1013_View.pdf
  // LFP, 400 V DC nominal, HV DC-coupled to OCEAN Pro PCS (EF-PCS-24).
  // Stackable up to 8 modules (80 kWh) per inverter. First home battery
  // in the industry to achieve UL 9540B certification (Sept 2025).
  {
    id: 'ecoflow-ocean-pro-bp-10',
    manufacturer: 'EcoFlow', model: 'OCEAN Pro Battery (EF-BP-10, 10 kWh)',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 10.0, peakPowerKw: 10.0, continuousPowerKw: 10.0,
    roundTripEfficiencyPct: 89.0, chemistry: 'LFP', voltageNominalV: 400,
    acOutputVoltageV: 240, maxContinuousOutputA: 26.32,
    backfeedBreakerA: 0,
    minDedicatedBreakerA: 0,
    weightLbs: 245.8, outdoorRated: true, ipRating: 'IP67',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: true, gatewayModel: 'EcoFlow OCEAN Smart Electrical Panel / OCEAN Gateway',
    warrantyYears: 15, cycleGuarantee: '6000 cycles', capacityRetentionPct: 70,
    msrpUsd: 5200,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 690.71 — Battery installation'],
    ulListing: 'UL 9540 / UL 9540A / UL 9540B / UL 1973',
    certifications: ['UL 9540', 'UL 9540A', 'UL 9540B', 'UL 1973', 'UN 38.3', 'AC156', 'IEEE 693-2005'],
    ecosystemBrand: 'ecoflow',
    ecosystemFamily: 'ocean-pro',
    compatibleWith: ['ecoflow-ocean-pro-11kw', 'ecoflow-ocean-pro-24kw'],
    active: true,
    isNew: true,
    datasheetUrl: 'https://enterprise-service-us-cdn.ecoflow.com/enterprise/documentation/1760684383859/Ocean%20Pro%20BP%20datasheet%20v1013_View.pdf',
  },
  // ═══ v47.428 — Battery Ecosystem Batch ═══════════════════════════════════
  // Closes the gap: BrandProfile recommendedBatteryBrands tokens (byd, pylontech,
  // tigo, eg4, homegrid) now resolve to real SKUs in the registry.
  //
  // ─── Tigo EI Battery TSB-10-US ─────────────────────────────────────────
  // Datasheet: Tigo EI Specifications PN 002-00084-00
  // 3 × ML33RTA modules (3.3 kWh @ 51.2V each) in single enclosure
  // Nominal 9.9 kWh / 9.0 kWh usable, 400V nominal (360-550V HV string)
  // 5.0 kW continuous / 6.0 kW surge, LFP, 6000 cycles, 11yr warranty
  // IP56/NEMA 4X, floor-installed, DC-coupled to Tigo EI Inverter
  {
    id: 'tigo-ei-battery-10',
    manufacturer: 'Tigo', model: 'EI Battery TSB-10-US',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 9.0, peakPowerKw: 6.0, continuousPowerKw: 5.0,
    roundTripEfficiencyPct: 94.4, chemistry: 'LFP', voltageNominalV: 400,
    acOutputVoltageV: 240, maxContinuousOutputA: 14.3,
    backfeedBreakerA: 0,
    minDedicatedBreakerA: 0,
    weightLbs: 309, outdoorRated: true, ipRating: 'IP56',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: false, gatewayModel: 'Tigo EI Inverter (integrated)',
    warrantyYears: 11, cycleGuarantee: '6000 cycles', capacityRetentionPct: 70,
    msrpUsd: 6800,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 690.71 — Battery installation'],
    ulListing: 'UL 9540 / UL 9540A / UL 1973', certifications: ['UL 9540', 'UL 9540A', 'UL 1973', 'IEC 62619'],
    ecosystemBrand: 'tigo',
    ecosystemFamily: 'ei-battery',
    compatibleWith: ['tigo-ei-7.6k', 'tigo-ei-11.4k'],
    active: true,
    isNew: true,
    datasheetUrl: 'https://es-media-prod.s3.amazonaws.com/media/components/panels/spec-sheets/Tigo_EI_Specifications_-_DRAFT_-_v2.4_1_3.pdf',
  },
  // ─── Tigo GO Battery TGB-10-US ─────────────────────────────────────────
  // Datasheet: Tigo GO Battery (US) PN 002-00234-00 v1.2
  // 2 modules (TGB-5 @ 5 kWh each) + TGM-30 BMS = 10 kWh total
  // Nominal 400V (380-550V), 5 kW continuous / 7 kW peak (300ms)
  // LFP, IP66, 10yr warranty, 84% AC-AC RTE, modular 5 kWh increments up to 30 kWh
  {
    id: 'tigo-go-battery-10',
    manufacturer: 'Tigo', model: 'GO Battery TGB-10-US',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 10.0, peakPowerKw: 7.0, continuousPowerKw: 5.0,
    roundTripEfficiencyPct: 89.0, chemistry: 'LFP', voltageNominalV: 400,
    acOutputVoltageV: 240, maxContinuousOutputA: 20.8,
    backfeedBreakerA: 0,
    minDedicatedBreakerA: 0,
    weightLbs: 269, outdoorRated: true, ipRating: 'IP66',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: false, gatewayModel: 'Tigo EI Inverter (integrated)',
    warrantyYears: 10, cycleGuarantee: '10 years', capacityRetentionPct: 70,
    msrpUsd: 6500,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 690.71 — Battery installation'],
    ulListing: 'UL 9540 / UL 9540A / UL 1973', certifications: ['UL 9540', 'UL 9540A', 'UL 1973', 'FCC', 'UN 38.3', 'CA-SGIP'],
    ecosystemBrand: 'tigo',
    ecosystemFamily: 'go-battery',
    compatibleWith: ['tigo-ei-7.6k', 'tigo-ei-11.4k'],
    active: true,
    isNew: true,
    datasheetUrl: 'https://cdn.prod.website-files.com/5fad551d7419c7a0e9e4aba4/69b44d94a7864730c8e4cae5_002-00234-00%201.2%20Datasheet%20GO%20Battery%20(US)%20-%2020260306.pdf',
  },
  // ─── BYD Battery-Box Premium HVM 11.0 ──────────────────────────────────
  // Datasheet: 241224_Datasheet_Battery-Box HVM(US)_V1.4_EN
  // 4 × HVM modules (2.76 kWh @ 51.2V each) = 11.04 kWh usable
  // 204.8V nominal (160-236V), 50A continuous / 75A peak (3s)
  // LFP, CAN/RS485, NEMA 3R, ≥96% RTE, 10yr warranty
  // Pairs with Solis S6-EH1P US and other HV string inverters
  {
    id: 'byd-hvm-11',
    manufacturer: 'BYD', model: 'Battery-Box Premium HVM 11.0 (US)',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 11.04, peakPowerKw: 15.36, continuousPowerKw: 10.24,
    roundTripEfficiencyPct: 96.0, chemistry: 'LFP', voltageNominalV: 204.8,
    acOutputVoltageV: 240, maxContinuousOutputA: 50,
    backfeedBreakerA: 0,
    minDedicatedBreakerA: 0,
    weightLbs: 368, outdoorRated: true, ipRating: 'NEMA 3R',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: false, gatewayModel: 'Hybrid inverter (HV string)',
    warrantyYears: 10, cycleGuarantee: '10 years', capacityRetentionPct: 60,
    msrpUsd: 7200,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 690.71 — Battery installation'],
    ulListing: 'UL 9540 / UL 9540A / UL 1973', certifications: ['UL 9540', 'UL 9540A', 'UL 1973', 'IEC 60730', 'FCC', 'UN 38.3'],
    ecosystemBrand: 'byd',
    ecosystemFamily: 'hvm',
    compatibleWith: ['solis-s6-eh1p-7.6k', 'solis-s6-eh1p-10k', 'solis-s6-eh1p-11.4k'],
    active: true,
    isNew: true,
    datasheetUrl: 'https://bydbatterybox.com/uploads/downloads/241224_Datasheet_Battery-Box%20HVM(US)_V1.4_EN-676a1fc2b0fe6.pdf',
  },
  // ─── Pylontech Force-H2 14.2 kWh ───────────────────────────────────────
  // Datasheet: Pylontech Force H2 FH9637M
  // 4 × FH9637M modules (3.55 kWh @ 96V each) = 14.21 kWh / 13.5 kWh usable
  // 384V DC system voltage, 18.5A continuous / 42A peak (15s)
  // LFP, Modbus RTU/CAN, IP55, 15+yr design life, >8000 cycles, 95% DoD
  // Pairs with Solis, Sol-Ark, Growatt HV strings
  {
    id: 'pylontech-force-h2-14',
    manufacturer: 'Pylontech', model: 'Force-H2 (4 modules)',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 13.5, peakPowerKw: 16.12, continuousPowerKw: 7.1,
    roundTripEfficiencyPct: 95.0, chemistry: 'LFP', voltageNominalV: 384,
    acOutputVoltageV: 240, maxContinuousOutputA: 18.5,
    backfeedBreakerA: 0,
    minDedicatedBreakerA: 0,
    weightLbs: 335, outdoorRated: true, ipRating: 'IP55',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: false, gatewayModel: 'Hybrid inverter (HV string)',
    warrantyYears: 10, cycleGuarantee: '>8000 cycles', capacityRetentionPct: 70,
    msrpUsd: 8500,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 690.71 — Battery installation'],
    ulListing: 'IEC 62619 / IEC 63056', certifications: ['CE', 'CEC', 'IEC 62040-1', 'IEC 62619', 'IEC 63056', 'VDE-AR-E 2510-50'],
    ecosystemBrand: 'pylontech',
    ecosystemFamily: 'force-h2',
    compatibleWith: ['solis-s6-eh1p-7.6k', 'solis-s6-eh1p-10k', 'solis-s6-eh1p-11.4k'],
    active: true,
    isNew: true,
    datasheetUrl: 'https://liriksolar.com/image/uploads/Pylontech%20Force%20H2%20FH9637M%20Datasheet.pdf',
  },
  // ─── EG4 PowerPro WallMount All Weather 14.3 kWh ───────────────────────
  // Datasheet: EG4 14.3kWh PowerPro WallMount AW Spec Sheet 1.0.2
  // 51.2V 280Ah single module, 200A continuous discharge / 100-200A charge
  // LFP, RS485/CAN, IP65, 10yr warranty, >8000 cycles @ 80% DoD, >15yr design life
  // Self-heating, 308.6 lbs, Amphenol/SurLok quick-connect
  // Compatible: Sol-Ark, Schneider, Victron, Growatt, Luxpower, Deye
  {
    id: 'eg4-powerpro-14',
    manufacturer: 'EG4', model: 'PowerPro WallMount All Weather 14.3 kWh',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 14.3, peakPowerKw: 15.36, continuousPowerKw: 10.24,
    roundTripEfficiencyPct: 95.0, chemistry: 'LFP', voltageNominalV: 51.2,
    acOutputVoltageV: 240, maxContinuousOutputA: 200,
    backfeedBreakerA: 0,
    minDedicatedBreakerA: 0,
    weightLbs: 309, outdoorRated: true, ipRating: 'IP65',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: false, gatewayModel: 'Hybrid inverter (48V LV string)',
    warrantyYears: 10, cycleGuarantee: '>8000 cycles @ 80% DoD', capacityRetentionPct: 70,
    msrpUsd: 4900,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 690.71 — Battery installation'],
    ulListing: 'UL 1973 / UL 9540A', certifications: ['UL 1973', 'UL 9540A'],
    ecosystemBrand: 'eg4',
    ecosystemFamily: 'powerpro-wallmount',
    compatibleWith: [],
    active: true,
    isNew: true,
    datasheetUrl: 'https://signaturesolar.com/product_images/EG4%2014.3kWh%20PowerPro%20WallMount%20AW%20Spec%20Sheet%201.0.2.pdf',
  },
  // ─── HomeGrid Stack'd 9.6 kWh (2 modules) ──────────────────────────────
  // SKU: PF5-LFP09600-2A01-KIT
  // 2 × 4.8 kWh modules in one stack (BMS base supports up to 8 modules = 38.4 kWh)
  // 48V nominal (46-56V), 200Ah, 9.6 kW continuous (stack: up to 15 kW, 24 kW surge 10s)
  // LFP, IP55, 10yr warranty, CANbus to Sol-Ark/Schneider/SMA/Victron/OutBack
  {
    id: 'homegrid-stackd-9.6',
    manufacturer: 'HomeGrid', model: "Stack'd Series 9.6 kWh (2 modules)",
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 9.6, peakPowerKw: 16.8, continuousPowerKw: 9.6,
    roundTripEfficiencyPct: 95.0, chemistry: 'LFP', voltageNominalV: 48,
    acOutputVoltageV: 240, maxContinuousOutputA: 200,
    backfeedBreakerA: 0,
    minDedicatedBreakerA: 0,
    weightLbs: 304, outdoorRated: true, ipRating: 'IP55',
    gridFormingCapable: false, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: false, gatewayModel: 'Hybrid inverter (48V LV string)',
    warrantyYears: 10, cycleGuarantee: '10 years', capacityRetentionPct: 70,
    msrpUsd: 5930,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 690.71 — Battery installation'],
    ulListing: 'UL 9540 / UL 9540A / UL 1973', certifications: ['UL 9540', 'UL 9540A', 'UL 1973'],
    ecosystemBrand: 'homegrid',
    ecosystemFamily: 'stackd',
    compatibleWith: [],
    active: true,
    isNew: true,
    datasheetUrl: 'https://www.solar-electric.com/lib/wind-sun/HomeGrid_Stackd_Series_specifications.pdf',
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
  // v47.400 — datasheet URL (additive, optional)
  datasheetUrl?: string;
  // v47.397 — ecosystem fields
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];   // e.g. compatible ATS
  active?: boolean;
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'guardian',
    compatibleWith: ['generac-rxsw200a3', 'generac-rtsw200a3', 'generac-rxsw100a3'],
    active: true,
    // v47.402 datasheet: Shared spec sheet (20–24kW Guardian)
    datasheetUrl: 'https://www.generac.com/globalassets/products/residential/standby-generators/spec-sheets/20-24kw-guardian-standby-generator-specsheet.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'guardian',
    compatibleWith: ['generac-rxsw200a3', 'generac-rtsw200a3'],
    active: true,
    // v47.402 datasheet: Shared spec sheet (20–24kW Guardian)
    datasheetUrl: 'https://www.generac.com/globalassets/products/residential/standby-generators/spec-sheets/20-24kw-guardian-standby-generator-specsheet.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'guardian',
    compatibleWith: ['generac-rxsw200a3', 'generac-rtsw200a3', 'generac-rxsw100a3'],
    active: true,
    // v47.402 datasheet: Shared brochure covering 10–26kW Guardian lineup
    datasheetUrl: 'https://www.generac.com/globalassets/products/residential/standby-generators/brochure/10-26kw_hsb_brochure.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'guardian',
    compatibleWith: ['generac-rxsw200a3', 'generac-rtsw200a3'],
    active: true,
    // v47.402 datasheet: Dedicated 26kW Guardian spec sheet
    datasheetUrl: 'https://www.generac.com/globalassets/products/residential/standby-generators/spec-sheets/g007290-g007291-26kw-guardian-res-standby-generator-specsheet.pdf',
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
  // v47.400 — datasheet URL (additive, optional)
  datasheetUrl?: string;
  // v47.397 — ecosystem fields
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];   // e.g. compatible generator
  active?: boolean;
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'ats',
    compatibleWith: ['generac-guardian-22kw', 'generac-guardian-24kw', 'generac-guardian-18kw', 'generac-guardian-26kw'],
    active: true,
    // v47.402 datasheet: Combined RXSC/RXSW 100–200A ATS spec sheet
    datasheetUrl: 'https://www.generac.com/globalassets/products/residential/standby-generator-transfer-switches/automatic-transfer-switches/spec-sheets/rxsc100a3-200a3_rxsw100a3-150a3-200a3_specsheet.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'ats',
    compatibleWith: ['generac-guardian-22kw', 'generac-guardian-24kw', 'generac-guardian-18kw', 'generac-guardian-26kw'],
    active: true,
    // v47.402 datasheet: Owner's manual (Generac has no dedicated spec sheet for RTSW)
    datasheetUrl: 'https://www.generac.com/globalassets/products/residential/standby-generator-transfer-switches/automatic-transfer-switches/owners-manual/100-200a-automatic-transfer-switch-owners-manual.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq-system-controller',
    compatibleWith: ['enphase-iq-battery-5p', 'enphase-iq-battery-10t', 'enphase-iq-battery-3t', 'enphase-iq-gateway'],
    active: true,
    // v47.400 datasheet: Shared datasheet with IQ System Controller 3
    datasheetUrl: 'https://enphase.com/download/iq-system-controller-3m-data-sheet',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'ats',
    compatibleWith: ['generac-guardian-18kw', 'generac-guardian-22kw'],
    active: true,
    // v47.402 datasheet: Combined RXSC/RXSW 100–200A ATS spec sheet
    datasheetUrl: 'https://www.generac.com/globalassets/products/residential/standby-generator-transfer-switches/automatic-transfer-switches/spec-sheets/rxsc100a3-200a3_rxsw100a3-150a3-200a3_specsheet.pdf',
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
  // v47.400 — datasheet URL (additive, optional)
  datasheetUrl?: string;
  // v47.397 — ecosystem fields
  ecosystemBrand?: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];   // cross-category compatibility
  active?: boolean;
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq-system-controller',
    compatibleWith: ['enphase-iq-battery-5p', 'enphase-iq-battery-10t', 'enphase-iq-battery-3t', 'enphase-iq-gateway'],
    active: true,
    datasheetUrl: 'https://enphase.com/download/iq-system-controller-3m-data-sheet',
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
    compatibleBatteries: ['tesla-powerwall-3', 'tesla-powerwall-2'],
    ecosystemBrand: 'tesla',
    ecosystemFamily: 'backup-gateway',
    compatibleWith: ['tesla-powerwall-3', 'tesla-powerwall-2', 'tesla-wall-connector-gen3'],
    active: true,
    // v47.400 datasheet: HTML specs page (no standalone PDF published)
    datasheetUrl: 'https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/2/InstallManual/BackupGateway/2/en-us/GUID-C93D57B7-CA13-4E04-9449-1EAB073A485B.html',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'pwrmanager',
    compatibleWith: ['generac-pwrcell-9', 'generac-pwrcell-17', 'generac-pwrcell-inverter-7600'],
    active: true,
    // v47.402 datasheet: Install manual (Generac has no dedicated spec sheet for PWRmanager)
    datasheetUrl: 'https://www.generac.com/globalassets/residential/dealers--installers/generac-installer-programs/solar--battery-installer-support/pwrmanager-install-manual.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'home-hub',
    compatibleWith: ['solaredge-home-battery-10'],
    active: true,
    // v47.400 datasheet: Shared Home Hub single-phase datasheet (covers 7600 & 10000)
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/SolarEdge/se-home-hub-inverter-single-phase-inverter-made-in-usa-datasheet-nam.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'home-hub',
    compatibleWith: ['solaredge-home-battery-10'],
    active: true,
    // v47.400 datasheet: Shared Home Hub single-phase datasheet (covers 7600 & 10000)
    datasheetUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/SolarEdge/se-home-hub-inverter-single-phase-inverter-made-in-usa-datasheet-nam.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'generac',
    ecosystemFamily: 'pwrcell',
    compatibleWith: ['generac-pwrcell-9', 'generac-pwrcell-17', 'generac-pwrmanager'],
    active: true,
    // v47.402 datasheet: PWRcell 1-phase inverter spec sheet (Rev G)
    datasheetUrl: 'https://www.generac.com/globalassets/residential/dealers--installers/generac-installer-programs/solar--battery-installer-support/a0000909057_pwrcell_inverter-1phase_ss_revg_eng-spa_digital.pdf',
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
    // v47.397 — ecosystem fields
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq-combiner',
    compatibleWith: ['enphase-iq8plus', 'enphase-iq8m', 'enphase-iq8h', 'enphase-iq8a', 'enphase-iq8ac', 'enphase-iq-gateway'],
    active: true,
    datasheetUrl: 'https://enphase.com/download/iq-combiner-5-data-sheet',
  },
  // ── EcoFlow OCEAN Smart Home Panel ─────────────────────────────────────────────
  // v58.20: Added so EcoFlow ecosystem systems resolve backupInterfaceBrand = 'EcoFlow'
  // and the SLD renderer shows the correct EcoFlow Smart Home Panel BUI symbol.
  {
    id: 'ecoflow-ocean-smart-home-panel',
    manufacturer: 'EcoFlow', model: 'OCEAN Smart Home Panel',
    category: 'backup_interface', subcategory: 'gateway_controller',
    maxBackupOutputKw: 20, maxContinuousOutputA: 80,
    serviceEntranceRated: false,
    gridFormingCapable: true, islandingCapable: true,
    loadSheddingCapable: true, loadSheddingCircuits: 10,
    generatorCompatible: false,
    outdoorRated: false, weightLbs: 15, warrantyYears: 5, msrpUsd: 800,
    necRefs: ['NEC 706 — Energy Storage Systems', 'NEC 705.12(B) — load-side interconnection', 'NEC 230.82'],
    ulListing: 'UL 1741 / UL 9540',
    compatibleBatteries: ['ecoflow-ocean-pro-bp-10', 'ecoflow-battery-5kwh'],
    isNew: true,
    ecosystemBrand: 'ecoflow',
    ecosystemFamily: 'ocean-smart-home-panel',
    compatibleWith: ['ecoflow-ocean-pro-11kw', 'ecoflow-ocean-pro-24kw', 'ecoflow-ocean-pro-bp-10'],
    active: true,
    datasheetUrl: 'https://enterprise-service-us-cdn.ecoflow.com/enterprise/documentation/1760684472240/Ocean%20Pro%20PCS%20datasheet%20v1013_View.pdf',
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function getBatteryById(id: string): BatterySystem | undefined {
  return BATTERIES.find(b => b.id === id);
}

/**
 * Resolve the representative battery SKU for a battery-brand token (e.g. 'tesla',
 * 'enphase', 'solaredge', 'eg4', 'byd', 'pylontech', 'tigo', 'homegrid',
 * 'ecoflow'). Matches active batteries by ecosystemBrand, manufacturer slug, or
 * id prefix. For `single_pack` strategies returns the largest-capacity match
 * (the whole pack, e.g. Powerwall 3); otherwise the smallest-capacity match (the
 * granular stacking module). Used by the sizing engine so EVERY brand's battery
 * resolves to a real SKU + capacity (previously only EcoFlow did).
 */
export function resolveBatteryForBrand(
  brandToken: string | undefined,
  strategy: 'modular_stack' | 'single_pack' | 'per_module' | 'custom' = 'modular_stack',
): BatterySystem | undefined {
  const t = (brandToken ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!t) return undefined;
  const matches = BATTERIES.filter(b => {
    if (b.active === false) return false;
    const eco = (b.ecosystemBrand ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const mfr = b.manufacturer.toLowerCase().replace(/[^a-z0-9]/g, '');
    return eco === t || mfr === t || b.id.toLowerCase().startsWith(t + '-');
  });
  if (matches.length === 0) return undefined;
  // single_pack → whole pack (largest); modular → granular module (smallest).
  // Tiebreak: prefer isNew, then higher continuous power, then id (deterministic).
  matches.sort((a, b) => {
    if (a.usableCapacityKwh !== b.usableCapacityKwh) return a.usableCapacityKwh - b.usableCapacityKwh;
    if ((a.isNew ? 1 : 0) !== (b.isNew ? 1 : 0)) return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0);
    if (a.continuousPowerKw !== b.continuousPowerKw) return b.continuousPowerKw - a.continuousPowerKw;
    return a.id.localeCompare(b.id);
  });
  return strategy === 'single_pack' ? matches[matches.length - 1] : matches[0];
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

// ============================================================
// v47.397 — Monitoring Gateways (Enphase Envoy, APsystems ECU, Hoymiles DTU, SolarEdge gateway)
// Physical hardware that provides brand-specific monitoring / comm.
// Distinct from BackupInterface (which provides backup power control).
// ============================================================
export interface MonitoringGateway {
  id: string;
  manufacturer: string;
  model: string;
  category: 'monitoring_gateway';
  supportedProtocols: string[];
  maxDevicesMonitored: number;
  powerSource: 'ac_utility' | 'low_voltage_dc' | 'poe';
  outdoorRated: boolean;
  indoorRated: boolean;
  mountingType: 'wall_mount' | 'din_rail' | 'standalone';
  providesRapidShutdownSignal: boolean;
  weightLbs: number;
  warrantyYears: number;
  msrpUsd: number;
  ulListing: string;
  datasheetUrl?: string;
  ecosystemBrand: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];
  active?: boolean;
  isNew?: boolean;
}

export const MONITORING_GATEWAYS: MonitoringGateway[] = [
  // ── Enphase IQ Gateway (formerly Envoy) ──────────────────────────────────
  {
    id: 'enphase-iq-gateway',
    manufacturer: 'Enphase',
    model: 'IQ Gateway (Envoy)',
    category: 'monitoring_gateway',
    supportedProtocols: ['PLC (Power Line)', 'Wi-Fi', 'Ethernet', 'Cellular (optional)'],
    maxDevicesMonitored: 600,
    powerSource: 'ac_utility',
    outdoorRated: false,
    indoorRated: true,
    mountingType: 'wall_mount',
    providesRapidShutdownSignal: true,
    weightLbs: 2.1,
    warrantyYears: 5,
    msrpUsd: 450,
    ulListing: 'UL 60730-1',
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq-gateway',
    compatibleWith: [
      'enphase-iq8plus', 'enphase-iq8m', 'enphase-iq8h', 'enphase-iq8a',
      'enphase-iq-battery-5p', 'enphase-iq-battery-10t', 'enphase-iq-battery-3t',
      'enphase-iq-system-controller-3',
    ],
    active: true,
    isNew: true,
    datasheetUrl: 'https://enphase.com/sites/default/files/2021-07/IQ-Envoy-DS-EN-US-06-30-2021.pdf',
  },
  // ── APsystems ECU-R Energy Communication Unit ────────────────────────────
  {
    id: 'apsystems-ecu-r',
    manufacturer: 'APsystems',
    model: 'ECU-R',
    category: 'monitoring_gateway',
    supportedProtocols: ['Zigbee', 'Wi-Fi', 'Ethernet'],
    maxDevicesMonitored: 80,
    powerSource: 'ac_utility',
    outdoorRated: false,
    indoorRated: true,
    mountingType: 'wall_mount',
    providesRapidShutdownSignal: false,
    weightLbs: 1.1,
    warrantyYears: 5,
    msrpUsd: 320,
    ulListing: 'FCC Part 15',
    ecosystemBrand: 'apsystems',
    ecosystemFamily: 'ecu',
    compatibleWith: ['apsystems-ds3', 'apsystems-ds3s', 'apsystems-ds3l'],
    active: true,
    isNew: true,
    datasheetUrl: 'https://global.apsystems.com/wp-content/uploads/2022/09/APsystems-Energy-Communication-Unit-ECU-R-datasheet_Rev3.4_2022-08-30.pdf',
  },
  // ── Hoymiles DTU-Pro-S Data Transfer Unit ────────────────────────────────
  {
    id: 'hoymiles-dtu-pro-s',
    manufacturer: 'Hoymiles',
    model: 'DTU-Pro-S',
    category: 'monitoring_gateway',
    supportedProtocols: ['Sub-GHz RF', 'Wi-Fi', 'Ethernet', '4G (optional)'],
    maxDevicesMonitored: 99,
    powerSource: 'ac_utility',
    outdoorRated: false,
    indoorRated: true,
    mountingType: 'wall_mount',
    providesRapidShutdownSignal: false,
    weightLbs: 0.9,
    warrantyYears: 5,
    msrpUsd: 280,
    ulListing: 'FCC Part 15',
    ecosystemBrand: 'hoymiles',
    ecosystemFamily: 'dtu',
    compatibleWith: ['hoymiles-hm800'],
    active: true,
    isNew: true,
    datasheetUrl: 'https://www.solar-electric.com/lib/wind-sun/Hoymiles_Datasheet_DTU-Pro-S.pdf',
  },
  // ── SolarEdge Monitoring Gateway (cellular add-on for Home Hub) ──────────
  {
    id: 'solaredge-monitoring-gateway',
    manufacturer: 'SolarEdge',
    model: 'Monitoring Gateway',
    category: 'monitoring_gateway',
    supportedProtocols: ['Ethernet', 'RS-485', 'Cellular (optional)'],
    maxDevicesMonitored: 50,
    powerSource: 'low_voltage_dc',
    outdoorRated: false,
    indoorRated: true,
    mountingType: 'wall_mount',
    providesRapidShutdownSignal: true,
    weightLbs: 1.5,
    warrantyYears: 5,
    msrpUsd: 310,
    ulListing: 'UL 60730-1',
    ecosystemBrand: 'solaredge',
    ecosystemFamily: 'home-network',
    compatibleWith: [
      'solaredge-home-hub-7600', 'solaredge-home-hub-10000',
      'solaredge-home-battery-10',
    ],
    active: true,
    isNew: true,
  },
];

export function getMonitoringGatewayById(id: string): MonitoringGateway | undefined {
  return MONITORING_GATEWAYS.find(g => g.id === id);
}

// ============================================================
// v47.397 — EV Chargers (Tesla Wall Connector, Enphase IQ EV Charger, etc.)
// Intentionally NOT consumed by solar BOM/sizing/engineering pipelines.
// ============================================================
export interface EVCharger {
  id: string;
  manufacturer: string;
  model: string;
  category: 'ev_charger';
  maxOutputKw: number;
  maxOutputAmps: number;
  voltageV: number;
  phaseType: 'split_phase' | 'single_phase' | 'three_phase';
  breakerSizeA: number;
  connectorType: 'NACS' | 'J1772' | 'CCS1' | 'Type2';
  cableLengthFt: number;
  smartChargingCapable: boolean;
  bidirectionalCapable: boolean;
  wifiConnected: boolean;
  loadSharingCapable: boolean;
  outdoorRated: boolean;
  hardwired: boolean;
  weightLbs: number;
  warrantyYears: number;
  msrpUsd: number;
  ulListing: string;
  datasheetUrl?: string;
  ecosystemBrand: string;
  ecosystemFamily?: string;
  compatibleWith?: string[];
  active?: boolean;
  isNew?: boolean;
}

export const EV_CHARGERS: EVCharger[] = [
  // ── Tesla Wall Connector Gen 3 ────────────────────────────────────────────
  {
    id: 'tesla-wall-connector-gen3',
    manufacturer: 'Tesla', model: 'Wall Connector (Gen 3)',
    category: 'ev_charger',
    maxOutputKw: 11.5, maxOutputAmps: 48,
    voltageV: 240, phaseType: 'split_phase',
    breakerSizeA: 60,
    connectorType: 'NACS',
    cableLengthFt: 24,
    smartChargingCapable: true, bidirectionalCapable: false,
    wifiConnected: true, loadSharingCapable: true,
    outdoorRated: true, hardwired: true,
    weightLbs: 15, warrantyYears: 4, msrpUsd: 475,
    ulListing: 'UL 2594',
    ecosystemBrand: 'tesla',
    ecosystemFamily: 'wall-connector',
    compatibleWith: ['tesla-powerwall-3', 'tesla-powerwall-2', 'tesla-backup-gateway-2'],
    active: true,
    isNew: true,
    datasheetUrl: 'https://nwsolar.com/wp-content/uploads/2022/10/Tesla_Wall_Connector_Datasheet_EN-NA.pdf',
  },
  // ── Enphase IQ EV Charger ────────────────────────────────────────────────
  {
    id: 'enphase-iq-ev-charger',
    manufacturer: 'Enphase', model: 'IQ EV Charger',
    category: 'ev_charger',
    maxOutputKw: 11.5, maxOutputAmps: 48,
    voltageV: 240, phaseType: 'split_phase',
    breakerSizeA: 60,
    connectorType: 'J1772',
    cableLengthFt: 23,
    smartChargingCapable: true, bidirectionalCapable: false,
    wifiConnected: true, loadSharingCapable: true,
    outdoorRated: true, hardwired: true,
    weightLbs: 17, warrantyYears: 3, msrpUsd: 699,
    ulListing: 'UL 2594',
    ecosystemBrand: 'enphase',
    ecosystemFamily: 'iq-ev-charger',
    compatibleWith: [
      'enphase-iq-gateway',
      'enphase-iq8plus', 'enphase-iq8m', 'enphase-iq8h',
      'enphase-iq-battery-5p', 'enphase-iq-battery-10t',
    ],
    active: true,
    isNew: true,
    datasheetUrl: 'https://enphase.com/download/iq-ev-charger-2-data-sheet',
  },
];

export function getEVChargerById(id: string): EVCharger | undefined {
  return EV_CHARGERS.find(c => c.id === id);
}

// ============================================================
// v47.397 — Ecosystem lookup helper (cross-category)
// ============================================================
export function getEquipmentByEcosystem(brand: string): {
  panels: SolarPanel[];
  stringInverters: StringInverter[];
  microinverters: Microinverter[];
  optimizers: Optimizer[];
  batteries: BatterySystem[];
  generators: GeneratorSystem[];
  atsUnits: ATSUnit[];
  backupInterfaces: BackupInterface[];
  monitoringGateways: MonitoringGateway[];
  evChargers: EVCharger[];
} {
  const norm = (brand || '').toLowerCase();
  const matches = (e: any) =>
    ((e?.ecosystemBrand as string) || '').toLowerCase() === norm;
  return {
    panels:             SOLAR_PANELS.filter(matches),
    stringInverters:    STRING_INVERTERS.filter(matches),
    microinverters:     MICROINVERTERS.filter(matches),
    optimizers:         OPTIMIZERS.filter(matches),
    batteries:          BATTERIES.filter(matches),
    generators:         GENERATORS.filter(matches),
    atsUnits:           ATS_UNITS.filter(matches),
    backupInterfaces:   BACKUP_INTERFACES.filter(matches),
    monitoringGateways: MONITORING_GATEWAYS.filter(matches),
    evChargers:         EV_CHARGERS.filter(matches),
  };
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
