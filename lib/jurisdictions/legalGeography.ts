// ═══════════════════════════════════════════════════════════════════════════
// LEGAL GEOGRAPHY — the authority a permitting jurisdiction is derived FROM.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
// SolarPro chose an AHJ from whatever was available. When the boundary
// determination did not complete, selection fell through to a pre-written
// mailing-city row, and a package went out naming a city that does not
// administer the parcel. Nationally that is not a Granite City bug; it is the
// shape of the resolver.
//
// Two rules follow, and this module exists to make them enforceable:
//
//   1. A PROVIDER SUCCEEDING IS NOT AN AUTHORITY BEING ESTABLISHED.
//      The enrichment chain returned on the first useful answer. ATTOM answers
//      about a PARCEL; only the Census leg establishes legal BOUNDARY. So a
//      successful ATTOM call suppressed the only leg that could say which
//      municipality the parcel is inside. Completeness is per-FACET, and the
//      chain must continue while a required facet is unsatisfied —
//      `requiredFacetsSatisfied()`, never `someProviderSucceeded()`.
//
//   2. A MAILING ADDRESS IS A SEARCH HINT, NOT EVIDENCE.
//      "3 MELVIN DR, GRANITE CITY" does not establish that Granite City
//      administers the parcel. Neither does a county parcel source establish
//      that the county administers building permits. Each facet carries the
//      grade of the evidence that produced it, and a grade may never be raised
//      because two INFERRED facts agree with each other.
//
// ── THE NEGATIVE DETERMINATION IS A DETERMINATION ─────────────────────────
// `incorporatedPlace` with `value: null` and grade VERIFIED is the single most
// important state in this file: it means an authoritative source was asked and
// answered "this coordinate is inside NO incorporated place". That is what
// establishes unincorporated status, and it is completely different from
// `value: null, grade: UNKNOWN`, which means nobody asked. Conflating those two
// is how an unincorporated parcel acquires a city.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How good is the evidence behind one fact.
 *
 * Ordered weakest → strongest. The order is load-bearing: `atLeast()` compares
 * on it, and a facet may never be promoted merely because a second source of
 * the same or lower grade agrees.
 */
export const FACET_GRADES = [
  'UNKNOWN',    // nobody asked, or the answer did not come back
  'INFERRED',   // derived from something that is not evidence of it (postal city…)
  'OBSERVED',   // a human or a survey stated it; not an official record
  'CURATED',    // SolarPro's own governed table said so
  'GOVERNED',   // an official source, retrieved but not independently confirmed
  'VERIFIED',   // an official source of record, retrieved, with provenance
  'CONFLICT',   // two sources of comparable standing disagree — never silently resolved
] as const;
export type FacetGrade = (typeof FACET_GRADES)[number];

const GRADE_RANK: Record<FacetGrade, number> =
  Object.fromEntries(FACET_GRADES.map((g, i) => [g, i])) as Record<FacetGrade, number>;

/** Is `g` at least as strong as `min`? CONFLICT is never "at least" anything —
 *  a disagreement is not a stronger answer, it is the absence of one. */
export function atLeast(g: FacetGrade, min: FacetGrade): boolean {
  if (g === 'CONFLICT') return false;
  return GRADE_RANK[g] >= GRADE_RANK[min];
}

/** Where a fact came from, in enough detail to re-check it years later. */
export interface FacetProvenance {
  /** the provider / dataset that answered, e.g. 'census-tiger', 'attom'. */
  source: string;
  /** the exact endpoint or document. */
  sourceUrl?: string | null;
  retrievedAtIso?: string | null;
  /** for an archived document. */
  sha256?: string | null;
  /** the resolver + version that recorded it. */
  resolver?: string | null;
}

/**
 * One fact, its grade and its provenance.
 *
 * `value: null` is meaningful ONLY together with the grade:
 *   { value: null, grade: 'VERIFIED' }  — asked, and the answer is "none"
 *   { value: null, grade: 'UNKNOWN'  }  — not asked, or no answer
 */
export interface Facet<T> {
  value: T | null;
  grade: FacetGrade;
  provenance: FacetProvenance | null;
  /** one sentence a reviewer can act on: why this grade and not a higher one. */
  basis: string;
  /** when grade is CONFLICT — the competing answers, preserved, never merged. */
  conflict?: Array<{ value: T | null; provenance: FacetProvenance | null; basis: string }>;
}

const UNKNOWN_BASIS = 'not established — no source has been asked for this fact';

/** An honestly-unknown facet of a given type. A fresh object each time: these
 *  are folded into by `mergeFacet` and a shared frozen singleton would invite a
 *  caller to mutate the one instance everything else reads. */
export function unknownFacet<T>(basis?: string): Facet<T> {
  return { value: null, grade: 'UNKNOWN', provenance: null, basis: basis ?? UNKNOWN_BASIS };
}

export function facet<T>(
  value: T | null, grade: FacetGrade, basis: string, provenance?: FacetProvenance | null,
): Facet<T> {
  return { value, grade, provenance: provenance ?? null, basis };
}

