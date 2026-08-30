// ═══════════════════════════════════════════════════════════════════════════
// THE IDENTITY BACKFILL MUST FAIL CLOSED ON EVERY COLLISION SHAPE.
//
// American legal geography is adversarial to name matching. Names repeat across
// states, inside a state, between a city and its county, between an incorporated
// place and a CDP of the same name, and between a township and a city. A wrong
// GEOID binds a package to the wrong government silently — the same defect class
// as the prefix matcher this campaign removed, just harder to see.
//
// So these tests assert the RULE (nothing is bound that cannot be proven), not
// the current contents of the table. Adding real identities cannot switch them
// off.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { AHJ_NATIONAL, getAhjByCity, getAhjByCounty, type AhjRecord } from '@/lib/jurisdictions/ahj-national';
import {
  governmentKey, isGoverningEntityType, GOVERNING_ENTITY_TYPES,
} from '@/lib/jurisdictions/legalGovernmentIdentity';

const bound = (): AhjRecord[] => AHJ_NATIONAL.filter(r => r.legalIdentity);

describe('a bound identity is well-formed and national', () => {
  it('county FIPS is the 5-digit NATIONAL code, never the bare 3-digit one', () => {
    // A 3-digit county code collides across all 50 states: county 119 is Madison
    // County IL and county 119 in every other state that has one.
    const bad = bound()
      .filter(r => r.legalIdentity!.countyFips && r.legalIdentity!.countyFips!.length !== 5)
      .map(r => `${r.id}: ${r.legalIdentity!.countyFips}`);
    expect(bad).toEqual([]);
  });

  it('place GEOID is 7 digits and MCD GEOID is 10', () => {
    const bad = bound().filter(r => {
      const li = r.legalIdentity!;
      return (li.placeGeoid && li.placeGeoid.length !== 7)
        || (li.mcdGeoid && li.mcdGeoid.length !== 10);
    }).map(r => r.id);
    expect(bad).toEqual([]);
  });

  it('the county FIPS always begins with its own state FIPS', () => {
    const bad = bound()
      .filter(r => r.legalIdentity!.countyFips
        && !r.legalIdentity!.countyFips!.startsWith(r.legalIdentity!.stateFips))
      .map(r => `${r.id}: state ${r.legalIdentity!.stateFips} vs county ${r.legalIdentity!.countyFips}`);
    expect(bad).toEqual([]);
  });

  it('every bound identity carries its provenance', () => {
    // §20: never write an id with no account of how it was established.
    for (const r of bound()) {
      const li = r.legalIdentity!;
      expect(li.source, r.id).toBeTruthy();
      expect(li.sourceVintage, r.id).toBeTruthy();
      expect(li.sourceSha256, r.id).toMatch(/^[0-9a-f]{64}$/);
      expect(li.matchMethod, r.id).toBeTruthy();
    }
  });

  it('no identity was established by a guarded candidate', () => {
    // §3/§7: a guarded fuzzy candidate goes to manual review, never to bound.
    const bad = bound().filter(r => r.legalIdentity!.matchMethod === 'guarded-candidate');
    expect(bad.map(r => r.id)).toEqual([]);
  });
});

describe('a statistical geography is never a government', () => {
  it('no bound row is a CDP or a nonfunctioning county', () => {
    // A CDP is an area the Census drew around a populated place that has NO
    // municipal government. Connecticut and Rhode Island have no county
    // governments at all — every one of their county rows is FUNCSTAT 'N'.
    const bad = bound()
      .filter(r => !isGoverningEntityType(r.legalIdentity!.entityType))
      .map(r => `${r.id} (${r.legalIdentity!.entityType})`);
    expect(bad).toEqual([]);
  });

  it('every bound entityType is one that can hold authority', () => {
    for (const r of bound()) {
      expect(GOVERNING_ENTITY_TYPES, r.id).toContain(r.legalIdentity!.entityType);
    }
  });
});

