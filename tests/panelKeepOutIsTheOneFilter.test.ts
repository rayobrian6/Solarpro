/**
 * tests/panelKeepOutIsTheOneFilter.test.ts
 *
 * PANELS WERE BEING LAID ACROSS A CHIMNEY FLUE.
 *
 * 🚨 TWO IMPLEMENTATIONS OF ONE QUESTION, AND THE WEAKER ONE RAN.
 *
 * "Does this panel conflict with this object?" had two answers in the codebase:
 *
 *   isPanelInsideObstruction  (lib/surfaceGeometry3D.ts)
 *       Is the panel's CENTRE inside the bare footprint, plus 1 mm?
 *       The module's own size is not considered. The clearance is not
 *       considered.
 *
 *   panelHitsKeepOut          (lib/3d/panelKeepOut.ts)
 *       Does the panel's FOOTPRINT overlap the footprint GROWN BY ITS
 *       CLEARANCE? 0.45 m for a chimney, 0.15 m fallback.
 *
 * `panelKeepOut`'s own header calls its filter "THE ONE FILTER. Every placement
 * path calls this — auto, manual, row, snap, fill — so no path can have
 * different rules about what is physically there."
 *
 * Three placement paths in SolarEngine3D called the other one. Including the
 * one that runs when a person marks a chimney on a finished array — which is
 * exactly the moment the promise on screen, one line above the click, reads
 * "Panels keep 0.45 m clear of it".
 *
 * The consequence is not cosmetic and not recoverable on site: a module that
 * should have been excluded gets mounted over a flue, and the array is built
 * that way. Being wrong in this direction costs a truck roll and a hole in
 * somebody's roof; being wrong the other way costs one module.
 *
 * This file pins the arithmetic that separates the two answers, so a future
 * "simplification" back to a centre test fails loudly instead of quietly
 * re-opening a roof.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import {
  panelHitsKeepOut,
  filterPanelsByKeepOut,
  clearanceFor,
  DEFAULT_CLEARANCE_M,
} from '../lib/3d/panelKeepOut';

const ROOT = join(__dirname, '..');
const ENGINE = stripComments(
  readFileSync(join(ROOT, 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'),
);

const M_PER_DEG_LAT = 111_132;

/** A module of real size at a given offset, in metres, from an object. */
function panelAt(northM: number, eastM: number, lat = 38.7, lng = -90.0) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return {
    id: `p-${northM}-${eastM}`,
    lat: lat + northM / M_PER_DEG_LAT,
    lng: lng + eastM / (M_PER_DEG_LAT * cosLat),
    widthM: 1.13,
    heightM: 1.72,
  };
}

/** A typical chimney: 0.9 x 0.6 m footprint, bound to a roof face. */
const CHIMNEY = {
  id: 'chimney-1', type: 'chimney', space: 'roof' as const,
  lat: 38.7, lng: -90.0, widthM: 0.9, depthM: 0.6,
};

