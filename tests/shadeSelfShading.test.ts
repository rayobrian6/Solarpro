/**
 * tests/shadeSelfShading.test.ts
 *
 * A HOUSE DOES NOT SHADE ITSELF.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRESSION THE PREVIOUS FIX CREATED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `buildShadeScene` models a roof face as a disc at its centroid with a radius.
 * That is reasonable for a NEIGHBOURING structure and badly wrong for the other
 * half of the roof the panel is bolted to: the opposite slope of a gable has its
 * centroid a few metres away and a few metres up, so it reads as a wall blocking
 * about 50°.
 *
 * 🚨 IT WAS DORMANT UNTIL THE ELEVATION FIX MADE IT LIVE. Every hand-built face
 * used to sit at ellipsoid zero and occlude nothing, so correcting `faceTopM` to
 * read the true elevation turned a latent modelling error into a real one: an
 * adversary measured an ordinary gable plus a wing, with an EMPTY scene,
 * reporting 6.4% annual loss — and that number goes into PVWatts and the
 * customer's proposal.
 *
 * Fixing one phantom loss and creating another is not progress, which is why
 * this file exists.
 *
 * The rule is physical: the slopes of one roof meet at a ridge, and what a ridge
 * costs is the inter-row model's business, not the obstruction model's.
 */

import { describe, it, expect } from 'vitest';
import { buildShadeScene, profileForPanel, faceTopM } from '@/lib/shade/canonicalShadeScene';

const LAT = 38.70615;
const LNG = -90.04625;
const GROUND = 140;

function ecef(latDeg: number, lngDeg: number, h: number) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return {
    x: (N + h) * Math.cos(lat) * Math.cos(lng),
    y: (N + h) * Math.cos(lat) * Math.sin(lng),
    z: (N * (1 - e2) + h) * Math.sin(lat),
  };
}
const north = (m: number) => LAT + m / 111_320;

/** One gable: two slopes of the SAME section, either side of an E–W ridge. */
const eastSlope = {
  id: 'sec-1::slopeA', sectionId: 'sec-1',
  planeHeightAtCenterMeters: 0,
  origin3D: ecef(north(-3), LNG, GROUND + 6.5),
  centroidLat: north(-3), centroidLng: LNG, area: 60,
  vertices: [
    { lat: north(-6), lng: LNG - 0.00006 }, { lat: north(-6), lng: LNG + 0.00006 },
    { lat: north(0),  lng: LNG + 0.00006 }, { lat: north(0),  lng: LNG - 0.00006 },
  ],
};
const westSlope = {
  ...eastSlope,
  id: 'sec-1::slopeB',
  origin3D: ecef(north(3), LNG, GROUND + 6.5),
  centroidLat: north(3), centroidLng: LNG,
  vertices: [
    { lat: north(0), lng: LNG - 0.00006 }, { lat: north(0), lng: LNG + 0.00006 },
    { lat: north(6), lng: LNG + 0.00006 }, { lat: north(6), lng: LNG - 0.00006 },
  ],
};
/** A separate single-storey wing — a DIFFERENT section, which may shade. */
const wing = {
  id: 'sec-2::deck', sectionId: 'sec-2',
  planeHeightAtCenterMeters: 0,
  origin3D: ecef(north(-14), LNG, GROUND + 9.5),
  centroidLat: north(-14), centroidLng: LNG, area: 40,
  vertices: [
    { lat: north(-17), lng: LNG - 0.00005 }, { lat: north(-17), lng: LNG + 0.00005 },
    { lat: north(-11), lng: LNG + 0.00005 }, { lat: north(-11), lng: LNG - 0.00005 },
  ],
};

