// ============================================================
// SolarPro Fire Setback Calculator
// IRC R324 / IFC / CAL FIRE / NFPA 855 compliance
// Calculates required setbacks for solar panel installations
// ============================================================

export type RoofType = 'gable' | 'hip' | 'flat' | 'shed' | 'gambrel' | 'mansard' | 'complex';
export type FireZone  = 'standard' | 'wui' | 'hvhz' | 'cal_fire_sra' | 'cal_fire_vhfhsz';

export interface FireSetbackInput {
  roofType:        RoofType;
  roofPitchDeg:    number;       // degrees
  stateCode:       string;
  fireZone?:       FireZone;
  ahjOverride?: {
    ridgeSetbackIn?:   number;
    eaveSetbackIn?:    number;
    valleySetbackIn?:  number;
    pathwayWidthIn?:   number;
    hipSetbackIn?:     number;
  };
  // System details
  systemSizeKw?:   number;
  roofAreaSqFt?:   number;
  // Building details
  stories?:        number;
  buildingType?:   'residential' | 'commercial';
}

export interface FireSetbackResult {
  // Required setbacks (inches)
  ridgeSetbackIn:       number;
  eaveSetbackIn:        number;
  valleySetbackIn:      number;
  hipSetbackIn:         number;
  rakeSetbackIn:        number;   // gable end
  pathwayWidthIn:       number;
  // Pathway requirements
  pathwayRequired:      boolean;
  pathwayDescription:   string;
  // Code references
  codeReference:        string;
  necVersion:           string;
  // Special requirements
  specialRequirements:  string[];
  // Compliance notes
  notes:                string[];
  // Summary
  summary:              string;
  // Usable roof area after setbacks (approximate %)
  usableRoofPct:        number;
}

// ── State-specific fire zone overrides ───────────────────────────────────────
const STATE_FIRE_OVERRIDES: Record<string, Partial<FireSetbackResult>> = {
  CA: {
    ridgeSetbackIn:   18,
    eaveSetbackIn:    0,
    valleySetbackIn:  18,
    pathwayWidthIn:   36,
    codeReference:    'CAL FIRE / CBC Section 1505.1 / IRC R324',
    specialRequirements: [
      'CAL FIRE setbacks apply in SRA/VHFHSZ zones',
      'Additional 18" setback from all roof edges in VHFHSZ',
      'Class A fire rating required for all roofing materials',
    ],
  },
  FL: {
    ridgeSetbackIn:   18,
    eaveSetbackIn:    0,
    valleySetbackIn:  18,
    pathwayWidthIn:   36,
    codeReference:    'FBC (Florida Building Code) / IRC R324',
    specialRequirements: [
      'Miami-Dade NOA required for all equipment in HVHZ',
      'Wind uplift calculations mandatory',
    ],
  },
  NJ: {
    ridgeSetbackIn:   18,
    eaveSetbackIn:    0,
    valleySetbackIn:  18,
    pathwayWidthIn:   36,
    codeReference:    'NJ UCC / IRC R324.4',
    specialRequirements: [
      'NJ requires 36" pathways on all roof planes with solar',
    ],
  },
  NY: {
    ridgeSetbackIn:   18,
    eaveSetbackIn:    0,
    valleySetbackIn:  18,
    pathwayWidthIn:   36,
    codeReference:    'NYC Building Code / IRC R324.4',
    specialRequirements: [
      'NYC requires PE/RA stamp on all permit drawings',
      'Pathway requirements per NYC Fire Code',
    ],
  },
  MA: {
    ridgeSetbackIn:   18,
    eaveSetbackIn:    0,
    valleySetbackIn:  18,
    pathwayWidthIn:   36,
    codeReference:    '780 CMR (MA State Building Code) / IRC R324',
    specialRequirements: [
      'Massachusetts requires 36" pathways',
      'SMART program registration required for incentives',
    ],
  },
};

