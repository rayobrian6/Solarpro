/**
 * tests/perFacePitch.test.ts
 *
 * PER-FACE PITCH — THE LIVE GAUNTLET FAILURE, AND THE PROPERTY THAT CLOSES IT.
 *
 * The report was specific: "The current UI can display pitch for a selected
 * roof face but cannot edit that face's pitch. That is a blocking capability
 * gap." And the acceptance bar for the whole editor: "I must be able to model
 * this house without performing compensating edits across unrelated controls."
 *
 * So the load-bearing test in this file is not "the new number is stored". It
 * is THE NON-COMPENSATION PROPERTY:
 *
 *     change slope A's pitch
 *       -> slope A acquires it, in the GEOMETRY, not as a relabelled scalar
 *       -> the roof is still SHUT: both faces share one ridge line
 *       -> slope B's pitch is UNCHANGED
 *       -> slope B's eave is UNCHANGED
 *       -> every other section is byte-identical
 *
 * If all five hold, there is nothing left to compensate for.
 *
 * 🚨 THE SYMMETRIC CASE IS A PROTECTED REGRESSION INVARIANT. The ridge solution
 * was generalised from "the ridge is the centreline" to "the ridge is the
 * height both slopes agree on". A symmetric gable must come out EXACTLY as it
 * did before, because the previous round's datum fix is pinned to it.
 */

import { describe, it, expect } from 'vitest';
import type { RoofPlane } from '@/types';
import {
  buildSectionRoofPlanes,
  layoutSectionFaces,
  pitchForFace,
  sectionHasMixedPitch,
  sectionRecord,
  faceKeyOfFaceId,
  faceKeysForKind,
  type BuildingSection,
} from '@/lib/3d/buildingSection';
import {
  applyFacePitchEdit,
  applySectionEdit,
  previewFacePitch,
  measureFaceVertical,
  measureSection,
  sectionFromPlanes,
} from '@/lib/3d/sectionEditing';
import {
  degFromRise12, formatRise12, parsePitchInput, riseOver12,
} from '@/lib/3d/pitchFormat';
import { ecefToLatLng } from '@/lib/roofPlane3D';
import {
  mainSection, garageSection, wingSection, multiSectionHouse, GROUND_MAIN_M,
} from './fixtures/multiSectionHouse';

const DEG = Math.PI / 180;

/** Every face of every section, the way the engine holds them. */
function housePlanes(sections: BuildingSection[] = multiSectionHouse()): RoofPlane[] {
  const out: RoofPlane[] = [];
  for (const s of sections) {
    const built = buildSectionRoofPlanes(s);
    expect(built.ok, `fixture section ${s.id} must build`).toBe(true);
    out.push(...built.planes);
  }
  return out;
}

const byId = (planes: RoofPlane[], id: string): RoofPlane => {
  const p = planes.find(q => q.id === id);
  expect(p, `plane ${id} must exist`).toBeTruthy();
  return p!;
};

/** The highest and lowest points of a face, with the render lift removed. */
function extent(plane: RoofPlane): { lo: number; hi: number } {
  const m = measureFaceVertical(plane);
  return { lo: m.eaveElevM!, hi: m.ridgeElevM! };
}

/**
 * The ridge corners of a face, from CANONICAL plan geometry.
 *
 * 🚨 NOT FROM `polygon3D`. Those points carry SURFACE_OFFSET_M along the face
 * NORMAL, and the two halves of a gable have different normals — so a shut
 * ridge measures as a gap there, horizontally by lift·sin(tilt) in opposite
 * directions and, once the two pitches differ, vertically by the difference of
 * lift·cos(tilt) as well. On a 45/30 gable that is 1.9 cm of pure render lift.
 * The first version of this helper read `polygon3D` and reported that as a
 * broken ridge: measuring the render and calling it the model is precisely the
 * mistake `measureFaceVertical` exists to prevent.
 *
 * `plane.vertices` is the un-lifted plan record. Paired with the layout's
 * per-corner heights it is the canonical surface.
 */
function ridgePlanCorners(section: BuildingSection, key: string):
    Array<{ lat: number; lng: number; h: number }> {
  const laid = layoutSectionFaces(section);
  const face = laid.faces.find(f => f.key === key)!;
  const hi = Math.max(...face.heightsM);
  return face.outline
    .map((v, i) => ({ lat: v.lat, lng: v.lng, h: face.heightsM[i] }))
    .filter(p => hi - p.h < 1e-9);
}

