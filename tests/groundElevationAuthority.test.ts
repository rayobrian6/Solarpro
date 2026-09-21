/**
 * tests/groundElevationAuthority.test.ts
 *
 * ONE QUESTION, ONE ANSWER: "what is the ground elevation at this site, and do
 * we know it?"
 *
 * Six layers used to answer that question by returning 0, and 0 is a perfectly
 * ordinary elevation:
 *
 *   1. app/api/elevation/route.ts   no Google result   -> { elevation: 0 }, HTTP 200
 *   2. app/api/elevation/route.ts   exception          -> { elevation: 0 }, HTTP 500
 *   3. lib/digitalTwin.ts           `data.elevation > 0` rejected every legitimate
 *                                   at-or-below-sea-level answer
 *   4. lib/digitalTwin.ts           total failure      -> return 0
 *   5. lib/digitalTwin.ts           rejected promise   -> elevation = 0
 *   6. components/3d/SolarEngine3D  `?? 0`, then `resolved = true` UNCONDITIONALLY
 *
 * Step 6 is the one that mattered: `shouldRunLaneA` already refuses on
 * `!groundElevResolved`, and the camera already widens when it is false. The
 * correct behaviour was written and was simply never reachable, because the flag
 * was stamped true directly beneath a `?? 0`.
 *
 * WHAT THIS FILE PINS, AND WHY THE TWO HALVES LOOK CONTRADICTORY
 * -------------------------------------------------------------
 * The Google/Solar-API path is IMMUNE to a wrong base elevation and the
 * hand-modelled 2D path is NOT. That is not a guess; it is arithmetic, and it is
 * measured here in both directions:
 *
 *   extractRoofSegments emits  heightAboveGround = planeHeightAtCenterMeters - base
 *   the renderer then places   worldHeight       = (base + geoid) + heightAboveGround
 *                                                = geoid + planeHeightAtCenterMeters
 *
 * `base` cancels. A Google roof lands in exactly the right place whether the
 * elevation lookup answered 80 m or failed to 0.
 *
 * A 2D-traced face has no such absorbing term: `planeHeightAtCenterMeters` on it
 * is a RELATIVE height above ground, so `computeEcefFrameForLegacyPlane` adds the
 * datum once and a wrong datum moves the whole face. Measured below: 80 m.
 *
 * So the failure is invisible on the preferred provider and catastrophic on the
 * fallback provider — which is precisely the path a user is on when Google data
 * was unusable in the first place.
 */

import { describe, it, expect } from 'vitest';
import { extractRoofSegments, fetchElevation } from '@/lib/digitalTwin';
import { segmentToRoofPlane, shouldRunLaneA } from '@/lib/3d/laneA';
import { computeEcefFrameForLegacyPlane } from '@/lib/surfaceGeometry3D';
import { geoidUndulationM, resolveGroundDatum } from '@/lib/geodeticDatum';

// Alexandria VA — the demo address this family of failures was first seen at.
const LAT = 38.8048;
const LNG = -77.0469;
const TRUE_GROUND_ORTHO_M = 80;   // metres above sea level, as Google reports it
const ROOF_ABOVE_GROUND_M = 5;    // ordinary single-storey ridge height
const GEOID_M = geoidUndulationM(LAT);

/** Distance from the ellipsoid centre. Differences in this are differences in
 *  height, which is all these assertions need. */
function radius(p: { x: number; y: number; z: number }): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
}

function hull() {
  const d = 0.00005;
  return [
    { lat: LAT - d, lng: LNG - d * 1.5 },
    { lat: LAT - d, lng: LNG + d * 1.5 },
    { lat: LAT + d, lng: LNG + d * 1.5 },
    { lat: LAT + d, lng: LNG - d * 1.5 },
  ];
}

/** A Google Solar buildingInsights payload whose roof is ROOF_ABOVE_GROUND_M
 *  above a site at TRUE_GROUND_ORTHO_M. `planeHeightAtCenterMeters` is ABSOLUTE
 *  (above sea level) — that is what Google returns, and it is why the base
 *  elevation cancels. */
function solarPayload() {
  return {
    center: { latitude: LAT, longitude: LNG },
    solarPotential: {
      roofSegmentStats: [{
        center: { latitude: LAT, longitude: LNG },
        pitchDegrees: 25,
        azimuthDegrees: 180,
        planeHeightAtCenterMeters: TRUE_GROUND_ORTHO_M + ROOF_ABOVE_GROUND_M,
        stats: { areaMeters2: 60, groundAreaMeters2: 54, sunshineQuantiles: [0, 0, 0, 0, 0, 1400] },
        boundingBox: {
          sw: { latitude: LAT - 0.00004, longitude: LNG - 0.00006 },
          ne: { latitude: LAT + 0.00004, longitude: LNG + 0.00006 },
        },
      }],
      solarPanels: [],
      panelWidthMeters: 1.045,
      panelHeightMeters: 1.879,
    },
  };
}

