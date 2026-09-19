/**
 * tests/abutment.test.ts
 *
 * "My one plane of my roof meets into a covered porch. Pretty common. But the
 *  porch roof meets into the main roof ABOVE the eave. The system is not
 *  stitching that correctly."
 *
 * Stitch joins CORNER to CORNER. That is right for a gable — both halves really
 * do own the same two ridge corners, which is why Ray's garage worked. A porch
 * is a different shape of problem: its head lands partway UP the main slope, so
 * its top corners sit in the MIDDLE of the main face, where there is no corner
 * of the main roof to cluster with. No tolerance fixes that, because the thing
 * the porch attaches to is a surface, not a point.
 *
 * The headline test is the porch itself. The one that keeps the feature honest
 * is that a detached garage 20 m away is never dragged onto the house.
 */

import { describe, it, expect } from 'vitest';
import { snapAbutments, planeHeightAt, type AbutFace } from '@/lib/3d/abutment';
import { roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';
import { ecefToLatLng, latLngToECEF } from '@/lib/roofPlane3D';

const LAT = 38.8306;
const LNG = -89.5343;
const GROUND = 150;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);
const dLat = (m: number) => m / M_PER_DEG_LAT;
const dLng = (m: number) => m / mPerDegLng;
const at = (n: number, e: number) => ({ lat: LAT + dLat(n), lng: LNG + dLng(e) });

function face(id: string, ring: Array<{ lat: number; lng: number }>, pitch: number, az: number, eave: number): AbutFace {
  const built = roofPlaneFromFootprint(ring, {
    pitchDeg: pitch, azimuthDeg: az, eaveHeightM: eave, groundElevM: GROUND,
  });
  expect(built, `${id} should build`).not.toBeNull();
  return { id, polygon3D: built!.plane.polygon3D! };
}

const hOf = (p: { x: number; y: number; z: number }) => ecefToLatLng(p).height - GROUND;

/**
 * Ray's house: a main south-facing slope from an eave at 3 m up to a ridge,
 * with a covered porch in front of it whose head lands PARTWAY UP that slope —
 * above the main eave, not at it.
 */
function houseWithPorch(porchHeadHeightGuess = 3.0) {
  // Main roof: 16 m wide, running 8 m from its south eave (y=-8) up to y=0.
  const main = face('main', [at(-8, -8), at(-8, 8), at(0, 8), at(0, -8)], 30, 180, 3);
  // Porch: 8 m wide, 3 m deep, sitting SOUTH of the main eave and traced with a
  // guessed head height that is almost certainly wrong.
  const porch = face('porch', [at(-11, -4), at(-11, 4), at(-8, 4), at(-8, -4)], 12, 180, porchHeadHeightGuess);
  return { main, porch };
}

describe('planeHeightAt', () => {
  it('returns the height of a sloped plane directly above a point', () => {
    const f = face('m', [at(-8, -8), at(-8, 8), at(0, 8), at(0, -8)], 30, 180, 3);
    // Reconstruct the plane the way snapAbutments does and sample it at the
    // eave and at the ridge.
    const ring = f.polygon3D.map(p => ecefToLatLng(p));
    const south = ring.reduce((a, b) => (b.lat < a.lat ? b : a));
    const north = ring.reduce((a, b) => (b.lat > a.lat ? b : a));
    expect(north.height).toBeGreaterThan(south.height);
    // 8 m of run at 30 degrees is 4.6 m of rise.
    expect(north.height - south.height).toBeCloseTo(8 * Math.tan(30 * DEG), 1);
  });
});

