// ═══════════════════════════════════════════════════════════════════════════
// THE NATIONAL AHJ RESOLVER — geography decides, the registry only caches.
//
// The defect this replaces: when the municipal-boundary determination did not
// complete, AHJ selection fell through to a pre-written mailing-city row. A
// package went out naming a government that does not administer the parcel.
//
// These cases are written so that NO Granite City / Madison County / Illinois
// answer can satisfy them. Every fixture below is synthetic geography with
// invented FIPS codes; the resolver has to reach the right answer structurally.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  emptyLegalGeography, facet, unknownFacet, requiredFacetsSatisfied, unsatisfiedFacets,
  deriveBoundaryFacets, mergeFacet, atLeast, completenessBasis,
  type LegalGeographyAuthority, type PlaceIdentity,
} from '@/lib/jurisdictions/legalGeography';
import {
  baselinePolicy, resolveDelegation, type JurisdictionDelegationRule,
} from '@/lib/jurisdictions/delegationPolicy';
import {
  resolveScopeAuthority, resolveProjectAhjAuthority, identityKey,
  NO_SUBSTITUTION_INVARIANTS, type AhjRegistryLookup, type GoverningEntity,
} from '@/lib/jurisdictions/ahjAuthority';

const PROV = { source: 'census-tiger', sourceUrl: 'https://example.invalid/geographies', retrievedAtIso: '2026-08-29T00:00:00Z' };

/** Synthetic geography. `place: null` + VERIFIED means proven unincorporated. */
function geography(opts: {
  place?: PlaceIdentity | null;
  placeGrade?: 'GOVERNED' | 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
  county?: { name: string; fips: string };
  state?: { code: string; fips: string; name?: string };
}): LegalGeographyAuthority {
  const g = emptyLegalGeography();
  const st = opts.state ?? { code: 'ZZ', fips: '99', name: 'Teststate' };
  const co = opts.county ?? { name: 'Testcounty', fips: '99001' };
  const withBase: LegalGeographyAuthority = {
    ...g,
    coordinate: facet({ lat: 1, lng: 2 }, 'VERIFIED', 'geocoded', PROV),
    state: facet(st, 'VERIFIED', 'from the boundary source', PROV),
    county: facet(co, 'VERIFIED', 'from the boundary source', PROV),
    incorporatedPlace: opts.placeGrade === 'UNKNOWN'
      ? unknownFacet<PlaceIdentity | null>()
      : facet(opts.place ?? null, opts.placeGrade ?? 'VERIFIED',
          opts.place ? `inside ${opts.place.name}` : 'no incorporated place contains this coordinate', PROV),
  };
  return deriveBoundaryFacets(withBase);
}

/** A registry that knows only the identities it is given. */
function registryWith(...keys: string[]): AhjRegistryLookup {
  const known = new Set(keys);
  return {
    byIdentity(e: GoverningEntity) {
      const k = identityKey(e);
      return known.has(k) ? { id: `row:${k}`, name: `${e.name} (registry row)`, hasOfficialProvenance: false } : null;
    },
  };
}
const EMPTY_REGISTRY: AhjRegistryLookup = { byIdentity: () => null };

const CITY: PlaceIdentity = { name: 'Testville', geoid: '9912345' };
const CDP: PlaceIdentity = { name: 'Testview', geoid: '9954321', isCensusDesignatedPlace: true };

