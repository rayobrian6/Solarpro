/**
 * tests/shadeFaceElevation.test.ts
 *
 * A HAND-BUILT GARAGE CASTS A SHADOW.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "Custom-mode Shade must consume canonical custom buildings, detached garage,
 *    trees, chimney, raised roof obstructions, nearby structures…"
 *
 * It could not consume any building it had not been handed by Google.
 * `buildShadeScene` read a face's height as:
 *
 *     Number.isFinite(f.planeHeightAtCenterMeters) ? f.planeHeightAtCenterMeters : ground
 *
 * and `buildRoofPlane3D` writes **0.0** there deliberately, as a sentinel
 * meaning "do not use me, my elevation is in `origin3D`". `Number.isFinite(0)`
 * is true, so every hand-traced, gable-tool and section-edited face was placed
 * at ELLIPSOID ZERO — about 140 m below the ground at this site. Underground
 * buildings do not shade anything.
 *
 * 🚨 ONLY `solar_api` FACES, which carry a real declared height, could ever
 * occlude — in a feature whose entire purpose is to make the design's OWN
 * geometry cast shade.
 *
 * This is the same `??`-keeps-zero trap that once placed a whole array at ground
 * elevation in `resolvePlaneGeometry`. It is now explicit, and tested for.
 */

import { describe, it, expect } from 'vitest';
import {
  buildShadeScene,
  profileForPanel,
  faceTopM,
  geodeticHeightOfEcef,
} from '@/lib/shade/canonicalShadeScene';

const LAT = 38.70615;
const LNG = -90.04625;
const GROUND = 140; // St Louis-ish, metres above the ellipsoid

/** WGS84 lat/lng/height -> ECEF, so fixtures use real coordinates. */
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

/** Metres north of the reference point, as a latitude. */
const north = (m: number) => LAT + m / 111_320;

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the ECEF inverse', () => {
  it('round-trips a height at a real address', () => {
    expect(geodeticHeightOfEcef(ecef(LAT, LNG, GROUND))).toBeCloseTo(GROUND, 4);
    expect(geodeticHeightOfEcef(ecef(LAT, LNG, GROUND + 9.5))).toBeCloseTo(GROUND + 9.5, 4);
  });

  it('works at the equator, at altitude, and in the southern hemisphere', () => {
    expect(geodeticHeightOfEcef(ecef(0, 0, 0))).toBeCloseTo(0, 4);
    expect(geodeticHeightOfEcef(ecef(39.74, -104.99, 1609))).toBeCloseTo(1609, 3);
    expect(geodeticHeightOfEcef(ecef(-33.87, 151.21, 58))).toBeCloseTo(58, 4);
    expect(geodeticHeightOfEcef(ecef(71.0, 25.8, 12))).toBeCloseTo(12, 4);
  });

  it('bad input is NaN, not a wild number', () => {
    expect(Number.isNaN(geodeticHeightOfEcef(null))).toBe(true);
    expect(Number.isNaN(geodeticHeightOfEcef(undefined))).toBe(true);
    expect(Number.isNaN(geodeticHeightOfEcef({ x: NaN, y: 0, z: 0 }))).toBe(true);
  });
});

describe('🚨 0.0 is a sentinel, not an elevation', () => {
  it('a hand-traced face reports the height in its origin3D', () => {
    const face = {
      id: 'garage',
      planeHeightAtCenterMeters: 0.0,          // the sentinel
      origin3D: ecef(LAT, LNG, GROUND + 6.5),  // the truth
      vertices: [{ lat: LAT, lng: LNG }],
    };
    expect(faceTopM(face, GROUND)).toBeCloseTo(GROUND + 6.5, 3);
  });

  it('…and it is NOT read as zero', () => {
    // The whole defect in one assertion: 0 must never become the answer while
    // an origin3D exists.
    const face = {
      id: 'garage',
      planeHeightAtCenterMeters: 0.0,
      origin3D: ecef(LAT, LNG, GROUND + 6.5),
    };
    expect(faceTopM(face, GROUND)).not.toBeCloseTo(0, 1);
    expect(faceTopM(face, GROUND)).toBeGreaterThan(100);
  });

  it('a Google face with a real declared height still uses it', () => {
    // The declared value wins when it is a real value, so nothing regresses on
    // the native path.
    const face = { id: 'seg', planeHeightAtCenterMeters: GROUND + 4.2 };
    expect(faceTopM(face, GROUND)).toBeCloseTo(GROUND + 4.2, 6);
  });

  it('a face with neither falls back to the ground, not to zero', () => {
    expect(faceTopM({ id: 'bare' }, GROUND)).toBeCloseTo(GROUND, 6);
    expect(faceTopM({ id: 'bare', planeHeightAtCenterMeters: undefined }, GROUND)).toBeCloseTo(GROUND, 6);
  });
});

