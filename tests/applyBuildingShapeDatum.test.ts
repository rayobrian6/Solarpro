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
 *   • the fallback branch does NOT. 🚨 AN EARLIER VERSION OF THIS HEADER SAID
 *     IT READ THE STORED `polygon3D`. That was wrong, an independent touch
 *     audit caught it, and the error was not cosmetic: it is the premise the
 *     first fix was built on, and acting on it corrupted the very faces that
 *     were exact. That branch builds each corner from `plane.vertices` — the
 *     canonical, ALREADY-UNLIFTED plan record — and drops it VERTICALLY onto
 *     the plane, so its plan position is the truth and only its height comes
 *     from the lifted plane. Un-lifting those slides them `lift·sin(tilt)`
 *     UP-slope: the same corruption, in the other direction, on the other
 *     provider. Which branch answered is now carried on the renderable as
 *     `cornersPlanLiftM` rather than assumed.
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
import {
  ecefToLatLng, unliftAlongNormal, unliftFacesPreservingSharedCorners,
  SURFACE_OFFSET_M, type Cart3,
} from '@/lib/roofPlane3D';
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
    const idx = SRC.indexOf('const unlifted = unliftFacesPreservingSharedCorners(');
    expect(idx, 'the un-lift anchor was not found — re-anchor this guard').toBeGreaterThan(-1);
    const block = SRC.slice(idx, idx + 1_600);
    // The normal must come from each face's OWN frame, not a shared or vertical one.
    expect(block).toMatch(/normal:\s*\{\s*x:\s*rp\.n\.x/);
    expect(block).toMatch(/const rawFaces = renderables\.map\(/);
    expect(block).toMatch(/polygon3D:\s*unlifted\[i\]/);

    // 🚨 AND IT MUST BE THE ROOF-WIDE FORM. The per-face `unliftAlongNormal`
    // is correct arithmetic and the WRONG operation here: it splits every seam
    // Stitch closed, by 2*lift*sin(tilt), which the tests above measure at
    // 107.9 mm. This guard is what stops that being reintroduced as a
    // simplification.
    const fnStart = SRC.indexOf('function applyBuildingShape(');
    expect(fnStart, 'applyBuildingShape not found').toBeGreaterThan(-1);
    const fnBody = SRC.slice(fnStart, SRC.indexOf('function ', fnStart + 40));
    // 🚨 NO `\b` IN THIS PATTERN, DELIBERATELY. Written through a shell heredoc
    // it becomes a literal 0x08 BACKSPACE byte, the regex can then never match,
    // and a `.not.toMatch` guard built on it passes against any source at all.
    // tests/sourceControlBytes.test.ts caught exactly that, here, in this file.
    const PER_FACE = /[^a-zA-Z]unliftAlongNormal\s*\(/;
    // Prove the pattern can fail before trusting it to. A `.not.toMatch` whose
    // regex cannot match anything is the vacuous-guard defect in miniature.
    expect(' unliftAlongNormal(').toMatch(PER_FACE);
    expect(fnBody, 'applyBuildingShape must not un-lift face by face').not.toMatch(PER_FACE);
  });
});


