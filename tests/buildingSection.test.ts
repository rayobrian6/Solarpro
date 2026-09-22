// ═══════════════════════════════════════════════════════════════════════════
// THE BUILDING SECTION — behavioural tests.
//
// These assert PROPERTIES OF THE GEOMETRY, not the shape of the code. Every
// number below was chosen so that the previous behaviour FAILS it:
//
//   - the rotated-house cases fail against the axis-aligned bounding box the
//     gable/hip tools used, which could only model a building square to north;
//   - the shared-ridge cases fail against faces built independently, which
//     reach different ridge heights and cannot close;
//   - the stable-id cases fail against `buildRoofPlane3D`'s freshly minted id,
//     which would orphan every panel standing on a face whenever the installer
//     nudged the eave height.
//
// See tests/buildingSectionMutation.test.ts for the explicit old-vs-new proof.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import {
  buildSectionRoofPlanes,
  expectedFaceCount,
  layoutSectionFaces,
  sectionFaceId,
  sectionIdOfFaceId,
  sectionRidgeHeightM,
  validateSection,
  type BuildingSection,
  type LatLng,
  type SectionRoofKind,
} from '@/lib/3d/buildingSection';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

const C_LAT = 38.7;
const C_LNG = -89.9;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos(C_LAT * DEG);

/**
 * A rectangle of `lengthM` x `widthM` centred on (C_LAT, C_LNG), whose LONG
 * axis runs along the compass bearing `bearingDeg`.
 *
 * Ring order is [ +L/2 +W/2, +L/2 -W/2, -L/2 -W/2, -L/2 +W/2 ], so the long
 * edges are p1->p2 and p3->p0 and the ridge must come out along the long axis.
 */
function rotatedRect(lengthM: number, widthM: number, bearingDeg: number): LatLng[] {
  const t = bearingDeg * DEG;
  // Long axis unit vector in (east, north); bearing 0 = north, clockwise.
  const uE = Math.sin(t), uN = Math.cos(t);
  // Perpendicular (width) axis.
  const vE = Math.cos(t), vN = -Math.sin(t);
  const half = (a: number, b: number) => ({ e: a, n: b });
  const corners = [
    half(+lengthM / 2 * uE + widthM / 2 * vE, +lengthM / 2 * uN + widthM / 2 * vN),
    half(+lengthM / 2 * uE - widthM / 2 * vE, +lengthM / 2 * uN - widthM / 2 * vN),
    half(-lengthM / 2 * uE - widthM / 2 * vE, -lengthM / 2 * uN - widthM / 2 * vN),
    half(-lengthM / 2 * uE + widthM / 2 * vE, -lengthM / 2 * uN + widthM / 2 * vN),
  ];
  return corners.map(c => ({
    lat: C_LAT + c.n / M_PER_DEG_LAT,
    lng: C_LNG + c.e / M_PER_DEG_LNG,
  }));
}

function section(over: Partial<BuildingSection> = {}): BuildingSection {
  return {
    id: 'sec-1',
    kind: 'gable',
    footprint: rotatedRect(12, 8, 0),
    eaveHeightM: 3,
    pitchDeg: 30,
    groundElevM: 140,
    ...over,
  };
}

