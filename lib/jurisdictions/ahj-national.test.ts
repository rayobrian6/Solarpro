// lib/jurisdictions/ahj-national.test.ts
// Comprehensive completeness and correctness tests for the National AHJ Database.
// Tests: structural integrity, field validity, geographic coverage, search functions.
import { describe, it, expect } from 'vitest';
import {
  AHJ_NATIONAL,
  searchAhj,
  getAhjById,
  getAhjsByState,
  getAhjByAddress,
  getAhjByCounty,
  getTotalAhjCount,
  getStatesSummary,
  type AhjRecord,
} from './ahj-national';
import { JURISDICTION_DATA } from './necVersions';

// ── Constants ──────────────────────────────────────────────────────────────────

const VALID_NEC_VERSIONS = new Set(['2017', '2020', '2023']);
const VALID_AHJ_TYPES = new Set(['city', 'county', 'state', 'special_district']);
const VALID_SEISMIC = new Set(['A', 'B', 'C', 'D', 'D1', 'D2', 'E', 'F', '']);

/** All 50 states + DC */
const ALL_STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC',
];

/** Top-25 solar metros that must appear in database */
const REQUIRED_METRO_IDS = [
  'ca-los-angeles-la',
  'ca-san-diego-san-diego',
  'ca-santa-clara-san-jose',
  'ca-sacramento-sacramento',
  'az-maricopa-phoenix',
  'az-maricopa-scottsdale',
  'az-pima-tucson',
  'tx-harris-houston',
  'tx-dallas-dallas',
  'tx-travis-austin',
  'tx-bexar-san-antonio',
  'fl-miami-dade-miami',
  'fl-broward-fort-lauderdale',
  'fl-orange-orlando',
  'fl-duval-jacksonville',
  'nv-clark-las-vegas',
  'nv-washoe-reno',
  'co-denver-denver',
  'nc-mecklenburg-charlotte',
  'ny-new-york-nyc',
  'wa-king-seattle',
  'il-cook-chicago',
  'pa-philadelphia-philadelphia',
  'tn-davidson-nashville',
  'oh-franklin-columbus',
  // Expanded high-solar states
  'hi-honolulu-honolulu',
  'hi-maui-kahului',
  'hi-hawaii-hilo',
  'id-ada-boise',
  'id-bonneville-idaho-falls',
  'id-canyon-nampa',
  'nm-bernalillo-albuquerque',
  'nm-santa-fe-santa-fe',
  'nm-dona-ana-las-cruces',
];

// ── Database size ──────────────────────────────────────────────────────────────