// ── Main calculator ───────────────────────────────────────────────────────────
export function calcFireSetbacks(input: FireSetbackInput): FireSetbackResult {
  const {
    roofType,
    roofPitchDeg,
    stateCode,
    fireZone = 'standard',
    ahjOverride,
    systemSizeKw = 0,
    stories = 1,
    buildingType = 'residential',
  } = input;

  const notes: string[] = [];
  const specialRequirements: string[] = [];

  // ── Base setbacks per IRC R324.4 (2021) ──────────────────────────────────
  // IRC R324.4.1: Roof access and pathways
  // - Gable roofs: 18" from ridge, 18" from valleys
  // - Hip roofs: 18" from all hips
  // - All roofs: 36" wide pathways from eave to ridge

  let ridgeSetbackIn   = 18;   // IRC R324.4.1(1)
  let eaveSetbackIn    = 0;    // IRC R324.4.1 — no eave setback required by IRC
  let valleySetbackIn  = 18;   // IRC R324.4.1(3)
  let hipSetbackIn     = 18;   // IRC R324.4.1(2) — hip roofs
  let rakeSetbackIn    = 0;    // Gable rake — no IRC requirement
  let pathwayWidthIn   = 36;   // IRC R324.4.1 — 36" min pathway
  let pathwayRequired  = true;

  // ── Roof type adjustments ─────────────────────────────────────────────────
  switch (roofType) {
    case 'hip':
      // Hip roofs: 18" from all hips, no ridge setback needed (no ridge access path)
      ridgeSetbackIn  = 18;
      hipSetbackIn    = 18;
      valleySetbackIn = 18;
      notes.push('Hip roof: 18" setback from all hip ridges per IRC R324.4.1(2)');
      break;

    case 'flat':
      // Flat roofs: different pathway requirements
      ridgeSetbackIn  = 0;
      hipSetbackIn    = 0;
      valleySetbackIn = 0;
      pathwayWidthIn  = 48;   // Flat roofs need wider pathways for FF access
      notes.push('Flat roof: 48" perimeter setback recommended for FF access');
      notes.push('Flat roof: No ridge/hip setbacks required');
      break;

    case 'shed':
      // Shed roofs: setback from high side only
      ridgeSetbackIn  = 18;
      hipSetbackIn    = 0;
      valleySetbackIn = 0;
      notes.push('Shed roof: 18" setback from high side (ridge equivalent)');
      break;

    case 'gable':
    default:
      ridgeSetbackIn  = 18;
      hipSetbackIn    = 0;
      valleySetbackIn = 18;
      notes.push('Gable roof: 18" from ridge, 18" from valleys per IRC R324.4.1');
      break;
  }

  // ── Pitch adjustments ─────────────────────────────────────────────────────
  if (roofPitchDeg > 45) {
    // Steep roofs (>45°): additional setback for safety
    ridgeSetbackIn = Math.max(ridgeSetbackIn, 24);
    notes.push(`Steep roof (${roofPitchDeg}°): increased ridge setback to 24"`);
  }

  if (roofPitchDeg < 5) {
    // Low-slope: treated more like flat roof
    pathwayWidthIn = 48;
    notes.push('Low-slope roof (<5°): 48" pathway width recommended');
  }

  // ── Fire zone adjustments ─────────────────────────────────────────────────
  if (fireZone === 'wui' || fireZone === 'cal_fire_sra') {
    ridgeSetbackIn  = Math.max(ridgeSetbackIn, 18);
    valleySetbackIn = Math.max(valleySetbackIn, 18);
    pathwayWidthIn  = Math.max(pathwayWidthIn, 36);
    specialRequirements.push('WUI zone: enhanced setbacks apply');
    specialRequirements.push('Class A fire-rated roofing required in WUI zone');
  }

  if (fireZone === 'cal_fire_vhfhsz') {
    ridgeSetbackIn  = Math.max(ridgeSetbackIn, 18);
    eaveSetbackIn   = Math.max(eaveSetbackIn, 18);
    valleySetbackIn = Math.max(valleySetbackIn, 18);
    hipSetbackIn    = Math.max(hipSetbackIn, 18);
    pathwayWidthIn  = Math.max(pathwayWidthIn, 36);
    specialRequirements.push('CAL FIRE VHFHSZ: 18" setback from ALL roof edges');
    specialRequirements.push('Class A fire-rated roofing required');
    specialRequirements.push('Ember-resistant vents required');
  }

  if (fireZone === 'hvhz') {
    specialRequirements.push('HVHZ: Miami-Dade NOA required for all equipment');
    specialRequirements.push('HVHZ: Wind uplift calculations mandatory');
    specialRequirements.push('HVHZ: Enhanced attachment requirements');
  }

  // ── State-specific overrides ──────────────────────────────────────────────
  const stateOverride = STATE_FIRE_OVERRIDES[stateCode.toUpperCase()];
  if (stateOverride) {
    if (stateOverride.ridgeSetbackIn  !== undefined) ridgeSetbackIn  = Math.max(ridgeSetbackIn,  stateOverride.ridgeSetbackIn);
    if (stateOverride.eaveSetbackIn   !== undefined) eaveSetbackIn   = Math.max(eaveSetbackIn,   stateOverride.eaveSetbackIn);
    if (stateOverride.valleySetbackIn !== undefined) valleySetbackIn = Math.max(valleySetbackIn, stateOverride.valleySetbackIn);
    if (stateOverride.pathwayWidthIn  !== undefined) pathwayWidthIn  = Math.max(pathwayWidthIn,  stateOverride.pathwayWidthIn);
    if (stateOverride.specialRequirements) specialRequirements.push(...stateOverride.specialRequirements);
  }

  // ── AHJ overrides (highest priority) ─────────────────────────────────────
  if (ahjOverride) {
    if (ahjOverride.ridgeSetbackIn   !== undefined) ridgeSetbackIn   = ahjOverride.ridgeSetbackIn;
    if (ahjOverride.eaveSetbackIn    !== undefined) eaveSetbackIn    = ahjOverride.eaveSetbackIn;
    if (ahjOverride.valleySetbackIn  !== undefined) valleySetbackIn  = ahjOverride.valleySetbackIn;
    if (ahjOverride.pathwayWidthIn   !== undefined) pathwayWidthIn   = ahjOverride.pathwayWidthIn;
    if (ahjOverride.hipSetbackIn     !== undefined) hipSetbackIn     = ahjOverride.hipSetbackIn;
    notes.push('AHJ-specific setback requirements applied');
  }

  // ── Pathway description ───────────────────────────────────────────────────
  let pathwayDescription = '';
  if (roofType === 'flat') {
    pathwayDescription = `${pathwayWidthIn}" perimeter access pathway around array`;
  } else {
    pathwayDescription = `${pathwayWidthIn}" wide pathway from eave to ridge on each roof plane`;
    if (stories > 1) {
      pathwayDescription += '; additional pathway may be required for multi-story buildings';
    }
  }

  // ── Code reference ────────────────────────────────────────────────────────
  let codeReference = 'IRC R324.4 (2021) / IFC 605.11';
  if (stateOverride?.codeReference) codeReference = stateOverride.codeReference;

  // ── Usable roof area estimate ─────────────────────────────────────────────
  // Rough estimate: setbacks reduce usable area by ~15-25% for typical residential
  let usableRoofPct = 80;
  if (roofType === 'hip') usableRoofPct = 70;
  if (roofType === 'flat') usableRoofPct = 85;
  if (fireZone === 'cal_fire_vhfhsz') usableRoofPct -= 10;

  // ── Summary ───────────────────────────────────────────────────────────────
  const setbackParts: string[] = [];
  if (ridgeSetbackIn > 0)  setbackParts.push(`${ridgeSetbackIn}" from ridge`);
  if (hipSetbackIn > 0 && roofType === 'hip') setbackParts.push(`${hipSetbackIn}" from hips`);
  if (valleySetbackIn > 0) setbackParts.push(`${valleySetbackIn}" from valleys`);
  if (eaveSetbackIn > 0)   setbackParts.push(`${eaveSetbackIn}" from eaves`);

  const summary = setbackParts.length > 0
    ? `Required setbacks: ${setbackParts.join(', ')}. ${pathwayWidthIn}" pathway required.`
    : `No ridge/hip setbacks required. ${pathwayWidthIn}" pathway required.`;

  return {
    ridgeSetbackIn,
    eaveSetbackIn,
    valleySetbackIn,
    hipSetbackIn,
    rakeSetbackIn,
    pathwayWidthIn,
    pathwayRequired,
    pathwayDescription,
    codeReference,
    necVersion: stateCode === 'CA' ? 'NEC 2023' : stateCode === 'AZ' ? 'NEC 2017' : 'NEC 2020',
    specialRequirements,
    notes,
    summary,
    usableRoofPct,
  };
}