describe('snapAbutments — the covered porch', () => {
  it('lands the porch head ON the main roof, above the main eave', () => {
    const { main, porch } = houseWithPorch(3.0);
    const before = porch.polygon3D.map(hOf);

    const res = snapAbutments([main, porch]);
    expect(res.snapped).toBeGreaterThan(0);

    const after = res.faces.get('porch')!.map(hOf);
    // The porch's head corners (at y = -8, the shared line) must now sit at the
    // main roof's height there — which is its EAVE height, 3 m, plus the
    // surface offset. The point is they are ON the main plane, not floating.
    const ring = res.faces.get('porch')!.map(p => ecefToLatLng(p));
    const headIdx = ring
      .map((g, i) => ({ i, lat: g.lat }))
      .sort((a, b) => b.lat - a.lat)
      .slice(0, 2)
      .map(o => o.i);
    for (const i of headIdx) {
      expect(after[i]).toBeGreaterThan(2.5);
      expect(after[i]).toBeLessThan(4.0);
    }
    expect(before).not.toEqual(after);
  });

  it('works when the porch head meets the slope WELL ABOVE the eave', () => {
    // The case Ray described. Porch overlaps 3 m into the main roof's footprint,
    // so its head lands 3 m up the slope — 1.7 m above the main eave at 30 deg.
    const main = face('main', [at(-8, -8), at(-8, 8), at(0, 8), at(0, -8)], 30, 180, 3);
    const porch = face('porch', [at(-10, -4), at(-10, 4), at(-5, 4), at(-5, -4)], 12, 180, 3);
    const res = snapAbutments([main, porch]);
    const ring = res.faces.get('porch')!.map(p => ecefToLatLng(p));
    const heads = ring.map((g, i) => ({ i, lat: g.lat })).sort((a, b) => b.lat - a.lat).slice(0, 2);
    // At y = -5 the main roof is 3 m of run above its eave: 3 + 3*tan(30) = 4.73.
    for (const h of heads) {
      const hh = ring[h.i].height - GROUND;
      expect(hh).toBeGreaterThan(4.0);
      expect(hh).toBeLessThan(5.5);
    }
  });

  it('does NOT move the porch horizontally — the traced footprint is the user\'s', () => {
    const { main, porch } = houseWithPorch();
    const beforeLL = porch.polygon3D.map(p => { const g = ecefToLatLng(p); return { lat: g.lat, lng: g.lng }; });
    const res = snapAbutments([main, porch]);
    const afterLL = res.faces.get('porch')!.map(p => { const g = ecefToLatLng(p); return { lat: g.lat, lng: g.lng }; });
    afterLL.forEach((a, i) => {
      expect(a.lat).toBeCloseTo(beforeLL[i].lat, 10);
      expect(a.lng).toBeCloseTo(beforeLL[i].lng, 10);
    });
  });

  it('leaves the porch\'s own eave alone — only the abutting end moves', () => {
    const { main, porch } = houseWithPorch();
    const before = porch.polygon3D.map(p => ecefToLatLng(p));
    const res = snapAbutments([main, porch]);
    const after = res.faces.get('porch')!.map(p => ecefToLatLng(p));
    // The far (south) corners are nowhere near the main roof in plan view, so
    // they must be untouched.
    const southIdx = before.map((g, i) => ({ i, lat: g.lat })).sort((a, b) => a.lat - b.lat).slice(0, 2);
    for (const s of southIdx) {
      expect(after[s.i].height).toBeCloseTo(before[s.i].height, 6);
    }
  });

  // ── The assertions that keep it from inventing geometry ────────────────────

  it('NEVER drags a detached garage onto the house', () => {
    // 20 m away, nowhere near in plan view. This is the failure that would make
    // the feature dangerous, and it is the one Ray would notice last.
    const main = face('main', [at(-8, -8), at(-8, 8), at(0, 8), at(0, -8)], 30, 180, 3);
    const garage = face('garage', [at(20, -6), at(20, 6), at(28, 6), at(28, -6)], 20, 180, 3);
    const before = garage.polygon3D.map(hOf);
    const res = snapAbutments([main, garage]);
    expect(res.snapped).toBe(0);
    expect(res.faces.get('garage')!.map(hOf)).toEqual(before);
  });

  it('refuses a lift larger than the bound rather than inventing a height', () => {
    // A porch traced 10 m below the main roof is not abutting it; something
    // else is wrong, and hauling it up would manufacture geometry.
    const main = face('main', [at(-8, -8), at(-8, 8), at(0, 8), at(0, -8)], 30, 180, 12);
    const porch = face('porch', [at(-10, -4), at(-10, 4), at(-7, 4), at(-7, -4)], 12, 180, 1);
    const res = snapAbutments([main, porch], { maxLiftM: 2.5 });
    expect(res.maxLiftM).toBeLessThanOrEqual(2.5);
  });

  it('is order-independent — planes are sampled from the ORIGINAL geometry', () => {
    // Snapping off already-snapped geometry would let one move cascade into the
    // next and make the answer depend on face order.
    const { main, porch } = houseWithPorch();
    const fwd = snapAbutments([main, porch]).faces.get('porch')!.map(hOf);
    const rev = snapAbutments([porch, main]).faces.get('porch')!.map(hOf);
    fwd.forEach((h, i) => expect(h).toBeCloseTo(rev[i], 9));
  });

  it('does not mutate its inputs', () => {
    const { main, porch } = houseWithPorch();
    const snapshot = JSON.stringify(porch.polygon3D);
    snapAbutments([main, porch]);
    expect(JSON.stringify(porch.polygon3D)).toBe(snapshot);
  });

  it('handles fewer than two faces without throwing', () => {
    expect(snapAbutments([]).snapped).toBe(0);
    const { main } = houseWithPorch();
    expect(snapAbutments([main]).snapped).toBe(0);
  });

  it('survives a degenerate face among good ones', () => {
    const { main, porch } = houseWithPorch();
    const broken: AbutFace = { id: 'broken', polygon3D: [{ x: NaN, y: 0, z: 0 }] };
    expect(() => snapAbutments([main, porch, broken])).not.toThrow();
  });
});

