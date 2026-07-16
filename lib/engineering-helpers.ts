/**
 * Engineering page helper functions, types, and constants.
 * Extracted from app/engineering/page.tsx for monolith relief.
 */
import { getBatteryById } from '@/lib/equipment-db';
import type { SubSystemKey, SubSystemEquipmentMap } from '@/lib/system/subSystemEquipment';

// ── Types ────────────────────────────────────────────────────────────
// v47.418 — 'hybrid' added as first-class member. See systemDefinition.ts.
export type InverterType = 'string' | 'micro' | 'optimizer' | 'hybrid' | 'ecoflow';
export type RoofType = 'shingle' | 'tile' | 'metal_standing_seam' | 'metal_corrugated' | 'flat_tpo' | 'flat_epdm' | 'flat_gravel';
export type SystemType = 'roof' | 'ground' | 'fence';
export type TabId = 'config' | 'compliance' | 'electrical' | 'diagram' | 'schedule' | 'structural' | 'mounting' | 'permit' | 'bom' | 'files';

// ── CANONICAL ProjectConfig family ───────────────────────────────────
// Wave 1 of docs/ARCHITECTURE-per-subsystem-equipment.md: the two ProjectConfig
// copies (this one + app/engineering/page.tsx:220) are REUNIFIED — this is the
// single canonical declaration; page.tsx aliases it via `import()` types.
// Keep this the exact superset of everything the engineering page persists.

export interface StringConfig {
  id: string;
  label: string;
  panelCount: number;
  panelId: string;
  tilt: number;
  azimuth: number;
  roofType: RoofType;
  mountingSystem: string;
  wireGauge: string;
  wireLength: number;
  ocpdOverride?: number;
  ocpdOverrideAcknowledged?: boolean;
  /** Per-subsystem tag (derived cache — contract §1.1). Inherits the parent
   *  inverter's key when untagged. */
  subSystemKey?: SubSystemKey;
}

export interface InverterConfig {
  id: string;
  inverterId: string;
  type: InverterType;
  strings: StringConfig[];
  deviceRatioOverride?: number;
  modulesPerString?: number;
  stringsPerInverter?: number;
  // v58.6: optimizer topology peripheral ID (e.g. 'se-p505') — separate from
  // inverterId (central string inverter). Drives BOM Stage 1 optimizer lines.
  optimizerPeripheralId?: string;
  /** Per-subsystem tag (derived cache — contract §1.1, re-stamped from panel
   *  stamps at hydration; survives both normalizer whitelists per I-2). */
  subSystemKey?: SubSystemKey;
}