/** A module on the east slope of the gable. */
const panel = {
  id: 'p1', lat: north(-3), lng: LNG, height: GROUND + 6.0,
  planeId: 'sec-1::slopeA', sectionId: 'sec-1',
};

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the other half of your own roof is not an obstruction', () => {
  it('a gable with nothing near it casts no shade on itself', () => {
    const scene = buildShadeScene({ roofPlanes: [eastSlope, westSlope], groundElevM: GROUND });
    const profile = profileForPanel(panel, scene, GROUND);
    expect(profile.nearbyObstruction ?? [], 'the house shades itself').toHaveLength(0);
  });

  it('…and that is not because the faces are missing from the scene', () => {
    // The guard must be the SECTION rule, not an elevation that quietly failed.
    // Without this the test above would pass for the old, wrong reason.
    const scene = buildShadeScene({ roofPlanes: [eastSlope, westSlope], groundElevM: GROUND });
    expect(scene).toHaveLength(2);
    for (const o of scene) {
      expect(o.topM, 'a face is back at the ellipsoid').toBeGreaterThan(GROUND);
      expect(o.sectionId).toBe('sec-1');
    }
  });

  it('🚨 a DIFFERENT building still shades — the guard is not a blanket', () => {
    const scene = buildShadeScene({
      roofPlanes: [eastSlope, westSlope, wing], groundElevM: GROUND,
    });
    const profile = profileForPanel(panel, scene, GROUND);
    const hits = profile.nearbyObstruction ?? [];
    expect(hits.length, 'the neighbouring wing stopped shading').toBeGreaterThan(0);
    expect(hits.every(h => h.sourceId !== 'sec-1::slopeB')).toBe(true);
    expect(hits.some(h => h.sourceId === 'sec-2::deck')).toBe(true);
  });

  it('a panel with no section is not silently exempted from everything', () => {
    // The guard needs BOTH sides. A panel carrying no sectionId must still be
    // shaded by other buildings; it simply loses the self-shade exemption.
    const orphan = { ...panel, sectionId: undefined };
    const scene = buildShadeScene({ roofPlanes: [wing], groundElevM: GROUND });
    expect((profileForPanel(orphan, scene, GROUND).nearbyObstruction ?? []).length)
      .toBeGreaterThan(0);
  });
});

describe('🚨 planeHeightAtCenterMeters: how the datum is read, and why it was not changed', () => {
  it('a solar_api face declares an ABSOLUTE elevation', () => {
    const f = { id: 'seg', source: 'solar_api', planeHeightAtCenterMeters: GROUND + 4.2 };
    expect(faceTopM(f, GROUND)).toBeCloseTo(GROUND + 4.2, 6);
  });

  it('🚨 a declared non-zero height is read as ABSOLUTE for every source — for now', () => {
    // An adversary argued (PLAUSIBLE, never reproduced) that this field means
    // height-above-ground for any source other than solar_api, citing
    // lib/surfaceGeometry3D.ts:607, which does say that.
    //
    // Reading it that way was tried and moved four existing fixtures by the full
    // ground elevation, because all of them encode the opposite. Only
    // `buildRoofPlane3D` writes this field for a hand-built face, and it writes
    // the 0.0 SENTINEL — so the disputed branch is unreachable in production and
    // could only break the tests describing today's behaviour.
    //
    // This test records the decision, not a preference: the reading does not
    // change on an unproven claim. `source` is carried on the type so it can be
    // settled with evidence later.
    const f = { id: 'hand', source: 'manual', planeHeightAtCenterMeters: GROUND + 4 };
    expect(faceTopM(f, GROUND)).toBeCloseTo(GROUND + 4, 6);
  });

  it('origin3D still wins over a declared height for a hand-built face', () => {
    // It is already absolute and needs no datum argument at all.
    const f = {
      id: 'hand', source: 'manual',
      planeHeightAtCenterMeters: 0,
      origin3D: ecef(LAT, LNG, GROUND + 7.25),
    };
    expect(faceTopM(f, GROUND)).toBeCloseTo(GROUND + 7.25, 3);
  });

  it('nothing at all falls back to the ground, not to zero', () => {
    expect(faceTopM({ id: 'bare' }, GROUND)).toBeCloseTo(GROUND, 6);
  });
});