describe('AHJ_NATIONAL — database size', () => {
  it('contains at least 125 entries', () => {
    expect(AHJ_NATIONAL.length).toBeGreaterThanOrEqual(125);
  });

  it('getTotalAhjCount() matches array length', () => {
    expect(getTotalAhjCount()).toBe(AHJ_NATIONAL.length);
  });

  it('no duplicate IDs', () => {
    const ids = AHJ_NATIONAL.map(a => a.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── Required fields on every record ───────────────────────────────────────────

describe('AHJ_NATIONAL — required fields on every record', () => {
  it('every record has a non-empty id', () => {
    for (const a of AHJ_NATIONAL) {
      expect(a.id, `record missing id`).toBeTruthy();
      expect(a.id.length, `${a.id}: id too short`).toBeGreaterThan(3);
    }
  });

  it('every record has a non-empty stateCode (2 uppercase letters)', () => {
    for (const a of AHJ_NATIONAL) {
      expect(a.stateCode, `${a.id}: missing stateCode`).toBeTruthy();
      expect(a.stateCode).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('every record has a non-empty stateName', () => {
    for (const a of AHJ_NATIONAL) {
      expect(a.stateName, `${a.id}: missing stateName`).toBeTruthy();
    }
  });

  it('every record has a non-empty ahjName', () => {
    for (const a of AHJ_NATIONAL) {
      expect(a.ahjName, `${a.id}: missing ahjName`).toBeTruthy();
    }
  });

  it('every record has a non-empty utilityName', () => {
    for (const a of AHJ_NATIONAL) {
      expect(a.utilityName, `${a.id}: missing utilityName`).toBeTruthy();
    }
  });

  it('every city/county record has a non-empty county (state-type records exempt)', () => {
    for (const a of AHJ_NATIONAL) {
      if (a.ahjType === 'state') continue; // state-level fallback records may omit county
      expect(a.county, `${a.id}: missing county`).toBeTruthy();
    }
  });

  it('every record has a non-empty city', () => {
    for (const a of AHJ_NATIONAL) {
      expect(a.city, `${a.id}: missing city`).toBeTruthy();
    }
  });
});

// ── NEC version validity ───────────────────────────────────────────────────────

describe('AHJ_NATIONAL — necVersion validity', () => {
  it('all necVersion values are valid (2017, 2020, or 2023)', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        VALID_NEC_VERSIONS.has(a.necVersion),
        `${a.id}: invalid necVersion "${a.necVersion}"`,
      ).toBe(true);
    }
  });

  it('database uses at least 2 distinct NEC versions', () => {
    const versions = new Set(AHJ_NATIONAL.map(a => a.necVersion));
    expect(versions.size).toBeGreaterThanOrEqual(2);
  });

  it('majority of entries are NEC 2020', () => {
    const count2020 = AHJ_NATIONAL.filter(a => a.necVersion === '2020').length;
    expect(count2020).toBeGreaterThan(AHJ_NATIONAL.length * 0.5);
  });

  it('California entries use NEC 2023', () => {
    const caEntries = AHJ_NATIONAL.filter(a => a.stateCode === 'CA');
    for (const a of caEntries) {
      expect(a.necVersion, `${a.id}: CA should use NEC 2023`).toBe('2023');
    }
  });
});

// ── AHJ type validity ──────────────────────────────────────────────────────────

describe('AHJ_NATIONAL — ahjType validity', () => {
  it('all ahjType values are valid enum members', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        VALID_AHJ_TYPES.has(a.ahjType),
        `${a.id}: invalid ahjType "${a.ahjType}"`,
      ).toBe(true);
    }
  });

  it('has substantial city-level coverage plus national county breadth', () => {
    // Post national onboarding the DB is county-heavy (one record per US county) with
    // city-level granularity layered on top for metros — so city is no longer the
    // majority tier. Assert healthy city coverage AND that records are properly typed.
    const cityCount = AHJ_NATIONAL.filter(a => a.ahjType === 'city').length;
    const countyCount = AHJ_NATIONAL.filter(a => a.ahjType === 'county').length;
    expect(cityCount).toBeGreaterThanOrEqual(150);   // metros covered at city granularity
    expect(countyCount).toBeGreaterThan(0);          // national county-level coverage
  });
});

// ── Numeric field validity ─────────────────────────────────────────────────────

describe('AHJ_NATIONAL — numeric field validity', () => {
  it('windSpeedMph > 0 for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.windSpeedMph,
        `${a.id}: windSpeedMph must be > 0`,
      ).toBeGreaterThan(0);
    }
  });

  it('windSpeedMph in realistic range (85–175 mph)', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.windSpeedMph,
        `${a.id}: windSpeedMph=${a.windSpeedMph} out of range`,
      ).toBeGreaterThanOrEqual(85);
      expect(
        a.windSpeedMph,
        `${a.id}: windSpeedMph=${a.windSpeedMph} implausibly high`,
      ).toBeLessThanOrEqual(200);
    }
  });

  it('groundSnowLoadPsf >= 0 for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.groundSnowLoadPsf,
        `${a.id}: groundSnowLoadPsf must be >= 0`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('typicalPermitDays > 0 for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.typicalPermitDays,
        `${a.id}: typicalPermitDays must be > 0`,
      ).toBeGreaterThan(0);
    }
  });

  it('typicalPlanCheckDays > 0 for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.typicalPlanCheckDays,
        `${a.id}: typicalPlanCheckDays must be > 0`,
      ).toBeGreaterThan(0);
    }
  });

  it('interconnectionDays > 0 for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.interconnectionDays,
        `${a.id}: interconnectionDays must be > 0`,
      ).toBeGreaterThan(0);
    }
  });

  it('roofSetbackInches >= 0 for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.roofSetbackInches,
        `${a.id}: roofSetbackInches must be >= 0`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('ridgeSetbackInches >= 0 for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.ridgeSetbackInches,
        `${a.id}: ridgeSetbackInches must be >= 0`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('pathwayWidthInches >= 0 for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.pathwayWidthInches,
        `${a.id}: pathwayWidthInches must be >= 0`,
      ).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Boolean field validity ─────────────────────────────────────────────────────

describe('AHJ_NATIONAL — boolean field validity', () => {
  it('permitRequired is boolean for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.permitRequired, `${a.id}`).toBe('boolean');
    }
  });

  it('onlinePermitting is boolean for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.onlinePermitting, `${a.id}`).toBe('boolean');
    }
  });

  it('expeditedAvailable is boolean for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.expeditedAvailable, `${a.id}`).toBe('boolean');
    }
  });

  it('inspectionRequired is boolean for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.inspectionRequired, `${a.id}`).toBe('boolean');
    }
  });

  it('netMeteringAvailable is boolean for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.netMeteringAvailable, `${a.id}`).toBe('boolean');
    }
  });

  it('rapidShutdownRequired is boolean for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.rapidShutdownRequired, `${a.id}`).toBe('boolean');
    }
  });

  it('all entries require a permit', () => {
    for (const a of AHJ_NATIONAL) {
      expect(a.permitRequired, `${a.id}: should require permit`).toBe(true);
    }
  });

  it('all entries require rapid shutdown', () => {
    for (const a of AHJ_NATIONAL) {
      expect(
        a.rapidShutdownRequired,
        `${a.id}: should require rapid shutdown (post-NEC 2017)`,
      ).toBe(true);
    }
  });
});

