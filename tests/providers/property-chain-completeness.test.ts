// ═══════════════════════════════════════════════════════════════════════════
// THE PROVIDER CHAIN RUNS UNTIL THE FACETS ARE ESTABLISHED, NOT UNTIL A LEG
// ANSWERS.
//
// The three legs do not answer the same question. ATTOM establishes parcel and
// assessment facts and knows nothing about legal boundaries. The Census
// geocoder is the ONLY leg that resolves which incorporated place contains a
// parcel, and the only source of state/county/place FIPS. The chain used to
// stop at the first leg that returned anything, so wherever an ATTOM key was
// configured the boundary was never resolved — and an unresolved boundary is
// what let the mailing city stand in for the governing municipality.
//
// There were no tests over this file at all, which is how it survived. These
// are the regressions.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enrichProperty } from '@/lib/enrichment/propertyEnricher';
import { toPropertyIdentity } from '@/lib/providers/property/censusPropertyProvider';

const ATTOM_BODY = {
  property: [{
    address: { oneLine: '3 MELVIN DR APT A, GRANITE CITY, IL 62040', county: 'MADISON' },
    location: { latitude: '38.7010', longitude: '-90.1490', geoIdV4: { CO: '17119' }, censusTracts: [{ tractCode: '401100' }] },
    identifier: { apn: '17-2-08-12-04-301-014' },
    building: { useCode: { description: 'SFR' }, yearBuilt: '1965', size: { livingSize: '1200' }, rooms: { beds: '3', bathsFull: '2' } },
    lot: { lotSize2: '8000' },
    assessment: { assessed: { assdTtlValue: '30000' }, market: { mktTtlValue: '90000' } },
    owner: { owner1: { fullName: 'DOE JOHN' }, ownerOccupied: 'Y' },
    saleHistory: [{ saleTransDate: '2019-04-01', amount: { saleAmt: '85000' } }],
  }],
};

const CENSUS_BODY = {
  result: {
    addressMatches: [{
      matchedAddress: '3 MELVIN DR, GRANITE CITY, IL, 62040',
      coordinates: { x: -90.1490, y: 38.7010 },
      geographies: {
        'Census Tracts': [{ TRACT: '401100' }],
        Counties: [{ NAME: 'Madison County', STATE: '17', COUNTY: '119' }],
        'Incorporated Places': [{ NAME: 'Granite City', GEOID: '1730926' }],
        'County Subdivisions': [{ NAME: 'Granite City township' }],
      },
    }],
  },
};

/** Records every host the chain actually contacted. */
let hostsCalled: string[] = [];

function installFetch(opts: { attom?: boolean; census?: boolean } = {}) {
  const { attom = true, census = true } = opts;
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('attomdata.com')) {
      hostsCalled.push('attom');
      if (!attom) return { ok: false, json: async () => ({}) } as unknown as Response;
      return { ok: true, json: async () => ATTOM_BODY } as unknown as Response;
    }
    if (u.includes('geocoding.geo.census.gov')) {
      hostsCalled.push('census');
      if (!census) return { ok: false, json: async () => ({}) } as unknown as Response;
      return { ok: true, json: async () => CENSUS_BODY } as unknown as Response;
    }
    hostsCalled.push('nominatim');
    return { ok: true, json: async () => ([]) } as unknown as Response;
  }));
}

const INPUT = {
  opportunity_id: 'test',
  address_line1: '3 Melvin Dr',
  city: 'Granite City',
  state: 'IL',
  zip: '62040',
};

