// ═══════════════════════════════════════════════════════════════════════════
// WHO ADMINISTERS WHICH PERMIT, AND ON WHAT AUTHORITY.
//
// There is no national rule that "the municipality wins" or "the county wins".
// Both are true somewhere:
//
//   • an incorporated city with its own building department administers its own
//     permits — the ordinary case;
//   • unincorporated territory is administered by the county — also ordinary;
//   • some municipalities contract their building department BACK to the county,
//     so the parcel is inside the city and the county issues the permit;
//   • in the ~20 MCD states a township is a real government with real authority;
//   • a consolidated city-county is one government wearing both hats;
//   • electrical inspection is a separate authority in several states;
//   • fire review is almost always a separate authority (a fire district), and
//     it is NOT the building AHJ even when the building AHJ is a city.
//
// None of that can live as `if (state === 'IL')` branches scattered through the
// resolver. It is DATA — a rule with a territory, a scope, a delegator, a
// delegate, a source and an effective date — and it is graded like any other
// evidence.
//
// ── THE DEFAULT IS NOT A RULE ─────────────────────────────────────────────
// The baseline below (incorporated ⇒ the place; unincorporated ⇒ the county) is
// the general structure of American building administration, and it is graded
// CURATED, never VERIFIED. It decides which government to LOOK FOR. It never,
// by itself, promotes an authority to verified, and it never overrides a
// jurisdiction-specific rule carrying real evidence.
// ═══════════════════════════════════════════════════════════════════════════

import type { FacetGrade, FacetProvenance } from './legalGeography';

/** The permit scopes a project can need, each of which may have its own AHJ. */
export const AUTHORITY_SCOPES = ['building', 'electrical', 'fire', 'structural', 'zoning'] as const;
export type AuthorityScope = (typeof AUTHORITY_SCOPES)[number];

/** The kind of government a rule points at. */
export type AuthorityEntityType =
  | 'place'              // incorporated municipality
  | 'county'
  | 'county-subdivision' // township / MCD
  | 'state'
  | 'special-district'   // fire district, electrical inspection district
  | 'consolidated';      // city-county

/** Which territory a rule applies to. */
export type TerritoryType =
  | 'incorporated'       // inside any incorporated place in the state
  | 'unincorporated'     // outside every incorporated place
  | 'specific-place'     // one named place (by GEOID)
  | 'specific-county'    // one named county (by FIPS)
  | 'statewide';

export interface JurisdictionDelegationRule {
  /** stable id, so a rule can be cited by the authority record it produced. */
  id: string;
  /** two-letter state code, or '*' for a rule that is genuinely national. */
  state: string;
  scope: AuthorityScope;
  territory: {
    type: TerritoryType;
    /** for specific-place / specific-county. */
    geoid?: string | null;
    countyFips?: string | null;
  };
  /** the government that WOULD hold the authority by default. */
  delegator: AuthorityEntityType;
  /** the government that ACTUALLY administers it under this rule. */
  delegate: AuthorityEntityType;
  /** free-text conditions a human must read when the rule is cited. */
  conditions?: string | null;
  /** how good the evidence for this rule is. A baseline structural default is
   *  CURATED; a rule read off a published intergovernmental agreement is
   *  GOVERNED or VERIFIED. */
  grade: FacetGrade;
  provenance: FacetProvenance | null;
  effectiveDate?: string | null;
  supersededBy?: string | null;
}

/**
 * THE BASELINE. Deliberately tiny, deliberately CURATED, deliberately national.
 *
 * These encode the STRUCTURE of American permit administration, not any
 * particular jurisdiction's choice. Every one of them can be overridden by a
 * specific rule with better evidence — that is the entire point of the layer.
 */
