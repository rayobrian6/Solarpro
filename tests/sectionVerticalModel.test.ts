/**
 * tests/sectionVerticalModel.test.ts
 *
 * THE LIVE ACCEPTANCE FAILURE, REPRODUCED AND THEN CLOSED.
 *
 * The installer's report:
 *
 *   "I am having to perform compensating edits: select one plane, move it
 *    vertically, select another plane that did not move, adjust Walls again,
 *    compensate for the previous adjustment... Worse, the UI reports
 *    wall/building heights around 17 ft while the modeled geometry visibly
 *    does not represent a 17 ft wall."
 *
 * 12,622 unit tests were green at the time. They proved useful invariants and
 * they did not prove usability, because not one of them asked the only question
 * that mattered: DOES THE NUMBER ON SCREEN NAME A REAL PHYSICAL DIMENSION?
 *
 * This file asks it three ways.
 *
 *   §1  reproduces the old behaviour and asserts it FAILS — so the tests below
 *       can distinguish old-broken from new-correct rather than merely passing
 *   §2  pins the new authority: absolute physical quantities, section-scoped
 *   §3  pins the invariants an edit must not break — section isolation, a ridge
 *       that stays shut, stable face ids, and a clean save/reload
 *
 * 🚨 §1 IS LOAD-BEARING. Delete it and every test below passes against a
 * reimplementation of the defect.
 */

import { describe, it, expect } from 'vitest';
import type { RoofPlane } from '@/types';
import {
  buildSectionRoofPlanes,
  sectionsFromPlanes,
  sectionFaceId,
  type BuildingSection,
} from '@/lib/3d/buildingSection';
import {
  applySectionEdit,
  measureSection,
  measureFaceVertical,
  sectionFromPlanes,
  listSections,
  ftInStr,
} from '@/lib/3d/sectionEditing';
import { roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';
import { ecefToLatLng, SURFACE_OFFSET_M } from '@/lib/roofPlane3D';
import { layoutSignature } from '@/lib/roofPlanesSignature';
import {
  multiSectionHouse, mainSection, garageSection, wingSection,
  EXPECTED, GROUND_MAIN_M, toEnu, enu,
} from './fixtures/multiSectionHouse';

const DEG = Math.PI / 180;
const FT = 0.3048;
const FT_PER_M = 3.280839895013123;

/** The whole fixture as one canonical plane array, as DesignStudio holds it. */
function houseAsPlanes(): RoofPlane[] {
  const out: RoofPlane[] = [];
  for (const s of multiSectionHouse()) {
    const built = buildSectionRoofPlanes(s);
    expect(built.ok, `fixture section ${s.id} must build`).toBe(true);
    out.push(...built.planes);
  }
  return out;
}

/**
 * A face's corners as the ROOF SURFACE, not as it is drawn.
 *
 * 🚨 UN-LIFT ALONG THE NORMAL, NOT STRAIGHT DOWN. `polygon3D` is lifted
 * SURFACE_OFFSET_M along each face's own normal, and that vector is not
 * vertical: it has a horizontal component of lift·sin(tilt) pointing down-slope.
 * Removing only the vertical part leaves every corner displaced 6 cm in plan on
 * a 30 degree face, which is enough to move a rebuilt eave by 7e-5 m — small,
 * but this file asserts to 1e-4, and a probe that is wrong by less than the
 * thing it measures is still wrong.
 *
 * It also matters for the RIDGE. Two halves of a gable carry opposite normals,
 * so their lifts push them apart along the ridge by 2·lift·sin(tilt) = 0.12 m
 * at 30 degrees — see `unliftFacesPreservingSharedCorners` in SolarEngine3D,
 * which exists for exactly this reason. Comparing drawn corners would report a
 * 12 cm gap on a gable that is geometrically shut.
 */
function unlifted(p: RoofPlane): Array<{ lat: number; lng: number; height: number }> {
  const n = (p as any).normal3D as { x: number; y: number; z: number } | undefined;
  return (p.polygon3D ?? []).map(q => {
    const c = q as any;
    const u = n
      ? { x: c.x - n.x * SURFACE_OFFSET_M, y: c.y - n.y * SURFACE_OFFSET_M, z: c.z - n.z * SURFACE_OFFSET_M }
      : c;
    return ecefToLatLng(u);
  });
}

/** Absolute elevation of a face's lowest and highest corner, lift removed. */
function faceExtentM(p: RoofPlane): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (const q of unlifted(p)) {
    if (q.height < lo) lo = q.height;
    if (q.height > hi) hi = q.height;
  }
  return { lo, hi };
}