describe('enrichProperty — a successful leg does not end the chain', () => {
  beforeEach(() => { hostsCalled = []; process.env.ATTOM_API_KEY = 'test-key'; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.ATTOM_API_KEY; });

  it('still queries the Census boundary layer after ATTOM succeeds', () => {
    // THE REGRESSION. `if (attom) return attom` made this impossible.
    installFetch();
    return enrichProperty(INPUT).then(() => {
      expect(hostsCalled).toContain('attom');
      expect(hostsCalled, 'the boundary leg was skipped because an earlier leg answered')
        .toContain('census');
    });
  });

  it('resolves the municipal boundary even when ATTOM answered first', async () => {
    installFetch();
    const r = await enrichProperty(INPUT);
    expect(r).not.toBeNull();
    expect(r!.boundary_layers_resolved).toBe(true);
    expect(r!.incorporated_place).toBe('Granite City');
    expect(r!.place_fips).toBe('1730926');
    expect(r!.state_fips).toBe('17');
    expect(r!.county_fips).toBe('119');
  });

  it('keeps the facts only ATTOM establishes', async () => {
    installFetch();
    const r = await enrichProperty(INPUT);
    // Continuing the chain must SUPPLEMENT, never discard.
    expect(r!.parcel_id).toBe('17-2-08-12-04-301-014');
    expect(r!.owner_name).toBe('DOE JOHN');
    expect(r!.year_built).toBe(1965);
  });

  it('a later leg fills blanks but never overwrites an established facet', async () => {
    installFetch();
    const r = await enrichProperty(INPUT);
    // ATTOM answered `county` first ('MADISON'); Census also has one
    // ('Madison County'). The first answer stands — a leg that ran second
    // because the first was incomplete has no standing to overrule it.
    expect(r!.county).toBe('MADISON');
  });

  it('credits each facet to the leg that established it', async () => {
    installFetch();
    const r = await enrichProperty(INPUT);
    expect(r!.parcel_source).toBe('attom');
    expect(r!.boundary_source).toBe('census_geocoder');
    expect(r!.provider_contributors).toEqual(['attom', 'census_geocoder']);
    // The record is attributed to the leg that made the boundary determination,
    // because that is the authority-relevant one.
    expect(r!.provider_used).toBe('census_geocoder');
  });

  it('does not run the boundary leg twice when Census answered alone', async () => {
    delete process.env.ATTOM_API_KEY;   // ATTOM leg returns null immediately
    installFetch();
    const r = await enrichProperty(INPUT);
    expect(hostsCalled.filter(h => h === 'census')).toHaveLength(1);
    expect(r!.provider_contributors).toEqual(['census_geocoder']);
  });

  it('still returns the ATTOM record when the boundary leg fails', async () => {
    installFetch({ census: false });
    const r = await enrichProperty(INPUT);
    // A failed boundary retrieval must not discard the parcel facts, and must
    // not claim the boundary was resolved.
    expect(r).not.toBeNull();
    expect(r!.parcel_id).toBe('17-2-08-12-04-301-014');
    expect(r!.boundary_layers_resolved).not.toBe(true);
    expect(r!.provider_used).toBe('attom');
  });
});

describe('toPropertyIdentity — provenance survives the merge', () => {
  it('attributes the parcel id to ATTOM even when the record is Census-headed', () => {
    const id = toPropertyIdentity({
      provider_used: 'census_geocoder',
      parcel_source: 'attom',
      boundary_source: 'census_geocoder',
      parcel_id: '17-2-08-12-04-301-014',
      incorporated_place: 'Granite City',
      place_fips: '1730926',
      state_fips: '17', county_fips: '119',
      boundary_layers_resolved: true,
      latitude: 38.701, longitude: -90.149,
      formatted_address: '3 MELVIN DR, GRANITE CITY, IL, 62040',
      county: 'Madison County', fips_code: '17119', census_tract: '401100',
      property_type: null, year_built: null, square_feet_living: null,
      square_feet_lot: null, bedrooms: null, bathrooms: null,
      owner_name: null, owner_occupied: null, assessed_value: null,
      market_value: null, last_sale_date: null, last_sale_price: null,
    }, { retrievedAtIso: '2026-08-30T00:00:00.000Z' });

    // The Census geocoder publishes no parcel identifiers; saying it did would
    // be a false provenance claim on a permit document.
    expect(id.parcelSource).toBe('attom');
    expect(id.placeFips).toBe('1730926');
    expect(id.boundaryLayersResolved).toBe(true);
    expect(id.unincorporated).toBe(false);
    expect(id.boundaryEvidence).toContain('Granite City');
  });

  it('an unresolved boundary is reported as undetermined, not as a place', () => {
    const id = toPropertyIdentity({
      provider_used: 'attom',
      parcel_source: 'attom',
      parcel_id: 'APN-1',
      boundary_layers_resolved: false,
      latitude: 1, longitude: 2, formatted_address: 'x', county: 'Madison County',
      fips_code: null, census_tract: null, property_type: null, year_built: null,
      square_feet_living: null, square_feet_lot: null, bedrooms: null, bathrooms: null,
      owner_name: null, owner_occupied: null, assessed_value: null, market_value: null,
      last_sale_date: null, last_sale_price: null,
    }, { retrievedAtIso: '2026-08-30T00:00:00.000Z' });

    expect(id.boundaryLayersResolved).toBe(false);
    expect(id.unincorporated).toBeNull();
    expect(id.incorporatedPlace).toBeNull();
    expect(id.boundaryEvidence).toMatch(/UNDETERMINED/);
  });
});