describe('🚨 un-lifting FACE BY FACE tears a stitched roof open', () => {
  /**
   * The regression my first version of this fix shipped, and the reason
   * `unliftFacesPreservingSharedCorners` exists.
   *
   * Stitch and the abutment pass average a shared ridge corner into ONE point,
   * in LIFTED space. A gable's halves have opposite normals, so un-lifting each
   * face along its own normal moves that single point in two directions at
   * once. `stitchRoofVertices` documents the same measurement from a browser
   * run (100.9 mm at 25 degrees) and deliberately does not un-lift because of it.
   */
  function gableHalves() {
    const hw = 3 / M_LNG, hd = 2.5 / M_LAT;
    const mk = (latOffM: number, az: number) => {
      const c = LAT + latOffM / M_LAT;
      const b = roofPlaneFromFootprint(
        [{ lat: c - hd, lng: LNG - hw }, { lat: c - hd, lng: LNG + hw },
         { lat: c + hd, lng: LNG + hw }, { lat: c + hd, lng: LNG - hw }],
        { pitchDeg: PITCH_DEG, azimuthDeg: az, eaveHeightM: WALL_M, groundElevM: GROUND_M },
      );
      expect(b).toBeTruthy();
      return b!;
    };
    const south = mk(-2.5, 180), north = mk(2.5, 0);
    const sPts: Cart3[] = south.frame.projectedPts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    const nPts: Cart3[] = north.frame.projectedPts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    // Force the ridge corners coincident, which is exactly what Stitch leaves.
    const hS = sPts.map(p => ecefToLatLng(p).height), hN = nPts.map(p => ecefToLatLng(p).height);
    const iS = hS.indexOf(Math.max(...hS)), iN = hN.indexOf(Math.max(...hN));
    const mid = { x: (sPts[iS].x + nPts[iN].x) / 2, y: (sPts[iS].y + nPts[iN].y) / 2, z: (sPts[iS].z + nPts[iN].z) / 2 };
    sPts[iS] = { ...mid }; nPts[iN] = { ...mid };
    const nrm = (b: any): Cart3 => ({ x: b.frame.normal.x, y: b.frame.normal.y, z: b.frame.normal.z });
    return { sPts, nPts, iS, iN, sN: nrm(south), nN: nrm(north) };
  }

  const gapM = (a: Cart3, b: Cart3) => {
    const ga = ecefToLatLng(a), gb = ecefToLatLng(b);
    return Math.hypot((gb.lat - ga.lat) * M_LAT, (gb.lng - ga.lng) * M_LNG);
  };

  it('the fixture really does arrive with the ridge joined', () => {
    // A fixture whose ridge was never shut could not exhibit the split.
    const { sPts, nPts, iS, iN } = gableHalves();
    expect(gapM(sPts[iS], nPts[iN])).toBeLessThan(0.001);
  });

  it('🚨 unliftAlongNormal per face splits it by 2*lift*sin(tilt)', () => {
    const { sPts, nPts, iS, iN, sN, nN } = gableHalves();
    const s = unliftAlongNormal(sPts, sN), n = unliftAlongNormal(nPts, nN);
    const split = gapM(s[iS], n[iN]);
    const predicted = 2 * SURFACE_OFFSET_M * Math.sin((PITCH_DEG * Math.PI) / 180);
    expect(split).toBeGreaterThan(0.10);
    expect(split).toBeCloseTo(predicted, 2);
  });

  it('unliftFacesPreservingSharedCorners keeps it shut', () => {
    const { sPts, nPts, iS, iN, sN, nN } = gableHalves();
    const [s, n] = unliftFacesPreservingSharedCorners([
      { pts: sPts, normal: sN }, { pts: nPts, normal: nN },
    ]);
    expect(gapM(s[iS], n[iN]), 'the ridge must stay one point').toBeLessThan(0.001);
  });

  it('…and still un-lifts every corner that nobody shares', () => {
    // Otherwise "keep it shut" could be satisfied by not un-lifting at all,
    // which is the defect this whole file exists for.
    const { sPts, nPts, iS, sN, nN } = gableHalves();
    const [s] = unliftFacesPreservingSharedCorners([
      { pts: sPts, normal: sN }, { pts: nPts, normal: nN },
    ]);
    const solo = unliftAlongNormal(sPts, sN);
    let moved = 0;
    for (let i = 0; i < sPts.length; i++) {
      if (i === iS) continue;                      // the shared one
      expect(gapM(s[i], solo[i])).toBeLessThan(1e-6);
      if (gapM(s[i], sPts[i]) > 0.04) moved++;     // ~5.4 cm each at 6:12
    }
    expect(moved, 'the unshared corners were not un-lifted').toBeGreaterThanOrEqual(2);
  });

  it('a lone face is unchanged by the group version', () => {
    const { sPts, sN } = gableHalves();
    const [only] = unliftFacesPreservingSharedCorners([{ pts: sPts, normal: sN }]);
    const solo = unliftAlongNormal(sPts, sN);
    only.forEach((p, i) => expect(gapM(p, solo[i])).toBeLessThan(1e-9));
  });

  it('two corners 0.5 m apart are NOT merged', () => {
    // The smallest edge the editor permits is MIN_EDGE_LENGTH_M = 0.5 m, so the
    // 1 cm tolerance must never treat distinct corners as one.
    const { sPts, nPts, iS, iN, sN, nN } = gableHalves();
    nPts[iN] = { x: nPts[iN].x + 0.5, y: nPts[iN].y, z: nPts[iN].z };
    const [s, n] = unliftFacesPreservingSharedCorners([
      { pts: sPts, normal: sN }, { pts: nPts, normal: nN },
    ]);
    expect(gapM(s[iS], n[iN])).toBeGreaterThan(0.3);
  });
});