/** The largest gap between any corner of A and its nearest corner of B, in
 *  metres — how far apart two faces that should share a ridge actually are. */
function ridgeGapM(a: RoofPlane, b: RoofPlane): number {
  const A = unlifted(a);
  const B = unlifted(b);
  // Only the upper corners of each face can be on the shared ridge.
  const topOf = (pts: typeof A) => {
    const maxH = Math.max(...pts.map(p => p.height));
    return pts.filter(p => maxH - p.height < 0.05);
  };
  const ta = topOf(A), tb = topOf(B);
  let worst = 0;
  for (const p of ta) {
    let best = Infinity;
    for (const q of tb) {
      const e = toEnu(p), f = toEnu(q);
      best = Math.min(best, Math.hypot(e.e - f.e, e.n - f.n, p.height - q.height));
    }
    if (best > worst) worst = best;
  }
  return worst;
}

// ═══════════════════════════════════════════════════════════════════════════
// §1  THE DEFECT, REPRODUCED
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A faithful port of the WALLS stepper as it stood at commit 7ceab492.
 *
 * components/3d/SolarEngine3D.tsx:
 *   ~12318 adjustBuilding:
 *            nextWall = Math.max(0.3048, effectiveWallM + delta.wall)
 *            setWallHeightM(nextWall)            // <- UNCONDITIONAL
 *            applyBuildingShape(v, Cz, {wallHeightM: nextWall}, selectedFaceId)
 *   ~12315 effectiveWallM = selectedFaceId
 *            ? (buildingOverrides.get(selectedFaceId)?.wallHeightM ?? wallHeightM)
 *            : wallHeightM
 *          — and `setBuildingOverrides` is DECLARED AND NEVER CALLED, so that
 *            map is permanently empty and both branches read the same global.
 *   ~5103  applyBuildingShape, per face, for faces matching `scope`:
 *            prevWall = wallHeightRef.current          // the global, pre-press
 *            wall     = shape.wallHeightM
 *            groundM  = lowest - prevWall              // <- INVENTED
 *            roofPlaneFromFootprint(outline, {eaveHeightM: wall, groundElevM: groundM})
 *
 * 🚨 WHAT THIS PORT DOES AND DOES NOT REPRODUCE. It reproduces the counter and
 * the ground arithmetic and the scope — the three things under test. It does
 * not reproduce the render-lift un-lifting, which the real function does
 * correctly and which is asserted by tests/applyBuildingShapeDatum.test.ts. To
 * keep the port honest the outline and eave are taken from geometry that is
 * already un-lifted, which is what that pass hands the arithmetic below.
 */
function legacyWallPress(
  planes: RoofPlane[],
  scope: string | null,
  globalWallM: number,
): { planes: RoofPlane[]; globalWallM: number } {
  const nextWall = Math.max(FT, +(globalWallM + FT).toFixed(4));
  const out = planes.map(p => {
    if (scope && p.id !== scope) return p;
    const ext = faceExtentM(p);
    // The un-lifted ring — what `unliftFacesPreservingSharedCorners` hands the
    // arithmetic in the real function. Using the drawn ring instead would add a
    // 6 cm plan displacement that the real code does not have.
    const outline = unlifted(p).map(v => ({ lat: v.lat, lng: v.lng }));
    const groundM = ext.lo - globalWallM;          // the invented datum
    const built = roofPlaneFromFootprint(outline, {
      pitchDeg: p.pitch,
      azimuthDeg: p.azimuth,
      eaveHeightM: nextWall,
      groundElevM: groundM,
    });
    if (!built) return p;
    const np = built.plane;
    np.id = p.id;
    np.sectionId = p.sectionId;
    np.sectionFaceKey = p.sectionFaceKey;
    // 🚨 THE RECORD IS NOT RE-STAMPED. applyBuildingShape emits vertices,
    // pitch, azimuth and the frames through onRoofPlanesStitched and never
    // touches `plane.section`, so the canonical record keeps the OLD eave
    // height while the geometry has moved. Two answers in one object.
    np.section = p.section;
    return np;
  });
  return { planes: out, globalWallM: nextWall };
}