/** Drive the REAL production pair — extractRoofSegments then segmentToRoofPlane —
 *  the way lib/digitalTwin.ts and detectPlanesFromTwin do, for a given base. */
function googleRoofHeightForBase(baseOrtho: number): number {
  const segs = extractRoofSegments(solarPayload(), baseOrtho);
  const plane = segmentToRoofPlane(
    {
      center: { lat: LAT, lng: LNG },
      convexHull: hull(),
      pitchDegrees: 25,
      azimuthDegrees: 180,
      heightAboveGround: segs[0].heightAboveGround,
    },
    baseOrtho + GEOID_M,   // the ellipsoidal datum the engine pairs with it
  );
  expect(plane).not.toBeNull();
  return radius(plane!.origin3D as any);
}

describe('ground elevation — the Google/Solar-API provider absorbs a wrong datum', () => {
  it('places the roof identically whether the elevation lookup answered or failed to 0', () => {
    const truth  = googleRoofHeightForBase(TRUE_GROUND_ORTHO_M);
    const failed = googleRoofHeightForBase(0);

    // Sub-millimetre. The base elevation term cancels exactly.
    expect(Math.abs(failed - truth)).toBeLessThan(1e-3);
  });

  it('absorbs it by inflating heightAboveGround by exactly the missing datum', () => {
    // This is the MECHANISM of the cancellation, pinned separately so that a
    // change to extractRoofSegments which breaks it fails HERE, naming the cause,
    // rather than only showing up as a mystery offset in the test above.
    const truth  = extractRoofSegments(solarPayload(), TRUE_GROUND_ORTHO_M)[0];
    const failed = extractRoofSegments(solarPayload(), 0)[0];

    expect(truth.heightAboveGround).toBeCloseTo(ROOF_ABOVE_GROUND_M, 6);
    expect(failed.heightAboveGround).toBeCloseTo(TRUE_GROUND_ORTHO_M + ROOF_ABOVE_GROUND_M, 6);
    expect(failed.heightAboveGround - truth.heightAboveGround).toBeCloseTo(TRUE_GROUND_ORTHO_M, 6);
  });
});

describe('ground elevation — the hand-modelled 2D fallback provider does NOT absorb it', () => {
  /** A face as DesignStudio's "Tag This Roof Plane" produces it: lat/lng vertices
   *  plus pitch and azimuth, enriched only with a localFrame3D. It has NO
   *  origin3D and NO ecefFrame3D, so resolvePlaneGeometry routes it to
   *  computeEcefFrameForLegacyPlane, where planeHeightAtCenterMeters is a
   *  RELATIVE height and the datum is applied once, unabsorbed. */
  function tracedPlane(): any {
    return {
      id: 'traced-1',
      vertices: hull(),
      pitch: 25,
      azimuth: 180,
      area: 60,
      usableArea: 54,
      centroidLat: LAT,
      centroidLng: LNG,
      planeHeightAtCenterMeters: ROOF_ABOVE_GROUND_M,
      source: 'manual',
    };
  }

  it('lands 80 m below the real roof when the elevation lookup fails to 0', () => {
    const truth  = computeEcefFrameForLegacyPlane(tracedPlane(), TRUE_GROUND_ORTHO_M + GEOID_M);
    const failed = computeEcefFrameForLegacyPlane(tracedPlane(), 0 + GEOID_M);

    const dropM = radius(truth.origin3D) - radius(failed.origin3D);

    // The whole site elevation, lost. Asserted as a band rather than a point so
    // this does not become a change-detector on ECEF rounding, but far tighter
    // than the 0.12 m render lift or the 3.7 mm coordinate quantum — this cannot
    // pass by accident.
    expect(dropM).toBeGreaterThan(TRUE_GROUND_ORTHO_M - 0.05);
    expect(dropM).toBeLessThan(TRUE_GROUND_ORTHO_M + 0.05);
  });

  it('and 48 m below it on the bare groundElevM=0 sentinel', () => {
    // The other shape of the same failure: a caller that passes 0 because the
    // elevation is "unresolved". 0 is indistinguishable from sea level, so the
    // face is built at roof-height-above-the-ELLIPSOID.
    const truth    = computeEcefFrameForLegacyPlane(tracedPlane(), TRUE_GROUND_ORTHO_M + GEOID_M);
    const sentinel = computeEcefFrameForLegacyPlane(tracedPlane(), 0);

    const dropM = radius(truth.origin3D) - radius(sentinel.origin3D);
    expect(dropM).toBeGreaterThan(40);   // measured 47.87 m — well beyond any tolerance
  });
});

