/**
 * tests/convexHullCorners.test.ts
 *
 * Verifies the convexHullCorners helper used by SolarEngine3D to
 * filter noisy aerial-twin roof corners into a clean convex outline.
 * Real roof faces are always convex, so any concave indentations in
 * the detected corners are noise we want to strip.
 */
import { describe, it, expect } from 'vitest';

// We re-declare the helper here (duplicated from SolarEngine3D.tsx)
// because the component file uses Cesium globals and isn't easily
// importable in a unit test. Keep this in sync with the source.
function convexHullCorners(
  corners: Array<{ lat: number; lng: number; alt?: number }>,
): Array<{ lat: number; lng: number; alt?: number }> {
  if (corners.length <= 3) return corners.slice();
  const pts = corners.map(c => ({ lat: c.lat, lng: c.lng, alt: c.alt, _key: `${c.lng.toFixed(7)},${c.lat.toFixed(7)}` }));
  const seen = new Set<string>();
  const uniq = pts.filter(p => {
    if (seen.has(p._key)) return false;
    seen.add(p._key);
    return true;
  });
  if (uniq.length <= 3) return uniq.map(({ _key, ...rest }) => rest);
  uniq.sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (O: any, A: any, B: any) =>
    (A.lng - O.lng) * (B.lat - O.lat) - (A.lat - O.lat) * (B.lng - O.lng);
  const lower: typeof uniq = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: typeof uniq = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  return hull.map(({ _key, ...rest }) => rest);
}

describe('convexHullCorners', () => {
  it('returns short lists unchanged (≤ 3 points)', () => {
    expect(convexHullCorners([])).toEqual([]);
    const two = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
    expect(convexHullCorners(two)).toEqual(two);
    const three = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 0 }];
    expect(convexHullCorners(three)).toEqual(three);
  });

  it('drops a concave interior point from a 4-corner concave quad', () => {
    // A quad where one interior point pushes inward (concave). The
    // hull should drop the inward point and return 3 corners.
    const corners = [
      { lat: 0, lng: 0, alt: 10 },     // bottom-left
      { lat: 0, lng: 10, alt: 10 },    // top-left
      { lat: 5, lng: 5, alt: 10 },     // INTERIOR (concave inward bump)
      { lat: 10, lng: 0, alt: 10 },    // bottom-right
      { lat: 10, lng: 10, alt: 10 },   // top-right
    ];
    const hull = convexHullCorners(corners);
    // The interior point must be gone
    const lngs = hull.map(c => c.lng).sort((a, b) => a - b);
    expect(hull.length).toBe(4);
    expect(lngs).toEqual([0, 0, 10, 10]); // 2 at lng=0, 2 at lng=10, no lng=5
  });

  it('preserves altitudes on the surviving corners', () => {
    // Roof faces have per-corner altitude (ridge vs eave). The hull
    // must not lose that info.
    const corners = [
      { lat: 0, lng: 0, alt: 100 },    // low eave
      { lat: 0, lng: 10, alt: 100 },
      { lat: 5, lng: 5, alt: 110 },    // mid (will be dropped)
      { lat: 10, lng: 0, alt: 120 },   // ridge
      { lat: 10, lng: 10, alt: 120 },
    ];
    const hull = convexHullCorners(corners);
    for (const c of hull) {
      expect([100, 120]).toContain(c.alt);
    }
    expect(hull.find(c => c.alt === 100)).toBeDefined();
    expect(hull.find(c => c.alt === 120)).toBeDefined();
  });

  it('deduplicates coincident corners', () => {
    // Two corners at exactly the same lat/lng would break Andrew's
    // chain (zero-length edges). They must collapse to one.
    const corners = [
      { lat: 0, lng: 0, alt: 50 },
      { lat: 0, lng: 0, alt: 51 },  // dup
      { lat: 0, lng: 10, alt: 50 },
      { lat: 10, lng: 10, alt: 50 },
      { lat: 10, lng: 0, alt: 50 },
    ];
    const hull = convexHullCorners(corners);
    // After dedup we have 4 unique points, all on the hull.
    expect(hull.length).toBe(4);
  });

  it('handles a perfectly square roof (all 4 corners on hull)', () => {
    const corners = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 0 },
      { lat: 10, lng: 10 },
    ];
    const hull = convexHullCorners(corners);
    expect(hull.length).toBe(4);
    // All 4 input corners survive
    const lngSet = new Set(hull.map(c => c.lng));
    const latSet = new Set(hull.map(c => c.lat));
    expect(lngSet).toEqual(new Set([0, 10]));
    expect(latSet).toEqual(new Set([0, 10]));
  });
});
