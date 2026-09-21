/**
 * tests/faceAuthorship.test.ts
 *
 * "DID A PERSON MODEL THIS FACE?" — one question, answered from the field that
 * records authorship, not from the field that records geometry.
 *
 * The two facts had been conflated:
 *
 *     source          who produced this face   'manual' | 'solar_api' | …
 *     createdFrom3D   what its geometry is     exact ECEF, vs 2D lat/lng
 *
 * Lane A builds its planes with the same `buildRoofPlane3D` the tracing tool
 * uses, so every Google-detected face carries `createdFrom3D: true`, and
 * `stampDetectedProvenance` deliberately leaves that flag alone — clearing it
 * would send every Google face down the legacy 2D placement branch, a real
 * regression on the PREFERRED provider.
 *
 * So `source === 'manual' || createdFrom3D === true` answered "a person made
 * this" for every Google detection, and the de-dup whose whole purpose is "the
 * same roof captured twice was double-filling — the manual trace wins" returned
 * `true` on its first line for the detection too, and dropped nothing.
 *
 * It worked for `aerial_nearmap` and was inert for Google. The case it was
 * inert for is exactly the fallback workflow: Google produces a roof, the person
 * judges it wrong and traces over it, and Auto Layout then fills both.
 */

import { describe, it, expect } from 'vitest';
import { isHandModelledFace, segmentToRoofPlane, stampDetectedProvenance } from '@/lib/3d/laneA';
import { dropDetectedPlanesOverlappingManual } from '@/lib/aerial/subjectBuildingCrop';
import { buildRoofPlane3D, latLngToECEF } from '@/lib/roofPlane3D';

const LAT = 38.6657, LNG = -90.2266, GROUND = 160;
const M_LAT = 111_320;

function ring(dLatM: number, dLngM: number, sizeM = 8) {
  const mLng = M_LAT * Math.cos(LAT * Math.PI / 180);
  const cLat = LAT + dLatM / M_LAT;
  const cLng = LNG + dLngM / mLng;
  const h = sizeM / 2 / M_LAT;
  const w = sizeM / 2 / mLng;
  return [
    { lat: cLat - h, lng: cLng - w },
    { lat: cLat - h, lng: cLng + w },
    { lat: cLat + h, lng: cLng + w },
    { lat: cLat + h, lng: cLng - w },
  ];
}

/** A face exactly as Lane A emits it: built by the production converter, then
 *  stamped by the production provenance stamper. Not a hand-written stand-in. */
function googleDetectedFace() {
  const plane = segmentToRoofPlane(
    { center: { lat: LAT, lng: LNG }, convexHull: ring(0, 0), pitchDegrees: 25, azimuthDegrees: 180, heightAboveGround: 5 },
    GROUND,
  );
  expect(plane, 'the production converter refused the fixture segment').not.toBeNull();
  return stampDetectedProvenance([plane!], { siteKey: 'site-1' })[0];
}

/** A face exactly as the 3D tracing tool emits it. */
function handTracedFace() {
  const mLng = M_LAT * Math.cos(LAT * Math.PI / 180);
  const h = 4 / M_LAT, w = 4 / mLng;
  return buildRoofPlane3D([
    latLngToECEF(LAT - h, LNG - w, GROUND + 5),
    latLngToECEF(LAT - h, LNG + w, GROUND + 5),
    latLngToECEF(LAT + h, LNG + w, GROUND + 6),
    latLngToECEF(LAT + h, LNG - w, GROUND + 6),
  ]);
}