// ── 1. COMPLETENESS: A PROVIDER SUCCEEDING IS NOT AN AUTHORITY ────────────
describe('provider success is not authority completeness', () => {
  it('a parcel/property answer alone does NOT satisfy the contract', () => {
    // The ATTOM shape: state + county known from a parcel record, boundary not asked.
    const g = { ...emptyLegalGeography(),
      coordinate: facet({ lat: 1, lng: 2 }, 'VERIFIED', 'parcel centroid', { source: 'attom' }),
      state: facet({ code: 'ZZ', fips: '99' }, 'GOVERNED', 'parcel record', { source: 'attom' }),
      county: facet({ name: 'Testcounty', fips: '99001' }, 'GOVERNED', 'parcel record', { source: 'attom' }),
    };
    expect(requiredFacetsSatisfied(g)).toBe(false);
    const missing = unsatisfiedFacets(g).map(m => m.facet);
    expect(missing).toContain('municipalBoundary');
    expect(missing).toContain('incorporatedPlace');
    expect(completenessBasis(g)).toMatch(/municipalBoundary is UNKNOWN/);
  });

  it('...and the boundary leg completes it', () => {
    expect(requiredFacetsSatisfied(geography({ place: CITY }))).toBe(true);
  });

  it('a PROVEN "no incorporated place" also completes it', () => {
    // The negative determination is a determination.
    const g = geography({ place: null });
    expect(requiredFacetsSatisfied(g)).toBe(true);
    expect(g.unincorporated.value).toBe(true);
    expect(g.municipalBoundary.value).toBe('outside');
  });

  it('but an UNASKED place does not — null-unknown is not null-verified', () => {
    const g = geography({ placeGrade: 'UNKNOWN' });
    expect(requiredFacetsSatisfied(g)).toBe(false);
    expect(g.unincorporated.grade).toBe('UNKNOWN');
  });

  it('an INFERRED place (mailing city) never satisfies the contract', () => {
    const g = geography({ place: CITY, placeGrade: 'INFERRED' });
    expect(requiredFacetsSatisfied(g)).toBe(false);
  });
});

// ── 2. GRADING: AGREEMENT IS NOT PROMOTION ────────────────────────────────
describe('fail-closed grading', () => {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  it('two inferred sources agreeing stay inferred', () => {
    const a = facet({ name: 'X', geoid: '1' }, 'INFERRED', 'mailing city', { source: 'postal' });
    const b = facet({ name: 'X', geoid: '1' }, 'INFERRED', 'zip city', { source: 'zip' });
    expect(mergeFacet(a, b, same).grade).toBe('INFERRED');
  });

  it('equal-grade disagreement becomes CONFLICT, not last-writer-wins', () => {
    const a = facet({ name: 'X', geoid: '1' }, 'GOVERNED', 'source A', { source: 'a' });
    const b = facet({ name: 'Y', geoid: '2' }, 'GOVERNED', 'source B', { source: 'b' });
    const m = mergeFacet(a, b, same);
    expect(m.grade).toBe('CONFLICT');
    expect(m.value).toBeNull();
    expect(m.conflict).toHaveLength(2);
  });

  it('CONFLICT is never "at least" any grade', () => {
    expect(atLeast('CONFLICT', 'INFERRED')).toBe(false);
    expect(atLeast('CONFLICT', 'GOVERNED')).toBe(false);
  });

  it('a stronger source overrides a weaker one', () => {
    const weak = facet({ name: 'Mailing', geoid: null }, 'INFERRED', 'postal', { source: 'postal' });
    const strong = facet({ name: 'Real', geoid: '9912345' }, 'VERIFIED', 'boundary', PROV);
    expect(mergeFacet(weak, strong, same).value).toEqual({ name: 'Real', geoid: '9912345' });
  });

  it('a CDP is a statistical area, not a government', () => {
    const g = geography({ place: CDP });
    expect(g.municipalBoundary.value).toBe('outside');
    expect(g.unincorporated.value).toBe(true);
    expect(g.municipalBoundary.basis).toMatch(/census-designated place/);
  });
});