describe('🚨 a hand-built garage occludes', () => {
  /** A 6.5 m detached garage 10 m due south of the array, traced by hand. */
  const garage = {
    id: 'garage',
    planeHeightAtCenterMeters: 0.0,
    origin3D: ecef(north(-10), LNG, GROUND + 6.5),
    centroidLat: north(-10),
    centroidLng: LNG,
    area: 60,
    vertices: [
      { lat: north(-13), lng: LNG - 0.00005 },
      { lat: north(-13), lng: LNG + 0.00005 },
      { lat: north(-7),  lng: LNG + 0.00005 },
      { lat: north(-7),  lng: LNG - 0.00005 },
    ],
  };

  const panel = { id: 'p1', lat: LAT, lng: LNG, height: GROUND + 3, planeId: 'main' };

  it('the scene places it above the ground, not below it', () => {
    const scene = buildShadeScene({ roofPlanes: [garage], groundElevM: GROUND });
    const g = scene.find(o => o.id === 'garage');
    expect(g, 'the garage is not in the scene at all').toBeTruthy();
    expect(g!.topM).toBeCloseTo(GROUND + 6.5, 3);
    // 🚨 THE OLD ANSWER. Ellipsoid zero, 140 m underground.
    expect(g!.topM).toBeGreaterThan(GROUND);
  });

  it('and the panel south of it sees something in the way', () => {
    const scene = buildShadeScene({ roofPlanes: [garage], groundElevM: GROUND });
    const profile = profileForPanel(panel, scene, GROUND);
    expect(profile.nearbyObstruction, 'no occluder reached the panel').toBeTruthy();
    expect(profile.nearbyObstruction!.length).toBeGreaterThan(0);
    const hit = profile.nearbyObstruction![0];
    // It stands 3.5 m above the panel and about 10 m away, to the south.
    expect(hit.heightM).toBeCloseTo(3.5, 1);
    expect(hit.distanceM).toBeCloseTo(10, 0);
    expect(hit.azimuthDeg).toBeGreaterThan(150);
    expect(hit.azimuthDeg).toBeLessThan(210);
  });

  it('🚨 MUTATION PROOF: read the sentinel literally and the garage vanishes', () => {
    // Exactly the old expression, on the same fixture.
    const oldTopM = Number.isFinite(garage.planeHeightAtCenterMeters)
      ? garage.planeHeightAtCenterMeters
      : GROUND;
    expect(oldTopM).toBe(0);
    // A 6.5 m garage recorded as standing at ellipsoid zero is 140 m below the
    // panel, so it can never appear above its horizon.
    expect(oldTopM).toBeLessThan(panel.height - 100);
    // …while the corrected value is above it.
    expect(faceTopM(garage, GROUND)).toBeGreaterThan(panel.height);
  });

  it('the panel is not shaded by its own roof', () => {
    // The existing rule must survive: a face does not shade what is bolted to it.
    const ownRoof = { ...garage, id: 'main', centroidLat: LAT, centroidLng: LNG };
    const scene = buildShadeScene({ roofPlanes: [ownRoof], groundElevM: GROUND });
    const profile = profileForPanel(panel, scene, GROUND);
    expect(profile.nearbyObstruction ?? []).toHaveLength(0);
  });
});
