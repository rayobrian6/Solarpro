/**
 * tests/squareUpPreservesPitch.test.ts
 *
 * SQUARE UP IS A PLAN-VIEW TOOL. IT MUST NOT CHANGE A PITCH.
 *
 * Square Up exists because "buildings are rectilinear; a trace of one is not,
 * because the clicks are eyeballed on blurry imagery". That is a statement about
 * the OUTLINE. The slope is not what the user got wrong, and the tool has no
 * business touching it.
 *
 * It did. `squareUpTracedFaces` rebuilt every corner at the MEAN of the corner
 * heights — a horizontal ring — so every face it touched came back flat, and the
 * flattened pitch and azimuth were pushed into `updates` and persisted. The
 * comment directly above the code said "at the heights it already had".
 *
 * 🚨 WHY 0.19° IS WORSE THAN 0°. Fitting a ring of constant geodetic height does
 * not measure as exactly flat: the engine measures tilt against the GEOCENTRIC
 * radial while the ring sits at constant GEODETIC height, and the angle between
 * those two is the deflection of the vertical — about 0.19° at this latitude,
 * peaking near 45°. A clean 0 would have been caught by the `t > 0` filter in
 * lib/pvwatts.ts and the `pitch > 0` gate in applyToSystemDefinition. 0.19 slips
 * past both, so a flattened roof was silently treated as a real, almost-flat one.
 *
 * These tests exercise `projectOutlineOntoPlane`, which is the fix, and they also
 * reproduce the OLD behaviour directly so the defect is asserted rather than
 * merely described.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRoofPlane3D, projectOutlineOntoPlane, latLngToECEF, ecefToLatLng,
} from '@/lib/roofPlane3D';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

// 3 Melvin Drive — the property from the live trace.
const LAT = 38.70615;
const LNG = -90.04625;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

const GROUND = 150;
const EAVE_H = GROUND + 5;
const WIDTH_M = 12;   // along the eave
const DEPTH_M = 8;    // up the slope

/** A pitched rectangular face: eave to the south, ridge to the north. */
function pitchedFace(tiltDeg: number) {
  const dLng = WIDTH_M / 2 / mPerDegLng;
  const dLat = DEPTH_M / 2 / M_PER_DEG_LAT;
  const ridgeH = EAVE_H + DEPTH_M * Math.tan(tiltDeg * DEG);
  return [
    latLngToECEF(LAT - dLat, LNG - dLng, EAVE_H),
    latLngToECEF(LAT - dLat, LNG + dLng, EAVE_H),
    latLngToECEF(LAT + dLat, LNG + dLng, ridgeH),
    latLngToECEF(LAT + dLat, LNG - dLng, ridgeH),
  ];
}

/**
 * What a "squared" outline looks like: the same face in plan view with each
 * corner nudged a few centimetres, which is what regularizeOutline produces from
 * an eyeballed trace. Plan view only — no heights.
 */
function squaredOutline(plane: { vertices: Array<{ lat: number; lng: number }> }) {
  const jiggle = [
    { dLat: +0.0000020, dLng: -0.0000015 },
    { dLat: -0.0000010, dLng: +0.0000025 },
    { dLat: +0.0000018, dLng: +0.0000012 },
    { dLat: -0.0000022, dLng: -0.0000008 },
  ];
  return plane.vertices.map((v, i) => ({
    lat: v.lat + jiggle[i % jiggle.length].dLat,
    lng: v.lng + jiggle[i % jiggle.length].dLng,
  }));
}

/** THE OLD BEHAVIOUR, reproduced verbatim: every corner at the mean height. */
function rebuildAtMeanHeight(
  corners: Array<{ x: number; y: number; z: number }>,
  outline: Array<{ lat: number; lng: number }>,
) {
  const old = corners.map(c => ecefToLatLng(c));
  const meanH = old.reduce((acc, g) => acc + g.height, 0) / old.length;
  return outline.map(v => latLngToECEF(v.lat, v.lng, meanH));
}