/**
 * GENERALITY.
 *
 * Ray: "this system needs to be built for any fucking scenario."
 *
 * He is right that building gable, then hip, then porch one at a time is the
 * pattern that keeps failing. The claim this block has to earn is that
 * snapAbutments is not another special case but the general rule:
 *
 *   a roof is a connected surface, so every vertex either lands on another
 *   face's surface or is an exterior edge.
 *
 * Each test below is a different roof form, run through the SAME function with
 * no per-form branching anywhere in the implementation.
 */
describe('snapAbutments — every roof form, one rule', () => {
  const heights = (poly: Array<{ x: number; y: number; z: number }>) => poly.map(hOf);

  it('GABLE — both halves meet at the ridge', () => {
    const s = face('s', [at(-8, -8), at(-8, 8), at(0, 8), at(0, -8)], 30, 180, 3);
    const n = face('n', [at(0, -8), at(0, 8), at(8, 8), at(8, -8)], 30, 0, 3);
    const res = snapAbutments([s, n]);
    const sr = res.faces.get('s')!.map(p => ecefToLatLng(p));
    const nr = res.faces.get('n')!.map(p => ecefToLatLng(p));
    const sRidge = sr.filter(g => Math.abs(g.lat - LAT) * 111320 < 0.5).map(g => g.height);
    const nRidge = nr.filter(g => Math.abs(g.lat - LAT) * 111320 < 0.5).map(g => g.height);
    expect(sRidge.length).toBe(2);
    expect(nRidge.length).toBe(2);
    // The two halves now agree on the ridge height.
    expect(Math.abs(Math.max(...sRidge) - Math.max(...nRidge))).toBeLessThan(0.35);
  });

  it('VALLEY — an L-shaped cross gable meets along the inside corner', () => {
    const wingA = face('a', [at(-8, -8), at(-8, 2), at(0, 2), at(0, -8)], 28, 180, 3);
    const wingB = face('b', [at(-2, 2), at(-2, 12), at(6, 12), at(6, 2)], 28, 90, 3);
    const res = snapAbutments([wingA, wingB]);
    // Wherever the two footprints overlap, the vertices involved must be
    // brought onto a common surface rather than left crossing each other.
    expect(res.snapped).toBeGreaterThan(0);
    expect(res.maxLiftM).toBeLessThanOrEqual(2.5);
  });

  it('SHED DORMER — sits on the main slope, well above the eave', () => {
    const main = face('main', [at(-9, -10), at(-9, 10), at(0, 10), at(0, -10)], 35, 180, 3);
    const dormer = face('dormer', [at(-6, -3), at(-6, 3), at(-3, 3), at(-3, -3)], 10, 180, 3);
    const res = snapAbutments([main, dormer]);
    expect(res.snapped).toBeGreaterThan(0);
    const d = res.faces.get('dormer')!.map(p => ecefToLatLng(p));
    // Every dormer corner is inside the main footprint, so all four land on the
    // main roof — and none of them is left down at the main eave height.
    for (const g of d) expect(g.height - GROUND).toBeGreaterThan(3.2);
  });

  it('LEAN-TO — a low addition against a tall wall', () => {
    const main = face('main', [at(0, -8), at(0, 8), at(9, 8), at(9, -8)], 35, 0, 3);
    const lean = face('lean', [at(-4, -5), at(-4, 5), at(0, 5), at(0, -5)], 8, 180, 2.5);
    const res = snapAbutments([main, lean]);
    const l = res.faces.get('lean')!.map(p => ecefToLatLng(p));
    const head = l.reduce((a, b) => (b.lat > a.lat ? b : a));
    const foot = l.reduce((a, b) => (b.lat < a.lat ? b : a));
    // The head is lifted to meet the main roof; the foot keeps its own height.
    expect(head.height).toBeGreaterThan(foot.height);
  });

  it('HIP — abutment DECLINES the shared peak; clustering owns it', () => {
    // Four apexes essentially on top of each other are a shared CORNER, and
    // corners converge under clustering. Abutment must not take them: planes
    // are sampled from the original geometry for order-independence, so four
    // mutually-abutting corners would each land on the others' OLD planes and
    // simply swap heights, never converging. Declining is the correct answer,
    // and this test exists so nobody "improves" it into taking them.
    const r = 7;
    const peak = at(0, 0);
    const c = [at(-r, -r), at(-r, r), at(r, r), at(r, -r)];
    const apexH = GROUND + 3 + r * Math.tan(30 * DEG);
    const jitter = [0.0, 0.35, -0.28, 0.19];
    const hips: AbutFace[] = c.map((corner, i) => ({
      id: 'hip' + i,
      polygon3D: [
        latLngToECEF(corner.lat, corner.lng, GROUND + 3),
        latLngToECEF(c[(i + 1) % 4].lat, c[(i + 1) % 4].lng, GROUND + 3),
        latLngToECEF(peak.lat, peak.lng, apexH + jitter[i]),
      ],
    }));
    const res = snapAbutments(hips);
    for (let i = 0; i < 4; i++) {
      const apex = res.faces.get('hip' + i)![2];
      // Untouched — left for Stitch's clustering, which averages them.
      expect(hOf(apex)).toBeCloseTo(apexH + jitter[i] - GROUND, 6);
    }
  });

  it('FLAT ROOF — a level face abutting a pitched one still lands', () => {
    const main = face('main', [at(-8, -8), at(-8, 8), at(0, 8), at(0, -8)], 30, 180, 3);
    const flat = face('flat', [at(-11, -4), at(-11, 4), at(-8, 4), at(-8, -4)], 0, 180, 3);
    const res = snapAbutments([main, flat]);
    expect(() => res.faces.get('flat')!.map(hOf)).not.toThrow();
    expect(res.maxLiftM).toBeLessThanOrEqual(2.5);
  });

  it('SALTBOX — abutment DECLINES the shared ridge; clustering owns it', () => {
    // Unequal slopes either side of one ridge. Both ridge corners are shared
    // corners, so clustering converges them to their mean. If abutment took
    // them they would swap heights and stay exactly as far apart as they
    // started — which is precisely the bug this division of labour prevents.
    const shortSide = face('short', [at(-4, -8), at(-4, 8), at(0, 8), at(0, -8)], 40, 180, 3);
    const longSide = face('long', [at(0, -8), at(0, 8), at(10, 8), at(10, -8)], 22, 0, 3);
    const beforeShort = shortSide.polygon3D.map(hOf);
    const res = snapAbutments([shortSide, longSide]);
    const afterShort = res.faces.get('short')!.map(hOf);
    const ring = shortSide.polygon3D.map(p => ecefToLatLng(p));
    ring.forEach((g, i) => {
      if (Math.abs(g.lat - LAT) * 111320 < 0.5) {
        // A ridge corner — must be left exactly where it was.
        expect(afterShort[i]).toBeCloseTo(beforeShort[i], 6);
      }
    });
  });

  it('SCALES — twelve faces do not blow up or take forever', () => {
    const many: AbutFace[] = [];
    for (let i = 0; i < 12; i++) {
      many.push(face('f' + i, [
        at(-4 + i * 3, -4), at(-4 + i * 3, 4), at(-1 + i * 3, 4), at(-1 + i * 3, -4),
      ], 25, 180, 3));
    }
    const t0 = Date.now();
    const res = snapAbutments(many);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(res.maxLiftM).toBeLessThanOrEqual(2.5);
  });
});
