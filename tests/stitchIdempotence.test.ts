/**
 * tests/stitchIdempotence.test.ts
 *
 * Pressing Stitch twice must not move the roof.
 *
 * computePlaneFromPoints3D lifts its fitted polygon by SURFACE_OFFSET_M (0.12 m)
 * along the normal, unconditionally, so panels and the plane do not z-fight with
 * the noisy 3D-tile mesh underneath. That is right for a FIRST fit of raw picked
 * points.
 *
 * stitchRoofVertices seeds its working copy from plane3DCesiumPtsMap — points
 * that came out of a previous fit and are therefore already lifted — re-fits
 * them, and writes the result back to that same map. So every press added
 * another 12 cm, cumulatively, floating the roof and every panel on it with no
 * visible cause. Ray pressed Stitch repeatedly while testing.
 *
 * These tests pin the fix (an explicit surfaceOffsetM of 0 when re-fitting) and,
 * just as importantly, pin that the DEFAULT still lifts — removing the offset
 * everywhere would reintroduce the z-fighting it exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import { computePlaneFromPoints3D, latLngToECEF, ecefToLatLng, SURFACE_OFFSET_M, type Cart3 } from '@/lib/roofPlane3D';

const LAT = 38.8306;
const LNG = -89.5343;
const H = 155;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

/** A pitched face, as picked corners would arrive. */
function facePoints(): Cart3[] {
  const dLng = 7 / mPerDegLng;
  const dLat = 4 / M_PER_DEG_LAT;
  return [
    latLngToECEF(LAT - dLat, LNG - dLng, H),
    latLngToECEF(LAT - dLat, LNG + dLng, H),
    latLngToECEF(LAT + dLat, LNG + dLng, H + 3.2), // ridge side higher
    latLngToECEF(LAT + dLat, LNG - dLng, H + 3.2),
  ];
}

const meanHeight = (pts: Cart3[]) =>
  pts.reduce((s, p) => s + ecefToLatLng(p).height, 0) / pts.length;

describe('stitch re-fit is idempotent', () => {
  it('re-fitting with surfaceOffsetM 0 does not move the face', () => {
    // This is the exact loop Stitch runs: fit, take projectedPts, feed them back.
    const first = computePlaneFromPoints3D(facePoints(), { surfaceOffsetM: 0 });
    const second = computePlaneFromPoints3D(first.projectedPts, { surfaceOffsetM: 0 });
    const third = computePlaneFromPoints3D(second.projectedPts, { surfaceOffsetM: 0 });
    expect(meanHeight(second.projectedPts)).toBeCloseTo(meanHeight(first.projectedPts), 4);
    expect(meanHeight(third.projectedPts)).toBeCloseTo(meanHeight(first.projectedPts), 4);
  });

  it('the OLD behaviour climbed by SURFACE_OFFSET_M on every pass', () => {
    // Reconstructs the bug so the regression is unmistakable, and documents the
    // size of the drift Ray was seeing.
    const first = computePlaneFromPoints3D(facePoints());
    const second = computePlaneFromPoints3D(first.projectedPts);
    const third = computePlaneFromPoints3D(second.projectedPts);
    const rise1 = meanHeight(second.projectedPts) - meanHeight(first.projectedPts);
    const rise2 = meanHeight(third.projectedPts) - meanHeight(second.projectedPts);
    // Vertical component of a lift along the (tilted) normal.
    expect(rise1).toBeGreaterThan(0.10);
    expect(rise1).toBeLessThanOrEqual(SURFACE_OFFSET_M + 1e-6);
    expect(rise2).toBeCloseTo(rise1, 3);
    // Five presses is over half a metre of unexplained hover.
    expect(rise1 * 5).toBeGreaterThan(0.5);
  });

  it('the DEFAULT still lifts — the offset must not be removed globally', () => {
    // It exists to stop z-fighting with the 3D-tile mesh. The fix is scoped to
    // re-fits, not a blanket removal.
    const pts = facePoints();
    const lifted = computePlaneFromPoints3D(pts);
    const flat = computePlaneFromPoints3D(pts, { surfaceOffsetM: 0 });
    expect(meanHeight(lifted.projectedPts)).toBeGreaterThan(meanHeight(flat.projectedPts));
    expect(meanHeight(lifted.projectedPts) - meanHeight(flat.projectedPts))
      .toBeLessThanOrEqual(SURFACE_OFFSET_M + 1e-6);
  });

  it('re-fitting preserves the plane orientation, not just its height', () => {
    // A drifting fit that also rotated would silently change pitch and azimuth,
    // and the sidebar number would stop matching the geometry.
    const first = computePlaneFromPoints3D(facePoints(), { surfaceOffsetM: 0 });
    const second = computePlaneFromPoints3D(first.projectedPts, { surfaceOffsetM: 0 });
    expect(second.tiltDeg).toBeCloseTo(first.tiltDeg, 4);
    expect(second.azimuthDeg).toBeCloseTo(first.azimuthDeg, 4);
  });

  it('a flat face is equally stable across re-fits', () => {
    const flatFace = facePoints().map(p => {
      const g = ecefToLatLng(p);
      return latLngToECEF(g.lat, g.lng, H);
    });
    const a = computePlaneFromPoints3D(flatFace, { surfaceOffsetM: 0 });
    const b = computePlaneFromPoints3D(a.projectedPts, { surfaceOffsetM: 0 });
    expect(meanHeight(b.projectedPts)).toBeCloseTo(meanHeight(a.projectedPts), 4);
  });
});
