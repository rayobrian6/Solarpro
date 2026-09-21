/**
 * tests/faceHitTest.test.ts
 *
 * SolarPro 3D could DRAW individual roof faces and could not SELECT them. These
 * tests are written against the thing that was actually broken: the resolution
 * from a click to a CANONICAL roof-face id.
 *
 * Every fixture here is built through the REAL production resolver
 * (`resolvePlaneGeometry`), from the two shapes the two geometry providers
 * produce:
 *
 *   • a face with its own `origin3D` + `ecefFrame3D` + `polygon3D` — what the
 *     3D point-picking tool and Lane A both emit;
 *   • a face with only lat/lng vertices, pitch and azimuth — what the 2D
 *     "Tag This Roof Plane" path emits, which resolves through the legacy
 *     branch.
 *
 * Both are hit-tested by the same code with no branch on provenance. That is
 * the "selectable roof face" contract: providers differ, the interaction does
 * not.
 *
 * The adversarial cases are the ones that actually decide whether a selection
 * system is usable — ridges, overlaps, empty space, rebuilds, deletion,
 * A -> B -> A, and camera motion.
 */

import { describe, it, expect } from 'vitest';
import { pickFace, pickFaces, pointInPolygon3D, newellNormal, selectableFacesFrom, type SelectableFace, type Vec3 } from '@/lib/3d/faceHitTest';
import { resolvePlaneGeometry } from '@/lib/surfaceGeometry3D';
import { latLngToECEF } from '@/lib/roofPlane3D';
import { geoidUndulationM } from '@/lib/geodeticDatum';

const LAT = 38.8048;
const LNG = -77.0469;
const GROUND_M = 80 + geoidUndulationM(LAT);   // ellipsoidal ground datum

function v(p: any): Vec3 { return { x: p.x, y: p.y, z: p.z }; }
function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(a: Vec3, k: number): Vec3 { return { x: a.x * k, y: a.y * k, z: a.z * k }; }
function centroid(pts: Vec3[]): Vec3 {
  const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 });
  return scale(s, 1 / pts.length);
}

/** A ray from a camera position toward a world target — exactly the shape
 *  `Cesium.Camera.getPickRay` returns (origin in ECEF, direction in ECEF). */
function rayTo(target: Vec3, cameraOffsetM: Vec3) {
  const origin = add(target, cameraOffsetM);
  return { origin, direction: sub(target, origin) };
}

/** Straight down from 200 m above the target, along the local up. */
function rayFromAbove(target: Vec3, heightM = 200) {
  const up = (() => {
    const m = Math.sqrt(target.x ** 2 + target.y ** 2 + target.z ** 2);
    return { x: target.x / m, y: target.y / m, z: target.z / m };
  })();
  return rayTo(target, scale(up, heightM));
}

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Metres east/north offsets converted to a lat/lng near the site. */
function offsetLatLng(dEastM: number, dNorthM: number) {
  const mLat = 111320;
  return {
    lat: LAT + dNorthM / mLat,
    lng: LNG + dEastM / (mLat * Math.cos(LAT * Math.PI / 180)),
  };
}

/** A 2D-traced face — the hand-modelled fallback provider's shape. No origin3D,
 *  no ecefFrame3D: `resolvePlaneGeometry` sends it down the legacy branch. */
function tracedFace(id: string, box: { e0: number; e1: number; n0: number; n1: number }, azimuth: number): any {
  const verts = [
    offsetLatLng(box.e0, box.n0),
    offsetLatLng(box.e1, box.n0),
    offsetLatLng(box.e1, box.n1),
    offsetLatLng(box.e0, box.n1),
  ];
  const c = offsetLatLng((box.e0 + box.e1) / 2, (box.n0 + box.n1) / 2);
  return {
    id,
    vertices: verts,
    pitch: 25,
    azimuth,
    area: Math.abs((box.e1 - box.e0) * (box.n1 - box.n0)),
    usableArea: 1,
    centroidLat: c.lat,
    centroidLng: c.lng,
    planeHeightAtCenterMeters: 5,
    source: 'manual',
  };
}

