// ═══════════════════════════════════════════════════════════════════════════
// A KNOWN JURISDICTION WE HAVE NO ROW FOR IS A GAP, NOT A REASON TO GUESS.
//
// SolarPro holds ~4,000 AHJ rows against ~19,500 municipalities, so nationally
// the ORDINARY outcome is: the boundary layer resolves cleanly, names the
// governing municipality, and the registry has no record for it. That state
// must terminate resolution — carrying the name of the authority we are missing
// — and must never fall through to the county, the postal city, or a stored
// name written by an earlier lookup.
//
// The synthetic jurisdictions below use deliberately impossible names so no
// real registry row can satisfy these tests, now or after the registry grows.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { resolveAhjRecordTraced, buildCodeAuthority } from '@/lib/permit/snapshot/codeAuthority';

const ABSENT_PLACE = 'Zzzqx Springs';
const ABSENT_COUNTY = 'Zzzqx';

describe('boundary established + record missing', () => {
  it('does not bind the county when the parcel is inside an incorporated place', () => {
    // THE REGRESSION. This used to fall through to getAhjByCounty and return
    // the county building department for a parcel proven to be inside a city.
    const r = resolveAhjRecordTraced({
      stateCode: 'IL',
      county: 'Madison',                 // a county we DO hold a record for
      city: 'Granite City',
      boundary: { resolved: true, unincorporated: false, incorporatedPlace: ABSENT_PLACE },
    });
    expect(r.record).toBeNull();
    expect(r.matchMethod).toBe('boundary-established-record-missing');
    expect(r.missingAuthorityFor).toContain(ABSENT_PLACE);
    expect(r.incorporated).toBe(true);
  });

  it('does not bind a municipality when the parcel is proven unincorporated', () => {
    const r = resolveAhjRecordTraced({
      stateCode: 'IL',
      county: ABSENT_COUNTY,
      city: 'Chicago',                   // a city we DO hold a record for
      boundary: { resolved: true, unincorporated: true, incorporatedPlace: null },
    });
    expect(r.record).toBeNull();
    expect(r.matchMethod).toBe('boundary-established-record-missing');
    expect(r.missingAuthorityFor).toContain(ABSENT_COUNTY);
    expect(r.incorporated).toBe(false);
  });

  it('a stored AHJ name cannot override the boundary determination', () => {
    // The permit route historically force-wrote this field from a mailing-city
    // search. It must not resurrect a government the boundary layer excluded.
    const r = resolveAhjRecordTraced({
      stateCode: 'IL',
      ahjName: 'City of Chicago Department of Buildings',
      ahjRecordId: 'il-cook-chicago',
      county: 'Madison',
      city: 'Granite City',
      boundary: { resolved: true, unincorporated: false, incorporatedPlace: ABSENT_PLACE },
    });
    expect(r.record).toBeNull();
    expect(r.matchMethod).toBe('boundary-established-record-missing');
  });

  it('still binds normally when the record DOES exist', () => {
    // The rule must not make the covered case worse.
    const r = resolveAhjRecordTraced({
      stateCode: 'IL', county: 'Madison', city: 'Granite City',
      boundary: { resolved: true, unincorporated: false, incorporatedPlace: 'Granite City' },
    });
    expect(r.record?.id).toBe('il-madison-granite-city');
    expect(r.matchMethod).toBe('incorporated-city');
    expect(r.missingAuthorityFor).toBeNull();
  });

  it('an UNRESOLVED boundary still uses the hint chain', () => {
    // The new rule is scoped to a RESOLVED determination. Where geography is
    // genuinely unknown, the previous behaviour is correct and unchanged.
    const r = resolveAhjRecordTraced({
      stateCode: 'IL', county: 'Madison', city: 'Granite City',
      boundary: { resolved: false, unincorporated: null, incorporatedPlace: null },
    });
    expect(r.record).not.toBeNull();
    expect(r.matchMethod).not.toBe('boundary-established-record-missing');
  });
});