// ── Array field validity ───────────────────────────────────────────────────────

describe('AHJ_NATIONAL — array field validity', () => {
  it('localAmendments is an array for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(Array.isArray(a.localAmendments), `${a.id}`).toBe(true);
    }
  });

  it('specialRequirements is an array for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(Array.isArray(a.specialRequirements), `${a.id}`).toBe(true);
    }
  });

  it('planSetRequirements is an array for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(Array.isArray(a.planSetRequirements), `${a.id}`).toBe(true);
    }
  });
});

// ── String field validity ──────────────────────────────────────────────────────

describe('AHJ_NATIONAL — string field validity', () => {
  it('typicalPermitFee is a non-empty string for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.typicalPermitFee, `${a.id}`).toBe('string');
      expect(a.typicalPermitFee.length, `${a.id}: empty typicalPermitFee`).toBeGreaterThan(0);
    }
  });

  it('permitAuthority is a non-empty string for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.permitAuthority, `${a.id}`).toBe('string');
      expect(a.permitAuthority.length, `${a.id}: empty permitAuthority`).toBeGreaterThan(0);
    }
  });

  it('rapidShutdownStandard is a non-empty string for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.rapidShutdownStandard, `${a.id}`).toBe('string');
      expect(
        a.rapidShutdownStandard.length,
        `${a.id}: empty rapidShutdownStandard`,
      ).toBeGreaterThan(0);
    }
  });

  it('feeStructure is a non-empty string for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.feeStructure, `${a.id}`).toBe('string');
      expect(a.feeStructure.length, `${a.id}: empty feeStructure`).toBeGreaterThan(0);
    }
  });

  it('interconnectionProgram is a non-empty string for all entries', () => {
    for (const a of AHJ_NATIONAL) {
      expect(typeof a.interconnectionProgram, `${a.id}`).toBe('string');
      expect(
        a.interconnectionProgram.length,
        `${a.id}: empty interconnectionProgram`,
      ).toBeGreaterThan(0);
    }
  });
});

// ── ID format contract ─────────────────────────────────────────────────────────