describe('ground elevation — absence must stay absent', () => {
  const realFetch = globalThis.fetch;

  function withFetch(impl: any, fn: () => Promise<void>) {
    (globalThis as any).fetch = impl;
    return fn().finally(() => { (globalThis as any).fetch = realFetch; });
  }

  it('fetchElevation returns null — not 0 — when the proxy has no answer', async () => {
    await withFetch(
      async () => ({ ok: true, json: async () => ({ elevation: null, reason: 'no-result' }) }),
      async () => {
        // The direct-Google fallback also fails (no browser key), which is the
        // real production shape of this failure.
        expect(await fetchElevation(LAT, LNG)).toBeNull();
      },
    );
  });

  it('fetchElevation returns null when the proxy itself errors', async () => {
    await withFetch(
      async () => { throw new Error('network'); },
      async () => { expect(await fetchElevation(LAT, LNG)).toBeNull(); },
    );
  });

  it('KEEPS a legitimate at-or-below-sea-level elevation instead of discarding it', async () => {
    // The old `data.elevation > 0` guard threw these away and fell through to a
    // browser-side Google call that cannot work, yielding 0. Imperial Valley,
    // New Orleans and the Salton Sea are real solar markets.
    for (const real of [0, -2.4, -20, -70.1]) {
      await withFetch(
        async () => ({ ok: true, json: async () => ({ elevation: real }) }),
        async () => { expect(await fetchElevation(33.0, -115.5)).toBe(real); },
      );
    }
  });

  it('Lane A refuses to detect a roof while the datum is unknown', () => {
    // This gate already existed and was already correct. It was unreachable,
    // because `resolved` was stamped true unconditionally. Pinned so that a
    // future "simplification" of the stamp fails here.
    const base = {
      stage: 'done' as const,
      restoreResolved: true,
      segmentCount: 4,
      existingPlaneCount: 0,
      siteKey: 'site-abc',
      lastRanSiteKey: null,
    };
    expect(shouldRunLaneA({ ...base, groundElevResolved: true })).toBe(true);
    expect(shouldRunLaneA({ ...base, groundElevResolved: false })).toBe(false);
  });
});

describe('resolveGroundDatum — the one place the flag and the value are decided together', () => {
  it('resolves an ordinary inland elevation to an ellipsoidal datum', () => {
    const d = resolveGroundDatum(TRUE_GROUND_ORTHO_M, LAT);
    expect(d.resolved).toBe(true);
    if (!d.resolved) throw new Error('unreachable');
    expect(d.orthometricM).toBe(TRUE_GROUND_ORTHO_M);
    expect(d.ellipsoidalM).toBeCloseTo(TRUE_GROUND_ORTHO_M + GEOID_M, 9);
  });

  it('TREATS 0 AS A REAL ELEVATION, not as absence', () => {
    // A site genuinely at sea level. The whole failure this file documents began
    // with 0 being read as "we do not know".
    const d = resolveGroundDatum(0, LAT);
    expect(d.resolved).toBe(true);
    if (!d.resolved) throw new Error('unreachable');
    expect(d.ellipsoidalM).toBeCloseTo(GEOID_M, 9);
  });

  it('resolves a genuinely negative elevation (Salton Sea)', () => {
    const d = resolveGroundDatum(-70.1, 33.3);
    expect(d.resolved).toBe(true);
    if (!d.resolved) throw new Error('unreachable');
    expect(d.ellipsoidalM).toBeCloseTo(-70.1 + geoidUndulationM(33.3), 9);
  });

  for (const absent of [null, undefined, NaN, Infinity]) {
    it(`REFUSES rather than inventing a datum for ${String(absent)}`, () => {
      const d = resolveGroundDatum(absent as any, LAT);
      expect(d.resolved).toBe(false);
      expect(d.reason).toBe('elevation-unknown');
      // The specific wrong answer this replaces: geoidUndulationM(lat) alone,
      // which is a plausible-looking ~-32 m and is what `0 + geoid` produced.
      expect((d as any).ellipsoidalM).toBeUndefined();
    });
  }
});
