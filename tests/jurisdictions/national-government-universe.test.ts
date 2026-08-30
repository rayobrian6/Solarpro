// ═══════════════════════════════════════════════════════════════════════════
// THE NATIONAL GOVERNMENT UNIVERSE — a statistical geography is never a
// government, and a government that exists is not thereby an AHJ.
//
// The registry of ~4,000 AHJ rows is the PERMITTING-AUTHORITY layer. This is
// the layer beneath it: what governments the United States actually has. The
// two must never be conflated, in either direction.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  loadUniverse, universeById, canHoldAuthority, isStatisticalOnly,
  STATISTICAL_KINDS, type LegalGovernmentEntity,
} from '@/lib/jurisdictions/legalGovernmentUniverse';

const U = loadUniverse();
const byKind = (k: string) => U.filter(e => e.entityKind === k);
const active = (e: LegalGovernmentEntity) => e.governmentStatus === 'ACTIVE';

describe('the universe is loaded and internally consistent', () => {
  it('holds the national government topology, not the AHJ registry', () => {
    // ~72k entities against ~4k AHJ rows: the point is that the registry is a
    // small subset of the country's governments, not the universe of them.
    expect(U.length).toBeGreaterThan(60_000);
    expect(U.filter(canHoldAuthority).length).toBeGreaterThan(30_000);
  });

  it('every id is unique and identity-shaped, never a name', () => {
    const ids = U.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of U.slice(0, 500)) {
      expect(e.id).toMatch(/^(state|county|place|cousub):[0-9]+$/);
    }
  });

  it('every entity carries its source key and raw Census codes', () => {
    // §2/§20: an identity with no account of how it was established is a bare
    // assertion. The raw class and functional-status codes stay on the record so
    // a grading decision can be re-examined rather than trusted.
    for (const e of U.slice(0, 1000)) {
      expect(e.source.sourceKey, e.id).toBeTruthy();
      expect(e.source.vintage, e.id).toBeTruthy();
      expect(e.governmentClass, e.id).toBeTruthy();
      expect(e.governmentFunctionStatus, e.id).toBeTruthy();
    }
  });
});

describe('a CDP is never a government — the mandatory guard', () => {
  it('no Census Designated Place can hold authority', () => {
    const cdps = byKind('census-designated-place');
    expect(cdps.length).toBeGreaterThan(10_000);
    expect(cdps.filter(canHoldAuthority)).toEqual([]);
  });

  it('no Census County Division can hold authority', () => {
    // CCDs are the statistical carve-up of a county in states with no MCD layer.
    const ccds = byKind('census-county-division');
    expect(ccds.length).toBeGreaterThan(5_000);
    expect(ccds.filter(canHoldAuthority)).toEqual([]);
  });

  it('every statistical kind is flagged statistical', () => {
    for (const k of STATISTICAL_KINDS) {
      for (const e of byKind(k)) expect(isStatisticalOnly(e), e.id).toBe(true);
    }
  });

  it('a CDP whose name matches a real municipality is still not a government', () => {
    // The exact substitution shape: Hawaii has ZERO incorporated places, so
    // "Kailua", "Pearl City" and "Wahiawa" exist only as CDPs. A name match
    // against a mailing address must never manufacture a municipal AHJ.
    const hawaiiCdps = U.filter(e => e.stateFips === '15' && e.entityKind === 'census-designated-place');
    expect(hawaiiCdps.length).toBeGreaterThan(0);
    expect(hawaiiCdps.filter(canHoldAuthority)).toEqual([]);
    // and Hawaii genuinely has no incorporated place at all
    const hawaiiPlaces = U.filter(e => e.stateFips === '15' && e.entityKind === 'incorporated-place');
    expect(hawaiiPlaces.filter(active)).toEqual([]);
  });
});

describe('superseded and dissolved governments cannot be authorities', () => {
  it('a nonfunctioning legal entity cannot hold authority', () => {
    const dead = U.filter(e => e.governmentStatus === 'SUPERSEDED');
    expect(dead.length).toBeGreaterThan(100);
    expect(dead.filter(canHoldAuthority)).toEqual([]);
  });

  it('Louisville city is superseded by its consolidated successor', () => {
    const l = universeById('place:2148000');
    expect(l?.canonicalName).toBe('Louisville city');
    expect(l?.governmentStatus).toBe('SUPERSEDED');
    expect(canHoldAuthority(l!)).toBe(false);
  });

  it('the "(balance)" hierarchy fillers are statistical, not governments', () => {
    // "Nashville-Davidson metropolitan government (balance)" is a geographic
    // remainder Census invents to complete the hierarchy. It is not a body you
    // can pull a permit from.
    const balances = U.filter(e => e.canonicalName.includes('(balance)'));
    expect(balances.length).toBeGreaterThan(0);
    expect(balances.filter(canHoldAuthority)).toEqual([]);
  });
});