describe('🚨 provenance — a roof is a MIXTURE, and only one branch carries the lift', () => {
  /**
   * `collectRoofRenderables` answers from two branches:
   *   live     — `plane3DCesiumPtsMap`, points that came out of a fit, LIFTED;
   *   fallback — `plane.vertices` dropped vertically, plan-EXACT, not lifted.
   * A single roof can contain both (a face with no render entities takes the
   * fallback). Un-lifting the whole roof with one number corrupts whichever
   * branch it guessed wrong about.
   */
  function facePair() {
    const b = build(footprint(3, 2.5), GROUND_M);
    const normal: Cart3 = { x: b.frame.normal.x, y: b.frame.normal.y, z: b.frame.normal.z };
    const lifted: Cart3[] = b.frame.projectedPts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    // The fallback branch's corners: same plane, but plan positions untouched.
    const exact: Cart3[] = unliftAlongNormal(lifted, normal);
    return { normal, lifted, exact };
  }

  const planGap = (a: Cart3, b: Cart3) => {
    const ga = ecefToLatLng(a), gb = ecefToLatLng(b);
    return Math.hypot((gb.lat - ga.lat) * M_LAT, (gb.lng - ga.lng) * M_LNG);
  };

  it('liftM: 0 leaves a plan-exact face exactly where it is', () => {
    const { normal, exact } = facePair();
    const [out] = unliftFacesPreservingSharedCorners([{ pts: exact, normal, liftM: 0 }]);
    out.forEach((p, i) => expect(planGap(p, exact[i])).toBeLessThan(1e-9));
  });

  it('🚨 and un-lifting it anyway moves it 5.4 cm the WRONG WAY', () => {
    // The defect the provenance flag prevents, measured rather than asserted.
    const { normal, exact } = facePair();
    const [wrong] = unliftFacesPreservingSharedCorners([{ pts: exact, normal }]); // default lift
    const drift = Math.max(...wrong.map((p, i) => planGap(p, exact[i])));
    expect(drift).toBeGreaterThan(0.05);
    expect(drift).toBeCloseTo(SURFACE_OFFSET_M * Math.sin((PITCH_DEG * Math.PI) / 180), 3);
  });

  it('a mixed roof: the lifted face moves, the exact one does not, in ONE call', () => {
    const { normal, lifted, exact } = facePair();
    const [a, bOut] = unliftFacesPreservingSharedCorners([
      { pts: lifted, normal, liftM: SURFACE_OFFSET_M },
      { pts: exact,  normal, liftM: 0 },
    ]);
    // Both end up at the same plan positions — which is the point: they were
    // always meant to describe the same footprint.
    a.forEach((p, i) => expect(planGap(p, exact[i])).toBeLessThan(1e-6));
    bOut.forEach((p, i) => expect(planGap(p, exact[i])).toBeLessThan(1e-9));
  });

  it('an all-exact roof is a complete no-op', () => {
    const { normal, exact } = facePair();
    const out = unliftFacesPreservingSharedCorners([
      { pts: exact, normal, liftM: 0 }, { pts: exact, normal, liftM: 0 },
    ]);
    out.forEach(face => face.forEach((p, i) => expect(planGap(p, exact[i])).toBeLessThan(1e-9)));
  });
});

describe('applyBuildingShape asks the renderable which branch answered', () => {
  const SRC2 = stripComments(
    readFileSync(join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'),
  );

  it('both branches of collectRoofRenderables tag their corners', () => {
    const fnStart = SRC2.indexOf('function collectRoofRenderables(');
    expect(fnStart).toBeGreaterThan(-1);
    const body = SRC2.slice(fnStart, SRC2.indexOf('function ', fnStart + 40));
    const pushes = body.match(/renderables\.push\(/g) ?? [];
    expect(pushes.length, 'expected exactly two branches to push renderables').toBe(2);
    const tags = body.match(/cornersPlanLiftM:/g) ?? [];
    expect(tags.length, 'every branch must state its plan-lift provenance').toBe(2);
    expect(body).toMatch(/cornersPlanLiftM:\s*SURFACE_OFFSET_M/);   // live branch
    expect(body).toMatch(/cornersPlanLiftM:\s*0/);                  // fallback branch
  });

  it('and applyBuildingShape passes it through rather than assuming', () => {
    const idx = SRC2.indexOf('const unlifted = unliftFacesPreservingSharedCorners(');
    expect(idx).toBeGreaterThan(-1);
    expect(SRC2.slice(idx, idx + 1_600)).toMatch(/liftM:\s*rp\.cornersPlanLiftM/);
  });
});