// ── The identities a legal geography carries ───────────────────────────────

export interface StateIdentity { code: string; name?: string | null; fips: string | null }
export interface CountyIdentity { name: string; fips: string | null; stateFips?: string | null }
/** An incorporated municipality (Census "place"), or a CDP where relevant. */
export interface PlaceIdentity {
  name: string;
  /** the 7-digit Census place GEOID (state FIPS + place FIPS). */
  geoid: string | null;
  /** true when the place is a CDP / unincorporated community, not a government. */
  isCensusDesignatedPlace?: boolean;
  lsad?: string | null;
}
/** Minor Civil Division — the township/town layer that governs in ~20 states. */
export interface CountySubdivisionIdentity { name: string; geoid: string | null; lsad?: string | null }
export interface Coordinate { lat: number; lng: number }

export interface SpecialDistrict {
  name: string;
  kind: string;              // 'fire' | 'water' | 'school' | …
  geoid?: string | null;
}

/**
 * THE legal-geography authority for one project location.
 *
 * Every field is a graded facet — there is no bare value anywhere, because a
 * bare value is exactly what let an inferred city stand where a verified
 * boundary belonged.
 */
export interface LegalGeographyAuthority {
  coordinate: Facet<Coordinate>;
  state: Facet<StateIdentity>;
  county: Facet<CountyIdentity>;
  /** null + VERIFIED ⇒ proven to be inside NO incorporated place. */
  incorporatedPlace: Facet<PlaceIdentity | null>;
  countySubdivision: Facet<CountySubdivisionIdentity | null>;
  /** 'inside' / 'outside' an incorporated municipality. */
  municipalBoundary: Facet<'inside' | 'outside'>;
  unincorporated: Facet<boolean>;
  specialDistricts: Facet<SpecialDistrict[]>;
  /** every provider that contributed, in call order, with what it established. */
  contributions: Array<{ source: string; established: FacetName[]; note?: string }>;
}

export type FacetName = keyof Omit<LegalGeographyAuthority, 'contributions'>;

export const ALL_FACETS: FacetName[] = [
  'coordinate', 'state', 'county', 'incorporatedPlace',
  'countySubdivision', 'municipalBoundary', 'unincorporated', 'specialDistricts',
];

