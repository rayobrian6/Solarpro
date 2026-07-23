// ═══════════════════════════════════════════════════════════════════════════
// Design Temperatures — ASHRAE climatic design conditions (state lookup)
// ───────────────────────────────────────────────────────────────────────────
// Source basis: ASHRAE Handbook — Fundamentals (2021), Climatic Design
// Information (extreme annual mean minimum dry-bulb; 2% annual cooling
// design dry-bulb), rounded CONSERVATIVELY per state:
//   • extreme low  = at/below the coldest major-station value in the state
//     (colder ⇒ HIGHER corrected Voc ⇒ conservative for NEC 690.7(A))
//   • 2% high      = at/above the hottest major-station value in the state
//     (hotter ⇒ MORE ampacity derating ⇒ conservative for NEC 310.15)
// These are permit-sheet DESIGN TEMPERATURES, not a weather model. Values are
// deliberately state-envelope conservative; an AHJ-specific override (the
// project's designTempMin field) always wins upstream of this lookup.
// ═══════════════════════════════════════════════════════════════════════════

export interface DesignTemps {
  /** ASHRAE extreme annual mean minimum dry-bulb, °C (NEC 690.7(A) basis). */
  ashraeExtremeLowC: number;
  /** ASHRAE 2% annual cooling design dry-bulb, °C (ampacity/derate basis). */
  ashrae2pctHighC: number;
  /** Human-readable provenance for the sheet footnote. */
  source: string;
}

// [extremeLowC, 2pctHighC] — see source basis note above.
const STATE_TEMPS: Record<string, [number, number]> = {
  AL: [-9, 35],  AK: [-40, 26], AZ: [-8, 43],  AR: [-13, 36], CA: [-7, 40],
  CO: [-25, 34], CT: [-19, 32], DE: [-13, 33], DC: [-13, 34], FL: [-2, 34],
  GA: [-8, 35],  HI: [10, 32],  ID: [-22, 36], IL: [-23, 33], IN: [-21, 34],
  IA: [-26, 33], KS: [-20, 37], KY: [-18, 33], LA: [-6, 35],  ME: [-26, 31],
  MD: [-14, 34], MA: [-20, 32], MI: [-25, 31], MN: [-31, 31], MS: [-8, 35],
  MO: [-19, 35], MT: [-32, 34], NE: [-25, 36], NV: [-12, 41], NH: [-26, 32],
  NJ: [-16, 33], NM: [-16, 36], NY: [-26, 32], NC: [-12, 34], ND: [-33, 33],
  OH: [-21, 32], OK: [-14, 38], OR: [-12, 36], PA: [-22, 32], RI: [-16, 32],
  SC: [-9, 35],  SD: [-29, 35], TN: [-15, 34], TX: [-10, 38], UT: [-18, 38],
  VT: [-27, 31], VA: [-15, 34], WA: [-13, 34], WV: [-19, 32], WI: [-27, 31],
  WY: [-29, 33],
};

// Safe national default — colder than every CONUS state envelope except the
// northern plains, hotter than everything but the desert southwest.
const DEFAULT_TEMPS: [number, number] = [-25, 38];

/**
 * Resolve permit design temperatures for a site.
 * `state` is a 2-letter USPS abbreviation (case-insensitive). `lat` refines
 * the three latitude-spanning states (CA / TX / FL) toward their colder
 * northern envelope; `lng` is accepted for future refinement and currently
 * unused. Unknown/absent state ⇒ conservative national default.
 */