/** A face carrying its own exact 3D frame — what the 3D point-picking tool and
 *  the Google/Solar-API provider both emit. Built as a flat quad at a chosen
 *  height so the test can place one face above another on purpose. */
function framedFace(id: string, box: { e0: number; e1: number; n0: number; n1: number }, heightM: number): any {
  const corners = [
    offsetLatLng(box.e0, box.n0),
    offsetLatLng(box.e1, box.n0),
    offsetLatLng(box.e1, box.n1),
    offsetLatLng(box.e0, box.n1),
  ].map(ll => latLngToECEF(ll.lat, ll.lng, GROUND_M + heightM));
  const o = corners[0];
  const up = (() => {
    const m = Math.sqrt(o.x ** 2 + o.y ** 2 + o.z ** 2);
    return { x: o.x / m, y: o.y / m, z: o.z / m };
  })();
  const uRaw = sub(v(corners[1]), v(corners[0]));
  const um = Math.sqrt(uRaw.x ** 2 + uRaw.y ** 2 + uRaw.z ** 2);
  const u = scale(uRaw, 1 / um);
  return {
    id,
    vertices: [],
    pitch: 0,
    azimuth: 180,
    area: 1,
    usableArea: 1,
    origin3D: v(o),
    ecefFrame3D: { u, v: { x: up.y * u.z - up.z * u.y, y: up.z * u.x - up.x * u.z, z: up.x * u.y - up.y * u.x }, n: up },
    normal3D: up,
    polygon3D: corners.map(v),
    createdFrom3D: true,
    source: 'manual',
  };
}

/** Turn a RoofPlane into the interaction contract, through the production
 *  resolver — the same call the renderer makes before drawing it. */
function selectable(plane: any): SelectableFace {
  const g = resolvePlaneGeometry(plane, GROUND_M);
  return {
    faceId: plane.id,
    normal: v(g.ecefFrame3D.n),
    polygon: g.polygon3D.map(v),
  };
}

/** A gable: two 6 m x 8 m faces meeting at a shared ridge at north = 0. */
function gable(): SelectableFace[] {
  return [
    selectable(tracedFace('face-A', { e0: -4, e1: 4, n0: -6, n1: 0 }, 180)),
    selectable(tracedFace('face-B', { e0: -4, e1: 4, n0: 0, n1: 6 }, 0)),
  ];
}

/** A gable whose two faces share the ridge EXACTLY — both reference the same two
 *  Cartesian3 values, so the shared edge is bit-identical.
 *
 *  This exists because the legacy 2D resolver does NOT produce coincident ridge
 *  corners: `computeEcefFrameForLegacyPlane` derives vertex heights with a
 *  flat-earth projection and then projects each face's corners onto the plane
 *  THAT FACE declares, and two faces of opposite azimuth project the shared
 *  corners slightly differently. Measured on the traced gable above: 2.96 mm.
 *  That is a real, separately-recorded property of the legacy branch and it is
 *  NOT something to hide inside a widened tolerance here — so the ridge-geometry
 *  test uses geometry that is exact by construction, and the traced gable is
 *  tested for PREDICTABLE RESOLUTION instead, which is what a user needs. */
function gableSharedRidge(): SelectableFace[] {
  const h = 5;
  const ridgeW = latLngToECEF(offsetLatLng(-4, 0).lat, offsetLatLng(-4, 0).lng, GROUND_M + h + 2);
  const ridgeE = latLngToECEF(offsetLatLng(4, 0).lat, offsetLatLng(4, 0).lng, GROUND_M + h + 2);
  const eaveSW = latLngToECEF(offsetLatLng(-4, -6).lat, offsetLatLng(-4, -6).lng, GROUND_M + h);
  const eaveSE = latLngToECEF(offsetLatLng(4, -6).lat, offsetLatLng(4, -6).lng, GROUND_M + h);
  const eaveNW = latLngToECEF(offsetLatLng(-4, 6).lat, offsetLatLng(-4, 6).lng, GROUND_M + h);
  const eaveNE = latLngToECEF(offsetLatLng(4, 6).lat, offsetLatLng(4, 6).lng, GROUND_M + h);
  return [
    { faceId: 'face-A', normal: null, polygon: [v(eaveSW), v(eaveSE), v(ridgeE), v(ridgeW)] },
    { faceId: 'face-B', normal: null, polygon: [v(ridgeW), v(ridgeE), v(eaveNE), v(eaveNW)] },
  ];
}

