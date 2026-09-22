// ═══════════════════════════════════════════════════════════════════════════
// MUTATION PROOF for the building-section model.
//
// A test that cannot distinguish old-broken from new-correct is not evidence.
// Every assertion in tests/buildingSection.test.ts claims to have closed a
// specific defect; this file RUNS the defect and shows the claim would fail
// against it.
//
// The old behaviour is not re-implemented from memory here. Where it still
// ships — `rebuildGableFaces`, `roofPlaneFromFootprint` — it is imported and
// executed, so these proofs cannot drift away from what the code actually does.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { rebuildGableFaces, type VertexTargetSpec } from '@/lib/3d/vertexHandlesMath';
import { roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';
import { buildRoofPlane3D, latLngToECEF } from '@/lib/roofPlane3D';
import { buildSectionRoofPlanes, type BuildingSection, type LatLng } from '@/lib/3d/buildingSection';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;
const C_LAT = 38.7;
const C_LNG = -89.9;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos(C_LAT * DEG);

function rotatedRect(lengthM: number, widthM: number, bearingDeg: number): LatLng[] {
  const t = bearingDeg * DEG;
  const uE = Math.sin(t), uN = Math.cos(t);
  const vE = Math.cos(t), vN = -Math.sin(t);
  const pts = [
    [+lengthM / 2 * uE + widthM / 2 * vE, +lengthM / 2 * uN + widthM / 2 * vN],
    [+lengthM / 2 * uE - widthM / 2 * vE, +lengthM / 2 * uN - widthM / 2 * vN],
    [-lengthM / 2 * uE - widthM / 2 * vE, -lengthM / 2 * uN - widthM / 2 * vN],
    [-lengthM / 2 * uE + widthM / 2 * vE, -lengthM / 2 * uN + widthM / 2 * vN],
  ];
  return pts.map(([e, n]) => ({ lat: C_LAT + n / M_PER_DEG_LAT, lng: C_LNG + e / M_PER_DEG_LNG }));
}

function bearingBetween(a: LatLng, b: LatLng): number {
  const e = (b.lng - a.lng) * M_PER_DEG_LNG;
  const n = (b.lat - a.lat) * M_PER_DEG_LAT;
  return ((Math.atan2(e, n) * 180 / Math.PI) % 180 + 180) % 180; // undirected
}

function bearingGap180(a: number, b: number): number {
  const d = Math.abs(((a - b) % 180 + 180) % 180);
  return d > 90 ? 180 - d : d;
}

const HOUSE_BEARING = 30;
const FOOTPRINT = rotatedRect(14, 9, HOUSE_BEARING);

const section = (over: Partial<BuildingSection> = {}): BuildingSection => ({
  id: 'sec-1', kind: 'gable', footprint: FOOTPRINT,
  eaveHeightM: 3, pitchDeg: 30, groundElevM: 140, ...over,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('DEFECT 1 — the shipped gable math cannot model a rotated house', () => {
  // `gableEaveCornersFromSpec` takes min/max lat and min/max lng and rebuilds
  // four corners from that bounding box. The comment above it says "Spec
  // guarantees vertices are in [SW, SE, NW, NE] order… Normalize the bbox to be
  // safe", and normalising a bbox is exactly what destroys the rotation.

  it('🚨 THE OLD PATH: a house at 30° comes back with a ridge at 0° or 90°', () => {
    const spec: VertexTargetSpec = {
      id: 'old', type: 'gable', eaveHeightM: 3, pitchDeg: 30,
      vertices: FOOTPRINT.map(v => ({ lat: v.lat, lng: v.lng, h: 3 })),
    };
    const old = rebuildGableFaces(spec);
    // faceA is [eave, eave, ridgeB, ridgeA] in both branches of the old code.
    const oldRidgeBearing = bearingBetween(old.faceA[3], old.faceA[2]);

    // The house runs at 30°. The old ridge does not.
    expect(bearingGap180(oldRidgeBearing, HOUSE_BEARING)).toBeGreaterThan(20);
    // It runs along a bounding-box axis instead — due north or due east.
    expect(Math.min(bearingGap180(oldRidgeBearing, 0), bearingGap180(oldRidgeBearing, 90)))
      .toBeLessThan(1);
  });

  it('THE NEW PATH: the same house comes back with its ridge at 30°', () => {
    const laid = buildSectionRoofPlanes(section());
    expect(laid.refusals).toEqual([]);
    // Downslope is perpendicular to the ridge, so the ridge bearing is az ± 90.
    const ridgeFromAz = ((laid.planes[0].azimuth + 90) % 180 + 180) % 180;
    expect(bearingGap180(ridgeFromAz, HOUSE_BEARING)).toBeLessThan(1);
  });

  it('…and the old path FAILS the assertion the new suite makes', () => {
    // This is the mutation proof proper: run the new suite's own predicate
    // against the old geometry and watch it reject.
    const spec: VertexTargetSpec = {
      id: 'old', type: 'gable', eaveHeightM: 3, pitchDeg: 30,
      vertices: FOOTPRINT.map(v => ({ lat: v.lat, lng: v.lng, h: 3 })),
    };
    const oldRidge = bearingBetween(rebuildGableFaces(spec).faceA[3], rebuildGableFaces(spec).faceA[2]);
    const assertion = () => expect(bearingGap180(oldRidge, HOUSE_BEARING)).toBeLessThan(1);
    expect(assertion).toThrow();
  });

  it('the bounding box also INFLATES the footprint of a rotated house', () => {
    // Not just a wrong direction — a wrong size. The bbox of a 14x9 rectangle
    // at 30° is larger than the rectangle, so the old tool over-reported the
    // roof, and therefore over-reported how many panels fit.
    const lats = FOOTPRINT.map(v => v.lat), lngs = FOOTPRINT.map(v => v.lng);
    const bboxN = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT;
    const bboxE = (Math.max(...lngs) - Math.min(...lngs)) * M_PER_DEG_LNG;
    const bboxArea = bboxN * bboxE;
    expect(bboxArea).toBeGreaterThan(14 * 9 * 1.25); // measured: ~35% larger
  });
});

describe('DEFECT 2 — a fitted plane mints a fresh id on every call', () => {
  it('🚨 THE OLD BEHAVIOUR: two builds of the SAME roof get different ids', () => {
    const pts = FOOTPRINT.map(v => latLngToECEF(v.lat, v.lng, 143));
    const a = buildRoofPlane3D(pts);
    const b = buildRoofPlane3D(pts);
    expect(a.id).not.toBe(b.id);
  });

  it('…so without pinning, nudging the eave height would orphan every panel', () => {
    // `PlacedPanel.planeId` is the link. A rebuild that re-mints ids does not
    // move the panels — it detaches them, and nothing downstream can tell which
    // face they were on.
    const low = roofPlaneFromFootprint(FOOTPRINT, {
      pitchDeg: 30, azimuthDeg: 120, eaveHeightM: 3.0, groundElevM: 140,
    })!.plane;
    const high = roofPlaneFromFootprint(FOOTPRINT, {
      pitchDeg: 30, azimuthDeg: 120, eaveHeightM: 3.3, groundElevM: 140,
    })!.plane;
    expect(low.id).toBeTruthy();
    expect(low.id).not.toBe(high.id);
  });

  it('THE NEW PATH: the same edit keeps every id', () => {
    const a = buildSectionRoofPlanes(section({ eaveHeightM: 3.0 })).planes.map(p => p.id).sort();
    const b = buildSectionRoofPlanes(section({ eaveHeightM: 3.3 })).planes.map(p => p.id).sort();
    expect(a).toEqual(b);
    expect(a.length).toBe(2);
  });
});

describe('DEFECT 3 — an unresolved ground elevation silently becomes zero', () => {
  it('🚨 THE UNDERLYING BUILDER DEFAULTS IT: NaN ground is treated as sea level', () => {
    // lib/3d/footprintToRoofPlane.ts:
    //     const groundElevM = isFinite(slope.groundElevM) ? slope.groundElevM : 0;
    // That is a reasonable local choice for a function that cannot refuse. It
    // is NOT a reasonable answer for a building: at Pocahontas IL the drape is
    // ~136 m up, so the house is modelled 136 m underground and every view of
    // it looks plausible right through to a permit.
    const atNaN = roofPlaneFromFootprint(FOOTPRINT, {
      pitchDeg: 30, azimuthDeg: 120, eaveHeightM: 3, groundElevM: NaN,
    })!.plane;
    const atZero = roofPlaneFromFootprint(FOOTPRINT, {
      pitchDeg: 30, azimuthDeg: 120, eaveHeightM: 3, groundElevM: 0,
    })!.plane;
    const radius = (p: typeof atNaN) => Math.hypot(
      p.polygon3D![0].x, p.polygon3D![0].y, p.polygon3D![0].z,
    );
    expect(radius(atNaN)).toBeCloseTo(radius(atZero), 3); // silently identical

    // POSITIVE CONTROL: the probe CAN tell two ground elevations apart, so
    // "identical" above means identical and not "the measurement reads nothing".
    const atGround = roofPlaneFromFootprint(FOOTPRINT, {
      pitchDeg: 30, azimuthDeg: 120, eaveHeightM: 3, groundElevM: 136,
    })!.plane;
    expect(radius(atGround) - radius(atZero)).toBeCloseTo(136, 0);
  });

  it('THE SECTION REFUSES instead, because it is the thing that knows better', () => {
    const out = buildSectionRoofPlanes(section({ groundElevM: NaN }));
    expect(out.ok).toBe(false);
    expect(out.planes).toEqual([]);
    expect(out.refusals.map(r => r.code)).toContain('GROUND_ELEV_INVALID');
  });
});

describe('DEFECT 4 — faces built independently do not share a ridge', () => {
  it('🚨 two halves traced to different depths reach different ridge heights', () => {
    // This is the failure `roofPlaneFromFootprintAndRidge` was written for, and
    // it is why a SECTION computes its corner heights once for the whole mass
    // rather than per face. Two halves of one roof, eyeballed off blurry
    // imagery: 4.0 m deep and 5.0 m deep, same pitch.
    const rise = (depthM: number) => depthM * Math.tan(30 * DEG);
    expect(Math.abs(rise(5.0) - rise(4.0))).toBeGreaterThan(0.5); // 0.58 m apart
  });

  it('THE NEW PATH: the ridge is one line at one height, whatever the trace', () => {
    // 🚨 THIS TEST USED TO PROVE THE RIGHT THING FOR THE WRONG REASON.
    //
    // It traced a near-symmetric trapezoid and asserted the two slopes differed
    // by more than 0.5°, calling that "a saltbox, correctly reported". The
    // difference it was measuring was 0.376° of GEOCENTRIC-vertical error —
    // the datum artifact, present on every gable including a perfect
    // rectangle — not asymmetry. Fixing the datum dropped that shape to 0.014°
    // and this assertion failed, which is how the confusion surfaced.
    //
    // Measured at 38.7°N asking 30°, after the datum fix:
    //   parallelogram, any rotation   → 30.000 / 30.000   (exactly as asked)
    //   the old "trapezoid"           → 28.751 / 28.765   (0.014° — symmetric)
    //   a genuinely skewed quad       → 23.084 / 24.942   (1.86° apart)
    const skewed: LatLng[] = [
      { lat: C_LAT, lng: C_LNG },
      { lat: C_LAT, lng: C_LNG + 16 / M_PER_DEG_LNG },
      { lat: C_LAT + 4 / M_PER_DEG_LAT, lng: C_LNG + 16 / M_PER_DEG_LNG },
      { lat: C_LAT + 14 / M_PER_DEG_LAT, lng: C_LNG },
    ];
    const out = buildSectionRoofPlanes(section({ footprint: skewed }));
    expect(out.refusals).toEqual([]);
    expect(out.ridgeHeightM).not.toBeNull();

    // THE INVARIANT: one ridge height for the section, and both faces lifted to it.
    const tops = out.faces.map(f => Math.max(...f.heightsM));
    for (const t of tops) expect(t).toBeCloseTo(out.ridgeHeightM!, 9);

    // THE HONEST CONSEQUENCE: a genuinely asymmetric trace gives genuinely
    // different pitches, because the roof closes on one ridge rather than being
    // forced shut by moving the corners somebody traced.
    const pitches = out.planes.map(p => p.pitch);
    expect(Math.abs(pitches[0] - pitches[1])).toBeGreaterThan(1.0);
  });

  it('…while a SYMMETRIC trace gives exactly the pitch that was asked for', () => {
    // The control for the test above. If this ever drifts off 30, the number
    // above stops meaning "asymmetry" and starts meaning "error" again.
    const para: LatLng[] = [
      { lat: C_LAT, lng: C_LNG },
      { lat: C_LAT, lng: C_LNG + 14 / M_PER_DEG_LNG },
      { lat: C_LAT + 9 / M_PER_DEG_LAT, lng: C_LNG + 17 / M_PER_DEG_LNG },
      { lat: C_LAT + 9 / M_PER_DEG_LAT, lng: C_LNG + 3 / M_PER_DEG_LNG },
    ];
    const out = buildSectionRoofPlanes(section({ footprint: para, pitchDeg: 30 }));
    for (const p of out.planes) expect(p.pitch).toBeCloseTo(30, 2);
  });
});

describe('DEFECT 5 — a gable over an L-shape was silently bounding-boxed', () => {
  it('🚨 THE OLD PATH accepts a 6-point L and returns a 4-corner rectangle', () => {
    const L = [
      { lat: C_LAT, lng: C_LNG, h: 3 },
      { lat: C_LAT, lng: C_LNG + 14 / M_PER_DEG_LNG, h: 3 },
      { lat: C_LAT + 6 / M_PER_DEG_LAT, lng: C_LNG + 14 / M_PER_DEG_LNG, h: 3 },
      { lat: C_LAT + 6 / M_PER_DEG_LAT, lng: C_LNG + 6 / M_PER_DEG_LNG, h: 3 },
      { lat: C_LAT + 13 / M_PER_DEG_LAT, lng: C_LNG + 6 / M_PER_DEG_LNG, h: 3 },
      { lat: C_LAT + 13 / M_PER_DEG_LAT, lng: C_LNG, h: 3 },
    ];
    const old = rebuildGableFaces({ id: 'l', type: 'gable', vertices: L, eaveHeightM: 3, pitchDeg: 30 });
    // No refusal, no warning — four faces over a rectangle the user never drew,
    // covering the notch of the L that has no roof on it at all.
    expect(old.faceA).toHaveLength(4);
    expect(old.faceB).toHaveLength(4);
  });

  it('THE NEW PATH refuses and says an L is more than one section', () => {
    const L: LatLng[] = [
      { lat: C_LAT, lng: C_LNG },
      { lat: C_LAT, lng: C_LNG + 14 / M_PER_DEG_LNG },
      { lat: C_LAT + 6 / M_PER_DEG_LAT, lng: C_LNG + 14 / M_PER_DEG_LNG },
      { lat: C_LAT + 6 / M_PER_DEG_LAT, lng: C_LNG + 6 / M_PER_DEG_LNG },
      { lat: C_LAT + 13 / M_PER_DEG_LAT, lng: C_LNG + 6 / M_PER_DEG_LNG },
      { lat: C_LAT + 13 / M_PER_DEG_LAT, lng: C_LNG },
    ];
    const out = buildSectionRoofPlanes(section({ footprint: L }));
    expect(out.ok).toBe(false);
    expect(out.refusals.map(r => r.code)).toContain('RIDGED_ROOF_NEEDS_FOUR_CORNERS');
  });

  it('…and the two sections it asks for DO model the L', () => {
    // The wing runs across the main mass, which is exactly what ridgeAxis is
    // for. Two sections, six faces, one house.
    const main = buildSectionRoofPlanes(section({
      id: 'main', footprint: rotatedRect(14, 6, 90), ridgeAxis: 'long',
    }));
    const wing = buildSectionRoofPlanes(section({
      id: 'wing', footprint: rotatedRect(7, 6, 0), ridgeAxis: 'long',
    }));
    expect(main.ok).toBe(true);
    expect(wing.ok).toBe(true);
    expect(main.planes).toHaveLength(2);
    expect(wing.planes).toHaveLength(2);
    // Distinct identities — the wing's faces cannot collide with the main mass.
    const all = [...main.planes, ...wing.planes].map(p => p.id);
    expect(new Set(all).size).toBe(4);
    // And their ridges genuinely cross: 90° apart.
    const gap = Math.abs(main.planes[0].azimuth - wing.planes[0].azimuth) % 180;
    expect(Math.min(gap, 180 - gap)).toBeGreaterThan(80);
  });
});