// ── 3. THE NO-SUBSTITUTION RULE ───────────────────────────────────────────
describe('registry absence is never authority substitution', () => {
  it('inside a city with NO registry row ⇒ MISSING, never the county', () => {
    const g = geography({ place: CITY });
    // the county row EXISTS and is still not chosen
    const reg = registryWith('county:99001');
    const a = resolveScopeAuthority('building', g, baselinePolicy(), reg);

    expect(a.status).toBe('BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING');
    expect(a.entity!.type).toBe('place');
    expect(a.entity!.placeGeoid).toBe('9912345');
    expect(a.ahjRecordId, 'a missing record must carry NO row').toBeNull();
    expect(a.basis).toMatch(/No other jurisdiction may be substituted/);
    expect(NO_SUBSTITUTION_INVARIANTS.missingRecordHasNoRow(a)).toBe(true);
  });

  it('unincorporated with no county row ⇒ MISSING, never the mailing city', () => {
    const g = geography({ place: null });
    // a plausible city row exists — it must not be reachable
    const reg = registryWith('place:9912345');
    const a = resolveScopeAuthority('building', g, baselinePolicy(), reg);
    expect(a.status).toBe('BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING');
    expect(a.entity!.type).toBe('county');
    expect(a.ahjRecordId).toBeNull();
  });

  it('an unresolved boundary resolves to NOTHING, not to a default', () => {
    const g = geography({ placeGrade: 'UNKNOWN' });
    const reg = registryWith('county:99001', 'place:9912345');
    const a = resolveScopeAuthority('building', g, baselinePolicy(), reg);
    expect(a.status).toBe('BOUNDARY_UNRESOLVED');
    expect(a.entity).toBeNull();
    expect(a.ahjRecordId).toBeNull();
  });

  it('the entity always matches what the delegation rule delegated to', () => {
    for (const g of [geography({ place: CITY }), geography({ place: null })]) {
      const a = resolveScopeAuthority('building', g, baselinePolicy(), EMPTY_REGISTRY);
      expect(NO_SUBSTITUTION_INVARIANTS.entityMatchesDelegation(a)).toBe(true);
    }
  });

  it('a matched row is graded no better than the evidence that located it', () => {
    const g = geography({ place: CITY, placeGrade: 'GOVERNED' });
    const a = resolveScopeAuthority('building', g, baselinePolicy(), registryWith('place:9912345'));
    expect(a.status).toBe('AHJ_RECORD_FOUND');
    // the baseline delegation rule is CURATED, so the authority cannot be better
    expect(a.grade).toBe('CURATED');
  });
});

// ── 4. DELEGATION ─────────────────────────────────────────────────────────
describe('state delegation decides, not a hardcoded preference', () => {
  const CITY_DELEGATES_TO_COUNTY: JurisdictionDelegationRule = {
    id: 'test:city-contracts-building-to-county',
    state: 'ZZ', scope: 'building',
    territory: { type: 'specific-place', geoid: '9912345' },
    delegator: 'place', delegate: 'county',
    conditions: 'intergovernmental agreement',
    grade: 'GOVERNED',
    provenance: { source: 'municipal-ordinance', sourceUrl: 'https://example.invalid/iga' },
  };

  it('a specific delegation beats the incorporated baseline', () => {
    const g = geography({ place: CITY });
    const policy = baselinePolicy([CITY_DELEGATES_TO_COUNTY]);
    const a = resolveScopeAuthority('building', g, policy, registryWith('county:99001'));
    // inside the city, and the COUNTY is correct here — because evidence says so
    expect(a.entity!.type).toBe('county');
    expect(a.delegationRuleId).toBe('test:city-contracts-building-to-county');
    expect(a.status).toBe('AHJ_RECORD_FOUND');
  });

  it('...and that same county is NOT reachable without the rule', () => {
    const g = geography({ place: CITY });
    const a = resolveScopeAuthority('building', g, baselinePolicy(), registryWith('county:99001'));
    expect(a.entity!.type).toBe('place');
    expect(a.status).toBe('BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING');
  });

  it('two equally-specific rules disagreeing is a CONFLICT, not a pick', () => {
    const other: JurisdictionDelegationRule = { ...CITY_DELEGATES_TO_COUNTY,
      id: 'test:other', delegate: 'state' };
    const a = resolveScopeAuthority('building', geography({ place: CITY }),
      baselinePolicy([CITY_DELEGATES_TO_COUNTY, other]), EMPTY_REGISTRY);
    expect(a.status).toBe('AUTHORITY_CONFLICT');
    expect(a.entity).toBeNull();
  });

  it('no rule at all ⇒ scope unresolved, never a guess', () => {
    const a = resolveScopeAuthority('structural', geography({ place: CITY }),
      { rules: [] }, registryWith('place:9912345', 'county:99001'));
    expect(a.status).toBe('AUTHORITY_SCOPE_UNRESOLVED');
    expect(a.ahjRecordId).toBeNull();
  });

  it('fire is a separate authority and does not inherit the building AHJ', () => {
    const g = geography({ place: CITY });
    const p = resolveProjectAhjAuthority(g, baselinePolicy(), registryWith('place:9912345'));
    expect(p.scopes.building.status).toBe('AHJ_RECORD_FOUND');
    // the baseline fire rule delegates to a special district we cannot name
    expect(p.scopes.fire.status).toBe('AUTHORITY_SCOPE_UNRESOLVED');
    expect(p.scopes.fire.ahjRecordId).toBeNull();
  });
});