describe('🚨 the engine calls the clearance-aware filter', () => {
  it('no placement path uses the centre test any more', () => {
    const n = (ENGINE.match(/removeObstructedPanels\(/g) || []).length;
    expect(n, `${n} call(s) to the centre test remain — each one lays panels across an obstruction`)
      .toBe(0);
  });

  it('all three placement paths call the keep-out filter', () => {
    const n = (ENGINE.match(/filterPanelsByKeepOut\(/g) || []).length;
    expect(n, 'a placement path stopped consulting the keep-out authority').toBe(3);
  });

  it('the shared commit uses it, so placement and duplicate agree', () => {
    expect(ENGINE).toMatch(/filterPanelsByKeepOut\(panelsRef\.current, \[obs\]\)/);
  });

  it('and it counts what was removed rather than subtracting lengths', () => {
    // The filter reports the removed panels; deriving the count from array
    // lengths works only while the filter is guaranteed not to reorder or
    // duplicate, which is not a property worth depending on.
    expect(ENGINE).toMatch(/const removed  = keepOut\.removed\.length;/);
  });
});

describe('🚨 the arithmetic that separates the two answers', () => {
  it('a module beside a chimney is excluded even though its centre is clear', () => {
    // 0.8 m north of the chimney centre. The chimney's half-depth is 0.30 m, so
    // the centre is well outside the footprint — the old test kept this module.
    // Its own half-height is 0.86 m and the clearance is 0.45 m, so it really
    // overlaps: 0.30 + 0.45 + 0.86 = 1.61 m of exclusion.
    const p = panelAt(0.8, 0);
    expect(panelHitsKeepOut(p, CHIMNEY),
      'a module overlapping a chimney and its clearance was allowed to stay')
      .toBe(true);
  });

  it('a module genuinely clear of it survives', () => {
    // Beyond 1.61 m it is legitimately clear, and removing it would cost the
    // customer a module for nothing.
    expect(panelHitsKeepOut(panelAt(2.0, 0), CHIMNEY)).toBe(false);
  });

  it('the exclusion is far larger than the footprint — that is the whole point', () => {
    // Sweep north in 5 cm steps and find where exclusion ends.
    let edge = 0;
    for (let d = 0; d < 400; d++) {
      if (!panelHitsKeepOut(panelAt(d * 0.05, 0), CHIMNEY)) { edge = d * 0.05; break; }
    }
    // Half-depth 0.30 + clearance 0.45 + panel half-height 0.86 = 1.61 m.
    expect(edge).toBeGreaterThan(1.5);
    expect(edge).toBeLessThan(1.75);
    // The old centre test stopped excluding at 0.30 m — five times sooner.
    expect(edge / 0.301).toBeGreaterThan(4);
  });

  it('a chimney on a finished array removes several modules, not nought or one', () => {
    // A tight grid straddling the chimney, at real module pitch.
    const grid: ReturnType<typeof panelAt>[] = [];
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
      grid.push(panelAt(r * 1.8, c * 1.2));
    }
    const { removed } = filterPanelsByKeepOut(grid, [CHIMNEY]);
    expect(removed.length,
      `only ${removed.length} module(s) excluded around a chimney — the centre test's answer`)
      .toBeGreaterThanOrEqual(2);
    expect(removed.length, 'the keep-out swallowed the whole array').toBeLessThan(grid.length);
  });

  it('a tree still shades without occupying — site objects are untouched', () => {
    // 🚨 THE ONE BEHAVIOUR THE SWAP MUST NOT CHANGE. Dropping a 6 m tree near
    // the house once deleted every module within 3 m of it, unrecoverably,
    // while the tool promised it would only shade. Both implementations return
    // early on `space: 'site'`, and this proves the one now in use still does.
    const tree = {
      id: 't1', type: 'tree', space: 'site' as const,
      lat: 38.7, lng: -90.0, widthM: 6, depthM: 6,
    };
    const grid = [panelAt(0, 0), panelAt(1, 0), panelAt(0, 1)];
    const { panels, removed } = filterPanelsByKeepOut(grid, [tree]);
    expect(removed.length, 'a tree removed panels — shaded production is a derate, not a no-build')
      .toBe(0);
    expect(panels.length).toBe(3);
  });
});

describe('the clearance is type-specific, not one global number', () => {
  it('a chimney claims more room than a vent', () => {
    const chimney = clearanceFor({ id: 'a', type: 'chimney', lat: 0, lng: 0 } as any);
    const vent    = clearanceFor({ id: 'b', type: 'vent',    lat: 0, lng: 0 } as any);
    expect(chimney).toBeGreaterThan(vent);
  });

  it('an unknown type still gets a real clearance, not zero', () => {
    // Falling back to 0 would silently reproduce the centre test for any object
    // whose type was renamed or misspelled.
    const unknown = clearanceFor({ id: 'c', type: 'no-such-thing', lat: 0, lng: 0 } as any);
    expect(unknown).toBeGreaterThan(0);
  });

  it('chimney clearance is the 0.45 m the UI promises the user', () => {
    // The tool prints "Panels keep 0.45 m clear of it" one line above the click.
    // If this number moves, that sentence becomes false.
    expect(DEFAULT_CLEARANCE_M.chimney).toBeCloseTo(0.45, 6);
  });
});