// ── Pathway layout helper ─────────────────────────────────────────────────────
export interface PathwayLayout {
  pathways: {
    id:          string;
    description: string;
    widthIn:     number;
    location:    string;
  }[];
  totalPathwayCount: number;
  notes: string[];
}

export function calcPathwayLayout(
  roofType: RoofType,
  roofPitchDeg: number,
  arrayCount: number,
  stateCode: string,
): PathwayLayout {
  const pathways: PathwayLayout['pathways'] = [];
  const notes: string[] = [];

  const pathwayWidth = stateCode === 'CA' ? 36 : 36;

  // Always need at least one eave-to-ridge pathway per roof plane
  if (roofType === 'gable' || roofType === 'shed') {
    pathways.push({
      id: 'P1',
      description: 'Primary eave-to-ridge pathway',
      widthIn: pathwayWidth,
      location: 'Center of roof plane or at array boundary',
    });
    if (arrayCount > 1) {
      pathways.push({
        id: 'P2',
        description: 'Secondary eave-to-ridge pathway',
        widthIn: pathwayWidth,
        location: 'Opposite side of roof plane',
      });
    }
  }

  if (roofType === 'hip') {
    pathways.push({
      id: 'P1',
      description: 'Hip roof pathway — diagonal from eave to hip',
      widthIn: pathwayWidth,
      location: 'Along each hip rafter',
    });
    notes.push('Hip roofs require pathways along each hip — reduces usable area significantly');
  }

  if (roofType === 'flat') {
    pathways.push({
      id: 'P1',
      description: 'Perimeter access pathway',
      widthIn: 48,
      location: 'All four sides of array',
    });
    notes.push('Flat roofs: 48" perimeter pathway recommended for FF access');
  }

  // California additional requirements
  if (stateCode === 'CA') {
    notes.push('California: Pathways must be clear of obstructions and accessible from ground');
    notes.push('California: Pathways must be marked on site plan');
  }

  return {
    pathways,
    totalPathwayCount: pathways.length,
    notes,
  };
}