/**
 * tests/applyBuildingShapeDatum.test.ts
 *
 * EVERY WALLS/PITCH PRESS SLID THE ROOF AND RATCHETED THE EAVE — AND SAVED IT.
 *
 * `applyBuildingShape` re-fits each face from `collectRoofRenderables()`. Both
 * of that helper's branches return RENDER points, lifted SURFACE_OFFSET_M along
 * the face normal:
 *
 *   • the live branch reads `plane3DCesiumPtsMap`, written from
 *     `built.frame.projectedPts` at the bottom of applyBuildingShape itself;
 *   • the fallback branch reads the stored `polygon3D`, which
 *     lib/roofPlane3D.ts:743 sets to `projPts` — "the lift stays where it
 *     belongs — polygon3D, origin3D and the frame keep it".
 *
 * A normal is not vertical. Projecting lifted points back to lat/lng and handing
 * them to `roofPlaneFromFootprint` — which correctly lifts a genuinely raw
 * outline — applied the offset a SECOND time, then wrote the result back into
 * the same cache, so presses compounded.
 *
 * `vertices` and `pitch` are both in SIGNED_FIELDS, so the autosave fired: this
 * was persisted corruption of the plan record the permit site plan and the CAD
 * engine read, not a rendering artefact. A gable's two halves carry OPPOSITE
 * azimuths, so they slide apart and the shared ridge splits by twice the drift.
 * `joinSharedCorners`' 1.5 m tolerance is why nothing downstream objected.
 *
 * lib/roofPlane3D.ts:626-650 already documents this exact class and names the
 * callers that were fixed — buildRoofPlane3D, Stitch and Square Up.
 * applyBuildingShape re-fits already-lifted points and was not on that list.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';
import { ecefToLatLng, unliftAlongNormal, SURFACE_OFFSET_M, type Cart3 } from '@/lib/roofPlane3D';
import { stripComments } from './support/stripSource';

const LAT = 38.6657, LNG = -90.2266;
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((LAT * Math.PI) / 180);
const PITCH_DEG = 26.565;          // 6:12 — the commonest residential slope
const AZIMUTH = 180;
const WALL_M = 3.0;
const GROUND_M = 160;

function footprint(halfWm: number, halfDm: number) {
  const hw = halfWm / M_LNG, hd = halfDm / M_LAT;
  return [
    { lat: LAT - hd, lng: LNG - hw },
    { lat: LAT - hd, lng: LNG + hw },
    { lat: LAT + hd, lng: LNG + hw },
    { lat: LAT + hd, lng: LNG - hw },
  ];
}

function build(outline: Array<{ lat: number; lng: number }>, groundM: number, azimuthDeg = AZIMUTH) {
  const b = roofPlaneFromFootprint(outline, {
    pitchDeg: PITCH_DEG, azimuthDeg, eaveHeightM: WALL_M, groundElevM: groundM,
  });
  expect(b, 'the fixture face failed to build — this file is testing nothing').toBeTruthy();
  return b!;
}

/**
 * One press of the WALLS/PITCH stepper, exactly as applyBuildingShape performs
 * it. `unlift` selects the fixed behaviour; false reproduces the defect.
 */
function press(cached: Cart3[], normal: Cart3, unlift: boolean, azimuthDeg = AZIMUTH): { cached: Cart3[]; plan: Array<{ lat: number; lng: number; height: number }> } {
  const src = unlift ? unliftAlongNormal(cached, normal) : cached;
  const outline = src.map(p => { const g = ecefToLatLng(p); return { lat: g.lat, lng: g.lng }; });
  let lowest = Infinity;
  for (const p of src) { const h = ecefToLatLng(p).height; if (h < lowest) lowest = h; }
  const built = build(outline, lowest - WALL_M, azimuthDeg);
  const next = built.frame.projectedPts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
  return { cached: next, plan: next.map(p => ecefToLatLng(p)) };
}

/** Worst-case horizontal distance, in metres, between two plan rings. */
function planDriftM(a: Array<{ lat: number; lng: number }>, b: Array<{ lat: number; lng: number }>): number {
  return Math.max(...a.map((g, i) => Math.hypot((b[i].lat - g.lat) * M_LAT, (b[i].lng - g.lng) * M_LNG)));
}

describe('the offset really is the thing that moves the footprint sideways', () => {
  it('a normal is not vertical, so the lift has a horizontal component', () => {
    // Establishes the mechanism before measuring it, so a future reader does not
    // have to take the arithmetic on trust. tan-free: offset * sin(tilt).
    const expected = SURFACE_OFFSET_M * Math.sin((PITCH_DEG * Math.PI) / 180);
    expect(expected).toBeGreaterThan(0.05);
    expect(expected).toBeLessThan(0.06);   // ~5.4 cm at 6:12
  });
});