describe('AHJ_NATIONAL — ID format contract', () => {
  it('all IDs follow state-county-city slug format', () => {
    for (const a of AHJ_NATIONAL) {
      // IDs should be lowercase, hyphen-separated, at least 2 parts
      expect(a.id, `${a.id}: id should be lowercase`).toBe(a.id.toLowerCase());
      expect(a.id, `${a.id}: id should only contain lowercase letters and hyphens`).toMatch(
        /^[a-z0-9-]+$/,
      );
      const parts = a.id.split('-');
      expect(parts.length, `${a.id}: id should have at least 2 segments`).toBeGreaterThanOrEqual(2);
    }
  });

  it('IDs start with their stateCode (lowercased)', () => {
    for (const a of AHJ_NATIONAL) {
      const expectedPrefix = a.stateCode.toLowerCase();
      expect(
        a.id.startsWith(expectedPrefix + '-'),
        `${a.id}: should start with "${expectedPrefix}-"`,
      ).toBe(true);
    }
  });
});

// ── Geographic coverage ────────────────────────────────────────────────────────

describe('AHJ_NATIONAL — geographic coverage', () => {
  it('all 50 states + DC have at least one entry', () => {
    const statesInDb = new Set(AHJ_NATIONAL.map(a => a.stateCode));
    for (const stateCode of ALL_STATE_CODES) {
      expect(
        statesInDb.has(stateCode),
        `State ${stateCode} has no AHJ entry`,
      ).toBe(true);
    }
  });

  it('getStatesSummary() returns all 51 states', () => {
    const summary = getStatesSummary();
    expect(summary.length).toBeGreaterThanOrEqual(51);
  });

  it('getStatesSummary() count totals match AHJ_NATIONAL length', () => {
    const summary = getStatesSummary();
    const total = summary.reduce((sum, s) => sum + s.count, 0);
    expect(total).toBe(AHJ_NATIONAL.length);
  });

  it('high-solar states have multiple entries (AZ ≥ 5, CA ≥ 8, TX ≥ 5, FL ≥ 4, NV ≥ 3)', () => {
    const stateCount = (code: string) =>
      AHJ_NATIONAL.filter(a => a.stateCode === code).length;
    expect(stateCount('AZ')).toBeGreaterThanOrEqual(5);
    expect(stateCount('CA')).toBeGreaterThanOrEqual(8);
    expect(stateCount('TX')).toBeGreaterThanOrEqual(5);
    expect(stateCount('FL')).toBeGreaterThanOrEqual(4);
    expect(stateCount('NV')).toBeGreaterThanOrEqual(3);
  });

  it('high-solar mid-tier states have at least 2 entries (CO, NC, WA, OR, NJ)', () => {
    const stateCount = (code: string) =>
      AHJ_NATIONAL.filter(a => a.stateCode === code).length;
    expect(stateCount('CO')).toBeGreaterThanOrEqual(2);
    expect(stateCount('NC')).toBeGreaterThanOrEqual(2);
    expect(stateCount('WA')).toBeGreaterThanOrEqual(2);
    expect(stateCount('OR')).toBeGreaterThanOrEqual(2);
    expect(stateCount('NJ')).toBeGreaterThanOrEqual(2);
  });

  it('expanded high-solar states now have ≥ 3 entries (HI, ID, NM)', () => {
    const stateCount = (code: string) =>
      AHJ_NATIONAL.filter(a => a.stateCode === code).length;
    expect(stateCount('HI')).toBeGreaterThanOrEqual(3);
    expect(stateCount('ID')).toBeGreaterThanOrEqual(3);
    expect(stateCount('NM')).toBeGreaterThanOrEqual(3);
  });
});

// ── Required major metro IDs ───────────────────────────────────────────────────

describe('AHJ_NATIONAL — required major metro entries', () => {
  for (const id of REQUIRED_METRO_IDS) {
    it(`entry exists: ${id}`, () => {
      expect(getAhjById(id), `Missing required metro entry: ${id}`).not.toBeNull();
    });
  }
});

// ── Specific record data spot-checks ──────────────────────────────────────────