describe('collision shapes fail closed', () => {
  it('the same city name in two states never shares an identity', () => {
    // Springfield, Washington, Franklin, Madison, Union, Georgetown.
    const byName = new Map<string, AhjRecord[]>();
    for (const r of bound()) {
      if (r.ahjType === 'county') continue;
      const k = r.city.toLowerCase();
      byName.set(k, [...(byName.get(k) ?? []), r]);
    }
    const collisions: string[] = [];
    for (const [name, rows] of byName) {
      const states = new Set(rows.map(r => r.stateCode));
      if (states.size < 2) continue;
      const keys = new Map<string, string[]>();
      for (const r of rows) {
        const k = governmentKey(r.legalIdentity!);
        keys.set(k, [...(keys.get(k) ?? []), r.id]);
      }
      for (const [k, ids] of keys) {
        const st = new Set(ids.map(i => rows.find(r => r.id === i)!.stateCode));
        if (st.size > 1) collisions.push(`"${name}" ${[...st].join('/')} share ${k}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('two registry rows in different counties never share one place GEOID', () => {
    const byGeoid = new Map<string, AhjRecord[]>();
    for (const r of bound()) {
      const g = r.legalIdentity!.placeGeoid;
      if (!g) continue;
      byGeoid.set(g, [...(byGeoid.get(g) ?? []), r]);
    }
    const bad: string[] = [];
    for (const [g, rows] of byGeoid) {
      const counties = new Set(rows.map(r => r.county.toLowerCase()));
      if (counties.size > 1) bad.push(`${g}: ${rows.map(r => r.id).join(', ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('a city row and a county row never share one identity key', () => {
    // "Madison" the city and "Madison" the county are different governments, and
    // a same-name pair is the single most common national trap.
    const bad: string[] = [];
    const byKey = new Map<string, AhjRecord[]>();
    for (const r of bound()) byKey.set(governmentKey(r.legalIdentity!),
      [...(byKey.get(governmentKey(r.legalIdentity!)) ?? []), r]);
    for (const [k, rows] of byKey) {
      const types = new Set(rows.map(r => r.legalIdentity!.entityType));
      // county + incorporated-place under one key would mean a city was bound to
      // its county. Consolidated governments legitimately carry one type.
      if (types.has('county') && types.has('incorporated-place')) {
        bad.push(`${k}: ${rows.map(r => `${r.id}(${r.legalIdentity!.entityType})`).join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('an MCD identity is never used where an incorporated place was meant', () => {
    // A township and a city can share a name in the same county (Granite City
    // city and Granite City township both exist in Madison County, IL).
    for (const r of bound()) {
      const li = r.legalIdentity!;
      if (li.entityType === 'mcd') expect(li.mcdGeoid, r.id).toBeTruthy();
      if (li.entityType === 'incorporated-place') expect(li.placeGeoid, r.id).toBeTruthy();
    }
  });
});

describe('the known-hard national cases', () => {
  const byId = (id: string) => AHJ_NATIONAL.find(r => r.id === id);

  it('binds a city whose NAME ends in a legal-descriptor word', () => {
    // "Granite City" is not "Granite"; "Salt Lake City" is not "Salt Lake". The
    // Census writes the descriptor into the name ("Granite City city"), and
    // stripping it from the REGISTRY side mangles the actual name.
    for (const id of ['il-madison-granite-city', 'ut-salt-lake-salt-lake-city', 'mo-jackson-kansas-city']) {
      const r = byId(id);
      expect(r?.legalIdentity?.placeGeoid, id).toBeTruthy();
    }
    expect(byId('il-madison-granite-city')!.legalIdentity!.placeGeoid).toBe('1730926');
  });

  it('binds a county whose NAME ends in a geographic word', () => {
    // "Rock Island County" is not "Rock County".
    const r = byId('il-rock-island-rock-island-county');
    expect(r?.legalIdentity?.countyFips).toBeTruthy();
  });

  it('the consolidated-government cases are NOT auto-bound', () => {
    // Athens-Clarke, Nashville-Davidson, Augusta-Richmond, Butte-Silver Bow.
    // A prefix rule would "solve" these — and the same rule turns Chicago
    // Heights into Chicago. They are left for review.
    for (const id of ['ga-clarke-athens', 'tn-davidson-nashville', 'ga-richmond-augusta']) {
      const r = byId(id);
      if (r) expect(r.legalIdentity, `${id} was auto-bound`).toBeUndefined();
    }
  });

  it('Granite City the CITY and Madison County are distinct identities', () => {
    // The Braidon distinction, expressed structurally rather than as a fixture:
    // a postal city, an incorporated municipality and a county are three things.
    const city = getAhjByCity('IL', 'Granite City');
    const county = getAhjByCounty('IL', 'Madison');
    expect(city?.legalIdentity?.placeGeoid).toBe('1730926');
    expect(county?.legalIdentity?.countyFips).toBe('17119');
    expect(governmentKey(city!.legalIdentity!)).not.toBe(governmentKey(county!.legalIdentity!));
  });
});
