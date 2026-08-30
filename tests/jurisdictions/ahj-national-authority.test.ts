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
    expect(p.complete).toBe(false);
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