/** Separation between two bearings, in degrees, taking the short way round. */
function bearingGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function metresApart(a: LatLng, b: LatLng): number {
  return Math.hypot(
    (a.lng - b.lng) * M_PER_DEG_LNG,
    (a.lat - b.lat) * M_PER_DEG_LAT,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('a section is not a roof face', () => {
  it.each<[SectionRoofKind, number]>([
    ['gable', 2], ['hip', 4], ['shed', 1], ['flat', 1],
  ])('a %s section owns %i face(s)', (kind, n) => {
    expect(expectedFaceCount(kind)).toBe(n);
    const out = buildSectionRoofPlanes(section({ kind }));
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.planes).toHaveLength(n);
  });

  it('the faces of one section all name that section', () => {
    const out = buildSectionRoofPlanes(section({ kind: 'hip' }));
    for (const p of out.planes) {
      expect((p as any).sectionId).toBe('sec-1');
      expect(sectionIdOfFaceId(p.id)).toBe('sec-1');
    }
    // Four DISTINCT faces, not the same face four times.
    expect(new Set(out.planes.map(p => p.id)).size).toBe(4);
  });

  it('a hand-traced face belongs to no section, which stays legal', () => {
    expect(sectionIdOfFaceId('plane-8f3a9c')).toBeNull();
    expect(sectionIdOfFaceId(null)).toBeNull();
    expect(sectionIdOfFaceId('')).toBeNull();
  });
});

describe('🚨 a house that is not square to north', () => {
  // The gable/hip tools normalised their two clicks to an axis-aligned bounding
  // box (gableEaveCornersFromSpec → min/max lat/lng), so the ridge could ONLY
  // run north-south or east-west. Most houses are not square to north; for them
  // the old tool produced a roof that was not the roof.
  it.each([0, 17, 30, 45, 63, 88, 115, 152])(
    'a gable on a house rotated %i° has its ridge along the rotated long axis',
    (bearing) => {
      const out = buildSectionRoofPlanes(section({ footprint: rotatedRect(14, 9, bearing) }));
      expect(out.refusals).toEqual([]);
      expect(out.planes).toHaveLength(2);

      // Downslope runs perpendicular to the ridge. Ridge along `bearing` means
      // the two faces fall toward `bearing ± 90`.
      const azes = out.planes.map(p => p.azimuth).sort((x, y) => x - y);
      const want = [bearing + 90, bearing + 270].map(a => ((a % 360) + 360) % 360)
        .sort((x, y) => x - y);
      expect(bearingGap(azes[0], want[0])).toBeLessThan(1.0);
      expect(bearingGap(azes[1], want[1])).toBeLessThan(1.0);

      // And the two slopes oppose each other — a gable, not two lean-tos.
      expect(bearingGap(azes[0], azes[1])).toBeGreaterThan(179);
    },
  );

  it('the ridge runs along the LONG axis, not the north-south one', () => {
    // 14 m long axis at 90° (due east-west) on a 9 m width. An axis-aligned
    // bbox happens to agree here, so pick a bearing where it cannot: 30°.
    const out = buildSectionRoofPlanes(section({ footprint: rotatedRect(14, 9, 30) }));
    const azes = out.planes.map(p => p.azimuth);
    // A bbox-derived ridge would be N-S or E-W, giving azimuths near
    // {90,270} or {0,180}. Ours must be near {120,300}.
    for (const az of azes) {
      expect(Math.min(bearingGap(az, 0), bearingGap(az, 90),
                      bearingGap(az, 180), bearingGap(az, 270))).toBeGreaterThan(20);
    }
  });

  it('ridgeAxis: "short" turns the ridge across the mass — the cross-gable wing', () => {
    const fp = rotatedRect(14, 9, 30);
    const along = buildSectionRoofPlanes(section({ footprint: fp, ridgeAxis: 'long' }));
    const across = buildSectionRoofPlanes(section({ footprint: fp, ridgeAxis: 'short' }));
    expect(across.refusals).toEqual([]);
    // Ridge rotated 90° means downslope rotated 90° too.
    expect(bearingGap(along.planes[0].azimuth, across.planes[0].azimuth)).toBeGreaterThan(80);
    // And the wing is STEEPER-spanning: its ridge sits lower, because the span
    // it crosses (the 9 m width became the 14 m length) is... longer. Higher.
    expect(sectionRidgeHeightM(section({ footprint: fp, ridgeAxis: 'short' })))
      .toBeGreaterThan(sectionRidgeHeightM(section({ footprint: fp, ridgeAxis: 'long' }))!);
  });
});

describe('🚨 one ridge at one height', () => {
  it('both gable slopes share the ridge corners exactly', () => {
    const laid = layoutSectionFaces(section({ footprint: rotatedRect(12, 8, 37) }));
    const [a, b] = laid.faces;
    // slopeA ends [..., rB, rA]; slopeB ends [..., rA, rB].
    const ridgeOfA = [a.outline[2], a.outline[3]];
    const ridgeOfB = [b.outline[3], b.outline[2]];
    expect(metresApart(ridgeOfA[0], ridgeOfB[0])).toBeLessThan(1e-6);
    expect(metresApart(ridgeOfA[1], ridgeOfB[1])).toBeLessThan(1e-6);
    // …at the same height, on both faces.
    expect(a.heightsM[2]).toBeCloseTo(b.heightsM[2], 9);
    expect(a.heightsM[3]).toBeCloseTo(b.heightsM[3], 9);
  });

  it('a hip closes: all four faces reach the same ridge height', () => {
    const laid = layoutSectionFaces(section({ kind: 'hip', footprint: rotatedRect(16, 9, 22) }));
    expect(laid.faces).toHaveLength(4);
    const ridgeH = laid.ridgeHeightM!;
    for (const f of laid.faces) {
      const top = Math.max(...f.heightsM);
      expect(top).toBeCloseTo(ridgeH, 9);
      // …and every face starts at the eave.
      expect(Math.min(...f.heightsM)).toBeCloseTo(3, 9);
    }
  });

  it('a hip end slopes at the same pitch as the main faces', () => {
    // This is what the half-span setback is FOR. Get the setback wrong and the
    // hip end is steeper or shallower than the roof it belongs to.
    const out = buildSectionRoofPlanes(section({ kind: 'hip', footprint: rotatedRect(16, 9, 22) }));
    const pitches = out.planes.map(p => p.pitch);
    for (const p of pitches) expect(p).toBeCloseTo(30, 0);
  });

  it('ridge height follows the pitch and the span, not a constant', () => {
    // 8 m wide ⇒ half-span 4 m ⇒ rise = 4·tan(pitch).
    expect(sectionRidgeHeightM(section({ pitchDeg: 0 }))!).toBeCloseTo(3, 6);
    expect(sectionRidgeHeightM(section({ pitchDeg: 30 }))!).toBeCloseTo(3 + 4 * Math.tan(30 * DEG), 4);
    expect(sectionRidgeHeightM(section({ pitchDeg: 45 }))!).toBeCloseTo(7, 4);
    // A wider house at the same pitch has a higher ridge.
    expect(sectionRidgeHeightM(section({ footprint: rotatedRect(12, 16, 0) }))!)
      .toBeGreaterThan(sectionRidgeHeightM(section({ footprint: rotatedRect(12, 8, 0) }))!);
  });
});

describe('🚨 area is SLOPE area — a roof is bigger than its footprint', () => {
  it('a 12x8 gable at 30° reports footprint/cos(30), not footprint', () => {
    const out = buildSectionRoofPlanes(section({ footprint: rotatedRect(12, 8, 0), pitchDeg: 30 }));
    const total = out.planes.reduce((s, p) => s + p.area, 0);
    const plan = 12 * 8;
    expect(total).toBeGreaterThan(plan * 1.10);
    expect(total).toBeCloseTo(plan / Math.cos(30 * DEG), 0);
  });

  it('a flat deck reports its footprint, because it has no slope', () => {
    const out = buildSectionRoofPlanes(section({ kind: 'flat' }));
    expect(out.planes[0].area).toBeCloseTo(96, 0);
    expect(out.planes[0].pitch).toBe(0);
  });
});

describe('🚨 face ids are stable, so an edit does not orphan the panels', () => {
  const ids = (s: BuildingSection) => buildSectionRoofPlanes(s).planes.map(p => p.id).sort();

  it('changing the pitch keeps every face id', () => {
    expect(ids(section({ pitchDeg: 22 }))).toEqual(ids(section({ pitchDeg: 41 })));
  });
  it('changing the eave height keeps every face id', () => {
    expect(ids(section({ eaveHeightM: 2.4 }))).toEqual(ids(section({ eaveHeightM: 4.1 })));
  });
  it('moving the footprint keeps every face id', () => {
    expect(ids(section({ footprint: rotatedRect(12, 8, 0) })))
      .toEqual(ids(section({ footprint: rotatedRect(15, 10, 44) })));
  });
  it('a different section gets different ids', () => {
    expect(ids(section({ id: 'sec-1' }))).not.toEqual(ids(section({ id: 'sec-2' })));
  });
  it('the id is the SECTION face id, never the plane fitter’s fresh one', () => {
    const out = buildSectionRoofPlanes(section({ kind: 'hip' }));
    for (const key of ['slopeA', 'slopeB', 'hipEndA', 'hipEndB'] as const) {
      expect(out.planes.map(p => p.id)).toContain(sectionFaceId('sec-1', key));
    }
  });
});

describe('🚨 it refuses rather than approximating', () => {
  it('a gable over six corners is refused — an L is TWO sections', () => {
    const L: LatLng[] = [
      { lat: C_LAT, lng: C_LNG },
      { lat: C_LAT, lng: C_LNG + 14 / M_PER_DEG_LNG },
      { lat: C_LAT + 6 / M_PER_DEG_LAT, lng: C_LNG + 14 / M_PER_DEG_LNG },
      { lat: C_LAT + 6 / M_PER_DEG_LAT, lng: C_LNG + 6 / M_PER_DEG_LNG },
      { lat: C_LAT + 13 / M_PER_DEG_LAT, lng: C_LNG + 6 / M_PER_DEG_LNG },
      { lat: C_LAT + 13 / M_PER_DEG_LAT, lng: C_LNG },
    ];
    const out = buildSectionRoofPlanes(section({ kind: 'gable', footprint: L }));
    expect(out.ok).toBe(false);
    expect(out.planes).toEqual([]);
    expect(out.refusals.map(r => r.code)).toContain('RIDGED_ROOF_NEEDS_FOUR_CORNERS');
    // The refusal must TELL the installer what to do instead.
    expect(out.refusals[0].message).toMatch(/separate sections/i);
  });

  it('but a FLAT or SHED roof over six corners is fine — no ridge to define', () => {
    const L: LatLng[] = [
      { lat: C_LAT, lng: C_LNG },
      { lat: C_LAT, lng: C_LNG + 14 / M_PER_DEG_LNG },
      { lat: C_LAT + 6 / M_PER_DEG_LAT, lng: C_LNG + 14 / M_PER_DEG_LNG },
      { lat: C_LAT + 6 / M_PER_DEG_LAT, lng: C_LNG + 6 / M_PER_DEG_LNG },
      { lat: C_LAT + 13 / M_PER_DEG_LAT, lng: C_LNG + 6 / M_PER_DEG_LNG },
      { lat: C_LAT + 13 / M_PER_DEG_LAT, lng: C_LNG },
    ];
    for (const kind of ['flat', 'shed'] as const) {
      const out = buildSectionRoofPlanes(section({ kind, footprint: L }));
      expect(out.refusals, kind).toEqual([]);
      expect(out.planes, kind).toHaveLength(1);
    }
  });

  it('reports EVERY problem at once, not the first', () => {
    const bad = validateSection(section({
      id: '   ', kind: 'gable', pitchDeg: 95, eaveHeightM: -2,
      footprint: [
        { lat: C_LAT, lng: C_LNG },
        { lat: C_LAT + 9 / M_PER_DEG_LAT, lng: C_LNG },
        { lat: C_LAT + 9 / M_PER_DEG_LAT, lng: C_LNG + 9 / M_PER_DEG_LNG },
      ],
    }));
    const codes = bad.map(r => r.code);
    expect(codes).toContain('SECTION_ID_REQUIRED');
    expect(codes).toContain('RIDGED_ROOF_NEEDS_FOUR_CORNERS');
    expect(codes).toContain('PITCH_OUT_OF_RANGE');
    expect(codes).toContain('EAVE_HEIGHT_INVALID');
  });

  it('a footprint under half a metre is a mis-click, not a roof', () => {
    const tiny = rotatedRect(0.3, 0.2, 0);
    const out = buildSectionRoofPlanes(section({ footprint: tiny }));
    expect(out.ok).toBe(false);
    expect(out.refusals.map(r => r.code)).toContain('FOOTPRINT_DEGENERATE');
  });

  it('unresolved ground elevation is refused, never silently treated as zero', () => {
    // 🚨 THE WHOLE POINT. `?? 0` here would put the house 140 m underground and
    // the design would look plausible the whole way to a permit.
    const out = buildSectionRoofPlanes(section({ groundElevM: NaN }));
    expect(out.ok).toBe(false);
    expect(out.refusals.map(r => r.code)).toContain('GROUND_ELEV_INVALID');
  });
});

describe('🚨 a hip on a square footprint is a pyramid, not an inside-out roof', () => {
  it('the ridge collapses to a point and all four faces are triangles', () => {
    const laid = layoutSectionFaces(section({ kind: 'hip', footprint: rotatedRect(10, 10, 15) }));
    expect(laid.faces).toHaveLength(4);
    for (const f of laid.faces) expect(f.outline).toHaveLength(3);
    // Every face reaches the one apex, at the one height.
    const apexes = laid.faces.map(f => f.outline[2]);
    for (const a of apexes) expect(metresApart(a, apexes[0])).toBeLessThan(1e-6);
  });

  it('and it still builds four real planes', () => {
    const out = buildSectionRoofPlanes(section({ kind: 'hip', footprint: rotatedRect(10, 10, 15) }));
    expect(out.refusals).toEqual([]);
    expect(out.planes).toHaveLength(4);
    // Four faces of a pyramid face four different ways, 90° apart.
    const azes = out.planes.map(p => p.azimuth).sort((a, b) => a - b);
    for (let i = 1; i < 4; i++) expect(bearingGap(azes[i], azes[i - 1])).toBeGreaterThan(80);
  });

  it('a nearly-square hip does not let the ridge run backwards', () => {
    // 🚨 THE BOUNDARY IS WHERE THE TWO SETBACKS MEET, and it used to be tested
    // with an exact float comparison on two independently accumulated sums. On
    // a literal 10x10 that lands on the wrong side about half the time, leaving
    // a sub-micron "ridge": both slopes came out as QUADS with two coincident
    // corners and the hip ends were slivers. Sweep across the boundary.
    for (const len of [9.0, 9.9, 10.0, 10.1, 10.4, 11.0, 14.0]) {
      const out = buildSectionRoofPlanes(section({ kind: 'hip', footprint: rotatedRect(len, 10, 15) }));
      expect(out.refusals, `len=${len}`).toEqual([]);
      expect(out.planes, `len=${len}`).toHaveLength(4);
      // An inverted ridge shows up as a face whose pitch exceeds the request.
      for (const p of out.planes) expect(p.pitch, `len=${len}`).toBeLessThanOrEqual(31);
      // And no face may carry a repeated corner — that is the sliver signature.
      const laid = layoutSectionFaces(section({ kind: 'hip', footprint: rotatedRect(len, 10, 15) }));
      for (const f of laid.faces) {
        for (let i = 0; i < f.outline.length; i++) {
          for (let j = i + 1; j < f.outline.length; j++) {
            expect(metresApart(f.outline[i], f.outline[j]),
              `len=${len} ${f.key} corners ${i}/${j}`).toBeGreaterThan(0.01);
          }
        }
      }
    }
  });
});

describe('provenance', () => {
  it('a traced section is manual and UNCONFIRMED — a typed pitch is an estimate', () => {
    const out = buildSectionRoofPlanes(section());
    for (const p of out.planes) {
      expect(p.source).toBe('manual');
      expect(p.confirmed).toBe(false);
    }
  });

  it('the site key reaches every face, so the house moves with the property', () => {
    const out = buildSectionRoofPlanes(section({ kind: 'hip', siteKey: 'site-abc' }));
    for (const p of out.planes) expect(p.siteKey).toBe('site-abc');
  });

  it('no site key means none is invented', () => {
    const out = buildSectionRoofPlanes(section());
    for (const p of out.planes) expect(p.siteKey).toBeUndefined();
  });

  it('the fitted pitch is reported alongside the requested one', () => {
    const out = buildSectionRoofPlanes(section({ pitchDeg: 30 }));
    for (const p of out.planes) {
      expect(out.fittedPitchByFaceId[p.id]).toBeCloseTo(p.pitch, 9);
      expect(out.fittedPitchByFaceId[p.id]).toBeCloseTo(30, 0);
    }
  });
});

describe('the fallback premise: this works with NO 3D coverage', () => {
  it('nothing in the input carries an elevation except the stated ground level', () => {
    // The footprint type has lat/lng only — there is nowhere to put a picked
    // height, which is what makes this usable where Google 3D has none.
    const s = section();
    for (const v of s.footprint) {
      expect(Object.keys(v).sort()).toEqual(['lat', 'lng']);
    }
    expect(buildSectionRoofPlanes(s).ok).toBe(true);
  });

  it('the house sits ON the stated ground, not at the ellipsoid', () => {
    const low = buildSectionRoofPlanes(section({ groundElevM: 0 }));
    const high = buildSectionRoofPlanes(section({ groundElevM: 140 }));
    const zOf = (o: typeof low) => Math.hypot(
      o.planes[0].polygon3D![0].x, o.planes[0].polygon3D![0].y, o.planes[0].polygon3D![0].z,
    );
    // 140 m of ground shows up as 140 m more ECEF radius, within a metre.
    expect(zOf(high) - zOf(low)).toBeCloseTo(140, 0);
  });
});