/** The same, read off a BUILT plane's plan record, to prove the two agree. */
function builtRidgeCorners(plane: RoofPlane): Array<{ lat: number; lng: number }> {
  const pts = (plane.polygon3D ?? []).map(p => ecefToLatLng(p as any));
  const hi = Math.max(...pts.map(p => p.height));
  const idx: number[] = [];
  pts.forEach((p, i) => { if (hi - p.height < 0.05) idx.push(i); });
  return idx.map(i => ({ lat: plane.vertices[i].lat, lng: plane.vertices[i].lng }));
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE PROTECTED INVARIANT — a symmetric gable did not move.
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the symmetric case is unchanged by the generalisation', () => {
  it('a plain gable still puts its ridge at the centreline, at eave + halfSpan·tan', () => {
    const s = mainSection();               // 14 x 9, pitch 30, eave 2.9
    const laid = layoutSectionFaces(s);
    expect(laid.refusals).toEqual([]);
    // The span across the east-west ridge is the 9 m depth.
    expect(laid.ridgeHeightM!).toBeCloseTo(2.9 + 4.5 * Math.tan(30 * DEG), 6);

    // 🚨 THE RIDGE IS STILL EXACTLY THE RAKE MIDPOINTS. This is the assertion
    // that pins the generalisation: with equal pitches the solved position
    // `dA/span` is 0.5, so `lerp` lands on the midpoint and the layout is the
    // one this module produced before per-face pitch existed.
    for (const key of ['slopeA', 'slopeB']) {
      const face = laid.faces.find(f => f.key === key)!;
      const hi = face.outline.filter((_, i) => face.heightsM[i] > 2.91);
      expect(hi.length, key).toBe(2);
      // The main mass runs -7..7 east; its rake midpoints are at east ±7,
      // north 0 — i.e. exactly the site latitude.
      for (const p of hi) expect(Math.abs(p.lat - 38.70615)).toBeLessThan(1e-12);
    }

    const built = buildSectionRoofPlanes(s);
    const a = built.planes.find(p => p.sectionFaceKey === 'slopeA')!;
    const b = built.planes.find(p => p.sectionFaceKey === 'slopeB')!;
    // Both halves at the requested pitch, and — the load-bearing half of the
    // previous round's geodetic-vs-geocentric fix — equal to each other.
    // Two decimals is this module's established tolerance for the PLANE FITTER
    // (tests/buildingSection.test.ts:273); the ~0.0006° residual is the
    // fitter's, not the layout's, and it is identical for both halves.
    expect(a.pitch).toBeCloseTo(30, 2);
    expect(b.pitch).toBeCloseTo(30, 2);
    // The protected invariant elsewhere in this suite is 0.01°
    // (tests/buildingSection.test.ts:222). The measured disagreement here is
    // 9.3e-6°, from the plane fitter, and this pins it three orders inside the
    // guarantee so a regression shows up here first.
    expect(Math.abs(a.pitch - b.pitch)).toBeLessThan(1e-4);
  });

  it('a plain hip still sets its ridge back by the half-span at both ends', () => {
    const s = garageSection();             // 7 x 6, hip, pitch 25
    const built = buildSectionRoofPlanes(s);
    expect(built.ok).toBe(true);
    for (const p of built.planes) expect(p.pitch).toBeCloseTo(25, 2);
    expect(built.ridgeHeightM!).toBeCloseTo(2.4 + 3 * Math.tan(25 * DEG), 6);
  });

  it('🚨 a 0° gable still builds — equal pitches are solved by symmetry, not by division', () => {
    // The general ridge solution divides by tan, and at 0° that is 0/0. Equal
    // pitches take the symmetric branch instead, so the degenerate flat gable
    // the pitch slider has always been able to produce still produces a roof.
    // Losing this was a real regression caught by tests/buildingSection.test.ts.
    const flatGable = layoutSectionFaces({ ...mainSection(), pitchDeg: 0 });
    expect(flatGable.refusals).toEqual([]);
    expect(flatGable.ridgeHeightM).toBeCloseTo(2.9, 9);
    expect(flatGable.faces.length).toBe(2);

    const flatHip = buildSectionRoofPlanes({ ...garageSection(), pitchDeg: 0 });
    expect(flatHip.refusals).toEqual([]);
    expect(flatHip.ok).toBe(true);
    // 🚨 FOUR FACES, NOT FOUR SLIVERS. With no rise there is no setback to
    // derive, and a zero setback would put both hip-end apexes on the rake
    // line — three collinear corners, which cannot be built at all.
    expect(flatHip.planes.length).toBe(4);
  });

  it('a flat face BESIDE a pitched one is refused — there is no ridge they share', () => {
    // Caught by `validateSection`, which runs first and names the face.
    const early = layoutSectionFaces({ ...mainSection(), facePitchDeg: { slopeA: 0 } });
    expect(early.refusals.map(r => r.code)).toEqual(['FACE_PITCH_TOO_FLAT']);
    expect(early.refusals[0].message).toMatch(/shed or flat section/);

    // And the layout's own guard, reached when the flat side is the SECTION
    // default (which is legal on its own — a 0° gable — and only becomes
    // unbuildable once the other face is given a real slope).
    const late = layoutSectionFaces({
      ...mainSection(), pitchDeg: 0, facePitchDeg: { slopeA: 30 },
    });
    expect(late.refusals.map(r => r.code)).toEqual(['FACE_PITCH_TOO_FLAT']);
    expect(late.refusals[0].message).toMatch(/shed section for a single sloped plane/);
    expect(late.ridgeHeightM).toBeNull();
  });

  it('a section with no facePitchDeg reports no mixed pitch', () => {
    expect(sectionHasMixedPitch(mainSection())).toBe(false);
    expect(sectionHasMixedPitch(garageSection())).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE ACCEPTANCE PROPERTY — no compensating edit.
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 changing ONE face’s pitch requires no compensating edit', () => {
  const before = housePlanes();
  const out = applyFacePitchEdit(before, 'sec-main::slopeA', 45);

  it('the edit is accepted and names the section face', () => {
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.scope).toBe('section-face');
    expect(out.rebuiltFaceIds.sort()).toEqual(['sec-main::slopeA', 'sec-main::slopeB']);
  });

  it('🚨 the GEOMETRY acquires the pitch — it is read back off the built surface', () => {
    // Not `plane.pitch === 45` by assignment: `roofPlaneFromLiftedOutline` fits
    // the plane to corner heights and the pitch is the fit's own answer. If the
    // ridge solution were wrong, this would come out at something else.
    expect(byId(out.planes, 'sec-main::slopeA').pitch).toBeCloseTo(45, 2);
  });

  it('🚨 slope B keeps ITS pitch — nothing to compensate for', () => {
    const b0 = byId(before, 'sec-main::slopeB');
    const b1 = byId(out.planes, 'sec-main::slopeB');
    expect(b0.pitch).toBeCloseTo(30, 2);
    expect(b1.pitch).toBeCloseTo(30, 2);
    expect(Math.abs(b1.pitch - b0.pitch)).toBeLessThan(0.02);
  });

  it('🚨 slope B keeps ITS eave — the wall it stands on did not move', () => {
    expect(extent(byId(out.planes, 'sec-main::slopeB')).lo)
      .toBeCloseTo(extent(byId(before, 'sec-main::slopeB')).lo, 6);
    expect(extent(byId(out.planes, 'sec-main::slopeA')).lo)
      .toBeCloseTo(extent(byId(before, 'sec-main::slopeA')).lo, 6);
  });

  it('🚨 THE ROOF IS STILL SHUT — both faces reach one shared ridge', () => {
    const sec = sectionFromPlanes(out.planes, 'sec-main').section!;
    const a = ridgePlanCorners(sec, 'slopeA');
    const b = ridgePlanCorners(sec, 'slopeB');
    expect(a.length).toBe(2);
    expect(b.length).toBe(2);
    // Identical height, to the float.
    expect(a[0].h).toBe(b[0].h);
    expect(a[1].h).toBe(b[1].h);
    // ...and the SAME two points in plan, in either order. Not "close": the
    // same corner objects come out of one `lerp`, so a difference of any size
    // would mean the two faces were laid out from different ridges.
    for (const pa of a) {
      const twin = b.some(pb => pa.lat === pb.lat && pa.lng === pb.lng);
      expect(twin, `ridge corner ${pa.lat},${pa.lng} is shared`).toBe(true);
    }
  });

  it('…and the BUILT planes carry that same shared ridge in their plan record', () => {
    const a = builtRidgeCorners(byId(out.planes, 'sec-main::slopeA'));
    const b = builtRidgeCorners(byId(out.planes, 'sec-main::slopeB'));
    expect(a.length).toBe(2);
    expect(b.length).toBe(2);
    for (const pa of a) {
      const twin = b.some(pb =>
        Math.abs(pa.lat - pb.lat) < 1e-11 && Math.abs(pa.lng - pb.lng) < 1e-11);
      expect(twin, `built ridge corner ${pa.lat},${pa.lng} is shared`).toBe(true);
    }
  });

  it('🚨 the rendered ridge gap is the SURFACE LIFT and nothing else', () => {
    // `polygon3D` is lifted 0.12 m along each face's own normal, and the two
    // halves point opposite ways — so the DRAWN ridges are apart even on a
    // perfect roof. Pinning the size of that gap to the lift keeps a future
    // reader from mistaking it for a geometry defect, and would catch a real
    // one hiding behind it.
    const SURFACE_OFFSET_M = 0.12;
    const hi = (p: RoofPlane) =>
      Math.max(...(p.polygon3D ?? []).map(q => ecefToLatLng(q as any).height));
    const gap = Math.abs(hi(byId(out.planes, 'sec-main::slopeA'))
                       - hi(byId(out.planes, 'sec-main::slopeB')));
    const predicted = Math.abs(
      SURFACE_OFFSET_M * Math.cos(45 * DEG) - SURFACE_OFFSET_M * Math.cos(30 * DEG));
    expect(gap).toBeCloseTo(predicted, 3);
    // And `measureFaceVertical`, which removes it, reports one ridge.
    expect(extent(byId(out.planes, 'sec-main::slopeA')).hi)
      .toBeCloseTo(extent(byId(out.planes, 'sec-main::slopeB')).hi, 3);
  });

  it('🚨 the ridge moved TOWARD the steeper slope, by the solved amount', () => {
    const laid = layoutSectionFaces(sectionFromPlanes(out.planes, 'sec-main').section!);
    const tanA = Math.tan(45 * DEG), tanB = Math.tan(30 * DEG);
    const rise = 9 * tanA * tanB / (tanA + tanB);
    expect(laid.ridgeHeightM!).toBeCloseTo(2.9 + rise, 3);
    // Slope A is steeper, so it needs LESS run: its plan width shrinks.
    const dA = rise / tanA;
    expect(dA).toBeLessThan(4.5);
    expect(dA + rise / tanB).toBeCloseTo(9, 6);
  });

  it('🚨 NO OTHER SECTION MOVED — byte-identical', () => {
    for (const id of ['sec-garage::slopeA', 'sec-garage::slopeB', 'sec-garage::hipEndA',
                      'sec-garage::hipEndB', 'sec-wing::slopeA', 'sec-wing::slopeB']) {
      expect(JSON.stringify(byId(out.planes, id)))
        .toBe(JSON.stringify(byId(before, id)));
    }
  });

  it('🚨 the panels keep their face — the ids did not change', () => {
    expect(out.planes.map(p => p.id).sort()).toEqual(before.map(p => p.id).sort());
  });

  it('the plane order is preserved, so roofPlanes[0] is still the array tilt face', () => {
    expect(out.planes.map(p => p.id)).toEqual(before.map(p => p.id));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE ANCHOR — what stays put is a stated physical decision.
// ═══════════════════════════════════════════════════════════════════════════

describe('the pitch anchor', () => {
  it("'eave' holds the wall and moves the ridge", () => {
    const before = housePlanes([mainSection()]);
    const out = applyFacePitchEdit(before, 'sec-main::slopeA', 45, 'eave');
    expect(out.ok).toBe(true);
    expect(out.section!.eaveHeightM).toBeCloseTo(2.9, 9);
    expect(out.ridgeHeightM!).toBeGreaterThan(2.9 + 4.5 * Math.tan(30 * DEG));
  });

  it("'ridge' holds the roofline and re-derives the wall — exactly", () => {
    const before = housePlanes([mainSection()]);
    const ridgeElevBefore = GROUND_MAIN_M + 2.9 + 4.5 * Math.tan(30 * DEG);

    const out = applyFacePitchEdit(before, 'sec-main::slopeA', 45, 'ridge');
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);

    // The ridge is where it was...
    expect(out.section!.groundElevM + out.ridgeHeightM!).toBeCloseTo(ridgeElevBefore, 6);
    // ...and the wall came DOWN, because a steeper slope needs more rise.
    expect(out.section!.eaveHeightM).toBeLessThan(2.9);

    // And the built geometry agrees with the record, which is the whole point:
    // the number shown is the number the roof is.
    const top = extent(byId(out.planes, 'sec-main::slopeA')).hi;
    expect(top).toBeCloseTo(ridgeElevBefore, 2);
  });

  it("'ridge' refuses rather than putting the eave underground", () => {
    // A low wall under a 45° roof: the ridge sits 0.4 + 4.5 = 4.9 m above the
    // pad. Asking slope A for 60° while slope B stays at 45° needs
    // 9·tan60·tan45/(tan60+tan45) = 5.71 m of rise — 0.81 m more than there is.
    const s: BuildingSection = {
      ...mainSection(), id: 'sec-low', eaveHeightM: 0.4, pitchDeg: 45,
    };
    const planes = housePlanes([s]);
    const out = applyFacePitchEdit(planes, 'sec-low::slopeA', 60, 'ridge');
    expect(out.ok).toBe(false);
    expect(out.refusals[0].code).toBe('EAVE_HEIGHT_INVALID');
    expect(out.refusals[0].message).toMatch(/BELOW the ground/);
    // 🚨 A REFUSAL RETURNS THE INPUT UNCHANGED.
    expect(out.planes).toEqual(planes);
  });

  it('holding the ridge AND setting the wall in one edit is refused, not silently ordered', () => {
    const planes = housePlanes([mainSection()]);
    const out = applySectionEdit(planes, 'sec-main', {
      pitchDeg: 40, eaveHeightM: 4, pitchAnchor: 'ridge',
    });
    expect(out.ok).toBe(false);
    expect(out.refusals[0].message).toMatch(/two\s+different walls/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. HIPS — the end setback follows its own pitch.
// ═══════════════════════════════════════════════════════════════════════════

describe('a hip end may have its own rake', () => {
  it('a steeper hip end sets the ridge back LESS, and the ridge gets longer', () => {
    const before = housePlanes([garageSection()]);
    const ridge0 = ridgePlanCorners(garageSection(), 'slopeA');

    const out = applyFacePitchEdit(before, 'sec-garage::hipEndA', 45);
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);
    expect(byId(out.planes, 'sec-garage::hipEndA').pitch).toBeCloseTo(45, 1);
    // The main slopes are untouched.
    expect(byId(out.planes, 'sec-garage::slopeA').pitch).toBeCloseTo(25, 1);
    expect(byId(out.planes, 'sec-garage::slopeB').pitch).toBeCloseTo(25, 1);
    // And every face still reaches the same ridge height.
    const ridge1 = ridgePlanCorners(out.section!, 'slopeA');
    expect(ridge1[0].h).toBeCloseTo(ridge0[0].h, 9);
    // The setback shrank: rise/tan45 < rise/tan25, so the ridge runs further.
    const len = (pts: Array<{ lat: number; lng: number }>) =>
      Math.hypot(pts[0].lat - pts[1].lat, pts[0].lng - pts[1].lng);
    expect(len(ridge1)).toBeGreaterThan(len(ridge0));
  });

  it('all four faces of a hip can be given four different pitches and still close', () => {
    const planes = housePlanes([garageSection()]);
    const out = applySectionEdit(planes, 'sec-garage', {
      facePitchDeg: { slopeA: 35, slopeB: 20, hipEndA: 40, hipEndB: 30 },
    });
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);
    const want: Record<string, number> = {
      'sec-garage::slopeA': 35, 'sec-garage::slopeB': 20,
      'sec-garage::hipEndA': 40, 'sec-garage::hipEndB': 30,
    };
    const tops: number[] = [];
    for (const id of Object.keys(want)) {
      const p = byId(out.planes, id);
      expect(p.pitch, id).toBeCloseTo(want[id], 1);
      tops.push(extent(p).hi);
    }
    // One ridge, four faces.
    for (const t of tops) expect(t).toBeCloseTo(tops[0], 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. REFUSALS — a control that cannot move the geometry is not offered.
// ═══════════════════════════════════════════════════════════════════════════

describe('what is refused, and why', () => {
  it('a face flatter than the minimum cannot form a ridge', () => {
    const planes = housePlanes([mainSection()]);
    const out = applyFacePitchEdit(planes, 'sec-main::slopeA', 0);
    expect(out.ok).toBe(false);
    expect(out.refusals.map(r => r.code)).toContain('FACE_PITCH_TOO_FLAT');
    expect(out.planes).toEqual(planes);
  });

  it('an override for a face the section does not own is refused, not ignored', () => {
    const planes = housePlanes([mainSection()]);          // gable: no hip ends
    const out = applySectionEdit(planes, 'sec-main', { facePitchDeg: { hipEndA: 30 } });
    expect(out.ok).toBe(false);
    expect(out.refusals.map(r => r.code)).toContain('FACE_PITCH_NOT_A_FACE');
  });

  it('changing a hip to a gable DROPS the hip-end overrides rather than jamming', () => {
    const planes = housePlanes([garageSection()]);
    const mixed = applySectionEdit(planes, 'sec-garage', {
      facePitchDeg: { slopeA: 35, hipEndA: 40 },
    });
    expect(mixed.ok).toBe(true);
    // Now make it a gable. The hipEndA override names a face that is gone.
    const gabled = applySectionEdit(mixed.planes, 'sec-garage', { kind: 'gable' });
    expect(gabled.refusals).toEqual([]);
    expect(gabled.ok).toBe(true);
    expect(gabled.section!.facePitchDeg).toEqual({ slopeA: 35 });
    expect(gabled.removedFaceIds.sort())
      .toEqual(['sec-garage::hipEndA', 'sec-garage::hipEndB']);
  });

  it('🚨 typing a pitch into a FLAT section is refused, not stored and ignored', () => {
    // The audit reached this from the Block tool in three clicks. `pitchDeg: 25`
    // validated, the edit returned ok, the status bar said "every face of the
    // section moved together", the builder built the deck at 0° anyway, and the
    // panel then displayed "Roof pitch 25.0°" about a roof with no 25° in it.
    const flat: BuildingSection = {
      ...mainSection(), id: 'sec-flat', kind: 'flat', pitchDeg: 0,
    };
    const planes = housePlanes([flat]);
    const out = applySectionEdit(planes, 'sec-flat', { pitchDeg: 25 });
    expect(out.ok).toBe(false);
    expect(out.refusals[0].code).toBe('PITCH_OUT_OF_RANGE');
    expect(out.refusals[0].message).toMatch(/Shed/);
    expect(out.planes).toEqual(planes);
  });

  it('🚨 a flat section STORES 0°, whatever a caller hands in', () => {
    // Switching a 30° gable to flat leaves the old pitch on the record. That is
    // a legal edit and must not be refused — but the stored number must not
    // survive as a value the deck does not have, or the inspector displays it.
    const planes = housePlanes([mainSection()]);
    const flattened = applySectionEdit(planes, 'sec-main', { kind: 'flat' });
    expect(flattened.refusals).toEqual([]);
    expect(flattened.ok).toBe(true);
    expect(flattened.section!.pitchDeg).toBe(0);
    expect(byId(flattened.planes, 'sec-main::deck').pitch).toBe(0);
    // ...and the panel reads what the roof is.
    expect(measureSection(flattened.section!, 1).pitchDeg).toBe(0);
  });

  it('a flat section has no pitch to set, and says so', () => {
    const flat: BuildingSection = {
      ...mainSection(), id: 'sec-flat', kind: 'flat', pitchDeg: 0,
    };
    const planes = housePlanes([flat]);
    const out = applyFacePitchEdit(planes, 'sec-flat::deck', 20);
    expect(out.ok).toBe(false);
    expect(out.refusals[0].message).toMatch(/Shed/);
    // ...and the measurement tells the UI not to offer the control at all.
    const m = measureFaceVertical(byId(planes, 'sec-flat::deck'));
    expect(m.pitchScope).toBe('not-editable');
    expect(m.pitchNotEditableWhy).toMatch(/flat section has no pitch/i);
  });

  it('setting the SECTION pitch clears every per-face override', () => {
    const planes = housePlanes([mainSection()]);
    const mixed = applySectionEdit(planes, 'sec-main', { facePitchDeg: { slopeA: 45 } });
    expect(mixed.section!.facePitchDeg).toEqual({ slopeA: 45 });
    const all = applySectionEdit(mixed.planes, 'sec-main', { pitchDeg: 22.5 });
    expect(all.ok).toBe(true);
    expect(all.section!.facePitchDeg).toBeUndefined();
    expect(byId(all.planes, 'sec-main::slopeA').pitch).toBeCloseTo(22.5, 2);
    expect(byId(all.planes, 'sec-main::slopeB').pitch).toBeCloseTo(22.5, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. A SHED IS ONE FACE — so its face pitch IS its section pitch.
// ═══════════════════════════════════════════════════════════════════════════

describe('a shed deck', () => {
  const shed: BuildingSection = {
    ...mainSection(), id: 'sec-shed', kind: 'shed', pitchDeg: 12, shedAzimuthDeg: 180,
  };

  it('is written as the section pitch, not as a second copy of it', () => {
    const planes = housePlanes([shed]);
    const out = applyFacePitchEdit(planes, 'sec-shed::deck', 18);
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.scope).toBe('shed-deck');
    expect(out.section!.pitchDeg).toBeCloseTo(18, 9);
    // 🚨 NOT stored twice. An override here would be a second answer that could
    // drift from the first.
    expect(out.section!.facePitchDeg).toBeUndefined();
    expect(byId(out.planes, 'sec-shed::deck').pitch).toBeCloseTo(18, 2);
  });

  it('the measurement labels it as the shed deck', () => {
    const m = measureFaceVertical(byId(housePlanes([shed]), 'sec-shed::deck'));
    expect(m.pitchScope).toBe('shed-deck');
    expect(m.pitchNotEditableWhy).toBeNull();
  });

  it('🚨 a `deck` override is REFUSED — it would be a second copy of the section pitch', () => {
    // `pitchForFace` reads `section.pitchDeg` for a deck and never looks at the
    // override, so storing one was a value that no geometry realises: an audit
    // measured `{facePitchDeg: {deck: 40}}` on an 18° shed returning ok,
    // stamping 40 onto every face's record, signing it into the autosave and
    // reloading it forever while the roof stayed at 18°.
    const planes = housePlanes([shed]);
    const out = applySectionEdit(planes, 'sec-shed', { facePitchDeg: { deck: 40 } });
    expect(out.ok).toBe(false);
    expect(out.refusals.map(r => r.code)).toContain('FACE_PITCH_NOT_A_FACE');
    expect(out.refusals[0].message).toMatch(/single face/);
    expect(out.planes).toEqual(planes);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. A STANDALONE FACE — nothing else to keep shut.
// ═══════════════════════════════════════════════════════════════════════════

describe('a face that belongs to no section', () => {
  /** One hand-traced face, built the way the trace path builds it. */
  function lone(): RoofPlane[] {
    const planes = housePlanes([{ ...mainSection(), id: 'sec-tmp', kind: 'shed', shedAzimuthDeg: 180 }]);
    const p = planes[0];
    delete (p as any).section;
    delete (p as any).sectionId;
    delete (p as any).sectionFaceKey;
    p.id = 'hand-traced-1';
    p.orientation = 'landscape';
    p.sunshineHoursPerYear = 1234;
    return [p];
  }

  it('its pitch is editable and its low edge stays put', () => {
    const before = lone();
    const e0 = extent(before[0]);
    const out = applyFacePitchEdit(before, 'hand-traced-1', 35, 'eave');
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.scope).toBe('standalone');
    const p = byId(out.planes, 'hand-traced-1');
    expect(p.pitch).toBeCloseTo(35, 1);
    expect(extent(p).lo).toBeCloseTo(e0.lo, 2);
    expect(extent(p).hi).toBeGreaterThan(e0.hi);
  });

  it("the 'ridge' anchor holds the HIGH edge instead", () => {
    const before = lone();
    const e0 = extent(before[0]);
    const out = applyFacePitchEdit(before, 'hand-traced-1', 35, 'ridge');
    expect(out.ok).toBe(true);
    const p = byId(out.planes, 'hand-traced-1');
    expect(extent(p).hi).toBeCloseTo(e0.hi, 2);
    expect(extent(p).lo).toBeLessThan(e0.lo);
  });

  it('🚨 a re-slope is not a new face — orientation and sunshine survive', () => {
    const out = applyFacePitchEdit(lone(), 'hand-traced-1', 35);
    const p = byId(out.planes, 'hand-traced-1');
    expect(p.id).toBe('hand-traced-1');
    expect(p.orientation).toBe('landscape');
    expect(p.sunshineHoursPerYear).toBe(1234);
    // ...and it re-enters review, because the slope is now typed, not detected.
    expect(p.confirmed).toBe(false);
    // 🚨 The legacy-elevation field keeps the builder's "use origin3D" sentinel
    // rather than a stale absolute elevation. See tests/planeHeightDatum.test.ts.
    expect(p.planeHeightAtCenterMeters).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. THE RECORD ROUND-TRIPS, AND DOES NOT FALSELY CONFLICT.
// ═══════════════════════════════════════════════════════════════════════════

describe('persistence of the override map', () => {
  it('🚨 sectionRecord COPIES facePitchDeg — the field is not erased by the next edit', () => {
    const planes = housePlanes([mainSection()]);
    const withOverride = applySectionEdit(planes, 'sec-main', { facePitchDeg: { slopeA: 45 } });
    expect(withOverride.section!.facePitchDeg).toEqual({ slopeA: 45 });

    // Now edit something ELSE. If `sectionRecord` dropped the field, this would
    // silently return the roof to symmetric — the exact class of silent loss a
    // partial copier produces.
    const moved = applySectionEdit(withOverride.planes, 'sec-main', { eaveHeightM: 3.4 });
    expect(moved.ok).toBe(true);
    expect(moved.section!.facePitchDeg).toEqual({ slopeA: 45 });
    expect(byId(moved.planes, 'sec-main::slopeA').pitch).toBeCloseTo(45, 1);
  });

  it('survives a JSON save/reload of the planes', () => {
    const planes = housePlanes([mainSection()]);
    const edited = applySectionEdit(planes, 'sec-main', { facePitchDeg: { slopeA: 45 } });
    const reloaded: RoofPlane[] = JSON.parse(JSON.stringify(edited.planes));
    const look = sectionFromPlanes(reloaded, 'sec-main');
    expect(look.conflicted).toBe(false);
    expect(look.found).toBe(true);
    expect(look.section!.facePitchDeg).toEqual({ slopeA: 45 });
    expect(pitchForFace(look.section!, 'slopeA')).toBeCloseTo(45, 9);
    expect(pitchForFace(look.section!, 'slopeB')).toBeCloseTo(30, 9);
  });

  it('🚨 key ORDER does not make two copies of one section disagree', () => {
    // `sectionFromPlanes` compares records with JSON.stringify and refuses the
    // whole section on any difference. {slopeA,slopeB} and {slopeB,slopeA} are
    // the same roof; if the copier did not canonicalise the order, a section
    // would become uneditable for no physical reason.
    const a = sectionRecord({ ...mainSection(), facePitchDeg: { slopeA: 45, slopeB: 20 } });
    const b = sectionRecord({ ...mainSection(), facePitchDeg: { slopeB: 20, slopeA: 45 } } as BuildingSection);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('🚨 an EMPTY override map is the same record as none at all', () => {
    const a = sectionRecord(mainSection());
    const b = sectionRecord({ ...mainSection(), facePitchDeg: {} });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // ...and a non-finite entry is not a pitch.
    const c = sectionRecord({ ...mainSection(), facePitchDeg: { slopeA: NaN } });
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. THE PREVIEW — the user understands the coupling BEFORE applying.
// ═══════════════════════════════════════════════════════════════════════════

describe('the preview states the consequences', () => {
  it('names the ridge movement and says the partner keeps its pitch', () => {
    const planes = housePlanes();
    const pre = previewFacePitch(planes, 'sec-main::slopeA', 45, 'eave');
    expect(pre.ok).toBe(true);
    expect(pre.scope).toBe('section-face');
    expect(pre.faceKey).toBe('slopeA');
    expect(pre.pitchBeforeDeg).toBeCloseTo(30, 6);
    expect(pre.ridgeHeightAfterM!).toBeGreaterThan(pre.ridgeHeightBeforeM!);
    expect(pre.eaveHeightAfterM).toBeCloseTo(pre.eaveHeightBeforeM!, 9);
    const text = pre.consequences.join(' ');
    expect(text).toMatch(/Slope B keeps their own pitch|Slope B keep their own pitch/);
    expect(text).toMatch(/No other building section moves/);
  });

  it('🚨 the preview cannot describe an outcome the real edit would not produce', () => {
    // It is computed by applying the edit to a copy, so the two agree by
    // construction — this test is what keeps that true if someone "optimises"
    // the preview into a closed-form guess.
    const planes = housePlanes();
    const pre = previewFacePitch(planes, 'sec-main::slopeA', 38, 'eave');
    const real = applyFacePitchEdit(planes, 'sec-main::slopeA', 38, 'eave');
    expect(pre.ridgeHeightAfterM!).toBeCloseTo(real.ridgeHeightM!, 9);
    expect(pre.eaveHeightAfterM!).toBeCloseTo(real.section!.eaveHeightM, 9);
    // ...and it did NOT mutate the input.
    expect(planes.map(p => p.pitch)).toEqual(housePlanes().map(p => p.pitch));
  });

  it('a preview of a refused edit is a refusal, not a guess', () => {
    const pre = previewFacePitch(housePlanes(), 'sec-main::slopeA', 0);
    expect(pre.ok).toBe(false);
    expect(pre.refusals.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. THE MEASUREMENT THE INSPECTOR READS.
// ═══════════════════════════════════════════════════════════════════════════

describe('what the inspector is handed', () => {
  it('a section lists every face and the pitch it is actually built at', () => {
    const planes = housePlanes([mainSection()]);
    const mixed = applySectionEdit(planes, 'sec-main', { facePitchDeg: { slopeA: 45 } });
    const m = measureSection(mixed.section!, 2);
    expect(m.mixedPitch).toBe(true);
    expect(m.facePitches).toEqual([
      { key: 'slopeA', faceId: 'sec-main::slopeA', label: 'Slope A', pitchDeg: 45 },
      { key: 'slopeB', faceId: 'sec-main::slopeB', label: 'Slope B', pitchDeg: 30 },
    ]);
    // The section's own default is untouched — it is what a NEW face would get.
    expect(m.pitchDeg).toBe(30);
  });

  it('a face says it is overriding its section', () => {
    const planes = housePlanes([mainSection()]);
    const mixed = applySectionEdit(planes, 'sec-main', { facePitchDeg: { slopeA: 45 } });
    const a = measureFaceVertical(byId(mixed.planes, 'sec-main::slopeA'));
    const b = measureFaceVertical(byId(mixed.planes, 'sec-main::slopeB'));
    expect(a.pitchScope).toBe('section-face');
    expect(a.faceKey).toBe('slopeA');
    expect(a.overridesSectionPitch).toBe(true);
    expect(a.sectionPitchDeg).toBe(30);
    expect(b.overridesSectionPitch).toBe(false);
  });

  it('faceKeyOfFaceId only accepts real keys', () => {
    expect(faceKeyOfFaceId('sec-main::slopeA')).toBe('slopeA');
    expect(faceKeyOfFaceId('sec-main::kitchen')).toBeNull();
    expect(faceKeyOfFaceId('hand-traced-1')).toBeNull();
    expect(faceKeyOfFaceId(null)).toBeNull();
    expect(faceKeysForKind('gable')).toEqual(['slopeA', 'slopeB']);
    expect(faceKeysForKind('hip')).toEqual(['slopeA', 'slopeB', 'hipEndA', 'hipEndB']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. RISE OVER RUN — one authority, two ways of saying it.
// ═══════════════════════════════════════════════════════════════════════════

describe('rise over run is a rendering of degrees, never a second stored number', () => {
  it('the builder fractions are exact', () => {
    expect(degFromRise12(4)).toBeCloseTo(18.4349, 4);
    expect(degFromRise12(6)).toBeCloseTo(26.5651, 4);
    expect(degFromRise12(12)).toBeCloseTo(45, 9);
    expect(riseOver12(45)).toBeCloseTo(12, 9);
    expect(riseOver12(degFromRise12(7.5))).toBeCloseTo(7.5, 9);
  });

  it('🚨 it does NOT snap a measured slope to the nearest fraction', () => {
    expect(formatRise12(25.1)).toBe('5.6:12');
    expect(formatRise12(26.5651)).toBe('6:12');
    expect(formatRise12(null)).toBe('—');
  });

  it('a bare number is degrees, and rise:run must say so', () => {
    expect(parsePitchInput('6').pitchDeg).toBeCloseTo(6, 9);
    expect(parsePitchInput('6:12').pitchDeg).toBeCloseTo(26.5651, 4);
    expect(parsePitchInput('6/12').pitchDeg).toBeCloseTo(26.5651, 4);
    expect(parsePitchInput('6 in 12').pitchDeg).toBeCloseTo(26.5651, 4);
    expect(parsePitchInput('26.6°').pitchDeg).toBeCloseTo(26.6, 9);
    expect(parsePitchInput('6:12').as).toBe('rise-over-run');
    expect(parsePitchInput('6').as).toBe('degrees');
  });

  it('refuses what it cannot read, with advice', () => {
    for (const bad of ['', 'steep', '6:0', '-3', '75', '30:12']) {
      const p = parsePitchInput(bad);
      expect(p.ok, bad).toBe(false);
      expect(p.reason.length, bad).toBeGreaterThan(0);
    }
  });
});
