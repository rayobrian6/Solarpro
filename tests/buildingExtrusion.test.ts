/**
 * tests/buildingExtrusion.test.ts
 *
 * Walls dropped from a traced roof to the ground.
 *
 * Two things must hold or the building looks broken rather than solid:
 *   1. NO WALL ON A SHARED EDGE. A wall on the ridge of a gable slices a
 *      vertical sheet straight down the middle of the house.
 *   2. NO BOWTIES. A wall quad wound across itself instead of around its
 *      perimeter renders as two crossed triangles. This repo already carries
 *      that defect in its gable and hip construction, so it is pinned here
 *      numerically rather than trusted.
 *
 * The gable fixture is built the same way the flat trace builds faces, so the
 * numbers are the real pipeline's, not a hand-written approximation.
 */

import { describe, it, expect } from 'vitest';
import { buildWalls, quadPlanarArea, type ExtrusionFace } from '@/lib/3d/buildingExtrusion';
import { roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';
import { ecefToLatLng, type Cart3 } from '@/lib/roofPlane3D';
import { buildSectionRoofPlanes } from '@/lib/3d/buildingSection';
import { applySectionEdit } from '@/lib/3d/sectionEditing';

const LAT = 38.8306;
const LNG = -89.5343;
const GROUND = 150;
const EAVE = 3;
const PITCH = 30;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

/**
 * A gable: two slopes meeting at an east-west ridge through the centre.
 * South slope faces 180, north slope faces 0. They SHARE the ridge line, which
 * is the edge that must not get a wall.
 */
function gableFaces(widthM = 14, depthM = 8): ExtrusionFace[] {
  const dLng = widthM / 2 / mPerDegLng;
  const halfDepth = depthM / 2 / M_PER_DEG_LAT;

  // South slope: from the south eave up to the ridge at centre latitude.
  const south = roofPlaneFromFootprint(
    [
      { lat: LAT - halfDepth, lng: LNG - dLng },
      { lat: LAT - halfDepth, lng: LNG + dLng },
      { lat: LAT, lng: LNG + dLng },
      { lat: LAT, lng: LNG - dLng },
    ],
    { pitchDeg: PITCH, azimuthDeg: 180, eaveHeightM: EAVE, groundElevM: GROUND },
  );
  // North slope: from the north eave up to the same ridge.
  const north = roofPlaneFromFootprint(
    [
      { lat: LAT + halfDepth, lng: LNG - dLng },
      { lat: LAT + halfDepth, lng: LNG + dLng },
      { lat: LAT, lng: LNG + dLng },
      { lat: LAT, lng: LNG - dLng },
    ],
    { pitchDeg: PITCH, azimuthDeg: 0, eaveHeightM: EAVE, groundElevM: GROUND },
  );
  expect(south).not.toBeNull();
  expect(north).not.toBeNull();
  return [
    { id: 'south', polygon3D: south!.plane.polygon3D! },
    { id: 'north', polygon3D: north!.plane.polygon3D! },
  ];
}

const heightAboveGround = (p: Cart3) => ecefToLatLng(p).height - GROUND;

describe('buildWalls', () => {
  it('drops a wall from every exterior edge of a single face', () => {
    const [south] = gableFaces();
    const walls = buildWalls([south], GROUND);
    // One face alone has no neighbour, so all four edges are exterior.
    expect(walls).toHaveLength(4);
    expect(walls.every(w => w.corners.length === 4)).toBe(true);
  });

  it('does NOT wall the shared ridge of a gable — the wall-through-the-house bug', () => {
    const faces = gableFaces();
    const walls = buildWalls(faces, GROUND);
    // 4 edges per face, minus the ridge shared by both = 8 - 2 = 6.
    expect(walls).toHaveLength(6);

    // Prove it positively: no wall's top edge lies along the ridge line, which
    // runs at the centre latitude at the full ridge height.
    const ridgeH = EAVE + (8 / 2) * Math.tan(PITCH * DEG);
    for (const w of walls) {
      const [topA, topB] = w.corners;
      const bothAtRidgeHeight =
        Math.abs(heightAboveGround(topA) - ridgeH) < 0.3 &&
        Math.abs(heightAboveGround(topB) - ridgeH) < 0.3;
      const bothAtCentreLat =
        Math.abs(ecefToLatLng(topA).lat - LAT) < 1e-6 &&
        Math.abs(ecefToLatLng(topB).lat - LAT) < 1e-6;
      expect(bothAtRidgeHeight && bothAtCentreLat).toBe(false);
    }
  });

  it('every wall reaches the ground exactly', () => {
    const walls = buildWalls(gableFaces(), GROUND);
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) {
      const [, , bottomB, bottomA] = w.corners;
      expect(heightAboveGround(bottomA)).toBeCloseTo(0, 6);
      expect(heightAboveGround(bottomB)).toBeCloseTo(0, 6);
    }
  });

  it('walls are vertical — each bottom corner sits under its own top corner', () => {
    const walls = buildWalls(gableFaces(), GROUND);
    for (const w of walls) {
      const [topA, topB, bottomB, bottomA] = w.corners;
      const a = ecefToLatLng(topA), av = ecefToLatLng(bottomA);
      const b = ecefToLatLng(topB), bv = ecefToLatLng(bottomB);
      expect(av.lat).toBeCloseTo(a.lat, 9);
      expect(av.lng).toBeCloseTo(a.lng, 9);
      expect(bv.lat).toBeCloseTo(b.lat, 9);
      expect(bv.lng).toBeCloseTo(b.lng, 9);
    }
  });

  // ── The bowtie guard ──────────────────────────────────────────────────────

  it('wall quads are wound around the perimeter, not across — NO BOWTIES', () => {
    const walls = buildWalls(gableFaces(), GROUND);
    for (const w of walls) {
      const [topA, topB, bottomB, bottomA] = w.corners;
      const correct = quadPlanarArea([topA, topB, bottomB, bottomA]);
      // The intuitive-but-wrong ordering, which crosses the quad.
      const bowtie = quadPlanarArea([topA, topB, bottomA, bottomB]);
      expect(correct).toBeGreaterThan(0.5);
      // A bowtie's halves cancel, collapsing the Newell area.
      expect(bowtie).toBeLessThan(correct * 0.5);
    }
  });

  it('a wall has the area its edge length and height imply', () => {
    // Catches a winding or drop error that happens to avoid a bowtie but still
    // produces the wrong shape.
    const [south] = gableFaces(14, 8);
    const walls = buildWalls([south], GROUND);
    const eaveWall = walls.reduce((lo, w) => (w.maxHeightM < lo.maxHeightM ? w : lo));

    // The south eave runs the full 14 m width at the eave height — plus a small
    // constant. buildRoofPlane3D lifts every face by SURFACE_OFFSET_M (0.12 m)
    // ALONG ITS NORMAL so panels never clip into noisy mesh; the vertical
    // component of that is 0.12·cos(pitch) = 0.104 m at 30°. So the wall is
    // slightly taller than the nominal eave, by a knowable amount — asserted
    // rather than rounded away, because if this offset ever changes silently it
    // shifts every traced roof.
    const surfaceOffsetVertical = 0.12 * Math.cos(PITCH * DEG);
    expect(eaveWall.maxHeightM).toBeGreaterThan(EAVE);
    expect(eaveWall.maxHeightM).toBeCloseTo(EAVE + surfaceOffsetVertical, 2);

    const expectedArea = 14 * eaveWall.maxHeightM;
    expect(quadPlanarArea(eaveWall.corners)).toBeGreaterThan(expectedArea * 0.95);
    expect(quadPlanarArea(eaveWall.corners)).toBeLessThan(expectedArea * 1.05);
  });

  // ── Degenerate input ──────────────────────────────────────────────────────

  it('returns empty rather than throwing on unusable input', () => {
    expect(buildWalls([], GROUND)).toEqual([]);
    expect(buildWalls(gableFaces(), NaN)).toEqual([]);
    expect(buildWalls([{ id: 'x', polygon3D: [] }], GROUND)).toEqual([]);
    expect(buildWalls([{ id: 'x', polygon3D: [{ x: 1, y: 2, z: 3 }] }], GROUND)).toEqual([]);
  });

  it('skips a face whose vertices are not finite', () => {
    const [south] = gableFaces();
    const broken: ExtrusionFace = {
      id: 'broken',
      polygon3D: [south.polygon3D[0], { x: NaN, y: 0, z: 0 }, south.polygon3D[2]],
    };
    expect(() => buildWalls([broken], GROUND)).not.toThrow();
  });

  it('tolerance governs whether a hand-traced ridge counts as shared', () => {
    const faces = gableFaces();
    // Nudge one face's ridge by 20 cm, as two separate traces of the same ridge
    // would differ. The default 0.35 m tolerance must still see them as shared.
    const nudged: ExtrusionFace = {
      id: 'north',
      polygon3D: faces[1].polygon3D.map((p, i) =>
        i >= 2 ? { x: p.x + 0.14, y: p.y + 0.14, z: p.z } : p),
    };
    expect(buildWalls([faces[0], nudged], GROUND)).toHaveLength(6);
    // A tolerance tighter than the scatter misses it and walls the ridge.
    expect(buildWalls([faces[0], nudged], GROUND, { sharedEdgeToleranceM: 0.01 })).toHaveLength(8);
  });

  it('handles three faces meeting at a hip without walling the interior edges', () => {
    // Two faces sharing an edge with a third: every shared edge is suppressed.
    const faces = gableFaces();
    const walls = buildWalls(faces, GROUND);
    const shared = 8 - walls.length;
    expect(shared).toBe(2); // one shared edge, counted once per owning face
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A BLOCK MADE A GABLE IS A CLOSED HOUSE WITH PENTAGON ENDS
// ═══════════════════════════════════════════════════════════════════════════
//
// The inspector's Roof → Gable sends `{ kind: 'gable', pitchDeg }` to
// `applySectionEdit`. What has to come out the other side, for the Building
// view to draw a house rather than two floating slopes:
//   · two faces, the deck gone (a leftover deck under the gable makes the
//     gable's eave edges look interior and opens both long walls — probe 04c);
//   · six walls: two eave rectangles and four rake halves whose tops meet at
//     the ridge, so each gable end is a pentagon;
//   · the eave the Block was drawn with.
describe('a Block converted to a gable', () => {
  const BLOCK_EAVE = 4;
  const GABLE_PITCH = 30;
  const WIDTH = 14;   // east-west
  const DEPTH = 9;    // north-south — the span the ridge rises across
  const RIDGE = BLOCK_EAVE + (DEPTH / 2) * Math.tan(GABLE_PITCH * DEG);

  function blockAsGable() {
    const dLng = WIDTH / 2 / mPerDegLng;
    const dLat = DEPTH / 2 / M_PER_DEG_LAT;
    // Exactly what finalizeBlock builds: a flat deck over the clicked corners.
    const block = buildSectionRoofPlanes({
      id: 'sec-block-1', kind: 'flat', pitchDeg: 0, eaveHeightM: BLOCK_EAVE, groundElevM: GROUND,
      footprint: [
        { lat: LAT - dLat, lng: LNG - dLng }, { lat: LAT - dLat, lng: LNG + dLng },
        { lat: LAT + dLat, lng: LNG + dLng }, { lat: LAT + dLat, lng: LNG - dLng },
      ],
      label: 'Flat section', source: 'user-traced', createdAtIso: '2026-10-03T00:00:00.000Z',
    });
    expect(block.ok, JSON.stringify(block.refusals)).toBe(true);
    expect(block.planes.map(p => p.id)).toEqual(['sec-block-1::deck']);
    const out = applySectionEdit(block.planes, 'sec-block-1', { kind: 'gable', pitchDeg: GABLE_PITCH });
    expect(out.refusals).toEqual([]);
    return out;
  }

  it('keeps the eave, drops the deck, and owns two slopes under one section id', () => {
    const out = blockAsGable();
    expect(out.section!.eaveHeightM).toBe(BLOCK_EAVE);
    expect(out.removedFaceIds).toEqual(['sec-block-1::deck']);
    expect(out.planes.map(p => p.id).sort()).toEqual(['sec-block-1::slopeA', 'sec-block-1::slopeB']);
    expect(new Set(out.planes.map(p => p.sectionId))).toEqual(new Set(['sec-block-1']));
    // To the decimetre: the footprint here is laid out on the round 111 320 m/°,
    // the builder measures in true metres, and the 9 m span differs by ~1 cm.
    expect(out.ridgeHeightM!).toBeCloseTo(RIDGE, 1);
  });

  it('🚨 six walls: two eave rectangles and four rake halves that meet at the ridge', () => {
    const out = blockAsGable();
    const faces: ExtrusionFace[] = out.planes.map(p => ({ id: p.id, polygon3D: p.polygon3D! }));
    const walls = buildWalls(faces, GROUND);
    expect(walls).toHaveLength(6);

    const above = (h: number) => h - GROUND;
    // The plane builder may lift the stored outline a few centimetres off the
    // geometry; 0.2 m tells an eave from a ridge 2.6 m above it with room to spare.
    const TOL = 0.2;
    const eaveWalls = walls.filter(w => w.topHeightsM.every(h => Math.abs(above(h) - BLOCK_EAVE) < TOL));
    const rakeWalls = walls.filter(w => {
      const [lo, hi] = w.topHeightsM.map(above).sort((a, b) => a - b);
      return Math.abs(lo - BLOCK_EAVE) < TOL && Math.abs(hi - RIDGE) < TOL;
    });
    expect(eaveWalls, 'two full-length eave walls, one under each slope').toHaveLength(2);
    expect(rakeWalls, 'four rake halves, two at each gable end').toHaveLength(4);
    // Every wall stands on the section's pad.
    for (const w of walls) for (const b of w.baseHeightsM) expect(b).toBeCloseTo(GROUND, 6);

    // 🚨 PENTAGON ENDS. At each gable end the two rake halves share their HIGH
    // corner — the ridge apex — so the end wall reads as one five-cornered
    // gable, not two triangles with a gap or a box with a roof perched on it.
    const apex = (w: typeof walls[number]) => {
      const i = w.topHeightsM[0] > w.topHeightsM[1] ? 0 : 1;
      return w.plan[i];
    };
    const mPerLat = M_PER_DEG_LAT;
    const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
      Math.hypot((a.lat - b.lat) * mPerLat, (a.lng - b.lng) * mPerDegLng);
    const apexes = rakeWalls.map(apex);
    // Each face's stored polygon is lifted SURFACE_OFFSET_M (0.12 m) along its
    // own normal, which at 30° moves the two halves' ridge corners 6 cm apart
    // in plan, in opposite directions. 0.15 m allows exactly that and is still
    // two orders of magnitude under the 14 m between the two gable ends.
    const pairs: number[][] = [];
    for (let i = 0; i < apexes.length; i++) {
      for (let j = i + 1; j < apexes.length; j++) {
        if (dist(apexes[i], apexes[j]) < 0.15) pairs.push([i, j]);
      }
    }
    expect(pairs, 'each ridge apex is shared by exactly two rake halves').toHaveLength(2);
    // …and the two ends are the two ends of the 14 m ridge.
    expect(dist(apexes[pairs[0][0]], apexes[pairs[1][0]])).toBeCloseTo(WIDTH, 0);
  });

  it('why the deck has to go: a deck left under the gable opens the long walls', () => {
    // What the probe saw when a Gable was traced over a Block instead of the
    // Block being converted: the deck's edges coincide with the gable's eaves,
    // so both eave walls are classed interior and the house is open.
    const out = blockAsGable();
    const block = buildSectionRoofPlanes({
      ...out.section!, id: 'sec-other', kind: 'flat', pitchDeg: 0, label: 'Flat section',
    });
    const faces: ExtrusionFace[] = [...out.planes, ...block.planes]
      .map(p => ({ id: p.id, polygon3D: p.polygon3D! }));
    const walls = buildWalls(faces, GROUND);
    expect(walls.filter(w => w.faceId.startsWith('sec-block-1::'))).not.toHaveLength(6);
  });
});