// ── The plain case ──────────────────────────────────────────────────────────

describe('face hit test — a click resolves to the canonical face id', () => {
  it('selects A when the ray passes through A, and B when it passes through B', () => {
    const faces = gable();
    const a = faces.find(f => f.faceId === 'face-A')!;
    const b = faces.find(f => f.faceId === 'face-B')!;

    expect(pickFace(rayFromAbove(centroid(a.polygon)), faces)?.faceId).toBe('face-A');
    expect(pickFace(rayFromAbove(centroid(b.polygon)), faces)?.faceId).toBe('face-B');
  });

  it('resolves the SAME contract for a 2D-traced face and a 3D-framed face', () => {
    // The two providers produce different source structures on purpose. Neither
    // impersonates the other, and the interaction layer does not know which is
    // which.
    const traced = selectable(tracedFace('t1', { e0: -3, e1: 3, n0: -3, n1: 3 }, 180));
    const framed = selectable(framedFace('f1', { e0: 20, e1: 26, n0: -3, n1: 3 }, 5));

    expect(pickFace(rayFromAbove(centroid(traced.polygon)), [traced, framed])?.faceId).toBe('t1');
    expect(pickFace(rayFromAbove(centroid(framed.polygon)), [traced, framed])?.faceId).toBe('f1');
  });

  it('A -> B -> A returns the same id for A both times', () => {
    const faces = gable();
    const aPoint = centroid(faces[0].polygon);
    const bPoint = centroid(faces[1].polygon);

    const first  = pickFace(rayFromAbove(aPoint), faces)?.faceId;
    const middle = pickFace(rayFromAbove(bPoint), faces)?.faceId;
    const back   = pickFace(rayFromAbove(aPoint), faces)?.faceId;

    expect(first).toBe('face-A');
    expect(middle).toBe('face-B');
    expect(back).toBe(first);
  });
});

// ── The adversarial cases ───────────────────────────────────────────────────

describe('face hit test — empty space, walls and misses', () => {
  it('returns null for a click well clear of every face', () => {
    const faces = gable();
    const far = latLngToECEF(offsetLatLng(500, 500).lat, offsetLatLng(500, 500).lng, GROUND_M);
    expect(pickFace(rayFromAbove(v(far)), faces)).toBeNull();
  });

  it('returns null for a ray pointing AWAY from the roof', () => {
    // Everything is behind the camera. A roof behind you is not under the cursor.
    const faces = gable();
    const target = centroid(faces[0].polygon);
    const good = rayFromAbove(target);
    const away = { origin: good.origin, direction: scale(good.direction, -1) };
    expect(pickFace(away, faces)).toBeNull();
  });

  it('a face the ray is parallel to is not a hit', () => {
    const faces = gable();
    const a = faces[0];
    // Travel along the plane itself: direction perpendicular to the normal.
    const edge = sub(a.polygon[1], a.polygon[0]);
    expect(pickFace({ origin: a.polygon[0], direction: edge }, [a])).toBeNull();
  });

  it('an empty face list is a miss, not a throw', () => {
    expect(pickFace(rayFromAbove({ x: 1e6, y: 1e6, z: 1e6 }), [])).toBeNull();
  });
});