// ── 5. IDENTITY IS NOT A NAME ─────────────────────────────────────────────
describe('stable identity, not display names', () => {
  it('identity keys off GEOID/FIPS before any name', () => {
    expect(identityKey({ type: 'place', name: 'Springfield', stateFips: '17', countyFips: '17167', placeGeoid: '1772000', countySubdivisionGeoid: null }))
      .toBe('place:1772000');
    expect(identityKey({ type: 'county', name: 'Springfield', stateFips: '17', countyFips: '17167', placeGeoid: null, countySubdivisionGeoid: null }))
      .toBe('county:17167');
  });

  it('same-named governments in different states are different identities', () => {
    const a: GoverningEntity = { type: 'place', name: 'Springfield', stateFips: '17', countyFips: null, placeGeoid: '1772000', countySubdivisionGeoid: null };
    const b: GoverningEntity = { type: 'place', name: 'Springfield', stateFips: '29', countyFips: null, placeGeoid: '2970000', countySubdivisionGeoid: null };
    expect(identityKey(a)).not.toBe(identityKey(b));
  });

  it('a same-named city and county are different identities', () => {
    const city: GoverningEntity = { type: 'place', name: 'Denver', stateFips: '08', countyFips: '08031', placeGeoid: '0820000', countySubdivisionGeoid: null };
    const county: GoverningEntity = { type: 'county', name: 'Denver', stateFips: '08', countyFips: '08031', placeGeoid: null, countySubdivisionGeoid: null };
    expect(identityKey(city)).not.toBe(identityKey(county));
    // and a registry holding only the county cannot answer for the city
    const reg = registryWith(identityKey(county));
    expect(reg.byIdentity(city)).toBeNull();
    expect(reg.byIdentity(county)).not.toBeNull();
  });
});