describe('a stored record id is only explicit about the RECORD', () => {
  it('refuses an id that names a record in another state', () => {
    // An Illinois project carrying a stale 'ca-los-angeles-la' — a copied
    // project, a bad import, an id left by an earlier resolution — used to bind
    // City of Los Angeles LADBS and label it 'explicit-record-id', the
    // highest-confidence method in the function. Every other branch is
    // state-scoped; this one was not.
    const r = resolveAhjRecordTraced({
      ahjRecordId: 'ca-los-angeles-la',
      stateCode: 'IL', county: 'Madison', city: 'Granite City',
      address: '3 Melvin Dr, Granite City, IL 62040',
    });
    expect(r.record?.stateCode).toBe('IL');
    expect(r.matchMethod).not.toBe('explicit-record-id');
    // The rejection is carried, not dropped — a cross-state id is a symptom.
    expect(r.rejectedRecordId).toBe('ca-los-angeles-la');
  });

  it('still honours an id in the project’s own state', () => {
    const r = resolveAhjRecordTraced({
      ahjRecordId: 'il-madison-granite-city',
      stateCode: 'IL', county: 'Madison', city: 'Granite City',
    });
    expect(r.matchMethod).toBe('explicit-record-id');
    expect(r.rejectedRecordId).toBeNull();
  });

  it('honours an id when the project states no state to disagree with', () => {
    const r = resolveAhjRecordTraced({ ahjRecordId: 'ca-los-angeles-la' });
    expect(r.record?.id).toBe('ca-los-angeles-la');
    expect(r.matchMethod).toBe('explicit-record-id');
  });

  it('never returns a record from a state other than the project’s', () => {
    // The general invariant, swept across states: whatever the hints say, the
    // bound record must belong to the project's state.
    const STATES = ['IL', 'TX', 'CA', 'NY', 'FL', 'OH', 'MO', 'WA'];
    const offenders: string[] = [];
    for (const st of STATES) {
      for (const staleId of ['ca-los-angeles-la', 'tx-harris-houston', 'ny-new-york-new-york']) {
        const r = resolveAhjRecordTraced({
          ahjRecordId: staleId, stateCode: st, county: 'Madison', city: 'Springfield',
        });
        if (r.record && r.record.stateCode.toUpperCase() !== st) {
          offenders.push(`${st} + ${staleId} -> ${r.record.id}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the code authority reports the gap by name', () => {
  const resolution = resolveAhjRecordTraced({
    stateCode: 'IL', county: 'Madison', city: 'Granite City',
    ahjName: 'Madison County Building & Zoning',
    boundary: { resolved: true, unincorporated: false, incorporatedPlace: ABSENT_PLACE },
  });

  it('names the authority it is missing', () => {
    const ca = buildCodeAuthority({
      ahjRecord: resolution.record,
      ahjResolution: resolution,
      ahjNameHint: 'Madison County Building & Zoning',
      stateCodeHint: 'IL',
      capturedAtIso: '2026-08-30T00:00:00.000Z',
    });
    const notes = ca.applicabilityNotes.join(' | ');
    expect(notes).toContain(ABSENT_PLACE);
    expect(notes).toMatch(/no AHJ record/i);
    expect(notes).toMatch(/substituted/i);
  });

  it('does not print the stored name of a different government', () => {
    const ca = buildCodeAuthority({
      ahjRecord: resolution.record,
      ahjResolution: resolution,
      // the stored hint names the COUNTY — the very authority the boundary
      // determination ruled out.
      ahjNameHint: 'Madison County Building & Zoning',
      stateCodeHint: 'IL',
      capturedAtIso: '2026-08-30T00:00:00.000Z',
    });
    expect(ca.ahjName).toBeNull();
  });

  it('still uses the hint when no boundary determination was made', () => {
    const unresolved = resolveAhjRecordTraced({
      stateCode: 'ZZ',                 // no records at all for this state
      boundary: { resolved: false, unincorporated: null, incorporatedPlace: null },
    });
    const ca = buildCodeAuthority({
      ahjRecord: unresolved.record,
      ahjResolution: unresolved,
      ahjNameHint: 'Some Stored Name',
      stateCodeHint: 'ZZ',
      capturedAtIso: '2026-08-30T00:00:00.000Z',
    });
    expect(ca.ahjName).toBe('Some Stored Name');
  });
});
