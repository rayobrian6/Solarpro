/**
 * tests/assignRoofPlaneContainment.test.ts
 *
 * CLICKING A ROOF MUST EDIT THE ROOF YOU CLICKED.
 *
 * `assignRoofPlane` — the face resolver Extend Row and Add Row use — picked the
 * plane whose CENTROID was nearest, with no containment test of any kind. On an
 * ordinary slope carrying a dormer, that means a large share of the main roof
 * resolves to the dormer, and the new panel column is appended to a 5 degree
 * face instead of the 22 degree one the cursor was over.
 *
 * An audit measured 34 of 72 sampled clicks on the main slope — 47% of it —
 * resolving to a 2.5 m dormer. `handleSurfaceSelectClick` 350 lines away had
 * done polygon-first assignment for years; this path never learned.
 */

import { describe, it, expect } from 'vitest';
import type { RoofPlane } from '@/types';
import { assignRoofPlane } from '@/lib/surfaceGeometry3D';

const LAT = 38.6657, LNG = -90.2266;
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos(LAT * Math.PI / 180);

/** A rectangle given in metres east/north of the site origin. */
function rect(id: string, e0: number, n0: number, e1: number, n1: number, over: Partial<RoofPlane> = {}): RoofPlane {
  const ll = (e: number, n: number) => ({ lat: LAT + n / M_LAT, lng: LNG + e / M_LNG });
  const vertices = [ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1)];
  return {
    id,
    vertices,
    pitch: 22, azimuth: 180,
    area: Math.abs((e1 - e0) * (n1 - n0)),
    usableArea: Math.abs((e1 - e0) * (n1 - n0)) * 0.8,
    centroidLat: LAT + ((n0 + n1) / 2) / M_LAT,
    centroidLng: LNG + ((e0 + e1) / 2) / M_LNG,
    ...over,
  } as RoofPlane;
}

const at = (e: number, n: number) => ({ lat: LAT + n / M_LAT, lng: LNG + e / M_LNG });

// A 14 x 7 m main slope with a 2.5 x 2.5 m shed dormer on it.
//
// 🚨 THE DORMER IS OFF-CENTRE, AND THAT IS THE POINT. A first version of this
// fixture put it at the middle of the slope — where its centroid COINCIDES with
// the main slope's, so nearest-centroid ties and the loop keeps the first
// entry. The positive control at the bottom caught it: the old rule scored 0
// wrong, and the whole file would have been asserting against a defect the
// fixture could not exhibit. A real dormer sits over a room, not over the
// centroid.
const MAIN = rect('main', -7, -3.5, 7, 3.5);
const DORMER = rect('dormer', 2.75, -1.25, 5.25, 1.25, { pitch: 5, area: 6.25 });

describe('🚨 the click lands on the face it is inside', () => {
  it('a click on the main slope one metre from the dormer is NOT the dormer', () => {
    // The exact case the audit measured: a click on bare main slope that is
    // nearer the dormer's centroid (4.0 m east) than the main slope's (0, 0).
    const p = at(2.0, 0);
    expect(assignRoofPlane(p.lat, p.lng, [MAIN, DORMER])!.id).toBe('main');
  });

  it('🚨 and the whole main slope is reachable — this is the 47% that was not', () => {
    let wrong = 0, sampled = 0;
    for (let e = -6.5; e <= 6.5; e += 0.5) {
      for (let n = -3; n <= 3; n += 0.5) {
        // Skip points genuinely inside the dormer.
        if (e >= 2.75 && e <= 5.25 && Math.abs(n) <= 1.25) continue;
        const p = at(e, n);
        sampled += 1;
        if (assignRoofPlane(p.lat, p.lng, [MAIN, DORMER])!.id !== 'main') wrong += 1;
      }
    }
    expect(sampled, 'the sweep sampled nothing').toBeGreaterThan(100);
    expect(wrong, `${wrong} of ${sampled} main-slope clicks resolved to the dormer`).toBe(0);
  });

  it('a click genuinely inside the dormer still resolves to the dormer', () => {
    const p = at(4.0, 0.4);
    expect(assignRoofPlane(p.lat, p.lng, [MAIN, DORMER])!.id).toBe('dormer');
  });

  it('🚨 overlapping faces resolve to the SMALLER — the one being pointed at', () => {
    // The dormer sits inside the main slope's outline, so both contain the
    // point. The user can only see and aim at the small one.
    const p = at(4.0, 0);
    expect(assignRoofPlane(p.lat, p.lng, [MAIN, DORMER])!.id).toBe('dormer');
    // …and the order of the array does not decide it.
    expect(assignRoofPlane(p.lat, p.lng, [DORMER, MAIN])!.id).toBe('dormer');
  });
});

describe('the nearest-centroid rule still covers a click that is off every face', () => {
  it('a click just past the eave snaps to the nearest face', () => {
    const p = at(0, -4.2);   // 0.7 m beyond the main slope's south edge
    expect(assignRoofPlane(p.lat, p.lng, [MAIN, DORMER])!.id).toBe('main');
  });

  it('…and a click far from everything still resolves to nothing', () => {
    const p = at(0, 120);
    expect(assignRoofPlane(p.lat, p.lng, [MAIN, DORMER], 50)).toBeNull();
  });

  it('an empty roof is null, not a crash', () => {
    expect(assignRoofPlane(LAT, LNG, [])).toBeNull();
  });

  it('a degenerate face cannot swallow a click through containment', () => {
    const line = { ...rect('line', -5, 0, 5, 0), vertices: [at(-5, 0), at(5, 0)] } as RoofPlane;
    // Two vertices is not a polygon; it must fall through to distance.
    const p = at(0, 0.2);
    expect(assignRoofPlane(p.lat, p.lng, [MAIN, line])!.id).toBe('main');
  });
});

describe('positive control', () => {
  it('the OLD rule really did get it wrong — the fixture is not a straw man', () => {
    // Nearest-centroid, reproduced, so the numbers above are anchored to a real
    // disagreement rather than to an arrangement invented to fail.
    const nearestCentroid = (lat: number, lng: number, planes: RoofPlane[]) => {
      const cosLat = Math.cos(lat * Math.PI / 180);
      let best: RoofPlane | null = null, bestD = Infinity;
      for (const pl of planes) {
        const dy = (lat - pl.centroidLat!) * M_LAT;
        const dx = (lng - pl.centroidLng!) * M_LAT * cosLat;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = pl; }
      }
      return best;
    };

    let wrong = 0, sampled = 0;
    for (let e = -6.5; e <= 6.5; e += 0.5) {
      for (let n = -3; n <= 3; n += 0.5) {
        if (e >= 2.75 && e <= 5.25 && Math.abs(n) <= 1.25) continue;
        const p = at(e, n);
        sampled += 1;
        if (nearestCentroid(p.lat, p.lng, [MAIN, DORMER])!.id !== 'main') wrong += 1;
      }
    }
    // Measured by the audit at 47% on its own sampling; the exact share depends
    // on the grid, and what matters is that it is a large fraction of the roof.
    expect(wrong / sampled).toBeGreaterThan(0.2);
  });
});