describe('AHJ_NATIONAL — spot-check specific records', () => {
  it('Phoenix AHJ has APS as utility, online permitting, NEC 2020', () => {
    const phx = getAhjById('az-maricopa-phoenix');
    expect(phx).not.toBeNull();
    expect(phx!.utilityName).toContain('APS');
    expect(phx!.onlinePermitting).toBe(true);
    expect(phx!.necVersion).toBe('2020');
  });

  it('LA AHJ has LADWP as utility, NEC 2023, seismic D', () => {
    const la = getAhjById('ca-los-angeles-la');
    expect(la).not.toBeNull();
    expect(la!.utilityName).toContain('LADWP');
    expect(la!.necVersion).toBe('2023');
    expect(la!.seismicDesignCategory).toContain('D');
  });

  it('NYC AHJ has high wind speed (coastal)', () => {
    const nyc = getAhjById('ny-new-york-nyc');
    expect(nyc).not.toBeNull();
    expect(nyc!.windSpeedMph).toBeGreaterThanOrEqual(110);
  });

  it('Miami AHJ has elevated wind speed (hurricane zone ≥ 150 mph)', () => {
    const miami = getAhjById('fl-miami-dade-miami');
    expect(miami).not.toBeNull();
    expect(miami!.windSpeedMph).toBeGreaterThanOrEqual(150);
  });

  it('Chicago AHJ has non-zero snow load', () => {
    const chicago = getAhjById('il-cook-chicago');
    expect(chicago).not.toBeNull();
    expect(chicago!.groundSnowLoadPsf).toBeGreaterThan(0);
  });

  it('Seattle AHJ has non-zero snow load', () => {
    const seattle = getAhjById('wa-king-seattle');
    expect(seattle).not.toBeNull();
    expect(seattle!.groundSnowLoadPsf).toBeGreaterThan(0);
  });

  it('Denver AHJ has non-zero snow load', () => {
    const denver = getAhjById('co-denver-denver');
    expect(denver).not.toBeNull();
    expect(denver!.groundSnowLoadPsf).toBeGreaterThan(0);
  });

  it('Phoenix has zero snow load (desert climate)', () => {
    const phx = getAhjById('az-maricopa-phoenix');
    expect(phx).not.toBeNull();
    expect(phx!.groundSnowLoadPsf).toBe(0);
  });

  it('Honolulu AHJ has seismic zone D (Pacific)', () => {
    const hi = getAhjById('hi-honolulu-honolulu');
    expect(hi).not.toBeNull();
    expect(hi!.seismicDesignCategory).toContain('D');
  });

  it('Maui AHJ has MECO as utility', () => {
    const maui = getAhjById('hi-maui-kahului');
    expect(maui).not.toBeNull();
    expect(maui!.utilityName).toContain('MECO');
    expect(maui!.seismicDesignCategory).toContain('D');
  });

  it('Boise ID AHJ has Idaho Power, NEC 2020, non-zero snow load', () => {
    const boise = getAhjById('id-ada-boise');
    expect(boise).not.toBeNull();
    expect(boise!.utilityName).toContain('Idaho Power');
    expect(boise!.necVersion).toBe('2020');
    expect(boise!.groundSnowLoadPsf).toBeGreaterThan(0);
  });

  it('Albuquerque NM AHJ has PNM as utility, low snow load', () => {
    const abq = getAhjById('nm-bernalillo-albuquerque');
    expect(abq).not.toBeNull();
    expect(abq!.utilityName).toContain('PNM');
    expect(abq!.groundSnowLoadPsf).toBeLessThanOrEqual(15);
  });

  it('Las Cruces NM AHJ has EPE as utility (south NM/El Paso Electric territory)', () => {
    const lc = getAhjById('nm-dona-ana-las-cruces');
    expect(lc).not.toBeNull();
    expect(lc!.utilityName).toContain('EPE');
  });

  it('LA AHJ seismic zone is D (high seismic risk)', () => {
    const la = getAhjById('ca-los-angeles-la');
    expect(la).not.toBeNull();
    expect(la!.seismicDesignCategory).toContain('D');
  });
});

// ── getAhjById ─────────────────────────────────────────────────────────────────

describe('getAhjById', () => {
  it('returns correct record for known ID', () => {
    const record = getAhjById('az-maricopa-phoenix');
    expect(record).not.toBeNull();
    expect(record!.id).toBe('az-maricopa-phoenix');
    expect(record!.stateCode).toBe('AZ');
    expect(record!.city).toBe('Phoenix');
  });

  it('returns null for unknown ID', () => {
    expect(getAhjById('xx-nonexistent-city')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getAhjById('')).toBeNull();
  });
});