describe('state-specific legal structures are represented, not forced', () => {
  it('New England towns are first-class, and CT/RI have no county government', () => {
    for (const [fips, minTowns] of [['09', 100], ['44', 20], ['25', 200]] as const) {
      const towns = U.filter(e => e.stateFips === fips
        && ['town', 'township', 'mcd'].includes(e.entityKind) && active(e));
      expect(towns.length, `state ${fips} towns`).toBeGreaterThan(minTowns);
    }
    for (const fips of ['09', '44']) {
      const counties = U.filter(e => e.stateFips === fips && e.entityKind === 'county' && active(e));
      expect(counties, `state ${fips} has no county government`).toEqual([]);
    }
    // Massachusetts kept a minority of its counties.
    const maCounties = U.filter(e => e.stateFips === '25' && e.entityKind === 'county' && active(e));
    expect(maCounties.length).toBeGreaterThan(0);
    expect(maCounties.length).toBeLessThan(14);
  });

  it('Puerto Rico is modelled as municipios, not mainland places', () => {
    const municipios = U.filter(e => e.entityKind === 'municipio' && active(e));
    expect(municipios.length).toBe(78);
    // and PR genuinely has no incorporated places to mistake them for
    const prPlaces = U.filter(e => e.stateFips === '72' && e.entityKind === 'incorporated-place' && active(e));
    expect(prPlaces).toEqual([]);
  });

  it('Alaska: boroughs govern, CENSUS AREAS do not', () => {
    // Alaska's real structure, not a mainland analogy: 14 organized boroughs
    // (H1), 4 UNIFIED city-boroughs (H6 — Anchorage, Juneau, Sitka, Wrangell),
    // Skagway Municipality, and 11 CENSUS AREAS (H5) which together are the
    // UNORGANIZED BOROUGH and have no local government at all.
    const ak = U.filter(e => e.stateFips === '02' && e.countyFips && !e.cousubGeoid && !e.placeGeoid);
    expect(ak.filter(e => e.entityKind === 'borough' && active(e)).length).toBeGreaterThan(10);
    expect(ak.filter(e => e.entityKind === 'consolidated-government' && active(e)).length).toBeGreaterThan(0);

    // THE GUARD: a Census Area is statistical geography and can never be an AHJ.
    const censusAreas = ak.filter(e => /\sCensus Area$/.test(e.canonicalName));
    expect(censusAreas.length).toBe(11);
    expect(censusAreas.filter(canHoldAuthority)).toEqual([]);
    for (const c of censusAreas) expect(c.governmentStatus, c.canonicalName).toBe('STATISTICAL_ONLY');
  });

  it('an independent city is ONE government recorded at two levels', () => {
    // All 41 are FUNCSTAT 'F' in the county file (a hierarchy filler, so the
    // government is not double-counted) and 'A' in the place file. Taking 'F'
    // literally would mark St. Louis statistical and make a county-keyed lookup
    // refuse a government that plainly exists.
    for (const [countyId, placeId, name] of [
      ['county:29510', 'place:2965000', 'St. Louis city'],
      ['county:24510', 'place:2404000', 'Baltimore city'],
      ['county:51510', 'place:5101000', 'Alexandria city'],
    ] as const) {
      const c = universeById(countyId);
      const p = universeById(placeId);
      expect(c?.entityKind, name).toBe('independent-city');
      expect(p?.entityKind, name).toBe('independent-city');
      expect(canHoldAuthority(c!), `${name} county-level`).toBe(true);
      expect(canHoldAuthority(p!), `${name} place-level`).toBe(true);
    }
  });
});

describe('the universe is NOT the authority layer', () => {
  it('an active government is not thereby a building AHJ', () => {
    // Nameoki Township is an active Illinois township government — and Illinois
    // townships do not issue building permits. The universe records that it
    // exists; only the delegation policy decides what it administers.
    const t = universeById('cousub:1711951583');
    expect(t?.canonicalName).toBe('Nameoki township');
    expect(canHoldAuthority(t!)).toBe(true);
    // canHoldAuthority is a capability, not a determination — there is
    // deliberately no `isBuildingAhj` on the universe at all.
    expect(Object.keys(t!)).not.toContain('isBuildingAhj');
  });

  it('the universe dwarfs the AHJ registry, which is the point', async () => {
    const { AHJ_NATIONAL } = await import('@/lib/jurisdictions/ahj-national');
    expect(U.filter(canHoldAuthority).length).toBeGreaterThan(AHJ_NATIONAL.length * 5);
  });
});
