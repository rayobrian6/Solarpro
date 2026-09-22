// ═══════════════════════════════════════════════════════════════════════════
// WHICH GEOMETRY GOVERNS — behavioural tests for the provider decision.
//
// The headline case is the one the product owner hit: reject a bad Google roof,
// pan the map to frame the house, and watch the rejected planes come back. That
// sequence is replayed here against the REAL gate function, with and without
// the decision, so the proof is a difference in behaviour rather than a claim.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  archivesSignature,
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

describe('🚨 THE DECISION IS REACHABLE IN PRODUCTION — it is not decoration', () => {
  // An adversarial pass found the first version of this feature was inert in
  // FOUR independent ways at once: nothing wrote a decision, the gate literal
  // did not pass one so `shouldRunLaneA` always saw 'undecided', every
  // hydrate/switchSite path dropped the map so the next save wrote {} over a
  // stored rejection, and `archivesSignature` did not sign it so a write could
  // never have scheduled that save anyway. Each leg alone makes the other three
  // pointless, so each is asserted separately.
  const STUDIO = readFileSync(join(process.cwd(), 'components/design/DesignStudio.tsx'), 'utf8');
  const HOOK = readFileSync(join(process.cwd(), 'components/design/useSiteDesign.ts'), 'utf8');
  const ENGINE = readFileSync(join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');
  const MODEL = readFileSync(join(process.cwd(), 'lib/design/siteDesignModel.ts'), 'utf8');

  it('LEG 1 — something WRITES it: rejecting the Google roof records the rejection', () => {
    expect(HOOK).toMatch(/const setNativeDisposition = useCallback/);
    // Matched as three facts rather than one formatting. The call became
    // multi-line when the site key gained a fallback, and a regex pinned to the
    // argument list broke for a reason that had nothing to do with what it
    // protects — which is what an over-specified source matcher always costs.
    expect(HOOK).toMatch(/withDisposition\(/);
    expect(HOOK).toMatch(/stateRef\.current\.nativeGeometry/);
    // 🚨 THE FALLBACK. `activeSiteKeyRef` is the EMPTY STRING until hydration
    // resolves ownership, and a write against an empty key is dropped — so a
    // decision made early in a session would vanish with no error.
    expect(HOOK).toMatch(/activeSiteKeyRef\.current \|\| stateRef\.current\.activeSiteKey/);
    // "Draw Manually Instead" — the gesture that used to erase itself.
    //
    // 🚨 SLICED FORWARD FROM THE CALL, not backward from the label. The first
    // version searched backward from `indexOf('Draw Manually Instead')`, and
    // that phrase also appears in a COMMENT 5,000 lines earlier — so the slice
    // came out empty and the assertions below would have passed vacuously had
    // the positive control not caught it.
    const at = STUDIO.indexOf("site.setNativeDisposition('rejected')");
    expect(at, 'positive control: the write was not found at all').toBeGreaterThan(-1);
    const btn = STUDIO.slice(at, at + 1200);
    expect(btn, 'the rejection must clear the planes too').toMatch(/setRoofPlanes\(\[\]\)/);
    expect(btn, 'positive control: this really is that button')
      .toMatch(/Draw Manually Instead/);
  });

  it('LEG 1b — building a section records that a hand-built model governs', () => {
    expect(STUDIO).toMatch(/if \(enrichedPlane\.section\) site\.setNativeDisposition\('custom'\)/);
  });

  it('LEG 2 — the GATE reads it, on the path that runs Lane A', () => {
    const gate = ENGINE.slice(
      ENGINE.indexOf('const gate: LaneAGateInput = {'),
      ENGINE.indexOf('if (!shouldRunLaneA(gate))'),
    );
    expect(gate.length, 'positive control: the gate literal was found').toBeGreaterThan(200);
    expect(gate).toMatch(/nativeDisposition:/);
  });

  it('🚨 LEG 2b — AND on the SECOND acquisition path, which had no gate at all', () => {
    // `handleAutoRoof` called `detectPlanesFromTwin` directly — no stage check,
    // no restore check, no plane count, no run-once guard — and fired precisely
    // when `eligiblePlanes.length === 0`, which is the state a rejection leaves
    // behind. Pressing Auto Fill re-injected the rejected roof.
    const auto = ENGINE.slice(
      ENGINE.indexOf('if (eligiblePlanes.length === 0) {'),
      ENGINE.indexOf("addLog('AUTO', 'handleAutoRoof: no drawn planes AND no Solar segments')"),
    );
    expect(auto.length, 'positive control: the branch was found').toBeGreaterThan(200);
    expect(auto).toMatch(/nativeAcquisitionPermitted\(/);
    // The refusal must come BEFORE the detection, not after it.
    expect(auto.indexOf('nativeAcquisitionPermitted('))
      .toBeLessThan(auto.indexOf("detectPlanesFromTwin('handleAutoRoof')"));
  });

  it('LEG 3 — every state literal carries it, so reload and A→B→A keep it', () => {
    // A literal that builds a SiteDesignState without it silently resets the
    // decision, and `toPersistencePayload`'s `?? {}` then writes the reset back.
    const literals = MODEL.match(/version: SITE_ARCHIVE_VERSION,/g) ?? [];
    expect(literals.length, 'positive control: state literals exist').toBeGreaterThan(5);
    let missing = 0;
    let idx = MODEL.indexOf('version: SITE_ARCHIVE_VERSION,');
    while (idx >= 0) {
      if (!MODEL.slice(idx, idx + 700).includes('nativeGeometry')) missing++;
      idx = MODEL.indexOf('version: SITE_ARCHIVE_VERSION,', idx + 1);
    }
    expect(missing, 'a state literal drops the provider decision').toBe(0);
  });

  it('LEG 4 — it is SIGNED, so recording it actually schedules a save', () => {
    const sig = MODEL.slice(
      MODEL.indexOf('export function archivesSignature('),
      MODEL.indexOf('function signableElectrical('),
    );
    expect(sig.length, 'positive control: archivesSignature was found').toBeGreaterThan(200);
    expect(sig).toMatch(/nativeGeometry/);
  });

  it('…and the signature genuinely moves when a decision is recorded', () => {
    // The behavioural form of LEG 4. A structural match on the word proves the
    // field is mentioned; this proves the string changes.
    const base = { version: 1 as const, activeSiteKey: 'a', sites: {} };
    const a = archivesSignature({ ...base, nativeGeometry: {} });
    const b = archivesSignature({ ...base, nativeGeometry: { a: 'rejected' } });
    const c = archivesSignature({ ...base, nativeGeometry: { a: 'custom' } });
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    // …and does NOT move when nothing changed.
    expect(archivesSignature({ ...base, nativeGeometry: { a: 'rejected' } })).toBe(b);
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

// ═══════════════════════════════════════════════════════════════════════════
// A DECISION MADE BEFORE THE PROPERTY WAS NAMED
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 an unresolved site key must not swallow a decision in silence', () => {
  it('withDisposition still refuses to FILE against an empty key', () => {
    // This part is right and stays right: a decision has to be about a
    // property, and '' is not one.
    expect(withDisposition({}, '', 'custom')).toEqual({});
    expect(withDisposition({}, null, 'rejected')).toEqual({});
    expect(withDisposition({ a: 'custom' }, undefined, 'rejected')).toEqual({ a: 'custom' });
  });

  it('🚨 …which is why the CALLER has to hold it — measured live, it was lost', () => {
    // components/design/useSiteDesign.ts: `setNativeDisposition` filed against
    // `activeSiteKeyRef.current || stateRef.current.activeSiteKey`. Measured in
    // a real browser through the quick-design entry, BOTH are the empty string
    // at the moment a section is built, so `withDisposition` returned the map
    // unchanged, the write vanished, and the app went on believing native
    // geometry acquisition was still permitted for that property.
    //
    // The hook now parks the decision and `setActiveKey` files it the moment
    // the property is named. This asserts the SHAPE that fix relies on: the
    // same decision, applied later against a real key, lands.
    const parked: NativeGeometryDisposition = 'custom';
    let map = withDisposition({}, '', parked);
    expect(dispositionFor(map, 'site-1')).toBe('undecided');   // the loss

    map = withDisposition(map, 'site-1', parked);              // the flush
    expect(dispositionFor(map, 'site-1')).toBe('custom');
    expect(nativeAcquisitionPermitted(dispositionFor(map, 'site-1'))).toBe(false);
  });

  it('the parked decision belongs to the site that RESOLVES, not to every site', () => {
    const map = withDisposition(withDisposition({}, '', 'custom'), 'site-1', 'custom');
    expect(dispositionFor(map, 'site-1')).toBe('custom');
    // A neighbour must not inherit it. "Custom data must not silently
    // contaminate a normal good Google project."
    expect(dispositionFor(map, 'site-2')).toBe('undecided');
    expect(nativeAcquisitionPermitted(dispositionFor(map, 'site-2'))).toBe(true);
  });
});