describe('§1 🚨 the old editor, reproduced — these assertions describe the FAILURE', () => {
  it('the WALLS readout never named a wall: it starts 3.0 m against a 2.9 m eave and is never measured', () => {
    // components/3d/SolarEngine3D.tsx:252  FLAT_TRACE_EAVE_HEIGHT_M = 3.0
    // :1058                                useState(FLAT_TRACE_EAVE_HEIGHT_M)
    const displayedWallM = 3.0;

    // The house the user actually built. Not one of its sections is 3.0 m.
    for (const s of multiSectionHouse()) {
      expect(s.eaveHeightM, `${s.id} eave`).not.toBeCloseTo(displayedWallM, 3);
    }

    // And the gap is not small. The main house reads 9.8 ft for a 9.5 ft wall;
    // a section placed with the tool's own default (newRoofEaveHeightM = 6 m,
    // SolarEngine3D.tsx:1879) reads 9.8 ft for a 19.7 ft wall.
    const toolDefaultEaveM = 6;
    expect((toolDefaultEaveM - displayedWallM) * FT_PER_M).toBeGreaterThan(9.8);
  });

  it('🚨 THE 17 FT: eight per-face presses raise the house one foot and the readout eight', () => {
    // The user's workflow. There is no "raise this section" control, so the
    // only way to lift a whole volume is to press WALLS once per face with that
    // face selected. Our fixture house has eight faces.
    let planes = houseAsPlanes();
    expect(planes.length).toBe(8);

    const eaveBefore = faceExtentM(planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!).lo;

    let displayed = 3.0; // the global counter, at its default
    for (const p of [...planes]) {
      const r = legacyWallPress(planes, p.id, displayed);
      planes = r.planes;
      displayed = r.globalWallM;
    }

    const eaveAfter = faceExtentM(planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!).lo;

    // The building rose by ONE foot. Every face rose by one foot, once.
    expect(eaveAfter - eaveBefore).toBeCloseTo(FT, 4);

    // The readout rose by EIGHT feet, and now says seventeen.
    expect(displayed).toBeCloseTo(3.0 + 8 * FT, 4);
    expect(displayed * FT_PER_M).toBeGreaterThan(17);
    expect(displayed * FT_PER_M).toBeLessThan(18);
    expect(ftInStr(displayed)).toBe(`17' 10"`);

    // …about a wall that is ten feet six.
    const realWallM = eaveAfter - GROUND_MAIN_M;
    expect(realWallM * FT_PER_M).toBeGreaterThan(10);
    expect(realWallM * FT_PER_M).toBeLessThan(11);

    // THE LIE, AS ONE NUMBER: the readout is over seven feet above the wall.
    expect((displayed - realWallM) * FT_PER_M).toBeGreaterThan(7);
  });

  it('🚨 a face-scoped press tears the gable open at the ridge — the compensating edit', () => {
    let planes = houseAsPlanes();
    const a = () => planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    const b = () => planes.find(p => p.id === sectionFaceId('sec-main', 'slopeB'))!;

    // Built together, the two halves share the ridge exactly.
    expect(ridgeGapM(a(), b())).toBeLessThan(0.01);

    // Raise ONE half by a foot — which is all the old UI could do.
    planes = legacyWallPress(planes, a().id, 3.0).planes;

    // The roof is now open by a foot along its whole ridge. The only way to
    // shut it is to press again on the other face, which moves the readout
    // again. That is the loop the installer described.
    expect(ridgeGapM(a(), b())).toBeGreaterThan(0.29);
  });

  it('🚨 the canonical record went stale the moment WALLS was pressed', () => {
    let planes = houseAsPlanes();
    planes = legacyWallPress(planes, sectionFaceId('sec-main', 'slopeA'), 3.0).planes;

    const moved = planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    const geometricWallM = faceExtentM(moved).lo - GROUND_MAIN_M;

    // The geometry moved…
    expect(geometricWallM).toBeCloseTo(2.9 + FT, 3);
    // …and the record it carries still claims the old height. Anything that
    // rebuilds from the record — which is what editing a section does — would
    // put the face straight back.
    expect(moved.section!.eaveHeightM).toBe(2.9);
    expect(moved.section!.eaveHeightM).not.toBeCloseTo(geometricWallM, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2  THE AUTHORITY: absolute physical quantities, section-scoped
// ═══════════════════════════════════════════════════════════════════════════

describe('§2 every displayed number is a measured physical dimension', () => {
  it('measureSection reports the truth, checked against the fixture rather than itself', () => {
    const planes = houseAsPlanes();
    for (const s of multiSectionHouse()) {
      const look = sectionFromPlanes(planes, s.id);
      expect(look.found, s.id).toBe(true);

      const m = measureSection(look.section!, look.faceIds.length);
      const e = (EXPECTED as any)[s.id];

      expect(m.label).toBe(e.label);
      expect(m.faceCount).toBe(e.faces);
      expect(m.groundElevM).toBeCloseTo(e.groundElevM, 6);
      expect(m.eaveHeightM).toBeCloseTo(e.eaveHeightM, 6);
      expect(m.eaveElevM).toBeCloseTo(e.eaveElevM, 6);
      expect(m.pitchDeg).toBeCloseTo(e.pitchDeg, 6);
      expect(m.ridgeHeightM!).toBeCloseTo(e.ridgeHeightM, 4);
      expect(m.ridgeElevM!).toBeCloseTo(e.ridgeElevM, 4);

      // Plan dimensions, to the centimetre, against metres stated by hand.
      const pair = [m.planAM, m.planBM].sort((x, y) => y - x);
      const want = [e.widthM, e.depthM].sort((x, y) => y - x);
      expect(pair[0]).toBeCloseTo(want[0], 2);
      expect(pair[1]).toBeCloseTo(want[1], 2);
    }
  });

  it('🚨 measureFaceVertical removes the render lift — a 4-inch error is where the chasing starts', () => {
    const planes = houseAsPlanes();
    const face = planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;

    const m = measureFaceVertical(face);
    expect(m.eaveElevM!).toBeCloseTo(GROUND_MAIN_M + 2.9, 6);
    expect(m.ridgeElevM!).toBeCloseTo(EXPECTED['sec-main'].ridgeElevM, 3);

    // MUTATION PROOF: had the lift been left in, the eave would read this much
    // higher. The tolerance above is 1e-6, so forgetting it fails.
    const liftUp = SURFACE_OFFSET_M * Math.cos(30 * DEG);
    expect(liftUp).toBeGreaterThan(0.10);
    expect(Math.abs((m.eaveElevM! + liftUp) - (GROUND_MAIN_M + 2.9))).toBeGreaterThan(0.10);
  });

  it('a section face knows its own pad, so its wall height is real without being told', () => {
    const planes = houseAsPlanes();
    for (const s of multiSectionHouse()) {
      for (const p of planes.filter(x => x.sectionId === s.id)) {
        const m = measureFaceVertical(p);
        expect(m.groundResolved, p.id).toBe(true);
        expect(m.wallHeightM!, p.id).toBeCloseTo(s.eaveHeightM, 5);
        expect(m.sectionId).toBe(s.id);
      }
    }
  });

  it('🚨 a standalone face with no known ground reports UNRESOLVED, not a number', () => {
    // A hand trace, a Google segment, an import: no pad elevation exists.
    const built = roofPlaneFromFootprint(
      [enu(-5, -4), enu(5, -4), enu(5, 4), enu(-5, 4)],
      { pitchDeg: 22, azimuthDeg: 180, eaveHeightM: 3.2, groundElevM: 151 },
    )!;
    const loose: RoofPlane = built.plane;
    loose.id = 'hand-traced-1';
    delete (loose as any).section;
    delete (loose as any).sectionId;

    const m = measureFaceVertical(loose);
    expect(m.sectionId).toBeNull();
    expect(m.groundResolved).toBe(false);
    expect(m.wallHeightM).toBeNull();
    expect(ftInStr(m.wallHeightM)).toBe('—');

    // Its ELEVATION is still knowable and is still reported — what is unknown
    // is where the ground is, not where the roof is.
    expect(m.eaveElevM!).toBeCloseTo(151 + 3.2, 4);

    // Supply a ground and the same call answers.
    const told = measureFaceVertical(loose, 151);
    expect(told.groundResolved).toBe(true);
    expect(told.wallHeightM!).toBeCloseTo(3.2, 4);
  });

  it('🚨 setting an absolute value twice is idempotent — a counter would double it', () => {
    const planes = houseAsPlanes();
    const once = applySectionEdit(planes, 'sec-main', { eaveHeightM: 3.5 });
    expect(once.ok).toBe(true);
    const twice = applySectionEdit(once.planes, 'sec-main', { eaveHeightM: 3.5 });
    expect(twice.ok).toBe(true);

    expect(twice.section!.eaveHeightM).toBe(3.5);
    const f = twice.planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    expect(measureFaceVertical(f).wallHeightM!).toBeCloseTo(3.5, 5);
    // The eave sits where it was asked to, not at 4.1 m.
    expect(faceExtentM(f).lo).toBeCloseTo(GROUND_MAIN_M + 3.5, 4);
  });

  it('ridge height is DERIVED and cannot be set, so it can never disagree', () => {
    const planes = houseAsPlanes();
    const r = applySectionEdit(planes, 'sec-main', { pitchDeg: 45 });
    expect(r.ok).toBe(true);

    // 14x9 gable, ridge on the long (14 m) axis -> span is the 9 m depth.
    const wantRidgeH = 2.9 + 4.5 * Math.tan(45 * DEG);
    expect(r.ridgeHeightM!).toBeCloseTo(wantRidgeH, 3);

    const m = measureSection(r.section!, 2);
    expect(m.ridgeElevM!).toBeCloseTo(GROUND_MAIN_M + wantRidgeH, 3);

    // …and the geometry agrees with the number shown.
    const f = r.planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    expect(faceExtentM(f).hi).toBeCloseTo(GROUND_MAIN_M + wantRidgeH, 2);
  });

  it('the pad elevation is absolute: moving it moves eave and ridge together', () => {
    const planes = houseAsPlanes();
    const r = applySectionEdit(planes, 'sec-main', { groundElevM: GROUND_MAIN_M + 1.75 });
    expect(r.ok).toBe(true);

    const f = r.planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    const ext = faceExtentM(f);
    expect(ext.lo).toBeCloseTo(GROUND_MAIN_M + 1.75 + 2.9, 4);
    // The WALL did not change. Only the pad did.
    expect(measureFaceVertical(f).wallHeightM!).toBeCloseTo(2.9, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3  INVARIANTS AN EDIT MUST NOT BREAK
// ═══════════════════════════════════════════════════════════════════════════

describe('§3 editing one section leaves every other section exactly as it was', () => {
  it('🚨 raising the garage does not move the house or the wing by one micrometre', () => {
    const before = houseAsPlanes();
    const snapshot = new Map(before.map(p => [p.id, faceExtentM(p)]));

    const r = applySectionEdit(before, 'sec-garage', { eaveHeightM: 2.4 + 2 * FT });
    expect(r.ok).toBe(true);

    for (const p of r.planes) {
      const was = snapshot.get(p.id)!;
      const now = faceExtentM(p);
      if (p.sectionId === 'sec-garage') {
        expect(now.lo - was.lo, p.id).toBeCloseTo(2 * FT, 4);
      } else {
        expect(now.lo, p.id).toBeCloseTo(was.lo, 9);
        expect(now.hi, p.id).toBeCloseTo(was.hi, 9);
      }
    }
  });

  it('🚨 every face of the edited section moves TOGETHER — the ridge stays shut', () => {
    const planes = houseAsPlanes();
    const r = applySectionEdit(planes, 'sec-main', { eaveHeightM: 2.9 + FT });
    expect(r.ok).toBe(true);

    const a = r.planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    const b = r.planes.find(p => p.id === sectionFaceId('sec-main', 'slopeB'))!;
    expect(ridgeGapM(a, b)).toBeLessThan(0.01);

    // The hip garage has four faces and one apex line; all four must agree.
    const g = applySectionEdit(planes, 'sec-garage', { pitchDeg: 35 });
    expect(g.ok).toBe(true);
    const gf = g.planes.filter(p => p.sectionId === 'sec-garage');
    expect(gf.length).toBe(4);
    const tops = gf.map(p => faceExtentM(p).hi);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(0.01);
  });

  it('face ids survive every edit, so panels are never orphaned', () => {
    const planes = houseAsPlanes();
    const idsBefore = planes.map(p => p.id).sort();

    let cur = planes;
    for (const edit of [
      { eaveHeightM: 3.4 }, { pitchDeg: 38 }, { groundElevM: 151.2 },
      { moveEastM: 2, moveNorthM: -1 }, { label: 'Main house' },
    ]) {
      const r = applySectionEdit(cur, 'sec-main', edit as any);
      expect(r.ok, JSON.stringify(edit)).toBe(true);
      expect(r.removedFaceIds).toEqual([]);
      cur = r.planes;
    }
    expect(cur.map(p => p.id).sort()).toEqual(idsBefore);
  });

  it('🚨 the record is re-stamped on every face, so nothing goes stale', () => {
    const planes = houseAsPlanes();
    const r = applySectionEdit(planes, 'sec-main', { eaveHeightM: 3.75, pitchDeg: 33 });
    expect(r.ok).toBe(true);

    for (const p of r.planes.filter(x => x.sectionId === 'sec-main')) {
      expect(p.section!.eaveHeightM, p.id).toBe(3.75);
      expect(p.section!.pitchDeg, p.id).toBe(33);
      // The record and the geometry agree — the §1 failure, closed.
      expect(measureFaceVertical(p).wallHeightM!).toBeCloseTo(3.75, 5);
    }
    // And the untouched sections keep theirs.
    expect(r.planes.find(p => p.sectionId === 'sec-garage')!.section!.eaveHeightM).toBe(2.4);
  });

  it('moving a section slides it without resizing it', () => {
    const planes = houseAsPlanes();
    const r = applySectionEdit(planes, 'sec-wing', { moveEastM: 3, moveNorthM: 1.5 });
    expect(r.ok).toBe(true);

    const was = wingSection().footprint.map(toEnu);
    const now = r.section!.footprint.map(toEnu);
    for (let i = 0; i < was.length; i++) {
      expect(now[i].e - was[i].e, `corner ${i} east`).toBeCloseTo(3, 4);
      expect(now[i].n - was[i].n, `corner ${i} north`).toBeCloseTo(1.5, 4);
    }
    // Same building, moved. Its dimensions are unchanged to the millimetre.
    const m = measureSection(r.section!, 2);
    expect(m.planAM).toBeCloseTo(8, 3);
    expect(m.planBM).toBeCloseTo(5, 3);
  });

  it('🚨 a refusal is a NO-OP that returns the input, never an empty roof', () => {
    const planes = houseAsPlanes();
    for (const bad of [
      { eaveHeightM: NaN },
      { pitchDeg: NaN },
      { groundElevM: NaN },
      { pitchDeg: 91 },
      { eaveHeightM: -4 },
      { footprint: [enu(0, 0), enu(0.1, 0), enu(0.1, 0.1), enu(0, 0.1)] }, // 10 cm house
    ]) {
      const r = applySectionEdit(planes, 'sec-main', bad as any);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.refusals.length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(r.planes).toEqual(planes);   // identical, not merely non-empty
      expect(r.planes.length).toBe(8);
    }
  });

  it('an unknown section, a section with no record, and a conflicted one are all refused', () => {
    const planes = houseAsPlanes();

    expect(applySectionEdit(planes, 'sec-nope', { pitchDeg: 30 }).refusals[0].code)
      .toBe('SECTION_NOT_FOUND');

    const recordless = planes.map(p => {
      if (p.sectionId !== 'sec-wing') return p;
      const q = { ...p }; delete (q as any).section; return q;
    });
    expect(applySectionEdit(recordless, 'sec-wing', { pitchDeg: 30 }).refusals[0].code)
      .toBe('SECTION_RECORD_MISSING');

    // 🚨 A DISAGREEMENT IS NOT A VOTE. One face's copy is edited behind the
    // domain's back — exactly what a partial legacy write-back leaves.
    const conflicted = planes.map(p => {
      if (p.id !== sectionFaceId('sec-wing', 'slopeB')) return p;
      return { ...p, section: { ...p.section!, eaveHeightM: 9.9 } };
    });
    const c = applySectionEdit(conflicted, 'sec-wing', { pitchDeg: 30 });
    expect(c.ok).toBe(false);
    expect(c.refusals[0].code).toBe('SECTION_RECORDS_CONFLICT');
    expect(c.planes).toEqual(conflicted);
  });
});

describe('🚨 §3 a vertical edit must make the AUTOSAVE FIRE', () => {
  // A touch audit of the vertical surface found this and it is the sharpest
  // threat to "save it, reload it": SIGNED_FIELDS (lib/roofPlanesSignature.ts)
  // deliberately excludes origin3D, polygon3D, normal3D, ecefFrame3D,
  // localFrame3D and planeHeightAtCenterMeters — and tests/roofPlanesSignature
  // PINS that a polygon3D change must not move the signature. So a face that
  // moves vertically while its plan footprint stays identical is invisible to
  // the save path: the audit found a byte-identical signature for a 7.85 m
  // vertical move.
  //
  // A SECTION edit survives that, but not by luck — `section` is in
  // SIGNED_FIELDS, so the eave height and pad elevation are signed directly.
  // This asserts it rather than assuming it.

  it('changing the eave height moves the signature', () => {
    const before = houseAsPlanes();
    const after = applySectionEdit(before, 'sec-main', { eaveHeightM: 2.9 + FT }).planes;
    expect(layoutSignature({ panels: [], designElectrical: null, roofPlanes: after }))
      .not.toBe(layoutSignature({ panels: [], designElectrical: null, roofPlanes: before }));
  });

  it('🚨 the pad elevation is signed DIRECTLY, not by coordinate noise', () => {
    // 🚨 WHY THIS IS NOT ASSERTED THE OBVIOUS WAY. A first version raised the
    // pad and asserted the plan footprint was byte-identical, expecting the
    // signature to move purely because `section` is signed. The premise was
    // false: `vertices` come back from an ECEF round-trip at a different
    // altitude, so they wobble in the last few decimal places. The signature
    // would then have moved for a reason the test did not name — which is the
    // "saved only by floating-point luck" the audit warned about, dressed as a
    // pass.
    //
    // So this constructs the case directly: two plane lists identical in EVERY
    // field except `section.groundElevM`.
    const before = houseAsPlanes();
    const after = before.map(p => p.sectionId !== 'sec-garage' ? p : ({
      ...p, section: { ...p.section!, groundElevM: 147.9 },
    }));

    const planOf = (ps: RoofPlane[]) => JSON.stringify(ps.map(p => p.vertices));
    expect(planOf(after), 'the premise: nothing in plan differs').toBe(planOf(before));

    expect(layoutSignature({ panels: [], designElectrical: null, roofPlanes: after }))
      .not.toBe(layoutSignature({ panels: [], designElectrical: null, roofPlanes: before }));

    // …and the real edit path moves it too, for whatever combination of reasons.
    const real = applySectionEdit(before, 'sec-garage', { groundElevM: 147.9 }).planes;
    expect(layoutSignature({ panels: [], designElectrical: null, roofPlanes: real }))
      .not.toBe(layoutSignature({ panels: [], designElectrical: null, roofPlanes: before }));
  });

  it('🚨 an edit does not REORDER the roof — roofPlanes[0].pitch is the PVWatts tilt', () => {
    // `replaceSectionFaces` was `[...kept, ...rebuilt]`, which moved an edited
    // section's faces to the end of the array. Two things read that order: the
    // signature, and lib/pvwatts.ts, which takes the array tilt from index 0.
    // So editing the garage could change the production estimate for the house.
    const before = houseAsPlanes();
    const idsBefore = before.map(p => p.id);
    for (const [sid, edit] of [
      ['sec-main', { eaveHeightM: 3.4 }],
      ['sec-garage', { pitchDeg: 30 }],
      ['sec-wing', { moveEastM: 1 }],
    ] as Array<[string, any]>) {
      const after = applySectionEdit(before, sid, edit).planes;
      expect(after.map(p => p.id), `${sid} reordered the roof`).toEqual(idsBefore);
    }
  });

  it('a pitch change and a rename both move it', () => {
    const before = houseAsPlanes();
    const sig = (ps: RoofPlane[]) => layoutSignature({ panels: [], designElectrical: null, roofPlanes: ps });
    expect(sig(applySectionEdit(before, 'sec-wing', { pitchDeg: 41 }).planes)).not.toBe(sig(before));
    // A rename moves no geometry whatever, which is exactly why `section` had
    // to be signed as a whole rather than field by field.
    expect(sig(applySectionEdit(before, 'sec-wing', { label: 'Sunroom' }).planes)).not.toBe(sig(before));
  });

  it('POSITIVE CONTROL — an identical rebuild does NOT move it, so the probe is not trivially true', () => {
    const before = houseAsPlanes();
    const same = applySectionEdit(before, 'sec-main', { eaveHeightM: 2.9 }).planes; // its current value
    expect(layoutSignature({ panels: [], designElectrical: null, roofPlanes: same }))
      .toBe(layoutSignature({ panels: [], designElectrical: null, roofPlanes: before }));
  });
});

describe('§3 save and reload recover the same building', () => {
  it('🚨 every edit survives a JSON round-trip, field by field', () => {
    let planes = houseAsPlanes();
    planes = applySectionEdit(planes, 'sec-main', { eaveHeightM: 3.15, pitchDeg: 34, label: 'House' }).planes;
    planes = applySectionEdit(planes, 'sec-garage', { groundElevM: 149.05, pitchDeg: 18 }).planes;
    planes = applySectionEdit(planes, 'sec-wing', { moveEastM: 1.25, ridgeAxis: 'short' }).planes;

    // What autosave actually does to this array.
    const reloaded: RoofPlane[] = JSON.parse(JSON.stringify(planes));

    const back = sectionsFromPlanes(reloaded);
    expect(back.conflicted).toEqual([]);
    expect(back.sections.length).toBe(3);

    const byId = new Map(back.sections.map(s => [s.id, s]));

    // 🚨 ASSERTED FIELD BY FIELD AGAINST HAND-WRITTEN VALUES. An earlier
    // persistence test used the copier as its own oracle, so a field the copier
    // forgot was dropped from BOTH sides and the suite stayed green while a
    // cross-gable's ridge rotated 90 degrees on reload.
    const main = byId.get('sec-main')!;
    expect(main.kind).toBe('gable');
    expect(main.eaveHeightM).toBe(3.15);
    expect(main.pitchDeg).toBe(34);
    expect(main.groundElevM).toBe(GROUND_MAIN_M);
    expect(main.ridgeAxis).toBe('long');
    expect(main.label).toBe('House');
    expect(main.footprint.length).toBe(4);

    const garage = byId.get('sec-garage')!;
    expect(garage.kind).toBe('hip');
    expect(garage.groundElevM).toBe(149.05);
    expect(garage.pitchDeg).toBe(18);
    expect(garage.eaveHeightM).toBe(2.4);

    const wing = byId.get('sec-wing')!;
    expect(wing.ridgeAxis).toBe('short');
    expect(wing.eaveHeightM).toBe(2.6);
    expect(toEnu(wing.footprint[0]).e).toBeCloseTo(-4 + 1.25, 3);

    // The reloaded building measures the same as the one that was saved.
    for (const s of back.sections) {
      const live = sectionFromPlanes(planes, s.id).section!;
      expect(measureSection(s, 2)).toEqual(measureSection(live, 2));
    }
  });

  it('reload can still edit: the round-tripped array is a valid editing target', () => {
    let planes: RoofPlane[] = JSON.parse(JSON.stringify(houseAsPlanes()));
    const r = applySectionEdit(planes, 'sec-garage', { eaveHeightM: 2.9 });
    expect(r.ok).toBe(true);
    expect(measureFaceVertical(
      r.planes.find(p => p.id === sectionFaceId('sec-garage', 'hipEndA'))!,
    ).wallHeightM!).toBeCloseTo(2.9, 5);
  });

  it('listSections enumerates the building for the selection UI', () => {
    const planes = houseAsPlanes();
    const list = listSections(planes);
    expect(list.map(s => s.sectionId)).toEqual(['sec-main', 'sec-garage', 'sec-wing']);
    expect(list.map(s => s.faceIds.length)).toEqual([2, 4, 2]);
    expect(list.every(s => !s.conflicted)).toBe(true);
    expect(list.map(s => s.section!.label)).toEqual(['House', 'Garage', 'Rear addition']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POSITIVE CONTROLS — the probes above can tell right from wrong
// ═══════════════════════════════════════════════════════════════════════════

describe('positive controls', () => {
  it('ridgeGapM really does read zero for a shut ridge and non-zero for an open one', () => {
    const planes = houseAsPlanes();
    const a = planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    const b = planes.find(p => p.id === sectionFaceId('sec-main', 'slopeB'))!;
    expect(ridgeGapM(a, b)).toBeLessThan(0.01);
    // The wing's ridge runs the other way and is nowhere near the main ridge.
    const w = planes.find(p => p.id === sectionFaceId('sec-wing', 'slopeA'))!;
    expect(ridgeGapM(a, w)).toBeGreaterThan(1);
  });

  it('faceExtentM can tell two eave heights apart', () => {
    const planes = houseAsPlanes();
    const house = faceExtentM(planes.find(p => p.sectionId === 'sec-main')!).lo;
    const garage = faceExtentM(planes.find(p => p.sectionId === 'sec-garage')!).lo;
    // 150+2.9 against 149.4+2.4 — 1.1 m apart, and the probe says so.
    expect(house - garage).toBeCloseTo(1.1, 3);
  });

  it('ftInStr rounds the way a tape measure does', () => {
    expect(ftInStr(0)).toBe(`0' 0"`);
    expect(ftInStr(1)).toBe(`3' 3"`);
    expect(ftInStr(5.18)).toBe(`17' 0"`);
    expect(ftInStr(2.9)).toBe(`9' 6"`);
    expect(ftInStr(null)).toBe('—');
    expect(ftInStr(NaN)).toBe('—');
    // 11.6 inches must carry to the next foot, not print 12".
    expect(ftInStr(11.96 * 0.0254)).toBe(`1' 0"`);
  });
});