describe('face hit test — ridges and overlaps resolve predictably', () => {
  it('a click on an EXACTLY shared ridge resolves to an adjacent face, identically every time', () => {
    const faces = gableSharedRidge();
    const a = faces[0], b = faces[1];
    // The shared edge is bit-identical, so this really is a ridge click.
    expect(a.polygon[2]).toEqual(b.polygon[1]);
    expect(a.polygon[3]).toEqual(b.polygon[0]);

    const ridge = centroid([a.polygon[2], a.polygon[3]]);
    const ray = rayFromAbove(ridge);
    const answers = new Set([
      pickFace(ray, faces)?.faceId,
      pickFace(ray, faces)?.faceId,
      pickFace(ray, [...faces].reverse())?.faceId,
    ]);
    // One answer, not two, and never null or a stranger. Which of the two it is
    // does not matter; that it is STABLE, and stable under list order, does.
    expect(answers.size).toBe(1);
    expect(['face-A', 'face-B']).toContain([...answers][0]);
  });

  it('a click just INSIDE a face near the ridge resolves to that face, on both sides', () => {
    // This is the behaviour a user actually depends on at a ridge: 10 cm onto
    // face A is face A, 10 cm onto face B is face B. Run on the TRACED gable,
    // where the two faces do not share corners exactly (2.96 mm apart), so it
    // also proves that artefact does not reach the interaction.
    const faces = gable();
    const a = faces.find(f => f.faceId === 'face-A')!;
    const b = faces.find(f => f.faceId === 'face-B')!;
    const nudge = (f: SelectableFace, ridgeIdx: [number, number], eaveIdx: [number, number], d: number) => {
      const ridge = centroid([f.polygon[ridgeIdx[0]], f.polygon[ridgeIdx[1]]]);
      const eave  = centroid([f.polygon[eaveIdx[0]],  f.polygon[eaveIdx[1]]]);
      const dir   = sub(eave, ridge);
      const m     = Math.hypot(dir.x, dir.y, dir.z);
      return add(ridge, scale(dir, d / m));
    };
    expect(pickFace(rayFromAbove(nudge(a, [2, 3], [0, 1], 0.10)), faces)?.faceId).toBe('face-A');
    expect(pickFace(rayFromAbove(nudge(b, [0, 1], [2, 3], 0.10)), faces)?.faceId).toBe('face-B');
  });

  it('when two faces overlap, the one NEAREST the camera wins', () => {
    // A canopy over a roof: same footprint, one 5 m up, one 9 m up.
    const lower = selectable(framedFace('lower', { e0: -3, e1: 3, n0: -3, n1: 3 }, 5));
    const upper = selectable(framedFace('upper', { e0: -3, e1: 3, n0: -3, n1: 3 }, 9));
    const target = centroid(upper.polygon);

    const fromAbove = pickFaces(rayFromAbove(target), [lower, upper]);
    expect(fromAbove.map(h => h.faceId)).toEqual(['upper', 'lower']);
    expect(pickFace(rayFromAbove(target), [lower, upper])?.faceId).toBe('upper');

    // And list order does not decide it.
    expect(pickFace(rayFromAbove(target), [upper, lower])?.faceId).toBe('upper');
  });

  it('camera position does not change which face a world point belongs to', () => {
    const faces = gable();
    const a = faces.find(f => f.faceId === 'face-A')!;
    const target = centroid(a.polygon);
    const up = (() => {
      const m = Math.sqrt(target.x ** 2 + target.y ** 2 + target.z ** 2);
      return { x: target.x / m, y: target.y / m, z: target.z / m };
    })();
    const east = (() => {
      const r = sub(a.polygon[1], a.polygon[0]);
      const m = Math.sqrt(r.x ** 2 + r.y ** 2 + r.z ** 2);
      return scale(r, 1 / m);
    })();
    const north = { x: up.y * east.z - up.z * east.y, y: up.z * east.x - up.x * east.z, z: up.x * east.y - up.y * east.x };

    // Overhead, oblique from four sides, and close in — every camera that can
    // see this point must agree about which face it is on.
    const offsets = [
      scale(up, 300),
      add(scale(up, 120), scale(east, 120)),
      add(scale(up, 120), scale(east, -120)),
      add(scale(up, 120), scale(north, 120)),
      add(scale(up, 120), scale(north, -120)),
      add(scale(up, 15), scale(east, 8)),
    ];
    for (const off of offsets) {
      expect(pickFace(rayTo(target, off), faces)?.faceId).toBe('face-A');
    }
  });
});