export const BASELINE_DELEGATION_RULES: JurisdictionDelegationRule[] = [
  {
    id: 'baseline:incorporated-place-administers-building',
    state: '*', scope: 'building',
    territory: { type: 'incorporated' },
    delegator: 'place', delegate: 'place',
    conditions: 'An incorporated municipality ordinarily administers building permits within its own '
      + 'corporate limits. This is the structural default, not a determination about any particular '
      + 'municipality — a place that contracts its building department to the county is covered by a '
      + 'specific rule, and a place with NO building department at all must be discovered, not assumed.',
    grade: 'CURATED', provenance: null,
  },
  {
    id: 'baseline:county-administers-unincorporated-building',
    state: '*', scope: 'building',
    territory: { type: 'unincorporated' },
    delegator: 'county', delegate: 'county',
    conditions: 'Territory outside every incorporated place is ordinarily administered by the county. '
      + 'In MCD states a township may hold this authority instead; that is a state-specific rule.',
    grade: 'CURATED', provenance: null,
  },
  // ELECTRICAL RIDES WITH THE BUILDING AUTHORITY — AND SO MUST ITS TERRITORY.
  //
  // This was ONE statewide rule with `delegate: 'place'`. On unincorporated
  // territory there is no place, so the delegate resolved to nothing and every
  // unincorporated parcel in the country reported the electrical scope
  // UNRESOLVED — while the building scope resolved fine to the county from the
  // pair below. "Follows the building authority" has to follow it into
  // unincorporated territory too, so it is a matching PAIR, not one statewide
  // rule.
  {
    id: 'baseline:electrical-follows-building-incorporated',
    state: '*', scope: 'electrical',
    territory: { type: 'incorporated' },
    delegator: 'place', delegate: 'place',
    conditions: 'Electrical inspection ordinarily rides with the building authority. Several states '
      + 'administer it separately (a state electrical division or an independent inspection agency); '
      + 'those are specific rules and must carry evidence.',
    grade: 'CURATED', provenance: null,
  },
  {
    id: 'baseline:electrical-follows-building-unincorporated',
    state: '*', scope: 'electrical',
    territory: { type: 'unincorporated' },
    delegator: 'county', delegate: 'county',
    conditions: 'Outside every incorporated place the county administers electrical inspection with '
      + 'the building permit, unless a state electrical division or an independent inspection agency '
      + 'holds it — which is a specific rule and must carry evidence.',
    grade: 'CURATED', provenance: null,
  },
  // ZONING — the scope was in the resolver's default list with NO rule to match,
  // so it reported UNRESOLVED on every project nationally. Zoning is ordinarily
  // administered by the same general-purpose government as building, which is
  // the structural default worth stating; a jurisdiction that splits it (a
  // separate planning commission, a county overlay inside a city) is a specific
  // rule with evidence.
  {
    id: 'baseline:zoning-follows-the-general-purpose-government-incorporated',
    state: '*', scope: 'zoning',
    territory: { type: 'incorporated' },
    delegator: 'place', delegate: 'place',
    conditions: 'An incorporated municipality ordinarily administers its own zoning within its '
      + 'corporate limits. Overlay districts and county-administered zoning inside a municipality '
      + 'exist and are specific rules.',
    grade: 'CURATED', provenance: null,
  },
  {
    id: 'baseline:zoning-follows-the-general-purpose-government-unincorporated',
    state: '*', scope: 'zoning',
    territory: { type: 'unincorporated' },
    delegator: 'county', delegate: 'county',
    conditions: 'Territory outside every incorporated place is ordinarily zoned by the county. Some '
      + 'states have no county zoning at all, which is a specific rule.',
    grade: 'CURATED', provenance: null,
  },
  // ── WHERE THE COUNTY IS NOT A GOVERNMENT ────────────────────────────────
  // The baseline "county administers unincorporated territory" rule assumes the
  // county EXISTS as a government. In New England it frequently does not:
  //
  //   Connecticut    0 of 8 counties are governments   169 active towns
  //   Rhode Island   0 of 5                             31 active towns
  //   Massachusetts  5 of 14                           293 active towns
  //
  // (Counted from the Census county file by FUNCSTAT: CT and RI county rows are
  // all 'N', nonfunctioning. CT and RI abolished county government outright.)
  //
  // So a parcel outside an incorporated place in CT or RI has no county to fall
  // back to, and the town — a county SUBDIVISION in Census terms — is the
  // general-purpose government and the building authority. Without these rules
  // the resolver names a county building department that does not exist, which
  // is the registry defect these same states already exhibit: 22 rows assert
  // exactly such a department.
  //
  // Graded GOVERNED, not CURATED: it is read off authoritative federal data
  // about which entities function as governments, not inferred from practice.
  ...(['CT', 'RI', 'MA'] as const).map(state => ({
    id: `ne:${state.toLowerCase()}-town-administers-outside-a-municipality`,
    state,
    scope: 'building' as AuthorityScope,
    territory: { type: 'unincorporated' as TerritoryType },
    delegator: 'county' as AuthorityEntityType,
    delegate: 'county-subdivision' as AuthorityEntityType,
    conditions: `${state} county government is nonfunctioning or absent (US Census FUNCSTAT), so the `
      + 'TOWN (county subdivision) is the general-purpose government and the building authority for '
      + 'territory outside an incorporated place. A county building department here would name a body '
      + 'that does not exist.',
    grade: 'GOVERNED' as FacetGrade,
    provenance: {
      source: 'US Census Bureau national geographic reference codes (codes2020), county FUNCSTAT',
      sourceUrl: 'https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt',
    },
  })),
  {
    id: 'baseline:fire-is-a-separate-authority',
    state: '*', scope: 'fire',
    territory: { type: 'statewide' },
    delegator: 'place', delegate: 'special-district',
    conditions: 'Fire review is commonly held by a fire protection district whose boundaries do NOT '
      + 'follow municipal limits. Absent an identified district this scope is UNRESOLVED — it must not '
      + 'silently inherit the building authority, because a fire district is a different government.',
    grade: 'CURATED', provenance: null,
  },
];

