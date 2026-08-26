/**
 * tests/block3d.test.ts
 *
 * Pure-math tests for the v64 Block / Gable / Hip primitives. The math
 * lives in lib/3d/blockMath.ts and is called from SolarEngine3D.tsx.
 *
 * These tests do NOT need Cesium, a browser, or a 3D scene — they just
 * verify the geometry is mathematically correct.
 *
 * What this guards:
 *   - footprint dimension conversion (lat/lng → meters) is accurate
 *   - gable ridge is at the centroid, parallel to the long edge
 *   - gable ridge rise matches (short_edge/2) * tan(pitch)
 *   - hip ridge is set back from BOTH short eave edges
 *   - hip ridge is shorter than the eave long edge
 *   - block height clamp is 1.0m ≤ h ≤ 30.0m
 *   - degenerate footprints (sub-meter) are flagged
 */

import { describe, it, expect } from 'vitest';
import {
  computeBlockDimensions,
  computeGableGeometry,
  computeHipGeometry,
  clampBlockHeight,
  METERS_PER_DEG_LAT,
  metersPerDegLng,
} from '@/lib/3d/blockMath';

const ALEX_LAT = 38.818;     // Alexandria VA — typical suburban address
const ALEX_LNG = -77.082;

// ─── Coordinate conversion helpers ───────────────────────────────────────

describe('blockMath — coordinate conversion', () => {
  it('METERS_PER_DEG_LAT is approximately 111.32 km', () => {
    // 1° latitude is ~111 km everywhere (the Earth is an oblate spheroid but
    // 111.32 is the canonical mean). The exact value varies <0.5%.
    expect(METERS_PER_DEG_LAT).toBeGreaterThan(110_000);
    expect(METERS_PER_DEG_LAT).toBeLessThan(112_000);
  });

  it('metersPerDegLng shrinks toward the poles', () => {
    const atEquator = metersPerDegLng(0);
    const atAlex    = metersPerDegLng(ALEX_LAT);
    // At 89.99° the cosine is ~0.000175, so lng is ~19m — much smaller than 86km at the equator
    const nearPole  = metersPerDegLng(89.99);
    expect(atEquator).toBeGreaterThan(atAlex);
    expect(atAlex).toBeGreaterThan(nearPole);
    expect(nearPole).toBeLessThan(100); // nearly 0 at the pole
  });

  it('1° of latitude at Alexandria VA is 111,320 m', () => {
    expect(METERS_PER_DEG_LAT).toBeCloseTo(111_320, 0);
  });
});

// ─── Block dimensions ───────────────────────────────────────────────────

describe('blockMath — block dimensions from 2 corners', () => {
  it('a 30ft × 20ft gable near Alexandria VA gives width≈9.14m depth≈6.10m', () => {
    // 30ft east-west (width, the long edge) = 9.144m → dLng = 9.144 / metersPerDegLng(ALEX_LAT)
    // 20ft north-south (depth, the short edge) = 6.096m → dLat = 6.096 / 111320
    const widthM = 9.144;
    const depthM = 6.096;
    const dLng = widthM / metersPerDegLng(ALEX_LAT);   // east-west delta
    const dLat = depthM / METERS_PER_DEG_LAT;          // north-south delta
    const sw = { lat: ALEX_LAT, lng: ALEX_LNG };
    const ne = { lat: ALEX_LAT + dLat, lng: ALEX_LNG + dLng };
    const d = computeBlockDimensions(sw, ne, 6);
    expect(d.widthM).toBeCloseTo(9.14, 1);
    expect(d.depthM).toBeCloseTo(6.10, 1);
    expect(d.heightM).toBe(6);
  });

  it('centroid is the midpoint of SW and NE', () => {
    const sw = { lat: 38.8, lng: -77.0 };
    const ne = { lat: 38.9, lng: -77.1 };
    const d = computeBlockDimensions(sw, ne, 5);
    expect(d.centroidLat).toBeCloseTo(38.85, 10);
    expect(d.centroidLng).toBeCloseTo(-77.05, 10);
  });

  it('normalizes the corners so SW is the smaller, NE is the larger', () => {
    // If user clicks NE first, then SW, the function still normalizes.
    const sw_in = { lat: 38.9, lng: -77.1 };
    const ne_in = { lat: 38.8, lng: -77.0 };
    const d = computeBlockDimensions(sw_in, ne_in, 5);
    expect(d.sw.lat).toBeLessThan(d.ne.lat);
    expect(d.sw.lng).toBeLessThan(d.ne.lng);
  });
});

// ─── Gable geometry ─────────────────────────────────────────────────────