describe('🚨 the defect, reproduced numerically', () => {
  it('WITHOUT the un-lift, five presses slide the plan 27 cm and raise the eave 54 cm', () => {
    const b0 = build(footprint(3, 2.5), GROUND_M);
    const normal: Cart3 = { x: b0.frame.normal.x, y: b0.frame.normal.y, z: b0.frame.normal.z };
    let cached: Cart3[] = b0.frame.projectedPts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    const first = cached.map(p => ecefToLatLng(p));

    let plan = first;
    for (let i = 0; i < 5; i++) ({ cached, plan } = press(cached, normal, false));

    const slide = planDriftM(first, plan);
    const ratchet = Math.min(...plan.map(g => g.height)) - Math.min(...first.map(g => g.height));

    // Linear in the number of presses, at 0.12*sin(tilt) and 0.12*cos(tilt).
    expect(slide).toBeGreaterThan(0.26);
    expect(slide).toBeLessThan(0.28);
    expect(ratchet).toBeGreaterThan(0.53);
    expect(ratchet).toBeLessThan(0.55);
  });

  it('and it is CUMULATIVE — each press adds the same amount again', () => {
    // A one-off 12 cm error would be a datum bug. Growing without bound is what
    // makes it a data-integrity bug: the file is worse every time it is touched.
    const b0 = build(footprint(3, 2.5), GROUND_M);
    const normal: Cart3 = { x: b0.frame.normal.x, y: b0.frame.normal.y, z: b0.frame.normal.z };
    let cached: Cart3[] = b0.frame.projectedPts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    const first = cached.map(p => ecefToLatLng(p));

    const drifts: number[] = [];
    let plan = first;
    for (let i = 0; i < 3; i++) {
      ({ cached, plan } = press(cached, normal, false));
      drifts.push(planDriftM(first, plan));
    }
    expect(drifts[1] / drifts[0]).toBeCloseTo(2, 1);
    expect(drifts[2] / drifts[0]).toBeCloseTo(3, 1);
  });
});

describe('with the un-lift, a press is idempotent', () => {
  it('🚨 twenty presses move the plan record less than a millimetre', () => {
    const b0 = build(footprint(3, 2.5), GROUND_M);
    const normal: Cart3 = { x: b0.frame.normal.x, y: b0.frame.normal.y, z: b0.frame.normal.z };
    let cached: Cart3[] = b0.frame.projectedPts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    const first = cached.map(p => ecefToLatLng(p));

    let plan = first;
    for (let i = 0; i < 20; i++) ({ cached, plan } = press(cached, normal, true));

    expect(planDriftM(first, plan), 'the footprint must not move at all').toBeLessThan(0.001);
    const ratchet = Math.abs(Math.min(...plan.map(g => g.height)) - Math.min(...first.map(g => g.height)));
    expect(ratchet, 'the eave must not ratchet').toBeLessThan(0.001);
  });

  it('a gable ridge stays shut instead of splitting by twice the drift', () => {
    // The two halves carry opposite azimuths, so an un-corrected slide moves
    // them APART. This is the consequence a permit reader would actually see.
    const south = build(footprint(3, 2.5), GROUND_M);
    const nOf = (b: any): Cart3 => ({ x: b.frame.normal.x, y: b.frame.normal.y, z: b.frame.normal.z });

    // A second face with the opposite azimuth over the same footprint.
    const northBuilt = roofPlaneFromFootprint(footprint(3, 2.5), {
      pitchDeg: PITCH_DEG, azimuthDeg: 0, eaveHeightM: WALL_M, groundElevM: GROUND_M,
    })!;
    expect(northBuilt).toBeTruthy();

    let sCached: Cart3[] = south.frame.projectedPts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    let nCached: Cart3[] = northBuilt.frame.projectedPts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    const sFirst = sCached.map(p => ecefToLatLng(p));
    const nFirst = nCached.map(p => ecefToLatLng(p));

    let sPlan = sFirst, nPlan = nFirst;
    for (let i = 0; i < 4; i++) {
      ({ cached: sCached, plan: sPlan } = press(sCached, nOf(south), true));
      // 🚨 THE AZIMUTH MUST TRAVEL WITH THE FACE. The first draft of this test
      // re-pressed the north half at the SOUTH azimuth and measured 43 cm of
      // "drift" that was really a 180 degree flip of my own fixture — a test
      // bug that would have been reported as a product one.
      ({ cached: nCached, plan: nPlan } = press(nCached, nOf(northBuilt), true, 0));
    }
    expect(planDriftM(sFirst, sPlan)).toBeLessThan(0.001);
    expect(planDriftM(nFirst, nPlan)).toBeLessThan(0.001);
  });
});

describe('applyBuildingShape takes the record before the lift', () => {
  const SRC = stripComments(
    readFileSync(join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'),
  );

  it('its rawFaces un-lift the render points along each face normal', () => {
    // Structural, because the function lives inside a 14k-line client component
    // and cannot be driven from a unit test. Anchored on `rawFaces`, which is
    // unique to this function, rather than on a bare `unliftAlongNormal` that
    // another call site could satisfy.
    const idx = SRC.indexOf('const rawFaces = renderables.map(');
    expect(idx, 'the rawFaces anchor was not found — re-anchor this guard').toBeGreaterThan(-1);
    const block = SRC.slice(idx, idx + 500);
    expect(block, 'the render lift must be removed before the plan record is taken')
      .toMatch(/unliftAlongNormal\(/);
    // The normal must come from the face's OWN frame, not a shared or vertical one.
    expect(block).toMatch(/rp\.n\.x/);
  });
});