describe('isHandModelledFace reads authorship, not geometry', () => {
  it('a Google-detected face really does carry createdFrom3D — that is why the old test failed', () => {
    // If this ever becomes false, the conflation stops mattering and the rest of
    // this file is testing a hazard that no longer exists. Pinned deliberately.
    const g = googleDetectedFace() as any;
    expect(g.source).toBe('solar_api');
    expect(g.confirmed).toBe(false);
    expect(g.createdFrom3D, 'Lane A builds through buildRoofPlane3D, which sets this').toBe(true);
  });

  it('calls a Google detection DETECTED, despite its exact 3D geometry', () => {
    expect(isHandModelledFace(googleDetectedFace())).toBe(false);
  });

  it('calls a hand-traced face HAND-MODELLED', () => {
    const t = handTracedFace() as any;
    expect(t.source).toBe('manual');
    expect(isHandModelledFace(t)).toBe(true);
  });

  it('calls a Nearmap detection DETECTED, as it always did', () => {
    expect(isHandModelledFace({ source: 'aerial_nearmap', createdFrom3D: false })).toBe(false);
    // …including one that somehow carries the geometry flag.
    expect(isHandModelledFace({ source: 'aerial_nearmap', createdFrom3D: true })).toBe(false);
  });

  it('adopts a pre-provenance face with exact 3D geometry as hand-modelled', () => {
    // Legacy rule, kept on purpose: before `source` existed, only a person could
    // have produced exact 3D corners. It is the fallback, not the rule.
    expect(isHandModelledFace({ createdFrom3D: true })).toBe(true);
    expect(isHandModelledFace({ createdFrom3D: false })).toBe(false);
    expect(isHandModelledFace({})).toBe(false);
    expect(isHandModelledFace(null)).toBe(false);
    expect(isHandModelledFace(undefined)).toBe(false);
  });

  it("treats an 'imported' face as somebody's work, not a machine's guess", () => {
    expect(isHandModelledFace({ source: 'imported' })).toBe(true);
  });
});

describe('the de-dup that could not fire', () => {
  const getRing = (p: any) => (p.vertices ?? []) as Array<{ lat: number; lng: number }>;

  it('DROPS a Google detection that overlaps a hand trace — it used to keep both', () => {
    const detected = googleDetectedFace();
    const traced = handTracedFace();
    // The fixture must actually overlap, or this proves nothing.
    expect(getRing(detected).length).toBeGreaterThanOrEqual(3);
    expect(getRing(traced).length).toBeGreaterThanOrEqual(3);

    const after = dropDetectedPlanesOverlappingManual([detected, traced], getRing, isHandModelledFace);
    expect(after.dropped, 'the overlapping Google detection survived').toBe(1);
    expect(after.kept.map((p: any) => p.id)).toEqual([(traced as any).id]);

    // And the OLD predicate, kept here verbatim, still cannot do it. This is the
    // mutation proof, written into the suite rather than run once by hand.
    const oldPredicate = (p: any) => p.source === 'manual' || p.createdFrom3D === true;
    const before = dropDetectedPlanesOverlappingManual([googleDetectedFace(), handTracedFace()], getRing, oldPredicate);
    expect(before.dropped, 'the old predicate is supposed to be the defect').toBe(0);
  });

  it('still drops an overlapping Nearmap detection — the case that always worked', () => {
    const traced = handTracedFace();
    const nearmap = { id: 'nm', source: 'aerial_nearmap', vertices: getRing(traced) };
    const after = dropDetectedPlanesOverlappingManual([nearmap, traced], getRing, isHandModelledFace);
    expect(after.dropped).toBe(1);
    expect(after.kept.map((p: any) => p.id)).toEqual([(traced as any).id]);
  });

  it('PROTECTED PATH: a Google-only design is untouched — nothing to win against', () => {
    // The preferred provider on its own must behave exactly as before. With no
    // hand-modelled face present the function short-circuits and drops nothing,
    // so Auto Layout on a purely Google-detected roof is unchanged.
    const a = googleDetectedFace();
    const b = googleDetectedFace();
    const after = dropDetectedPlanesOverlappingManual([a, b], getRing, isHandModelledFace);
    expect(after.dropped).toBe(0);
    expect(after.kept.length).toBe(2);
  });

  it('PROTECTED PATH: two hand-modelled faces are both kept', () => {
    const a = handTracedFace();
    const b = handTracedFace();
    const after = dropDetectedPlanesOverlappingManual([a, b], getRing, isHandModelledFace);
    expect(after.dropped).toBe(0);
  });

  it('a Google detection that does NOT overlap the trace is kept', () => {
    const traced = handTracedFace();
    const far = { id: 'far', source: 'solar_api', createdFrom3D: true, vertices: ring(200, 200) };
    const after = dropDetectedPlanesOverlappingManual([far, traced], getRing, isHandModelledFace);
    expect(after.dropped).toBe(0);
    expect(after.kept.length).toBe(2);
  });
});