describe('Square Up regularises the outline and leaves the plane alone', () => {
  for (const tilt of [15, 25, 30, 45]) {
    it(`POSITIVE — a ${tilt}° face keeps its pitch and azimuth`, () => {
      const before = buildRoofPlane3D(pitchedFace(tilt));
      const outline = squaredOutline(before);

      const pts = projectOutlineOntoPlane(outline, before.origin3D!, before.normal3D!);
      expect(pts, 'a pitched plane is never vertical, so projection must succeed').not.toBeNull();

      const after = buildRoofPlane3D(pts!, { surfaceOffsetM: 0 });

      expect(Math.abs(after.pitch - before.pitch)).toBeLessThan(0.01);
      expect(Math.abs(after.azimuth - before.azimuth)).toBeLessThan(0.05);
    });
  }

  it('POSITIVE — the outline really is squared: plan positions come from the ring', () => {
    const before = buildRoofPlane3D(pitchedFace(30));
    const outline = squaredOutline(before);
    const after = buildRoofPlane3D(
      projectOutlineOntoPlane(outline, before.origin3D!, before.normal3D!)!,
      { surfaceOffsetM: 0 },
    );
    // The whole point of the tool: the corners MOVED in plan.
    for (let i = 0; i < outline.length; i++) {
      expect(Math.abs(after.vertices[i].lat - outline[i].lat)).toBeLessThan(1e-9);
      expect(Math.abs(after.vertices[i].lng - outline[i].lng)).toBeLessThan(1e-9);
    }
  });

  it('POSITIVE — projecting an outline that is already on the plane is a no-op', () => {
    const before = buildRoofPlane3D(pitchedFace(30));
    const pts = projectOutlineOntoPlane(before.vertices, before.origin3D!, before.normal3D!);
    expect(pts).not.toBeNull();
    const n = before.normal3D!;
    const o = before.origin3D!;
    for (const p of pts!) {
      const d = (p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z;
      expect(Math.abs(d)).toBeLessThan(1e-6);
    }
  });

  // ── THE DEFECT, ASSERTED ────────────────────────────────────────────────────
  it('🚨 ADVERSARIAL — the OLD mean-height rebuild really did flatten the face', () => {
    const before = buildRoofPlane3D(pitchedFace(25));
    expect(before.pitch).toBeGreaterThan(24); // the fixture is genuinely pitched

    const outline = squaredOutline(before);
    const flattened = buildRoofPlane3D(
      rebuildAtMeanHeight(before.polygon3D!, outline),
      { surfaceOffsetM: 0 },
    );

    // 25° becomes essentially flat …
    expect(flattened.pitch).toBeLessThan(0.5);
    // … and the azimuth is not approximated, it is destroyed: below the 0.5°
    // guard the engine hard-codes 180.
    expect(flattened.azimuth).toBe(180);
    // The damage, as one number.
    expect(before.pitch - flattened.pitch).toBeGreaterThan(24);
  });

  it('🚨 ADVERSARIAL — the flattened pitch is NOT zero, which is why nothing caught it', () => {
    const before = buildRoofPlane3D(pitchedFace(25));
    const flattened = buildRoofPlane3D(
      rebuildAtMeanHeight(before.polygon3D!, squaredOutline(before)),
      { surfaceOffsetM: 0 },
    );
    // Strictly positive: it passes every `pitch > 0` / `t > 0` guard downstream
    // that would have rejected a clean zero and flagged the face as flat.
    expect(flattened.pitch).toBeGreaterThan(0);
    // And it is the deflection of the vertical, not noise — about 0.19° here.
    expect(flattened.pitch).toBeGreaterThan(0.1);
    expect(flattened.pitch).toBeLessThan(0.3);
  });

  it('🚨 the fix and the defect disagree by the whole pitch — the assertion is load-bearing', () => {
    const before = buildRoofPlane3D(pitchedFace(30));
    const outline = squaredOutline(before);

    const fixed = buildRoofPlane3D(
      projectOutlineOntoPlane(outline, before.origin3D!, before.normal3D!)!,
      { surfaceOffsetM: 0 },
    );
    const broken = buildRoofPlane3D(
      rebuildAtMeanHeight(before.polygon3D!, outline),
      { surfaceOffsetM: 0 },
    );

    expect(fixed.pitch - broken.pitch).toBeGreaterThan(29);
  });

  // ── DEGENERATE INPUT ────────────────────────────────────────────────────────
  it('declines a vertical plane rather than inventing a height', () => {
    const before = buildRoofPlane3D(pitchedFace(30));
    // A normal lying in the local horizontal plane describes a vertical wall. A
    // vertical line never meets it, so there is no height to solve for.
    const c = latLngToECEF(LAT, LNG, 0);
    const up = latLngToECEF(LAT, LNG, 1);
    const u = { x: up.x - c.x, y: up.y - c.y, z: up.z - c.z };
    // Any vector perpendicular to up, via a cross product with an arbitrary axis.
    const horiz = { x: u.y * 1 - u.z * 0, y: u.z * 0 - u.x * 1, z: u.x * 0 - u.y * 0 };
    const len = Math.hypot(horiz.x, horiz.y, horiz.z);
    const vertical = { x: horiz.x / len, y: horiz.y / len, z: horiz.z / len };

    expect(projectOutlineOntoPlane(before.vertices, before.origin3D!, vertical)).toBeNull();
  });

  it('declines an outline with fewer than three corners, or non-finite coordinates', () => {
    const before = buildRoofPlane3D(pitchedFace(30));
    expect(projectOutlineOntoPlane(before.vertices.slice(0, 2), before.origin3D!, before.normal3D!)).toBeNull();
    expect(projectOutlineOntoPlane(
      [{ lat: NaN, lng: LNG }, { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG }],
      before.origin3D!, before.normal3D!,
    )).toBeNull();
  });

  // ── THE OTHER HALF OF THE SQUARE UP DEFECT ──────────────────────────────────
  it('🚨 buildRoofPlane3D can now be asked NOT to lift — its absence was the bug', () => {
    const pts = pitchedFace(30);
    const lifted = buildRoofPlane3D(pts);                          // default
    const unlifted = buildRoofPlane3D(pts, { surfaceOffsetM: 0 }); // opted out

    const n = unlifted.normal3D!;
    const d =
      (lifted.origin3D!.x - unlifted.origin3D!.x) * n.x +
      (lifted.origin3D!.y - unlifted.origin3D!.y) * n.y +
      (lifted.origin3D!.z - unlifted.origin3D!.z) * n.z;

    // Exactly one SURFACE_OFFSET_M apart. Square Up drew the deck from a frame
    // built with 0 and stored a plane built with the default, so the deck and
    // the placement geometry sat exactly this far apart on every press.
    expect(Math.abs(d - 0.12)).toBeLessThan(1e-6);
    // The lift is a rigid translation: it must not disturb the shape.
    expect(Math.abs(lifted.pitch - unlifted.pitch)).toBeLessThan(1e-6);
    expect(Math.abs(lifted.area - unlifted.area)).toBeLessThan(1e-6);
  });
});