export interface ProjectConfig {
  projectName: string;
  clientName: string;
  address: string;
  state: string;          // Explicit state code (e.g. 'CA', 'TX') — overrides address parsing
  city: string;           // City name — used for AHJ city-level overrides
  county: string;         // County name — used for AHJ county-level overrides
  designer: string;
  date: string;
  systemType: SystemType;
  inverters: InverterConfig[];
  batteryBrand: string;
  batteryModel: string;
  batteryCount: number;
  batteryKwh: number;     // LEGACY PER-UNIT kWh (page multiplies by batteryCount for totals)
  batteryId: string;      // equipment-db battery ID — drives NEC 705.12(B) bus impact calc
  generatorId: string;    // equipment-db generator ID
  generatorWireLength: number;  // ft — distance from generator to ATS
  trenchRunLengthFt?: number;   // ft — ground/fence array → service trench distance
  atsId: string;
  backupInterfaceId: string;    // equipment-db backup interface ID (Enphase IQ SC3, Tesla Gateway, …)
  mainPanelAmps: number;
  mainPanelBrand: string;
  utilityMeter: string;
  acDisconnect: boolean;
  dcDisconnect: boolean;
  productionMeter: boolean;
  rapidShutdown: boolean;
  roofType: RoofType;
  mountingId: string;
  wireGauge: string;
  conduitType: string;
  wireLength: number;
  windSpeed: number;
  windExposure: 'B' | 'C' | 'D';
  groundSnowLoad: number;
  roofPitch: number;
  rafterSpacing: number;
  rafterSpan: number;
  rafterSize: string;
  rafterSpecies: string;
  framingType: 'truss' | 'rafter' | 'unknown';  // V3 structural engine
  meanRoofHeight?: number;              // ft — mean height of eave to ridge midpoint (ASCE 7 Kz)
  panelOrientation?: 'portrait' | 'landscape';  // V3 array geometry
  attachmentSpacing: number;
  railSpacing: number;           // inches — distance between rail rows
  rowCount?: number;
  columnCount?: number;
  layoutOrientation?: 'portrait' | 'landscape';
  // Installer preference: cut the AC trunk at row transitions.
  spliceAtRows?: boolean;
  panelCoordinates?: Array<{ x: number; y: number; row: number; col: number; }>;
  notes: string;
  interconnectionMethod: 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | 'MAIN_BREAKER_DERATE' | 'PANEL_UPGRADE';
  panelBusRating: number;        // Bus bar rating (may differ from mainPanelAmps)
  utilityId: string;             // e.g. 'ameren', 'comed', 'pge' — '' = auto/unknown
  ahjId: string;                 // e.g. 'il-icc', 'manual' — '' = auto
  roofWidth?: number;
  roofLength?: number;
  inverterLocation?: string;
  disconnectLocation?: string;
  meterLocation?: string;
  mainPanelLocation?: string;
  railType?: string;
  flashingType?: string;
  lagBoltSize?: string;
  sheathingType?: string;
  contractorLicense?: string;
  electricalLicense?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  zip?: string;                  // ZIP code — used for AHJ lookup
  apn?: string;                  // Assessor Parcel Number — Error 3e fix
  // Phase 13 — Smart Defaults sentinel + seed brand.
  // `defaultsApplied` is set exactly ONCE by applySmartDefaultsOnce() and must
  // remain true until the user explicitly resets the system (reset hook
  // clearDefaultsAppliedFlag). It blocks the defaults layer from ever
  // overriding user edits after the first bootstrap. `selectedBrand` records
  // the seed brand chosen by the defaults layer (only when the user had not
  // already picked one); defaults will NOT re-fire on brand changes.
  defaultsApplied?: boolean;
  selectedBrand?: string;
  // Phase 13.1 — USER INTENT LOCK. Set to `true` the moment the user touches
  // ANY inverter / string field. While on: smart defaults + auto-apply of the
  // sizing recommendation are hard no-ops. Only "Apply Recommendation" or
  // "Reset System" flips it off. NON-NEGOTIABLE: the sizing engine MAY still
  // compute a recommendation for display, but MUST NOT mutate the user's
  // config once this lock is engaged.
  userHasEditedInverters?: boolean;
  // v61.7 — CONFIG OVERWRITE KILL SWITCH. Set to `true` after any explicit
  // user action (Apply Recommendation, manual edit, smart-defaults bootstrap).
  // When true ALL automatic config mutations are BLOCKED: CAD sync only
  // updates panel count (never rearranges strings), AUTO-APPLY is a no-op,
  // HARD DC/AC AUTO-HEAL is warning-only, ecosystem apply is blocked.
  isUserControlled?: boolean;
  // ── Per-subsystem equipment contract (Wave 1, §1.3) — all additive ──
  /** Equipment authority per subsystem — survives inverter regeneration
   *  (contract §1.1 authority hierarchy; keyed by SubSystemKey). */
  subSystems?: SubSystemEquipmentMap;
  /** Per-subsystem smart-defaults sentinel (extends `defaultsApplied`). */
  defaultsAppliedBySubSystem?: Partial<Record<SubSystemKey, boolean>>;
  /** engineering_config envelope schema version. 2 = per-subsystem contract;
   *  absent/<2 = legacy flat shape (save route re-normalizes — Wave 1b). */
  schemaVersion?: number;
}