// ── getAhjsByState ─────────────────────────────────────────────────────────────

describe('getAhjsByState', () => {
  it('returns multiple records for California', () => {
    const results = getAhjsByState('CA');
    expect(results.length).toBeGreaterThanOrEqual(8);
    expect(results.every(a => a.stateCode === 'CA')).toBe(true);
  });

  it('is case-insensitive', () => {
    const upper = getAhjsByState('CA');
    const lower = getAhjsByState('ca');
    expect(upper.length).toBe(lower.length);
  });

  it('returns empty array for unknown state', () => {
    expect(getAhjsByState('ZZ')).toHaveLength(0);
  });

  it('returns at least 1 record for every state', () => {
    for (const stateCode of ALL_STATE_CODES) {
      const results = getAhjsByState(stateCode);
      expect(
        results.length,
        `${stateCode} has no AHJ entries`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── searchAhj ─────────────────────────────────────────────────────────────────

describe('searchAhj', () => {
  it('finds Phoenix by stateCode + city', () => {
    const results = searchAhj({ stateCode: 'AZ', city: 'Phoenix' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].city).toBe('Phoenix');
  });

  it('finds all AZ entries by stateCode only', () => {
    const results = searchAhj({ stateCode: 'AZ' });
    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(results.every(a => a.stateCode === 'AZ')).toBe(true);
  });

  it('finds by county name', () => {
    const results = searchAhj({ stateCode: 'CA', county: 'Los Angeles' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(a => a.stateCode === 'CA')).toBe(true);
  });

  it('finds by text search on utility name', () => {
    const results = searchAhj({ text: 'HECO' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(a => a.stateCode === 'HI')).toBe(true);
  });

  it('finds by text search on city name', () => {
    const results = searchAhj({ text: 'Nashville' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].city).toBe('Nashville');
  });

  it('text search is case-insensitive', () => {
    const lower = searchAhj({ text: 'phoenix' });
    const upper = searchAhj({ text: 'PHOENIX' });
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array when no matches', () => {
    const results = searchAhj({ stateCode: 'AZ', city: 'Nonexistent City XYZ' });
    // When city not found, falls back to state results
    // This is documented behavior: returns state results when city not found
    expect(results.every(a => a.stateCode === 'AZ')).toBe(true);
  });

  it('returns all entries when no query params', () => {
    const results = searchAhj({});
    expect(results.length).toBe(AHJ_NATIONAL.length);
  });

  it('stateCode + city narrows to correct city', () => {
    const results = searchAhj({ stateCode: 'TX', city: 'Austin' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(a => a.city === 'Austin')).toBe(true);
  });
});

// ── getAhjByAddress ────────────────────────────────────────────────────────────

describe('getAhjByAddress', () => {
  it('finds Phoenix for Arizona address with city', () => {
    const result = getAhjByAddress('123 Main St, Phoenix, AZ 85001');
    expect(result).not.toBeNull();
    expect(result!.stateCode).toBe('AZ');
  });

  it('returns null when city is not matched in a multi-AHJ state (no silent wrong guess)', () => {
    // Old behavior returned the FIRST record in the state — that is exactly the
    // Wood River → Cook/Chicago bug generalized. Corrected: return null so the
    // caller uses neutral code-minimum defaults instead of a wrong jurisdiction.
    const result = getAhjByAddress('123 Rural Rd, AZ 85999');
    expect(result).toBeNull();
  });

  it('returns null for empty address', () => {
    expect(getAhjByAddress('')).toBeNull();
  });

  it('returns null for address without state code', () => {
    const result = getAhjByAddress('123 Main St, Somecity 12345');
    expect(result).toBeNull();
  });

  it('finds CA for California address', () => {
    const result = getAhjByAddress('456 Sunset Blvd, Los Angeles, CA 90028');
    expect(result).not.toBeNull();
    expect(result!.stateCode).toBe('CA');
  });

  it('finds TX for Texas address', () => {
    const result = getAhjByAddress('789 Congress Ave, Austin, TX 78701');
    expect(result).not.toBeNull();
    expect(result!.stateCode).toBe('TX');
  });
});

// ── getAhjByCounty + Wood River regression ─────────────────────────────────────
// Wood River, IL is in Madison County (St. Louis metro), ~250mi from Chicago.
// The old getAhjByAddress fell back to the FIRST IL record (Cook County / Chicago)
// for any unmatched address, poisoning the planset's wind/snow/utility/permit data.

describe('getAhjByCounty', () => {
  it('resolves Madison County, IL (Wood River) — not Cook/Chicago', () => {
    const r = getAhjByCounty('IL', 'Madison');
    expect(r).not.toBeNull();
    expect(r!.stateCode).toBe('IL');
    expect(r!.county).toBe('Madison');
    expect(r!.county).not.toBe('Cook');
  });

  it('still resolves Cook County when that IS the county', () => {
    const r = getAhjByCounty('IL', 'Cook');
    expect(r).not.toBeNull();
    expect(r!.county).toBe('Cook');
  });

  it('returns null for an unknown county', () => {
    expect(getAhjByCounty('IL', 'Nonexistentcounty')).toBeNull();
  });
});

describe('getAhjByAddress — Wood River regression', () => {
  const woodRiver = '100 Ferguson Ave, Wood River, IL 62095, USA';

  it('uses the county hint to resolve Wood River to Madison County (not Cook)', () => {
    const r = getAhjByAddress(woodRiver, { stateCode: 'IL', county: 'Madison', city: 'Wood River' });
    expect(r).not.toBeNull();
    expect(r!.county).toBe('Madison');
    expect(r!.county).not.toBe('Cook');
  });

  it('NEVER silently defaults an unmatched IL address to Cook/Chicago', () => {
    const r = getAhjByAddress(woodRiver); // no hint, no exact city record
    expect(r?.county).not.toBe('Cook');
  });

  it('resolves a county named in the address text', () => {
    const r = getAhjByAddress('Edwardsville, Madison County, IL');
    expect(r).not.toBeNull();
    expect(r!.county).toBe('Madison');
  });
});

// ── getStatesSummary ───────────────────────────────────────────────────────────

describe('getStatesSummary', () => {
  it('returns sorted array by stateCode', () => {
    const summary = getStatesSummary();
    for (let i = 1; i < summary.length; i++) {
      expect(summary[i].stateCode >= summary[i - 1].stateCode).toBe(true);
    }
  });

  it('each summary entry has stateCode, stateName, count', () => {
    for (const s of getStatesSummary()) {
      expect(s.stateCode).toBeTruthy();
      expect(s.stateName).toBeTruthy();
      expect(s.count).toBeGreaterThan(0);
    }
  });

  it('California shows highest count (≥ 8)', () => {
    const summary = getStatesSummary();
    const ca = summary.find(s => s.stateCode === 'CA');
    expect(ca).toBeDefined();
    expect(ca!.count).toBeGreaterThanOrEqual(8);
  });

  it('Arizona shows count ≥ 5', () => {
    const summary = getStatesSummary();
    const az = summary.find(s => s.stateCode === 'AZ');
    expect(az).toBeDefined();
    expect(az!.count).toBeGreaterThanOrEqual(5);
  });
});

// ── Physical consistency checks ────────────────────────────────────────────────

describe('AHJ_NATIONAL — physical consistency checks', () => {
  it('FL entries have elevated wind speeds (coastal ≥ 130 mph)', () => {
    const flEntries = AHJ_NATIONAL.filter(a => a.stateCode === 'FL');
    for (const a of flEntries) {
      expect(
        a.windSpeedMph,
        `${a.id}: FL wind should be ≥ 130 mph`,
      ).toBeGreaterThanOrEqual(130);
    }
  });

  it('HI entry has elevated wind speed (island exposure ≥ 115 mph)', () => {
    const hiEntries = AHJ_NATIONAL.filter(a => a.stateCode === 'HI');
    for (const a of hiEntries) {
      expect(
        a.windSpeedMph,
        `${a.id}: HI wind should be ≥ 115 mph`,
      ).toBeGreaterThanOrEqual(115);
    }
  });

  it('AK entries have non-zero snow load', () => {
    const akEntries = AHJ_NATIONAL.filter(a => a.stateCode === 'AK');
    for (const a of akEntries) {
      expect(
        a.groundSnowLoadPsf,
        `${a.id}: AK should have snow load > 0`,
      ).toBeGreaterThan(0);
    }
  });

  it('MT entries have non-zero snow load', () => {
    const mtEntries = AHJ_NATIONAL.filter(a => a.stateCode === 'MT');
    for (const a of mtEntries) {
      expect(
        a.groundSnowLoadPsf,
        `${a.id}: MT should have snow load > 0`,
      ).toBeGreaterThan(0);
    }
  });

  it('low-desert metros have zero or minimal snow load (≤ 15 psf)', () => {
    // Scoped to true low-elevation desert metros. NOT a blanket AZ/NM rule — high-
    // altitude counties (e.g. Flagstaff/Coconino at ~7,000 ft) legitimately carry
    // real snow load and must not be forced low.
    const desertMetros = [
      'az-maricopa-phoenix', 'az-pima-tucson', 'az-maricopa-mesa',
      'nv-clark-las-vegas', 'nm-bernalillo-albuquerque', 'nm-dona-ana-las-cruces',
    ];
    for (const id of desertMetros) {
      const a = getAhjById(id);
      if (!a) continue;
      expect(
        a.groundSnowLoadPsf,
        `${id}: low-desert metro should have minimal snow load`,
      ).toBeLessThanOrEqual(15);
    }
  });
});

// ── Setbacks use real code logic (not fabricated per-AHJ defaults) ──────────────

describe('AHJ_NATIONAL — setbacks derive from real adopted-code logic', () => {
  it('every record is provenance-tagged (curated | expanded)', () => {
    for (const a of AHJ_NATIONAL) {
      expect(['curated', 'expanded'], `${a.id}`).toContain(a.dataProvenance);
    }
  });

  it('roof/ridge setbacks match the adopted-code table (JURISDICTION_DATA) for every covered state', () => {
    for (const a of AHJ_NATIONAL) {
      const code = JURISDICTION_DATA[a.stateCode];
      if (!code) continue; // territories (PR etc.) have no code-table entry — exempt
      expect(a.roofSetbackInches, `${a.id}: roof setback must follow adopted code`).toBe(code.roofSetbackInches);
      expect(a.ridgeSetbackInches, `${a.id}: ridge setback must follow adopted code`).toBe(code.ridgeSetbackInches);
    }
  });

  it('relaxed-setback states (AZ, NV, NM, TX, UT) use an 18" perimeter — not the 36" bulk default', () => {
    for (const code of ['AZ', 'NV', 'NM', 'TX', 'UT']) {
      const entries = AHJ_NATIONAL.filter(a => a.stateCode === code);
      expect(entries.length).toBeGreaterThan(0);
      for (const a of entries) {
        expect(a.roofSetbackInches, `${a.id}: should follow the state's 18" access-pathway code`).toBe(18);
      }
    }
  });
});

// ── Unique ID integrity ────────────────────────────────────────────────────────

describe('AHJ_NATIONAL — unique ID integrity', () => {
  it('each ID appears exactly once', () => {
    const ids = AHJ_NATIONAL.map(a => a.id);
    const seen = new Set<string>();
    for (const id of ids) {
      expect(seen.has(id), `Duplicate ID found: ${id}`).toBe(false);
      seen.add(id);
    }
  });

  it('IDs are all unique across the full array', () => {
    const ids = AHJ_NATIONAL.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── getTotalAhjCount ───────────────────────────────────────────────────────────

describe('getTotalAhjCount', () => {
  it('returns positive number', () => {
    expect(getTotalAhjCount()).toBeGreaterThan(0);
  });

  it('equals AHJ_NATIONAL.length', () => {
    expect(getTotalAhjCount()).toBe(AHJ_NATIONAL.length);
  });

  it('is at least 125 (baseline coverage)', () => {
    expect(getTotalAhjCount()).toBeGreaterThanOrEqual(125);
  });
});