export function getDesignTemps(
  lat?: number | null,
  lng?: number | null,
  state?: string | null,
): DesignTemps {
  const key = (state ?? '').trim().toUpperCase();
  const base = STATE_TEMPS[key];
  if (!base) {
    return {
      ashraeExtremeLowC: DEFAULT_TEMPS[0],
      ashrae2pctHighC: DEFAULT_TEMPS[1],
      source: 'ASHRAE 2021 — conservative national default (state unresolved)',
    };
  }
  let [low, high] = base;
  // North/south refinement for the three latitude-spanning states — northern
  // sites get the colder envelope (conservative for 690.7(A)).
  if (typeof lat === 'number' && Number.isFinite(lat)) {
    if (key === 'CA' && lat > 38) low = Math.min(low, -12);
    if (key === 'TX' && lat > 33) low = Math.min(low, -14);
    if (key === 'FL' && lat > 29) low = Math.min(low, -6);
  }
  return {
    ashraeExtremeLowC: low,
    ashrae2pctHighC: high,
    source: `ASHRAE 2021 climatic design data — ${key} state envelope (conservative)`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// THERMAL DESIGN BASIS — the ONE canonical min/max design-temperature object
// (W5 §4, repair pass 2026-07-22). Every V/I/T calculation on the permit set
// (NEC 690.7 cold-Voc, 310.15 ampacity derating) consumes THIS basis. No
// renderer may hardcode a local temperature (the APP-A -10 °C split is killed
// by routing APP-A through getThermalDesignBasis). One basis per package.
// ═══════════════════════════════════════════════════════════════════════════

export interface ThermalDesignBasis {
  /** minimum design temperature, °C (NEC 690.7(A) cold-Voc basis). */
  minDesignTempC: number;
  /** maximum / 2% cooling design temperature, °C (NEC 310.15 derating basis). */
  maxDesignTempC: number;
  /** human-readable provenance of the temperature values. */
  source: string;
  /** station / location the values represent (state envelope or AHJ override). */
  stationOrLocation: string;
  /** climatic-data revision, e.g. 'ASHRAE 2021'. */
  revision: string;
  /** where the module temperature coefficients come from. */
  coefficientSource: string;
  /** the calculation the min temp feeds. */
  method: string;
  /** true when an explicit AHJ/project override replaced the ASHRAE envelope. */
  overrideApplied: boolean;
  provenance: { source: string };
}

/** Extract a 2-letter USPS state from an explicit field or a "…, IL 62040" address tail. */
function resolveStateAbbr(state?: string | null, address?: string | null): string | undefined {
  if (state && /^[A-Za-z]{2}$/.test(state.trim())) return state.trim().toUpperCase();
  const m = (address ?? '').match(/,\s*([A-Za-z]{2})[\s,]+\d{5}(?:-\d{4})?\b/);
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * Resolve the singular ThermalDesignBasis for a site. An explicit
 * `designTempMinOverrideC` (the project's AHJ design-low field) always wins
 * over the ASHRAE state envelope; otherwise the ASHRAE 2021 state-envelope
 * extreme-low is used. This is the ONLY sanctioned source of design temperatures
 * for the equipment/compliance sheets.
 */
export function getThermalDesignBasis(opts: {
  lat?: number | null;
  lng?: number | null;
  state?: string | null;
  address?: string | null;
  designTempMinOverrideC?: number | null;
}): ThermalDesignBasis {
  const stateAbbr = resolveStateAbbr(opts.state, opts.address);
  const temps = getDesignTemps(opts.lat, opts.lng, stateAbbr);
  const hasOverride = typeof opts.designTempMinOverrideC === 'number'
    && Number.isFinite(opts.designTempMinOverrideC);
  const minC = hasOverride ? (opts.designTempMinOverrideC as number) : temps.ashraeExtremeLowC;
  return {
    minDesignTempC: minC,
    maxDesignTempC: temps.ashrae2pctHighC,
    source: hasOverride
      ? `AHJ / project design-low override (${minC} °C); ASHRAE max ${temps.ashrae2pctHighC} °C`
      : temps.source,
    stationOrLocation: hasOverride
      ? 'AHJ / project override'
      : (stateAbbr ? `${stateAbbr} state envelope` : 'national default'),
    revision: 'ASHRAE 2021',
    coefficientSource: 'module manufacturer datasheet (temperature coefficient of Voc)',
    method: 'NEC 690.7(A) cold-temperature Voc correction / NEC 310.15 ampacity derating',
    overrideApplied: hasOverride,
    provenance: { source: hasOverride ? 'project.designTempMin' : 'designTemps.getDesignTemps' },
  };
}
