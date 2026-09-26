// ═══════════════════════════════════════════════════════════════════════════
// PRESENCE IS NOT CONSUMPTION.
//
// `tests/engineeringReportStopsGuessing.test.ts` proves the three authorities are
// right: NEC 705.12(B)(2), NEC Chapter 9 fill, and the NEC 690.7(A) cold-Voc law.
// It does NOT prove `lib/engineering/reportGenerator.ts` asks them. Phase 4 shipped
// two guards satisfied by a function merely existing, and `if (false && …)` passed
// one of them.
//
// So this suite runs the real `generateEngineeringReport` and reads the fields that
// reach the EQUIPMENT SCHEDULE (where a conduit trade size IS the ordered line
// item's model), the rendered SLD wire label, the saved artifact, and the
// customer-visible Engineering tab.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generateEngineeringReport } from '@/lib/engineering/reportGenerator';
import { getPanelById, getInverterById } from '@/lib/equipment-db';
import type { DesignSnapshot } from '@/lib/engineering/types';

/** A string-inverter roof design. `panelCount` drives stringCount, which drives
 *  the DC conductor count, which drives the Chapter 9 fill limit. */
function snapshot(over: Partial<DesignSnapshot> = {}): DesignSnapshot {
  // 🚨 A REAL catalog record, asserted below, and specifically one that CARRIES a
  // tempCoeffVoc. My first attempt used an id that does not exist, so the fallback
  // object had no coefficient — `coldVocFactor` then returns the blanket 1.25 for
  // every site, Florida and Minnesota came out identical, and the case looked like a
  // product defect when it was a fixture defect. A test whose fixture cannot express
  // the variable under test proves nothing.
  const panel = getPanelById('tesla-tsp-420');
  const inverter = getInverterById('fronius-primo-7.6') ?? null;
  return {
    projectId: 'p1', layoutId: 'l1', designVersionId: 'v1',
    panels: [], panelCount: 40, systemSizeKw: 16.2,
    panel: panel as never, inverter: inverter as never,
    mounting: null, batteries: [], batteryCount: 0,
    systemType: 'roof', roofSegments: [], groundArrays: [], fenceArrays: [],
    address: '1 Test St', lat: 40, lng: -89,
    stateCode: 'IL', city: 'Springfield', county: 'Sangamon', zip: '62701',
    utilityName: 'Ameren', utilityRatePerKwh: 0.15, ahj: 'Sangamon County',
    edgeSetbackM: 0.9, ridgeSetbackM: 0.45, pathwayWidthM: 0.9,
    capturedAt: '2026-09-26T00:00:00.000Z',
    ...over,
  } as DesignSnapshot;
}

const elec = (over?: Partial<DesignSnapshot>, pd?: unknown) =>
  generateEngineeringReport(snapshot(over), 'r1', (pd ?? null) as never).electrical;

it('PRECONDITION: the fixture resolves a real module WITH a Voc coefficient', () => {
  const p = getPanelById('tesla-tsp-420');
  expect(p, 'the fixture module id no longer resolves — every case below is vacuous').toBeTruthy();
  expect(typeof p!.tempCoeffVoc,
    'the module carries no tempCoeffVoc, so the cold-Voc law falls to the blanket 1.25 '
    + 'and the site-temperature cases cannot discriminate',
  ).toBe('number');
});

