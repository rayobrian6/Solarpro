/**
 * Pure (no-database) tests for the internal Neon AHJ registry's row matching and
 * its adoption-evidence gate (lib/jurisdictions/internalAhjRegistry.ts).
 *
 * THE DEFECT THESE PIN: migration 117 applied, the resolver seeded
 * `il-madison-county` on the first live run — and the internal provider then
 * reported NO_COVERAGE with "no registry row for IL/Madison County" on every
 * subsequent run, while the row sat in the table. The county branch required a
 * BLANK city, but the AHJ dataset the registry is seeded from spells "no
 * municipality of its own" as the SENTINEL city "Unincorporated". So a
 * county-level row could never be found by the only query an unincorporated
 * parcel makes — the registry was write-only for every unincorporated
 * jurisdiction, which is most rural sites.
 *
 * It shipped because the matching was only reachable through a live DB query.
 * It is now a pure function, tested here.
 */

import { describe, it, expect } from 'vitest';
import {
  matchRegistryRows, isCountyLevelRow, rowCarriesAdoptionEvidence,
  type AhjRegistryRow,
} from '../lib/jurisdictions/internalAhjRegistry';

function row(over: Partial<AhjRegistryRow>): AhjRegistryRow {
  return {
    id: 'x', stateCode: 'IL', county: 'Madison', city: null, ahjName: 'X',
    jurisdictionType: 'county', externalAhjId: null,
    editions: { nec: null, ibc: null, irc: null, ifc: null },
    rawEditions: null, localAmendments: [], effectiveDate: null,
    sourceUrl: null, sourceSha256: null, provenance: 'seeded-unprovenanced',
    verifiedBy: null, verifiedAtIso: null, retrievedAtIso: null, rawPayload: null,
    enrichmentAttempts: [], permitOffice: null, engineeringReviewRequirements: [],
    notes: null, ...over,
  };
}

const COUNTY = row({ id: 'il-madison-county', city: 'Unincorporated', ahjName: 'Madison County Building & Zoning' });
const CITY = row({ id: 'il-madison-granite-city', city: 'Granite City', jurisdictionType: 'city', ahjName: 'City of Granite City Building & Zoning' });

describe('internal AHJ registry — county-level row identification', () => {
  it('treats the "Unincorporated" sentinel as county-level', () => {
    expect(isCountyLevelRow(COUNTY)).toBe(true);
    expect(isCountyLevelRow(row({ city: 'unincorporated' }))).toBe(true);
    expect(isCountyLevelRow(row({ city: '  UNINCORPORATED ' }))).toBe(true);
  });

  it('treats a blank city as county-level too', () => {
    expect(isCountyLevelRow(row({ city: null }))).toBe(true);
    expect(isCountyLevelRow(row({ city: '' }))).toBe(true);
  });

  it('a real municipality is NOT county-level', () => {
    expect(isCountyLevelRow(CITY)).toBe(false);
  });
});

describe('internal AHJ registry — row matching', () => {
  const all = [COUNTY, CITY];

  it('THE REGRESSION: a county query finds the seeded Unincorporated row', () => {
    const r = matchRegistryRows(all, { county: 'Madison County', city: null });
    expect(r.match?.id).toBe('il-madison-county');
    expect(r.matchMethod).toBe('state+county');
  });

  it('with or without the word "County" on the query', () => {
    expect(matchRegistryRows(all, { county: 'Madison' }).match?.id).toBe('il-madison-county');
    expect(matchRegistryRows(all, { county: 'madison county' }).match?.id).toBe('il-madison-county');
  });

  it('an incorporated city query wins over the county row', () => {
    const r = matchRegistryRows(all, { county: 'Madison County', city: 'Granite City' });
    expect(r.match?.id).toBe('il-madison-granite-city');
    expect(r.matchMethod).toBe('state+city');
  });

  it('a city query never matches a county row through the sentinel', () => {
    // Passing city:'Unincorporated' must not be treated as a municipality name;
    // it falls to the county branch (which is the correct answer, via county).
    const r = matchRegistryRows(all, { county: 'Madison County', city: 'Unincorporated' });
    expect(r.matchMethod).toBe('state+county');
    const cityOnly = matchRegistryRows([COUNTY], { city: 'Unincorporated' });
    expect(cityOnly.match).toBeNull();
  });

  it('an unknown jurisdiction still matches nothing', () => {
    expect(matchRegistryRows(all, { county: 'Cook' }).match).toBeNull();
    expect(matchRegistryRows(all, { city: 'Chicago' }).match).toBeNull();
    expect(matchRegistryRows([], { county: 'Madison' }).match).toBeNull();
  });

  it('a county row for a DIFFERENT county is not returned', () => {
    const other = row({ id: 'il-cook-county', county: 'Cook', city: 'Unincorporated' });
    expect(matchRegistryRows([other], { county: 'Madison County' }).match).toBeNull();
  });
});

describe('internal AHJ registry — the adoption-evidence gate is UNCHANGED', () => {
  it('a seeded row is never adoption authority, even now that it can be FOUND', () => {
    // This is the whole safety property: fixing the lookup must not turn a
    // copied in-code row into an adopted-edition claim.
    expect(rowCarriesAdoptionEvidence(COUNTY)).toBe(false);
    expect(rowCarriesAdoptionEvidence(row({
      provenance: 'seeded-unprovenanced', city: 'Unincorporated',
      editions: { nec: '2020', ibc: null, irc: null, ifc: null },
    }))).toBe(false);
  });

  it('an evidence-bearing row requires provenance AND source AND hash AND attribution AND an edition', () => {
    const full = row({
      provenance: 'operator-verified', sourceUrl: 'https://co.madison.il.us/ordinance',
      sourceSha256: 'a'.repeat(64), verifiedBy: 'operator-verification:1',
      editions: { nec: '2020', ibc: '2021', irc: '2021', ifc: '2021' },
    });
    expect(rowCarriesAdoptionEvidence(full)).toBe(true);
    expect(rowCarriesAdoptionEvidence({ ...full, sourceUrl: null })).toBe(false);
    expect(rowCarriesAdoptionEvidence({ ...full, sourceSha256: null })).toBe(false);
    expect(rowCarriesAdoptionEvidence({ ...full, verifiedBy: null, retrievedAtIso: null })).toBe(false);
    expect(rowCarriesAdoptionEvidence({ ...full, provenance: 'seeded-unprovenanced' })).toBe(false);
    expect(rowCarriesAdoptionEvidence({
      ...full, editions: { nec: null, ibc: null, irc: null, ifc: null },
    })).toBe(false);
  });

  it('a live external retrieval qualifies without an operator', () => {
    expect(rowCarriesAdoptionEvidence(row({
      provenance: 'retrieved', sourceUrl: 'https://ahjregistry.myorangebutton.com/api/v1/ahj/',
      sourceSha256: 'b'.repeat(64), retrievedAtIso: '2026-07-30T00:00:00.000Z',
      editions: { nec: '2020', ibc: null, irc: null, ifc: null },
    }))).toBe(true);
  });
});