export interface ComplianceResult {
  overallStatus: 'PASS' | 'WARNING' | 'FAIL' | null;
  utilityName?: string;
  jurisdiction?: any;
  electrical?: any;
  structural?: any;
  autoDetected?: any;
  stringConfig?: {
    totalStrings: number;
    panelsPerString: number;
    lastStringPanels: number;
    maxPanelsPerString: number;
    minPanelsPerString: number;
    recommendedPanelsPerString: number;
    designTempMin: number;
    tempCorrectionFactor: number;
    vocCorrected: number;
    vmpCorrected: number;
    stringVoc: number;
    stringVmp: number;
    stringIsc: number;
    totalDcPower: number;
    totalDcVoltageMax: number;
    totalDcCurrentMax: number;
    ocpdPerString: number;
    dcWireAmpacity: number;
    combinerType: string;
    combinerLabel: string;
    mpptChannels: Array<{ channelIndex: number; stringCount: number; totalPower: number; totalIsc: number }>;
    dcAcRatio: number;
    warnings: string[];
    errors: string[];
    isValid: boolean;
  } | null;
}

// ── Constants ────────────────────────────────────────────────────────
export const ROOF_TYPES: Record<RoofType, { label: string; attachment: string; hardware: string; notes: string }> = {
  shingle:             { label: 'Asphalt Shingle',             attachment: 'Flashed L-Foot with lag bolt into rafter',             hardware: 'IronRidge XR100 rail + L-feet, 5/16" \u00d7 3" lag bolts, EPDM flashing',              notes: 'Locate rafters with stud finder. Min. 2.5" embedment into rafter. Flash all penetrations.' },
  tile:                { label: 'Concrete / Clay Tile',        attachment: 'Tile hook or tile replacement mount',                  hardware: 'QuickMount PV Tile Hook, or Wiehle tile replacement, 5/16" \u00d7 3" lag bolts',        notes: 'Remove tile, install flashing + hook, replace tile. Do not crack tiles.' },
  metal_standing_seam: { label: 'Metal \u2014 Standing Seam', attachment: 'S-5! clamp (no penetrations)',                         hardware: 'S-5! PVKIT 2.0 or S-5! U-Clamp, no roof penetrations required',                        notes: 'No penetrations. Clamp directly to seam. Verify seam profile matches clamp model.' },
  metal_corrugated:    { label: 'Metal \u2014 Corrugated / R-Panel', attachment: 'SnapNrack or Unirac corrugated mount with EPDM seal', hardware: 'SnapNrack Series 100, self-tapping screws with EPDM washers, butyl tape seal',      notes: 'Drill into structural purlins only. Apply butyl tape + EPDM washer at every penetration.' },
  flat_tpo:            { label: 'Flat \u2014 TPO / PVC Membrane', attachment: 'Ballasted tray (no penetrations) or heat-welded pad', hardware: 'Esdec FlatFix Fusion, Unirac RM Ballast, or SunModo EzBallast',                       notes: 'Ballasted systems preferred. If penetrating, use TPO-compatible flashing welded by certified roofer.' },
  flat_epdm:           { label: 'Flat \u2014 EPDM Rubber',    attachment: 'Ballasted tray or EPDM-bonded pad',                   hardware: 'Esdec FlatFix, or bonded rubber pad with stainless hardware',                            notes: 'Use EPDM-compatible adhesive for bonded mounts. Ballasted preferred to avoid warranty issues.' },
  flat_gravel:         { label: 'Flat \u2014 Built-Up / Gravel', attachment: 'Ballasted tray system',                             hardware: 'Unirac RM Ballast or IronRidge ballasted flat roof system',                              notes: 'Clear gravel from mount footprint. Verify roof load capacity with structural engineer.' },
};