// ── 6. THE PROJECT-LEVEL RESULT ───────────────────────────────────────────
describe('the project authority collects what must be discovered', () => {
  it('missing records are enumerated once, by identity', () => {
    const p = resolveProjectAhjAuthority(geography({ place: CITY }), baselinePolicy(), EMPTY_REGISTRY);
    // Renamed from `complete`: the flag is NOT a release gate. It is
    // structurally unreachable while the fire scope has no boundary provider,
    // so gating on it would block every package nationally.
    expect(p.allScopesResolved).toBe(false);
    const keys = p.missingRecords.map(identityKey);
    expect(keys).toContain('place:9912345');
    expect(new Set(keys).size, 'deduplicated by identity').toBe(keys.length);
  });

  it('the geography travels with the result so no consumer re-derives it', () => {
    const g = geography({ place: CITY });
    const p = resolveProjectAhjAuthority(g, baselinePolicy(), EMPTY_REGISTRY);
    expect(p.legalGeography).toBe(g);
    expect(p.legalGeography.incorporatedPlace.provenance?.source).toBe('census-tiger');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. DEFECTS FOUND IN THESE MODULES BY A HOSTILE REVIEW OF THEM.
//
// Each of the four below was a real bug in the code above, not in its callers.
// They are grouped here because the lesson is shared: an authority module is
// not correct because it is well-commented, and these were all invisible while
// the modules had no production consumer.
// ═══════════════════════════════════════════════════════════════════════════

describe('a CONFLICT is resolved by evidence, never by call order', () => {
  const same = (a: string | null, b: string | null) => a === b;
  const F = (v: string, g: 'CURATED' | 'GOVERNED' | 'VERIFIED') =>
    facet<string>(v, g, `claimed by a ${g} source`, PROV);

  it('a third source of the SAME grade cannot break a tie', () => {
    // `gradeOf` used to ignore its argument and return the literal 'GOVERNED',
    // so a VERIFIED-vs-VERIFIED conflict was outranked by the next VERIFIED
    // writer and silently resolved — by call order, which is precisely what the
    // CONFLICT basis string says must never decide.
    const conflict = mergeFacet(F('City A', 'VERIFIED'), F('City B', 'VERIFIED'), same);
    expect(conflict.grade).toBe('CONFLICT');
    const after = mergeFacet(conflict, F('City C', 'VERIFIED'), same);
    expect(after.grade, 'a third equal source resolved the conflict').toBe('CONFLICT');
    expect(after.value).toBeNull();
  });

  it('a genuinely STRONGER source does resolve a weaker conflict', () => {
    // The symmetric bug: a CURATED-vs-CURATED conflict was assumed GOVERNED, so
    // a real GOVERNED source could not beat it and a valid resolution was lost.
    const conflict = mergeFacet(F('City A', 'CURATED'), F('City B', 'CURATED'), same);
    expect(conflict.grade).toBe('CONFLICT');
    const after = mergeFacet(conflict, F('City C', 'GOVERNED'), same);
    expect(after.grade).toBe('GOVERNED');
    expect(after.value).toBe('City C');
  });

  it('records the grade each side was claimed at', () => {
    const conflict = mergeFacet(F('City A', 'VERIFIED'), F('City B', 'CURATED'), same);
    // Unequal grades are not a conflict at all — the stronger wins outright.
    expect(conflict.grade).toBe('VERIFIED');
    const real = mergeFacet(F('City A', 'CURATED'), F('City B', 'CURATED'), same);
    expect(real.conflict?.every(c => !!c.grade), 'every conflict entry keeps its grade').toBe(true);
  });
});

describe('identityKey is a NATIONAL key', () => {
  const county = (stateFips: string, countyFips: string): GoverningEntity => ({
    type: 'county', name: 'Testcounty', stateFips, countyFips,
    placeGeoid: null, countySubdivisionGeoid: null,
  });

  it('the same county code in two states is not the same county', () => {
    // The provider supplies the THREE-DIGIT county code, and this keyed on it
    // alone — so county 119 in Illinois and county 119 in every other state
    // shared one identity. A key that collides across states is not an identity.
    expect(identityKey(county('17', '119'))).not.toBe(identityKey(county('29', '119')));
  });

  it('composes the 5-digit national FIPS from state + county', () => {
    expect(identityKey(county('17', '119'))).toBe('county:17119');
    expect(identityKey(county('6', '37'))).toBe('county:06037');
  });

  it('accepts a county code that is already national', () => {
    expect(identityKey(county('17', '17119'))).toBe('county:17119');
  });

  it('refuses to mint a county identity with no state', () => {
    const k = identityKey({
      type: 'county', name: 'Testcounty', stateFips: null, countyFips: '119',
      placeGeoid: null, countySubdivisionGeoid: null,
    });
    expect(k.startsWith('county:'), 'a bare county code is not a national identity').toBe(false);
    expect(k.startsWith('name:')).toBe(true);
  });
});

describe('every scope in the default list has a rule to match', () => {
  const policy = baselinePolicy();

  it('electrical resolves on UNINCORPORATED territory', () => {
    // The electrical baseline was one statewide rule delegating to 'place'. On
    // unincorporated land there is no place, so electrical reported UNRESOLVED
    // on every such parcel in the country while building resolved fine.
    const g = geography({ place: null });   // proven outside any municipality
    const a = resolveScopeAuthority('electrical', g, policy, EMPTY_REGISTRY);
    expect(a.status).not.toBe('AUTHORITY_SCOPE_UNRESOLVED');
    expect(a.entity?.type).toBe('county');
  });

  it('electrical still follows the municipality inside one', () => {
    const a = resolveScopeAuthority('electrical', geography({ place: CITY }), policy, EMPTY_REGISTRY);
    expect(a.entity?.type).toBe('place');
  });

  it('zoning resolves in both territories', () => {
    // `zoning` was in resolveProjectAhjAuthority's default scope list with NO
    // baseline rule, so it was UNRESOLVED on every project nationally.
    for (const [label, g] of [['incorporated', geography({ place: CITY })],
                              ['unincorporated', geography({ place: null })]] as const) {
      const a = resolveScopeAuthority('zoning', g, policy, EMPTY_REGISTRY);
      expect(a.status, `zoning ${label}`).not.toBe('AUTHORITY_SCOPE_UNRESOLVED');
    }
  });

  it('fire stays UNRESOLVED, and that is correct', () => {
    // Fire districts do not follow municipal limits and nothing retrieves their
    // boundaries. Inheriting the building AHJ would be a substitution.
    const a = resolveScopeAuthority('fire', geography({ place: CITY }), policy, EMPTY_REGISTRY);
    expect(a.status).toBe('AUTHORITY_SCOPE_UNRESOLVED');
  });

  it('allScopesResolved is therefore unreachable — and must not be a gate', () => {
    const p = resolveProjectAhjAuthority(
      geography({ place: CITY }), policy, registryWith('place:9912345'));
    expect(p.scopes.building.status).toBe('AHJ_RECORD_FOUND');
    // The building permit is resolvable even though the flag is false. A gate on
    // the flag would block 100% of packages for an unrelated reason.
    expect(p.allScopesResolved).toBe(false);
  });
});

describe('identityKey never falls across ENTITY TYPES', () => {
  const ent = (over) => ({
    type: 'place', name: 'Testville', stateFips: '99', countyFips: '99001',
    placeGeoid: null, countySubdivisionGeoid: null, ...over,
  });

  it('a place with no GEOID does not borrow its county identity', () => {
    // THE DEFECT the canonical-vs-legacy dry run caught. `entityFromGeography`
    // puts the county FIPS on EVERY entity as context, and the old single
    // fallback chain (place -> cousub -> county -> state) meant a municipality
    // whose GEOID we do not hold degraded to its COUNTY's key — so the registry
    // returned the county's row for a city. It bound 51 cities to their
    // counties, including Nashville to Davidson County, Boise to Ada County and
    // Louisville to Jefferson County: the exact substitution this module exists
    // to prevent, committed by the module itself.
    const place = identityKey(ent({ type: 'place', placeGeoid: null }));
    const county = identityKey(ent({ type: 'county', name: 'Testcounty' }));
    expect(place).not.toBe(county);
    expect(place.startsWith('county:'), 'a place borrowed a county identity').toBe(false);
  });

  it('an unidentified government is not matchable by the registry', () => {
    // It must not collide with any GEOID-keyed row, so the resolver reports the
    // record missing rather than finding something that is not this government.
    for (const t of ['place', 'county', 'county-subdivision', 'state']) {
      const k = identityKey(ent({ type: t, placeGeoid: null, countyFips: null, stateFips: null }));
      expect(k.startsWith('name:'), t).toBe(true);
    }
  });

  it('an MCD with no GEOID does not borrow the county either', () => {
    const mcd = identityKey(ent({ type: 'county-subdivision', name: 'Testtown', countySubdivisionGeoid: null }));
    expect(mcd.startsWith('cousub:')).toBe(false);
    expect(mcd.startsWith('county:')).toBe(false);
  });

  it('each type still keys on its OWN identity when it has one', () => {
    expect(identityKey(ent({ type: 'place', placeGeoid: '9912345' }))).toBe('place:9912345');
    expect(identityKey(ent({ type: 'county', countyFips: '99001' }))).toBe('county:99001');
    expect(identityKey(ent({ type: 'county-subdivision', countySubdivisionGeoid: '9900112345' })))
      .toBe('cousub:9900112345');
    expect(identityKey(ent({ type: 'state', stateFips: '99' }))).toBe('state:99');
  });

  it('a consolidated city-county may key on either hat', () => {
    // One government wearing both; place is the more specific, so it wins.
    expect(identityKey(ent({ type: 'consolidated', placeGeoid: '9912345' }))).toBe('place:9912345');
    expect(identityKey(ent({ type: 'consolidated', placeGeoid: null }))).toBe('county:99001');
  });
});
