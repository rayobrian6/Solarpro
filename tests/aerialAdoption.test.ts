// ═══════════════════════════════════════════════════════════════════════════
// "Detect roof from aerial" must not be able to delete an hour of tracing.
//
// The defect was one line — `setRoofPlanes(planes)` — reachable by one click,
// with no merge, no guard, no confirmation and no undo, persisted by the
// autosave three seconds later.
//
// The last describe block asserts, against the component source, that the call
// site cannot quietly go back to the unconditional form.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RoofPlane } from '@/types';
import { isHandModelledFace, planAerialAdoption } from '@/lib/design/aerialAdoption';
import { stripComments } from './support/stripSource';

const plane = (id: string, over: Partial<RoofPlane> = {}): RoofPlane => ({
  id,
  vertices: [{ lat: 38.7, lng: -89.9 }, { lat: 38.7001, lng: -89.9 }, { lat: 38.7001, lng: -89.8999 }],
  pitch: 25, azimuth: 180, area: 40, usableArea: 36,
  ...over,
});

const detected = (id: string) => plane(id, { source: 'aerial_nearmap', confirmed: false });
const traced   = (id: string) => plane(id, { source: 'manual', confirmed: false });
const reviewed = (id: string) => plane(id, { source: 'solar_api', confirmed: true });
const sectionFace = (id: string) => plane(id, { sectionId: 'sec-1', source: 'manual' });

// ─────────────────────────────────────────────────────────────────────────────

describe('what counts as somebody’s work', () => {
  it('a hand-traced face does', () => expect(isHandModelledFace(traced('a'))).toBe(true));
  it('a face belonging to a building section does', () =>
    expect(isHandModelledFace(sectionFace('a'))).toBe(true));
  it('a CONFIRMED machine face does — a review is a decision', () =>
    expect(isHandModelledFace(reviewed('a'))).toBe(true));
  it('an imported face does', () =>
    expect(isHandModelledFace(plane('a', { source: 'imported' }))).toBe(true));

  it('an unreviewed machine guess does NOT', () => {
    expect(isHandModelledFace(detected('a'))).toBe(false);
    expect(isHandModelledFace(plane('a', { source: 'solar_api', confirmed: false }))).toBe(false);
  });

  it('a face with no provenance at all does not, and does not throw', () => {
    expect(isHandModelledFace(plane('a'))).toBe(false);
    expect(isHandModelledFace(null)).toBe(false);
    expect(isHandModelledFace(undefined)).toBe(false);
  });
});

describe('🚨 a fresh detection cannot silently replace a person’s roof', () => {
  it('REFUSES when hand-traced faces exist, and changes nothing', () => {
    const existing = [traced('hand-1'), traced('hand-2'), detected('auto-1')];
    const out = planAerialAdoption({ existing, incoming: [detected('new-1')] });

    expect(out.ok).toBe(false);
    expect(out.mode).toBe('refused');
    expect(out.destroyedCount).toBe(0);
    // 🚨 A REFUSAL IS A NO-OP, never an empty roof.
    expect(out.planes).toEqual(existing);
    expect(out.refusals[0].code).toBe('WOULD_DESTROY_MODELLED_GEOMETRY');
    expect(out.refusals[0].faceIds.sort()).toEqual(['hand-1', 'hand-2']);
    // The message must say what happened and what to do, not just "error".
    expect(out.refusals[0].message).toMatch(/2 roof faces/);
    expect(out.refusals[0].message).toMatch(/Nothing has been changed/i);
  });

  it('refuses for a CONFIRMED machine face too', () => {
    const out = planAerialAdoption({ existing: [reviewed('ok-1')], incoming: [detected('new-1')] });
    expect(out.ok).toBe(false);
    expect(out.refusals[0].faceIds).toEqual(['ok-1']);
  });

  it('refuses for a face that carries PANELS, whatever produced it', () => {
    // Losing it silently unsticks an array. The caller supplies this because
    // the module cannot see panels; it must not be left to guess.
    const existing = [detected('auto-1')];
    const out = planAerialAdoption({ existing, incoming: [detected('new-1')], panelledPlaneIds: ['auto-1'] });
    expect(out.ok).toBe(false);
    expect(out.refusals[0].faceIds).toEqual(['auto-1']);
    expect(out.planes).toEqual(existing);
  });

  it('a section-owned face is protected', () => {
    const out = planAerialAdoption({ existing: [sectionFace('sec-1::slopeA')], incoming: [detected('n')] });
    expect(out.ok).toBe(false);
  });

  it('the singular reads correctly for one face', () => {
    const out = planAerialAdoption({ existing: [traced('a')], incoming: [detected('n')] });
    expect(out.refusals[0].message).toMatch(/1 roof face you/);
  });
});

