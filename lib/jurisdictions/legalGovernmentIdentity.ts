// ═══════════════════════════════════════════════════════════════════════════
// WHICH LEGAL GOVERNMENT AN AHJ ROW REPRESENTS.
//
// ── TWO INDEPENDENT DIMENSIONS, NEVER CONFLATED ───────────────────────────
// `legalIdentityVerified` answers: WHICH GOVERNMENT is this row?
// `permittingAuthorityVerified` answers: does that government administer this
// permit scope, under which adopted codes?
//
// A GEOID proves the first and says NOTHING about the second. Madison County
// having FIPS 17119 does not establish that Madison County Building & Zoning
// issues residential PV permits, nor which NEC edition it enforces. Reporting
// identity coverage as "AHJ coverage" would be the same category error as
// reporting a mailing city as a municipal boundary.
//
// ── IDENTITY IS NOT THE DEPARTMENT ────────────────────────────────────────
// A legal government and a permitting department are different objects:
//
//     legal government : City of Granite City          (place GEOID 1730926)
//     department       : Building & Zoning             (its permit office)
//
// One government can have several departments across scopes (building,
// electrical, fire, zoning), and two registry rows naming different departments
// of ONE government are not duplicates. That is why `LegalGovernmentIdentity`
// is separate from the AHJ row rather than folded into it.
// ═══════════════════════════════════════════════════════════════════════════

/** The kind of legal entity a government is, in US legal geography. */
export type LegalEntityType =
  | 'state'
  | 'county'                    // county or county-equivalent (parish, borough)
  | 'independent-city'          // a city that is ALSO a county-equivalent (VA, MO, MD, NV)
  | 'consolidated-government'   // one government wearing both city and county hats
  | 'incorporated-place'        // an ordinary municipality
  | 'mcd'                       // minor civil division / township — a real government
                                // in the ~20 MCD states, and the building authority
                                // in New England, where counties are NOT governments
  | 'census-designated-place'   // ⚠ NOT a government — statistical geography only
  | 'nonfunctioning-county';    // ⚠ NOT a government — e.g. every CT and RI county

/** Entity types that can actually hold permitting authority. A CDP cannot. */
export const GOVERNING_ENTITY_TYPES: readonly LegalEntityType[] = [
  'state', 'county', 'independent-city', 'consolidated-government',
  'incorporated-place', 'mcd',
];

export function isGoverningEntityType(t: LegalEntityType | null | undefined): boolean {
  return !!t && (GOVERNING_ENTITY_TYPES as readonly string[]).includes(t);
}

/**
 * How an identity was established. Only the deterministic methods may be
 * promoted automatically; `guarded-candidate` never is.
 */
export type IdentityMatchMethod =
  | 'state-code'
  | 'state+county-name'
  | 'state+place-name'
  | 'state+county+place-name'
  | 'state+county+mcd-name'
  | 'official-alias'
  | 'guarded-candidate';        // proposed for a human, never auto-verified

/**
 * The stable, national identity of one legal government.
 *
 * Every id here is a Census GEOID/FIPS, which is national and stable, unlike a
 * NAME: 1,739 of the registry's rows share an `ahjName` with another row, and
 * "Washington County Building Department" names a department in 30 states.
 */
export interface LegalGovernmentIdentity {
  entityType: LegalEntityType;
  /** 2-digit state FIPS. */
  stateFips: string;
  /** 5-digit national county FIPS (state+county), never the bare 3-digit code. */
  countyFips?: string | null;
  /** 7-digit place GEOID (state+place). */
  placeGeoid?: string | null;
  /** 10-digit county-subdivision GEOID (state+county+cousub). */
  mcdGeoid?: string | null;
  /** the government's name as the legal-geography source writes it — which is
   *  often NOT the common name ("Boise City city", "Lexington-Fayette urban
   *  county", "San Buenaventura (Ventura) city"). */
  canonicalName: string;
  // ── provenance (§20): how this was established, never a bare id ──────────
  matchMethod: IdentityMatchMethod;
  /** the dataset, so a stale binding is detectable when the source is reissued. */
  source: string;
  sourceVintage: string;
  sourceSha256: string;
}

/** The single stable key for a government. Mirrors ahjAuthority.identityKey. */
export function governmentKey(id: LegalGovernmentIdentity): string {
  if (id.placeGeoid) return `place:${id.placeGeoid}`;
  if (id.mcdGeoid) return `cousub:${id.mcdGeoid}`;
  if (id.countyFips) return `county:${id.countyFips}`;
  return `state:${id.stateFips}`;
}