describe('blockMath — gable geometry', () => {
  // Helper: a 30ft east-west × 20ft north-south footprint near Alexandria
  function makeGableInputs() {
    const widthM = 9.144;  // east-west, the long edge
    const depthM = 6.096;  // north-south, the short edge
    const dLng = widthM / metersPerDegLng(ALEX_LAT);
    const dLat = depthM / METERS_PER_DEG_LAT;
    return {
      sw: { lat: ALEX_LAT, lng: ALEX_LNG },
      ne: { lat: ALEX_LAT + dLat, lng: ALEX_LNG + dLng },
    };
  }

  it('gable ridge runs along the long edge (east-west for a wider-than-deep roof)', () => {
    const { sw, ne } = makeGableInputs();
    const g = computeGableGeometry(sw, ne, 6, 22);
    expect(g.longIsLng).toBe(true);
    // Ridge endpoints are at the centroid lat, displaced in lng
    const centroidLat = (sw.lat + ne.lat) / 2;
    expect(g.ridgeA.lat).toBeCloseTo(centroidLat, 6);
    expect(g.ridgeB.lat).toBeCloseTo(centroidLat, 6);
    // Ridge endpoints are symmetric around the centroid lng
    const centroidLng = (ALEX_LNG + ne.lng) / 2;
    expect((g.ridgeA.lng + g.ridgeB.lng) / 2).toBeCloseTo(centroidLng, 7);
  });

  it('gable ridge rise = (short_edge/2) * tan(pitch)', () => {
    const { sw, ne } = makeGableInputs();
    const g = computeGableGeometry(sw, ne, 6, 22);
    // short edge = 6.096m, tan(22°) ≈ 0.4040
    // rise = (6.096/2) * 0.4040 = 1.232m
    expect(g.ridgeRiseM).toBeCloseTo(1.23, 1);
  });

  it('gable ridge is higher than the eave', () => {
    const { sw, ne } = makeGableInputs();
    const g = computeGableGeometry(sw, ne, 6, 22);
    expect(g.ridgeA.h).toBeGreaterThan(g.eaveSW.h);
    expect(g.ridgeB.h).toBeGreaterThan(g.eaveSE.h);
  });

  it('steep pitch gives a higher ridge than shallow pitch', () => {
    const { sw, ne } = makeGableInputs();
    const shallow = computeGableGeometry(sw, ne, 6, 10);
    const steep   = computeGableGeometry(sw, ne, 6, 45);
    expect(steep.ridgeRiseM).toBeGreaterThan(shallow.ridgeRiseM);
  });

  it('a clearly wider-than-deep rectangle gives longIsLng=true', () => {
    // 20m east-west × 5m north-south (clearly wider than deep)
    const dLng = 20 / metersPerDegLng(ALEX_LAT);
    const dLat = 5 / METERS_PER_DEG_LAT;
    const sw = { lat: ALEX_LAT, lng: ALEX_LNG };
    const ne = { lat: ALEX_LAT + dLat, lng: ALEX_LNG + dLng };
    const g = computeGableGeometry(sw, ne, 6, 22);
    expect(g.longIsLng).toBe(true);
  });

  it('a clearly deeper-than-wide rectangle gives longIsLng=false', () => {
    // 5m east-west × 20m north-south (clearly deeper than wide)
    const dLng = 5 / metersPerDegLng(ALEX_LAT);
    const dLat = 20 / METERS_PER_DEG_LAT;
    const sw = { lat: ALEX_LAT, lng: ALEX_LNG };
    const ne = { lat: ALEX_LAT + dLat, lng: ALEX_LNG + dLng };
    const g = computeGableGeometry(sw, ne, 6, 22);
    expect(g.longIsLng).toBe(false);
  });

  it('rotated 30ft×20ft (long edge north-south) gives longIsLng=false', () => {
    // 20ft east-west, 30ft north-south — long edge is now north-south
    const widthM = 6.096;  // east-west, now the short edge
    const depthM = 9.144;  // north-south, now the long edge
    const dLng = widthM / metersPerDegLng(ALEX_LAT);
    const dLat = depthM / METERS_PER_DEG_LAT;
    const sw = { lat: ALEX_LAT, lng: ALEX_LNG };
    const ne = { lat: ALEX_LAT + dLat, lng: ALEX_LNG + dLng };
    const g = computeGableGeometry(sw, ne, 6, 22);
    expect(g.longIsLng).toBe(false);
    // Ridge runs north-south, so endpoints displaced in lat
    const centroidLng = (ALEX_LNG + ne.lng) / 2;
    expect(g.ridgeA.lng).toBeCloseTo(centroidLng, 7);
    expect(g.ridgeB.lng).toBeCloseTo(centroidLng, 7);
  });
});

// ─── Hip geometry ───────────────────────────────────────────────────────