describe('face hit test — identity survives rebuild, reorder, deletion and addition', () => {
  it('a rebuilt polygon with brand-new objects resolves to the same id', () => {
    // Proves identity is the canonical faceId, not object identity, not array
    // position, and not a renderer handle.
    const faces = gable();
    const target = centroid(faces[0].polygon);
    const before = pickFace(rayFromAbove(target), faces)?.faceId;

    const rebuilt = gable().map(f => ({
      faceId: f.faceId,
      normal: { ...f.normal! },
      polygon: f.polygon.map(p => ({ x: p.x, y: p.y, z: p.z })),
    }));
    expect(rebuilt[0].polygon[0]).not.toBe(faces[0].polygon[0]);   // genuinely new objects
    expect(pickFace(rayFromAbove(target), rebuilt)?.faceId).toBe(before);
  });

  it('reordering the face list does not change the answer', () => {
    const faces = gable();
    const target = centroid(faces[1].polygon);
    expect(pickFace(rayFromAbove(target), faces)?.faceId).toBe('face-B');
    expect(pickFace(rayFromAbove(target), [...faces].reverse())?.faceId).toBe('face-B');
  });

  it('deleting a face makes its area a miss and leaves its neighbour alone', () => {
    const faces = gable();
    const bPoint = centroid(faces[1].polygon);
    const aPoint = centroid(faces[0].polygon);
    const without = faces.filter(f => f.faceId !== 'face-B');

    expect(pickFace(rayFromAbove(bPoint), without)).toBeNull();
    expect(pickFace(rayFromAbove(aPoint), without)?.faceId).toBe('face-A');
  });

  it('adding a face does not move an existing selection', () => {
    const faces = gable();
    const aPoint = centroid(faces[0].polygon);
    const extended = [...faces, selectable(tracedFace('face-C', { e0: 40, e1: 46, n0: -3, n1: 3 }, 90))];
    expect(pickFace(rayFromAbove(aPoint), extended)?.faceId).toBe('face-A');
  });
});

describe('face hit test — the primitives it stands on', () => {
  it('pointInPolygon3D works on a near-vertical face, where a world-axis projection would collapse', () => {
    // A wall. Projecting onto the horizontal plane would flatten this to a line
    // and every containment answer would be garbage; the in-plane basis does not.
    const o = latLngToECEF(LAT, LNG, GROUND_M);
    const up = (() => { const m = Math.hypot(o.x, o.y, o.z); return { x: o.x / m, y: o.y / m, z: o.z / m }; })();
    const east = { x: -Math.sin(LNG * Math.PI / 180), y: Math.cos(LNG * Math.PI / 180), z: 0 };
    const quad = [
      v(o),
      add(v(o), scale(east, 6)),
      add(add(v(o), scale(east, 6)), scale(up, 4)),
      add(v(o), scale(up, 4)),
    ];
    const n = newellNormal(quad)!;
    expect(n).not.toBeNull();

    const inside = add(add(v(o), scale(east, 3)), scale(up, 2));
    const outside = add(add(v(o), scale(east, 9)), scale(up, 2));
    expect(pointInPolygon3D(inside, quad, n)).toBe(true);
    expect(pointInPolygon3D(outside, quad, n)).toBe(false);
  });

  it('falls back to a Newell normal when the face does not carry a usable one', () => {
    const faces = gable();
    const a = faces[0];
    const target = centroid(a.polygon);
    const noNormal: SelectableFace = { faceId: a.faceId, normal: null, polygon: a.polygon };
    const nanNormal: SelectableFace = { faceId: a.faceId, normal: { x: NaN, y: 0, z: 0 }, polygon: a.polygon };

    expect(pickFace(rayFromAbove(target), [noNormal])?.faceId).toBe('face-A');
    expect(pickFace(rayFromAbove(target), [nanNormal])?.faceId).toBe('face-A');
  });

  it('a degenerate face (fewer than 3 points) is skipped, not thrown on', () => {
    const faces = gable();
    const target = centroid(faces[0].polygon);
    const degenerate: SelectableFace = { faceId: 'bad', normal: null, polygon: [faces[0].polygon[0]] };
    expect(pickFace(rayFromAbove(target), [degenerate, ...faces])?.faceId).toBe('face-A');
  });
});