/** A rule store. Baseline rules plus any governed rules loaded from the registry. */
export interface DelegationPolicy {
  rules: JurisdictionDelegationRule[];
}

export function baselinePolicy(extra: JurisdictionDelegationRule[] = []): DelegationPolicy {
  return { rules: [...BASELINE_DELEGATION_RULES, ...extra] };
}

export interface DelegationQuery {
  state: string;
  scope: AuthorityScope;
  incorporated: boolean;
  placeGeoid?: string | null;
  countyFips?: string | null;
}

/** How specific a rule is — a more specific rule beats a more general one, and
 *  at equal specificity a better-graded rule wins. Ties are a CONFLICT the
 *  caller must surface, never a silent pick. */
function specificity(r: JurisdictionDelegationRule): number {
  let n = 0;
  if (r.state !== '*') n += 4;
  if (r.territory.type === 'specific-place') n += 8;
  else if (r.territory.type === 'specific-county') n += 6;
  else if (r.territory.type !== 'statewide') n += 2;
  return n;
}

const GRADE_ORDER: FacetGrade[] = ['UNKNOWN', 'INFERRED', 'OBSERVED', 'CURATED', 'GOVERNED', 'VERIFIED', 'CONFLICT'];
const rank = (g: FacetGrade): number => GRADE_ORDER.indexOf(g);

export interface DelegationMatch {
  rule: JurisdictionDelegationRule;
  /** every rule that applied, strongest first — kept so a reviewer sees what
   *  else was in play rather than only the winner. */
  considered: JurisdictionDelegationRule[];
  /** true when two equally-specific, equally-graded rules disagreed. */
  ambiguous: boolean;
}

/** Which rule governs this query. Returns null when NOTHING applies — which is a
 *  real answer meaning "SolarPro has no policy for this", not "use the county". */
export function resolveDelegation(
  policy: DelegationPolicy, q: DelegationQuery,
): DelegationMatch | null {
  const applies = policy.rules.filter(r => {
    if (r.supersededBy) return false;
    if (r.scope !== q.scope) return false;
    if (r.state !== '*' && r.state.toUpperCase() !== q.state.toUpperCase()) return false;
    switch (r.territory.type) {
      case 'statewide': return true;
      case 'incorporated': return q.incorporated;
      case 'unincorporated': return !q.incorporated;
      case 'specific-place':
        return !!q.placeGeoid && r.territory.geoid === q.placeGeoid;
      case 'specific-county':
        return !!q.countyFips && r.territory.countyFips === q.countyFips;
      default: return false;
    }
  });
  if (applies.length === 0) return null;

  const sorted = [...applies].sort((a, b) => {
    const s = specificity(b) - specificity(a);
    if (s !== 0) return s;
    return rank(b.grade) - rank(a.grade);
  });
  const top = sorted[0];
  const ambiguous = sorted.length > 1
    && specificity(sorted[1]) === specificity(top)
    && rank(sorted[1].grade) === rank(top.grade)
    && sorted[1].delegate !== top.delegate;

  return { rule: top, considered: sorted, ambiguous };
}