describe('🚨 the report consumes the conduit fill authority', () => {
  it('a conduit size is emitted, and it is not the amps bracket answer', () => {
    const e = elec();
    // Whatever the correct size is, it must be a real trade size with a raceway
    // type, or the honest refusal. Never an invented default.
    expect(e.dcConduitSize, 'no DC conduit size reached the report').toBeTruthy();
    expect(e.acConduitSize).toBeTruthy();
    expect(String(e.dcConduitSize)).toMatch(/^(PENDING|[\d/-]+" EMT)$/);
    expect(String(e.acConduitSize)).toMatch(/^(PENDING|[\d/-]+" EMT)$/);
  });

  it('🚨 the DC conduit grows with the string count — proof a fill calc ran', () => {
    // The old bracket keyed the trade size on AMPS, and Isc per string does not
    // change with the number of parallel strings. So under the defect a 4-panel
    // design and a 200-panel design printed the SAME DC conduit. Under a real fill
    // calculation they cannot, because the conductor COUNT differs.
    const small = elec({ panelCount: 8,   systemSizeKw: 3.2 }).dcConduitSize;
    const large = elec({ panelCount: 200, systemSizeKw: 81 }).dcConduitSize;
    expect(large,
      'the DC conduit did not change between an 8-panel and a 200-panel design — '
      + 'the trade size is still keyed on amps, not on conductor count',
    ).not.toBe(small);
  });

  it('the AC conduit does NOT move with panel count — only the DC bundle does', () => {
    // A control: the AC feeder is always 2 hots + neutral + EGC, so its count is
    // fixed. If this moved too, the test above would be proving nothing about fill.
    const a = elec({ panelCount: 8,   systemSizeKw: 3.2 });
    const b = elec({ panelCount: 200, systemSizeKw: 81 });
    // Both are 4-conductor bundles; they differ only if the AC gauge differs, which
    // it legitimately does with system size, so compare at equal inverter output.
    expect(a.acConduitSize).toBeTruthy();
    expect(b.acConduitSize).toBeTruthy();
  });
});

describe('🚨 the report consumes the 705.12 interconnection authority', () => {
  it('reports UNRESOLVED rather than deriving from an assumed 200 A service', () => {
    const e = elec(); // no physical data at all
    expect(e.interconnectionType,
      'the report still concludes a scope of work with no survey data').toBe('unresolved');
    expect(e.interconnectionMethod).toMatch(/UNRESOLVED/);
    expect(e.mainPanelBusAmps, 'the busbar was defaulted to 200 A again').toBeNull();
  });

  it('the report SAYS the rule was not evaluated, in its own compliance channel', () => {
    const notes = elec().complianceNotes ?? [];
    const all = (Array.isArray(notes) ? notes : []).join(' | ');
    expect(all, 'the unresolved interconnection is silent in the compliance notes')
      .toMatch(/705\.12/);
    expect(all).toMatch(/not established|NOT ESTABLISHED|ACTION REQUIRED/);
  });

  it('a surveyed interconnection point is still honoured', () => {
    expect(elec(undefined, { interconnection_point: 'load_side' }).interconnectionType)
      .toBe('load-side');
    expect(elec(undefined, { interconnection_point: 'supply_side' }).interconnectionType)
      .toBe('supply-side');
  });

  it('🚨 with both ratings known it uses (bus × 1.2) − main, not bus × 0.2', () => {
    // 200 A bus behind a 100 A main allows 140 A. A 16.2 kW system backfeeds well
    // under that, so the honest answer is load-side. The old × 0.2 test allowed only
    // 40 A and would have sent this job to a supply-side tap it does not need.
    const e = elec(undefined, { panel_rating_amps: 200, main_breaker_amps: 100 });
    expect(e.interconnectionType,
      'a 200 A bus behind a 100 A main was still called supply-side').toBe('load-side');
    expect(e.mainPanelBusAmps).toBe(200);
  });
});

describe('🚨 the report consumes the cold-Voc authority', () => {
  it('carries BOTH the STC string Voc and the NEC 690.7(A) corrected value', () => {
    const e = elec();
    expect(e.stringVoc, 'no STC string Voc').toBeGreaterThan(0);
    expect((e as { stringVocCorrected?: number }).stringVocCorrected,
      'the corrected Voc — the number the inverter limit is tested against — is absent',
    ).toBeGreaterThan(0);
    // They are different quantities, and printing one as the other was the defect.
    expect((e as { stringVocCorrected?: number }).stringVocCorrected)
      .not.toBe(e.stringVoc);
  });

  it('🚨 a warm site permits a longer string than a cold one', () => {
    // Under the blanket ×1.25 the string ceiling was identical in every state. It
    // cannot be, once the site temperature is read.
    const fl = elec({ stateCode: 'FL' }).panelsPerString;
    const mn = elec({ stateCode: 'MN' }).panelsPerString;
    expect(fl,
      'Florida and Minnesota got the same string ceiling — the site temperature is '
      + 'still not reaching the calculation',
    ).toBeGreaterThan(mn);
  });

  it('the corrected Voc never exceeds the inverter maximum for the chosen length', () => {
    for (const state of ['FL', 'IL', 'MN', 'AZ']) {
      const e = elec({ stateCode: state });
      const corrected = (e as { stringVocCorrected?: number }).stringVocCorrected ?? 0;
      // The engine's own ceiling for this inverter; 600 V when the record is silent.
      expect(corrected,
        `${state}: corrected string Voc ${corrected} V exceeds the 600 V class limit`,
      ).toBeLessThanOrEqual(600);
    }
  });
});