describe('selectableFacesFrom — the design decides which faces exist, not the render cache', () => {
  /**
   * SolarEngine3D's three plane maps are never pruned — there is no `.delete()`
   * on any of them anywhere in the file, and that is DELIBERATE: a
   * reconcile-deletions block once removed entities for any id missing from the
   * `roofPlanes` prop and destroyed a user's traced garage, because the prop has
   * its own timing and "absent from a prop" is not "the user deleted it".
   *
   * A ghost outline was a cosmetic annoyance right up until those maps became
   * the input to a PICK. Then it became a clickable face resolving to a
   * canonical id the design no longer holds — and because the maps survive an
   * address change, a face traced at one property stays selectable while a
   * different property is on screen.
   */
  const geom = (poly: Vec3[]) => ({ polygon: poly, normal: null });

  it('offers only faces the design still contains', () => {
    const faces = gable();
    const rendered = faces.map(f => [f.faceId, geom(f.polygon)] as const);

    const both = selectableFacesFrom(rendered, new Set(['face-A', 'face-B']));
    expect(both.map(f => f.faceId).sort()).toEqual(['face-A', 'face-B']);

    const onlyA = selectableFacesFrom(rendered, new Set(['face-A']));
    expect(onlyA.map(f => f.faceId)).toEqual(['face-A']);
  });

  it('A DELETED FACE IS NOT CLICKABLE, even though the render cache still holds it', () => {
    const faces = gable();
    const rendered = faces.map(f => [f.faceId, geom(f.polygon)] as const);
    const target = centroid(faces[1].polygon);

    // Before: B is in the design and is hit.
    expect(pickFace(rayFromAbove(target), selectableFacesFrom(rendered, new Set(['face-A', 'face-B'])))?.faceId)
      .toBe('face-B');

    // After the user deletes B: the entities and the cache entry both remain —
    // nothing is pruned — but the click must no longer resolve to it.
    expect(pickFace(rayFromAbove(target), selectableFacesFrom(rendered, new Set(['face-A']))))
      .toBeNull();
  });

  it("ANOTHER PROPERTY'S face cannot be selected while this one is on screen", () => {
    // The address-change effect resets several per-location refs; the three
    // plane maps are not among them. This is the cross-site case.
    const here = gable();
    // Placed a long way off, because a different PROPERTY is a different place.
    const there = selectable(tracedFace('other-site-face', { e0: 600, e1: 606, n0: 600, n1: 606 }, 180));
    const rendered = [...here, there].map(f => [f.faceId, geom(f.polygon)] as const);

    const design = new Set(here.map(f => f.faceId));   // only THIS property's faces
    const offered = selectableFacesFrom(rendered, design);
    expect(offered.map(f => f.faceId)).not.toContain('other-site-face');

    // And a click over the stale face finds nothing rather than the stranger.
    expect(pickFace(rayFromAbove(centroid(there.polygon)), offered)).toBeNull();
  });

  it('an empty design offers nothing, rather than everything', () => {
    const faces = gable();
    const rendered = faces.map(f => [f.faceId, geom(f.polygon)] as const);
    expect(selectableFacesFrom(rendered, new Set())).toEqual([]);
  });

  it('still drops degenerate geometry, and does not throw on a missing entry', () => {
    const faces = gable();
    const rendered = [
      ['degenerate', geom([faces[0].polygon[0]])] as const,
      [faces[0].faceId, geom(faces[0].polygon)] as const,
    ];
    const offered = selectableFacesFrom(rendered, new Set(['degenerate', 'face-A']));
    expect(offered.map(f => f.faceId)).toEqual(['face-A']);
    expect(selectableFacesFrom([], new Set(['face-A']))).toEqual([]);
  });
});