describe('blockMath — hip geometry', () => {
  // Helper: same 30ft east-west × 20ft north-south footprint as gable
  function makeHipInputs() {
    const widthM = 9.144;
    const depthM = 6.096;
    const dLng = widthM / metersPerDegLng(ALEX_LAT);
    const dLat = depthM / METERS_PER_DEG_LAT;
    return {
      sw: { lat: ALEX_LAT, lng: ALEX_LNG },
      ne: { lat: ALEX_LAT + dLat, lng: ALEX_LNG + dLng },
    };
  }

  it('hip ridge is shorter than the eave long edge', () => {
    const { sw, ne } = makeHipInputs();
    const h = computeHipGeometry(sw, ne, 6, 22);
    // Long edge ≈ 9.14m, ridge ≈ 9.14 - 2*(6.10/3) ≈ 5.07m
    expect(h.ridgeLengthM).toBeLessThan(9.14);
    expect(h.ridgeLengthM).toBeGreaterThan(0);
    // Specifically about 5.07m
    expect(h.ridgeLengthM).toBeCloseTo(5.07, 1);
  });

  it('hip ridge is set back from BOTH short eave edges (default 1/3 of short edge)', () => {
    const { sw, ne } = makeHipInputs();
    const h = computeHipGeometry(sw, ne, 6, 22);
    // Short edge ≈ 6.10m, hipSetback = 6.10/3 ≈ 2.03m
    expect(h.hipSetbackM).toBeCloseTo(2.03, 1);
  });

  it('hip ridge rise = (short_edge/2) * tan(pitch) — same as gable', () => {
    const { sw, ne } = makeHipInputs();
    const h = computeHipGeometry(sw, ne, 6, 22);
    const g = computeGableGeometry(sw, ne, 6, 22);
    expect(h.ridgeRiseM).toBeCloseTo(g.ridgeRiseM, 6);
  });

  it('hip ridge is symmetric around the centroid (both endpoints equidistant)', () => {
    const { sw, ne } = makeHipInputs();
    const h = computeHipGeometry(sw, ne, 6, 22);
    // For longIsLng, the ridge runs east-west at the centroid lat
    expect(h.ridgeA.lat).toBeCloseTo(h.ridgeB.lat, 7);
    const centroidLng = (sw.lng + ne.lng) / 2;
    expect((h.ridgeA.lng + h.ridgeB.lng) / 2).toBeCloseTo(centroidLng, 7);
  });

  it('hip ridge length is independent of pitch (depends only on short edge setback)', () => {
    const { sw, ne } = makeHipInputs();
    const shallow = computeHipGeometry(sw, ne, 6, 10);
    const steep   = computeHipGeometry(sw, ne, 6, 45);
    expect(shallow.ridgeLengthM).toBeCloseTo(steep.ridgeLengthM, 6);
  });
});

// ─── Height clamp ───────────────────────────────────────────────────────

describe('blockMath — height clamping', () => {
  it('clamps heights below 1.0m up to 1.0m', () => {
    expect(clampBlockHeight(0.5)).toBe(1.0);
    expect(clampBlockHeight(-10)).toBe(1.0);
  });

  it('clamps heights above 30.0m down to 30.0m', () => {
    expect(clampBlockHeight(50)).toBe(30.0);
    expect(clampBlockHeight(1000)).toBe(30.0);
  });

  it('passes through heights in the safe range [1.0, 30.0]', () => {
    expect(clampBlockHeight(1.0)).toBe(1.0);
    expect(clampBlockHeight(6.0)).toBe(6.0);
    expect(clampBlockHeight(15.5)).toBe(15.5);
    expect(clampBlockHeight(30.0)).toBe(30.0);
  });
});

// ─── Degenerate footprints ──────────────────────────────────────────────

describe('blockMath — degenerate footprint detection', () => {
  it('a sub-meter footprint gives a tiny widthM/depthM (caller should reject)', () => {
    // Tiny delta: 0.0000001° at ALEX_LAT. metersPerDegLng(ALEX) ≈ 86772, so
    //   dLng → 0.0087m, dLat → 0.0111m — both well below 0.5m threshold
    const sw = { lat: ALEX_LAT, lng: ALEX_LNG };
    const ne = { lat: ALEX_LAT + 0.0000001, lng: ALEX_LNG + 0.0000001 };
    const d = computeBlockDimensions(sw, ne, 6);
    expect(d.widthM).toBeLessThan(0.5);
    expect(d.depthM).toBeLessThan(0.5);
    // The caller (handleBlockClick) checks this and refuses to place
  });

  it('a 1m × 1m footprint gives ~1m on each side', () => {
    const dLat = 1 / METERS_PER_DEG_LAT;
    const dLng = 1 / metersPerDegLng(ALEX_LAT);
    const sw = { lat: ALEX_LAT, lng: ALEX_LNG };
    const ne = { lat: ALEX_LAT + dLat, lng: ALEX_LNG + dLng };
    const d = computeBlockDimensions(sw, ne, 6);
    expect(d.widthM).toBeCloseTo(1.0, 5);
    expect(d.depthM).toBeCloseTo(1.0, 5);
  });
});
