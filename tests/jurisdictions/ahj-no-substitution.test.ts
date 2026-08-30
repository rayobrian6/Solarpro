// ═══════════════════════════════════════════════════════════════════════════
// REGISTRY ABSENCE MUST NEVER BECOME AUTHORITY SUBSTITUTION.
//
// SolarPro holds ~4,000 AHJ rows against ~19,500 municipalities, so the ordinary
// case nationally is that the governing municipality is NOT in the table. The
// only safe answer then is "no record" — never the county, the mailing city, a
// neighbouring municipality, or a similarly named row that happens to exist.
//
// These are mutation tests: each one fails if the specific defect it describes
// is reintroduced. They assert BEHAVIOUR OF THE RULE, not the current contents
// of the table, so adding real records cannot silently switch them off.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  AHJ_NATIONAL,
  AHJ_RETIRED_IDS,
  getAhjById,
  getAhjByCity,
  getAhjByCounty,
  getAhjByAddress,
  searchAhj,
  normalizeCityName,
  type AhjRecord,
} from '@/lib/jurisdictions/ahj-national';

const municipalRows = (): AhjRecord[] =>
  AHJ_NATIONAL.filter(a => a.ahjType !== 'county' && a.city.toLowerCase() !== 'unincorporated');

describe('getAhjByCity — a longer name is a DIFFERENT municipality', () => {
  // Real, separately incorporated American municipalities whose names extend the
  // name of another real municipality in the same state. Before the repair the
  // prefix fallback returned the shorter one's building department for each.
  const REAL_DISTINCT_PLACES: Array<[string, string]> = [
    ['IL', 'Chicago Heights'],
    ['IL', 'Chicago Ridge'],
    ['IL', 'Peoria Heights'],
    ['OH', 'Columbus Grove'],
    ['NY', 'Rochester Hills'],
    ['CO', 'Aurora Hills'],
    ['TN', 'Franklin Springs'],
    ['GA', 'Atlanta Beach'],
    ['MO', 'Kansas City North'],
  ];

  for (const [state, city] of REAL_DISTINCT_PLACES) {
    it(`${state} "${city}" does not resolve to a shorter-named neighbour`, () => {
      const got = getAhjByCity(state, city);
      // Either we genuinely hold this municipality, or the answer is null.
      // What must never happen is a record for some OTHER place.
      if (got !== null) {
        expect(normalizeCityName(got.city)).toBe(normalizeCityName(city));
      }
    });
  }

  it('never returns a record whose city is not the queried city', () => {
    // The general invariant, swept over the whole table: extend every real city
    // name with a real American place-name suffix and demand no substitution.
    const SUFFIXES = [' Heights', ' Park', ' Hills', ' Ridge', ' Beach', ' Grove', ' Junction'];
    const offenders: string[] = [];
    for (const row of municipalRows()) {
      for (const suffix of SUFFIXES) {
        const probe = row.city + suffix;
        const got = getAhjByCity(row.stateCode, probe);
        if (got && normalizeCityName(got.city) !== normalizeCityName(probe)) {
          offenders.push(`${row.stateCode} "${probe}" -> ${got.id} (city=${got.city})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a truncation of a real city name is not that city', () => {
    const offenders: string[] = [];
    for (const row of municipalRows()) {
      if (row.city.length < 5) continue;
      const probe = row.city.slice(0, row.city.length - 2);
      const got = getAhjByCity(row.stateCode, probe);
      if (got && normalizeCityName(got.city) !== normalizeCityName(probe)) {
        offenders.push(`${row.stateCode} "${probe}" -> ${got.id} (city=${got.city})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('getAhjByCity — spelling variance is folded, identity is not', () => {
  it('resolves every standard spelling of an abbreviated place name', () => {
    // The prefix rule this replaced claimed to cover these and did not:
    // 'saint louis'.startsWith('st. louis') is false in both directions, so two
    // of the three spellings returned null.
    const target = getAhjByCity('MO', 'St. Louis');
    expect(target).not.toBeNull();
    for (const spelling of ['Saint Louis', 'St Louis', 'ST. LOUIS', 'st louis']) {
      expect(getAhjByCity('MO', spelling)?.id).toBe(target!.id);
    }
  });

  it('normalizeCityName never adds or removes a token', () => {
    // The property that keeps folding safe: it may REWRITE a token, never change
    // how many there are. "Chicago Heights" can therefore never become "Chicago".
    // Tokens are split on hyphens as well as whitespace on both sides, because
    // folding "Winston-Salem" to "winston salem" is deliberate — it is one city
    // spelled two ways, exactly like "St." and "Saint".
    const tokens = (s: string) => s.trim().toLowerCase().split(/[\s\-_]+/).filter(Boolean);
    for (const row of AHJ_NATIONAL) {
      expect(
        tokens(normalizeCityName(row.city)).length,
        `normalizeCityName changed the token count of "${row.city}"`,
      ).toBe(tokens(row.city).length);
    }
  });

  it('normalization never merges two distinct municipalities in a state', () => {
    // The danger of any folding rule: that it makes two real, different places
    // compare equal, at which point getAhjByCity's equality match would return
    // whichever came first — a substitution wearing a different hat.
    const byState = new Map<string, Map<string, string>>();
    const collisions: string[] = [];
    for (const row of municipalRows()) {
      if (!byState.has(row.stateCode)) byState.set(row.stateCode, new Map());
      const seen = byState.get(row.stateCode)!;
      const norm = normalizeCityName(row.city);
      const prior = seen.get(norm);
      if (prior !== undefined && prior.toLowerCase() !== row.city.toLowerCase()) {
        collisions.push(`${row.stateCode}: "${prior}" and "${row.city}" both fold to "${norm}"`);
      }
      seen.set(norm, row.city);
    }
    expect(collisions).toEqual([]);
  });

  it('folds only genuine abbreviations, not arbitrary words', () => {
    expect(normalizeCityName('St. Louis')).toBe(normalizeCityName('Saint Louis'));
    expect(normalizeCityName('Mt. Vernon')).toBe(normalizeCityName('Mount Vernon'));
    expect(normalizeCityName('Ft. Worth')).toBe(normalizeCityName('Fort Worth'));
    // and never across distinct places
    expect(normalizeCityName('Chicago Heights')).not.toBe(normalizeCityName('Chicago'));
    expect(normalizeCityName('Kansas City')).not.toBe(normalizeCityName('Kansas'));
  });
});

describe('searchAhj — a filter that matches nothing narrows to nothing', () => {
  it('does not widen to the whole state when the city matches nothing', () => {
    // The live defect: this returned every row in the state, and all three
    // consumers took results[0] — Chicago for IL, Houston for TX.
    for (const state of ['IL', 'TX', 'CA', 'NY', 'FL']) {
      const res = searchAhj({ stateCode: state, city: 'Zzzznotarealcity' });
      expect(res).toEqual([]);
    }
  });

  it('does not widen to the whole state when the county matches nothing', () => {
    for (const state of ['IL', 'TX', 'CA']) {
      const res = searchAhj({ stateCode: state, county: 'Zzzznotarealcounty' });
      expect(res).toEqual([]);
    }
  });

  it('never answers a city query with a row from a different city', () => {
    for (const state of ['IL', 'TX', 'OH', 'MO']) {
      const res = searchAhj({ stateCode: state, city: 'Zzzznotarealcity' });
      for (const row of res) expect(row.city.toLowerCase()).toContain('zzzznotarealcity');
    }
  });
});

describe('getAhjByAddress — no localization means no answer', () => {
  it('returns null rather than the first row in the state', () => {
    const got = getAhjByAddress('1 Nowhere Ln, Zzzznotarealcity, IL 60000');
    // IL has many rows; a guess would be il-cook-chicago.
    expect(got).toBeNull();
  });

  it('an unknown county hint does not fall back to another county', () => {
    const got = getAhjByAddress('1 Nowhere Ln, Zzzznotarealcity, TX 75000',
      { stateCode: 'TX', county: 'Zzzznotarealcounty' });
    expect(got).toBeNull();
  });
});

describe('one government, one row', () => {
  it('no two records describe the same jurisdiction', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const a of AHJ_NATIONAL) {
      const key = [a.stateCode, normalizeCityName(a.county), normalizeCityName(a.city)]
        .join('|').toLowerCase();
      if (seen.has(key)) dupes.push(`${key}: ${seen.get(key)} + ${a.id}`);
      else seen.set(key, a.id);
    }
    // Two curated rows for one government used to survive the merge, and array
    // order decided which one every lookup returned — in both real cases the
    // poorer of the two.
    expect(dupes).toEqual([]);
  });

  it('record ids are unique', () => {
    const ids = AHJ_NATIONAL.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('retired ids stay resolvable', () => {
  it('every retired id redirects to a record that exists', () => {
    for (const [retired, canonical] of Object.entries(AHJ_RETIRED_IDS)) {
      const target = AHJ_NATIONAL.find(a => a.id === canonical);
      expect(target, `alias ${retired} -> ${canonical} has no target`).toBeTruthy();
      expect(getAhjById(retired)?.id).toBe(canonical);
    }
  });

  it('an alias never redirects across states', () => {
    // An alias is a redirect between two rows for ONE government. It is not a
    // place to map a city onto its county, or onto anything in another state.
    for (const [retired, canonical] of Object.entries(AHJ_RETIRED_IDS)) {
      expect(retired.slice(0, 2)).toBe(canonical.slice(0, 2));
    }
  });

  it('a retired id is not also a live record', () => {
    for (const retired of Object.keys(AHJ_RETIRED_IDS)) {
      expect(AHJ_NATIONAL.some(a => a.id === retired)).toBe(false);
    }
  });
});

describe('a consolidated city-county is ONE government', () => {
  it('resolves to the same authority from a city and a county lookup', () => {
    // The District of Columbia had THREE rows: the real DC Department of
    // Buildings, a duplicate of it, and a fabricated "District of Columbia
    // County Building Department" — a body that does not exist, which a county
    // lookup PREFERRED over the real authority because it looked county-typed.
    const byCity = getAhjByCity('DC', 'Washington');
    const byCounty = getAhjByCounty('DC', 'District of Columbia');
    expect(byCity).not.toBeNull();
    expect(byCounty?.id).toBe(byCity!.id);
  });

  it('holds no invented "County Building Department" for a consolidated government', () => {
    const dc = AHJ_NATIONAL.filter(a => a.stateCode === 'DC');
    expect(dc).toHaveLength(1);
    expect(dc[0].ahjName).not.toMatch(/county building department/i);
  });
});

describe('a lone row does not swallow a state', () => {
  it('auto-picks only a TERRITORY-WIDE record when a state has one row', () => {
    // Holding one row proves our coverage is thin, not that the state has one
    // government. Only a state-level or county/unincorporated record stands for
    // a whole state on its own face.
    const byState = new Map<string, AhjRecord[]>();
    for (const a of AHJ_NATIONAL) byState.set(a.stateCode, [...(byState.get(a.stateCode) ?? []), a]);
    for (const [st, rows] of byState) {
      if (rows.length !== 1) continue;
      const got = getAhjByAddress(`1 Nowhere Rd, Zzzznotarealcity, ${st} 00000`, { stateCode: st });
      if (got) {
        const territoryWide = got.ahjType === 'state' || got.ahjType === 'county'
          || got.city.toLowerCase() === 'unincorporated';
        expect(territoryWide, `${st} auto-picked the municipal row ${got.id}`).toBe(true);
      }
    }
  });
});

describe('data hygiene that reaches the sheet', () => {
  it('no record stores an empty string as a local amendment', () => {
    // 118 rows did. It renders as a blank bullet under "Local amendments" on the
    // code-authority sheet.
    const offenders = AHJ_NATIONAL
      .filter(a => (a.localAmendments ?? []).some(x => String(x ?? '').trim() === ''))
      .map(a => a.id);
    expect(offenders).toEqual([]);
  });
});

describe('only governments can be an authority having jurisdiction', () => {
  it('no record carries placeholder geography', () => {
    // The table held rows for utility incentive programs, state green banks and
    // two TRADE ASSOCIATIONS, all at county:'Various', city:'Various'. A city
    // lookup for the literal string "Various" returned the Illinois Solar Energy
    // Association as the AHJ.
    const placeholder = /^(various|multiple|statewide|n\/?a|unknown|tbd)$/i;
    const offenders = AHJ_NATIONAL
      .filter(a => placeholder.test(a.city.trim()) || placeholder.test(a.county.trim()))
      .map(a => `${a.id} (${a.ahjName})`);
    expect(offenders).toEqual([]);
  });

  it('a placeholder query resolves to nothing', () => {
    for (const state of ['IL', 'CA', 'CO', 'NY', 'MA', 'NJ', 'CT']) {
      expect(getAhjByCity(state, 'Various')).toBeNull();
      expect(getAhjByCounty(state, 'Various')).toBeNull();
    }
  });
});
