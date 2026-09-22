// ═══════════════════════════════════════════════════════════════════════════
// WHICH GEOMETRY GOVERNS — behavioural tests for the provider decision.
//
// The headline case is the one the product owner hit: reject a bad Google roof,
// pan the map to frame the house, and watch the rejected planes come back. That
// sequence is replayed here against the REAL gate function, with and without
// the decision, so the proof is a difference in behaviour rather than a claim.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import {
  NATIVE_GEOMETRY_DISPOSITIONS,
  customModelGoverns,
  dispositionFor,
  dispositionLabel,
  isNativeGeometryDisposition,
  nativeAcquisitionPermitted,
  parseNativeGeometryMap,
  withDisposition,
  type NativeGeometryDisposition,
  type NativeGeometryMap,
} from '@/lib/design/nativeGeometryDisposition';
import { shouldRunLaneA, type LaneAGateInput } from '@/lib/3d/laneA';
import {
  emptyState,
  parseStoredArchives,
  toPersistencePayload,
} from '@/lib/design/siteDesignModel';

/** The state of the world the moment before Lane A would fire. */
const gate = (over: Partial<LaneAGateInput> = {}): LaneAGateInput => ({
  stage: 'done',
  groundElevResolved: true,
  restoreResolved: true,
  segmentCount: 4,
  existingPlaneCount: 0,
  siteKey: 'site-after-pan',
  lastRanSiteKey: 'site-before-pan',
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('🚨 the sequence that lost the product owner an hour of tracing', () => {
  // 1. Google returns a roof for this address, and it is wrong.
  // 2. The installer clicks "Draw Manually Instead" — the planes are cleared.
  // 3. They pan the 2D map ~12 m to frame the house before tracing.
  // 4. The pan changes mapCenter, which is the engine's lat/lng prop, which is
  //    the ONLY caller of maybeRunLaneA. The site key rounds to ~1.1 m, so a
  //    12 m pan produces a different key and the run-once guard does not fire.
  // 5. Every remaining condition is satisfied, and the rejected planes return.

  it('WITHOUT a recorded decision, the pan re-injects the rejected roof', () => {
    // This is the old behaviour, still reachable by omitting the disposition —
    // which is exactly what every legacy row does. It must stay permitted, or
    // no existing project could ever detect a roof again.
    expect(shouldRunLaneA(gate())).toBe(true);
  });

  it('WITH the rejection recorded, the pan changes nothing', () => {
    expect(shouldRunLaneA(gate({ nativeDisposition: 'rejected' }))).toBe(false);
  });

  it('and a hand-built model is protected the same way', () => {
    expect(shouldRunLaneA(gate({ nativeDisposition: 'custom' }))).toBe(false);
  });

  it('🚨 the refusal is checked even though the plane count is ZERO', () => {
    // Clearing the planes IS how the installer says no, so a guard that only
    // looks at the count cannot see the decision — it can only observe the
    // consequence, and the consequence is what the rejection removes.
    expect(gate().existingPlaneCount).toBe(0);
    expect(shouldRunLaneA(gate({ existingPlaneCount: 0, nativeDisposition: 'rejected' }))).toBe(false);
  });

  it('no address change is involved — only the site key moved', () => {
    const g = gate({ nativeDisposition: 'rejected' });
    expect(g.lastRanSiteKey).not.toBe(g.siteKey); // the pan defeated the run-once guard
    expect(shouldRunLaneA(g)).toBe(false);        // and the decision holds anyway
  });
});

describe('what each state permits', () => {
  it.each<[NativeGeometryDisposition, boolean]>([
    ['undecided', true],
    ['accepted', true],
    ['unavailable', true],
    ['rejected', false],
    ['custom', false],
  ])('%s permits acquisition: %s', (d, permitted) => {
    expect(nativeAcquisitionPermitted(d)).toBe(permitted);
    expect(shouldRunLaneA(gate({ nativeDisposition: d }))).toBe(permitted);
  });

  it('🚨 "unavailable" does NOT refuse — it is a fact, not a judgement', () => {
    // Google coverage genuinely appears for addresses over time. Recording that
    // there was none must not permanently disable detection at that property,
    // or a job designed by hand in 2026 can never adopt real geometry in 2027.
    expect(nativeAcquisitionPermitted('unavailable')).toBe(true);
  });

  it('only a HUMAN judgement blocks acquisition', () => {
    const blocking = NATIVE_GEOMETRY_DISPOSITIONS.filter(d => !nativeAcquisitionPermitted(d));
    expect([...blocking].sort()).toEqual(['custom', 'rejected']);
  });

  it('every other Lane A refusal still applies on top of it', () => {
    for (const over of [
      { stage: 'loading' }, { groundElevResolved: false }, { restoreResolved: false },
      { segmentCount: 0 }, { existingPlaneCount: 3 }, { siteKey: '' },
      { lastRanSiteKey: 'site-after-pan' },
    ] as Partial<LaneAGateInput>[]) {
      expect(shouldRunLaneA(gate({ ...over, nativeDisposition: 'accepted' })), JSON.stringify(over))
        .toBe(false);
    }
  });
});

describe('🚨 absence is not a value', () => {
  it('an unknown site reads undecided, and is never coerced to a judgement', () => {
    expect(dispositionFor({}, 'site-x')).toBe('undecided');
    expect(dispositionFor(null, 'site-x')).toBe('undecided');
    expect(dispositionFor({ 'site-y': 'rejected' }, 'site-x')).toBe('undecided');
  });

  it('an unresolved site key owns no decision', () => {
    expect(dispositionFor({ '': 'rejected' } as NativeGeometryMap, '')).toBe('undecided');
    expect(dispositionFor({ 'a': 'rejected' }, null)).toBe('undecided');
  });

  it('an unrecognised stored value degrades to undecided, not to accepted', () => {
    // A row written by a newer build, or hand-edited. Reading it as "accepted"
    // would silently license re-acquisition over custom work.
    expect(dispositionFor({ s: 'nonsense' } as unknown as NativeGeometryMap, 's')).toBe('undecided');
    expect(dispositionFor({ s: null } as unknown as NativeGeometryMap, 's')).toBe('undecided');
  });

  it('recording "undecided" DELETES the entry rather than storing the word', () => {
    // Absence and "undecided" must be one state, or there are two spellings of
    // one fact and a reader that disagrees the day they diverge.
    const m = withDisposition({ s: 'rejected' }, 's', 'undecided');
    expect(Object.prototype.hasOwnProperty.call(m, 's')).toBe(false);
    expect(dispositionFor(m, 's')).toBe('undecided');
  });

  it('writing does not mutate the map it was given', () => {
    const before: NativeGeometryMap = { s: 'accepted' };
    const after = withDisposition(before, 's', 'rejected');
    expect(before.s).toBe('accepted');
    expect(after.s).toBe('rejected');
  });

  it('a write against an unresolved site key is dropped, not stored under ""', () => {
    expect(withDisposition({ a: 'accepted' }, '', 'rejected')).toEqual({ a: 'accepted' });
    expect(withDisposition({ a: 'accepted' }, null, 'rejected')).toEqual({ a: 'accepted' });
  });

  it('the guard recognises exactly the five values', () => {
    for (const d of NATIVE_GEOMETRY_DISPOSITIONS) expect(isNativeGeometryDisposition(d)).toBe(true);
    for (const v of ['', 'REJECTED', 'google', null, undefined, 3, {}]) {
      expect(isNativeGeometryDisposition(v)).toBe(false);
    }
  });
});

describe('🚨 the decision survives the database, including for the ACTIVE property', () => {
  // It lives at the top level of site_archives, not in a bundle, because
  // toPersistencePayload writes `sites: state.archives` — the ARCHIVED bundles
  // only. A bundle field persists for every property except the one on screen.

  const roundTrip = (m: NativeGeometryMap) => {
    const state = { ...emptyState('site-active'), nativeGeometry: m };
    const payload = toPersistencePayload(state);
    // What Postgres actually does to it.
    const stored = JSON.parse(JSON.stringify(payload.siteArchives));
    return parseStoredArchives(stored);
  };

  it('a rejection on the ACTIVE property round-trips', () => {
    const back = roundTrip({ 'site-active': 'rejected' });
    expect(back).not.toBeNull();
    expect(dispositionFor(back!.nativeGeometry, 'site-active')).toBe('rejected');
  });

  it('decisions about several properties round-trip together', () => {
    const back = roundTrip({ a: 'accepted', b: 'rejected', c: 'custom', d: 'unavailable' });
    expect(back!.nativeGeometry).toEqual({ a: 'accepted', b: 'rejected', c: 'custom', d: 'unavailable' });
  });

  it('🚨 parseStoredArchives REBUILDS the object, so the field must be named there', () => {
    // It discards anything it does not name. A field written but not parsed
    // round-trips as absent and looks exactly like a feature that never ran —
    // which is how this would have failed silently.
    const stored = { version: 1, activeSiteKey: 'a', sites: {}, nativeGeometry: { a: 'rejected' } };
    expect(parseStoredArchives(stored)!.nativeGeometry).toEqual({ a: 'rejected' });
  });

  it('a legacy row with no field at all parses to an empty map, not to null', () => {
    const back = parseStoredArchives({ version: 1, activeSiteKey: 'a', sites: {} });
    expect(back!.nativeGeometry).toEqual({});
    expect(dispositionFor(back!.nativeGeometry, 'a')).toBe('undecided');
  });

  it('garbage in the stored field is dropped per key, never defaulted', () => {
    expect(parseNativeGeometryMap({ a: 'rejected', b: 'nonsense', c: 7, '': 'custom' }))
      .toEqual({ a: 'rejected' });
    for (const junk of [null, undefined, 'x', 42, ['rejected']]) {
      expect(parseNativeGeometryMap(junk)).toEqual({});
    }
  });

  it('the payload always emits the field, so clearing it is expressible', () => {
    // `undefined` means "keep what is stored" in the layout writer, so an empty
    // map has to be written as {} rather than omitted.
    const payload = toPersistencePayload(emptyState('site-active'));
    expect(payload.siteArchives.nativeGeometry).toEqual({});
  });
});

describe('what the UI is allowed to say', () => {
  it('every state has its own sentence, and undecided claims nothing', () => {
    const said = NATIVE_GEOMETRY_DISPOSITIONS.map(dispositionLabel);
    expect(new Set(said).size).toBe(NATIVE_GEOMETRY_DISPOSITIONS.length);
    expect(dispositionLabel('undecided')).toMatch(/not yet decided/i);
    expect(dispositionLabel('rejected')).toMatch(/rejected/i);
    expect(dispositionLabel('unavailable')).toMatch(/no google 3d coverage/i);
  });

  it('customModelGoverns is true for exactly one state', () => {
    expect(NATIVE_GEOMETRY_DISPOSITIONS.filter(customModelGoverns)).toEqual(['custom']);
  });
});