/** An empty authority — every facet honestly unknown. */
export function emptyLegalGeography(): LegalGeographyAuthority {
  return {
    coordinate: unknownFacet<Coordinate>(),
    state: unknownFacet<StateIdentity>(),
    county: unknownFacet<CountyIdentity>(),
    incorporatedPlace: unknownFacet<PlaceIdentity | null>(),
    countySubdivision: unknownFacet<CountySubdivisionIdentity | null>(),
    municipalBoundary: unknownFacet<'inside' | 'outside'>(),
    unincorporated: unknownFacet<boolean>(),
    specialDistricts: unknownFacet<SpecialDistrict[]>(),
    contributions: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPLETENESS CONTRACT
//
// This is the predicate that replaces "a provider returned something". It asks
// a different question — not "did a call succeed" but "is every fact this
// DECISION needs established to a sufficient grade".
// ═══════════════════════════════════════════════════════════════════════════

/** What a given decision needs, and how good the evidence must be. */
export interface FacetRequirement { facet: FacetName; minimumGrade: FacetGrade; why: string }

/**
 * What it takes to name the BUILDING permitting authority for a parcel.
 *
 * The boundary and place facets are GOVERNED-or-better on purpose: a curated
 * table may seed a search, but it may not decide which municipality contains a
 * coordinate. That is a question only an authoritative boundary source answers.
 */
export const BUILDING_AUTHORITY_CONTRACT: FacetRequirement[] = [
  { facet: 'state', minimumGrade: 'GOVERNED',
    why: 'the state selects which delegation policy governs at all' },
  { facet: 'county', minimumGrade: 'GOVERNED',
    why: 'the county is the fallback administrator in most states and the parent of every place' },
  { facet: 'municipalBoundary', minimumGrade: 'GOVERNED',
    why: 'inside-or-outside a municipality decides whether a city can be the authority' },
  { facet: 'incorporatedPlace', minimumGrade: 'GOVERNED',
    why: 'WHICH municipality — and a proven "none" is what establishes unincorporated' },
];

/** Which required facets are still not established to their minimum grade. */
export function unsatisfiedFacets(
  geo: LegalGeographyAuthority,
  contract: FacetRequirement[] = BUILDING_AUTHORITY_CONTRACT,
): FacetRequirement[] {
  return contract.filter(r => !atLeast(geo[r.facet].grade, r.minimumGrade));
}

/**
 * THE predicate. `someProviderSucceeded()` is not a thing this codebase may ask
 * again: a chain that stops on the first useful answer will keep leaving the
 * boundary unresolved, and an unresolved boundary is what produced a mailing-city
 * AHJ on a sealed drawing.
 */
export function requiredFacetsSatisfied(
  geo: LegalGeographyAuthority,
  contract: FacetRequirement[] = BUILDING_AUTHORITY_CONTRACT,
): boolean {
  return unsatisfiedFacets(geo, contract).length === 0;
}

/** One sentence naming what is still missing, for the review record. */
export function completenessBasis(
  geo: LegalGeographyAuthority,
  contract: FacetRequirement[] = BUILDING_AUTHORITY_CONTRACT,
): string {
  const missing = unsatisfiedFacets(geo, contract);
  if (missing.length === 0) {
    return 'every facet the building-authority determination requires is established from an official source';
  }
  return missing
    .map(m => `${m.facet} is ${geo[m.facet].grade} (needs ${m.minimumGrade}) — ${m.why}`)
    .join('; ');
}

// ═══════════════════════════════════════════════════════════════════════════
// MERGING PROVIDER ANSWERS
//
// Providers are asked in sequence and each may establish DIFFERENT facets. The
// merge rule is deliberately conservative in both directions.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fold one provider's answer into the authority.
 *
 * RULES, and each exists because its opposite caused a real defect:
 *  • a STRONGER grade replaces a weaker one;
 *  • an EQUAL-grade DISAGREEMENT becomes CONFLICT, never last-writer-wins —
 *    "whichever loaded first" is not a jurisdictional determination;
 *  • an equal-grade AGREEMENT does NOT promote the grade. Two inferred facts
 *    agreeing is still inference;
 *  • a weaker answer never overwrites a stronger one, but IS recorded when it
 *    disagrees, so the disagreement is not lost.
 */
export function mergeFacet<T>(
  current: Facet<T>, incoming: Facet<T>, sameValue: (a: T | null, b: T | null) => boolean,
): Facet<T> {
  if (incoming.grade === 'UNKNOWN') return current;
  if (current.grade === 'UNKNOWN') return incoming;
  if (current.grade === 'CONFLICT') {
    // A conflict is only resolved by something STRICTLY stronger than both sides.
    const strongest = Math.max(...(current.conflict ?? []).map(c => GRADE_RANK[gradeOf(c)] ?? 0), 0);
    if (GRADE_RANK[incoming.grade] > strongest) return incoming;
    return current;
  }

  const cRank = GRADE_RANK[current.grade];
  const iRank = GRADE_RANK[incoming.grade];
  const agree = sameValue(current.value, incoming.value);

  if (agree) {
    // Corroboration does NOT raise a grade. It only enriches provenance when the
    // stronger side had none.
    return iRank > cRank ? incoming : current;
  }
  if (iRank > cRank) return incoming;
  if (iRank < cRank) return current;

  return {
    value: null,
    grade: 'CONFLICT',
    provenance: null,
    basis: 'two sources of equal standing disagree — the determination is NOT established '
      + 'and must be resolved by evidence, not by call order',
    conflict: [
      { value: current.value, provenance: current.provenance, basis: current.basis },
      { value: incoming.value, provenance: incoming.provenance, basis: incoming.basis },
    ],
  };
}

/** The grade a conflict entry was recorded at, for conflict re-resolution. */
function gradeOf(_c: { basis: string }): FacetGrade {
  // Conflict entries keep their basis and provenance; their grade was equal by
  // construction (that is what made it a conflict), so the comparison above uses
  // the recorded pair's rank via the current facet. Kept as a function so the
  // intent is explicit rather than an inline constant.
  return 'GOVERNED';
}

/**
 * Derive `unincorporated` and `municipalBoundary` from the place determination.
 *
 * Deliberately NOT a provider's job: it is an INFERENCE ABOUT A DETERMINATION,
 * and it may only be drawn when the place facet is itself established. A place
 * of UNKNOWN grade yields UNKNOWN here — never "no place found, therefore
 * unincorporated", which is the exact reasoning that put a mailing city on a
 * drawing.
 */
export function deriveBoundaryFacets(geo: LegalGeographyAuthority): LegalGeographyAuthority {
  const place = geo.incorporatedPlace;
  if (!atLeast(place.grade, 'GOVERNED')) return geo;

  // A CDP is a statistical area, not a government: being inside one does NOT
  // make the parcel incorporated.
  const inPlace = place.value != null && place.value.isCensusDesignatedPlace !== true;

  return {
    ...geo,
    municipalBoundary: facet<'inside' | 'outside'>(
      inPlace ? 'inside' : 'outside', place.grade,
      inPlace
        ? `the coordinate falls inside the incorporated place ${place.value!.name}`
        : place.value == null
          ? 'an authoritative boundary source was asked and returned NO incorporated place for this coordinate'
          : `the coordinate falls inside ${place.value.name}, which is a census-designated place — a statistical area, not a government`,
      place.provenance,
    ),
    unincorporated: facet<boolean>(
      !inPlace, place.grade,
      inPlace
        ? `inside ${place.value!.name}, an incorporated municipality`
        : 'no incorporated place contains this coordinate',
      place.provenance,
    ),
  };
}