describe('a re-read of the machine’s own guesses is allowed', () => {
  it('replaces unreviewed detections without asking', () => {
    const out = planAerialAdoption({
      existing: [detected('old-1'), detected('old-2')],
      incoming: [detected('new-1')],
    });
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('replaced');
    expect(out.destroyedCount).toBe(0);
    expect(out.planes.map(p => p.id)).toEqual(['new-1']);
  });

  it('adopting onto an empty roof is allowed', () => {
    for (const e of [null, undefined, []]) {
      const out = planAerialAdoption({ existing: e, incoming: [detected('new-1')] });
      expect(out.ok).toBe(true);
      expect(out.planes).toHaveLength(1);
    }
  });

  it('an empty detection is still an outcome, not a crash', () => {
    const out = planAerialAdoption({ existing: [detected('a')], incoming: [] });
    expect(out.ok).toBe(true);
    expect(out.planes).toEqual([]);
  });
});

describe('when the operator confirms, it does what they asked and says what it cost', () => {
  it('replaces, and reports exactly how many faces were lost', () => {
    const out = planAerialAdoption({
      existing: [traced('hand-1'), traced('hand-2'), detected('auto-1')],
      incoming: [detected('new-1')],
      confirmedReplace: true,
    });
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('confirmed-replace');
    expect(out.destroyedCount).toBe(2);
    expect(out.planes.map(p => p.id)).toEqual(['new-1']);
  });

  it('confirming when there was nothing to lose is an ordinary replace', () => {
    const out = planAerialAdoption({
      existing: [detected('auto-1')], incoming: [detected('new-1')], confirmedReplace: true,
    });
    expect(out.mode).toBe('replaced');
    expect(out.destroyedCount).toBe(0);
  });
});

describe('🚨 ownership is stamped on the way in', () => {
  it('an unowned detection is adopted by the site it was made for', () => {
    const out = planAerialAdoption({ existing: [], incoming: [detected('n')], siteKey: 'site-melvin' });
    expect(out.planes[0].siteKey).toBe('site-melvin');
  });

  it('a face that already names a DIFFERENT site is never re-stamped', () => {
    // Re-stamping is how one property's roof gets adopted by another — the
    // exact failure lib/siteIdentity.ts exists to prevent.
    const foreign = { ...detected('n'), siteKey: 'site-other' };
    const out = planAerialAdoption({ existing: [], incoming: [foreign], siteKey: 'site-melvin' });
    expect(out.planes[0].siteKey).toBe('site-other');
  });

  it('with no site key resolved, nothing is invented', () => {
    const out = planAerialAdoption({ existing: [], incoming: [detected('n')] });
    expect(out.planes[0].siteKey).toBeUndefined();
  });

  it('the incoming array is not mutated', () => {
    const incoming = [detected('n')];
    planAerialAdoption({ existing: [], incoming, siteKey: 'site-1' });
    expect(incoming[0].siteKey).toBeUndefined();
  });
});

describe('🚨 the call site cannot go back to the unconditional form', () => {
  // 🚨 COMMENTS STRIPPED FIRST. The fix's own comment QUOTES the defective
  // line to explain what it replaced, and the first version of this guard
  // matched that prose and failed against correct code. A structural guard
  // that reads comments is asserting something about the documentation.
  const SRC = stripComments(
    readFileSync(join(process.cwd(), 'components/design/DesignStudio.tsx'), 'utf8'),
  );

  it('detectRoofFromAerial routes through the planner', () => {
    const fn = SRC.slice(
      SRC.indexOf('const detectRoofFromAerial'),
      SRC.indexOf('}, [mapCenter.lat, mapCenter.lng, toast]);'),
    );
    expect(fn.length, 'the scan did not find detectRoofFromAerial').toBeGreaterThan(500);
    expect(fn).toMatch(/planAerialAdoption\(\{/);
    // 🚨 THE POSITIVE CONTROL. This is the defect itself: if the slice above
    // ever stopped covering the function, the assertion below would pass
    // vacuously — so assert that the slice DOES contain the new write, proving
    // it is looking at the right code, and that it does NOT contain the old one.
    // The planner's answer still reaches state — now via the deletion ledger,
    // which refuses a face the user deliberately removed. This is the THIRD
    // machine-write door, and re-admitting a tombstoned face is the same defect
    // whichever machine supplied it.
    expect(fn).toMatch(/setRoofPlanes\(site\.admitGeometry\(adoption\.planes\)\)/);
    expect(fn).not.toMatch(/setRoofPlanes\(planes\)/);
  });

  it('and it returns without writing when the plan refuses', () => {
    const fn = SRC.slice(
      SRC.indexOf('const detectRoofFromAerial'),
      SRC.indexOf('}, [mapCenter.lat, mapCenter.lng, toast]);'),
    );
    const refusal = fn.slice(fn.indexOf('if (!adoption.ok)'));
    expect(refusal.slice(0, 400)).toMatch(/return;/);
    // The refusal branch must not write roof planes at all.
    const beforeReturn = refusal.slice(0, refusal.indexOf('return;'));
    expect(beforeReturn).not.toMatch(/setRoofPlanes\(/);
  });
});
