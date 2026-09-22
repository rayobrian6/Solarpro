/**
 * tests/cesiumApiSurface.test.ts
 *
 * EVERY CESIUM METHOD THE ENGINE CALLS MUST ACTUALLY EXIST.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS WAS WRITTEN FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `getWorldPosition`'s last-resort fallback called
 *
 *     viewer.scene.globe.ellipsoid.intersectWithRay(ray)
 *
 * and `Ellipsoid.prototype.intersectWithRay` DOES NOT EXIST in CesiumJS — not
 * in the pinned browser build (1.114) and not in the local package (1.139.1).
 * Every call threw a TypeError, which `handleCesiumError` caught and logged.
 *
 * Nobody noticed, because it is the LAST of three fallbacks and the first two
 * almost always answer. They do not answer in exactly one situation, and it is
 * the situation the custom/fallback modelling pipeline exists for: an address
 * with NO Google photorealistic mesh. The engine hides the globe as soon as a
 * tileset object exists, and Google's ROOT tileset resolves for any valid key
 * regardless of coverage — so `scene.pick` found nothing, the terrain branch
 * was skipped because the globe was hidden, and this threw.
 *
 * Four clicks of the Gable tool did nothing, with no message, at precisely the
 * properties the tool was built for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT TOOK AN AUDIT AND NOT A TEST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every existing 3D unit test drives a MOCK viewer. A mock answers whatever the
 * test author expected it to answer, so a call to a method the real library has
 * never had passes forever. This file imports the REAL `cesium` package and
 * asks it.
 *
 * 🚨 IT IS A NAME CHECK, NOT A BEHAVIOUR CHECK, and that is the point: the
 * defect was not wrong arithmetic. It was a call into empty space.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Cesium from 'cesium';
import { stripComments } from './support/stripSource';

const ENGINE = stripComments(
  readFileSync(join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'),
);

describe('🚨 the method that did not exist', () => {
  it('Ellipsoid has no intersectWithRay — the old fallback could only throw', () => {
    // Asserted against the real library, so this records a fact rather than a
    // belief. If a future Cesium adds it, this test tells us, and the fix
    // below stops being necessary rather than silently becoming wrong.
    expect((Cesium.Ellipsoid.prototype as any).intersectWithRay).toBeUndefined();
  });

  it('…and the engine no longer calls it', () => {
    const PATTERN = /ellipsoid\.intersectWithRay\s*\(/;
    // Prove the pattern can fire before trusting a .not.toMatch to mean
    // anything — a guard whose regex cannot match passes against any source.
    expect('globe.ellipsoid.intersectWithRay(ray)').toMatch(PATTERN);
    expect(ENGINE, 'the dead ellipsoid call is back').not.toMatch(PATTERN);
  });

  it('the replacement DOES exist, in the pinned API', () => {
    expect(typeof (Cesium.Camera.prototype as any).pickEllipsoid).toBe('function');
    // The alternative, kept named so a future reader knows it was considered.
    expect(typeof (Cesium.IntersectionTests as any).rayEllipsoid).toBe('function');
  });

  it('🚨 the fallback picks at the GROUND, not at ellipsoid zero', () => {
    // A bare WGS84 pick lands at h = 0 while `finalizeRoofSection` builds the
    // section at `groundElevM`. Measured by an audit: the traced corner and the
    // rendered eave corner ended up 420 px apart on a 1000 px canvas at 3
    // Melvin Dr, and 966 px at Denver elevation — the roof appears nowhere near
    // where it was drawn.
    // 🚨 ANCHORED ON CODE, NOT ON A COMMENT. The first version sliced from
    // `indexOf('Fallback: ellipsoid pick')` — a comment, which `stripComments`
    // has already removed, so the slice came out empty and the assertions
    // below would have failed for a reason that had nothing to do with what
    // they protect. (Empty is the lucky direction; a `.not.toMatch` anchored
    // that way would have passed vacuously.)
    const i = ENGINE.indexOf('const base = viewer.scene.globe?.ellipsoid');
    expect(i, 'the ellipsoid fallback was not found — re-anchor this guard').toBeGreaterThan(-1);
    const block = ENGINE.slice(i, i + 1_200);
    expect(block).toMatch(/camera\.pickEllipsoid\(/);
    expect(block).toMatch(/cesiumGroundElevResolvedRef\.current/);
    expect(block).toMatch(/new C\.Ellipsoid\(/);
    // And it says which datum answered, so a log can be read later.
    expect(block).toMatch(/ellipsoid@ground/);
  });
});

describe('🚨 a corner pick that lands on nothing says so', () => {
  it('both section tools report a missed click instead of returning in silence', () => {
    for (const fn of ['handleGableClick', 'handleHipClick']) {
      const i = ENGINE.indexOf(`function ${fn}(`);
      expect(i, `${fn} not found`).toBeGreaterThan(-1);
      const body = ENGINE.slice(i, i + 2_400);

      // The bare early return is what made a dead pick invisible.
      const BARE = /if \(!hit\) return;/;
      expect('      if (!hit) return;').toMatch(BARE);
      expect(body, `${fn} still swallows a missed pick`).not.toMatch(BARE);

      expect(body).toMatch(/missed\(/);
      expect(body).toMatch(/setStatusMsg\(/);
    }
  });
});

describe('the other Cesium entry points these paths depend on', () => {
  it('exist on the real library', () => {
    // Not exhaustive — these are the ones the section creation path takes, and
    // the ones a mock would happily fake.
    expect(typeof (Cesium.Cartographic as any).fromCartesian).toBe('function');
    expect(typeof (Cesium.Camera.prototype as any).getPickRay).toBe('function');
    expect(typeof (Cesium.Ellipsoid.prototype as any).geodeticSurfaceNormal).toBe('function');
    expect(typeof (Cesium.Cartesian3 as any).fromDegrees).toBe('function');
    expect(typeof (Cesium.BoundingSphere as any).fromPoints).toBe('function');
    // An Ellipsoid really can be constructed from three radii, which is how the
    // ground-height pick is built.
    const e = new Cesium.Ellipsoid(6378237, 6378237, 6356852.314245);
    expect(e.radii.x).toBeCloseTo(6378237, 6);
  });
});