// NEC code explanations lookup
export const NEC_EXPLANATIONS: Record<string, { title: string; plain: string; fix: string; ref: string }> = {
  '690.7':  { title: 'Max DC Voltage',       plain: 'The total string voltage at cold temperature exceeds the inverter or system maximum. NEC 690.7 requires the corrected open-circuit voltage (Voc) to stay within rated limits.',        fix: 'Reduce panels per string, or choose an inverter with a higher max input voltage. Use the Auto String Config tool to find the correct count.',    ref: 'NEC 690.7(A)' },
  '690.8':  { title: 'OCPD Sizing',          plain: 'The overcurrent protection device (fuse/breaker) must be rated at 125% of the short-circuit current (Isc). An undersized OCPD can fail to protect wiring during a fault.',            fix: 'Increase the OCPD rating to at least 125% \u00d7 Isc. The system will auto-select the next standard breaker size.',                               ref: 'NEC 690.8(A)' },
  '690.12': { title: 'Rapid Shutdown',        plain: 'NEC 690.12 requires rapid shutdown capability for all rooftop PV systems. Panels must de-energize within 30 seconds of initiating shutdown.',                                        fix: 'Add a rapid shutdown device (RSD) such as SolarEdge P-Series, Tigo CCA, or Enphase IQ8. Module-level power electronics (MLPE) satisfy this requirement.', ref: 'NEC 690.12' },
  '705.12': { title: '120% Busbar Rule',      plain: 'The solar breaker + main breaker cannot exceed 120% of the bus bar rating. Exceeding this risks overloading the panel bus bar.',                                                     fix: 'Use supply-side tap (NEC 705.11), derate the main breaker, upgrade the panel, or reduce the solar system size.',                                  ref: 'NEC 705.12(B)(2)' },
  '310.15': { title: 'Wire Ampacity',         plain: 'The conductor must be rated to carry the maximum current with temperature and conduit fill derating applied. Undersized wire can overheat.',                                         fix: 'Increase wire gauge (lower AWG number). Check conduit fill \u2014 more conductors in conduit require larger wire.',                                ref: 'NEC 310.15' },
  '690.9':  { title: 'Overcurrent Protection', plain: 'Each ungrounded conductor must be protected by an OCPD rated for the circuit. Missing or incorrectly sized protection creates fire risk.',                                          fix: 'Add properly rated fuses or breakers at each source. String combiner boxes typically include fusing.',                                            ref: 'NEC 690.9' },
  '690.47': { title: 'Grounding',             plain: 'PV systems require equipment grounding conductors (EGC) sized per NEC 690.47. Improper grounding creates shock and fire hazards.',                                                   fix: 'Verify EGC sizing per NEC Table 250.122. Use listed grounding hardware. Ensure all metal parts are bonded.',                                      ref: 'NEC 690.47' },
};

// ── Pure helper functions ────────────────────────────────────────────

/**
 * Calculate total battery backfeed breaker amps for NEC 705.12(B) bus loading.
 */
export function calcBatteryBackfeedAmps(batteryId: string | undefined, batteryCount: number): number {
  if (!batteryId) return 0;
  const b = getBatteryById(batteryId);
  if (!b || !b.backfeedBreakerA) return 0;
  if (b.requiresGateway) return b.backfeedBreakerA;
  const qty = batteryCount && batteryCount > 0 ? batteryCount : 1;
  return b.backfeedBreakerA * qty;
}

export function parseStateFromAddress(address: string): string | null {
  if (!address) return null;
  const stateAbbrevMatch = address.match(/,\s*([A-Z]{2})(?:\s+\d{5})?(?:\s*,|\s*$)/);
  if (stateAbbrevMatch) {
    const code = stateAbbrevMatch[1];
    const validStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
      'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
      'VT','VA','WA','WV','WI','WY','DC'];
    if (validStates.includes(code)) return code;
  }
  const stateNames: Record<string, string> = {
    'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
    'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
    'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
    'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
    'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
    'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
    'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
    'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
    'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
    'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
    'district of columbia':'DC','washington dc':'DC','washington d.c.':'DC',
  };
  const lower = address.toLowerCase();
  for (const [name, code] of Object.entries(stateNames)) {
    if (lower.includes(name)) return code;
  }
  return null;
}

export function parseCityFromAddress(address: string): string | null {
  if (!address) return null;
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    const cityPart = parts[parts.length - 2];
    if (cityPart && !/^\d/.test(cityPart)) return cityPart;
  }
  return null;
}

export function getNecExplanation(issue: any) {
  if (!issue.necReference && !issue.code) return null;
  const ref = issue.necReference || issue.code || '';
  for (const [key, val] of Object.entries(NEC_EXPLANATIONS)) {
    if (ref.includes(key)) return val;
  }
  return null;
}

export function newString(idx: number): StringConfig {
  return { id: `str-${Date.now()}-${idx}`, label: `String ${idx + 1}`, panelCount: 10, panelId: 'qcells-peak-duo-400', tilt: 20, azimuth: 180, roofType: 'shingle', mountingSystem: 'ironridge-xr100', wireGauge: '#10 AWG', wireLength: 50 };
}
